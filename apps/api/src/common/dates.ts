/*
 * Date helpers shared by all slices.
 *
 * node-pg parses PostgreSQL DATE columns as local-midnight Date objects, so:
 *  - String(date)           -> "Sun Nov 16 ..."  (invalid input for ::date)
 *  - date.toISOString()     -> previous day in time zones ahead of UTC (e.g. Africa/Cairo)
 *  - date.getFullYear()...  -> the exact stored calendar date  (correct)
 */

/** Normalises a pg DATE value (Date object or string) to `YYYY-MM-DD`. */
export function asIsoDate(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value).trim();
  // Already ISO-like (YYYY-MM-DD or an ISO timestamp)?
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return undefined;
}

/** Today as `YYYY-MM-DD` in local time. */
export function todayIso(): string {
  return asIsoDate(new Date()) as string;
}
