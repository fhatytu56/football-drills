import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cleanName, getGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

function friendly(message: string) {
  return message.includes('teams_age_group_name_key') ? 'There is already a team with that name.' : message;
}

async function groupOfTeam(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from('teams').select('age_group').eq('id', id).single();
  return getGroup(data?.age_group);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const group = getGroup(body.age_group);
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: 'Team name must be 1–30 characters.' }, { status: 400 });

    const supabase = await createClient();
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { data, error } = await supabase.from('teams').insert([{ age_group: group.id, name }]).select().single();
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const name = cleanName(body.name);
    if (!body.id || !name) return NextResponse.json({ error: 'Team name must be 1–30 characters.' }, { status: 400 });

    const supabase = await createClient();
    const group = await groupOfTeam(supabase, body.id);
    if (!group) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('teams').update({ name }).eq('id', body.id);
    if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

// Deleting a team keeps its players; they move to "No team yet".
export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const supabase = await createClient();
    const group = await groupOfTeam(supabase, id);
    if (!group) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
