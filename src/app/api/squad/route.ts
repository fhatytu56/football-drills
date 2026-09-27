import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

// Teams + players for one age group. Coaches of that group only.
export async function GET(request: Request) {
  try {
    const group = getGroup(new URL(request.url).searchParams.get('group'));
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });

    const supabase = await createClient();
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const [teams, players] = await Promise.all([
      supabase.from('teams').select('id, name, created_at').eq('age_group', group.id).order('created_at'),
      supabase
        .from('players')
        .select('id, team_id, first_name, positions, created_at')
        .eq('age_group', group.id)
        .order('first_name'),
    ]);
    const error = teams.error || players.error;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ teams: teams.data, players: players.data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
