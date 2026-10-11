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
  changeKeeper,
  keeperDue,
  keepersOf,
  maxGap,
  nextDueMs,
  previewPlan,
  skipWindow,
  suggestSub,
  upgradeSaved,
  type MatchDayState,
  type PlannedSub,
  type SavedSchedule,
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
  /** Sub gap + keepers per half. Older plans: null, or the earlier {firstAt, every, ...} shape. */
  schedule?: (Partial<SavedSchedule> & Record<string, unknown>) | null;
  targets?: Record<string, number> | null;
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
    const saved = loadSaved(group.id);
    setState(saved ? upgradeSaved(saved, Date.now()) : null);
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

  // A sub window opened but nobody needs a change (everyone's on track): move to the next one.
  useEffect(() => {
    if (!state) return;
    const skipped = skipWindow(state, now);
    if (skipped) setState(skipped);
  }, [state, now]);

  // Sub due (or a keeper change once the half has started): beep once, then every 30s until the coach acts.
  const lastAlert = useRef<number>(0);
  const due = !!state && subDue(state, now);
  const keeperChange = !!state && !!keeperDue(state);
  const alerting = due || (keeperChange && state?.phase === 'playing');
  useEffect(() => {
    if (!state) return;
    if (!alerting) {
      lastAlert.current = 0;
      return;
    }
    if (state.phase === 'break') return; // half-time: the whistle just beeped, the banner shows
    const t = matchMs(state, now);
    if (lastAlert.current === 0 || t - lastAlert.current >= 30_000) {
      lastAlert.current = t || 1;
      beep(3);
    }
  }, [alerting, state, now, beep]);

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
        // Back to who's-here, keeping the match, players, sub gap, line-up, keepers and game time.
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
          {group.aSide === 5 ? ' · two games on the day' : ''}. Pick the match and tick who&apos;s here. Subs and game time are set on the next step.
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

          {(savedPlan || (benchCount === 0 && here.length > 0)) && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
            {savedPlan && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2" role="status">
                A coach saved a sub plan for this match ({new Date(savedPlan.updated_at).toLocaleString('en-IE', {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}). It opens on the next step.
              </p>
            )}
            {benchCount === 0 && here.length > 0 && (
              <p className="text-xs text-amber-700">Nobody on the bench, so there won&apos;t be any sub alerts.</p>
            )}
          </section>
          )}

          <button
            disabled={here.length === 0}
            onClick={() => {
              const chosen = players.filter((p) => here.includes(p.id));
              let { onPitch, bench } = autoLineup(format.spots, chosen, group.usesPositions);
              const hereSet = new Set(chosen.map((p) => p.id));
              const keepHere = (t: Record<string, number> | null | undefined) =>
                Object.fromEntries(Object.entries(t || {}).filter(([id, v]) => hereSet.has(id) && typeof v === 'number'));
              const keepIds = (k: unknown) =>
                Array.isArray(k) ? k.map((id) => (typeof id === 'string' && hereSet.has(id) ? id : null)) : [];
              let gap = 5;
              let keepers: (string | null)[] = [];
              let targets: Record<string, number> = {};
              const sameAsDraft =
                !!draft &&
                draft.teamId === choice.teamId &&
                draft.matchId === (match?.id || null) &&
                draft.players.length === chosen.length &&
                chosen.every((p) => draft.players.some((d) => d.id === p.id));
              if (draft && sameAsDraft) {
                // Came back with Back and changed nothing about who's here: keep everything.
                onPitch = draft.onPitch;
                bench = draft.bench;
                gap = draft.subGapMins;
                keepers = keepIds(draft.keepers);
                targets = keepHere(draft.targets);
              } else if (savedPlan) {
                // Use the saved line-up for whoever's here; anyone new goes to the bench.
                const saved: Partial<Record<Spot, string | null>> = {};
                for (const sp of format.spots) {
                  const id = (savedPlan.lineup as Record<string, string | null>)[sp];
                  saved[sp] = id && hereSet.has(id) ? id : null;
                }
                const placed = new Set(Object.values(saved).filter(Boolean) as string[]);
                onPitch = saved;
                // Keep the saved bench order (it decides ties in the plan), newcomers last.
                const savedBench = (savedPlan.bench || []).filter((id) => hereSet.has(id) && !placed.has(id));
                bench = [
                  ...savedBench,
                  ...chosen.map((p) => p.id).filter((id) => !placed.has(id) && !savedBench.includes(id)),
                ];
                gap = Number(savedPlan.schedule?.every) || savedPlan.sub_gap || gap;
                keepers = keepIds(savedPlan.schedule?.keepers);
                targets = keepHere(savedPlan.targets);
              } else if (draft) {
                // Came back and changed who's here: new line-up, same sub gap, keepers and game time.
                gap = draft.subGapMins;
                keepers = keepIds(draft.keepers);
                targets = keepHere(draft.targets);
              }
              onReady({
                version: 1,
                groupId: group.id,
                matchId: match?.id || null,
                teamId: choice.teamId,
                title: match ? matchTitle({ ...match, team: teamName(match.team_id) }) : `${teamName(choice.teamId)} · quick game`,
                format,
                subGapMins: Math.min(maxGap(format), Math.max(1, gap)),
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
                keepers,
                targets,
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
  // The sub the app suggests right now (from real minutes), and the one it expects at the next window.
  const kd = keeperDue(state);
  const suggestion = due ? suggestSub(state, now) : null;
  const upNext =
    state.phase === 'playing' && !due && state.bench.length
      ? suggestSub(state, now, Math.max(nextDueMs(state), matchMs(state, now)))
      : null;
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
                : nextSubInMs(state, now) === Infinity
                ? 'No more subs'
                : `Next sub in ${fmtCountdown(Math.min(nextSubInMs(state, now), periodLeft))}`}
            </span>
            <span className="text-slate-400">every {state.subGapMins} min</span>
          </div>
        )}
        {upNext && nextSubInMs(state, now) !== Infinity && (
          <p className="text-xs text-slate-300 mt-1" aria-label="Up next">
            Up next: <b className="text-white">{name(upNext.on)}</b> on for <b className="text-white">{name(upNext.off)}</b>
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

      {/* keeper change at half-time (or once the half has started without it) */}
      {kd && (
        <div role="alert" className="bg-amber-400 text-slate-900 rounded-xl p-4 shadow-lg border-2 border-amber-600">
          <p className="font-black text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            {state.phase !== 'break' ? 'Keeper change' : state.period % 2 === 0 ? 'Half-time: keeper' : 'Between games: keeper'}
          </p>
          <p className="text-base font-bold mt-1">
            {name(kd.keeper)} goes in goal
            {kd.from ? (kd.spot ? `, ${name(kd.from)} to ${SHORT[kd.spot]}` : `, ${name(kd.from)} comes off`) : ''}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => {
                setSelected(null);
                act(changeKeeper);
              }}
              className="bg-slate-900 text-white text-sm font-black px-4 h-11 rounded-lg"
            >
              Done
            </button>
            {kd.from && (
              <button
                onClick={() =>
                  act((st) => {
                    const p = st.phase === 'break' ? st.period + 1 : st.period;
                    const k = [...keepersOf(st)];
                    k[p] = st.onPitch.gk || null;
                    return { ...st, keepers: k };
                  })
                }
                className="bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 text-xs font-bold px-3 h-11 rounded-lg"
              >
                Keep {name(kd.from)} in goal
              </button>
            )}
          </div>
        </div>
      )}

      {/* sub alert: the fairest sub right now, from real minutes */}
      {!kd && due && suggestion && (
        <div role="alert" className="bg-amber-400 text-slate-900 rounded-xl p-4 shadow-lg border-2 border-amber-600 animate-pulse">
          <p className="font-black text-lg flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" /> {state.phase !== 'break' ? 'Sub due' : state.period % 2 === 0 ? 'Half-time sub' : 'Sub between games'}
          </p>
          <p className="text-base font-bold mt-1">
            {name(suggestion.on)} ON for {name(suggestion.off)} ({SHORT[suggestion.spot]})
          </p>
          <p className="text-xs font-semibold mt-1">Or tap different players: who&apos;s coming off, then who&apos;s going on.</p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => {
                setSelected(null);
                act((st, t) => swap(st, { playerId: suggestion.off }, { playerId: suggestion.on }, t));
              }}
              className="bg-slate-900 text-white text-sm font-black px-4 h-11 rounded-lg"
            >
              Done
            </button>
            <button
              onClick={() => act(snooze)}
              className="bg-slate-900/10 hover:bg-slate-900/20 text-slate-900 text-xs font-bold px-3 h-11 rounded-lg"
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

      {state.phase === 'lineup' && <GameTimeEditor state={state} act={act} name={name} />}

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


// ---------- game time: % per player before kick-off ----------

/** A number box you can type into, with − / + either side. Typing commits as you go; blur tidies it. */
function NumberField({
  id,
  value,
  min,
  max,
  onChange,
  downLabel,
  upLabel,
  onDown,
  onUp,
  suffix,
  muted,
  compact,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  downLabel: string;
  upLabel: string;
  onDown?: () => void;
  onUp?: () => void;
  suffix?: string;
  muted?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v))));
  const btn = 'w-11 h-11 shrink-0 flex items-center justify-center text-slate-800 disabled:opacity-30';
  return (
    <div className={`flex items-center h-11 rounded-xl overflow-hidden bg-white ${compact ? '' : 'border border-slate-300'}`}>
      <button type="button" aria-label={downLabel} disabled={!onDown && value <= min} onClick={onDown || (() => set(value - 1))} className={`${btn} ${compact ? 'bg-emerald-100' : 'bg-slate-100'}`}>
        <Minus className="w-4 h-4" />
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) set(n);
        }}
        onBlur={() => setText(String(value))}
        className={`${compact ? 'w-10' : 'flex-1 w-full'} min-w-0 h-full text-center text-lg font-black bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
          muted ? 'text-slate-400' : 'text-slate-900'
        }`}
      />
      {suffix && <span className={`pr-1 text-sm font-bold ${muted ? 'text-slate-400' : 'text-slate-600'}`}>{suffix}</span>}
      <button type="button" aria-label={upLabel} disabled={!onUp && value >= max} onClick={onUp || (() => set(value + 1))} className={`${btn} ${compact ? 'bg-emerald-100' : 'bg-slate-100'}`}>
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}


function GameTimeEditor({
  state,
  act,
  name,
}: {
  state: MatchDayState;
  act: (fn: (s: MatchDayState, now: number) => MatchDayState) => void;
  name: (id: string | null | undefined) => string;
}) {
  const p = previewPlan(state);
  const g = p.goals;
  const total = p.total;
  const periods = state.format.periods;
  const keepers = keepersOf(state);
  const targets = state.targets || {};
  const ids = [...(state.format.spots.map((sp) => state.onPitch[sp]).filter(Boolean) as string[]), ...state.bench];
  const has = (id: string) => typeof targets[id] === 'number';
  const pct = (mins: number) => Math.round((mins / total) * 100);
  const step = Math.max(1, Math.round((state.subGapMins / total) * 100));
  const [open, setOpen] = useState<string | null>(null);
  const openId = open && ids.includes(open) ? open : null;
  const [showPlan, setShowPlan] = useState(false);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const sig = JSON.stringify([state.onPitch, state.bench, state.subGapMins, keepers, targets]);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const dirty = savedSig !== sig;

  const setGap = (v: number) => act((s) => ({ ...s, subGapMins: Math.min(maxGap(s.format), Math.max(1, Math.round(v))) }));
  const setTarget = (id: string, v: number | null) =>
    act((s) => {
      const t = { ...(s.targets || {}) };
      if (v === null) delete t[id];
      else t[id] = Math.min(100, Math.max(0, Math.round(v)));
      return { ...s, targets: t };
    });
  // 1st half keeper = whoever's in goal on the line-up, so picking one moves them there.
  const setKeeper = (period: number, id: string) =>
    act((s, t) => {
      if (period === 0) return id && s.onPitch.gk !== id ? swap(s, { spot: 'gk' }, { playerId: id }, t) : s;
      const k = [...(s.keepers || [])];
      while (k.length <= period) k.push(null);
      k[period] = id || null;
      return { ...s, keepers: k };
    });

  const save = async () => {
    if (!state.matchId) return;
    setSaveState('saving');
    try {
      const res = await fetch('/api/plans', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: state.matchId,
          here: state.players.map((x) => x.id),
          lineup: state.onPitch,
          bench: state.bench,
          sub_gap: state.subGapMins,
          schedule: { every: state.subGapMins, keepers },
          targets,
          subs: p.subs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedSig(sig);
      setSaveState('saved');
      setSaveMsg('');
    } catch (e: any) {
      setSaveState('error');
      setSaveMsg(e.message || 'Could not save');
    }
  };

  // The line under the title: does it work, and how fair is it? One sub per window means some
  // players land a window either side of the rest (two keepers make it two); more than that is uneven.
  const misses = g.setIds.filter((id) => Math.abs((p.minutes[id] || 0) - g.goal[id]) > state.subGapMins + 1e-6);
  const autoOut = g.autoIds.filter((id) => !g.inGoal[id]);
  const autoMins = autoOut.map((id) => p.minutes[id] || 0);
  const lo = Math.min(...autoMins);
  const hi = Math.max(...autoMins);
  const range = autoMins.length ? (pct(lo) === pct(hi) ? `${pct(lo)}%` : `${pct(lo)}–${pct(hi)}%`) : '';
  const subCount = p.subs.length;
  const line: { ok: boolean; text: string } = !state.bench.length
    ? { ok: true, text: 'Nobody on the bench, so no subs.' }
    : g.problem
    ? { ok: false, text: g.problem }
    : misses.length
    ? { ok: false, text: `${name(misses[0])} gets ${pct(p.minutes[misses[0]] || 0)}%, set to ${targets[misses[0]]}%.` }
    : autoMins.length && hi - lo > 2 * state.subGapMins + 1e-6
    ? { ok: false, text: `Uneven: ${range}. Sub more often.` }
    : {
        ok: true,
        text: `${
          !g.setIds.length
            ? 'Everyone'
            : g.setIds.every((id) => pct(p.minutes[id] || 0) === pct(g.goal[id]))
            ? 'Set players on target · others'
            : 'Set players within a sub of target · others'
        } ${range} · ${subCount} ${subCount === 1 ? 'sub' : 'subs'}`,
      };

  const keeperTag = (id: string) => {
    const idx = keepers.map((k, i) => (k === id ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return '';
    if (idx.length === periods) return periods > 2 ? 'In goal both games' : 'In goal all game';
    return `In goal ${idx.map((i) => periodLabel(periods, i)).join(', ')}`;
  };
  const keeperLabel = (i: number) => `In goal, ${periodLabel(periods, i)}`;

  const at = (t: number) => `${(t / total) * 100}%`;
  const breaks = Array.from({ length: periods - 1 }, (_, i) => (i + 1) * state.format.halfMins);
  const labels: number[] = [];
  for (const e of p.events) if (!labels.length || e.t - labels[labels.length - 1] >= total * 0.09) labels.push(e.t);

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" aria-label="Game time">
      <header className="px-4 pt-3 pb-2">
        <h3 className="font-bold text-slate-900">Game time</h3>
        <p role="status" aria-label="Plan check" className={`text-sm font-semibold ${line.ok ? 'text-slate-600' : 'text-amber-700'}`}>
          {line.text}
        </p>
      </header>

      <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
        <label htmlFor="plan-every" className="flex-1 text-sm font-semibold text-slate-700">
          Sub every
        </label>
        <div className="w-40">
          <NumberField
            id="plan-every"
            value={state.subGapMins}
            min={1}
            max={maxGap(state.format)}
            suffix="′"
            downLabel="Subs more often"
            upLabel="Subs less often"
            onChange={setGap}
          />
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-2 gap-3">
        {keepers.map((k, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <label htmlFor={`plan-keeper-${i}`} className="text-xs font-semibold text-slate-600">
              {keeperLabel(i)}
            </label>
            <select
              id={`plan-keeper-${i}`}
              value={k || ''}
              onChange={(e) => setKeeper(i, e.target.value)}
              className="h-11 rounded-xl border border-slate-300 bg-white px-2 text-base font-bold text-slate-900"
            >
              {!k && (
                <option value="" disabled>
                  Pick a keeper
                </option>
              )}
              {ids.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="px-4 pt-2 pb-1 text-xs text-slate-600 border-t border-slate-100">
        Tap a player to change their game time. Auto shares what&apos;s left evenly.
      </p>
      <ul aria-label="Players' game time">
        {ids.map((id) => {
          const isOpen = openId === id;
          const set = has(id);
          const gk = keeperTag(id);
          const minPct = pct(g.inGoal[id] || 0);
          const autoPct = (g.goal[id] / total) * 100;
          const value = set ? targets[id] : Math.round(autoPct);
          const fullKeeper = (g.inGoal[id] || 0) >= total;
          const down = set ? value - step : Math.ceil(autoPct / step) * step - step;
          const up = set ? value + step : Math.floor(autoPct / step) * step + step;
          return (
            <li key={id} className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : id)}
                aria-expanded={isOpen}
                className={`w-full min-h-[52px] px-4 py-1.5 flex items-center gap-3 text-left ${isOpen ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
              >
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-base font-semibold text-slate-900 truncate">{name(id)}</span>
                  <span className={`text-xs font-bold ${set ? 'text-emerald-700' : gk ? 'text-slate-700' : 'text-slate-500'}`}>
                    {[gk, set ? `Set ${targets[id]}%` : 'Auto'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <span className={`text-lg font-black tabular-nums ${misses.includes(id) ? 'text-amber-700' : 'text-slate-900'}`}>
                    {pct(p.minutes[id] || 0)}%
                  </span>
                  <span className="text-xs font-semibold text-slate-500 tabular-nums">{Math.round(p.minutes[id] || 0)}′</span>
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 pt-1 bg-emerald-50 flex items-center gap-2" aria-label={`${name(id)} game time`}>
                  <label htmlFor="plan-target" className="sr-only">
                    {name(id)} game time %
                  </label>
                  <NumberField
                    id="plan-target"
                    compact
                    value={value}
                    min={Math.max(0, minPct)}
                    max={100}
                    suffix="%"
                    muted={!set}
                    downLabel="Less game time"
                    upLabel="More game time"
                    onDown={fullKeeper || value <= minPct ? undefined : () => setTarget(id, Math.max(minPct, down))}
                    onUp={fullKeeper || value >= 100 ? undefined : () => setTarget(id, Math.min(100, up))}
                    onChange={(v) => setTarget(id, Math.max(minPct, v))}
                  />
                  <button
                    type="button"
                    onClick={() => setTarget(id, null)}
                    disabled={!set}
                    className="h-11 px-3 rounded-xl bg-emerald-700 text-white text-sm font-bold disabled:opacity-40 shrink-0"
                  >
                    Auto
                  </button>
                  <span className="flex-1 text-xs text-emerald-900">
                    {fullKeeper ? 'In goal all game, so 100%.' : gk ? `At least ${minPct}% (in goal).` : ''}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => setShowPlan(!showPlan)}
        aria-expanded={showPlan}
        className="w-full h-[52px] px-4 flex items-center justify-between border-t border-slate-200 text-sm font-bold text-emerald-800"
      >
        <span>{showPlan ? 'Hide plan' : 'Show plan'}</span>
        <span className="text-xs font-semibold text-slate-500">
          {subCount} {subCount === 1 ? 'sub' : 'subs'} expected
        </span>
      </button>

      {showPlan && (
        <div className="pb-2 border-t border-slate-100" aria-label="Plan">
          <div className="flex items-end gap-2 px-4 pt-2 h-6" aria-hidden>
            <span className="w-20 shrink-0" />
            <span className="relative flex-1 h-4">
              {labels.map((t) => (
                <span key={t} className="absolute bottom-0 -translate-x-1/2 text-[10px] font-bold text-slate-500 tabular-nums" style={{ left: at(t) }}>
                  {t}
                </span>
              ))}
            </span>
          </div>
          <ul aria-label="Timeline">
            {ids.map((id) => (
              <li key={id} className="h-8 px-4 flex items-center gap-2">
                <span className="w-20 shrink-0 text-sm font-semibold text-slate-800 truncate">{name(id)}</span>
                <span className="relative flex-1 h-4 rounded bg-slate-100 overflow-hidden" aria-hidden>
                  {breaks.map((t) => (
                    <span key={t} className="absolute inset-y-0 w-0.5 bg-slate-400" style={{ left: at(t) }} />
                  ))}
                  {(p.segments[id] || []).map(([a, b, kind]) => (
                    <span
                      key={a}
                      className={`absolute inset-y-0 rounded ${kind === 'goal' ? 'bg-slate-700' : 'bg-emerald-600'}`}
                      style={{ left: at(a), width: at(b - a) }}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <div className="px-4 pt-2 flex gap-4 text-xs text-slate-600" aria-hidden>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-600" />On</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-700" />In goal</span>
            {breaks.length > 0 && <span className="flex items-center gap-1.5"><span className="w-0.5 h-3 bg-slate-400" />Half-time</span>}
          </div>
          <h4 className="px-4 pt-3 pb-1 text-sm font-bold text-slate-900">Expected subs</h4>
          {p.events.length === 0 ? (
            <p className="px-4 pb-2 text-xs text-slate-500">No subs needed.</p>
          ) : (
            <ol aria-label="Expected subs">
              {p.events.map((e) => (
                <li key={e.t} className="px-4 py-2 border-t border-slate-100 flex gap-3">
                  <span className="w-10 shrink-0 text-sm font-extrabold text-emerald-800 tabular-nums">{e.t}′</span>
                  <span className="flex-1 flex flex-col gap-1 text-sm text-slate-700">
                    {e.items.map((x, j) =>
                      x.kind === 'sub' ? (
                        <span key={j}>
                          <b className="text-emerald-800">{name(x.on)}</b> on for {name(x.off)}
                        </span>
                      ) : (
                        <span key={j}>
                          <b className="text-slate-900">{name(x.keeper)}</b> in goal
                          {x.from ? (x.to ? ` (${name(x.from)} to ${SHORT[x.to]})` : ` for ${name(x.from)}`) : ''}
                        </span>
                      )
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="px-4 pt-2 text-xs text-slate-500">
            During the game each sub is picked from real minutes, so a late or swapped sub just changes the next pick.
          </p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100">
        {state.matchId ? (
          <button
            type="button"
            onClick={save}
            disabled={saveState === 'saving' || (!dirty && saveState === 'saved')}
            className="w-full h-11 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl"
          >
            {saveState === 'saving' ? 'Saving…' : !dirty && saveState === 'saved' ? 'Saved ✓' : 'Save plan'}
          </button>
        ) : (
          <p className="text-center text-xs text-slate-500">Quick game: plan stays on this phone.</p>
        )}
      </div>
      {state.matchId && (
        <p className={`px-4 pb-3 -mt-1 text-[11px] text-center ${saveState === 'error' ? 'text-red-600 font-semibold' : 'text-slate-500'}`} role="status">
          {saveState === 'error'
            ? saveMsg
            : !dirty && saveState === 'saved'
            ? 'Saved. Other coaches of this group see it when they open this match.'
            : 'Save to share the line-up and game time with the other coaches.'}
        </p>
      )}
    </section>
  );
}
