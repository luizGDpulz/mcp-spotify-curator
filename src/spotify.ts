import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  backupDir?: string;
  maxRetries?: number;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  release_date?: string;
  duration_ms?: number;
  added_at?: string;
}

export interface SpotifyArtist {
  id: string;
  uri: string;
  name: string;
  genres: string[];
  popularity?: number;
  url?: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  total_tracks: number;
  public: boolean | null;
  collaborative: boolean;
  owner: string;
  url: string;
}

export interface SearchTrackResult {
  query: string;
  found: boolean;
  uri?: string;
  name?: string;
  artists?: string[];
  album?: string;
  release_date?: string;
  duration_ms?: number;
  url?: string;
}

export interface RecentlyPlayedItem {
  played_at: string;
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  duration_ms?: number;
}

export interface CurrentPlaybackInfo {
  is_playing: boolean;
  currently_playing_type?: string;
  progress_ms?: number | null;
  device?: {
    name: string;
    type: string;
    volume_percent: number | null;
  };
  track?: SpotifyTrack | null;
}

export interface PlaylistBackupMetadata {
  backup_id: string;
  playlist_id: string;
  created_at: string;
  reason: string;
  total_tracks: number;
  file_path: string;
}

export interface PlaylistBackupData extends PlaylistBackupMetadata {
  tracks: SpotifyTrack[];
}

export type DuplicateMatchMode = "uri" | "title_artist";

export interface DeduplicateResult {
  playlist_id: string;
  dry_run: boolean;
  match_by: DuplicateMatchMode;
  original_count: number;
  unique_count: number;
  removed_count: number;
  duplicates: Array<{
    uri: string;
    name: string;
    artists: string[];
    reason: string;
  }>;
  backup_id?: string;
}

export type SortCriterion =
  | "name"
  | "artist"
  | "album"
  | "duration"
  | "release_date"
  | "added_at";

export type SortOrder = "asc" | "desc";

export interface SortPlaylistResult {
  success: boolean;
  playlist_id: string;
  criteria: SortCriterion;
  order: SortOrder;
  total_tracks: number;
  backup_id?: string;
  preview_first_5: string[];
}

export function cleanPlaylistId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("spotify:playlist:")) {
    return trimmed.replace("spotify:playlist:", "");
  }
  const match = trimmed.match(/playlist\/([a-zA-Z0-9]+)/);
  if (match) {
    return match[1];
  }
  return trimmed;
}

export function cleanTrackUri(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("spotify:track:") || trimmed.startsWith("spotify:episode:")) {
    return trimmed;
  }
  const match = trimmed.match(/track\/([a-zA-Z0-9]+)/);
  if (match) {
    return `spotify:track:${match[1]}`;
  }
  const epMatch = trimmed.match(/episode\/([a-zA-Z0-9]+)/);
  if (epMatch) {
    return `spotify:episode:${epMatch[1]}`;
  }
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return `spotify:track:${trimmed}`;
  }
  return trimmed;
}

/**
 * Normaliza o título de uma faixa removendo sufixos comuns de remasterização
 * para comparação inteligente de duplicatas.
 */
export function normalizeTrackSignature(name: string, artists: string[]): string {
  const normalizedTitle = name
    .toLowerCase()
    .replace(
      /\s*[-–—]\s*((\d{4}\s+)?remaster(ed)?(\s+\d{4})?|mono|stereo|single version|album version|radio edit).*$/i,
      ""
    )
    .replace(
      /\s*\(((\d{4}\s+)?remaster(ed)?(\s+\d{4})?|feat\..*|with\s+.*)\)/gi,
      ""
    )
    .replace(
      /\s*\[((\d{4}\s+)?remaster(ed)?(\s+\d{4})?|feat\..*)\]/gi,
      ""
    )
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  const primaryArtist = (artists[0] || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  return `${normalizedTitle}:::${primaryArtist}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SpotifyClient {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private backupDir: string;
  private maxRetries: number;

  constructor(config: SpotifyConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
    this.backupDir =
      config.backupDir ||
      process.env.SPOTIFY_BACKUP_DIR ||
      path.join(os.homedir(), ".cache", "mcp-spotify-curator", "backups");
    this.maxRetries = config.maxRetries ?? 3;
  }

  public async getAccessToken(): Promise<string> {
    // Se o token ainda for válido por pelo menos 60 segundos, reutiliza
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    const authHeader = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Falha ao renovar token do Spotify (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      scope: string;
      expires_in: number;
      refresh_token?: string;
    };

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    return this.accessToken;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let token = await this.getAccessToken();
    const url = endpoint.startsWith("http")
      ? endpoint
      : `https://api.spotify.com/v1${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    let attempt = 0;
    let refreshed401 = false;

    while (true) {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Se receber 401 Unauthorized, renova o token e tenta novamente uma única vez
      if (response.status === 401 && !refreshed401) {
        refreshed401 = true;
        this.accessToken = null;
        token = await this.getAccessToken();
        headers.Authorization = `Bearer ${token}`;
        continue;
      }

      // Tratamento de Rate Limiting (HTTP 429) e erros transitórios (502, 503, 504)
      if (
        (response.status === 429 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504) &&
        attempt < this.maxRetries
      ) {
        attempt++;
        const retryAfterHeader = response.headers.get("retry-after");
        let waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        if (retryAfterHeader) {
          const parsedSeconds = Number(retryAfterHeader);
          if (!Number.isNaN(parsedSeconds) && parsedSeconds >= 0) {
            waitMs = Math.min(parsedSeconds * 1000, 30000);
          }
        }
        await sleep(waitMs);
        continue;
      }

      if (response.status === 204) {
        return null as T;
      }

      if (!response.ok) {
        let message = response.statusText;
        try {
          const errorJson = (await response.json()) as { error?: { message?: string } };
          if (errorJson?.error?.message) {
            message = errorJson.error.message;
          }
        } catch {
          // Fallback para statusText
        }

        if (
          response.status === 403 &&
          (endpoint.includes("/me/tracks") ||
            endpoint.includes("/me/top") ||
            endpoint.includes("/me/player"))
        ) {
          throw new Error(
            `Spotify API error [403]: ${message}. Dica: Este recurso exige escopos adicionais de leitura do usuário. Execute 'pnpm run auth:setup' no terminal para atualizar suas permissões OAuth.`
          );
        }

        throw new Error(`Spotify API error [${response.status}]: ${message}`);
      }

      const text = await response.text();
      if (!text) {
        return null as T;
      }
      return JSON.parse(text) as T;
    }
  }

  /**
   * Obtém informações do perfil do usuário autenticado.
   */
  public async getCurrentUser(): Promise<{ id: string; display_name: string }> {
    return this.request<{ id: string; display_name: string }>("/me");
  }

  /**
   * Lista as playlists do usuário autenticado.
   */
  public async listUserPlaylists(limit = 50): Promise<PlaylistSummary[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const data = await this.request<{
      items: Array<{
        id: string;
        name: string;
        description: string | null;
        tracks?: { total: number };
        items?: { total: number };
        public: boolean | null;
        collaborative: boolean;
        owner?: { display_name?: string; id: string };
        external_urls?: { spotify: string };
      }>;
    }>(`/me/playlists?limit=${safeLimit}`);

    return (data.items || []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      total_tracks: p.tracks?.total ?? p.items?.total ?? 0,
      public: p.public,
      collaborative: p.collaborative,
      owner: p.owner?.display_name || p.owner?.id || "Desconhecido",
      url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
    }));
  }

  /**
   * Retorna todas as faixas de uma playlist com detalhes higienizados.
   */
  public async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const id = cleanPlaylistId(playlistId);
    const tracks: SpotifyTrack[] = [];
    let offset = 0;
    const limit = 100;
    const maxTracks = 1000; // Limite de proteção contra paginação infinita

    while (offset < maxTracks) {
      const data = await this.request<{
        items: Array<{
          added_at?: string;
          track?: {
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { name: string; release_date?: string };
            duration_ms?: number;
          } | null;
          item?: {
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { name: string; release_date?: string };
            duration_ms?: number;
          } | null;
        }>;
        total: number;
        next: string | null;
      }>(`/playlists/${encodeURIComponent(id)}/items?limit=${limit}&offset=${offset}`);

      if (!data.items || data.items.length === 0) {
        break;
      }

      for (const entry of data.items) {
        const item = entry.item || entry.track;
        if (item && item.uri) {
          tracks.push({
            uri: item.uri,
            name: item.name,
            artists: (item.artists || []).map((a) => a.name),
            album: item.album?.name,
            release_date: item.album?.release_date,
            duration_ms: item.duration_ms,
            added_at: entry.added_at,
          });
        }
      }

      if (!data.next || tracks.length >= data.total) {
        break;
      }

      offset += limit;
    }

    return tracks;
  }

  /**
   * Busca faixas no catálogo do Spotify a partir de uma lista de termos de pesquisa.
   * Suporta filtros avançados do Spotify como 'artist:', 'album:', 'year:', 'genre:'.
   */
  public async searchTracks(queries: string[]): Promise<SearchTrackResult[]> {
    const results: SearchTrackResult[] = [];

    for (const query of queries) {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) continue;

      try {
        const data = await this.request<{
          tracks?: {
            items: Array<{
              uri: string;
              name: string;
              artists?: Array<{ name: string }>;
              album?: { name: string; release_date?: string };
              duration_ms?: number;
              external_urls?: { spotify: string };
            }>;
          };
        }>(`/search?q=${encodeURIComponent(trimmedQuery)}&type=track&limit=1`);

        const topTrack = data.tracks?.items?.[0];
        if (topTrack) {
          results.push({
            query: trimmedQuery,
            found: true,
            uri: topTrack.uri,
            name: topTrack.name,
            artists: (topTrack.artists || []).map((a) => a.name),
            album: topTrack.album?.name,
            release_date: topTrack.album?.release_date,
            duration_ms: topTrack.duration_ms,
            url: topTrack.external_urls?.spotify,
          });
        } else {
          results.push({
            query: trimmedQuery,
            found: false,
          });
        }
      } catch {
        results.push({
          query: trimmedQuery,
          found: false,
        });
      }
    }

    return results;
  }

  /**
   * Cria uma nova playlist para o usuário autenticado.
   */
  public async createPlaylist(
    name: string,
    description?: string,
    isPublic = false
  ): Promise<{ id: string; name: string; description: string | null; url: string; uri: string }> {
    const data = await this.request<{
      id: string;
      name: string;
      description: string | null;
      external_urls?: { spotify: string };
      uri: string;
    }>(`/me/playlists`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || "",
        public: isPublic,
      }),
    });

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      url: data.external_urls?.spotify || `https://open.spotify.com/playlist/${data.id}`,
      uri: data.uri,
    };
  }

  // ============================================================================
  // Sistema de Backup / Snapshot Local
  // ============================================================================

  /**
   * Cria um backup JSON local com as faixas atuais da playlist antes de operações destrutivas.
   */
  public async createPlaylistBackup(
    playlistId: string,
    reason = "manual",
    prefetchedTracks?: SpotifyTrack[]
  ): Promise<PlaylistBackupMetadata> {
    const id = cleanPlaylistId(playlistId);
    const tracks = prefetchedTracks ?? (await this.getPlaylistTracks(id));

    fs.mkdirSync(this.backupDir, { recursive: true });

    const now = new Date();
    const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
    const backupId = `${id}_${safeTimestamp}`;
    const filePath = path.join(this.backupDir, `${backupId}.json`);

    const backupData: PlaylistBackupData = {
      backup_id: backupId,
      playlist_id: id,
      created_at: now.toISOString(),
      reason,
      total_tracks: tracks.length,
      file_path: filePath,
      tracks,
    };

    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), "utf-8");
    this.pruneOldBackups(id, 20);

    return {
      backup_id: backupData.backup_id,
      playlist_id: backupData.playlist_id,
      created_at: backupData.created_at,
      reason: backupData.reason,
      total_tracks: backupData.total_tracks,
      file_path: backupData.file_path,
    };
  }

  private pruneOldBackups(playlistId: string, keepMax = 20): void {
    try {
      if (!fs.existsSync(this.backupDir)) return;
      const files = fs
        .readdirSync(this.backupDir)
        .filter((f) => f.startsWith(`${playlistId}_`) && f.endsWith(".json"))
        .sort()
        .reverse();

      for (const oldFile of files.slice(keepMax)) {
        fs.unlinkSync(path.join(this.backupDir, oldFile));
      }
    } catch {
      // Ignora erros de limpeza de cache
    }
  }

  /**
   * Lista os backups locais disponíveis (opcionalmente filtrados por playlist).
   */
  public listPlaylistBackups(playlistId?: string): PlaylistBackupMetadata[] {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const cleanId = playlistId ? cleanPlaylistId(playlistId) : undefined;
    const files = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".json") && (!cleanId || f.startsWith(`${cleanId}_`)))
      .sort()
      .reverse();

    const backups: PlaylistBackupMetadata[] = [];
    for (const file of files) {
      try {
        const fullPath = path.join(this.backupDir, file);
        const raw = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as PlaylistBackupData;
        backups.push({
          backup_id: raw.backup_id,
          playlist_id: raw.playlist_id,
          created_at: raw.created_at,
          reason: raw.reason,
          total_tracks: raw.total_tracks,
          file_path: fullPath,
        });
      } catch {
        // Ignora arquivos corrompidos
      }
    }

    return backups;
  }

  /**
   * Restaura as faixas de uma playlist a partir de um backup local.
   */
  public async restorePlaylistBackup(
    playlistId: string,
    backupId?: string
  ): Promise<{
    success: boolean;
    playlist_id: string;
    restored_backup_id: string;
    restored_tracks: number;
    pre_restore_backup_id?: string;
  }> {
    const id = cleanPlaylistId(playlistId);
    const backups = this.listPlaylistBackups(id);

    if (backups.length === 0) {
      throw new Error(`Nenhum backup encontrado para a playlist '${id}'.`);
    }

    const targetMeta = backupId
      ? backups.find((b) => b.backup_id === backupId)
      : backups[0];

    if (!targetMeta) {
      throw new Error(`Backup '${backupId}' não encontrado para a playlist '${id}'.`);
    }

    const raw = JSON.parse(fs.readFileSync(targetMeta.file_path, "utf-8")) as PlaylistBackupData;
    const uris = (raw.tracks || []).map((t) => t.uri);

    const result = await this.updatePlaylistTracks(id, uris, {
      reason: `before_restore_${targetMeta.backup_id}`,
    });

    return {
      success: true,
      playlist_id: id,
      restored_backup_id: targetMeta.backup_id,
      restored_tracks: uris.length,
      pre_restore_backup_id: result.backup_id,
    };
  }

  // ============================================================================
  // Operações de Faixas (Substituição, Adição e Remoção Atômica)
  // ============================================================================

  /**
   * Substitui todas as faixas da playlist pela nova lista ordenada de URIs.
   * Salva automaticamente um backup local antes de sobrescrever.
   */
  public async updatePlaylistTracks(
    playlistId: string,
    uris: string[],
    options: { skipBackup?: boolean; reason?: string; prefetchedTracks?: SpotifyTrack[] } = {}
  ): Promise<{
    success: boolean;
    playlist_id: string;
    total_tracks: number;
    backup_id?: string;
  }> {
    const id = cleanPlaylistId(playlistId);
    const cleanedUris = uris.map(cleanTrackUri);

    let backupId: string | undefined;
    if (!options.skipBackup) {
      try {
        const backup = await this.createPlaylistBackup(
          id,
          options.reason || "update_playlist_tracks",
          options.prefetchedTracks
        );
        backupId = backup.backup_id;
      } catch {
        // Continua mesmo se não conseguir criar backup
      }
    }

    // Se estiver vazio, esvazia a playlist
    if (cleanedUris.length === 0) {
      await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
        method: "PUT",
        body: JSON.stringify({ uris: [] }),
      });
      return { success: true, playlist_id: id, total_tracks: 0, backup_id: backupId };
    }

    // Spotify PUT substitui até os primeiros 100 itens
    const firstBatch = cleanedUris.slice(0, 100);
    await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
      method: "PUT",
      body: JSON.stringify({ uris: firstBatch }),
    });

    // Se houver mais faixas além de 100, adiciona em lotes com POST
    for (let i = 100; i < cleanedUris.length; i += 100) {
      const nextBatch = cleanedUris.slice(i, i + 100);
      await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: nextBatch }),
      });
    }

    return {
      success: true,
      playlist_id: id,
      total_tracks: cleanedUris.length,
      backup_id: backupId,
    };
  }

  /**
   * Adiciona faixas a uma playlist de forma atômica sem sobrescrever as existentes.
   */
  public async addTracksToPlaylist(
    playlistId: string,
    uris: string[],
    position?: number
  ): Promise<{
    success: boolean;
    playlist_id: string;
    added_tracks: number;
    position?: number;
  }> {
    const id = cleanPlaylistId(playlistId);
    const cleanedUris = uris.map(cleanTrackUri).filter(Boolean);

    if (cleanedUris.length === 0) {
      return { success: true, playlist_id: id, added_tracks: 0, position };
    }

    for (let i = 0; i < cleanedUris.length; i += 100) {
      const batch = cleanedUris.slice(i, i + 100);
      const body: { uris: string[]; position?: number } = { uris: batch };
      if (position !== undefined && position >= 0) {
        body.position = position + i;
      }

      await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    return {
      success: true,
      playlist_id: id,
      added_tracks: cleanedUris.length,
      position,
    };
  }

  /**
   * Remove faixas específicas de uma playlist de forma atômica.
   * Cria backup automático antes da remoção.
   */
  public async removeTracksFromPlaylist(
    playlistId: string,
    uris: string[]
  ): Promise<{
    success: boolean;
    playlist_id: string;
    removed_uris_count: number;
    backup_id?: string;
  }> {
    const id = cleanPlaylistId(playlistId);
    const cleanedUris = Array.from(new Set(uris.map(cleanTrackUri).filter(Boolean)));

    if (cleanedUris.length === 0) {
      return { success: true, playlist_id: id, removed_uris_count: 0 };
    }

    let backupId: string | undefined;
    try {
      const backup = await this.createPlaylistBackup(id, "remove_tracks_from_playlist");
      backupId = backup.backup_id;
    } catch {
      // Prossegue mesmo se o backup falhar
    }

    for (let i = 0; i < cleanedUris.length; i += 100) {
      const batch = cleanedUris.slice(i, i + 100);
      await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
        method: "DELETE",
        body: JSON.stringify({
          items: batch.map((uri) => ({ uri })),
        }),
      });
    }

    return {
      success: true,
      playlist_id: id,
      removed_uris_count: cleanedUris.length,
      backup_id: backupId,
    };
  }

  // ============================================================================
  // Curadoria Inteligente (Deduplicação e Ordenação)
  // ============================================================================

  /**
   * Identifica e opcionalmente remove faixas duplicadas de uma playlist
   * por URI exato ou combinação normalizada de Título + Artista.
   */
  public async deduplicatePlaylist(
    playlistId: string,
    options: { dryRun?: boolean; matchBy?: DuplicateMatchMode } = {}
  ): Promise<DeduplicateResult> {
    const id = cleanPlaylistId(playlistId);
    const dryRun = options.dryRun ?? false;
    const matchBy = options.matchBy ?? "title_artist";

    const tracks = await this.getPlaylistTracks(id);
    const seenUris = new Set<string>();
    const seenSignatures = new Set<string>();

    const uniqueTracks: SpotifyTrack[] = [];
    const duplicates: DeduplicateResult["duplicates"] = [];

    for (const track of tracks) {
      if (seenUris.has(track.uri)) {
        duplicates.push({
          uri: track.uri,
          name: track.name,
          artists: track.artists,
          reason: "URI idêntico",
        });
        continue;
      }

      if (matchBy === "title_artist") {
        const sig = normalizeTrackSignature(track.name, track.artists);
        if (seenSignatures.has(sig)) {
          duplicates.push({
            uri: track.uri,
            name: track.name,
            artists: track.artists,
            reason: "Mesmo título e artista principal",
          });
          continue;
        }
        seenSignatures.add(sig);
      }

      seenUris.add(track.uri);
      uniqueTracks.push(track);
    }

    let backupId: string | undefined;
    if (!dryRun && duplicates.length > 0) {
      const updateRes = await this.updatePlaylistTracks(
        id,
        uniqueTracks.map((t) => t.uri),
        {
          reason: "deduplicate_playlist",
          prefetchedTracks: tracks,
        }
      );
      backupId = updateRes.backup_id;
    }

    return {
      playlist_id: id,
      dry_run: dryRun,
      match_by: matchBy,
      original_count: tracks.length,
      unique_count: uniqueTracks.length,
      removed_count: duplicates.length,
      duplicates,
      backup_id: backupId,
    };
  }

  /**
   * Ordena as faixas de uma playlist por critério específico e salva backup prévio.
   */
  public async sortPlaylistBy(
    playlistId: string,
    criteria: SortCriterion,
    order: SortOrder = "asc"
  ): Promise<SortPlaylistResult> {
    const id = cleanPlaylistId(playlistId);
    const tracks = await this.getPlaylistTracks(id);

    const direction = order === "desc" ? -1 : 1;
    const sorted = [...tracks].sort((a, b) => {
      switch (criteria) {
        case "name":
          return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) * direction;
        case "artist": {
          const artistA = a.artists[0] || "";
          const artistB = b.artists[0] || "";
          const cmp = artistA.localeCompare(artistB, "pt-BR", { sensitivity: "base" });
          return (cmp !== 0 ? cmp : a.name.localeCompare(b.name, "pt-BR")) * direction;
        }
        case "album": {
          const albumA = a.album || "";
          const albumB = b.album || "";
          const cmp = albumA.localeCompare(albumB, "pt-BR", { sensitivity: "base" });
          return (cmp !== 0 ? cmp : a.name.localeCompare(b.name, "pt-BR")) * direction;
        }
        case "duration":
          return ((a.duration_ms ?? 0) - (b.duration_ms ?? 0)) * direction;
        case "release_date": {
          const dateA = a.release_date || "";
          const dateB = b.release_date || "";
          return dateA.localeCompare(dateB) * direction;
        }
        case "added_at": {
          const addedA = a.added_at || "";
          const addedB = b.added_at || "";
          return addedA.localeCompare(addedB) * direction;
        }
        default:
          return 0;
      }
    });

    const updateRes = await this.updatePlaylistTracks(
      id,
      sorted.map((t) => t.uri),
      {
        reason: `sort_by_${criteria}_${order}`,
        prefetchedTracks: tracks,
      }
    );

    return {
      success: true,
      playlist_id: id,
      criteria,
      order,
      total_tracks: sorted.length,
      backup_id: updateRes.backup_id,
      preview_first_5: sorted
        .slice(0, 5)
        .map((t) => `${t.name} - ${t.artists.join(", ")}`),
    };
  }

  // ============================================================================
  // Contexto Musical do Usuário (Curtidas, Top Artistas/Faixas, Histórico e Player)
  // ============================================================================

  /**
   * Obtém as músicas curtidas (salvas na biblioteca) do usuário.
   */
  public async getUserSavedTracks(limit = 50, offset = 0): Promise<SpotifyTrack[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const data = await this.request<{
      items: Array<{
        added_at?: string;
        track?: {
          uri: string;
          name: string;
          artists?: Array<{ name: string }>;
          album?: { name: string; release_date?: string };
          duration_ms?: number;
        } | null;
        item?: {
          uri: string;
          name: string;
          artists?: Array<{ name: string }>;
          album?: { name: string; release_date?: string };
          duration_ms?: number;
        } | null;
      }>;
    }>(`/me/tracks?limit=${safeLimit}&offset=${Math.max(offset, 0)}`);

    const tracks: SpotifyTrack[] = [];
    for (const entry of data.items || []) {
      const item = entry.item || entry.track;
      if (item && item.uri) {
        tracks.push({
          uri: item.uri,
          name: item.name,
          artists: (item.artists || []).map((a) => a.name),
          album: item.album?.name,
          release_date: item.album?.release_date,
          duration_ms: item.duration_ms,
          added_at: entry.added_at,
        });
      }
    }

    return tracks;
  }

  /**
   * Obtém os artistas ou faixas mais ouvidos pelo usuário em determinado período.
   */
  public async getUserTopItems(
    type: "artists" | "tracks",
    timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
    limit = 20
  ): Promise<SpotifyArtist[] | SpotifyTrack[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    if (type === "artists") {
      const data = await this.request<{
        items: Array<{
          id: string;
          uri: string;
          name: string;
          genres?: string[];
          popularity?: number;
          external_urls?: { spotify: string };
        }>;
      }>(`/me/top/artists?time_range=${timeRange}&limit=${safeLimit}`);

      return (data.items || []).map((artist) => ({
        id: artist.id,
        uri: artist.uri,
        name: artist.name,
        genres: artist.genres || [],
        popularity: artist.popularity,
        url: artist.external_urls?.spotify,
      }));
    }

    const data = await this.request<{
      items: Array<{
        uri: string;
        name: string;
        artists?: Array<{ name: string }>;
        album?: { name: string; release_date?: string };
        duration_ms?: number;
      }>;
    }>(`/me/top/tracks?time_range=${timeRange}&limit=${safeLimit}`);

    return (data.items || []).map((track) => ({
      uri: track.uri,
      name: track.name,
      artists: (track.artists || []).map((a) => a.name),
      album: track.album?.name,
      release_date: track.album?.release_date,
      duration_ms: track.duration_ms,
    }));
  }

  /**
   * Obtém o histórico de faixas reproduzidas recentemente pelo usuário.
   */
  public async getRecentlyPlayed(limit = 50): Promise<RecentlyPlayedItem[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const data = await this.request<{
      items: Array<{
        played_at: string;
        track?: {
          uri: string;
          name: string;
          artists?: Array<{ name: string }>;
          album?: { name: string };
          duration_ms?: number;
        } | null;
      }>;
    }>(`/me/player/recently-played?limit=${safeLimit}`);

    const items: RecentlyPlayedItem[] = [];
    for (const entry of data.items || []) {
      if (entry.track && entry.track.uri) {
        items.push({
          played_at: entry.played_at,
          uri: entry.track.uri,
          name: entry.track.name,
          artists: (entry.track.artists || []).map((a) => a.name),
          album: entry.track.album?.name,
          duration_ms: entry.track.duration_ms,
        });
      }
    }

    return items;
  }

  /**
   * Obtém informações sobre a faixa em reprodução no momento.
   */
  public async getCurrentPlayback(): Promise<CurrentPlaybackInfo> {
    const data = await this.request<{
      is_playing: boolean;
      currently_playing_type?: string;
      progress_ms?: number | null;
      device?: {
        name: string;
        type: string;
        volume_percent: number | null;
      };
      item?: {
        uri: string;
        name: string;
        artists?: Array<{ name: string }>;
        album?: { name: string; release_date?: string };
        duration_ms?: number;
      } | null;
    } | null>(`/me/player/currently-playing`);

    if (!data) {
      return {
        is_playing: false,
        track: null,
      };
    }

    return {
      is_playing: Boolean(data.is_playing),
      currently_playing_type: data.currently_playing_type,
      progress_ms: data.progress_ms,
      device: data.device,
      track: data.item
        ? {
            uri: data.item.uri,
            name: data.item.name,
            artists: (data.item.artists || []).map((a) => a.name),
            album: data.item.album?.name,
            release_date: data.item.album?.release_date,
            duration_ms: data.item.duration_ms,
          }
        : null,
    };
  }
}
