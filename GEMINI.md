# mcp-spotify-curator

## 🎯 Visão Geral do Projeto
O **`mcp-spotify-curator`** é um servidor MCP (**Model Context Protocol**) construído em **TypeScript** que permite que assistentes de IA (como **Antigravity**, Claude Desktop, Cursor, etc.) gerenciem e façam curadoria inteligente de playlists no Spotify diretamente pelo contexto de conversa.

O servidor opera via transporte **`stdio`**, garantindo consumo mínimo de recursos (0% CPU ocioso, ~30-50MB RAM), backups automáticos locais antes de modificações destrutivas, tratamento de Rate Limiting (HTTP 429) e integração local segura.

---

## 🏗️ Arquitetura e Pilha Tecnológica
* **Linguagem / Runtime:** TypeScript / Node.js (ESM)
* **Gerenciador de Pacotes:** `pnpm` (padrão oficial da Millennium Falcon)
* **SDK MCP:** `@modelcontextprotocol/sdk`
* **Transporte:** `stdio` (Standard I/O)
* **API Externa:** Spotify Web API (OAuth 2.0 com fluxo de Refresh Token e endpoints `/items`)
* **Validação / Schemas:** `zod`
* **Testes:** `vitest`

---

## 🔑 Estratégia de Autenticação (OAuth 2.0)
Como o servidor MCP roda silenciosamente em segundo plano chamado pelo cliente de IA via CLI:
1. **Setup Inicial (uma única vez):**
   * Script CLI (`src/auth-setup.ts`) que inicia um servidor local temporário (porta 8888), abre o navegador para o usuário autorizar os escopos necessários e captura o `SPOTIFY_REFRESH_TOKEN`.
2. **Operação Contínua (Silenciosa):**
   * O servidor MCP usa o `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` e `SPOTIFY_REFRESH_TOKEN` gravados no `.env`.
   * Sempre que o `access_token` expira (a cada 1h), o servidor renova em memória silenciosamente sem interrupção para o usuário.

### Escopos do Spotify Configurados
* `playlist-read-private`
* `playlist-read-collaborative`
* `playlist-modify-public`
* `playlist-modify-private`
* `user-library-read`
* `user-top-read`
* `user-read-recently-played`
* `user-read-playback-state`
* `user-read-currently-playing`

---

## 🛠️ Ferramentas (Tools) Expostas pelo Servidor

| Ferramenta | Entrada (Input Schema) | Descrição |
| :--- | :--- | :--- |
| `list_user_playlists` | `{ limit?: number }` | Lista as playlists do usuário logado para encontrar seus IDs pelo nome. |
| `get_playlist_tracks` | `{ playlist_id: string }` | Devolve as faixas atuais higienizadas (`uri`, `name`, `artists`, `album`, `release_date`, `duration_ms`, `added_at`). |
| `search_spotify_tracks` | `{ queries: string[] }` | Busca no catálogo por termos ou filtros avançados (`artist:`, `year:`, `genre:`) e retorna os URIs. |
| `create_playlist` | `{ name: string, description?: string, public?: boolean }` | Cria uma nova playlist vazia para o usuário e retorna seu ID e URL. |
| `update_playlist_tracks` | `{ playlist_id: string, uris: string[] }` | Substitui todas as faixas da playlist pela nova lista ordenada de URIs (com backup automático). |
| `add_tracks_to_playlist` | `{ playlist_id: string, uris: string[], position?: number }` | Adiciona faixas atomicamente no final ou em posição específica sem sobrescrever a playlist. |
| `remove_tracks_from_playlist` | `{ playlist_id: string, uris: string[] }` | Remove faixas específicas atomicamente com backup automático prévio. |
| `deduplicate_playlist` | `{ playlist_id: string, dry_run?: boolean, match_by?: "uri" \| "title_artist" }` | Identifica e remove músicas duplicadas (incluindo remasters repetidos) com backup automático. |
| `sort_playlist_by` | `{ playlist_id: string, criteria: string, order?: "asc" \| "desc" }` | Ordena faixas por `name`, `artist`, `album`, `duration`, `release_date` ou `added_at`. |
| `list_playlist_backups` | `{ playlist_id?: string }` | Lista snapshots de backup salvos localmente em `~/.cache/mcp-spotify-curator/backups`. |
| `restore_playlist_backup` | `{ playlist_id: string, backup_id?: string }` | Restaura uma playlist a partir de um backup local. |
| `get_user_saved_tracks` | `{ limit?: number, offset?: number }` | Obtém as músicas curtidas (*Liked Songs*) do usuário. |
| `get_user_top_items` | `{ type: "artists" \| "tracks", time_range?: string, limit?: number }` | Retorna os artistas ou músicas mais ouvidos pelo usuário. |
| `get_recently_played` | `{ limit?: number }` | Retorna o histórico de reprodução recente do usuário. |
| `get_current_playback` | `{}` | Obtém a faixa em reprodução no momento. |

---

## 🧩 MCP Resources e Prompts
* **Resources:** `spotify://me/playlists`, `spotify://me/top-artists`, `spotify://me/top-tracks`, `spotify://playlists/{playlist_id}`
* **Prompts:** `curate-genre-playlist`, `smooth-transition-sorter`, `clean-and-deduplicate`

---

## 📁 Estrutura de Arquivos

```text
mcp-spotify-curator/
├── .github/
│   ├── workflows/ci.yml       # Pipeline de CI (typecheck, test, build)
│   ├── ISSUE_TEMPLATE/        # Templates de issues
│   └── pull_request_template.md
├── GEMINI.md                  # Contexto e especificações para Antigravity/Gemini
├── CONTRIBUTING.md            # Guia de contribuição
├── LICENSE                    # Licença MIT
├── README.md                  # Documentação principal (Inglês)
├── README.pt-BR.md            # Documentação em Português
├── .gitignore                 # node_modules, dist, .env, AGENTS.md
├── .env.example               # Template de variáveis de ambiente
├── package.json               # Dependências e scripts de build/start/test
├── tsconfig.json              # Configuração TypeScript (ESM)
├── src/
│   ├── index.ts               # Servidor MCP (Tools, Resources e Prompts)
│   ├── spotify.ts             # Cliente da API Spotify, backups, curadoria e retries
│   └── auth-setup.ts          # Script para gerar o Refresh Token inicial
└── test/
    ├── utils.test.ts          # Testes unitários de higienização e normalização
    ├── spotify-client.test.ts # Testes do cliente Spotify (backups, retries, curadoria)
    └── mcp-server.test.ts     # Testes de integração do servidor MCP via InMemoryTransport
```
