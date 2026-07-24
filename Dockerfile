# Forja OS — imagem única do monorepo (api, worker, web rodam da mesma imagem).
# Build multi-stage com pnpm + turbo.

# ---- base ----
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app

# ---- deps: instala dependências do workspace (camada cacheável) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile

# ---- build: gera client Prisma e compila tudo ----
FROM deps AS build
COPY . .
RUN pnpm --filter @forja/db exec prisma generate
# NEXT_PUBLIC_API_URL é embutido no bundle do Next em tempo de build.
ARG NEXT_PUBLIC_API_URL="http://localhost:3333"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build

# ---- runtime: imagem final (contém node_modules + builds) ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
# comando é definido por serviço no docker-compose (api / worker / web)
CMD ["node", "apps/api/dist/main.js"]
