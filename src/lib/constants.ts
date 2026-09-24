import type { AgeCategory, GamePhase } from '@/types/database.types'

export const AGE_CATEGORIES: AgeCategory[] = [
  'u6','u7','u8','u9','u10','u11','u12','u13','u14','u15','u16','u17','u18'
]

export const GAME_PHASES: { value: GamePhase; label: string }[] = [
  { value: 'attacking', label: 'Attacking' },
  { value: 'defending', label: 'Defending' },
  { value: 'transition_attack', label: 'Transition (Att)' },
  { value: 'transition_defense', label: 'Transition (Def)' },
  { value: 'possession', label: 'Possession' },
  { value: 'set_pieces', label: 'Set Pieces' },
  { value: 'goalkeeping', label: 'Goalkeeping' },
  { value: 'warmup', label: 'Warm-Up' },
  { value: 'conditioning', label: 'Conditioning' },
]
