'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export default function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number
  totalPages: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (totalPages <= 1) return null

  function goTo(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center justify-center gap-4 py-6">
      <button
        onClick={() => goTo(currentPage - 1)}
        disabled={currentPage <= 1}
        className="p-2 rounded-xl border disabled:opacity-30"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs text-gray-500">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => goTo(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="p-2 rounded-xl border disabled:opacity-30"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
