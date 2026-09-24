import Image from 'next/image'
import Link from 'next/link'
import { Users, PlayCircle } from 'lucide-react'
import type { Drill } from '@/types/database.types'

export default function DrillCard({ drill }: { drill: Drill }) {
  return (
    <Link
      href={`/drills/${drill.id}`}
      className="block bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm active:scale-[0.98] transition"
    >
      <div className="relative aspect-video bg-gray-100">
        {drill.thumbnail_url ? (
          <Image
            src={drill.thumbnail_url}
            alt={drill.title}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 50vw, 25vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-300">
            <PlayCircle size={32} />
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 bg-club-800/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
          {drill.age_category.toUpperCase()}
        </span>
      </div>

      <div className="p-2.5">
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight">
          {drill.title}
        </h3>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-500">
          <span className="flex items-center gap-0.5">
            <Users size={11} />
            {drill.player_count_min}-{drill.player_count_max}
          </span>
          <span className="truncate capitalize">
            {drill.game_phase.replace('_', ' ')}
          </span>
        </div>
      </div>
    </Link>
  )
}
