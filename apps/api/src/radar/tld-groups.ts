// Resolução pura do spray de TLD — separada do serviço (que só faz a query
// Prisma) para ser testável sem banco.
//
// Spray de TLD = o MESMO nome-base (baseDomain, o SLD sem sufixo) aparecendo em
// ≥ 2 REGISTRÁVEIS diferentes (unlockprofile.lat / .site / .xyz). O corte é por
// registráveis distintos, não por candidatos: subdomínios do MESMO registrável
// (fra./esp.safefamilymonitor.com) ou vários sellers numa mesma plataforma
// (x.mundoactivo.online, y.mundoactivo.online) contam como 1 registrável e NÃO
// são spray — colapsá-los sumiria com ofertas distintas.

export interface TldRow {
  id: string;
  baseDomain: string; // SLD sem sufixo (chave do grupo) — garantido não-nulo
  registrable: string | null; // domínio registrável COM sufixo; null = não-parseável
  signalScore: number | null;
  hitCount: number;
}

export interface TldGroup {
  spread: number; // nº de REGISTRÁVEIS distintos com este nome-base (≈ nº de TLDs)
  siblingIds: string[]; // todos os ids do grupo, representante incluso
}

export interface TldGroupResult {
  nonRepIds: string[]; // irmãos a excluir da lista (todos menos o representante)
  groupByBase: Map<string, TldGroup>;
}

/** Limiar: só ≥ 2 registráveis distintos do mesmo nome-base contam como spray. */
export const TLD_SPRAY_MIN = 2;

/**
 * Representante do grupo = maior signalScore (null conta como -1, o mais fraco),
 * desempate por hitCount desc e por id asc (determinístico — o mesmo
 * representante some/aparece de forma estável entre requisições).
 */
export function resolveTldGroups(rows: TldRow[]): TldGroupResult {
  const groups = new Map<string, TldRow[]>();
  for (const r of rows) {
    const arr = groups.get(r.baseDomain);
    if (arr) arr.push(r);
    else groups.set(r.baseDomain, [r]);
  }

  const nonRepIds: string[] = [];
  const groupByBase = new Map<string, TldGroup>();
  for (const [base, arr] of groups) {
    // Conta REGISTRÁVEIS distintos (fallback para o próprio id quando o
    // registrável não parseia, para não fundir não-parseáveis entre si).
    const registrables = new Set(arr.map((r) => r.registrable ?? `#${r.id}`));
    if (registrables.size < TLD_SPRAY_MIN) continue; // não é spray de TLD

    arr.sort(
      (a, b) =>
        (b.signalScore ?? -1) - (a.signalScore ?? -1) ||
        b.hitCount - a.hitCount ||
        (a.id < b.id ? -1 : 1),
    );
    groupByBase.set(base, { spread: registrables.size, siblingIds: arr.map((x) => x.id) });
    for (let i = 1; i < arr.length; i++) nonRepIds.push(arr[i].id);
  }
  return { nonRepIds, groupByBase };
}
