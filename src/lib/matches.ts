export interface MatchDetails {
  team: string;
  match_date: string; // YYYY-MM-DD
  meet_time: string | null; // HH:MM[:SS]
  kickoff: string;
  opponent: string;
  kickoff_2: string | null;
  opponent_2: string | null;
  home_away: 'home' | 'away';
  location: string | null;
  kit: string | null;
  notes: string | null;
}

export type Answer = 'yes' | 'no' | null;

/** "10:00:00" -> "10:00" */
export function hhmm(t: string | null | undefined) {
  return t ? t.slice(0, 5) : '';
}

/** "2026-10-04" -> "Saturday 4 October" (no timezone shifts: it's a calendar date). */
export function longDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function shortDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function mapsLink(location: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

export function matchTitle(m: Pick<MatchDetails, 'team' | 'opponent' | 'opponent_2' | 'home_away'>) {
  const vs = m.opponent_2 ? `${m.opponent} & ${m.opponent_2}` : m.opponent;
  return `${m.team} v ${vs} (${m.home_away === 'home' ? 'Home' : 'Away'})`;
}

/** Today's date in Ireland as YYYY-MM-DD. */
export function todayInIreland() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date());
}

/** The WhatsApp message a coach sends to the team's parent group. */
export function buildMessage(m: MatchDetails, link: string) {
  const lines: string[] = [];
  lines.push(`⚽ *Wayside Celtic ${matchTitle(m)}*`);
  lines.push(`📅 ${longDate(m.match_date)}`);
  if (m.opponent_2 && m.kickoff_2) {
    if (m.meet_time) lines.push(`⏰ Meet ${hhmm(m.meet_time)}`);
    lines.push(`1️⃣ ${hhmm(m.kickoff)} v ${m.opponent}`);
    lines.push(`2️⃣ ${hhmm(m.kickoff_2)} v ${m.opponent_2}`);
  } else {
    lines.push(`⏰ ${m.meet_time ? `Meet ${hhmm(m.meet_time)} · ` : ''}Kick-off ${hhmm(m.kickoff)}`);
  }
  if (m.location) lines.push(`📍 ${m.location}\n${mapsLink(m.location)}`);
  if (m.kit) lines.push(`👕 ${m.kit}`);
  if (m.notes) lines.push(`📝 ${m.notes}`);
  lines.push('');
  lines.push('Can your child play? Tap your child’s name and answer Yes or No:');
  lines.push(link);
  return lines.join('\n');
}
