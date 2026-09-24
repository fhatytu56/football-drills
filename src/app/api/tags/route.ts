import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/tags?q=fir  -> autocomplete suggestions
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''

  const supabase = await createClient()
  let query = supabase.from('tags').select('id, name, slug').order('name').limit(10)

  if (q) query = query.ilike('name', `%${q}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
