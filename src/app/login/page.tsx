import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import LoginForm from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-md max-w-sm w-full">
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft className="w-4 h-4" /> Age groups
        </Link>
        <div className="flex items-center gap-3 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crest.jpg" alt="Wayside Celtic F.C. crest" className="w-12 h-12 rounded-full" />
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Coach sign in</h1>
            <p className="text-xs text-slate-500">Wayside Celtic Football Drills</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Sign in to add drills and plan sessions for your age group. Ask the club if you need an account.
        </p>
        <Suspense fallback={<div className="p-4 text-center text-xs text-slate-500">Loading…</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
