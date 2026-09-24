'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { replaceDrillTags } from '@/lib/tags'
import type { AgeCategory, GamePhase, PlatformType } from '@/types/database.types'

export async function createDrill(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) throw new Error('You must be signed in to post a drill.')
  if (!user.email_confirmed_at) {
    throw new Error('Please verify your email before posting drills.')
  }

  const equipmentRaw = formData.get('equipment_needed') as string
  const equipment_needed = equipmentRaw
    ? equipmentRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const payload = {
    user_id: user.id,
    title: formData.get('title') as string,
    url: formData.get('url') as string,
    platform: formData.get('platform') as PlatformType,
    thumbnail_url: (formData.get('thumbnail_url') as string) || null,
    age_category: formData.get('age_category') as AgeCategory,
    game_phase: formData.get('game_phase') as GamePhase,
    player_count_min: Number(formData.get('player_count_min')),
    player_count_max: Number(formData.get('player_count_max')),
    equipment_needed,
  }

  const { data: drill, error } = await supabase
    .from('drills')
    .insert(payload)
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  const tagsRaw = formData.get('tags') as string
  const tagNames = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()) : []
  await replaceDrillTags(supabase, drill.id, tagNames, user.id)

  redirect('/')
}
