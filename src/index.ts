#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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
      "Credenciais do Spotify ausentes! Certifique-se de configurar SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET e SPOTIFY_REFRESH_TOKEN no .env ou execute 'pnpm run auth:setup'."
    );
  }

  spotifyClient = new SpotifyClient({
    clientId,
    clientSecret,
    refreshToken,
  });

  return spotifyClient;
}

function formatJsonToolResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function formatToolError(prefix: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `${prefix}: ${message}`,
      },
    ],
  };
}

export const server = new McpServer({
  name: "mcp-spotify-curator",
  version: "1.1.0",
});

// ============================================================================
// 1. Ferramentas Core de Playlists e Catálogo
// ============================================================================

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
      return formatJsonToolResponse(playlists);
    } catch (err) {
      return formatToolError("Erro ao listar playlists", err);
    }
  }
);

server.registerTool(
  "get_playlist_tracks",
  {
    description:
      "Devolve as faixas atuais higienizadas (uri, name, artists, album, release_date, duration_ms, added_at) para análise ou reordenação.",
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
      return formatJsonToolResponse(tracks);
    } catch (err) {
      return formatToolError("Erro ao obter faixas da playlist", err);
    }
  }
);

server.registerTool(
  "search_spotify_tracks",
  {
    description:
      "Busca no catálogo por termos no formato 'Música - Artista' ou com filtros avançados ('artist:', 'album:', 'year:', 'genre:') e retorna os URIs correspondentes.",
    inputSchema: {
      queries: z
        .array(z.string())
        .describe(
          "Lista de termos de busca, ex: ['Bohemian Rhapsody - Queen', 'artist:Daft Punk year:2001']."
        ),
    },
  },
  async ({ queries }) => {
    try {
      const client = getSpotifyClient();
      const results = await client.searchTracks(queries);
      return formatJsonToolResponse(results);
    } catch (err) {
      return formatToolError("Erro ao buscar faixas", err);
    }
  }
);

server.registerTool(
  "create_playlist",
  {
    description: "Cria uma nova playlist vazia para o usuário e retorna seu ID e URL.",
    inputSchema: {
      name: z.string().describe("Nome da nova playlist."),
      description: z.string().optional().describe("Descrição opcional para a playlist."),
      public: z
        .boolean()
        .optional()
        .describe("Define se a playlist será pública (padrão: false / privada)."),
    },
  },
  async ({ name, description, public: isPublic }) => {
    try {
      const client = getSpotifyClient();
      const playlist = await client.createPlaylist(name, description, isPublic);
      return formatJsonToolResponse(playlist);
    } catch (err) {
      return formatToolError("Erro ao criar playlist", err);
    }
  }
);

server.registerTool(
  "update_playlist_tracks",
  {
    description:
      "Substitui todas as faixas da playlist pela nova lista ordenada de URIs (reordenação ou reset). Salva automaticamente um backup local antes de sobrescrever.",
    inputSchema: {
      playlist_id: z
        .string()
        .describe("ID, URI ou link da playlist do Spotify a ser atualizada."),
      uris: z
        .array(z.string())
        .describe(
          "Lista completa e ordenada de URIs (spotify:track:...) que substituirão as faixas atuais da playlist."
        ),
    },
  },
  async ({ playlist_id, uris }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.updatePlaylistTracks(playlist_id, uris);
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao atualizar faixas da playlist", err);
    }
  }
);

// ============================================================================
// 2. Operações Atômicas de Faixas (Fase 1)
// ============================================================================

server.registerTool(
  "add_tracks_to_playlist",
  {
    description:
      "Adiciona novas faixas a uma playlist de forma atômica (no final ou em uma posição específica) sem sobrescrever as faixas existentes.",
    inputSchema: {
      playlist_id: z.string().describe("ID, URI ou link da playlist do Spotify."),
      uris: z
        .array(z.string())
        .describe("Lista de URIs ou IDs das faixas a serem adicionadas."),
      position: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Índice baseado em zero onde inserir as faixas (ex: 0 para inserir no topo). Se omitido, adiciona ao final."
        ),
    },
  },
  async ({ playlist_id, uris, position }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.addTracksToPlaylist(playlist_id, uris, position);
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao adicionar faixas na playlist", err);
    }
  }
);

server.registerTool(
  "remove_tracks_from_playlist",
  {
    description:
      "Remove faixas específicas de uma playlist de forma atômica usando seus URIs. Cria um backup automático antes da remoção.",
    inputSchema: {
      playlist_id: z.string().describe("ID, URI ou link da playlist do Spotify."),
      uris: z
        .array(z.string())
        .describe("Lista de URIs ou IDs das faixas a serem removidas da playlist."),
    },
  },
  async ({ playlist_id, uris }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.removeTracksFromPlaylist(playlist_id, uris);
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao remover faixas da playlist", err);
    }
  }
);

// ============================================================================
// 3. Sistema de Backup / Desfazer Alterações (Fase 1)
// ============================================================================

server.registerTool(
  "list_playlist_backups",
  {
    description:
      "Lista os snapshots de backup salvos localmente antes de modificações destrutivas em playlists.",
    inputSchema: {
      playlist_id: z
        .string()
        .optional()
        .describe("Opcional: ID, URI ou link da playlist para filtrar os backups."),
    },
  },
  async ({ playlist_id }) => {
    try {
      const client = getSpotifyClient();
      const backups = client.listPlaylistBackups(playlist_id);
      return formatJsonToolResponse(backups);
    } catch (err) {
      return formatToolError("Erro ao listar backups de playlists", err);
    }
  }
);

server.registerTool(
  "restore_playlist_backup",
  {
    description:
      "Restaura uma playlist para um estado anterior a partir de um backup local (desfazendo alterações indesejadas).",
    inputSchema: {
      playlist_id: z
        .string()
        .describe("ID, URI ou link da playlist que será restaurada."),
      backup_id: z
        .string()
        .optional()
        .describe(
          "ID específico do backup a restaurar. Se omitido, restaura o backup mais recente da playlist."
        ),
    },
  },
  async ({ playlist_id, backup_id }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.restorePlaylistBackup(playlist_id, backup_id);
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao restaurar backup da playlist", err);
    }
  }
);

// ============================================================================
// 4. Contexto Musical Pessoal do Usuário (Fase 2)
// ============================================================================

server.registerTool(
  "get_user_saved_tracks",
  {
    description:
      "Obtém as músicas curtidas ('Músicas Curtidas' / Liked Songs) da biblioteca do usuário.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Quantidade de faixas a retornar (padrão: 50, máx: 50)."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Deslocamento para paginação (padrão: 0)."),
    },
  },
  async ({ limit, offset }) => {
    try {
      const client = getSpotifyClient();
      const tracks = await client.getUserSavedTracks(limit, offset);
      return formatJsonToolResponse(tracks);
    } catch (err) {
      return formatToolError("Erro ao obter músicas curtidas", err);
    }
  }
);

server.registerTool(
  "get_user_top_items",
  {
    description:
      "Retorna os artistas ou faixas mais ouvidos pelo usuário em um intervalo de tempo (curto, médio ou longo prazo).",
    inputSchema: {
      type: z
        .enum(["artists", "tracks"])
        .describe("Tipo de ranking desejado: 'artists' (artistas) ou 'tracks' (músicas)."),
      time_range: z
        .enum(["short_term", "medium_term", "long_term"])
        .optional()
        .describe(
          "Período de análise: 'short_term' (~4 semanas), 'medium_term' (~6 meses, padrão) ou 'long_term' (~vários anos)."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Quantidade de itens a retornar (padrão: 20, máx: 50)."),
    },
  },
  async ({ type, time_range, limit }) => {
    try {
      const client = getSpotifyClient();
      const items = await client.getUserTopItems(type, time_range, limit);
      return formatJsonToolResponse(items);
    } catch (err) {
      return formatToolError("Erro ao obter top itens do usuário", err);
    }
  }
);

server.registerTool(
  "get_recently_played",
  {
    description: "Retorna o histórico das últimas faixas reproduzidas pelo usuário no Spotify.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Quantidade máxima de faixas recentes (padrão: 50, máx: 50)."),
    },
  },
  async ({ limit }) => {
    try {
      const client = getSpotifyClient();
      const items = await client.getRecentlyPlayed(limit);
      return formatJsonToolResponse(items);
    } catch (err) {
      return formatToolError("Erro ao obter histórico de reprodução recente", err);
    }
  }
);

server.registerTool(
  "get_current_playback",
  {
    description:
      "Obtém informações sobre a música que está tocando neste exato momento no player do Spotify do usuário.",
    inputSchema: {},
  },
  async () => {
    try {
      const client = getSpotifyClient();
      const playback = await client.getCurrentPlayback();
      return formatJsonToolResponse(playback);
    } catch (err) {
      return formatToolError("Erro ao obter estado atual de reprodução", err);
    }
  }
);

// ============================================================================
// 5. Curadoria Inteligente & Higienização (Fase 3)
// ============================================================================

server.registerTool(
  "deduplicate_playlist",
  {
    description:
      "Identifica e remove faixas duplicadas de uma playlist (por URI exato ou combinação de Título + Artista como versões remasterizadas). Faz backup automático antes de remover.",
    inputSchema: {
      playlist_id: z.string().describe("ID, URI ou link da playlist do Spotify."),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "Se true, apenas simula e lista as duplicatas encontradas sem alterar a playlist (padrão: false)."
        ),
      match_by: z
        .enum(["uri", "title_artist"])
        .optional()
        .describe(
          "Critério de detecção: 'uri' (apenas IDs idênticos) ou 'title_artist' (detecta também remasters/versões repetidas do mesmo artista; padrão: 'title_artist')."
        ),
    },
  },
  async ({ playlist_id, dry_run, match_by }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.deduplicatePlaylist(playlist_id, {
        dryRun: dry_run,
        matchBy: match_by,
      });
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao desduplicar playlist", err);
    }
  }
);

server.registerTool(
  "sort_playlist_by",
  {
    description:
      "Ordena automaticamente todas as faixas de uma playlist por nome, artista, álbum, duração, data de lançamento ou data de adição. Salva backup automático antes de reordenar.",
    inputSchema: {
      playlist_id: z.string().describe("ID, URI ou link da playlist do Spotify."),
      criteria: z
        .enum(["name", "artist", "album", "duration", "release_date", "added_at"])
        .describe(
          "Critério de ordenação: 'name' (título), 'artist' (artista), 'album' (álbum), 'duration' (duração), 'release_date' (data de lançamento) ou 'added_at' (data de inclusão)."
        ),
      order: z
        .enum(["asc", "desc"])
        .optional()
        .describe("Direção da ordenação: 'asc' (crescente, padrão) ou 'desc' (decrescente)."),
    },
  },
  async ({ playlist_id, criteria, order }) => {
    try {
      const client = getSpotifyClient();
      const result = await client.sortPlaylistBy(playlist_id, criteria, order);
      return formatJsonToolResponse(result);
    } catch (err) {
      return formatToolError("Erro ao ordenar playlist", err);
    }
  }
);

// ============================================================================
// 6. MCP Resources (Fase 4)
// ============================================================================

server.registerResource(
  "user-playlists",
  "spotify://me/playlists",
  {
    description: "Lista resumida das playlists do usuário autenticado no Spotify.",
    mimeType: "application/json",
  },
  async (uri) => {
    const client = getSpotifyClient();
    const playlists = await client.listUserPlaylists(50);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(playlists, null, 2),
        },
      ],
    };
  }
);

server.registerResource(
  "user-top-artists",
  "spotify://me/top-artists",
  {
    description: "Artistas mais ouvidos pelo usuário no Spotify (médio prazo).",
    mimeType: "application/json",
  },
  async (uri) => {
    const client = getSpotifyClient();
    const artists = await client.getUserTopItems("artists", "medium_term", 25);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(artists, null, 2),
        },
      ],
    };
  }
);

server.registerResource(
  "user-top-tracks",
  "spotify://me/top-tracks",
  {
    description: "Faixas mais ouvidas pelo usuário no Spotify (médio prazo).",
    mimeType: "application/json",
  },
  async (uri) => {
    const client = getSpotifyClient();
    const tracks = await client.getUserTopItems("tracks", "medium_term", 25);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(tracks, null, 2),
        },
      ],
    };
  }
);

server.registerResource(
  "playlist-tracks",
  new ResourceTemplate("spotify://playlists/{playlist_id}", { list: undefined }),
  {
    description: "Faixas detalhadas de uma playlist específica do Spotify pelo ID.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const client = getSpotifyClient();
    const playlistId = String(variables.playlist_id || "");
    const tracks = await client.getPlaylistTracks(playlistId);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(tracks, null, 2),
        },
      ],
    };
  }
);

// ============================================================================
// 7. MCP Prompts (Workflows Pré-Definidos - Fase 4)
// ============================================================================

server.registerPrompt(
  "curate-genre-playlist",
  {
    description:
      "Workflow guiado para criar uma nova playlist temática ou de subgênero alinhada ao gosto musical do usuário.",
    argsSchema: {
      genre_or_theme: z
        .string()
        .describe("Gênero musical, subgênero ou tema da playlist (ex: 'Synthwave Cyberpunk', 'MPB Acústico')."),
      mood: z
        .string()
        .optional()
        .describe("Clima/energia desejado (ex: 'Foco intenso', 'Relaxante fim de tarde')."),
      track_count: z
        .string()
        .optional()
        .describe("Quantidade aproximada de faixas (padrão: '25')."),
    },
  },
  ({ genre_or_theme, mood, track_count }) => {
    const count = track_count || "25";
    const moodText = mood ? ` com clima/energia "${mood}"` : "";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Atue como um curador musical especialista. Quero criar uma nova playlist no Spotify sobre o tema/gênero "${genre_or_theme}"${moodText} contendo cerca de ${count} músicas.

Siga este fluxo:
1. Opcionalmente consulte meus top artistas/músicas ('get_user_top_items') para entender minhas referências, caso aplicável.
2. Selecione ${count} faixas excelentes que combinem perfeitamente com "${genre_or_theme}"${moodText}, garantindo uma progressão fluida entre elas.
3. Busque os URIs das faixas usando 'search_spotify_tracks'.
4. Crie a playlist com 'create_playlist' definindo um título criativo e uma boa descrição.
5. Adicione todas as faixas encontradas com 'add_tracks_to_playlist' e me apresente o link final e o resumo da curadoria.`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "smooth-transition-sorter",
  {
    description:
      "Workflow para analisar as faixas de uma playlist existente e reorganizá-las em uma progressão fluida de energia e estilo.",
    argsSchema: {
      playlist_name_or_id: z
        .string()
        .describe("Nome ou ID da playlist que deve ser reorganizada."),
      goal: z
        .string()
        .optional()
        .describe(
          "Objetivo da progressão (ex: 'Aquecimento -> Pico de Energia -> Cool down para treino', 'Festa crescente')."
        ),
    },
  },
  ({ playlist_name_or_id, goal }) => {
    const goalDesc = goal || "transição suave de energia (aquecimento, clímax e encerramento harmônico)";
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Quero reorganizar as músicas da minha playlist "${playlist_name_or_id}" visando: ${goalDesc}.

Siga este fluxo:
1. Se necessário, use 'list_user_playlists' para descobrir o ID exato da playlist "${playlist_name_or_id}".
2. Obtenha todas as faixas atuais com 'get_playlist_tracks'.
3. Remova eventuais duplicatas e ordene a lista completa de URIs pensando no ritmo, estilo, época e energia de cada música para criar uma narrativa sonora coesa (preservando todas as músicas únicas).
4. Atualize a playlist usando 'update_playlist_tracks' (o backup automático será salvo) e me explique como você estruturou os blocos da playlist.`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "clean-and-deduplicate",
  {
    description:
      "Audita uma playlist em busca de músicas repetidas ou versões remasterizadas duplicadas e faz a limpeza segura.",
    argsSchema: {
      playlist_name_or_id: z.string().describe("Nome ou ID da playlist a ser higienizada."),
    },
  },
  ({ playlist_name_or_id }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Faça uma auditoria e limpeza de duplicatas na minha playlist "${playlist_name_or_id}":
1. Localize o ID da playlist com 'list_user_playlists' se eu tiver informado apenas o nome.
2. Execute 'deduplicate_playlist' com 'match_by: "title_artist"' para remover URIs duplicados e versões repetidas da mesma música.
3. Me mostre quais faixas duplicadas foram removidas e qual o ID do backup gerado caso eu queira reverter.`,
        },
      },
    ],
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-spotify-curator v1.1.0 iniciado com sucesso via stdio.");
}

// Executa apenas quando chamado diretamente via CLI
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error("Erro fatal ao iniciar servidor MCP:", err);
    process.exit(1);
  });
}
