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
      .from('drills')
      .select('*')
      .eq('age_category', group.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error GET drills:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { title, url, game_phase } = body;

    const group = getGroup(body.age_group);
    if (!group) return NextResponse.json({ error: 'Unknown age group' }, { status: 400 });
    if (!title || !url) {
      return NextResponse.json({ error: 'Title and URL are required' }, { status: 400 });
    }

    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const rawPhase = (game_phase || 'attacking').toString().toLowerCase();

    const { data, error } = await supabase
      .from('drills')
      .insert([
        {
          user_id: coach.userId,
          title,
          url,
          age_category: group.id,
          game_phase: rawPhase,
        },
      ])
      .select();

    if (error) {
      console.error('Supabase POST error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err: any) {
    console.error('API Error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

    const supabase = await createClient();
    const { data: drill } = await supabase.from('drills').select('age_category').eq('id', id).single();
    const group = getGroup(drill?.age_category);
    if (!group) return NextResponse.json({ error: 'Drill not found' }, { status: 404 });

    const coach = await requireCoach(supabase, group.id);
    if (coach instanceof NextResponse) return coach;

    const { error } = await supabase.from('drills').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
