export type TrainingDay = 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'sunday';
export type GroupId = 'academy' | 'u8' | 'u9' | 'u10' | 'u11';

export interface AgeGroup {
  id: GroupId;
  label: string;
  /** One or two training days a week. */
  days: TrainingDay[];
  /** Example team name for hints, e.g. "10.1". */
  teamExample: string;
  /** Players on the pitch per team, keeper included. */
  aSide: 5 | 7;
  /** U10s/U11s: each player gets a main and a second position (GK, LB, RB, LM, CM, RM, ST). */
  usesPositions: boolean;
}

export const AGE_GROUPS: AgeGroup[] = [
  { id: 'academy', label: 'Academy', days: ['sunday'], teamExample: 'Academy 1', aSide: 5, usesPositions: false },
  { id: 'u8', label: 'U8s', days: ['wednesday', 'friday'], teamExample: '8.1', aSide: 5, usesPositions: false },
  { id: 'u9', label: 'U9s', days: ['tuesday', 'friday'], teamExample: '9.1', aSide: 5, usesPositions: false },
  { id: 'u10', label: 'U10s', days: ['tuesday', 'thursday'], teamExample: '10.1', aSide: 7, usesPositions: true },
  { id: 'u11', label: 'U11s', days: ['tuesday', 'thursday'], teamExample: '11.1', aSide: 7, usesPositions: true },
];

export type Position = 'gk' | 'lb' | 'rb' | 'lm' | 'cm' | 'rm' | 'st';

/** The 7 spots of the 7-a-side shape (GK, 2 at the back, 3 in midfield, 1 up top). */
export const POSITIONS: { id: Position; short: string; label: string }[] = [
  { id: 'gk', short: 'GK', label: 'Goalkeeper' },
  { id: 'lb', short: 'LB', label: 'Left back' },
  { id: 'rb', short: 'RB', label: 'Right back' },
  { id: 'lm', short: 'LM', label: 'Left midfield' },
  { id: 'cm', short: 'CM', label: 'Centre midfield' },
  { id: 'rm', short: 'RM', label: 'Right midfield' },
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
  sunday: { long: 'Sunday', short: 'Sun' },
};

/** "Wed & Fri", or "Sunday" when there's only one day. */
export function daysShort(group: AgeGroup) {
  if (group.days.length === 1) return DAY_LABEL[group.days[0]].long;
  return group.days.map((d) => DAY_LABEL[d].short).join(' & ');
}

/** Next team name hint: "10.1" -> "10.3" for the 3rd team; "Academy 1" -> "Academy 2". */
export function teamHint(group: AgeGroup, n: number) {
  return group.teamExample.replace(/\d+$/, String(n));
}

export function getGroup(id: string | null | undefined): AgeGroup | undefined {
  return AGE_GROUPS.find((g) => g.id === (id || '').toLowerCase());
}
