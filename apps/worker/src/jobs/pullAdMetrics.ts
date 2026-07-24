import { Job } from 'bullmq';

// Fase 5: puxar métricas de Meta/TikTok e gravar em CampaignMetricDaily.
export async function pullAdMetrics(_job: Job) {
  return { ok: true, note: 'stub — implementar na Fase 5' };
}
