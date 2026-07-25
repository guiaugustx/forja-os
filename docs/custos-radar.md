# Custo da busca de ofertas — medido, não estimado

Data da medição: 2026-07-25

Todos os números abaixo saem de execução real: páginas do próprio pool de
candidatos, o prompt exato do job de enriquecimento, a API de contagem de tokens
da Anthropic, as cotas reais da chave do urlscan e os contadores das 40 últimas
rodadas de colheita gravadas no banco. O que **não** foi medido está marcado
como tal.

---

## O formato do funil (40 rodadas reais)

| Métrica | Total nas 40 rodadas | Por rodada completa (7 fontes) |
|---|---:|---:|
| Resultados brutos varridos | 21.251 | ~3.721 |
| Chamadas de busca ao urlscan | 213 | ~37 |
| Candidatos inéditos gravados | 8.842 | ~1.548 |
| Descartados pelo pré-filtro | 7.465 (84%) | ~1.307 |
| **Chegaram à fila de triagem** | **1.377 (16%)** | **~241** |

As 40 rodadas equivalem a ~5,7 varreduras completas das 7 fontes. Uma chamada de
busca ao urlscan devolve até 100 resultados, o que explica a razão de ~1:100
entre chamadas e resultados brutos.

---

## Custo por etapa

### 1. Colheita — R$ 0

Só chamadas de busca ao urlscan, dentro da cota gratuita. **Zero download de
página, zero token de LLM.** Colher 100.000 candidatos custa exatamente o mesmo
que colher 100: nada em dinheiro.

O limite aqui não é financeiro, é de cota — ver a seção do urlscan abaixo.

### 2. Pré-filtro — R$ 0

CPU pura sobre o que a varredura já devolveu. Nenhuma chamada externa.

### 3. Triagem — seu tempo

Nenhum custo externo. É a etapa que consome o recurso que o dinheiro não compra.
**Não medido:** decisões por minuto na tabela densa dependem de você e da
proporção que você resolve em lote.

### 4. Enriquecimento — onde o dinheiro sai

É a única etapa que gasta LLM. Por oferta promovida:

- 1 chamada de LLM (raio-x)
- 1 chamada de busca ao urlscan (atividade do domínio)
- 1 download de página (2 em fontes de checkout, quando a cascata baixa o
  gateway para achar a página de vendas)

**Tokens medidos em 5 páginas reais do pool:**

| Página | Texto | Entrada | Saída |
|---|---:|---:|---:|
| pbsmethod.com | 513 chars | 993 | 661 |
| getadamsystem.com | 1.119 | 1.167 | 444 |
| theflushfactorplus.com | 3.946 | 2.374 | 570 |
| trysciaticyl.com | 12.000 (teto) | 5.609 | 742 |
| achadinhosdesconto.site | 10.268 | 6.920 | 532 |
| **Média** | | **3.413** | **590** |
| **Máximo** | | **6.920** | **742** |

A saída inclui o thinking, que vem ligado por padrão no Opus 5. O texto da página
é truncado em 12.000 caracteres pelo próprio job, o que põe um teto natural na
entrada.

**Custo por oferta enriquecida:**

| Provedor | Preço | Média | Pior caso |
|---|---|---:|---:|
| Claude Opus 5 | $5 / $25 por M | **US$ 0,032** | US$ 0,053 |
| OpenRouter nemotron pago | $0,08 / $0,40 por M | **US$ 0,0005** | US$ 0,0008 |
| OpenRouter nemotron free | grátis, teto 50/dia | **US$ 0** | US$ 0 |

O nemotron pago sai ~62× mais barato que o Opus 5. A contagem de tokens foi feita
com o tokenizador da Anthropic; o do nemotron difere, então o número dele é
aproximado — a ordem de grandeza não muda.

### 5. Trends — R$ 0

`SERPAPI_KEY` está vazio, então `fetchTrend` devolve `null` sem chamar nada.
Ligar o SerpApi acrescentaria uma chamada paga por nicho novo enriquecido.

---

## Quanto custa uma rodada completa

Partindo dos ~241 candidatos que uma varredura das 7 fontes põe na fila:

| Você promove | Ofertas | Opus 5 | nemotron pago | nemotron free |
|---|---:|---:|---:|---|
| 5% da fila | 12 | US$ 0,38 | US$ 0,006 | US$ 0 |
| 10% | 24 | US$ 0,76 | US$ 0,012 | US$ 0 |
| 20% | 48 | US$ 1,53 | US$ 0,025 | US$ 0 |
| 100% (a fila toda) | 241 | US$ 7,66 | US$ 0,12 | estoura o teto |

**Projeção mensal, uma rodada completa por dia:**

| Você promove | Ofertas/mês | Opus 5 | nemotron pago |
|---|---:|---:|---:|
| 5% | ~362 | US$ 11,50 | US$ 0,18 |
| 10% | ~723 | US$ 23,00 | US$ 0,37 |
| 20% | ~1.446 | US$ 46,00 | US$ 0,74 |

---

## O gargalo real é a cota do urlscan, não o dinheiro

Cotas medidas na sua chave, hoje:

| Recurso | Limite | Usado hoje |
|---|---:|---:|
| Busca / dia | 1.000 | **529 (53%)** |
| Busca / hora | 1.000 | 0 |
| Busca / minuto | 120 | 0 |

Consumo por rodada completa: ~37 chamadas de colheita + 1 por oferta enriquecida.
Com 24 ofertas promovidas, dá ~61 chamadas — cabem ~16 rodadas completas por dia.

**Atenção:** o campo `lastIP` da cota aponta para `168.231.66.179`, que é a sua
VPS. Ela divide a mesma cota diária com a sua máquina local. As 529 buscas já
consumidas hoje saíram de algum dos dois; se as duas colherem no mesmo dia, o
teto chega mais rápido do que a conta acima sugere.

---

## O risco que vale conhecer

**Promover a fila inteira em lote é o único jeito de gastar muito de uma vez.**
Marcar os 241 candidatos e mandar para Análise dispara 241 downloads e 241
chamadas de LLM — US$ 7,66 no Opus 5, ou US$ 12,77 se todos caírem no pior caso
de tokens. É por isso que a ação em lote de promoção pede confirmação com a
contagem; o descarte em lote não pede, porque é barato e reversível.

No teto gratuito do OpenRouter (50 requisições/dia), o mesmo clique falha da
41ª em diante, e cada uma dessas ofertas fica em `enrichment: failed` com o
botão de tentar de novo.

---

## Conclusão prática

O custo **não** escala com a busca — escala com a promoção. Varrer os 10.000+
links da fonte custa zero em dinheiro e cabe folgadamente na cota gratuita do
urlscan. Quem paga a conta é a decisão de promover, a US$ 0,032 cada no modelo
mais caro que existe hoje.

Com uma rodada por dia e 10% de promoção, o Radar custa **cerca de US$ 23 por
mês no Opus 5**, ou centavos no nemotron. Os US$ 10 de crédito no OpenRouter
(que destravam 1.000 requisições/dia em modelos gratuitos) cobrem esse volume
com folga e sem custo recorrente.

---

## Como reproduzir

- Tokens e custo por oferta: script de medição que puxa candidatos reais do pool,
  monta o prompt exato de `extractXray` e chama `messages.countTokens` +
  `messages.create` da Anthropic.
- Formato do funil: `IngestionRun` das últimas 40 rodadas, campos `rawHits`,
  `newCandidates`, `autoDiscarded`, `queuedForTriage`.
- Cotas do urlscan: `GET https://urlscan.io/user/quotas/` com a `URLSCAN_API_KEY`.
- Preços do OpenRouter: `GET https://openrouter.ai/api/v1/models` (público).
- Preços da Anthropic: tabela oficial de modelos (Opus 5 = $5/M entrada,
  $25/M saída).

---

## Qual modelo usar (medido em 5 páginas reais, 2026-07-25)

| Modelo | Custo/oferta | vs Opus 5 | Mês a 10% de promoção |
|---|---:|---:|---:|
| Claude Opus 5 | US$ 0,0341 | — | ~US$ 23 |
| **Claude Sonnet 5** | **US$ 0,0119** | **2,9× menor** | **~US$ 8** |
| Claude Haiku 4.5 | US$ 0,0047 | 7,3× menor | ~US$ 3 |

O preço do Sonnet 5 é o introdutório ($2/$10 por M, até 31/08/2026). Na tabela
cheia ($3/$15) sobe para ~US$ 0,018/oferta, ainda metade do Opus.

**Concordância com o Opus 5**, em 5 campos × 5 páginas:

- `isSalesPage`, `productType`, `market`: **idênticos nos três modelos, 15/15.**
  São os campos que disparam os alertas e o filtro de mercado — o Opus não
  entrega nada aqui que o Haiku não entregue.
- `niche`: diverge sempre, por granularidade (texto livre). Nenhum errado.
- `ticketEstCents`: a divergência real. Páginas de suplemento com 3 faixas de
  preço fazem cada modelo escolher uma faixa diferente (Opus 17700 vs Sonnet
  6900 na mesma página). Ambiguidade da página, não erro de leitura.

**Haiku 4.5 quebra o schema hoje:** devolveu `ticketEstCents` como *string*
(`"6700"`) em 5 de 5 páginas. O schema é `z.number()`, então `schema.parse()`
lançaria e todo enriquecimento falharia. Exigiria `z.coerce.number()` — e ainda
assim é o modelo cuja estimativa de ticket mais diverge, alimentando o score.

**Decisão: `ANTHROPIC_MODEL="claude-sonnet-5"`.** O Opus 5 é o modelo mais caro
que existe fazendo extração estruturada de página de vendas.

### Efeito colateral conhecido do campo `niche`

Nenhum modelo produz nichos agrupáveis: `"saude"`, `"Saúde articular e inchaço
nos membros inferiores"` e `"Saúde - circulação/retenção de líquidos"` são a
mesma coisa para um humano e três valores distintos no banco. Como
`competitionCount` conta ofertas do mesmo `niche` + `market`, o resultado é
quase sempre 1 — e o score sai inflado pelo componente de concorrência. Vale um
vocabulário fechado de nichos no prompt.
