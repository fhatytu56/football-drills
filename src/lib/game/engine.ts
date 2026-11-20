// U10 manager game: the rules. No React, no storage — just plain data in, plain data out,
// so it can be checked with a script.

import { DIVISIONS, WAYSIDE, fixtureDate, type Division } from './ddsl';

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
}

export interface Question {
  kind: 'day' | 'phase' | 'kit';
  drillId: string;
  prompt: string;
  options: string[];
  answer: number; // index into options
}

export interface SessionResult {
  status: 'done' | 'missed' | 'empty';
  focus: string[]; // player ids given extra coaching
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

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(arr: T[], r: () => number): T[] {
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

/** Which game week today is in (can be past the end of the season). */
export function weekOf(s: Save, today: string) {
  return Math.floor(daysBetween(s.startMonday, today) / 7);
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

/** Playing someone where the coaches haven't put them costs a little. Anyone can go in goal. */
export function fits(p: GamePlayer, slot: Slot) {
  return slot === 'gk' || p.positions.length === 0 || p.positions.includes(slot);
}

const EMPTY: Stats = { passing: 3, dribbling: 3, shooting: 3, tackling: 3, positioning: 3, keeping: 3, fitness: 3 };

export function teamStrength(s: Save, lineup: Lineup) {
  let att = 0;
  let def = 0;
  let pas = 0;
  let fit = 0;
  for (const { id: slot } of SLOTS) {
    const p = lineup[slot] ? s.players[lineup[slot]!] : undefined;
    const st = p ? p.s : EMPTY;
    const k = p && !fits(p, slot) ? 0.85 : 1;
    att += ATT_WEIGHT[slot] * attOf(slot, st) * k;
    def += DEF_WEIGHT[slot] * defOf(slot, st) * k;
    pas += st.passing / 7;
    fit += st.fitness / 7;
  }
  const gkP = lineup.gk ? s.players[lineup.gk] : undefined;
  const keep = gkP ? gkP.s.keeping : EMPTY.keeping;
  const fitK = 0.92 + 0.16 * (fit / MAX_STAT);
  return { att: att * fitK, def: (0.65 * def + 0.35 * keep) * fitK, pas, keep };
}

// ---------- Matches ----------

const GOALS = 2.6; // average goals per team when evenly matched (7-a-side, 50 min)

function lambda(att: number, def: number, home: boolean) {
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

const DAY_WORD: Record<string, string> = { tuesday: 'Tuesday', thursday: 'Thursday' };

/** One question per drill. Same questions every time the session is opened that week. */
export function questionsFor(s: Save, w: number, day: 'tuesday' | 'thursday', plan: PlanDrill[], library: LibDrill[]): Question[] {
  const drills = plan.filter((d) => d.day === day);
  const dayTitles = new Set(drills.map((d) => d.title));
  return drills.map((d, i) => {
    const r = rng(s.seed + w * 131 + (day === 'tuesday' ? 1 : 2) * 17 + i);
    const kinds: Question['kind'][] = [];
    const otherTitles = Array.from(new Set(library.map((x) => x.title).filter((t) => !dayTitles.has(t))));
    if (otherTitles.length >= 2) kinds.push('day');
    kinds.push('phase');
    const otherKit = Array.from(new Set(library.flatMap((x) => x.equipment))).filter((e) => !d.equipment.includes(e));
    if (d.equipment.length && otherKit.length >= 2) kinds.push('kit');
    const kind = kinds[(w + i) % kinds.length];

    let prompt = '';
    let right = '';
    let wrong: string[] = [];
    if (kind === 'day') {
      prompt = `Which of these did we do on ${DAY_WORD[day]}?`;
      right = d.title;
      wrong = shuffle(otherTitles, r).slice(0, 2);
    } else if (kind === 'kit') {
      prompt = `What do you need for “${d.title}”?`;
      right = d.equipment[Math.floor(r() * d.equipment.length)];
      wrong = shuffle(otherKit, r).slice(0, 2);
    } else {
      prompt = `What is “${d.title}” mainly working on?`;
      right = PHASE_LABEL[d.game_phase] || d.game_phase;
      wrong = shuffle(Object.keys(PHASE_LABEL).filter((p) => p !== d.game_phase && PHASE_STATS[p][0] !== PHASE_STATS[d.game_phase]?.[0]), r)
        .slice(0, 2)
        .map((p) => PHASE_LABEL[p]);
    }
    const options = shuffle([right, ...wrong], r);
    return { kind, drillId: d.drill_id, prompt, options, answer: options.indexOf(right) };
  });
}

const GAIN = 0.2; // per stat, per drill, for the whole squad
const FOCUS = 2; // extra coaching doubles it
const WRONG = 0.35; // a wrong answer still counts a bit

/** Apply a finished session: stat gains for the squad, bigger for the focus players. */
export function runSession(s: Save, plan: PlanDrill[], qs: Question[], picks: number[], focus: string[]): SessionResult {
  const gains: Record<string, Partial<Stats>> = {};
  const answers: SessionResult['answers'] = [];
  qs.forEach((q, i) => {
    const d = plan.find((x) => x.drill_id === q.drillId)!;
    const correct = picks[i] === q.answer;
    const m = s.mastery[q.drillId] || 0;
    const mult = (correct ? 1 + 0.1 * Math.min(m, 5) : WRONG);
    if (correct) s.mastery[q.drillId] = m + 1;
    answers.push({ drillId: q.drillId, title: d.title, phase: d.game_phase, correct, picked: q.options[picks[i]] ?? '', right: q.options[q.answer], prompt: q.prompt });
    for (const key of PHASE_STATS[d.game_phase] || ['fitness']) {
      for (const p of Object.values(s.players)) {
        const g = GAIN * mult * (focus.includes(p.id) ? FOCUS : 1);
        const before = p.s[key];
        p.s[key] = Math.min(MAX_STAT, before + g);
        const got = p.s[key] - before;
        if (got > 0) (gains[p.id] ||= {})[key] = ((gains[p.id] || {})[key] || 0) + got;
      }
    }
  });
  return { status: 'done', focus, answers, gains };
}

// ---------- The week ----------

export function weekState(s: Save, w: number): WeekState {
  return (s.log[w] ||= {});
}

export function cupRoundIn(s: Save, w: number) {
  return s.cup.rounds.findIndex((r) => r.w === w);
}

/** Our cup tie this week (if we're still in), and play everyone else's ties in that round. */
export function playCupRound(s: Save, w: number, auto: boolean): MatchResult | null {
  const k = cupRoundIn(s, w);
  if (k < 0) return null;
  const round = s.cup.rounds[k];
  if (!round.ties.length || round.ties.every((t) => t.winner)) return null;
  const r = rng(s.seed + w * 313 + 7);
  let ours: MatchResult | null = null;
  for (const t of round.ties) {
    if (t.a === s.team || t.b === s.team) {
      const opp = t.a === s.team ? t.b : t.a;
      const m = playMatch(s, opp, t.a === s.team, w, s.seed + w * 71 + 3, auto, true);
      ours = m;
      t.ga = t.a === s.team ? m.gf : m.ga;
      t.gb = t.a === s.team ? m.ga : m.gf;
      if (m.pens) t.pens = t.a === s.team ? m.pens : [m.pens[1], m.pens[0]];
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
  return ours;
}

function credit(s: Save, m: MatchResult) {
  for (const id of SLOTS.map((x) => s.lineup[x.id]).filter(Boolean) as string[]) if (s.players[id]) s.players[id].apps++;
  for (const id of m.scorers) if (s.players[id]) s.players[id].goals++;
}

/** Sunday: league game (and the cup tie, if it's a cup week). */
export function playWeek(s: Save, w: number, auto: boolean) {
  const ws = weekState(s, w);
  if (ws.match) return ws;
  if (!s.lineup || Object.keys(s.lineup).length === 0) s.lineup = autoLineup(s);
  for (const day of ['tuesday', 'thursday'] as const) if (!ws[day]) ws[day] = { status: 'missed', focus: [], answers: [], gains: {} };
  const fx = s.schedule.find((f) => f.w === w);
  if (fx) {
    const m = playMatch(s, fx.opp, fx.home, w, s.seed + w * 53 + 1, auto);
    ws.match = m;
    credit(s, m);
    recordLeagueWeek(s, w, m);
  }
  const cup = playCupRound(s, w, auto);
  if (cup) { ws.cup = cup; credit(s, cup); }
  return ws;
}

/** Catch up: any week that has fully gone by gets played automatically (missed training = no gains). */
export function catchUp(s: Save, today: string) {
  const now = weekOf(s, today);
  const played: number[] = [];
  for (let w = 0; w < Math.min(now, s.weeks); w++) {
    if (!weekState(s, w).match) { playWeek(s, w, true); played.push(w); }
  }
  return played;
}

export function seasonOver(s: Save) {
  return s.schedule.every((f) => s.log[f.w]?.match);
}
