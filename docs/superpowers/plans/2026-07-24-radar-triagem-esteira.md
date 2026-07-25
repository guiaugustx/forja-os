# Radar: Triagem em Massa e Esteira — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inverter a economia do funil do Radar — colher milhares de candidatos a custo ~zero, deixar o humano triar em massa numa tabela densa, e só então gastar download + IA no que foi promovido.

**Architecture:** A ingestão monolítica (`ingestOffers`) é quebrada em dois jobs. `harvest` varre o urlscan, agrega os hits por chave, aplica um pré-filtro barato e grava linhas em `Candidate` — sem nenhum acesso HTTP à página nem chamada de LLM. O humano tria em `/radar`; ao promover, nasce uma `Offer` e o job `enrich` faz o trabalho caro em background. A `Offer` promovida vive em duas filas: Análise (`stage: analysis`) e Esteira (`stage: pipeline`, board em `/esteira` sobre `OfferDraft.currentStep`).

**Tech Stack:** TypeScript, pnpm workspaces + Turborepo, Prisma 5 + PostgreSQL, BullMQ + Redis, NestJS 10 (api), Next.js 15 + React 19 + HeroUI v3 + Tailwind 4 (web), Vitest (novo — o projeto não tinha runner de teste).

**Spec:** `docs/superpowers/specs/2026-07-24-radar-triagem-esteira-design.md`

## Global Constraints

- Comentários e textos de UI em **português do Brasil**, seguindo o tom dos arquivos existentes (comentário explica *por quê*, não *o quê*).
- **Nunca reintroduzir limite de colheita ou ordenação especial para fontes de checkout.** Verificado empiricamente pelo usuário: o volume das fontes de checkout é consideravelmente menor que o da utmify.
- Nenhum download de página e nenhuma chamada de LLM pode acontecer nos jobs `harvest` ou no pré-filtro. Esses custos vivem exclusivamente em `enrich`.
- Verificação de "domínio morto" **não** existe no pré-filtro (exigiria uma requisição HTTP por candidato). Página fora do ar vira o alerta `sem-conteudo` no enriquecimento.
- Testes automatizados cobrem a **lógica pura** do worker (agregação, chave de dedupe, pré-filtro, cascata de resolução, parsing do adapter) via Vitest. API e web **não** ganham stack de teste nesta entrega — são verificadas rodando a aplicação, com o passo de verificação escrito explicitamente em cada tarefa.
- `pnpm --filter @forja/db generate` precisa rodar após qualquer alteração no `schema.prisma`, senão o client TypeScript não enxerga os modelos novos.
- Commits frequentes, um por tarefa no mínimo, em português, no formato dos commits existentes (`Radar: ...`, `Ingestao: ...`).

## File Structure

**`packages/db`**
- `prisma/schema.prisma` — MODIFICAR: modelos `Candidate`, `HarvestSource`; alterar `Offer`, `IngestionRun`
- `prisma/seed-sources.ts` — CRIAR: popula as fontes iniciais

**`packages/types`**
- `src/index.ts` — MODIFICAR: `CandidateDTO`, `HarvestSourceDTO`, ajustes em `OfferDTO` e `IngestionRunDTO`

**`apps/worker`**
- `vitest.config.ts` — CRIAR
- `src/lib/dedupeKey.ts` — CRIAR: normalização de URL e chave por tipo de fonte
- `src/lib/aggregate.ts` — CRIAR: agrupa hits crus em candidatos
- `src/lib/prefilter.ts` — CRIAR: pré-filtro barato
- `src/lib/filters.ts` — MANTER: `isBlockedCategory`, `looksLikeSalesPage`, `computeTraffic` seguem em uso
- `src/lib/resolveSalesPage.ts` — CRIAR: cascata checkout → página de vendas
- `src/adapters/urlscan.ts` — MODIFICAR: paginação por cursor, hits crus com `referer`
- `src/jobs/harvest.ts` — CRIAR
- `src/jobs/enrich.ts` — CRIAR
- `src/jobs/ingestOffers.ts` — REMOVER (substituído pelos dois acima)
- `src/queues.ts` — MODIFICAR: filas `harvest` e `enrich`
- `src/index.ts` — MODIFICAR: registra os dois workers, remove o agendamento
- `scripts/recon-sources.ts` — CRIAR: reconhecimento de queries candidatas

**`apps/api/src/radar`**
- `radar.dto.ts` — MODIFICAR
- `radar.service.ts` — MODIFICAR: ofertas por `stage`, trends, runs, disparo da colheita
- `candidates.service.ts` — CRIAR: listagem, triagem individual e em lote, desfazer, restaurar
- `radar.controller.ts` — MODIFICAR: rotas novas
- `radar.module.ts` — MODIFICAR: registra `CandidatesService`
- `../queue/queue.service.ts` — MODIFICAR: filas `harvest` e `enrich`

**`apps/web`**
- `app/radar/page.tsx` — REESCREVER: triagem + descartados + análise + trends
- `components/radar/TriageTable.tsx` — CRIAR
- `components/radar/AnalysisCards.tsx` — CRIAR
- `app/esteira/page.tsx` — CRIAR
- `components/layout/TopNav.tsx` — MODIFICAR: item "Esteira"

---

### Task 1: Vitest no worker + chave de dedupe

Fundação de teste do projeto e a primeira peça pura: a chave que garante "nunca repete" e que impede mil checkouts de colapsarem num candidato.

**Files:**
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/src/lib/dedupeKey.ts`
- Test: `apps/worker/src/lib/dedupeKey.test.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type HarvestKind = 'resource' | 'checkout'`
  - `normalizeUrl(url: string): string`
  - `buildDedupeKey(kind: HarvestKind, hit: { pageUrl: string; pageDomain: string }): string`

- [ ] **Step 1: Instalar o vitest**

```bash
cd /Users/guilhermeaugusto/forja-os
pnpm --filter @forja/worker add -D vitest@^2.1.0
```

- [ ] **Step 2: Criar a config do vitest**

Criar `apps/worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Adicionar o script de teste**

Em `apps/worker/package.json`, dentro de `"scripts"`, acrescentar:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Escrever o teste que falha**

Criar `apps/worker/src/lib/dedupeKey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeUrl, buildDedupeKey } from './dedupeKey';

describe('normalizeUrl', () => {
  it('remove query, hash e barra final, e baixa o host', () => {
    expect(normalizeUrl('https://Pay.Cakto.com.br/abc123/?utm_source=fb#top')).toBe(
      'https://pay.cakto.com.br/abc123',
    );
  });

  it('preserva a raiz como barra única', () => {
    expect(normalizeUrl('https://metodoxyz.com.br/')).toBe('https://metodoxyz.com.br/');
  });

  it('devolve a entrada quando a URL é inválida', () => {
    expect(normalizeUrl('nao-e-url')).toBe('nao-e-url');
  });
});

describe('buildDedupeKey', () => {
  it('fonte de recurso chaveia pelo domínio da página', () => {
    const key = buildDedupeKey('resource', {
      pageUrl: 'https://metodoxyz.com.br/vsl?utm=1',
      pageDomain: 'metodoxyz.com.br',
    });
    expect(key).toBe('metodoxyz.com.br');
  });

  it('fonte de checkout chaveia pela URL normalizada, não pelo domínio', () => {
    const a = buildDedupeKey('checkout', {
      pageUrl: 'https://pay.cakto.com.br/produto-a?src=ig',
      pageDomain: 'pay.cakto.com.br',
    });
    const b = buildDedupeKey('checkout', {
      pageUrl: 'https://pay.cakto.com.br/produto-b',
      pageDomain: 'pay.cakto.com.br',
    });
    expect(a).toBe('https://pay.cakto.com.br/produto-a');
    expect(a).not.toBe(b);
  });

  it('normaliza o domínio para minúsculas na fonte de recurso', () => {
    expect(
      buildDedupeKey('resource', { pageUrl: 'https://X.com/a', pageDomain: 'MetodoXYZ.com.br' }),
    ).toBe('metodoxyz.com.br');
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @forja/worker test`
Expected: FAIL — `Failed to resolve import "./dedupeKey"`

- [ ] **Step 6: Implementar**

Criar `apps/worker/src/lib/dedupeKey.ts`:

```ts
// Chave de deduplicação do pool de candidatos.
//
// O tipo da fonte inverte o que identifica uma oferta. Numa fonte de RECURSO
// (utmify, ConverteAI, Panda) o urlscan registra a página de vendas como
// page.domain — um domínio é um anunciante. Numa fonte de CHECKOUT a página
// escaneada é o próprio gateway, igual para milhares de ofertas: ali quem
// identifica é a URL.

export type HarvestKind = 'resource' | 'checkout';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString();
    return s.length > 1 && s.endsWith('/') && u.pathname !== '/' ? s.slice(0, -1) : s;
  } catch {
    return url;
  }
}

export function buildDedupeKey(
  kind: HarvestKind,
  hit: { pageUrl: string; pageDomain: string },
): string {
  return kind === 'checkout' ? normalizeUrl(hit.pageUrl) : hit.pageDomain.toLowerCase();
}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — 6 testes

- [ ] **Step 8: Commit**

```bash
git add apps/worker/vitest.config.ts apps/worker/package.json apps/worker/src/lib/dedupeKey.ts apps/worker/src/lib/dedupeKey.test.ts pnpm-lock.yaml
git commit -m "Radar: vitest no worker + chave de dedupe por tipo de fonte"
```

---

### Task 2: Schema — Candidate, HarvestSource e a nova Offer

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/seed-sources.ts`
- Modify: `packages/db/package.json`

**Interfaces:**
- Consumes: nada
- Produces: modelos Prisma `Candidate`, `HarvestSource`; enums `CandidateStatus`, `HarvestKind`, `OfferStage`, `EnrichmentState`; campos novos em `Offer` (`candidateId`, `stage`, `enrichment`, `enrichmentError`, `alerts`) e em `IngestionRun` (`sourceId`, `rawHits`, `newCandidates`, `autoDiscarded`, `queuedForTriage`)

- [ ] **Step 1: Adicionar os modelos novos**

Em `packages/db/prisma/schema.prisma`, logo após o bloco de comentário `RADAR — motor de mineração de ofertas e tendências`, inserir:

```prisma
enum HarvestKind {
  resource // o domínio escaneado é a página de vendas (utmify, ConverteAI, Panda)
  checkout // a página escaneada é o gateway; quem identifica a oferta é a URL
}

// Fonte de mineração: uma query urlscan com cursor próprio, para que cada rodada
// continue de onde a anterior parou em vez de re-varrer o topo dos 10.000.
model HarvestSource {
  id          String        @id @default(cuid())
  name        String
  query       String        @unique
  kind        HarvestKind
  enabled     Boolean       @default(true)
  cursor      String? // search_after do urlscan
  minHitCount Int           @default(1) // limiar do pré-filtro de circulação
  maxAgeDays  Int           @default(90) // idem
  lastRunAt   DateTime?
  candidates  Candidate[]
  runs        IngestionRun[]
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
}

enum CandidateStatus {
  pending
  discarded_auto
  discarded_manual
  promoted
}

// Pool acumulativo de candidatos crus. Barato: só o que a varredura do urlscan
// já devolveu. Cresce para dezenas de milhares de linhas e nunca é reapresentado
// depois de triado — garantia dada pelo unique de dedupeKey, não por lógica.
model Candidate {
  id            String          @id @default(cuid())
  sourceId      String
  source        HarvestSource   @relation(fields: [sourceId], references: [id])
  dedupeKey     String          @unique
  url           String
  domain        String
  title         String?
  screenshotUrl String?
  referer       String? // pista para resolver a página de vendas de um checkout
  productName   String? // fontes de checkout
  priceCents    Int? // fontes de checkout
  gateway       String? // fontes de checkout
  hitCount      Int             @default(1) // proxy de circulação, sai de graça da varredura
  firstSeenAt   DateTime?
  lastSeenAt    DateTime?
  daysRunning   Int             @default(0)
  status        CandidateStatus @default(pending)
  discardReason String?
  triagedAt     DateTime?
  firstRunId    String
  offer         Offer?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([status, hitCount])
  @@index([sourceId, status])
}

enum OfferStage {
  analysis // fila de análise: dossiê pronto, promove ou descarta
  pipeline // esteira de modelagem
  discarded
}

enum EnrichmentState {
  pending
  running
  done
  failed
}
```

- [ ] **Step 2: Alterar o modelo `Offer`**

No modelo `Offer`, **remover** a linha `saved Boolean @default(false)` e acrescentar, antes de `createdAt`:

```prisma
  candidateId     String?         @unique
  candidate       Candidate?      @relation(fields: [candidateId], references: [id])
  stage           OfferStage      @default(analysis)
  enrichment      EnrichmentState @default(pending)
  enrichmentError String?
  alerts          Json? // ['produto-fisico','nao-e-pagina-de-vendas','sem-trafego','sem-conteudo','pagina-de-vendas-nao-localizada']
```

E acrescentar o índice, junto dos existentes:

```prisma
  @@index([stage])
```

- [ ] **Step 3: Alterar o modelo `IngestionRun`**

Substituir o modelo `IngestionRun` inteiro por:

```prisma
// Registro de cada rodada de colheita (feedback do botão "Colher").
model IngestionRun {
  id              String         @id @default(cuid())
  query           String
  sourceId        String?
  source          HarvestSource? @relation(fields: [sourceId], references: [id])
  status          String         @default("running") // running | done | partial | error
  stage           String? // atividade atual, exibida no loader
  rawHits         Int            @default(0) // resultados brutos varridos
  newCandidates   Int            @default(0) // chaves inéditas
  autoDiscarded   Int            @default(0) // mortos pelo pré-filtro
  queuedForTriage Int            @default(0) // chegaram à sua fila
  events          Json? // feed de decisões recentes [{key, ok, reason}]
  error           String?
  startedAt       DateTime       @default(now())
  finishedAt      DateTime?
}
```

- [ ] **Step 4: Criar o seed das fontes**

Criar `packages/db/prisma/seed-sources.ts`:

```ts
// Fontes iniciais de mineração. A lista definitiva sai do reconhecimento
// (apps/worker/scripts/recon-sources.ts) — estas são o ponto de partida.
import { prisma } from '../src/index';

const SOURCES = [
  { name: 'Utmify (rastreador)', query: 'domain:cdn.utmify.com.br', kind: 'resource' as const },
  { name: 'ConverteAI (player VSL)', query: 'domain:cdn.converteai.net', kind: 'resource' as const },
  { name: 'Panda Video', query: 'domain:cdn.pandavideo.com.br', kind: 'resource' as const },
  { name: 'Klickpages', query: 'domain:klickpages.com.br', kind: 'resource' as const },
  { name: 'Cakto (checkout)', query: 'page.domain:pay.cakto.com.br', kind: 'checkout' as const },
  { name: 'Kirvano (checkout)', query: 'page.domain:pay.kirvano.com', kind: 'checkout' as const },
  { name: 'Ticto (checkout)', query: 'page.domain:pay.ticto.com.br', kind: 'checkout' as const },
];

async function main() {
  for (const s of SOURCES) {
    await prisma.harvestSource.upsert({
      where: { query: s.query },
      update: { name: s.name, kind: s.kind },
      create: s,
    });
    console.log(`✓ ${s.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Em `packages/db/package.json`, dentro de `"scripts"`, acrescentar:

```json
    "seed:sources": "dotenv -e ../../.env -- tsx prisma/seed-sources.ts",
```

- [ ] **Step 5: Aplicar a migração e gerar o client**

```bash
cd /Users/guilhermeaugusto/forja-os
docker compose up -d
pnpm --filter @forja/db exec prisma migrate dev --name radar-triagem
pnpm --filter @forja/db generate
```

Expected: migração criada em `packages/db/prisma/migrations/`, e `✔ Generated Prisma Client`.

Se a migração reclamar de perda de dados por causa da remoção de `Offer.saved`, aceitar — as ofertas atuais foram mineradas pelo fluxo antigo e serão re-colhidas.

- [ ] **Step 6: Popular as fontes**

```bash
pnpm --filter @forja/db seed:sources
```

Expected: sete linhas `✓ ...`.

- [ ] **Step 7: Verificar que o client enxerga os modelos novos**

```bash
pnpm --filter @forja/db exec prisma studio
```

Expected: `Candidate`, `HarvestSource` aparecem na lista de modelos; `HarvestSource` tem 7 linhas. Fechar o studio com Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma packages/db/package.json
git commit -m "Radar: schema de Candidate, HarvestSource e Offer por stage"
```

---

### Task 3: Agregação dos hits (o dado de circulação de graça)

Hoje `searchOffers` deduplica por domínio e **joga fora** os hits repetidos — que são exatamente o sinal de circulação, recomprado depois com uma chamada por domínio. Esta tarefa agrega em vez de descartar.

**Files:**
- Create: `apps/worker/src/lib/aggregate.ts`
- Test: `apps/worker/src/lib/aggregate.test.ts`

**Interfaces:**
- Consumes: `buildDedupeKey`, `HarvestKind` de `./dedupeKey` (Task 1)
- Produces:
  - `interface RawHit { uuid: string; pageUrl: string; pageDomain: string; title: string | null; time: string | null; referer: string | null }`
  - `interface AggregatedCandidate { dedupeKey: string; url: string; domain: string; title: string | null; screenshotUrl: string | null; referer: string | null; hitCount: number; firstSeenAt: string | null; lastSeenAt: string | null; daysRunning: number }`
  - `aggregateHits(hits: RawHit[], kind: HarvestKind, now?: Date): AggregatedCandidate[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/worker/src/lib/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateHits, type RawHit } from './aggregate';

const hit = (over: Partial<RawHit>): RawHit => ({
  uuid: 'u1',
  pageUrl: 'https://metodoxyz.com.br/vsl',
  pageDomain: 'metodoxyz.com.br',
  title: 'Método X',
  time: '2026-07-01T10:00:00Z',
  referer: null,
  ...over,
});

describe('aggregateHits — fonte de recurso', () => {
  it('agrupa hits do mesmo domínio e conta a circulação', () => {
    const out = aggregateHits(
      [
        hit({ uuid: 'a', time: '2026-07-01T10:00:00Z' }),
        hit({ uuid: 'b', time: '2026-07-10T10:00:00Z', pageUrl: 'https://metodoxyz.com.br/lp' }),
        hit({ uuid: 'c', time: '2026-06-01T10:00:00Z' }),
      ],
      'resource',
    );
    expect(out).toHaveLength(1);
    expect(out[0].hitCount).toBe(3);
    expect(out[0].firstSeenAt).toBe('2026-06-01T10:00:00.000Z');
    expect(out[0].lastSeenAt).toBe('2026-07-10T10:00:00.000Z');
  });

  it('deriva daysRunning da distância entre o primeiro e o último hit', () => {
    const out = aggregateHits(
      [
        hit({ time: '2026-06-01T00:00:00Z' }),
        hit({ uuid: 'b', time: '2026-07-01T00:00:00Z' }),
      ],
      'resource',
    );
    expect(out[0].daysRunning).toBe(30);
  });

  it('separa domínios diferentes', () => {
    const out = aggregateHits(
      [hit({}), hit({ uuid: 'b', pageDomain: 'outro.com', pageUrl: 'https://outro.com/x' })],
      'resource',
    );
    expect(out).toHaveLength(2);
  });

  it('monta a URL do screenshot a partir do uuid do primeiro hit', () => {
    const out = aggregateHits([hit({ uuid: 'abc' })], 'resource');
    expect(out[0].screenshotUrl).toBe('https://urlscan.io/screenshots/abc.png');
  });

  it('guarda o primeiro referer não nulo encontrado', () => {
    const out = aggregateHits(
      [hit({}), hit({ uuid: 'b', referer: 'https://origem.com/lp' })],
      'resource',
    );
    expect(out[0].referer).toBe('https://origem.com/lp');
  });

  it('ordena por circulação decrescente', () => {
    const out = aggregateHits(
      [
        hit({ pageDomain: 'pouco.com', pageUrl: 'https://pouco.com/a' }),
        hit({ uuid: 'b', pageDomain: 'muito.com', pageUrl: 'https://muito.com/a' }),
        hit({ uuid: 'c', pageDomain: 'muito.com', pageUrl: 'https://muito.com/b' }),
      ],
      'resource',
    );
    expect(out[0].domain).toBe('muito.com');
  });
});

describe('aggregateHits — fonte de checkout', () => {
  it('não colapsa produtos diferentes do mesmo gateway', () => {
    const out = aggregateHits(
      [
        hit({ pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-a' }),
        hit({ uuid: 'b', pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-b' }),
        hit({ uuid: 'c', pageDomain: 'pay.cakto.com.br', pageUrl: 'https://pay.cakto.com.br/produto-a?utm=1' }),
      ],
      'checkout',
    );
    expect(out).toHaveLength(2);
    const a = out.find((c) => c.dedupeKey.endsWith('produto-a'))!;
    expect(a.hitCount).toBe(2);
  });
});

describe('aggregateHits — bordas', () => {
  it('tolera hits sem data', () => {
    const out = aggregateHits([hit({ time: null })], 'resource');
    expect(out[0].firstSeenAt).toBeNull();
    expect(out[0].daysRunning).toBe(0);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(aggregateHits([], 'resource')).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @forja/worker test`
Expected: FAIL — `Failed to resolve import "./aggregate"`

- [ ] **Step 3: Implementar**

Criar `apps/worker/src/lib/aggregate.ts`:

```ts
// Agregação dos hits crus do urlscan em candidatos.
//
// O ponto: hits repetidos da mesma chave NÃO são lixo — são o sinal de
// circulação. Contá-los aqui entrega hitCount/firstSeen/lastSeen de graça,
// na mesma varredura, em vez de recomprar o dado com uma chamada por domínio
// (getDomainActivity), que em milhares de domínios estoura o rate limit.

import { buildDedupeKey, type HarvestKind } from './dedupeKey';

export interface RawHit {
  uuid: string;
  pageUrl: string;
  pageDomain: string;
  title: string | null;
  time: string | null;
  referer: string | null;
}

export interface AggregatedCandidate {
  dedupeKey: string;
  url: string;
  domain: string;
  title: string | null;
  screenshotUrl: string | null;
  referer: string | null;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysRunning: number;
}

const DAY_MS = 86_400_000;

export function aggregateHits(hits: RawHit[], kind: HarvestKind): AggregatedCandidate[] {
  const byKey = new Map<string, AggregatedCandidate>();

  for (const h of hits) {
    if (!h.pageUrl || !h.pageDomain) continue;
    const dedupeKey = buildDedupeKey(kind, h);
    const time = h.time ? new Date(h.time) : null;
    const stamp = time && !Number.isNaN(time.getTime()) ? time.toISOString() : null;

    const found = byKey.get(dedupeKey);
    if (!found) {
      byKey.set(dedupeKey, {
        dedupeKey,
        url: h.pageUrl,
        domain: h.pageDomain.toLowerCase(),
        title: h.title,
        screenshotUrl: h.uuid ? `https://urlscan.io/screenshots/${h.uuid}.png` : null,
        referer: h.referer,
        hitCount: 1,
        firstSeenAt: stamp,
        lastSeenAt: stamp,
        daysRunning: 0,
      });
      continue;
    }

    found.hitCount++;
    if (!found.title && h.title) found.title = h.title;
    if (!found.referer && h.referer) found.referer = h.referer;
    if (stamp) {
      if (!found.firstSeenAt || stamp < found.firstSeenAt) found.firstSeenAt = stamp;
      if (!found.lastSeenAt || stamp > found.lastSeenAt) found.lastSeenAt = stamp;
    }
  }

  const out = Array.from(byKey.values());
  for (const c of out) {
    c.daysRunning =
      c.firstSeenAt && c.lastSeenAt
        ? Math.max(0, Math.round((Date.parse(c.lastSeenAt) - Date.parse(c.firstSeenAt)) / DAY_MS))
        : 0;
  }
  return out.sort((a, b) => b.hitCount - a.hitCount);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — todos os testes de `aggregate.test.ts` e `dedupeKey.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/aggregate.ts apps/worker/src/lib/aggregate.test.ts
git commit -m "Radar: agregacao dos hits do urlscan (circulacao sai de graca da varredura)"
```

---

### Task 4: Pré-filtro barato

**Files:**
- Create: `apps/worker/src/lib/prefilter.ts`
- Test: `apps/worker/src/lib/prefilter.test.ts`

**Interfaces:**
- Consumes: `isBlockedCategory` de `./filters` (já existe), `AggregatedCandidate` de `./aggregate` (Task 3)
- Produces:
  - `type PrefilterReason = 'delivery-comida' | 'sem-circulacao'`
  - `interface PrefilterRules { minHitCount: number; maxAgeDays: number }`
  - `prefilter(c: AggregatedCandidate, rules: PrefilterRules, now?: Date): { ok: true } | { ok: false; reason: PrefilterReason }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/worker/src/lib/prefilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prefilter } from './prefilter';
import type { AggregatedCandidate } from './aggregate';

const NOW = new Date('2026-07-24T00:00:00Z');
const RULES = { minHitCount: 1, maxAgeDays: 90 };

const cand = (over: Partial<AggregatedCandidate> = {}): AggregatedCandidate => ({
  dedupeKey: 'metodoxyz.com.br',
  url: 'https://metodoxyz.com.br/vsl',
  domain: 'metodoxyz.com.br',
  title: 'Método X — Emagreça em 21 dias',
  screenshotUrl: null,
  referer: null,
  hitCount: 3,
  firstSeenAt: '2026-06-01T00:00:00Z',
  lastSeenAt: '2026-07-20T00:00:00Z',
  daysRunning: 49,
  ...over,
});

describe('prefilter', () => {
  it('aprova um candidato normal', () => {
    expect(prefilter(cand(), RULES, NOW)).toEqual({ ok: true });
  });

  it('descarta pela blocklist de categoria no título', () => {
    const r = prefilter(cand({ title: 'Pizzaria do Zé — peça pelo delivery' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'delivery-comida' });
  });

  it('descarta pela blocklist de categoria no domínio', () => {
    const r = prefilter(cand({ domain: 'hamburgueriacentral.com.br' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'delivery-comida' });
  });

  it('descarta quando a circulação fica abaixo do limiar da fonte', () => {
    const r = prefilter(cand({ hitCount: 1 }), { minHitCount: 2, maxAgeDays: 90 }, NOW);
    expect(r).toEqual({ ok: false, reason: 'sem-circulacao' });
  });

  it('descarta quando o último hit é mais velho que a janela da fonte', () => {
    const r = prefilter(cand({ lastSeenAt: '2026-01-01T00:00:00Z' }), RULES, NOW);
    expect(r).toEqual({ ok: false, reason: 'sem-circulacao' });
  });

  it('aprova quando não há data — não inventa motivo de descarte', () => {
    expect(prefilter(cand({ lastSeenAt: null }), RULES, NOW)).toEqual({ ok: true });
  });

  it('com os limiares padrão, um candidato recente de hit único passa', () => {
    const r = prefilter(cand({ hitCount: 1, lastSeenAt: '2026-07-23T00:00:00Z' }), RULES, NOW);
    expect(r).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @forja/worker test`
Expected: FAIL — `Failed to resolve import "./prefilter"`

- [ ] **Step 3: Implementar**

Criar `apps/worker/src/lib/prefilter.ts`:

```ts
// Pré-filtro da colheita: só descarta com o que a varredura já devolveu.
//
// Nada aqui pode fazer requisição HTTP. Verificar se o domínio está no ar
// custaria uma requisição por candidato, o que em milhares de itens deixa de
// ser custo zero — página fora do ar é problema do enriquecimento, onde o
// download já acontece.
//
// Todo descarte grava o motivo e aparece na aba "descartados pela máquina",
// para que o filtro não vire caixa-preta.

import { isBlockedCategory } from './filters';
import type { AggregatedCandidate } from './aggregate';

export type PrefilterReason = 'delivery-comida' | 'sem-circulacao';

export interface PrefilterRules {
  minHitCount: number;
  maxAgeDays: number;
}

const DAY_MS = 86_400_000;

export function prefilter(
  c: AggregatedCandidate,
  rules: PrefilterRules,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: PrefilterReason } {
  if (isBlockedCategory(c.domain, c.title)) return { ok: false, reason: 'delivery-comida' };

  if (c.hitCount < rules.minHitCount) return { ok: false, reason: 'sem-circulacao' };

  if (c.lastSeenAt) {
    const ageDays = (now.getTime() - Date.parse(c.lastSeenAt)) / DAY_MS;
    if (ageDays > rules.maxAgeDays) return { ok: false, reason: 'sem-circulacao' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — 7 testes novos

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/prefilter.ts apps/worker/src/lib/prefilter.test.ts
git commit -m "Radar: pre-filtro barato com limiares por fonte"
```

---

### Task 5: Adapter urlscan — paginação por cursor e hits crus

**Files:**
- Modify: `apps/worker/src/adapters/urlscan.ts`
- Test: `apps/worker/src/adapters/urlscan.test.ts`

**Interfaces:**
- Consumes: `RawHit` de `../lib/aggregate` (Task 3)
- Produces:
  - `parseSearchResponse(json: unknown): { hits: RawHit[]; nextCursor: string | null; pageSize: number }`
  - `searchPage(opts: { query: string; cursor: string | null; size?: number }): Promise<{ hits: RawHit[]; nextCursor: string | null; pageSize: number }>`
  - `getDomainActivity(domain: string): Promise<DomainActivity>` — mantida sem alteração

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/worker/src/adapters/urlscan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseSearchResponse } from './urlscan';

const payload = {
  results: [
    {
      _id: 'aaa',
      sort: [1719000000000, 'aaa'],
      page: { url: 'https://metodoxyz.com.br/vsl', domain: 'metodoxyz.com.br', title: 'Método X' },
      task: { url: 'https://metodoxyz.com.br/vsl', time: '2026-07-01T10:00:00Z', referer: 'https://ig.com' },
    },
    {
      _id: 'bbb',
      sort: [1718000000000, 'bbb'],
      page: { url: 'https://outro.com/lp', domain: 'outro.com' },
      task: { time: '2026-06-20T10:00:00Z' },
    },
  ],
};

describe('parseSearchResponse', () => {
  it('converte resultados em RawHit preservando o referer', () => {
    const { hits } = parseSearchResponse(payload);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      uuid: 'aaa',
      pageUrl: 'https://metodoxyz.com.br/vsl',
      pageDomain: 'metodoxyz.com.br',
      title: 'Método X',
      time: '2026-07-01T10:00:00Z',
      referer: 'https://ig.com',
    });
  });

  it('usa o domínio como título quando a página não tem um', () => {
    const { hits } = parseSearchResponse(payload);
    expect(hits[1].title).toBe('outro.com');
  });

  it('extrai o cursor do sort do último resultado', () => {
    const { nextCursor } = parseSearchResponse(payload);
    expect(nextCursor).toBe('1718000000000,bbb');
  });

  it('devolve cursor nulo quando não há sort', () => {
    const { nextCursor } = parseSearchResponse({ results: [{ _id: 'x', page: { url: 'https://a.com', domain: 'a.com' } }] });
    expect(nextCursor).toBeNull();
  });

  it('ignora resultados sem url ou sem domínio', () => {
    const { hits } = parseSearchResponse({ results: [{ _id: 'x', page: {} }, { _id: 'y', page: { url: 'https://a.com' } }] });
    expect(hits).toHaveLength(0);
  });

  it('devolve vazio para payload sem results', () => {
    expect(parseSearchResponse({})).toEqual({ hits: [], nextCursor: null, pageSize: 0 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @forja/worker test`
Expected: FAIL — `parseSearchResponse is not a function`

- [ ] **Step 3: Reescrever a parte de busca do adapter**

Em `apps/worker/src/adapters/urlscan.ts`, **substituir** o bloco que vai do comentário `export interface UrlscanHit` até o fim de `searchOffers` (linhas 6–88) por:

```ts
import type { RawHit } from '../lib/aggregate';

interface RawResult {
  _id?: string;
  sort?: unknown[];
  page?: { url?: string; domain?: string; title?: string };
  task?: { url?: string; time?: string; referer?: string };
}

export interface SearchPage {
  hits: RawHit[];
  nextCursor: string | null;
  pageSize: number;
}

function apiKey(): string {
  return process.env.URLSCAN_API_KEY ?? '';
}

/**
 * Converte a resposta da Search API em hits crus. Separado da requisição para
 * ser testável sem rede — o parsing é onde mora o risco, não o fetch.
 *
 * Nada é deduplicado aqui: hits repetidos da mesma página são o sinal de
 * circulação e quem agrega é `aggregateHits`.
 */
export function parseSearchResponse(json: unknown): SearchPage {
  const results = (json as { results?: RawResult[] })?.results ?? [];
  const hits: RawHit[] = [];

  for (const r of results) {
    const pageUrl = r.page?.url ?? r.task?.url;
    const pageDomain = r.page?.domain;
    if (!pageUrl || !pageDomain) continue;
    hits.push({
      uuid: r._id ?? '',
      pageUrl,
      pageDomain,
      title: r.page?.title ?? pageDomain,
      time: r.task?.time ?? null,
      referer: r.task?.referer ?? null,
    });
  }

  const last = results[results.length - 1];
  const nextCursor = last?.sort?.length ? last.sort.join(',') : null;
  return { hits, nextCursor, pageSize: results.length };
}

/**
 * Uma página de resultados. O cursor (`search_after`) é persistido em
 * HarvestSource, então cada rodada continua de onde a anterior parou em vez de
 * re-varrer o topo dos 10.000 resultados.
 *
 * Sem filtro de data: o cursor já dá a progressão, e um `date:>now-Nd` colidiria
 * com ele — a varredura anda para trás no tempo e o filtro cortaria justamente o
 * trecho ainda não visitado.
 */
export async function searchPage(opts: {
  query: string;
  cursor: string | null;
  size?: number;
}): Promise<SearchPage> {
  const key = apiKey();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['API-Key'] = key;

  const size = opts.size ?? 100;
  let url = `${SEARCH_URL}?q=${encodeURIComponent(opts.query)}&size=${size}`;
  if (opts.cursor) url += `&search_after=${encodeURIComponent(opts.cursor)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`urlscan search ${res.status}: ${body.slice(0, 200)}`);
  }
  return parseSearchResponse(await res.json());
}
```

Manter intactos, no fim do arquivo, `DomainActivity` e `getDomainActivity` — o enriquecimento ainda os usa.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — 6 testes novos

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/adapters/urlscan.ts apps/worker/src/adapters/urlscan.test.ts
git commit -m "Radar: urlscan com paginacao por cursor e hits crus (sem dedupe)"
```

---

### Task 6: Job de colheita

**Files:**
- Create: `apps/worker/src/jobs/harvest.ts`
- Modify: `apps/worker/src/queues.ts`
- Modify: `apps/worker/src/index.ts`
- Delete: `apps/worker/src/jobs/ingestOffers.ts`

**Interfaces:**
- Consumes: `searchPage` (Task 5), `aggregateHits` (Task 3), `prefilter` (Task 4), `buildDedupeKey`/`HarvestKind` (Task 1)
- Produces:
  - `interface HarvestJobData { runId: string; sourceId: string }`
  - `harvest(job: Job<HarvestJobData>): Promise<{ rawHits: number; newCandidates: number; autoDiscarded: number; queuedForTriage: number }>`
  - constantes de fila `HARVEST_QUEUE = 'harvest'`, `ENRICH_QUEUE = 'enrich'`

- [ ] **Step 1: Reescrever as filas**

Substituir `apps/worker/src/queues.ts` por:

```ts
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const HARVEST_QUEUE = 'harvest';
export const ENRICH_QUEUE = 'enrich';

// Filas do sistema. Tudo que toca integração externa roda aqui, nunca no request.
// harvest é barato e em massa; enrich é caro e sob demanda — separados para que
// uma colheita longa nunca segure o enriquecimento de um item recém-promovido.
export const queues = {
  harvest: new Queue(HARVEST_QUEUE, { connection }),
  enrich: new Queue(ENRICH_QUEUE, { connection }),
  syncBalances: new Queue('sync-balances', { connection }),
  pullAdMetrics: new Queue('pull-ad-metrics', { connection }),
  processWebhook: new Queue('process-webhook', { connection }),
};
```

- [ ] **Step 2: Implementar o job de colheita**

Criar `apps/worker/src/jobs/harvest.ts`:

```ts
import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { searchPage } from '../adapters/urlscan';
import { aggregateHits, type RawHit } from '../lib/aggregate';
import { prefilter } from '../lib/prefilter';
import type { HarvestKind } from '../lib/dedupeKey';

export interface HarvestJobData {
  runId: string;
  sourceId: string;
}

interface HarvestEvent {
  key: string;
  ok: boolean;
  reason?: string;
}

// Trava de segurança: até 20 páginas de 100 por rodada. O cursor persiste, então
// a rodada seguinte continua daqui — não é um teto de cobertura, é um teto de
// duração para que o botão dê retorno em tempo humano.
const MAX_PAGES = 20;
const PAGE_SIZE = 100;

export async function harvest(job: Job<HarvestJobData>) {
  const { runId, sourceId } = job.data;
  const source = await prisma.harvestSource.findUniqueOrThrow({ where: { id: sourceId } });

  let rawHits = 0;
  let newCandidates = 0;
  let autoDiscarded = 0;
  let queuedForTriage = 0;
  const events: HarvestEvent[] = [];

  const progress = (stage: string) =>
    prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        stage,
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
      },
    });

  let cursor = source.cursor;
  let partial = false;
  let partialError: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      await progress(`🔎 Varrendo ${source.name} — página ${page + 1}…`);

      let result;
      try {
        result = await searchPage({ query: source.query, cursor, size: PAGE_SIZE });
      } catch (err) {
        // Rate limit ou instabilidade: encerra a rodada com o que já tem. O cursor
        // salvo abaixo garante que nada se perde — a próxima rodada continua daqui.
        partial = true;
        partialError = (err as Error).message;
        break;
      }

      if (result.hits.length === 0 && result.pageSize === 0) break;
      rawHits += result.pageSize;

      await ingestPage(result.hits, source.kind as HarvestKind, source, runId, {
        onNew: () => newCandidates++,
        onDiscard: (key, reason) => {
          autoDiscarded++;
          events.unshift({ key, ok: false, reason });
          if (events.length > 24) events.length = 24;
        },
        onQueue: (key) => {
          queuedForTriage++;
          events.unshift({ key, ok: true });
          if (events.length > 24) events.length = 24;
        },
      });

      cursor = result.nextCursor;
      if (!cursor || result.pageSize < PAGE_SIZE) break;
    }

    await prisma.harvestSource.update({
      where: { id: sourceId },
      data: { cursor, lastRunAt: new Date() },
    });

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: partial ? 'partial' : 'done',
        stage: partial
          ? `Parcial — ${queuedForTriage} na fila (${partialError})`
          : `Concluído — ${queuedForTriage} na fila, ${autoDiscarded} filtrados`,
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        events: events.slice(0, 24) as unknown as Prisma.InputJsonValue,
        error: partialError,
        finishedAt: new Date(),
      },
    });

    return { rawHits, newCandidates, autoDiscarded, queuedForTriage };
  } catch (err) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: 'error',
        stage: 'Falha na colheita',
        rawHits,
        newCandidates,
        autoDiscarded,
        queuedForTriage,
        error: (err as Error).message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

// Grava os candidatos de uma página. `skipDuplicates` no createMany é o que faz
// o "nunca repete" ser garantia do banco: uma chave já triada simplesmente não
// volta, sem precisar consultar o pool inteiro antes.
async function ingestPage(
  hits: RawHit[],
  kind: HarvestKind,
  source: { id: string; minHitCount: number; maxAgeDays: number },
  runId: string,
  cb: {
    onNew: () => void;
    onDiscard: (key: string, reason: string) => void;
    onQueue: (key: string) => void;
  },
) {
  const candidates = aggregateHits(hits, kind);
  if (candidates.length === 0) return;

  const keys = candidates.map((c) => c.dedupeKey);
  const existing = await prisma.candidate.findMany({
    where: { dedupeKey: { in: keys } },
    select: { dedupeKey: true },
  });
  const known = new Set(existing.map((e) => e.dedupeKey));

  const rows: Prisma.CandidateCreateManyInput[] = [];

  for (const c of candidates) {
    if (known.has(c.dedupeKey)) continue;
    cb.onNew();

    const verdict = prefilter(c, {
      minHitCount: source.minHitCount,
      maxAgeDays: source.maxAgeDays,
    });

    if (verdict.ok) cb.onQueue(c.dedupeKey);
    else cb.onDiscard(c.dedupeKey, verdict.reason);

    rows.push({
      sourceId: source.id,
      dedupeKey: c.dedupeKey,
      url: c.url,
      domain: c.domain,
      title: c.title,
      screenshotUrl: c.screenshotUrl,
      referer: c.referer,
      hitCount: c.hitCount,
      firstSeenAt: c.firstSeenAt ? new Date(c.firstSeenAt) : null,
      lastSeenAt: c.lastSeenAt ? new Date(c.lastSeenAt) : null,
      daysRunning: c.daysRunning,
      status: verdict.ok ? 'pending' : 'discarded_auto',
      discardReason: verdict.ok ? null : verdict.reason,
      firstRunId: runId,
    });
  }

  if (rows.length > 0) {
    await prisma.candidate.createMany({ data: rows, skipDuplicates: true });
  }
}
```

- [ ] **Step 3: Registrar o worker e remover o agendamento**

Substituir `apps/worker/src/index.ts` por:

```ts
import { Worker } from 'bullmq';
import { connection, HARVEST_QUEUE, ENRICH_QUEUE } from './queues';
import { harvest } from './jobs/harvest';
import { enrich } from './jobs/enrich';

console.log('⚙️  Forja Worker iniciado. Aguardando jobs...');

// Colheita: urlscan → agregação → pré-filtro → Candidate. Barata e em massa.
// Serial de propósito, para não competir por rate limit do urlscan consigo mesma.
new Worker(HARVEST_QUEUE, harvest, { connection, concurrency: 1 });

// Enriquecimento: download + raio-x IA + tráfego + trend + score. Caro e sob
// demanda, com paralelismo modesto para não estourar o rate limit da IA.
new Worker(ENRICH_QUEUE, enrich, { connection, concurrency: 3 });

// Sem agendamento periódico: a colheita é disparada exclusivamente por ação
// humana, no botão do Radar.

process.on('SIGTERM', async () => {
  await connection.quit();
  process.exit(0);
});
```

- [ ] **Step 4: Remover o job antigo**

```bash
git rm apps/worker/src/jobs/ingestOffers.ts
```

- [ ] **Step 5: Verificar a compilação**

Run: `pnpm --filter @forja/worker exec tsc --noEmit`
Expected: erro apenas em `./jobs/enrich` (ainda não existe), nada mais. Esse erro some na Task 8.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/jobs/harvest.ts apps/worker/src/queues.ts apps/worker/src/index.ts
git commit -m "Ingestao: job de colheita barata (sem fetch, sem IA) e fim do agendamento automatico"
```

---

### Task 7: Cascata de resolução da página de vendas

**Files:**
- Create: `apps/worker/src/lib/resolveSalesPage.ts`
- Test: `apps/worker/src/lib/resolveSalesPage.test.ts`

**Interfaces:**
- Consumes: nada do plano; usa `cheerio` (já é dependência do worker)
- Produces:
  - `extractBackLink(html: string, checkoutDomain: string): string | null`
  - `interface ResolveDeps { referer: string | null; fetchHtml: (url: string) => Promise<string | null>; findInPool: (productName: string) => Promise<string | null> }`
  - `resolveSalesPage(checkoutUrl: string, productName: string | null, deps: ResolveDeps): Promise<{ url: string; via: 'referer' | 'backlink' | 'pool' } | null>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/worker/src/lib/resolveSalesPage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { extractBackLink, resolveSalesPage } from './resolveSalesPage';

describe('extractBackLink', () => {
  it('prefere og:url quando aponta para fora do gateway', () => {
    const html = `<html><head><meta property="og:url" content="https://metodoxyz.com.br/vsl"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br/vsl');
  });

  it('ignora og:url que aponta para o próprio gateway', () => {
    const html = `<html><head><meta property="og:url" content="https://pay.cakto.com.br/abc"></head></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBeNull();
  });

  it('cai para o primeiro link externo quando não há og:url', () => {
    const html = `<html><body>
      <a href="https://pay.cakto.com.br/termos">Termos</a>
      <a href="https://metodoxyz.com.br">Voltar ao site</a>
    </body></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br');
  });

  it('ignora links de plataforma e redes sociais', () => {
    const html = `<html><body>
      <a href="https://www.instagram.com/loja">Instagram</a>
      <a href="https://cakto.com.br">Cakto</a>
      <a href="https://metodoxyz.com.br">Site</a>
    </body></html>`;
    expect(extractBackLink(html, 'pay.cakto.com.br')).toBe('https://metodoxyz.com.br');
  });

  it('devolve null quando não há candidato', () => {
    expect(extractBackLink('<html><body>nada</body></html>', 'pay.cakto.com.br')).toBeNull();
  });
});

describe('resolveSalesPage', () => {
  const noop = {
    fetchHtml: async () => null,
    findInPool: async () => null,
  };

  it('degrau 1 — usa o referer e não gasta requisição', async () => {
    const fetchHtml = vi.fn(async () => null);
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      ...noop,
      referer: 'https://metodoxyz.com.br/vsl',
      fetchHtml,
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br/vsl', via: 'referer' });
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('ignora referer que aponta para o próprio gateway', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      ...noop,
      referer: 'https://pay.cakto.com.br/outro',
    });
    expect(r).toBeNull();
  });

  it('degrau 2 — extrai o link de volta do HTML do checkout', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      ...noop,
      referer: null,
      fetchHtml: async () => `<meta property="og:url" content="https://metodoxyz.com.br/vsl">`,
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br/vsl', via: 'backlink' });
  });

  it('degrau 3 — busca no pool pelo nome do produto', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool: async (name) => (name === 'Método X' ? 'https://metodoxyz.com.br' : null),
    });
    expect(r).toEqual({ url: 'https://metodoxyz.com.br', via: 'pool' });
  });

  it('não busca no pool sem nome de produto', async () => {
    const findInPool = vi.fn(async () => 'https://x.com');
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', null, {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool,
    });
    expect(r).toBeNull();
    expect(findInPool).not.toHaveBeenCalled();
  });

  it('degrau 4 — devolve null quando toda a cascata falha', async () => {
    const r = await resolveSalesPage('https://pay.cakto.com.br/abc', 'Método X', {
      referer: null,
      fetchHtml: async () => '<html></html>',
      findInPool: async () => null,
    });
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @forja/worker test`
Expected: FAIL — `Failed to resolve import "./resolveSalesPage"`

- [ ] **Step 3: Implementar**

Criar `apps/worker/src/lib/resolveSalesPage.ts`:

```ts
// Cascata que descobre a página de vendas a partir de um checkout.
//
// Numa fonte de checkout o urlscan escaneou o gateway, não a oferta — o que
// falta é justamente a página. A cascata vai do mais barato ao mais caro e
// desiste em silêncio: falhar aqui não invalida a oferta, que segue viva com
// checkout, nome, preço e screenshot, apenas marcada com um alerta.

import * as cheerio from 'cheerio';

// Domínios que nunca são a página de vendas: as próprias plataformas e redes.
const IGNORED = [
  'cakto', 'kirvano', 'kiwify', 'hotmart', 'ticto', 'monetizze', 'eduzz', 'perfectpay',
  'stripe', 'paypal', 'mercadopago', 'instagram.', 'facebook.', 'youtube.', 'tiktok.',
  'whatsapp', 'wa.me', 't.me', 'twitter.', 'x.com', 'google.',
];

function isPlausibleSalesPage(url: string, checkoutDomain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === checkoutDomain.toLowerCase()) return false;
    return !IGNORED.some((bad) => host.includes(bad));
  } catch {
    return false;
  }
}

/** Procura no HTML do checkout um link de volta para o site do produtor. */
export function extractBackLink(html: string, checkoutDomain: string): string | null {
  const $ = cheerio.load(html);

  const og = $('meta[property="og:url"]').attr('content');
  if (og && isPlausibleSalesPage(og, checkoutDomain)) return og;

  const canonical = $('link[rel="canonical"]').attr('href');
  if (canonical && isPlausibleSalesPage(canonical, checkoutDomain)) return canonical;

  let found: string | null = null;
  $('a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href');
    if (href && href.startsWith('http') && isPlausibleSalesPage(href, checkoutDomain)) found = href;
  });
  return found;
}

export interface ResolveDeps {
  referer: string | null;
  fetchHtml: (url: string) => Promise<string | null>;
  findInPool: (productName: string) => Promise<string | null>;
}

export async function resolveSalesPage(
  checkoutUrl: string,
  productName: string | null,
  deps: ResolveDeps,
): Promise<{ url: string; via: 'referer' | 'backlink' | 'pool' } | null> {
  let checkoutDomain = '';
  try {
    checkoutDomain = new URL(checkoutUrl).hostname;
  } catch {
    return null;
  }

  // 1 — referer do scan: já veio na busca, custo zero.
  if (deps.referer && isPlausibleSalesPage(deps.referer, checkoutDomain)) {
    return { url: deps.referer, via: 'referer' };
  }

  // 2 — link de volta no HTML do próprio checkout.
  const html = await deps.fetchHtml(checkoutUrl);
  if (html) {
    const back = extractBackLink(html, checkoutDomain);
    if (back) return { url: back, via: 'backlink' };
  }

  // 3 — o pool provavelmente já colheu essa página por uma fonte de recurso.
  if (productName) {
    const fromPool = await deps.findInPool(productName);
    if (fromPool && isPlausibleSalesPage(fromPool, checkoutDomain)) {
      return { url: fromPool, via: 'pool' };
    }
  }

  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — 12 testes novos

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/lib/resolveSalesPage.ts apps/worker/src/lib/resolveSalesPage.test.ts
git commit -m "Radar: cascata que resolve a pagina de vendas a partir do checkout"
```

---

### Task 8: Job de enriquecimento

O trabalho caro que antes rodava em todos os candidatos, agora só nos promovidos. Os gates que matavam o candidato viram **alertas**.

**Files:**
- Create: `apps/worker/src/jobs/enrich.ts`

**Interfaces:**
- Consumes: `fetchAndExtract` (`../adapters/salesPage`), `extractXray` (`@forja/ai`), `getDomainActivity` (`../adapters/urlscan`), `fetchTrend` (`../adapters/trends`), `computeScore` (`../lib/score`), `looksLikeSalesPage`/`computeTraffic`/`isBlockedCategory` (`../lib/filters`), `resolveSalesPage` (Task 7)
- Produces: `interface EnrichJobData { offerId: string }`; `enrich(job: Job<EnrichJobData>): Promise<{ ok: boolean; alerts: string[] }>`

- [ ] **Step 1: Implementar o job**

Criar `apps/worker/src/jobs/enrich.ts`:

```ts
import { Job } from 'bullmq';
import { prisma, Prisma } from '@forja/db';
import { extractXray } from '@forja/ai';
import { fetchAndExtract } from '../adapters/salesPage';
import { getDomainActivity } from '../adapters/urlscan';
import { fetchTrend } from '../adapters/trends';
import { computeScore } from '../lib/score';
import { looksLikeSalesPage, computeTraffic, isBlockedCategory } from '../lib/filters';
import { resolveSalesPage } from '../lib/resolveSalesPage';

export interface EnrichJobData {
  offerId: string;
}

function parseGrowth(pct: string | null): number | null {
  if (!pct) return null;
  const n = Number(pct.replace(/[+%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * HTML cru, para a cascata de resolução da página de vendas.
 *
 * Não dá para reusar `fetchAndExtract` aqui: ela devolve o texto do body já
 * limpo, sem `<head>` e sem atributos — exatamente onde vivem og:url, canonical
 * e os href que a cascata procura.
 */
async function fetchRawHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ForjaBot/0.1; +https://forja.local) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Enriquecimento de uma oferta promovida: download + raio-x IA + tráfego + trend
 * + score. É o único lugar do sistema onde se gasta requisição de página e token
 * de LLM — por isso roda em dezenas de itens, não em milhares.
 *
 * Regra que difere do fluxo antigo: nenhum veredito aqui DESCARTA a oferta. O que
 * antes matava o candidato (não é página de vendas, produto físico, sem tráfego)
 * agora vira alerta na fila de Análise, porque a decisão já é humana e o descarte
 * automático a essa altura seria desfazer uma escolha sua.
 */
export async function enrich(job: Job<EnrichJobData>) {
  const { offerId } = job.data;
  const offer = await prisma.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: { candidate: { include: { source: true } } },
  });

  await prisma.offer.update({ where: { id: offerId }, data: { enrichment: 'running' } });
  const alerts: string[] = [];

  try {
    const candidate = offer.candidate;
    const isCheckout = candidate?.source.kind === 'checkout';
    let targetUrl = offer.pageUrl ?? candidate?.url ?? '';

    // Numa fonte de checkout, a URL colhida é o gateway — o raio-x precisa da
    // página de vendas, que a cascata tenta descobrir antes de qualquer download.
    if (isCheckout && candidate) {
      const resolved = await resolveSalesPage(candidate.url, candidate.productName, {
        referer: candidate.referer,
        fetchHtml: fetchRawHtml,
        findInPool: async (name) => {
          const hit = await prisma.candidate.findFirst({
            where: {
              title: { contains: name, mode: 'insensitive' },
              source: { kind: 'resource' },
            },
            select: { url: true },
          });
          return hit?.url ?? null;
        },
      });
      if (resolved) targetUrl = resolved.url;
      else alerts.push('pagina-de-vendas-nao-localizada');
    }

    const page = await fetchAndExtract(targetUrl);
    if (!page.ok) alerts.push('sem-conteudo');

    if (page.ok && !looksLikeSalesPage({
      hasCheckout: page.hasCheckout,
      hasPrice: page.hasPrice,
      textLen: page.text.length,
    })) {
      alerts.push('nao-e-pagina-de-vendas');
    }

    const xray = page.ok
      ? await extractXray({ pageText: page.text, url: targetUrl, title: offer.name })
      : null;

    if (xray) {
      if (!xray.isSalesPage && !alerts.includes('nao-e-pagina-de-vendas')) {
        alerts.push('nao-e-pagina-de-vendas');
      }
      if (xray.productType && xray.productType !== 'digital') {
        alerts.push(`produto-${xray.productType}`);
      }
      if (isBlockedCategory(xray.category, xray.niche)) alerts.push('categoria-bloqueada');
    }

    const domain = candidate?.domain ?? offer.advertiser;
    const activity = await getDomainActivity(domain);
    const traffic = computeTraffic({
      pixels: page.pixels,
      domainScanCount: activity.scanCount,
      lastSeen: activity.lastSeen,
    });
    if (!traffic.hasTraffic) alerts.push('sem-trafego');

    const niche = xray?.niche || offer.niche || 'desconhecido';
    const market = xray?.market || offer.market || 'BR';
    const competitionCount = await prisma.offer.count({
      where: { niche, market, id: { not: offerId } },
    });

    const trend = await fetchTrend(niche, market);
    if (trend) {
      const series = trend.series as unknown as Prisma.InputJsonValue;
      await prisma.termTrend.upsert({
        where: { term_market: { term: trend.term, market: trend.market } },
        update: { volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
        create: { term: trend.term, market: trend.market, volumeMonthly: trend.volumeMonthly, growth90d: trend.growth90d, status: trend.status, series },
      });
    }

    const firstSeen = activity.firstSeen ? new Date(activity.firstSeen) : offer.firstSeen;
    const lastSeen = activity.lastSeen ? new Date(activity.lastSeen) : offer.lastSeen;
    const daysRunning =
      firstSeen && lastSeen
        ? Math.max(0, Math.round((lastSeen.getTime() - firstSeen.getTime()) / 86_400_000))
        : offer.daysRunning;

    const score = computeScore({
      trafficScore: traffic.score,
      daysRunning,
      scanCount: activity.scanCount,
      ticketEstCents: xray?.ticketEstCents ?? offer.ticketEstCents,
      competitionCount: competitionCount + 1,
      demandGrowthPct: parseGrowth(trend?.growth90d ?? null),
    });

    await prisma.offer.update({
      where: { id: offerId },
      data: {
        pageUrl: targetUrl || offer.pageUrl,
        market,
        niche,
        ticketEstCents: xray?.ticketEstCents ?? offer.ticketEstCents,
        angle: xray?.angle ?? offer.angle,
        detectedGateway: page.detectedGateway ?? offer.detectedGateway,
        xray: xray ? (xray as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        opportunityScore: score,
        trafficScore: traffic.score,
        daysRunning,
        scanCount: activity.scanCount,
        firstSeen,
        lastSeen,
        alerts: alerts as unknown as Prisma.InputJsonValue,
        enrichment: 'done',
        enrichmentError: null,
      },
    });

    return { ok: true, alerts };
  } catch (err) {
    // Falhar aqui não pode derrubar o que já foi preenchido nem sumir no log —
    // o erro precisa aparecer no card, com botão de tentar de novo.
    await prisma.offer.update({
      where: { id: offerId },
      data: {
        enrichment: 'failed',
        enrichmentError: (err as Error).message.slice(0, 500),
        alerts: alerts as unknown as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
```

- [ ] **Step 2: Verificar a compilação**

Run: `pnpm --filter @forja/worker exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Rodar a suíte inteira**

Run: `pnpm --filter @forja/worker test`
Expected: PASS — todos os testes das Tasks 1, 3, 4, 5, 7.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/jobs/enrich.ts
git commit -m "Ingestao: job de enriquecimento (download + IA) so nas ofertas promovidas"
```

---

### Task 9: API — fontes, colheita e rodadas

**Files:**
- Modify: `apps/api/src/queue/queue.service.ts`
- Modify: `apps/api/src/radar/radar.dto.ts`
- Modify: `apps/api/src/radar/radar.service.ts`
- Modify: `apps/api/src/radar/radar.controller.ts`

**Interfaces:**
- Consumes: filas `harvest` e `enrich` do BullMQ (Task 6)
- Produces em `RadarService`: `sources()`, `harvest(input)`, `runs()`, `run(id)`, `offers({stage})`, `setStage(id, stage)`, `trends()`

- [ ] **Step 1: Atualizar as filas da API**

Substituir `apps/api/src/queue/queue.service.ts` por:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Produtor de jobs — a API enfileira, o worker consome.
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  readonly harvest = new Queue('harvest', { connection: this.connection });
  readonly enrich = new Queue('enrich', { connection: this.connection });

  async onModuleDestroy() {
    await this.harvest.close();
    await this.enrich.close();
    await this.connection.quit();
  }
}
```

- [ ] **Step 2: Atualizar os DTOs**

Substituir `apps/api/src/radar/radar.dto.ts` por:

```ts
import { z } from 'zod';

export const harvestInputSchema = z.object({
  sourceId: z.string().min(1).optional(), // ausente = todas as fontes habilitadas
});
export type HarvestInput = z.infer<typeof harvestInputSchema>;

export const triageDecisionSchema = z.object({
  decision: z.enum(['pipeline', 'analysis', 'discard']),
});
export type TriageDecision = z.infer<typeof triageDecisionSchema>;

export const bulkTriageSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  decision: z.enum(['pipeline', 'analysis', 'discard']),
});
export type BulkTriage = z.infer<typeof bulkTriageSchema>;

export const offerStageSchema = z.object({
  stage: z.enum(['analysis', 'pipeline', 'discarded']),
});
export type OfferStageInput = z.infer<typeof offerStageSchema>;
```

- [ ] **Step 3: Reescrever o RadarService**

Substituir `apps/api/src/radar/radar.service.ts` por:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import type { HarvestInput, OfferStageInput } from './radar.dto';

@Injectable()
export class RadarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  sources() {
    return this.prisma.client.harvestSource.findMany({ orderBy: { name: 'asc' } });
  }

  offers(params: { stage?: string; market?: string; niche?: string }) {
    const where: Prisma.OfferWhereInput = {};
    if (params.stage) where.stage = params.stage as Prisma.EnumOfferStageFilter['equals'];
    if (params.market) where.market = params.market;
    if (params.niche) where.niche = params.niche;
    return this.prisma.client.offer.findMany({
      where,
      orderBy: [{ opportunityScore: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  trends() {
    return this.prisma.client.termTrend.findMany({ orderBy: { volumeMonthly: 'desc' } });
  }

  async setStage(id: string, body: OfferStageInput) {
    const offer = await this.prisma.client.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    return this.prisma.client.offer.update({ where: { id }, data: { stage: body.stage } });
  }

  // Re-enfileira o enriquecimento de uma oferta que falhou.
  async retryEnrichment(id: string) {
    const offer = await this.prisma.client.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    await this.prisma.client.offer.update({
      where: { id },
      data: { enrichment: 'pending', enrichmentError: null },
    });
    await this.queue.enrich.add('retry', { offerId: id });
    return { ok: true };
  }

  /**
   * Dispara a colheita. Uma rodada por fonte, enfileiradas em sequência — o worker
   * roda com concurrency 1 nessa fila para não competir consigo mesmo por rate
   * limit do urlscan.
   */
  async harvest(input: HarvestInput) {
    const sources = input.sourceId
      ? await this.prisma.client.harvestSource.findMany({ where: { id: input.sourceId } })
      : await this.prisma.client.harvestSource.findMany({ where: { enabled: true } });

    if (sources.length === 0) throw new NotFoundException('Nenhuma fonte habilitada');

    const runs = [];
    for (const source of sources) {
      const run = await this.prisma.client.ingestionRun.create({
        data: { query: source.query, sourceId: source.id, status: 'running' },
      });
      await this.queue.harvest.add('manual', { runId: run.id, sourceId: source.id });
      runs.push(run);
    }
    return runs;
  }

  runs() {
    return this.prisma.client.ingestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: { source: { select: { name: true, kind: true } } },
    });
  }

  async run(id: string) {
    const run = await this.prisma.client.ingestionRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Rodada não encontrada');
    return run;
  }
}
```

- [ ] **Step 4: Atualizar o controller (parte de fontes/colheita/ofertas)**

Substituir `apps/api/src/radar/radar.controller.ts` por:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RadarService } from './radar.service';
import { CandidatesService } from './candidates.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  harvestInputSchema,
  triageDecisionSchema,
  bulkTriageSchema,
  offerStageSchema,
  type HarvestInput,
  type TriageDecision,
  type BulkTriage,
  type OfferStageInput,
} from './radar.dto';

@Controller('radar')
export class RadarController {
  constructor(
    private readonly radar: RadarService,
    private readonly candidates: CandidatesService,
  ) {}

  // ===== fontes e colheita =====

  @Get('sources')
  sources() {
    return this.radar.sources();
  }

  @Post('harvest')
  harvest(@Body(new ZodValidationPipe(harvestInputSchema)) body: HarvestInput) {
    return this.radar.harvest(body);
  }

  @Get('runs')
  runs() {
    return this.radar.runs();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.radar.run(id);
  }

  // ===== triagem =====

  @Get('candidates')
  list(
    @Query('status') status?: string,
    @Query('sourceId') sourceId?: string,
    @Query('reason') reason?: string,
    @Query('sort') sort?: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
  ) {
    return this.candidates.list({ status, sourceId, reason, sort, cursor, take });
  }

  @Patch('candidates/:id')
  triage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(triageDecisionSchema)) body: TriageDecision,
  ) {
    return this.candidates.triage(id, body.decision);
  }

  @Post('candidates/bulk')
  bulk(@Body(new ZodValidationPipe(bulkTriageSchema)) body: BulkTriage) {
    return this.candidates.bulk(body.ids, body.decision);
  }

  @Post('candidates/:id/undo')
  undo(@Param('id') id: string) {
    return this.candidates.undo(id);
  }

  @Post('candidates/:id/restore')
  restore(@Param('id') id: string) {
    return this.candidates.restore(id);
  }

  // ===== ofertas =====

  @Get('offers')
  offers(
    @Query('stage') stage?: string,
    @Query('market') market?: string,
    @Query('niche') niche?: string,
  ) {
    return this.radar.offers({ stage, market, niche });
  }

  @Patch('offers/:id')
  setStage(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(offerStageSchema)) body: OfferStageInput,
  ) {
    return this.radar.setStage(id, body);
  }

  @Post('offers/:id/retry-enrichment')
  retry(@Param('id') id: string) {
    return this.radar.retryEnrichment(id);
  }

  @Get('trends')
  trends() {
    return this.radar.trends();
  }
}
```

- [ ] **Step 5: Commit (a compilação ainda falha por falta de `CandidatesService` — a Task 10 fecha)**

```bash
git add apps/api/src/queue/queue.service.ts apps/api/src/radar/radar.dto.ts apps/api/src/radar/radar.service.ts apps/api/src/radar/radar.controller.ts
git commit -m "API: rotas de fontes, colheita e ofertas por stage"
```

---

### Task 10: API — serviço de triagem

**Files:**
- Create: `apps/api/src/radar/candidates.service.ts`
- Modify: `apps/api/src/radar/radar.module.ts`

**Interfaces:**
- Consumes: `QueueService.enrich` (Task 9)
- Produces: `CandidatesService` com `list(params)`, `triage(id, decision)`, `bulk(ids, decision)`, `undo(id)`, `restore(id)`

- [ ] **Step 1: Implementar o serviço**

Criar `apps/api/src/radar/candidates.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@forja/db';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

type Decision = 'pipeline' | 'analysis' | 'discard';

// Janela do desfazer. O enriquecimento entra atrasado para que uma decisão
// revertida nesse intervalo não gaste download nem token de LLM.
const UNDO_WINDOW_MS = 8_000;

@Injectable()
export class CandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Fila de triagem, paginada por cursor — a fila pode ter centenas de itens e a
   * tabela carrega por bloco.
   */
  async list(params: {
    status?: string;
    sourceId?: string;
    reason?: string;
    sort?: string;
    cursor?: string;
    take?: string;
  }) {
    const where: Prisma.CandidateWhereInput = {
      status: (params.status as Prisma.EnumCandidateStatusFilter['equals']) ?? 'pending',
    };
    if (params.sourceId) where.sourceId = params.sourceId;
    if (params.reason) where.discardReason = params.reason;

    const orderBy: Prisma.CandidateOrderByWithRelationInput[] =
      params.sort === 'days'
        ? [{ daysRunning: 'desc' }, { id: 'asc' }]
        : params.sort === 'recent'
          ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]
          : [{ hitCount: 'desc' }, { id: 'asc' }];

    const take = Math.min(Number(params.take ?? 50), 200);

    const items = await this.prisma.client.candidate.findMany({
      where,
      orderBy,
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      include: { source: { select: { id: true, name: true, kind: true } } },
    });

    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    const total = await this.prisma.client.candidate.count({ where });

    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null, total };
  }

  async triage(id: string, decision: Decision) {
    const candidate = await this.prisma.client.candidate.findUnique({
      where: { id },
      include: { source: true },
    });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    if (decision === 'discard') {
      return this.prisma.client.candidate.update({
        where: { id },
        data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
      });
    }

    const stage = decision === 'pipeline' ? 'pipeline' : 'analysis';

    const offer = await this.prisma.client.offer.create({
      data: {
        source: 'urlscan',
        candidateId: candidate.id,
        advertiser: candidate.domain,
        name: candidate.productName ?? candidate.title ?? candidate.domain,
        market: 'BR',
        niche: 'desconhecido',
        pageUrl: candidate.url,
        screenshotUrl: candidate.screenshotUrl,
        ticketEstCents: candidate.priceCents,
        detectedGateway: candidate.gateway,
        daysRunning: candidate.daysRunning,
        scanCount: candidate.hitCount,
        firstSeen: candidate.firstSeenAt,
        lastSeen: candidate.lastSeenAt,
        stage,
        enrichment: 'pending',
      },
    });

    await this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'promoted', triagedAt: new Date() },
    });

    // jobId determinístico: é o que permite ao desfazer cancelar o job.
    await this.queue.enrich.add(
      'promote',
      { offerId: offer.id },
      { jobId: `enrich:${offer.id}`, delay: UNDO_WINDOW_MS },
    );

    return offer;
  }

  async bulk(ids: string[], decision: Decision) {
    // Descarte em lote é uma única escrita — o caso comum é marcar dezenas de
    // linhas e matar todas de uma vez.
    if (decision === 'discard') {
      const res = await this.prisma.client.candidate.updateMany({
        where: { id: { in: ids }, status: 'pending' },
        data: { status: 'discarded_manual', discardReason: 'manual', triagedAt: new Date() },
      });
      return { count: res.count };
    }

    let count = 0;
    for (const id of ids) {
      await this.triage(id, decision);
      count++;
    }
    return { count };
  }

  /** Desfaz uma decisão recente: devolve o candidato à fila e cancela o job atrasado. */
  async undo(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({
      where: { id },
      include: { offer: true },
    });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');

    if (candidate.offer) {
      const job = await this.queue.enrich.getJob(`enrich:${candidate.offer.id}`);
      if (job) await job.remove().catch(() => undefined);
      await this.prisma.client.offer.delete({ where: { id: candidate.offer.id } });
    }

    return this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null, triagedAt: null },
    });
  }

  /** Traz de volta à fila algo que o pré-filtro descartou. */
  async restore(id: string) {
    const candidate = await this.prisma.client.candidate.findUnique({ where: { id } });
    if (!candidate) throw new NotFoundException('Candidato não encontrado');
    return this.prisma.client.candidate.update({
      where: { id },
      data: { status: 'pending', discardReason: null },
    });
  }
}
```

- [ ] **Step 2: Registrar no módulo**

Substituir `apps/api/src/radar/radar.module.ts` por:

```ts
import { Module } from '@nestjs/common';
import { RadarController } from './radar.controller';
import { RadarService } from './radar.service';
import { CandidatesService } from './candidates.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [RadarController],
  providers: [RadarService, CandidatesService],
})
export class RadarModule {}
```

- [ ] **Step 3: Verificar a compilação**

Run: `pnpm --filter @forja/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificar a API rodando de ponta a ponta**

Em três terminais:

```bash
docker compose up -d
pnpm --filter @forja/api dev
pnpm --filter @forja/worker dev
```

Depois:

```bash
curl -s localhost:3333/api/radar/sources | head -c 400
curl -s -X POST localhost:3333/api/radar/harvest -H 'Content-Type: application/json' -d '{}' | head -c 400
sleep 30
curl -s localhost:3333/api/radar/runs | head -c 600
curl -s 'localhost:3333/api/radar/candidates?status=pending' | head -c 600
```

Expected: `sources` devolve 7 fontes; `harvest` devolve as rodadas criadas; após ~30s `runs` mostra `status: "done"` (ou `"partial"`) com `rawHits > 0`; `candidates` devolve `{items, nextCursor, total}` com `total > 0`.

Se `rawHits` vier 0 em todas as fontes, conferir `URLSCAN_API_KEY` no `.env`.

- [ ] **Step 5: Verificar a triagem e o desfazer**

```bash
ID=$(curl -s 'localhost:3333/api/radar/candidates?status=pending&take=1' | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -X PATCH localhost:3333/api/radar/candidates/$ID -H 'Content-Type: application/json' -d '{"decision":"analysis"}' | head -c 300
curl -s 'localhost:3333/api/radar/offers?stage=analysis' | head -c 300
curl -s -X POST localhost:3333/api/radar/candidates/$ID/undo | head -c 300
curl -s 'localhost:3333/api/radar/offers?stage=analysis' | head -c 300
```

Expected: o PATCH cria a oferta; o primeiro `offers` a lista; após o `undo` a lista volta vazia e o candidato reaparece em `pending`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/radar/candidates.service.ts apps/api/src/radar/radar.module.ts
git commit -m "API: servico de triagem com lote, desfazer e restauracao"
```

---

### Task 11: Tipos compartilhados

**Files:**
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Consumes: nada
- Produces: `CandidateDTO`, `HarvestSourceDTO`, `CandidateListDTO`, `OfferStage`, `EnrichmentState`; `OfferDTO` sem `saved` e com `stage`/`enrichment`/`alerts`; `IngestionRunDTO` com os contadores novos

- [ ] **Step 1: Substituir o bloco RADAR dos tipos**

Em `packages/types/src/index.ts`, substituir tudo entre o comentário `// RADAR — raio-x da oferta minerada...` e o comentário `// GERADOR — blocos gerados por IA...` por:

```ts
export interface OfferXray {
  promise: string;
  mechanism: string;
  avatar: string;
  pain: string;
  guarantee: string;
  angle: string;
  niche: string;
  market: string;
  ticketEstCents: number;
  isSalesPage?: boolean;
  productType?: 'digital' | 'physical' | 'service' | 'other';
  category?: string;
}

export type HarvestKind = 'resource' | 'checkout';

export interface HarvestSourceDTO {
  id: string;
  name: string;
  query: string;
  kind: HarvestKind;
  enabled: boolean;
  minHitCount: number;
  maxAgeDays: number;
  lastRunAt: string | null;
}

export type CandidateStatus = 'pending' | 'discarded_auto' | 'discarded_manual' | 'promoted';

// Candidato cru da colheita: só o que a varredura do urlscan devolveu.
export interface CandidateDTO {
  id: string;
  dedupeKey: string;
  url: string;
  domain: string;
  title: string | null;
  screenshotUrl: string | null;
  productName: string | null;
  priceCents: number | null;
  gateway: string | null;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  daysRunning: number;
  status: CandidateStatus;
  discardReason: string | null;
  source: { id: string; name: string; kind: HarvestKind };
}

export interface CandidateListDTO {
  items: CandidateDTO[];
  nextCursor: string | null;
  total: number;
}

export type OfferStage = 'analysis' | 'pipeline' | 'discarded';
export type EnrichmentState = 'pending' | 'running' | 'done' | 'failed';

// Oferta promovida pela triagem.
export interface OfferDTO {
  id: string;
  source: string;
  candidateId: string | null;
  advertiser: string;
  name: string;
  market: string;
  niche: string;
  ticketEstCents: number | null;
  angle: string | null;
  pageUrl: string | null;
  screenshotUrl: string | null;
  detectedGateway: string | null;
  daysRunning: number;
  scanCount: number | null;
  activeAdsCount: number;
  opportunityScore: number | null;
  trafficScore: number | null;
  xray: OfferXray | null;
  stage: OfferStage;
  enrichment: EnrichmentState;
  enrichmentError: string | null;
  alerts: string[] | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface IngestionEvent {
  key: string;
  ok: boolean;
  reason?: string;
}

export interface IngestionRunDTO {
  id: string;
  query: string;
  sourceId: string | null;
  source?: { name: string; kind: HarvestKind } | null;
  status: 'running' | 'done' | 'partial' | 'error';
  stage: string | null;
  rawHits: number;
  newCandidates: number;
  autoDiscarded: number;
  queuedForTriage: number;
  events: IngestionEvent[] | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

// Rótulos dos alertas do enriquecimento, exibidos na fila de Análise.
export const ALERT_LABELS: Record<string, string> = {
  'nao-e-pagina-de-vendas': 'Não parece página de vendas',
  'produto-physical': 'A IA diz que é produto físico',
  'produto-service': 'A IA diz que é serviço',
  'produto-other': 'Tipo de produto indefinido',
  'sem-trafego': 'Sem sinal de tráfego',
  'sem-conteudo': 'Página fora do ar ou sem conteúdo',
  'categoria-bloqueada': 'Categoria bloqueada (delivery/comida)',
  'pagina-de-vendas-nao-localizada': 'Página de vendas não localizada',
};
```

- [ ] **Step 2: Verificar a compilação dos tipos**

Run: `pnpm --filter @forja/types exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "Types: candidatos, fontes e oferta por stage"
```

---

### Task 12: Web — tela de triagem

**Files:**
- Create: `apps/web/components/radar/TriageTable.tsx`
- Modify: `apps/web/app/radar/page.tsx`

**Interfaces:**
- Consumes: `CandidateDTO`, `CandidateListDTO`, `HarvestSourceDTO`, `IngestionRunDTO`, `OfferDTO` (Task 11); `AnalysisCards` (Task 13); rotas da API (Tasks 9 e 10)
- Produces: componente `TriageTable`

> **Ordem:** a página importa `AnalysisCards`, criado na Task 13. Executar a Task 13 imediatamente após esta — só então a web compila. A verificação do passo 4 depende disso.

- [ ] **Step 1: Criar a tabela de triagem**

Criar `apps/web/components/radar/TriageTable.tsx`:

```tsx
'use client';

import { Button, Chip } from '@heroui/react';
import type { CandidateDTO } from '@forja/types';

export type Decision = 'pipeline' | 'analysis' | 'discard';

interface Props {
  items: CandidateDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDecide: (id: string, decision: Decision) => void;
  busy: boolean;
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Tabela densa: ~20 candidatos por tela. O objetivo é comparar antes de decidir e
// resolver blocos inteiros de uma vez — por isso a linha é baixa e o screenshot
// pequeno, ampliando só no hover.
export function TriageTable({ items, selected, onToggle, onToggleAll, onDecide, busy }: Props) {
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="w-8 p-2">
              <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="Selecionar todos" />
            </th>
            <th className="w-16 p-2" />
            <th className="p-2">Oferta</th>
            <th className="w-24 p-2">Dias no ar</th>
            <th className="w-20 p-2">Hits</th>
            <th className="w-32 p-2">Fonte</th>
            <th className="w-40 p-2 text-right">Decisão</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-white/10 align-middle hover:bg-white/[0.03]">
              <td className="p-2">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => onToggle(c.id)}
                  aria-label={`Selecionar ${c.domain}`}
                />
              </td>
              <td className="p-2">
                {c.screenshotUrl ? (
                  <a href={c.url} target="_blank" rel="noreferrer" title="Abrir a página">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.screenshotUrl}
                      alt=""
                      loading="lazy"
                      className="h-9 w-14 rounded object-cover object-top transition-transform hover:scale-[3] hover:shadow-2xl"
                    />
                  </a>
                ) : (
                  <div className="h-9 w-14 rounded bg-white/5" />
                )}
              </td>
              <td className="max-w-[380px] p-2">
                <div className="truncate font-semibold">
                  {c.source.kind === 'checkout' ? (c.productName ?? c.title ?? c.domain) : c.domain}
                </div>
                <div className="truncate text-[11.5px] text-neutral-500">
                  {c.source.kind === 'checkout'
                    ? `${fmtPrice(c.priceCents)} · ${c.gateway ?? c.domain}`
                    : (c.title ?? '—')}
                </div>
              </td>
              <td className="p-2">
                <b>{c.daysRunning}</b>
                {c.daysRunning >= 120 && (
                  <Chip className="ml-1.5" size="sm" variant="soft" color="success">
                    vencedora
                  </Chip>
                )}
              </td>
              <td className="p-2 tabular-nums">{c.hitCount}</td>
              <td className="p-2 text-[11.5px] text-neutral-400">{c.source.name}</td>
              <td className="whitespace-nowrap p-2 text-right">
                <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => onDecide(c.id, 'pipeline')} title="Mandar para a esteira">
                  ✓
                </Button>{' '}
                <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => onDecide(c.id, 'analysis')} title="Mandar para análise">
                  ?
                </Button>{' '}
                <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => onDecide(c.id, 'discard')} title="Descartar">
                  ✕
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Reescrever a página do Radar**

Substituir `apps/web/app/radar/page.tsx` por:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip } from '@heroui/react';
import { api, apiPost, apiPatch } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { Sparkline } from '@/components/radar/Sparkline';
import { TriageTable, type Decision } from '@/components/radar/TriageTable';
import { AnalysisCards } from '@/components/radar/AnalysisCards';
import type {
  CandidateListDTO,
  HarvestSourceDTO,
  IngestionRunDTO,
  OfferDTO,
} from '@forja/types';

type TabKey = 'triage' | 'discarded' | 'analysis' | 'trends';
const TABS: [TabKey, string][] = [
  ['triage', 'Triagem'],
  ['discarded', 'Descartados pela máquina'],
  ['analysis', 'Análise'],
  ['trends', 'Trends de termos'],
];

type SortKey = 'hits' | 'days' | 'recent';

// Trends não muda de comportamento nesta entrega — segue sendo leitura pura.
interface Trend {
  id: string;
  term: string;
  market: string;
  volumeMonthly: number;
  growth90d: string | null;
  status: string;
  series: number[] | null;
}

export default function RadarPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('triage');
  const [sourceId, setSourceId] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('hits');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undoId, setUndoId] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<HarvestSourceDTO[]>('/radar/sources'),
  });

  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => api<IngestionRunDTO[]>('/radar/runs'),
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === 'running') ? 2000 : false,
  });

  const status = tab === 'discarded' ? 'discarded_auto' : 'pending';
  const queryString = useMemo(() => {
    const p = new URLSearchParams({ status, sort });
    if (sourceId !== 'all') p.set('sourceId', sourceId);
    return p.toString();
  }, [status, sort, sourceId]);

  const candidates = useQuery({
    queryKey: ['candidates', queryString],
    queryFn: () => api<CandidateListDTO>(`/radar/candidates?${queryString}`),
    enabled: tab === 'triage' || tab === 'discarded',
  });

  const trends = useQuery({
    queryKey: ['trends'],
    queryFn: () => api<Trend[]>('/radar/trends'),
    enabled: tab === 'trends',
  });

  const analysis = useQuery({
    queryKey: ['offers', 'analysis'],
    queryFn: () => api<OfferDTO[]>('/radar/offers?stage=analysis'),
    enabled: tab === 'analysis',
    refetchInterval: (q) =>
      q.state.data?.some((o) => o.enrichment === 'pending' || o.enrichment === 'running')
        ? 2500
        : false,
  });

  const harvest = useMutation({
    mutationFn: () =>
      apiPost<IngestionRunDTO[]>('/radar/harvest', sourceId === 'all' ? {} : { sourceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['offers'] });
  };

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: Decision }) =>
      apiPatch(`/radar/candidates/${v.id}`, { decision: v.decision }),
    onSuccess: (_d, v) => {
      setUndoId(v.id);
      setTimeout(() => setUndoId((cur) => (cur === v.id ? null : cur)), 8000);
      refreshLists();
    },
  });

  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; decision: Decision }) => apiPost('/radar/candidates/bulk', v),
    onSuccess: () => {
      setSelected(new Set());
      refreshLists();
    },
  });

  const undo = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/undo`),
    onSuccess: () => {
      setUndoId(null);
      refreshLists();
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/restore`),
    onSuccess: refreshLists,
  });

  const setStage = useMutation({
    mutationFn: (v: { id: string; stage: 'pipeline' | 'discarded' }) =>
      apiPatch(`/radar/offers/${v.id}`, { stage: v.stage }),
    onSuccess: refreshLists,
  });

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/offers/${id}/retry-enrichment`),
    onSuccess: refreshLists,
  });

  const items = candidates.data?.items ?? [];
  const running = runs.data?.some((r) => r.status === 'running') || harvest.isPending;
  const lastRun = runs.data?.[0];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      items.every((c) => prev.has(c.id)) ? new Set() : new Set(items.map((c) => c.id)),
    );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Radar</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Descoberta e triagem. A colheita é barata e em massa; a IA só entra no que você promove.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px]"
          >
            <option value="all">Todas as fontes</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button variant="primary" isDisabled={running} onPress={() => harvest.mutate()}>
            {running ? 'Colhendo…' : '✦ Colher'}
          </Button>
        </div>
      </div>

      {lastRun && (
        <Panel className="px-4 py-3 text-[12.5px] text-neutral-400">
          <b className="text-neutral-200">{lastRun.source?.name ?? lastRun.query}</b> ·{' '}
          {lastRun.stage ?? lastRun.status} — {lastRun.rawHits.toLocaleString('pt-BR')} varridos ·{' '}
          {lastRun.newCandidates} novos · {lastRun.autoDiscarded} filtrados ·{' '}
          <b className="text-neutral-200">{lastRun.queuedForTriage} na fila</b>
          {lastRun.status === 'partial' && (
            <Chip className="ml-2" size="sm" variant="soft" color="warning">
              parcial — a próxima rodada continua daqui
            </Chip>
          )}
        </Panel>
      )}

      <div className="flex gap-1 border-b border-white/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setSelected(new Set());
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === k
                ? 'border-blue-500 text-neutral-100'
                : 'border-transparent text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {label}
            {k === tab && candidates.data && (tab === 'triage' || tab === 'discarded') && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px]">
                {candidates.data.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {undoId && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-[13px]">
          <span>Decisão aplicada.</span>
          <Button size="sm" variant="ghost" onPress={() => undo.mutate(undoId)}>
            Desfazer
          </Button>
        </div>
      )}

      {(tab === 'triage' || tab === 'discarded') && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12.5px]"
            >
              <option value="hits">Ordenar: circulação</option>
              <option value="days">Ordenar: dias no ar</option>
              <option value="recent">Ordenar: visto recentemente</option>
            </select>

            {selected.size > 0 && tab === 'triage' && (
              <div className="ml-auto flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5">
                <span className="text-[12.5px]">{selected.size} selecionados</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'pipeline' })}
                >
                  ✓ Esteira
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'analysis' })}
                >
                  ? Análise
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'discard' })}
                >
                  ✕ Descartar
                </Button>
              </div>
            )}
          </div>

          {candidates.isLoading && <Loading label="Carregando a fila…" />}
          {candidates.data && items.length === 0 && (
            <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
              {tab === 'triage'
                ? 'Fila vazia. Clique em “Colher” para varrer as fontes.'
                : 'Nada foi descartado automaticamente ainda.'}
            </Panel>
          )}

          {items.length > 0 && tab === 'triage' && (
            <Panel>
              <TriageTable
                items={items}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onDecide={(id, decision) => decide.mutate({ id, decision })}
                busy={decide.isPending || bulk.isPending}
              />
            </Panel>
          )}

          {items.length > 0 && tab === 'discarded' && (
            <Panel className="divide-y divide-white/10">
              {items.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.domain}</div>
                    <div className="truncate text-[11.5px] text-neutral-500">{c.title ?? '—'}</div>
                  </div>
                  <Chip size="sm" variant="soft" color="danger">
                    {c.discardReason}
                  </Chip>
                  <Button size="sm" variant="ghost" onPress={() => restore.mutate(c.id)}>
                    Trazer de volta
                  </Button>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      {tab === 'analysis' && (
        <AnalysisCards
          offers={analysis.data ?? []}
          loading={analysis.isLoading}
          onPromote={(id) => setStage.mutate({ id, stage: 'pipeline' })}
          onDiscard={(id) => setStage.mutate({ id, stage: 'discarded' })}
          onRetry={(id) => retry.mutate(id)}
        />
      )}

      {tab === 'trends' && (
        <>
          {trends.isLoading && <Loading label="Carregando trends…" />}
          {trends.data && trends.data.length === 0 && (
            <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
              Sem trends por enquanto — a demanda entra com a chave do SerpApi.
            </Panel>
          )}
          {trends.data && trends.data.length > 0 && (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="p-3">Termo</th>
                    <th className="p-3">Mercado</th>
                    <th className="p-3">Tendência</th>
                    <th className="p-3">Crescimento</th>
                    <th className="p-3">Volume/mês</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.data.map((t) => (
                    <tr key={t.id} className="border-t border-white/10">
                      <td className="p-3 font-semibold">{t.term}</td>
                      <td className="p-3">{t.market}</td>
                      <td className="p-3">
                        {t.series && t.series.length > 1 ? (
                          <Sparkline points={t.series} color="#3b82f6" />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3">
                        <b>{t.growth90d ?? '—'}</b>
                      </td>
                      <td className="p-3 tabular-nums">{t.volumeMonthly.toLocaleString('pt-BR')}</td>
                      <td className="p-3">
                        <Chip size="sm" variant="soft">
                          {t.status}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
```

> Conferir a assinatura de `apps/web/components/radar/Sparkline.tsx` antes de usar. Se as props diferirem de `{ points, color }`, ajustar a chamada acima — o componente não muda nesta entrega.

- [ ] **Step 3: Verificar na aplicação (executar a Task 13 antes)**

Com api, worker e web rodando (`pnpm --filter @forja/web dev`), abrir `http://localhost:3000/radar`.

Expected:
- O seletor de fontes lista as 7 fontes.
- "Colher" dispara e a barra de resumo aparece com os contadores.
- A aba Triagem mostra a tabela densa; passar o mouse no screenshot amplia.
- Marcar 3 linhas exibe a barra de lote; "✕ Descartar" some com as três.
- Clicar em "?" numa linha exibe a faixa de desfazer; "Desfazer" devolve a linha à fila.
- A aba "Descartados pela máquina" lista com o motivo e "Trazer de volta" funciona.
- A aba "Trends de termos" continua renderizando como antes.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/radar/TriageTable.tsx apps/web/app/radar/page.tsx
git commit -m "Radar: tela de triagem em massa com tabela densa, lote e desfazer"
```

---

### Task 13: Web — fila de Análise

**Files:**
- Create: `apps/web/components/radar/AnalysisCards.tsx`

**Interfaces:**
- Consumes: `OfferDTO`, `ALERT_LABELS` (Task 11)
- Produces: componente `AnalysisCards` com as props usadas em `radar/page.tsx` (Task 12): `{ offers, loading, onPromote, onDiscard, onRetry }`

- [ ] **Step 1: Criar o componente**

Criar `apps/web/components/radar/AnalysisCards.tsx`:

```tsx
'use client';

import { Button, Chip } from '@heroui/react';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { ALERT_LABELS, type OfferDTO } from '@forja/types';

interface Props {
  offers: OfferDTO[];
  loading: boolean;
  onPromote: (id: string) => void;
  onDiscard: (id: string) => void;
  onRetry: (id: string) => void;
}

function fmtTicket(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Cards, não tabela: aqui se lê o dossiê, não se varre a fila. Cada card carrega
// o resultado do enriquecimento e reduz a decisão a promover ou descartar.
export function AnalysisCards({ offers, loading, onPromote, onDiscard, onRetry }: Props) {
  if (loading) return <Loading label="Carregando a fila de análise…" />;

  if (offers.length === 0) {
    return (
      <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
        Nada em análise. Mande candidatos para cá com o “?” na triagem.
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {offers.map((o) => {
        const busy = o.enrichment === 'pending' || o.enrichment === 'running';
        return (
          <Panel key={o.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              {o.screenshotUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={o.screenshotUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-24 flex-none rounded object-cover object-top"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{o.name}</div>
                <div className="truncate text-[12px] text-neutral-500">{o.advertiser}</div>
              </div>
              {o.opportunityScore != null && (
                <div className="flex-none text-right">
                  <div className="text-[20px] font-extrabold tabular-nums">{o.opportunityScore}</div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">score</div>
                </div>
              )}
            </div>

            {busy && (
              <div className="rounded-lg bg-white/5 px-3 py-2 text-[12.5px] text-neutral-400">
                ⏳ Enriquecendo — baixando a página e rodando o raio-x…
              </div>
            )}

            {o.enrichment === 'failed' && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">Falhou: {o.enrichmentError}</span>
                <Button size="sm" variant="ghost" onPress={() => onRetry(o.id)}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {o.enrichment === 'done' && o.xray && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Promessa</dt>
                  <dd className="text-neutral-200">{o.xray.promise}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Mecanismo</dt>
                  <dd className="text-neutral-200">{o.xray.mechanism}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Nicho</dt>
                  <dd className="text-neutral-200">{o.niche}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Ticket</dt>
                  <dd className="text-neutral-200">{fmtTicket(o.ticketEstCents)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Dias no ar</dt>
                  <dd className="text-neutral-200">{o.daysRunning}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Tráfego</dt>
                  <dd className="text-neutral-200">{o.trafficScore ?? '—'}</dd>
                </div>
              </dl>
            )}

            {o.alerts && o.alerts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {o.alerts.map((a) => (
                  <Chip key={a} size="sm" variant="soft" color="warning">
                    {ALERT_LABELS[a] ?? a}
                  </Chip>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-1">
              {o.pageUrl && (
                <Button size="sm" variant="ghost" onPress={() => window.open(o.pageUrl!, '_blank')}>
                  Ver página
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                isDisabled={busy}
                onPress={() => onPromote(o.id)}
              >
                Promover para a esteira
              </Button>
              <Button size="sm" variant="ghost" onPress={() => onDiscard(o.id)}>
                Descartar
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verificar na aplicação**

Abrir `http://localhost:3000/radar`, aba **Análise**.

Expected: um candidato mandado para análise aparece primeiro como "⏳ Enriquecendo"; após alguns segundos o card se preenche com promessa, mecanismo, nicho, ticket e score. Alertas aparecem como chips âmbar quando existem. "Promover para a esteira" tira o card da lista.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/radar/AnalysisCards.tsx
git commit -m "Radar: fila de analise em cards com dossie e alertas do enriquecimento"
```

---

### Task 14: Web — rota `/esteira`

**Files:**
- Create: `apps/web/app/esteira/page.tsx`
- Modify: `apps/web/components/layout/TopNav.tsx`
- Modify: `apps/api/src/offer-drafts/offer-drafts.service.ts`
- Modify: `apps/api/src/offer-drafts/offer-drafts.controller.ts`

**Interfaces:**
- Consumes: `OfferDTO` (Task 11), `MVP_GENERATOR_STEPS` (já existe em `@forja/types`)
- Produces: `GET /offer-drafts` devolvendo os drafts com a oferta de origem; board `/esteira`

- [ ] **Step 1: Expor a listagem de drafts na API**

Em `apps/api/src/offer-drafts/offer-drafts.service.ts`, acrescentar dentro da classe, logo após `create`:

```ts
  // Board da esteira: cada draft com o mínimo da oferta de origem para render.
  findAll() {
    return this.prisma.client.offerDraft.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        sourceOffer: {
          select: { id: true, name: true, advertiser: true, screenshotUrl: true, opportunityScore: true },
        },
      },
    });
  }
```

Em `apps/api/src/offer-drafts/offer-drafts.controller.ts`, acrescentar o handler (junto dos demais `@Get`):

```ts
  @Get()
  findAll() {
    return this.drafts.findAll();
  }
```

Conferir que `Get` está importado de `@nestjs/common` no topo do controller; se não estiver, acrescentar ao import existente.

- [ ] **Step 2: Criar a página da esteira**

Criar `apps/web/app/esteira/page.tsx`:

```tsx
'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@heroui/react';
import { api, apiPost } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { MVP_GENERATOR_STEPS, type OfferDTO } from '@forja/types';

interface DraftRow {
  id: string;
  currentStep: number;
  sourceOfferId: string | null;
  sourceOffer: {
    id: string;
    name: string;
    advertiser: string;
    screenshotUrl: string | null;
    opportunityScore: number | null;
  } | null;
}

// As colunas do board são as etapas da modelagem. currentStep é o índice da
// próxima etapa a fazer — a coluna em que o draft está É a tarefa pendente.
const COLUMNS = [
  { key: 'base', label: 'Oferta base' },
  ...MVP_GENERATOR_STEPS.map((s) => ({ key: s.key, label: s.label })),
  { key: 'done', label: 'Pronta' },
];

export default function EsteiraPage() {
  const qc = useQueryClient();
  const router = useRouter();

  const drafts = useQuery({
    queryKey: ['drafts'],
    queryFn: () => api<DraftRow[]>('/offer-drafts'),
  });

  // Ofertas promovidas que ainda não viraram draft — entram na primeira coluna.
  const pipeline = useQuery({
    queryKey: ['offers', 'pipeline'],
    queryFn: () => api<OfferDTO[]>('/radar/offers?stage=pipeline'),
  });

  const startDraft = useMutation({
    mutationFn: (offerId: string) => apiPost<{ id: string }>('/offer-drafts', { sourceOfferId: offerId }),
    onSuccess: (draft) => {
      qc.invalidateQueries({ queryKey: ['drafts'] });
      router.push(`/gerador?draftId=${draft.id}`);
    },
  });

  const withDraft = useMemo(
    () => new Set((drafts.data ?? []).map((d) => d.sourceOfferId).filter(Boolean) as string[]),
    [drafts.data],
  );

  const pending = (pipeline.data ?? []).filter((o) => !withDraft.has(o.id));

  const byColumn = (index: number) =>
    (drafts.data ?? []).filter((d) =>
      index === COLUMNS.length - 1
        ? d.currentStep >= MVP_GENERATOR_STEPS.length
        : d.currentStep === index,
    );

  const loading = drafts.isLoading || pipeline.isLoading;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Esteira</h1>
        <p className="mt-1 text-[13.5px] text-neutral-400">
          Modelagem das ofertas aprovadas. A coluna em que a oferta está é o que falta fazer nela.
        </p>
      </div>

      {loading && <Loading label="Carregando a esteira…" />}

      {!loading && (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {COLUMNS.map((col, i) => {
            const cards = byColumn(i);
            const extra = i === 0 ? pending.length : 0;
            return (
              <div key={col.key} className="w-[260px] flex-none">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="text-[12.5px] font-bold">{col.label}</span>
                  <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-neutral-400">
                    {cards.length + extra}
                  </span>
                </div>

                <div className="space-y-2">
                  {i === 0 &&
                    pending.map((o) => (
                      <Panel key={o.id} className="p-3">
                        <div className="truncate text-[13px] font-semibold">{o.name}</div>
                        <div className="truncate text-[11.5px] text-neutral-500">{o.advertiser}</div>
                        <Button
                          size="sm"
                          variant="primary"
                          className="mt-2 w-full"
                          isDisabled={startDraft.isPending}
                          onPress={() => startDraft.mutate(o.id)}
                        >
                          Iniciar modelagem
                        </Button>
                      </Panel>
                    ))}

                  {/* Panel não aceita onClick — o clique fica no wrapper. */}
                  {cards.map((d) => (
                    <div
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/gerador?draftId=${d.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') router.push(`/gerador?draftId=${d.id}`);
                      }}
                      className="cursor-pointer"
                    >
                      <Panel className="p-3 transition-colors hover:bg-white/[0.05]">
                        <div className="truncate text-[13px] font-semibold">
                          {d.sourceOffer?.name ?? 'Oferta sem origem'}
                        </div>
                        <div className="truncate text-[11.5px] text-neutral-500">
                          {d.sourceOffer?.advertiser ?? '—'}
                        </div>
                      </Panel>
                    </div>
                  ))}

                  {cards.length + extra === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11.5px] text-neutral-600">
                      vazio
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Acrescentar o item no menu**

Em `apps/web/components/layout/TopNav.tsx`, substituir o array `items` por:

```tsx
const items = [
  { key: '/radar', label: 'Radar' },
  { key: '/esteira', label: 'Esteira' },
  { key: '/gerador', label: 'Gerador' },
  { key: '/integracoes', label: 'Integrações' },
];
```

- [ ] **Step 4: Verificar na aplicação**

Abrir `http://localhost:3000/esteira`.

Expected: "Esteira" aparece no menu do topo; o board mostra as colunas `Oferta base → Avatar & consciência → Grande ideia + mecanismo → Estrutura da oferta → Copy da página de vendas → Pronta`; uma oferta promovida na triagem aparece na primeira coluna com "Iniciar modelagem", e o clique leva ao gerador.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/esteira/page.tsx apps/web/components/layout/TopNav.tsx apps/api/src/offer-drafts/offer-drafts.service.ts apps/api/src/offer-drafts/offer-drafts.controller.ts
git commit -m "Esteira: board de modelagem em rota propria"
```

---

### Task 15: Script de reconhecimento de fontes

Decide a lista definitiva de fontes com dado em vez de palpite — inclusive a forma invertida (`domain:X AND NOT page.domain:X`), cuja eficácia depende de o gateway ser carregado como recurso e não apenas linkado.

**Files:**
- Create: `apps/worker/scripts/recon-sources.ts`
- Modify: `apps/worker/package.json`

**Interfaces:**
- Consumes: `searchPage` (Task 5), `aggregateHits` (Task 3)
- Produces: script executável `pnpm --filter @forja/worker recon`

- [ ] **Step 1: Criar o script**

Criar `apps/worker/scripts/recon-sources.ts`:

```ts
/**
 * Reconhecimento de fontes: roda cada query candidata, conta quantas chaves
 * distintas ela rende e mostra uma amostra. Serve para decidir a lista de
 * HarvestSource com dado, não com palpite — queries que rendem zero ou lixo
 * ficam de fora.
 *
 * Uso: pnpm --filter @forja/worker recon
 */
import { searchPage } from '../src/adapters/urlscan';
import { aggregateHits } from '../src/lib/aggregate';
import type { HarvestKind } from '../src/lib/dedupeKey';

const CANDIDATES: Array<{ name: string; query: string; kind: HarvestKind }> = [
  { name: 'Utmify', query: 'domain:cdn.utmify.com.br', kind: 'resource' },
  { name: 'ConverteAI', query: 'domain:cdn.converteai.net', kind: 'resource' },
  { name: 'Panda Video', query: 'domain:cdn.pandavideo.com.br', kind: 'resource' },
  { name: 'Klickpages', query: 'domain:klickpages.com.br', kind: 'resource' },
  { name: 'Cakto (checkout)', query: 'page.domain:pay.cakto.com.br', kind: 'checkout' },
  { name: 'Kirvano (checkout)', query: 'page.domain:pay.kirvano.com', kind: 'checkout' },
  { name: 'Ticto (checkout)', query: 'page.domain:pay.ticto.com.br', kind: 'checkout' },
  { name: 'Cakto invertida', query: 'domain:pay.cakto.com.br AND NOT page.domain:pay.cakto.com.br', kind: 'resource' },
  { name: 'Kiwify invertida', query: 'domain:pay.kiwify.com.br AND NOT page.domain:pay.kiwify.com.br', kind: 'resource' },
  { name: 'Hotmart invertida', query: 'domain:pay.hotmart.com AND NOT page.domain:pay.hotmart.com', kind: 'resource' },
];

const PAGES = 3;

async function recon(c: (typeof CANDIDATES)[number]) {
  const hits = [];
  let cursor: string | null = null;

  for (let p = 0; p < PAGES; p++) {
    const page = await searchPage({ query: c.query, cursor, size: 100 });
    hits.push(...page.hits);
    cursor = page.nextCursor;
    if (!cursor || page.pageSize < 100) break;
  }

  const candidates = aggregateHits(hits, c.kind);
  const sample = candidates.slice(0, 5).map((x) => `${x.dedupeKey} (${x.hitCount}×)`);

  console.log(`\n▸ ${c.name}`);
  console.log(`  query   : ${c.query}`);
  console.log(`  brutos  : ${hits.length}`);
  console.log(`  chaves  : ${candidates.length}`);
  console.log(`  amostra : ${sample.join('\n            ') || '—'}`);
}

async function main() {
  if (!process.env.URLSCAN_API_KEY) {
    console.warn('⚠️  Sem URLSCAN_API_KEY — o rate limit anônimo vai truncar os resultados.\n');
  }
  for (const c of CANDIDATES) {
    try {
      await recon(c);
    } catch (err) {
      console.log(`\n▸ ${c.name}\n  ✕ falhou: ${(err as Error).message}`);
    }
  }
}

main();
```

- [ ] **Step 2: Adicionar o script ao package**

Em `apps/worker/package.json`, dentro de `"scripts"`, acrescentar:

```json
    "recon": "dotenv -e ../../.env -- tsx scripts/recon-sources.ts",
```

- [ ] **Step 3: Rodar o reconhecimento**

Run: `pnpm --filter @forja/worker recon`
Expected: um bloco por query, com `brutos`, `chaves` e amostra. As queries invertidas mostram se o gateway é carregado como recurso (`chaves > 0`) ou apenas linkado (`chaves = 0`).

- [ ] **Step 4: Ajustar as fontes com o resultado**

Editar `packages/db/prisma/seed-sources.ts`, removendo as queries que renderam zero e acrescentando as invertidas que renderam bem. Reaplicar:

```bash
pnpm --filter @forja/db seed:sources
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/scripts/recon-sources.ts apps/worker/package.json packages/db/prisma/seed-sources.ts
git commit -m "Radar: script de reconhecimento das fontes de mineracao"
```

---

### Task 16: Limpeza e verificação final

**Files:**
- Modify: `packages/db/prisma/cleanup.ts`, `packages/db/prisma/wipe-offers.ts` (se referenciarem `saved`)
- Modify: `packages/db/prisma/seed.ts` (se referenciar `saved`)
- Modify: `.env.example`, `.env.prod.example`
- Modify: `README.md`

- [ ] **Step 1: Encontrar as referências mortas**

```bash
cd /Users/guilhermeaugusto/forja-os
grep -rn "saved\|ingestOffers\|INGEST_SCHEDULE_HOURS\|ingest-offers\|searchOffers" \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.example" \
  apps packages scripts README.md .env.example .env.prod.example 2>/dev/null | grep -v node_modules | grep -v dist
```

Expected: uma lista curta. Corrigir cada ocorrência:
- `saved` em seeds/scripts → trocar por `stage: 'analysis'`
- `ingestOffers` / `ingest-offers` → `harvest`
- `INGEST_SCHEDULE_HOURS` nos `.env*.example` → remover a linha e o comentário associado
- `searchOffers` → `searchPage`

- [ ] **Step 2: Atualizar o README**

Na seção que descreve o Radar, substituir a descrição da ingestão automática por:

```markdown
### Radar

Descoberta em três estágios de custo. A **colheita** (botão "Colher") varre as fontes
configuradas no urlscan, agrega os hits por chave e aplica um pré-filtro barato — sem
baixar nenhuma página e sem chamar a IA. Você **tria em massa** na tabela densa, mandando
cada candidato para a esteira, para análise ou para o descarte. Só então o
**enriquecimento** gasta download e IA, nas ofertas que você promoveu.

A ingestão não roda sozinha: é sempre disparada por ação humana.
```

- [ ] **Step 3: Verificação completa**

```bash
pnpm --filter @forja/worker test
pnpm --filter @forja/worker exec tsc --noEmit
pnpm --filter @forja/api exec tsc --noEmit
pnpm --filter @forja/types exec tsc --noEmit
pnpm build
```

Expected: testes passam, nenhum erro de tipo, build completo sem erro.

- [ ] **Step 4: Verificação de ponta a ponta**

Com `docker compose up -d`, api, worker e web rodando:

1. `/radar` → "Colher" → a barra de resumo enche com os contadores
2. Aba Triagem → marcar 5 linhas → "✕ Descartar" → somem
3. Uma linha → "?" → aparece em **Análise** como "⏳ Enriquecendo" → em segundos vira dossiê
4. No card → "Promover para a esteira" → o card sai da Análise
5. `/esteira` → a oferta está na coluna "Oferta base" → "Iniciar modelagem" abre o gerador
6. Voltar a `/radar` → "Colher" de novo → nenhum candidato já triado reaparece

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Radar: limpeza das referencias ao fluxo antigo de ingestao"
```

---

## Notas de verificação

**O que os testes automatizados cobrem:** toda a lógica pura do worker — normalização de URL e chave por tipo de fonte (Task 1), agregação e derivação de circulação (Task 3), pré-filtro e limiares (Task 4), parsing da resposta do urlscan e cursor (Task 5), cascata de resolução da página de vendas (Task 7).

**O que é verificado rodando a aplicação:** jobs BullMQ, camada Nest e telas. Cada tarefa dessas traz o passo de verificação com o comando exato e o resultado esperado. Não é equivalente a teste automatizado — é o que cabe nesta entrega sem montar uma stack de teste de integração e de browser, que seria um projeto à parte.

**Ordem de execução:** as tarefas 1–8 (worker) são independentes da web e podem ser feitas primeiro. Duas duplas não compilam isoladamente e precisam andar juntas: **9 + 10** (a API só fecha com o `CandidatesService`) e **12 + 13** (a página do Radar importa `AnalysisCards`). A Task 11 (tipos) precisa vir antes de 12–14.
