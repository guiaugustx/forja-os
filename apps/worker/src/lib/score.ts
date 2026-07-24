// Score de oportunidade (0–100). Heurística transparente e calibrável — ponto de
// partida, não verdade absoluta. Combina persistência (a página segue viva/sendo
// promovida), concorrência (quantas ofertas no mesmo nicho) e margem (ticket).
// Demanda entra como bônus quando o Trends estiver ligado.

export interface ScoreInput {
  daysRunning: number; // proxy de persistência (urlscan)
  scanCount: number | null; // intensidade de scans
  ticketEstCents: number | null; // margem (proxy)
  competitionCount: number; // nº de ofertas no mesmo nicho/mercado
  demandGrowthPct?: number | null; // opcional (Trends)
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function computeScore(i: ScoreInput): number {
  // Persistência: 120+ dias no ar já é sinal forte de oferta lucrativa.
  const persistence = clamp((i.daysRunning / 120) * 100);
  const intensity = clamp(((i.scanCount ?? 0) / 30) * 100);

  // Concorrência: pouca concorrência no nicho = mais oportunidade.
  const competition = clamp(100 - (i.competitionCount - 1) * 15);

  // Margem: ticket entre R$9 e R$50 é a faixa doce de low ticket.
  const ticket = (i.ticketEstCents ?? 0) / 100;
  const margin = ticket <= 0 ? 40 : clamp(40 + Math.min(ticket, 50) * 1.2);

  // Demanda (bônus opcional).
  const demand = i.demandGrowthPct == null ? null : clamp(50 + i.demandGrowthPct / 4);

  const base =
    persistence * 0.35 + intensity * 0.15 + competition * 0.25 + margin * 0.25;

  const score = demand == null ? base : base * 0.8 + demand * 0.2;
  return Math.round(clamp(score));
}
