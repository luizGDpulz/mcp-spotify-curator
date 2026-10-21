import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanPlaylistId,
  cleanTrackUri,
  normalizeTrackSignature,
  SpotifyClient,
} from "../src/spotify.js";

describe("Utilitários de higienização e normalização", () => {
  it("limpa IDs de playlists a partir de URIs, URLs ou IDs puros", () => {
    expect(cleanPlaylistId("spotify:playlist:76fQK526wOVx8A3gkHTiHn")).toBe(
      "76fQK526wOVx8A3gkHTiHn"
    );
    expect(
      cleanPlaylistId("https://open.spotify.com/playlist/76fQK526wOVx8A3gkHTiHn?si=12345")
    ).toBe("76fQK526wOVx8A3gkHTiHn");
    expect(cleanPlaylistId("  76fQK526wOVx8A3gkHTiHn  ")).toBe("76fQK526wOVx8A3gkHTiHn");
  });

  it("limpa URIs de faixas a partir de URLs, IDs ou URIs", () => {
    expect(cleanTrackUri("spotify:track:4iV5W9uYEdYUVa79Axb7Rh")).toBe(
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    );
    expect(cleanTrackUri("https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh?si=abc")).toBe(
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    );
    expect(cleanTrackUri("4iV5W9uYEdYUVa79Axb7Rh")).toBe(
      "spotify:track:4iV5W9uYEdYUVa79Axb7Rh"
    );
  });

  it("normaliza assinaturas de faixas ignorando sufixos de remasterização", () => {
    const sig1 = normalizeTrackSignature("Bohemian Rhapsody - Remastered 2011", ["Queen"]);
    const sig2 = normalizeTrackSignature("Bohemian Rhapsody (Remastered)", ["Queen"]);
    const sig3 = normalizeTrackSignature("Bohemian Rhapsody", ["Queen"]);
    expect(sig1).toBe(sig3);
    expect(sig2).toBe(sig3);
  });
});

describe("SpotifyClient - Operações, Backup, Curadoria e Rate Limit", () => {
  let tmpBackupDir: string;
  let client: SpotifyClient;
  const fetchMock = vi.fn();

  beforeEach(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-spotify-test-"));
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();

    client = new SpotifyClient({
      clientId: "test_client_id",
      clientSecret: "test_client_secret",
      refreshToken: "test_refresh_token",
      backupDir: tmpBackupDir,
      maxRetries: 2,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tmpBackupDir, { recursive: true, force: true });
  });

  function mockTokenResponse() {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "valid_access_token",
          token_type: "Bearer",
          scope: "playlist-read-private playlist-modify-private",
          expires_in: 3600,
        }),
        { status: 200 }
      )
    );
  }

  it("lista playlists suportando o novo campo items.total e o legado tracks.total", async () => {
    mockTokenResponse();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "pl1",
              name: "Playlist Nova API",
              description: "Desc 1",
              items: { total: 42 },
              public: true,
              collaborative: false,
              owner: { display_name: "Luiz" },
            },
            {
              id: "pl2",
              name: "Playlist Legada",
              description: null,
              tracks: { total: 15 },
              public: false,
              collaborative: true,
              owner: { id: "user2" },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const playlists = await client.listUserPlaylists(10);
    expect(playlists).toHaveLength(2);
    expect(playlists[0].total_tracks).toBe(42);
    expect(playlists[1].total_tracks).toBe(15);
  });

  it("adiciona e remove faixas atomicamente e cria backup antes de remover", async () => {
    mockTokenResponse();

    // 1. Teste de addTracksToPlaylist
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot_id: "snap_add" }), { status: 201 })
    );

    const addRes = await client.addTracksToPlaylist("pl123", ["trackA", "trackB"], 0);
    expect(addRes.added_tracks).toBe(2);
    expect(addRes.position).toBe(0);

    // 2. Teste de removeTracksFromPlaylist (busca faixas para backup -> envia DELETE)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              item: {
                uri: "spotify:track:trackA",
                name: "Song A",
                artists: [{ name: "Artist A" }],
              },
            },
          ],
          total: 1,
          next: null,
        }),
        { status: 200 }
      )
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot_id: "snap_del" }), { status: 200 })
    );

    const removeRes = await client.removeTracksFromPlaylist("pl123", ["trackA"]);
    expect(removeRes.removed_uris_count).toBe(1);
    expect(removeRes.backup_id).toBeDefined();

    const backups = client.listPlaylistBackups("pl123");
    expect(backups).toHaveLength(1);
    expect(backups[0].total_tracks).toBe(1);
  });

  it("desduplica faixas por título + artista e restaura backup com sucesso", async () => {
    mockTokenResponse();

    // Retorno de getPlaylistTracks com 3 músicas (sendo 1 duplicata remasterizada)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              item: {
                uri: "spotify:track:111",
                name: "Time",
                artists: [{ name: "Pink Floyd" }],
              },
            },
            {
              item: {
                uri: "spotify:track:222",
                name: "Time - 2011 Remastered",
                artists: [{ name: "Pink Floyd" }],
              },
            },
            {
              item: {
                uri: "spotify:track:333",
                name: "Money",
                artists: [{ name: "Pink Floyd" }],
              },
            },
          ],
          total: 3,
          next: null,
        }),
        { status: 200 }
      )
    );

    // PUT de atualização da playlist sem a duplicata
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot_id: "snap_dedup" }), { status: 200 })
    );

    const dedup = await client.deduplicatePlaylist("plPink", {
      dryRun: false,
      matchBy: "title_artist",
    });

    expect(dedup.original_count).toBe(3);
    expect(dedup.unique_count).toBe(2);
    expect(dedup.removed_count).toBe(1);
    expect(dedup.duplicates[0].uri).toBe("spotify:track:222");
    expect(dedup.backup_id).toBeDefined();

    // Agora testa a restauração do backup
    // 1) getPlaylistTracks para o backup pré-restauração
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              item: {
                uri: "spotify:track:111",
                name: "Time",
                artists: [{ name: "Pink Floyd" }],
              },
            },
          ],
          total: 1,
          next: null,
        }),
        { status: 200 }
      )
    );
    // 2) PUT restaurando as 3 músicas originais
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot_id: "snap_restored" }), { status: 200 })
    );

    const restored = await client.restorePlaylistBackup("plPink", dedup.backup_id);
    expect(restored.success).toBe(true);
    expect(restored.restored_tracks).toBe(3);
  });

  it("ordena playlist por duração e respeita Retry-After em caso de HTTP 429", async () => {
    mockTokenResponse();

    // Simula HTTP 429 Too Many Requests com Retry-After: 0 seguido de 200 OK
    fetchMock.mockResolvedValueOnce(
      new Response("Rate limit exceeded", {
        status: 429,
        headers: { "Retry-After": "0" },
      })
    );

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              item: {
                uri: "spotify:track:long",
                name: "Long Song",
                artists: [{ name: "Band" }],
                duration_ms: 300000,
              },
            },
            {
              item: {
                uri: "spotify:track:short",
                name: "Short Song",
                artists: [{ name: "Band" }],
                duration_ms: 120000,
              },
            },
          ],
          total: 2,
          next: null,
        }),
        { status: 200 }
      )
    );

    // PUT ordenando
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ snapshot_id: "snap_sort" }), { status: 200 })
    );

    const sortRes = await client.sortPlaylistBy("plSort", "duration", "asc");
    expect(sortRes.success).toBe(true);
    expect(sortRes.preview_first_5[0]).toContain("Short Song");
    expect(sortRes.preview_first_5[1]).toContain("Long Song");
  });

  it("obtém contexto musical do usuário (curtidas, top itens, histórico, player) e exibe dica em erro 403", async () => {
    mockTokenResponse();

    // 1. getUserSavedTracks
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              added_at: "2026-10-01T10:00:00Z",
              track: {
                uri: "spotify:track:saved1",
                name: "Saved Song",
                artists: [{ name: "Saved Artist" }],
                album: { name: "Saved Album", release_date: "2025-05-01" },
                duration_ms: 200000,
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const saved = await client.getUserSavedTracks(10, 0);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Saved Song");

    // 2. getUserTopItems (artists)
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "art1",
              uri: "spotify:artist:art1",
              name: "Daft Punk",
              genres: ["french house", "electronic"],
              popularity: 88,
            },
          ],
        }),
        { status: 200 }
      )
    );
    const topArtists = await client.getUserTopItems("artists", "medium_term", 5);
    expect(topArtists).toHaveLength(1);
    expect(topArtists[0].name).toBe("Daft Punk");

    // 3. getCurrentPlayback (204 No Content quando nada está tocando)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const playback = await client.getCurrentPlayback();
    expect(playback.is_playing).toBe(false);
    expect(playback.track).toBeNull();

    // 4. Erro 403 em /me/player/recently-played deve orientar a rodar pnpm run auth:setup
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "Insufficient client scope" } }), {
        status: 403,
      })
    );
    await expect(client.getRecentlyPlayed(10)).rejects.toThrow(/pnpm run auth:setup/);
  });
});
