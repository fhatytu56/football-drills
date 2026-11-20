'use client';

// Wayside U10 Manager — a Championship Manager 99/00-style game for the kids.
// Everyone starts equal. Players only improve by "running" the real Tuesday/Thursday drills,
// which means remembering them. Weeks go at the kid's own pace: Tue, Thu, Sunday match, Next week.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { divisionFor, shortName } from '@/lib/game/ddsl';
import {
  STATS, SLOTS, PHASE_LABEL, PHASE_STATS,
  newSave, syncSquad, playWeek, questionsFor, runSession, weekState, currentWeek, nextWeek, dayOf,
  table, seasonOver, autoLineup, fits, cupRoundIn,
  type Save, type PlanDrill, type LibDrill, type Question, type MatchResult, type SessionResult, type Slot, type StatKey,
} from '@/lib/game/engine';

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

const storeKey = (token: string) => `wcfc-u10-game-${token}`;

function loadSave(token: string): Save | null {
  try {
    const raw = window.localStorage.getItem(storeKey(token));
    return raw ? (JSON.parse(raw) as Save) : null;
  } catch {
    return null;
  }
}

function storeSave(token: string, s: Save) {
  try {
    window.localStorage.setItem(storeKey(token), JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

function statClass(v: number) {
  if (v >= 16) return 'text-emerald-300 font-bold';
  if (v >= 11) return 'text-lime-300';
  if (v >= 6) return 'text-amber-300';
  return 'text-red-400';
}

const nameOf = (s: Save, team: string) => (team === s.team ? s.team : shortName(team));

// ---------- shell ----------

export default function GameApp({ token }: { token: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<Save | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
  const [session, setSession] = useState<Day | null>(null);
  const [showMatch, setShowMatch] = useState<{ w: number; which: 'match' | 'cup' } | null>(null);
  const [news, setNews] = useState<string[]>([]);
  const [storeOk, setStoreOk] = useState(true);
  const today = useMemo(todayIso, []);

  useEffect(() => {
    fetch(`/api/game/${token}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Try again.');
        return j as TeamData;
      })
      .then((d) => {
        setData(d);
        const s = loadSave(token);
        if (s && divisionFor(d.team)?.name === s.division) {
          syncSquad(s, d.players);
          setStoreOk(storeSave(token, s));
          setSave(s);
        }
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [token, today]);

  const update = useCallback(
    (fn: (s: Save) => void) => {
      setSave((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        fn(next);
        setStoreOk(storeSave(token, next));
        return next;
      });
    },
    [token]
  );

  if (error) return <Frame><Panel title="Wayside U10 Manager"><p className="text-sm">{error}</p></Panel></Frame>;
  if (!data || !loaded) return <Frame><p className="text-center text-slate-300 py-16 text-sm">Loading…</p></Frame>;

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

  if (!save) {
    return (
      <Frame>
        <Intro
          team={data.team}
          division={div.name}
          squad={data.players.length}
          onStart={() => {
            const s = newSave({ team: `Wayside ${data.team}`, division: div.name, today, players: data.players });
            setStoreOk(storeSave(token, s));
            setSave(s);
          }}
        />
      </Frame>
    );
  }

  const w = currentWeek(save);

  return (
    <Frame>
      <TopBar save={save} />
      <nav className="grid grid-cols-6 gap-px bg-slate-600 border-y border-slate-500 text-[11px] font-bold">
        {(['home', 'squad', 'tactics', 'fixtures', 'table', 'cup'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSession(null); setShowMatch(null); }}
            className={`py-2 uppercase tracking-wide ${tab === t && !session && !showMatch ? 'bg-amber-300 text-slate-900' : 'bg-slate-800 text-slate-200'}`}
          >
            {t === 'home' ? 'Inbox' : t}
          </button>
        ))}
      </nav>

      {!storeOk && (
        <p className="m-2 text-[11px] bg-red-900/60 border border-red-700 p-2">
          This browser won’t keep your save (private mode?). Progress will be lost when you close it.
        </p>
      )}

      <div className="p-2 space-y-2">
        {session ? (
          <Training
            save={save}
            w={w}
            day={session}
            plan={data.plan}
            library={data.library}
            onFinish={(qs, picks, focus) => {
              update((s) => { weekState(s, w)[session] = runSession(s, data.plan, qs, picks, focus); });
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
            onTrain={setSession}
            onPlay={() => {
              update((s) => { playWeek(s, w, false); });
              setShowMatch({ w, which: 'match' });
            }}
            onShowMatch={(which, wk) => setShowMatch({ w: wk, which })}
            onNextWeek={() => { setNews([]); update((s) => { nextWeek(s); }); }}
            onNewSeason={() => {
              const s = newSave({ team: save.team, division: save.division, today, players: data.players, season: save.season + 1, carry: save });
              setStoreOk(storeSave(token, s));
              setSave(s);
              setNews([`Season ${s.season}. Your players keep what they learned, but every other team has got better too.`]);
            }}
          />
        ) : tab === 'squad' ? (
          <Squad save={save} w={w} />
        ) : tab === 'tactics' ? (
          <Tactics save={save} update={update} locked={!!save.log[w]?.match && !seasonOver(save)} />
        ) : tab === 'fixtures' ? (
          <Fixtures save={save} onShow={(wk) => setShowMatch({ w: wk, which: 'match' })} />
        ) : tab === 'table' ? (
          <LeagueTable save={save} />
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

function TopBar({ save }: { save: Save }) {
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
        <p className="text-slate-300">
          Week {Math.min(w + 1, save.weeks)}/{save.weeks}
          {started && <> · {pos}{['th', 'st', 'nd', 'rd'][pos % 10 > 3 || Math.floor(pos / 10) === 1 ? 0 : pos % 10]}</>}
        </p>
      </div>
    </header>
  );
}

function Btn({ children, onClick, disabled, tone = 'go' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: 'go' | 'plain' }) {
  return (
    <button
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

function Intro({ team, division, squad, onStart }: { team: string; division: string; squad: number; onStart: () => void }) {
  return (
    <div className="p-2 pt-6 space-y-2">
      <div className="text-center pb-2">
        <img src="/crest.jpg" alt="" className="w-16 h-16 mx-auto rounded border border-slate-400" />
        <h1 className="mt-2 text-lg font-bold">Wayside U10 Manager</h1>
      </div>
      <Panel title="Your new job">
        <div className="text-sm space-y-2">
          <p>You’re the manager of <b>Wayside {team}</b> in the DDSL <b>{division} Boys Sunday</b> league.</p>
          <p>All {squad} players start at exactly the same level. The only way to make them better is training.</p>
          <p><b>Tuesday and Thursday:</b> run the drills you did at real training. Remember them right and your players improve more.</p>
          <p><b>Sunday:</b> pick your team and play the match. Win the league. Win the cup.</p>
          <p className="text-slate-300 text-xs">Play as many weeks as you like. Skip training and your players don’t improve that week.</p>
        </div>
      </Panel>
      <div className="flex justify-end"><Btn onClick={onStart}>Start season</Btn></div>
    </div>
  );
}

// ---------- home / inbox ----------

function Home({ save, w, plan, news, onTrain, onPlay, onShowMatch, onNextWeek, onNewSeason }: {
  save: Save; w: number; plan: PlanDrill[]; news: string[];
  onTrain: (d: Day) => void; onPlay: () => void; onShowMatch: (which: 'match' | 'cup', w: number) => void;
  onNextWeek: () => void; onNewSeason: () => void;
}) {
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
      </>
    );
  }

  const ws = save.log[w] || {};
  const fx = save.schedule.find((f) => f.w === w);
  const cupK = cupRoundIn(save, w);
  const cupTie = cupK >= 0 && !save.cup.out ? save.cup.rounds[cupK].ties.find((t) => t.a === save.team || t.b === save.team) : undefined;
  const last = [...save.schedule].reverse().find((f) => f.w < w && save.log[f.w]?.match);

  const sessionRow = (day: Day) => {
    const res = ws[day];
    const date = dayOf[day](save, w);
    const drills = plan.filter((d) => d.day === day).length;
    let status: React.ReactNode;
    if (res?.status === 'done') status = <span className="text-lime-300">Done · {res.answers.filter((a) => a.correct).length}/{res.answers.length} remembered</span>;
    else if (res?.status === 'missed') status = <span className="text-red-400">Missed</span>;
    else if (ws.match) status = <span className="text-red-400">Missed</span>;
    else if (!drills) status = <span className="text-slate-400">No drills planned yet</span>;
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
                <Btn onClick={onPlay}>Play match</Btn>
              </>
            )}
          </div>
          {ws.match && <div className="flex justify-end mt-2"><Btn onClick={onNextWeek}>Next week ▶</Btn></div>}
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
  onFinish: (qs: Question[], picks: number[], focus: string[]) => void; onClose: () => void;
}) {
  const qs: Question[] = useMemo(() => questionsFor(save, w, day, plan, library), [save.seed, w, day, plan, library]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = save.log[w]?.[day];
  const [focus, setFocus] = useState<string[]>([]);
  const [step, setStep] = useState<'focus' | number | 'report'>(done ? 'report' : 'focus');
  const [picks, setPicks] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const players = Object.values(save.players).sort((a, b) => a.name.localeCompare(b.name));

  if (step === 'report' || done) {
    const res = done;
    if (!res) return null;
    return (
      <Panel title={`${DAY_NAME[day]} training report`}>
        <div className="space-y-2 text-sm">
          <p>
            Remembered <b>{res.answers.filter((a) => a.correct).length} of {res.answers.length}</b> drills.
            {res.focus.length > 0 && <> Extra coaching: <b>{res.focus.map((id) => save.players[id]?.name).filter(Boolean).join(' & ')}</b>.</>}
          </p>
          <ul className="space-y-1">
            {res.answers.map((a) => (
              <li key={a.drillId} className="text-xs border border-slate-600 p-1.5">
                <span className={a.correct ? 'text-lime-300' : 'text-red-400'}>{a.correct ? '✓' : '✗'}</span> <b>{a.title}</b>{' '}
                <span className="text-slate-400">· {PHASE_LABEL[a.phase] || a.phase} · trains {(PHASE_STATS[a.phase] || []).map((k) => STATS.find((x) => x.key === k)?.label).join(', ')}</span>
                {!a.correct && <p className="text-slate-300 mt-0.5">{a.prompt} Answer: <b>{a.right}</b></p>}
              </li>
            ))}
          </ul>
          <GainsTable save={save} res={res} />
          <div className="flex justify-end"><Btn onClick={onClose}>Continue</Btn></div>
        </div>
      </Panel>
    );
  }

  if (step === 'focus') {
    return (
      <Panel title={`${DAY_NAME[day]} training · extra coaching`}>
        <p className="text-sm mb-2">Pick 2 players to give extra coaching. They improve twice as much today.</p>
        <div className="grid grid-cols-2 gap-1">
          {players.map((p) => {
            const on = focus.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => setFocus(on ? focus.filter((x) => x !== p.id) : focus.length < 2 ? [...focus, p.id] : [focus[1], p.id])}
                className={`text-left text-sm px-2 py-1.5 border ${on ? 'bg-amber-300 text-slate-900 border-amber-200 font-bold' : 'bg-slate-800 border-slate-600'}`}
              >
                {p.name}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <Btn tone="plain" onClick={onClose}>Back</Btn>
          <Btn disabled={focus.length !== 2} onClick={() => setStep(0)}>Start training</Btn>
        </div>
      </Panel>
    );
  }

  const i = step;
  const q = qs[i];
  const d = plan.find((x) => x.drill_id === q.drillId)!;
  const answered = picked !== null;
  return (
    <Panel title={`${DAY_NAME[day]} training · drill ${i + 1} of ${qs.length}`}>
      <p className="text-sm font-bold mb-2">{q.prompt}</p>
      <div className="space-y-1">
        {q.options.map((o, k) => {
          const cls = !answered
            ? 'bg-slate-800 border-slate-600'
            : k === q.answer
              ? 'bg-lime-700 border-lime-400'
              : k === picked
                ? 'bg-red-800 border-red-500'
                : 'bg-slate-800 border-slate-700 text-slate-400';
          return (
            <button key={k} disabled={answered} onClick={() => setPicked(k)} className={`w-full text-left text-sm px-2 py-2 border ${cls}`}>
              {o}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="mt-2 border border-slate-600 p-2 flex gap-2 items-start">
          {d.thumbnail_url && <img src={d.thumbnail_url} alt="" className="w-20 h-14 object-cover border border-slate-500" />}
          <div className="text-xs">
            <p className={picked === q.answer ? 'text-lime-300 font-bold' : 'text-red-400 font-bold'}>
              {picked === q.answer ? 'Well remembered! Full training boost.' : 'Not quite. Small boost this time.'}
            </p>
            <p className="mt-0.5"><b>{d.title}</b> · {PHASE_LABEL[d.game_phase] || d.game_phase}</p>
            <p className="text-slate-300">Trains {(PHASE_STATS[d.game_phase] || []).map((k) => STATS.find((x) => x.key === k)?.label).join(', ')}</p>
          </div>
        </div>
      )}
      <div className="flex justify-end mt-2">
        <Btn
          disabled={!answered}
          onClick={() => {
            const all = [...picks, picked!];
            setPicks(all);
            setPicked(null);
            if (i + 1 < qs.length) setStep(i + 1);
            else {
              onFinish(qs, all, focus);
              setStep('report');
            }
          }}
        >
          {i + 1 < qs.length ? 'Next drill' : 'Finish training'}
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

function Squad({ save, w }: { save: Save; w: number }) {
  const players = Object.values(save.players).sort((a, b) => a.name.localeCompare(b.name));
  const weekGains = (id: string, k: StatKey) =>
    (['tuesday', 'thursday'] as Day[]).reduce((a, d) => a + (save.log[w]?.[d]?.gains[id]?.[k] || 0), 0);
  return (
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
                  <td key={s.key} className={`text-center tabular-nums ${statClass(p.s[s.key])}`}>
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
        {STATS.map((s) => `${s.short} ${s.label}`).join(' · ')}. ▲ = trained up this week.
      </p>
    </Panel>
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
      <div className="bg-gradient-to-b from-green-800 to-green-700 border border-green-500 p-2 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-center gap-2">
            {r.map((slot) => {
              const id = save.lineup[slot];
              const p = id ? save.players[id] : undefined;
              const off = p && !fits(p, slot);
              return (
                <label key={slot} className="flex flex-col items-center w-[31%]">
                  <span className="text-[10px] font-bold text-green-100">{SLOTS.find((x) => x.id === slot)?.short}</span>
                  <select
                    aria-label={`Player at ${slot}`}
                    value={id || ''}
                    onChange={(e) => set(slot, e.target.value)}
                    className={`w-full text-xs px-1 py-1 bg-slate-900 border ${off ? 'border-amber-400' : 'border-slate-500'} text-slate-100`}
                  >
                    <option value="">— empty —</option>
                    {players.map((pl) => (
                      <option key={pl.id} value={pl.id}>{pl.name}{inTeam.has(pl.id) && pl.id !== id ? ' (in team)' : ''}</option>
                    ))}
                  </select>
                  {off && <span className="text-[9px] text-amber-200">not their position</span>}
                </label>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-300 mt-2">
        Picking someone already in the team swaps them. Players out of their usual position play a bit worse. Your keeper’s <b>GK</b> number matters most in goal.
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

