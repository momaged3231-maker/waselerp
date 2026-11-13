'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Tab = 'trial' | 'pnl' | 'balance' | 'ledger' | 'tax' | 'cost';

export default function AccountingReportsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('trial');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [asOf, setAsOf] = useState('');
  const [data, setData] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState(0);
  const [error, setError] = useState('');
  const [closeYear, setCloseYear] = useState(new Date().getFullYear());
  const [closing, setClosing] = useState(false);
  const [closeResult, setCloseResult] = useState<any>(null);

  const canClose = can('accounting.close');

  async function closeBooks() {
    setError('');
    setClosing(true);
    setCloseResult(null);
    try {
      const result = await apiFetch('/accounting/close-year', {
        method: 'POST',
        body: { year: closeYear },
      });
      setCloseResult(result);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setClosing(false);
    }
  }

  async function load() {
    setError('');
    try {
      if (tab === 'trial') {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        setData(await apiFetch(`/accounting/reports/trial-balance?${query.toString()}`));
      } else if (tab === 'pnl') {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        setData(await apiFetch(`/accounting/reports/profit-loss?${query.toString()}`));
      } else if (tab === 'balance') {
        const query = new URLSearchParams();
        if (asOf) query.set('asOf', asOf);
        setData(await apiFetch(`/accounting/reports/balance-sheet?${query.toString()}`));
      } else if (tab === 'ledger') {
        if (!accountId) { setData(null); return; }
        const query = new URLSearchParams({ accountId: String(accountId) });
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        setData(await apiFetch(`/accounting/reports/general-ledger?${query.toString()}`));
      } else if (tab === 'cost') {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        setData(await apiFetch(`/accounting/reports/cost-centers?${query.toString()}`));
      } else {
        const query = new URLSearchParams();
        if (from) query.set('from', from);
        if (to) query.set('to', to);
        setData(await apiFetch(`/accounting/reports/tax-summary?${query.toString()}`));
      }
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    apiFetch<any[]>('/accounting/accounts')
      .then((rows) => setAccounts(flatten(rows)))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [tab, from, to, asOf, accountId]);

  return (
    <AppShell title="التقارير المالية">
      <AccountingNav />

      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button className={tab === 'trial' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('trial')}>ميزان المراجعة</button>
        <button className={tab === 'pnl' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('pnl')}>أرباح وخسائر</button>
        <button className={tab === 'balance' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('balance')}>الميزانية العمومية</button>
        <button className={tab === 'ledger' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('ledger')}>دفتر الأستاذ</button>
        <button className={tab === 'tax' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('tax')}>ملخص الضريبة</button>
        <button className={tab === 'cost' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('cost')}>مراكز التكلفة</button>

        <div className="flex-1" />

        {tab === 'balance' && (
          <input className="input w-40 py-1.5" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        )}
        {tab === 'ledger' && (
          <select className="input w-56 py-1.5" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            <option value={0}>— اختر الحساب —</option>
            {accounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.code} — {account.name}
              </option>
            ))}
          </select>
        )}
        {tab !== 'balance' && (
          <>
            <input className="input w-40 py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="input w-40 py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      {tab === 'cost' && data && (
        <div className="card">
          <div className="card-title"><span>الإنفاق حسب مركز التكلفة</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>المركز</th><th>مدين</th><th>دائن</th><th>الصافي</th></tr></thead>
              <tbody>
                {data.lines.map((row: any) => (
                  <tr key={row.costCenterId}>
                    <td className="font-mono text-xs">{row.code}</td>
                    <td className="text-xs">{row.name}</td>
                    <td className="text-xs">{formatMoney(row.debit)}</td>
                    <td className="text-xs">{formatMoney(row.credit)}</td>
                    <td className="text-xs font-bold">{formatMoney(row.net)}</td>
                  </tr>
                ))}
                {data.lines.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد مراكز</td></tr>}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td colSpan={2}>الإجمالي</td>
                  <td>{formatMoney(data.totalDebit)}</td>
                  <td>{formatMoney(data.totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'trial' && data && (
        <div className="card">
          <div className="card-title">
            <span>ميزان المراجعة</span>
            <span className={`badge ${data.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {data.balanced ? 'متوازن' : 'غير متوازن'}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الكود</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
              <tbody>
                {data.lines.map((row: any) => (
                  <tr key={row.accountId}>
                    <td className="font-mono text-xs">{row.code}</td>
                    <td className="text-xs">{row.name}</td>
                    <td className="text-xs">{Number(row.debit) ? formatMoney(row.debit) : '—'}</td>
                    <td className="text-xs">{Number(row.credit) ? formatMoney(row.credit) : '—'}</td>
                    <td className={`text-xs font-bold ${Number(row.balance) < 0 ? 'text-rose-600' : ''}`}>
                      {formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
                {data.lines.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد حركات</td></tr>}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-slate-50">
                  <td colSpan={2}>الإجمالي</td>
                  <td>{formatMoney(data.totalDebit)}</td>
                  <td>{formatMoney(data.totalCredit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tab === 'pnl' && data && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-title"><span>الإيرادات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الحساب</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {data.revenue.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="text-xs">{row.code} — {row.name}</td>
                      <td className="font-bold text-emerald-700">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                  {data.revenue.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-6">لا توجد إيرادات</td></tr>}
                </tbody>
                <tfoot><tr className="font-bold bg-slate-50"><td>إجمالي الإيرادات</td><td>{formatMoney(data.totalRevenue)}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><span>المصروفات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الحساب</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {data.expense.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="text-xs">{row.code} — {row.name}</td>
                      <td className="font-bold text-rose-700">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                  {data.expense.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-6">لا توجد مصروفات</td></tr>}
                </tbody>
                <tfoot><tr className="font-bold bg-slate-50"><td>إجمالي المصروفات</td><td>{formatMoney(data.totalExpense)}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <div className="md:col-span-2 card p-4 flex items-center justify-between">
            <span className="font-bold">{data.netProfit >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</span>
            <span className={`text-2xl font-extrabold ${data.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
              {formatMoney(Math.abs(data.netProfit))}
            </span>
          </div>
        </div>
      )}

      {tab === 'balance' && data && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-title"><span>الأصول</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الحساب</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {data.assets.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="text-xs">{row.code} — {row.name}</td>
                      <td className="font-bold">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                  {data.assets.length === 0 && <tr><td colSpan={2} className="text-center text-slate-400 py-6">لا توجد أصول</td></tr>}
                </tbody>
                <tfoot><tr className="font-bold bg-slate-50"><td>إجمالي الأصول</td><td>{formatMoney(data.totalAssets)}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><span>الخصوم وحقوق الملكية</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الحساب</th><th>الرصيد</th></tr></thead>
                <tbody>
                  {data.liabilities.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="text-xs">{row.code} — {row.name}</td>
                      <td className="font-bold">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                  {data.equity.map((row: any) => (
                    <tr key={row.accountId}>
                      <td className="text-xs">{row.code} — {row.name}</td>
                      <td className="font-bold">{formatMoney(row.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="text-xs font-bold">{data.profit >= 0 ? 'أرباح الفترة' : 'خسائر الفترة'}</td>
                    <td className="font-bold">{formatMoney(data.profit)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-bold bg-slate-50">
                    <td>إجمالي الخصوم وحقوق الملكية</td>
                    <td>{formatMoney(data.totalLiabilitiesAndEquity)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="md:col-span-2 card p-4 flex items-center justify-between">
            <span className="font-bold">حالة الميزانية</span>
            <span className={`badge ${data.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {data.balanced ? 'متوازنة' : 'غير متوازنة'}
            </span>
          </div>
        </div>
      )}

      {tab === 'ledger' && data && (
        <div className="card">
          <div className="card-title">
            <span>دفتر الأستاذ — {data.account?.code} {data.account?.name}</span>
            <span className="badge bg-slate-100 text-slate-700">الرصيد الختامي {formatMoney(data.closingBalance)}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
              <tbody>
                {data.lines.map((line: any) => (
                  <tr key={line.entryId}>
                    <td className="text-xs">{line.journalDate}</td>
                    <td className="font-mono text-xs">{line.journalNo}</td>
                    <td className="text-xs">{line.description ?? line.journalDescription ?? '—'}</td>
                    <td className="text-xs">{Number(line.debit) ? formatMoney(line.debit) : '—'}</td>
                    <td className="text-xs">{Number(line.credit) ? formatMoney(line.credit) : '—'}</td>
                    <td className="text-xs font-bold">{formatMoney(line.balance)}</td>
                  </tr>
                ))}
                {data.lines.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد حركات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tax' && data && (
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card p-4 space-y-1">
            <div className="text-xs text-slate-500">ضريبة القيمة المضافة (مخرجات)</div>
            <div className="text-2xl font-extrabold text-slate-800">{formatMoney(data.outputVat)}</div>
          </div>
          <div className="card p-4 space-y-1">
            <div className="text-xs text-slate-500">ضريبة القيمة المضافة (مدخلات)</div>
            <div className="text-2xl font-extrabold text-slate-800">{formatMoney(data.inputVat)}</div>
          </div>
          <div className="card p-4 space-y-1">
            <div className="text-xs text-slate-500">{data.payable > 0 ? 'المستحق للهيئة' : 'الرصيد القابل للاسترداد'}</div>
            <div className={`text-2xl font-extrabold ${data.payable > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {formatMoney(data.payable > 0 ? data.payable : data.refundable)}
            </div>
          </div>
          <div className="md:col-span-3 card">
            <div className="card-title"><span>ملخص الفترة</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>البند</th><th>المبلغ</th></tr></thead>
                <tbody>
                  <tr><td>إجمالي المبيعات (صافي)</td><td className="font-bold">{formatMoney(data.sales)}</td></tr>
                  <tr><td>إجمالي المشتريات (صافي)</td><td className="font-bold">{formatMoney(data.purchases)}</td></tr>
                  <tr><td>صافي ضريبة القيمة المضافة</td><td className="font-bold">{formatMoney(data.netVat)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {canClose && (
        <div className="card p-4 mt-4 flex flex-wrap items-center gap-3">
          <div className="font-bold">إقفال السنة</div>
          <div className="text-xs text-slate-500">
            يقفل حسابات الإيرادات والمصروفات وينقل النتيجة إلى الأرباح المحتجزة.
          </div>
          <div className="flex-1" />
          <input
            className="input w-28 py-1.5" type="number" placeholder="السنة"
            value={closeYear} onChange={(e) => setCloseYear(Number(e.target.value))}
          />
          <button className="btn-primary" onClick={closeBooks} disabled={closing}>
            {closing ? 'جارٍ الإقفال…' : 'إقفال السنة'}
          </button>
          {closeResult && (
            <span className="badge bg-emerald-50 text-emerald-700">
              صافي {formatMoney(closeResult.netProfit)} · قيد {closeResult.journalId}
            </span>
          )}
        </div>
      )}
    </AppShell>
  );
}

function flatten(nodes: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const node of list ?? []) {
      if (!node.isGroup) out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes ?? []);
  return out;
}
