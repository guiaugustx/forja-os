'use client';

// Anel de score (SVG) — portado do protótipo (reference/prototype.html:1484-1491).
export function ScoreRing({ score, size = 64 }: { score: number | null; size?: number }) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  const color = value >= 80 ? '#22c55e' : value >= 65 ? '#f59e0b' : '#94a3b8';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.3}
        fontWeight={800}
        fill="currentColor"
      >
        {score == null ? '—' : Math.round(value)}
      </text>
    </svg>
  );
}
