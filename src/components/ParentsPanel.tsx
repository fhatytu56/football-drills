'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Copy, Check, ChevronDown, ChevronUp, MessageCircle, CalendarDays } from 'lucide-react';
import type { AgeGroup } from '@/lib/groups';
import { buildMessage, hhmm, matchTitle, shortDate, todayInIreland, type Answer, type MatchDetails } from '@/lib/matches';

interface Team {
  id: string;
  name: string;
}
interface Player {
  id: string;
  team_id: string | null;
  first_name: string;
}
interface Match {
  id: string;
  team_id: string;
  match_date: string;
  meet_time: string | null;
  kickoff: string;
  opponent: string;
  kickoff_2: string | null;
  opponent_2: string | null;
  home_away: 'home' | 'away';
  location: string | null;
  kit: string | null;
  notes: string | null;
  share_token: string;
}
interface AnswerRow {
  match_id: string;
  player_id: string;
  answer: 'yes' | 'no';
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

export default function ParentsPanel({ group }: { group: AgeGroup }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<'new' | string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  const load = async () => {
    try {
      const [squad, m] = await Promise.all([
        send(`/api/squad?group=${group.id}`, 'GET'),
        send(`/api/matches?group=${group.id}`, 'GET'),
      ]);
      setTeams(squad.teams || []);
      setPlayers(squad.players || []);
      setMatches(m.matches || []);
      setAnswers(m.answers || []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  const today = todayInIreland();
  const upcoming = matches.filter((m) => m.match_date >= today);
  const past = matches.filter((m) => m.match_date < today).reverse();
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name || '?';

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  if (loading) return <p className="text-center text-slate-500 py-10">Loading matches...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-emerald-400" /> {group.label} Matches
        </h2>
        <p className="text-xs text-slate-300 mt-1">
          Add a match, share it to the team&apos;s WhatsApp group, and see who can play. Parents tap Yes or No — no login.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg p-3">
          {error}
        </div>
      )}

      {teams.length === 0 ? (
        <div className="text-center py-8 bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-slate-500 font-medium text-sm">No teams yet.</p>
          <p className="text-slate-400 text-xs mt-1">Create a team and add players in the Squad tab first.</p>
        </div>
      ) : formFor === 'new' ? (
        <MatchForm
          group={group}
          teams={teams}
          onCancel={() => setFormFor(null)}
          onSave={async (values) => {
            if (await run(() => send('/api/matches', 'POST', { ...values, age_group: group.id }))) setFormFor(null);
          }}
        />
      ) : (
        <button
          onClick={() => setFormFor('new')}
          className="w-full bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-bold py-3 rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" /> New match
        </button>
      )}

      {upcoming.length === 0 && teams.length > 0 && formFor !== 'new' && (
        <p className="text-center text-slate-400 text-xs">No upcoming matches.</p>
      )}

      {upcoming.map((m) =>
        formFor === m.id ? (
          <MatchForm
            key={m.id}
            group={group}
            teams={teams}
            initial={m}
            onCancel={() => setFormFor(null)}
            onSave={async (values) => {
              if (await run(() => send('/api/matches', 'PATCH', { ...values, id: m.id }))) setFormFor(null);
            }}
          />
        ) : (
          <MatchCard
            key={m.id}
            match={m}
            team={teamName(m.team_id)}
            players={players.filter((p) => p.team_id === m.team_id)}
            answers={answers.filter((a) => a.match_id === m.id)}
            open={open === m.id}
            onToggle={() => setOpen(open === m.id ? null : m.id)}
            onEdit={() => setFormFor(m.id)}
            onDelete={async () => {
              if (!confirm(`Delete ${matchTitle({ ...m, team: teamName(m.team_id) })}? Parents' answers will be lost.`)) return;
              await run(() => send(`/api/matches?id=${m.id}`, 'DELETE'));
            }}
            onAnswer={(playerId, answer) =>
              run(() => send('/api/availability', 'PATCH', { match_id: m.id, player_id: playerId, answer }))
            }
          />
        )
      )}

      {past.length > 0 && (
        <div>
          <button
            onClick={() => setShowPast(!showPast)}
            className="text-xs font-bold text-slate-500 flex items-center gap-1 mx-auto"
          >
            {showPast ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Past matches ({past.length})
          </button>
          {showPast && (
            <ul className="mt-2 bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
              {past.slice(0, 10).map((m) => {
                const yes = answers.filter((a) => a.match_id === m.id && a.answer === 'yes').length;
                return (
                  <li key={m.id} className="px-4 py-2.5 flex justify-between gap-3 text-xs">
                    <span className="text-slate-700 font-semibold">{matchTitle({ ...m, team: teamName(m.team_id) })}</span>
                    <span className="text-slate-400 shrink-0">
                      {shortDate(m.match_date)} · {yes} played
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match,
  team,
  players,
  answers,
  open,
  onToggle,
  onEdit,
  onDelete,
  onAnswer,
}: {
  match: Match;
  team: string;
  players: Player[];
  answers: AnswerRow[];
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAnswer: (playerId: string, answer: Answer) => void;
}) {
  const [copied, setCopied] = useState(false);
  const details: MatchDetails = { ...match, team };
  const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${match.share_token}` : '';
  const message = useMemo(() => buildMessage(details, link), [JSON.stringify(details), link]); // eslint-disable-line react-hooks/exhaustive-deps
  const answerOf = (id: string): Answer => answers.find((a) => a.player_id === id)?.answer || null;
  const yes = players.filter((p) => answerOf(p.id) === 'yes');
  const no = players.filter((p) => answerOf(p.id) === 'no');
  const none = players.length - yes.length - no.length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this message:', message);
    }
  };

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="p-4 space-y-3">
        <div className="flex justify-between items-start gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-base leading-snug">{matchTitle(details)}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {shortDate(match.match_date)}
              {match.meet_time ? ` · Meet ${hhmm(match.meet_time)}` : ''} · KO {hhmm(match.kickoff)}
              {match.kickoff_2 ? ` & ${hhmm(match.kickoff_2)}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button aria-label="Edit match" onClick={onEdit} className="p-1.5 text-slate-400 hover:text-slate-700 rounded">
              <Pencil className="w-4 h-4" />
            </button>
            <button aria-label="Delete match" onClick={onDelete} className="p-1.5 text-slate-400 hover:text-red-600 rounded">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <button
          onClick={onToggle}
          aria-expanded={open}
          className="w-full flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold"
        >
          <span className="flex gap-3">
            <span className="text-emerald-700">{yes.length} Yes</span>
            <span className="text-slate-600">{no.length} No</span>
            <span className="text-amber-700">{none} No reply</span>
          </span>
          <span className="text-slate-500 flex items-center gap-1">
            Who&apos;s playing {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {open && (
          <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            {players.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No players in {team} yet.</li>}
            {players.map((p) => {
              const a = answerOf(p.id);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-800">{p.first_name}</span>
                  <span className="flex gap-1" role="group" aria-label={`${p.first_name} answer`}>
                    {([
                      ['yes', 'Yes'],
                      ['no', 'No'],
                      [null, '–'],
                    ] as const).map(([v, label]) => (
                      <button
                        key={label}
                        aria-pressed={a === v}
                        aria-label={v ? label : 'No reply'}
                        onClick={() => a !== v && onAnswer(p.id, v)}
                        className={`w-11 py-1 rounded-md text-xs font-bold border ${
                          a === v
                            ? v === 'yes'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : v === 'no'
                              ? 'bg-slate-700 text-white border-slate-700'
                              : 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-white text-slate-500 border-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 bg-[#1f8f4e] hover:bg-[#187a42] text-white text-xs font-bold py-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-sm"
          >
            <MessageCircle className="w-4 h-4" /> Share to WhatsApp
          </a>
          <button
            onClick={copy}
            className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-3 rounded-lg flex items-center gap-1.5"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </article>
  );
}

type FormValues = {
  team_id: string;
  match_date: string;
  meet_time: string;
  kickoff: string;
  opponent: string;
  kickoff_2: string;
  opponent_2: string;
  home_away: 'home' | 'away';
  location: string;
  kit: string;
  notes: string;
};

function MatchForm({
  group,
  teams,
  initial,
  onSave,
  onCancel,
}: {
  group: AgeGroup;
  teams: Team[];
  initial?: Match;
  onSave: (v: FormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FormValues>({
    team_id: initial?.team_id || (teams.length === 1 ? teams[0].id : ''),
    match_date: initial?.match_date || '',
    meet_time: hhmm(initial?.meet_time),
    kickoff: hhmm(initial?.kickoff),
    opponent: initial?.opponent || '',
    kickoff_2: hhmm(initial?.kickoff_2),
    opponent_2: initial?.opponent_2 || '',
    home_away: initial?.home_away || 'home',
    location: initial?.location || '',
    kit: initial?.kit || '',
    notes: initial?.notes || '',
  });
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV({ ...v, [k]: e.target.value });

  const input =
    'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600';
  const label = 'block text-[11px] font-bold text-slate-600 uppercase mb-1';
  const twoGames = group.aSide === 5;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="bg-white rounded-xl border-2 border-emerald-600 shadow-sm p-4 space-y-3"
    >
      <h3 className="font-bold text-slate-900">{initial ? 'Edit match' : 'New match'}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="m-team">Team</label>
          <select id="m-team" required value={v.team_id} onChange={set('team_id')} className={input}>
            <option value="">Choose…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="m-date">Date</label>
          <input id="m-date" type="date" required value={v.match_date} onChange={set('match_date')} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="m-meet">Meet time</label>
          <input id="m-meet" type="time" value={v.meet_time} onChange={set('meet_time')} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="m-ko">{twoGames ? 'Game 1 kick-off' : 'Kick-off'}</label>
          <input id="m-ko" type="time" required value={v.kickoff} onChange={set('kickoff')} className={input} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="m-opp">{twoGames ? 'Game 1 opponent' : 'Opponent'}</label>
        <input id="m-opp" required maxLength={60} value={v.opponent} onChange={set('opponent')} placeholder="e.g. Kilternan" className={input} />
      </div>

      {twoGames && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="m-ko2">Game 2 kick-off</label>
            <input id="m-ko2" type="time" value={v.kickoff_2} onChange={set('kickoff_2')} className={input} />
          </div>
          <div>
            <label className={label} htmlFor="m-opp2">Game 2 opponent</label>
            <input id="m-opp2" maxLength={60} value={v.opponent_2} onChange={set('opponent_2')} className={input} />
          </div>
        </div>
      )}

      <div>
        <span className={label}>Home or away</span>
        <div className="flex bg-slate-200 p-1 rounded-xl gap-1" role="group" aria-label="Home or away">
          {(['home', 'away'] as const).map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={v.home_away === h}
              onClick={() => setV({ ...v, home_away: h })}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg ${
                v.home_away === h ? 'bg-white text-emerald-800 shadow' : 'text-slate-600'
              }`}
            >
              {h === 'home' ? 'Home' : 'Away'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={label} htmlFor="m-loc">Location</label>
        <input id="m-loc" maxLength={120} value={v.location} onChange={set('location')} placeholder="Ground name or Eircode" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="m-kit">Kit</label>
        <input id="m-kit" maxLength={80} value={v.kit} onChange={set('kit')} placeholder="e.g. Home kit, shin guards, water" className={input} />
      </div>
      <div>
        <label className={label} htmlFor="m-notes">Notes</label>
        <textarea id="m-notes" maxLength={300} rows={2} value={v.notes} onChange={set('notes')} className={input} />
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 py-2.5 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">
          Cancel
        </button>
        <button type="submit" className="flex-1 py-2.5 text-xs font-bold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800">
          Save match
        </button>
      </div>
    </form>
  );
}
