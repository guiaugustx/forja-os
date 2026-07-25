'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
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

// Erros de negócio (409 de "já triado", "enriquecimento já começou" etc.) chegam
// aqui como `ApiError` — `lib/api.ts` já leu o corpo `{ message }` que o Nest
// devolve e colocou a frase em português no `.message`, então só precisamos
// exibi-la. Só cai no fallback genérico quando o corpo não trouxer mensagem
// utilizável (ex.: API totalmente fora do ar, sem resposta JSON nenhuma).
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
  const [undoDecision, setUndoDecision] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Ids das rodadas criadas pelo último clique em "Colher" nesta sessão — usados
  // só para agregar o resumo (correção 9); antes do primeiro clique, cai no
  // fallback de mostrar a rodada mais recente conhecida.
  const [dispatchRunIds, setDispatchRunIds] = useState<string[] | null>(null);

  // Só existe um timer de desfazer por vez: sem isso, decidir duas linhas em
  // sequência faz o timer da primeira fechar a faixa da segunda antes da hora,
  // e o timer sobrevive ao desmonte da página se nunca for limpo.
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

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

  // Detecta a transição de uma rodada de "running" para terminada e só então
  // atualiza a fila sozinha — comparar por id evita invalidar de novo a cada
  // polling (o status já terminado não dispara uma segunda vez) e evita loop
  // (a invalidação atinge só ['candidates'], nunca ['runs']).
  const prevRunStatuses = useRef<Map<string, IngestionRunDTO['status']>>(new Map());
  useEffect(() => {
    if (!runs.data) return;
    let justFinished = false;
    for (const r of runs.data) {
      const prevStatus = prevRunStatuses.current.get(r.id);
      if (prevStatus === 'running' && r.status !== 'running') justFinished = true;
      prevRunStatuses.current.set(r.id, r.status);
    }
    if (justFinished) qc.invalidateQueries({ queryKey: ['candidates'] });
  }, [runs.data, qc]);

  const status = tab === 'discarded' ? 'discarded_auto' : 'pending';
  const queryString = useMemo(() => {
    const p = new URLSearchParams({ status, sort });
    if (sourceId !== 'all') p.set('sourceId', sourceId);
    return p.toString();
  }, [status, sort, sourceId]);

  // Fila em massa: centenas/milhares de candidatos, não só a primeira página.
  // `useInfiniteQuery` é o caminho direto do TanStack para consumir o
  // `nextCursor` que a API já devolve, carregando mais sem recarregar a tela.
  const candidates = useInfiniteQuery({
    queryKey: ['candidates', queryString],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api<CandidateListDTO>(
        `/radar/candidates?${queryString}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
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
    onSuccess: (created) => {
      setDispatchRunIds(created.map((r) => r.id));
      setNotice(null);
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui disparar a colheita.')),
  });

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['candidates'] });
    qc.invalidateQueries({ queryKey: ['offers'] });
  };

  // Decidir uma linha é a ação mais frequente desta tela — com a fila em
  // `useInfiniteQuery`, invalidar ['candidates'] refaz TODAS as páginas já
  // carregadas em cadeia (cada uma com um COUNT(*) na API), e esse custo cresce
  // com quanto o operador já triou. Em vez disso, removemos o item decidido
  // direto do cache de cada página: zero ida ao servidor, a fila continua
  // coerente (o item não reaparece) e o "total" acompanha a remoção. Só os
  // caminhos raros (desfazer, erro) continuam pagando o preço de um invalidate
  // cheio — não são o gargalo de throughput que esta correção visa.
  const removeCandidatesFromCache = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    qc.setQueriesData<InfiniteData<CandidateListDTO>>({ queryKey: ['candidates'] }, (data) => {
      if (!data) return data;
      let removed = 0;
      const pages = data.pages.map((page) => {
        const items = page.items.filter((c) => !idSet.has(c.id));
        removed += page.items.length - items.length;
        return items.length === page.items.length ? page : { ...page, items };
      });
      if (removed === 0) return data;
      return { ...data, pages: pages.map((page) => ({ ...page, total: Math.max(0, page.total - removed) })) };
    });
  };

  const armUndo = (id: string, decision: Decision) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoId(id);
    setUndoDecision(decision);
    undoTimer.current = setTimeout(() => {
      setUndoId((cur) => (cur === id ? null : cur));
    }, 8000);
  };

  const clearUndo = () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoId(null);
    setUndoDecision(null);
  };

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: Decision }) =>
      apiPatch(`/radar/candidates/${v.id}`, { decision: v.decision }),
    onSuccess: (_d, v) => {
      armUndo(v.id, v.decision);
      setNotice(null);
      removeCandidatesFromCache([v.id]);
      // A oferta criada por essa decisão pode interessar à aba de Análise; como
      // essa query só busca quando a aba está ativa (`enabled`), invalidar aqui
      // não dispara rede nenhuma na tela de triagem — só marca como stale.
      qc.invalidateQueries({ queryKey: ['offers'] });
    },
    // 409 mais comum aqui: o candidato já foi triado por outra aba/lote — a
    // mensagem do backend já explica isso, só precisa chegar ao operador em
    // vez de morrer silenciosamente e deixar a linha "grudada" na tela. Caminho
    // raro (não é o que se repete a cada decisão), então o invalidate cheio é
    // aceitável aqui.
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
      removeCandidatesFromCache(res.succeeded);
      qc.invalidateQueries({ queryKey: ['offers'] });
      if (res.failed.length > 0) {
        setNotice(
          `${res.succeeded.length} aplicados, ${res.failed.length} falharam (ex.: ${res.failed[0].reason}).`,
        );
      } else {
        setNotice(null);
      }
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui aplicar a decisão em lote.')),
  });

  // "Desfazer" precisa chamar a rota certa para a decisão que foi tomada: a
  // API grava descarte como `discarded_manual`, e a rota `undo` só aceita
  // candidatos `promoted` — usá-la depois de um ✕ é 409 garantido. `restore` é
  // quem reverte um descarte; o operador não precisa saber que são rotas
  // diferentes, só que "Desfazer" funciona.
  const undo = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/undo`),
    onSuccess: () => {
      clearUndo();
      setNotice(null);
      refreshLists();
    },
    // 409: o enriquecimento já começou (ou já terminou) e não é mais seguro
    // desfazer sozinho — a tela precisa dizer isso em vez de fingir sucesso.
    onError: (err) => {
      setNotice(errorMessage(err, 'Não foi possível desfazer — o enriquecimento já pode ter começado.'));
      clearUndo();
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/candidates/${id}/restore`),
    onSuccess: () => {
      clearUndo();
      setNotice(null);
      refreshLists();
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui trazer esse candidato de volta.')),
  });

  const setStage = useMutation({
    mutationFn: (v: { id: string; stage: 'pipeline' | 'discarded' }) =>
      apiPatch(`/radar/offers/${v.id}`, { stage: v.stage }),
    onSuccess: () => {
      setNotice(null);
      refreshLists();
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui atualizar essa oferta.')),
  });

  const retry = useMutation({
    mutationFn: (id: string) => apiPost(`/radar/offers/${id}/retry-enrichment`),
    onSuccess: () => {
      setNotice(null);
      refreshLists();
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui reenfileirar o enriquecimento.')),
  });

  const items = useMemo(
    () => candidates.data?.pages.flatMap((p) => p.items) ?? [],
    [candidates.data],
  );
  const total = candidates.data?.pages[0]?.total ?? 0;
  // Falha na query de rodadas não pode fazer "running" virar falso por engano —
  // isso destravaria o botão "Colher" e convidaria a uma colheita duplicada
  // enquanto talvez ainda exista uma rodada em andamento que só não conseguimos
  // ler agora. Erro aqui é tratado como "assuma que está rodando".
  const running = runs.isError || runs.data?.some((r) => r.status === 'running') || harvest.isPending;

  // A lista pode encolher sem o operador pedir (decisão individual removeu a
  // linha da cache, ou a fila foi refeita depois de um desfazer). Sem esta
  // poda, "selected" continua com ids de linhas que já sumiram: o contador
  // mente e o próximo lote manda ids que a API rejeita.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(items.map((c) => c.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  // Colher "todas as fontes" dispara uma rodada por fonte (7 hoje); mostrar só
  // a mais recente escondia o resultado da varredura inteira. Enquanto o lote
  // do último clique em "Colher" ainda está nas rodadas conhecidas, o resumo
  // soma os contadores de todas elas; fora isso (ex.: reload da página sem
  // nenhum clique nesta sessão), cai no fallback de mostrar só a última rodada.
  const summaryRuns = dispatchRunIds
    ? (runs.data?.filter((r) => dispatchRunIds.includes(r.id)) ?? [])
    : (runs.data?.slice(0, 1) ?? []);

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
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1">
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
            {sources.isError && (
              <span className="text-[11px] text-red-400">Não consegui carregar as fontes.</span>
            )}
          </div>
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

      {runs.isError && (
        <Panel className="p-3 text-[13px] text-red-400">
          Não consegui carregar as rodadas de colheita (API offline?). Por segurança, &quot;Colher&quot;
          fica bloqueado até a fila voltar a responder.
        </Panel>
      )}

      {summaryRuns.length > 0 && (
        <Panel className="px-4 py-3 text-[12.5px] text-neutral-400">
          {summaryRuns.length === 1 ? (
            <>
              <b className="text-neutral-200">{summaryRuns[0].source?.name ?? summaryRuns[0].query}</b>{' '}
              · {summaryRuns[0].stage ?? summaryRuns[0].status} —{' '}
              {summaryRuns[0].rawHits.toLocaleString('pt-BR')} varridos ·{' '}
              {summaryRuns[0].newCandidates} novos · {summaryRuns[0].autoDiscarded} filtrados ·{' '}
              <b className="text-neutral-200">{summaryRuns[0].queuedForTriage} na fila</b>
            </>
          ) : (
            <>
              <b className="text-neutral-200">{summaryRuns.length} fontes</b> ·{' '}
              {summaryRuns.some((r) => r.status === 'running')
                ? 'colhendo'
                : summaryRuns.some((r) => r.status === 'error')
                  ? 'concluído com falhas'
                  : 'concluído'}{' '}
              —{' '}
              {summaryRuns.reduce((n, r) => n + r.rawHits, 0).toLocaleString('pt-BR')} varridos ·{' '}
              {summaryRuns.reduce((n, r) => n + r.newCandidates, 0)} novos ·{' '}
              {summaryRuns.reduce((n, r) => n + r.autoDiscarded, 0)} filtrados ·{' '}
              <b className="text-neutral-200">
                {summaryRuns.reduce((n, r) => n + r.queuedForTriage, 0)} na fila
              </b>{' '}
              · {summaryRuns.filter((r) => r.status !== 'running').length}/{summaryRuns.length} fontes concluídas
            </>
          )}
          {summaryRuns.some((r) => r.status === 'partial') && (
            <Chip className="ml-2" size="sm" variant="soft" color="warning">
              parcial — a próxima rodada continua daqui
            </Chip>
          )}
          {summaryRuns.some((r) => r.status === 'error') && (
            <Chip className="ml-2" size="sm" variant="soft" color="danger">
              falhou — pelo menos uma fonte não completou
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
              setNotice(null);
            }}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-[13.5px] font-semibold transition-colors ${
              tab === k
                ? 'border-blue-500 text-neutral-100'
                : 'border-transparent text-neutral-400 hover:text-neutral-100'
            }`}
          >
            {label}
            {k === tab && candidates.data && (tab === 'triage' || tab === 'discarded') && (
              <span className="rounded-full bg-white/10 px-1.5 text-[11px]">{total}</span>
            )}
          </button>
        ))}
      </div>

      {undoId && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-[13px]">
          <span>Decisão aplicada.</span>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={undo.isPending || restore.isPending}
            onPress={() => {
              if (undoDecision === 'discard') restore.mutate(undoId);
              else undo.mutate(undoId);
            }}
          >
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
                <span className="text-[12.5px]">{selected.size} selecionados (dos carregados)</span>
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
          {candidates.isError && (
            <Panel className="p-4 text-red-400">Não consegui carregar a fila (API offline?).</Panel>
          )}
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

          {items.length > 0 && (
            <div className="flex items-center justify-between text-[11.5px] text-neutral-500">
              <span>
                Mostrando {items.length.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
              </span>
              {candidates.hasNextPage && (
                <Button
                  size="sm"
                  variant="ghost"
                  isDisabled={candidates.isFetchingNextPage}
                  onPress={() => candidates.fetchNextPage()}
                >
                  {candidates.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'analysis' &&
        (analysis.isError ? (
          <Panel className="p-4 text-red-400">
            Não consegui carregar a fila de análise (API offline?).
          </Panel>
        ) : (
          <AnalysisCards
            offers={analysis.data ?? []}
            loading={analysis.isLoading}
            onPromote={(id) => setStage.mutate({ id, stage: 'pipeline' })}
            onDiscard={(id) => setStage.mutate({ id, stage: 'discarded' })}
            onRetry={(id) => retry.mutate(id)}
          />
        ))}

      {tab === 'trends' && (
        <>
          {trends.isLoading && <Loading label="Carregando trends…" />}
          {trends.isError && (
            <Panel className="p-4 text-red-400">Não consegui carregar as trends (API offline?).</Panel>
          )}
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
