// Demanda (Google Trends) — opcional/adiado. Sem SERPAPI_KEY, retorna null e o
// score usa apenas persistência + concorrência + margem. Quando ligado, busca o
// interest-over-time do termo via SerpApi (fonte confiável, paga).

export interface TrendResult {
  term: string;
  market: string;
  volumeMonthly: number;
  growth90d: string | null;
  status: 'breakout' | 'rising' | 'stable' | 'seasonal' | 'declining';
  series: number[];
}

export async function fetchTrend(term: string, market: string): Promise<TrendResult | null> {
  const key = process.env.SERPAPI_KEY ?? '';
  if (!key || !term) return null;

  try {
    const url =
      `https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES` +
      `&q=${encodeURIComponent(term)}&api_key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      interest_over_time?: { timeline_data?: Array<{ values?: Array<{ extracted_value?: number }> }> };
    };
    const timeline = json.interest_over_time?.timeline_data ?? [];
    const series = timeline.map((t) => t.values?.[0]?.extracted_value ?? 0);
    if (series.length === 0) return null;

    const last = series[series.length - 1] ?? 0;
    const prev = series[Math.max(0, series.length - 13)] ?? 0;
    const growth = prev > 0 ? Math.round(((last - prev) / prev) * 100) : 0;
    const status: TrendResult['status'] =
      growth >= 200 ? 'breakout' : growth >= 40 ? 'rising' : growth <= -30 ? 'declining' : 'stable';

    return {
      term,
      market,
      volumeMonthly: Math.round((series.reduce((a, b) => a + b, 0) / series.length) * 1000),
      growth90d: `${growth >= 0 ? '+' : ''}${growth}%`,
      status,
      series,
    };
  } catch {
    return null;
  }
}
