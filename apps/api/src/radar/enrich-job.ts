// jobId determinístico do enrich de uma oferta. Sem ':' — o BullMQ 5.81 tolera
// ':' apenas com exatamente 3 segmentos por compat legado (o próprio código da
// lib marca isso como TODO para remoção num major futuro), então evitamos
// depender dessa muleta e usamos hífen.
//
// Extraído para cá porque duas rotas enfileiram o job enrich para a mesma
// oferta — a triagem (candidates.service.ts) e o "tentar de novo"
// (radar.service.ts) — e as duas precisam concordar no mesmo id: é ele que
// permite ao desfazer localizar e cancelar o job certo.
export function enrichJobId(offerId: string): string {
  return `enrich-${offerId}`;
}
