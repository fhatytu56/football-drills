'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Search } from 'lucide-react'

export default function SearchBar({ defaultValue }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? '')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set('q', value)
    else params.delete('q')
    params.delete('page') // reset pagination on new search
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-2 bg-white border-b">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search drills..."
          className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm bg-gray-50"
        />
      </div>
    </form>
  )
}
