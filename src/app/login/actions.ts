'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getGroup } from '@/lib/groups'

// Only ever send people back to one of our own group pages.
function safeNext(raw: FormDataEntryValue | null) {
  const group = getGroup(String(raw || '').replace(/^\//, ''))
  return group ? `/${group.id}` : '/'
}

export async function signInWithPassword(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  const next = safeNext(formData.get('next'))
  if (error) {
    redirect(`/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(error.message)}`)
  }
  redirect(next)
}

export async function signUp(formData: FormData) {
  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  })

  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`)
  redirect('/login?message=Check your email to confirm your account')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}
