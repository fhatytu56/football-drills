import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import PasswordForm from '@/components/PasswordForm';
import { createClient } from '@/lib/supabase/server';
import { getGroup } from '@/lib/groups';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: { searchParams: { next?: string } }) {
  const group = getGroup(String(searchParams.next || '').replace(/^\//, ''));
  const backHref = group ? `/${group.id}` : '/';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(backHref)}`);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-md max-w-sm w-full">
        <Link href={backHref} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-4">
          <ChevronLeft className="w-4 h-4" /> {group ? `Back to ${group.label}` : 'Age groups'}
        </Link>
        <div className="flex items-center gap-3 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crest.jpg" alt="Wayside Celtic F.C. crest" className="w-12 h-12 rounded-full" />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Change password</h1>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Swap the password the club gave you for your own. If you forget it, ask the club to reset it.
        </p>
        <Suspense fallback={<div className="p-4 text-center text-xs text-slate-500">Loading…</div>}>
          <PasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
