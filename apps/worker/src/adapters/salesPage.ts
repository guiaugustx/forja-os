import * as cheerio from 'cheerio';

// Baixa a página de vendas e extrai texto legível (remove script/style/nav).
export interface ExtractedPage {
  ok: boolean;
  title: string | null;
  text: string;
}

const MAX_TEXT = 12000;

export async function fetchAndExtract(url: string): Promise<ExtractedPage> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ForjaBot/0.1; +https://forja.local) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return { ok: false, title: null, text: '' };
    const html = await res.text();
    const $ = cheerio.load(html);
    $('script, style, noscript, svg, iframe, nav, footer, header').remove();

    const title = $('title').first().text().trim() || null;
    const raw = $('body').text();
    const text = raw
      .replace(/\s+/g, ' ')
      .replace(/ /g, ' ')
      .trim()
      .slice(0, MAX_TEXT);

    return { ok: text.length > 0, title, text };
  } catch {
    return { ok: false, title: null, text: '' };
  }
}
