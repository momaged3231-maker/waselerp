'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';

type BankAccount = {
  bankAccountId: number; name: string; bankName?: string; accountNo?: string;
  glAccountId?: number; reconciledBalance?: number | null; lastReconciledAt?: string | null;
};
type StatementLine = {
  lineId: number; statementDate: string; description: string; reference?: string;
  movementType: number; movementTypeName?: string; amount: number; balanceAfter?: number | null;
  status: number; statusName?: string; matchDifference?: number; matchedJournalId?: number | null;
};
type ReconRun = {
  runId: number; runNo: string; runDate: string; bookBalance: number; statementBalance: number;
  variance: number; matchedCount: number; unmatchedCount: number; status: number;
  statusName?: string; journalId?: number | null; reverseJournalId?: number | null; notes?: string;
};
type ImportResult = { created: number; duplicates: any[]; errors: any[]; skipped: any[] };

const STATUS_CLS: Record<number, string> = {
  1: 'bg-amber-100 text-amber-800',
  2: 'bg-emerald-100 text-emerald-800',
  3: 'bg-emerald-100 text-emerald-800',
  4: 'bg-sky-100 text-sky-800',
  5: 'bg-rose-100 text-rose-800',
  6: 'bg-orange-100 text-orange-800',
};

const CSV_TEMPLATE = `date,description,reference,amount,movement_type
2026-11-01,إيداع من العميل,TRX-001,5000,deposit
2026-11-02,رسوم بنكية,FEE-001,-25,fee`;

export default function BankReconPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState<number>(0);
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [csv, setCsv] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [matchTarget, setMatchTarget] = useState<StatementLine | null>(null);
  const [matchEntryId, setMatchEntryId] = useState('');
  const [report, setReport] = useState<any | null>(null);

  const selected = useMemo(() => accounts.find((a) => a.bankAccountId === accountId) ?? null, [accounts, accountId]);

  const reload = useCallback(async (acc = accountId) => {
    if (!acc) return;
    const [stmt, runRows] = await Promise.all([
      apiFetch<any>(`/treasury/bank-recon/statements?accountId=${acc}`),
      apiFetch<any>(`/treasury/bank-recon/runs?accountId=${acc}`),
    ]);
    setLines(Array.isArray(stmt) ? stmt : []);
    setRuns(Array.isArray(runRows) ? runRows : []);
  }, [accountId]);

  useEffect(() => {
    apiFetch<any>('/treasury/bank-recon/accounts')
      .then((rows) => {
        const list = (Array.isArray(rows) ? rows : []) as BankAccount[];
        setAccounts(list);
        if (list.length && !accountId) setAccountId(list[0].bankAccountId);
      })
      .catch((err) => setError(err?.message ?? 'تعذر تحميل الحسابات البنكية'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err?.message ?? 'تعذر تحميل الكشف'));
  }, [reload]);

  async function doImport() {
    if (!accountId || !csv.trim()) { setError('اختر حسابًا وألصق محتوى CSV'); return; }
    setImporting(true);
    setError('');
    setImportResult(null);
    try {
      const res = await apiFetch<ImportResult>('/treasury/bank-recon/statements/import', {
        method: 'POST', body: { accountId, csv },
      });
      setImportResult(res);
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'فشل الاستيراد');
    } finally {
      setImporting(false);
    }
  }

  async function autoMatch() {
    setBusy(true);
    setError('');
    try {
      await apiFetch('/treasury/bank-recon/auto-match', { method: 'POST', body: { accountId } });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذرت المطابقة التلقائية');
    } finally {
      setBusy(false);
    }
  }

  async function confirmManualMatch() {
    if (!matchTarget) return;
    const entryId = Number(matchEntryId);
    if (!entryId) { setError('رقم الطرف غير صحيح'); return; }
    try {
      await apiFetch(`/treasury/bank-recon/statements/lines/${matchTarget.lineId}/match`, {
        method: 'POST', body: { entryId },
      });
      setMatchTarget(null);
      setMatchEntryId('');
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذرت المطابقة');
    }
  }

  async function unmatch(line: StatementLine) {
    try {
      await apiFetch(`/treasury/bank-recon/statements/lines/${line.lineId}/unmatch`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر فك المطابقة');
    }
  }

  async function markTiming(line: StatementLine, kind: 'pending_deposit' | 'outstanding_check') {
    try {
      await apiFetch(`/treasury/bank-recon/statements/lines/${line.lineId}/mark-timing`, {
        method: 'POST', body: { kind },
      });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر وسم السطر');
    }
  }

  async function createRun() {
    const statementBalance = window.prompt('رصيد كشف البنك عند تاريخ المسير (اتركه فارغًا لاستخدام آخر رصيد في الكشف):');
    setBusy(true);
    setError('');
    try {
      const body: any = { accountId };
      if (statementBalance && statementBalance.trim() !== '') body.statementBalance = Number(statementBalance);
      await apiFetch('/treasury/bank-recon/runs', { method: 'POST', body });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر إنشاء المسيرة');
    } finally {
      setBusy(false);
    }
  }

  async function postRun(run: ReconRun) {
    if (!window.confirm(`ترحيل المسيرة ${run.runNo}؟ سيُنشأ قيد تسوية واحد متوازن عبر محرك القيد المزدوج.`)) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/treasury/bank-recon/runs/${run.runId}/post`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر ترحيل المسيرة');
    } finally {
      setBusy(false);
    }
  }

  async function reverseRun(run: ReconRun) {
    if (!window.confirm(`عكس المسيرة ${run.runNo}؟ سيُنشأ قيد عكسي والسطور تعود غير مطابقة.`)) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/treasury/bank-recon/runs/${run.runId}/reverse`, { method: 'POST', body: {} });
      await reload();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر العكس');
    } finally {
      setBusy(false);
    }
  }

  async function openReport(run: ReconRun) {
    try {
      setReport(await apiFetch(`/treasury/bank-recon/runs/${run.runId}/report`));
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تحميل التقرير');
    }
  }

  const summary = useMemo(() => {
    const unmatchedIn = lines.filter((l) => l.status === 1 && Number(l.amount) > 0).reduce((s, l) => s + Number(l.amount), 0);
    const unmatchedOut = lines.filter((l) => l.status === 1 && Number(l.amount) < 0).reduce((s, l) => s + Math.abs(Number(l.amount)), 0);
    const timing = lines.filter((l) => l.status === 4).reduce((s, l) => s + Math.abs(Number(l.amount)), 0);
    const matched = lines.filter((l) => [2, 3, 6].includes(l.status)).length;
    return { unmatchedIn, unmatchedOut, timing, matched, unmatched: lines.length - matched, total: lines.length };
  }, [lines]);

  return (
    <AppShell title="المطابقة البنكية">
      <AccountingNav />

      {/* Account selector + headline numbers */}
      <div className="card p-4 flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label">الحساب البنكي</label>
          <select className="input w-72" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            <option value={0}>— اختر —</option>
            {accounts.map((a) => (
              <option key={a.bankAccountId} value={a.bankAccountId}>{a.name}{a.bankName ? ` · ${a.bankName}` : ''}</option>
            ))}
          </select>
        </div>
        {selected?.reconciledBalance != null && (
          <div className="text-sm text-slate-600">آخر رصيد مطابَق: <b>{formatMoney(selected.reconciledBalance)}</b>{selected.lastReconciledAt ? ` · ${formatDate(selected.lastReconciledAt)}` : ''}</div>
        )}
        <div className="flex gap-2 mr-auto">
          <button className="btn-soft" onClick={autoMatch} disabled={busy || !accountId}>مطابقة تلقائية</button>
          <button className="btn-primary" onClick={createRun} disabled={busy || !accountId}>إنشاء مسيرة</button>
        </div>
      </div>

      {error && <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm mb-4">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          ['أسطر الكشف', String(summary.total)],
          ['مطابقة', String(summary.matched)],
          ['غير مطابقة', String(summary.unmatched)],
          ['توقيت (بلا قيد)', formatMoney(summary.timing)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-extrabold text-slate-800 mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Import */}
      <div className="card p-4 mb-4">
        <div className="label mb-1">استيراد كشف البنك (CSV)</div>
        <p className="text-xs text-slate-500 mb-2">العناوين الممكنة: <code dir="ltr">date, description, reference, amount, movement_type, balance_after</code> — المبالغ الموجبة إيداعات والسالبة سحوبات · إعادة الاستيراد لا تُكرر السطور (كشف التكرار تلقائي).</p>
        <textarea className="input w-full font-mono text-xs" dir="ltr" rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={CSV_TEMPLATE} />
        <div className="flex gap-2 mt-2 items-center flex-wrap">
          <button className="btn-primary" onClick={doImport} disabled={importing || !accountId}>{importing ? 'جارٍ الاستيراد…' : 'استيراد'}</button>
          {importResult && (
            <div className="text-xs text-slate-600">
              أُضيف: <b>{importResult.created}</b> · مكرر: <b>{importResult.duplicates?.length ?? 0}</b> · أخطاء: <b>{importResult.errors?.length ?? 0}</b>
              {importResult.errors?.length ? <div className="mt-1 text-rose-600">{importResult.errors.slice(0, 5).map((e) => <div key={e.row}>سطر {e.row}: {e.reason}</div>)}</div> : null}
            </div>
          )}
        </div>
      </div>

      {/* Statement lines */}
      <div className="card p-4 mb-4 overflow-x-auto">
        <div className="label mb-2">سطور الكشف</div>
        <table className="table w-full text-sm">
          <thead>
            <tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th>النوع</th><th>المبلغ</th><th>الرصيد</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineId}>
                <td>{formatDate(line.statementDate)}</td>
                <td>{line.description}</td>
                <td dir="ltr" className="text-xs">{line.reference ?? '—'}</td>
                <td className="text-xs">{line.movementTypeName ?? '—'}</td>
                <td className="font-num" dir="ltr">{formatMoney(line.amount)}</td>
                <td className="font-num text-slate-500" dir="ltr">{line.balanceAfter != null ? formatMoney(line.balanceAfter) : '—'}</td>
                <td><span className={`badge ${STATUS_CLS[line.status] ?? ''}`}>{line.statusName ?? line.status}{Math.abs(Number(line.matchDifference ?? 0)) > 0 ? ` (${formatMoney(line.matchDifference)})` : ''}</span></td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    {[1, 6].includes(line.status) && <button className="btn-soft h-8 px-2 text-xs" onClick={() => { setMatchTarget(line); setMatchEntryId(''); }}>مطابقة</button>}
                    {[2, 3, 6].includes(line.status) && <button className="btn-soft h-8 px-2 text-xs" onClick={() => unmatch(line)}>فك</button>}
                    {line.status === 1 && <button className="btn-soft h-8 px-2 text-xs" title="إيداع معلق" onClick={() => markTiming(line, 'pending_deposit')}>معلق</button>}
                    {line.status === 1 && <button className="btn-soft h-8 px-2 text-xs" title="شيك غير مصروف" onClick={() => markTiming(line, 'outstanding_check')}>شيك معلق</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr><td colSpan={8} className="text-center text-slate-400 py-6">لا توجد سطور — استورد كشف البنك أولًا.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Runs */}
      <div className="card p-4 overflow-x-auto">
        <div className="label mb-2">مسيرات المطابقة</div>
        <table className="table w-full text-sm">
          <thead>
            <tr><th>الرقم</th><th>التاريخ</th><th>الدفتر</th><th>الكشف</th><th>الفرق</th><th>الحالة</th><th></th></tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runId}>
                <td dir="ltr">{run.runNo}</td>
                <td>{formatDate(run.runDate)}</td>
                <td className="font-num" dir="ltr">{formatMoney(run.bookBalance)}</td>
                <td className="font-num" dir="ltr">{formatMoney(run.statementBalance)}</td>
                <td className="font-num" dir="ltr">{formatMoney(run.variance)}</td>
                <td><span className={`badge ${run.status === 1 ? 'bg-amber-100 text-amber-800' : run.status === 2 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{run.statusName}</span></td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    <button className="btn-soft h-8 px-2 text-xs" onClick={() => openReport(run)}>تقرير</button>
                    {run.status === 1 && <button className="btn-primary h-8 px-2 text-xs" onClick={() => postRun(run)}>ترحيل</button>}
                    {run.status === 2 && <button className="btn-soft h-8 px-2 text-xs text-rose-700" onClick={() => reverseRun(run)}>عكس</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!runs.length && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد مسيرات بعد — أنشئ مسيرة بعد المطابقة.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Manual match modal */}
      {matchTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMatchTarget(null)}>
          <div className="card p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 mb-1">مطابقة يدوية</h3>
            <p className="text-xs text-slate-500 mb-3">{matchTarget.description} — <span dir="ltr">{formatMoney(matchTarget.amount)}</span> · اربط السطر بطرف القيد (entryId من قيد البنك).</p>
            <input className="input w-full mb-3" autoFocus placeholder="entryId" dir="ltr" value={matchEntryId} onChange={(e) => setMatchEntryId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmManualMatch()} />
            <div className="flex gap-2 justify-end">
              <button className="btn-soft" onClick={() => setMatchTarget(null)}>إلغاء</button>
              <button className="btn-primary" onClick={confirmManualMatch}>تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {/* Report modal */}
      {report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReport(null)}>
          <div className="card p-5 w-full max-w-3xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800">تقرير المسيرة {report.run?.runNo}</h3>
              <button className="btn-soft h-8 px-3 text-xs" onClick={() => setReport(null)}>إغلاق</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-sm">
              {[
                ['الدفتر', report.summary?.bookBalance],
                ['الكشف', report.summary?.statementBalance],
                ['الفرق', report.summary?.variance],
                ['توقيت', (report.summary?.timingDeposits ?? 0) + (report.summary?.outstandingChecks ?? 0)],
              ].map(([label, value]) => (
                <div key={String(label)} className="card p-3">
                  <div className="text-[10px] text-slate-500">{label}</div>
                  <div className="font-num font-bold" dir="ltr">{formatMoney(Number(value ?? 0))}</div>
                </div>
              ))}
            </div>
            <table className="table w-full text-xs">
              <thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
              <tbody>
                {(report.lines ?? []).map((l: any) => (
                  <tr key={l.lineId}>
                    <td>{formatDate(l.statementDate)}</td>
                    <td>{l.description}</td>
                    <td className="font-num" dir="ltr">{formatMoney(l.amount)}</td>
                    <td>{l.statusName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
