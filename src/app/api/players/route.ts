import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cleanName, cleanPositions, getGroup, type AgeGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function groupOfPlayer(supabase: Supabase, id: string) {
  const { data } = await supabase.from('players').select('age_group').eq('id', id).single();
  return getGroup(data?.age_group);
}

/** team_id must be null or a team in the same age group. */
async function checkTeam(supabase: Supabase, group: AgeGroup, teamId: unknown) {
  if (teamId === null || teamId === undefined || teamId === '') return { ok: true as const, teamId: null };
  if (typeof teamId !== 'string') return { ok: false as const };
  const { data } = await supabase.from('teams').select('age_group').eq('id', teamId).single();
  return data?.age_group === group.id ? { ok: true as const, teamId } : { ok: false as const };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const group = getGroup(body.age_group);
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    const first_name = cleanName(body.first_name);
    if (!first_name) return NextResponse.json({ error: 'First name must be 1–30 characters.' }, { status: 400 });

    const supabase = await createClient();
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const team = await checkTeam(supabase, group, body.team_id);
    if (!team.ok) return NextResponse.json({ error: 'Team not found in this age group' }, { status: 400 });

    const { data, error } = await supabase
      .from('players')
      .insert([{ age_group: group.id, team_id: team.teamId, first_name, positions: cleanPositions(group, body.positions) }])
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// Change name, team and/or positions. Only fields sent are changed.
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const supabase = await createClient();
    const group = await groupOfPlayer(supabase, body.id);
    if (!group) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const update: Record<string, unknown> = {};
    if ('first_name' in body) {
      const first_name = cleanName(body.first_name);
      if (!first_name) return NextResponse.json({ error: 'First name must be 1–30 characters.' }, { status: 400 });
      update.first_name = first_name;
    }
    if ('team_id' in body) {
      const team = await checkTeam(supabase, group, body.team_id);
      if (!team.ok) return NextResponse.json({ error: 'Team not found in this age group' }, { status: 400 });
      update.team_id = team.teamId;
    }
    if ('positions' in body) update.positions = cleanPositions(group, body.positions);

    const { error } = await supabase.from('players').update(update).eq('id', body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const supabase = await createClient();
    const group = await groupOfPlayer(supabase, id);
    if (!group) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('players').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
