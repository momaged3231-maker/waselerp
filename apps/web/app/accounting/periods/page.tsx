'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

type Period = {
  periodId: number; name: string; startDate: string; endDate?: string | null;
  isClosed: boolean; closedAt?: string | null; closedBy?: string | null;
  netIncome?: number | null; closingEntryId?: number | null; journalCount?: number;
};
type CheckRow = { checkCode: string; checkLabel: string; status: number; statusName?: string; details?: string | null };
type Report = { period: Period; checks: CheckRow[]; closingJournal: any | null };

const STATUS_CLS: Record<number, string> = {
  1: 'bg-slate-100 text-slate-600',
  2: 'bg-emerald-100 text-emerald-800',
  3: 'bg-rose-100 text-rose-800',
  4: 'bg-amber-100 text-amber-800',
};
const STATUS_NAME: Record<number, string> = {
  1: 'معلق', 2: 'ناجح', 3: 'فاشل', 4: 'مستثنى',
};

export default function PeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [checklist, setChecklist] = useState<{ period: Period; checks: CheckRow[]; passed: number; failed: number; bypassed: number } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [bypassTarget, setBypassTarget] = useState<Period | null>(null);
  const [bypassReason, setBypassReason] = useState('');
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });

  const reload = useCallback(async () => {
    const rows = await apiFetch<any[]>('/accounting/periods');
    setPeriods(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err?.message ?? 'تعذر تحميل الفترات'));
  }, [reload]);

  async function submitCreate() {
    if (!form.startDate) { setError('تاريخ البداية مطلوب'); return; }
    setBusy(true);
    setError('');
    try {
      await apiFetch('/accounting/periods', {
        method: 'POST',
        body: { name: form.name || undefined, startDate: form.startDate, endDate: form.endDate || null },
      });
      setCreateOpen(false);
      setForm({ name: '', startDate: '', endDate: '' });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر إنشاء الفترة');
    } finally {
      setBusy(false);
    }
  }

  async function runPreclose(p: Period) {
    setError('');
    try {
      const res = await apiFetch<any>(`/accounting/periods/${p.periodId}/preclose-check`, { method: 'POST', body: {} });
      setChecklist({ period: p, checks: res.checks ?? [], passed: res.passed ?? 0, failed: res.failed ?? 0, bypassed: res.bypassed ?? 0 });
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تشغيل الفحص');
    }
  }

  async function confirmClose(p: Period) {
    if (!window.confirm(`إقفال «${p.name}»؟ سيتم ترحيل صافي الدخل إلى الأرباح المحتجزة (3103) وإغلاق الفترة نهائيًا.`)) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/accounting/periods/${p.periodId}/close-month`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الإقفال — راجع نتائج الفحص المسبق أولًا');
    } finally {
      setBusy(false);
    }
  }

  async function confirmCloseWithBypass() {
    if (!bypassTarget || !bypassReason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/accounting/periods/${bypassTarget.periodId}/close-month`, {
        method: 'POST', body: { bypassReason: bypassReason.trim() },
      });
      setBypassTarget(null);
      setBypassReason('');
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الإقفال');
    } finally {
      setBusy(false);
    }
  }

  async function reverseClose(p: Period) {
    const reason = window.prompt(`عكس إقفال «${p.name}»؟ اذكر السبب (إلزامي):`);
    if (!reason?.trim()) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/accounting/periods/${p.periodId}/reverse-close`, { method: 'POST', body: { reason: reason.trim() } });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر العكس');
    } finally {
      setBusy(false);
    }
  }

  async function openReport(p: Period) {
    setError('');
    try {
      setReport(await apiFetch<any>(`/accounting/periods/${p.periodId}/close-report`));
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تحميل التقرير');
    }
  }

  const summary = useMemo(() => ({
    open: periods.filter((p) => !p.isClosed).length,
    closed: periods.filter((p) => p.isClosed).length,
    journals: periods.reduce((sum, p) => sum + (p.journalCount ?? 0), 0),
  }), [periods]);

  return (
    <AppShell title="الفترات المحاسبية والإقفال">
      <AccountingNav />

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-4">{error}</div>}

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          ['فترات مفتوحة', String(summary.open)],
          ['فترات مقفولة', String(summary.closed)],
          ['إجمالي القيود', String(summary.journals)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-2 mb-4">
        <div className="text-xs text-slate-500">إنشاء فترة يدويًا فقط — الإقفال آلي بالكامل: حساب نتيجة الفترة من الدفاتر وترحيلها إلى الأرباح المحتجزة.</div>
        <button className="btn-primary mr-auto" onClick={() => setCreateOpen(true)}>+ فترة جديدة</button>
      </div>

      <div className="card p-4 overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th>صافي الدخل</th><th></th></tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.periodId}>
                <td className="font-bold">{p.name}</td>
                <td dir="ltr" className="text-xs">{p.startDate?.slice(0, 10)}</td>
                <td dir="ltr" className="text-xs">{p.endDate?.slice(0, 10) ?? 'بلا نهاية'}</td>
                <td>
                  {p.isClosed
                    ? <span className="badge bg-slate-200 text-slate-700">مقفولة</span>
                    : <span className="badge bg-emerald-100 text-emerald-800">مفتوحة</span>}
                </td>
                <td className="font-num" dir="ltr">{p.netIncome != null ? formatMoney(p.netIncome) : '—'}</td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {!p.isClosed && <button className="btn-soft h-8 px-2 text-xs" onClick={() => runPreclose(p)}>فحص مسبق</button>}
                    {!p.isClosed && <button className="btn-primary h-8 px-2 text-xs" onClick={() => confirmClose(p)} disabled={busy}>إقفال</button>}
                    {!p.isClosed && <button className="btn-soft h-8 px-2 text-xs text-amber-700" onClick={() => { setBypassTarget(p); setBypassReason(''); }}>إقفال مع استثناء</button>}
                    <button className="btn-soft h-8 px-2 text-xs" onClick={() => openReport(p)}>تقرير</button>
                    {p.isClosed && <button className="btn-soft h-8 px-2 text-xs text-rose-700" onClick={() => reverseClose(p)}>عكس</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!periods.length && (
              <tr><td colSpan={6} className="text-center text-slate-400 py-6">لا توجد فترات — أنشئ فترة للبدء.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create period modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCreateOpen(false)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-3">فترة جديدة</h3>
            <div className="space-y-2">
              <input className="input w-full" placeholder="الاسم (اختياري — سيُشتق من التاريخ)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="input w-full" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <input className="input w-full" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} placeholder="تاريخ النهاية (اختياري — بلا نهاية)" />
              <p className="text-[11px] text-slate-500">فترة بلا نهاية تُقفل بحساب كل الحركات حتى اليوم.</p>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn-soft" onClick={() => setCreateOpen(false)}>إلغاء</button>
              <button className="btn-primary" onClick={submitCreate} disabled={busy || !form.startDate}>حفظ</button>
            </div>
          </div>
        </div>
      )}

      {/* Checklist modal */}
      {checklist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setChecklist(null)}>
          <div className="card p-5 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-800">الفحص المسبق — {checklist.period.name}</h3>
              <button className="btn-soft h-8 px-3 text-xs" onClick={() => setChecklist(null)}>إغلاق</button>
            </div>
            <div className="text-xs text-slate-500 mb-3">{checklist.passed} ناجح · {checklist.failed} فاشل · {checklist.bypassed} مستثنى</div>
            <table className="table w-full text-xs">
              <thead><tr><th>الفحص</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
              <tbody>
                {checklist.checks.map((c) => (
                  <tr key={c.checkCode}>
                    <td>{c.checkLabel}</td>
                    <td><span className={`badge ${STATUS_CLS[c.status] ?? ''}`}>{c.statusName ?? STATUS_NAME[c.status] ?? c.status}</span></td>
                    <td className="text-slate-500">{c.details ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bypass modal */}
      {bypassTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBypassTarget(null)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1">إقفال مع استثناء</h3>
            <p className="text-xs text-slate-500 mb-3">{bypassTarget.name} — الإقفال مع تجاهل سطور الكشف غير المطابقة يتطلب سببًا مكتوبًا (يُسجّل في سجل التدقيق).</p>
            <input className="input w-full mb-3" autoFocus placeholder="سبب التجاوز (إلزامي)" value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmCloseWithBypass()} />
            <div className="flex gap-2 justify-end">
              <button className="btn-soft" onClick={() => setBypassTarget(null)}>إلغاء</button>
              <button className="btn-primary" onClick={confirmCloseWithBypass} disabled={!bypassReason.trim()}>إقفال مع الاستثناء</button>
            </div>
          </div>
        </div>
      )}

      {/* Close report modal */}
      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReport(null)}>
          <div className="card p-5 w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-800">تقرير الإقفال — {report.period.name}</h3>
              <button className="btn-soft h-8 px-3 text-xs" onClick={() => setReport(null)}>إغلاق</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
              {[
                ['الحالة', report.period.isClosed ? 'مقفولة' : 'مفتوحة'],
                ['صافي الدخل', report.period.netIncome != null ? formatMoney(report.period.netIncome) : '—'],
                ['القيد', report.period.closingEntryId ? `#${report.period.closingEntryId}` : '—'],
                ['قفل بواسطة', report.period.closedBy ?? '—'],
              ].map(([label, value]) => (
                <div key={String(label)} className="card p-3">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="font-bold">{value}</div>
                </div>
              ))}
            </div>
            {(report.checks ?? []).length > 0 && (
              <>
                <div className="label mb-1">نتائج الفحص</div>
                <table className="table w-full text-xs mb-3">
                  <thead><tr><th>الفحص</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
                  <tbody>
                    {report.checks.map((c: any) => (
                      <tr key={c.checkCode}>
                        <td>{c.checkLabel}</td>
                        <td><span className={`badge ${STATUS_CLS[c.status] ?? ''}`}>{c.statusName}</span></td>
                        <td className="text-slate-500">{c.details ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {report.closingJournal && (
              <>
                <div className="label mb-1">قيد الإقفال</div>
                <table className="table w-full text-xs">
                  <thead><tr><th>الحساب</th><th>المدين</th><th>الدائن</th></tr></thead>
                  <tbody>
                    {(report.closingJournal.lines ?? []).map((l: any) => (
                      <tr key={l.lineNo}>
                        <td>{l.accountCode} — {l.accountName}</td>
                        <td className="font-num" dir="ltr">{Number(l.debit) > 0 ? formatMoney(l.debit) : '—'}</td>
                        <td className="font-num" dir="ltr">{Number(l.credit) > 0 ? formatMoney(l.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
