import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroup, type AgeGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';
import { cleanDate, cleanText, cleanTime } from '@/lib/validate';

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MATCH_COLUMNS =
  'id, team_id, match_date, meet_time, kickoff, opponent, kickoff_2, opponent_2, home_away, location, kit, notes, share_token';

/** Validate a match form. Returns the row to save, or an error message. */
function parseMatch(group: AgeGroup, body: any): { row: Record<string, unknown> } | { error: string } {
  const match_date = cleanDate(body.match_date);
  if (!match_date) return { error: 'Pick a match date.' };
  const kickoff = cleanTime(body.kickoff);
  if (!kickoff) return { error: 'Add a kick-off time.' };
  const meet_time = cleanTime(body.meet_time);
  if (meet_time === undefined) return { error: 'Meet time is not a valid time.' };
  const opponent = cleanText(body.opponent, 60, { required: true });
  if (!opponent) return { error: 'Add the opponent (up to 60 characters).' };

  let kickoff_2: string | null = null;
  let opponent_2: string | null = null;
  if (group.aSide === 5) {
    const k2 = cleanTime(body.kickoff_2);
    const o2 = cleanText(body.opponent_2, 60);
    if (k2 === undefined || o2 === undefined) return { error: 'Game 2 details are not valid.' };
    if (!!k2 !== !!o2) return { error: 'For Game 2, add both the kick-off time and the opponent (or leave both empty).' };
    kickoff_2 = k2;
    opponent_2 = o2;
  }

  const home_away = body.home_away === 'away' ? 'away' : 'home';
  const location = cleanText(body.location, 120);
  const kit = cleanText(body.kit, 80);
  const notes = cleanText(body.notes, 300);
  if (location === undefined) return { error: 'Location is too long (120 characters max).' };
  if (kit === undefined) return { error: 'Kit is too long (80 characters max).' };
  if (notes === undefined) return { error: 'Notes are too long (300 characters max).' };

  return {
    row: { match_date, kickoff, meet_time, opponent, kickoff_2, opponent_2, home_away, location, kit, notes },
  };
}

async function teamInGroup(supabase: Supabase, group: AgeGroup, teamId: unknown) {
  if (typeof teamId !== 'string') return false;
  const { data } = await supabase.from('teams').select('age_group').eq('id', teamId).single();
  return data?.age_group === group.id;
}

async function groupOfMatch(supabase: Supabase, id: string) {
  const { data } = await supabase.from('matches').select('age_group').eq('id', id).single();
  return getGroup(data?.age_group);
}

// Matches for an age group plus every answer given so far.
export async function GET(request: Request) {
  try {
    const group = getGroup(new URL(request.url).searchParams.get('group'));
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    const supabase = await createClient();
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { data: matches, error } = await supabase
      .from('matches')
      .select(MATCH_COLUMNS)
      .eq('age_group', group.id)
      .order('match_date', { ascending: true })
      .order('kickoff', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (matches || []).map((m: { id: string }) => m.id);
    let answers: unknown[] = [];
    if (ids.length) {
      const res = await supabase.from('availability').select('match_id, player_id, answer').in('match_id', ids);
      if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
      answers = res.data || [];
    }
    return NextResponse.json({ matches, answers });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const group = getGroup(body.age_group);
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    const supabase = await createClient();
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    if (!(await teamInGroup(supabase, group, body.team_id))) {
      return NextResponse.json({ error: 'Pick a team.' }, { status: 400 });
    }
    const parsed = parseMatch(group, body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await supabase
      .from('matches')
      .insert([{ ...parsed.row, age_group: group.id, team_id: body.team_id }])
      .select(MATCH_COLUMNS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    const supabase = await createClient();
    const group = await groupOfMatch(supabase, body.id);
    if (!group) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    if (!(await teamInGroup(supabase, group, body.team_id))) {
      return NextResponse.json({ error: 'Pick a team.' }, { status: 400 });
    }
    const parsed = parseMatch(group, body);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { error } = await supabase
      .from('matches')
      .update({ ...parsed.row, team_id: body.team_id })
      .eq('id', body.id);
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
    const group = await groupOfMatch(supabase, id);
    if (!group) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('matches').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
