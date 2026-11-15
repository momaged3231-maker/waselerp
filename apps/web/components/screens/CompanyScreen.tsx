'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const KEYS = ['CompanyName', 'CompanyPhone', 'CompanyAddress', 'TaxNumber', 'InvoiceFooter'] as const;
const LABELS: Record<(typeof KEYS)[number], { label: string; placeholder?: string; dir?: string; textarea?: boolean }> = {
  CompanyName: { label: 'اسم الشركة (يُطبع أعلى الإيصال والفاتورة)', placeholder: 'شركة الوصل للتجارة' },
  CompanyPhone: { label: 'تليفون الشركة', placeholder: '02-12345678', dir: 'ltr' },
  CompanyAddress: { label: 'العنوان', placeholder: 'الجيزة — شارع…' },
  TaxNumber: { label: 'الرقم الضريبي', placeholder: '123-456-789', dir: 'ltr' },
  InvoiceFooter: { label: 'نص تذييل الفاتورة', placeholder: 'شكراً لزيارتكم', textarea: true },
};

/** Company identity printed on receipts/invoices — moved here from system settings. */
export default function CompanyScreen() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const settings = await apiFetch<Record<string, string>>('/admin/settings');
      const next: Record<string, string> = {};
      for (const key of KEYS) next[key] = settings[key] ?? '';
      setForm(next);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التحميل — تحتاج صلاحية إدارة المستخدمين');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload: Record<string, string> = {};
      for (const key of KEYS) payload[key] = String(form[key] ?? '').trim();
      await apiFetch('/admin/settings', { method: 'PUT', body: payload });
      setMessage('تم حفظ بيانات الشركة — تظهر فورًا على الإيصال والفاتورة المطبوعة');
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <form onSubmit={save} className="card p-5 space-y-3 lg:col-span-3">
        <div className="font-bold text-slate-800">بيانات الشركة (تُطبع على الإيصال والفاتورة)</div>
        {KEYS.map((key) => {
          const cfg = LABELS[key];
          return (
            <div key={key}>
              <label className="label" htmlFor={`company-${key}`}>{cfg.label}</label>
              {cfg.textarea ? (
                <textarea id={`company-${key}`} className="input h-20" dir={cfg.dir} placeholder={cfg.placeholder} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              ) : (
                <input id={`company-${key}`} className="input" dir={cfg.dir} placeholder={cfg.placeholder} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              )}
            </div>
          );
        })}
        {error && <div className="text-xs text-rose-600">{error}</div>}
        {message && <div className="text-xs text-emerald-700">{message}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ بيانات الشركة'}</button>
      </form>

      <div className="card p-5 text-xs text-slate-500 leading-6 lg:col-span-2 h-fit">
        <div className="font-bold text-slate-700 mb-2">أين تظهر هذه البيانات؟</div>
        <ul className="list-disc pr-4 space-y-1.5">
          <li>رأس <b>الإيصال الحراري</b> من شاشة نقطة البيع (اسم الشركة والعنوان والهاتف والرقم الضريبي).</li>
          <li><b>تذكرة المطبخ</b> وفواتير <b>A5/A4</b> المطبوعة من المتصفح.</li>
          <li><b>تذييل كل فاتورة</b> — نص قصير يظهر أسفل كل مطبوعة (شكرًا / سياسة الاسترجاع).</li>
          <li>تُحفظ كإعدادات نظام عادية (نفس القيم يديرها كل الفرع بإعدادات الإيصال ← «إعدادات النظام ← الطباعة»).</li>
        </ul>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
          ملاحظة: هذه البيانات تُطبّق على كل الفروع (لكل فرع إعدادات فرعه لطباعة الأقسام والنسخ من «إعدادات النظام ← الطباعة»).
        </div>
      </div>
    </div>
  );
}
