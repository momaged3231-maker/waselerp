'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';

function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} كيلوبايت`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} ميجابايت`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} جيجابايت`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d} يوم، ${h} ساعة، ${m} دقيقة`;
}

/** Tools → «بيانات الدعم الفني» — read-only diagnostics to share with support (no secrets). */
export default function SupportScreen() {
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    setError('');
    try { setInfo(await apiFetch<any>('/admin/support-info')); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل — تحتاج صلاحية إدارة المستخدمين'); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function copyAll() {
    if (!info) return;
    const text = [
      `WaselERP ${info.appVersion}`,
      `Node ${info.nodeVersion}`,
      `DB: ${info.dbName} — ${info.dbVersion}`,
      `Size: ${info.dbSizeBytes} bytes (${fmtSize(info.dbSizeBytes)})`,
      `Tables: ${info.tables} · Users: ${info.users} · Items: ${info.items} · Parties: ${info.parties} · Invoices: ${info.invoices}`,
      `Attachments: ${info.attachments} (${fmtSize(info.attachmentBytes)}) · Settings keys: ${info.settingsKeys}`,
      `Embedded PGlite: ${info.isEmbeddedPglite ? 'yes' : 'no'}`,
      `Uptime: ${fmtUptime(info.uptimeSeconds)} · Server time: ${info.serverTime}`,
    ].join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('المتصفح رفض النسخ — انسخ الحقول يدويًا'); }
  }

  const row = (label: string, value: any) => (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-slate-100 last:border-0">
      <div className="w-56 text-xs text-slate-500 shrink-0">{label}</div>
      <div className="text-sm font-semibold text-slate-800 break-all" dir="ltr">{value ?? '—'}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card p-5 flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <div className="font-bold text-slate-800">بيانات الدعم الفني</div>
          <div className="text-xs text-slate-500">معلومات تشخيصية للقراءة فقط — شاركها مع فريق الدعم عند أي مشكلة. لا تتضمن أي أسرار.</div>
        </div>
        <button className="btn-soft text-sm" onClick={load}>تحديث</button>
        <button className="btn-primary text-sm" onClick={copyAll} disabled={!info}>{copied ? '✓ تم النسخ' : 'نسخ الكل'}</button>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      {info && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="font-bold text-slate-800 mb-3">التطبيق والبيئة</div>
            {row('إصدار النظام', `WaselERP v${info.appVersion}`)}
            {row('إصدار Node.js', info.nodeVersion)}
            {row('وقت تشغيل الخادم', fmtUptime(info.uptimeSeconds))}
            {row('وقت الخادم', info.serverTime)}
            {row('طراز قاعدة البيانات', info.isEmbeddedPglite ? 'PGlite (مضمّنة WASM)' : 'PostgreSQL')}
          </div>
          <div className="card p-5">
            <div className="font-bold text-slate-800 mb-3">قاعدة البيانات</div>
            {row('اسم القاعدة', info.dbName)}
            {row('إصدار PostgreSQL', info.dbVersion)}
            {row('حجم القاعدة', `${fmtSize(info.dbSizeBytes)} (${info.dbSizeBytes.toLocaleString('en-US')} بايت)`)}
            {row('عدد الجداول', info.tables)}
          </div>
          <div className="card p-5">
            <div className="font-bold text-slate-800 mb-3">حجم البيانات</div>
            {row('المستخدمون', info.users)}
            {row('الأصناف', info.items)}
            {row('العملاء / الموردون', info.parties)}
            {row('الفواتير (كل الأنواع)', info.invoices)}
            {row('المرفقات', `${info.attachments} مرفق — ${fmtSize(info.attachmentBytes)}`)}
            {row('مفاتيح الإعدادات', info.settingsKeys)}
          </div>
          <div className="card p-5 text-xs text-slate-500 leading-6 h-fit">
            <div className="font-bold text-slate-700 mb-2">ماذا يتضمن الدعم الفني؟</div>
            <ul className="list-disc pr-4 space-y-1.5">
              <li>بيانات هذه الشاشة (سجّل النسخة والإصدار وحجم القاعدة قبل أي تواصل).</li>
              <li>لقطة شاشة من شاشة «النسخ الاحتياطي» في الإعدادات (تاريخ آخر نسخة).</li>
              <li>آخر 50 سطرًا من سجل العمليات («سجل عمليات المستخدمين») عند مشكلة بيانات.</li>
              <li>رسالة الخطأ كما ظهرت (متضمنة النص والكود HTTP إن وُجد).</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
