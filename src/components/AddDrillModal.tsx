'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { AgeGroup } from '@/lib/groups';

interface AddDrillModalProps {
  group: AgeGroup;
  isOpen: boolean;
  onClose: () => void;
  onDrillAdded: () => void;
}

export default function AddDrillModal({ group, isOpen, onClose, onDrillAdded }: AddDrillModalProps) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [gamePhase, setGamePhase] = useState('ATTACKING');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch('/api/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          url,
          age_group: group.id,
          game_phase: gamePhase,
        }),
      });

      if (res.ok) {
        setTitle('');
        setUrl('');
        onDrillAdded();
        onClose();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add drill');
      }
    } catch (err) {
      console.error(err);
      alert('Network error when adding drill');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-bold text-slate-800 mb-4">Add Drill to {group.label}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Drill Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 1v1 Attacking Transition"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Video / Social Link URL</label>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.instagram.com/reel/..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Game Phase</label>
              <select
                value={gamePhase}
                onChange={(e) => setGamePhase(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="ATTACKING">Attacking</option>
                <option value="DEFENDING">Defending</option>
                <option value="TRANSITION">Transition</option>
                <option value="WARM_UP">Warm Up</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 text-xs font-bold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Drill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
