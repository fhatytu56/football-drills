// U10 manager game: the rules. No React, no storage — just plain data in, plain data out,
// so it can be checked with a script.

import { DIVISIONS, WAYSIDE, fixtureDate, type Division } from './ddsl';
import type { LiveMatch, Tactic } from './match';

// ---------- Stats ----------

export type StatKey = 'passing' | 'dribbling' | 'shooting' | 'tackling' | 'positioning' | 'keeping' | 'fitness';

export const STATS: { key: StatKey; short: string; label: string }[] = [
  { key: 'passing', short: 'Pas', label: 'Passing' },
  { key: 'dribbling', short: 'Dri', label: 'Dribbling' },
  { key: 'shooting', short: 'Sho', label: 'Shooting' },
  { key: 'tackling', short: 'Tck', label: 'Tackling' },
  { key: 'positioning', short: 'Pos', label: 'Positioning' },
  { key: 'keeping', short: 'GK', label: 'Keeping' },
  { key: 'fitness', short: 'Fit', label: 'Fitness' },
];

export type Stats = Record<StatKey, number>;

/** Everyone starts here. 1–20, like Championship Manager. */
export const START_STAT = 5;
export const MAX_STAT = 20;

export function freshStats(): Stats {
  return { passing: START_STAT, dribbling: START_STAT, shooting: START_STAT, tackling: START_STAT, positioning: START_STAT, keeping: START_STAT, fitness: START_STAT };
}

/** What each kind of drill trains. Keys are the drills' game_phase values. */
export const PHASE_STATS: Record<string, StatKey[]> = {
  attacking: ['shooting', 'dribbling'],
  defending: ['tackling', 'positioning'],
  transition_attack: ['dribbling', 'passing', 'fitness'],
  transition_defense: ['positioning', 'tackling', 'fitness'],
  possession: ['passing', 'positioning'],
  set_pieces: ['shooting', 'passing'],
  goalkeeping: ['keeping'],
  warmup: ['fitness'],
  conditioning: ['fitness'],
};

/** In kid words, for the quiz and the drill cards. */
export const PHASE_LABEL: Record<string, string> = {
  attacking: 'Attacking',
  defending: 'Defending',
  transition_attack: 'Breaking forward fast',
  transition_defense: 'Getting back when we lose the ball',
  possession: 'Keeping the ball',
  set_pieces: 'Set pieces',
  goalkeeping: 'Goalkeeping',
  warmup: 'Warm-up',
  conditioning: 'Fitness',
};

// ---------- Positions (same 7-a-side shape as Match Day) ----------

export type Slot = 'gk' | 'lb' | 'rb' | 'lm' | 'cm' | 'rm' | 'st';
export const SLOTS: { id: Slot; short: string }[] = [
  { id: 'gk', short: 'GK' }, { id: 'lb', short: 'LB' }, { id: 'rb', short: 'RB' },
  { id: 'lm', short: 'LM' }, { id: 'cm', short: 'CM' }, { id: 'rm', short: 'RM' }, { id: 'st', short: 'ST' },
];
export type Lineup = Partial<Record<Slot, string>>; // slot -> player id

// ---------- Save ----------

export interface GamePlayer {
  id: string;
  name: string;
  positions: string[]; // from the coaches' squad: main then second
  s: Stats;
  goals: number;
  apps: number;
  /** Individual training: this stat gets a little extra every session. */
  focus?: StatKey;
}

export interface SessionResult {
  status: 'done' | 'missed' | 'empty';
  drills?: { drillId: string; title: string; phase: string; repeat: boolean }[];
  /** A bit of fun from training (no effect on stats). */
  mishap?: string;
  // older saves (quiz version)
  focus: string[];
  answers: { drillId: string; title: string; phase: string; correct: boolean; picked: string; right: string; prompt: string }[];
  gains: Record<string, Partial<Stats>>; // player id -> stat increases
}

export interface MatchResult {
  opp: string;
  home: boolean;
  gf: number;
  ga: number;
  scorers: string[]; // player ids, one per goal
  oppScorers: number;
  possession: number;
  shots: [number, number];
  onTarget: [number, number];
  motm: string | null;
  auto: boolean; // played automatically because the week went by
  pens?: [number, number];
}

export interface WeekState {
  tuesday?: SessionResult;
  thursday?: SessionResult;
  match?: MatchResult;
  cup?: MatchResult;
}

export interface LeagueResult {
  w: number;
  home: string;
  away: string;
  hg: number;
  ag: number;
}

export interface CupTie {
  a: string;
  b: string;
  ga?: number;
  gb?: number;
  pens?: [number, number];
  winner?: string;
}

export interface CupRound {
  w: number;
  name: string;
  ties: CupTie[];
}

export interface Fixture {
  w: number;
  opp: string;
  home: boolean;
  real: boolean; // matches a real DDSL fixture date
}

export interface Save {
  v: 1;
  team: string;
  division: string;
  season: number;
  seed: number;
  startMonday: string; // YYYY-MM-DD
  weeks: number;
  schedule: Fixture[];
  results: LeagueResult[];
  players: Record<string, GamePlayer>;
  lineup: Lineup;
  mastery: Record<string, number>; // drill id -> times answered right
  log: Record<number, WeekState>;
  cup: { rounds: CupRound[]; out: boolean; won: boolean };
  oppBoost: number;
  /** The game week being played. Moves on when the kid taps Next week after the match. */
  cur?: number;
  /** Finished seasons, for the leaderboard (league titles, cups). */
  honours?: { season: number; pos: number; cup: boolean }[];
  /** Drills from the last session (running the same ones again in a row counts for less). */
  lastDrills?: string[];
  /** How often each player has been in a joke, so it's spread evenly. */
  jokes?: Record<string, number>;
  /** Training sessions run, for picking the funny lines. */
  sessions?: number;
  /** The last few training jokes used, so they don't repeat. */
  recentMishaps?: number[];
  /** Pre-match tactic. */
  tactic?: Tactic;
  /** A match being watched right now, so closing the app doesn't lose it. */
  live?: LiveMatch;
}

// ---------- Random (seeded, so a reload never re-rolls) ----------

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function poisson(lambda: number, r: () => number) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > L && k < 30);
  return k - 1;
}

// ---------- Dates (plain YYYY-MM-DD, no time zones) ----------

export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

export function mondayOf(iso: string) {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
  return addDays(iso, -((dow + 6) % 7));
}

export const dayOf = {
  tuesday: (s: Save, w: number) => addDays(s.startMonday, w * 7 + 1),
  thursday: (s: Save, w: number) => addDays(s.startMonday, w * 7 + 3),
  sunday: (s: Save, w: number) => addDays(s.startMonday, w * 7 + 6),
};

/** The week being played. Older saves without `cur` pick up at the first week with no match. */
export function currentWeek(s: Save) {
  if (typeof s.cur === 'number') return Math.min(s.cur, s.weeks - 1);
  const w = s.schedule.findIndex((f) => !s.log[f.w]?.match);
  return w < 0 ? s.weeks - 1 : w;
}

/** After the match: on to next week. */
export function nextWeek(s: Save) {
  const w = currentWeek(s);
  if (!s.log[w]?.match || ourCupTie(s, w)) return; // league game and our cup tie first
  recordCup(s, w, null); // the rest of this week's cup round, if we weren't in it
  if (w + 1 < s.weeks) s.cur = w + 1;
}

// ---------- Team strength ----------

/** Opponent rating on the same 1–20 scale. Higher divisions (10.2) are stronger than lower ones (10.19). */
export function teamRating(s: Save, team: string, w: number) {
  const div = DIVISIONS.find((d) => d.name === s.division && d.teams.includes(team))
    || DIVISIONS.find((d) => d.teams.includes(team));
  const level = div ? Number(div.name.split('.')[1]) : 10;
  const base = 7.4 - 0.08 * (level - 1);
  const noise = ((hash(team) % 1000) / 1000 - 0.5) * 2.4; // ±1.2, same every time
  return base + noise + s.oppBoost + 0.27 * w; // opponents train too
}

const ATT_WEIGHT: Record<Slot, number> = { gk: 0, lb: 0.05, rb: 0.05, lm: 0.2, cm: 0.2, rm: 0.2, st: 0.3 };
const DEF_WEIGHT: Record<Slot, number> = { gk: 0, lb: 0.25, rb: 0.25, lm: 0.1, cm: 0.25, rm: 0.1, st: 0.05 };

function attOf(slot: Slot, st: Stats) {
  if (slot === 'st') return 0.5 * st.shooting + 0.3 * st.dribbling + 0.2 * st.passing;
  if (slot === 'cm') return 0.6 * st.passing + 0.2 * st.dribbling + 0.2 * st.shooting;
  if (slot === 'lm' || slot === 'rm') return 0.4 * st.dribbling + 0.3 * st.passing + 0.3 * st.shooting;
  return 0.5 * st.passing + 0.5 * st.dribbling;
}

function defOf(slot: Slot, st: Stats) {
  if (slot === 'lb' || slot === 'rb') return 0.5 * st.tackling + 0.5 * st.positioning;
  if (slot === 'cm') return 0.4 * st.tackling + 0.6 * st.positioning;
  return 0.4 * st.tackling + 0.6 * st.positioning;
}

const EMPTY: Stats = { passing: 3, dribbling: 3, shooting: 3, tackling: 3, positioning: 3, keeping: 3, fitness: 3 };

/** Energy 0–100 makes a tired player play like a weaker one (100 = full strength, 0 = 70%). */
export function energyFactor(e: number | undefined) {
  return e === undefined ? 1 : 0.6 + 0.4 * Math.max(0, Math.min(100, e)) / 100;
}

export function teamStrength(s: Save, lineup: Lineup, energy?: Record<string, number>) {
  let att = 0;
  let def = 0;
  let pas = 0;
  let fit = 0;
  let keep = EMPTY.keeping;
  for (const { id: slot } of SLOTS) {
    const p = lineup[slot] ? s.players[lineup[slot]!] : undefined;
    const st = p ? p.s : EMPTY;
    const e = p ? energyFactor(energy?.[p.id]) : 1;
    const k = e; // anyone can play anywhere: only their stats matter
    att += ATT_WEIGHT[slot] * attOf(slot, st) * k;
    def += DEF_WEIGHT[slot] * defOf(slot, st) * k;
    pas += (st.passing * e) / 7;
    fit += st.fitness / 7;
    if (slot === 'gk') keep = st.keeping * e;
  }
  const fitK = energy ? 1 : 0.92 + 0.16 * (fit / MAX_STAT); // live matches use energy instead
  return { att: att * fitK, def: (0.65 * def + 0.35 * keep) * fitK, pas, keep };
}

// ---------- Matches ----------

export const GOALS = 2.6; // average goals per team when evenly matched (7-a-side, 50 min)

export function lambda(att: number, def: number, home: boolean) {
  return Math.max(0.15, GOALS * Math.pow(att / Math.max(1, def), 1.3) * (home ? 1.08 : 0.95));
}

function pickScorer(s: Save, lineup: Lineup, r: () => number) {
  const w: Record<Slot, number> = { gk: 0, lb: 0.4, rb: 0.4, lm: 2, cm: 1.5, rm: 2, st: 4 };
  const pool = SLOTS.filter((x) => lineup[x.id]).map((x) => ({ id: lineup[x.id]!, w: w[x.id] * (s.players[lineup[x.id]!]?.s.shooting || 1) }));
  const total = pool.reduce((a, b) => a + b.w, 0);
  let t = r() * total;
  for (const p of pool) {
    t -= p.w;
    if (t <= 0) return p.id;
  }
  return pool[0]?.id || '';
}

export function playMatch(s: Save, opp: string, home: boolean, w: number, seed: number, auto: boolean, knockout = false): MatchResult {
  const r = rng(seed);
  const us = teamStrength(s, s.lineup);
  const them = teamRating(s, opp, w);
  const lf = lambda(us.att, them, home);
  const la = lambda(them, us.def, !home);
  const gf = poisson(lf, r);
  const ga = poisson(la, r);
  const scorers = Array.from({ length: gf }, () => pickScorer(s, s.lineup, r));
  const possession = Math.round(Math.min(72, Math.max(28, 50 + 40 * (us.pas - them) / (us.pas + them))));
  const shots: [number, number] = [gf + poisson(lf * 2.2, r), ga + poisson(la * 2.2, r)];
  const onTarget: [number, number] = [gf + Math.min(shots[0] - gf, poisson(lf * 0.8, r)), ga + Math.min(shots[1] - ga, poisson(la * 0.8, r))];
  const ids = SLOTS.map((x) => s.lineup[x.id]).filter(Boolean) as string[];
  const motm = ids.length
    ? ids.slice().sort((a, b) => (scorers.filter((x) => x === b).length - scorers.filter((x) => x === a).length) || (avg(s.players[b]?.s) - avg(s.players[a]?.s)) || (r() - 0.5))[0]
    : null;
  const res: MatchResult = { opp, home, gf, ga, scorers, oppScorers: ga, possession, shots, onTarget, motm, auto };
  if (knockout && gf === ga) {
    // penalties: keeping and shooting help a bit
    const pUs = 0.7 + 0.01 * (avgShooting(s) - them / 2);
    const pThem = 0.7 - 0.01 * (us.keep - them / 2);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 5; i++) { if (r() < pUs) a++; if (r() < pThem) b++; }
    while (a === b) { if (r() < pUs) a++; if (r() < pThem) b++; }
    res.pens = [a, b];
  }
  return res;
}

function avg(st?: Stats) {
  if (!st) return 0;
  return (st.passing + st.dribbling + st.shooting + st.tackling + st.positioning + st.fitness) / 6;
}

function avgShooting(s: Save) {
  const ids = SLOTS.map((x) => s.lineup[x.id]).filter(Boolean) as string[];
  return ids.length ? ids.reduce((a, id) => a + (s.players[id]?.s.shooting || 0), 0) / ids.length : 5;
}

function simPair(s: Save, a: string, b: string, w: number, r: () => number) {
  const ra = teamRating(s, a, w);
  const rb = teamRating(s, b, w);
  return [poisson(lambda(ra, rb, true), r), poisson(lambda(rb, ra, false), r)];
}

/** Records our result and plays everyone else's games that week. */
export function recordLeagueWeek(s: Save, w: number, m: MatchResult) {
  const fx = s.schedule.find((f) => f.w === w);
  if (!fx) return;
  s.results.push(fx.home
    ? { w, home: s.team, away: fx.opp, hg: m.gf, ag: m.ga }
    : { w, home: fx.opp, away: s.team, hg: m.ga, ag: m.gf });

  // Everyone else pairs up: fewest games first, rarely the same pairing twice.
  const r = rng(s.seed + w * 977 + 13);
  const div = divisionOf(s);
  const others = div.teams.filter((t) => t !== WAYSIDE && t !== fx.opp);
  const played = (t: string) => s.results.filter((x) => x.home === t || x.away === t).length;
  const met = (a: string, b: string) => s.results.filter((x) => (x.home === a && x.away === b) || (x.home === b && x.away === a)).length;
  const pool = shuffle(others, r).sort((a, b) => played(a) - played(b));
  while (pool.length >= 2) {
    const a = pool.shift()!;
    let bi = 0;
    for (let i = 0; i < pool.length; i++) if (met(a, pool[i]) < met(a, pool[bi])) bi = i;
    const b = pool.splice(bi, 1)[0];
    const homeFirst = s.results.some((x) => x.home === a && x.away === b);
    const [h, aw] = homeFirst ? [b, a] : [a, b];
    const [hg, ag] = simPair(s, h, aw, w, r);
    s.results.push({ w, home: h, away: aw, hg, ag });
  }
}

export interface TableRow { team: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }

export function table(s: Save): TableRow[] {
  const rows: Record<string, TableRow> = {};
  for (const t of divisionOf(s).teams) {
    const name = t === WAYSIDE ? s.team : t;
    rows[name] = { team: name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }
  for (const x of s.results) {
    const h = rows[x.home];
    const a = rows[x.away];
    if (!h || !a) continue;
    h.p++; a.p++;
    h.gf += x.hg; h.ga += x.ag; a.gf += x.ag; a.ga += x.hg;
    if (x.hg > x.ag) { h.w++; a.l++; h.pts += 3; }
    else if (x.hg < x.ag) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  return Object.values(rows).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.team.localeCompare(b.team));
}

// ---------- Season set-up ----------

export function divisionOf(s: Save): Division {
  return DIVISIONS.find((d) => d.name === s.division)!;
}

/**
 * Our fixtures: every other team home and away, one game a week.
 * Where DDSL has a real Wayside fixture on one of our Sundays, that game goes on that Sunday.
 */
function buildSchedule(s: Save): Fixture[] {
  const div = divisionOf(s);
  const r = rng(s.seed + 5);
  const opps = shuffle(div.teams.filter((t) => t !== WAYSIDE), r);
  const first = opps.map((opp, i) => ({ opp, home: i % 2 === 0 }));
  const second = opps.map((opp, i) => ({ opp, home: i % 2 !== 0 }));
  const list = [...first, ...second].map((f, w) => ({ ...f, w, real: false }));

  const wi = div.teams.indexOf(WAYSIDE);
  for (const [h, a, when] of div.fx) {
    if (h !== wi && a !== wi) continue;
    const date = fixtureDate(when);
    if (!date) continue;
    const w = daysBetween(s.startMonday, date);
    if (w < 0 || w % 7 !== 6) continue; // only real Sundays inside our season
    const week = (w - 6) / 7;
    if (week >= list.length) continue;
    const opp = div.teams[h === wi ? a : h];
    const home = h === wi;
    const at = list.findIndex((f) => f.opp === opp && f.home === home && !f.real);
    if (at < 0) continue;
    const tmp = list[week];
    list[week] = { ...list[at], w: week, real: true };
    list[at] = { ...tmp, w: at };
  }
  return list;
}

function buildCup(s: Save): CupRound[] {
  const r = rng(s.seed + 77);
  const pool = Array.from(new Set(DIVISIONS.flatMap((d) => d.teams))).filter((t) => t !== WAYSIDE);
  const field = [s.team, ...shuffle(pool, r).slice(0, 15)];
  const names = ['Cup round 1', 'Cup quarter-final', 'Cup semi-final', 'Cup final'];
  const rounds: CupRound[] = names.map((name, k) => ({ w: Math.max(1, Math.floor((s.weeks * (k + 1)) / 5)), name, ties: [] }));
  const draw = shuffle(field, r);
  for (let i = 0; i < draw.length; i += 2) rounds[0].ties.push({ a: draw[i], b: draw[i + 1] });
  return rounds;
}

export function newSave(opts: { team: string; division: string; today: string; players: { id: string; first_name: string; positions: string[] }[]; season?: number; carry?: Save }): Save {
  const div = DIVISIONS.find((d) => d.name === opts.division)!;
  const s: Save = {
    v: 1,
    team: opts.team,
    division: opts.division,
    season: opts.season || 1,
    seed: Math.floor(Math.random() * 1e9),
    startMonday: mondayOf(opts.today),
    weeks: 2 * (div.teams.length - 1),
    schedule: [],
    results: [],
    players: {},
    lineup: {},
    mastery: opts.carry?.mastery || {},
    log: {},
    cup: { rounds: [], out: false, won: false },
    oppBoost: opts.carry ? opts.carry.oppBoost + 2 : 0,
    cur: 0,
    honours: opts.carry
      ? [...(opts.carry.honours || []), { season: opts.carry.season, pos: table(opts.carry).findIndex((r) => r.team === opts.carry!.team) + 1, cup: opts.carry.cup.won }]
      : [],
  };
  for (const p of opts.players) {
    const old = opts.carry?.players[p.id];
    s.players[p.id] = { id: p.id, name: p.first_name, positions: p.positions || [], s: old ? { ...old.s } : freshStats(), goals: 0, apps: 0 };
  }
  s.schedule = buildSchedule(s);
  s.cup.rounds = buildCup(s);
  s.lineup = autoLineup(s);
  return s;
}

/** Keep stats for kids already in the save, add new ones at the start level, drop ones who left. */
export function syncSquad(s: Save, players: { id: string; first_name: string; positions: string[] }[]) {
  const next: Record<string, GamePlayer> = {};
  for (const p of players) {
    const old = s.players[p.id];
    next[p.id] = old ? { ...old, name: p.first_name, positions: p.positions || [] } : { id: p.id, name: p.first_name, positions: p.positions || [], s: freshStats(), goals: 0, apps: 0 };
  }
  s.players = next;
  for (const slot of Object.keys(s.lineup) as Slot[]) if (!next[s.lineup[slot]!]) delete s.lineup[slot];
}

/** Main positions first, then second positions, then anyone. */
export function autoLineup(s: Save): Lineup {
  const lineup: Lineup = {};
  const used = new Set<string>();
  const all = Object.values(s.players).sort((a, b) => a.name.localeCompare(b.name));
  for (const pass of [0, 1]) {
    for (const { id: slot } of SLOTS) {
      if (lineup[slot]) continue;
      const p = all.find((x) => !used.has(x.id) && x.positions[pass] === slot);
      if (p) { lineup[slot] = p.id; used.add(p.id); }
    }
  }
  for (const { id: slot } of SLOTS) {
    if (lineup[slot]) continue;
    const p = all.find((x) => !used.has(x.id));
    if (p) { lineup[slot] = p.id; used.add(p.id); }
  }
  return lineup;
}

// ---------- Training ----------

export interface PlanDrill { day: string; drill_id: string; title: string; game_phase: string; equipment: string[]; thumbnail_url: string | null }
export interface LibDrill { drill_id: string; title: string; game_phase: string; equipment: string[] }

export const DRILLS_PER_SESSION = 3;
const GAIN = 0.32; // per stat, per drill, for the whole squad
const INDIVIDUAL = 0.25; // per session, on each player's own focus stat
const REPEAT = 0.6; // a drill run again straight after loses some effect

/** Better players improve more slowly, like real life. */
function grow(p: GamePlayer, key: StatKey, g: number, gains: Record<string, Partial<Stats>>) {
  const before = p.s[key];
  const slow = Math.max(0.3, 1 - (before - START_STAT) / 16);
  p.s[key] = Math.min(MAX_STAT, before + g * slow);
  const got = p.s[key] - before;
  if (got > 0) (gains[p.id] ||= {})[key] = ((gains[p.id] || {})[key] || 0) + got;
}

/** Run a session: the chosen drills train the whole squad; each player also works on their own focus. */
export function runSession(s: Save, drills: LibDrill[]): SessionResult {
  const gains: Record<string, Partial<Stats>> = {};
  const last = new Set(s.lastDrills || []);
  for (const d of drills.slice(0, DRILLS_PER_SESSION)) {
    const mult = last.has(d.drill_id) ? REPEAT : 1;
    for (const key of PHASE_STATS[d.game_phase] || ['fitness']) {
      for (const p of Object.values(s.players)) grow(p, key, GAIN * mult, gains);
    }
  }
  for (const p of Object.values(s.players)) if (p.focus) grow(p, p.focus, INDIVIDUAL, gains);
  s.lastDrills = drills.map((d) => d.drill_id);
  s.sessions = (s.sessions || 0) + 1;
  return {
    status: 'done',
    focus: [],
    answers: [],
    drills: drills.map((d) => ({ drillId: d.drill_id, title: d.title, phase: d.game_phase, repeat: last.has(d.drill_id) })),
    gains,
    mishap: trainingMishap(s),
  };
}

// ---------- A bit of fun ----------

/** The player who's been in the fewest jokes so far (ties broken by `r`). Counts them in. */
export function jokePlayer(s: Save, ids: string[], r: () => number): string | undefined {
  if (!ids.length) return undefined;
  const jokes = (s.jokes ||= {});
  const least = Math.min(...ids.map((id) => jokes[id] || 0));
  const pool = ids.filter((id) => (jokes[id] || 0) === least);
  const id = pool[Math.floor(r() * pool.length)];
  jokes[id] = (jokes[id] || 0) + 1;
  return id;
}

const MISHAPS = [
  '{n} was late: the car got stuck behind a tractor.',
  '{n} missed the warm-up looking for the other boot.',
  '{n} sneaked off during the water break to finish a bag of jellies behind the goal.',
  '{n} turned up in school shoes. Again.',
  '{n} spent the water break trying to do keepie-uppies with an orange.',
  '{n} brought sweets for everyone. Morale is sky high.',
  '{n} arrived ten minutes late holding a 99 with a flake.',
  '{n} forgot shin guards and used two copybooks instead.',
  '{n} asked if training could be cancelled because of “a bit of wind”.',
  '{n} did the whole warm-up with a jersey on backwards.',
  '{n} was late because the dog ate a football sock.',
  '{n} told everyone a cousin plays for Liverpool. Nobody believes it.',
  '{n} tried to take a penalty with a crisp packet still in hand.',
  '{n} got the cones out, then sat on one.',
];

/** About one session in three has something funny happen. Just for laughs. */
function trainingMishap(s: Save): string | undefined {
  const r = rng(hash(`${s.seed}:mishap:${s.sessions || 0}`));
  if (r() > 0.36) return undefined;
  const id = jokePlayer(s, Object.keys(s.players), r);
  if (!id) return undefined;
  // don't repeat any of the last few lines
  const recent = (s.recentMishaps ||= []);
  const fresh = MISHAPS.map((_, i) => i).filter((i) => !recent.includes(i));
  const i = fresh[Math.floor(r() * fresh.length)];
  s.recentMishaps = [...recent, i].slice(-6);
  return MISHAPS[i].replace('{n}', s.players[id].name);
}

// ---------- The week ----------

export function weekState(s: Save, w: number): WeekState {
  return (s.log[w] ||= {});
}

export function cupRoundIn(s: Save, w: number) {
  return s.cup.rounds.findIndex((r) => r.w === w);
}

/** Our unplayed cup tie this week, if it's a cup week and we're still in. */
export function ourCupTie(s: Save, w: number): CupTie | undefined {
  const k = cupRoundIn(s, w);
  if (k < 0 || s.cup.out) return undefined;
  const round = s.cup.rounds[k];
  return round.ties.find((t) => !t.winner && (t.a === s.team || t.b === s.team));
}

/** Finish a cup round: our tie from `ours` (if we played one), everyone else simulated, then the next draw. */
export function recordCup(s: Save, w: number, ours: MatchResult | null) {
  const k = cupRoundIn(s, w);
  if (k < 0) return;
  const round = s.cup.rounds[k];
  if (!round.ties.length || round.ties.every((t) => t.winner)) return;
  const r = rng(s.seed + w * 313 + 7);
  for (const t of round.ties) {
    if (t.winner) continue;
    if ((t.a === s.team || t.b === s.team) && ours) {
      t.ga = t.a === s.team ? ours.gf : ours.ga;
      t.gb = t.a === s.team ? ours.ga : ours.gf;
      if (ours.pens) t.pens = t.a === s.team ? ours.pens : [ours.pens[1], ours.pens[0]];
    } else {
      const [ga, gb] = simPair(s, t.a, t.b, w, r);
      t.ga = ga;
      t.gb = gb;
      if (ga === gb) t.pens = r() < 0.5 ? [4, 3] : [3, 4];
    }
    t.winner = t.ga! > t.gb! || (t.ga === t.gb && t.pens![0] > t.pens![1]) ? t.a : t.b;
  }
  const winners = round.ties.map((t) => t.winner!);
  if (!winners.includes(s.team)) s.cup.out = true;
  if (k + 1 < s.cup.rounds.length) {
    const next = s.cup.rounds[k + 1];
    const draw = shuffle(winners, r);
    next.ties = [];
    for (let i = 0; i < draw.length; i += 2) next.ties.push({ a: draw[i], b: draw[i + 1] });
  } else if (winners[0] === s.team) {
    s.cup.won = true;
  }
}

export function credit(s: Save, m: MatchResult, played?: string[]) {
  for (const id of played || (SLOTS.map((x) => s.lineup[x.id]).filter(Boolean) as string[])) if (s.players[id]) s.players[id].apps++;
  for (const id of m.scorers) if (s.players[id]) s.players[id].goals++;
}

/** Missed training is marked when Sunday's match starts. */
export function closeTraining(s: Save, w: number) {
  const ws = weekState(s, w);
  for (const day of ['tuesday', 'thursday'] as const) if (!ws[day]) ws[day] = { status: 'missed', focus: [], answers: [], gains: {} };
}

/** Sunday without watching (used by the balance checks): league game and cup tie, instantly. */
export function playWeek(s: Save, w: number, auto: boolean) {
  const ws = weekState(s, w);
  if (ws.match) return ws;
  if (!s.lineup || Object.keys(s.lineup).length === 0) s.lineup = autoLineup(s);
  closeTraining(s, w);
  const fx = s.schedule.find((f) => f.w === w);
  if (fx) {
    const m = playMatch(s, fx.opp, fx.home, w, s.seed + w * 53 + 1, auto);
    ws.match = m;
    credit(s, m);
    recordLeagueWeek(s, w, m);
  }
  const tie = ourCupTie(s, w);
  if (tie) {
    const m = playMatch(s, tie.a === s.team ? tie.b : tie.a, tie.a === s.team, w, s.seed + w * 71 + 3, auto, true);
    ws.cup = m;
    credit(s, m);
    recordCup(s, w, m);
  } else recordCup(s, w, null);
  return ws;
}

export function seasonOver(s: Save) {
  return s.schedule.every((f) => s.log[f.w]?.match);
}

/** What the team leaderboard shows for this save. */
export function summary(s: Save) {
  const t = table(s);
  const i = t.findIndex((r) => r.team === s.team);
  const me = t[i];
  const done = seasonOver(s);
  const past = s.honours || [];
  return {
    season: s.season,
    played: me ? me.p : 0,
    pts: me ? me.pts : 0,
    pos: me && me.p > 0 ? i + 1 : null,
    gd: me ? me.gf - me.ga : 0,
    titles: past.filter((h) => h.pos === 1).length + (done && i === 0 ? 1 : 0),
    cups: past.filter((h) => h.cup).length + (s.cup.won ? 1 : 0),
  };
}
