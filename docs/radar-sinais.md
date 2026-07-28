# Sinais de escala — como o Radar separa oferta de lixo

Data: 2026-07-26 · Status: implementado; pesos calibráveis

## O princípio que governa

**Fase não descarta. Categoria sim.**

Uma oferta boa pode viver num `lovable.app`, num `vercel.app`, num template
capenga — é assim que oferta em validação se parece, e antecipá-la é vantagem
competitiva, não defeito. Por isso o filtro **nunca** julga a cara da página:
hospedagem gratuita, TLD barato e título de template não descartam nada.

O que descarta, automaticamente e sempre de forma reversível (aba "descartados
pela máquina"):

| Razão | O que é | Permanente? |
|---|---|---|
| `golpe-phishing` | blocklist textual de golpe ("consulta cpf", "recarga free fire", "gov.br", "leilão"...) | sim — categoria |
| `delivery-comida` | blocklist de restaurante/delivery | sim — categoria |
| `malicioso-urlscan` | veredito de malicioso do próprio urlscan no scan da página | sim — categoria |
| `loja-ecommerce` | plataforma de loja contatada (Shopify, Nuvemshop, VTEX, Loja Integrada, Tray) ou marketplace linkado (Shopee, Mercado Livre, Amazon, Magalu, AliExpress) | sim — categoria |
| `pagina-fora-do-ar` | página com HTTP ≥ 400 no momento do scan (`page.status`) | sim — categoria |
| `sem-sinal-trafego` | **medido** com zero pixel, tracker e player | sim* |
| `sem-circulacao` | último scan mais velho que a janela da fonte | **não — temporal**: re-avistamento recente ressuscita o candidato sozinho |

**Loja e página morta** são detectadas de graça no MESMO retrieve do signal pass:
`cdn.shopify.com` aparece limpo em `lists.domains`; o marketplace linkado em
`lists.linkDomains`; o status HTTP em `page.status`. O pixel é sinal
*necessário, não suficiente* — loja e VSL de físico também rodam pixel, então
subiam no ranking; a regra de categoria as tira da fila sem desligar o pixel
como sinal de ordenação para o que é infoproduto. `wix`/`webflow` **não** contam
como loja (site-builder genérico hospeda infoproduto — falso positivo). Produto
físico "puro" em domínio próprio não tem sinal barato confiável e segue para o
enriquecimento, onde o alerta `produto-physical` da IA o pega.

**Por que o JSON de sinais guarda `storefronts`, `marketplaces` e `httpStatus`
mesmo quando não descarta:** para que uma mudança de regra futura reavalie o
backlog por `recompute` (sem rede) em vez de gastar retrieve. Os já medidos
ANTES dessas regras não têm `httpStatus` no JSON — o modo
`backfill:signals --recheck-category` faz o re-retrieve deles (barato, <1k na
cota de 10k/dia) e grava os campos novos.

*Decisão de produto: candidato medido sem nenhuma evidência de investimento sai
da fila. Reversível como os demais.

## Dá para medir "volume de tráfego" da página? (a pergunta original)

Diretamente, não — nenhuma fonte gratuita entrega visitantes/mês de um domínio
pequeno. O que É mensurável, de graça, são três proxies que juntos separam
oferta escalada de página morta:

1. **Evidência de investimento** — pixels de anúncio (Meta, TikTok, Google,
   Kwai, Pinterest, Taboola), tracker de atribuição (utmify) e player de VSL
   instalados na página. Ninguém instala atribuição sem gastar em tráfego.
   Fonte: `lists.domains` do retrieve do urlscan — a lista de domínios que a
   página **contatou** durante o scan. Zero download, zero LLM.
2. **Velocidade de atenção** — scans/dia no urlscan. Página com tráfego é mais
   escaneada (verificadores, extensões, curiosos).
3. **Persistência** — oferta que roda há semanas foi validada por quem paga a
   conta dela.

Nota honesta: pixel é sinal **necessário, não suficiente** — medimos que só
~32% do lixo de golpe cai quando se exige pixel Meta (golpista também anuncia).
Por isso golpe sai por blocklist de categoria, e o pixel serve para **ordenar**,
não para aprovar.

## O score (0–100) e as tags

Pesos em `apps/worker/src/lib/scaleSignalScore.ts` (calibráveis num lugar só):

| Componente | Pontos | Por quê |
|---|---:|---|
| Pixel Meta / TikTok | 25 cada | canais dominantes de escala BR |
| Pixel Google | 10 | GTM/GA são onipresentes — falso positivo alto |
| Kwai / Pinterest / Taboola | 15 cada | canais pagos menos comuns = sinal mais específico |
| teto do bloco de pixels | 40 | tag-soup não domina o score |
| multi-canal (2+ plataformas) | +10 | orçamento real, não teste |
| tracker de atribuição | 15 | dinheiro em jogo |
| player de VSL | 10 | infra paga de vendas |
| checkout linkado | +5 | confirma página de vendas |
| velocidade (scans/dia, satura em 1/dia) | 0–15 | circulação intensa |
| persistência (satura em 60d) | 0–10 | segue viva |
| último scan >30d | ×0,8 | sinal velho vale menos, não zera |
| origem = scan de checkout | ×0,7 no bloco de pixels | pixel no gateway é sinal parcial |

Tags exibidas na triagem:
- **⚡ escalando-agora** — domínio com ≤45 dias + pixel + ≥0,5 scan/dia. É a
  oferta jovem que já investe: a antecipação que o produto quer.
- **✓ comprovada** — 60+ dias rodando com pixel.
- **multi-canal** — 2+ plataformas de pixel.

## Spray de TLD (colapso na triagem)

Pixel é necessário, não suficiente — um funil cinza (ex.: `unlockprofile` /
`tryreportprofiler`, "veja quem viu seu perfil") compra tráfego Meta/TikTok e,
no nível de domínio, é idêntico a infoproduto legítimo. O tell que o separa é
operacional: a MESMA oferta espalhada em vários TLDs descartáveis
(`contahoje.{click,sbs,lat,cfd,lol,cyou}`) para queimar domínio e escapar de ban
de conta de anúncio.

Detecção (fase não descarta, estrutura sim — aqui a estrutura é o padrão de
domínio, não a cara da página):

- `Candidate.baseDomain` = nome registrável **sem** sufixo (SLD), via `tldts`
  com **`allowPrivateDomains: true`**. A flag é obrigatória: sem ela, todo site
  em `pages.dev`/`vercel.app`/`netlify.app`/`lovable.app`/`myshopify.com`
  (seção PRIVADA da PSL) colapsaria num único nome-base falso ("pages" ×179),
  sumindo com ofertas distintas. Só populado para fonte **resource** (checkout é
  keyado por URL; o domínio é o gateway → `null`).
- **Spray = mesmo `baseDomain` em ≥ 2 REGISTRÁVEIS distintos** (`getDomain`, com
  sufixo). O corte é por registráveis, não por candidatos: subdomínios de um
  mesmo registrável (`fra./esp.safefamilymonitor.com`) ou vários sellers numa
  plataforma compartilhada (`x./y.mundoactivo.online`) contam como 1 e **não**
  são spray — colapsá-los sumiria com ofertas distintas.

Na fila de triagem (só `pending`) o grupo **colapsa** em 1 representante (maior
`signalScore`; desempate `hitCount` desc, `id` asc), com chip `⚠ N TLDs` e ação
"descartar grupo" (reusa o descarte em lote sobre todos os irmãos). Não mexe no
score — ordena por evidência, e o humano decide. Índice `[status, baseDomain]`.
Backfill: `backfill:signals --backfill-base` (sem rede, idempotente).

## Contrato null ≠ 0

`signalScore null` = **não medido** (retrieve não rodou/expirou). `0` = medido
e sem nada. A UI mostra "—" vs "0"; o sort põe os não-medidos por último; o
descarte por `sem-sinal-trafego` só se aplica a MEDIDOS. Confundir os dois
descartaria candidatos por falha de infraestrutura.

## Economia

- Retrieve: cota própria de **10.000/dia** (a busca tem 1.000/dia e é dividida
  com a VPS). 1 retrieve por candidato inédito; golpe/comida descartados pelo
  pré-filtro **não gastam retrieve**.
- Harvest: orçamento `SIGNAL_MAX_RETRIEVES_PER_HARVEST` (default 300) por
  rodada; o excedente fica não-medido e o backfill completa.
- Backfill: `pnpm --filter @forja/worker backfill:signals -- --budget 9000
  [--sample N] [--dry-run]`. Resumível: a fila é `signalScore IS NULL AND
  signals IS NULL`, ordenada por circulação (se o orçamento acabar, os mais
  quentes já foram medidos).

## O que ficou de fora (deliberadamente)

- **Meta Ad Library** — o sinal perfeito (nº de anúncios ativos), mas exige
  adapter próprio e tem cobertura parcial de anúncios comerciais no BR. Fase
  seguinte; `META_AD_LIBRARY_TOKEN` já está reservado no `.env.example`.
- **SimilarWeb e afins** — pagos, fracos em domínio pequeno.
- **`minHitCount ≥ 2`** — mataria exatamente as ofertas recém-nascidas que a
  tag ⚡ existe para pegar.

## Resultado da amostra de 500 (2026-07-26)

Primeira medição real, nos 500 pendentes de maior circulação (491 medidos com
sucesso, 0 scans expirados, ~6 min, 500 retrieves de 10.000/dia):

| Desfecho | Quantidade |
|---|---:|
| Continuam na fila, com score | 419 |
| Descartados: zero sinal medido | 72 |
| Descartados: veredito malicioso do urlscan | 9 |
| (fase 1, sem retrieve) golpe/phishing | 312 |

Distribuição do score entre os 419: **5** em 75+, **112** em 50–74, **232** em
25–49, **70** em 1–24. **361 têm pixel de anúncio** (86%), 35 com a tag
⚡ escalando-agora, 229 com ✓ comprovada.

O topo da fila ordenada por sinal passou a ser quiz-funnel, nutra e curso com
pixel Meta+TikTok+Google simultâneos — e o 11º colocado é um domínio de **25
dias** com 3 pixels: exatamente a antecipação que o desenho persegue.

Correção que a amostra pegou: o sinal TAUTOLÓGICO da fonte (todo candidato da
fonte Utmify contata utmify.com.br por definição) estava inflando o score e
anulando o descarte por zero sinal — subtraído desde então
(`selfSignalsFromQuery`), com recompute aplicado aos já medidos sem gastar
retrieve.
