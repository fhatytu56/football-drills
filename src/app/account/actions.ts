'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getGroup } from '@/lib/groups'

// Only ever send people back to one of our own group pages.
function safeNext(raw: FormDataEntryValue | null) {
  const group = getGroup(String(raw || '').replace(/^\//, ''))
  return group ? `/${group.id}` : '/'
}

/**
 * A coach swaps the temporary password the club gave them for their own.
 * No email involved: they must type the current password, and the new one twice.
 */
export async function changePassword(formData: FormData) {
  const next = safeNext(formData.get('next'))
  const back = (key: 'error' | 'message', text: string) =>
    redirect(`/account?next=${encodeURIComponent(next)}&${key}=${encodeURIComponent(text)}`)

  const current = String(formData.get('current') || '')
  const password = String(formData.get('password') || '')
  const again = String(formData.get('again') || '')

  if (password.length < 8) back('error', 'The new password needs at least 8 characters.')
  if (password !== again) back('error', "The two new passwords don't match.")
  if (password === current) back('error', 'The new password must be different from the current one.')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect(`/login?next=${encodeURIComponent(next)}`)

  const check = await supabase.auth.signInWithPassword({ email: user.email, password: current })
  if (check.error) back('error', 'Your current password is wrong.')

  const { error } = await supabase.auth.updateUser({ password })
  if (error) back('error', error.message)

  back('message', 'Password changed. Use the new one next time you sign in.')
}
