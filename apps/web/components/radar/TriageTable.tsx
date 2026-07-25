'use client';

import { Button, Chip } from '@heroui/react';
import type { CandidateDTO } from '@forja/types';

export type Decision = 'pipeline' | 'analysis' | 'discard';

interface Props {
  items: CandidateDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDecide: (id: string, decision: Decision) => void;
  busy: boolean;
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Tabela densa: ~20 candidatos por tela. O objetivo é comparar antes de decidir e
// resolver blocos inteiros de uma vez — por isso a linha é baixa e o screenshot
// pequeno, ampliando só no hover.
export function TriageTable({ items, selected, onToggle, onToggleAll, onDecide, busy }: Props) {
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="w-8 p-2">
              <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="Selecionar todos" />
            </th>
            <th className="w-16 p-2" />
            <th className="p-2">Oferta</th>
            <th className="w-24 p-2">Dias no ar</th>
            <th className="w-20 p-2">Hits</th>
            <th className="w-32 p-2">Fonte</th>
            <th className="w-40 p-2 text-right">Decisão</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id} className="border-t border-white/10 align-middle hover:bg-white/[0.03]">
              <td className="p-2">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => onToggle(c.id)}
                  aria-label={`Selecionar ${c.domain}`}
                />
              </td>
              <td className="p-2">
                {c.screenshotUrl ? (
                  <a href={c.url} target="_blank" rel="noreferrer" title="Abrir a página">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.screenshotUrl}
                      alt=""
                      loading="lazy"
                      className="h-9 w-14 rounded object-cover object-top transition-transform hover:scale-[3] hover:shadow-2xl"
                    />
                  </a>
                ) : (
                  <div className="h-9 w-14 rounded bg-white/5" />
                )}
              </td>
              <td className="max-w-[380px] p-2">
                <div className="truncate font-semibold">
                  {c.source.kind === 'checkout' ? (c.productName ?? c.title ?? c.domain) : c.domain}
                </div>
                <div className="truncate text-[11.5px] text-neutral-500">
                  {c.source.kind === 'checkout'
                    ? `${fmtPrice(c.priceCents)} · ${c.gateway ?? c.domain}`
                    : (c.title ?? '—')}
                </div>
              </td>
              <td className="p-2">
                <b>{c.daysRunning}</b>
                {c.daysRunning >= 120 && (
                  <Chip className="ml-1.5" size="sm" variant="soft" color="success">
                    vencedora
                  </Chip>
                )}
              </td>
              <td className="p-2 tabular-nums">{c.hitCount}</td>
              <td className="p-2 text-[11.5px] text-neutral-400">{c.source.name}</td>
              <td className="whitespace-nowrap p-2 text-right">
                {/* Button (react-aria) não repassa `title` nativo — o span em volta
                    é quem dá o tooltip do mouse; o botão continua descrevendo a
                    ação em aria-label para leitor de tela. */}
                <span title="Mandar para a esteira">
                  <Button size="sm" variant="ghost" isDisabled={busy} aria-label="Mandar para a esteira" onPress={() => onDecide(c.id, 'pipeline')}>
                    ✓
                  </Button>
                </span>{' '}
                <span title="Mandar para análise">
                  <Button size="sm" variant="ghost" isDisabled={busy} aria-label="Mandar para análise" onPress={() => onDecide(c.id, 'analysis')}>
                    ?
                  </Button>
                </span>{' '}
                <span title="Descartar">
                  <Button size="sm" variant="ghost" isDisabled={busy} aria-label="Descartar" onPress={() => onDecide(c.id, 'discard')}>
                    ✕
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
