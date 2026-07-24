# Forja OS

Central de operação de produtos digitais low ticket globais. Um único painel que cobre a esteira inteira: **descoberta → produto → entregáveis → funil → criativos → tráfego → financeiro**.

Este repositório é o scaffold funcional. Ele já sobe (web + api + worker + banco) e serve dados reais do Postgres. O que ainda não está portado do protótipo está sequenciado no [`plano.md`](./plano.md).

## Stack

- **Web:** Next.js 14 (App Router) + HeroUI + Tailwind + TanStack Query + Zustand
- **API:** NestJS + Prisma + PostgreSQL (validação com Zod)
- **Worker:** BullMQ + Redis (jobs de integração, tudo fora do request)
- **IA:** SiliconFlow (Qwen, API compatível com OpenAI) via `@forja/ai`
- **Monorepo:** Turborepo + pnpm
- **Infra local:** Docker (Postgres + Redis). Em produção: Coolify + Infisical + Uptime Kuma.

## Fluxo do MVP

Descoberta → curadoria → modelagem:

1. **Ingestão** (Radar): o worker busca páginas de venda no urlscan.io (query padrão
   `domain:cdn.utmify.com.br`), extrai o texto, e a IA gera um **raio-x** da oferta +
   um **score** de oportunidade.
2. **Curadoria** (Radar): você revisa as ofertas (raio-x, sinais, score) e **salva/descarta**.
3. **Modelagem** (Gerador): a partir de uma oferta salva, a IA monta a **estrutura base**
   em 4 etapas — Avatar → Grande ideia → Estrutura da oferta → Copy de vendas.

### Chaves necessárias (preencher no `.env`)

- `SILICONFLOW_API_KEY` — obrigatório para a geração real de IA (sem ela, roda em modo
  simulado com mocks). Modelo padrão `Qwen/Qwen2.5-72B-Instruct`.
- `URLSCAN_API_KEY` — conta gratuita em https://urlscan.io (Settings & API). Sem ela, a
  busca roda na cota anônima (bem limitada).
- `SERPAPI_KEY` — opcional; liga a demanda via Google Trends. Sem ela, o score usa
  persistência + concorrência + margem.

Sem Supabase — Postgres self-hosted, por decisão de projeto.

## Colocar na pasta do desktop

Este projeto deve viver em `~/Desktop/guilhermeaugusto`. Depois de descompactar:

```bash
# macOS / Linux
mkdir -p ~/Desktop/guilhermeaugusto
cp -R forja-os ~/Desktop/guilhermeaugusto/
cd ~/Desktop/guilhermeaugusto/forja-os
```

No Windows, mova a pasta `forja-os` para dentro de `Desktop\guilhermeaugusto` pelo Explorer e abra um terminal ali.

## Setup (um comando)

Pré-requisitos: **Node 20+**, **Docker Desktop** e **pnpm** (o script instala o pnpm se faltar).

```bash
bash scripts/setup.sh
```

Isso instala dependências, sobe Postgres + Redis, cria o schema e semeia dados de exemplo.

## Rodar

```bash
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:3333/api/health
- Prisma Studio: `pnpm db:studio`

## Estrutura

```
forja-os/
  apps/
    web/      Next.js + HeroUI (o painel)
    api/      NestJS + Prisma (REST /api)
    worker/   BullMQ (sync de saldos, métricas, mineração)
  packages/
    db/       schema Prisma + client + seed
    types/    tipos compartilhados
  reference/  protótipo HTML + documento de arquitetura (a fonte da verdade visual)
  plano.md    execução em fases até 100%
```

## Referência visual

O protótipo navegável (`reference/prototype.html`) e o documento de arquitetura (`reference/arquitetura.md`) são a fonte da verdade do produto. A missão do build é portar aquele protótipo para os componentes reais de HeroUI, fase a fase.
