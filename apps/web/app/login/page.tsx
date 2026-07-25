'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { setToken, type AuthUser } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { email, password });
      setToken(res.token);
      router.replace('/radar');
    } catch (err) {
      setError((err as Error).message || 'Falha no login');
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-7 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 text-sm font-extrabold text-white">
            F
          </div>
          <span className="text-[16px] font-bold tracking-tight">Forja OS</span>
        </div>

        <h1 className="text-[18px] font-bold">Entrar</h1>
        <p className="mb-5 text-[13px] text-neutral-400">Acesse o painel de operação.</p>

        <label className="mb-1 block text-[12px] font-semibold text-neutral-400">E-mail</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="username"
          className="mb-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] outline-none transition-colors focus:border-blue-500"
        />

        <label className="mb-1 block text-[12px] font-semibold text-neutral-400">Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[14px] outline-none transition-colors focus:border-blue-500"
        />

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
