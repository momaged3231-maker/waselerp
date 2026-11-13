'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

const METHOD_LABEL: Record<number, string> = {
  1: 'نقدي', 2: 'شيك', 3: 'تحويل بنكي', 4: 'بطاقة',
};
const CHECK_STATUS: Record<number, string> = {
  1: 'تحت التحصيل', 2: 'تم التحصيل', 3: 'مرفوض', 4: 'ملغى',
};

export default function VouchersPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<'vouchers' | 'checks'>('vouchers');
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [voucherType, setVoucherType] = useState(1);
  const [partyId, setPartyId] = useState(0);
  const [cashAccountId, setCashAccountId] = useState(0);
  const [amount, setAmount] = useState(0);
  const [voucherDate, setVoucherDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(1);
  const [voucherNote, setVoucherNote] = useState('');
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<Record<number, number>>({});

  async function loadOpenInvoices() {
    if (!partyId) { setOpenInvoices([]); return; }
    try {
      const rows = await apiFetch<any[]>(`/accounting/open-invoices?partyId=${partyId}&type=1`);
      setOpenInvoices(rows);
    } catch {
      setOpenInvoices([]);
    }
  }

  useEffect(() => { loadOpenInvoices(); }, [partyId]);

  const [checkDirection, setCheckDirection] = useState(1);
  const [checkNo, setCheckNo] = useState('');
  const [bankName, setBankName] = useState('');
  const [checkAmount, setCheckAmount] = useState(0);
  const [dueDate, setDueDate] = useState('');
  const [checkPartyId, setCheckPartyId] = useState(0);

  const canManage = can('accounting.manage');
  const canPost = can('accounting.post');

  async function load() {
    const [v, c, partyRows, cash, p] = await Promise.all([
      apiFetch<any[]>('/accounting/vouchers?limit=200'),
      apiFetch<any[]>('/accounting/checks?limit=200'),
      apiFetch<any>('/parties?type=0&pageSize=200'),
      apiFetch<any[]>('/treasury/accounts'),
      apiFetch<any[]>('/accounting/accounts'),
    ]);
    setVouchers(v);
    setChecks(c);
    setParties(partyRows?.items ?? partyRows ?? []);
    setCashAccounts(cash);
    setAccounts(flatten(p));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function createVoucher() {
    setError(''); setMessage('');
    try {
      const allocationList = Object.entries(allocations)
        .filter(([, value]) => Number(value) > 0)
        .map(([invoiceId, value]) => ({ invoiceId: Number(invoiceId), amount: Number(value) }));
      await apiFetch('/accounting/vouchers', {
        method: 'POST',
        body: {
          voucherType,
          partyId: partyId || undefined,
          cashAccountId,
          amount,
          voucherDate: voucherDate || undefined,
          paymentMethod,
          description: voucherNote || undefined,
          allocations: allocationList.length ? allocationList : undefined,
        },
      });
      setMessage('تم تسجيل السند');
      setAmount(0);
      setVoucherNote('');
      setAllocations({});
      await load();
      await loadOpenInvoices();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function cancelVoucher(id: number) {
    setError(''); setMessage('');
    try {
      await apiFetch(`/accounting/vouchers/${id}/cancel`, { method: 'POST' });
      setMessage('تم إلغاء السند');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function createCheck() {
    setError(''); setMessage('');
    try {
      await apiFetch('/accounting/checks', {
        method: 'POST',
        body: {
          direction: checkDirection,
          checkNo,
          bankName: bankName || undefined,
          amount: checkAmount,
          dueDate: dueDate || undefined,
          partyId: checkPartyId || undefined,
          cashAccountId: cashAccountId || undefined,
        },
      });
      setMessage('تم تسجيل الشيك');
      setCheckNo(''); setCheckAmount(0); setBankName('');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function collectCheck(id: number) {
    setError(''); setMessage('');
    try {
      await apiFetch(`/accounting/checks/${id}/collect`, { method: 'POST' });
      setMessage('تم تحصيل الشيك');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <AppShell title="السندات والشيكات">
      <AccountingNav />

      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex gap-2 mb-4">
        <button className={tab === 'vouchers' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('vouchers')}>
          سندات القبض والصرف
        </button>
        <button className={tab === 'checks' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('checks')}>
          الشيكات
        </button>
      </div>

      {tab === 'vouchers' && (
        <div className="grid lg:grid-cols-3 gap-4">
          {canManage && (
            <div className="card p-4 space-y-3 h-fit">
              <div className="font-bold">سند جديد</div>
              <div>
                <label className="label">نوع السند</label>
                <select className="input" value={voucherType} onChange={(e) => setVoucherType(Number(e.target.value))}>
                  <option value={1}>سند قبض</option>
                  <option value={2}>سند صرف</option>
                </select>
              </div>
              <div>
                <label className="label">الطرف</label>
                <select className="input" value={partyId} onChange={(e) => setPartyId(Number(e.target.value))}>
                  <option value={0}>— اختر —</option>
                  {parties.map((row: any) => (
                    <option key={row.partyId} value={row.partyId}>
                      {row.name} {row.partyType === 2 ? '(مورد)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">حساب الخزينة</label>
                <select className="input" value={cashAccountId} onChange={(e) => setCashAccountId(Number(e.target.value))}>
                  <option value={0}>— اختر —</option>
                  {cashAccounts.map((row: any) => (
                    <option key={row.cashAccountId} value={row.cashAccountId}>
                      {row.name} ({formatMoney(row.balance)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">المبلغ</label>
                  <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">التاريخ</label>
                  <input className="input" type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">طريقة الدفع</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((key) => (
                    <option key={key} value={key}>{METHOD_LABEL[key]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">البيان</label>
                <input className="input" value={voucherNote} onChange={(e) => setVoucherNote(e.target.value)} />
              </div>
              {openInvoices.length > 0 && (
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-bold text-slate-600 mb-1">
                    تخصيص السند على فواتير العميل (اختياري)
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {openInvoices.map((invoice) => (
                      <div key={invoice.invoiceId} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-slate-500">{invoice.invoiceNo}</span>
                        <span className="text-slate-400 flex-1">
                          متبقٍ {formatMoney(invoice.remaining)}
                        </span>
                        <input
                          className="input py-0.5 text-xs w-24" type="number" step="0.01"
                          placeholder="تخصيص"
                          value={allocations[invoice.invoiceId] ?? ''}
                          onChange={(e) => setAllocations((a) => ({ ...a, [invoice.invoiceId]: Number(e.target.value) }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button className="btn-primary w-full" onClick={createVoucher} disabled={!amount || !partyId || !cashAccountId}>
                تسجيل السند
              </button>
            </div>
          )}

          <div className={`card ${canManage ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="card-title"><span>سجل السندات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>رقم السند</th><th>النوع</th><th>التاريخ</th><th>الطرف</th><th>المبلغ</th><th>مخصَّص</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {vouchers.map((row) => (
                    <tr key={row.voucherId}>
                      <td className="font-mono text-xs">{row.voucherNo}</td>
                      <td className="text-xs">{row.voucherType === 1 ? 'قبض' : 'صرف'}</td>
                      <td className="text-xs">{formatDate(row.voucherDate)}</td>
                      <td className="text-xs">{row.partyName ?? '—'}</td>
                      <td className="font-bold">{formatMoney(row.amount)}</td>
                      <td className="text-xs">
                        {Number(row.allocatedAmount) > 0 ? formatMoney(row.allocatedAmount) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${row.status === 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {row.status === 1 ? 'مُرحّل' : 'ملغى'}
                        </span>
                      </td>
                      <td>
                        {canPost && row.status === 1 && (
                          <button className="btn-soft text-xs" onClick={() => cancelVoucher(row.voucherId)}>إلغاء</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {vouchers.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد سندات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'checks' && (
        <div className="grid lg:grid-cols-3 gap-4">
          {canManage && (
            <div className="card p-4 space-y-3 h-fit">
              <div className="font-bold">شيك جديد</div>
              <div>
                <label className="label">الاتجاه</label>
                <select className="input" value={checkDirection} onChange={(e) => setCheckDirection(Number(e.target.value))}>
                  <option value={1}>شيك مستلم</option>
                  <option value={2}>شيك صادر</option>
                </select>
              </div>
              <div>
                <label className="label">رقم الشيك</label>
                <input className="input" value={checkNo} onChange={(e) => setCheckNo(e.target.value)} />
              </div>
              <div>
                <label className="label">البنك</label>
                <input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">المبلغ</label>
                  <input className="input" type="number" step="0.01" value={checkAmount} onChange={(e) => setCheckAmount(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">تاريخ الاستحقاق</label>
                  <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">الطرف</label>
                <select className="input" value={checkPartyId} onChange={(e) => setCheckPartyId(Number(e.target.value))}>
                  <option value={0}>— اختر —</option>
                  {parties.map((row: any) => (
                    <option key={row.partyId} value={row.partyId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">حساب الخزينة</label>
                <select className="input" value={cashAccountId} onChange={(e) => setCashAccountId(Number(e.target.value))}>
                  <option value={0}>— اختر —</option>
                  {cashAccounts.map((row: any) => (
                    <option key={row.cashAccountId} value={row.cashAccountId}>{row.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn-primary w-full" onClick={createCheck} disabled={!checkNo || !checkAmount}>
                تسجيل الشيك
              </button>
            </div>
          )}

          <div className={`card ${canManage ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="card-title"><span>سجل الشيكات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>رقم الشيك</th><th>الاتجاه</th><th>البنك</th><th>المبلغ</th><th>الاستحقاق</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {checks.map((row) => (
                    <tr key={row.checkId}>
                      <td className="font-mono text-xs">{row.checkNo}</td>
                      <td className="text-xs">{row.direction === 1 ? 'مستلم' : 'صادر'}</td>
                      <td className="text-xs">{row.bankName ?? '—'}</td>
                      <td className="font-bold">{formatMoney(row.amount)}</td>
                      <td className="text-xs">{row.dueDate ? formatDate(row.dueDate) : '—'}</td>
                      <td>
                        <span className={`badge ${row.status === 1 ? 'bg-amber-50 text-amber-700' : row.status === 2 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {CHECK_STATUS[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>
                        {canPost && row.status === 1 && row.direction === 1 && (
                          <button className="btn-soft text-xs" onClick={() => collectCheck(row.checkId)}>تحصيل</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {checks.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">لا توجد شيكات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {accounts.length === 0 && <div className="hidden" />}
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
