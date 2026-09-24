import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from('drills').select('*').order('created_at', { ascending: false });

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

    const { title, url, age_category, game_phase } = body;

    if (!title || !url) {
      return NextResponse.json({ error: 'Title and URL are required' }, { status: 400 });
    }

    // Convert uppercase 'U10' to lowercase 'u10' or 'u8_u10' to match Postgres Enum values
    const rawAge = (age_category || 'u10').toString().toLowerCase();
    const cleanAge = rawAge.includes('10') ? 'u10' : rawAge;
    
    const rawPhase = (game_phase || 'attacking').toString().toLowerCase();

    const { data, error } = await supabase.from('drills').insert([
      {
        title,
        url,
        age_category: cleanAge,
        game_phase: rawPhase,
      },
    ]).select();

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
