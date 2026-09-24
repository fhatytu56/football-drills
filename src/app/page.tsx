import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AGE_GROUPS, DAY_LABEL } from '@/lib/groups';

export default function PickGroupPage() {
  return (
    <main className="min-h-screen bg-emerald-800 flex flex-col">
      <div className="flex-1 w-full max-w-md mx-auto px-4 pt-10 pb-8 flex flex-col">
        <div className="text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/crest.jpg"
            alt="Wayside Celtic F.C. crest"
            className="w-32 h-32 mx-auto rounded-full bg-white p-1.5 shadow-lg"
          />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">Wayside Celtic</h1>
          <p className="text-sm text-emerald-200 font-medium">Football Drills</p>
        </div>

        <h2 className="mt-8 mb-3 text-xs font-bold uppercase tracking-wider text-emerald-200 text-center">
          Choose your age group
        </h2>

        <nav className="grid grid-cols-2 gap-3">
          {AGE_GROUPS.map((g) => (
            <Link
              key={g.id}
              href={`/${g.id}`}
              className="group bg-white rounded-2xl p-4 shadow-md hover:shadow-lg hover:bg-emerald-50 transition flex flex-col"
            >
              <span className="flex items-center justify-between">
                <span className="text-2xl font-black text-emerald-900 tracking-tight">{g.label}</span>
                <ChevronRight className="w-5 h-5 text-emerald-700 group-hover:translate-x-0.5 transition" />
              </span>
              <span className="mt-1 text-xs font-semibold text-slate-500">
                {DAY_LABEL[g.days[0]].short} &amp; {DAY_LABEL[g.days[1]].short}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
