import type { SupabaseClient } from '@supabase/supabase-js'

export function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export async function resolveOrCreateTags(
  supabase: SupabaseClient,
  names: string[],
  userId: string | null
): Promise<string[]> {
  if (names.length === 0) return []
  const slugs = names.map(slugify)

  const { data: existing } = await supabase.from('tags').select('id, slug').in('slug', slugs)
  const existingSlugs = new Set(existing?.map((t) => t.slug) ?? [])
  const ids = existing?.map((t) => t.id) ?? []

  const missing = names.filter((n) => !existingSlugs.has(slugify(n)))
  if (missing.length > 0) {
    const { data: created, error } = await supabase
      .from('tags')
      .insert(missing.map((name) => ({ name, slug: slugify(name), created_by: userId })))
      .select('id')
    if (error) throw new Error(error.message)
    ids.push(...(created?.map((t) => t.id) ?? []))
  }

  return ids
}

export async function replaceDrillTags(
  supabase: SupabaseClient,
  drillId: string,
  tagNames: string[],
  userId: string | null
) {
  await supabase.from('drill_tags').delete().eq('drill_id', drillId)
  const uniqueNames = [...new Set(tagNames.filter(Boolean))]
  if (uniqueNames.length === 0) return

  const tagIds = await resolveOrCreateTags(supabase, uniqueNames, userId)
  const { error } = await supabase
    .from('drill_tags')
    .insert(tagIds.map((tag_id) => ({ drill_id: drillId, tag_id })))
  if (error) throw new Error(error.message)
}
