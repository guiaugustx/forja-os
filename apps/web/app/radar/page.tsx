'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Chip } from '@heroui/react';
import { api, apiPost, apiPatch } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { Sparkline } from '@/components/radar/Sparkline';
import { TriageTable, type Decision } from '@/components/radar/TriageTable';
import { AnalysisCards } from '@/components/radar/AnalysisCards';
import type {
  CandidateListDTO,
  HarvestSourceDTO,
  IngestionRunDTO,
  OfferDTO,
  BulkTriageResultDTO,
} from '@forja/types';

type TabKey = 'triage' | 'discarded' | 'analysis' | 'trends';
const TABS: [TabKey, string][] = [
  ['triage', 'Triagem'],
  ['discarded', 'Descartados pela máquina'],
  ['analysis', 'Análise'],
  ['trends', 'Trends de termos'],
];

type SortKey = 'hits' | 'days' | 'recent';

// Trends não muda de comportamento nesta entrega — segue sendo leitura pura.
interface Trend {
  id: string;
  term: string;
  market: string;
  volumeMonthly: number;
  growth90d: string | null;
  status: string;
  series: number[] | null;
}

// Erros de negócio (409 de "já triado", "enriquecimento já começou" etc.) vêm
// como texto simples no corpo do fetch que falhou — a mensagem já é a que o
// backend escreveu para um humano ler, então só precisamos exibi-la.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function RadarPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('triage');
  const [sourceId, setSourceId] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('hits');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [undoId, setUndoId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<HarvestSourceDTO[]>('/radar/sources'),
  });

  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => api<IngestionRunDTO[]>('/radar/runs'),
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === 'running') ? 2000 : false,
  });

  const status = tab === 'discarded' ? 'discarded_auto' : 'pending';
  const queryString = useMemo(() => {
    const p = new URLSearchParams({ status, sort });
    if (sourceId !== 'all') p.set('sourceId', sourceId);
    return p.toString();
  }, [status, sort, sourceId]);

  const candidates = useQuery({
    queryKey: ['candidates', queryString],
    queryFn: () => api<CandidateListDTO>(`/radar/candidates?${queryString}`),
    enabled: tab === 'triage' || tab === 'discarded',
  });

  const trends = useQuery({
    queryKey: ['trends'],
    queryFn: () => api<Trend[]>('/radar/trends'),
    enabled: tab === 'trends',
  });

  const analysis = useQuery({
    queryKey: ['offers', 'analysis'],
    queryFn: () => api<OfferDTO[]>('/radar/offers?stage=analysis'),
    enabled: tab === 'analysis',
    refetchInterval: (q) =>
      q.state.data?.some((o) => o.enrichment === 'pending' || o.enrichment === 'running')
        ? 2500
        : false,
  });

  const harvest = useMutation({
    mutationFn: () =>
      apiPost<IngestionRunDTO[]>('/radar/harvest', sourceId === 'all' ? {} : { sourceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
    onError: (err) => setNotice(errorMessage(err, 'Não consegui disparar a colheita.')),
  });

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['offers'] });
  };

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: Decision }) =>
      apiPatch(`/radar/candidates/${v.id}`, { decision: v.decision }),
    onSuccess: (_d, v) => {
      setUndoId(v.id);
      setTimeout(() => setUndoId((cur) => (cur === v.id ? null : cur)), 8000);
      refreshLists();
    },
    // 409 mais comum aqui: o candidato já foi triado por outra aba/lote — a
    // mensagem do backend já explica isso, só precisa chegar ao operador em
    // vez de morrer silenciosamente e deixar a linha "grudada" na tela.
    onError: (err) => {
      setNotice(errorMessage(err, 'Não consegui aplicar essa decisão.'));
      refreshLists();
    },
  });

  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; decision: Decision }) =>
      apiPost<BulkTriageResultDTO>('/radar/candidates/bulk', v),
    onSuccess: (res) => {
      setSelected(new Set());
      refreshLists();
      if (res.failed.length > 0) {
        setNotice(
          `${res.succeeded.length} aplicados, ${res.failed.length} falharam (ex.: ${res.failed[0].reason}).`,
        );
      }
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui aplicar a decisão em lote.')),
  });

  const undo = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/undo`),
    onSuccess: () => {
      setUndoId(null);
      refreshLists();
    },
    // 409: o enriquecimento já começou (ou já terminou) e não é mais seguro
    // desfazer sozinho — a tela precisa dizer isso em vez de fingir sucesso.
    onError: (err) => {
      setNotice(errorMessage(err, 'Não foi possível desfazer — o enriquecimento já pode ter começado.'));
      setUndoId(null);
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/restore`),
    onSuccess: refreshLists,
    onError: (err) => setNotice(errorMessage(err, 'Não consegui trazer esse candidato de volta.')),
  });

  const setStage = useMutation({
    mutationFn: (v: { id: string; stage: 'pipeline' | 'discarded' }) =>
      apiPatch(`/radar/offers/${v.id}`, { stage: v.stage }),
    onSuccess: refreshLists,
    onError: (err) => setNotice(errorMessage(err, 'Não consegui atualizar essa oferta.')),
  });

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/offers/${id}/retry-enrichment`),
    onSuccess: refreshLists,
    onError: (err) => setNotice(errorMessage(err, 'Não consegui reenfileirar o enriquecimento.')),
  });

  const items = candidates.data?.items ?? [];
  const running = runs.data?.some((r) => r.status === 'running') || harvest.isPending;
  const lastRun = runs.data?.[0];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      items.every((c) => prev.has(c.id)) ? new Set() : new Set(items.map((c) => c.id)),
    );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">Radar</h1>
          <p className="mt-1 text-[13.5px] text-neutral-400">
            Descoberta e triagem. A colheita é barata e em massa; a IA só entra no que você promove.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px]"
          >
            <option value="all">Todas as fontes</option>
            {sources.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button variant="primary" isDisabled={running} onPress={() => harvest.mutate()}>
            {running ? 'Colhendo…' : '✦ Colher'}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px]">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button size="sm" variant="ghost" onPress={() => setNotice(null)}>
            Ok
          </Button>
        </div>
      )}

      {lastRun && (
        <Panel className="px-4 py-3 text-[12.5px] text-neutral-400">
          <b className="text-neutral-200">{lastRun.source?.name ?? lastRun.query}</b> ·{' '}
          {lastRun.stage ?? lastRun.status} — {lastRun.rawHits.toLocaleString('pt-BR')} varridos ·{' '}
          {lastRun.newCandidates} novos · {lastRun.autoDiscarded} filtrados ·{' '}
          <b className="text-neutral-200">{lastRun.queuedForTriage} na fila</b>
          {lastRun.status === 'partial' && (
            <Chip className="ml-2" size="sm" variant="soft" color="warning">
              parcial — a próxima rodada continua daqui
            </Chip>
          )}
        </Panel>
      )}

      <div className="flex gap-1 border-b border-white/10">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setSelected(new Set());
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === k
                ? 'border-blue-500 text-neutral-100'
                : 'border-transparent text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {label}
            {k === tab && candidates.data && (tab === 'triage' || tab === 'discarded') && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px]">
                {candidates.data.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {undoId && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-[13px]">
          <span>Decisão aplicada.</span>
          <Button size="sm" variant="ghost" onPress={() => undo.mutate(undoId)}>
            Desfazer
          </Button>
        </div>
      )}

      {(tab === 'triage' || tab === 'discarded') && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12.5px]"
            >
              <option value="hits">Ordenar: circulação</option>
              <option value="days">Ordenar: dias no ar</option>
              <option value="recent">Ordenar: visto recentemente</option>
            </select>

            {selected.size > 0 && tab === 'triage' && (
              <div className="ml-auto flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5">
                <span className="text-[12.5px]">{selected.size} selecionados</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'pipeline' })}
                >
                  ✓ Esteira
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'analysis' })}
                >
                  ? Análise
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => bulk.mutate({ ids: [...selected], decision: 'discard' })}
                >
                  ✕ Descartar
                </Button>
              </div>
            )}
          </div>

          {candidates.isLoading && <Loading label="Carregando a fila…" />}
          {candidates.data && items.length === 0 && (
            <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
              {tab === 'triage'
                ? 'Fila vazia. Clique em "Colher" para varrer as fontes.'
                : 'Nada foi descartado automaticamente ainda.'}
            </Panel>
          )}

          {items.length > 0 && tab === 'triage' && (
            <Panel>
              <TriageTable
                items={items}
                selected={selected}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onDecide={(id, decision) => decide.mutate({ id, decision })}
                busy={decide.isPending || bulk.isPending}
              />
            </Panel>
          )}

          {items.length > 0 && tab === 'discarded' && (
            <Panel className="divide-y divide-white/10">
              {items.map((c) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.domain}</div>
                    <div className="truncate text-[11.5px] text-neutral-500">{c.title ?? '—'}</div>
                  </div>
                  <Chip size="sm" variant="soft" color="danger">
                    {c.discardReason}
                  </Chip>
                  <Button size="sm" variant="ghost" onPress={() => restore.mutate(c.id)}>
                    Trazer de volta
                  </Button>
                </div>
              ))}
            </Panel>
          )}
        </div>
      )}

      {tab === 'analysis' && (
        <AnalysisCards
          offers={analysis.data ?? []}
          loading={analysis.isLoading}
          onPromote={(id) => setStage.mutate({ id, stage: 'pipeline' })}
          onDiscard={(id) => setStage.mutate({ id, stage: 'discarded' })}
          onRetry={(id) => retry.mutate(id)}
        />
      )}

      {tab === 'trends' && (
        <>
          {trends.isLoading && <Loading label="Carregando trends…" />}
          {trends.data && trends.data.length === 0 && (
            <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
              Sem trends por enquanto — a demanda entra com a chave do SerpApi.
            </Panel>
          )}
          {trends.data && trends.data.length > 0 && (
            <Panel className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
                    <th className="p-3">Termo</th>
                    <th className="p-3">Mercado</th>
                    <th className="p-3">Tendência</th>
                    <th className="p-3">Crescimento</th>
                    <th className="p-3">Volume/mês</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.data.map((t) => (
                    <tr key={t.id} className="border-t border-white/10">
                      <td className="p-3 font-semibold">{t.term}</td>
                      <td className="p-3">{t.market}</td>
                      <td className="p-3">
                        {t.series && t.series.length > 1 ? (
                          <Sparkline points={t.series} color="#3b82f6" />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="p-3">
                        <b>{t.growth90d ?? '—'}</b>
                      </td>
                      <td className="p-3 tabular-nums">{t.volumeMonthly.toLocaleString('pt-BR')}</td>
                      <td className="p-3">
                        <Chip size="sm" variant="soft">
                          {t.status}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
