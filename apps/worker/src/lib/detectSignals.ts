// Detecção de sinais de investimento em tráfego a partir do scan do urlscan.
//
// O princípio que governa (decisão de produto): FASE NÃO DESCARTA, CATEGORIA
// SIM. Uma oferta boa pode estar num lovable.app com template torto — se tem
// pixel instalado, alguém está pagando tráfego para ela, e é exatamente a que
// queremos antecipar. Por isso o sinal certo é o que a página CONTATA
// (lists.domains do scan), não a cara dela.

export type PixelPlatform = 'facebook' | 'tiktok' | 'google' | 'kwai' | 'pinterest' | 'taboola';
export type SignalOrigin = 'sales-page' | 'checkout';

export interface DetectedSignals {
  pixels: PixelPlatform[];
  trackers: string[]; // atribuição (utmify) — quem rastreia conversão, gasta em tráfego
  players: string[]; // players de VSL (converteai/panda/vturb) — infra paga de vendas
  linkedCheckouts: string[]; // gateways LINKADOS na página (href, não requisição)
  // De onde veio o scan: numa fonte de checkout o scan é do GATEWAY, e os
  // pixels detectados são os instalados no checkout — sinal parcial (muitos
  // produtores instalam pixel lá, mas não prova tráfego na página de vendas).
  origin: SignalOrigin;
}

// Domínios contatados → plataforma. Casamento por sufixo com fronteira de
// ponto (nunca substring), pelo mesmo motivo do filtro de resolveSalesPage:
// "notfacebook.com" não pode casar com "facebook.com".
const PIXEL_DOMAINS: Array<[string, PixelPlatform]> = [
  ['connect.facebook.net', 'facebook'],
  ['facebook.com', 'facebook'],
  ['analytics.tiktok.com', 'tiktok'],
  ['tiktokw.us', 'tiktok'], // analytics-ipv6.tiktokw.us — visto em scan real
  ['googletagmanager.com', 'google'],
  ['google-analytics.com', 'google'],
  ['googleadservices.com', 'google'],
  ['kwai.net', 'kwai'],
  ['kwai.com', 'kwai'],
  ['ct.pinterest.com', 'pinterest'],
  ['taboola.com', 'taboola'],
];

const TRACKER_DOMAINS: Array<[string, string]> = [
  ['utmify.com.br', 'utmify'], // pega cdn.utmify e tracking.utmify
];

const PLAYER_DOMAINS: Array<[string, string]> = [
  ['converteai.net', 'converteai'],
  ['pandavideo.com.br', 'pandavideo'],
  ['vturb.com.br', 'vturb'],
  ['vturb.net', 'vturb'],
];

// Checkouts só valem em linkDomains: link não gera requisição, então um
// gateway em `domains` seria a própria página do checkout (fonte checkout),
// não um checkout linkado por uma página de vendas.
const CHECKOUT_DOMAINS: Array<[string, string]> = [
  ['pay.cakto.com.br', 'cakto'],
  ['pay.kiwify.com.br', 'kiwify'],
  ['pay.kirvano.com', 'kirvano'],
  ['pay.hotmart.com', 'hotmart'],
  ['pay.ticto.com.br', 'ticto'],
  ['app.monetizze.com.br', 'monetizze'],
  ['sun.eduzz.com', 'eduzz'],
  ['chk.eduzz.com', 'eduzz'],
  ['go.perfectpay.com.br', 'perfectpay'],
];

function hostMatches(host: string, entry: string): boolean {
  return host === entry || host.endsWith('.' + entry);
}

function collect<T>(hosts: string[], table: Array<[string, T]>): T[] {
  const out = new Set<T>();
  for (const raw of hosts) {
    const host = raw.toLowerCase();
    for (const [entry, label] of table) {
      if (hostMatches(host, entry)) out.add(label);
    }
  }
  return [...out];
}

export function detectSignals(
  domains: string[],
  linkDomains: string[],
  origin: SignalOrigin,
): DetectedSignals {
  return {
    pixels: collect(domains, PIXEL_DOMAINS),
    trackers: collect(domains, TRACKER_DOMAINS),
    players: collect(domains, PLAYER_DOMAINS),
    linkedCheckouts: collect(linkDomains, CHECKOUT_DOMAINS),
    origin,
  };
}
