'use client';

import { useEffect, useRef } from 'react';
import { Button, Chip } from '@heroui/react';
import type { CandidateDTO } from '@forja/types';

export type Decision = 'pipeline' | 'analysis' | 'discard';

interface Props {
  items: CandidateDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDecide: (id: string, decision: Decision) => void;
  // Descarta o grupo inteiro de spray de TLD (o representante + os irmãos
  // escondidos), reusando o descarte em lote.
  onDiscardGroup: (ids: string[]) => void;
  busy: boolean;
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Rótulos curtos dos pixels para a coluna caber em tabela densa.
const PIXEL_SHORT: Record<string, string> = {
  facebook: 'fb',
  tiktok: 'tt',
  google: 'gg',
  kwai: 'kw',
  pinterest: 'pin',
  taboola: 'tb',
};

// Coluna de sinais: evidência de investimento em tráfego medida na colheita.
// signalScore null ≠ 0 — "—" é "não medido", 0 é "medido e sem nada"; a
// distinção é contrato do backfill e não pode sumir na exibição.
function SignalCell({ c }: { c: CandidateDTO }) {
  if (c.signalScore == null) {
    return <span className="text-[11px] text-neutral-600">—</span>;
  }
  const tags = c.signals?.tags ?? [];
  return (
    <div className="flex items-center gap-1">
      <b className="tabular-nums">{c.signalScore}</b>
      {tags.includes('escalando-agora') && (
        <span title="Domínio jovem já investindo em tráfego — dá para antecipar">⚡</span>
      )}
      {tags.includes('comprovada') && <span title="Roda há 60+ dias com pixel">✓</span>}
      {(c.signals?.pixels ?? []).map((p) => (
        <Chip key={p} size="sm" variant="soft" color="accent">
          {PIXEL_SHORT[p] ?? p}
        </Chip>
      ))}
      {(c.signals?.trackers ?? []).length > 0 && (
        <span title="Tracker de atribuição">
          <Chip size="sm" variant="soft" color="warning">
            utm
          </Chip>
        </span>
      )}
      {(c.signals?.players ?? []).length > 0 && (
        <span title="Player de VSL">
          <Chip size="sm" variant="soft" color="success">
            vsl
          </Chip>
        </span>
      )}
    </div>
  );
}

// Tabela densa: ~20 candidatos por tela. O objetivo é comparar antes de decidir e
// resolver blocos inteiros de uma vez — por isso a linha é baixa e o screenshot
// pequeno, ampliando só no hover.
export function TriageTable({ items, selected, onToggle, onToggleAll, onDecide, onDiscardGroup, busy }: Props) {
  const allChecked = items.length > 0 && items.every((c) => selected.has(c.id));
  const someChecked = items.some((c) => selected.has(c.id));

  // "Selecionar todos" só alcança o que já foi carregado nesta tela (a fila
  // real costuma ter milhares) — o rótulo e o indeterminate deixam isso
  // honesto. `indeterminate` não existe como prop de `input`, só como
  // propriedade imperativa do elemento, daí o ref.
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someChecked && !allChecked;
    }
  }, [someChecked, allChecked]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-500">
            <th className="w-8 p-2">
              <input
                ref={headerCheckboxRef}
                type="checkbox"
                checked={allChecked}
                onChange={onToggleAll}
                aria-label="Selecionar todos os carregados"
              />
            </th>
            <th className="w-16 p-2" />
            <th className="p-2">Oferta</th>
            <th className="w-24 p-2">Dias no ar</th>
            <th className="w-20 p-2">Hits</th>
            <th className="w-44 p-2">Sinais</th>
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
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">
                    {c.source.kind === 'checkout' ? (c.productName ?? c.title ?? c.domain) : c.domain}
                  </span>
                  {c.tldSpread != null && c.tldSpread >= 2 && (
                    <span
                      title={`Mesmo nome-base em ${c.tldSpread} TLDs (${c.tldSiblingIds?.length ?? c.tldSpread} domínios) — padrão de domínio descartável`}
                    >
                      <Chip size="sm" variant="soft" color="warning">
                        ⚠ {c.tldSpread} TLDs
                      </Chip>
                    </span>
                  )}
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
              <td className="p-2">
                <SignalCell c={c} />
              </td>
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
                {c.tldSpread != null && c.tldSpread >= 2 && c.tldSiblingIds && (
                  <>
                    {' '}
                    <span title={`Descartar os ${c.tldSiblingIds.length} domínios deste grupo`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busy}
                        aria-label="Descartar grupo de TLDs"
                        onPress={() => onDiscardGroup(c.tldSiblingIds!)}
                        className="text-amber-500"
                      >
                        ✕ grupo
                      </Button>
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
