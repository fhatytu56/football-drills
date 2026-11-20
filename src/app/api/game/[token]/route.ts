import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Public: the U10 manager game, opened with a team's secret game link. No login.
// The database function checks the token and only answers for U10 teams.

const GONE = 'This game link is not valid. Ask your coach for the link again.';

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f]{32}$/.test(params.token)) return NextResponse.json({ error: GONE }, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('game_team', { p_token: params.token });
  if (error) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: GONE }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
