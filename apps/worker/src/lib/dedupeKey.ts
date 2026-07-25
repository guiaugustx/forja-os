// Chave de deduplicação do pool de candidatos.
//
// O tipo da fonte inverte o que identifica uma oferta. Numa fonte de RECURSO
// (utmify, ConverteAI, Panda) o urlscan registra a página de vendas como
// page.domain — um domínio é um anunciante. Numa fonte de CHECKOUT a página
// escaneada é o próprio gateway, igual para milhares de ofertas: ali quem
// identifica é a URL.

export type HarvestKind = 'resource' | 'checkout';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const s = u.toString();
    return s.length > 1 && s.endsWith('/') && u.pathname !== '/' ? s.slice(0, -1) : s;
  } catch {
    return url;
  }
}

export function buildDedupeKey(
  kind: HarvestKind,
  hit: { pageUrl: string; pageDomain: string },
): string {
  return kind === 'checkout' ? normalizeUrl(hit.pageUrl) : hit.pageDomain.toLowerCase();
}
