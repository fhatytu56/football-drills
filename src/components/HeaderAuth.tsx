import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LogIn, LayoutList } from 'lucide-react'
import { signOut } from '@/app/login/actions'

export default async function HeaderAuth() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <Link href="/login" className="flex items-center gap-1 text-sm text-white/90 hover:text-white font-medium">
        <LogIn size={16} /> Sign in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/my-drills" className="flex items-center gap-1 text-sm text-white/90 hover:text-white font-medium">
        <LayoutList size={16} /> My Drills
      </Link>
      <form action={signOut}>
        <button className="text-sm text-white/70 hover:text-white">Sign out</button>
      </form>
    </div>
  )
}
