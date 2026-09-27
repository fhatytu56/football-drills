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
  /** The team playing (lets "Back" return to the who's-here step). */
  teamId?: string;
  /** Planned subs in order (from the saved sub plan). Empty = no plan. */
  plan?: PlannedSub[];
  /** How many subs have been made so far = which plan step is next. */
  subsMade?: number;
}

export interface PlannedSub {
  on: string;
  off: string;
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
      next.subsMade = (s.subsMade || 0) + 1;
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


// ---------- sub plan ----------

/** Sub k (1-based) is due about k x gap minutes into the day's playing time. */
export function planTimes(format: Format, gapMins: number, count: number) {
  return Array.from({ length: count }, (_, i) => (i + 1) * gapMins);
}

/** How many subs fit: one every `gap` minutes, none at or after the final whistle. */
export function planLength(format: Format, gapMins: number, benchSize: number) {
  if (benchSize === 0 || gapMins <= 0) return 0;
  const total = format.halfMins * format.periods;
  return Math.max(0, Math.ceil(total / gapMins) - 1);
}

type P = { id: string; positions: Position[] };

/**
 * Suggest a fair plan. At each sub: the bench player with the fewest minutes comes on;
 * the outfield player they replace is, for U10s/U11s, preferably one whose spot is in the
 * newcomer's positions, otherwise whoever has played longest. U10s/U11s keeper stays put.
 */
export function suggestPlan(
  format: Format,
  gapMins: number,
  onPitch: Partial<Record<Spot, string | null>>,
  bench: string[],
  players: P[],
  usePositions: boolean
): PlannedSub[] {
  const n = planLength(format, gapMins, bench.length);
  const pitch = { ...onPitch };
  let benchNow = [...bench];
  const mins: Record<string, number> = {};
  const sinceOn: Record<string, number> = {};
  for (const id of Object.values(pitch)) if (id) { mins[id] = 0; sinceOn[id] = 0; }
  for (const id of benchNow) mins[id] = 0;
  const pos = (id: string) => players.find((p) => p.id === id)?.positions || [];
  const plan: PlannedSub[] = [];
  let last = 0;
  for (let k = 1; k <= n; k++) {
    const t = k * gapMins;
    for (const id of Object.values(pitch)) if (id) mins[id] += t - last;
    last = t;
    if (!benchNow.length) break;
    const on = [...benchNow].sort((a, b) => mins[a] - mins[b])[0];
    const spots = format.spots.filter((sp) => pitch[sp] && !(sp === 'gk' && !format.keeperRotates));
    if (!spots.length) break;
    const byMinutes = [...spots].sort(
      (a, b) => mins[pitch[b]!] - mins[pitch[a]!] || sinceOn[pitch[a]!] - sinceOn[pitch[b]!]
    );
    let spot = byMinutes[0];
    if (usePositions) {
      const fit = byMinutes.find((sp) => pos(on).includes(sp));
      // take a like-for-like spot unless that player has had clearly less time (> one gap)
      if (fit && mins[pitch[fit]!] >= mins[pitch[spot]!] - gapMins) spot = fit;
    }
    const off = pitch[spot]!;
    pitch[spot] = on;
    sinceOn[on] = t;
    benchNow = benchNow.filter((x) => x !== on).concat(off);
    plan.push({ on, off });
  }
  return plan;
}

/** Minutes each player would get if the plan runs on time. */
export function plannedMinutes(
  format: Format,
  gapMins: number,
  onPitch: Partial<Record<Spot, string | null>>,
  plan: PlannedSub[]
) {
  const total = format.halfMins * format.periods;
  const on = new Set(Object.values(onPitch).filter(Boolean) as string[]);
  const mins: Record<string, number> = {};
  let last = 0;
  plan.forEach((sub, i) => {
    const t = Math.min((i + 1) * gapMins, total);
    for (const id of on) mins[id] = (mins[id] || 0) + (t - last);
    last = t;
    if (on.has(sub.off) && !on.has(sub.on)) {
      on.delete(sub.off);
      on.add(sub.on);
    }
  });
  for (const id of on) mins[id] = (mins[id] || 0) + (total - last);
  return mins;
}

/** The planned sub that's next, and whether it can still happen right now. */
export function nextPlanned(s: MatchDayState): { sub: PlannedSub; number: number; ok: boolean; why?: string } | null {
  const plan = s.plan || [];
  const i = s.subsMade || 0;
  if (i >= plan.length) return null;
  const sub = plan[i];
  const onPitch = s.format.spots.some((sp) => s.onPitch[sp] === sub.off);
  const onBench = s.bench.includes(sub.on);
  const why = !onPitch ? 'is already off' : !onBench ? 'is already on' : undefined;
  return { sub, number: i + 1, ok: onPitch && onBench, why };
}
