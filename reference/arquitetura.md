# Forja OS — Arquitetura v1

Central de operação de produtos digitais low ticket globais. Um único painel que cobre a esteira inteira: descoberta → produto → entregáveis → funil → criativos → tráfego → financeiro. Documento inicial para discussão; nada aqui é definitivo.

## Conceito central: a esteira

O sistema inteiro é organizado em torno de uma entidade só — o **Produto** — que atravessa cinco estágios: Radar (oportunidade), Validação, Produção, Funil/Lançamento e Escala. Todos os módulos são "lentes" sobre essa mesma entidade. Isso é o que faz tudo conversar: um criativo pertence a um produto, uma campanha aponta para um funil, uma transação referencia um produto e uma etapa do funil. Nenhum módulo é uma ilha.

O fluxo guiado ("Novo produto") é um wizard de 5 passos que cria o produto e já semeia os registros filhos: checklist de entregáveis sugerido pela IA, esqueleto de funil (LP + checkout + bump + upsell) e ângulos de criativo. O usuário nunca começa de uma tela em branco.

## Stack

**Frontend:** Next.js 14 (App Router) + HeroUI + Tailwind CSS. HeroUI cobre ~90% dos componentes (Table, Card, Chip, Modal, Tabs, Select, Progress); o que for custom (kanban, funnel builder, score ring) vira componente próprio usando os tokens do tema HeroUI para manter consistência. TanStack Query para cache de dados, Zustand para estado de UI leve. Recharts para gráficos.

**Backend:** NestJS + PostgreSQL 16 + Prisma. Cada módulo do painel é um módulo Nest (`radar`, `products`, `deliverables`, `creatives`, `funnels`, `traffic`, `finance`, `integrations`) — organização espelhada entre front e back, fácil de manter sozinho e fácil de escalar contratando depois. REST simples com OpenAPI gerado automaticamente; sem GraphQL nessa fase.

**Jobs e sincronização:** Redis + BullMQ. Tudo que é integração externa roda em worker, nunca no request: sync de saldo dos gateways (a cada 15 min), pull de métricas do Meta/TikTok (a cada hora), conversão de câmbio (PTAX diário), regras automáticas de tráfego. Webhooks de pagamento entram por endpoint dedicado, gravam o evento bruto numa tabela `webhook_events` (idempotência por event id) e um worker processa.

**Infra:** seu VPS atual com Coolify. Três serviços: `forja-web` (Next), `forja-api` (Nest), `forja-worker` (BullMQ), mais Postgres e Redis gerenciados pelo Coolify. Segredos no Infisical, monitoramento no Uptime Kuma — encaixa direto no que você já roda. Backups do Postgres com `pg_dump` diário para storage S3-compatível.

**IA:** Anthropic API server-side para geração de copy, roteiros, análise de gargalo de funil e sugestões de criativo. Um serviço `ai` no Nest centraliza prompts versionados por tipo de asset, sempre alimentados pelo briefing do produto (persona, promessa, ticket, mercado, idioma).

## Modelo de dados (núcleo)

```
Opportunity   id, title, market, niche, score, demand, competition,
              ticket_range, source_notes, status(open|promoted|discarded)

Product       id, name, market, currency, price_cents, gateway, stage
              (validation|production|funnel|launch|scaling|paused),
              brief{persona, promise, angle}, opportunity_id?

Deliverable   id, product_id, type(main|bonus|copy|email|vsl|mockup|bump|upsell),
              title, status(todo|doing|review|done), ai_generated, file_url?

Funnel        id, product_id, name, status(draft|published)
FunnelStep    id, funnel_id, position, type(ad|advertorial|lp|checkout|
              bump|upsell|thankyou), config jsonb, url?

Creative      id, product_id, name, format(9x16|1x1|16x9), kind(video|static),
              hook, status(draft|approved|running|paused), platform

Campaign      id, product_id, funnel_id, platform(meta|tiktok|google),
              external_id, name, status, daily_budget_cents
CampaignMetricDaily  campaign_id, date, spend, clicks, purchases, cpa, roas

Transaction   id, product_id, gateway, external_id, type(sale|refund|chargeback),
              method(pix|card|boleto), amount_cents, currency, fee_cents,
              status, funnel_step_id?, occurred_at
GatewayBalance  gateway, available_cents, pending_cents, currency, synced_at

Integration   id, provider, status, credentials_ref (Infisical path), meta jsonb
WebhookEvent  id, provider, external_event_id, payload jsonb, processed_at
```

Tudo em centavos e com moeda explícita; consolidação em BRL é feita na leitura com a taxa do dia (tabela `fx_rates`), nunca gravada por cima do valor original.

## Integrações por módulo

O Financeiro é o módulo mais sensível: Cakto e Kirvano entram por webhook (venda, reembolso, chargeback) mais polling de saldo; Stripe por webhook + Balance/Payout API; Hotmart por webhook + API de vendas. Estratégia unificada: cada provider tem um adapter que normaliza para o formato interno de `Transaction`, então o resto do sistema não sabe de qual gateway veio nada.

O Tráfego usa Meta Marketing API e TikTok Business API só para leitura de métricas na v1 (spend, resultados por campanha/adset/criativo). Ações de escrita (pausar, escalar budget) entram na v1.1 via as regras automáticas — que podem rodar no próprio worker ou delegar para o n8n que você já tem, com o painel só registrando e exibindo as execuções.

## Radar — motor de mineração de ofertas

O Radar deixa de ser uma lista curada e passa a ser um motor de descoberta com três frentes que se alimentam:

**Mineração de ofertas.** Adapters coletam ofertas em veiculação de fontes públicas — Meta Ad Library, TikTok Creative Center — e de rankings de marketplace (Hotmart mais vendidos, ClickBank Gravity). Para cada oferta descoberta o motor guarda anunciante, mercado, nicho, ticket estimado, ângulo dominante e, principalmente, **longevidade** (dias no ar) e **volume de peças ativas**. A tese é simples: anúncio que roda há muito tempo com muitas variações é oferta que está lucrando — vale engenharia reversa. É o sinal mais forte e barato de "produto vencedor".

**Trends de termos.** Monitoramento de volume de busca e velocidade de crescimento por termo e mercado, com detecção de breakout (aceleração súbita) e sazonalidade. Fonte primária Google Trends; complementável com dados de volume de terceiros. Isso responde "a demanda está subindo ou já passou?".

**Shortlist pontuada.** O que você salva da mineração cai numa shortlist onde o motor calcula um score de oportunidade combinando demanda (trend), concorrência (nº de ofertas ativas no nicho/mercado), margem (faixa de ticket vs. custo estimado de tráfego) e saturação. Da shortlist, um clique promove a oportunidade a Produto pelo wizard, já com briefing pré-preenchido.

### Considerações técnicas do motor

Coleta roda 100% em worker, agendada, nunca no request — é a parte mais frágil do sistema e não pode derrubar o resto. Cada fonte é um adapter isolado atrás de uma interface comum (`discoverOffers()`, `fetchTrend()`), então quebrar um scraper não afeta os outros. Resultados são normalizados para as tabelas `Offer` e `TermTrend` e cacheados; a UI sempre lê do banco, nunca dispara scraping ao vivo.

```
Offer       id, source(meta|tiktok|hotmart|clickbank), advertiser, name,
            market, niche, ticket_est_cents, angle, first_seen, last_seen,
            days_running, active_ads_count, sample_creatives jsonb, saved bool
TermTrend   id, term, market, volume_monthly, growth_90d, growth_12m,
            status(breakout|rising|stable|seasonal|declining),
            series jsonb (pontos p/ sparkline), seasonality_note
```

Pontos de atenção honestos: bibliotecas de anúncios têm termos de uso e rate limits — a Meta Ad Library tem API oficial (melhor caminho); TikTok e scraping de marketplace são mais sensíveis e podem exigir rotação/serviços de terceiros. A recomendação para a v1 é começar pela Ad Library oficial da Meta + Google Trends (as duas fontes com API legítima) e ir adicionando o resto com cautela. A pontuação de oportunidade é heurística e deve ser calibrada com os seus próprios resultados ao longo do tempo — o score inicial é um ponto de partida, não verdade absoluta.

Por isso a fase original muda: **Radar sai do "v2" e ganha um núcleo já na v1** (Meta Ad Library + Trends + shortlist manual pontuada), com as fontes mais frágeis entrando de forma incremental.

## Gerador de ofertas — o motor de modelagem

É a ponte entre achar uma oferta vencedora (Radar) e ter um produto pronto pra lançar. Em vez de um formulário único, é um workspace em etapas onde o contexto acumula: cada passo é gerado pela IA usando a oferta base mais tudo que já foi produzido nos passos anteriores. Você entra com o que tem da oferta de referência (link da página de vendas, criativos, anotações) e sai com a oferta inteira modelada — adaptada, não copiada.

As oito etapas: (1) Oferta base — ingestão do link + criativos, e a IA extrai um "raio-x" da oferta (promessa, mecanismo, avatar, dor, garantia, ângulo vencedor); (2) Avatar & consciência; (3) Grande ideia + mecanismo único; (4) Estrutura da oferta — principal, bump, upsell, garantia, precificação; (5) Página de vendas — copy completa em blocos; (6) Ângulos de criativo com hooks e roteiros; (7) E-mails e sequências; (8) Revisão & lançar, que transforma tudo num Produto com entregáveis, funil e criativos já preenchidos.

O princípio de UX é dar o máximo de contexto à IA e mantê-lo visível: um painel lateral fixo mostra a oferta base e o contexto acumulado, reforçando que nada é gerado no vácuo.

### Como isso funciona por baixo

O serviço `ai` do Nest ganha um sub-fluxo de "modelagem de oferta" que é essencialmente uma cadeia de prompts encadeados, cada um recebendo o estado acumulado da oferta (um objeto `OfferDraft` em jsonb que cresce a cada etapa). A ingestão da oferta base é o passo mais técnico: um worker busca a página de vendas (fetch + extração de texto legível), lê os criativos de referência (transcrição de vídeo / análise de imagem via modelo multimodal) e produz o raio-x estruturado. A partir daí cada etapa é uma chamada ao modelo com o `OfferDraft` inteiro no contexto e uma instrução específica do passo.

```
OfferDraft   id, product_id?, source_offer_id?, status(modeling|ready|launched),
             base{sales_page_url, creatives[], notes, xray jsonb},
             avatar jsonb, big_idea jsonb, stack jsonb, sales_copy jsonb,
             creative_angles jsonb, email_sequences jsonb, current_step int
```

Ponto importante de produto e de ética: o gerador **modela** a partir de uma referência, não clona. O raio-x captura a estrutura e a lógica da oferta vencedora (o que faz funcionar), e a geração produz posicionamento, mecanismo e copy próprios — inclusive é onde entra a diferenciação (na etapa 3, a "grande ideia" é deliberadamente construída para não competir de igual com a base). Copiar página e criativos alheios ao pé da letra é risco jurídico e de conta; o valor do gerador é destilar o padrão e recriar com identidade própria.

O gerador é acessível a partir do Radar — tanto das ofertas mineradas ("Modelar") quanto da shortlist pontuada. O "+ Novo produto" continua existindo como caminho do zero, sem oferta base, para quando a ideia não vem de uma referência.

## Fases sugeridas

**v1 (4–6 semanas de escopo):** Produtos + pipeline, Entregáveis com geração IA, Financeiro com Cakto + Stripe (webhooks + saldo), Funis como registro/medição (sem page builder — as páginas continuam onde estão, o Forja mede via pixel/UTM/webhook), Dashboard consolidado.

**v1.1:** Tráfego read-only (Meta + TikTok), Criativos com biblioteca e métricas por peça, alertas.

**v2:** Regras automáticas de tráfego com escrita, Radar automatizado, page builder de LP se fizer sentido (ou integração com o que você já usa), multi-usuário/permissões.

## Pontos abertos para discutirmos

O funil deve ser só medição (páginas hospedadas fora, Forja rastreia) ou builder completo (Forja hospeda LP e checkout redireciona)? A v1 assume medição — muito mais barato de construir e não compete com Cakto/checkout dos gateways. Segundo ponto: o Radar vale investimento em automação cedo, ou a curadoria manual assistida por IA resolve por meses? Terceiro: mono-repo (Turborepo com web + api + worker) ou repositórios separados? Minha sugestão é mono-repo pela facilidade de compartilhar tipos entre Nest e Next.
