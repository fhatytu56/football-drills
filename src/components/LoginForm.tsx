'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { signInWithPassword, signUp } from '@/app/login/actions'
import { Loader2 } from 'lucide-react'

export default function LoginForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [isPending, startTransition] = useTransition()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const message = searchParams.get('message')

  const action = mode === 'login' ? signInWithPassword : signUp

  return (
    <div>
      <form
        action={(formData) => startTransition(() => action(formData))}
        className="space-y-3"
      >
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="w-full px-3 py-2.5 border rounded-xl text-sm"
        />
        <input
          name="password"
          type="password"
          required
          minLength={6}
          placeholder="Password"
          className="w-full px-3 py-2.5 border rounded-xl text-sm"
        />

        {error && <p className="text-xs text-red-500">{error}</p>}
        {message && <p className="text-xs text-club-600">{message}</p>}

        <button
          type="submit"
          disabled={isPending}
          className="w-full bg-club-700 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
        >
          {isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : mode === 'login' ? 'Sign In' : 'Sign Up'}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        className="w-full text-center text-xs text-gray-500 mt-4"
      >
        {mode === 'login' ? "No account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  )
}
