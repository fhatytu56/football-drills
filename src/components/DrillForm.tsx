'use client'

import { useState, useTransition } from 'react'
import { createDrill } from '@/app/drills/new/actions'
import { updateDrill } from '@/app/drills/[id]/actions'
import { AGE_CATEGORIES, GAME_PHASES } from '@/lib/constants'
import { Loader2, Link as LinkIcon } from 'lucide-react'
import TagInput from './TagInput'
import type { Drill } from '@/types/database.types'

interface Props {
  mode?: 'create' | 'edit'
  drillId?: string
  initialDrill?: Drill
  initialTags?: string[]
}

export default function DrillForm({ mode = 'create', drillId, initialDrill, initialTags }: Props) {
  const [url, setUrl] = useState(initialDrill?.url ?? '')
  const [title, setTitle] = useState(initialDrill?.title ?? '')
  const [thumbnail, setThumbnail] = useState(initialDrill?.thumbnail_url ?? '')
  const [platform, setPlatform] = useState(initialDrill?.platform ?? 'other')
  const [fetching, setFetching] = useState(false)
  const [isPending, startTransition] = useTransition()

  async function handleUrlBlur() {
    if (!url || mode === 'edit') return // don't re-fetch metadata on edit unless URL actually changed
    setFetching(true)
    try {
      const res = await fetch('/api/resolve-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      setPlatform(data.platform)
      if (data.title) setTitle(data.title)
      if (data.thumbnail_url) setThumbnail(data.thumbnail_url)
    } finally {
      setFetching(false)
    }
  }

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      if (mode === 'edit' && drillId) {
        updateDrill(drillId, formData)
      } else {
        createDrill(formData)
      }
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-gray-600">Video/Resource URL</label>
        <div className="relative mt-1">
          <LinkIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            name="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://youtube.com/..."
            className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm"
          />
          {fetching && (
            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
          )}
        </div>
      </div>

      <input type="hidden" name="platform" value={platform} />
      <input type="hidden" name="thumbnail_url" value={thumbnail ?? ''} />

      <div>
        <label className="text-xs font-medium text-gray-600">Title</label>
        <input
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Age Group</label>
          <select
            name="age_category"
            required
            defaultValue={initialDrill?.age_category}
            className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
          >
            {AGE_CATEGORIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Game Phase</label>
          <select
            name="game_phase"
            required
            defaultValue={initialDrill?.game_phase}
            className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
          >
            {GAME_PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Min Players</label>
          <input
            name="player_count_min"
            type="number"
            min={1}
            defaultValue={initialDrill?.player_count_min ?? 1}
            required
            className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Max Players</label>
          <input
            name="player_count_max"
            type="number"
            min={1}
            defaultValue={initialDrill?.player_count_max ?? 1}
            required
            className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
          />
        </div>
      </div>

      <TagInput initialTags={initialTags} />

      <div>
        <label className="text-xs font-medium text-gray-600">Equipment (comma-separated)</label>
        <input
          name="equipment_needed"
          defaultValue={initialDrill?.equipment_needed?.join(', ')}
          placeholder="cones, bibs, ladders"
          className="w-full mt-1 px-3 py-2.5 border rounded-xl text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full bg-club-700 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
      >
        {isPending ? 'Saving...' : mode === 'edit' ? 'Update Drill' : 'Save Drill'}
      </button>
    </form>
  )
}
