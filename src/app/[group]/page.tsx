import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import GroupBoard from '@/components/GroupBoard';
import { getGroup } from '@/lib/groups';
import { createClient } from '@/lib/supabase/server';
import { getCoachAccess } from '@/lib/coach';

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { group: string } }): Metadata {
  const group = getGroup(params.group);
  if (!group) return {};
  return {
    title: `Wayside Celtic ${group.label} — Drill Archive`,
    description: `Training drill archive for Wayside Celtic ${group.label}`,
  };
}

export default async function GroupPage({ params }: { params: { group: string } }) {
  const group = getGroup(params.group);
  if (!group) notFound();

  const supabase = await createClient();
  const { user, groups } = await getCoachAccess(supabase);

  return <GroupBoard group={group} canEdit={groups.includes(group.id)} signedIn={!!user} />;
}
