'use client';

import { Spinner } from '@heroui/react';

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-neutral-400">
      <Spinner color="accent" size="sm" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
