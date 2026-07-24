import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { TopNav } from '@/components/layout/TopNav';

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'] });

export const metadata: Metadata = {
  title: 'Forja OS',
  description: 'Central de operação de produtos low ticket globais',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`dark ${inter.className}`} data-theme="dark">
      <body className="min-h-screen bg-[#09090b] text-neutral-100 antialiased">
        <Providers>
          <TopNav />
          <main className="mx-auto w-full max-w-[1440px] px-7 py-7">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
