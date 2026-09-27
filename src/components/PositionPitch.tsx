'use client';

import { POSITIONS, type Position } from '@/lib/groups';

// Where each spot sits on the mini pitch (percent from left / top). Own goal at the bottom.
export const SPOTS: Record<Position, { x: number; y: number }> = {
  st: { x: 50, y: 14 },
  lm: { x: 18, y: 40 },
  cm: { x: 50, y: 40 },
  rm: { x: 82, y: 40 },
  lb: { x: 30, y: 64 },
  rb: { x: 70, y: 64 },
  gk: { x: 50, y: 87 },
};

const SHORT = Object.fromEntries(POSITIONS.map((p) => [p.id, p.short])) as Record<Position, string>;
const LABEL = Object.fromEntries(POSITIONS.map((p) => [p.id, p.label])) as Record<Position, string>;

/**
 * Tap a spot: first tap sets Main (green, 1), next tap sets Second (dark, 2).
 * Tap a chosen spot again to clear it (if Main is cleared, Second becomes Main).
 * With both set, tapping another spot replaces Second.
 */
export function nextPositions(current: Position[], tapped: Position): Position[] {
  const [main, second] = current;
  if (tapped === main) return second ? [second] : [];
  if (tapped === second) return [main];
  if (!main) return [tapped];
  return [main, tapped];
}

export default function PositionPitch({
  value,
  onChange,
}: {
  value: Position[];
  onChange: (next: Position[]) => void;
}) {
  const [main, second] = value;
  return (
    <div>
      <div
        className="relative mx-auto w-full max-w-[240px] aspect-[4/5] rounded-xl bg-emerald-600 border-2 border-emerald-700 overflow-hidden select-none"
        role="group"
        aria-label="Positions"
      >
        {/* pitch markings */}
        <div className="absolute inset-2 border-2 border-white/40 rounded-md" aria-hidden />
        <div className="absolute left-2 right-2 top-1/2 border-t-2 border-white/40" aria-hidden />
        <div className="absolute left-1/2 top-1/2 w-16 h-16 -ml-8 -mt-8 rounded-full border-2 border-white/40" aria-hidden />
        <div className="absolute left-1/2 bottom-2 w-24 h-10 -ml-12 border-2 border-b-0 border-white/40" aria-hidden />
        <div className="absolute left-1/2 top-2 w-24 h-10 -ml-12 border-2 border-t-0 border-white/40" aria-hidden />

        {POSITIONS.map(({ id }) => {
          const rank = id === main ? 1 : id === second ? 2 : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(nextPositions(value, id))}
              aria-pressed={rank > 0}
              aria-label={`${LABEL[id]}${rank === 1 ? ' (main)' : rank === 2 ? ' (second)' : ''}`}
              style={{ left: `${SPOTS[id].x}%`, top: `${SPOTS[id].y}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full text-[11px] font-black shadow-md border-2 transition ${
                rank === 1
                  ? 'bg-white text-emerald-800 border-emerald-900 ring-4 ring-amber-300'
                  : rank === 2
                  ? 'bg-slate-800 text-white border-white'
                  : 'bg-emerald-700/70 text-white/90 border-white/60 hover:bg-emerald-800'
              }`}
            >
              {SHORT[id]}
              {rank > 0 && (
                <span
                  className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] leading-4 font-black ${
                    rank === 1 ? 'bg-amber-300 text-emerald-900' : 'bg-white text-slate-800'
                  }`}
                  aria-hidden
                >
                  {rank}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 text-center mt-2">
        {main ? (
          <>
            Main: <b className="text-slate-800">{LABEL[main]}</b>
            {second ? (
              <>
                {' '}· Second: <b className="text-slate-800">{LABEL[second]}</b>
              </>
            ) : (
              ' · Tap another spot for their second position'
            )}
          </>
        ) : (
          'Tap their main position, then their second'
        )}
      </p>
    </div>
  );
}
