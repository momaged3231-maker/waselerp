/**
 * Shared deterministic depreciation math (E5 policy) — extracted so the
 * pre-close completeness gate (E6) can compute exactly which asset-months are
 * due, using the SAME rules the depreciation runner posts with.
 *
 * Policy (documented decision — the reference spec didn't define one):
 *  - Straight-line (method 1): monthly = (cost − residual) / useful_life_months,
 *    calculated with full precision and rounded to 2dp at posting. The FIRST
 *    month is pro-rated by days in service (daysInService / daysInMonth). The
 *    final month posts only the remaining balance so accumulated never exceeds
 *    cost − residual.
 *  - Diminishing balance (method 2): monthly = book_value × (annualRate / 100 / 12).
 *    Never depreciates below residual_value. Same first-month pro-rating applies.
 *    Final month of the remaining useful life settles the full remainder down
 *    to residual so the register always lands exactly on residual at end.
 */
import { BadRequestException } from '@nestjs/common';
import { asIsoDate } from './dates';

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const round6 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 1e6) / 1e6;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const MONTH_RE = /^(\d{4})-(\d{2})$/;
export function monthBounds(periodMonth: string): { first: string; last: string; days: number; monthDate: string } {
  const m = MONTH_RE.exec(String(periodMonth ?? ''));
  if (!m) throw new BadRequestException('صيغة الشهر غير صحيحة (YYYY-MM)');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new BadRequestException('الشهر غير صحيح');
  const first = `${m[1]}-${m[2]}-01`;
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { first, last, days, monthDate: first };
}

export function monthsBetween(fromMonth: string, toMonth: string): number {
  const a = MONTH_RE.exec(fromMonth);
  const b = MONTH_RE.exec(toMonth);
  if (!a || !b) return 0;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/** First-day strings for every calendar month overlapping [fromIso, toIso]. */
export function monthsInRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = asIsoDate(fromIso);
  const end = asIsoDate(toIso);
  if (!start || !end || start > end) return out;
  let cur = start.slice(0, 7) + '-01';
  for (;;) {
    out.push(cur);
    const [y, mo] = cur.slice(0, 7).split('-').map(Number);
    const next = new Date(Date.UTC(y, mo, 1));
    cur = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
    if (cur > end) break;
    if (out.length > 600) break;
  }
  return out;
}

/** Deterministic monthly depreciation amount per the documented policy.
 *  `priorAccumulated` must be the accumulated depreciation BEFORE this month. */
export function depreciationForMonth(asset: any, monthDate: string, priorAccumulated: number): number {
  const cost = num(asset.cost);
  const residual = num(asset.residual_value);
  const depreciable = cost - residual;
  if (!(depreciable > 0)) return 0;
  const prior = num(priorAccumulated);
  const method = Number(asset.depreciation_method ?? 1);
  const life = Number(asset.useful_life_months);
  const inServiceMonth = asIsoDate(asset.in_service_date)?.slice(0, 7);
  const periodMonth = monthDate.slice(0, 7);
  if (!inServiceMonth) return 0;
  const monthsElapsed = monthsBetween(inServiceMonth, periodMonth);
  if (monthsElapsed < 0) return 0;

  // Days in service during the in-service month (full month from that month onward).
  const day = Number(asIsoDate(asset.in_service_date)!.slice(8, 10));
  const { days } = monthBounds(periodMonth);
  const daysInService = monthsElapsed === 0 ? days - day + 1 : days;
  const monthFraction = round6(daysInService / days);

  let base: number;
  if (method === 2) {
    const rate = Number(asset.depreciation_rate_pct);
    if (!(rate > 0)) return 0;
    if (monthsElapsed >= Number(asset.useful_life_months) - 1) {
      return round2(Math.max(0, Math.min(cost - prior, depreciable - prior)));
    }
    base = (cost - prior) * (rate / 100 / 12) * (monthsElapsed === 0 ? monthFraction : 1);
  } else {
    const monthly = depreciable / life;
    base = monthly * (monthsElapsed === 0 ? monthFraction : 1);
  }
  const remaining = depreciable - prior;
  return round2(Math.min(Math.max(base, 0), remaining));
}
