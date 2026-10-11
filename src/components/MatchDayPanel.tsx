'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Minus, Plus, Timer, AlertTriangle, Smartphone, Flag, ChevronLeft, Check, RotateCcw, X } from 'lucide-react';
import { POSITIONS, type AgeGroup, type Position } from '@/lib/groups';
import { hhmm, matchTitle, shortDate, todayInIreland } from '@/lib/matches';
import { SPOTS } from '@/components/PositionPitch';
import {
  autoLineup,
  endEarly,
  endPeriod,
  fmtClock,
  fmtCountdown,
  formatFor,
  keeperCandidates,
  kickOff,
  matchMs,
  minutesPlayedMs,
  nextSubInMs,
  pause,
  periodLabel,
  periodMs,
  periodOver,
  restart,
  resume,
  snooze,
  startNextPeriod,
  subDue,
  swap,
  suggestPlan,
  plannedMinutes,
  planTimes,
  nextPlanned,
  type MatchDayState,
  type PlannedSub,
  type Spot,
} from '@/lib/matchday';

interface Team {
  id: string;
  name: string;
}
interface Player {
  id: string;
  team_id: string | null;
  first_name: string;
  positions: Position[];
}
interface Match {
  id: string;
  team_id: string;
  match_date: string;
  kickoff: string;
  opponent: string;
  opponent_2: string | null;
  kickoff_2: string | null;
  home_away: 'home' | 'away';
}

interface SavedPlan {
  here: string[];
  lineup: Record<string, string | null>;
  bench: string[];
  sub_gap: number;
  subs: PlannedSub[];
  updated_at: string;
}

const SHORT = Object.fromEntries(POSITIONS.map((p) => [p.id, p.short])) as Record<Position, string>;
const storageKey = (groupId: string) => `matchday:v1:${groupId}`;

function loadSaved(groupId: string): MatchDayState | null {
  try {
    const raw = localStorage.getItem(storageKey(groupId));
    const s = raw ? (JSON.parse(raw) as MatchDayState) : null;
    return s && s.version === 1 ? s : null;
  } catch {
    return null;
  }
}
function save(groupId: string, s: MatchDayState | null) {
  try {
    if (s) localStorage.setItem(storageKey(groupId), JSON.stringify(s));
    else localStorage.removeItem(storageKey(groupId));
  } catch {
    /* storage blocked: the match still runs, it just won't survive a reload */
  }
}

// ---------- sound + keep-screen-on ----------

function useBeeper() {
  const ctx = useRef<AudioContext | null>(null);
  const unlock = useCallback(() => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      if (!ctx.current) ctx.current = new AC();
      if (ctx.current.state === 'suspended') ctx.current.resume();
      // a silent blip inside the tap, so iPhones allow sound later
      const o = ctx.current.createOscillator();
      const g = ctx.current.createGain();
      g.gain.value = 0.0001;
      o.connect(g).connect(ctx.current.destination);
      o.start();
      o.stop(ctx.current.currentTime + 0.01);
    } catch {
      /* no sound available */
    }
  }, []);
  const beep = useCallback((times = 3) => {
    const c = ctx.current;
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    for (let i = 0; i < times; i++) {
      const t0 = c.currentTime + i * 0.35;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = 1046;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(c.destination);
      o.start(t0);
      o.stop(t0 + 0.26);
    }
    try {
      (window as any).__beeps = ((window as any).__beeps || 0) + 1; // lets tests count alerts
    } catch {}
  }, []);
  return { unlock, beep };
}

type WakeStatus = 'idle' | 'on' | 'unsupported' | 'failed';

function useWakeLock(active: boolean) {
  const lock = useRef<any>(null);
  const [status, setStatus] = useState<WakeStatus>('idle');
  const request = useCallback(async () => {
    const wl = (navigator as any).wakeLock;
    if (!wl) {
      setStatus('unsupported');
      return;
    }
    try {
      lock.current = await wl.request('screen');
      setStatus('on');
      lock.current.addEventListener?.('release', () => setStatus((s) => (s === 'on' ? 'idle' : s)));
    } catch {
      setStatus('failed');
    }
  }, []);
  useEffect(() => {
    if (!active) {
      lock.current?.release?.();
      lock.current = null;
      return;
    }
    request();
    const onVis = () => {
      if (document.visibilityState === 'visible') request();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active, request]);
  return status;
}

// ---------- panel ----------

export default function MatchDayPanel({ group }: { group: AgeGroup }) {
  const [state, setState] = useState<MatchDayState | null>(null);
  const [restored, setRestored] = useState(false);
  const [draft, setDraft] = useState<MatchDayState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { unlock, beep } = useBeeper();

  useEffect(() => {
    setState(loadSaved(group.id));
    setRestored(true);
  }, [group.id]);

  useEffect(() => {
    if (restored) save(group.id, state);
  }, [state, restored, group.id]);

  const live = !!state && (state.phase === 'playing' || state.phase === 'break');
  const wake = useWakeLock(live);

  // Re-render a few times a second; the time itself always comes from Date.now().
  useEffect(() => {
    if (!state || state.phase === 'lineup' || state.phase === 'fulltime') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [state]);

  // Whistle: end of half / game / match.
  useEffect(() => {
    if (state && periodOver(state, now)) {
      setState(endPeriod(state, now));
      beep(4);
    }
  }, [state, now, beep]);

  // Sub due: beep once when it becomes due, then every 30s until the coach acts.
  const lastAlert = useRef<number>(0);
  const due = !!state && subDue(state, now);
  useEffect(() => {
    if (!state) return;
    if (!due) {
      lastAlert.current = 0;
      return;
    }
    const t = matchMs(state, now);
    if (lastAlert.current === 0 || t - lastAlert.current >= 30_000) {
      lastAlert.current = t || 1;
      beep(3);
    }
  }, [due, state, now, beep]);

  const act = (fn: (s: MatchDayState, now: number) => MatchDayState) => {
    unlock();
    const t = Date.now();
    setNow(t);
    setState((s) => (s ? fn(s, t) : s));
  };

  if (!restored) return null;
  if (!state)
    return (
      <Setup
        group={group}
        draft={draft}
        onReady={(s) => {
          setDraft(null);
          setState(s);
        }}
        onDiscardDraft={() => setDraft(null)}
      />
    );

  return (
    <Game
      state={state}
      now={now}
      due={due}
      wake={wake}
      act={act}
      onKickOff={() => {
        unlock();
        act(kickOff);
      }}
      onBack={() => {
        // Back to who's-here, keeping the match, players, sub gap, line-up and plan.
        setDraft(state);
        setState(null);
      }}
      onRestart={() => {
        setNow(Date.now());
        setState((s) => (s ? restart(s) : s));
      }}
      onNewMatch={() => setState(null)}
      group={group}
    />
  );
}

// ---------- step 1: choose match, who's here, sub gap ----------

function Setup({
  group,
  draft,
  onReady,
  onDiscardDraft,
}: {
  group: AgeGroup;
  draft: MatchDayState | null;
  onReady: (s: MatchDayState) => void;
  onDiscardDraft: () => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [answers, setAnswers] = useState<{ match_id: string; player_id: string; answer: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [choice, setChoice] = useState<{ matchId: string | null; teamId: string } | null>(
    draft?.teamId ? { matchId: draft.matchId, teamId: draft.teamId } : null
  );
  const [here, setHere] = useState<string[]>(draft ? draft.players.map((p) => p.id) : []);
  const [gap, setGap] = useState(draft?.subGapMins ?? 5);
  const [savedPlan, setSavedPlan] = useState<SavedPlan | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/squad?group=${group.id}`).then((r) => r.json()),
      fetch(`/api/matches?group=${group.id}`).then((r) => r.json()),
    ])
      .then(([sq, m]) => {
        if (sq.error) throw new Error(sq.error);
        setTeams(sq.teams || []);
        setPlayers(sq.players || []);
        setMatches(m.matches || []);
        setAnswers(m.answers || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [group.id]);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name || '?';
  const today = todayInIreland();
  const upcoming = matches.filter((m) => m.match_date >= today).slice(0, 6);

  const pick = async (matchId: string | null, teamId: string) => {
    setChoice({ matchId, teamId });
    setSavedPlan(null);
    const squad = players.filter((p) => p.team_id === teamId);
    const yes = matchId
      ? squad.filter((p) => answers.some((a) => a.match_id === matchId && a.player_id === p.id && a.answer === 'yes'))
      : [];
    // No answers yet (or a quick game): tick everyone, the coach unticks who's missing.
    setHere((yes.length ? yes : squad).map((p) => p.id));
    if (!matchId) return;
    // A coach may already have made a sub plan for this match (maybe on another phone).
    try {
      const r = await fetch(`/api/plans?match_id=${matchId}`);
      const data = await r.json();
      if (r.ok && data.plan) {
        const ids = new Set(squad.map((p) => p.id));
        setSavedPlan(data.plan);
        setHere((data.plan.here as string[]).filter((id) => ids.has(id)));
        setGap(data.plan.sub_gap);
      }
    } catch {
      /* no saved plan: carry on */
    }
  };

  if (loading) return <p className="text-center text-slate-500 py-10">Loading...</p>;

  const match = choice?.matchId ? matches.find((m) => m.id === choice.matchId) : null;
  const format = formatFor(group, !!match?.opponent_2);
  const squad = choice ? players.filter((p) => p.team_id === choice.teamId) : [];
  const onCount = Math.min(format.spots.length, here.length);
  const benchCount = Math.max(0, here.length - format.spots.length);

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Timer className="w-4 h-4 text-emerald-400" /> {group.label} Match Day
        </h2>
        <p className="text-xs text-slate-300 mt-1">
          {group.aSide}-a-side · {format.halfMins}-min halves
          {group.aSide === 5 ? ' · two games on the day' : ''}. Pick the match, tick who&apos;s here, set how often to sub.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg p-3">
          {error}
        </div>
      )}

      {!choice ? (
        <>
          {teams.length === 0 && (
            <p className="text-center text-slate-400 text-sm py-6">Create a team in Squads first.</p>
          )}
          {upcoming.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <h3 className="px-4 pt-3 pb-2 text-xs font-bold uppercase text-slate-500">Upcoming matches</h3>
              <ul className="divide-y divide-slate-100">
                {upcoming.map((m) => {
                  const yes = answers.filter((a) => a.match_id === m.id && a.answer === 'yes').length;
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => pick(m.id, m.team_id)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex justify-between items-center gap-3"
                      >
                        <span>
                          <span className="block font-bold text-slate-800 text-sm">
                            {matchTitle({ ...m, team: teamName(m.team_id) })}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {shortDate(m.match_date)} · KO {hhmm(m.kickoff)} · {yes} said yes
                          </span>
                        </span>
                        <Play className="w-4 h-4 text-emerald-700 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {teams.length > 0 && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">Quick game (no match set up)</h3>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pick(null, t.id)}
                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-emerald-50"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <header className="px-4 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  {match ? matchTitle({ ...match, team: teamName(match.team_id) }) : `${teamName(choice.teamId)} · quick game`}
                </h3>
                <p className="text-xs text-slate-500">Who&apos;s here? {here.length} ticked · {onCount} on, {benchCount} on the bench</p>
              </div>
              <button
                onClick={() => {
                  setChoice(null);
                  onDiscardDraft();
                }}
                className="text-xs font-bold text-slate-500 flex items-center"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
            </header>
            <ul className="grid grid-cols-2 gap-px bg-slate-100">
              {squad.map((p) => {
                const on = here.includes(p.id);
                return (
                  <li key={p.id} className="bg-white">
                    <label className="flex items-center gap-2 px-4 py-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setHere(on ? here.filter((x) => x !== p.id) : [...here, p.id])}
                        className="w-4 h-4 accent-emerald-700"
                      />
                      <span className={`text-sm font-semibold ${on ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                        {p.first_name}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <label htmlFor="sub-gap" className="block text-xs font-bold uppercase text-slate-500 mb-2">
              Sub every
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="One minute less"
                onClick={() => setGap(Math.max(1, gap - 1))}
                className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                id="sub-gap"
                type="number"
                inputMode="numeric"
                min={1}
                max={format.halfMins}
                value={gap}
                onChange={(e) => setGap(Math.min(format.halfMins, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-16 h-11 text-center text-lg font-black text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <button
                type="button"
                aria-label="One minute more"
                onClick={() => setGap(Math.min(format.halfMins, gap + 1))}
                className="w-11 h-11 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center"
              >
                <Plus className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-slate-600">minutes</span>
            </div>
            {savedPlan && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 mt-3" role="status">
                A coach saved a sub plan for this match ({new Date(savedPlan.updated_at).toLocaleString('en-IE', {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}). It opens on the next step.
              </p>
            )}
            {benchCount === 0 && here.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">Nobody on the bench, so there won&apos;t be any sub alerts.</p>
            )}
          </section>

          <button
            disabled={here.length === 0}
            onClick={() => {
              const chosen = players.filter((p) => here.includes(p.id));
              let { onPitch, bench } = autoLineup(format.spots, chosen, group.usesPositions);
              let plan: PlannedSub[];
              const sameAsDraft =
                !!draft &&
                draft.teamId === choice.teamId &&
                draft.matchId === (match?.id || null) &&
                draft.players.length === chosen.length &&
                chosen.every((p) => draft.players.some((d) => d.id === p.id));
              if (draft && sameAsDraft) {
                // Came back with Back and changed nothing about who's here: keep line-up and plan.
                onPitch = draft.onPitch;
                bench = draft.bench;
                plan =
                  draft.subGapMins === gap
                    ? draft.plan || []
                    : suggestPlan(format, gap, onPitch, bench, chosen, group.usesPositions);
              } else if (savedPlan) {
                // Use the saved line-up for whoever's here; anyone new goes to the bench.
                const hereSet = new Set(chosen.map((p) => p.id));
                const saved: Partial<Record<Spot, string | null>> = {};
                for (const sp of format.spots) {
                  const id = (savedPlan.lineup as Record<string, string | null>)[sp];
                  saved[sp] = id && hereSet.has(id) ? id : null;
                }
                const placed = new Set(Object.values(saved).filter(Boolean) as string[]);
                onPitch = saved;
                bench = chosen.map((p) => p.id).filter((id) => !placed.has(id));
                plan = savedPlan.subs.filter((x) => hereSet.has(x.on) && hereSet.has(x.off));
              } else {
                plan = suggestPlan(format, gap, onPitch, bench, chosen, group.usesPositions);
              }
              onReady({
                version: 1,
                groupId: group.id,
                matchId: match?.id || null,
                teamId: choice.teamId,
                title: match ? matchTitle({ ...match, team: teamName(match.team_id) }) : `${teamName(choice.teamId)} · quick game`,
                format,
                subGapMins: gap,
                players: chosen.map((p) => ({ id: p.id, first_name: p.first_name, positions: p.positions })),
                onPitch,
                bench,
                period: 0,
                periodStartMs: 0,
                bankedMs: 0,
                runningSince: null,
                phase: 'lineup',
                lastSubMs: 0,
                snoozeUntilMs: 0,
                stints: [],
                plan,
                subsMade: 0,
              });
            }}
            className="w-full bg-emerald-800 hover:bg-emerald-900 disabled:opacity-40 text-white text-sm font-bold py-3 rounded-xl"
          >
            Next: starting line-up
          </button>
        </>
      )}
    </div>
  );
}

// ---------- step 2 + 3: line-up and live game ----------

function Game({
  state,
  now,
  due,
  wake,
  act,
  onKickOff,
  onBack,
  onRestart,
  onNewMatch,
  group,
}: {
  state: MatchDayState;
  now: number;
  due: boolean;
  wake: WakeStatus;
  act: (fn: (s: MatchDayState, now: number) => MatchDayState) => void;
  onKickOff: () => void;
  onBack: () => void;
  onRestart: () => void;
  onNewMatch: () => void;
  group: AgeGroup;
}) {
  const [selected, setSelected] = useState<{ playerId?: string; spot?: Spot } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  useEffect(() => {
    if (!resetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setResetOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [resetOpen]);
  const name = (id: string | null | undefined) => state.players.find((p) => p.id === id)?.first_name || '';
  const mins = (id: string) => Math.floor(minutesPlayedMs(state, id, now) / 60_000);
  const running = state.runningSince !== null;
  const keeperMissing = !state.onPitch.gk;
  const gkIdeas = keeperMissing ? keeperCandidates(state.players, state.bench) : [];

  const tap = (item: { playerId?: string; spot?: Spot }) => {
    if (!selected) {
      if (!item.playerId && item.spot && !state.onPitch[item.spot]) {
        setSelected(item); // empty spot: pick who goes there next
        return;
      }
      setSelected(item);
      return;
    }
    const same =
      (selected.playerId && selected.playerId === item.playerId) || (!selected.playerId && selected.spot === item.spot);
    if (!same) act((s, t) => swap(s, selected, item, t));
    setSelected(null);
  };
  const isSel = (item: { playerId?: string; spot?: Spot }) =>
    !!selected &&
    ((selected.playerId && selected.playerId === item.playerId) || (!selected.playerId && !item.playerId && selected.spot === item.spot));

  const benchSorted = [...state.bench].sort((a, b) => mins(a) - mins(b));
  const planned = state.phase === 'playing' ? nextPlanned(state) : null;
  const spotOf = (id: string) => state.format.spots.find((sp) => state.onPitch[sp] === id);
  const periodLeft = state.format.halfMins * 60_000 - periodMs(state, now);

  return (
    <div className="space-y-3">
      {/* keep the screen on */}
      {state.phase !== 'fulltime' && (
        <div
          className={`rounded-xl p-3 text-xs font-semibold flex items-start gap-2 ${
            wake === 'on' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-300'
          }`}
          role="note"
        >
          <Smartphone className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <b>Keep this screen open and your phone unlocked during the match.</b> A locked phone can&apos;t beep for subs
            (the clock stays right).{' '}
            {wake === 'on'
              ? 'Screen will stay on ✓'
              : wake === 'unsupported' || wake === 'failed'
              ? 'This browser can’t keep the screen on by itself — turn off Auto-Lock in your phone’s settings for the match.'
              : 'The screen stays on once you kick off.'}
          </span>
        </div>
      )}

      {/* scoreboard */}
      <div className="bg-slate-900 text-white rounded-xl p-4 shadow-md">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              {state.phase === 'lineup'
                ? 'Starting line-up'
                : state.phase === 'fulltime'
                ? 'Full time'
                : state.phase === 'break'
                ? state.period % 2 === 0
                  ? 'Half-time'
                  : 'Between games'
                : periodLabel(state.format.periods, state.period)}
            </p>
            <p className="text-sm font-bold truncate">{state.title}</p>
          </div>
          {state.phase === 'lineup' && (
            <button onClick={onBack} className="text-[11px] font-bold text-slate-400 hover:text-white shrink-0">
              <span className="flex items-center">
                <ChevronLeft className="w-4 h-4" /> Back
              </span>
            </button>
          )}
        </div>
        <div className="flex items-end justify-between gap-3 mt-2">
          <p className="font-mono font-black text-5xl tabular-nums" aria-label="Clock">
            {fmtClock(state.phase === 'lineup' ? 0 : periodMs(state, now))}
          </p>
          <p className="text-xs text-slate-400 pb-2">/ {state.format.halfMins}:00</p>
        </div>
        {state.phase === 'playing' && (
          <div className="flex items-center justify-between gap-2 mt-2 text-xs">
            <span className="text-slate-300" aria-label="Next sub">
              {state.bench.length === 0
                ? 'No subs on the bench'
                : due
                ? 'Sub due now'
                : `Next sub in ${fmtCountdown(Math.min(nextSubInMs(state, now), periodLeft))}`}
            </span>
            <span className="text-slate-400">every {state.subGapMins} min</span>
          </div>
        )}
        {state.phase === 'playing' && planned && !due && (
          <p className="text-xs text-slate-300 mt-1" aria-label="Up next">
            Up next (sub {planned.number}): <b className="text-white">{name(planned.sub.on)}</b> on for{' '}
            <b className="text-white">{name(planned.sub.off)}</b>
          </p>
        )}
        <div className="flex gap-2 mt-3">
          {state.phase === 'lineup' && (
            <button
              onClick={onKickOff}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-3 rounded-lg flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" /> Kick off
            </button>
          )}
          {state.phase === 'playing' && (
            <>
              <button
                onClick={() => act(running ? pause : resume)}
                className={`flex-1 font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 ${
                  running ? 'bg-amber-500 text-slate-900' : 'bg-emerald-500 text-slate-900'
                }`}
              >
                {running ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                {running ? 'Pause' : 'Resume'}
              </button>
              <button
                onClick={() => confirm('End the match now?') && act(endEarly)}
                className="px-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold flex items-center gap-1"
              >
                <Flag className="w-4 h-4" /> End
              </button>
            </>
          )}
          {state.phase === 'break' && (
            <button
              onClick={() => act(startNextPeriod)}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-3 rounded-lg flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" />
              {state.period % 2 === 0 ? 'Start 2nd half' : `Start Game ${Math.floor(state.period / 2) + 2}`}
            </button>
          )}
        </div>
        {/* The way out once the game has started: full width so it's easy to find on a phone. */}
        {(state.phase === 'playing' || state.phase === 'break') && (
          <button
            onClick={() => setResetOpen(true)}
            className="w-full mt-2 h-11 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm font-bold flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        )}
        {state.phase === 'fulltime' && (
          <button
            onClick={onNewMatch}
            className="w-full mt-3 h-11 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-black flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" /> New match
          </button>
        )}
      </div>

      {/* sub alert */}
      {due && (
        <div role="alert" className="bg-amber-400 text-slate-900 rounded-xl p-4 shadow-lg border-2 border-amber-600 animate-pulse">
          <p className="font-black text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> Sub due{planned ? ` · sub ${planned.number}` : ''}
          </p>
          {planned && planned.ok ? (
            <>
              <p className="text-base font-bold mt-1">
                {name(planned.sub.on)} ON for {name(planned.sub.off)}
                {spotOf(planned.sub.off) ? ` (${SHORT[spotOf(planned.sub.off)!]})` : ''}
              </p>
              <p className="text-xs font-semibold mt-1">Or tap different players: who&apos;s coming off, then who&apos;s going on.</p>
            </>
          ) : planned ? (
            <p className="text-sm font-semibold mt-1">
              Plan said {name(planned.sub.on)} on for {name(planned.sub.off)}, but{' '}
              {planned.why === 'is already off' ? name(planned.sub.off) : name(planned.sub.on)} {planned.why}. Tap who&apos;s
              coming off, then who&apos;s going on.
            </p>
          ) : (
            <p className="text-sm font-semibold mt-1">Tap who&apos;s coming off, then who&apos;s going on.</p>
          )}
          <div className="flex gap-2 mt-3">
            {planned && planned.ok && (
              <button
                onClick={() => {
                  setSelected(null);
                  act((st, t) => swap(st, { playerId: planned.sub.off }, { playerId: planned.sub.on }, t));
                }}
                className="bg-slate-900 text-white text-sm font-black px-4 py-2 rounded-lg"
              >
                Done
              </button>
            )}
            <button
              onClick={() => act(snooze)}
              className="bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 text-xs font-bold px-3 py-2 rounded-lg"
            >
              Not now (1 min)
            </button>
          </div>
        </div>
      )}

      {state.phase === 'lineup' && (
        <p className="text-xs text-slate-500 text-center">
          Tap two players to swap them. Tap a player, then a bench player, to change who starts.
        </p>
      )}
      {keeperMissing && state.phase !== 'fulltime' && (
        <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
          No keeper yet. Tap the GK spot, then who goes in goal
          {gkIdeas.length ? ` (GK in their positions: ${gkIdeas.map(name).join(', ')})` : ''}.
        </p>
      )}

      {/* pitch */}
      {state.phase !== 'fulltime' && (
        <div className="relative mx-auto w-full max-w-[360px] aspect-[4/5] rounded-2xl bg-emerald-600 border-2 border-emerald-700 overflow-hidden select-none" aria-label="Pitch">
          <div className="absolute inset-2 border-2 border-white/40 rounded-md" aria-hidden />
          <div className="absolute left-2 right-2 top-1/2 border-t-2 border-white/40" aria-hidden />
          <div className="absolute left-1/2 top-1/2 w-20 h-20 -ml-10 -mt-10 rounded-full border-2 border-white/40" aria-hidden />
          <div className="absolute left-1/2 bottom-2 w-32 h-12 -ml-16 border-2 border-b-0 border-white/40" aria-hidden />
          <div className="absolute left-1/2 top-2 w-32 h-12 -ml-16 border-2 border-t-0 border-white/40" aria-hidden />
          {state.format.spots.map((spot) => {
            const pid = state.onPitch[spot] || null;
            const pos = spotXY(spot, state.format.spots.length);
            const sel = isSel(pid ? { playerId: pid } : { spot });
            return (
              <button
                key={spot}
                onClick={() => tap(pid ? { playerId: pid, spot } : { spot })}
                aria-label={pid ? `${name(pid)} (${SHORT[spot]})` : `Empty ${SHORT[spot]}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              >
                <span
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-[11px] font-black leading-tight px-1 text-center shadow-md border-2 transition ${
                    sel
                      ? 'bg-amber-300 text-slate-900 border-amber-600 ring-4 ring-amber-200'
                      : pid
                      ? 'bg-white text-emerald-900 border-emerald-900'
                      : 'bg-emerald-700/50 text-white border-dashed border-white'
                  }`}
                >
                  {pid ? name(pid).slice(0, 8) : SHORT[spot]}
                </span>
                <span className="mt-0.5 text-[10px] font-bold text-white bg-emerald-900/70 rounded px-1">
                  {SHORT[spot]}
                  {pid && state.phase !== 'lineup' ? ` · ${mins(pid)}′` : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* bench */}
      {state.phase !== 'fulltime' && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
          <h3 className="text-xs font-bold uppercase text-slate-500 mb-2">
            Bench {state.phase !== 'lineup' && <span className="normal-case font-semibold">· fewest minutes first</span>}
          </h3>
          {benchSorted.length === 0 ? (
            <p className="text-xs text-slate-400">Nobody on the bench.</p>
          ) : (
            <div className="flex flex-wrap gap-2" aria-label="Bench">
              {benchSorted.map((pid) => (
                <button
                  key={pid}
                  onClick={() => tap({ playerId: pid })}
                  className={`px-3 py-2 rounded-lg text-sm font-bold border-2 transition ${
                    isSel({ playerId: pid })
                      ? 'bg-amber-300 border-amber-600 text-slate-900'
                      : gkIdeas.includes(pid)
                      ? 'bg-white border-amber-400 text-slate-800'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  {name(pid)}
                  {state.phase !== 'lineup' && <span className="ml-1 text-xs font-semibold text-slate-500">{mins(pid)}′</span>}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {state.phase === 'lineup' && <PlanEditor state={state} act={act} name={name} />}
      {(state.phase === 'playing' || state.phase === 'break') && (state.plan?.length || 0) > 0 && (
        <PlanList state={state} name={name} />
      )}

      {/* full time: minutes */}
      {state.phase === 'fulltime' && (
        <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <h3 className="px-4 pt-3 pb-2 text-xs font-bold uppercase text-slate-500 flex items-center gap-1">
            <Check className="w-4 h-4 text-emerald-600" /> Minutes played
          </h3>
          <ul className="divide-y divide-slate-100">
            {[...state.players]
              .sort((a, b) => minutesPlayedMs(state, b.id, now) - minutesPlayedMs(state, a.id, now))
              .map((p) => (
                <li key={p.id} className="px-4 py-2 flex justify-between text-sm">
                  <span className="font-semibold text-slate-800">{p.first_name}</span>
                  <span className="font-mono text-slate-600">{fmtClock(minutesPlayedMs(state, p.id, now))}</span>
                </li>
              ))}
          </ul>
          <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
            Not saved anywhere — tap New match to clear it from this phone.
          </p>
        </section>
      )}

      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-3" onClick={() => setResetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <h2 id="reset-title" className="text-base font-black text-slate-900">
                Reset
              </h2>
              <button aria-label="Close" onClick={() => setResetOpen(false)} className="w-9 h-9 -mr-2 flex items-center justify-center text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => {
                setResetOpen(false);
                setSelected(null);
                onRestart();
              }}
              className="w-full text-left rounded-xl border-2 border-slate-200 hover:border-emerald-600 p-3"
            >
              <span className="block text-sm font-black text-slate-900">Restart this match</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Keep the starting line-up and sub plan. Clock and minutes go back to 0.
              </span>
            </button>
            <button
              onClick={() => {
                setResetOpen(false);
                onNewMatch();
              }}
              className="w-full text-left rounded-xl border-2 border-slate-200 hover:border-red-500 p-3"
            >
              <span className="block text-sm font-black text-red-700">New match</span>
              <span className="block text-xs text-slate-500 mt-0.5">Clear everything and pick a match again.</span>
            </button>
            <button onClick={() => setResetOpen(false)} className="w-full h-11 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 5-a-side has no CM/ST: spread the two midfielders wider. */
function spotXY(spot: Spot, count: number) {
  if (count === 5 && spot === 'lm') return { x: 28, y: 36 };
  if (count === 5 && spot === 'rm') return { x: 72, y: 36 };
  return SPOTS[spot];
}


// ---------- sub plan: edit before kick-off, follow during the game ----------

function PlanEditor({
  state,
  act,
  name,
}: {
  state: MatchDayState;
  act: (fn: (s: MatchDayState, now: number) => MatchDayState) => void;
  name: (id: string | null | undefined) => string;
}) {
  const plan = state.plan || [];
  const times = planTimes(state.format, state.subGapMins, plan.length);
  const minutes = plannedMinutes(state.format, state.subGapMins, state.onPitch, plan);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const sig = JSON.stringify([state.onPitch, state.bench, plan, state.subGapMins]);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const dirty = savedSig !== sig;
  const byName = [...state.players].sort((a, b) => a.first_name.localeCompare(b.first_name));
  const usePositions = state.format.spots.length === 7;

  const setPlan = (next: PlannedSub[]) => {
    setRegapped(false);
    act((s) => ({ ...s, plan: next }));
  };
  const [regapped, setRegapped] = useState(false);
  // New gap: the number and timing of subs change, so the plan is suggested again for it.
  const setGap = (g: number) => {
    const gap = Math.min(state.format.halfMins, Math.max(1, g));
    if (gap === state.subGapMins) return;
    setRegapped(true);
    act((s) => ({
      ...s,
      subGapMins: gap,
      plan: suggestPlan(s.format, gap, s.onPitch, s.bench, s.players, usePositions),
    }));
  };
  const setRow = (i: number, key: 'on' | 'off', id: string) => setPlan(plan.map((x, j) => (j === i ? { ...x, [key]: id } : x)));

  const save = async () => {
    if (!state.matchId) return;
    setSaveState('saving');
    try {
      const r = await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: state.matchId,
          here: state.players.map((p) => p.id),
          lineup: state.onPitch,
          bench: state.bench,
          sub_gap: state.subGapMins,
          subs: plan,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSavedSig(sig);
      setSaveState('saved');
      setSaveMsg('');
    } catch (e: any) {
      setSaveState('error');
      setSaveMsg(e.message || 'Could not save');
    }
  };

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm" aria-label="Sub plan">
      <div className="px-4 pt-3 pb-3 border-b border-slate-100 flex items-center gap-2">
        <label htmlFor="plan-gap" className="text-xs font-bold uppercase text-slate-500 mr-auto">
          Sub every
        </label>
        <button
          type="button"
          aria-label="Sub gap one minute less"
          onClick={() => setGap(state.subGapMins - 1)}
          className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center"
        >
          <Minus className="w-4 h-4" />
        </button>
        <input
          id="plan-gap"
          type="number"
          inputMode="numeric"
          min={1}
          max={state.format.halfMins}
          value={state.subGapMins}
          onChange={(e) => setGap(parseInt(e.target.value) || 1)}
          className="w-14 h-10 text-center text-lg font-black text-slate-900 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <button
          type="button"
          aria-label="Sub gap one minute more"
          onClick={() => setGap(state.subGapMins + 1)}
          className="w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center"
        >
          <Plus className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-slate-600">min</span>
      </div>
      <header className="px-4 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Sub plan</h3>
          <p className="text-xs text-slate-500">
            {plan.length} {plan.length === 1 ? 'sub' : 'subs'}. Change any pair.
          </p>
          {regapped && <p className="text-[11px] text-emerald-700 font-semibold">Re-planned for every {state.subGapMins} min.</p>}
        </div>
        <button
          onClick={() =>
            setPlan(suggestPlan(state.format, state.subGapMins, state.onPitch, state.bench, state.players, usePositions))
          }
          className="text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-lg shrink-0"
        >
          Suggest again
        </button>
      </header>

      {plan.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-400">No subs planned{state.bench.length ? '' : ' — nobody on the bench'}.</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {plan.map((x, i) => (
            <li key={i} className="px-3 py-2 flex items-center gap-2 text-sm">
              <span className="w-12 shrink-0 text-[11px] font-bold text-slate-500 leading-tight">
                Sub {i + 1}
                <br />~{times[i]}′
              </span>
              <select
                aria-label={`Sub ${i + 1} on`}
                value={x.on}
                onChange={(e) => setRow(i, 'on', e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 border border-emerald-300 bg-emerald-50 rounded-lg text-sm font-semibold text-emerald-900"
              >
                {byName.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === x.off}>{p.first_name}</option>
                ))}
              </select>
              <span className="text-[11px] font-bold text-slate-400 shrink-0">on for</span>
              <select
                aria-label={`Sub ${i + 1} off`}
                value={x.off}
                onChange={(e) => setRow(i, 'off', e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 border border-slate-300 rounded-lg text-sm font-semibold text-slate-800"
              >
                {byName.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === x.on}>{p.first_name}</option>
                ))}
              </select>
              <button
                aria-label={`Remove sub ${i + 1}`}
                onClick={() => setPlan(plan.filter((_, j) => j !== i))}
                className="text-slate-300 hover:text-red-600 px-1 text-lg leading-none"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}

      {plan.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100">
          <p className="text-[11px] font-bold uppercase text-slate-500 mb-1.5">Minutes if the plan runs on time</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Planned minutes">
            {[...state.players]
              .sort((a, b) => (minutes[a.id] || 0) - (minutes[b.id] || 0))
              .map((p) => (
                <span key={p.id} className="text-xs font-semibold bg-slate-100 text-slate-700 rounded-md px-2 py-1">
                  {p.first_name} {Math.round(minutes[p.id] || 0)}′
                </span>
              ))}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-1 flex items-center gap-3">
        {state.bench.length > 0 && (
          <button
            onClick={() => {
              const last = plan[plan.length - 1];
              const on = state.bench[0];
              const off = state.format.spots.map((sp) => state.onPitch[sp]).find((id) => id && id !== on) || '';
              if (on && off) setPlan([...plan, last ? { on: last.off, off: last.on } : { on, off }]);
            }}
            className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg"
          >
            + Add sub
          </button>
        )}
        <div className="flex-1" />
        {state.matchId ? (
          <button
            onClick={save}
            disabled={saveState === 'saving' || (!dirty && saveState === 'saved')}
            className="text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 px-4 py-2 rounded-lg"
          >
            {saveState === 'saving' ? 'Saving…' : !dirty && saveState === 'saved' ? 'Saved ✓' : 'Save plan'}
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">Quick game: plan stays on this phone.</span>
        )}
      </div>
      {state.matchId && (
        <p className={`px-4 pb-3 -mt-2 text-[11px] ${saveState === 'error' ? 'text-red-600 font-semibold' : 'text-slate-400'}`} role="status">
          {saveState === 'error'
            ? saveMsg
            : !dirty && saveState === 'saved'
            ? 'Saved. Other coaches of this group see it when they open this match.'
            : 'Save to share the line-up and plan with the other coaches.'}
        </p>
      )}
    </section>
  );
}

function PlanList({ state, name }: { state: MatchDayState; name: (id: string | null | undefined) => string }) {
  const [open, setOpen] = useState(false);
  const plan = state.plan || [];
  const done = Math.min(state.subsMade || 0, plan.length);
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full px-4 py-2.5 flex justify-between text-xs font-bold text-slate-600"
      >
        <span>Sub plan · {done} of {plan.length} made</span>
        <span>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ol className="divide-y divide-slate-100 border-t border-slate-100">
          {plan.map((x, i) => (
            <li
              key={i}
              className={`px-4 py-1.5 text-xs flex gap-2 ${
                i < done ? 'text-slate-400 line-through' : i === done ? 'font-bold text-slate-900 bg-amber-50' : 'text-slate-600'
              }`}
            >
              <span className="w-12">Sub {i + 1}</span>
              {name(x.on)} on for {name(x.off)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
