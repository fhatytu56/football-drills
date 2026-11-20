'use client';

// Wayside U10 Manager — a Championship Manager 99/00-style game for the kids.
// Everyone starts equal. Players improve through the drills the kid picks for Tuesday and Thursday,
// plus each player's own focus. Sunday's match is watched live with commentary, subs, tactics and
// a half-time team talk. Weeks go at the kid's own pace.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { divisionFor, shortName } from '@/lib/game/ddsl';
import {
  STATS, SLOTS, PHASE_LABEL, PHASE_STATS, DRILLS_PER_SESSION,
  newSave, syncSquad, runSession, weekState, currentWeek, nextWeek, dayOf, ourCupTie,
  table, seasonOver, autoLineup, cupRoundIn, summary,
  type Save, type PlanDrill, type LibDrill, type MatchResult, type SessionResult, type Slot, type StatKey,
} from '@/lib/game/engine';
import {
  startLive, stepLive, subLive, setTactic, teamTalk, completeLive, rates, HALF, FULL, TACTICS, TALKS,
  type LiveMatch, type Tactic,
} from '@/lib/game/match';

interface TeamData {
  team: string;
  age_group: string;
  players: { id: string; first_name: string; positions: string[] }[];
  plan: PlanDrill[];
  library: LibDrill[];
}

type Tab = 'home' | 'squad' | 'tactics' | 'fixtures' | 'table' | 'cup';
type Day = 'tuesday' | 'thursday';

const DAY_NAME: Record<Day, string> = { tuesday: 'Tuesday', thursday: 'Thursday' };

// ---------- helpers ----------

/** The season starts in the real week the kid starts, so real DDSL fixture dates line up. */
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date());
}

function fmtDate(iso: string, withDay = true) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-IE', { timeZone: 'UTC', weekday: withDay ? 'short' : undefined, day: 'numeric', month: 'short' });
}

// Before logins, saves lived only in the phone's browser under this key. Offered once, then removed.
const legacyKey = (token: string) => `wcfc-u10-game-${token}`;

function legacySave(token: string): Save | null {
  try {
    const raw = window.localStorage.getItem(legacyKey(token));
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

function dropLegacy(token: string) {
  try { window.localStorage.removeItem(legacyKey(token)); } catch { /* nothing to do */ }
}

function statClass(v: number) {
  if (v >= 16) return 'text-emerald-300 font-bold';
  if (v >= 11) return 'text-lime-300';
  if (v >= 6) return 'text-amber-300';
  return 'text-red-400';
}

const nameOf = (s: Save, team: string) => (team === s.team ? s.team : shortName(team));

// ---------- shell ----------

interface Account {
  userId: string;
  manager: string | null; // null = signed in but hasn't joined a team's game yet
  team?: string;
  token?: string;
}

type SaveState = 'saved' | 'saving' | 'error';

export default function GameApp({ token }: { token: string }) {
  const supabase = useMemo(createClient, []);
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acct, setAcct] = useState<Account | null | 'checking'>('checking');
  const [save, setSave] = useState<Save | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [session, setSession] = useState<Day | null>(null);
  const [showMatch, setShowMatch] = useState<{ w: number; which: 'match' | 'cup' } | null>(null);
  const [news, setNews] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const today = useMemo(todayIso, []);
  const pending = useRef<Save | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Team data comes from the link, signed in or not.
  useEffect(() => {
    fetch(`/api/game/${token}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
        return j as TeamData;
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [token]);

  /** Who's signed in, and their saved game. */
  const refresh = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { setAcct(null); setSave(null); return; }
    const { data: mine, error: e } = await supabase.rpc('game_mine');
    if (e) { setError('Couldn’t load your game. Try again.'); return; }
    if (!mine) { setAcct({ userId: u.user.id, manager: null }); setSave(null); return; }
    setAcct({ userId: u.user.id, manager: mine.manager_name, team: mine.team, token: mine.token });
    setSave((mine.save as Save | null) || null);
  }, [supabase]);

  useEffect(() => { refresh(); }, [refresh]);

  // Bring the squad up to date once both the team data and the save are here.
  const synced = useRef(false);
  useEffect(() => {
    if (!data || !save || synced.current) return;
    synced.current = true;
    setSave((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      syncSquad(next, data.players);
      return next;
    });
  }, [data, save]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const s = pending.current;
    if (!s || !acct || acct === 'checking') return;
    pending.current = null;
    const sum = summary(s);
    const { error: e } = await supabase
      .from('game_saves')
      .update({ save: s, ...sum, updated_at: new Date().toISOString() })
      .eq('user_id', acct.userId);
    if (e) { pending.current = pending.current || s; setSaveState('error'); } else if (!pending.current) setSaveState('saved');
  }, [supabase, acct]);

  // Throttled, not debounced: a match ticking every 150 ms must still save at least every 0.8 s.
  const persist = useCallback((s: Save) => {
    pending.current = s;
    setSaveState('saving');
    if (!timer.current) timer.current = setTimeout(flush, 800);
  }, [flush]);

  // Don't lose the last move if the phone locks or the tab closes.
  useEffect(() => {
    const out = () => { if (pending.current) flush(); };
    const vis = () => { if (document.visibilityState === 'hidden') out(); };
    window.addEventListener('pagehide', out);
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('pagehide', out); document.removeEventListener('visibilitychange', vis); };
  }, [flush]);

  const update = useCallback(
    (fn: (s: Save) => void) => {
      setSave((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        fn(next);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const signOut = async () => {
    await flush();
    await supabase.auth.signOut();
    synced.current = false;
    setAcct(null);
    setSave(null);
    setTab('home');
  };

  if (error) return <Frame><Panel title="Wayside U10 Manager"><p className="text-sm">{error}</p></Panel></Frame>;
  if (!data || acct === 'checking') return <Frame><p className="text-center text-slate-300 py-16 text-sm">Loading…</p></Frame>;

  const div = divisionFor(data.team);
  if (!div) {
    return (
      <Frame>
        <Panel title="Wayside U10 Manager">
          <p className="text-sm">Team {data.team} isn’t in the game yet. Only Wayside’s U10 Sunday teams are in it for now.</p>
        </Panel>
      </Frame>
    );
  }

  if (!acct) return <Frame><SignIn supabase={supabase} token={token} team={data.team} onDone={(m) => { setJoinMsg(m || null); refresh(); }} /></Frame>;
  if (!acct.manager) return <Frame><Join supabase={supabase} token={token} team={data.team} hint={joinMsg} onDone={refresh} onSignOut={signOut} /></Frame>;
  if (acct.token !== token) {
    return (
      <Frame>
        <div className="p-2 pt-6 space-y-2">
          <Panel title="Wrong team link">
            <p className="text-sm">
              <b>{acct.manager}</b> manages <b>Wayside {acct.team}</b>. This link is for Wayside {data.team}.
            </p>
            <div className="flex justify-between mt-3">
              <Btn tone="plain" onClick={signOut}>Log out</Btn>
              <a href={`/game/${acct.token}`}><Btn>Open my game</Btn></a>
            </div>
          </Panel>
        </div>
      </Frame>
    );
  }

  if (!save) {
    const old = legacySave(token);
    return (
      <Frame>
        <Intro
          team={data.team}
          division={div.name}
          squad={data.players.length}
          manager={acct.manager}
          hasOld={!!old && old.division === div.name}
          onStart={(keepOld) => {
            let s: Save;
            if (keepOld && old) { s = old; syncSquad(s, data.players); } else s = newSave({ team: `Wayside ${data.team}`, division: div.name, today, players: data.players });
            synced.current = true;
            setSave(s);
            persist(s);
            if (keepOld && old) {
              dropLegacy(token);
              setNews(['Your game from this phone is now saved to your login. You can play it on any phone now.']);
            }
          }}
        />
      </Frame>
    );
  }

  const w = currentWeek(save);

  return (
    <Frame>
      <TopBar save={save} saveState={saveState} />
      {!save.live && <nav className="grid grid-cols-6 gap-px bg-slate-600 border-y border-slate-500 text-[11px] font-bold">
        {(['home', 'squad', 'tactics', 'fixtures', 'table', 'cup'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSession(null); setShowMatch(null); }}
            className={`py-2 uppercase tracking-wide ${tab === t && !session && !showMatch ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}
          >
            {t === 'home' ? 'Inbox' : t}
          </button>
        ))}
      </nav>}

      {saveState === 'error' && (
        <p className="m-2 text-[11px] bg-red-900/60 border border-red-700 p-2 flex items-center justify-between gap-2">
          <span>Couldn’t save your game. Check your internet.</span>
          <button className="underline font-bold" onClick={() => { if (save) persist(save); }}>Try again</button>
        </p>
      )}

      <div className="p-2 space-y-2">
        {save.live ? (
          <LiveScreen
            save={save}
            update={update}
            onFinished={() => {
              const lm = save.live!;
              update((s) => { completeLive(s); });
              setShowMatch({ w: lm.w, which: lm.kind === 'cup' ? 'cup' : 'match' });
              setTab('home');
            }}
          />
        ) : session ? (
          <Training
            save={save}
            w={w}
            day={session}
            plan={data.plan}
            library={data.library}
            onFinish={(drills) => {
              update((s) => { weekState(s, w)[session] = runSession(s, drills); });
            }}
            onClose={() => setSession(null)}
          />
        ) : showMatch ? (
          <MatchScreen save={save} w={showMatch.w} which={showMatch.which} onClose={() => setShowMatch(null)} />
        ) : tab === 'home' ? (
          <Home
            save={save}
            w={w}
            plan={data.plan}
            news={news}
            library={data.library}
            onTrain={setSession}
            onPlay={(kind) => {
              update((s) => {
                if (kind === 'league') {
                  const fx = s.schedule.find((f) => f.w === w);
                  if (fx) startLive(s, 'league', w, fx.opp, fx.home);
                } else {
                  const tie = ourCupTie(s, w);
                  if (tie) startLive(s, 'cup', w, tie.a === s.team ? tie.b : tie.a, tie.a === s.team);
                }
              });
            }}
            onShowMatch={(which, wk) => setShowMatch({ w: wk, which })}
            onNextWeek={() => { setNews([]); update((s) => { nextWeek(s); }); }}
            manager={acct.manager}
            onSignOut={signOut}
            onNewSeason={() => {
              const s = newSave({ team: save.team, division: save.division, today, players: data.players, season: save.season + 1, carry: save });
              setSave(s);
              persist(s);
              setNews([`Season ${s.season}. Your players keep what they learned, but every other team has got better too.`]);
            }}
          />
        ) : tab === 'squad' ? (
          <Squad save={save} w={w} update={update} />
        ) : tab === 'tactics' ? (
          <Tactics save={save} update={update} locked={!!save.log[w]?.match && !seasonOver(save)} />
        ) : tab === 'fixtures' ? (
          <Fixtures save={save} onShow={(wk) => setShowMatch({ w: wk, which: 'match' })} />
        ) : tab === 'table' ? (
          <>
            <LeagueTable save={save} />
            <Leaderboard supabase={supabase} token={token} team={data.team} />
          </>
        ) : (
          <Cup save={save} />
        )}
      </div>
    </Frame>
  );
}

// ---------- layout bits ----------

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b1a33] text-slate-100" style={{ fontFamily: 'Tahoma, Verdana, Segoe UI, sans-serif' }}>
      <div className="max-w-xl mx-auto">{children}</div>
    </div>
  );
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-slate-500 bg-[#16305a]">
      <h2 className="flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider bg-gradient-to-b from-slate-300 to-slate-400 text-slate-900">
        <span>{title}</span>
        {right}
      </h2>
      <div className="p-2">{children}</div>
    </section>
  );
}

function TopBar({ save, saveState }: { save: Save; saveState: SaveState }) {
  const w = currentWeek(save);
  const pos = table(save).findIndex((r) => r.team === save.team) + 1;
  const started = save.results.length > 0;
  return (
    <header className="flex items-center justify-between px-2 py-2 bg-gradient-to-b from-[#24508f] to-[#163a6c] border-b border-slate-500">
      <div className="flex items-center gap-2">
        <img src="/crest.jpg" alt="" className="w-8 h-8 rounded-sm border border-slate-400" />
        <div>
          <p className="font-bold text-sm leading-tight">{save.team}</p>
          <p className="text-[11px] text-slate-300 leading-tight">DDSL {save.division} Boys Sun · Season {save.season}</p>
        </div>
      </div>
      <div className="text-right text-[11px] leading-tight">
        <p className="font-bold">{fmtDate(dayOf.sunday(save, w))}</p>
        <p className={saveState === 'error' ? 'text-red-400' : 'text-slate-400'}>
          {saveState === 'saved' ? 'Saved ✓' : saveState === 'saving' ? 'Saving…' : 'Not saved'}
        </p>
        <p className="text-slate-300">
          Week {Math.min(w + 1, save.weeks)}/{save.weeks}
          {started && <> · {pos}{['th', 'st', 'nd', 'rd'][pos % 10 > 3 || Math.floor(pos / 10) === 1 ? 0 : pos % 10]}</>}
        </p>
      </div>
    </header>
  );
}

function Btn({ children, onClick, disabled, tone = 'go', type = 'button' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'go' | 'plain'; type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 text-xs font-bold uppercase tracking-wide border ${
        disabled
          ? 'bg-slate-700 border-slate-600 text-slate-400'
          : tone === 'go'
            ? 'bg-amber-300 border-amber-200 text-slate-900 active:bg-amber-400'
            : 'bg-slate-700 border-slate-500 text-slate-100 active:bg-slate-600'
      }`}
    >
      {children}
    </button>
  );
}

// ---------- intro ----------

function Intro({ team, division, squad, manager, hasOld, onStart }: {
  team: string; division: string; squad: number; manager: string; hasOld: boolean; onStart: (keepOld: boolean) => void;
}) {
  return (
    <div className="p-2 pt-6 space-y-2">
      <div className="text-center pb-2">
        <img src="/crest.jpg" alt="" className="w-16 h-16 mx-auto rounded border border-slate-400" />
        <h1 className="mt-2 text-lg font-bold">Wayside U10 Manager</h1>
      </div>
      <Panel title="Your new job">
        <div className="text-sm space-y-2">
          <p>Welcome, <b>{manager}</b>. You’re the manager of <b>Wayside {team}</b> in the DDSL <b>{division} Boys Sunday</b> league.</p>
          <p>All {squad} players start at exactly the same level. The only way to make them better is training.</p>
          <p><b>Tuesday and Thursday:</b> pick the drills. Each drill makes your players better at what it trains. Give each player their own focus too.</p>
          <p><b>Sunday:</b> pick your team, then watch the match live. Make subs, change tactics, give the half-time team talk. Win the league. Win the cup.</p>
          <p className="text-slate-300 text-xs">Play as many weeks as you like. Skip training and your players don’t improve that week.</p>
        </div>
      </Panel>
      {hasOld ? (
        <Panel title="Game on this phone">
          <p className="text-sm">There’s already a game on this phone from before logins. Keep it and save it to your login?</p>
          <div className="flex justify-between mt-2">
            <Btn tone="plain" onClick={() => onStart(false)}>Start fresh</Btn>
            <Btn onClick={() => onStart(true)}>Keep my game</Btn>
          </div>
        </Panel>
      ) : (
        <div className="flex justify-end"><Btn onClick={() => onStart(false)}>Start season</Btn></div>
      )}
    </div>
  );
}

// ---------- home / inbox ----------

function Home({ save, w, library, news, manager, onTrain, onPlay, onShowMatch, onNextWeek, onNewSeason, onSignOut }: {
  save: Save; w: number; plan: PlanDrill[]; library: LibDrill[]; news: string[]; manager: string;
  onTrain: (d: Day) => void; onPlay: (kind: 'league' | 'cup') => void; onShowMatch: (which: 'match' | 'cup', w: number) => void;
  onNextWeek: () => void; onNewSeason: () => void; onSignOut: () => void;
}) {
  const footer = (
    <p className="text-[11px] text-slate-400 flex justify-between pt-1">
      <span>Manager: <b className="text-slate-200">{manager}</b></span>
      <button className="underline" onClick={onSignOut}>Log out</button>
    </p>
  );
  if (seasonOver(save)) {
    const t = table(save);
    const pos = t.findIndex((r) => r.team === save.team) + 1;
    const me = t[pos - 1];
    return (
      <>
        {news.map((n, i) => (
          <p key={i} className="text-xs bg-[#3a2a0b] border border-amber-700 p-2">{n}</p>
        ))}
        <Panel title="End of season">
          <div className="text-sm space-y-1">
            <p className="text-base font-bold">{pos === 1 ? '🏆 League champions!' : `Finished ${pos} of ${t.length}`}</p>
            <p>P {me.p} · W {me.w} · D {me.d} · L {me.l} · {me.pts} pts</p>
            <p>{save.cup.won ? '🏆 Cup winners!' : save.cup.out ? 'Knocked out of the cup.' : 'Cup finished.'}</p>
            <TopScorers save={save} />
          </div>
        </Panel>
        <div className="flex justify-end"><Btn onClick={onNewSeason}>Next season</Btn></div>
        {footer}
      </>
    );
  }

  const ws = save.log[w] || {};
  const fx = save.schedule.find((f) => f.w === w);
  const cupK = cupRoundIn(save, w);
  const cupTie = cupK >= 0 && !save.cup.out ? save.cup.rounds[cupK].ties.find((t) => t.a === save.team || t.b === save.team) : undefined;
  const cupToPlay = ourCupTie(save, w);
  const last = [...save.schedule].reverse().find((f) => f.w < w && save.log[f.w]?.match);

  const sessionRow = (day: Day) => {
    const res = ws[day];
    const date = dayOf[day](save, w);
    let status: React.ReactNode;
    if (res?.status === 'done') status = <span className="text-lime-300">Done ✓</span>;
    else if (res?.status === 'missed') status = <span className="text-red-400">Missed</span>;
    else if (ws.match) status = <span className="text-red-400">Missed</span>;
    else if (!library.length) status = <span className="text-slate-400">No drills yet</span>;
    else status = <Btn onClick={() => onTrain(day)}>Train</Btn>;
    return (
      <div className="flex items-center justify-between py-1.5 border-b border-slate-600 last:border-0">
        <span className="text-sm"><b>{DAY_NAME[day]}</b> training <span className="text-slate-400 text-xs">{fmtDate(date, false)}</span></span>
        <span className="text-xs">{status}</span>
      </div>
    );
  };

  const sunday = dayOf.sunday(save, w);
  const trained = (['tuesday', 'thursday'] as Day[]).filter((d) => ws[d]?.status === 'done').length;

  return (
    <>
      {news.map((n, i) => (
        <p key={i} className="text-xs bg-[#3a2a0b] border border-amber-700 p-2">{n}</p>
      ))}

      <Panel title={`This week · ${fmtDate(dayOf.tuesday(save, w), false)} – ${fmtDate(sunday, false)}`}>
        {sessionRow('tuesday')}
        {sessionRow('thursday')}
      </Panel>

      {fx && (
        <Panel title={`Sunday · ${fmtDate(sunday)}`} right={fx.real ? <span className="text-[10px] bg-slate-800 text-amber-200 px-1">REAL DDSL FIXTURE</span> : null}>
          <p className="text-sm">
            League: <b>{fx.home ? save.team : shortName(fx.opp)}</b> v <b>{fx.home ? shortName(fx.opp) : save.team}</b>
          </p>
          {cupTie && <p className="text-sm mt-1">{save.cup.rounds[cupK].name}: <b>{nameOf(save, cupTie.a)}</b> v <b>{nameOf(save, cupTie.b)}</b></p>}
          <div className="flex items-center justify-between mt-2">
            {ws.match ? (
              <>
                <span className="text-sm">
                  Full time: <b>{ws.match.gf}–{ws.match.ga}</b>
                  {ws.cup && <> · Cup <b>{ws.cup.gf}–{ws.cup.ga}{ws.cup.pens ? ` (${ws.cup.pens[0]}–${ws.cup.pens[1]} pens)` : ''}</b></>}
                </span>
                <span className="flex gap-1">
                  {ws.cup && <Btn tone="plain" onClick={() => onShowMatch('cup', w)}>Cup</Btn>}
                  <Btn tone="plain" onClick={() => onShowMatch('match', w)}>Report</Btn>
                </span>
              </>
            ) : (
              <>
                <span className="text-xs text-slate-300">
                  {trained < 2 ? `Only ${trained} of 2 trainings done — untrained weeks don’t improve anyone.` : 'Check your team in Tactics first.'}
                </span>
                <Btn onClick={() => onPlay('league')}>Play match</Btn>
              </>
            )}
          </div>
          {ws.match && (
            <div className="flex justify-end mt-2">
              {cupToPlay ? <Btn onClick={() => onPlay('cup')}>Play cup tie</Btn> : <Btn onClick={onNextWeek}>Next week ▶</Btn>}
            </div>
          )}
        </Panel>
      )}

      {last && save.log[last.w]?.match && (
        <Panel title="Last result">
          <button className="w-full text-left text-sm" onClick={() => onShowMatch('match', last.w)}>
            {resultLine(save, save.log[last.w]!.match!)} <span className="text-slate-400 text-xs">· tap for report</span>
          </button>
        </Panel>
      )}

      <MiniTable save={save} />
      {footer}
    </>
  );
}

function resultLine(save: Save, m: MatchResult) {
  const us = save.team;
  const them = shortName(m.opp);
  const outcome = m.gf > m.ga || (m.pens && m.pens[0] > m.pens[1]) ? 'W' : m.gf < m.ga || m.pens ? 'L' : 'D';
  return `${outcome} · ${m.home ? `${us} ${m.gf}–${m.ga} ${them}` : `${them} ${m.ga}–${m.gf} ${us}`}`;
}

function MiniTable({ save }: { save: Save }) {
  const t = table(save);
  const i = t.findIndex((r) => r.team === save.team);
  const start = Math.max(0, Math.min(i - 2, t.length - 5));
  const rows = t.slice(start, start + 5);
  return (
    <Panel title="League position">
      <TableRows save={save} rows={rows} all={t} />
    </Panel>
  );
}

// ---------- training ----------

function Training({ save, w, day, plan, library, onFinish, onClose }: {
  save: Save; w: number; day: Day; plan: PlanDrill[]; library: LibDrill[];
  onFinish: (drills: LibDrill[]) => void; onClose: () => void;
}) {
  const done = save.log[w]?.[day];
  const [picked, setPicked] = useState<string[]>([]);
  const inPlan = new Set(plan.filter((d) => d.day === day).map((d) => d.drill_id));
  const last = new Set(save.lastDrills || []);

  if (done) {
    return (
      <Panel title={`${DAY_NAME[day]} training report`}>
        <div className="space-y-2 text-sm">
          {done.mishap && <p className="text-xs bg-[#3a2a0b] border border-amber-700 p-2">😄 <b>Training news:</b> {done.mishap}</p>}
          <ul className="space-y-1">
            {(done.drills || done.answers.map((a) => ({ drillId: a.drillId, title: a.title, phase: a.phase, repeat: false }))).map((d) => (
              <li key={d.drillId} className="text-xs border border-slate-600 p-1.5">
                <b>{d.title}</b> <span className="text-slate-400">· trains {(PHASE_STATS[d.phase] || []).map((k) => STATS.find((x) => x.key === k)?.label).join(', ')}</span>
                {d.repeat && <span className="text-amber-200"> · same as last session, less effect</span>}
              </li>
            ))}
          </ul>
          <GainsTable save={save} res={done} />
          <div className="flex justify-end"><Btn onClick={onClose}>Continue</Btn></div>
        </div>
      </Panel>
    );
  }

  const groups = Object.keys(PHASE_LABEL)
    .map((ph) => ({ ph, drills: library.filter((d) => d.game_phase === ph).sort((a, b) => a.title.localeCompare(b.title)) }))
    .filter((g) => g.drills.length);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < DRILLS_PER_SESSION ? [...p, id] : p));

  return (
    <Panel title={`${DAY_NAME[day]} training · pick ${DRILLS_PER_SESSION} drills`} right={<span>{picked.length}/{DRILLS_PER_SESSION}</span>}>
      <p className="text-xs text-slate-300 mb-2">
        Each drill makes the whole squad better at what it trains. Players also work on their own focus (set it in Squad).
      </p>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {groups.map((g) => (
          <div key={g.ph}>
            <p className="text-[11px] font-bold text-amber-200">
              {PHASE_LABEL[g.ph]} <span className="font-normal text-slate-400">· {(PHASE_STATS[g.ph] || []).map((k) => STATS.find((x) => x.key === k)?.short).join(' ')}</span>
            </p>
            <div className="space-y-1 mt-0.5">
              {g.drills.map((d) => {
                const on = picked.includes(d.drill_id);
                return (
                  <button
                    key={d.drill_id}
                    onClick={() => toggle(d.drill_id)}
                    className={`w-full text-left text-sm px-2 py-1.5 border ${on ? 'bg-amber-300 text-slate-900 border-amber-200 font-bold' : 'bg-slate-800 border-slate-600'}`}
                  >
                    {d.title}
                    {inPlan.has(d.drill_id) && <span className={`text-[10px] ml-1 ${on ? 'text-slate-700' : 'text-sky-300'}`}>· real training this week</span>}
                    {last.has(d.drill_id) && <span className={`text-[10px] ml-1 ${on ? 'text-slate-700' : 'text-amber-200'}`}>· did last time</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        <Btn tone="plain" onClick={onClose}>Back</Btn>
        <Btn
          disabled={picked.length !== DRILLS_PER_SESSION}
          onClick={() => onFinish(picked.map((id) => library.find((d) => d.drill_id === id)!))}
        >
          Run training
        </Btn>
      </div>
    </Panel>
  );
}

function GainsTable({ save, res }: { save: Save; res: SessionResult }) {
  const keys = Array.from(new Set(Object.values(res.gains).flatMap((g) => Object.keys(g)))) as StatKey[];
  if (!keys.length) return null;
  const ids = Object.keys(res.gains).filter((id) => save.players[id]).sort((a, b) => save.players[a].name.localeCompare(save.players[b].name));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-300">
            <th className="text-left font-normal">Player</th>
            {keys.map((k) => <th key={k} className="font-normal">{STATS.find((x) => x.key === k)?.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id} className="odd:bg-slate-800/50">
              <td className="py-0.5">{save.players[id].name}{res.focus.includes(id) && <span className="text-amber-300"> ★</span>}</td>
              {keys.map((k) => {
                const g = res.gains[id]?.[k] || 0;
                return (
                  <td key={k} className="text-center tabular-nums text-lime-300">
                    {g > 0 ? `+${g.toFixed(1)}` : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-400 mt-1">How much each player improved today. ★ = extra coaching. Every 1.0 is a whole number on the Squad screen.</p>
    </div>
  );
}

// ---------- squad ----------

function Squad({ save, w, update }: { save: Save; w: number; update: (fn: (s: Save) => void) => void }) {
  const players = Object.values(save.players).sort((a, b) => a.name.localeCompare(b.name));
  const weekGains = (id: string, k: StatKey) =>
    (['tuesday', 'thursday'] as Day[]).reduce((a, d) => a + (save.log[w]?.[d]?.gains[id]?.[k] || 0), 0);
  return (
    <>
      <Panel title="Squad" right={<span className="text-[10px]">1–20 · everyone started at 5</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-300">
                <th className="text-left font-normal">Name</th>
                <th className="font-normal">Pos</th>
                {STATS.map((s) => <th key={s.key} className="font-normal" title={s.label}>{s.short}</th>)}
                <th className="font-normal">Gls</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className="odd:bg-slate-800/50">
                  <td className="py-1 pr-1 font-bold">{p.name}</td>
                  <td className="text-center text-slate-300 uppercase">{p.positions[0] || '–'}</td>
                  {STATS.map((s) => (
                    <td key={s.key} className={`text-center tabular-nums ${statClass(p.s[s.key])} ${p.focus === s.key ? 'underline decoration-sky-400 decoration-2 underline-offset-2' : ''}`}>
                      {Math.floor(p.s[s.key])}{weekGains(p.id, s.key) > 0 && <span className="text-lime-300 text-[9px]">▲</span>}
                    </td>
                  ))}
                  <td className="text-center tabular-nums">{p.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">
          {STATS.map((s) => `${s.short} ${s.label}`).join(' · ')}. ▲ = trained up this week. <span className="underline decoration-sky-400 decoration-2">Underlined</span> = individual focus.
        </p>
      </Panel>
      <Panel title="Individual training">
        <p className="text-xs text-slate-300 mb-2">Give each player something to work on. It gets a little extra at every training session.</p>
        <div className="space-y-1">
          {players.map((p) => (
            <label key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-bold">{p.name} <span className="text-slate-400 font-normal uppercase text-xs">{p.positions[0] || ''}</span></span>
              <select
                aria-label={`Individual focus for ${p.name}`}
                value={p.focus || ''}
                onChange={(e) => update((s) => { const v = e.target.value as StatKey | ''; if (v) s.players[p.id].focus = v; else delete s.players[p.id].focus; })}
                className="text-xs px-1 py-1 bg-slate-900 border border-slate-500 text-slate-100 w-36"
              >
                <option value="">— none —</option>
                {STATS.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Panel>
    </>
  );
}

function TopScorers({ save }: { save: Save }) {
  const top = Object.values(save.players).filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 3);
  if (!top.length) return null;
  return <p>Top scorers: {top.map((p) => `${p.name} ${p.goals}`).join(', ')}</p>;
}

// ---------- tactics ----------

function Tactics({ save, update, locked }: { save: Save; update: (fn: (s: Save) => void) => void; locked: boolean }) {
  const players = Object.values(save.players).sort((a, b) => a.name.localeCompare(b.name));
  const inTeam = new Set(Object.values(save.lineup));
  const set = (slot: Slot, id: string) =>
    update((s) => {
      const from = (Object.keys(s.lineup) as Slot[]).find((k) => s.lineup[k] === id);
      const was = s.lineup[slot];
      if (id) s.lineup[slot] = id; else delete s.lineup[slot];
      if (from && from !== slot) { if (was) s.lineup[from] = was; else delete s.lineup[from]; }
    });
  const rows: Slot[][] = [['st'], ['lm', 'cm', 'rm'], ['lb', 'rb'], ['gk']];
  return (
    <Panel title="Tactics · 7-a-side" right={<button className="underline" onClick={() => update((s) => { s.lineup = autoLineup(s); })}>Pick for me</button>}>
      {locked && <p className="text-[11px] text-slate-300 mb-2">This week’s match is played. Changes count from next Sunday.</p>}
      <div className="grid grid-cols-3 gap-px bg-slate-600 border border-slate-500 text-xs font-bold mb-2">
        {TACTICS.map((t) => (
          <button
            key={t.id}
            onClick={() => update((s) => { s.tactic = t.id; })}
            className={`py-1.5 ${(save.tactic || 'balanced') === t.id ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bg-gradient-to-b from-green-800 to-green-700 border border-green-500 p-2 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-center gap-2">
            {r.map((slot) => {
              const id = save.lineup[slot];
              return (
                <label key={slot} className="flex flex-col items-center w-[31%]">
                  <span className="text-[10px] font-bold text-green-100">{SLOTS.find((x) => x.id === slot)?.short}</span>
                  <select
                    aria-label={`Player at ${slot}`}
                    value={id || ''}
                    onChange={(e) => set(slot, e.target.value)}
                    className="w-full text-xs px-1 py-1 bg-slate-900 border border-slate-500 text-slate-100"
                  >
                    <option value="">— empty —</option>
                    {players.map((pl) => (
                      <option key={pl.id} value={pl.id}>{pl.name}{inTeam.has(pl.id) && pl.id !== id ? ' (in team)' : ''}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-300 mt-2">
        <b>Attack</b> scores more but lets in more; <b>Defend</b> the opposite. You can change it during the match too. Picking someone already in the team swaps them. Play anyone anywhere: what counts is their numbers (a striker needs Shooting, a defender Tackling and Positioning). Your keeper’s <b>GK</b> number matters most in goal.
      </p>
      <p className="text-[11px] text-slate-400 mt-1">Subs: {players.filter((p) => !inTeam.has(p.id)).map((p) => p.name).join(', ') || 'none'}</p>
    </Panel>
  );
}

// ---------- match report ----------

function MatchScreen({ save, w, which, onClose }: { save: Save; w: number; which: 'match' | 'cup'; onClose: () => void }) {
  const m = save.log[w]?.[which];
  if (!m) return null;
  const homeName = m.home ? save.team : shortName(m.opp);
  const awayName = m.home ? shortName(m.opp) : save.team;
  const [hg, ag] = m.home ? [m.gf, m.ga] : [m.ga, m.gf];
  const scorers: Record<string, number> = {};
  for (const id of m.scorers) scorers[id] = (scorers[id] || 0) + 1;
  const ourStat = (a: number, b: number) => (m.home ? [a, b] : [b, a]);
  const [hPos, aPos] = ourStat(m.possession, 100 - m.possession);
  const [hSh, aSh] = ourStat(m.shots[0], m.shots[1]);
  const [hOn, aOn] = ourStat(m.onTarget[0], m.onTarget[1]);
  const title = which === 'cup' ? save.cup.rounds.find((r) => r.w === w)?.name || 'Cup' : `League · week ${w + 1}`;
  return (
    <Panel title={`${title} · ${fmtDate(dayOf.sunday(save, w))}`}>
      {m.auto && <p className="text-[11px] text-amber-200 mb-1">Played without you (the week went by).</p>}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center bg-slate-900 border border-slate-600 py-3">
        <span className="font-bold text-sm">{homeName}</span>
        <span className="text-3xl font-bold tabular-nums px-3 text-amber-300">{hg} – {ag}</span>
        <span className="font-bold text-sm">{awayName}</span>
      </div>
      {m.pens && <p className="text-center text-xs mt-1">{save.team} {m.pens[0]}–{m.pens[1]} on penalties</p>}
      <p className="text-xs mt-2">
        <b>{save.team} scorers:</b>{' '}
        {Object.keys(scorers).length ? Object.entries(scorers).map(([id, n]) => `${save.players[id]?.name || '?'}${n > 1 ? ` (${n})` : ''}`).join(', ') : 'none'}
      </p>
      <table className="w-full text-xs mt-2">
        <tbody>
          {[['Possession', `${hPos}%`, `${aPos}%`], ['Shots', hSh, aSh], ['On target', hOn, aOn]].map(([k, a, b]) => (
            <tr key={k as string} className="odd:bg-slate-800/50">
              <td className="text-left tabular-nums w-1/4">{a}</td>
              <td className="text-center text-slate-300">{k}</td>
              <td className="text-right tabular-nums w-1/4">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {m.motm && save.players[m.motm] && <p className="text-xs mt-2">⭐ Player of the match: <b>{save.players[m.motm].name}</b></p>}
      <div className="flex justify-end mt-2"><Btn onClick={onClose}>Continue</Btn></div>
    </Panel>
  );
}

// ---------- fixtures / table / cup ----------

function Fixtures({ save, onShow }: { save: Save; onShow: (w: number) => void }) {
  return (
    <Panel title={`Fixtures · DDSL ${save.division} Boys Sun`}>
      <table className="w-full text-xs">
        <tbody>
          {save.schedule.map((f) => {
            const m = save.log[f.w]?.match;
            const cupK = cupRoundIn(save, f.w);
            return (
              <tr key={f.w} className="odd:bg-slate-800/50">
                <td className="py-1 text-slate-300 whitespace-nowrap pr-1">{fmtDate(dayOf.sunday(save, f.w), false)}</td>
                <td className="pr-1">{f.home ? 'H' : 'A'}</td>
                <td>
                  {shortName(f.opp)}
                  {f.real && <span className="text-amber-200 text-[9px]"> DDSL</span>}
                  {cupK >= 0 && <span className="text-sky-300 text-[9px]"> +CUP</span>}
                </td>
                <td className="text-right">
                  {m ? (
                    <button className="underline tabular-nums" onClick={() => onShow(f.w)}>
                      {m.gf > m.ga ? 'W' : m.gf < m.ga ? 'L' : 'D'} {m.gf}–{m.ga}
                    </button>
                  ) : <span className="text-slate-500">–</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-400 mt-2">DDSL = a real Wayside fixture on that Sunday. Teams are the real {save.division} division; results are the game’s own.</p>
    </Panel>
  );
}

function TableRows({ save, rows, all }: { save: Save; rows: ReturnType<typeof table>; all: ReturnType<typeof table> }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-300">
          <th className="font-normal text-left">#</th><th className="font-normal text-left">Team</th>
          <th className="font-normal">P</th><th className="font-normal">W</th><th className="font-normal">D</th><th className="font-normal">L</th>
          <th className="font-normal">GD</th><th className="font-normal">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.team} className={r.team === save.team ? 'bg-amber-300 text-slate-900 font-bold' : 'odd:bg-slate-800/50'}>
            <td className="py-0.5">{all.indexOf(r) + 1}</td>
            <td>{nameOf(save, r.team)}</td>
            <td className="text-center tabular-nums">{r.p}</td><td className="text-center tabular-nums">{r.w}</td>
            <td className="text-center tabular-nums">{r.d}</td><td className="text-center tabular-nums">{r.l}</td>
            <td className="text-center tabular-nums">{r.gf - r.ga}</td><td className="text-center tabular-nums font-bold">{r.pts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeagueTable({ save }: { save: Save }) {
  const t = table(save);
  return (
    <Panel title={`DDSL ${save.division} Boys Sun`}>
      <TableRows save={save} rows={t} all={t} />
      <p className="text-[10px] text-slate-400 mt-2">Real teams from ddsl.ie. DDSL doesn’t publish U10 results, so this table is your game’s own.</p>
    </Panel>
  );
}

function Cup({ save }: { save: Save }) {
  return (
    <Panel title="Wayside U10 Cup" right={<span className="text-[10px]">{save.cup.won ? 'WINNERS' : save.cup.out ? 'OUT' : 'STILL IN'}</span>}>
      <div className="space-y-2">
        {save.cup.rounds.map((r) => (
          <div key={r.name}>
            <p className="text-[11px] font-bold text-amber-200">{r.name} · {fmtDate(dayOf.sunday(save, r.w), false)}</p>
            {r.ties.length ? (
              <table className="w-full text-xs">
                <tbody>
                  {r.ties.map((t, i) => {
                    const ours = t.a === save.team || t.b === save.team;
                    return (
                      <tr key={i} className={ours ? 'bg-amber-300 text-slate-900 font-bold' : 'odd:bg-slate-800/50'}>
                        <td className={`py-0.5 ${t.winner === t.a ? 'font-bold' : ''}`}>{nameOf(save, t.a)}</td>
                        <td className="text-center tabular-nums whitespace-nowrap">
                          {t.winner ? `${t.ga}–${t.gb}${t.pens ? ` (${t.pens[0]}–${t.pens[1]}p)` : ''}` : 'v'}
                        </td>
                        <td className={`text-right ${t.winner === t.b ? 'font-bold' : ''}`}>{nameOf(save, t.b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="text-xs text-slate-500">Draw after the last round</p>}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-2">DDSL has no U10 cup, so this one is made up from the real clubs in Wayside’s U10 Sunday divisions. Cup ties are played the same Sunday as the league game.</p>
    </Panel>
  );
}


// ---------- logins ----------

const field = 'w-full text-sm px-2 py-2 bg-slate-900 border border-slate-500 text-slate-100';

function SignIn({ supabase, token, team, onDone }: { supabase: SupabaseClient; token: string; team: string; onDone: (msg?: string) => void }) {
  const [mode, setMode] = useState<'new' | 'login'>('new');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const go = async () => {
    setMsg(null);
    if (!email.includes('@')) return setMsg('Enter a parent’s email address.');
    if (password.length < 6) return setMsg('The password needs at least 6 characters.');
    if (mode === 'new' && name.trim().length < 2) return setMsg('Pick a manager nickname (2–20 letters).');
    setBusy(true);
    try {
      if (mode === 'new') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) {
          setMsg(/registered|exists/i.test(error.message) ? 'That email already has a login. Tap “Log in” instead.' : error.message);
          return;
        }
        if (!data.session) {
          setMsg('Sign-ups aren’t switched on yet. Ask the coach.');
          return;
        }
        const { data: res } = await supabase.rpc('game_join', { p_token: token, p_name: name });
        if (res === 'taken') return onDone(`“${name.trim()}” is already used on this team. Pick another nickname.`);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) { setMsg('Wrong email or password.'); return; }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-2 pt-6 space-y-2">
      <div className="text-center pb-2">
        <img src="/crest.jpg" alt="" className="w-16 h-16 mx-auto rounded border border-slate-400" />
        <h1 className="mt-2 text-lg font-bold">Wayside U10 Manager</h1>
        <p className="text-xs text-slate-300">Wayside {team}</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-slate-600 border border-slate-500 text-xs font-bold">
        {(['new', 'login'] as const).map((m) => (
          <button key={m} onClick={() => { setMode(m); setMsg(null); }} className={`py-2 uppercase ${mode === m ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}>
            {m === 'new' ? 'New manager' : 'Log in'}
          </button>
        ))}
      </div>
      <Panel title={mode === 'new' ? 'Make your login' : 'Log in'}>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          {mode === 'new' && <p className="text-xs text-slate-300">Ask a parent to put in their email and pick a password with you. Your game is saved to it, so you can play on any phone.</p>}
          <label className="block text-xs">Parent’s email
            <input className={field} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-xs">Password
            <input className={field} type="password" autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {mode === 'new' && (
            <label className="block text-xs">Manager nickname <span className="text-slate-400">(not your real name — others on the team see it)</span>
              <input className={field} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {msg && <p className="text-xs text-red-300">{msg}</p>}
          <div className="flex justify-end"><Btn type="submit" disabled={busy}>{busy ? 'Wait…' : mode === 'new' ? 'Start' : 'Log in'}</Btn></div>
          {mode === 'login' && <p className="text-[11px] text-slate-400">Forgot the password? Make a new login with a different email. The old game can’t be got back.</p>}
        </form>
      </Panel>
    </div>
  );
}

function Join({ supabase, token, team, hint, onDone, onSignOut }: {
  supabase: SupabaseClient; token: string; team: string; hint: string | null; onDone: () => void; onSignOut: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(hint);
  const go = async () => {
    setMsg(null);
    setBusy(true);
    const { data: res, error } = await supabase.rpc('game_join', { p_token: token, p_name: name });
    setBusy(false);
    if (error) return setMsg('Something went wrong. Try again.');
    if (res === 'taken') return setMsg('That nickname is already used on this team. Try another.');
    if (res === 'bad_name') return setMsg('Nicknames are 2–20 letters.');
    if (res === 'bad_link') return setMsg('This game link isn’t valid. Ask your coach for it again.');
    onDone();
  };
  return (
    <div className="p-2 pt-6 space-y-2">
      <Panel title={`Join Wayside ${team}`}>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <label className="block text-xs">Manager nickname <span className="text-slate-400">(not your real name — others on the team see it)</span>
            <input className={field} maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {msg && <p className="text-xs text-red-300">{msg}</p>}
          <div className="flex justify-between">
            <Btn tone="plain" onClick={onSignOut}>Log out</Btn>
            <Btn type="submit" disabled={busy || name.trim().length < 2}>Start</Btn>
          </div>
        </form>
      </Panel>
    </div>
  );
}

interface LeaderRow { manager_name: string; season: number; played: number; pts: number; pos: number | null; gd: number; cups: number; titles: number; me: boolean }

function Leaderboard({ supabase, token, team }: { supabase: SupabaseClient; token: string; team: string }) {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  useEffect(() => {
    supabase.rpc('game_leaderboard', { p_token: token }).then(({ data }) => setRows((data as LeaderRow[]) || []));
  }, [supabase, token]);
  return (
    <Panel title={`Wayside ${team} managers`}>
      {!rows ? <p className="text-xs text-slate-400">Loading…</p> : rows.length === 0 ? <p className="text-xs text-slate-400">No one else yet.</p> : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-300">
              <th className="font-normal text-left">#</th><th className="font-normal text-left">Manager</th>
              <th className="font-normal">Ssn</th><th className="font-normal">P</th><th className="font-normal">Pts</th>
              <th className="font-normal">Pos</th><th className="font-normal" title="League titles">🏆</th><th className="font-normal" title="Cups">Cup</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.manager_name} className={r.me ? 'bg-amber-300 text-slate-900 font-bold' : 'odd:bg-slate-800/50'}>
                <td className="py-0.5">{i + 1}</td>
                <td className="truncate max-w-[7rem]">{r.manager_name}</td>
                <td className="text-center tabular-nums">{r.season}</td>
                <td className="text-center tabular-nums">{r.played}</td>
                <td className="text-center tabular-nums">{r.pts}</td>
                <td className="text-center tabular-nums">{r.pos ?? '–'}</td>
                <td className="text-center tabular-nums">{r.titles}</td>
                <td className="text-center tabular-nums">{r.cups}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-slate-400 mt-2">Ranked by league titles, then cups, then season, then points. Pos = league position this season.</p>
    </Panel>
  );
}

// ---------- watching the match ----------

const SPEEDS = [
  { label: 'Slow', ms: 1400 },
  { label: 'Normal', ms: 600 },
  { label: 'Fast', ms: 150 },
];

function LiveScreen({ save, update, onFinished }: { save: Save; update: (fn: (s: Save) => void) => void; onFinished: () => void }) {
  const lm = save.live as LiveMatch;
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(lm.minute === 0);
  const [subSlot, setSubSlot] = useState<Slot | null>(null);
  const atHalf = lm.minute === HALF && !lm.talk;

  useEffect(() => {
    if (paused || lm.done || atHalf || subSlot) return;
    const t = setTimeout(() => update((s) => { if (s.live) stepLive(s, s.live); }), SPEEDS[speed].ms);
    return () => clearTimeout(t);
  }, [paused, lm.done, lm.minute, atHalf, subSlot, speed, update]);

  const them = shortName(lm.opp);
  const [homeName, awayName] = lm.home ? [save.team, them] : [them, save.team];
  const [hg, ag] = lm.home ? [lm.gf, lm.ga] : [lm.ga, lm.gf];
  const bench = Object.values(save.players).filter((p) => !Object.values(lm.onPitch).includes(p.id)).sort((a, b) => (lm.energy[b.id] || 0) - (lm.energy[a.id] || 0));
  const feed = lm.events.slice().reverse();
  const { possUs } = rates(save, lm);
  const clock = lm.minute <= HALF ? `${lm.minute}′` : `${lm.minute}′`;
  const title = lm.kind === 'cup' ? save.cup.rounds.find((r) => r.w === lm.w)?.name || 'Cup' : 'League';

  return (
    <div className="space-y-2">
      <div className="bg-slate-900 border border-slate-500">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center text-center py-2">
          <span className="font-bold text-sm">{homeName}</span>
          <span className="text-3xl font-bold tabular-nums px-3 text-amber-300">{hg} – {ag}</span>
          <span className="font-bold text-sm">{awayName}</span>
        </div>
        <div className="flex justify-between px-2 pb-1 text-[11px] text-slate-300">
          <span>{title}</span>
          <span className="font-bold text-slate-100 tabular-nums">{lm.done ? 'FT' : atHalf ? 'HT' : clock}</span>
          <span>{TACTICS.find((t) => t.id === lm.tactic)?.label}</span>
        </div>
        <div className="h-1 bg-slate-700"><div className="h-1 bg-amber-300" style={{ width: `${(lm.minute / FULL) * 100}%` }} /></div>
      </div>

      {atHalf && (
        <Panel title="Half-time team talk">
          <p className="text-sm mb-2">{lm.gf > lm.ga ? 'You’re winning.' : lm.gf < lm.ga ? 'You’re losing.' : 'It’s level.'} What do you say to the players?</p>
          <div className="space-y-1">
            {TALKS.map((t) => (
              <button key={t.id} onClick={() => update((s) => { if (s.live) teamTalk(s, s.live, t.id); })} className="w-full text-left text-sm px-2 py-2 border bg-slate-800 border-slate-600">
                “{t.label}”
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">You can also make subs or change tactics below before the second half.</p>
        </Panel>
      )}

      <Panel title="Commentary">
        <ul className="space-y-1 max-h-56 overflow-y-auto text-xs">
          {feed.map((e, i) => (
            <li
              key={feed.length - i}
              className={e.kind === 'goal' ? (e.side === 'us' ? 'text-lime-300 font-bold text-sm' : 'text-red-300 font-bold text-sm') : e.kind === 'whistle' ? 'text-amber-200 font-bold' : e.kind === 'sub' || e.kind === 'talk' ? 'text-sky-300' : e.kind === 'fun' ? 'text-fuchsia-300 italic' : 'text-slate-200'}
            >
              <span className="text-slate-400 tabular-nums mr-1">{e.m}′</span>{e.text}
            </li>
          ))}
        </ul>
      </Panel>

      {lm.done ? (
        <div className="flex justify-end"><Btn onClick={onFinished}>Match report</Btn></div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-1">
            <Btn tone={paused ? 'go' : 'plain'} onClick={() => setPaused(!paused)} disabled={atHalf}>{paused ? (lm.minute === 0 ? 'Kick off' : 'Play') : 'Pause'}</Btn>
            <div className="grid grid-cols-3 gap-px bg-slate-600 border border-slate-500 text-[11px] font-bold">
              {SPEEDS.map((sp, i) => (
                <button key={sp.label} onClick={() => setSpeed(i)} className={`px-2 py-1.5 ${speed === i ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}>{sp.label}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-px bg-slate-600 border border-slate-500 text-xs font-bold">
            {TACTICS.map((t) => (
              <button key={t.id} onClick={() => update((s) => { if (s.live) setTactic(s.live, t.id as Tactic); })} className={`py-1.5 ${lm.tactic === t.id ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      <Panel title="Your team" right={<span className="text-[10px]">Possession {Math.round(possUs * 100)}% · shots {lm.shots[0]}–{lm.shots[1]}</span>}>
        <p className="text-[11px] text-slate-300 mb-1">{lm.done ? 'Energy at the final whistle.' : 'Tap a player to sub them or move them. Tired players play worse — bench players get their energy back.'}</p>
        <div className="space-y-1">
          {SLOTS.map(({ id: slot, short }) => {
            const pid = lm.onPitch[slot];
            const p = pid ? save.players[pid] : undefined;
            const e = pid ? lm.energy[pid] || 0 : 0;
            return (
              <button
                key={slot}
                disabled={lm.done}
                onClick={() => setSubSlot(subSlot === slot ? null : slot)}
                className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1 border ${subSlot === slot ? 'border-amber-300 bg-slate-700' : 'border-slate-600 bg-slate-800'}`}
              >
                <span className="w-7 font-bold text-slate-300">{short}</span>
                <span className="flex-1 font-bold">{p?.name || '— empty —'}</span>
                <EnergyBar e={e} />
              </button>
            );
          })}
        </div>
        {subSlot && !lm.done && (
          <div className="mt-2 border border-amber-300 p-2">
            <p className="text-xs font-bold mb-1">Who goes to {subSlot.toUpperCase()}?</p>
            <div className="space-y-1">
              {[...bench, ...SLOTS.filter((x) => x.id !== subSlot && lm.onPitch[x.id]).map((x) => save.players[lm.onPitch[x.id]!])].filter(Boolean).map((p) => {
                const onPitch = Object.values(lm.onPitch).includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => { update((s) => { if (s.live) subLive(s, s.live, subSlot, p.id); }); setSubSlot(null); }}
                    className="w-full flex items-center gap-2 text-left text-xs px-2 py-1 border border-slate-600 bg-slate-900"
                  >
                    <span className="flex-1">{onPitch ? '↔ ' : '⬆ '}<b>{p.name}</b> <span className="text-slate-400 uppercase">{p.positions[0] || ''}</span>{onPitch && <span className="text-slate-400"> (swap)</span>}</span>
                    <EnergyBar e={lm.energy[p.id] || 0} />
                  </button>
                );
              })}
            </div>
            <div className="flex justify-end mt-1"><Btn tone="plain" onClick={() => setSubSlot(null)}>Cancel</Btn></div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function EnergyBar({ e }: { e: number }) {
  const c = e > 70 ? 'bg-lime-400' : e > 45 ? 'bg-amber-300' : 'bg-red-400';
  return (
    <span className="flex items-center gap-1 w-20">
      <span className="flex-1 h-1.5 bg-slate-700"><span className={`block h-1.5 ${c}`} style={{ width: `${Math.round(e)}%` }} /></span>
      <span className="tabular-nums text-[10px] text-slate-400 w-6 text-right">{Math.round(e)}</span>
    </span>
  );
}
