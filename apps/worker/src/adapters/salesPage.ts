import * as cheerio from 'cheerio';

// Baixa a página e extrai texto legível + sinais (pixels de anúncio, checkout, preço).
export interface ExtractedPage {
  ok: boolean;
  title: string | null;
  text: string;
  pixels: string[]; // ['facebook','tiktok','google','utmify']
  detectedGateway: string | null; // cakto | hotmart | stripe | kirvano | ...
  hasCheckout: boolean;
  hasPrice: boolean;
}

const MAX_TEXT = 12000;

const PIXEL_PATTERNS: Array<[RegExp, string]> = [
  [/connect\.facebook\.net|fbq\s*\(|facebook.{0,10}pixel/i, 'facebook'],
  [/analytics\.tiktok\.com|ttq\.|tiktok.{0,10}pixel/i, 'tiktok'],
  [/googletagmanager\.com|gtag\s*\(|google-analytics\.com/i, 'google'],
  [/utmify/i, 'utmify'],
];

const GATEWAY_PATTERNS: Array<[RegExp, string]> = [
  [/cakto/i, 'cakto'],
  [/hotmart/i, 'hotmart'],
  [/(buy|checkout)\.stripe|js\.stripe\.com/i, 'stripe'],
  [/kirvano/i, 'kirvano'],
  [/monetizze/i, 'monetizze'],
  [/eduzz/i, 'eduzz'],
  [/pepper|kiwify/i, 'kiwify'],
];

const CHECKOUT_HINTS =
  /checkout|comprar agora|comprar já|finalizar compra|adicionar ao carrinho|quero comprar|garantir (minha|meu)|assinar agora|buy now|add to cart/i;

const PRICE_HINTS = /(r\$|us\$|\$|€)\s?\d{1,4}([.,]\d{2})?|\d+x de/i;

export async function fetchAndExtract(url: string): Promise<ExtractedPage> {
  const empty: ExtractedPage = {
    ok: false,
    title: null,
    text: '',
    pixels: [],
    detectedGateway: null,
    hasCheckout: false,
    hasPrice: false,
  };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return empty;
    const html = await res.text();

    const pixels = PIXEL_PATTERNS.filter(([re]) => re.test(html)).map(([, name]) => name);
    const gatewayHit = GATEWAY_PATTERNS.find(([re]) => re.test(html));
    const detectedGateway = gatewayHit ? gatewayHit[1] : null;

    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, nav, footer, header').remove();
    const title = $('title').first().text().trim() || null;
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

    const hasCheckout = CHECKOUT_HINTS.test(html) || CHECKOUT_HINTS.test(text) || detectedGateway != null;
    const hasPrice = PRICE_HINTS.test(text);

    return {
      ok: text.length > 0,
      title,
      text,
      pixels,
      detectedGateway,
      hasCheckout,
      hasPrice,
    };
  } catch {
    return empty;
  }
}
