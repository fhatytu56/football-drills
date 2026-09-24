'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const searchParams = useSearchParams();
  const message = searchParams.get('message');

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-md max-w-sm w-full">
        <h1 className="text-xl font-bold text-slate-800 mb-2">Wayside Celtic u10s</h1>
        <p className="text-xs text-slate-500 mb-4">Please log in to manage drills and training sessions.</p>
        
        {message && (
          <div className="mb-4 p-2 bg-amber-50 text-amber-800 text-xs rounded border border-amber-200">
            {message}
          </div>
        )}

        <form action="/auth/login" method="post" className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500">Loading login...</div>}>
      <LoginForm />
    </Suspense>
  );
}
