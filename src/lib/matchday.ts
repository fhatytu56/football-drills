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
  /** How many plan steps are done = which plan step is next. */
  subsMade?: number;
  /** The line-up at kick-off, so Reset > Restart can put it back. */
  startOnPitch?: Partial<Record<Spot, string | null>>;
  startBench?: string[];
  /** When subs happen. Missing (older saved games) = one every subGapMins. */
  schedule?: Schedule;
  /** Game-time targets: player id -> % of the day's playing time. Missing = Auto. */
  targets?: Record<string, number>;
}

export interface PlannedSub {
  on: string;
  off: string;
  /** Minute of playing time it's planned for (older plans don't have it). */
  at?: number;
}

/** First window at `firstAt` with `firstCount` subs, then one every `every` minutes with `per` subs. */
export interface Schedule {
  firstAt: number;
  firstCount: number;
  every: number;
  per: number;
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

/**
 * Match ms the next sub is due. A timed plan: the next step's minute (null once the plan is done).
 * Older games without times: one every subGapMins after the last sub.
 */
export function nextDueMs(s: MatchDayState): number | null {
  const plan = s.plan || [];
  if (s.schedule || plan.some((x) => typeof x.at === 'number')) {
    const step = plan[s.subsMade || 0];
    return step && typeof step.at === 'number' ? step.at * 60_000 : null;
  }
  return s.lastSubMs + s.subGapMins * 60_000;
}

export function nextSubInMs(s: MatchDayState, now: number) {
  const due = nextDueMs(s);
  if (due === null) return Infinity;
  return Math.max(due, s.snoozeUntilMs) - matchMs(s, now);
}

/** Due while playing, and at half-time when a window falls on the whistle. */
export function subDue(s: MatchDayState, now: number) {
  return (
    (s.phase === 'playing' || s.phase === 'break') &&
    s.bench.length > 0 &&
    s.subGapMins > 0 &&
    nextSubInMs(s, now) <= 0
  );
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
      // A sub counts as the next plan step when that step is due, or it's exactly that pair.
      // An early unplanned sub (an injury at 12′) leaves the 15′ step where it is.
      const i = s.subsMade || 0;
      const step = (s.plan || [])[i];
      const timed = !!step && typeof step.at === 'number';
      const isStep = !!step && step.on === comingOn && step.off === goingOff;
      if (!timed || isStep || t >= step.at! * 60_000) {
        next.subsMade = i + 1;
      }
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
    startOnPitch: s.phase === 'lineup' ? { ...s.onPitch } : s.startOnPitch,
    startBench: s.phase === 'lineup' ? [...s.bench] : s.startBench,
  };
}

/**
 * Reset > Restart this match: back to the line-up screen with the kick-off line-up,
 * sub gap and plan kept; clock, minutes and subs made go back to zero.
 * (A match kicked off before this existed has no saved start line-up: keep who's on now.)
 */
export function restart(s: MatchDayState): MatchDayState {
  return {
    ...s,
    onPitch: { ...(s.startOnPitch || s.onPitch) },
    bench: [...(s.startBench || s.bench)],
    phase: 'lineup',
    period: 0,
    periodStartMs: 0,
    bankedMs: 0,
    runningSince: null,
    lastSubMs: 0,
    snoozeUntilMs: 0,
    stints: [],
    subsMade: 0,
    startOnPitch: undefined,
    startBench: undefined,
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

/** The day's playing time in minutes (both halves; both games for U8s/U9s with a Game 2). */
export function totalMins(format: Format) {
  return format.halfMins * format.periods;
}

/** Nobody planned off within this many minutes of coming on. */
export const MIN_STINT = 10;

/** 7-a-side: 2 subs at 10′, then 1 every 5′. 5-a-side: 1 every 5′ (as before). */
export function defaultSchedule(format: Format): Schedule {
  return format.spots.length === 7
    ? { firstAt: 10, firstCount: 2, every: 5, per: 1 }
    : { firstAt: 5, firstCount: 1, every: 5, per: 1 };
}

/** The schedule a game uses; older saved games had only "sub every N". */
export function scheduleOf(s: Pick<MatchDayState, 'schedule' | 'subGapMins' | 'format'>): Schedule {
  if (s.schedule) return s.schedule;
  const g = s.subGapMins > 0 ? s.subGapMins : defaultSchedule(s.format).every;
  return { firstAt: g, firstCount: 1, every: g, per: 1 };
}

/** Allowed range for each schedule number. */
export function scheduleLimits(format: Format, benchSize: number, spotsInPlay: number) {
  const total = totalMins(format);
  const most = Math.max(1, Math.min(benchSize, spotsInPlay));
  return {
    firstAt: { min: 1, max: Math.max(1, total - 1) },
    firstCount: { min: 1, max: most },
    every: { min: 1, max: Math.min(25, Math.max(1, total - 1)) },
    per: { min: 1, max: most },
  };
}

export function clampSchedule(format: Format, sch: Schedule, benchSize: number, spotsInPlay: number): Schedule {
  const lim = scheduleLimits(format, benchSize, spotsInPlay);
  const c = (v: number, k: keyof Schedule) =>
    Math.min(lim[k].max, Math.max(lim[k].min, Math.round(Number.isFinite(v) ? v : lim[k].min)));
  return { firstAt: c(sch.firstAt, 'firstAt'), firstCount: c(sch.firstCount, 'firstCount'), every: c(sch.every, 'every'), per: c(sch.per, 'per') };
}

/** Sub windows: minute and how many subs. None at or after the final whistle. */
export function subWindows(format: Format, sch: Schedule) {
  const total = totalMins(format);
  const out: { t: number; count: number }[] = [];
  if (sch.every <= 0) return out;
  for (let t = sch.firstAt, i = 0; t < total; t += sch.every, i++) out.push({ t, count: i === 0 ? sch.firstCount : sch.per });
  return out;
}

type P = { id: string; positions: Position[] };

export interface PlanInput {
  format: Format;
  schedule: Schedule;
  onPitch: Partial<Record<Spot, string | null>>;
  bench: string[];
  players: P[];
  /** player id -> % of the day's playing time; missing = Auto */
  targets: Record<string, number>;
  usePositions: boolean;
}

export interface PlanResult {
  subs: PlannedSub[];
  /** Windows that have at least one sub, in order. */
  windows: { t: number; subs: PlannedSub[] }[];
  total: number;
  /** U10s/U11s keeper: stays on all game, not in the rotation. */
  keeper: string | null;
  /** Players sharing the other spots: starters in spot order, then the bench. */
  rotating: string[];
  starters: string[];
  /** Planned minutes and time on the pitch, per player. */
  minutes: Record<string, number>;
  stints: Record<string, [number, number][]>;
  /** Minutes each rotating player is aiming for (their target, or an even share of what's left). */
  goal: Record<string, number>;
  /** % an Auto player is aiming for. */
  autoPct: number;
  /** Something about the targets can't work. */
  problem: string | null;
  /** Players with a target the plan misses by more than one gap. */
  misses: string[];
}

const EPS = 1e-6;

/**
 * Plan the subs from game-time targets.
 * At each window the bench player furthest behind their target comes on, for the player
 * furthest ahead of theirs (never someone who came on under MIN_STINT minutes ago).
 * Like-for-like position only breaks a tie, so it never costs anyone minutes.
 * A sub only happens if it brings both players closer to their targets.
 */
export function buildPlan(input: PlanInput): PlanResult {
  const { format, schedule, onPitch, players, usePositions } = input;
  const total = totalMins(format);
  const keeper = !format.keeperRotates ? onPitch.gk || null : null;
  const pitch: Partial<Record<Spot, string>> = {};
  for (const sp of format.spots) {
    const id = onPitch[sp];
    if (id && !(sp === 'gk' && !format.keeperRotates)) pitch[sp] = id;
  }
  const spots = format.spots.filter((sp) => pitch[sp]);
  const starters = spots.map((sp) => pitch[sp]!);
  let bench = input.bench.filter((id) => id !== keeper && !starters.includes(id));
  const rotating = [...starters, ...bench];
  const rank: Record<string, number> = {};
  rotating.forEach((id, i) => (rank[id] = i));

  // targets -> goal minutes
  const cap = spots.length * total;
  const pctOf = (id: string) => {
    const v = input.targets[id];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
  };
  const setIds = rotating.filter((id) => pctOf(id) !== null);
  const autoIds = rotating.filter((id) => pctOf(id) === null);
  const setMins = setIds.reduce((a, id) => a + (pctOf(id)! / 100) * total, 0);
  const autoMins = autoIds.length ? (cap - setMins) / autoIds.length : 0;
  const goal: Record<string, number> = {};
  for (const id of rotating) goal[id] = pctOf(id) !== null ? (pctOf(id)! / 100) * total : Math.min(total, Math.max(0, autoMins));

  const since: Record<string, number> = {};
  const played: Record<string, number> = {};
  const stints: Record<string, [number, number][]> = {};
  for (const id of rotating) {
    played[id] = 0;
    stints[id] = [];
  }
  for (const id of starters) since[id] = 0;
  const pos = (id: string) => players.find((p) => p.id === id)?.positions || [];

  const subs: PlannedSub[] = [];
  const windows: PlanResult['windows'] = [];
  if (bench.length && spots.length) {
    for (const w of subWindows(format, schedule)) {
      const t = w.t;
      const need = (id: string) => goal[id] - played[id] - (since[id] !== undefined ? t - since[id] : 0);
      const wentOff = new Set<string>();
      const made: PlannedSub[] = [];
      for (let k = 0; k < w.count; k++) {
        let on: string | null = null;
        for (const id of bench) {
          if (wentOff.has(id)) continue;
          if (on === null || need(id) > need(on) + EPS) on = id;
        }
        if (!on) break;
        let spot: Spot | null = null;
        for (const sp of spots) {
          const id = pitch[sp]!;
          if (t - since[id] < MIN_STINT) continue;
          if (spot === null) {
            spot = sp;
            continue;
          }
          const cur = pitch[spot]!;
          const d = need(id) - need(cur);
          if (d < -EPS) spot = sp;
          else if (d <= EPS) {
            const fit = usePositions && pos(on).includes(sp);
            const curFit = usePositions && pos(on).includes(spot);
            if (fit !== curFit) {
              if (fit) spot = sp;
            } else if (since[id] !== since[cur]) {
              if (since[id] < since[cur]) spot = sp;
            } else if (rank[id] < rank[cur]) spot = sp;
          }
        }
        if (!spot) break;
        const off = pitch[spot]!;
        if (need(on) <= need(off) + EPS) break;
        stints[off].push([since[off], t]);
        played[off] += t - since[off];
        delete since[off];
        pitch[spot] = on;
        since[on] = t;
        bench = bench.filter((x) => x !== on).concat(off);
        wentOff.add(off);
        const sub = { on, off, at: t };
        made.push(sub);
        subs.push(sub);
      }
      if (made.length) windows.push({ t, subs: made });
    }
  }
  for (const id of Object.values(pitch)) {
    if (!id) continue;
    stints[id].push([since[id], total]);
    played[id] += total - since[id];
  }

  const minutes: Record<string, number> = { ...played };
  if (keeper) {
    minutes[keeper] = total;
    stints[keeper] = [[0, total]];
  }

  let problem: string | null = null;
  if (rotating.length > spots.length && spots.length) {
    if (setMins > cap + EPS) problem = 'Targets add up to more than the pitch holds.';
    else if (!autoIds.length && setMins < cap - EPS) problem = 'Targets leave a spot empty. Raise someone.';
    else if (autoMins > total + EPS) problem = 'Auto players would need over 100%.';
  }
  const misses = setIds.filter((id) => Math.abs(played[id] - goal[id]) > schedule.every + EPS);

  return {
    subs,
    windows,
    total,
    keeper,
    rotating,
    starters,
    minutes,
    stints,
    goal,
    autoPct: Math.min(100, Math.max(0, (autoMins / total) * 100)),
    problem,
    misses,
  };
}

/** The plan inputs a game holds. */
export function planInputOf(s: MatchDayState): PlanInput {
  return {
    format: s.format,
    schedule: scheduleOf(s),
    onPitch: s.onPitch,
    bench: s.bench,
    players: s.players,
    targets: s.targets || {},
    usePositions: s.format.spots.length === 7,
  };
}

/** Re-plan a game that hasn't kicked off (after a line-up, schedule or target change). */
export function withPlan(s: MatchDayState): MatchDayState {
  const schedule = scheduleOf(s);
  return { ...s, schedule, subGapMins: schedule.every, plan: buildPlan(planInputOf(s)).subs, subsMade: 0 };
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
