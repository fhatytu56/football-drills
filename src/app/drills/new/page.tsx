import DrillForm from '@/components/DrillForm'

export default function NewDrillPage() {
  return (
    <main className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3">
        <h1 className="text-lg font-bold text-gray-900">Add Drill</h1>
      </header>
      <div className="p-4">
        <DrillForm mode="create" />
      </div>
    </main>
  )
}
