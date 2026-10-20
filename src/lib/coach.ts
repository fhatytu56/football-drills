import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroup, type GroupId } from '@/lib/groups';

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Groups the signed-in user can edit, and the ones where they coordinate (see every team).
 * A team coach is in `groups` but not `leads`: the database only shows them their own team(s).
 * Empty when signed out or not a coach.
 */
export async function getCoachAccess(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, groups: [] as string[], leads: [] as string[] };
  type Row = { age_group: string; all_teams: boolean };
  const res = await supabase.from('coach_groups').select('age_group, all_teams').eq('user_id', user.id);
  let error = res.error;
  let rows = (res.data || []) as Row[];
  if (error && error.message.includes('all_teams')) {
    // 009 not run yet: no team lock in the database, so every coach still sees their whole group.
    const old = await supabase.from('coach_groups').select('age_group').eq('user_id', user.id);
    error = old.error;
    rows = ((old.data || []) as { age_group: string }[]).map((r) => ({ age_group: r.age_group, all_teams: true }));
  }
  // Shows up in Vercel → Logs if the database refuses the lookup (e.g. missing table permissions).
  if (error) console.error('coach_groups lookup failed:', error.message);
  return {
    user,
    groups: rows.map((r) => r.age_group),
    leads: rows.filter((r) => r.all_teams).map((r) => r.age_group),
  };
}

/**
 * Friendly check before a write. RLS in the database is the real guard;
 * this just returns a clear message instead of a raw policy error.
 * `lead: true` = only the age group's coordinators (e.g. adding or deleting teams).
 */
export async function requireCoach(
  supabase: Supabase,
  group: GroupId,
  opts: { lead?: boolean } = {}
): Promise<{ userId: string; lead: boolean } | NextResponse> {
  const { user, groups, leads } = await getCoachAccess(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in as a coach first.' }, { status: 401 });
  }
  if (!groups.includes(group)) {
    return NextResponse.json(
      { error: `Your account isn't set up to edit ${getGroup(group)?.label || group.toUpperCase()}.` },
      { status: 403 }
    );
  }
  const lead = leads.includes(group);
  if (opts.lead && !lead) {
    const label = getGroup(group)?.label || group.toUpperCase();
    return NextResponse.json(
      { error: `Only the ${label} coordinators can add, rename or delete teams.` },
      { status: 403 }
    );
  }
  return { userId: user.id, lead };
}

/** Turns the database's "row-level security" refusal into words a coach understands. */
export function friendlyLockError(message: string, fallback: string) {
  return message.includes('row-level security') ? fallback : message;
}
