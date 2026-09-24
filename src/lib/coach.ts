import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { GroupId } from '@/lib/groups';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Groups the signed-in user can edit. Empty when signed out or not a coach. */
export async function getCoachAccess(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, groups: [] as string[] };
  const { data } = await supabase.from('coach_groups').select('age_group').eq('user_id', user.id);
  return { user, groups: (data || []).map((r: { age_group: string }) => r.age_group) };
}

/**
 * Friendly check before a write. RLS in the database is the real guard;
 * this just returns a clear message instead of a raw policy error.
 */
export async function requireCoach(
  supabase: Supabase,
  group: GroupId
): Promise<{ userId: string } | NextResponse> {
  const { user, groups } = await getCoachAccess(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in as a coach first.' }, { status: 401 });
  }
  if (!groups.includes(group)) {
    return NextResponse.json(
      { error: `Your account isn't set up to edit ${group.toUpperCase()}.` },
      { status: 403 }
    );
  }
  return { userId: user.id };
}
