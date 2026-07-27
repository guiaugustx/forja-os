// Filtros e sinais de qualidade da ingestão.

// Delivery / comida / serviço local de alimentação — não são ofertas modeláveis.
const BLOCK_KEYWORDS = [
  'delivery', 'ifood', 'rappi', 'uber eats', 'ubereats', 'restaurante', 'lanchonet', 'lanche',
  'hamburg', 'burger', 'pizzaria', 'pizza', 'marmita', 'marmitex', 'açai', 'acai', 'fast food',
  'fastfood', 'sorveteria', 'padaria', 'pastel', 'esfiha', 'sushi', 'temaki', 'açougue', 'acougue',
  'hortifruti', 'mercearia', 'mercadinho', 'churrasc', 'espetinho', 'comida', 'food', 'refei',
  'distribuidora de bebida', 'cardapio', 'cardápio', 'entrega de comida', 'delivery de',
];

// Aplicado a campos ESTRUTURADOS (domínio, nome, nicho, categoria) — não ao texto livre,
// para evitar bloquear infoprodutos que só citam "entrega imediata" na copy.
export function isBlockedCategory(...fields: Array<string | null | undefined>): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return BLOCK_KEYWORDS.some((k) => hay.includes(k));
}

// Pré-filtro LENIENTE: só barra pré-IA página realmente vazia e sem nenhum sinal.
// Se tem checkout, preço, pixel de rastreio OU conteúdo relevante, deixa a IA julgar
// (ela é o juiz preciso de isSalesPage/productType). Evita falso-negativo de página
// real cujo CTA/preço está em imagem/JS.
export function looksLikeSalesPage(p: {
  hasCheckout: boolean;
  hasPrice: boolean;
  textLen: number;
  pixels: number;
}): boolean {
  return p.hasCheckout || p.hasPrice || p.pixels > 0 || p.textLen >= 200;
}

// Sinal de tráfego: pixels de anúncio (fb/tiktok/google) + circulação no urlscan.
export interface TrafficInput {
  pixels: string[];
  domainScanCount: number;
  lastSeen: string | null;
}

export function computeTraffic(i: TrafficInput): { score: number; hasTraffic: boolean } {
  // utmify é o critério da busca, não conta como sinal de tráfego real.
  const adPixels = i.pixels.filter((p) => p !== 'utmify');
  let score = Math.min(adPixels.length, 2) * 30; // até 60 por pixels de anúncio ativos
  if (i.domainScanCount >= 5) score += 30;
  else if (i.domainScanCount >= 3) score += 20;
  else if (i.domainScanCount >= 2) score += 10;
  if (i.lastSeen) {
    const days = (Date.now() - new Date(i.lastSeen).getTime()) / 86400000;
    if (days <= 14) score += 10;
  }
  score = Math.max(0, Math.min(100, score));
  const hasTraffic = adPixels.length >= 1 || i.domainScanCount >= 3;
  return { score, hasTraffic };
}

// Golpe/phishing — CATEGORIA, não fase: nunca vira oferta modelável. Termos
// compostos de propósito ("consulta cpf", nunca "cpf" solto) para não matar
// oferta legítima que cite o termo na copy. Medido contra o backlog real
// antes de entrar: 322/5.946 pendentes batiam (05%), zero falso positivo na
// amostra inspecionada. Descarte é reversível pela aba "descartados pela
// máquina".
const SCAM_KEYWORDS = [
  'consulta cpf', 'consulta de cpf', 'consulta nacional de cpf', 'cpf gratuito', 'cpf grátis',
  'free fire', 'recarga', 'centro de recarga',
  'leilão', 'leilao', 'lucrando com leil',
  'gov.br', 'govbr', 'gov-', '-gov.',
  'inep', 'instituto nacional de estudos',
  'cnh do brasil', 'cnh social', 'cnh gratuita',
  'serasa', 'bolsa família', 'bolsa familia', 'auxílio brasil', 'auxilio brasil',
  'fgts', 'saque emergencial', 'indenização', 'indenizacao', 'premiado', 'premiada',
  'pix premiado', 'sorteio oficial', 'nota fiscal premiada',
  'receita federal', 'caixa econômica', 'caixa economica', '13º salário', '13o salario',
];

// Mesmo contrato do isBlockedCategory: aplicar SÓ a campos estruturados
// (domínio, título, nome do produto), nunca ao texto livre da página.
export function isScamCategory(...fields: Array<string | null | undefined>): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return SCAM_KEYWORDS.some((k) => hay.includes(k));
}
