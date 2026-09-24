import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Users, ExternalLink, Hash, Wrench, ArrowLeft } from 'lucide-react'
import DeleteDrillButton from '@/components/DeleteDrillButton'
import ReportDrillButton from '@/components/ReportDrillButton'
import VideoEmbed from '@/components/VideoEmbed'

export default async function DrillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: drill, error } = await supabase
    .from('drills')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !drill) notFound()

  const { data: tagLinks } = await supabase
    .from('drill_tags')
    .select('tags(id, name, slug)')
    .eq('drill_id', id)

  const tags = tagLinks?.map((t: any) => t.tags).filter(Boolean) ?? []

  const isOwner = user?.id === drill.user_id

  return (
    <main className="min-h-screen bg-gray-50 pb-28">
      <header className="sticky top-0 z-10 bg-club-800 px-4 py-3 flex items-center gap-3 shadow-sm">
        <Link href="/" className="text-white/80 hover:text-white transition">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-semibold text-white truncate font-display">Drill Details</h1>
      </header>

      <div className="bg-white rounded-b-2xl shadow-sm overflow-hidden">
        <VideoEmbed url={drill.url} platform={drill.platform} title={drill.title} />

        <div className="p-4 space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 font-display leading-snug">{drill.title}</h2>
            <a
              href={drill.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-club-600 mt-1 font-medium"
            >
              Open on {drill.platform} <ExternalLink size={13} />
            </a>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-1 bg-club-700 text-white text-xs font-semibold rounded-full">
              {drill.age_category.toUpperCase()}
            </span>
            <span className="px-2.5 py-1 bg-club-50 text-club-700 text-xs font-medium rounded-full capitalize">
              {drill.game_phase.replace('_', ' ')}
            </span>
            <span className="flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
              <Users size={11} />
              {drill.player_count_min}-{drill.player_count_max} players
            </span>
          </div>

          {drill.equipment_needed && drill.equipment_needed.length > 0 && (
            <div>
              <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                <Wrench size={12} /> Equipment
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {drill.equipment_needed.map((eq: string) => (
                  <span key={eq} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full border border-amber-100">
                    {eq}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tags.length > 0 && (
            <div>
              <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                <Hash size={12} /> Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag: any) => (
                  <span key={tag.id} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-100">
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {!isOwner && (
            <div className="pt-2 border-t">
              <ReportDrillButton drillId={drill.id} />
            </div>
          )}
        </div>
      </div>

      {isOwner && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex gap-2 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
          <Link
            href={`/drills/${drill.id}/edit`}
            className="flex-1 text-center py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
          >
            Edit
          </Link>
          <DeleteDrillButton drillId={drill.id} />
        </div>
      )}
    </main>
  )
}
