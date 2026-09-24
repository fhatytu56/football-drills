'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Hash } from 'lucide-react'

interface TagOption {
  id: string
  name: string
  slug: string
}

export default function TagFilterBar({
  allTags,
  activeSlugs,
}: {
  allTags: TagOption[]
  activeSlugs: string[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function toggleTag(slug: string) {
    const params = new URLSearchParams(searchParams.toString())
    const next = activeSlugs.includes(slug)
      ? activeSlugs.filter((s) => s !== slug)
      : [...activeSlugs, slug]

    if (next.length > 0) params.set('tags', next.join(','))
    else params.delete('tags')

    router.push(`${pathname}?${params.toString()}`)
  }

  if (allTags.length === 0) return null

  return (
    <div className="px-4 py-2 bg-white border-b">
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {allTags.map((tag) => {
          const isActive = activeSlugs.includes(tag.slug)
          return (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.slug)}
              className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition
                ${isActive
                  ? 'bg-club-900 text-white border-club-900'
                  : 'bg-white text-gray-600 border-gray-200'}`}
            >
              <Hash size={10} />
              {tag.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
