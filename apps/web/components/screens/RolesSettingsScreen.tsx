'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** Roles & permissions matrix — toggle permission codes per role (seeded roles: admin/cashier/sales/accountant/viewer). */
export default function RolesSettingsScreen() {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    setRoles(await apiFetch('/admin/roles'));
    setPermissions(await apiFetch('/admin/permissions'));
  }

  useEffect(() => { load().catch((e) => setError(e?.message ?? 'تعذر التحميل')); }, []);

  const grouped = useMemo(() => permissions.reduce<Record<string, any[]>>((acc, permission) => {
    (acc[permission.module] ??= []).push(permission);
    return acc;
  }, {}), [permissions]);

  async function toggleRolePermission(roleId: number, code: string, enabled: boolean) {
    const role = roles.find((r) => r.roleId === roleId);
    const next = enabled
      ? [...new Set([...(role.permissions ?? []), code])]
      : (role.permissions ?? []).filter((c: string) => c !== code);
    try {
      await apiFetch(`/admin/roles/${roleId}/permissions`, { method: 'PUT', body: { codes: next } });
      load();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ الصلاحيات');
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">{error}</div>}
      <div className="card p-4">
        <div className="font-extrabold text-slate-800">الأدوار والصلاحيات</div>
        <div className="text-xs text-slate-500 mt-1">كل الأدوار و{permissions.length} صلاحية في {Object.keys(grouped).length} وحدة — أي تغيير يُحفظ فورًا.</div>
      </div>
      {roles.map((role) => (
        <div key={role.roleId} className="card">
          <div className="card-title justify-between">
            <span>{role.name} {role.nameEn && <span className="text-xs font-normal text-slate-400">({role.nameEn})</span>}</span>
            <span className="badge bg-slate-100 text-slate-600">{(role.permissions ?? []).length} صلاحية</span>
          </div>
          <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(grouped).map(([module, list]) => (
              <div key={module} className="rounded-xl bg-slate-50 p-3">
                <div className="text-xs font-bold text-slate-500 mb-2">{module}</div>
                {list.map((permission) => {
                  const enabled = (role.permissions ?? []).includes(permission.code);
                  return (
                    <label key={permission.code} className="flex items-center gap-2 text-sm py-1">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleRolePermission(role.roleId, permission.code, e.target.checked)}
                      />
                      {permission.name}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
