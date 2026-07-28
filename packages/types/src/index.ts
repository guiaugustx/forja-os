// Tipos compartilhados entre web, api e worker.

// ============================================================
// RADAR — raio-x da oferta minerada (extraído pela IA na ingestão)
// ============================================================

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

// Correção 2: corpo do PATCH /radar/sources/:id — todos os campos opcionais
// porque a tela edita um por vez (ex.: só reabilitar a fonte), mas a API
// recusa um corpo totalmente vazio.
export interface UpdateHarvestSourceInput {
  enabled?: boolean;
  minHitCount?: number;
  maxAgeDays?: number;
}

export type CandidateStatus = 'pending' | 'discarded_auto' | 'discarded_manual' | 'promoted';

// Sinais de escala medidos via retrieve do urlscan (1 chamada/candidato).
// signalScore null = NÃO MEDIDO; 0 = medido e sem sinal — a UI precisa
// distinguir os dois ("—" vs "0").
export interface CandidateSignals {
  pixels: string[]; // facebook | tiktok | google | kwai | pinterest | taboola
  trackers: string[]; // utmify
  players: string[]; // converteai | pandavideo | vturb
  linkedCheckouts: string[];
  storefronts?: string[]; // shopify | nuvemshop | vtex … (loja → descarte de categoria)
  marketplaces?: string[]; // shopee | mercadolivre | amazon … (linkados)
  origin: 'sales-page' | 'checkout';
  httpStatus?: number | null; // status HTTP da página no scan (>=400 → fora do ar)
  tags?: ('escalando-agora' | 'comprovada' | 'multi-canal')[];
  measuredAt?: string;
  error?: string; // ex.: 'result-404' (scan expirado)
}

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
  signalScore: number | null;
  signals: CandidateSignals | null;
  hasAdPixel: boolean | null;
  domainAgeDays: number | null;
  // Spray de TLD (só no representante de um grupo ≥ 2 na fila de triagem): o
  // mesmo nome-base espalhado em vários domínios descartáveis. tldSpread = nº de
  // domínios; tldSiblingIds = ids de todos (o representante incluso), para a
  // ação "descartar grupo". Ausente quando não é grupo.
  tldSpread?: number;
  tldSiblingIds?: string[];
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
  'pagina-de-vendas-duplicada': 'Página de vendas já pertence a outra oferta',
};

// Resposta das decisões em lote da triagem. O formato é o mesmo para descartar e
// para promover — o cliente não precisa saber qual decisão enviou para ler a
// resposta. `failed` traz o motivo de cada item que não passou, para a tela
// poder dizer "38 promovidos, 2 falharam" em vez de recarregar às cegas.
export interface BulkTriageResultDTO {
  count: number;
  succeeded: string[];
  failed: { id: string; reason: string }[];
}

// ============================================================
// GERADOR — blocos gerados por IA (estrutura base da oferta)
// ============================================================

export interface AvatarBlock {
  demographic: string;
  awarenessLevel: string;
  desires: string[];
  pains: string[];
  objections: string[];
  beliefs: string[];
}

export interface BigIdeaBlock {
  bigIdea: string;
  uniqueMechanism: string;
  differentiation: string;
  promiseHeadline: string;
}

export interface OfferStackBlock {
  mainOffer: { name: string; description: string; priceCents: number };
  bump?: { name: string; description: string; priceCents: number };
  upsell?: { name: string; description: string; priceCents: number };
  guarantee: string;
  bonuses: { name: string; description: string }[];
}

export interface SalesCopyBlock {
  headline: string;
  subheadline: string;
  leadParagraphs: string[];
  bullets: string[];
  offerBlock: string;
  guaranteeBlock: string;
  cta: string;
  faq: { q: string; a: string }[];
}

// Estado acumulado do gerador de ofertas — cresce a cada etapa.
export interface OfferDraftState {
  id: string;
  currentStep: number;
  sourceOfferId?: string | null;
  base?: {
    salesPageUrl?: string;
    creatives?: { url: string; format?: string }[];
    notes?: string;
    xray?: OfferXray;
  };
  avatar?: AvatarBlock;
  bigIdea?: BigIdeaBlock;
  stack?: OfferStackBlock;
  salesCopy?: SalesCopyBlock;
  creativeAngles?: unknown[];
  emailSequences?: unknown[];
}

// Chaves das etapas geradas por IA no MVP (núcleo + copy de vendas).
export type GeneratorStepKey = 'avatar' | 'bigIdea' | 'stack' | 'salesCopy';

export interface GeneratorStepDef {
  key: GeneratorStepKey;
  label: string;
  description: string;
  dependsOn: GeneratorStepKey[];
}

// Etapas do MVP (o protótipo tem 8; aqui entregamos as 4 do núcleo + copy).
export const MVP_GENERATOR_STEPS: readonly GeneratorStepDef[] = [
  {
    key: 'avatar',
    label: 'Avatar & consciência',
    description: 'Quem é o público, nível de consciência, desejos, dores e objeções.',
    dependsOn: [],
  },
  {
    key: 'bigIdea',
    label: 'Grande ideia + mecanismo',
    description: 'A grande ideia e o mecanismo único, diferenciando-se da oferta base.',
    dependsOn: ['avatar'],
  },
  {
    key: 'stack',
    label: 'Estrutura da oferta',
    description: 'Principal, bump, upsell, garantia, bônus e precificação.',
    dependsOn: ['bigIdea'],
  },
  {
    key: 'salesCopy',
    label: 'Copy da página de vendas',
    description: 'Copy completa em blocos: headline, lead, bullets, oferta, garantia, CTA, FAQ.',
    dependsOn: ['stack'],
  },
] as const;

// Lista completa do protótipo (referência; etapas 5–8 chegam em fases seguintes).
export const GENERATOR_STEPS = [
  'Oferta base',
  'Avatar & consciência',
  'Grande ideia',
  'Estrutura da oferta',
  'Página de vendas',
  'Ângulos de criativo',
  'E-mails',
  'Revisão & lançar',
] as const;
