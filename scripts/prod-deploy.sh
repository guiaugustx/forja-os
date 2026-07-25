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

# ⚠️  FAÇA BACKUP DO BANCO ANTES DE RODAR ESTE DEPLOY. A migração desta leva
# dropa colunas com dado (Offer.saved, contadores antigos de IngestionRun) —
# é destrutiva de propósito, não um acidente, mas não tem volta sem um backup.
# Ex.: `docker compose -f docker-compose.prod.yml exec -T db pg_dump -U <user> <db> > backup-pre-deploy.sql`

# Baseline: um banco de produção que já existe rodou até aqui via `db push`,
# então nunca teve `_prisma_migrations` — a primeira migração real (o "init",
# que só descreve o schema que já está no ar) precisa ser marcada como já
# aplicada, sem rodar o SQL dela (o schema que ela criaria já existe; rodar o
# SQL de novo em cima do que já está lá é que quebraria). `|| true` faz isto
# ser idempotente: num banco que já passou por este passo (segundo deploy em
# diante), o resolve falha porque a migração já está registrada — e isso é
# esperado, não um erro real, então não pode derrubar o `set -e` do resto do
# script.
echo "→ Marcando a migração inicial como já aplicada (baseline; idempotente)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/prisma migrate resolve --applied 00000000000000_init" || true

# Migrações de verdade a partir daqui — `db push --accept-data-loss` seria a
# alternativa, mas sem TTY (`exec -T`) o prompt de confirmação nunca aparece e
# o comando sai com erro antes mesmo do seed rodar (é a Correção 1 desta leva).
# `migrate deploy` aplica cada migração pendente em ordem e grava em
# `_prisma_migrations`, sem perguntar nada — é feito para rodar sem TTY.
echo "→ Aplicando as migrações (prisma migrate deploy)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/prisma migrate deploy"

echo "→ Semeando dados de exemplo (idempotente; ignore se já semeado)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/tsx prisma/seed.ts" || echo "  (seed já aplicado — ok)"

# Sem HarvestSource populado a colheita não tem o que varrer na VPS.
echo "→ Semeando as fontes de colheita (idempotente)…"
$COMPOSE exec -T api sh -lc "cd packages/db && node_modules/.bin/tsx prisma/seed-sources.ts"

echo ""
echo "✅ Deploy concluído."
$COMPOSE ps
