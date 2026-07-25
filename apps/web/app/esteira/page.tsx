'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@heroui/react';
import { api, apiPost } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { MVP_GENERATOR_STEPS, type OfferDTO } from '@forja/types';

interface DraftRow {
  id: string;
  currentStep: number;
  sourceOfferId: string | null;
  sourceOffer: {
    id: string;
    name: string;
    advertiser: string;
    screenshotUrl: string | null;
    opportunityScore: number | null;
  } | null;
}

// As colunas do board são as etapas da modelagem. currentStep é o índice da
// próxima etapa a fazer — a coluna em que o draft está É a tarefa pendente.
const COLUMNS = [
  { key: 'base', label: 'Oferta base' },
  ...MVP_GENERATOR_STEPS.map((s) => ({ key: s.key, label: s.label })),
  { key: 'done', label: 'Pronta' },
];

// Erros de negócio chegam como ApiError já com a mensagem que o backend
// escreveu (`lib/api.ts` lê o corpo `{ message }`) — mesmo padrão do /radar.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function EsteiraPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);

  const drafts = useQuery({
    queryKey: ['drafts'],
    queryFn: () => api<DraftRow[]>('/offer-drafts'),
  });

  // Ofertas promovidas que ainda não viraram draft — entram na primeira coluna.
  const pipeline = useQuery({
    queryKey: ['offers', 'pipeline'],
    queryFn: () => api<OfferDTO[]>('/radar/offers?stage=pipeline'),
  });

  const startDraft = useMutation({
    mutationFn: (offerId: string) => apiPost<{ id: string }>('/offer-drafts', { sourceOfferId: offerId }),
    onSuccess: (draft) => {
      setNotice(null);
      qc.invalidateQueries({ queryKey: ['drafts'] });
      router.push(`/gerador?draftId=${draft.id}`);
    },
    onError: (err) => setNotice(errorMessage(err, 'Não consegui iniciar a modelagem dessa oferta.')),
  });

  const withDraft = useMemo(
    () => new Set((drafts.data ?? []).map((d) => d.sourceOfferId).filter(Boolean) as string[]),
    [drafts.data],
  );

  const pending = (pipeline.data ?? []).filter((o) => !withDraft.has(o.id));

  const byColumn = (index: number) =>
    (drafts.data ?? []).filter((d) =>
      index === COLUMNS.length - 1
        ? d.currentStep >= MVP_GENERATOR_STEPS.length
        : d.currentStep === index,
    );

  const loading = drafts.isLoading || pipeline.isLoading;
  const hasError = drafts.isError || pipeline.isError;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Esteira</h1>
        <p className="mt-1 text-[13.5px] text-neutral-400">
          Modelagem das ofertas aprovadas. A coluna em que a oferta está é o que falta fazer nela.
        </p>
      </div>

      {notice && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px]">
          <span className="min-w-0 flex-1">{notice}</span>
          <Button size="sm" variant="ghost" onPress={() => setNotice(null)}>
            Ok
          </Button>
        </div>
      )}

      {loading && <Loading label="Carregando a esteira…" />}

      {!loading && hasError && (
        <Panel className="p-4 text-red-400">Não consegui carregar a esteira (API offline?).</Panel>
      )}

      {!loading && !hasError && (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {COLUMNS.map((col, i) => {
            const cards = byColumn(i);
            const extra = i === 0 ? pending.length : 0;
            return (
              <div key={col.key} className="w-[260px] flex-none">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className="text-[12.5px] font-bold">{col.label}</span>
                  <span className="rounded-full bg-white/10 px-1.5 text-[11px] text-neutral-400">
                    {cards.length + extra}
                  </span>
                </div>

                <div className="space-y-2">
                  {i === 0 &&
                    pending.map((o) => (
                      <Panel key={o.id} className="p-3">
                        <div className="truncate text-[13px] font-semibold">{o.name}</div>
                        <div className="truncate text-[11.5px] text-neutral-500">{o.advertiser}</div>
                        <Button
                          size="sm"
                          variant="primary"
                          className="mt-2 w-full"
                          isDisabled={startDraft.isPending}
                          onPress={() => startDraft.mutate(o.id)}
                        >
                          Iniciar modelagem
                        </Button>
                      </Panel>
                    ))}

                  {/* Panel não aceita onClick — o clique fica no wrapper. */}
                  {cards.map((d) => (
                    <div
                      key={d.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => router.push(`/gerador?draftId=${d.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') router.push(`/gerador?draftId=${d.id}`);
                      }}
                      className="cursor-pointer"
                    >
                      <Panel className="p-3 transition-colors hover:bg-white/[0.05]">
                        <div className="truncate text-[13px] font-semibold">
                          {d.sourceOffer?.name ?? 'Oferta sem origem'}
                        </div>
                        <div className="truncate text-[11.5px] text-neutral-500">
                          {d.sourceOffer?.advertiser ?? '—'}
                        </div>
                      </Panel>
                    </div>
                  ))}

                  {cards.length + extra === 0 && (
                    <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11.5px] text-neutral-600">
                      vazio
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
