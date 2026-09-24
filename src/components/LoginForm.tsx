'use client'

import { useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { signInWithPassword } from '@/app/login/actions'
import { Loader2 } from 'lucide-react'

export default function LoginForm() {
  const [isPending, startTransition] = useTransition()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const message = searchParams.get('message')
  const next = searchParams.get('next') || '/'

  return (
    <form
      action={(formData) => startTransition(() => signInWithPassword(formData))}
      className="space-y-3"
    >
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition disabled:opacity-60"
      >
        {isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Sign In'}
      </button>
    </form>
  )
}
