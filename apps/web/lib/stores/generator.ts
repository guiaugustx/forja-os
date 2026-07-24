import { create } from 'zustand';
import type { OfferDraftState, GeneratorStepKey } from '@forja/types';

// Estado do gerador de ofertas — o draft acumulado + a etapa selecionada.
// Hidratado a partir da API e atualizado a cada geração.
interface GeneratorState {
  draft: OfferDraftState | null;
  stepKey: GeneratorStepKey;
  setDraft: (draft: OfferDraftState | null) => void;
  setStepKey: (stepKey: GeneratorStepKey) => void;
}

export const useGenerator = create<GeneratorState>((set) => ({
  draft: null,
  stepKey: 'avatar',
  setDraft: (draft) => set({ draft }),
  setStepKey: (stepKey) => set({ stepKey }),
}));
