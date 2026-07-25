# Radar: triagem em massa e esteira de modelagem

Data: 2026-07-24
Status: aprovado no brainstorming, pronto para virar plano de implementação

## Problema

O Radar hoje gasta o recurso caro no lugar errado. O job `ingestOffers` roda, para **cada**
candidato vindo do urlscan, um download da página (`fetchAndExtract`) e uma chamada de LLM
(`extractXray`), e só então aplica os gates de qualidade. O que não passa é descartado e some —
sobra apenas uma linha em `IngestionRun.events`.

Duas consequências:

1. **Não escala.** A fonte (`https://urlscan.io/search/#cdn.utmify.com.br`) tem mais de 10.000
   links. Varrer 5.000 custaria 5.000 downloads e 5.000 chamadas de LLM para entregar algumas
   dezenas de ofertas.
2. **O humano decide por último.** A curadoria é binária (`Offer.saved`) e só alcança o resíduo
   que a máquina já filtrou.

Além disso a ingestão roda sozinha a cada 6h (`INGEST_SCHEDULE_HOURS`, `apps/worker/src/index.ts`),
o que torna o custo contínuo e não observável.

## Objetivo

Inverter a economia do funil: **milhares de candidatos custam ~zero, o humano tria em massa, e a
IA só encosta no que foi promovido.** Em seguida, dar destino claro ao que foi promovido através
de duas filas — Análise e Esteira.

## Decisões tomadas

| Decisão | Escolha |
|---|---|
| Ordem IA × humano | Humano primeiro; IA só depois da promoção |
| Pré-filtro | Só o que passa nas heurísticas baratas chega à triagem; descartes auditáveis |
| Filas | Duas separadas: **Análise** (backlog) e **Esteira** (execução) |
| O que é a esteira | Modelagem de oferta (`OfferDraft`), não ciclo de vida do produto |
| Rodadas | Pool acumulativo; nada já triado reaparece |
| Fila de Análise | Enriquecimento automático dispara ao entrar |
| Modelo de dados | `Candidate` separado de `Offer` |
| Layout da triagem | Tabela densa com ação em lote |
| Ingestão | Exclusivamente manual |
| Navegação | Esteira ganha rota própria (`/esteira`); Radar fica com descoberta e triagem |

## Arquitetura: 5 estágios de custo crescente

```
1. Colheita          custo ~zero      milhares de URLs
   urlscan search paginado + agregação por chave, dedupe contra o pool, cursor persistido
        ↓
2. Pré-filtro        custo ~zero      corta a maior parte
   blocklist de categoria + ausência de circulação — descarte gravado com motivo
        ↓
3. Triagem (humano)  seu tempo        tabela densa + lote
   → Esteira · ? Análise · ✕ Descarte
        ↓
4. Enriquecimento    fetch + LLM      só o promovido
   fetchAndExtract → extractXray → getDomainActivity → fetchTrend → computeTraffic/computeScore
        ↓
5. Filas (humano)
   Análise: dossiê pronto, promove ou descarta
   Esteira: OfferDraft por etapa
```

A mudança de fundo: numa rodada de 500 links, hoje são 500 downloads + 500 chamadas de LLM para
você ver ~20 ofertas. No desenho novo os 500 custam ~zero, você tria e promove ~30 — 30 downloads
e 30 chamadas de LLM. É o que permite que a rodada passe a ser de milhares de links.

### Consequência aceita: gates viram sinais

Os gates que hoje matam o candidato antes de você ver — `looksLikeSalesPage`,
`xray.productType !== 'digital'`, `sem-trafego` — dependem do download e da IA, que agora rodam
depois da sua decisão. Eles não desaparecem: passam a ser **alertas** exibidos na fila de Análise
(`a IA diz que é produto físico`, `não parece página de vendas`, `sem sinal de tráfego`), e você
confirma o descarte com um clique.

Continuam sendo descarte automático apenas as regras que custam zero, porque operam sobre dados
que a própria varredura já devolveu:

- **Blocklist de categoria** (`isBlockedCategory`, já existe) aplicada a domínio, título e nome do
  produto.
- **Ausência de circulação**: `hitCount` abaixo do limiar da fonte **e** `lastSeenAt` mais velho
  que a janela da fonte. Os dois limiares são campos de `HarvestSource`, porque uma fonte de
  checkout circula em volume diferente de uma fonte de recurso — nascem em `1` e `90 dias`
  (praticamente inertes) e são calibrados com o pool real, olhando a aba de descartados.

Não há verificação de "domínio morto" no pré-filtro: ela exigiria uma requisição HTTP por
candidato, o que em milhares de itens deixa de ser custo zero. Página fora do ar é detectada no
enriquecimento, onde o download já acontece, e vira o alerta `sem-conteudo`.

## Fontes de mineração

`HarvestSource` é uma lista configurável de queries urlscan, cada uma com seu cursor. A fonte atual
**permanece**. Existem dois tipos, com comportamento oposto:

| | Fonte de **recurso** | Fonte de **checkout** |
|---|---|---|
| Exemplos | `cdn.utmify.com.br`, `cdn.converteai.net`, `cdn.pandavideo.com.br`, `klickpages.com.br` | `pay.cakto.com.br`, `pay.kirvano.com`, `pay.ticto.com.br` |
| `page.domain` do scan | é a página de vendas | é o gateway, igual para milhares de ofertas |
| Chave do candidato | `page.domain` | `page.url` |
| Já vem de graça | domínio, título, screenshot | **nome do produto, preço, gateway** |
| Falta | preço | a página de vendas |

O motivo de `domain:cdn.utmify.com.br` funcionar é que no urlscan `domain:` casa com qualquer
domínio contatado no scan, enquanto `page.domain:` é a página principal — a utmify entra como
recurso, então `page.domain` é a página de vendas. Para checkouts a página escaneada é o próprio
gateway, daí a chave ser a URL.

**Volume**: verificado empiricamente pelo usuário — o volume das fontes de checkout é
**consideravelmente menor** que o da utmify. Não há necessidade de limite por rodada nem de
ordenação especial para elas; entram no mesmo fluxo das demais. Não reintroduzir essa trava.

### Resolução da página de vendas a partir do checkout

Executada no enriquecimento (etapa 4), apenas nos promovidos, em cascata:

1. `task.referer` do resultado urlscan — custo zero, já vem na busca.
2. Download do checkout e busca do link de volta: `og:url`, `href` do logo, "termos de compra",
   domínio do produtor no rodapé.
3. Busca reversa no pool pelo nome do produto, cruzando com `page.title` de candidatos já colhidos
   — tende a acertar porque a página de vendas provavelmente já foi colhida pela utmify.
4. Falha: a oferta segue viva com checkout, nome, preço e screenshot, marcada
   `página de vendas não localizada`, resolvível à mão.

Quanto maior o pool vindo das fontes de recurso, mais checkouts se casam sozinhos com sua página
de vendas.

### Reconhecimento de fontes

Antes de fixar a lista, um script de reconhecimento roda cada query candidata, conta quantos
`page.domain` (ou `page.url`) distintos ela rende e mostra uma amostra. As que renderem lixo ou
zero ficam de fora. Isso vale também para a forma invertida
(`domain:X AND NOT page.domain:X`), cuja eficácia depende de o gateway ser embutido como recurso
e não apenas como link — link não gera requisição e o urlscan não registra.

## Modelo de dados

### Novo: `Candidate`

Pool acumulativo, barato, cresce para dezenas de milhares de linhas.

```prisma
model Candidate {
  id            String   @id @default(cuid())
  sourceId      String                  // HarvestSource
  dedupeKey     String   @unique        // page.domain (resource) | page.url (checkout)
  url           String
  domain        String
  title         String?
  screenshotUrl String?
  productName   String?                 // fontes de checkout
  priceCents    Int?                    // fontes de checkout
  gateway       String?                 // fontes de checkout
  hitCount      Int      @default(1)    // nº de hits na varredura — proxy de circulação
  firstSeenAt   DateTime?
  lastSeenAt    DateTime?
  daysRunning   Int      @default(0)
  status        CandidateStatus @default(pending)
  discardReason String?
  triagedAt     DateTime?
  firstRunId    String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

enum CandidateStatus { pending discarded_auto discarded_manual promoted }
```

`dedupeKey` único é o que garante "nunca repete" no banco, e não em lógica de aplicação.
A ligação com a oferta promovida vive num lado só: `Offer.candidateId @unique`.

### Novo: `HarvestSource`

```prisma
model HarvestSource {
  id       String   @id @default(cuid())
  name     String
  query        String   @unique
  kind         HarvestKind          // resource | checkout
  enabled      Boolean  @default(true)
  cursor       String?              // search_after do urlscan
  minHitCount  Int      @default(1)   // limiar do pré-filtro de circulação
  maxAgeDays   Int      @default(90)  // idem
  lastRunAt    DateTime?
}

enum HarvestKind { resource checkout }
```

O cursor vive na própria fonte — cada rodada continua de onde a anterior parou em vez de
re-varrer o topo dos 10.000.

### Alterado: `Offer`

Deixa de ser "tudo que foi minerado" e passa a ser "oferta que você promoveu".

```prisma
  candidateId     String?  @unique
  stage           OfferStage      @default(analysis)   // analysis | pipeline | discarded
  enrichment      EnrichmentState @default(pending)    // pending | running | done | failed
  enrichmentError String?
  alerts          Json?    // ['produto-fisico', 'nao-e-pagina-de-vendas', 'sem-trafego',
                           //  'sem-conteudo', 'pagina-de-vendas-nao-localizada']
```

O campo `saved Boolean` é removido; `shortlist()` passa a filtrar por `stage`.

### Alterado: `IngestionRun`

Contadores refletem o novo fluxo: `rawHits`, `newCandidates`, `autoDiscarded`, `queuedForTriage`.
Os campos `savedCount` / `discardedCount` perdem sentido, porque salvar e descartar viraram
decisão humana fora da rodada.

### Inalterado: `OfferDraft`

É a esteira. Criado quando a oferta entra em `stage: pipeline`. `currentStep` já modela a posição.

## Colheita: agregar em vez de descartar

Hoje `searchOffers` deduplica por domínio e **joga fora** os hits repetidos — que são justamente
o sinal de circulação. Esse dado é recomprado depois com uma chamada extra por domínio
(`getDomainActivity`), o que em milhares de domínios estoura o rate limit do urlscan e deixa de
ser custo zero.

Correção: agrupar os hits pela chave da fonte e derivar de graça, na mesma varredura:

- `hitCount` = quantidade de hits
- `firstSeenAt` / `lastSeenAt` = min/max de `task.time`
- `daysRunning` = diferença entre os dois

A contagem precisa via `getDomainActivity` fica para o enriquecimento, onde roda em dezenas de
itens.

## Telas

### Radar › Triagem

- **Topo**: botão **Colher** com seletor de fonte (ou "todas"); resumo da última rodada —
  `3.412 varridos · 287 novos · 241 descartados pelo filtro · 46 na fila`.
- **Tabela densa**: `[✓] · screenshot · domínio/título · dias no ar · hits · sinais · decisão`.
  Em candidatos de checkout a coluna central mostra **produto + preço** e um selo do gateway.
- Ordenável por qualquer coluna; filtros por fonte, mercado e faixa de dias no ar.
- Ação em lote na barra superior, aplicada aos marcados.
- Por linha: ✓ Esteira · ? Análise · ✕ Descarte. A linha sai da fila na hora, com **desfazer**
  disponível por alguns segundos.
- **Aba "Descartados pela máquina"**: o que o pré-filtro matou, com o motivo e um botão para
  devolver à fila. É o que impede o filtro de virar caixa-preta.

### Radar › Análise

Cards, não tabela — aqui se lê, não se varre. Cada card traz o dossiê do enriquecimento: promessa,
mecanismo, ticket, nicho, score, trend, sinais de tráfego e os **alertas**. Duas ações: promover
para a esteira ou descartar. Enquanto o job roda, o card aparece em estado "enriquecendo".

### /esteira

Rota própria no menu principal. Board por etapa da modelagem — raio-x → avatar → big idea → stack
→ copy → criativos → e-mails —, alimentado por `OfferDraft.currentStep`. Cada coluna mostra as
ofertas paradas naquela etapa; clicar abre o gerador no passo certo. A coluna **é** a tarefa
pendente.

### Radar › Trends

Sem alteração.

## API

```
POST   /radar/harvest              { sourceId? }  → IngestionRun     (dispara a colheita)
GET    /radar/runs, /radar/runs/:id                                   (mantidos)
GET    /radar/candidates           ?status&source&market&sort&cursor
PATCH  /radar/candidates/:id       { decision: 'pipeline'|'analysis'|'discard' }
POST   /radar/candidates/bulk      { ids[], decision }
GET    /radar/candidates/discarded ?reason
POST   /radar/candidates/:id/restore
GET    /radar/offers               ?stage
PATCH  /radar/offers/:id           { stage }
GET    /radar/sources / POST / PATCH
```

A listagem de candidatos é paginada por cursor — a fila pode ter centenas de itens e a tabela
carrega por bloco.

## Jobs

| Fila | Job | Dispara quando |
|---|---|---|
| `harvest` | varre a fonte, agrega, aplica pré-filtro, grava `Candidate` | botão Colher |
| `enrich` | download + raio-x + tráfego + trend + score + resolução da página de vendas | promoção de um candidato |

O agendamento periódico (`INGEST_SCHEDULE_HOURS`) é removido de `apps/worker/src/index.ts`.
O job `enrich` é idempotente por `offerId` e grava `enrichment: failed` + `enrichmentError` em vez
de estourar, para que a falha apareça na tela em vez de sumir no log.

## Tratamento de erros

- **Rate limit do urlscan na colheita**: a rodada para com o que já tem, grava
  `IngestionRun.status = 'partial'` e o cursor avança até onde deu. A próxima rodada continua dali
  — nada se perde.
- **Falha de download no enriquecimento**: a oferta fica em `enrichment: failed` com o motivo
  visível no card, e um botão "tentar de novo".
- **Falha da IA**: idem, sem derrubar os outros campos já preenchidos.
- **Desfazer na triagem**: a decisão é aplicada imediatamente, mas o job de enriquecimento entra
  com um atraso curto; desfazer dentro da janela cancela o job e devolve o candidato a `pending`.

## Testes

- **Colheita**: agregação por chave produz `hitCount`/`firstSeenAt`/`lastSeenAt` corretos a partir
  de um payload urlscan de exemplo; dedupe contra o pool não recria candidato já triado; cursor
  avança e a rodada seguinte não repete resultados.
- **Chave por tipo de fonte**: fonte `resource` chaveia por `page.domain`, fonte `checkout` chaveia
  por `page.url` — o teste que garante que mil checkouts não colapsam num candidato.
- **Pré-filtro**: blocklist e ausência de circulação descartam com o motivo certo, respeitando os
  limiares da fonte; nada mais é descartado automaticamente.
- **Triagem**: decisão individual e em lote movem o candidato e criam a `Offer` no `stage` certo;
  desfazer dentro da janela reverte e cancela o enriquecimento.
- **Enriquecimento**: preenche os campos e traduz cada gate reprovado no alerta correspondente,
  sem descartar a oferta; falha grava `failed` + mensagem.
- **Resolução da página de vendas**: cada degrau da cascata é testado isoladamente e o degrau 4
  marca o alerta em vez de falhar.

## Fora de escopo

- Meta Ad Library como fonte. É a fonte com o melhor dado (dias que o anúncio realmente roda,
  quantidade de criativos no ar), mas exige adapter próprio, autenticação e tem cobertura parcial
  de anúncios comerciais no BR. Fase 2, depois que o funil de triagem estiver rodando.
- Esteira de ciclo de vida do produto (`Product.stage`: validação → produção → funil → lançamento
  → escala). Depende de módulos que ainda não existem.
- Re-visita automática de candidatos descartados quando os sinais mudam.
