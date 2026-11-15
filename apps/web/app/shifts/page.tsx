'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useSession } from '@/lib/session';
import { apiFetch, formatMoney, formatDate } from '@/lib/api';

/**
 * «فترات العمل» — مركز إدارة ورديات الكاشير تحت التشغيل.
 * نقطة البيع ترفض البيع بدون فترة مفتوحة عندما يكون مفتاح RequireCashierShift
 * مفعّلًا — هذه الشاشة هي المكان المركزي لفتح/إغلاق الفترات ومراقبتها.
 */
export default function ShiftsPage() {
  const { session } = useSession();

  const [accounts, setAccounts] = useState<any[]>([]);
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [requireShift, setRequireShift] = useState<boolean | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  // open form
  const [openAccountId, setOpenAccountId] = useState<number | null>(null);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  // close form
  const [countedCash, setCountedCash] = useState<number>(0);
  const [closeNotes, setCloseNotes] = useState<string>('');
  // shared
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function load() {
    const [accRows, shift, policy, shifts] = await Promise.all([
      apiFetch<any[]>('/treasury/accounts').catch(() => []),
      apiFetch<any>('/treasury/shifts/current').catch(() => null),
      apiFetch<any>('/treasury/shifts/policy').catch(() => null),
      apiFetch<any[]>('/treasury/shifts?limit=20').catch(() => []),
    ]);
    setAccounts(accRows ?? []);
    setCurrentShift(shift);
    setRequireShift(policy ? !!policy.requireShift : null);
    setHistory(shifts ?? []);
    if (shift) setCountedCash(Number(shift.expectedCash ?? 0));
    return accRows ?? [];
  }

  useEffect(() => {
    if (!session) return;
    load().then((rows) => {
      const branch = Number(session.activeBranchId);
      const drawer = rows.find((r) => Number(r.branchId) === branch && Number(r.type) === 1)
        ?? rows.find((r) => Number(r.branchId) === branch)
        ?? rows[0];
      setOpenAccountId((v) => v ?? drawer?.cashAccountId ?? null);
    });
  }, [session?.activeBranchId]);

  const branchDrawers = accounts.filter((a) => Number(a.branchId) === Number(session?.activeBranchId));

  async function openShift() {
    setBusy(true); setError(''); setDone('');
    try {
      await apiFetch('/treasury/shifts/open', {
        method: 'POST',
        body: { cashAccountId: openAccountId ?? branchDrawers[0]?.cashAccountId, openingBalance: Number(openingBalance) },
      });
      setOpeningBalance(0);
      setDone('تم فتح فترة العمل — تقدر تبدأ البيع من نقطة البيع.');
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر فتح الفترة');
    } finally { setBusy(false); }
  }

  async function closeShift() {
    setBusy(true); setError(''); setDone('');
    try {
      await apiFetch('/treasury/shifts/close', {
        method: 'POST',
        body: { countedCash: Number(countedCash), notes: closeNotes || undefined },
      });
      setCloseNotes('');
      setDone('تم إغلاق فترة العمل.');
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر إغلاق الفترة');
    } finally { setBusy(false); }
  }

  const diff = currentShift ? Number(countedCash) - Number(currentShift.expectedCash ?? 0) : 0;
  const openCount = history.filter((s) => Number(s.status) === 1).length;

  return (
    <AppShell title="فترات العمل">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {requireShift !== null && (
          <span className={`badge ${requireShift ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
            {requireShift ? 'إلزام الفترة مفعّل: البيع ممنوع بدون فترة مفتوحة' : 'إلزام الفترة متوقف: البيع مسموح بدون فترة'}
          </span>
        )}
        {currentShift && (
          <span className="badge bg-emerald-100 text-emerald-700 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            فترة مفتوحة #{currentShift.shiftNo}
          </span>
        )}
        <Link href="/pos" className="btn-primary text-xs mr-auto">فتح نقطة البيع</Link>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500 font-semibold">المتوقع في الدرج الآن</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1 font-num">
            {currentShift ? formatMoney(currentShift.expectedCash) : '—'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{currentShift ? currentShift.cashAccountName : 'لا توجد فترة مفتوحة'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 font-semibold">فترات مفتوحة في الفرع</div>
          <div className="text-xl font-extrabold text-slate-800 mt-1 font-num">{openCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">لكل الكاشيرين (للعرض فقط — الإغلاق لفترتك أنت)</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-slate-500 font-semibold">حركة الفترة الحالية</div>
          <div className="text-sm font-bold mt-1 font-num">
            <span className="text-emerald-700">داخل {formatMoney(currentShift?.cashIn ?? 0)}</span>
            {' · '}
            <span className="text-rose-600">خارج {formatMoney(currentShift?.cashOut ?? 0)}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">افتتحت بـ {formatMoney(currentShift?.openingBalance ?? 0)} · {currentShift ? formatDate(currentShift.openedAt) : ''}</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-title"><span>سجل الفترات — الفرع الحالي</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الفترة</th><th>الدرج النقدي</th><th>الكاشير</th><th>الفتح</th><th>الإغلاق</th>
                  <th>المتوقع</th><th>الفعلي</th><th>الفرق</th><th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.shiftId}>
                    <td className="font-semibold font-num">#{row.shiftNo}</td>
                    <td>{row.cashAccountName}</td>
                    <td>{row.cashierName}</td>
                    <td>{formatDate(row.openedAt)}</td>
                    <td>{row.closedAt ? formatDate(row.closedAt) : '—'}</td>
                    <td>{formatMoney(row.expectedCash)}</td>
                    <td>{row.countedCash === null ? '—' : formatMoney(row.countedCash)}</td>
                    <td className={`font-bold font-num ${Number(row.difference) < 0 ? 'text-rose-600' : Number(row.difference) > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {row.difference === null ? '—' : formatMoney(row.difference)}
                    </td>
                    <td>
                      <span className={`badge ${Number(row.status) === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {Number(row.status) === 1 ? 'مفتوحة' : 'مغلقة'}
                      </span>
                    </td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد فترات بعد</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {currentShift ? (
            <form
              className="card p-5 space-y-3"
              onSubmit={(e) => { e.preventDefault(); closeShift(); }}
            >
              <div className="font-bold">إغلاق فترة العمل</div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm space-y-1">
                <div className="font-semibold text-emerald-800">
                  فترة #{currentShift.shiftNo} · {currentShift.cashAccountName}
                </div>
                <div className="text-emerald-700">افتتحت: {formatDate(currentShift.openedAt)} بـ {formatMoney(currentShift.openingBalance)}</div>
                <div className="font-extrabold text-emerald-900 font-num">المتوقع في الدرج: {formatMoney(currentShift.expectedCash)}</div>
              </div>
              <div>
                <label className="label">النقد المعدود فعليًا</label>
                <input className="input font-num" type="number" step="0.01" value={countedCash}
                  onChange={(e) => setCountedCash(Number(e.target.value))} />
              </div>
              <div className={`text-sm font-bold font-num ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                {diff === 0 ? 'مطابق تمامًا' : diff > 0 ? `زيادة ${formatMoney(diff)}` : `عجز ${formatMoney(Math.abs(diff))}`}
                <span className="text-[11px] font-normal text-slate-400"> — الفرق يُسجل في الخزينة بقيد محاسبي عند الإغلاق</span>
              </div>
              <div>
                <label className="label">ملاحظات (اختياري)</label>
                <input className="input" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
              </div>
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? 'جارٍ الإغلاق…' : 'إغلاق الفترة'}
              </button>
            </form>
          ) : (
            <form
              className="card p-5 space-y-3"
              onSubmit={(e) => { e.preventDefault(); openShift(); }}
            >
              <div className="font-bold">بدء فترة عمل</div>
              <div className="text-xs text-slate-500">
                الفترة ترتبط بدرج نقدي في الفرع الحالي وباسمك — كل مبيعاتك النقدية تُحتسب عليها حتى الإغلاق.
              </div>
              <div>
                <label className="label">الدرج النقدي</label>
                <select className="input" value={openAccountId ?? ''}
                  onChange={(e) => setOpenAccountId(Number(e.target.value))}>
                  {branchDrawers.map((a) => (
                    <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>
                  ))}
                  {branchDrawers.length === 0 && <option value="">لا توجد أدراج نقدية في هذا الفرع</option>}
                </select>
              </div>
              <div>
                <label className="label">رصيد بداية الفترة (الفلوس الموجودة في الدرج)</label>
                <input className="input font-num" type="number" step="0.01" value={openingBalance}
                  onChange={(e) => setOpeningBalance(Number(e.target.value))} />
              </div>
              <button className="btn-primary w-full" disabled={busy || !openAccountId}>
                {busy ? 'جارٍ الفتح…' : 'بدء الفترة'}
              </button>
              <div className="text-[11px] text-slate-400">
                {requireShift ? 'ملاحظة: إلزام الفترة مفعّل — نقطة البيع لن تقبل بيعًا قبل بدء الفترة.' : 'ملاحظة: إلزام الفترة متوقف حاليًا (يمكن تفعيله من الإعدادات).'}
              </div>
            </form>
          )}

          {(error || done) && (
            <div className={`card p-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
              {error || done}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
