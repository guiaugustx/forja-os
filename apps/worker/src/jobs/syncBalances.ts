import { Job } from 'bullmq';

// Fase 3: buscar saldo real de cada gateway (Cakto/Stripe/Hotmart) e gravar em GatewayBalance.
export async function syncBalances(_job: Job) {
  // TODO: chamar adapters de gateway e persistir.
  return { ok: true, note: 'stub — implementar na Fase 3' };
}
