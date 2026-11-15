'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from './api';

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

/** Formats a timestamp as a full Arabic datetime (date + HH:mm) in a zone. */
export function formatDateTime(value: string | Date | null | undefined, timeZone?: string): string {
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
      hourCycle: 'h23',
    }).format(date);
  } catch {
    // Invalid IANA zone — fall back to the runtime zone formatting.
    return date.toLocaleString('ar-EG', { timeZone: undefined, dateStyle: 'medium', timeStyle: 'medium' });
  }
}

/** Formats a timestamp as a date only (for tables/lists). */
export function formatDateOnly(value: string | Date | null | undefined, timeZone?: string): string {
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
    }).format(date);
  } catch {
    return date.toLocaleDateString('ar-EG');
  }
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
