// Superfície de "card" com estilo garantido (independe dos defaults do HeroUI).
export function Panel({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-white/[0.03] ${className}`}>{children}</div>
  );
}
