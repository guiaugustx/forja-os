'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { api, apiPost, apiPatch } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { ScoreRing } from '@/components/radar/ScoreRing';
import { Sparkline } from '@/components/radar/Sparkline';
import type { OfferDTO, IngestionRunDTO } from '@forja/types';

type Trend = {
  id: string;
  term: string;
  market: string;
  volumeMonthly: number;
  growth90d: string | null;
  status: string;
  series: number[] | null;
  seasonalityNote: string | null;
};

type TabKey = 'offers' | 'trends' | 'shortlist';
const TABS: [TabKey, string][] = [
  ['offers', 'Ofertas mineradas'],
  ['trends', 'Trends de termos'],
  ['shortlist', 'Shortlist pontuada'],
];
type Market = 'all' | 'BR' | 'US' | 'ES';

export default function RadarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('offers');
  const [market, setMarket] = useState<Market>('all');
  const [niche, setNiche] = useState<string>('all');
  const [sort, setSort] = useState<'days' | 'score' | 'scans'>('days');

  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api<OfferDTO[]>('/radar/offers') });
  const trends = useQuery({ queryKey: ['trends'], queryFn: () => api<Trend[]>('/radar/trends') });
  const shortlist = useQuery({ queryKey: ['shortlist'], queryFn: () => api<OfferDTO[]>('/radar/shortlist') });
  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => api<IngestionRunDTO[]>('/radar/runs'),
    refetchInterval: 4000,
  });

  const ingest = useMutation({
    mutationFn: () => apiPost<IngestionRunDTO>('/radar/ingest', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  });
  const curate = useMutation({
    mutationFn: (v: { id: string; saved: boolean }) => apiPatch(`/radar/offers/${v.id}`, { saved: v.saved }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['shortlist'] });
    },
  });
  const model = useMutation({
    mutationFn: (offerId: string) => apiPost<{ id: string }>('/offer-drafts', { sourceOfferId: offerId }),
    onSuccess: (draft) => router.push(`/gerador?draftId=${draft.id}`),
  });

  const lastRun = runs.data?.[0];
  const running = lastRun?.status === 'running' || ingest.isPending;

  const lastDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRun?.status === 'done' && lastRun.id !== lastDoneRef.current) {
      lastDoneRef.current = lastRun.id;
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['shortlist'] });
    }
  }, [lastRun?.status, lastRun?.id, qc]);

  const niches = useMemo(() => {
    const s = new Set<string>();
    offers.data?.forEach((o) => o.niche && s.add(o.niche));
    return Array.from(s).sort();
  }, [offers.data]);

  const filteredOffers = useMemo(() => {
    let list = offers.data ?? [];
    if (market !== 'all') list = list.filter((o) => o.market === market);
    if (niche !== 'all') list = list.filter((o) => o.niche === niche);
    const by = { days: 'daysRunning', scans: 'scanCount', score: 'opportunityScore' } as const;
    const key = by[sort];
    return [...list].sort((a, b) => (Number(b[key] ?? 0) - Number(a[key] ?? 0)));
  }, [offers.data, market, niche, sort]);

  const filteredShortlist = useMemo(() => {
    let list = shortlist.data ?? [];
    if (market !== 'all') list = list.filter((o) => o.market === market);
    return [...list].sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
  }, [shortlist.data, market]);

  const kScaling = offers.data?.filter((o) => o.daysRunning >= 120).length ?? 0;
  const kBreakout = trends.data?.filter((t) => t.status === 'breakout').length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Radar</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Motor de mineração de ofertas e tendências. Descobre o que está escalando antes de você entrar.
          </p>
        </div>
        <Button variant="primary" isDisabled={running} onPress={() => ingest.mutate()}>
          {running ? 'Minerando…' : '✦ Rodar ingestão'}
        </Button>
      </div>

      {/* KPIs do motor */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Ofertas rastreadas" value={String(offers.data?.length ?? '—')} sub="mineradas do urlscan" />
        <Kpi label="Escalando agora" value={String(kScaling)} sub="120+ dias de persistência" />
        <Kpi label="Termos em breakout" value={String(kBreakout)} sub="crescimento > 200% / 90d" valueClass="text-amber-400" />
        <Kpi label="Fontes ativas" value="1" sub="urlscan · Utmify" />
      </div>

      {/* Sub-abas */}
      <div className="flex gap-1 border-b border-white/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === k ? 'border-blue-500 text-neutral-100' : 'border-transparent text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {label}
            {k === 'shortlist' && (shortlist.data?.length ?? 0) > 0 && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px]">{shortlist.data!.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ===== OFERTAS MINERADAS ===== */}
      {tab === 'offers' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <MarketPills market={market} setMarket={setMarket} />
            <Select value={niche} onChange={setNiche} label="Nicho">
              <option value="all">Nicho: todos</option>
              {niches.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
            <Select value={sort} onChange={(v) => setSort(v as typeof sort)} label="Ordenar">
              <option value="days">Ordenar: dias no ar</option>
              <option value="score">Ordenar: score</option>
              <option value="scans">Ordenar: scans</option>
            </Select>
            <span className="ml-auto text-[12px] text-neutral-500">
              Atualizado {timeAgo(lastRun?.finishedAt ?? lastRun?.startedAt ?? null)}
            </span>
          </div>

          {offers.isLoading && <Loading label="Carregando ofertas…" />}
          {offers.isError && <ApiError />}
          {offers.data && filteredOffers.length === 0 && (
            <Empty text="Nenhuma oferta para este filtro. Clique em “Rodar ingestão” para minerar." />
          )}

          {filteredOffers.length > 0 && (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="p-3">Oferta / anunciante</th>
                    <th className="p-3">Mercado</th>
                    <th className="p-3">Nicho</th>
                    <th className="p-3">Dias no ar</th>
                    <th className="p-3">Scans</th>
                    <th className="p-3">Ticket est.</th>
                    <th className="p-3">Ângulo dominante</th>
                    <th className="p-3">Escala</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredOffers.map((o) => (
                    <tr key={o.id} className="border-t border-white/10 align-middle">
                      <td className="p-3">
                        <div className="font-semibold">{o.name}</div>
                        <div className="text-[11.5px] text-neutral-500">{o.advertiser}</div>
                      </td>
                      <td className="p-3 text-[16px]">{flag(o.market)}</td>
                      <td className="max-w-[130px] p-3 text-neutral-300">{o.niche}</td>
                      <td className="whitespace-nowrap p-3">
                        <b>{o.daysRunning}</b>
                        {o.daysRunning >= 120 && (
                          <Chip className="ml-1.5" size="sm" variant="soft" color="success">vencedora</Chip>
                        )}
                      </td>
                      <td className="p-3">{o.scanCount ?? 0}</td>
                      <td className="whitespace-nowrap p-3">{fmtTicket(o.ticketEstCents, o.market)}</td>
                      <td className="max-w-[190px] p-3 text-neutral-300">{o.xray?.angle ?? o.angle ?? '—'}</td>
                      <td className="p-3"><ScaleDots score={o.opportunityScore} /></td>
                      <td className="whitespace-nowrap p-3 text-right">
                        {o.pageUrl && (
                          <Button size="sm" variant="ghost" onPress={() => window.open(o.pageUrl!, '_blank')}>
                            Ver página
                          </Button>
                        )}{' '}
                        <Button size="sm" variant="primary" isDisabled={model.isPending} onPress={() => model.mutate(o.id)}>
                          Modelar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <p className="text-[12.5px] leading-relaxed text-neutral-500">
            ✦ O motor cruza <b>persistência no urlscan</b> (proxy de oferta viva), <b>volume de scans</b> e{' '}
            <b>ticket estimado</b> para destacar ofertas que valem engenharia reversa. Métricas reais de anúncio
            (dias no ar, peças ativas) entram com a Meta Ad Library numa fase seguinte.
          </p>
        </div>
      )}

      {/* ===== TRENDS ===== */}
      {tab === 'trends' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            {trends.isLoading && <Loading label="Carregando trends…" />}
            {trends.data && trends.data.length === 0 && (
              <Empty text="Sem trends por enquanto — a demanda (Google Trends) entra com a chave do SerpApi." />
            )}
            {trends.data && trends.data.length > 0 && (
              <Panel className="overflow-x-auto">
                <div className="p-5 pb-0">
                  <div className="text-[15px] font-bold">Termos monitorados</div>
                  <div className="text-[12.5px] text-neutral-500">Volume de busca e velocidade de crescimento</div>
                </div>
                <table className="mt-3 w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                      <th className="p-3">Termo</th>
                      <th className="p-3">Mercado</th>
                      <th className="p-3">Tendência 12m</th>
                      <th className="p-3">Crescimento</th>
                      <th className="p-3">Volume/mês</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.data.map((t) => (
                      <tr key={t.id} className="border-t border-white/10">
                        <td className="p-3 font-semibold">{t.term}</td>
                        <td className="p-3 text-[16px]">{flag(t.market)}</td>
                        <td className="p-3">
                          <Sparkline points={(t.series && t.series.length > 1) ? t.series : synthSeries(t.status)} color={statusColor(t.status)} />
                        </td>
                        <td className="p-3"><b>{t.growth90d ?? statusLabel(t.status)}</b></td>
                        <td className="p-3 tabular">{t.volumeMonthly.toLocaleString('pt-BR')}</td>
                        <td className="p-3">
                          <Chip size="sm" variant="soft" color={statusChipColor(t.status)}>{statusLabel(t.status)}</Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <Panel className="p-4">
              <div className="text-[14px] font-bold">🔥 Em breakout</div>
              <div className="mb-3 text-[12.5px] text-neutral-500">Aceleração súbita nos últimos 90 dias</div>
              {(trends.data?.filter((t) => t.status === 'breakout') ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-t border-white/10 py-2.5 first:border-0">
                  <div className="flex-1">
                    <b>{t.term}</b>
                    <div className="text-[11.5px] text-neutral-500">{flag(t.market)} · {t.growth90d ?? '—'}</div>
                  </div>
                  <Chip size="sm" variant="soft" color="warning">breakout</Chip>
                </div>
              ))}
              {(trends.data?.filter((t) => t.status === 'breakout').length ?? 0) === 0 && (
                <div className="text-[12.5px] text-neutral-500">Nenhum termo em breakout agora.</div>
              )}
            </Panel>

            <Panel className="p-4">
              <div className="text-[14px] font-bold">Sazonalidade</div>
              <div className="mb-3 text-[12.5px] text-neutral-500">Janelas próximas</div>
              {(trends.data?.filter((t) => t.status === 'seasonal') ?? []).map((t) => (
                <div key={t.id} className="flex items-center gap-2 border-t border-white/10 py-2.5 first:border-0">
                  <b className="flex-1">{t.term}</b>
                  <span className="text-[12px] text-neutral-500">{t.seasonalityNote ?? 'pico sazonal'}</span>
                </div>
              ))}
              {(trends.data?.filter((t) => t.status === 'seasonal').length ?? 0) === 0 && (
                <div className="text-[12.5px] text-neutral-500">Sem termos sazonais mapeados.</div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* ===== SHORTLIST ===== */}
      {tab === 'shortlist' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <MarketPills market={market} setMarket={setMarket} />
            <span className="ml-auto text-[12px] text-neutral-500">Oportunidades salvas da mineração + score</span>
          </div>

          {shortlist.isLoading && <Loading label="Carregando shortlist…" />}
          {shortlist.data && filteredShortlist.length === 0 && (
            <Empty text="Sua shortlist está vazia. Salve ofertas em “Ofertas mineradas” (botão Modelar salva e abre o gerador)." />
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filteredShortlist.map((o) => (
              <Panel key={o.id} className="p-4">
                <div className="flex items-start gap-4">
                  <ScoreRing score={o.opportunityScore} size={52} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">{o.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Chip size="sm" variant="soft">{flag(o.market)} {o.market}</Chip>
                      <Chip size="sm" variant="soft">{o.niche}</Chip>
                    </div>
                    {o.xray?.promise && (
                      <div className="mt-2 line-clamp-2 text-[12.5px] text-neutral-400">{o.xray.promise}</div>
                    )}
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      <Chip size="sm" variant="soft" color="success">Score {o.opportunityScore ?? '—'}</Chip>
                      <Chip size="sm" variant="soft">Ticket {fmtTicket(o.ticketEstCents, o.market)}</Chip>
                      <Chip size="sm" variant="soft">~{o.daysRunning}d · {o.scanCount ?? 0} scans</Chip>
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" isDisabled={curate.isPending} onPress={() => curate.mutate({ id: o.id, saved: false })}>
                    Descartar
                  </Button>
                  {o.pageUrl && (
                    <Button size="sm" variant="secondary" onPress={() => window.open(o.pageUrl!, '_blank')}>
                      Analisar oferta
                    </Button>
                  )}
                  <Button size="sm" variant="primary" isDisabled={model.isPending} onPress={() => model.mutate(o.id)}>
                    Modelar oferta →
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- helpers & sub-componentes ---------------- */

function Kpi({ label, value, sub, valueClass = '' }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <Panel className="p-4">
      <div className="text-[12px] font-medium text-neutral-400">{label}</div>
      <div className={`mt-1.5 text-[26px] font-extrabold tracking-tight tabular ${valueClass}`}>{value}</div>
      <div className="mt-1 text-[12px] text-neutral-500">{sub}</div>
    </Panel>
  );
}

function MarketPills({ market, setMarket }: { market: Market; setMarket: (m: Market) => void }) {
  const opts: [Market, string][] = [['all', 'Todos os mercados'], ['BR', '🇧🇷 BR'], ['US', '🇺🇸 US'], ['ES', '🇪🇸 ES']];
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
      {opts.map(([k, label]) => (
        <button
          key={k}
          onClick={() => setMarket(k)}
          className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
            market === k ? 'bg-white/10 text-neutral-100' : 'text-neutral-400 hover:text-neutral-100'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] font-semibold text-neutral-200 outline-none hover:bg-white/5"
    >
      {children}
    </select>
  );
}

function ScaleDots({ score }: { score: number | null }) {
  const lvl = score == null ? 0 : score >= 80 ? 3 : score >= 65 ? 2 : 1;
  const color = lvl >= 3 ? 'bg-green-500' : 'bg-amber-500';
  return (
    <span className="inline-flex items-end gap-0.5">
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className={`w-1 rounded-sm ${i < lvl ? color : 'bg-white/15'}`}
          style={{ height: `${6 + i * 3}px` }}
        />
      ))}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <Panel className="p-4 text-[13.5px] text-neutral-400">{text}</Panel>;
}

function ApiError() {
  return (
    <Panel className="p-4 text-red-400">
      Não consegui falar com a API. Confira se ela está rodando e o banco foi semeado (<code>pnpm db:seed</code>).
    </Panel>
  );
}

function flag(m: string): string {
  return ({ BR: '🇧🇷', US: '🇺🇸', ES: '🇪🇸', PT: '🇵🇹', MX: '🇲🇽' } as Record<string, string>)[m] ?? '🌐';
}

function fmtTicket(cents: number | null, market: string): string {
  if (cents == null) return '—';
  const currency = market === 'US' ? 'USD' : market === 'ES' ? 'EUR' : 'BRL';
  const locale = market === 'US' ? 'en-US' : market === 'ES' ? 'es-ES' : 'pt-BR';
  return (cents / 100).toLocaleString(locale, { style: 'currency', currency });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return `há ${h}h`;
}

function synthSeries(status: string): number[] {
  const map: Record<string, number[]> = {
    breakout: [10, 12, 14, 18, 24, 32, 44, 58, 74, 88, 96, 100],
    rising: [60, 63, 62, 68, 70, 74, 78, 80, 85, 88, 92, 96],
    stable: [80, 82, 79, 83, 81, 84, 82, 85, 83, 84, 82, 85],
    seasonal: [70, 50, 40, 45, 55, 60, 58, 52, 48, 62, 80, 95],
    declining: [95, 80, 55, 35, 25, 20, 22, 28, 40, 55, 70, 82],
  };
  return map[status] ?? map.stable;
}

function statusColor(status: string): string {
  return ({ breakout: '#f59e0b', rising: '#22c55e', stable: '#94a3b8', seasonal: '#66aaf9', declining: '#ef4444' } as Record<string, string>)[status] ?? '#94a3b8';
}

function statusChipColor(status: string): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  return ({ breakout: 'warning', rising: 'success', stable: 'default', seasonal: 'accent', declining: 'danger' } as Record<string, 'default' | 'accent' | 'success' | 'warning' | 'danger'>)[status] ?? 'default';
}

function statusLabel(status: string): string {
  return ({ breakout: 'breakout', rising: 'em alta', stable: 'estável', seasonal: 'sazonal', declining: 'declínio' } as Record<string, string>)[status] ?? status;
}
