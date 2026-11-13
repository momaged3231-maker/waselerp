'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const ACCOUNT_TYPE: Record<number, string> = {
  1: 'درج نقدي', 2: 'حساب بنكي', 3: 'بطاقة', 4: 'محفظة إلكترونية',
};

export default function TreasuryPage() {
  const { can } = useSession();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [form, setForm] = useState({ cashAccountId: 0, direction: 1, categoryId: 0, amount: 0, description: '' });
  const [error, setError] = useState('');
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [shifts, setShifts] = useState<any[]>([]);
  const [shiftAccountId, setShiftAccountId] = useState(0);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [countedCash, setCountedCash] = useState(0);
  const [shiftNotes, setShiftNotes] = useState('');
  const [shiftError, setShiftError] = useState('');
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ name: '', type: 2, bankName: '', accountNo: '' });

  async function load() {
    const rows = await apiFetch<any[]>('/treasury/accounts');
    setAccounts(rows);
    setShiftAccountId((value) => value || rows[0]?.cashAccountId || 0);
    setForm((current) => (current.cashAccountId ? current : { ...current, cashAccountId: rows[0]?.cashAccountId || 0 }));
    setTransactions(await apiFetch<any[]>('/treasury/transactions?limit=100'));
    setCurrentShift(await apiFetch<any>('/treasury/shifts/current').catch(() => null));
    setShifts(await apiFetch<any[]>('/treasury/shifts?limit=20').catch(() => []));
  }

  useEffect(() => {
    apiFetch('/treasury/categories').then(setCategories).catch(() => {});
    load();
  }, []);

  useEffect(() => {
    if (currentShift) setCountedCash(Number(currentShift.expectedCash ?? 0));
  }, [currentShift?.shiftId]);

  async function openShift(event: React.FormEvent) {
    event.preventDefault();
    setShiftError('');
    try {
      await apiFetch('/treasury/shifts/open', {
        method: 'POST',
        body: {
          cashAccountId: shiftAccountId || accounts[0]?.cashAccountId,
          openingBalance: Number(openingBalance),
        },
      });
      setOpeningBalance(0);
      await load();
    } catch (err: any) {
      setShiftError(err?.message ?? 'تعذر فتح الوردية');
    }
  }

  async function closeShift(event: React.FormEvent) {
    event.preventDefault();
    setShiftError('');
    try {
      await apiFetch('/treasury/shifts/close', {
        method: 'POST',
        body: { countedCash: Number(countedCash), notes: shiftNotes || undefined },
      });
      setShiftNotes('');
      await load();
    } catch (err: any) {
      setShiftError(err?.message ?? 'تعذر إغلاق الوردية');
    }
  }

  async function addTransaction(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await apiFetch('/treasury/transactions', { method: 'POST', body: { ...form, amount: Number(form.amount) } });
      setForm({ ...form, amount: 0, description: '' });
      load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  const totalCash = accounts.reduce((sum, a) => sum + Number(a.balance), 0);

  const canManage = can('cash.manage');

  async function createAccount() {
    setError('');
    try {
      await apiFetch('/treasury/accounts', { method: 'POST', body: accountForm });
      setAccountForm({ name: '', type: 2, bankName: '', accountNo: '' });
      setShowAccountForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  return (
    <AppShell title="الخزينة">
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {accounts.map((account) => (
              <div key={account.cashAccountId} className="card p-4">
                <div className="text-xs text-slate-500 font-semibold">{account.name}</div>
                <div className="text-xl font-extrabold text-slate-800 mt-1">{formatMoney(account.balance)}</div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {account.bankName ?? 'نقدية'} {account.accountNo ? `· ${account.accountNo}` : ''}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {ACCOUNT_TYPE[account.type] ?? ''}
                  {account.glAccountName ? ` · ${account.glAccountName}` : ''}
                </div>
              </div>
            ))}
            <div className="card p-4 bg-slate-900 text-white border-slate-900">
              <div className="text-xs text-slate-300 font-semibold">إجمالي الخزينة</div>
              <div className="text-xl font-extrabold mt-1">{formatMoney(totalCash)}</div>
            </div>
          </div>

          {canManage && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="font-bold">حساب خزينة جديد</div>
                <div className="flex-1" />
                <button className="btn-soft text-xs" onClick={() => setShowAccountForm((v) => !v)}>
                  {showAccountForm ? 'إلغاء' : '+ حساب'}
                </button>
              </div>
              {showAccountForm && (
                <div className="grid sm:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="label">الاسم</label>
                    <input className="input" value={accountForm.name}
                      onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">النوع</label>
                    <select className="input" value={accountForm.type}
                      onChange={(e) => setAccountForm({ ...accountForm, type: Number(e.target.value) })}>
                      {Object.entries(ACCOUNT_TYPE).map(([key, label]) => (
                        <option key={key} value={Number(key)}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">البنك</label>
                    <input className="input" value={accountForm.bankName}
                      onChange={(e) => setAccountForm({ ...accountForm, bankName: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">رقم الحساب</label>
                    <input className="input" value={accountForm.accountNo}
                      onChange={(e) => setAccountForm({ ...accountForm, accountNo: e.target.value })} dir="ltr" />
                  </div>
                  <button className="btn-primary" onClick={createAccount} disabled={!accountForm.name}>
                    حفظ
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>آخر الحركات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>التاريخ</th><th>النوع</th><th>الحساب</th><th>البيان</th><th>المبلغ</th></tr></thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.transactionId}>
                      <td>{formatDate(row.transactionDate)}</td>
                      <td>
                        <span className={`badge ${row.direction === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {row.direction === 1 ? 'إيداع' : 'سحب'}
                        </span>
                      </td>
                      <td className="text-slate-500">{row.cashAccountName}</td>
                      <td>{row.description ?? '—'}</td>
                      <td className={`font-bold ${row.direction === 1 ? 'text-emerald-700' : 'text-rose-600'}`}>
                        {row.direction === 1 ? '+' : '−'} {formatMoney(row.amount)}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد حركات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-title"><span>آخر الورديات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الوردية</th><th>الكاشير</th><th>الفتح</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th><th>الحالة</th></tr></thead>
                <tbody>
                  {shifts.map((row) => (
                    <tr key={row.shiftId}>
                      <td className="font-semibold">#{row.shiftNo} · {row.cashAccountName}</td>
                      <td>{row.cashierName}</td>
                      <td>{formatDate(row.openedAt)}</td>
                      <td>{formatMoney(row.expectedCash)}</td>
                      <td>{row.countedCash === null ? '—' : formatMoney(row.countedCash)}</td>
                      <td className={`font-bold ${Number(row.difference) < 0 ? 'text-rose-600' : Number(row.difference) > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                        {row.difference === null ? '—' : formatMoney(row.difference)}
                      </td>
                      <td>
                        <span className={`badge ${Number(row.status) === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {Number(row.status) === 1 ? 'مفتوحة' : 'مغلقة'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {shifts.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد ورديات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <form className="card p-5 space-y-3" onSubmit={currentShift ? closeShift : openShift}>
            <div className="font-bold">الوردية</div>
            {currentShift ? (
              <>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm space-y-1">
                  <div className="font-semibold text-emerald-800">
                    وردية #{currentShift.shiftNo} مفتوحة · {currentShift.cashAccountName}
                  </div>
                  <div className="text-xs text-emerald-700">بدأت {formatDate(currentShift.openedAt)}</div>
                  <div className="text-xs text-emerald-700">
                    داخل {formatMoney(currentShift.cashIn)} · خارج {formatMoney(currentShift.cashOut)}
                  </div>
                  <div className="font-bold text-emerald-900">المتوقع في الدرج: {formatMoney(currentShift.expectedCash)}</div>
                </div>
                <div>
                  <label className="label">النقدية الفعلية عند الإغلاق</label>
                  <input className="input" type="number" step="0.01" value={countedCash}
                    onChange={(e) => setCountedCash(Number(e.target.value))} required />
                </div>
                <div>
                  <label className="label">ملاحظات</label>
                  <input className="input" value={shiftNotes} onChange={(e) => setShiftNotes(e.target.value)} />
                </div>
                <div className="text-sm text-slate-500">
                  الفرق: <span className={`font-bold ${countedCash - Number(currentShift.expectedCash) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {formatMoney(countedCash - Number(currentShift.expectedCash))}
                  </span>
                </div>
                <button className="btn-primary w-full">إغلاق الوردية</button>
              </>
            ) : (
              <>
                <div>
                  <label className="label">حساب الخزينة</label>
                  <select className="input" value={shiftAccountId}
                    onChange={(e) => setShiftAccountId(Number(e.target.value))}>
                    {accounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">رصيد بداية الوردية</label>
                  <input className="input" type="number" step="0.01" value={openingBalance}
                    onChange={(e) => setOpeningBalance(Number(e.target.value))} />
                </div>
                <button className="btn-primary w-full">فتح وردية</button>
              </>
            )}
            {shiftError && <div className="text-sm text-rose-600">{shiftError}</div>}
          </form>

        <form className="card p-5 space-y-3 h-fit" onSubmit={addTransaction}>
          <div className="font-bold">حركة خزينة جديدة</div>
          <div>
            <label className="label">الحساب</label>
            <select className="input" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: Number(e.target.value) })}>
              {accounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">النوع</label>
              <select className="input" value={form.direction} onChange={(e) => setForm({ ...form, direction: Number(e.target.value) })}>
                <option value={1}>إيداع</option>
                <option value={2}>سحب</option>
              </select>
            </div>
            <div>
              <label className="label">البند</label>
              <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: Number(e.target.value) })}>
                <option value={0}>— عام —</option>
                {categories.map((c) => <option key={c.cashCategoryId} value={c.cashCategoryId}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">المبلغ</label>
            <input className="input" type="number" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required />
          </div>
          <div>
            <label className="label">البيان</label>
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {error && <div className="text-sm text-rose-600">{error}</div>}
          <button className="btn-primary w-full">تسجيل الحركة</button>
        </form>
        </div>
      </div>
    </AppShell>
  );
}
