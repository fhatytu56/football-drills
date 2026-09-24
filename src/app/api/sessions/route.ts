import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getGroup } from '@/lib/groups';
import { requireCoach } from '@/lib/coach';

export async function GET(request: Request) {
  try {
    const group = getGroup(new URL(request.url).searchParams.get('group'));
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('session_drills')
      .select('*, drills(*)')
      .eq('age_group', group.id)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { drill_id, training_day } = body;

    const group = getGroup(body.age_group);
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    if (!group.days.includes(training_day)) {
      return NextResponse.json(
        { error: `${group.label} don't train on ${training_day}.` },
        { status: 400 }
      );
    }

    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    // Already in this day's plan? Don't add it twice.
    const { data: existing } = await supabase
      .from('session_drills')
      .select('id')
      .eq('drill_id', drill_id)
      .eq('training_day', training_day)
      .eq('age_group', group.id)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ data: existing }, { status: 200 });
    }

    const { data, error } = await supabase
      .from('session_drills')
      .insert([{ drill_id, training_day, age_group: group.id }])
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: row } = await supabase.from('session_drills').select('age_group').eq('id', id).single();
    const group = getGroup(row?.age_group);
    if (!group) return NextResponse.json({ error: 'Session item not found' }, { status: 404 });

    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('session_drills').delete().eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
