'use client'

import { useState, useTransition } from 'react'
import { deleteDrill } from '@/app/drills/[id]/actions'
import { Trash2, Loader2 } from 'lucide-react'

export default function DeleteDrillButton({ drillId }: { drillId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()

  if (confirming) {
    return (
      <button
        onClick={() => startTransition(() => deleteDrill(drillId))}
        disabled={isPending}
        className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-lg bg-red-600 text-white text-sm font-medium"
      >
        {isPending ? <Loader2 size={16} className="animate-spin" /> : 'Confirm Delete'}
      </button>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border border-red-200 text-red-600 text-sm"
    >
      <Trash2 size={16} />
    </button>
  )
}
