'use client';

// Sparkline (SVG) — portado do protótipo (reference/prototype.html:1398-1402).
export function Sparkline({
  points,
  width = 120,
  height = 32,
  color = '#8b5cf6',
}: {
  points: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (!points || points.length < 2) return <span className="text-[11px] text-default-400">—</span>;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - ((p - min) / range) * height).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={d}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
