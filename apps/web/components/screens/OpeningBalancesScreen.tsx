'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { downloadCsv } from '@/lib/export';

const TYPE_LABEL: Record<number, string> = { 1: 'عميل', 2: 'مورد', 3: 'عميل ومورد' };

/** Tools → «تعيين أرصدة البداية» — opening balances for customers and suppliers (one balanced journal). */
export default function OpeningBalancesScreen() {
  const [rows, setRows] = useState<any[]>([]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [type, setType] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    const qs = new URLSearchParams();
    if (search.trim()) qs.set('search', search.trim());
    if (type) qs.set('type', String(type));
    try {
      setRows(await apiFetch<any[]>(`/parties/opening-balances?${qs.toString()}`));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التحميل — تحتاج صلاحية عرض الأطراف');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);

  const entered = Object.entries(amounts)
    .map(([partyId, value]) => ({ partyId: Number(partyId), amount: Number(value) }))
    .filter((entry) => Number.isFinite(entry.amount) && entry.amount !== 0);
  const totalDr = entered.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);
  const totalCr = entered.filter((e) => e.amount < 0).reduce((sum, e) => sum + Math.abs(e.amount), 0);

  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    setResult(null);
    try {
      const data = await apiFetch<any>('/parties/opening-balances', { method: 'POST', body: { date, entries: entered } });
      setResult(data);
      setAmounts({});
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  function exportSheet() {
    downloadCsv('wasel-opening-balances', rows.map((row) => ({
      'الكود': row.code ?? '', 'الاسم': row.name, 'النوع': TYPE_LABEL[row.partyType] ?? row.partyType,
      'الرصيد الحالي': Number(row.balance ?? 0), 'رصيد افتتاحي مسجل': Number(row.openingAmount ?? 0),
    })));
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="font-bold text-slate-800 mb-1">تعيين أرصدة البداية — العملاء والموردون</div>
        <p className="text-xs text-slate-500 leading-6 mb-3">
          أدخل مديونية كل عميل أو مورد قبل بداية العمل على النظام. الحفظ ينشئ قيدًا متوازنًا واحدًا (مدين ذمم / دائن ذمم / فرق إلى «الأرباح المحتجزة»)
          وقيود افتتاحية في دفتر الطرف — مرة واحدة لكل طرف؛ إعادة الحفظ لطرف له رصيد افتتاحي تُتجاهله مع إشعاره.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48"><label className="label">بحث</label><input className="input" placeholder="الاسم / الكود / الهاتف" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
          <div><label className="label">النوع</label><select className="input w-36" value={type} onChange={(e) => setType(Number(e.target.value))}><option value={0}>الكل</option><option value={1}>عملاء</option><option value={2}>موردون</option></select></div>
          <button className="btn-soft text-sm" onClick={load}>عرض</button>
          <button className="btn-soft text-sm" onClick={exportSheet}>تصدير CSV</button>
          <div><label className="label">تاريخ الرصيد</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-4 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="card">
        <div className="card-title">
          <span>الأطراف ({rows.length})</span>
          <span className="text-xs font-normal text-slate-500">المدين {formatMoney(totalDr)} · الدائن {formatMoney(totalCr)}</span>
        </div>
        <div className="table-wrap max-h-[34rem] overflow-y-auto">
          <table className="table">
            <thead><tr><th>الكود</th><th>الاسم</th><th>النوع</th><th>الرصيد الحالي</th><th>رصيد مسجل</th><th>رصيد البداية</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.partyId} className={Number(row.openingRows) > 0 ? 'bg-slate-50' : ''}>
                  <td className="font-mono text-xs">{row.code ?? '—'}</td>
                  <td className="font-semibold">{row.name}</td>
                  <td className="text-xs">{TYPE_LABEL[row.partyType] ?? row.partyType}</td>
                  <td className={Number(row.balance) > 0 ? 'text-rose-600 font-bold' : ''}>{formatMoney(row.balance)}</td>
                  <td className="text-slate-500">{Number(row.openingAmount) ? formatMoney(row.openingAmount) : '—'}</td>
                  <td>
                    {Number(row.openingRows) > 0 ? (
                      <span className="badge bg-emerald-50 text-emerald-700">مسجل ✓</span>
                    ) : (
                      <input className="input w-32 py-1 text-sm" dir="ltr" type="number" step="0.01"
                        placeholder="+ مدين / − دائن" value={amounts[row.partyId] ?? ''}
                        onChange={(e) => setAmounts({ ...amounts, [row.partyId]: e.target.value })} />
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد أطراف — أضف عملاء/موردين من «البيانات الأساسية» أو استوردهم من «استيراد عملاء وموردين»</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card-footer flex flex-wrap items-center justify-between gap-2 p-3 border-t border-slate-100">
          <div className="text-xs text-slate-500">موجب = مديونية الطرف عليك المدين · سالب = تديُّنك أنت (عربون/سلف) — القيد يُغلق بـ «الأرباح المحتجزة»</div>
          <button className="btn-primary" disabled={busy || entered.length === 0} onClick={save}>{busy ? 'جارٍ الحفظ…' : `حفظ الأرصدة (${entered.length})`}</button>
        </div>
      </div>

      {result && (
        <div className="card p-5 border-emerald-200 bg-emerald-50">
          <div className="font-extrabold text-emerald-800">تم حفظ {result.saved} طرف ({result.date}) — قيد رقم {result.journalId ?? '—'}</div>
          {Array.isArray(result.skippedExisting) && result.skippedExisting.length > 0 && (
            <div className="text-xs text-amber-800 mt-1">تجاهل {result.skippedExisting.length} طرف له رصيد افتتاحي مسجل مسبقًا.</div>
          )}
          <div className="text-xs text-emerald-800 mt-1">المدين {formatMoney(result.arTotal)} · الدائن {formatMoney(result.apTotal)}</div>
        </div>
      )}
    </div>
  );
}
