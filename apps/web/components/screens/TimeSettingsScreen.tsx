'use client';

import { useEffect, useState } from 'react';
import { useSettings } from './SettingsKit';
import { apiFetch } from '@/lib/api';
import { formatDateTime, TIMEZONE_OPTIONS, useTimeDisplay } from '@/lib/time';

/**
 * «الوقت والتوقيت» — live clock (device or server), display timezone and the
 * server-sync flag. Changes persist through the shared settings map (PUT
 * /admin/settings) so they appear in the general tab + the raw settings list.
 */
export default function TimeSettingsScreen() {
  const { map, setValue, saveAll, savedAt, reloadAll } = useSettings();
  const time = useTimeDisplay();
  const [clock, setClock] = useState<Date | null>(null);

  useEffect(() => {
    setClock(new Date());
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const effectiveZone = String(map.DisplayTimezone || time.timeZone || 'Africa/Cairo');
  const effectiveFromServer = String(map.TimeFromServer ?? (time.fromServer ? 'true' : 'false')) === 'true';
  const sourceDate = effectiveFromServer ? new Date(time.serverEpochMs) : (clock ?? time.now);

  const syncNow = async () => {
    const fresh = await time.refresh();
    if (fresh) {
      try {
        const stored = await apiFetch<{ timeZone: string; fromServer: boolean; serverTime: string; serverEpochMs: number }>('/settings/time-display');
        setValue('DisplayTimezone', stored?.timeZone ?? effectiveZone);
        setValue('TimeFromServer', stored?.fromServer ? 'true' : 'false');
      } catch { /* keep local state */ }
      await reloadAll();
    }
  };

  const hhmm = sourceDate
    ? new Intl.DateTimeFormat('ar-EG', { timeZone: effectiveZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(sourceDate)
    : '--:--';

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-5">
        <div className="font-bold text-slate-800">ساعة النظام</div>
        <div className="text-xs text-slate-500 mt-1 mb-3">
          الوقت الحالي{effectiveFromServer ? ' من ساعة السيرفر (مزامن)' : ' من توقيت الجهاز'} — المنطقة: {effectiveZone}
        </div>
        <div className="text-4xl font-extrabold text-slate-800 font-num" dir="ltr" style={{ fontSize: '2.5rem' }}>
          {hhmm}
        </div>
        <div className="text-xs text-slate-500 mt-2 font-num" dir="ltr">
          {sourceDate ? formatDateTime(sourceDate.toISOString(), effectiveZone) : '—'}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn-soft text-xs" onClick={syncNow}>مزامنة الوقت مع السيرفر</button>
          <button className="btn-soft text-xs" onClick={() => reloadAll()}>تحديث من السيرفر</button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="font-bold text-slate-800">إعدادات الوقت والتوقيت</div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">توقيت الساعة (الدولة/المنطقة)</label>
            <select className="input" value={effectiveZone} onChange={(e) => setValue('DisplayTimezone', e.target.value)}>
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">مزامنة الوقت مع السيرفر</label>
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
              <span className="text-sm font-bold text-slate-700">عرض الأوقات من ساعة السيرفر</span>
              <button
                type="button"
                className={`badge border-0 cursor-pointer ${effectiveFromServer ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
                onClick={() => setValue('TimeFromServer', effectiveFromServer ? 'false' : 'true')}
              >
                {effectiveFromServer ? 'مفعّل' : 'متوقف'}
              </button>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-slate-400">
          المزامنة تعني أنّ الأوقات (الافتتاحية/الإغلاقية للفترة) تُحسب من ساعة السيرفر؛ توقيت الجهاز يُتبع عندما تكون الخيار متوقفًا. الحفظ يشمل المفاتيح «DisplayTimezone» و«TimeFromServer» من تبويب «حفظ» العلوي.
        </div>
        {savedAt && <div className="text-[11px] text-emerald-700">تم الحفظ ✓</div>}
      </div>
    </div>
  );
}
