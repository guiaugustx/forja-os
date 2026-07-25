#!/usr/bin/env bash
# Deploy do Forja OS na VPS via Docker Compose. Rode na raiz do projeto (na VPS).
# Pré-requisito: um arquivo .env preenchido (veja .env.prod.example).
set -e

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "→ Build da imagem forja-os…"
$COMPOSE build api

echo "→ Subindo o stack…"
$COMPOSE up -d

echo "→ Aguardando o Postgres ficar pronto…"
sleep 10

echo "→ Aplicando o schema (prisma db push)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/prisma db push --skip-generate"

echo "→ Semeando dados de exemplo (idempotente; ignore se já semeado)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/tsx prisma/seed.ts" || echo "  (seed já aplicado — ok)"

# Sem HarvestSource populado a colheita não tem o que varrer na VPS.
echo "→ Semeando as fontes de colheita (idempotente)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/tsx prisma/seed-sources.ts"

echo ""
echo "✅ Deploy concluído."
$COMPOSE ps
