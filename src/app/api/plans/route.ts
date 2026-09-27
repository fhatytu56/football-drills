import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function matchInfo(supabase: Supabase, matchId: unknown) {
  if (typeof matchId !== 'string') return null;
  const { data } = await supabase.from('matches').select('age_group, team_id').eq('id', matchId).single();
  const group = getGroup(data?.age_group);
  return group && data ? { group, teamId: data.team_id as string } : null;
}

// The saved sub plan for a match (or null if nobody has made one yet).
export async function GET(request: Request) {
  try {
    const matchId = new URL(request.url).searchParams.get('match_id');
    const supabase = await createClient();
    const info = await matchInfo(supabase, matchId);
    if (!info) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const coach = await requireCoach(supabase, info.group.id);
    if (coach instanceof NextResponse) return coach;

    const { data, error } = await supabase
      .from('match_plans')
      .select('here, lineup, bench, sub_gap, subs, updated_at')
      .eq('match_id', matchId!)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ plan: data || null });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// Save (create or replace) the plan. Every player in it must be in the match's team.
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const supabase = await createClient();
    const info = await matchInfo(supabase, body.match_id);
    if (!info) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
    const coach = await requireCoach(supabase, info.group.id);
    if (coach instanceof NextResponse) return coach;

    const { data: squad } = await supabase.from('players').select('id').eq('team_id', info.teamId);
    const inTeam = new Set((squad || []).map((p: { id: string }) => p.id));
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const here = ids(body.here);
    const bench = ids(body.bench);
    const lineup: Record<string, string | null> = {};
    for (const [spot, id] of Object.entries(body.lineup || {})) {
      if (!['gk', 'lb', 'rb', 'lm', 'cm', 'rm', 'st'].includes(spot)) continue;
      lineup[spot] = typeof id === 'string' ? id : null;
    }
    const subs = Array.isArray(body.subs)
      ? body.subs
          .filter((x: any) => x && typeof x.on === 'string' && typeof x.off === 'string' && x.on !== x.off)
          .map((x: any) => ({ on: x.on, off: x.off }))
      : [];
    const everyone = [...here, ...bench, ...(Object.values(lineup).filter(Boolean) as string[]), ...subs.flatMap((x: any) => [x.on, x.off])];
    if (everyone.some((id) => !inTeam.has(id))) {
      return NextResponse.json({ error: 'The plan has a player who is not in this team.' }, { status: 400 });
    }
    const gap = Number(body.sub_gap);
    if (!Number.isInteger(gap) || gap < 1 || gap > 25) {
      return NextResponse.json({ error: 'Sub gap must be 1–25 minutes.' }, { status: 400 });
    }
    if (subs.length > 60) return NextResponse.json({ error: 'Too many subs in the plan.' }, { status: 400 });

    const { error } = await supabase.from('match_plans').upsert(
      {
        match_id: body.match_id,
        age_group: info.group.id,
        here,
        lineup,
        bench,
        sub_gap: gap,
        subs,
        updated_at: new Date().toISOString(),
        updated_by: coach.userId,
      },
      { onConflict: 'match_id' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
