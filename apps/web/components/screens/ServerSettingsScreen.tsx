'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '@/lib/api';
import PrintAgentPanel from '@/components/screens/PrintAgentPanel';

/** «إعدادات السيرفر» — print agent (per device) + read-only server diagnostics. */
export default function ServerSettingsScreen() {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/admin/support-info').then(setInfo).catch((e) => setError(e?.message ?? 'تعذر تحميل بيانات السيرفر'));
  }, []);

  const mb = (bytes: number) => (Number(bytes || 0) / (1024 * 1024)).toFixed(1) + ' م.ب';

  const rows: [string, string][] = info ? [
    ['إصدار التطبيق', String(info.appVersion ?? '—')],
    ['إصدار Node', String(info.nodeVersion ?? '—')],
    ['قاعدة البيانات', String(info.dbName ?? '—') + (info.isEmbeddedPglite ? ' (PGlite مدمجة)' : '')],
    ['إصدار قاعدة البيانات', String(info.dbVersion ?? '—').slice(0, 60)],
    ['حجم قاعدة البيانات', mb(info.dbSizeBytes)],
    ['عدد الجداول', String(info.tables ?? '—')],
    ['عدد مفاتيح الإعدادات', String(info.settingsKeys ?? '—')],
    ['المستخدمون', String(info.users ?? '—')],
    ['الأصناف', String(info.items ?? '—')],
    ['الأطراف (عملاء/موردين)', String(info.parties ?? '—')],
    ['الفواتير', String(info.invoices ?? '—')],
    ['زمن تشغيل السيرفر', `${Math.floor(Number(info.uptimeSeconds ?? 0) / 60)} دقيقة`],
    ['وقت السيرفر', info.serverTime ? formatDate(info.serverTime) : '—'],
  ] : [];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="card p-4">
        <div className="font-extrabold text-slate-800">إعدادات السيرفر</div>
        <div className="text-xs text-slate-500 mt-1">بيانات الاتصال وبيئة التشغيل — مثل تبويب «اعدادات السيرفر» في دليل Ezees. الاتصال بقاعدة البيانات نفسه يُضبط بمتغير البيئة <code className="font-mono" dir="ltr">DATABASE_URL</code> على السيرفر (وليس من واجهة العميل) لأسباب أمنية.</div>
      </div>

      <PrintAgentPanel />

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold text-slate-800">بيانات السيرفر والبيئة</div>
          <span className="badge bg-slate-100 text-slate-500">قراءة فقط</span>
        </div>
        {error && <div className="text-sm text-rose-600 mt-3">{error}</div>}
        {!info && !error && <div className="text-sm text-slate-400 py-6 text-center">جارٍ التحميل…</div>}
        {info && (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-4 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2">
                <span className="text-slate-500">{label}</span>
                <span className="font-semibold text-slate-800 text-left" dir="auto">{value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="text-[11px] text-slate-400 mt-4 leading-5">للحصول على لقطة كاملة للدعم الفني استخدم «الأدوات ← بيانات الدعم الفنى» — تتضمن نفس البيانات جاهزة للصق في تذكرة الدعم.</div>
      </div>
    </div>
  );
}
