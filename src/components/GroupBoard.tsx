'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Play, Pause, RotateCcw, ArrowUp, ArrowDown, Timer, Clock, AlertTriangle, X, ExternalLink, ChevronLeft, LogIn, LogOut } from 'lucide-react';
import AddDrillModal from '@/components/AddDrillModal';
import { signOut } from '@/app/login/actions';
import { DAY_LABEL, SESSION_BUDGET_MINS, type AgeGroup, type TrainingDay } from '@/lib/groups';

interface Drill {
  id: string;
  title: string;
  url: string;
  platform: string;
  age_category: string;
  game_phase: string;
  player_count_min: number;
  player_count_max: number;
}

interface SessionItem {
  id: string;
  training_day: TrainingDay;
  drill_id: string;
  drills: Drill;
  duration?: number;
  order_index?: number;
}

interface GroupBoardProps {
  group: AgeGroup;
  canEdit: boolean;
  signedIn: boolean;
}

export default function GroupBoard({ group, canEdit, signedIn }: GroupBoardProps) {
  const days = group.days;
  const budget = SESSION_BUDGET_MINS;
  const [drills, setDrills] = useState<Drill[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | TrainingDay>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Video Modal State
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState<string>('');
  const [embedType, setEmbedType] = useState<'iframe' | 'direct'>('iframe');

  const [durations, setDurations] = useState<Record<string, number>>({});
  const [matchDuration, setMatchDuration] = useState<number>(15);
  const [breakDuration, setBreakDuration] = useState<number>(5);

  const [dayOrders, setDayOrders] = useState<Record<string, string[]>>(
    Object.fromEntries(days.map((d) => [d, [] as string[]]))
  );

  const [activeTimerSessionId, setActiveTimerSessionId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);

  const fetchData = async () => {
    try {
      const [drillsRes, sessionsRes] = await Promise.all([
        fetch(`/api/drills?group=${group.id}`),
        fetch(`/api/sessions?group=${group.id}`)
      ]);

      if (drillsRes.ok) {
        const dData = await drillsRes.json();
        setDrills(dData.data || []);
      }
      if (sessionsRes.ok) {
        const sData = await sessionsRes.json();
        const rawSessions: SessionItem[] = sData.data || [];
        setSessions(rawSessions);

        const initialDurations: Record<string, number> = {};
        rawSessions.forEach((s) => {
          initialDurations[s.id] = durations[s.id] || s.duration || 10;
        });
        setDurations(initialDurations);

        setDayOrders(
          Object.fromEntries(
            days.map((d) => [d, rawSessions.filter((s) => s.training_day === d).map((s) => s.id)])
          )
        );
      }
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isTimerRunning) {
      setIsTimerRunning(false);
      if (typeof window !== 'undefined') {
        alert("Time's up for this drill!");
      }
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timeLeft]);

  const startTimer = (sessionId: string) => {
    const mins = durations[sessionId] || 10;
    setActiveTimerSessionId(sessionId);
    setTimeLeft(mins * 60);
    setIsTimerRunning(true);
  };

  const toggleTimer = () => {
    setIsTimerRunning(!isTimerRunning);
  };

  const resetTimer = (sessionId: string) => {
    const mins = durations[sessionId] || 10;
    setTimeLeft(mins * 60);
    setIsTimerRunning(false);
  };

  const formatTimerDisplay = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const moveItem = (day: TrainingDay, index: number, direction: 'up' | 'down') => {
    const currentOrder = [...(dayOrders[day] || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= currentOrder.length) return;

    const temp = currentOrder[index];
    currentOrder[index] = currentOrder[targetIndex];
    currentOrder[targetIndex] = temp;

    setDayOrders({
      ...dayOrders,
      [day]: currentOrder,
    });
  };

  const updateDuration = (sessionId: string, newMins: number) => {
    const validMins = Math.max(1, newMins);
    setDurations((prev) => ({ ...prev, [sessionId]: validMins }));
    if (activeTimerSessionId === sessionId && !isTimerRunning) {
      setTimeLeft(validMins * 60);
    }
  };

  const handleWatchDrill = (title: string, rawUrl: string) => {
    if (!rawUrl) return;
    let url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Standard YouTube videos embed cleanly inside the modal
    if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
      const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        setActiveVideoTitle(title);
        setActiveVideoUrl(`https://www.youtube.com/embed/${match[1]}?autoplay=1`);
        setEmbedType('iframe');
        return;
      }
    }

    // Instagram, TikTok, Shorts, and other platforms enforce anti-embed policies.
    // Deep-link directly so the phone opens the native app smoothly without tab crashes.
    window.location.href = url;
  };

  const addToSession = async (drillId: string, day: TrainingDay) => {
    if (isDrillInSession(drillId, day)) return;
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drill_id: drillId, training_day: day, age_group: group.id }),
      });

      const result = await res.json();

      if (!res.ok) {
        alert(result.error || 'Failed to add drill to session');
      } else {
        fetchData();
      }
    } catch (err) {
      console.error(err);
      alert('Network error when adding drill to session.');
    }
  };

  const removeFromSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/sessions?id=${sessionId}`, { method: 'DELETE' });
      if (res.ok) fetchData();
      else alert((await res.json()).error || 'Could not remove drill');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      const res = await fetch(`/api/drills?id=${id}`, { method: 'DELETE' });
      if (res.ok) fetchData();
      else alert((await res.json()).error || 'Could not delete drill');
    } catch (err) {
      console.error(err);
    }
  };

  const isDrillInSession = (drillId: string, day: TrainingDay) => {
    return sessions.some((s) => s.drill_id === drillId && s.training_day === day);
  };

  const getOrderedSessionItems = (day: TrainingDay) => {
    const daySessions = sessions.filter((s) => s.training_day === day);
    const orderList = dayOrders[day] || [];

    return [...daySessions].sort((a, b) => {
      const indexA = orderList.indexOf(a.id);
      const indexB = orderList.indexOf(b.id);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
  };

  const calculateTotalTime = (day: TrainingDay) => {
    const items = getOrderedSessionItems(day);
    const drillsTime = items.reduce((sum, item) => sum + (durations[item.id] || 10), 0);
    return drillsTime + matchDuration + breakDuration;
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-20">
      <header className="bg-emerald-800 text-white p-4 shadow-md sticky top-0 z-40 border-b border-emerald-900">
        <div className="max-w-3xl mx-auto flex justify-between items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/"
              aria-label="Change age group"
              className="text-emerald-200 hover:text-white -ml-1 p-1 rounded-lg hover:bg-emerald-900/60 shrink-0"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/crest.jpg" alt="Wayside Celtic F.C. crest" className="w-10 h-10 rounded-full bg-white p-0.5 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight leading-tight truncate">
                {group.label} Drills
              </h1>
              <p className="text-[11px] text-emerald-200 font-medium truncate">
                Wayside Celtic
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canEdit ? (
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-white text-emerald-900 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold flex items-center gap-1 shadow hover:bg-emerald-50 transition"
              >
                <Plus className="w-4 h-4" /> Add Drill
              </button>
            ) : !signedIn ? (
              <Link
                href={`/login?next=/${group.id}`}
                className="border border-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-emerald-900/60 transition"
              >
                <LogIn className="w-4 h-4" /> Coach sign in
              </Link>
            ) : null}
            {signedIn && (
              <form action={signOut}>
                <button
                  type="submit"
                  title="Sign out"
                  aria-label="Sign out"
                  className="text-emerald-200 hover:text-white p-1.5 rounded-lg hover:bg-emerald-900/60"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
        {signedIn && !canEdit && (
          <p className="max-w-3xl mx-auto text-[11px] text-emerald-100 mt-2">
            You&apos;re signed in, but your account isn&apos;t set up to edit {group.label}. You can still view.
          </p>
        )}
      </header>

      {/* Navigation Tabs */}
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="flex bg-slate-200 p-1 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
              activeTab === 'all' ? 'bg-white text-emerald-800 shadow' : 'text-slate-600'
            }`}
          >
            All Drills ({drills.length})
          </button>
          {days.map((day) => (
            <button
              key={day}
              onClick={() => setActiveTab(day)}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                activeTab === day ? 'bg-white text-emerald-800 shadow' : 'text-slate-600'
              }`}
            >
              {DAY_LABEL[day].long} ({sessions.filter((s) => s.training_day === day).length})
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-4">
        {loading ? (
          <p className="text-center text-slate-500 py-10">Loading drills...</p>
        ) : activeTab === 'all' && drills.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-slate-500 font-medium text-sm">No drills for {group.label} yet.</p>
            <p className="text-slate-400 text-xs mt-1">
              {canEdit ? 'Tap "Add Drill" to save your first one.' : 'Coaches can sign in to add drills.'}
            </p>
          </div>
        ) : activeTab === 'all' ? (
          /* All Drills View */
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {drills.map((drill) => {

              return (
                <div key={drill.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <h3 className="font-bold text-slate-800 text-base">{drill.title}</h3>
                      {canEdit && (
                        <button
                          onClick={() => handleDelete(drill.id, drill.title)}
                          aria-label={`Delete ${drill.title}`}
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                        {drill.age_category}
                      </span>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md">
                        {(drill.game_phase || '').replace('_', ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 mt-2">
                    <div className="flex gap-2">
                      {days.map((day) => {
                        const inDay = isDrillInSession(drill.id, day);
                        if (!canEdit) {
                          return inDay ? (
                            <span
                              key={day}
                              className="flex-1 text-center text-[11px] font-bold py-1.5 rounded-lg border bg-emerald-50 text-emerald-800 border-emerald-200"
                            >
                              ✓ {DAY_LABEL[day].long}
                            </span>
                          ) : null;
                        }
                        return (
                          <button
                            key={day}
                            onClick={() => addToSession(drill.id, day)}
                            disabled={inDay}
                            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg border transition ${
                              inDay
                                ? 'bg-emerald-600 text-white border-emerald-600 cursor-default'
                                : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 border-slate-200'
                            }`}
                          >
                            {inDay ? `✓ ${DAY_LABEL[day].long}` : `+ ${DAY_LABEL[day].short} Session`}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => handleWatchDrill(drill.title, drill.url)}
                      className="inline-flex items-center justify-center gap-1.5 w-full bg-slate-900 text-white text-xs font-semibold py-2 rounded-lg hover:bg-slate-800 transition shadow-sm"
                    >
                      Watch Drill Video <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Session Day View */
          <div className="space-y-4">
            {/* Modular Session Status Header */}
            {(() => {
              const totalMins = calculateTotalTime(activeTab);
              const drillCount = getOrderedSessionItems(activeTab).length;
              const diff = totalMins - budget;

              return (
                <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md space-y-2">
                  <div className="flex flex-wrap justify-between items-center gap-3">
                    <div>
                      <h2 className="text-sm font-bold">{DAY_LABEL[activeTab].long} Session Plan</h2>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {drillCount} {drillCount === 1 ? 'Drill' : 'Drills'} + Water ({breakDuration}m) + Match ({matchDuration}m)
                      </p>
                    </div>

                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold ${
                      totalMins > budget
                        ? 'bg-red-950 text-red-200 border-red-800'
                        : totalMins === budget
                        ? 'bg-emerald-950 text-emerald-200 border-emerald-800'
                        : 'bg-slate-800 text-slate-200 border-slate-700'
                    }`}>
                      {totalMins > budget ? (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      ) : (
                        <Clock className="w-4 h-4 text-emerald-400" />
                      )}
                      <span>{totalMins} / {budget} mins</span>
                    </div>
                  </div>

                  {/* Status Banner */}
                  <div className="text-[11px] font-semibold pt-1 border-t border-slate-800 flex justify-between">
                    {diff > 0 ? (
                      <span className="text-red-400">⚠️ Session is {diff} mins over budget! Reduce drill times or remove a drill.</span>
                    ) : diff < 0 ? (
                      <span className="text-emerald-400">💡 {Math.abs(diff)} mins remaining in your {budget}m session budget.</span>
                    ) : (
                      <span className="text-emerald-300">✓ Perfect! Exactly {budget} minutes planned.</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Drills List */}
            {getOrderedSessionItems(activeTab).length === 0 ? (
              <div className="text-center py-10 bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-slate-500 font-medium text-sm">No drills added to {DAY_LABEL[activeTab].long} yet.</p>
                {canEdit && (
                  <p className="text-slate-400 text-xs mt-1">Switch to &quot;All Drills&quot; tab and tap &quot;+ {DAY_LABEL[activeTab].short} Session&quot;.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {getOrderedSessionItems(activeTab).map((s, idx, arr) => {
                  const duration = durations[s.id] || 10;
                  const isCurrentTimerActive = activeTimerSessionId === s.id;

                  return (
                    <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex justify-between items-start gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="bg-slate-100 text-slate-700 font-bold text-xs w-6 h-6 rounded-full flex items-center justify-center shrink-0 border border-slate-200">
                            {idx + 1}
                          </span>
                          <h3 className="font-bold text-slate-800 text-base">{s.drills?.title || 'Untitled Drill'}</h3>
                        </div>

                        {/* Order Controls & Delete */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => moveItem(activeTab, idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400 bg-slate-50 hover:bg-slate-100 rounded"
                            title="Move Up"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => moveItem(activeTab, idx, 'down')}
                            disabled={idx === arr.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400 bg-slate-50 hover:bg-slate-100 rounded"
                            title="Move Down"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => removeFromSession(s.id)}
                              className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-md ml-1"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                          {(s.drills?.game_phase || '').replace('_', ' ')}
                        </span>

                        {/* Editable Duration Selector */}
                        <div className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 text-xs text-slate-700 font-semibold">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <input
                            type="number"
                            min="1"
                            max="60"
                            value={duration}
                            onChange={(e) => updateDuration(s.id, parseInt(e.target.value) || 5)}
                            className="w-8 bg-transparent text-center font-bold focus:outline-none text-emerald-900"
                          />
                          <span>mins</span>
                        </div>
                      </div>

                      {/* Pitch Timer Control Box */}
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Timer className={`w-4 h-4 ${isCurrentTimerActive && isTimerRunning ? 'text-emerald-600 animate-pulse' : 'text-slate-500'}`} />
                          <span className="font-mono font-bold text-sm text-slate-800">
                            {isCurrentTimerActive ? formatTimerDisplay(timeLeft) : `${duration.toString().padStart(2, '0')}:00`}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {!isCurrentTimerActive ? (
                            <button
                              onClick={() => startTimer(s.id)}
                              className="bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm transition"
                            >
                              <Play className="w-3 h-3 fill-current" /> Start Drill
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={toggleTimer}
                                className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 shadow-sm transition ${
                                  isTimerRunning
                                    ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                    : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                }`}
                              >
                                {isTimerRunning ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                                {isTimerRunning ? 'Pause' : 'Resume'}
                              </button>
                              <button
                                onClick={() => resetTimer(s.id)}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 p-1.5 rounded-md text-xs font-bold transition"
                                title="Reset Timer"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        {s.drills?.url && (
                          <button
                            onClick={() => handleWatchDrill(s.drills.title, s.drills.url)}
                            className="inline-flex items-center justify-center gap-1.5 w-full bg-slate-900 text-white text-xs font-semibold py-2 rounded-lg hover:bg-slate-800 transition shadow-sm"
                          >
                            Watch Drill Video <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Editable Water / Setup Block */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 shadow-sm flex justify-between items-center text-xs">
                  <span className="font-semibold text-blue-900">🚰 Water Breaks & Cones Setup</span>
                  <div className="flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-blue-200">
                    <input
                      type="number"
                      min="0"
                      max="30"
                      value={breakDuration}
                      onChange={(e) => setBreakDuration(parseInt(e.target.value) || 0)}
                      className="w-7 text-center font-bold text-blue-900 focus:outline-none"
                    />
                    <span className="font-bold text-blue-800">mins</span>
                  </div>
                </div>

                {/* Editable Match Block */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-amber-900 text-sm">⚽ Match / Small-Sided Game</h3>
                    <p className="text-xs text-amber-700 mt-0.5">Free play applying the session focus.</p>
                  </div>
                  <div className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-amber-300 text-xs font-bold">
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={matchDuration}
                      onChange={(e) => setMatchDuration(parseInt(e.target.value) || 0)}
                      className="w-8 text-center font-bold text-amber-900 focus:outline-none"
                    />
                    <span className="text-amber-900">mins</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* In-App Clean YouTube Player Modal */}
      {activeVideoUrl && embedType === 'iframe' && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl border border-slate-700">
            <div className="p-4 bg-slate-800 flex justify-between items-center border-b border-slate-700">
              <h3 className="font-bold text-white text-sm truncate pr-2">{activeVideoTitle}</h3>
              <button
                onClick={() => setActiveVideoUrl(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg bg-slate-700/50 hover:bg-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative w-full aspect-video bg-black flex items-center justify-center">
              <iframe
                src={activeVideoUrl}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
            <div className="p-3 bg-slate-800 text-center border-t border-slate-700">
              <button
                onClick={() => setActiveVideoUrl(null)}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition"
              >
                Close & Return to Pitch Session
              </button>
            </div>
          </div>
        </div>
      )}

      <AddDrillModal
        group={group}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onDrillAdded={fetchData}
      />
    </main>
  );
}
