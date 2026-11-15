'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

const empty = { currencyCode: '', name: '', symbol: '', rate: 1, isBase: false };

/** Currencies + exchange rates — moved here from accounting (definitions hub). */
export default function CurrenciesScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/accounting/currencies')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    const code = String(form.currencyCode ?? '').trim().toUpperCase();
    if (!code) { setError('كود العملة مطلوب'); return; }
    if (!Number(form.rate) || Number(form.rate) <= 0) { setError('سعر الصرف يجب أن يكون أكبر من صفر'); return; }
    try {
      await apiFetch('/accounting/currencies', {
        method: 'POST',
        body: {
          currencyCode: code,
          name: form.name?.trim() || code,
          symbol: form.symbol?.trim() || null,
          rate: Number(form.rate),
          isBase: !!form.isBase,
        },
      });
      setMessage('تم الحفظ (العملة تُنشأ أو تُحدَّث بنفس الكود)');
      setForm(empty);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  const base = rows.find((row) => row.isBase);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title">
          <span>العملات ({rows.length})</span>
          {base && <span className="text-xs font-normal text-slate-500">العملة الأساسية: {base.currencyCode}</span>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الكود</th><th>الاسم</th><th>الرمز</th><th>السعر مقابل الأساس</th><th>الأساسية</th><th></th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.currencyCode}>
                  <td className="font-mono text-xs font-bold">{row.currencyCode}</td>
                  <td>{row.name}</td>
                  <td dir="ltr" className="text-right">{row.symbol ?? '—'}</td>
                  <td className="font-semibold">{Number(row.rate).toFixed(4)}</td>
                  <td>{row.isBase ? <span className="badge bg-emerald-50 text-emerald-700">أساسية</span> : '—'}</td>
                  <td><button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({ currencyCode: row.currencyCode, name: row.name, symbol: row.symbol ?? '', rate: row.rate, isBase: !!row.isBase })}>تعديل</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد عملات — أضف عملة الأساس (EGP) أولًا</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>
      <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
        <div className="font-bold">عملة جديدة / تعديل بنفس الكود</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">الكود</label><input className="input font-mono" required dir="ltr" maxLength={8} placeholder="USD" value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })} /></div>
          <div><label className="label">الرمز</label><input className="input" dir="ltr" placeholder="$" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} /></div>
        </div>
        <div><label className="label">الاسم</label><input className="input" placeholder="دولار أمريكي" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="label">سعر الصرف (مقابل العملة الأساسية)</label><input className="input" type="number" step="0.0001" min="0" dir="ltr" value={form.rate} onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })} /></div>
        <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={!!form.isBase} onChange={(e) => setForm({ ...form, isBase: e.target.checked })} />العملة الأساسية للنظام</label>
        <div className="text-[11px] text-slate-400 leading-5">حفظ بنفس الكود يُحدّث الاسم/الرمز/السعر — لا يمكن حذف عملة مستخدمة. عند تغيير العملة الأساسية يُنصح بمراجعة قيود التحويل في المحاسبة أولًا.</div>
        <button type="submit" className="btn-primary w-full">حفظ</button>
        {form.currencyCode && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
      </form>
    </div>
  );
}
