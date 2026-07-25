'use client';

import { Button } from '@heroui/react';
import type { IngestionRunDTO } from '@forja/types';

const PHASES = ['Buscar fontes', 'Analisar páginas', 'Concluído'];

function reasonLabel(r?: string): string {
  if (!r) return 'descartada';
  const map: Record<string, string> = {
    'sem-conteudo': 'página fora do ar',
    'delivery-comida': 'delivery/comida',
    'nao-e-pagina-de-vendas': 'não é página de vendas',
    'produto-physical': 'produto físico',
    'produto-service': 'serviço',
    'produto-other': 'não é infoproduto',
    'sem-trafego': 'sem tráfego',
  };
  if (map[r]) return map[r];
  if (r.startsWith('produto-')) return 'não é digital';
  if (r.startsWith('erro')) return 'erro';
  return r;
}

export function MiningLoader({ run, onClose }: { run: IngestionRunDTO; onClose: () => void }) {
  const done = run.status === 'done';
  const error = run.status === 'error';
  const phase = done || error ? 2 : run.foundCount > 0 ? 1 : 0;
  const pct = run.foundCount > 0 ? Math.round((run.processedCount / run.foundCount) * 100) : done ? 100 : 0;
  const events = run.events ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0d10] p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-green-500' : error ? 'bg-red-500' : 'animate-pulse bg-blue-500'}`}
          />
          <div className="text-[16px] font-bold">
            {done ? 'Mineração concluída' : error ? 'Falha na mineração' : 'Minerando ofertas'}
          </div>
          <button onClick={onClose} className="ml-auto text-neutral-500 hover:text-neutral-200" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* stepper */}
        <div className="mt-5 flex items-center">
          {PHASES.map((p, i) => (
            <div key={p} className="flex flex-1 items-center gap-2 last:flex-none">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  i < phase || (done && i === 2)
                    ? 'bg-green-500 text-white'
                    : i === phase && !done
                      ? 'bg-blue-500 text-white'
                      : 'bg-white/10 text-neutral-500'
                }`}
              >
                {i < phase || (done && i === 2) ? '✓' : i + 1}
              </div>
              <span className={`whitespace-nowrap text-[12px] ${i <= phase ? 'text-neutral-200' : 'text-neutral-500'}`}>
                {p}
              </span>
              {i < PHASES.length - 1 && <div className="mx-1 h-px flex-1 bg-white/10" />}
            </div>
          ))}
        </div>

        {/* atividade atual */}
        <div className="mt-5 truncate text-[13.5px] text-neutral-300">{run.stage ?? 'Iniciando…'}</div>

        {/* barra de progresso */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-all duration-500 ${error ? 'bg-red-500' : done ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${Math.max(pct, done ? 100 : 4)}%` }}
          />
        </div>

        {/* contadores */}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Counter label="Analisadas" value={run.processedCount} />
          <Counter label="Salvas" value={run.savedCount} className="text-green-400" />
          <Counter label="Descartadas" value={run.discardedCount} className="text-neutral-400" />
        </div>

        {/* feed de decisões */}
        <div className="mt-4 max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-white/10 bg-black/30 p-2">
          {events.length === 0 && (
            <div className="p-2 text-[12.5px] text-neutral-500">Aguardando as primeiras análises…</div>
          )}
          {events.map((e, i) => (
            <div key={`${e.domain}-${i}`} className="flex items-center gap-2 px-1 py-1 text-[12.5px]">
              <span className={e.ok ? 'text-green-400' : 'text-neutral-600'}>{e.ok ? '✓' : '✕'}</span>
              <span className="truncate text-neutral-300">{e.domain}</span>
              <span className={`ml-auto shrink-0 ${e.ok ? 'font-semibold text-green-400' : 'text-neutral-500'}`}>
                {e.ok ? 'salva' : reasonLabel(e.reason)}
              </span>
            </div>
          ))}
        </div>

        {/* rodapé */}
        <div className="mt-5 flex items-center justify-end gap-3">
          {done || error ? (
            <Button variant="primary" onPress={onClose}>
              Ver ofertas
            </Button>
          ) : (
            <button onClick={onClose} className="text-[13px] text-neutral-400 hover:text-neutral-200">
              Continuar em segundo plano
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] py-2">
      <div className={`tabular text-[22px] font-extrabold ${className}`}>{value}</div>
      <div className="text-[11px] text-neutral-500">{label}</div>
    </div>
  );
}
