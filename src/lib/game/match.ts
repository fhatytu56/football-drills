// Watching a match, Championship Manager 99/00 style: one minute at a time, with commentary.
// The kid can make rolling subs, change tactics and give a half-time team talk.
// Everything lives in a LiveMatch object that is saved, so closing the app mid-game is fine.

import { shortName } from './ddsl';
import { fill, GOAL_US, GOAL_THEM, SAVE_BY_THEM, MISS_US, SAVE_BY_US, MISS_THEM, PLAY_US, PLAY_THEM } from './commentary';
import {
  SLOTS, lambda, teamStrength, teamRating, credit, recordLeagueWeek, recordCup, closeTraining, weekState, hash, jokePlayer,
  spiritFactor, afterResult,
  type Save, type Lineup, type Slot, type MatchResult,
} from './engine';

export type Tactic = 'attack' | 'balanced' | 'defend';
export type Talk = 'praise' | 'calm' | 'fire';

export const HALF = 25; // DDSL U10: two halves of 25 minutes
export const FULL = 50;

export const TACTICS: { id: Tactic; label: string; att: number; def: number }[] = [
  { id: 'attack', label: 'Attack', att: 1.15, def: 0.88 },
  { id: 'balanced', label: 'Balanced', att: 1, def: 1 },
  { id: 'defend', label: 'Defend', att: 0.85, def: 1.15 },
];

export interface LiveEvent {
  m: number;
  side: 'us' | 'them' | 'none';
  kind: 'goal' | 'chance' | 'save' | 'miss' | 'play' | 'sub' | 'whistle' | 'talk' | 'fun';
  text: string;
}

export interface LiveMatch {
  kind: 'league' | 'cup';
  w: number;
  opp: string;
  home: boolean;
  minute: number; // minutes played, 0..FULL
  gf: number;
  ga: number;
  rs: number; // random state, so a reload carries on exactly where it was
  onPitch: Lineup;
  energy: Record<string, number>; // 0..100 for every squad player
  played: string[]; // everyone who got on the pitch (for appearances)
  tactic: Tactic;
  morale: number; // 1 = normal; the half-time talk nudges it
  talk?: Talk;
  events: LiveEvent[];
  scorers: string[];
  shots: [number, number];
  onTarget: [number, number];
  poss: [number, number];
  subs: number;
  pens?: [number, number];
  done: boolean;
  /** Their coach lost the plot: their team plays at `mult` until minute `until`. */
  rattled?: { mult: number; until: number };
  /** Minute their coach blows up this match (0 = he behaves). Set at kick-off. */
  coachAt?: number;
  /** Funny moments so far this match (max 2). */
  fun?: number;
  /** Rested this week: legs tire more slowly. */
  fresh?: boolean;
  /** Commentary lines used recently, so they don't repeat. */
  recent?: string[];
}

// ---------- random with saved state ----------

function rand(lm: LiveMatch) {
  lm.rs = (lm.rs + 0x6d2b79f5) >>> 0;
  let t = lm.rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick<T>(lm: LiveMatch, arr: T[]): T {
  return arr[Math.floor(rand(lm) * arr.length)];
}

/** Pick a commentary line not used in the last eight picks. */
function fresh(lm: LiveMatch, arr: string[]): string {
  const recent = (lm.recent ||= []);
  const options = arr.filter((l) => !recent.includes(l));
  const line = pick(lm, options.length ? options : arr);
  lm.recent = [...recent, line].slice(-8);
  return line;
}

// ---------- set-up ----------

export function startLive(s: Save, kind: 'league' | 'cup', w: number, opp: string, home: boolean): LiveMatch {
  closeTraining(s, w);
  const energy: Record<string, number> = {};
  for (const id of Object.keys(s.players)) energy[id] = 100;
  const onPitch = { ...s.lineup };
  const lm: LiveMatch = {
    kind, w, opp, home,
    minute: 0, gf: 0, ga: 0,
    rs: (s.seed + w * 977 + (kind === 'cup' ? 31 : 7) + hash(opp)) >>> 0,
    onPitch, energy,
    played: SLOTS.map((x) => onPitch[x.id]).filter(Boolean) as string[],
    tactic: s.tactic || 'balanced',
    morale: 1,
    events: [],
    scorers: [], shots: [0, 0], onTarget: [0, 0], poss: [0, 0], subs: 0,
    done: false,
    fun: 0,
  };
  lm.fresh = !!s.fresh;
  s.fresh = false;
  // Roughly 4 matches in 10, their coach loses it at some point.
  lm.coachAt = rand(lm) < 0.4 ? 6 + Math.floor(rand(lm) * 40) : 0;
  const them = shortName(opp);
  lm.events.push({ m: 0, side: 'none', kind: 'whistle', text: `Kick-off! ${home ? `${s.team} v ${them}` : `${them} v ${s.team}`}.` });
  s.live = lm;
  return lm;
}

// ---------- the minute-by-minute engine ----------

const SHOTS_PER_GOAL = 2.6;

function name(s: Save, id?: string) {
  return (id && s.players[id]?.name) || 'Someone';
}

function oppPlayer(lm: LiveMatch, cap = false) {
  return `${cap ? 'Their' : 'their'} number ${2 + Math.floor(rand(lm) * 13)}`;
}

/** Who on our team is most likely to be in the move: weighted by position and stats. */
function ourPlayer(s: Save, lm: LiveMatch, for_: 'shoot' | 'pass' | 'tackle'): string | undefined {
  const w: Record<'shoot' | 'pass' | 'tackle', Record<Slot, number>> = {
    shoot: { gk: 0, lb: 0.4, rb: 0.4, lm: 2, cm: 1.5, rm: 2, st: 4 },
    pass: { gk: 0.3, lb: 1, rb: 1, lm: 1.5, cm: 2, rm: 1.5, st: 1 },
    tackle: { gk: 0, lb: 2, rb: 2, lm: 1, cm: 2, rm: 1, st: 0.5 },
  };
  const key = for_ === 'shoot' ? 'shooting' : for_ === 'pass' ? 'passing' : 'tackling';
  const pool = SLOTS.filter((x) => lm.onPitch[x.id]).map((x) => {
    const id = lm.onPitch[x.id]!;
    return { id, w: w[for_][x.id] * (s.players[id]?.s[key] || 1) };
  });
  const total = pool.reduce((a, b) => a + b.w, 0);
  let t = rand(lm) * total;
  for (const p of pool) { t -= p.w; if (t <= 0) return p.id; }
  return pool[0]?.id;
}

function strengths(s: Save, lm: LiveMatch) {
  const us = teamStrength(s, lm.onPitch, lm.energy);
  const tac = TACTICS.find((t) => t.id === lm.tactic)!;
  const oppTired = 1 - 0.12 * (lm.minute / FULL);
  const rattled = lm.rattled && lm.minute < lm.rattled.until ? lm.rattled.mult : 1;
  const them = teamRating(s, lm.opp, lm.w) * oppTired * rattled;
  const sp = spiritFactor(s);
  return {
    att: us.att * tac.att * lm.morale * sp,
    def: us.def * tac.def * lm.morale * sp,
    pas: us.pas * lm.morale,
    them,
  };
}

/** Per-minute chance of each thing happening, from the current strengths. */
export function rates(s: Save, lm: LiveMatch) {
  const st = strengths(s, lm);
  const gUs = lambda(st.att, st.them, lm.home) / FULL;
  const gThem = lambda(st.them, st.def, !lm.home) / FULL;
  const possUs = Math.min(0.72, Math.max(0.28, 0.5 + 0.4 * (st.pas - st.them) / (st.pas + st.them)));
  return { gUs, gThem, possUs };
}

function tire(s: Save, lm: LiveMatch) {
  const on = new Set(Object.values(lm.onPitch));
  for (const id of Object.keys(lm.energy)) {
    const p = s.players[id];
    if (!p) continue;
    if (on.has(id)) {
      const gk = lm.onPitch.gk === id;
      const drop = (1.6 - 0.05 * p.s.fitness) * (gk ? 0.4 : 1) * (lm.fresh ? 0.75 : 1);
      lm.energy[id] = Math.max(15, lm.energy[id] - drop);
    } else {
      lm.energy[id] = Math.min(100, lm.energy[id] + 1.5);
    }
  }
}

/** Play one minute. */
export function stepLive(s: Save, lm: LiveMatch) {
  if (lm.done || lm.minute >= FULL) return;
  if (lm.minute === HALF && !lm.talk) return; // waiting for the half-time team talk
  const m = ++lm.minute;
  const { gUs, gThem, possUs } = rates(s, lm);
  const them = shortName(lm.opp);
  const ours = rand(lm) < possUs;
  lm.poss[ours ? 0 : 1]++;
  const r = rand(lm);
  const say = (side: LiveEvent['side'], kind: LiveEvent['kind'], text: string) => lm.events.push({ m, side, kind, text });

  const keeper = name(s, lm.onPitch.gk);
  const v = (shooter?: string) => {
    const p = shooter || ourPlayer(s, lm, 'pass');
    let a = ourPlayer(s, lm, 'pass');
    if (a === p) a = ourPlayer(s, lm, 'pass');
    const o = oppPlayer(lm);
    return {
      p: name(s, p), a: a && a !== p ? name(s, a) : 'a teammate', d: name(s, ourPlayer(s, lm, 'tackle')), k: keeper,
      t: them, o, T: o.charAt(0).toUpperCase() + o.slice(1),
    };
  };
  const scoreline = () => ` ${s.team} ${lm.gf}–${lm.ga} ${them}.`;

  if (r < gUs) {
    const id = ourPlayer(s, lm, 'shoot')!;
    lm.gf++; lm.shots[0]++; lm.onTarget[0]++; lm.scorers.push(id);
    say('us', 'goal', fill(fresh(lm, GOAL_US), v(id)) + scoreline());
  } else if (r < gUs + gThem) {
    lm.ga++; lm.shots[1]++; lm.onTarget[1]++;
    say('them', 'goal', fill(fresh(lm, GOAL_THEM), v()) + scoreline());
  } else if (r < gUs + gThem + gUs * SHOTS_PER_GOAL) {
    const id = ourPlayer(s, lm, 'shoot')!;
    lm.shots[0]++;
    if (rand(lm) < 0.45) { lm.onTarget[0]++; say('us', 'save', fill(fresh(lm, SAVE_BY_THEM), v(id))); }
    else say('us', 'miss', fill(fresh(lm, MISS_US), v(id)));
  } else if (r < gUs + gThem + (gUs + gThem) * SHOTS_PER_GOAL) {
    lm.shots[1]++;
    if (rand(lm) < 0.45) { lm.onTarget[1]++; say('them', 'save', fill(fresh(lm, SAVE_BY_US), v())); }
    else say('them', 'miss', fill(fresh(lm, MISS_THEM), v()));
  } else if ((lm.fun || 0) < 2 && rand(lm) < 0.03) {
    funnyMoment(s, lm, say);
  } else if (rand(lm) < 0.4) {
    if (ours) say('us', 'play', fill(fresh(lm, PLAY_US), v()));
    else say('them', 'play', fill(fresh(lm, PLAY_THEM), v(ourPlayer(s, lm, 'tackle'))));
  }

  // the clock and the score, now and then
  const diff = lm.gf - lm.ga;
  if (m === 10 || m === 35) say('none', 'play', `${m === 10 ? 'Ten minutes gone' : 'Ten minutes into the second half'}:${scoreline()}`);
  if (m === FULL - 5) {
    say('none', 'play', diff < 0 ? `Five minutes left. ${s.team} need a goal!` : diff > 0 ? `Five minutes left. Can ${s.team} hold on?` : 'Five minutes left and it’s all square. Who wants it more?');
  }
  if (m === FULL - 1 && diff === 0 && rand(lm) < 0.5) say('none', 'play', 'Last minute! Everyone forward!');

  if (lm.coachAt && m === lm.coachAt) coachLosesIt(lm, them, say);

  tire(s, lm);

  if (m === HALF) {
    say('none', 'whistle', `Half-time: ${s.team} ${lm.gf}–${lm.ga} ${them}.`);
    for (const id of Object.keys(lm.energy)) lm.energy[id] = Math.min(100, lm.energy[id] + 10);
  }
  if (m === FULL) finishWhistle(s, lm);
}

// ---------- a bit of fun ----------

type Say = (side: LiveEvent['side'], kind: LiveEvent['kind'], text: string) => void;

const COACH = [
  '{t}’s coach is roaring at the ref about a throw-in. The ref points him back to his box.',
  '{t}’s coach kicks a water bottle. It lands in his own kit bag.',
  '{t}’s coach has gone purple shouting “MAN ON!”. Nobody is on.',
  'The ref has a word with {t}’s coach. He goes and sulks on the cooler box.',
  '{t}’s coach throws his clipboard. It hits his own sub.',
  '{t}’s coach is demanding a VAR check. There is no VAR. It’s the under-10s.',
  '{t}’s coach yells “REF, ARE YOU BLIND?!”. The ref asks him to repeat it. He doesn’t.',
];

function coachLosesIt(lm: LiveMatch, them: string, say: Say) {
  say('them', 'fun', pick(lm, COACH).replace('{t}', them));
  if (rand(lm) < 0.7) {
    lm.rattled = { mult: 0.88, until: lm.minute + 6 };
    say('none', 'fun', `${them}’s players keep looking over at the sideline. They’ve lost their focus.`);
  } else {
    lm.rattled = { mult: 1.08, until: lm.minute + 4 };
    say('none', 'fun', `Uh oh. That seems to have fired ${them} up.`);
  }
}

const FUNNY = [
  '{n} stops to tie a lace. Play carries on without anyone noticing.',
  '{n} waves to the parents on the sideline mid-run.',
  'A dog runs onto the pitch. {n} tries to tackle it. The dog wins.',
  '{n} asks the ref how long is left. The ref says “ages”.',
  'A parent shouts “SHOOOOT!” from 40 yards out. {n} sensibly passes.',
  '{n} does a celebration practice run. There was no goal.',
  'Somebody’s little brother is in goal for a second. {n} escorts him off.',
  '{n} does a step-over. Then another one. Then falls over. Lovely.',
];

function funnyMoment(s: Save, lm: LiveMatch, say: Say) {
  const ids = SLOTS.map((x) => lm.onPitch[x.id]).filter(Boolean) as string[];
  const id = jokePlayer(s, ids, () => rand(lm));
  if (!id) return;
  lm.fun = (lm.fun || 0) + 1;
  say('us', 'fun', pick(lm, FUNNY).replace('{n}', name(s, id)));
}

function finishWhistle(s: Save, lm: LiveMatch) {
  const them = shortName(lm.opp);
  lm.events.push({ m: FULL, side: 'none', kind: 'whistle', text: `Full time: ${s.team} ${lm.gf}–${lm.ga} ${them}.` });
  if (lm.kind === 'cup' && lm.gf === lm.ga) {
    const keep = s.players[lm.onPitch.gk || '']?.s.keeping || 5;
    const pUs = 0.68 + 0.006 * (strengths(s, lm).att - strengths(s, lm).them) + 0.015 * Math.min(4, s.penPractice || 0);
    const pThem = 0.72 - 0.008 * (keep - 5);
    let a = 0;
    let b = 0;
    for (let i = 0; i < 5; i++) { if (rand(lm) < pUs) a++; if (rand(lm) < pThem) b++; }
    while (a === b) { if (rand(lm) < pUs) a++; if (rand(lm) < pThem) b++; }
    lm.pens = [a, b];
    lm.events.push({ m: FULL, side: 'none', kind: 'whistle', text: a > b ? `Penalties: ${s.team} win ${a}–${b}!` : `Penalties: ${them} win ${b}–${a}.` });
  }
  lm.done = true;
}

// ---------- the kid's decisions ----------

export function subLive(s: Save, lm: LiveMatch, slot: Slot, inId: string) {
  const outId = lm.onPitch[slot];
  if (!s.players[inId] || outId === inId) return;
  const fromSlot = (Object.keys(lm.onPitch) as Slot[]).find((k) => lm.onPitch[k] === inId);
  if (fromSlot) {
    // swapping two players already on the pitch: just a position change
    lm.onPitch[fromSlot] = outId;
    lm.onPitch[slot] = inId;
    if (!outId) delete lm.onPitch[fromSlot];
    lm.events.push({ m: lm.minute, side: 'us', kind: 'sub', text: `${name(s, inId)} moves to ${slot.toUpperCase()}${outId ? `, ${name(s, outId)} to ${fromSlot.toUpperCase()}` : ''}.` });
    return;
  }
  lm.onPitch[slot] = inId;
  if (!lm.played.includes(inId)) lm.played.push(inId);
  lm.subs++;
  lm.events.push({ m: lm.minute, side: 'us', kind: 'sub', text: outId ? `Sub: ${name(s, inId)} on for ${name(s, outId)}.` : `${name(s, inId)} comes on.` });
}

export function setTactic(lm: LiveMatch, t: Tactic) {
  if (lm.tactic === t) return;
  lm.tactic = t;
  lm.events.push({ m: lm.minute, side: 'us', kind: 'sub', text: `Tactics: ${TACTICS.find((x) => x.id === t)!.label.toLowerCase()}.` });
}

export const TALKS: { id: Talk; label: string }[] = [
  { id: 'praise', label: 'Brilliant lads! Keep this up and it’s ice pops after!' },
  { id: 'calm', label: 'Deep breaths. Pass, move, and NOBODY try a bicycle kick.' },
  { id: 'fire', label: 'Right! Who had their Weetabix this morning?! MORE EFFORT!' },
];

/** Half-time team talk. What works depends on the score, like in CM. */
export function teamTalk(s: Save, lm: LiveMatch, talk: Talk) {
  if (lm.talk || lm.minute !== HALF) return;
  lm.talk = talk;
  const diff = lm.gf - lm.ga;
  const table: Record<Talk, [number, number, number]> = {
    //            losing, drawing, winning
    praise: [-0.03, 0.02, 0.03],
    calm: [-0.01, 0.01, 0.05],
    fire: [0.06, 0.04, -0.03],
  };
  const idx = diff < 0 ? 0 : diff === 0 ? 1 : 2;
  const effect = table[talk][idx] + (rand(lm) - 0.5) * 0.02;
  lm.morale = 1 + effect;
  const text = effect > 0.03
    ? pick(lm, ['The players charge out like it’s the last day of school!', 'The lads are buzzing. Someone is doing a war cry.', 'Fired up! One of them is already doing stretches.'])
    : effect > 0
      ? pick(lm, ['A few nods. Someone asks if there are oranges.', 'The players nod. One is still eating a jelly.', 'They seem ready. Mostly.'])
      : pick(lm, ['Hmm. Half the team is staring at a seagull.', 'Some of the players look fed up. One is lying down.', 'Silence. Then someone asks what time it is.']);
  lm.events.push({ m: HALF, side: 'us', kind: 'talk', text });
}

// ---------- finishing ----------

/** Turn a finished LiveMatch into the result, and record it in the league or cup. */
export function completeLive(s: Save): MatchResult | null {
  const lm = s.live;
  if (!lm || !lm.done) return null;
  const total = lm.poss[0] + lm.poss[1] || 1;
  const goals: Record<string, number> = {};
  for (const id of lm.scorers) goals[id] = (goals[id] || 0) + 1;
  const motm = lm.played
    .slice()
    .sort((a, b) => (goals[b] || 0) - (goals[a] || 0) || (s.players[b]?.s.passing || 0) + (lm.energy[b] || 0) / 20 - ((s.players[a]?.s.passing || 0) + (lm.energy[a] || 0) / 20))[0] || null;
  const res: MatchResult = {
    opp: lm.opp, home: lm.home, gf: lm.gf, ga: lm.ga, scorers: lm.scorers, oppScorers: lm.ga,
    possession: Math.round((lm.poss[0] / total) * 100), shots: lm.shots, onTarget: lm.onTarget,
    motm, auto: false, pens: lm.pens,
  };
  const ws = weekState(s, lm.w);
  if (lm.kind === 'league') {
    ws.match = res;
    recordLeagueWeek(s, lm.w, res);
  } else {
    ws.cup = res;
    recordCup(s, lm.w, res);
  }
  credit(s, res, lm.played);
  afterResult(s, res);
  s.live = undefined;
  return res;
}

/** Play a whole match with no changes (balance checks, and "skip to the end"). */
export function autoLive(s: Save, lm: LiveMatch, talk: Talk = 'calm') {
  while (!lm.done) {
    if (lm.minute === HALF && !lm.talk) teamTalk(s, lm, talk);
    stepLive(s, lm);
  }
}
