// Watching a match, Championship Manager 99/00 style: one minute at a time, with commentary.
// The kid can make rolling subs, change tactics and give a half-time team talk.
// Everything lives in a LiveMatch object that is saved, so closing the app mid-game is fine.

import { shortName } from './ddsl';
import {
  SLOTS, lambda, teamStrength, teamRating, credit, recordLeagueWeek, recordCup, closeTraining, weekState, hash,
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
  kind: 'goal' | 'chance' | 'save' | 'miss' | 'play' | 'sub' | 'whistle' | 'talk';
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
  };
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
  const them = teamRating(s, lm.opp, lm.w) * oppTired;
  return {
    att: us.att * tac.att * lm.morale,
    def: us.def * tac.def * lm.morale,
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
      const drop = (1.6 - 0.05 * p.s.fitness) * (gk ? 0.4 : 1);
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

  if (r < gUs) {
    const id = ourPlayer(s, lm, 'shoot')!;
    const helper = ourPlayer(s, lm, 'pass');
    lm.gf++; lm.shots[0]++; lm.onTarget[0]++; lm.scorers.push(id);
    say('us', 'goal', pick(lm, [
      `GOAL! ${name(s, id)} smashes it in!`,
      `GOAL! ${name(s, id)} slots it past the keeper!`,
      `GOAL! ${helper && helper !== id ? `${name(s, helper)} sets up ${name(s, id)}` : name(s, id)} — and it’s in!`,
      `GOAL! What a finish from ${name(s, id)}!`,
    ]) + ` ${s.team} ${lm.gf}–${lm.ga} ${them}.`);
  } else if (r < gUs + gThem) {
    lm.ga++; lm.shots[1]++; lm.onTarget[1]++;
    const keeper = name(s, lm.onPitch.gk);
    say('them', 'goal', pick(lm, [
      `Goal for ${them}. ${oppPlayer(lm, true)} finds the corner.`,
      `${them} score. ${keeper} had no chance.`,
      `Goal for ${them} — ${oppPlayer(lm)} gets in behind.`,
    ]) + ` ${s.team} ${lm.gf}–${lm.ga} ${them}.`);
  } else if (r < gUs + gThem + gUs * SHOTS_PER_GOAL) {
    const id = ourPlayer(s, lm, 'shoot')!;
    lm.shots[0]++;
    if (rand(lm) < 0.45) {
      lm.onTarget[0]++;
      say('us', 'save', pick(lm, [`${name(s, id)} shoots… saved!`, `${name(s, id)} forces a good save.`, `Great effort from ${name(s, id)}, but the keeper holds it.`]));
    } else {
      say('us', 'miss', pick(lm, [`${name(s, id)} shoots… just wide!`, `${name(s, id)} blazes it over.`, `${name(s, id)} hits the post!`]));
    }
  } else if (r < gUs + gThem + (gUs + gThem) * SHOTS_PER_GOAL) {
    lm.shots[1]++;
    const keeper = name(s, lm.onPitch.gk);
    if (rand(lm) < 0.45) {
      lm.onTarget[1]++;
      say('them', 'save', pick(lm, [`${them} shoot — great save from ${keeper}!`, `${keeper} dives to stop ${oppPlayer(lm)}.`, `${keeper} gets down well to save.`]));
    } else {
      say('them', 'miss', pick(lm, [`${oppPlayer(lm, true)} shoots wide for ${them}.`, `${them} go close but it’s off target.`]));
    }
  } else if (rand(lm) < 0.35) {
    if (ours) {
      const a = ourPlayer(s, lm, 'pass');
      say('us', 'play', pick(lm, [`${name(s, a)} keeps it moving.`, `Nice pass from ${name(s, a)}.`, `${name(s, a)} switches the play.`, `${s.team} building from the back.`]));
    } else {
      const t = ourPlayer(s, lm, 'tackle');
      say('them', 'play', pick(lm, [`${them} on the ball.`, `Good tackle from ${name(s, t)}.`, `${name(s, t)} wins it back.`, `${them} pressing high.`]));
    }
  }

  tire(s, lm);

  if (m === HALF) {
    say('none', 'whistle', `Half-time: ${s.team} ${lm.gf}–${lm.ga} ${them}.`);
    for (const id of Object.keys(lm.energy)) lm.energy[id] = Math.min(100, lm.energy[id] + 10);
  }
  if (m === FULL) finishWhistle(s, lm);
}

function finishWhistle(s: Save, lm: LiveMatch) {
  const them = shortName(lm.opp);
  lm.events.push({ m: FULL, side: 'none', kind: 'whistle', text: `Full time: ${s.team} ${lm.gf}–${lm.ga} ${them}.` });
  if (lm.kind === 'cup' && lm.gf === lm.ga) {
    const keep = s.players[lm.onPitch.gk || '']?.s.keeping || 5;
    const pUs = 0.68 + 0.006 * (strengths(s, lm).att - strengths(s, lm).them);
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
  { id: 'praise', label: 'Well done, keep going' },
  { id: 'calm', label: 'Stay calm, stick to the plan' },
  { id: 'fire', label: 'Come on! More effort!' },
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
  const text = effect > 0.03 ? 'The players look fired up for the second half!'
    : effect > 0 ? 'The players nod. They’re ready.'
    : 'Hmm. Some of the players look fed up.';
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
