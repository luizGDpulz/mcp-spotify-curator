import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { server } from "../src/index.js";

describe("MCP Server Integration: Tools, Schemas, Resources & Prompts", () => {
  let client: Client;

  before(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "mcp-test-runner", version: "1.0.0" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  after(async () => {
    await client.close();
  });

  it("should register all 15 expected MCP tools with valid schemas", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    assert.equal(toolNames.length, 15);

    const expectedTools = [
      "list_user_playlists",
      "get_playlist_tracks",
      "search_spotify_tracks",
      "create_playlist",
      "update_playlist_tracks",
      "add_tracks_to_playlist",
      "remove_tracks_from_playlist",
      "deduplicate_playlist",
      "sort_playlist_by",
      "list_playlist_backups",
      "restore_playlist_backup",
      "get_user_saved_tracks",
      "get_user_top_items",
      "get_recently_played",
      "get_current_playback",
    ];

    for (const expected of expectedTools) {
      assert.ok(toolNames.includes(expected), `Missing tool: ${expected}`);
      const tool = result.tools.find((t) => t.name === expected);
      assert.ok(tool?.description, `Tool ${expected} must have a description`);
      assert.equal(tool?.inputSchema.type, "object", `Tool ${expected} must have an object schema`);
    }
  });

  it("should register MCP resources with correct URIs", async () => {
    const result = await client.listResources();
    const uris = result.resources.map((r) => r.uri);

    assert.ok(uris.includes("spotify://me/playlists"));
    assert.ok(uris.includes("spotify://me/top-artists"));
    assert.ok(uris.includes("spotify://me/top-tracks"));
  });

  it("should register MCP prompts with guidance workflows", async () => {
    const result = await client.listPrompts();
    const promptNames = result.prompts.map((p) => p.name);

    assert.ok(promptNames.includes("curate-genre-playlist"));
    assert.ok(promptNames.includes("smooth-transition-sorter"));
    assert.ok(promptNames.includes("clean-and-deduplicate"));
  });

  it("should execute list_playlist_backups tool and return structured content", async () => {
    const response = await client.callTool({
      name: "list_playlist_backups",
      arguments: {},
    });

    assert.ok(Array.isArray(response.content));
    assert.equal(response.content[0].type, "text");
    const parsed = JSON.parse(response.content[0].text);
    assert.ok(Array.isArray(parsed));
  });

  it("should return an error response when arguments violate Zod schema constraints", async () => {
    const response = await client.callTool({
      name: "sort_playlist_by",
      arguments: {
        playlist_id: "pl_test",
        criteria: "invalid_criteria", // Enum violation
      },
    });

    assert.equal(response.isError, true);
    assert.ok(response.content.length > 0);
  });
});
