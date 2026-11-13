'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Line = {
  accountId: number; debit: number; credit: number; description?: string;
};

const TYPE_LABEL: Record<number, string> = {
  1: 'يدوي', 2: 'مبيعات', 3: 'مشتريات', 4: 'خزينة', 5: 'بنك', 6: 'رواتب', 7: 'افتتاحي', 8: 'إقفال',
};
const STATUS_LABEL: Record<number, string> = { 1: 'مسودة', 2: 'مرحّل', 3: 'ملغى' };
const FREQUENCY: Record<number, string> = {
  1: 'شهري', 2: 'أسبوعي', 3: 'يومي', 4: 'ربع سنوي', 5: 'سنوي',
};

export default function JournalsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<'journals' | 'recurring'>('journals');
  const [journals, setJournals] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [recurring, setRecurring] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [journalDate, setJournalDate] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { accountId: 0, debit: 0, credit: 0, description: '' },
    { accountId: 0, debit: 0, credit: 0, description: '' },
  ]);
  const [recurringName, setRecurringName] = useState('');
  const [recurringFrequency, setRecurringFrequency] = useState(1);
  const [recurringNextDate, setRecurringNextDate] = useState('');
  const [recurringLines, setRecurringLines] = useState<Line[]>([
    { accountId: 0, debit: 0, credit: 0, description: '' },
    { accountId: 0, debit: 0, credit: 0, description: '' },
  ]);

  const recurringDebit = recurringLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const recurringCredit = recurringLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);

  const canManage = can('accounting.manage');
  const canPost = can('accounting.post');

  async function load() {
    const query = new URLSearchParams({ limit: '200' });
    if (search) query.set('search', search);
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    setJournals(await apiFetch<any[]>(`/accounting/journals?${query.toString()}`));
    setRecurring(await apiFetch<any[]>('/accounting/recurring'));
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [search, from, to]);

  useEffect(() => {
    apiFetch<any[]>('/accounting/accounts')
      .then((rows) => setAccounts(flatten(rows)))
      .catch(() => {});
  }, []);

  async function open(id: number) {
    setError('');
    try {
      setSelected(await apiFetch(`/accounting/journals/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save() {
    setError('');
    try {
      await apiFetch('/accounting/journals', {
        method: 'POST',
        body: {
          description,
          journalDate: journalDate || undefined,
          lines: lines
            .filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0))
            .map((line) => ({
              accountId: Number(line.accountId),
              debit: Number(line.debit) || 0,
              credit: Number(line.credit) || 0,
              description: line.description || undefined,
            })),
        },
      });
      setShowForm(false);
      setDescription('');
      setLines([
        { accountId: 0, debit: 0, credit: 0, description: '' },
        { accountId: 0, debit: 0, credit: 0, description: '' },
      ]);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function voidJournal(id: number) {
    setError('');
    try {
      await apiFetch(`/accounting/journals/${id}/void`, { method: 'POST' });
      await load();
      await open(id);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveRecurring() {
    setError('');
    try {
      await apiFetch('/accounting/recurring', {
        method: 'POST',
        body: {
          name: recurringName,
          frequency: recurringFrequency,
          nextDate: recurringNextDate || undefined,
          lines: recurringLines
            .filter((line) => line.accountId && (Number(line.debit) > 0 || Number(line.credit) > 0))
            .map((line) => ({
              accountId: Number(line.accountId),
              debit: Number(line.debit) || 0,
              credit: Number(line.credit) || 0,
            })),
        },
      });
      setRecurringName('');
      setRecurringLines([
        { accountId: 0, debit: 0, credit: 0, description: '' },
        { accountId: 0, debit: 0, credit: 0, description: '' },
      ]);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeRecurring(id: number) {
    setError('');
    try {
      await apiFetch(`/accounting/recurring/${id}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function runRecurring() {
    setError('');
    try {
      const result = await apiFetch('/accounting/recurring/run', { method: 'POST' });
      setMessage(`تم ترحيل ${result.posted} قيد متكرر`);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  return (
    <AppShell title="القيود المحاسبية">
      <AccountingNav />

      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <button className={tab === 'journals' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('journals')}>
          سجل القيود
        </button>
        <button className={tab === 'recurring' ? 'btn-primary' : 'btn-soft'} onClick={() => setTab('recurring')}>
          القيود المتكررة
        </button>
        <div className="flex-1" />
        {canPost && tab === 'recurring' && (
          <button className="btn-soft" onClick={runRecurring}>ترحيل المستحق الآن</button>
        )}
      </div>

      {tab === 'recurring' ? (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 card">
            <div className="card-title"><span>القوالب المتكررة</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الاسم</th><th>الدورية</th><th>تاريخ الترحيل القادم</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {recurring.map((row) => (
                    <tr key={row.recurringId}>
                      <td className="text-xs font-semibold">
                        {row.name}
                        <div className="text-slate-400">{row.lines?.length ?? 0} سطر</div>
                      </td>
                      <td className="text-xs">{FREQUENCY[row.frequency] ?? row.frequency}</td>
                      <td className="text-xs">{row.nextDate ?? '—'}</td>
                      <td>
                        <span className={`badge ${row.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {row.isActive ? 'مفعّل' : 'موقوف'}
                        </span>
                      </td>
                      <td>
                        {canManage && (
                          <button className="text-rose-500 text-xs" onClick={() => removeRecurring(row.recurringId)}>حذف</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recurring.length === 0 && (
                    <tr><td colSpan={5} className="text-center text-slate-400 py-8">لا توجد قوالب متكررة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {canManage && (
            <div className="card p-4 space-y-3 h-fit">
              <div className="font-bold">قالب متكرر جديد</div>
              <div>
                <label className="label">الاسم</label>
                <input className="input" value={recurringName} onChange={(e) => setRecurringName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">الدورية</label>
                  <select className="input" value={recurringFrequency} onChange={(e) => setRecurringFrequency(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((key) => (
                      <option key={key} value={key}>{FREQUENCY[key]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">تاريخ الترحيل القادم</label>
                  <input className="input" type="date" value={recurringNextDate} onChange={(e) => setRecurringNextDate(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                {recurringLines.map((line, index) => (
                  <div key={index} className="grid grid-cols-12 gap-1 items-center">
                    <select
                      className="input py-1 text-xs col-span-5"
                      value={line.accountId}
                      onChange={(e) => setRecurringLines((rows) => rows.map((r, i) => i === index ? { ...r, accountId: Number(e.target.value) } : r))}
                    >
                      <option value={0}>— حساب —</option>
                      {accounts.map((account) => (
                        <option key={account.accountId} value={account.accountId}>
                          {account.code} — {account.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input py-1 text-xs col-span-3" type="number" step="0.01" placeholder="مدين"
                      value={line.debit || ''}
                      onChange={(e) => setRecurringLines((rows) => rows.map((r, i) => i === index ? { ...r, debit: Number(e.target.value) || 0, credit: 0 } : r))}
                    />
                    <input
                      className="input py-1 text-xs col-span-3" type="number" step="0.01" placeholder="دائن"
                      value={line.credit || ''}
                      onChange={(e) => setRecurringLines((rows) => rows.map((r, i) => i === index ? { ...r, credit: Number(e.target.value) || 0, debit: 0 } : r))}
                    />
                    <button
                      className="text-rose-500 text-xs col-span-1"
                      onClick={() => setRecurringLines((rows) => rows.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="btn-soft text-xs"
                onClick={() => setRecurringLines((rows) => [...rows, { accountId: 0, debit: 0, credit: 0 }])}
              >
                + سطر
              </button>

              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>مدين: <b>{formatMoney(recurringDebit)}</b></span>
                <span>دائن: <b>{formatMoney(recurringCredit)}</b></span>
              </div>
              <button
                className="btn-primary w-full"
                disabled={!recurringName || recurringLines.length < 2 || Math.abs(recurringDebit - recurringCredit) > 0.01}
                onClick={saveRecurring}
              >
                حفظ القالب
              </button>
            </div>
          )}
        </div>
      ) : (
      <>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          className="input w-52 py-1.5" placeholder="بحث برقم القيد أو البيان"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <input className="input w-40 py-1.5" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input w-40 py-1.5" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex-1" />
        {canManage && (
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'إلغاء' : 'قيد جديد'}
          </button>
        )}
      </div>

      {showForm && (
        <div className="card p-4 mb-4 space-y-3">
          <div className="font-bold">قيد يومي جديد</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">البيان</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="label">التاريخ</label>
              <input className="input" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th><th></th></tr></thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        className="input py-1 text-xs"
                        value={line.accountId}
                        onChange={(e) => setLines((rows) => rows.map((r, i) => i === index ? { ...r, accountId: Number(e.target.value) } : r))}
                      >
                        <option value={0}>— اختر —</option>
                        {accounts.map((account) => (
                          <option key={account.accountId} value={account.accountId}>
                            {account.code} — {account.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input py-1 text-xs w-24" type="number" step="0.01"
                        value={line.debit || ''}
                        onChange={(e) => setLines((rows) => rows.map((r, i) => i === index ? { ...r, debit: Number(e.target.value) || 0, credit: 0 } : r))}
                      />
                    </td>
                    <td>
                      <input
                        className="input py-1 text-xs w-24" type="number" step="0.01"
                        value={line.credit || ''}
                        onChange={(e) => setLines((rows) => rows.map((r, i) => i === index ? { ...r, credit: Number(e.target.value) || 0, debit: 0 } : r))}
                      />
                    </td>
                    <td>
                      <input
                        className="input py-1 text-xs" value={line.description ?? ''}
                        onChange={(e) => setLines((rows) => rows.map((r, i) => i === index ? { ...r, description: e.target.value } : r))}
                      />
                    </td>
                    <td>
                      {lines.length > 2 && (
                        <button className="text-rose-500 text-xs" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>
                          حذف
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <button className="btn-soft text-xs" onClick={() => setLines((rows) => [...rows, { accountId: 0, debit: 0, credit: 0, description: '' }])}>
              + سطر
            </button>
            <span className="text-slate-500">مدين: <b>{formatMoney(totalDebit)}</b></span>
            <span className="text-slate-500">دائن: <b>{formatMoney(totalCredit)}</b></span>
            {!balanced && totalDebit > 0 && <span className="text-rose-600 text-xs">القيد غير متوازن</span>}
            <div className="flex-1" />
            <button className="btn-primary" disabled={!balanced} onClick={save}>ترحيل القيد</button>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-title"><span>سجل القيود</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>رقم القيد</th><th>التاريخ</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
              <tbody>
                {journals.map((row) => (
                  <tr key={row.journalId} className="cursor-pointer hover:bg-brand-50/40" onClick={() => open(row.journalId)}>
                    <td className="font-mono text-xs">{row.journalNo}</td>
                    <td className="text-xs">{formatDate(row.journalDate)}</td>
                    <td className="text-xs">{TYPE_LABEL[row.journalType] ?? row.journalType}</td>
                    <td className="text-xs">{row.description ?? '—'}</td>
                    <td className="font-bold">{formatMoney(row.totalDebit)}</td>
                    <td>
                      <span className={`badge ${row.status === 2 ? 'bg-emerald-50 text-emerald-700' : row.status === 3 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {journals.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد قيود</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card h-fit">
          <div className="card-title"><span>تفاصيل القيد</span></div>
          {!selected && <div className="p-6 text-center text-slate-400 text-sm">اختر قيدًا لعرضه</div>}
          {selected && (
            <div>
              <div className="p-4 border-b border-slate-100 space-y-1 text-sm">
                <div className="font-bold">{selected.header.journalNo}</div>
                <div className="text-slate-500">{selected.header.description}</div>
                <div className="text-xs text-slate-400">
                  {formatDate(selected.header.journalDate)} · {selected.header.createdBy ?? '—'}
                </div>
                {canPost && selected.header.status === 2 && (
                  <button className="btn-soft text-xs mt-2" onClick={() => voidJournal(selected.header.journalId)}>
                    إلغاء القيد
                  </button>
                )}
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>
                  <tbody>
                    {selected.lines.map((line: any) => (
                      <tr key={line.entryId}>
                        <td className="text-xs">
                          <div className="font-semibold">{line.accountName}</div>
                          <div className="text-slate-400 font-mono">{line.accountCode}</div>
                          {line.description && <div className="text-slate-500">{line.description}</div>}
                        </td>
                        <td className="text-xs">{Number(line.debit) ? formatMoney(line.debit) : '—'}</td>
                        <td className="text-xs">{Number(line.credit) ? formatMoney(line.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      </>
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
