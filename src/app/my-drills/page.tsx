import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DrillGrid from '@/components/DrillGrid'
import Link from 'next/link'
import { Plus } from 'lucide-react'

export default async function MyDrillsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: drills, error } = await supabase
    .from('drills')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">My Drills</h1>
        <Link href="/drills/new" className="p-2 rounded-full bg-club-700 text-white">
          <Plus size={16} />
        </Link>
      </header>

      <div className="px-4 mt-4">
        {error && <p className="text-red-500 text-sm">Failed to load your drills.</p>}
        {drills?.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-12">You haven&apos;t added any drills yet.</p>
        )}
        <DrillGrid drills={drills ?? []} />
      </div>
    </main>
  )
}
