import type { Drill } from '@/types/database.types'
import DrillCard from './DrillCard'

export default function DrillGrid({ drills }: { drills: Drill[] }) {
  if (drills.length === 0) {
    return (
      <p className="text-center text-gray-400 text-sm py-12">
        No drills match these filters yet.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {drills.map((drill) => (
        <DrillCard key={drill.id} drill={drill} />
      ))}
    </div>
  )
}
