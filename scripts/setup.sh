#!/usr/bin/env bash
# Forja OS — setup de ambiente (macOS / Linux).
# Roda a partir da raiz do projeto: bash scripts/setup.sh
set -e

echo ""
echo "🔥  Forja OS — setup de ambiente"
echo "────────────────────────────────"

# 1) Pré-requisitos
command -v node >/dev/null 2>&1 || { echo "❌ Node.js não encontrado. Instale Node 20+ (https://nodejs.org)"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then echo "❌ Node 20+ necessário (você tem $(node -v))."; exit 1; fi
echo "✓ Node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "→ Instalando pnpm via corepack…"
  corepack enable >/dev/null 2>&1 || npm i -g pnpm
fi
echo "✓ pnpm $(pnpm -v)"

command -v docker >/dev/null 2>&1 || { echo "❌ Docker não encontrado. Instale Docker Desktop."; exit 1; }
echo "✓ Docker encontrado"

# 2) .env
if [ ! -f .env ]; then cp .env.example .env; echo "✓ .env criado a partir do .env.example (preencha as chaves depois)"; fi

# 3) Dependências
echo "→ Instalando dependências (pode levar alguns minutos)…"
pnpm install

# 4) Infra local (Postgres + Redis)
echo "→ Subindo Postgres + Redis via Docker…"
docker compose up -d
echo "→ Aguardando o Postgres ficar pronto…"
sleep 6

# 5) Banco
echo "→ Gerando client Prisma e criando o schema…"
pnpm db:generate
pnpm db:push

echo "→ Compilando pacotes internos (db, ai)…"
pnpm --filter @forja/db build || true
pnpm --filter @forja/ai build || true

echo "→ Semeando dados de exemplo…"
pnpm db:seed

echo "→ Semeando as fontes de colheita do Radar…"
pnpm db:seed:sources

echo ""
echo "✅  Pronto! Ambiente configurado."
echo ""
echo "Para rodar tudo (web + api + worker):"
echo "    pnpm dev"
echo ""
echo "  Web:  http://localhost:3000"
echo "  API:  http://localhost:3333/api/health"
echo "  DB:   pnpm db:studio"
echo ""
