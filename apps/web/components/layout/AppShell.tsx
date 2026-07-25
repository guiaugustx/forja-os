'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TopNav } from './TopNav';
import { api } from '@/lib/api';
import { getToken, type AuthUser } from '@/lib/auth';

// Portão de autenticação de toda a aplicação. Sem token válido → /login.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isLogin = pathname === '/login';
  const token = mounted ? getToken() : null;

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<AuthUser>('/auth/me'),
    enabled: mounted && !isLogin && !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (mounted && !isLogin && !token) router.replace('/login');
  }, [mounted, isLogin, token, router]);

  // A tela de login não passa pelo portão nem mostra a navegação.
  if (isLogin) return <>{children}</>;

  if (!mounted || !token || me.isLoading) return <FullScreen />;
  // 401 já dispara redirect no cliente da API; aqui só evitamos renderizar o app.
  if (me.isError || !me.data) return <FullScreen />;

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[1440px] px-7 py-7">{children}</main>
    </>
  );
}

function FullScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b]">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-blue-500" />
    </div>
  );
}
