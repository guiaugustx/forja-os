'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Chip } from '@heroui/react';
import { MVP_GENERATOR_STEPS } from '@forja/types';
import type {
  OfferDraftState,
  GeneratorStepKey,
  AvatarBlock,
  BigIdeaBlock,
  OfferStackBlock,
  SalesCopyBlock,
} from '@forja/types';
import { api, apiPost, brl } from '@/lib/api';
import { Panel } from '@/components/ui/Panel';
import { Loading } from '@/components/ui/Loading';
import { useGenerator } from '@/lib/stores/generator';

export default function GeradorPage() {
  return (
    <Suspense fallback={<Loading label="Carregando gerador…" />}>
      <GeradorInner />
    </Suspense>
  );
}

function GeradorInner() {
  const params = useSearchParams();
  const router = useRouter();
  const draftId = params.get('draftId');
  const { draft, stepKey, setDraft, setStepKey } = useGenerator();

  const draftQuery = useQuery({
    queryKey: ['draft', draftId],
    queryFn: () => api<OfferDraftState>(`/offer-drafts/${draftId}`),
    enabled: !!draftId,
  });

  useEffect(() => {
    if (draftQuery.data) setDraft(draftQuery.data);
  }, [draftQuery.data, setDraft]);

  const create = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/offer-drafts', {}),
    onSuccess: (d) => router.push(`/gerador?draftId=${d.id}`),
  });

  const generate = useMutation({
    mutationFn: (step: GeneratorStepKey) =>
      apiPost<{ draft: OfferDraftState }>(`/offer-drafts/${draftId}/generate`, { step }),
    onSuccess: (res) => setDraft(res.draft),
  });

  if (!draftId) {
    return (
      <div className="space-y-4">
        <Header />
        <Panel className="space-y-3 p-4">
          <p className="text-[13.5px] text-neutral-400">Modele uma oferta salva no Radar, ou comece do zero.</p>
          <div className="flex gap-2">
            <Button variant="primary" onPress={() => router.push('/radar')}>Ir para o Radar</Button>
            <Button variant="secondary" isDisabled={create.isPending} onPress={() => create.mutate()}>
              {create.isPending ? 'Criando…' : 'Começar do zero'}
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  if (draftQuery.isLoading) return <Loading label="Carregando draft…" />;
  if (draftQuery.isError) {
    return <Panel className="p-4 text-red-400">Draft não encontrado. Volte ao Radar e clique em “Modelar”.</Panel>;
  }

  const current = draft ?? draftQuery.data ?? null;

  return (
    <div className="space-y-4">
      <Header />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_300px]">
        <StepperNav stepKey={stepKey} setStepKey={setStepKey} draft={current} />
        <StepPanel
          stepKey={stepKey}
          draft={current}
          onGenerate={() => generate.mutate(stepKey)}
          generating={generate.isPending}
          error={generate.isError}
        />
        <ContextSidebar draft={current} />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-[22px] font-extrabold tracking-tight">Gerador de ofertas</h1>
      <p className="mt-1 text-[13.5px] text-neutral-400">
        Modelagem por IA — núcleo + copy de vendas. Cada etapa usa o contexto acumulado.
      </p>
    </div>
  );
}

function isDone(draft: OfferDraftState | null, key: GeneratorStepKey): boolean {
  return !!draft && !!draft[key];
}

function StepperNav({
  stepKey,
  setStepKey,
  draft,
}: {
  stepKey: GeneratorStepKey;
  setStepKey: (k: GeneratorStepKey) => void;
  draft: OfferDraftState | null;
}) {
  return (
    <Panel className="h-fit p-2">
      <div className="flex flex-col gap-1">
        {MVP_GENERATOR_STEPS.map((s, i) => {
          const active = s.key === stepKey;
          const done = isDone(draft, s.key);
          return (
            <button
              key={s.key}
              onClick={() => setStepKey(s.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                active ? 'bg-blue-500/15 text-neutral-100' : 'text-neutral-400 hover:bg-white/5'
              }`}
            >
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  done ? 'bg-green-500 text-white' : 'bg-white/10 text-neutral-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <span className="font-semibold">{s.label}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function StepPanel({
  stepKey,
  draft,
  onGenerate,
  generating,
  error,
}: {
  stepKey: GeneratorStepKey;
  draft: OfferDraftState | null;
  onGenerate: () => void;
  generating: boolean;
  error: boolean;
}) {
  const def = MVP_GENERATOR_STEPS.find((s) => s.key === stepKey)!;
  const missingDeps = def.dependsOn.filter((d) => !isDone(draft, d));
  const done = isDone(draft, stepKey);

  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">{def.label}</h2>
          <p className="text-[12.5px] text-neutral-400">{def.description}</p>
        </div>
        <Button variant="primary" isDisabled={generating} onPress={onGenerate}>
          {generating ? 'Gerando…' : done ? '↻ Regerar' : '✦ Gerar com IA'}
        </Button>
      </div>

      {missingDeps.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-400">
          Dica: gere antes {missingDeps.map((d) => MVP_GENERATOR_STEPS.find((s) => s.key === d)?.label).join(', ')} para um resultado mais coerente.
        </div>
      )}
      {error && <div className="text-[12.5px] text-red-400">Falha ao gerar. Verifique a chave do SiliconFlow.</div>}

      {done ? (
        <StepContent stepKey={stepKey} draft={draft} />
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-[13px] text-neutral-500">
          Nada gerado ainda. Clique em “Gerar com IA”.
        </div>
      )}
    </Panel>
  );
}

function StepContent({ stepKey, draft }: { stepKey: GeneratorStepKey; draft: OfferDraftState | null }) {
  if (!draft) return null;
  if (stepKey === 'avatar' && draft.avatar) return <AvatarView v={draft.avatar} />;
  if (stepKey === 'bigIdea' && draft.bigIdea) return <BigIdeaView v={draft.bigIdea} />;
  if (stepKey === 'stack' && draft.stack) return <StackView v={draft.stack} />;
  if (stepKey === 'salesCopy' && draft.salesCopy) return <SalesCopyView v={draft.salesCopy} />;
  return null;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="text-[12px] font-bold text-neutral-400">{title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function AvatarView({ v }: { v: AvatarBlock }) {
  return (
    <div className="space-y-3">
      <Field label="Demografia" value={v.demographic} />
      <Field label="Nível de consciência" value={v.awarenessLevel} />
      <List title="Desejos" items={v.desires} />
      <List title="Dores" items={v.pains} />
      <List title="Objeções" items={v.objections} />
      <List title="Crenças" items={v.beliefs} />
    </div>
  );
}

function BigIdeaView({ v }: { v: BigIdeaBlock }) {
  return (
    <div className="space-y-3">
      <Field label="Grande ideia" value={v.bigIdea} />
      <Field label="Mecanismo único" value={v.uniqueMechanism} />
      <Field label="Diferenciação da base" value={v.differentiation} />
      <Field label="Headline da promessa" value={v.promiseHeadline} />
    </div>
  );
}

function StackView({ v }: { v: OfferStackBlock }) {
  return (
    <div className="space-y-3">
      <OfferItem label="Principal" item={v.mainOffer} />
      {v.bump && <OfferItem label="Order bump" item={v.bump} />}
      {v.upsell && <OfferItem label="Upsell" item={v.upsell} />}
      <Field label="Garantia" value={v.guarantee} />
      {v.bonuses?.length > 0 && (
        <div>
          <div className="text-[12px] font-bold text-neutral-400">Bônus</div>
          <ul className="mt-1 space-y-1 text-[13px]">
            {v.bonuses.map((b, i) => (
              <li key={i}><b>{b.name}</b> — {b.description}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OfferItem({ label, item }: { label: string; item: { name: string; description: string; priceCents: number } }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-neutral-400">{label}</span>
        <Chip size="sm" variant="soft" color="success">{brl(item.priceCents)}</Chip>
      </div>
      <div className="mt-0.5 text-[13px] font-semibold">{item.name}</div>
      <div className="text-[12.5px] text-neutral-400">{item.description}</div>
    </div>
  );
}

function SalesCopyView({ v }: { v: SalesCopyBlock }) {
  return (
    <div className="space-y-3">
      <Field label="Headline" value={v.headline} />
      <Field label="Subheadline" value={v.subheadline} />
      {v.leadParagraphs?.map((p, i) => <p key={i} className="text-[13px] text-neutral-300">{p}</p>)}
      <List title="Bullets" items={v.bullets} />
      <Field label="Oferta" value={v.offerBlock} />
      <Field label="Garantia" value={v.guaranteeBlock} />
      <Field label="CTA" value={v.cta} />
      {v.faq?.length > 0 && (
        <div>
          <div className="text-[12px] font-bold text-neutral-400">FAQ</div>
          <ul className="mt-1 space-y-1 text-[13px]">
            {v.faq.map((f, i) => <li key={i}><b>{f.q}</b> {f.a}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[12px] font-bold text-neutral-400">{label}</div>
      <div className="text-[13px]">{value}</div>
    </div>
  );
}

function ContextSidebar({ draft }: { draft: OfferDraftState | null }) {
  const xray = draft?.base?.xray;
  return (
    <Panel className="h-fit space-y-3 p-4">
      <div className="text-[13px] font-bold">Contexto</div>

      <div>
        <div className="text-[11.5px] font-bold uppercase tracking-wide text-neutral-500">Oferta base</div>
        {xray ? (
          <div className="mt-1 space-y-1 text-[12.5px]">
            <div><b>Promessa:</b> {xray.promise}</div>
            <div><b>Mecanismo:</b> {xray.mechanism}</div>
            <div><b>Ângulo:</b> {xray.angle}</div>
            <div><b>Ticket est.:</b> {brl(xray.ticketEstCents)}</div>
          </div>
        ) : (
          <div className="mt-1 text-[12px] text-neutral-500">Sem oferta base (draft do zero).</div>
        )}
      </div>

      <div>
        <div className="text-[11.5px] font-bold uppercase tracking-wide text-neutral-500">Acumulado</div>
        <ul className="mt-1 space-y-0.5 text-[12.5px]">
          {MVP_GENERATOR_STEPS.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={isDone(draft, s.key) ? 'text-green-400' : 'text-neutral-500'}>
                {isDone(draft, s.key) ? '✓' : '○'}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
