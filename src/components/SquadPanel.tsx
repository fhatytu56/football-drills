'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Check, X, Users } from 'lucide-react';
import { POSITIONS, type AgeGroup, type Position } from '@/lib/groups';

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

const POS_SHORT = Object.fromEntries(POSITIONS.map((p) => [p.id, p.short])) as Record<Position, string>;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Something went wrong');
  }
  return res.json().catch(() => ({}));
}

export default function SquadPanel({ group }: { group: AgeGroup }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newTeam, setNewTeam] = useState('');
  const [renamingTeam, setRenamingTeam] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newPlayer, setNewPlayer] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await send(`/api/squad?group=${group.id}`, 'GET');
      setTeams(data.teams || []);
      setPlayers(data.players || []);
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

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      await load();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  };

  const addTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeam.trim()) return;
    if (await run(() => send('/api/teams', 'POST', { age_group: group.id, name: newTeam }))) setNewTeam('');
  };

  const saveRename = async (teamId: string) => {
    if (await run(() => send('/api/teams', 'PATCH', { id: teamId, name: renameValue }))) setRenamingTeam(null);
  };

  const deleteTeam = async (team: Team) => {
    const count = players.filter((p) => p.team_id === team.id).length;
    const msg = count
      ? `Delete team "${team.name}"? Its ${count} player${count === 1 ? '' : 's'} will move to "No team yet".`
      : `Delete team "${team.name}"?`;
    if (!confirm(msg)) return;
    await run(() => send(`/api/teams?id=${team.id}`, 'DELETE'));
  };

  const addPlayer = async (e: React.FormEvent, teamId: string | null) => {
    e.preventDefault();
    const key = teamId || 'none';
    const name = (newPlayer[key] || '').trim();
    if (!name) return;
    const ok = await run(() =>
      send('/api/players', 'POST', { age_group: group.id, team_id: teamId, first_name: name })
    );
    if (ok) setNewPlayer((prev) => ({ ...prev, [key]: '' }));
  };

  const unassigned = players.filter((p) => !p.team_id || !teams.some((t) => t.id === p.team_id));
  const sections: { team: Team | null; list: Player[] }[] = [
    ...teams.map((t) => ({ team: t, list: players.filter((p) => p.team_id === t.id) })),
    ...(unassigned.length ? [{ team: null, list: unassigned }] : []),
  ];

  if (loading) return <p className="text-center text-slate-500 py-10">Loading squad...</p>;

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 text-white p-4 rounded-xl shadow-md">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-400" /> {group.label} Squad
        </h2>
        <p className="text-xs text-slate-300 mt-1">
          {group.label} play {group.aSide}-a-side. {players.length} {players.length === 1 ? 'player' : 'players'} in{' '}
          {teams.length} {teams.length === 1 ? 'team' : 'teams'}.
          {group.usesPositions && ' Give each player a main and a second position.'}
        </p>
        <p className="text-[11px] text-slate-400 mt-1">First names only. Only {group.label} coaches can see this.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-lg p-3" role="alert">
          {error}
        </div>
      )}

      {sections.map(({ team, list }) => {
        const key = team?.id || 'none';
        return (
          <section key={key} className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <header className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-slate-100">
              {team && renamingTeam === team.id ? (
                <form
                  className="flex items-center gap-1.5 flex-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveRename(team.id);
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Team name"
                    value={renameValue}
                    maxLength={30}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1 border border-slate-300 rounded-lg text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <button type="submit" aria-label="Save team name" className="p-1.5 rounded-lg bg-emerald-700 text-white">
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel rename"
                    onClick={() => setRenamingTeam(null)}
                    className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <>
                  <h3 className="font-bold text-slate-800 text-base">
                    {team ? team.name : 'No team yet'}{' '}
                    <span className="text-xs font-semibold text-slate-400">
                      · {list.length} {list.length === 1 ? 'player' : 'players'}
                    </span>
                  </h3>
                  {team && (
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`Rename ${team.name}`}
                        onClick={() => {
                          setRenamingTeam(team.id);
                          setRenameValue(team.name);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        aria-label={`Delete ${team.name}`}
                        onClick={() => deleteTeam(team)}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </header>

            <ul className="divide-y divide-slate-100">
              {list.map((p) =>
                editing === p.id ? (
                  <PlayerEditor
                    key={p.id}
                    group={group}
                    player={p}
                    teams={teams}
                    onCancel={() => setEditing(null)}
                    onSave={async (update) => {
                      if (await run(() => send('/api/players', 'PATCH', { id: p.id, ...update }))) setEditing(null);
                    }}
                    onDelete={async () => {
                      if (!confirm(`Remove ${p.first_name} from the squad?`)) return;
                      if (await run(() => send(`/api/players?id=${p.id}`, 'DELETE'))) setEditing(null);
                    }}
                  />
                ) : (
                  <li key={p.id}>
                    <button
                      onClick={() => setEditing(p.id)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="font-semibold text-slate-800 text-sm">{p.first_name}</span>
                      <span className="flex items-center gap-1.5">
                        {group.usesPositions &&
                          (p.positions.length ? (
                            p.positions.map((pos, i) => (
                              <span
                                key={pos}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                  i === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {POS_SHORT[pos]}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                              Set positions
                            </span>
                          ))}
                        <Pencil className="w-3.5 h-3.5 text-slate-300" />
                      </span>
                    </button>
                  </li>
                )
              )}
            </ul>

            {team && (
              <form onSubmit={(e) => addPlayer(e, team.id)} className="flex gap-2 p-3 border-t border-slate-100">
                <input
                  aria-label={`New player for ${team.name}`}
                  placeholder="First name"
                  maxLength={30}
                  value={newPlayer[key] || ''}
                  onChange={(e) => setNewPlayer((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
                <button
                  type="submit"
                  className="shrink-0 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-3 rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Add player
                </button>
              </form>
            )}
          </section>
        );
      })}

      {teams.length === 0 && (
        <div className="text-center py-6 bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-slate-500 font-medium text-sm">No teams yet.</p>
          <p className="text-slate-400 text-xs mt-1">Create your first team below, e.g. &quot;{group.id.slice(1)}.1&quot;.</p>
        </div>
      )}

      <form onSubmit={addTeam} className="flex gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <input
          aria-label="New team name"
          placeholder={`New team name, e.g. ${group.id.slice(1)}.${teams.length + 1}`}
          maxLength={30}
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-emerald-300 rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
        <button
          type="submit"
          className="shrink-0 bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-3 rounded-lg flex items-center gap-1"
        >
          <Plus className="w-4 h-4" /> New team
        </button>
      </form>
    </div>
  );
}

function PlayerEditor({
  group,
  player,
  teams,
  onSave,
  onCancel,
  onDelete,
}: {
  group: AgeGroup;
  player: Player;
  teams: Team[];
  onSave: (update: { first_name: string; team_id: string | null; positions: Position[] }) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(player.first_name);
  const [teamId, setTeamId] = useState<string>(player.team_id || '');
  const [main, setMain] = useState<Position | null>(player.positions[0] || null);
  const [second, setSecond] = useState<Position | null>(player.positions[1] || null);

  const pick = (slot: 'main' | 'second', pos: Position) => {
    if (slot === 'main') {
      setMain(main === pos ? null : pos);
      if (second === pos) setSecond(null);
    } else {
      setSecond(second === pos ? null : pos);
    }
  };

  const positionRow = (slot: 'main' | 'second', label: string) => {
    const current = slot === 'main' ? main : second;
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[11px] font-bold text-slate-500 uppercase">{label}</span>
        <div className="flex gap-1.5 flex-1" role="group" aria-label={`${label} position`}>
          {POSITIONS.map((p) => {
            const disabled = slot === 'second' && (!main || main === p.id);
            const on = current === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => pick(slot, p.id)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition disabled:opacity-30 ${
                  on
                    ? slot === 'main'
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-slate-700 text-white border-slate-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {p.short}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <li className="px-4 py-3 bg-slate-50 space-y-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            first_name: name,
            team_id: teamId || null,
            positions: [main, second].filter(Boolean) as Position[],
          });
        }}
      >
        <div className="flex gap-2">
          <input
            autoFocus
            aria-label="First name"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <select
            aria-label="Team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-28 shrink-0 px-2 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
          >
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {group.usesPositions && (
          <div className="space-y-2">
            {positionRow('main', 'Main')}
            {positionRow('second', 'Second')}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg"
          >
            Remove
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-bold text-slate-600 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded-lg"
          >
            Cancel
          </button>
          <button type="submit" className="text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 px-4 py-2 rounded-lg">
            Save
          </button>
        </div>
      </form>
    </li>
  );
}
