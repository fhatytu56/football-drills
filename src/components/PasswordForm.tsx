'use client'

import { useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { changePassword } from '@/app/account/actions'
import { Loader2 } from 'lucide-react'

const FIELDS = [
  { name: 'current', label: 'Current password', autoComplete: 'current-password' },
  { name: 'password', label: 'New password (8+ characters)', autoComplete: 'new-password' },
  { name: 'again', label: 'New password again', autoComplete: 'new-password' },
]

export default function PasswordForm() {
  const [isPending, startTransition] = useTransition()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const message = searchParams.get('message')
  const next = searchParams.get('next') || '/'

  return (
    <form
      action={(formData) => startTransition(() => changePassword(formData))}
      className="space-y-3"
    >
      <input type="hidden" name="next" value={next} />
      {FIELDS.map((f) => (
        <div key={f.name}>
          <label htmlFor={f.name} className="block text-xs font-semibold text-slate-700 mb-1">{f.label}</label>
          <input
            id={f.name}
            name={f.name}
            type="password"
            required
            minLength={f.name === 'current' ? undefined : 8}
            autoComplete={f.autoComplete}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
        </div>
      ))}

      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      {message && <p className="text-xs text-emerald-700" role="status">{message}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition disabled:opacity-60"
      >
        {isPending ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Change password'}
      </button>
    </form>
  )
}
