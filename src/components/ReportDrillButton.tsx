'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'

const REASONS = ['Inappropriate content', 'Broken link', 'Wrong age group', 'Spam', 'Other']

export default function ReportDrillButton({ drillId }: { drillId: string }) {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function submit(reason: string) {
    await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drillId, reason }),
    })
    setSubmitted(true)
  }

  if (submitted) {
    return <p className="text-xs text-gray-400">Reported — thank you.</p>
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-xs text-gray-400">
        <Flag size={12} /> Report
      </button>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {REASONS.map((r) => (
        <button
          key={r}
          onClick={() => submit(r)}
          className="px-2 py-1 border rounded-full text-[11px] text-gray-600"
        >
          {r}
        </button>
      ))}
    </div>
  )
}
