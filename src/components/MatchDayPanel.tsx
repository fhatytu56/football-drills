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
  buildPlan,
  clampSchedule,
  defaultSchedule,
  planInputOf,
  scheduleLimits,
  scheduleOf,
  withPlan,
  nextPlanned,
  type MatchDayState,
  type PlannedSub,
  type Schedule,
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
  /** Missing on plans saved before sub windows and targets. */
  schedule?: Schedule | null;
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
    if (state.phase === 'break') return; // half-time subs: the whistle just beeped, the banner shows
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
        // Re-plan from the kick-off line-up, schedule and targets (same plan as before kick-off).
        setState((s) => (s ? withPlan(restart(s)) : s));
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
              let schedule: Schedule = defaultSchedule(format);
              let targets: Record<string, number> = {};
              const sameAsDraft =
                !!draft &&
                draft.teamId === choice.teamId &&
                draft.matchId === (match?.id || null) &&
                draft.players.length === chosen.length &&
                chosen.every((p) => draft.players.some((d) => d.id === p.id));
              if (draft && sameAsDraft) {
                // Came back with Back and changed nothing about who's here: keep line-up, schedule, targets.
                onPitch = draft.onPitch;
                bench = draft.bench;
                schedule = scheduleOf(draft);
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
                schedule = savedPlan.schedule || { firstAt: savedPlan.sub_gap, firstCount: 1, every: savedPlan.sub_gap, per: 1 };
                targets = keepHere(savedPlan.targets);
              } else if (draft) {
                // Came back and changed who's here: new line-up, same schedule and targets.
                schedule = scheduleOf(draft);
                targets = keepHere(draft.targets);
              }
              const spotsInPlay = format.spots.filter((sp) => onPitch[sp] && !(sp === 'gk' && !format.keeperRotates)).length;
              schedule = clampSchedule(format, schedule, bench.length, spotsInPlay);
              onReady(withPlan({
                version: 1,
                groupId: group.id,
                matchId: match?.id || null,
                teamId: choice.teamId,
                title: match ? matchTitle({ ...match, team: teamName(match.team_id) }) : `${teamName(choice.teamId)} · quick game`,
                format,
                subGapMins: schedule.every,
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
                plan: [],
                subsMade: 0,
                schedule,
                targets,
              }));
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
    if (!same)
      act((s, t) => {
        const n = swap(s, selected, item, t);
        return n.phase === 'lineup' && n !== s ? withPlan(n) : n;
      });
    setSelected(null);
  };
  const isSel = (item: { playerId?: string; spot?: Spot }) =>
    !!selected &&
    ((selected.playerId && selected.playerId === item.playerId) || (!selected.playerId && !item.playerId && selected.spot === item.spot));

  const benchSorted = [...state.bench].sort((a, b) => mins(a) - mins(b));
  const planned = state.phase === 'playing' || state.phase === 'break' ? nextPlanned(state) : null;
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
            <AlertTriangle className="w-5 h-5" /> {state.phase !== 'break' ? 'Sub due' : state.period % 2 === 0 ? 'Half-time sub' : 'Sub between games'}
            {planned ? ` · sub ${planned.number}` : ''}
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

function PlanEditor({
  state,
  act,
  name,
}: {
  state: MatchDayState;
  act: (fn: (s: MatchDayState, now: number) => MatchDayState) => void;
  name: (id: string | null | undefined) => string;
}) {
  const schedule = scheduleOf(state);
  const targets = state.targets || {};
  const r = buildPlan(planInputOf(state));
  const total = r.total;
  const spotsInPlay = r.starters.length;
  const benchSize = r.rotating.length - spotsInPlay;
  const lim = scheduleLimits(state.format, benchSize, spotsInPlay);
  const step = Math.max(1, Math.round((schedule.every / total) * 100));
  const pct = (mins: number) => Math.round((mins / total) * 100);
  const hasTarget = (id: string) => typeof targets[id] === 'number';
  const [sel, setSel] = useState<string | null>(null);
  const selId = sel && r.rotating.includes(sel) ? sel : null;

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const sig = JSON.stringify([state.onPitch, state.bench, r.subs, schedule, targets]);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const dirty = savedSig !== sig;

  const setSchedule = (patch: Partial<Schedule>) =>
    act((s) => withPlan({ ...s, schedule: clampSchedule(s.format, { ...scheduleOf(s), ...patch }, benchSize, spotsInPlay) }));
  const setTarget = (id: string, v: number | null) =>
    act((s) => {
      const t = { ...(s.targets || {}) };
      if (v === null) delete t[id];
      else t[id] = Math.min(100, Math.max(0, Math.round(v)));
      return withPlan({ ...s, targets: t });
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
          here: state.players.map((p) => p.id),
          lineup: state.onPitch,
          bench: state.bench,
          sub_gap: schedule.every,
          schedule,
          targets,
          subs: r.subs,
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

  // the line under the steppers: is the plan fair / do the targets work?
  const setIds = r.rotating.filter(hasTarget);
  const autoIds = r.rotating.filter((id) => !hasTarget(id));
  const range = (ids: string[]) => {
    const v = ids.map((id) => pct(r.minutes[id] || 0));
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
  };
  const chip: { ok: boolean; text: string } = r.problem
    ? { ok: false, text: r.problem }
    : r.misses.length
    ? { ok: false, text: `${name(r.misses[0])} gets ${pct(r.minutes[r.misses[0]] || 0)}%, target ${targets[r.misses[0]]}%` }
    : !setIds.length
    ? { ok: true, text: `Everyone ${range(autoIds)}` }
    : autoIds.length
    ? { ok: true, text: `Targets hit · everyone else ${range(autoIds)}` }
    : { ok: true, text: 'Targets hit' };

  // timeline: a line at each sub window, a darker one at half-time
  const at = (t: number) => `${(t / total) * 100}%`;
  const subTimes = r.windows.map((w) => w.t);
  const breaks = Array.from({ length: state.format.periods - 1 }, (_, i) => (i + 1) * state.format.halfMins);
  const labels: number[] = [];
  for (const t of subTimes) if (!labels.length || t - labels[labels.length - 1] >= total * 0.09) labels.push(t);
  const track = (id: string, dark?: boolean) => (
    <span className={`relative flex-1 h-5 rounded-md overflow-hidden ${dark ? 'bg-slate-700' : 'bg-slate-100'}`} aria-hidden>
      {!dark && subTimes.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-slate-300" style={{ left: at(t) }} />)}
      {!dark && breaks.map((t) => <span key={`b${t}`} className="absolute inset-y-0 w-0.5 bg-slate-400" style={{ left: at(t) }} />)}
      {!dark &&
        (r.stints[id] || []).map(([a, b]) => (
          <span key={a} className="absolute inset-y-0 bg-emerald-600 rounded" style={{ left: at(a), width: at(b - a) }} />
        ))}
    </span>
  );
  const row = (id: string) => {
    const s = selId === id;
    const set = hasTarget(id);
    const miss = r.misses.includes(id);
    return (
      <li key={id}>
        <button
          type="button"
          onClick={() => setSel(s ? null : id)}
          aria-pressed={s}
          className={`w-full h-12 px-4 flex items-center gap-2 text-left ${s ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
        >
          <span className="w-20 shrink-0 min-w-0 flex flex-col">
            <span className={`text-sm font-semibold truncate ${s ? 'text-emerald-900' : 'text-slate-900'}`}>{name(id)}</span>
            <span className={`text-[11px] font-bold ${set ? 'text-emerald-700' : 'text-slate-500'}`}>
              {set ? `Target ${targets[id]}%` : 'Auto'}
            </span>
          </span>
          {track(id)}
          <span className="w-11 shrink-0 flex flex-col items-end">
            <span className={`text-sm font-bold tabular-nums ${miss ? 'text-amber-700' : 'text-slate-900'}`}>{pct(r.minutes[id] || 0)}%</span>
            <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{r.minutes[id] || 0}′</span>
          </span>
        </button>
      </li>
    );
  };

  const selAuto = !!selId && !hasTarget(selId);
  const selValue = selId ? (selAuto ? Math.round(r.autoPct) : targets[selId]) : 0;
  const autoDown = () => {
    const f = Math.floor(r.autoPct / step) * step;
    return f >= r.autoPct - 1e-6 ? f - step : f;
  };
  const autoUp = () => {
    const c = Math.ceil(r.autoPct / step) * step;
    return c <= r.autoPct + 1e-6 ? c + step : c;
  };
  const sectionLabel = 'px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500';

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden" aria-label="Sub plan">
      <header className="px-4 pt-3 pb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900">Sub plan</h3>
          <p className="text-xs text-slate-500">
            {total}′ · {r.subs.length} {r.subs.length === 1 ? 'sub' : 'subs'} in {r.windows.length} {r.windows.length === 1 ? 'window' : 'windows'}
          </p>
        </div>
        {benchSize > 0 && (
          <button
            type="button"
            onClick={() => {
              setSel(null);
              act((s) => withPlan({ ...s, targets: {} }));
            }}
            disabled={!setIds.length}
            className="h-11 px-3 rounded-xl text-sm font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 shrink-0"
          >
            All auto
          </button>
        )}
      </header>

      {benchSize === 0 ? (
        <p className="px-4 pb-3 text-xs text-slate-500">Nobody on the bench, so no subs.</p>
      ) : (
        <>
          <div className="px-4 pb-4 border-b border-slate-100 grid grid-cols-2 gap-x-3 gap-y-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-first-at" className="text-xs font-semibold text-slate-600">First subs at</label>
              <NumberField id="plan-first-at" value={schedule.firstAt} {...lim.firstAt} suffix="′" downLabel="First subs earlier" upLabel="First subs later" onChange={(v) => setSchedule({ firstAt: v })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-first-count" className="text-xs font-semibold text-slate-600">How many</label>
              <NumberField id="plan-first-count" value={Math.min(schedule.firstCount, lim.firstCount.max)} {...lim.firstCount} downLabel="Fewer first subs" upLabel="More first subs" onChange={(v) => setSchedule({ firstCount: v })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-every" className="text-xs font-semibold text-slate-600">Then every</label>
              <NumberField id="plan-every" value={schedule.every} {...lim.every} suffix="′" downLabel="Subs more often" upLabel="Subs less often" onChange={(v) => setSchedule({ every: v })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-per" className="text-xs font-semibold text-slate-600">How many</label>
              <NumberField id="plan-per" value={Math.min(schedule.per, lim.per.max)} {...lim.per} downLabel="Fewer subs each time" upLabel="More subs each time" onChange={(v) => setSchedule({ per: v })} />
            </div>
            <p
              role="status"
              aria-label="Plan check"
              className={`col-span-2 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold ${
                chip.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${chip.ok ? 'bg-emerald-600' : 'bg-amber-500'}`} aria-hidden />
              {chip.text}
            </p>
          </div>

          <div className="px-4 pt-3 pb-1">
            {selId ? (
              <div className="flex items-center gap-1.5 min-h-14 p-1.5 pl-3 rounded-xl bg-emerald-800 text-white" aria-label="Game time">
                <label htmlFor="plan-target" className="flex-1 min-w-0 truncate text-sm font-bold">
                  {name(selId)}
                </label>
                <NumberField
                  id="plan-target"
                  compact
                  value={selValue}
                  min={0}
                  max={100}
                  suffix="%"
                  muted={selAuto}
                  downLabel="Less game time"
                  upLabel="More game time"
                  onDown={selAuto ? () => setTarget(selId, autoDown()) : selValue <= 0 ? undefined : () => setTarget(selId, selValue - step)}
                  onUp={selAuto ? () => setTarget(selId, autoUp()) : selValue >= 100 ? undefined : () => setTarget(selId, selValue + step)}
                  onChange={(v) => setTarget(selId, v)}
                />
                <button
                  type="button"
                  onClick={() => setTarget(selId, null)}
                  disabled={selAuto}
                  className="h-11 px-2.5 rounded-lg bg-emerald-700 text-sm font-bold disabled:opacity-40 shrink-0"
                >
                  Auto
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setSel(null)}
                  className="w-11 h-11 rounded-lg bg-white text-emerald-800 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <p className="min-h-14 flex items-center px-3 rounded-xl bg-slate-100 text-sm text-slate-700">
                Tap a player to set their game time. Auto players share what&apos;s left evenly.
              </p>
            )}
          </div>

          <div className="flex items-end gap-2 px-4 pt-2 h-6" aria-hidden>
            <span className="w-20 shrink-0" />
            <span className="relative flex-1 h-4">
              {labels.map((t) => (
                <span key={t} className="absolute bottom-0 -translate-x-1/2 text-[10px] font-bold text-slate-500 tabular-nums" style={{ left: at(t) }}>
                  {t}
                </span>
              ))}
            </span>
            <span className="w-11 shrink-0 text-right text-[10px] font-bold text-slate-500">Plan</span>
          </div>

          <ul aria-label="Planned game time">
            {r.keeper && (
              <li className="h-12 px-4 flex items-center gap-2">
                <span className="w-20 shrink-0 min-w-0 flex flex-col">
                  <span className="text-sm font-semibold text-slate-900 truncate">{name(r.keeper)}</span>
                  <span className="text-[11px] font-bold text-slate-500">Keeper</span>
                </span>
                {track(r.keeper, true)}
                <span className="w-11 shrink-0 flex flex-col items-end">
                  <span className="text-sm font-bold">100%</span>
                  <span className="text-[11px] font-semibold text-slate-500">{total}′</span>
                </span>
              </li>
            )}
            <li className={sectionLabel}>Starting</li>
            {r.starters.map(row)}
            <li className={sectionLabel}>Bench</li>
            {r.rotating.slice(spotsInPlay).map(row)}
          </ul>

          <div className="mt-3 border-t border-slate-200">
            <div className="px-4 pt-3 pb-1 flex items-baseline justify-between">
              <h4 className="text-sm font-bold text-slate-900">Subs</h4>
              <span className="text-[11px] text-slate-500">For the Match Day alerts</span>
            </div>
            {r.windows.length === 0 ? (
              <p className="px-4 pb-3 text-xs text-slate-500">No subs needed for these targets.</p>
            ) : (
              <ol aria-label="Planned subs">
                {r.windows.map((w) => (
                  <li key={w.t} className="px-4 py-2 border-t border-slate-100 flex gap-3">
                    <span className="w-10 shrink-0 text-sm font-extrabold text-emerald-800 tabular-nums">{w.t}′</span>
                    <span className="flex-1 flex flex-col gap-1">
                      {w.subs.map((x) => (
                        <span key={x.on} className="text-sm">
                          <b className="text-emerald-800">{name(x.on)}</b> <span className="text-xs font-semibold text-slate-500">on for</span>{' '}
                          <span className="font-semibold text-slate-700">{name(x.off)}</span>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      )}

      <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3">
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
          <span className="w-full text-center text-xs text-slate-500">Quick game: plan stays on this phone.</span>
        )}
      </div>
      {state.matchId && (
        <p className={`px-4 pb-3 -mt-1 text-[11px] text-center ${saveState === 'error' ? 'text-red-600 font-semibold' : 'text-slate-500'}`} role="status">
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
              <span className="w-12 tabular-nums">{typeof x.at === 'number' ? `${x.at}′` : `Sub ${i + 1}`}</span>
              {name(x.on)} on for {name(x.off)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
