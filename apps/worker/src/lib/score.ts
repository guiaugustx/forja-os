// Score de oportunidade (0–100). Heurística transparente e calibrável — ponto de
// partida, não verdade absoluta. Combina tráfego (a página está sendo acessada),
// persistência (segue viva), concorrência (nº de ofertas no nicho) e margem (ticket).
// Demanda entra como bônus quando o Trends estiver ligado.

export interface ScoreInput {
  trafficScore: number; // 0–100 (pixels de anúncio + circulação urlscan)
  daysRunning: number; // proxy de persistência (urlscan)
  scanCount: number | null;
  ticketEstCents: number | null;
  competitionCount: number;
  demandGrowthPct?: number | null;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function computeScore(i: ScoreInput): number {
  const traffic = clamp(i.trafficScore);
  const persistence = clamp((i.daysRunning / 120) * 100);
  const competition = clamp(100 - (i.competitionCount - 1) * 15);
  const ticket = (i.ticketEstCents ?? 0) / 100;
  const margin = ticket <= 0 ? 40 : clamp(40 + Math.min(ticket, 50) * 1.2);
  const demand = i.demandGrowthPct == null ? null : clamp(50 + i.demandGrowthPct / 4);

  const base = traffic * 0.3 + persistence * 0.2 + competition * 0.2 + margin * 0.3;
  const score = demand == null ? base : base * 0.85 + demand * 0.15;
  return Math.round(clamp(score));
}
