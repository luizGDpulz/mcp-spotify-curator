import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpotifyClient } from "../src/spotify.js";

describe("SpotifyClient: API Integration, Backups, Curation & Resilience", () => {
  let tmpBackupDir: string;
  let client: SpotifyClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-spotify-test-"));
    originalFetch = globalThis.fetch;

    client = new SpotifyClient({
      clientId: "mock_client_id",
      clientSecret: "mock_client_secret",
      refreshToken: "mock_refresh_token",
      backupDir: tmpBackupDir,
      maxRetries: 2,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpBackupDir, { recursive: true, force: true });
  });

  function setupMockFetch(
    routeHandler?: (url: string, options?: RequestInit) => Response | Promise<Response> | null
  ) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input.toString();

      // OAuth token refresh endpoint
      if (urlStr.includes("accounts.spotify.com/api/token")) {
        return new Response(
          JSON.stringify({
            access_token: "mock_access_token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "playlist-read-private playlist-modify-private",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (routeHandler) {
        const custom = await routeHandler(urlStr, init);
        if (custom) return custom;
      }

      return new Response(JSON.stringify({ error: { message: "Not found" } }), { status: 404 });
    };
  }

  it("should list user playlists supporting both updated items.total and legacy tracks.total schemas", async () => {
    setupMockFetch((url) => {
      if (url.includes("/v1/me/playlists")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "playlist_modern",
                name: "Modern API Playlist",
                description: "Uses items.total",
                items: { total: 42 },
                public: true,
                collaborative: false,
                owner: { display_name: "Luiz" },
              },
              {
                id: "playlist_legacy",
                name: "Legacy API Playlist",
                description: null,
                tracks: { total: 15 },
                public: false,
                collaborative: true,
                owner: { id: "user_legacy" },
              },
            ],
          }),
          { status: 200 }
        );
      }
      return null;
    });

    const playlists = await client.listUserPlaylists(10);
    assert.equal(playlists.length, 2);
    assert.equal(playlists[0].id, "playlist_modern");
    assert.equal(playlists[0].total_tracks, 42);
    assert.equal(playlists[1].id, "playlist_legacy");
    assert.equal(playlists[1].total_tracks, 15);
  });

  it("should add tracks atomically using POST /items", async () => {
    let capturedBody: { uris: string[]; position?: number } | null = null;

    setupMockFetch((url, init) => {
      if (url.includes("/v1/playlists/pl_123/items") && init?.method === "POST") {
        capturedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ snapshot_id: "snap_add_1" }), { status: 201 });
      }
      return null;
    });

    const result = await client.addTracksToPlaylist("pl_123", ["track_1", "track_2"], 0);
    assert.equal(result.success, true);
    assert.equal(result.added_tracks, 2);
    assert.equal(result.position, 0);
    assert.deepEqual(capturedBody?.uris, ["spotify:track:track_1", "spotify:track:track_2"]);
    assert.equal(capturedBody?.position, 0);
  });

  it("should remove tracks atomically using DELETE /items and create a safety backup", async () => {
    let capturedDeleteBody: { items: Array<{ uri: string }> } | null = null;

    setupMockFetch((url, init) => {
      // 1. Initial track fetch for backup
      if (url.includes("/v1/playlists/pl_123/items") && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                item: {
                  uri: "spotify:track:to_remove",
                  name: "Song to Remove",
                  artists: [{ name: "Artist" }],
                },
              },
            ],
            total: 1,
            next: null,
          }),
          { status: 200 }
        );
      }

      // 2. DELETE request
      if (url.includes("/v1/playlists/pl_123/items") && init?.method === "DELETE") {
        capturedDeleteBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ snapshot_id: "snap_del_1" }), { status: 200 });
      }
      return null;
    });

    const result = await client.removeTracksFromPlaylist("pl_123", ["to_remove"]);
    assert.equal(result.success, true);
    assert.equal(result.removed_uris_count, 1);
    assert.ok(result.backup_id);
    assert.deepEqual(capturedDeleteBody?.items, [{ uri: "spotify:track:to_remove" }]);

    // Verify local backup file exists and matches
    const backups = client.listPlaylistBackups("pl_123");
    assert.equal(backups.length, 1);
    assert.equal(backups[0].total_tracks, 1);
  });

  it("should deduplicate tracks by title + artist and restore from backup successfully", async () => {
    let updatedUris: string[] | null = null;

    setupMockFetch((url, init) => {
      if (url.includes("/v1/playlists/pl_dedup/items")) {
        if (!init?.method || init.method === "GET") {
          return new Response(
            JSON.stringify({
              items: [
                {
                  item: {
                    uri: "spotify:track:orig",
                    name: "Time",
                    artists: [{ name: "Pink Floyd" }],
                  },
                },
                {
                  item: {
                    uri: "spotify:track:remaster",
                    name: "Time - 2011 Remastered",
                    artists: [{ name: "Pink Floyd" }],
                  },
                },
                {
                  item: {
                    uri: "spotify:track:another",
                    name: "Money",
                    artists: [{ name: "Pink Floyd" }],
                  },
                },
              ],
              total: 3,
              next: null,
            }),
            { status: 200 }
          );
        }

        if (init?.method === "PUT") {
          updatedUris = JSON.parse(String(init.body)).uris;
          return new Response(JSON.stringify({ snapshot_id: "snap_dedup" }), { status: 200 });
        }
      }
      return null;
    });

    const dedup = await client.deduplicatePlaylist("pl_dedup", {
      dryRun: false,
      matchBy: "title_artist",
    });

    assert.equal(dedup.original_count, 3);
    assert.equal(dedup.unique_count, 2);
    assert.equal(dedup.removed_count, 1);
    assert.equal(dedup.duplicates[0].uri, "spotify:track:remaster");
    assert.deepEqual(updatedUris, ["spotify:track:orig", "spotify:track:another"]);

    // Test restoring from the auto-created backup
    const restored = await client.restorePlaylistBackup("pl_dedup", dedup.backup_id);
    assert.equal(restored.success, true);
    assert.equal(restored.restored_tracks, 3);
    assert.deepEqual(updatedUris, [
      "spotify:track:orig",
      "spotify:track:remaster",
      "spotify:track:another",
    ]);
  });

  it("should handle HTTP 429 Rate Limits by parsing Retry-After header and retrying", async () => {
    let attempt = 0;

    setupMockFetch((url) => {
      if (url.includes("/v1/me/playlists")) {
        attempt++;
        if (attempt === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return null;
    });

    const result = await client.listUserPlaylists(10);
    assert.equal(attempt, 2);
    assert.deepEqual(result, []);
  });

  it("should append a clear OAuth permission guidance hint when personal endpoints return HTTP 403", async () => {
    setupMockFetch((url) => {
      if (url.includes("/v1/me/player/recently-played")) {
        return new Response(
          JSON.stringify({ error: { message: "Insufficient client scope" } }),
          { status: 403 }
        );
      }
      return null;
    });

    await assert.rejects(
      async () => {
        await client.getRecentlyPlayed(10);
      },
      (err: Error) => {
        return err.message.includes("pnpm run auth:setup");
      }
    );
  });
});
