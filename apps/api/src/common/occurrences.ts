/**
 * Shared occurrence generator for recurring rules (E3 bank expenses and any
 * future "every N months from a given day" schedule).
 *
 * Extracted so the pre-close completeness gate (E6) can compute the SAME due
 * occurrences the generator produces — one source of truth, no drift.
 *
 * Occurrence = calendar date on `dayOfMonth` of every `step` months starting
 * from the month of `startDate`; occurrences strictly before `startDate` are
 * skipped. `frequency`: 1 monthly · 2 quarterly · 3 semi-annual · 4 annual.
 */
import { asIsoDate } from './dates';

const FREQ_MONTHS: Record<number, number> = { 1: 1, 2: 3, 3: 6, 4: 12 };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function* occurrences(startDate: string, dayOfMonth: number, frequency: number, asOf: string): Generator<string> {
  const start = asIsoDate(startDate);
  const end = asIsoDate(asOf);
  if (!start || !end) return;
  if (start > end) return;
  const step = FREQ_MONTHS[frequency] ?? 1;
  let months = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
  for (let i = 0; i < 1200; i += 1) {
    const occ = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth(), dayOfMonth));
    const occIso = iso(occ);
    if (occIso > end) return;
    if (occIso >= start) yield occIso;
    months = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth() + step, 1));
    if (iso(months) > end) return;
  }
}

/** All occurrences in [fromIso, toIso] (both inclusive) of a recurring rule. */
export function occurrencesBetween(startDate: string, dayOfMonth: number, frequency: number, fromIso: string, toIso: string): string[] {
  const from = asIsoDate(fromIso);
  const to = asIsoDate(toIso);
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  for (const occ of occurrences(startDate, dayOfMonth, frequency, to)) {
    if (occ >= from) out.push(occ);
  }
  return out;
}

/** Next occurrence strictly AFTER `afterIso` (for listing/preview). */
export function nextOccurrence(startDate: string, dayOfMonth: number, frequency: number, afterIso: string): string | null {
  const start = asIsoDate(startDate);
  if (!start) return null;
  const end = asIsoDate(afterIso) ?? '2999-12-31';
  const step = FREQ_MONTHS[frequency] ?? 1;
  let months = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
  for (let i = 0; i < 1200; i += 1) {
    const occ = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth(), dayOfMonth));
    const occIso = iso(occ);
    if (occIso >= start && occIso > end) return occIso;
    months = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth() + step, 1));
  }
  return null;
}
