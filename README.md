# Forja OS

Central de operação de produtos digitais low ticket globais. Um único painel que cobre a esteira inteira: **descoberta → produto → entregáveis → funil → criativos → tráfego → financeiro**.

Este repositório é o scaffold funcional. Ele já sobe (web + api + worker + banco) e serve dados reais do Postgres. O que ainda não está portado do protótipo está sequenciado no [`plano.md`](./plano.md).

## Stack

- **Web:** Next.js 15 (App Router) + HeroUI v3 + React 19 + Tailwind 4 + TanStack Query + Zustand
- **API:** NestJS + Prisma + PostgreSQL (validação com Zod)
- **Worker:** BullMQ + Redis (jobs de integração, tudo fora do request)
- **IA:** SiliconFlow (Qwen, API compatível com OpenAI) via `@forja/ai`
- **Monorepo:** Turborepo + pnpm
- **Infra local:** Docker (Postgres + Redis). Em produção: Coolify + Infisical + Uptime Kuma.

## Fluxo do MVP

Descoberta → curadoria → modelagem:

### Radar

Descoberta em três estágios de custo. A **colheita** (botão "Colher") varre as fontes
configuradas no urlscan, agrega os hits por chave e aplica um pré-filtro barato — sem
baixar nenhuma página e sem chamar a IA. Você **tria em massa** na tabela densa, mandando
cada candidato para a esteira, para análise ou para o descarte. Só então o
**enriquecimento** gasta download e IA, nas ofertas que você promoveu.

A ingestão não roda sozinha: é sempre disparada por ação humana.

1. **Colheita** (`harvest`): varre as fontes do urlscan (cadastradas em `HarvestSource`,
   com cursor próprio por fonte) e grava cada hit inédito como `Candidate` — zero
   download, zero IA.
2. **Triagem** (aba Triagem em `/radar`): você decide em massa, por linha ou por lote —
   esteira (✓), análise (?) ou descarte (✕), com desfazer.
3. **Enriquecimento** (`enrich`): só nos candidatos promovidos para análise — baixa a
   página, roda o raio-x da IA, mede tráfego/trend e calcula o score.
4. **Análise** (aba Análise em `/radar`): dossiê pronto — promove para a esteira ou
   descarta.
5. **Modelagem** (`/esteira`): a partir de uma oferta promovida, a IA monta a
   **estrutura base** em 4 etapas — Avatar → Grande ideia → Estrutura da oferta → Copy
   de vendas.

### Chaves necessárias (preencher no `.env`)

- **IA** — dois provedores intercambiáveis, escolhidos por `AI_PROVIDER`:
  - `openrouter` (ou qualquer API compatível com OpenAI): `AI_OPENAI_API_KEY`,
    `AI_OPENAI_BASE_URL`, `AI_OPENAI_MODEL`.
  - `anthropic` (Claude API): `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (padrão `claude-opus-5`).

  `AI_FALLBACK_PROVIDER` é opcional e só entra em ação quando o primário recusa por
  **cota ou rate limit** — o caso típico é o teto diário do plano gratuito do OpenRouter.
  Chave errada, rede fora ou JSON inválido continuam falhando de forma visível, porque
  trocar de provedor não conserta nenhum deles.

  **Sem chave de provedor nenhuma a IA roda em modo simulado e devolve mocks coerentes.**
  O fluxo funciona e o dossiê é ficção — prefira uma chave errada dando erro visível a
  uma chave vazia mentindo.
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

Isso instala dependências, sobe Postgres + Redis, cria o schema, semeia dados de exemplo
e semeia as fontes de colheita do Radar (`HarvestSource`) — sem elas o botão "Colher"
não tem o que varrer.

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
    worker/   BullMQ (colheita, enriquecimento, sync de saldos e métricas)
  packages/
    db/       schema Prisma + client + seed
    ai/       cliente de IA (SiliconFlow/Qwen, compatível com OpenAI)
    types/    tipos compartilhados
  reference/  protótipo HTML + documento de arquitetura (a fonte da verdade visual)
  plano.md    execução em fases até 100%
```

## Referência visual

O protótipo navegável (`reference/prototype.html`) e o documento de arquitetura (`reference/arquitetura.md`) são a fonte da verdade do produto. A missão do build é portar aquele protótipo para os componentes reais de HeroUI, fase a fase.
