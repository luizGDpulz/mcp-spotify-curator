#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dotenv from "dotenv";
import { SpotifyClient } from "./spotify.js";

// Carrega variáveis do arquivo .env da raiz do projeto e depois do diretório atual
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

let spotifyClient: SpotifyClient | null = null;

function getSpotifyClient(): SpotifyClient {
  if (spotifyClient) {
    return spotifyClient;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Credenciais do Spotify ausentes! Certifique-se de configurar SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET e SPOTIFY_REFRESH_TOKEN no .env ou execute 'pnpm auth:setup'."
    );
  }

  spotifyClient = new SpotifyClient({
    clientId,
    clientSecret,
    refreshToken,
  });

  return spotifyClient;
}

const server = new McpServer({
  name: "mcp-spotify-curator",
  version: "1.0.0",
});

// 1. list_user_playlists
server.registerTool(
  "list_user_playlists",
  {
    description: "Lista as playlists do usuário logado para encontrar seus IDs pelo nome.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Quantidade máxima de playlists a retornar (padrão 50, máx 50)."),
    },
  },
  async ({ limit }) => {
    try {
      const client = getSpotifyClient();
      const playlists = await client.listUserPlaylists(limit);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(playlists, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao listar playlists: ${message}`,
          },
        ],
      };
    }
  }
);

// 2. get_playlist_tracks
server.registerTool(
  "get_playlist_tracks",
  {
    description: "Devolve as faixas atuais higienizadas (uri, name, artists) para análise ou reordenação.",
    inputSchema: {
      playlist_id: z
        .string()
        .describe("ID, URI (spotify:playlist:...) ou link da playlist do Spotify."),
    },
  },
  async ({ playlist_id }) => {
    try {
      const client = getSpotifyClient();
      const tracks = await client.getPlaylistTracks(playlist_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(tracks, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao obter faixas da playlist: ${message}`,
          },
        ],
      };
    }
  }
);

// 3. search_spotify_tracks
server.registerTool(
  "search_spotify_tracks",
  {
    description: "Busca no catálogo por termos no formato 'Música - Artista' e retorna os URIs correspondentes.",
    inputSchema: {
      queries: z
        .array(z.string())
        .describe("Lista de termos de busca, ex: ['Bohemian Rhapsody - Queen', 'Billie Jean - Michael Jackson']."),
    },
  },
  async ({ queries }) => {
    try {
      const client = getSpotifyClient();
      const results = await client.searchTracks(queries);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao buscar faixas: ${message}`,
          },
        ],
      };
    }
  }
);

// 4. create_playlist
server.registerTool(
  "create_playlist",
  {
    description: "Cria uma nova playlist vazia para o usuário e retorna seu ID e URL.",
    inputSchema: {
      name: z.string().describe("Nome da nova playlist."),
      description: z.string().optional().describe("Descrição opcional para a playlist."),
    },
  },
  async ({ name, description }) => {
    try {
      const client = getSpotifyClient();
      const playlist = await client.createPlaylist(name, description);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(playlist, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao criar playlist: ${message}`,
          },
        ],
      };
    }
  }
);

// 5. update_playlist_tracks
server.registerTool(
  "update_playlist_tracks",
  {
    description: "Substitui todas as faixas da playlist pela nova lista ordenada de URIs (reordenação ou reset).",
    inputSchema: {
      playlist_id: z
        .string()
        .describe("ID, URI ou link da playlist do Spotify a ser atualizada."),
      uris: z
        .array(z.string())
        .describe("Lista completa e ordenada de URIs (spotify:track:...) que substituirão as faixas atuais da playlist."),
    },
  },
  async ({ playlist_id, uris }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.updatePlaylistTracks(playlist_id, uris);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Erro ao atualizar faixas da playlist: ${message}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-spotify-curator iniciado com sucesso via stdio.");
}

main().catch((err) => {
  console.error("Erro fatal ao iniciar servidor MCP:", err);
  process.exit(1);
});
