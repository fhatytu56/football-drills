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
  /** Subs every N minutes of playing time: at N, 2N, 3N... (one at a time). */
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
  /** The line-up at kick-off, so Reset > Restart can put it back. */
  startOnPitch?: Partial<Record<Spot, string | null>>;
  startBench?: string[];
  /** Game-time targets: player id -> % of the day's playing time. Missing = Auto (an even share). */
  targets?: Record<string, number>;
  /**
   * Who's in goal each half (each period). Index 0 is always whoever is in goal on the line-up;
   * a later half that's missing or null = the same keeper as the half before.
   */
  keepers?: (string | null)[];
  /** Match ms the next sub window opens (set at kick-off; then every subGapMins on the grid). */
  nextDueMs?: number;
}

export interface PlannedSub {
  on: string;
  off: string;
  /** Minute of playing time it's expected at. */
  at?: number;
}

/** What a saved plan keeps besides the line-up: the sub gap and the keepers. */
export interface SavedSchedule {
  every: number;
  keepers?: (string | null)[];
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

export function minutesPlayedMs(s: MatchDayState, playerId: string, now: number) {
  const t = matchMs(s, now);
  return s.stints
    .filter((x) => x.playerId === playerId)
    .reduce((sum, x) => sum + ((x.to ?? t) - x.from), 0);
}

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

function locate(s: Pick<MatchDayState, 'format' | 'onPitch' | 'bench'>, playerId: string): Where | null {
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
      // A sub made once the window is open uses that window; the next one is the next grid point.
      // An early sub (an injury at 12′) leaves the 15′ window where it is.
      if (t >= nextDueMs(s)) next.nextDueMs = gridNextMs(s, t);
    }
  }
  return next;
}

export function kickOff(s: MatchDayState, now: number): MatchDayState {
  const t = matchMs(s, now);
  const onIds = s.format.spots.map((sp) => s.onPitch[sp]).filter(Boolean) as string[];
  const fresh = s.phase === 'lineup';
  const stints = fresh ? onIds.map((id) => ({ playerId: id, from: t, to: null as number | null })) : s.stints;
  return {
    ...s,
    phase: 'playing',
    runningSince: now,
    periodStartMs: fresh ? 0 : s.periodStartMs,
    lastSubMs: fresh ? 0 : s.lastSubMs,
    nextDueMs: fresh ? s.subGapMins * 60_000 : s.nextDueMs,
    stints,
    startOnPitch: fresh ? { ...s.onPitch } : s.startOnPitch,
    startBench: fresh ? [...s.bench] : s.startBench,
  };
}

/**
 * Reset > Restart this match: back to the line-up screen with the kick-off line-up,
 * sub gap, keepers and game time kept; clock and minutes go back to zero.
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
    nextDueMs: undefined,
    stints: [],
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

// ---------- game time: % per player, subs picked from real minutes ----------

/** The day's playing time in minutes (both halves; both games for U8s/U9s with a Game 2). */
export function totalMins(format: Format) {
  return format.halfMins * format.periods;
}

/** Longest allowed sub gap. */
export function maxGap(format: Format) {
  return Math.max(1, Math.min(25, totalMins(format) - 1));
}

/** Someone who came on stays on at least this long. (Starters can go at the first sub.) */
export const MIN_STINT = 10;

const EPS = 1e-6;

/** Next sub-window time on the grid (gap, 2×gap, ...) strictly after match ms `t`. */
export function gridNextMs(s: Pick<MatchDayState, 'subGapMins'>, t: number) {
  const g = Math.max(1, s.subGapMins) * 60_000;
  return (Math.floor(t / g + EPS) + 1) * g;
}

export function nextDueMs(s: MatchDayState) {
  return s.nextDueMs ?? Math.max(1, s.subGapMins) * 60_000;
}

/** Keeper for each half: index 0 is whoever's in goal on the line-up; later halves default to the half before. */
export function keepersOf(s: Pick<MatchDayState, 'format' | 'onPitch' | 'keepers' | 'players'>): (string | null)[] {
  const here = new Set(s.players.map((p) => p.id));
  const out: (string | null)[] = [];
  let prev: string | null = s.onPitch.gk || null;
  for (let p = 0; p < s.format.periods; p++) {
    const want = p === 0 ? s.onPitch.gk || null : s.keepers?.[p];
    const v = want && here.has(want) ? want : prev;
    out.push(v);
    prev = v;
  }
  return out;
}

export interface Goals {
  total: number;
  /** Minutes each player is aiming for. */
  goal: Record<string, number>;
  /** Minutes in goal, from the keeper picks. */
  inGoal: Record<string, number>;
  setIds: string[];
  autoIds: string[];
  /** Something about the % can't work. */
  problem: string | null;
}

/** Turn the % (and the keepers) into minutes each player aims for. Auto players share what's left. */
export function goalsFor(s: Pick<MatchDayState, 'format' | 'onPitch' | 'bench' | 'keepers' | 'players' | 'targets'>): Goals {
  const total = totalMins(s.format);
  const ids = s.players.map((p) => p.id);
  const keepers = keepersOf(s);
  const inGoal: Record<string, number> = {};
  for (const id of ids) inGoal[id] = 0;
  keepers.forEach((k) => {
    if (k) inGoal[k] += s.format.halfMins;
  });
  const spots = Math.min(s.format.spots.length, ids.length);
  const cap = spots * total;
  const pct = (id: string) => {
    const v = s.targets?.[id];
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
  };
  const setIds = ids.filter((id) => pct(id) !== null);
  const fixed: Record<string, number> = {};
  for (const id of setIds) fixed[id] = Math.max(inGoal[id], (pct(id)! / 100) * total);
  let autos = ids.filter((id) => pct(id) === null);
  let share = 0;
  for (let i = 0; i < ids.length + 1; i++) {
    const used = Object.values(fixed).reduce((a, b) => a + b, 0);
    share = autos.length ? (cap - used) / autos.length : 0;
    const forced = autos.filter((id) => inGoal[id] > share + EPS);
    if (!forced.length) break;
    for (const id of forced) fixed[id] = inGoal[id];
    autos = autos.filter((id) => !forced.includes(id));
  }
  const goal: Record<string, number> = {};
  for (const id of ids) goal[id] = fixed[id] ?? Math.min(total, Math.max(0, share));
  const used = Object.values(fixed).reduce((a, b) => a + b, 0);
  let problem: string | null = null;
  if (ids.length > spots) {
    if (used > cap + EPS) problem = 'Game time adds up to more than the pitch holds.';
    else if (!autos.length && used < cap - EPS) problem = 'Game time leaves a spot empty. Raise someone or set one to Auto.';
    else if (share > total + EPS) problem = 'Auto players would need over 100%.';
  }
  return { total, goal, inGoal, setIds, autoIds: ids.filter((id) => pct(id) === null), problem };
}

/** Minutes each player will spend in goal in halves that start after minute `t`. */
function goalAhead(keepers: (string | null)[], halfMins: number, t: number) {
  const out: Record<string, number> = {};
  keepers.forEach((k, p) => {
    if (k && p * halfMins > t + EPS) out[k] = (out[k] || 0) + halfMins;
  });
  return out;
}

/** The game as the planner sees it at minute `t`. Mutated as subs are made. */
interface Sim {
  t: number;
  onPitch: Partial<Record<Spot, string | null>>;
  bench: string[];
  /** minutes played in finished spells */
  played: Record<string, number>;
  /** minute the current spell started (on-pitch players) */
  since: Record<string, number>;
  /** minute each player last came off (missing = never been off) */
  lastOff: Record<string, number>;
  /** preview only: spells split into outfield / goal, and what happened when */
  log?: {
    roleSince: Record<string, number>;
    segments: Record<string, [number, number, 'out' | 'goal'][]>;
    events: Preview['events'];
  };
}

/** What doesn't change during the game. */
interface Env {
  format: Format;
  total: number;
  gap: number;
  goal: Record<string, number>;
  /** players the coach gave a % (hitting theirs matters more than evening out the rest) */
  set: Set<string>;
  keepers: (string | null)[];
  players: { id: string; positions: Position[] }[];
  usePositions: boolean;
}

/** A set % is the coach's call: missing it counts this many times more than an Auto player's. */
const SET_WEIGHT = 25;

function envOf(s: MatchDayState): Env {
  const goals = goalsFor(s);
  return {
    format: s.format,
    total: totalMins(s.format),
    gap: Math.max(1, s.subGapMins),
    goal: goals.goal,
    set: new Set(goals.setIds),
    keepers: keepersOf(s),
    players: s.players,
    usePositions: s.format.spots.length === 7,
  };
}

function cloneSim(x: Sim): Sim {
  return { t: x.t, onPitch: { ...x.onPitch }, bench: [...x.bench], played: { ...x.played }, since: { ...x.since }, lastOff: { ...x.lastOff } };
}

/** Sub windows and half-time keeper changes after minute `t` (or from `t`, inclusive). */
function eventTimes(env: Env, t: number, inclusive: boolean) {
  const set = new Set<number>();
  for (let w = env.gap; w < env.total - EPS; w += env.gap) set.add(Math.round(w * 1000) / 1000);
  for (let p = 1; p < env.format.periods; p++) set.add(p * env.format.halfMins);
  return Array.from(set)
    .filter((x) => (inclusive ? x >= t - EPS : x > t + EPS))
    .sort((a, b) => a - b);
}

const onGrid = (env: Env, t: number) => Math.abs(Math.round(t / env.gap) * env.gap - t) < EPS;

function playedAt(sim: Sim, id: string, t: number) {
  return (sim.played[id] || 0) + (sim.since[id] !== undefined ? t - sim.since[id] : 0);
}

/** Share of their free time left that a player still needs on the pitch (1 = all of it). */
function needAt(sim: Sim, env: Env, t: number, id: string) {
  const ahead = goalAhead(env.keepers, env.format.halfMins, t)[id] || 0;
  return ((env.goal[id] ?? 0) - playedAt(sim, id, t) - ahead) / Math.max(EPS, env.total - t - ahead);
}

function endRole(sim: Sim, id: string, t: number, role: 'out' | 'goal') {
  if (!sim.log) return;
  const from = sim.log.roleSince[id];
  if (from !== undefined && t > from + EPS) sim.log.segments[id].push([from, t, role]);
  sim.log.roleSince[id] = t;
}
function goOff(sim: Sim, id: string, t: number) {
  endRole(sim, id, t, sim.onPitch.gk === id ? 'goal' : 'out');
  if (sim.log) delete sim.log.roleSince[id];
  sim.played[id] = playedAt(sim, id, t);
  delete sim.since[id];
  sim.lastOff[id] = t;
}
function goOn(sim: Sim, id: string, t: number) {
  sim.since[id] = t;
  if (sim.log) sim.log.roleSince[id] = t;
}

/** Half-time keeper change in the plan: swap places if the new keeper's on, else they come on in goal. */
function keeperStep(sim: Sim, env: Env, t: number) {
  const p = Math.round(t / env.format.halfMins);
  if (Math.abs(p * env.format.halfMins - t) > EPS || p <= 0 || p >= env.format.periods) return null;
  const want = env.keepers[p];
  const from = sim.onPitch.gk || null;
  if (!want || want === from) return null;
  const spot = env.format.spots.find((sp) => sp !== 'gk' && sim.onPitch[sp] === want) || null;
  if (from) endRole(sim, from, t, 'goal');
  if (spot) {
    endRole(sim, want, t, 'out');
    sim.onPitch.gk = want;
    sim.onPitch[spot] = from;
  } else {
    if (!sim.bench.includes(want)) return null;
    sim.onPitch.gk = want;
    sim.bench = sim.bench.filter((x) => x !== want);
    if (from) {
      goOff(sim, from, t);
      sim.bench.push(from);
    }
    goOn(sim, want, t);
  }
  return { kind: 'keeper' as const, keeper: want, from, to: spot };
}

function applySub(sim: Sim, pick: { on: string; off: string; spot: Spot }, t: number) {
  goOff(sim, pick.off, t);
  sim.onPitch[pick.spot] = pick.on;
  sim.bench = sim.bench.filter((x) => x !== pick.on).concat(pick.off);
  goOn(sim, pick.on, t);
}

/**
 * Who could come on (furthest behind first; ties: waited longest) and who could come off
 * (furthest ahead first; nobody within MIN_STINT of coming on, starters can go at the first
 * window; ties: like-for-like position for U10s/U11s, then longest on).
 */
function candidates(sim: Sim, env: Env, t: number) {
  const need = (id: string) => needAt(sim, env, t, id);
  const ons = [...sim.bench].sort((a, b) => {
    const d = need(b) - need(a);
    if (Math.abs(d) > EPS) return d;
    return (sim.lastOff[a] ?? -1) - (sim.lastOff[b] ?? -1);
  });
  const offsFor = (on: string) => {
    const pos = env.players.find((p) => p.id === on)?.positions || [];
    return env.format.spots
      .filter((sp) => sp !== 'gk' && sim.onPitch[sp])
      .filter((sp) => {
        const from = sim.since[sim.onPitch[sp]!] ?? 0;
        return from <= EPS || t - from >= MIN_STINT - EPS;
      })
      .sort((a, b) => {
        const ia = sim.onPitch[a]!;
        const ib = sim.onPitch[b]!;
        // a player with a set % who's had it comes off first
        const da = env.set.has(ia) && need(ia) <= EPS ? 0 : 1;
        const db = env.set.has(ib) && need(ib) <= EPS ? 0 : 1;
        if (da !== db) return da - db;
        const d = need(ia) - need(ib);
        if (Math.abs(d) > EPS) return d;
        const fa = env.usePositions && pos.includes(a) ? 0 : 1;
        const fb = env.usePositions && pos.includes(b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return (sim.since[ia] ?? 0) - (sim.since[ib] ?? 0);
      });
  };
  return { ons, offsFor, need };
}

function greedyPick(sim: Sim, env: Env, t: number) {
  const { ons, offsFor, need } = candidates(sim, env, t);
  const on = ons[0];
  if (!on) return null;
  const spot = offsFor(on)[0];
  if (!spot) return null;
  const off = sim.onPitch[spot]!;
  return need(on) > need(off) + EPS ? { on, off, spot } : null;
}

/** Play the rest of the game with simple picks; how far from everyone's game time does it end? */
function rolloutCost(sim: Sim, env: Env) {
  let subs = 0;
  for (const t of eventTimes(env, sim.t, false)) {
    keeperStep(sim, env, t);
    if (onGrid(env, t) && sim.bench.length) {
      const pick = greedyPick(sim, env, t);
      if (pick) {
        applySub(sim, pick, t);
        subs++;
      }
    }
    sim.t = t;
  }
  let cost = 0;
  for (const id of Object.keys(env.goal)) {
    const d = playedAt(sim, id, env.total) - env.goal[id];
    cost += d * d * (env.set.has(id) ? SET_WEIGHT : 1);
  }
  return cost + subs * 0.5;
}

/**
 * The sub to make at minute `t`: of the fair options (someone further behind for someone further
 * ahead, top few each way, or no sub), the one that leaves everyone closest to their game time by
 * the final whistle if the rest of the game goes the simple way.
 */
function bestPick(sim: Sim, env: Env, t: number) {
  const { ons, offsFor, need } = candidates(sim, env, t);
  const options: ({ on: string; off: string; spot: Spot } | null)[] = [];
  // the top few each way, plus anyone with a set % (they're the coach's call)
  const pickSome = <T,>(xs: T[], idOf: (x: T) => string) => xs.filter((x, i) => i < 3 || env.set.has(idOf(x)));
  for (const on of pickSome(ons, (x) => x)) {
    for (const spot of pickSome(offsFor(on), (sp) => sim.onPitch[sp]!)) {
      const off = sim.onPitch[spot]!;
      if (need(on) > need(off) + EPS) options.push({ on, off, spot });
    }
  }
  if (!options.length) return null;
  options.push(null);
  let best: (typeof options)[number] = null;
  let bestCost = Infinity;
  for (const o of options) {
    const trial = cloneSim(sim);
    if (o) applySub(trial, o, t);
    trial.t = t;
    const cost = rolloutCost(trial, env) + (o ? 0.5 : 0);
    if (cost < bestCost - 1e-6) {
      bestCost = cost;
      best = o;
    }
  }
  return best;
}

/** The planner's view of a live game at match ms `atMs`. */
function simFromLive(s: MatchDayState, atMs: number): Sim {
  const t = atMs / 60_000;
  const played: Record<string, number> = {};
  const since: Record<string, number> = {};
  const lastOff: Record<string, number> = {};
  for (const p of s.players) played[p.id] = 0;
  for (const x of s.stints) {
    if (x.to === null) since[x.playerId] = x.from / 60_000;
    else {
      played[x.playerId] = (played[x.playerId] || 0) + (x.to - x.from) / 60_000;
      lastOff[x.playerId] = Math.max(lastOff[x.playerId] ?? -1, x.to / 60_000);
    }
  }
  return { t, onPitch: { ...s.onPitch }, bench: [...s.bench], played, since, lastOff };
}

/** The sub the app suggests at match ms `atMs` (default: now), from real minutes. */
export function suggestSub(s: MatchDayState, now: number, atMs?: number) {
  if (s.phase === 'lineup' || s.phase === 'fulltime' || !s.bench.length) return null;
  const at = atMs ?? matchMs(s, now);
  return bestPick(simFromLive(s, at), envOf(s), at / 60_000);
}

/** Half-time keeper change waiting to be made (at the break, or if the half started without it). */
export function keeperDue(s: MatchDayState): { keeper: string; from: string | null; spot: Spot | null } | null {
  if (s.phase !== 'playing' && s.phase !== 'break') return null;
  const p = s.phase === 'break' ? s.period + 1 : s.period;
  if (p >= s.format.periods || p === 0) return null;
  const want = keepersOf(s)[p];
  if (!want || s.onPitch.gk === want) return null;
  const where = locate(s, want);
  if (!where) return null;
  return { keeper: want, from: s.onPitch.gk || null, spot: 'spot' in where ? where.spot : null };
}

/**
 * Make the keeper change. New keeper on the pitch: the two swap places. New keeper on the
 * bench: they come on in goal and the old keeper comes off. Doesn't use up a sub window.
 */
export function changeKeeper(s: MatchDayState, now: number): MatchDayState {
  const k = keeperDue(s);
  if (!k) return s;
  const t = matchMs(s, now);
  const next: MatchDayState = { ...s, onPitch: { ...s.onPitch }, bench: [...s.bench], stints: s.stints.map((x) => ({ ...x })) };
  if (k.spot) {
    next.onPitch.gk = k.keeper;
    next.onPitch[k.spot] = k.from;
    return next;
  }
  next.onPitch.gk = k.keeper;
  const i = next.bench.indexOf(k.keeper);
  if (k.from) next.bench[i] = k.from;
  else next.bench.splice(i, 1);
  if (k.from) {
    const st = next.stints.find((x) => x.playerId === k.from && x.to === null);
    if (st) st.to = t;
  }
  next.stints.push({ playerId: k.keeper, from: t, to: null });
  return next;
}

/** Sub due: the window is open, nobody snoozed it, and there's a fair sub to make. */
export function subDue(s: MatchDayState, now: number) {
  if (s.phase !== 'playing' && s.phase !== 'break') return false;
  if (!s.bench.length || s.subGapMins <= 0) return false;
  const t = matchMs(s, now);
  if (t < Math.max(nextDueMs(s), s.snoozeUntilMs)) return false;
  return !!suggestSub(s, now);
}

/**
 * A window opened but no sub is needed (everyone's on track): move to the next window.
 * Returns null when there's nothing to skip.
 */
export function skipWindow(s: MatchDayState, now: number): MatchDayState | null {
  if (s.phase !== 'playing') return null;
  const t = matchMs(s, now);
  if (t < nextDueMs(s) || keeperDue(s) || suggestSub(s, now)) return null;
  return { ...s, nextDueMs: gridNextMs(s, t) };
}

export function nextSubInMs(s: MatchDayState, now: number) {
  const t = matchMs(s, now);
  const due = Math.max(nextDueMs(s), s.snoozeUntilMs);
  if (due >= totalMins(s.format) * 60_000) return Infinity;
  return due - t;
}

/** A game saved on a phone before this version: give it a sub window, drop the old fixed plan. */
export function upgradeSaved(s: MatchDayState, now: number): MatchDayState {
  const old = s as MatchDayState & { plan?: unknown; subsMade?: unknown; schedule?: { every?: number } };
  const gap = old.schedule?.every || s.subGapMins || 5;
  const next: MatchDayState = { ...s, subGapMins: gap };
  delete (next as typeof old).plan;
  delete (next as typeof old).subsMade;
  delete (next as typeof old).schedule;
  if (s.phase !== 'lineup' && s.nextDueMs === undefined) next.nextDueMs = gridNextMs(next, matchMs(s, now));
  return next;
}

export interface Preview {
  total: number;
  goals: Goals;
  minutes: Record<string, number>;
  /** time on the pitch, split by outfield / in goal */
  segments: Record<string, [number, number, 'out' | 'goal'][]>;
  events: { t: number; items: ({ kind: 'sub'; on: string; off: string } | { kind: 'keeper'; keeper: string; from: string | null; to: Spot | null })[] }[];
  subs: PlannedSub[];
}

/**
 * What the game looks like if every sub happens on time: the same picks the app will make live,
 * with keepers changing at half-time.
 */
export function previewPlan(s: MatchDayState): Preview {
  const goals = goalsFor(s);
  const env = envOf(s);
  const sim: Sim = { t: 0, onPitch: { ...s.onPitch }, bench: [...s.bench], played: {}, since: {}, lastOff: {} };
  sim.log = { roleSince: {}, segments: {}, events: [] };
  for (const p of s.players) {
    sim.played[p.id] = 0;
    sim.log.segments[p.id] = [];
  }
  for (const sp of s.format.spots) {
    const id = sim.onPitch[sp];
    if (id) goOn(sim, id, 0);
  }
  const subs: PlannedSub[] = [];
  for (const t of eventTimes(env, 0, false)) {
    const items: Preview['events'][number]['items'] = [];
    const k = keeperStep(sim, env, t);
    if (k) items.push(k);
    if (onGrid(env, t) && sim.bench.length) {
      const pick = bestPick(sim, env, t);
      if (pick) {
        applySub(sim, pick, t);
        items.push({ kind: 'sub', on: pick.on, off: pick.off });
        subs.push({ on: pick.on, off: pick.off, at: t });
      }
    }
    sim.t = t;
    if (items.length) sim.log.events.push({ t, items });
  }
  for (const sp of s.format.spots) {
    const id = sim.onPitch[sp];
    if (id && sim.since[id] !== undefined) goOff(sim, id, env.total);
  }
  const minutes: Record<string, number> = {};
  for (const id of Object.keys(sim.played)) minutes[id] = Math.round(sim.played[id] * 100) / 100;
  return { total: env.total, goals, minutes, segments: sim.log.segments, events: sim.log.events, subs };
}
