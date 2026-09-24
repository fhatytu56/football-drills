export type TrainingDay = 'tuesday' | 'wednesday' | 'thursday' | 'friday';
export type GroupId = 'u8' | 'u9' | 'u10' | 'u11';

export interface AgeGroup {
  id: GroupId;
  label: string;
  days: [TrainingDay, TrainingDay];
}

export const AGE_GROUPS: AgeGroup[] = [
  { id: 'u8', label: 'U8s', days: ['wednesday', 'friday'] },
  { id: 'u9', label: 'U9s', days: ['tuesday', 'friday'] },
  { id: 'u10', label: 'U10s', days: ['tuesday', 'thursday'] },
  { id: 'u11', label: 'U11s', days: ['tuesday', 'thursday'] },
];

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
