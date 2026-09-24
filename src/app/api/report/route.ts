import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { drillId, reason } = await req.json()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  if (!drillId || !reason) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { error } = await supabase.from('drill_reports').insert({
    drill_id: drillId,
    reported_by: user.id,
    reason,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
