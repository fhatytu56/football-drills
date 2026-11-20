// Snapshot of Wayside Celtic's U10 Sunday divisions on ddsl.ie, taken 20 Nov 2026.
// DDSL publishes U10 fixtures but no U10 results or tables, so the game uses the real
// teams and real fixture dates, and simulates every result.
// To refresh: open each URL, read the "Matrix view" table (row = home, column = away, cell = date).
// `fx` is [home index, away index, "dd-Mon-yy hh:mm"] into `teams`.

export interface Division {
  name: string; // the club's team name, same as the DDSL division, e.g. "10.2"
  url: string;
  teams: string[];
  fx: [number, number, string][];
}

export const WAYSIDE = 'Wayside Celtic FC';
export const SNAPSHOT_DATE = '2026-11-20';

export const DIVISIONS: Division[] = [
  {
    name: '10.2',
    url: 'https://ddsl.ie/league/218569/',
    teams: ['Ashbourne United FC', 'Belvedere FC', 'Killester Donnycarney FC', 'Leicester Celtic FC', 'Park Celtic FC', 'Phoenix FC', 'St Mochtas FC', 'Stella Maris FC', 'Verona FC', 'Wayside Celtic FC'],
    fx: [[0, 6, '06-Sep-26 10:00'], [0, 7, '22-Nov-26 10:00'], [1, 2, '15-Nov-26 10:00'], [1, 3, '18-Oct-26 10:00'], [1, 4, '25-Oct-26 10:00'], [1, 9, '08-Nov-26 10:00'], [2, 1, '29-Nov-26 10:00'], [2, 5, '06-Sep-26 10:00'], [3, 5, '25-Oct-26 10:00'], [3, 7, '06-Sep-26 10:00'], [3, 9, '22-Nov-26 10:00'], [4, 0, '29-Nov-26 10:00'], [4, 2, '13-Sep-26 10:00'], [5, 4, '22-Nov-26 10:00'], [5, 6, '29-Nov-26 10:00'], [6, 2, '22-Nov-26 10:00'], [7, 2, '11-Oct-26 11:00'], [7, 3, '01-Nov-26 10:00'], [7, 6, '20-Sep-26 10:00'], [7, 8, '29-Nov-26 10:00'], [8, 1, '22-Nov-26 10:00'], [8, 9, '11-Oct-26 10:00'], [9, 3, '29-Nov-26 10:00'], [9, 6, '25-Oct-26 10:00']],
  },
  {
    name: '10.11',
    url: 'https://ddsl.ie/league/218579/',
    teams: ['Cabinteely FC', 'Knocklyon United FC', 'Lakelands FC', 'Newbridge Town FC', 'Park Celtic FC', 'Railway Union FC', 'Wayside Celtic FC'],
    fx: [[0, 3, '27-Sep-26 10:00'], [1, 0, '22-Nov-26 10:00'], [1, 3, '01-Nov-26 10:00'], [1, 4, '25-Oct-26 10:00'], [2, 1, '29-Nov-26 10:00'], [2, 5, '25-Oct-26 10:00'], [3, 1, '06-Sep-26 10:00'], [3, 5, '18-Oct-26 10:00'], [3, 6, '29-Nov-26 10:00'], [4, 0, '29-Nov-26 10:00'], [5, 1, '15-Nov-26 10:00'], [5, 4, '22-Nov-26 10:00'], [6, 2, '22-Nov-26 10:00']],
  },
  {
    name: '10.19',
    url: 'https://ddsl.ie/league/218588/',
    teams: ['Granada FC', 'Lakelands FC', 'Lucan United FC', 'Palmerstown FC', 'Park Celtic FC', 'Shankill FC', 'Tallaght Town AFC', 'Wayside Celtic FC'],
    fx: [[0, 2, '29-Nov-26 10:00'], [0, 4, '25-Oct-26 10:00'], [0, 5, '04-Oct-26 10:00'], [0, 7, '27-Sep-26 10:00'], [1, 7, '22-Nov-26 10:00'], [2, 1, '25-Oct-26 10:00'], [2, 3, '27-Sep-26 10:00'], [2, 6, '22-Nov-26 10:00'], [3, 4, '22-Nov-26 10:00'], [4, 1, '29-Nov-26 10:00'], [5, 0, '22-Nov-26 10:00'], [5, 1, '27-Sep-26 10:00'], [6, 2, '04-Oct-26 10:00'], [6, 5, '29-Nov-26 10:00'], [6, 7, '25-Oct-26 10:00'], [7, 3, '29-Nov-26 10:00']],
  },
];

export function divisionFor(teamName: string): Division | undefined {
  const key = teamName.trim().replace(/\s+/g, ' ');
  return DIVISIONS.find((d) => d.name === key);
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** "22-Nov-26 10:00" -> "2026-11-22". Null if it can't be read. */
export function fixtureDate(s: string): string | null {
  const m = /^(\d{2})-([A-Z][a-z]{2})-(\d{2})/.exec(s);
  if (!m || !MONTHS[m[2]]) return null;
  return `20${m[3]}-${MONTHS[m[2]]}-${m[1]}`;
}

/** Short club name for tight tables: "Killester Donnycarney FC" -> "Killester Donnycarney". */
export function shortName(team: string) {
  return team.replace(/\s+(FC|AFC)$/, '');
}
