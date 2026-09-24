'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { AGE_CATEGORIES, GAME_PHASES } from '@/lib/constants'
import { X } from 'lucide-react'

export default function FilterBar({
  activeAge,
  activePhase,
}: {
  activeAge?: string
  activePhase?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  const hasFilters = activeAge || activePhase

  return (
    <div className="px-4 py-3 bg-white border-b border-gray-100 space-y-2 overflow-x-auto">
      {/* Age chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {AGE_CATEGORIES.map((age) => (
          <button
            key={age}
            onClick={() => setParam('age', activeAge === age ? null : age)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition
              ${activeAge === age
                ? 'bg-club-700 text-white border-club-700'
                : 'bg-white text-gray-600 border-gray-200'}`}
          >
            {age.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Phase chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {GAME_PHASES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setParam('phase', activePhase === value ? null : value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition
              ${activePhase === value
                ? 'bg-club-500 text-white border-club-500'
                : 'bg-white text-gray-600 border-gray-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="flex items-center gap-1 text-xs text-gray-500 mt-1"
        >
          <X size={12} /> Clear filters
        </button>
      )}
    </div>
  )
}
