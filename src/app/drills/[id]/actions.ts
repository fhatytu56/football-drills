'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { replaceDrillTags } from '@/lib/tags'

export async function deleteDrill(drillId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('drills')
    .delete()
    .eq('id', drillId)
    .eq('user_id', user.id)

  if (error) throw new Error(error.message)

  revalidatePath('/')
  redirect('/')
}

export async function updateDrill(drillId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const equipmentRaw = formData.get('equipment_needed') as string
  const equipment_needed = equipmentRaw
    ? equipmentRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : []

  const payload = {
    title: formData.get('title') as string,
    url: formData.get('url') as string,
    age_category: formData.get('age_category') as string,
    game_phase: formData.get('game_phase') as string,
    player_count_min: Number(formData.get('player_count_min')),
    player_count_max: Number(formData.get('player_count_max')),
    equipment_needed,
  }

  const { error } = await supabase
    .from('drills')
    .update(payload)
    .eq('id', drillId)
    .eq('user_id', user.id)

  if (error) throw new Error(error.message)

  const tagsRaw = formData.get('tags') as string
  const tagNames = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()) : []
  await replaceDrillTags(supabase, drillId, tagNames, user.id)

  revalidatePath(`/drills/${drillId}`)
  redirect(`/drills/${drillId}`)
}
