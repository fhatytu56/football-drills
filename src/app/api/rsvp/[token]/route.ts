import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Public: parents answer Yes/No with the match's secret link. No login.
// The database functions check the token and that match day hasn't passed.

const GONE = 'This link has expired or is not valid. Ask your coach for a new one.';

function validToken(token: string) {
  return /^[0-9a-f]{32}$/.test(token);
}

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!validToken(params.token)) return NextResponse.json({ error: GONE }, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('rsvp_match', { p_token: params.token });
  if (error) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: GONE }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: { token: string } }) {
  if (!validToken(params.token)) return NextResponse.json({ error: GONE }, { status: 404 });
  const { player_id, answer } = await request.json().catch(() => ({}));
  if (typeof player_id !== 'string' || (answer !== 'yes' && answer !== 'no')) {
    return NextResponse.json({ error: 'Pick Yes or No.' }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('rsvp_answer', { p_token: params.token, p_player: player_id, p_answer: answer });
  if (error) return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: GONE }, { status: 404 });
  return NextResponse.json({ success: true });
}
