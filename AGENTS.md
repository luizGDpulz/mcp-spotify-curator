# mcp-spotify-curator

## 🎯 Visão Geral do Projeto
O **`mcp-spotify-curator`** é um servidor MCP (**Model Context Protocol**) construído em **TypeScript** que permite que assistentes de IA (como **Antigravity**, Claude Desktop, Cursor, etc.) gerenciem e façam curadoria de playlists no Spotify diretamente pelo contexto de conversa.

O servidor opera via transporte **`stdio`**, garantindo consumo mínimo de recursos (0% CPU ocioso, ~30-50MB RAM) e integração local segura.

---

## 🏗️ Arquitetura e Pilha Tecnológica
* **Linguagem / Runtime:** TypeScript / Node.js (ESM)
* **Gerenciador de Pacotes:** `pnpm` (padrão oficial da Millennium Falcon)
* **SDK MCP:** `@modelcontextprotocol/sdk`
* **Transporte:** `stdio` (Standard I/O)
* **API Externa:** Spotify Web API (OAuth 2.0 com fluxo de Refresh Token)
* **Validação / Schemas:** `zod`

---

## 🔑 Estratégia de Autenticação (OAuth 2.0)
Como o servidor MCP roda silenciosamente em segundo plano chamado pelo cliente de IA via CLI:
1. **Setup Inicial (uma única vez):**
   * Script CLI (`src/auth-setup.ts`) que inicia um servidor local temporário (ex: porta 8888), abre o navegador para o usuário autorizar os escopos necessários e captura o `SPOTIFY_REFRESH_TOKEN`.
2. **Operação Contínua (Silenciosa):**
   * O servidor MCP usa o `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` e `SPOTIFY_REFRESH_TOKEN` gravados no `.env`.
   * Sempre que o `access_token` expira (a cada 1h), o servidor renova em memória silenciosamente sem interrupção para o usuário.

### Escopos Necessários do Spotify
* `playlist-read-private`
* `playlist-read-collaborative`
* `playlist-modify-public`
* `playlist-modify-private`

---

## 🛠️ Ferramentas (Tools) Expostas pelo Servidor

| Ferramenta | Entrada (Input Schema) | Descrição |
| :--- | :--- | :--- |
| `list_user_playlists` | `{ limit?: number }` | Lista as playlists do usuário logado para encontrar seus IDs pelo nome. |
| `get_playlist_tracks` | `{ playlist_id: string }` | Devolve as faixas atuais higienizadas (`uri`, `name`, `artists`) para análise ou reordenação. |
| `search_spotify_tracks` | `{ queries: string[] }` | Busca no catálogo por termos no formato `"Música - Artista"` e retorna os URIs. |
| `create_playlist` | `{ name: string, description?: string }` | Cria uma nova playlist vazia para o usuário e retorna seu ID e URL. |
| `update_playlist_tracks` | `{ playlist_id: string, uris: string[] }` | Substitui todas as faixas da playlist pela nova lista ordenada de URIs (reordenação ou reset). |

---

## 📁 Estrutura de Arquivos Planejada

```text
mcp-spotify-curator/
├── AGENTS.md                  # Contexto e especificações para o agente (este arquivo)
├── .gitignore                 # node_modules, dist, .env
├── .env.example               # Template de variáveis de ambiente
├── README.md                  # Documentação pública para GitHub
├── package.json               # Dependências e scripts de build/start
├── tsconfig.json              # Configuração TypeScript (ESM)
└── src/
    ├── index.ts               # Servidor MCP e registro das ferramentas
    ├── spotify.ts             # Cliente da API Spotify e renovação de token
    └── auth-setup.ts          # Script para gerar o Refresh Token inicial
```

---

## ⚙️ Configuração no Antigravity (`~/.gemini/config/mcp_config.json`)

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/home/ubuntu/dev/mcp-spotify-curator/dist/index.js"],
      "env": {
        "SPOTIFY_CLIENT_ID": "seu_client_id",
        "SPOTIFY_CLIENT_SECRET": "seu_client_secret",
        "SPOTIFY_REFRESH_TOKEN": "seu_refresh_token"
      }
    }
  }
}
```

---

## 📋 Checklist de Próximos Passos
- [x] Node.js LTS e pnpm configurados no ambiente.
- [x] Configurar `package.json` com dependências via `pnpm add`.
- [x] Implementar `src/spotify.ts`, `src/auth-setup.ts` e `src/index.ts`.
- [x] Criar `.env.example` e documentar passo a passo de como criar o App no Spotify Developer Dashboard.
- [x] Compilar projeto (`pnpm run build`).
- [x] Executar script de autenticação (`pnpm run auth:setup`) e registrar no `mcp_config.json`.
- [x] Fazer commit e push para `origin main`.
