import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

// Coach sets a child's answer: 'yes', 'no', or null (= no reply).
export async function PATCH(request: Request) {
  try {
    const { match_id, player_id, answer } = await request.json();
    if (!match_id || !player_id) return NextResponse.json({ error: 'Missing match or player' }, { status: 400 });
    if (answer !== 'yes' && answer !== 'no' && answer !== null) {
      return NextResponse.json({ error: 'Answer must be yes, no or empty' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: match } = await supabase.from('matches').select('age_group, team_id').eq('id', match_id).single();
    const group = getGroup(match?.age_group);
    if (!group || !match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { data: player } = await supabase.from('players').select('team_id').eq('id', player_id).single();
    if (!player || player.team_id !== match.team_id) {
      return NextResponse.json({ error: 'That player is not in this team' }, { status: 400 });
    }

    const { error } =
      answer === null
        ? await supabase.from('availability').delete().eq('match_id', match_id).eq('player_id', player_id)
        : await supabase
            .from('availability')
            .upsert({ match_id, player_id, answer, updated_at: new Date().toISOString() }, { onConflict: 'match_id,player_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
