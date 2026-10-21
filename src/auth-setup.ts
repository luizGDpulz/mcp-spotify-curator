import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ENV_PATH = path.resolve(__dirname, "../.env");
dotenv.config({ path: PROJECT_ENV_PATH });
dotenv.config();

const PORT = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-top-read",
  "user-read-recently-played",
  "user-read-playback-state",
  "user-read-currently-playing",
].join(" ");

function openBrowser(url: string) {
  const start =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
      ? "start"
      : "xdg-open";

  exec(`${start} "${url}"`, (err) => {
    if (err) {
      // Ignora erro se não houver interface gráfica ou comando disponível
    }
  });
}

function updateEnvFile(clientId: string, clientSecret: string, refreshToken: string) {
  const envPath = PROJECT_ENV_PATH;
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }

  const map = new Map<string, string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim();
        map.set(k, v);
      }
    }
  }

  map.set("SPOTIFY_CLIENT_ID", clientId);
  map.set("SPOTIFY_CLIENT_SECRET", clientSecret);
  map.set("SPOTIFY_REFRESH_TOKEN", refreshToken);

  const newLines: string[] = [];
  for (const [k, v] of map.entries()) {
    newLines.push(`${k}=${v}`);
  }

  fs.writeFileSync(envPath, newLines.join("\n") + "\n", "utf-8");
}

function extractCode(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("code=")) {
    try {
      const testUrl = trimmed.startsWith("http") ? trimmed : `http://127.0.0.1:8888/${trimmed}`;
      const parsed = new URL(testUrl);
      const code = parsed.searchParams.get("code");
      if (code) return code;
    } catch {
      const match = trimmed.match(/code=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  }
  return trimmed;
}

async function exchangeCodeForToken(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
  });

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    throw new Error(`Spotify token error (${tokenRes.status}): ${errorText}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
  };

  return tokenData.refresh_token;
}

async function main() {
  console.log("============================================================");
  console.log("   🎵 MCP Spotify Curator - Autenticação OAuth 2.0 Inicial   ");
  console.log("============================================================\n");

  let clientId = process.env.SPOTIFY_CLIENT_ID;
  let clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (!clientId || !clientSecret) {
    console.log("ℹ️  Credenciais do Spotify não encontradas no arquivo .env.\n");
    console.log("1. Acesse https://developer.spotify.com/dashboard");
    console.log("2. Selecione seu App (ou crie um)");
    console.log("3. Em 'Settings' > 'Redirect URIs', certifique-se de adicionar e clicar em 'Add':");
    console.log(`   👉 ${REDIRECT_URI}`);
    console.log("   (Nota: O aviso 'This redirect URI is not secure' é normal. Não use 'localhost').\n");

    if (!clientId) {
      clientId = (await rl.question("Informe seu SPOTIFY_CLIENT_ID: ")).trim();
    }
    if (!clientSecret) {
      clientSecret = (await rl.question("Informe seu SPOTIFY_CLIENT_SECRET: ")).trim();
    }
  }

  if (!clientId || !clientSecret) {
    console.error("❌ Client ID e Client Secret são obrigatórios.");
    rl.close();
    process.exit(1);
  }

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);

  let isCompleted = false;

  const handleSuccess = (refreshToken: string) => {
    if (isCompleted) return;
    isCompleted = true;

    updateEnvFile(clientId!, clientSecret!, refreshToken);

    console.log("\n============================================================");
    console.log("   ✅ SUCESSO! SPOTIFY_REFRESH_TOKEN OBTIDO COM ÊXITO       ");
    console.log("============================================================\n");
    console.log(`SPOTIFY_REFRESH_TOKEN: ${refreshToken}\n`);
    console.log("📁 As credenciais foram gravadas automaticamente no arquivo .env!\n");

    rl.close();
    server.close();
    process.exit(0);
  };

  const server = http.createServer(async (req, res) => {
    if (!req.url) return;
    const reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (reqUrl.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = reqUrl.searchParams.get("code");
    const error = reqUrl.searchParams.get("error");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>Erro de autorização</h1><p>${error}</p>`);
      console.error(`\n❌ Autorização recusada pelo Spotify: ${error}`);
      server.close();
      rl.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h1>Código de autorização não encontrado.</h1>");
      return;
    }

    try {
      const refreshToken = await exchangeCodeForToken(code, clientId!, clientSecret!);

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="utf-8">
          <title>Spotify Curator - Autenticado</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background-color: #121212;
              color: #FFFFFF;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              background-color: #181818;
              border: 1px solid #282828;
              border-radius: 12px;
              padding: 40px;
              text-align: center;
              max-width: 480px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .icon { font-size: 54px; margin-bottom: 16px; }
            h1 { color: #1DB954; font-size: 26px; margin-bottom: 12px; }
            p { color: #B3B3B3; font-size: 15px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🎧</div>
            <h1>Autenticação Concluída!</h1>
            <p>O <strong>mcp-spotify-curator</strong> recebeu seu <code>SPOTIFY_REFRESH_TOKEN</code> com sucesso e gravou no arquivo <code>.env</code>.</p>
            <p>Você já pode fechar esta aba e voltar ao seu terminal.</p>
          </div>
        </body>
        </html>
      `);

      handleSuccess(refreshToken);
    } catch (err) {
      console.error("\n❌ Falha ao trocar código pelo token:", err);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Erro interno ao processar autorização.");
      server.close();
      rl.close();
      process.exit(1);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`🌐 Servidor local ouvindo em http://127.0.0.1:${PORT}`);
    console.log("\n🔗 Abra a URL abaixo no navegador para autorizar:\n");
    console.log(authUrl.toString());
    console.log("\n------------------------------------------------------------");
    console.log("💡 SE VOCÊ ESTÁ EM UM SERVIDOR REMOTO (SSH / VPS):");
    console.log("1. Abra o link acima no navegador do seu computador local.");
    console.log("2. Faça login e clique em 'Autorizar'.");
    console.log("3. Seu navegador tentará carregar 'http://127.0.0.1:8888/callback?code=...' e falhará (normal!).");
    console.log("4. Apenas COPIE a URL inteira da barra de endereços (ou só o código) e COLE abaixo:");
    console.log("------------------------------------------------------------\n");

    openBrowser(authUrl.toString());

    // Prompt no terminal para caso o usuário esteja em máquina remota
    (async () => {
      try {
        const input = await rl.question("👉 Cole a URL de redirecionamento ou o código aqui: ");
        if (isCompleted) return;

        const rawCode = extractCode(input);
        if (!rawCode) {
          console.error("❌ Nenhum código encontrado na entrada.");
          rl.close();
          server.close();
          process.exit(1);
        }

        console.log("\n🔄 Processando código e obtendo Refresh Token...");
        const refreshToken = await exchangeCodeForToken(rawCode, clientId!, clientSecret!);
        handleSuccess(refreshToken);
      } catch (err) {
        if (!isCompleted) {
          console.error("\n❌ Erro ao validar o código colado:", err);
          rl.close();
          server.close();
          process.exit(1);
        }
      }
    })();
  });
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
