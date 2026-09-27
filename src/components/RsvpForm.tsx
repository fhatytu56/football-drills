'use client';

import { useEffect, useState } from 'react';
import { MapPin, Clock, Shirt, StickyNote, Check } from 'lucide-react';
import { hhmm, longDate, mapsLink, matchTitle, type Answer, type MatchDetails } from '@/lib/matches';

interface Row {
  id: string;
  first_name: string;
  answer: Answer;
}

export default function RsvpForm({ token }: { token: string }) {
  const [match, setMatch] = useState<MatchDetails | null>(null);
  const [players, setPlayers] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/rsvp/${token}`, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setMatch(data.match);
        setPlayers(data.players);
      })
      .catch((e) => setError(e.message || 'This link is not valid.'));
  }, [token]);

  const answer = async (p: Row, value: 'yes' | 'no') => {
    setSaving(p.id);
    setSaved(null);
    try {
      const r = await fetch(`/api/rsvp/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: p.id, answer: value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setPlayers((list) => list.map((x) => (x.id === p.id ? { ...x, answer: value } : x)));
      setSaved(`Thanks! ${p.first_name}: ${value === 'yes' ? 'Yes, can play' : 'No, can’t play'}.`);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not save. Try again.');
    } finally {
      setSaving(null);
    }
  };

  const yes = players.filter((p) => p.answer === 'yes').length;

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-emerald-800 text-white px-4 pt-6 pb-5">
        <div className="max-w-md mx-auto flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crest.jpg" alt="Wayside Celtic F.C. crest" className="w-12 h-12 rounded-full bg-white p-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-200">Wayside Celtic</p>
            <h1 className="text-lg font-bold leading-tight">{match ? matchTitle(match) : 'Match availability'}</h1>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 -mt-2 space-y-4">
        {match && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2 text-sm text-slate-700 mt-4">
            <p className="font-bold text-slate-900">{longDate(match.match_date)}</p>
            {match.opponent_2 && match.kickoff_2 ? (
              <>
                {match.meet_time && (
                  <p className="flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" /> Meet {hhmm(match.meet_time)}</p>
                )}
                <p className="pl-6">Game 1: {hhmm(match.kickoff)} v {match.opponent}</p>
                <p className="pl-6">Game 2: {hhmm(match.kickoff_2)} v {match.opponent_2}</p>
              </>
            ) : (
              <p className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                {match.meet_time ? `Meet ${hhmm(match.meet_time)} · ` : ''}Kick-off {hhmm(match.kickoff)}
              </p>
            )}
            {match.location && (
              <p className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <a href={mapsLink(match.location)} target="_blank" rel="noopener noreferrer" className="text-emerald-700 font-semibold underline">
                  {match.location}
                </a>
              </p>
            )}
            {match.kit && (
              <p className="flex items-center gap-2"><Shirt className="w-4 h-4 text-slate-400" /> {match.kit}</p>
            )}
            {match.notes && (
              <p className="flex items-start gap-2"><StickyNote className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" /> {match.notes}</p>
            )}
          </section>
        )}

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm font-semibold rounded-xl p-4 mt-4">
            {error}
          </div>
        )}
        {saved && (
          <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-semibold rounded-xl p-3 flex items-center gap-2">
            <Check className="w-4 h-4" /> {saved}
          </div>
        )}

        {match && (
          <section className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <header className="px-4 pt-3 pb-2 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">Can your child play?</h2>
              <p className="text-xs text-slate-500">Find your child and tap Yes or No. You can change it until match day.</p>
            </header>
            <ul className="divide-y divide-slate-100">
              {players.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="font-semibold text-slate-800">{p.first_name}</span>
                  <span className="flex gap-2" role="group" aria-label={`${p.first_name} can play?`}>
                    {(['yes', 'no'] as const).map((v) => (
                      <button
                        key={v}
                        disabled={saving === p.id}
                        aria-pressed={p.answer === v}
                        onClick={() => answer(p, v)}
                        className={`w-16 py-2 rounded-lg text-sm font-bold border transition disabled:opacity-50 ${
                          p.answer === v
                            ? v === 'yes'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-slate-700 text-white border-slate-700'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {v === 'yes' ? 'Yes' : 'No'}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">{yes} said yes so far.</p>
          </section>
        )}

        {!match && !error && <p className="text-center text-slate-500 py-10">Loading…</p>}
      </div>
    </main>
  );
}
