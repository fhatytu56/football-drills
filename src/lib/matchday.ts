/**
 * Match Day clock + subs. Pure functions, no timers in here.
 *
 * Time is never counted by ticking. The clock stores the wall-clock moment it was
 * started (`runningSince`) plus the time banked before that (`bankedMs`). The current
 * match time is always recomputed from Date.now(), so a locked phone, a background
 * tab or a slow device can't make the clock lose time.
 */
import type { AgeGroup, Position } from '@/lib/groups';

export type Spot = Position; // gk, lb, rb, lm, cm, rm, st

export const SPOTS_7: Spot[] = ['gk', 'lb', 'rb', 'lm', 'cm', 'rm', 'st'];
export const SPOTS_5: Spot[] = ['gk', 'lb', 'rb', 'lm', 'rm'];

export interface Format {
  halfMins: number;
  /** Periods on the day: 2 halves per game. U8s/U9s with a Game 2 = 4. */
  periods: number;
  spots: Spot[];
  keeperRotates: boolean;
}

export function formatFor(group: AgeGroup, twoGames: boolean): Format {
  if (group.aSide === 5) {
    return { halfMins: 12, periods: twoGames ? 4 : 2, spots: SPOTS_5, keeperRotates: true };
  }
  return { halfMins: 25, periods: 2, spots: SPOTS_7, keeperRotates: false };
}

export function periodLabel(periods: number, index: number) {
  const half = index % 2 === 0 ? '1st half' : '2nd half';
  return periods > 2 ? `Game ${Math.floor(index / 2) + 1} · ${half}` : half;
}

export interface Stint {
  playerId: string;
  from: number; // match ms
  to: number | null;
}

export interface MatchDayState {
  version: 1;
  groupId: string;
  matchId: string | null;
  title: string;
  format: Format;
  subGapMins: number;
  players: { id: string; first_name: string; positions: Position[] }[];
  /** spot -> player id (or null if nobody there) */
  onPitch: Partial<Record<Spot, string | null>>;
  bench: string[];
  period: number; // 0-based
  periodStartMs: number; // match ms when this period started
  bankedMs: number; // match ms banked while paused
  runningSince: number | null; // Date.now() when last resumed; null = paused
  phase: 'lineup' | 'playing' | 'break' | 'fulltime';
  lastSubMs: number; // match ms of the last sub (or kick-off)
  snoozeUntilMs: number; // match ms
  stints: Stint[];
}

export function matchMs(s: MatchDayState, now: number) {
  return s.bankedMs + (s.runningSince !== null ? Math.max(0, now - s.runningSince) : 0);
}

export function periodMs(s: MatchDayState, now: number) {
  return Math.min(matchMs(s, now) - s.periodStartMs, s.format.halfMins * 60_000);
}

export function periodOver(s: MatchDayState, now: number) {
  return s.phase === 'playing' && matchMs(s, now) - s.periodStartMs >= s.format.halfMins * 60_000;
}

export function nextSubInMs(s: MatchDayState, now: number) {
  const t = matchMs(s, now);
  return Math.max(s.lastSubMs + s.subGapMins * 60_000, s.snoozeUntilMs) - t;
}

export function subDue(s: MatchDayState, now: number) {
  return s.phase === 'playing' && s.bench.length > 0 && s.subGapMins > 0 && nextSubInMs(s, now) <= 0;
}

export function minutesPlayedMs(s: MatchDayState, playerId: string, now: number) {
  const t = matchMs(s, now);
  return s.stints
    .filter((x) => x.playerId === playerId)
    .reduce((sum, x) => sum + ((x.to ?? t) - x.from), 0);
}

/** Countdowns round up, so "3:00 to go" shows 03:00 rather than 02:59. */
export function fmtCountdown(ms: number) {
  return fmtClock(Math.ceil(Math.max(0, ms) / 1000) * 1000);
}

export function fmtClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Fill the pitch: U10/U11 by main position, then second, then anyone; U8/U9 in order. */
export function autoLineup(
  spots: Spot[],
  players: { id: string; positions: Position[] }[],
  usePositions: boolean
) {
  const onPitch: Partial<Record<Spot, string | null>> = {};
  const left = [...players];
  const take = (pred: (p: { id: string; positions: Position[] }) => boolean) => {
    const i = left.findIndex(pred);
    return i >= 0 ? left.splice(i, 1)[0].id : null;
  };
  if (usePositions) {
    for (const spot of spots) onPitch[spot] = take((p) => p.positions[0] === spot);
    for (const spot of spots) if (!onPitch[spot]) onPitch[spot] = take((p) => p.positions[1] === spot);
    // keeper: nobody has GK -> leave it for the coach to choose rather than guess
    for (const spot of spots) if (!onPitch[spot] && spot !== 'gk') onPitch[spot] = take(() => true);
    if (!onPitch.gk) onPitch.gk = null;
  } else {
    for (const spot of spots) onPitch[spot] = take(() => true);
  }
  return { onPitch, bench: left.map((p) => p.id) };
}

/** Who's the keeper suggestion order when GK is empty: GK main, then GK second. */
export function keeperCandidates(players: { id: string; positions: Position[] }[], ids: string[]) {
  const pool = players.filter((p) => ids.includes(p.id));
  return [
    ...pool.filter((p) => p.positions[0] === 'gk'),
    ...pool.filter((p) => p.positions[1] === 'gk'),
  ].map((p) => p.id);
}

type Where = { spot: Spot } | { bench: string };

function locate(s: MatchDayState, playerId: string): Where | null {
  for (const spot of s.format.spots) if (s.onPitch[spot] === playerId) return { spot };
  if (s.bench.includes(playerId)) return { bench: playerId };
  return null;
}

/**
 * Swap two things the coach tapped: two players, or a player and an empty spot.
 * pitch <-> bench = a sub (minutes and "last sub" are updated when the game has started);
 * pitch <-> pitch = players swap spots.
 */
export function swap(
  s: MatchDayState,
  a: { playerId?: string; spot?: Spot },
  b: { playerId?: string; spot?: Spot },
  now: number
): MatchDayState {
  const next: MatchDayState = {
    ...s,
    onPitch: { ...s.onPitch },
    bench: [...s.bench],
    stints: s.stints.map((x) => ({ ...x })),
  };
  const t = matchMs(s, now);
  const started = s.phase !== 'lineup';
  const whereA = a.playerId ? locate(s, a.playerId) : a.spot ? ({ spot: a.spot } as Where) : null;
  const whereB = b.playerId ? locate(s, b.playerId) : b.spot ? ({ spot: b.spot } as Where) : null;
  if (!whereA || !whereB) return s;

  const put = (where: Where, playerId: string | null) => {
    if ('spot' in where) next.onPitch[where.spot] = playerId;
    else {
      const i = next.bench.indexOf(where.bench);
      if (playerId) next.bench[i] = playerId;
      else next.bench.splice(i, 1);
    }
  };
  const idAt = (where: Where) => ('spot' in where ? s.onPitch[where.spot] ?? null : where.bench);
  const pa = idAt(whereA);
  const pb = idAt(whereB);
  if (pa === pb) return s;
  if (!('spot' in whereA) && !('spot' in whereB)) return s; // bench <-> bench: nothing to do

  put(whereA, pb);
  put(whereB, pa);
  next.bench = next.bench.filter(Boolean);

  const isSub = 'spot' in whereA !== 'spot' in whereB; // pitch <-> pitch is just a position swap
  if (started && isSub) {
    const goingOff = 'spot' in whereA ? pa : pb;
    const comingOn = 'spot' in whereA ? pb : pa;
    if (goingOff) {
      const st = next.stints.find((x) => x.playerId === goingOff && x.to === null);
      if (st) st.to = t;
    }
    if (comingOn && next.format.spots.some((sp) => next.onPitch[sp] === comingOn)) {
      if (!next.stints.some((x) => x.playerId === comingOn && x.to === null)) {
        next.stints.push({ playerId: comingOn, from: t, to: null });
      }
    }
    if (goingOff && comingOn) {
      next.lastSubMs = t;
      next.snoozeUntilMs = 0;
    }
  }
  return next;
}

export function kickOff(s: MatchDayState, now: number): MatchDayState {
  const t = matchMs(s, now);
  const onIds = s.format.spots.map((sp) => s.onPitch[sp]).filter(Boolean) as string[];
  const stints =
    s.phase === 'lineup' ? onIds.map((id) => ({ playerId: id, from: t, to: null as number | null })) : s.stints;
  return {
    ...s,
    phase: 'playing',
    runningSince: now,
    periodStartMs: s.phase === 'lineup' ? 0 : s.periodStartMs,
    lastSubMs: s.phase === 'lineup' ? 0 : s.lastSubMs,
    stints,
  };
}

export function pause(s: MatchDayState, now: number): MatchDayState {
  if (s.runningSince === null) return s;
  return { ...s, bankedMs: matchMs(s, now), runningSince: null };
}

export function resume(s: MatchDayState, now: number): MatchDayState {
  if (s.runningSince !== null || s.phase !== 'playing') return s;
  return { ...s, runningSince: now };
}

/** Period time is up: stop the clock exactly at the whistle, go to half-time / full time. */
export function endPeriod(s: MatchDayState, now: number): MatchDayState {
  const whistle = s.periodStartMs + s.format.halfMins * 60_000;
  const t = Math.min(matchMs(s, now), whistle);
  const last = s.period >= s.format.periods - 1;
  const stints = last ? s.stints.map((x) => (x.to === null ? { ...x, to: t } : x)) : s.stints;
  return { ...s, bankedMs: t, runningSince: null, phase: last ? 'fulltime' : 'break', stints };
}

export function startNextPeriod(s: MatchDayState, now: number): MatchDayState {
  return {
    ...s,
    period: s.period + 1,
    periodStartMs: s.bankedMs,
    phase: 'playing',
    runningSince: now,
    snoozeUntilMs: 0,
  };
}

export function endEarly(s: MatchDayState, now: number): MatchDayState {
  const t = matchMs(s, now);
  return {
    ...s,
    bankedMs: t,
    runningSince: null,
    phase: 'fulltime',
    stints: s.stints.map((x) => (x.to === null ? { ...x, to: t } : x)),
  };
}

export function snooze(s: MatchDayState, now: number): MatchDayState {
  return { ...s, snoozeUntilMs: matchMs(s, now) + 60_000 };
}
