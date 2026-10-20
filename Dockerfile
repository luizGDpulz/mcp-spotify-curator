# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Ativa corepack para usar pnpm nativamente
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

# Copia manifestos de dependência
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* tsconfig.json ./

# Instala dependências (incluindo dev para compilar o TypeScript)
RUN pnpm install --frozen-lockfile

# Copia código-fonte
COPY src/ ./src/

# Compila o projeto TypeScript
RUN pnpm run build

# Stage 2: Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --prod --frozen-lockfile

# Copia apenas o build do estágio anterior
COPY --from=builder /app/dist ./dist

# Servidor MCP stdio
CMD ["node", "dist/index.js"]
