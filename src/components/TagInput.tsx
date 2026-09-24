'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Tag as TagIcon } from 'lucide-react'

interface TagSuggestion {
  id: string
  name: string
  slug: string
}

export default function TagInput({ initialTags = [] }: { initialTags?: string[] }) {
  const [selected, setSelected] = useState<string[]>(initialTags)
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!input) {
      setSuggestions([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/tags?q=${encodeURIComponent(input)}`)
      const data = await res.json()
      setSuggestions(data)
    }, 250)
  }, [input])

  function addTag(name: string) {
    const trimmed = name.trim()
    if (!trimmed || selected.includes(trimmed)) return
    setSelected((prev) => [...prev, trimmed])
    setInput('')
    setSuggestions([])
  }

  function removeTag(name: string) {
    setSelected((prev) => prev.filter((t) => t !== name))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && selected.length > 0) {
      removeTag(selected[selected.length - 1])
    }
  }

  return (
    <div>
      <label className="text-xs font-medium text-gray-600">Skill Tags</label>

      {/* Hidden field submitted with the form */}
      <input type="hidden" name="tags" value={selected.join(',')} />

      <div className="mt-1 flex flex-wrap gap-1.5 p-2 border rounded-xl bg-white">
        {selected.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 bg-club-100 text-club-800 text-xs px-2 py-1 rounded-full"
          >
            <TagIcon size={10} />
            {tag}
            <button type="button" onClick={() => removeTag(tag)}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? 'first-touch, rondo...' : ''}
          className="flex-1 min-w-[80px] text-sm outline-none py-1"
        />
      </div>

      {suggestions.length > 0 && (
        <div className="mt-1 border rounded-xl bg-white shadow-sm overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => addTag(s.name)}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
