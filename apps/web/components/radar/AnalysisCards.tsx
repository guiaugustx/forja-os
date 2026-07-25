'use client';

import { Button, Chip } from '@heroui/react';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { ALERT_LABELS, type OfferDTO } from '@forja/types';

interface Props {
  offers: OfferDTO[];
  loading: boolean;
  onPromote: (id: string) => void;
  onDiscard: (id: string) => void;
  onRetry: (id: string) => void;
}

function fmtTicket(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Cards, não tabela: aqui se lê o dossiê, não se varre a fila. Cada card carrega
// o resultado do enriquecimento e reduz a decisão a promover ou descartar.
export function AnalysisCards({ offers, loading, onPromote, onDiscard, onRetry }: Props) {
  if (loading) return <Loading label="Carregando a fila de análise…" />;

  if (offers.length === 0) {
    return (
      <Panel className="p-8 text-center text-[13.5px] text-neutral-500">
        Nada em análise. Mande candidatos para cá com o "?" na triagem.
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {offers.map((o) => {
        const busy = o.enrichment === 'pending' || o.enrichment === 'running';
        return (
          <Panel key={o.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
              {o.screenshotUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={o.screenshotUrl}
                  alt=""
                  loading="lazy"
                  className="h-16 w-24 flex-none rounded object-cover object-top"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{o.name}</div>
                <div className="truncate text-[12px] text-neutral-500">{o.advertiser}</div>
              </div>
              {o.opportunityScore != null && (
                <div className="flex-none text-right">
                  <div className="text-[20px] font-extrabold tabular-nums">{o.opportunityScore}</div>
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500">score</div>
                </div>
              )}
            </div>

            {busy && (
              <div className="rounded-lg bg-white/5 px-3 py-2 text-[12.5px] text-neutral-400">
                ⏳ Enriquecendo — baixando a página e rodando o raio-x…
              </div>
            )}

            {o.enrichment === 'failed' && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">Falhou: {o.enrichmentError}</span>
                <Button size="sm" variant="ghost" onPress={() => onRetry(o.id)}>
                  Tentar de novo
                </Button>
              </div>
            )}

            {o.enrichment === 'done' && o.xray && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Promessa</dt>
                  <dd className="text-neutral-200">{o.xray.promise}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Mecanismo</dt>
                  <dd className="text-neutral-200">{o.xray.mechanism}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Nicho</dt>
                  <dd className="text-neutral-200">{o.niche}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Ticket</dt>
                  <dd className="text-neutral-200">{fmtTicket(o.ticketEstCents)}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Dias no ar</dt>
                  <dd className="text-neutral-200">{o.daysRunning}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-neutral-500">Tráfego</dt>
                  <dd className="text-neutral-200">{o.trafficScore ?? '—'}</dd>
                </div>
              </dl>
            )}

            {o.alerts && o.alerts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {o.alerts.map((a) => (
                  <Chip key={a} size="sm" variant="soft" color="warning">
                    {ALERT_LABELS[a] ?? a}
                  </Chip>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-1">
              {o.pageUrl && (
                <Button size="sm" variant="ghost" onPress={() => window.open(o.pageUrl!, '_blank')}>
                  Ver página
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                className="ml-auto"
                isDisabled={busy}
                onPress={() => onPromote(o.id)}
              >
                Promover para a esteira
              </Button>
              <Button size="sm" variant="ghost" onPress={() => onDiscard(o.id)}>
                Descartar
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
