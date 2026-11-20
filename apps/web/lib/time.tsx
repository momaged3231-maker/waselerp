'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from './api';

/**
 * Time display helpers (D32) — shift open/close times shown with the clock
 * (HH:mm) and a display timezone, optionally sourced from the server clock.
 *
 * - `DisplayTimezone` (app_settings): IANA zone or '' for the device zone.
 * - `TimeFromServer` (app_settings): when true, times come from the server clock.
 */

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Africa/Cairo', label: 'مصر — القاهرة (Africa/Cairo)' },
  { value: 'Africa/Casablanca', label: 'المغرب — الرباط (Africa/Casablanca)' },
  { value: 'Europe/London', label: 'بريطانيا — لندن (Europe/London)' },
  { value: 'Europe/Berlin', label: 'ألمانيا — برلين (Europe/Berlin)' },
  { value: 'Asia/Dubai', label: 'الإمارات — دبي (Asia/Dubai)' },
  { value: 'Asia/Beirut', label: 'لبنان — بيروت (Asia/Beirut)' },
  { value: 'Asia/Amman', label: 'الأردن — عمّان (Asia/Amman)' },
  { value: 'Asia/Qatar', label: 'قطر — الدار (Asia/Qatar)' },
  { value: 'Asia/Kuwait', label: 'الكويت — الكويت (Asia/Kuwait)' },
  { value: 'Asia/Riyadh', label: 'السعودية — الرياض (Asia/Riyadh)' },
  { value: 'UTC', label: 'UTC (توقيت عالمي)' },
];

export type TimeDisplayState = {
  timeZone: string;
  fromServer: boolean;
  serverTime: string;
  serverEpochMs: number;
};

const DEFAULT_TIME: TimeDisplayState = {
  timeZone: 'Africa/Cairo',
  fromServer: false,
  serverTime: new Date().toISOString(),
  serverEpochMs: Date.now(),
};

/** Formats a timestamp as a full Arabic datetime (date + HH:mm[:ss]) in a zone. */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone?: string,
  withSeconds = false,
): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const zone = timeZone && timeZone.trim() ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
    }).format(date);
  } catch {
    // Invalid IANA zone — fall back to the runtime zone formatting.
    return date.toLocaleString('ar-EG', { timeZone: undefined, dateStyle: 'medium', timeStyle: 'medium' });
  }
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True for date-only values (node-pg DATE / legacy `YYYY-MM-DD` inputs → 00:00:00Z). */
function isDateOnlyInstant(date: Date): boolean {
  return date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

/** Formats the calendar date of a DATE value without timezone shifting it. */
export function formatCalendarDate(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  if (!value) return '';
  const zone = timeZone && timeZone.trim() ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  let year: number;
  let month: number;
  let day: number;
  if (typeof value === 'string') {
    const text = value.trim();
    // A pure date (`YYYY-MM-DD`) carries no instant — use its literal parts.
    const pure = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (pure) {
      year = Number(pure[1]); month = Number(pure[2]); day = Number(pure[3]);
      return new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
    // A DATE column serialised by node-pg arrives as a local-midnight instant
    // (`2026-11-17T22:00:00.000Z` for 18 Nov in Cairo) — read it in the zone.
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return '';
    return formatInZone(parsed, zone);
  }
  if (Number.isNaN(value.getTime())) return '';
  return formatInZone(value, zone);
}

/** Calendar date of an instant, in a specific IANA zone. */
function formatInZone(date: Date, zone: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(date);
  }
}

/** Clock only (HH:mm[:ss]) in the display timezone. */
export function formatClock(
  value: string | Date | null | undefined,
  timeZone?: string,
  withSeconds = true,
): string {
  const date = toDate(value);
  if (!date) return '';
  const zone = timeZone && timeZone.trim() ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hourCycle: 'h23',
    }).format(date);
  } catch {
    return date.toLocaleTimeString('ar-EG');
  }
}

/**
 * A document whose *date* is a business date (DATE column) but which was
 * created at a real instant: show the document date + the recorded clock.
 * The accounting date itself is never changed.
 */
export function formatDateWithRecordedTime(
  dateValue: string | Date | null | undefined,
  recordedAt: string | Date | null | undefined,
  timeZone?: string,
): string {
  const datePart = formatCalendarDate(dateValue, timeZone);
  if (!datePart) return '';
  const timePart = formatClock(recordedAt, timeZone, true);
  return timePart ? `${datePart} ${timePart}` : datePart;
}

/**
 * Timestamp shown for a document: the document's own timestamp with seconds.
 * Legacy rows whose timestamp was stored as a bare date (00:00:00Z) fall back
 * to the recording clock so the hour/minute/second are never lost.
 */
export function formatDocumentDateTime(
  value: string | Date | null | undefined,
  recordedAt?: string | Date | null,
  timeZone?: string,
): string {
  const date = toDate(value);
  if (!date) return '';
  if (recordedAt && isDateOnlyInstant(date)) {
    return formatDateWithRecordedTime(value, recordedAt, timeZone);
  }
  return formatDateTime(date, timeZone, true);
}

/** The display timezone only (no ticking clock) — for document timestamps. */
export function useDisplayTimezone(): string {
  const [zone, setZone] = useState('Africa/Cairo');
  useEffect(() => {
    let alive = true;
    apiFetch<{ timeZone: string }>('/settings/time-display')
      .then((data) => { if (alive && data?.timeZone) setZone(data.timeZone); })
      .catch(() => { /* keep default */ });
    return () => { alive = false; };
  }, []);
  return zone;
}

/** Formats a timestamp as a date only (for tables/lists). */
export function formatDateOnly(value: string | Date | null | undefined, timeZone?: string): string {
  return formatDate(value, timeZone);
}

/** `YYYY-MM-DD` for exports: calendar date of a DATE value in the display zone. */
export function isoCalendarDate(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  if (!value) return '';
  const zone = timeZone && timeZone.trim() ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof value === 'string') {
    const pure = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (pure) return `${pure[1]}-${pure[2]}-${pure[3]}`;
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** `HH:mm:ss` for exports, in the display zone. */
export function isoClock(
  value: string | Date | null | undefined,
  timeZone?: string,
): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const zone = timeZone && timeZone.trim() ? timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('hour')}:${pick('minute')}:${pick('second')}`;
}

/** `YYYY-MM-DD HH:mm:ss` — business date + recorded clock (CSV/XLSX export). */
export function formatStampForExport(
  value: string | Date | null | undefined,
  recordedAt?: string | Date | null,
  timeZone?: string,
): string {
  const day = isoCalendarDate(value, timeZone);
  if (!day) return '';
  const clock = isoClock(recordedAt ?? value, timeZone);
  return clock ? `${day} ${clock}` : day;
}

/** Today as `YYYY-MM-DD` in the device timezone (not UTC). */
export function localTodayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Live clock (device or server) + the display timezone, refreshed from /settings/time-display. */
export function useTimeDisplay() {
  const [state, setState] = useState<TimeDisplayState>(DEFAULT_TIME);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    let alive = true;
    apiFetch<{ timeZone: string; fromServer: boolean; serverTime: string; serverEpochMs: number }>(
      '/settings/time-display',
    )
      .then((data) => {
        if (!alive) return;
        setState({
          timeZone: data?.timeZone || 'Africa/Cairo',
          fromServer: !!data?.fromServer,
          serverTime: data?.serverTime ?? new Date().toISOString(),
          serverEpochMs: Number(data?.serverEpochMs ?? Date.now()),
        });
      })
      .catch(() => { /* keep defaults */ });
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const refresh = () => {
    try {
      return apiFetch<{ timeZone: string; fromServer: boolean; serverTime: string; serverEpochMs: number }>(
        '/settings/time-display',
      );
    } catch {
      return null;
    }
  };

  return { ...state, now, refresh };
}
