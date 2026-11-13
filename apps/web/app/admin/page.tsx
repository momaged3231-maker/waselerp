'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate } from '@/lib/api';

function ZatcaList() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    apiFetch('/zatca/invoices').then(setRows).catch(() => {});
  }, []);

  if (rows.length === 0) {
    return <div className="text-sm text-slate-400 py-6 text-center">لا توجد مستندات بعد</div>;
  }

  const labels: Record<number, string> = { 1: 'بانتظار', 2: 'تم التخليص', 3: 'تم الإبلاغ', 4: 'مرفوض' };

  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>الفاتورة</th><th>النوع</th><th>UUID</th><th>الحالة</th><th>التاريخ</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.zatcaInvoiceId}>
              <td className="font-mono text-xs">{row.invoiceNo ?? '—'}</td>
              <td>
                <span className="badge bg-slate-100 text-slate-600">
                  {row.invoiceType === 1 ? 'مبسطة' : 'ضريبية'}
                </span>
              </td>
              <td className="font-mono text-[10px]">{String(row.invoiceUuid).slice(0, 18)}…</td>
              <td>
                <span className={`badge ${row.status === 4 ? 'bg-rose-50 text-rose-700' : row.status === 1 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {labels[row.status] ?? row.status}
                </span>
              </td>
              <td>{formatDate(row.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<'branches' | 'users' | 'roles' | 'settings' | 'audit' | 'zatca' | 'eta'>('branches');
  const [branches, setBranches] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<any[]>([]);
  const [zatca, setZatca] = useState<any>({});
  const [zatcaStatus, setZatcaStatus] = useState<any>(null);
  const [eta, setEta] = useState<any>({});
  const [etaStatus, setEtaStatus] = useState<any>(null);
  const [etaDocuments, setEtaDocuments] = useState<any[]>([]);
  const [error, setError] = useState('');

  async function load() {
    if (tab === 'branches') setBranches(await apiFetch('/admin/branches'));
    if (tab === 'users') setUsers(await apiFetch('/admin/users'));
    if (tab === 'roles') {
      setRoles(await apiFetch('/admin/roles'));
      setPermissions(await apiFetch('/admin/permissions'));
    }
    if (tab === 'settings') setSettings(await apiFetch('/admin/settings'));
    if (tab === 'audit') setAudit(await apiFetch('/admin/audit?limit=100'));
    if (tab === 'zatca') {
      setZatca(await apiFetch('/zatca/config') ?? {});
      setZatcaStatus(await apiFetch('/zatca/status'));
    }
    if (tab === 'eta') {
      setEta(await apiFetch('/eta/config') ?? {});
      setEtaStatus(await apiFetch('/eta/status'));
      setEtaDocuments(await apiFetch('/eta/invoices?limit=50'));
    }
  }

  useEffect(() => { load(); }, [tab]);

  async function addBranch(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.target as any);
    try {
      await apiFetch('/admin/branches', {
        method: 'POST',
        body: { code: form.get('code'), name: form.get('name'), city: form.get('city'), phone: form.get('phone'), isActive: true },
      });
      load();
    } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
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
      load();
    } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
  }

  async function toggleRolePermission(roleId: number, code: string, enabled: boolean) {
    const role = roles.find((r) => r.roleId === roleId);
    const next = enabled
      ? [...new Set([...(role.permissions ?? []), code])]
      : (role.permissions ?? []).filter((c: string) => c !== code);
    await apiFetch(`/admin/roles/${roleId}/permissions`, { method: 'PUT', body: { codes: next } });
    load();
  }

  async function saveSettings() {
    await apiFetch('/admin/settings', { method: 'PUT', body: settings });
    setError('');
  }

  const grouped = permissions.reduce<Record<string, any[]>>((acc, permission) => {
    (acc[permission.module] ??= []).push(permission);
    return acc;
  }, {});

  return (
    <AppShell title="الإعدادات">
      <div className="flex gap-2 mb-4 flex-wrap">
        {([['branches', 'الفروع'], ['users', 'المستخدمون'], ['roles', 'الأدوار والصلاحيات'], ['settings', 'إعدادات النظام'], ['eta', 'الفاتورة الإلكترونية (مصر)'], ['zatca', 'الضريبة الإلكترونية (السعودية)'], ['audit', 'سجل العمليات']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">{error}</div>}

      {tab === 'branches' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>الفروع ({branches.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الاسم</th><th>المدينة</th><th>التليفون</th><th>الحالة</th></tr></thead>
                <tbody>
                  {branches.map((branch) => (
                    <tr key={branch.branchId}>
                      <td className="font-mono text-xs">{branch.code}</td>
                      <td className="font-semibold">{branch.name}</td>
                      <td>{branch.city ?? '—'}</td>
                      <td dir="ltr" className="text-right">{branch.phone ?? '—'}</td>
                      <td>
                        <span className={`badge ${branch.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {branch.isActive ? 'نشط' : 'موقوف'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <form className="card p-5 space-y-3 h-fit" onSubmit={addBranch}>
            <div className="font-bold">فرع جديد</div>
            <div><label className="label">الكود</label><input name="code" className="input" required dir="ltr" /></div>
            <div><label className="label">الاسم</label><input name="name" className="input" required /></div>
            <div><label className="label">المدينة</label><input name="city" className="input" /></div>
            <div><label className="label">التليفون</label><input name="phone" className="input" dir="ltr" /></div>
            <button className="btn-primary w-full">إضافة</button>
          </form>
        </div>
      )}

      {tab === 'users' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-title"><span>المستخدمون ({users.length})</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>اسم المستخدم</th><th>الاسم</th><th>الأدوار</th><th>آخر دخول</th><th>الحالة</th></tr></thead>
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
                    </tr>
                  ))}
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
      )}

      {tab === 'roles' && (
        <div className="space-y-4">
          {roles.map((role) => (
            <div key={role.roleId} className="card">
              <div className="card-title">
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
      )}

      {tab === 'settings' && (
        <div className="card p-5 max-w-xl">
          <div className="font-bold mb-4">إعدادات النظام</div>
          <div className="space-y-3">
            {Object.entries(settings).map(([key, value]) => (
              <div key={key}>
                <label className="label">{key}</label>
                <input className="input" value={value ?? ''} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} />
              </div>
            ))}
          </div>
          <button className="btn-primary mt-4" onClick={saveSettings}>حفظ الإعدادات</button>
        </div>
      )}

      {tab === 'eta' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <form
            className="card p-5 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                await apiFetch('/eta/config', { method: 'PUT', body: eta });
                setEtaStatus(await apiFetch('/eta/status'));
              } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
            }}
          >
            <div className="font-bold">فاتورة إلكترونية مصرية (ETA)</div>

            {etaStatus && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
                <div>الحالة: <b>{etaStatus.configured ? 'مُهيّأة' : 'غير مُهيّأة'}</b></div>
                <div>البيئة: {etaStatus.environment}</div>
                <div>الشهادة: {etaStatus.hasCertificate ? 'موجودة' : 'غير موجودة'} · المفتاح: {etaStatus.hasPrivateKey ? 'موجود' : 'غير موجود'}</div>
                <div>UUID تسجيل البائع: {etaStatus.egsUuid ?? 'يُشتق من رقم التسجيل'}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">اسم البائع</label>
                <input className="input" value={eta.seller_name ?? ''}
                  onChange={(e) => setEta({ ...eta, seller_name: e.target.value })} />
              </div>
              <div>
                <label className="label">الرقم الضريبي</label>
                <input className="input" value={eta.seller_vat_number ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, seller_vat_number: e.target.value })} />
              </div>
              <div>
                <label className="label">رقم التسجيل التجاري</label>
                <input className="input" value={eta.seller_registration_id ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, seller_registration_id: e.target.value })} />
              </div>
              <div>
                <label className="label">UUID تسجيل البائع (EGS)</label>
                <input className="input" value={eta.egs_uuid ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, egs_uuid: e.target.value })} />
              </div>
              <div>
                <label className="label">البريد الإلكتروني</label>
                <input className="input" value={eta.seller_email ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, seller_email: e.target.value })} />
              </div>
              <div>
                <label className="label">التليفون</label>
                <input className="input" value={eta.seller_phone ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, seller_phone: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">العنوان</label>
              <input className="input" value={eta.seller_address ?? ''}
                onChange={(e) => setEta({ ...eta, seller_address: e.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">البيئة</label>
                <select className="input" value={eta.environment ?? 'sandbox'}
                  onChange={(e) => setEta({ ...eta, environment: e.target.value })}>
                  <option value="sandbox">اختبار</option>
                  <option value="production">إنتاج</option>
                </select>
              </div>
              <div>
                <label className="label">عنوان بوابة ETA</label>
                <input className="input" value={eta.api_base_url ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, api_base_url: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">معرّف العميل</label>
                <input className="input" value={eta.client_id ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, client_id: e.target.value })} />
              </div>
              <div>
                <label className="label">سر العميل</label>
                <input className="input" value={eta.client_secret ?? ''} dir="ltr"
                  onChange={(e) => setEta({ ...eta, client_secret: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">المفتاح الخاص (RSA)</label>
              <textarea className="input h-28 font-mono text-[10px]" value={eta.private_key ?? ''}
                onChange={(e) => setEta({ ...eta, private_key: e.target.value })} />
            </div>
            <div>
              <label className="label">الشهادة الرقمية</label>
              <textarea className="input h-24 font-mono text-[10px]" value={eta.certificate ?? ''}
                onChange={(e) => setEta({ ...eta, certificate: e.target.value })} />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!eta.is_active}
                onChange={(e) => setEta({ ...eta, is_active: e.target.checked })} />
              تفعيل الربط مع هيئة الضرائب المصرية
            </label>

            <button className="btn-primary">حفظ إعدادات ETA</button>
          </form>

          <div className="card">
            <div className="card-title"><span>مستندات ETA</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الفاتورة</th><th>UUID</th><th>الإجمالي</th><th>الحالة</th></tr></thead>
                <tbody>
                  {etaDocuments.map((row: any) => (
                    <tr key={row.etaInvoiceId}>
                      <td className="text-xs font-mono">{row.invoiceNo}</td>
                      <td className="text-[10px] font-mono">{row.invoiceUuid}</td>
                      <td className="text-xs font-bold">{Number(row.totalAmount).toFixed(2)}</td>
                      <td>
                        <span className={`badge ${row.status === 1 ? 'bg-amber-50 text-amber-700'
                          : row.status === 4 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {row.status === 1 ? 'في انتظار الإرسال' : row.status === 2 ? 'مُسلَّم' : row.status === 3 ? 'مُبلَّغ' : 'مرفوض'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {etaDocuments.length === 0 && (
                    <tr><td colSpan={4} className="text-center text-slate-400 py-8">لا توجد مستندات</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'zatca' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <form
            className="card p-5 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                await apiFetch('/zatca/config', { method: 'PUT', body: zatca });
                setZatcaStatus(await apiFetch('/zatca/status'));
              } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
            }}
          >
            <div className="font-bold">بيانات البائع وربط ZATCA</div>

            {zatcaStatus && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1">
                <div>الحالة: <b>{zatcaStatus.configured ? 'مُهيّأة' : 'غير مُهيّأة'}</b></div>
                <div>البيئة: {zatcaStatus.environment}</div>
                <div>CSID: {zatcaStatus.hasCsid ? 'موجود' : 'غير موجود'} · الشهادة: {zatcaStatus.hasCertificate ? 'موجودة' : 'غير موجودة'}</div>
                <div>مفتاح ECDSA: {zatcaStatus.hasEcdsaKey ? 'موجود' : 'غير موجود'}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">اسم البائع</label>
                <input className="input" value={zatca.seller_name ?? ''}
                  onChange={(e) => setZatca({ ...zatca, seller_name: e.target.value })} />
              </div>
              <div>
                <label className="label">الرقم الضريبي</label>
                <input className="input" value={zatca.seller_vat_number ?? ''} dir="ltr"
                  onChange={(e) => setZatca({ ...zatca, seller_vat_number: e.target.value })} />
              </div>
              <div>
                <label className="label">البريد</label>
                <input className="input" value={zatca.seller_email ?? ''} dir="ltr"
                  onChange={(e) => setZatca({ ...zatca, seller_email: e.target.value })} />
              </div>
              <div>
                <label className="label">الهاتف</label>
                <input className="input" value={zatca.seller_phone ?? ''} dir="ltr"
                  onChange={(e) => setZatca({ ...zatca, seller_phone: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">العنوان</label>
              <input className="input" value={zatca.seller_address ?? ''}
                onChange={(e) => setZatca({ ...zatca, seller_address: e.target.value })} />
            </div>

            <div>
              <label className="label">البيئة</label>
              <select className="input" value={zatca.environment ?? 'sandbox'}
                onChange={(e) => setZatca({ ...zatca, environment: e.target.value })}>
                <option value="sandbox">Simulation (اختبار)</option>
                <option value="production">Production (إنتاج)</option>
              </select>
            </div>

            <details className="rounded-xl border border-slate-200 p-3">
              <summary className="text-sm font-semibold cursor-pointer">بيانات CSID والمفاتيح (من بوابة ZATCA)</summary>
              <div className="space-y-3 mt-3">
                <div>
                  <label className="label">CSID Token</label>
                  <textarea className="input h-20 font-mono text-xs" value={zatca.csid_token ?? ''}
                    onChange={(e) => setZatca({ ...zatca, csid_token: e.target.value })} />
                </div>
                <div>
                  <label className="label">CSID Secret</label>
                  <textarea className="input h-20 font-mono text-xs" value={zatca.csid_secret ?? ''}
                    onChange={(e) => setZatca({ ...zatca, csid_secret: e.target.value })} />
                </div>
                <div>
                  <label className="label">المفتاح الخاص (RSA PEM)</label>
                  <textarea className="input h-28 font-mono text-[10px]" value={zatca.private_key ?? ''}
                    onChange={(e) => setZatca({ ...zatca, private_key: e.target.value })} />
                </div>
                <div>
                  <label className="label">الشهادة (PEM)</label>
                  <textarea className="input h-24 font-mono text-[10px]" value={zatca.certificate ?? ''}
                    onChange={(e) => setZatca({ ...zatca, certificate: e.target.value })} />
                </div>
                <div>
                  <label className="label">مفتاح ECDSA الخاص (PEM)</label>
                  <textarea className="input h-24 font-mono text-[10px]" value={zatca.ecdsa_private_key ?? ''}
                    onChange={(e) => setZatca({ ...zatca, ecdsa_private_key: e.target.value })} />
                </div>
                <div>
                  <label className="label">مفتاح ECDSA العام (PEM)</label>
                  <textarea className="input h-24 font-mono text-[10px]" value={zatca.ecdsa_public_key ?? ''}
                    onChange={(e) => setZatca({ ...zatca, ecdsa_public_key: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!zatca.is_active}
                    onChange={(e) => setZatca({ ...zatca, is_active: e.target.checked })} />
                  تفعيل الربط مع ZATCA
                </label>
              </div>
            </details>

            <button className="btn-primary">حفظ</button>
          </form>

          <div className="card p-5">
            <div className="font-bold mb-2">مستندات ZATCA</div>
            <ZatcaList />
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-title"><span>سجل العمليات ({audit.length})</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>التاريخ</th><th>المستخدم</th><th>الفرع</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.activityLogId}>
                    <td>{formatDate(row.createdAt)}</td>
                    <td className="font-semibold">{row.userName ?? '—'}</td>
                    <td className="text-slate-500">{row.branchName ?? '—'}</td>
                    <td><span className="badge bg-slate-100 text-slate-600">{row.action}</span></td>
                    <td className="text-xs">{row.entity} #{row.entityId}</td>
                    <td className="text-xs text-slate-500">{row.details ?? '—'}</td>
                  </tr>
                ))}
                {audit.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">لا توجد عمليات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
