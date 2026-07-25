'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getToken, clearToken, type AuthUser } from '@/lib/auth';

const items = [
  { key: '/radar', label: 'Radar' },
  { key: '/esteira', label: 'Esteira' },
  { key: '/gerador', label: 'Gerador' },
  { key: '/integracoes', label: 'Integrações' },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const isActive = (key: string) => pathname === key || pathname.startsWith(key + '/');

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<AuthUser>('/auth/me'),
    enabled: !!getToken(),
    staleTime: 5 * 60 * 1000,
  });
  const label = me.data?.name || me.data?.email || '—';
  const initial = (me.data?.name || me.data?.email || 'U').charAt(0).toUpperCase();

  function logout() {
    clearToken();
    qc.clear();
    router.replace('/login');
  }

  return (
    <header className="sticky top-0 z-40 flex h-[60px] items-center gap-6 border-b border-white/10 bg-[#09090b]/85 px-7 backdrop-blur-md">
      <div className="flex items-center gap-2.5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-extrabold text-white">
          F
        </div>
        <span className="text-[15px] font-bold tracking-tight text-neutral-100">Forja OS</span>
      </div>

      <nav className="flex h-full items-center">
        {items.map((it) => {
          const active = isActive(it.key);
          return (
            <button
              key={it.key}
              onClick={() => router.push(it.key)}
              className={`relative flex h-full items-center px-3.5 text-[13.5px] font-semibold transition-colors ${
                active ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-100'
              }`}
            >
              {it.label}
              {active && <span className="absolute inset-x-3.5 -bottom-px h-0.5 rounded bg-blue-500" />}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-[12.5px] font-semibold leading-tight text-neutral-100">{label}</div>
          {me.data?.role === 'admin' && <div className="text-[10.5px] text-neutral-500">admin</div>}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-500 text-xs font-bold text-white">
          {initial}
        </div>
        <button
          onClick={logout}
          title="Sair"
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[12.5px] text-neutral-400 transition-colors hover:text-neutral-100"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
