export type AgeCategory =
  | 'u6' | 'u7' | 'u8' | 'u9' | 'u10' | 'u11'
  | 'u12' | 'u13' | 'u14' | 'u15' | 'u16' | 'u17' | 'u18'

export type GamePhase =
  | 'attacking' | 'defending' | 'transition_attack' | 'transition_defense'
  | 'possession' | 'set_pieces' | 'goalkeeping' | 'warmup' | 'conditioning'

export type PlatformType = 'youtube' | 'vimeo' | 'instagram' | 'tiktok' | 'other'

export interface Drill {
  id: string
  user_id: string | null
  title: string
  url: string
  platform: PlatformType
  thumbnail_url: string | null
  age_category: AgeCategory
  game_phase: GamePhase
  player_count_min: number
  player_count_max: number
  equipment_needed: string[] | null
  is_flagged?: boolean
  created_at: string
  updated_at: string
}

export interface Tag {
  id: string
  name: string
  slug: string
  created_by: string | null
  created_at: string
}
