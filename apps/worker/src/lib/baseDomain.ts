// Nome registrável SEM o sufixo público, para agrupar o mesmo nome-base
// espalhado em vários TLDs (spray de domínio descartável: unlockprofile.lat /
// unlockprofile.site / unlockprofile.xyz → todos "unlockprofile").
//
// Precisa da Public Suffix List de verdade — um split ingênuo por "." erra em
// sufixos compostos (foo.com.br daria "com", não "foo"). tldts embute a PSL.
//
// allowPrivateDomains: TER de usar. Sem isso, plataformas de hospedagem que
// estão na seção PRIVADA da PSL (pages.dev, vercel.app, netlify.app,
// lovable.app, myshopify.com…) seriam tratadas como domínio comum, e todo site
// hospedado nelas colapsaria num único nome-base falso ("pages" ×179), somindo
// com ofertas legítimas distintas. Com a flag, vslfacebook.pages.dev vira
// "vslfacebook" (o subdomínio é o registrável), como tem de ser.

import { getDomainWithoutSuffix, getDomain } from 'tldts';

const OPTS = { allowPrivateDomains: true } as const;

/**
 * Rótulo registrável (SLD) sem sufixo, minúsculo — a CHAVE de agrupamento.
 * null quando não dá para extrair (IP, sufixo desconhecido, vazio); null nunca
 * agrupa.
 */
export function baseDomainOf(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const base = getDomainWithoutSuffix(domain.trim().toLowerCase(), OPTS);
  return base && base.length > 0 ? base : null;
}

/**
 * Domínio registrável COM sufixo (unlockprofile.site, vslfacebook.pages.dev) —
 * usado para contar TLDs distintos dentro de um grupo: só é spray de TLD quando
 * o mesmo SLD aparece em ≥ 2 registráveis diferentes. Subdomínios do MESMO
 * registrável (fra./esp.safefamilymonitor.com) contam como 1, não como spray.
 */
export function registrableDomainOf(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const reg = getDomain(domain.trim().toLowerCase(), OPTS);
  return reg && reg.length > 0 ? reg : null;
}
