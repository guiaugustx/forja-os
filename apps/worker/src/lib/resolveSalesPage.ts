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
