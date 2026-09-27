/** Small input checks shared by the API routes. Return null when invalid. */

export function cleanText(raw: unknown, max: number, { required = false } = {}): string | null | undefined {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return required ? undefined : null; // undefined = missing but required
  }
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().replace(/[ \t]+/g, ' ');
  return v.length <= max ? v : undefined;
}

export function cleanDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? raw : undefined;
}

/** "HH:MM" (24h). Empty -> null. Bad -> undefined. */
export function cleanTime(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  const m = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(:\d{2})?$/);
  return m ? `${m[1]}:${m[2]}` : undefined;
}
