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

// Página de vendas? (heurística sobre os sinais extraídos da página)
export function looksLikeSalesPage(p: { hasCheckout: boolean; hasPrice: boolean; textLen: number }): boolean {
  return p.hasCheckout || (p.hasPrice && p.textLen > 600);
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
