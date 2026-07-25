// Parsing do crescimento de demanda vindo do Trends (`growth90d`), formato livre
// tipo "+120%" ou "-8%". Isolado do job de enriquecimento porque é a única
// lógica pura ali dentro e o job em si não tem outra rede de teste.

export function parseGrowth(pct: string | null): number | null {
  if (!pct) return null;
  const n = Number(pct.replace(/[+%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
