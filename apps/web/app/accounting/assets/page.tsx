'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

type Asset = {
  assetId: number; assetCode: string; name: string; category: string;
  cost: number; residualValue: number; usefulLifeMonths: number;
  inServiceDate: string; depreciationMethod: number; depreciationMethodName?: string;
  depreciationRatePct?: number | null; expectedEndDate?: string | null;
  tagNumber?: string | null; responsiblePerson?: string | null;
  status: number; statusName?: string; accumulatedDepreciation: number; bookValue: number;
};
type Summary = {
  assetCount: number; inServiceCount: number; totalCost: number; totalAccumulated: number;
  bookValue: number; registerMatchesGl: boolean;
  gl: { fixedAsset: number; accumulatedDep: number; depreciationExpense: number };
};

const CATEGORIES = ['أجهزة كمبيوتر', 'أثاث', 'أدوات', 'سيارات', 'معدات', 'مباني', 'أخرى'];
const STATUS_CLS: Record<number, string> = {
  1: 'bg-emerald-100 text-emerald-800',
  2: 'bg-amber-100 text-amber-800',
  3: 'bg-sky-100 text-sky-800',
  4: 'bg-sky-100 text-sky-800',
  5: 'bg-rose-100 text-rose-800',
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [disposeTarget, setDisposeTarget] = useState<Asset | null>(null);
  const [runMonth, setRunMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [runResult, setRunResult] = useState<any | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: '', category: 'أجهزة كمبيوتر', cost: '', usefulLifeMonths: '12', residualValue: '0',
    acquisitionDate: '', inServiceDate: '', depreciationMethod: 1, paymentType: 1,
    cashAccountId: 0, supplierId: 0, tagNumber: '', responsiblePerson: '',
  });
  const [parties, setParties] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [disposedForm, setDisposedForm] = useState({ disposalType: 1, disposalAmount: '', reason: '' });

  const monthOptions = useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 24; i += 1) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      d.setMonth(d.getMonth() - 1);
    }
    return out;
  }, []);

  const reload = useCallback(async () => {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (status) qs.set('status', String(status));
    const [list, sum] = await Promise.all([
      apiFetch<any>(`/accounting/assets?${qs.toString()}`),
      apiFetch<any>('/accounting/assets/report/summary'),
    ]);
    setAssets(Array.isArray(list) ? list : []);
    setSummary(sum ?? null);
  }, [category, status]);

  useEffect(() => {
    apiFetch<any>('/treasury/accounts')
      .then((rows) => setAccounts(Array.isArray(rows) ? rows.filter((a: any) => Number(a.type) === 1) : []))
      .catch(() => {});
    apiFetch<any>('/parties?type=2&pageSize=100')
      .then((r) => setParties(r?.items ?? r ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err?.message ?? 'تعذر تحميل الأصول'));
  }, [reload]);

  const filtered = useMemo(
    () => assets.filter((a) => (!category || a.category === category) && (!status || Number(a.status) === status)),
    [assets, category, status],
  );

  async function submitCreate() {
    setBusy(true);
    setError('');
    try {
      const body: any = {
        name: form.name, category: form.category, cost: Number(form.cost),
        usefulLifeMonths: Number(form.usefulLifeMonths), residualValue: Number(form.residualValue || 0),
        acquisitionDate: form.acquisitionDate || undefined, inServiceDate: form.inServiceDate || undefined,
        depreciationMethod: Number(form.depreciationMethod), paymentType: Number(form.paymentType),
        tagNumber: form.tagNumber || undefined, responsiblePerson: form.responsiblePerson || undefined,
      };
      if (Number(form.paymentType) === 1) body.cashAccountId = Number(form.cashAccountId) || undefined;
      else body.supplierId = Number(form.supplierId) || undefined;
      await apiFetch('/accounting/assets', { method: 'POST', body });
      setCreateOpen(false);
      setForm({ name: '', category: 'أجهزة كمبيوتر', cost: '', usefulLifeMonths: '12', residualValue: '0', acquisitionDate: '', inServiceDate: '', depreciationMethod: 1, paymentType: 1, cashAccountId: 0, supplierId: 0, tagNumber: '', responsiblePerson: '' });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تسجيل الأصل');
    } finally {
      setBusy(false);
    }
  }

  async function runDepreciation() {
    setBusy(true);
    setError('');
    setRunResult(null);
    try {
      const res = await apiFetch('/accounting/assets/run-depreciation', { method: 'POST', body: { periodMonth: runMonth } });
      setRunResult(res);
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تشغيل الإهلاك');
    } finally {
      setBusy(false);
    }
  }

  async function submitDispose() {
    if (!disposeTarget) return;
    setBusy(true);
    setError('');
    try {
      const body: any = {
        disposalType: Number(disposedForm.disposalType), disposalDate: new Date().toISOString().slice(0, 10),
        reason: disposedForm.reason || undefined,
      };
      if (Number(disposedForm.disposalType) === 1) {
        body.disposalAmount = Number(disposedForm.disposalAmount);
        if (accounts.length) body.cashAccountId = Number(accounts[0].cashAccountId);
      }
      await apiFetch(`/accounting/assets/${disposeTarget.assetId}/dispose`, { method: 'POST', body });
      setDisposeTarget(null);
      setDisposedForm({ disposalType: 1, disposalAmount: '', reason: '' });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر استبعاد الأصل');
    } finally {
      setBusy(false);
    }
  }

  async function reverseDisposal(assetId: number) {
    try {
      await apiFetch(`/accounting/assets/${assetId}/reverse-disposal`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر العكس');
    }
  }

  async function openDetail(assetId: number) {
    try {
      setDetail(await apiFetch(`/accounting/assets/${assetId}`));
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تحميل التفاصيل');
    }
  }

  return (
    <AppShell title="الأصول الثابتة والإهلاك">
      <AccountingNav />

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-4">{error}</div>}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[
          ['عدد الأصول', String(summary?.assetCount ?? 0)],
          ['قيد الاستخدام', String(summary?.inServiceCount ?? 0)],
          ['التكلفة الإجمالية', formatMoney(summary?.totalCost ?? 0)],
          ['مجمع الإهلاك', formatMoney(summary?.totalAccumulated ?? 0)],
          ['القيمة الدفترية', formatMoney(summary?.bookValue ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{value}</div>
          </div>
        ))}
      </div>
      {summary && (
        <div className={`card p-3 mb-4 text-xs ${summary.registerMatchesGl ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {summary.registerMatchesGl ? '✓ سجل الأصول مطابق تمامًا للأستاذ العام (1201 − 1202)' : '⚠ سجل الأصول غير مطابق للأستاذ — راجع القيود'}
        </div>
      )}

      {/* Toolbar: filters + run depreciation + add asset */}
      <div className="card p-4 flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="label">الفئة</label>
          <select className="input w-40" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">الكل</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">الحالة</label>
          <select className="input w-36" value={status} onChange={(e) => setStatus(Number(e.target.value))}>
            <option value={0}>الكل</option>
            <option value={1}>قيد الاستخدام</option>
            <option value={2}>متوقف</option>
            <option value={3}>مُباع</option>
            <option value={5}>منعدم/هالك</option>
          </select>
        </div>
        <div className="mr-auto flex flex-wrap gap-2 items-end">
          <div>
            <label className="label">شهر الإهلاك</label>
            <select className="input w-36" value={runMonth} onChange={(e) => setRunMonth(e.target.value)}>
              {monthOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button className="btn-soft" onClick={runDepreciation} disabled={busy}>تشغيل الإهلاك الشهري</button>
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ أصل جديد</button>
        </div>
      </div>

      {runResult && (
        <div className="card p-3 mb-4 text-xs text-slate-600">
          الإهلاك لشهر <b dir="ltr">{runResult.month}</b>: <b>{runResult.posted?.length ?? 0}</b> أصل بقيمة <b>{formatMoney(runResult.total ?? 0)}</b>
          {runResult.skipped?.length ? <> · متخطى: <b>{runResult.skipped.length}</b> ({runResult.skipped.map((s: any) => s.reason).join('، ')})</> : null}
        </div>
      )}

      {/* Assets table */}
      <div className="card p-4 overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr><th>الرمز</th><th>الأصل</th><th>الفئة</th><th>التكلفة</th><th>المتراكم</th><th>القيمة الدفترية</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.assetId}>
                <td dir="ltr" className="text-xs">{a.assetCode}</td>
                <td>{a.name}</td>
                <td className="text-xs">{a.category}</td>
                <td className="font-num" dir="ltr">{formatMoney(a.cost)}</td>
                <td className="font-num text-slate-500" dir="ltr">{formatMoney(a.accumulatedDepreciation)}</td>
                <td className="font-num font-bold" dir="ltr">{formatMoney(a.bookValue)}</td>
                <td><span className={`badge ${STATUS_CLS[a.status] ?? ''}`}>{a.statusName}</span></td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    <button className="btn-soft h-8 px-2 text-xs" onClick={() => openDetail(a.assetId)}>بطاقة</button>
                    {[1, 2].includes(Number(a.status)) && (
                      <button className="btn-soft h-8 px-2 text-xs" onClick={() => { setDisposeTarget(a); setDisposedForm({ disposalType: 1, disposalAmount: '', reason: '' }); }}>استبعاد</button>
                    )}
                    {[3, 5].includes(Number(a.status)) && (
                      <button className="btn-soft h-8 px-2 text-xs" onClick={() => reverseDisposal(a.assetId)}>عكس</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-6">لا توجد أصول — سجّل أصلًا جديدًا للبدء.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-3">تسجيل أصل ثابت</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="label">الاسم</label>
                <input className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="لابتوب Dell Latitude..." /></div>
              <div><label className="label">الفئة</label>
                <select className="input w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></div>
              <div><label className="label">التكلفة</label>
                <input className="input w-full font-num" dir="ltr" type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
              <div><label className="label">العمر (شهور)</label>
                <input className="input w-full font-num" dir="ltr" type="number" min={1} value={form.usefulLifeMonths} onChange={(e) => setForm({ ...form, usefulLifeMonths: e.target.value })} /></div>
              <div><label className="label">القيمة التخريدية</label>
                <input className="input w-full font-num" dir="ltr" type="number" min={0} value={form.residualValue} onChange={(e) => setForm({ ...form, residualValue: e.target.value })} /></div>
              <div><label className="label">تاريخ الاقتناء</label>
                <input className="input w-full" type="date" value={form.acquisitionDate} onChange={(e) => setForm({ ...form, acquisitionDate: e.target.value })} /></div>
              <div><label className="label">تاريخ بدء الاستخدام</label>
                <input className="input w-full" type="date" value={form.inServiceDate} onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })} /></div>
              <div><label className="label">طريقة الإهلاك</label>
                <select className="input w-full" value={form.depreciationMethod} onChange={(e) => setForm({ ...form, depreciationMethod: Number(e.target.value) })}>
                  <option value={1}>خط مستقيم</option>
                  {/* رصيد متناقص: معطّل حتى تكتمل اختباراته — تفعيله يتطلب اعتمادًا منفصلًا */}
                </select></div>
              <div><label className="label">الدفع</label>
                <select className="input w-full" value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: Number(e.target.value) })}>
                  <option value={1}>نقدًا</option>
                  <option value={2}>آجل (مورد)</option>
                </select></div>
              {Number(form.paymentType) === 1 ? (
                <div className="col-span-2"><label className="label">الخزينة</label>
                  <select className="input w-full" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: Number(e.target.value) })}>
                    <option value={0}>— اختر —</option>
                    {accounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
                  </select></div>
              ) : (
                <div className="col-span-2"><label className="label">المورد</label>
                  <select className="input w-full" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: Number(e.target.value) })}>
                    <option value={0}>— اختر —</option>
                    {parties.map((p) => <option key={p.partyId} value={p.partyId}>{p.name}</option>)}
                  </select></div>
              )}
              <div><label className="label">رقم البطاقة (اختياري)</label>
                <input className="input w-full" value={form.tagNumber} onChange={(e) => setForm({ ...form, tagNumber: e.target.value })} /></div>
              <div><label className="label">المسؤول (اختياري)</label>
                <input className="input w-full" value={form.responsiblePerson} onChange={(e) => setForm({ ...form, responsiblePerson: e.target.value })} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-soft" onClick={() => setCreateOpen(false)}>إلغاء</button>
              <button className="btn-primary" onClick={submitCreate} disabled={busy || !form.name || !form.cost}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* Dispose modal */}
      {disposeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDisposeTarget(null)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1">استبعاد الأصل</h3>
            <p className="text-xs text-slate-500 mb-3">{disposeTarget.assetCode} — {disposeTarget.name} · القيمة الدفترية {formatMoney(disposeTarget.bookValue)}</p>
            <div className="mb-3">
              <label className="label">نوع العملية</label>
              <select className="input w-full" value={disposedForm.disposalType} onChange={(e) => setDisposedForm({ ...disposedForm, disposalType: Number(e.target.value) })}>
                <option value={1}>بيع</option>
                <option value={4}>هلاك/تفريخ (بلا مقابل)</option>
              </select>
            </div>
            {Number(disposedForm.disposalType) === 1 && (
              <div className="mb-3"><label className="label">قيمة البيع</label>
                <input className="input w-full font-num" dir="ltr" type="number" min={0} value={disposedForm.disposalAmount} onChange={(e) => setDisposedForm({ ...disposedForm, disposalAmount: e.target.value })} /></div>
            )}
            <div className="mb-4"><label className="label">السبب (اختياري)</label>
              <input className="input w-full" value={disposedForm.reason} onChange={(e) => setDisposedForm({ ...disposedForm, reason: e.target.value })} /></div>
            <div className="flex gap-2 justify-end">
              <button className="btn-soft" onClick={() => setDisposeTarget(null)}>إلغاء</button>
              <button className="btn-primary" onClick={submitDispose} disabled={busy}>تأكيد الاستبعاد</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="card p-5 w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800">بطاقة الأصل {detail.asset?.assetCode}</h3>
              <button className="btn-soft h-8 px-3 text-xs" onClick={() => setDetail(null)}>إغلاق</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3 text-sm">
              {[
                ['الاسم', detail.asset?.name],
                ['الفئة', detail.asset?.category],
                ['التكلفة', formatMoney(detail.asset?.cost ?? 0)],
                ['المتراكم', formatMoney(detail.asset?.accumulatedDepreciation ?? 0)],
                ['القيمة الدفترية', formatMoney(detail.asset?.bookValue ?? 0)],
                ['الحالة', detail.asset?.statusName],
                ['العمر', `${detail.asset?.usefulLifeMonths} شهر`],
                ['الإهلاك', detail.asset?.depreciationMethodName],
                ['يبدأ', detail.asset?.inServiceDate],
              ].map(([label, value]) => (
                <div key={String(label)} className="card p-3">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="font-bold">{value}</div>
                </div>
              ))}
            </div>
            <div className="label mb-1">الإهلاك المرحّل</div>
            <table className="table w-full text-xs mb-3">
              <thead><tr><th>الشهر</th><th>الإهلاك</th><th>المتراكم</th><th>القيمة الدفترية</th><th>القيد</th></tr></thead>
              <tbody>
                {(detail.lines ?? []).map((l: any) => (
                  <tr key={l.lineId}>
                    <td dir="ltr">{l.periodMonth}</td>
                    <td className="font-num" dir="ltr">{formatMoney(l.depreciationAmount)}</td>
                    <td className="font-num" dir="ltr">{formatMoney(l.accumulated)}</td>
                    <td className="font-num" dir="ltr">{formatMoney(l.bookValue)}</td>
                    <td dir="ltr">#{l.journalId}</td>
                  </tr>
                ))}
                {!detail.lines?.length && <tr><td colSpan={5} className="text-center text-slate-400 py-4">لا توجد قيود إهلاك بعد</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
