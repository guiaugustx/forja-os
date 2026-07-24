'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { api, apiPost, apiPatch, brl } from '@/lib/api';
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
};

type TabKey = 'offers' | 'trends' | 'shortlist';
const TABS: [TabKey, string][] = [
  ['offers', 'Ofertas mineradas'],
  ['trends', 'Trends de termos'],
  ['shortlist', 'Shortlist pontuada'],
];

export default function RadarPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('offers');

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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Radar</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Ingestão de ofertas (urlscan) → curadoria com raio-x, sinais e score.
          </p>
        </div>
        <Button variant="primary" isDisabled={running} onPress={() => ingest.mutate()}>
          {running ? 'Minerando…' : '✦ Rodar ingestão'}
        </Button>
      </div>

      {lastRun && <RunBanner run={lastRun} />}
      {ingest.isError && (
        <Panel className="p-4 text-red-400">Falha ao disparar a ingestão. A API/Redis está rodando?</Panel>
      )}

      <div className="flex gap-1 border-b border-white/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === k ? 'border-blue-500 text-neutral-100' : 'border-transparent text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'offers' && (
        <>
          {offers.isLoading && <Loading label="Carregando ofertas…" />}
          {offers.isError && <ApiError />}
          {offers.data && offers.data.length === 0 && (
            <Empty text="Nenhuma oferta ainda. Clique em “Rodar ingestão” para minerar a partir do urlscan." />
          )}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {offers.data?.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                onCurate={(saved) => curate.mutate({ id: o.id, saved })}
                onModel={() => model.mutate(o.id)}
                busy={curate.isPending || model.isPending}
              />
            ))}
          </div>
        </>
      )}

      {tab === 'trends' && (
        <>
          {trends.isLoading && <Loading label="Carregando trends…" />}
          {trends.data && trends.data.length === 0 && (
            <Empty text="Sem trends por enquanto — a demanda (Google Trends) entra numa fase seguinte." />
          )}
          {trends.data && trends.data.length > 0 && (
            <Panel className="overflow-hidden">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="p-3">Termo</th>
                    <th className="p-3">Mercado</th>
                    <th className="p-3">Volume/mês</th>
                    <th className="p-3">90d</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Tendência</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.data.map((t) => (
                    <tr key={t.id} className="border-t border-white/10">
                      <td className="p-3 font-semibold">{t.term}</td>
                      <td className="p-3">{t.market}</td>
                      <td className="p-3 tabular">{t.volumeMonthly.toLocaleString('pt-BR')}</td>
                      <td className="p-3">{t.growth90d ?? '—'}</td>
                      <td className="p-3">
                        <Chip size="sm" variant="soft" color={trendColor(t.status)}>{t.status}</Chip>
                      </td>
                      <td className="p-3"><Sparkline points={t.series ?? []} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}

      {tab === 'shortlist' && (
        <>
          {shortlist.isLoading && <Loading label="Carregando shortlist…" />}
          {shortlist.data && shortlist.data.length === 0 && (
            <Empty text="Sua shortlist está vazia. Salve ofertas na aba “Ofertas mineradas”." />
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {shortlist.data?.map((o) => (
              <Panel key={o.id} className="flex flex-row items-center gap-4 p-4">
                <ScoreRing score={o.opportunityScore} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{o.name}</div>
                  <div className="truncate text-[11.5px] text-neutral-500">{o.advertiser}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Chip size="sm" variant="soft">{o.market}</Chip>
                    <Chip size="sm" variant="soft">{o.niche}</Chip>
                  </div>
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="primary"
                    isDisabled={model.isPending}
                    onPress={() => model.mutate(o.id)}
                  >
                    Modelar oferta
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OfferCard({
  offer: o,
  onCurate,
  onModel,
  busy,
}: {
  offer: OfferDTO;
  onCurate: (saved: boolean) => void;
  onModel: () => void;
  busy: boolean;
}) {
  return (
    <Panel className="flex flex-row gap-4 p-4">
      <div className="hidden h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-white/5 sm:block">
        {o.screenshotUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.screenshotUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-semibold">{o.name}</div>
            <div className="truncate text-[11.5px] text-neutral-500">{o.advertiser}</div>
          </div>
          <ScoreRing score={o.opportunityScore} size={48} />
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          <Chip size="sm" variant="soft">{o.market}</Chip>
          <Chip size="sm" variant="soft">{o.niche}</Chip>
          {o.ticketEstCents != null && <Chip size="sm" variant="soft">{brl(o.ticketEstCents)}</Chip>}
          {o.detectedGateway && <Chip size="sm" variant="soft" color="accent">{o.detectedGateway}</Chip>}
        </div>

        {o.xray && (
          <p className="mt-2 line-clamp-2 text-[12.5px] text-neutral-400">
            <b>Promessa:</b> {o.xray.promise} · <b>Ângulo:</b> {o.xray.angle}
          </p>
        )}

        <div className="mt-1.5 text-[11.5px] text-neutral-500">
          persistência ~{o.daysRunning}d · {o.scanCount ?? 0} scans
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {o.saved ? (
            <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => onCurate(false)}>
              ✓ Salva
            </Button>
          ) : (
            <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => onCurate(true)}>
              Salvar
            </Button>
          )}
          <Button size="sm" variant="primary" isDisabled={busy} onPress={onModel}>
            Modelar
          </Button>
          {o.pageUrl && (
            <Button size="sm" variant="ghost" onPress={() => window.open(o.pageUrl!, '_blank')}>
              Ver página
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function RunBanner({ run }: { run: IngestionRunDTO }) {
  const color = run.status === 'error' ? 'danger' : run.status === 'done' ? 'success' : 'warning';
  const label =
    run.status === 'running'
      ? 'Ingestão em andamento…'
      : run.status === 'done'
        ? `Última ingestão: ${run.savedCount} de ${run.foundCount} ofertas processadas`
        : `Falha na ingestão: ${run.error ?? 'erro desconhecido'}`;
  return (
    <Panel className="flex flex-row items-center gap-3 px-4 py-2.5">
      <Chip size="sm" variant="soft" color={color}>{run.status}</Chip>
      <span className="text-[13px] text-neutral-400">{label}</span>
      <span className="ml-auto text-[11.5px] text-neutral-500">query: {run.query}</span>
    </Panel>
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

function trendColor(status: string): 'default' | 'success' | 'warning' | 'danger' {
  const map: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
    breakout: 'danger',
    rising: 'success',
    stable: 'default',
    seasonal: 'warning',
    declining: 'default',
  };
  return map[status] ?? 'default';
}
