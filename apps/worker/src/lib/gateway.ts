// Deriva a marca do gateway a partir do host da URL de checkout — a custo
// zero, porque o host já veio na varredura do urlscan (nenhuma requisição
// nova). Só faz sentido para fontes do tipo checkout: numa fonte de recurso a
// URL escaneada é a página de vendas do anunciante, não a do gateway.
//
// Estratégia: tira do host os rótulos que são prefixo de subdomínio comum
// (pay, checkout, www, ...) e os que são sufixo de TLD comum (com, br, ...),
// e usa o rótulo que sobra — em "pay.cakto.com.br" sobra "cakto".

const KNOWN_TLD_LABELS = new Set([
  'com', 'br', 'net', 'io', 'co', 'app', 'shop', 'store', 'org', 'me',
]);

const KNOWN_SUBDOMAIN_PREFIXES = new Set([
  'www', 'pay', 'checkout', 'secure', 'go', 'app', 'pagamento',
]);

export function extractGatewayFromUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;

  let labels = host.split('.');

  while (labels.length > 1 && KNOWN_TLD_LABELS.has(labels[labels.length - 1])) {
    labels = labels.slice(0, -1);
  }
  while (labels.length > 1 && KNOWN_SUBDOMAIN_PREFIXES.has(labels[0])) {
    labels = labels.slice(1);
  }

  return labels[labels.length - 1] ?? null;
}
