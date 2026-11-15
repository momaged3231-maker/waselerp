'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const TYPES: Record<number, string> = { 1: 'درج نقدي', 2: 'حساب بنكي', 3: 'بطاقة', 4: 'محفظة إلكترونية' };

const empty = { cashAccountId: undefined as any, name: '', type: 2, bankName: '', accountNo: '', currencyCode: 'EGP', openingBalance: '', isActive: true, notes: '', glAccountId: '' };

/** Flattens the accounting tree (roots → children) into an indented option list. */
function flattenAccounts(nodes: any[], depth = 0, out: any[] = []): any[] {
  for (const node of nodes ?? []) {
    out.push({ ...node, depth });
    if (node.children?.length) flattenAccounts(node.children, depth + 1, out);
  }
  return out;
}

/**
 * Cash & bank accounts management — moved here from the treasury screen
 * (definitions hub): drawers, bank accounts, cards, wallets, with their
 * accounting mapping. The treasury screen keeps balances and movements only.
 */
export default function BankAccountsScreen() {
  const { can } = useSession();
  const canManage = can('cash.manage');

  const [rows, setRows] = useState<any[]>([]);
  const [glOptions, setGlOptions] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try { setRows(await apiFetch('/treasury/accounts')); setError(''); }
    catch (e: any) { setError(e?.message ?? 'تعذر التحميل'); }
  }
  useEffect(() => {
    load();
    apiFetch<any[]>('/accounting/accounts').then((tree) => setGlOptions(flattenAccounts(Array.isArray(tree) ? tree : []))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leafGlOptions = useMemo(() => glOptions.filter((row) => !row.isGroup && row.isActive !== false), [glOptions]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.name.trim()) { setError('اسم الحساب مطلوب'); return; }
    const payload: any = {
      name: form.name.trim(), type: Number(form.type),
      bankName: form.bankName.trim() || null, accountNo: form.accountNo.trim() || null,
      currencyCode: form.currencyCode || 'EGP', isActive: form.isActive !== false,
      notes: form.notes?.trim() || null,
      glAccountId: form.glAccountId ? Number(form.glAccountId) : null,
    };
    if (!form.cashAccountId && Number(form.openingBalance || 0) > 0) payload.openingBalance = Number(form.openingBalance);
    try {
      if (form.cashAccountId) await apiFetch(`/treasury/accounts/${form.cashAccountId}`, { method: 'PUT', body: payload });
      else await apiFetch('/treasury/accounts', { method: 'POST', body: payload });
      setMessage(form.cashAccountId ? 'تم حفظ التعديل' : 'تم إضافة الحساب');
      setForm(empty);
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحفظ');
    }
  }

  async function remove(row: any) {
    setError('');
    try {
      await apiFetch(`/treasury/accounts/${row.cashAccountId}`, { method: 'DELETE' });
      setMessage('تم حذف الحساب');
      await load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحذف');
    }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="card lg:col-span-2">
        <div className="card-title"><span>الحسابات والخزائن ({rows.length})</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>الاسم</th><th>النوع</th><th>البنك/الرقم</th><th>العملة</th><th>الرصيد الحالي</th><th>الحساب المحاسبي</th><th>الحالة</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cashAccountId}>
                  <td className="font-semibold">{row.name}{row.notes ? <div className="text-[10px] text-slate-400">{row.notes}</div> : null}</td>
                  <td>{TYPES[row.type] ?? row.type}</td>
                  <td className="text-xs">{row.bankName ?? '—'}{row.accountNo ? <div dir="ltr" className="text-slate-400">{row.accountNo}</div> : null}</td>
                  <td dir="ltr" className="text-right">{row.currencyCode ?? 'EGP'}</td>
                  <td className="font-semibold">{formatMoney(row.balance ?? 0)}</td>
                  <td className="text-xs">{row.glAccountName ?? <span className="text-amber-700">غير مربوط</span>}</td>
                  <td><span className={`badge ${row.isActive === false ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'}`}>{row.isActive === false ? 'موقوف' : 'نشط'}</span></td>
                  {canManage && (
                    <td className="whitespace-nowrap">
                      <button className="text-brand-600 text-xs font-semibold" onClick={() => setForm({
                        cashAccountId: row.cashAccountId, name: row.name, type: row.type,
                        bankName: row.bankName ?? '', accountNo: row.accountNo ?? '',
                        currencyCode: row.currencyCode ?? 'EGP', openingBalance: '', isActive: row.isActive !== false,
                        notes: row.notes ?? '', glAccountId: row.glAccountId ? String(row.glAccountId) : '',
                      })}>تعديل</button>
                      <DeleteButton screenKey="bankAccounts" className="text-rose-600 text-xs font-semibold mr-2" confirmText={`حذف «${row.name}»؟ لا يمكن الحذف إذا كانت عليه حركات.`} onDelete={() => remove(row)} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد حسابات — أضف حسابًا أولًا</td></tr>}
            </tbody>
          </table>
        </div>
        {error && <div className="text-xs text-rose-600 px-4 pb-3">{error}</div>}
        {message && <div className="text-xs text-emerald-700 px-4 pb-3">{message}</div>}
      </div>

      {canManage && (
        <form className="card p-5 space-y-3 h-fit" onSubmit={save}>
          <div className="font-bold">{form.cashAccountId ? 'تعديل الحساب' : 'حساب جديد'}</div>
          <div><label className="label">الاسم</label><input className="input" placeholder="البنك الأهلي / الخزينة الرئيسية…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">النوع</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: Number(e.target.value) })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={Number(k)}>{v}</option>)}</select></div>
            <div><label className="label">العملة</label><input className="input" dir="ltr" value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">البنك</label><input className="input" placeholder="اسم البنك (للحساب البنكي)" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
            <div><label className="label">رقم الحساب</label><input className="input" dir="ltr" value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} /></div>
          </div>
          <div>
            <label className="label">الحساب المحاسبي (يُربط لترحيل حركات الخزينة)</label>
            <select className="input" value={form.glAccountId} onChange={(e) => setForm({ ...form, glAccountId: e.target.value })}>
              <option value="">— اختر حسابًا من شجرة الحسابات —</option>
              {leafGlOptions.map((row) => (
                <option key={row.accountId} value={row.accountId}>{'　'.repeat(row.depth)}{row.code} — {row.name}</option>
              ))}
            </select>
            <div className="text-[10px] text-slate-400 mt-1">بدون ربط تظهر الحركات في الخزينة فقط — القيود المحاسبية لن تُرحّل لهذا الحساب.</div>
          </div>
          {!form.cashAccountId && (
            <div><label className="label">الرصيد الافتتاحي</label><input className="input" type="number" step="0.01" dir="ltr" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /><div className="text-[10px] text-slate-400 mt-1">يُنشأ قيد إيداع افتتاحي تلقائيًا.</div></div>
          )}
          <div><label className="label">ملاحظات</label><textarea className="input h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />الحساب نشط</label>
          <button type="submit" className="btn-primary w-full">{form.cashAccountId ? 'حفظ التعديل' : 'إضافة'}</button>
          {form.cashAccountId && <button type="button" className="btn-soft w-full" onClick={() => setForm(empty)}>إلغاء</button>}
        </form>
      )}
    </div>
  );
}
