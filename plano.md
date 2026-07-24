# Forja OS — Plano de execução

Do scaffold atual até o app 100% funcional, em fases. Cada fase entrega algo utilizável e testável. As fases são incrementais: nada quebra o que já funciona.

Marcação: `[ ]` a fazer · `[~]` em andamento · `[x]` feito. O scaffold entregue já cobre a **Fase 0** e parte da **Fase 1**.

---

## Fase 0 — Fundações (feito no scaffold) ✅

- [x] Monorepo Turborepo + pnpm (web, api, worker, db, types)
- [x] Docker Compose local (Postgres + Redis)
- [x] Schema Prisma completo do domínio (Produto no centro; Radar, Gerador, Financeiro, Tráfego)
- [x] Seed com dados do protótipo
- [x] API Nest bootando com módulos (health, products, radar, finance, integrations, ai)
- [x] Web Next + HeroUI bootando, TopNav horizontal, dashboard servindo dados reais
- [x] Script de setup de um comando
- [ ] Infisical configurado para segredos (produção) — deixar `.env` só para dev
- [ ] Repositório Git inicializado + primeiro deploy no Coolify (staging)

**Critério de pronto:** `bash scripts/setup.sh && pnpm dev` sobe tudo e o dashboard mostra saldos e produtos do banco.

---

## Fase 1 — Núcleo de Produtos (esteira)

O coração do sistema. Tudo orbita o Produto.

- [x] Listagem de produtos (web + api)
- [x] Detalhe de produto com abas internas (esqueleto)
- [ ] CRUD completo de produto (criar, editar, arquivar) com validação (Zod nos DTOs)
- [ ] Kanban do pipeline com drag-and-drop entre etapas (validation → … → scaling)
- [ ] Portar a "Visão geral" interna do produto do protótipo (KPIs, situação, briefing editável)
- [ ] Wizard "+ Novo produto" do zero (sem oferta base)
- [ ] Persistir `brief` (persona, promessa, formato, ângulo) — é o que alimenta a IA depois

**Critério de pronto:** consigo criar um produto, movê-lo pelo pipeline e abrir seu detalhe com dados reais.

---

## Fase 2 — Entregáveis + primeiro uso de IA

- [ ] CRUD de entregáveis por produto, com checklist e status (todo/doing/review/done)
- [ ] Módulo `ai` no Nest: cliente Anthropic + prompts versionados por tipo de asset
- [ ] "✦ Gerar com IA" para copy de LP, e-mails, roteiro de VSL — usando o `brief` do produto
- [ ] Upload/link de arquivos de entregável (S3-compatível; MinIO local no compose)
- [ ] Barra de progresso de produção do produto derivada do checklist

**Critério de pronto:** gero a copy de um entregável com IA a partir do briefing e ela salva no produto.

---

## Fase 3 — Financeiro (o módulo mais sensível)

- [ ] Endpoint de webhook por gateway (`/webhooks/cakto`, `/stripe`, `/hotmart`) gravando `WebhookEvent` (idempotência por event id)
- [ ] Worker `process-webhook`: normaliza cada evento para `Transaction` via adapter por gateway
- [ ] Adapter Cakto (venda, reembolso, chargeback) + saldo
- [ ] Adapter Stripe (Payments + Balance/Payout)
- [ ] Job `sync-balances` a cada 15 min → `GatewayBalance`
- [ ] Conversão de câmbio (PTAX diário → `FxRate`); consolidação em BRL na leitura
- [ ] Financeiro consolidado (Visão geral) + financeiro por produto (aba) + DRE simplificado

**Critério de pronto:** uma venda de teste no gateway aparece no painel em segundos, com saldo e DRE atualizados.

---

## Fase 4 — Gerador de ofertas (modelagem por etapas)

- [ ] Modelo `OfferDraft` operacional + endpoints (criar, avançar etapa, salvar)
- [ ] Ingestão da oferta base: worker que busca a página de vendas (fetch + extração de texto) e analisa criativos (multimodal) → **raio-x** estruturado
- [ ] Cadeia de prompts encadeados: cada etapa recebe o `OfferDraft` acumulado + instrução do passo
  - [ ] Avatar & consciência
  - [ ] Grande ideia + mecanismo único (com diferenciação da base)
  - [ ] Estrutura da oferta (stack + preços)
  - [ ] Página de vendas (blocos)
  - [ ] Ângulos de criativo (hooks + roteiros no formato Higgsfield/Magnific)
  - [ ] Sequências de e-mail
- [ ] "Criar produto no pipeline": materializa entregáveis + funil + criativos a partir do draft

**Critério de pronto:** colo o link de uma oferta, avanço as 8 etapas e no fim gero um Produto já preenchido.

---

## Fase 5 — Tráfego (read-only primeiro)

- [ ] Integração Meta Marketing API (leitura de spend/resultados por campanha/adset/criativo)
- [ ] Integração TikTok Business API (leitura)
- [ ] Job `pull-ad-metrics` horário → `CampaignMetricDaily`
- [ ] Aba Tráfego do produto + visão consolidada (ROAS blended, CPA, alertas)
- [ ] Regras automáticas (registro + execução no worker, ou delegando ao n8n): pausar CPA alto, escalar ROAS bom
- [ ] (v1.1) escrita: pausar/escalar budget de fato

**Critério de pronto:** as campanhas reais aparecem com métricas atualizadas e os alertas disparam.

---

## Fase 6 — Portar o restante da UI do protótipo

Trazer o visual do protótipo para componentes HeroUI reais.

- [ ] Radar completo: 3 abas (ofertas mineradas, trends com sparklines, shortlist pontuada)
- [ ] Criativos: biblioteca com métricas por peça + sugestões da IA
- [ ] Funis: fluxo visual com conversão por passo + detecção de gargalo
- [ ] Detalhe de produto: todas as abas com dados reais
- [ ] Integrações: tela de conexões (status via API)
- [ ] Estados de loading/empty/erro consistentes; responsivo mobile

**Critério de pronto:** o app renderiza o que o protótipo mostra, com dados do banco.

---

## Fase 7 — Radar como motor (mineração real)

- [ ] Adapter Meta Ad Library (API oficial) → `Offer` (longevidade, nº de anúncios, criativos amostra)
- [ ] Adapter Google Trends → `TermTrend` (volume, crescimento, breakout, sazonalidade)
- [ ] Job `mine-offers` agendado; UI sempre lê do banco (nunca scraping ao vivo)
- [ ] Score de oportunidade (demanda × concorrência × margem) + calibração
- [ ] Adapters mais frágeis (TikTok Creative Center, marketplaces) — incrementais, isolados
- [ ] (opcional) Alertas proativos: nova oferta no seu nicho com 60+ dias no ar → Visão geral

**Critério de pronto:** o Radar se popula sozinho de fontes reais e destaca ofertas vencedoras.

---

## Fase 8 — Produção, qualidade e operação

- [ ] Autenticação (mesmo single-user no começo) + preparação para multiusuário/permissões
- [ ] Testes: unit (services), e2e (fluxos críticos: webhook→transação, gerador→produto)
- [ ] Observabilidade: logs estruturados, Uptime Kuma nos endpoints, alertas de falha de job
- [ ] Backups automáticos do Postgres (`pg_dump` diário → storage S3)
- [ ] CI (lint + typecheck + build) e deploy no Coolify (staging → prod)
- [ ] Rate limiting nos webhooks e nas rotas públicas

**Critério de pronto:** dá pra operar o negócio em cima do Forja com segurança e recuperação.

---

## Ordem recomendada e dependências

```
Fase 0 ─┬─▶ Fase 1 ─┬─▶ Fase 2 ─▶ Fase 4 (gerador usa IA da Fase 2)
        │           └─▶ Fase 3 (financeiro é independente, pode ir em paralelo)
        └─▶ Fase 6 (UI pode avançar junto, alimentada pelas fases de dados)
Fase 5 e 7 dependem de credenciais externas (Meta/TikTok/Trends) → começar assim que as chaves existirem.
Fase 8 é transversal — puxar itens dela já a partir da Fase 3.
```

Sugestão de foco para as primeiras semanas: **Fase 1 → Fase 3 → Fase 2 → Fase 4**. Isso entrega, em ordem, controle do pipeline, dinheiro entrando visível, IA produzindo assets e o gerador fechando o ciclo — o núcleo que gera valor mais rápido.

## Decisões em aberto (herdadas do protótipo)

1. **Funil:** só medição (páginas fora, Forja rastreia via pixel/UTM/webhook) ou builder que hospeda LP? O scaffold assume medição.
2. **Gerador:** etapas travadas (aprova para avançar) ou livres? O protótipo está livre; recomendação é híbrido (livre com aviso de dependência).
3. **Radar:** alertas proativos na Visão geral ou só sob demanda?
4. **Nome do topo:** "Visão geral" vs. "Estúdio" para não colidir com a "Visão geral" interna do produto.
