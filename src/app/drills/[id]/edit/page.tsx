import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import DrillForm from '@/components/DrillForm'

export default async function EditDrillPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: drill, error } = await supabase.from('drills').select('*').eq('id', id).single()
  if (error || !drill) notFound()
  if (drill.user_id !== user?.id) redirect(`/drills/${id}`)

  const { data: tagLinks } = await supabase
    .from('drill_tags')
    .select('tags(name)')
    .eq('drill_id', id)

  const tagNames = tagLinks?.map((t: any) => t.tags?.name).filter(Boolean) ?? []

  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">Edit Drill</h1>
      </header>
      <div className="p-4">
        <DrillForm mode="edit" drillId={id} initialDrill={drill} initialTags={tagNames} />
      </div>
    </main>
  )
}
