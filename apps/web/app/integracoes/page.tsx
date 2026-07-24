'use client';

import { useQuery } from '@tanstack/react-query';
import { Chip } from '@heroui/react';
import { api } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';

type Integration = {
  id: string;
  provider: string;
  status: string;
  meta?: Record<string, unknown> | null;
};

const CATALOG: Record<string, { label: string; group: string }> = {
  siliconflow: { label: 'SiliconFlow (Qwen)', group: 'IA & Ingestão' },
  urlscan: { label: 'urlscan.io', group: 'IA & Ingestão' },
  serpapi: { label: 'SerpApi (Google Trends)', group: 'IA & Ingestão' },
  cakto: { label: 'Cakto', group: 'Pagamentos' },
  stripe: { label: 'Stripe', group: 'Pagamentos' },
  hotmart: { label: 'Hotmart', group: 'Pagamentos' },
  meta: { label: 'Meta', group: 'Tráfego' },
  tiktok: { label: 'TikTok', group: 'Tráfego' },
};

const GROUPS = ['IA & Ingestão', 'Pagamentos', 'Tráfego'];

export default function IntegracoesPage() {
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<Integration[]>('/integrations') });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-extrabold tracking-tight">Integrações</h1>
        <p className="mt-1 text-[13.5px] text-neutral-400">Status das conexões do Forja.</p>
      </div>

      {q.isLoading && <Loading label="Carregando…" />}
      {q.isError && <Panel className="p-4 text-red-400">Não consegui carregar as integrações (API offline?).</Panel>}

      {q.data &&
        GROUPS.map((group) => {
          const items = q.data.filter((i) => (CATALOG[i.provider]?.group ?? 'Outros') === group);
          if (items.length === 0) return null;
          return (
            <Panel key={group} className="space-y-2 p-4">
              <div className="text-[13px] font-bold">{group}</div>
              <div className="divide-y divide-white/10">
                {items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex-1 font-semibold capitalize">{CATALOG[i.provider]?.label ?? i.provider}</span>
                    <Chip size="sm" variant="soft" color={i.status === 'connected' ? 'success' : 'default'}>
                      {i.status === 'connected' ? 'conectado' : 'desconectado'}
                    </Chip>
                  </div>
                ))}
              </div>
            </Panel>
          );
        })}
    </div>
  );
}
