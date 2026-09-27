export type TrainingDay = 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export type GroupId = 'u8' | 'u9' | 'u10' | 'u11';

export interface AgeGroup {
  id: GroupId;
  label: string;
  days: [TrainingDay, TrainingDay];
  /** Players on the pitch per team, keeper included. */
  aSide: 5 | 7;
  /** U10s/U11s: each player gets up to 2 outfield positions. */
  usesPositions: boolean;
}

export const AGE_GROUPS: AgeGroup[] = [
  { id: 'u8', label: 'U8s', days: ['wednesday', 'friday'], aSide: 5, usesPositions: false },
  { id: 'u9', label: 'U9s', days: ['tuesday', 'friday'], aSide: 5, usesPositions: false },
  { id: 'u10', label: 'U10s', days: ['tuesday', 'thursday'], aSide: 7, usesPositions: true },
  { id: 'u11', label: 'U11s', days: ['tuesday', 'thursday'], aSide: 7, usesPositions: true },
];

export type Position = 'def' | 'mid' | 'st';

export const POSITIONS: { id: Position; short: string; label: string }[] = [
  { id: 'def', short: 'DEF', label: 'Defender' },
  { id: 'mid', short: 'MID', label: 'Midfielder' },
  { id: 'st', short: 'ST', label: 'Striker' },
];

/** Keep only valid, distinct positions, max 2, and none for groups that don't use them. */
export function cleanPositions(group: AgeGroup, raw: unknown): Position[] {
  if (!group.usesPositions || !Array.isArray(raw)) return [];
  const valid = POSITIONS.map((p) => p.id) as string[];
  const out: Position[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && valid.includes(v) && !out.includes(v as Position)) out.push(v as Position);
  }
  return out.slice(0, 2);
}

/** Trim a user-typed name; returns null if empty or too long. */
export function cleanName(raw: unknown, max = 30): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().replace(/\s+/g, ' ');
  return v.length >= 1 && v.length <= max ? v : null;
}

export const SESSION_BUDGET_MINS = 60;

export const DAY_LABEL: Record<TrainingDay, { long: string; short: string }> = {
  tuesday: { long: 'Tuesday', short: 'Tue' },
  wednesday: { long: 'Wednesday', short: 'Wed' },
  thursday: { long: 'Thursday', short: 'Thu' },
  friday: { long: 'Friday', short: 'Fri' },
};

export function getGroup(id: string | null | undefined): AgeGroup | undefined {
  return AGE_GROUPS.find((g) => g.id === (id || '').toLowerCase());
}
