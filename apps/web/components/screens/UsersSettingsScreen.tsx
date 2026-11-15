'use client';

import { useEffect, useState } from 'react';
import { apiFetch, formatDate } from '@/lib/api';

/** Users management — create users, assign roles, restrict warehouse/cash-account visibility (P7). */
export default function UsersSettingsScreen() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [error, setError] = useState('');

  // P7 — تقييد قوائم المستخدم (مخازن + صناديق)
  const [restrictionUser, setRestrictionUser] = useState<any>(null);
  const [restrictionOptions, setRestrictionOptions] = useState<{ warehouses: any[]; cashAccounts: any[] }>({ warehouses: [], cashAccounts: [] });
  const [restrictionForm, setRestrictionForm] = useState<{ warehouseIds: number[]; cashAccountIds: number[] }>({ warehouseIds: [], cashAccountIds: [] });
  const [restrictionBusy, setRestrictionBusy] = useState(false);
  const [restrictionNote, setRestrictionNote] = useState('');

  async function load() {
    setUsers(await apiFetch('/admin/users'));
    setRoles(await apiFetch('/admin/roles'));
  }

  useEffect(() => { load().catch((e) => setError(e?.message ?? 'تعذر التحميل')); }, []);

  async function openRestrictions(user: any) {
    setRestrictionUser(user);
    setRestrictionNote('');
    setRestrictionBusy(true);
    try {
      const [options, current] = await Promise.all([
        restrictionOptions.warehouses.length || restrictionOptions.cashAccounts.length
          ? Promise.resolve(restrictionOptions)
          : apiFetch('/admin/restrictions/options'),
        apiFetch<{ warehouseIds: number[]; cashAccountIds: number[] }>(`/admin/users/${user.userId}/restrictions`),
      ]);
      setRestrictionOptions(options);
      setRestrictionForm({ warehouseIds: current.warehouseIds ?? [], cashAccountIds: current.cashAccountIds ?? [] });
    } catch (err: any) {
      setRestrictionNote(err?.message ?? 'تعذر تحميل القيود');
    } finally {
      setRestrictionBusy(false);
    }
  }

  function toggleRestriction(kind: 'warehouseIds' | 'cashAccountIds', id: number) {
    setRestrictionForm((prev) => {
      const list = prev[kind];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return { ...prev, [kind]: next };
    });
  }

  async function saveRestrictions() {
    if (!restrictionUser) return;
    setRestrictionBusy(true);
    setRestrictionNote('');
    try {
      await apiFetch(`/admin/users/${restrictionUser.userId}/restrictions`, { method: 'PUT', body: restrictionForm });
      setRestrictionNote('تم الحفظ بنجاح');
      window.setTimeout(() => setRestrictionNote(''), 3000);
    } catch (err: any) {
      setRestrictionNote(err?.message ?? 'تعذر الحفظ');
    } finally {
      setRestrictionBusy(false);
    }
  }

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.target as any);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: {
          userName: form.get('userName'), fullName: form.get('fullName'), password: form.get('password'),
          roleIds: [Number(form.get('roleId'))],
        },
      });
      (event.target as HTMLFormElement).reset();
      load();
    } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">{error}</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="card-title"><span>المستخدمون ({users.length})</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الأدوار</th><th>آخر دخول</th><th>الحالة</th><th>تقييد القوائم</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId}>
                    <td className="font-mono text-xs">{user.userName}</td>
                    <td className="font-semibold">{user.fullName}</td>
                    <td>{(user.roles ?? []).map((r: string) => <span key={r} className="badge bg-brand-50 text-brand-700 ml-1">{r}</span>)}</td>
                    <td>{user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'}</td>
                    <td>
                      <span className={`badge ${user.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {user.isActive ? 'نشط' : 'موقوف'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-soft text-xs py-1.5" onClick={() => openRestrictions(user)}>
                        مخازن / صناديق
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا يوجد مستخدمون</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <form className="card p-5 space-y-3 h-fit" onSubmit={addUser}>
          <div className="font-bold">مستخدم جديد</div>
          <div><label className="label">اسم المستخدم</label><input name="userName" className="input" required dir="ltr" /></div>
          <div><label className="label">الاسم الكامل</label><input name="fullName" className="input" required /></div>
          <div><label className="label">كلمة المرور</label><input name="password" type="password" className="input" required dir="ltr" /></div>
          <div>
            <label className="label">الدور</label>
            <select name="roleId" className="input">
              {roles.map((role) => <option key={role.roleId} value={role.roleId}>{role.name}</option>)}
            </select>
          </div>
          <button className="btn-primary w-full">إضافة</button>
        </form>
      </div>

      {restrictionUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setRestrictionUser(null)}>
          <div className="card w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-1">
              <div>
                <div className="font-extrabold text-lg text-slate-800">تقييد القوائم — {restrictionUser.fullName}</div>
                <div className="text-[11px] text-slate-500" dir="ltr">@{restrictionUser.userName}</div>
              </div>
              <button className="btn-soft" onClick={() => setRestrictionUser(null)}>إغلاق</button>
            </div>
            <div className="text-[11px] text-slate-500 mb-3 leading-5">
              القائمة الفارغة = «الكل مسموح». أي اختيار يقيّد المستخدم بالمحدد فقط في قوائم المخازن والصناديق/الخزائن (نقطة البيع، الجرد، التحويل، أذون المخازن، الخزينة).
            </div>

            {restrictionBusy && restrictionOptions.warehouses.length === 0 && restrictionOptions.cashAccounts.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">جارٍ التحميل…</div>
            ) : (
              <>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-bold text-slate-700 mb-2">المخازن المسموحة ({restrictionForm.warehouseIds.length})</div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pl-1">
                      {restrictionOptions.warehouses.map((warehouse) => (
                        <label
                          key={warehouse.warehouseId}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-brand-600"
                            checked={restrictionForm.warehouseIds.includes(warehouse.warehouseId)}
                            onChange={() => toggleRestriction('warehouseIds', warehouse.warehouseId)}
                          />
                          <span className="flex-1 min-w-0 truncate">{warehouse.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{warehouse.branchName}</span>
                        </label>
                      ))}
                      {restrictionOptions.warehouses.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">لا توجد مخازن</div>}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-700 mb-2">الصناديق / الخزائن المسموحة ({restrictionForm.cashAccountIds.length})</div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pl-1">
                      {restrictionOptions.cashAccounts.map((account) => (
                        <label
                          key={account.cashAccountId}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-brand-600"
                            checked={restrictionForm.cashAccountIds.includes(account.cashAccountId)}
                            onChange={() => toggleRestriction('cashAccountIds', account.cashAccountId)}
                          />
                          <span className="flex-1 min-w-0 truncate">{account.name}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{account.branchName}</span>
                        </label>
                      ))}
                      {restrictionOptions.cashAccounts.length === 0 && <div className="text-xs text-slate-400 py-4 text-center">لا توجد صناديق</div>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mt-4">
                  <div className={`text-xs font-semibold ${restrictionNote.includes('تعذر') ? 'text-rose-600' : 'text-emerald-600'}`}>{restrictionNote}</div>
                  <div className="flex gap-2">
                    <button className="btn-soft" onClick={() => setRestrictionUser(null)}>إلغاء</button>
                    <button className="btn-primary" onClick={saveRestrictions} disabled={restrictionBusy}>
                      {restrictionBusy ? 'جارٍ الحفظ…' : 'حفظ القيود'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
