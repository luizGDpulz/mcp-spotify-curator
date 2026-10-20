export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  duration_ms?: number;
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
  url?: string;
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
  if (trimmed.startsWith("spotify:track:")) {
    return trimmed;
  }
  const match = trimmed.match(/track\/([a-zA-Z0-9]+)/);
  if (match) {
    return `spotify:track:${match[1]}`;
  }
  if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
    return `spotify:track:${trimmed}`;
  }
  return trimmed;
}

export class SpotifyClient {
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: SpotifyConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.refreshToken = config.refreshToken;
  }

  public async getAccessToken(): Promise<string> {
    // If token is valid for at least 60 more seconds, reuse it
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
    const url = endpoint.startsWith("http") ? endpoint : `https://api.spotify.com/v1${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (options.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    let response = await fetch(url, {
      ...options,
      headers,
    });

    // Se receber 401 Unauthorized, tenta renovar o token e repetir uma única vez
    if (response.status === 401) {
      this.accessToken = null;
      token = await this.getAccessToken();
      headers.Authorization = `Bearer ${token}`;
      response = await fetch(url, {
        ...options,
        headers,
      });
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
      throw new Error(`Spotify API error [${response.status}]: ${message}`);
    }

    return (await response.json()) as T;
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
          track?: {
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { name: string };
            duration_ms?: number;
          } | null;
          item?: {
            uri: string;
            name: string;
            artists?: Array<{ name: string }>;
            album?: { name: string };
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
            duration_ms: item.duration_ms,
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
              album?: { name: string };
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

  /**
   * Substitui todas as faixas da playlist pela nova lista ordenada de URIs.
   * Suporta listas maiores que 100 itens dividindo em lotes.
   */
  public async updatePlaylistTracks(
    playlistId: string,
    uris: string[]
  ): Promise<{ success: boolean; playlist_id: string; total_tracks: number }> {
    const id = cleanPlaylistId(playlistId);
    const cleanedUris = uris.map(cleanTrackUri);

    // Se estiver vazio, esvazia a playlist
    if (cleanedUris.length === 0) {
      await this.request(`/playlists/${encodeURIComponent(id)}/items`, {
        method: "PUT",
        body: JSON.stringify({ uris: [] }),
      });
      return { success: true, playlist_id: id, total_tracks: 0 };
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
    };
  }
}
