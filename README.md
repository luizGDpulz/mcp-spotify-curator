# 🎧 mcp-spotify-curator

> Servidor **MCP (Model Context Protocol)** em TypeScript para curadoria, criação e gerenciamento inteligente de playlists no Spotify diretamente pelo seu assistente de IA (**Antigravity**, Claude Desktop, Cursor, etc.).

Opera localmente via transporte **`stdio`**, garantindo consumo mínimo de recursos (0% CPU ocioso, ~30–50MB RAM) e total privacidade.

---

## 🚀 Ferramentas MCP Disponíveis

| Ferramenta | Parâmetros | Descrição |
| :--- | :--- | :--- |
| `list_user_playlists` | `{ limit?: number }` | Lista as playlists da conta do usuário para descobrir IDs e detalhes. |
| `get_playlist_tracks` | `{ playlist_id: string }` | Retorna todas as faixas da playlist com URIs, títulos, artistas e álbuns higienizados. |
| `search_spotify_tracks` | `{ queries: string[] }` | Pesquisa no catálogo musical por termos (ex: `["Bohemian Rhapsody - Queen"]`) e devolve os URIs correspondentes. |
| `create_playlist` | `{ name: string, description?: string }` | Cria uma nova playlist no perfil do usuário e devolve seu ID e link direto. |
| `update_playlist_tracks` | `{ playlist_id: string, uris: string[] }` | Substitui todas as faixas da playlist pela nova lista ordenada de URIs (reordenação ou reset). Suporta listas grandes dividindo automaticamente em lotes. |

---

## 📋 Pré-requisitos
* **Node.js** v20+ LTS
* **pnpm** (gerenciador de pacotes oficial do projeto)
* Uma conta no Spotify (Free ou Premium)

---

## 🔑 Passo a Passo: Configuração do Spotify Developer App

Para que o servidor MCP possa acessar sua conta do Spotify de forma segura via OAuth 2.0, você precisa criar um App gratuito no painel do Spotify:

1. Acesse o [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) e faça login com sua conta Spotify.
2. Clique no botão **Create app** (Criar aplicativo).
3. Preencha as informações básicas:
   * **App name:** `MCP Spotify Curator` (ou o nome que preferir)
   * **App description:** `Curador de playlists via MCP e IA`
   * **Redirect URIs:** Adicione exatamente a URL abaixo e clique em **Add**:
     * `http://127.0.0.1:8888/callback`
     *(Nota: O Spotify exibirá um aviso amarelo dizendo "This redirect URI is not secure". Isso é normal e esperado para endereços locais `http://127.0.0.1`. O Spotify permite salvar normalmente).*
     *(Atenção: Não utilize `localhost`, pois o Spotify baniu essa palavra).*
   * **Which API/SDKs are you planning to use?:** Marque **Web API**.
4. Aceite os termos de serviço do desenvolvedor e clique em **Save**.
5. Na página do seu App recém-criado, clique em **Settings**:
   * Copie o **Client ID**.
   * Clique em **View client secret** e copie o **Client Secret**.

---

## ⚡ Instalação e Autenticação Inicial

### 1. Clonar e Instalar Dependências

```bash
git clone https://github.com/seu-usuario/mcp-spotify-curator.git
cd mcp-spotify-curator
pnpm install
```

### 2. Configurar o arquivo `.env`

Copie o template de variáveis de ambiente:

```bash
cp .env.example .env
```

Abra o `.env` e preencha suas chaves do Spotify Developer:

```env
SPOTIFY_CLIENT_ID=seu_client_id_aqui
SPOTIFY_CLIENT_SECRET=seu_client_secret_aqui
```

### 3. Gerar o Refresh Token (Execução Única)

Execute o assistente interativo de autenticação:

```bash
pnpm run auth:setup
```

1. O script iniciará um servidor local temporário na porta `8888` e tentará abrir o navegador automaticamente.
2. Faça login e clique em **Agree / Autorizar** para conceder permissões de leitura e escrita de playlists.
3. Ao concluir, o navegador exibirá uma tela de confirmação e o script gravará o `SPOTIFY_REFRESH_TOKEN` diretamente no seu arquivo `.env`!

> 💡 **Como funciona a renovação?** O servidor MCP renova o token de acesso silenciosamente na memória sempre que ele expira (a cada 1 hora). Você não precisará rodar o setup novamente.

### 4. Compilar o Projeto

```bash
pnpm run build
```

---

## ⚙️ Configuração no seu Cliente de IA

### Google Antigravity (`~/.gemini/config/mcp_config.json`)

Adicione o servidor na sua configuração do Antigravity:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/caminho/absoluto/para/mcp-spotify-curator/dist/index.js"],
      "env": {
        "SPOTIFY_CLIENT_ID": "seu_client_id",
        "SPOTIFY_CLIENT_SECRET": "seu_client_secret",
        "SPOTIFY_REFRESH_TOKEN": "seu_refresh_token"
      }
    }
  }
}
```

*(Se você já possui o `.env` preenchido no diretório do projeto, o servidor carrega as variáveis dele automaticamente).*

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/caminho/absoluto/para/mcp-spotify-curator/dist/index.js"],
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

## 💬 Exemplos de Uso com a IA

Com o servidor MCP configurado, converse naturalmente com seu assistente:

* *"Quais são as playlists que tenho no meu Spotify?"*
* *"Crie uma nova playlist chamada 'Cyberpunk Focus' com descrição 'Trilha sonora para programar'."*
* *"Busque as músicas 'Resonance - HOME', 'Subdivisions - Rush' e 'Midnight City - M83' e coloque na minha playlist 'Cyberpunk Focus'."*
* *"Veja as músicas da minha playlist 'Treino', analise a energia delas e reorganize para que as faixas mais intensas fiquem no meio do treino."*
* *"Elimine as músicas duplicadas da minha playlist 'Favoritas'."*

---

## 🐳 Executando com Docker (Opcional)

Se preferir rodar em contêiner:

```bash
# Construir a imagem
docker build -t mcp-spotify-curator .

# Executar via stdio integrando ao cliente MCP
docker run -i --rm --env-file .env mcp-spotify-curator
```

---

## 🛠️ Scripts Disponíveis

* `pnpm run build`: Compila o TypeScript para `dist/`.
* `pnpm run start`: Inicia o servidor MCP stdio a partir de `dist/index.js`.
* `pnpm run auth:setup`: Inicia o assistente de autorização OAuth 2.0.
* `pnpm run typecheck`: Valida a integridade dos tipos TypeScript sem emitir arquivos.

---

## 📄 Licença

Distribuído sob os termos da licença [GNU General Public License v3.0](LICENSE).