'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { apiFetch, formatDate } from '@/lib/api';
import { agentHealth, getAgentConfig, listPrinters, openDrawer, saveAgentConfig } from '@/lib/print';

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

type SettingField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
  desc?: string;
  placeholder?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  unit?: string;
};

const SETTING_SECTIONS: { id: string; title: string; desc: string; fields: SettingField[] }[] = [
  {
    id: 'company',
    title: 'الشركة والفاتورة',
    desc: 'بيانات الشركة — تُطبع على الإيصال والفاتورة المطبوعة تلقائيًا',
    fields: [
      { key: 'CompanyName', label: 'اسم الشركة', type: 'text', placeholder: 'مثال: شركة الوصل للتجارة', desc: 'يظهر بأعلى الإيصال والفاتورة المطبوعة' },
      { key: 'CompanyPhone', label: 'تليفون الشركة', type: 'text', dir: 'ltr', desc: 'يظهر أسفل الاسم في الطباعة' },
      { key: 'CompanyAddress', label: 'العنوان', type: 'text', desc: 'يظهر بأعلى الإيصال تحت اسم الشركة' },
      { key: 'TaxNumber', label: 'الرقم الضريبي', type: 'text', dir: 'ltr', desc: 'يظهر في الطباعة والفوترة' },
      { key: 'InvoiceFooter', label: 'نص تذييل الفاتورة', type: 'text', desc: 'يظهر أسفل كل إيصال/فاتورة مطبوعة (مثال: شكراً لزيارتكم)' },
    ],
  },
  {
    id: 'tax',
    title: 'الضرائب',
    desc: 'تسمية الضريبة وكيفية عرضها على الإيصال المطبوع',
    fields: [
      { key: 'TaxName', label: 'تسمية الضريبة المطبقة على المبيعات', type: 'text', desc: 'الاسم الذي يُطبع بجانب مبلغ الضريبة (مثال: ضريبة القيمة المضافة)' },
      {
        key: 'ShowTaxOnReceipt',
        label: 'إظهار الضريبة في الإيصال المطبوع',
        type: 'boolean',
        desc: 'إظهار/إخفاء سطر الضريبة في الطباعة — الحساب في النظام لا يتأثر (تظهر أو تختفي في الورقة فقط)',
      },
    ],
  },
  {
    id: 'stock',
    title: 'المخزون',
    desc: 'سلوك حركات المخزون والرصيد السالب',
    fields: [
      {
        key: 'AllowNegativeStock',
        label: 'السماح برصيد الصنف بالسالب',
        type: 'boolean',
        desc: 'يتيح البيع والتحويل والتصنيع حتى لو لم يكفِ الرصيد فيصبح رصيد الصنف سالبًا',
      },
    ],
  },
  {
    id: 'pos',
    title: 'نقطة البيع والكاشير',
    desc: 'سلوك نقطة البيع وإلزام فتح وردية',
    fields: [
      {
        key: 'RequireCashierShift',
        label: 'إلزام فتح وردية قبل البيع',
        type: 'boolean',
        desc: 'لا يمكن إتمام بيع من نقطة البيع بدون وردية مفتوحة على الخزينة',
      },
    ],
  },
  {
    id: 'accounting',
    title: 'المحاسبة',
    desc: 'الترحيل التلقائي للقيود المحاسبية',
    fields: [
      {
        key: 'EnableGLPosting',
        label: 'ترحيل القيود المحاسبية تلقائيًا',
        type: 'boolean',
        desc: 'إنشاء قيد مزدوج متوازن لكل معاملة مالية (فاتورة / حركة خزينة / سداد قسط / مرتب)',
      },
    ],
  },
];

const KNOWN_SETTING_KEYS = new Set(SETTING_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)));

function SettingFieldRow({ field, value, onChange }: {
  field: SettingField;
  value: string | undefined;
  onChange: (next: string) => void;
}) {
  if (field.type === 'boolean') {
    const checked = value === 'true' || value === '1';
    return (
      <label className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition cursor-pointer">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-700">{field.label}</span>
          {field.desc && <span className="block text-xs text-slate-500 mt-1 leading-5">{field.desc}</span>}
        </span>
        <input
          type="checkbox"
          className="w-5 h-5 accent-brand-600 shrink-0 mt-0.5"
          checked={checked}
          onChange={() => onChange(checked ? 'false' : 'true')}
        />
      </label>
    );
  }

  return (
    <div>
      <label className="label">{field.label}</label>
      <div className="relative">
        <input
          className={`input ${field.unit ? 'pl-9' : ''}`}
          type={field.type === 'number' ? 'number' : 'text'}
          dir={field.dir ?? 'rtl'}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.unit && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">{field.unit}</span>
        )}
      </div>
      {field.desc && <div className="text-[11px] text-slate-500 mt-1">{field.desc}</div>}
    </div>
  );
}

function PrintAgentPanel() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [version, setVersion] = useState('');
  const [config, setConfig] = useState<any>(null);
  const [printers, setPrinters] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [netName, setNetName] = useState('');
  const [netHost, setNetHost] = useState('');
  const [netPort, setNetPort] = useState('9100');

  async function refresh() {
    setError('');
    const health = await agentHealth();
    setOnline(!!health?.ok);
    setVersion(health?.version ?? '');
    if (health?.ok) {
      const [cfg, printers] = await Promise.all([
        getAgentConfig().catch(() => null),
        listPrinters().catch(() => []),
      ]);
      setConfig(cfg ?? { defaultPrinter: '', autoOpenDrawer: true, paperWidth: 42, networkPrinters: [] });
      setPrinters(printers);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      await saveAgentConfig(config);
      const fresh = await getAgentConfig().catch(() => config);
      setConfig(fresh ?? config);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ إعدادات الوكيل');
    } finally {
      setBusy(false);
    }
  }

  function addNetworkPrinter() {
    setError('');
    if (!netHost.trim()) { setError('اكتب عنوان الطابعة الشبكية'); return; }
    setConfig({
      ...config,
      networkPrinters: [
        ...(config?.networkPrinters ?? []),
        { type: 'network', name: netName.trim() || netHost.trim(), host: netHost.trim(), port: Number(netPort) || 9100 },
      ],
    });
    setNetName('');
    setNetHost('');
    setNetPort('9100');
  }

  function removeNetworkPrinter(index: number) {
    const next = [...(config?.networkPrinters ?? [])];
    next.splice(index, 1);
    setConfig({ ...config, networkPrinters: next });
  }

  const printerOptions = [
    ...printers.map((p: any) => ({
      value: p.name ?? p.host,
      label: `${p.name ?? p.host}${p.type === 'network' ? ' (شبكة)' : ' (Windows)'}`,
    })),
    ...(config?.networkPrinters ?? []).map((p: any) => ({
      value: p.name,
      label: `${p.name} (مواصفة شبكية)`,
    })),
  ];

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-slate-800">وكيل الطباعة — على هذا الجهاز فقط</div>
          <div className="text-xs text-slate-500 mt-0.5">طابعة الكاشير ودرج النقود — مشابهة لتبويب «اعدادات الطابعه» في Ezees (تُحفظ للجهاز الحالي، وتُضبط على كل محطة طباعة على حدة)</div>
        </div>
        <span className={`badge ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          {online === null ? 'جارٍ الفحص…' : online ? `وكيل متصل${version ? ` · v${version}` : ''}` : 'وكيل غير متصل'}
        </span>
      </div>

      {online === false && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 mt-4">
          وكيل الطباعة غير يعمل — للتشغيل:
          <code dir="ltr" className="block bg-amber-100 text-amber-900 px-3 py-2 rounded-lg mt-2 font-mono text-xs">cd apps\print-agent && npm install && node server.js</code>
          يعمل على <code dir="ltr" className="bg-amber-100 px-1 py-0.5 rounded">http://127.0.0.1:4100</code>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <div>
          <label className="label">الطابعة الافتراضية</label>
          <input
            className="input"
            list="wasel-printers"
            disabled={!online}
            value={config?.defaultPrinter ?? ''}
            onChange={(e) => setConfig({ ...config, defaultPrinter: e.target.value })}
            placeholder="اختر من القائمة أو اكتب اسم الطابعة"
          />
          <datalist id="wasel-printers">
            {printerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </datalist>
          <div className="text-[11px] text-slate-500 mt-1">تُستخدم للإيصالات وأذون المخزن ما لم تُحدد طابعة أخرى.</div>
        </div>

        <div>
          <label className="label">مقاس الإيصال الحراري</label>
          <div className="grid grid-cols-2 gap-2">
            {[{ value: 42, label: '80 ملم' }, { value: 32, label: '58 ملم' }].map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!online}
                onClick={() => setConfig({ ...config, paperWidth: option.value })}
                className={`py-2 rounded-xl text-sm font-bold transition disabled:opacity-50 ${
                  Number(config?.paperWidth ?? 42) === option.value
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4 sm:col-span-2 cursor-pointer hover:border-slate-300">
          <span>
            <span className="block text-sm font-bold text-slate-700">فتح درج النقود تلقائيًا بعد الطباعة</span>
            <span className="block text-xs text-slate-500 mt-1">يرسل ESC/POS لفتح الدرج بعد كل إيصال مطبوع (مشابه لـ autoOpenDrawer)</span>
          </span>
          <input
            type="checkbox"
            className="w-5 h-5 accent-brand-600 shrink-0"
            disabled={!online}
            checked={!!config?.autoOpenDrawer}
            onChange={() => setConfig({ ...config, autoOpenDrawer: !config?.autoOpenDrawer })}
          />
        </label>
      </div>

      <div className="mt-4">
        <label className="label">طابعات الشبكة (TCP 9100)</label>
        <div className="space-y-2 mt-1">
          {(config?.networkPrinters ?? []).map((p: any, index: number) => (
            <div key={`${p.host}:${p.port}:${index}`} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><b>{p.name}</b> — <span dir="ltr" className="text-slate-500">{p.host}:{p.port}</span></span>
              <button type="button" className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center" onClick={() => removeNetworkPrinter(index)} aria-label="حذف">×</button>
            </div>
          ))}
          {(config?.networkPrinters ?? []).length === 0 && (
            <div className="text-xs text-slate-400">لا توجد طابعات شبكية مُعرّفة</div>
          )}
        </div>
        <div className="grid grid-cols-[1fr_1fr_80px_auto] gap-2 mt-2">
          <input className="input" disabled={!online} placeholder="اسم الطابعة" value={netName} onChange={(e) => setNetName(e.target.value)} />
          <input className="input" disabled={!online} dir="ltr" placeholder="العنوان 192.168.1.50" value={netHost} onChange={(e) => setNetHost(e.target.value)} />
          <input className="input" disabled={!online} dir="ltr" type="number" value={netPort} onChange={(e) => setNetPort(e.target.value)} />
          <button type="button" className="btn-soft" disabled={!online} onClick={addNetworkPrinter}>إضافة</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-5 border-t border-slate-100 pt-4">
        <button className="btn-soft text-xs" disabled={!online} onClick={() => openDrawer().catch(() => {})}>اختبار درج الكاشير</button>
        <div className="flex items-center gap-2">
          {saved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ على هذا الجهاز</span>}
          {error && <span className="text-xs text-rose-600">{error}</span>}
          <button className="btn-primary" onClick={save} disabled={!online || busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات الوكيل'}</button>
        </div>
      </div>
    </div>
  );
}

function BranchServiceChargeCard() {
  const [settings, setSettings] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      setSettings(await apiFetch('/pos/settings'));
    } catch {
      setSettings(null);
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      await apiFetch('/pos/settings', {
        method: 'PUT',
        body: {
          serviceChargePerGuest: Number(settings.serviceChargePerGuest ?? 0),
          serviceChargeMinimum: Number(settings.serviceChargeMinimum ?? 0),
          serviceChargeMode: Number(settings.serviceChargeMode ?? 1),
          kitchenColumns: settings.kitchenColumns ?? [],
          notes: settings.notes ?? null,
        },
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ إعدادات الفرع');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-slate-800">رسوم الخدمة والكاشير (للفرع النشط)</div>
          <div className="text-xs text-slate-500 mt-0.5">تُطبق على طلبات الصالة/التوصيل في الفرع المحدد أعلى الشاشة — مشابهة لتبويب «POS» في الإعدادات المتقدمة لـ Ezees</div>
        </div>
        <Link href="/restaurant" className="btn-soft text-xs">إدارة المطاعم والتاعات ←</Link>
      </div>

      {settings === null && (
        <div className="text-sm text-slate-400 py-6 text-center">تعذر تحميل إعدادات الفرع</div>
      )}
      {settings && (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="label">رسوم الخدمة لكل ضيف</label>
              <input className="input" type="number" step="0.01" dir="ltr" value={settings.serviceChargePerGuest ?? 0}
                onChange={(e) => setSettings({ ...settings, serviceChargePerGuest: e.target.value })} />
            </div>
            <div>
              <label className="label">الحد الأدنى للفاتورة (للخدمة)</label>
              <input className="input" type="number" step="0.01" dir="ltr" value={settings.serviceChargeMinimum ?? 0}
                onChange={(e) => setSettings({ ...settings, serviceChargeMinimum: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">طريقة احتساب رسوم الخدمة</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { value: 1, label: 'مبلغ ثابت لكل ضيف' },
                  { value: 2, label: 'حد أدنى لإجمالي الفاتورة (يُضاف الفرق)' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSettings({ ...settings, serviceChargeMode: option.value })}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition text-right ${
                      Number(settings.serviceChargeMode ?? 1) === option.value
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {error && <div className="text-sm text-rose-600 mt-3">{error}</div>}
          <div className="flex items-center gap-2 justify-end mt-4 pt-4 border-t border-slate-100">
            {saved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ للفرع النشط</span>}
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات الفرع'}</button>
          </div>
        </>
      )}
    </div>
  );
}

const ADVANCED_UNAVAILABLE: { title: string; reason: string }[] = [
  { title: 'البريد والرسائل (Email / SMS / واتساب)', reason: 'يحتاج مزود خارجي وفاتورة شهرية — يبقى ضمن P7 عند اختيار مزود' },
  { title: 'المظهر/الخط/اللغة لكل جهاز (Style)', reason: 'واجهة ويب بحجم واحد — العربي افتراضيًا؛ لا توجد مقاربة تنفيذ للاستعداد' },
  { title: 'إعدادات اتصال قاعدة البيانات من الجهاز', reason: 'الاتصال عبر بيئة الـ API و`DATABASE_URL` — ليست واجهة مستخدم عميل لأسباب أمنية' },
  { title: 'ميزان الباركود وشاشة عرض العميل والمودم', reason: 'أجهزة COM/تسلسلي — خارج قدرات الويب؛ تحتاج وكيل/جسر أجهزة محلي' },
  { title: 'تصنيع الأصناف المجمعة تلقائيًا', reason: 'وحدة BOM/تصنيع لم تُطلب سوقيًا بعد' },
  { title: 'مستخلصات المقاولات (Contractor)', reason: 'وحدة متخصصة (P8) — لا تُبنى إلا بطلب سوقي واضح' },
  { title: 'إظهار/إخفاء الوحدات بكود دعم (ExtraModule)', reason: 'مُستبدلة بأدوار RBAC وتقييد المخازن/الصناديق للمستخدمين (P7)' },
  { title: 'النسخ الاحتياطي من جهاز الكاشير', reason: 'يُنفذ على مستوى السيرفر/PostgreSQL (أدوات `tools/pg` والنسخ الاحتياطي الخارجي ضمن P7)' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<'branches' | 'users' | 'roles' | 'settings' | 'advanced' | 'audit' | 'zatca' | 'eta' | 'backup'>('branches');
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
  const [settingsSaved, setSettingsSaved] = useState(false);

  // P7 — تقييد قوائم المستخدم (مخازن + صناديق)
  const [restrictionUser, setRestrictionUser] = useState<any>(null);
  const [restrictionOptions, setRestrictionOptions] = useState<{ warehouses: any[]; cashAccounts: any[] }>({ warehouses: [], cashAccounts: [] });
  const [restrictionForm, setRestrictionForm] = useState<{ warehouseIds: number[]; cashAccountIds: number[] }>({ warehouseIds: [], cashAccountIds: [] });
  const [restrictionBusy, setRestrictionBusy] = useState(false);
  const [restrictionNote, setRestrictionNote] = useState('');

  // P7 — نسخ احتياطي / استعادة
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNote, setBackupNote] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

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

  async function downloadBackup() {
    setBackupBusy(true);
    setBackupNote('');
    try {
      const data = await apiFetch('/admin/backup');
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      anchor.href = url;
      anchor.download = `wasel-backup-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBackupNote('تم تنزيل النسخة الاحتياطية بنجاح');
    } catch (err: any) {
      setBackupNote(err?.message ?? 'تعذر إنشاء النسخة');
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackupBusy(true);
    setBackupNote('');
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const confirmed = window.confirm(
        'سيتم استبدال كل بيانات قاعدة البيانات بالنسخة المرفوعة — هذا الإجراء لا يمكن التراجع عنه. هل أنت متأكد؟',
      );
      if (!confirmed) return;
      const result = await apiFetch<any>('/admin/backup/restore', { method: 'POST', body: payload });
      setBackupNote(`تمت الاستعادة بنجاح (${result?.tables ?? '—'} جدول)`);
    } catch (err: any) {
      setBackupNote(err?.message ?? 'تعذر الاستعادة — تأكد أن الملف نسخة احتياطية صالحة');
    } finally {
      setBackupBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  }

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
    setError('');
    try {
      await apiFetch('/admin/settings', { method: 'PUT', body: settings });
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ الإعدادات');
    }
  }

  const grouped = permissions.reduce<Record<string, any[]>>((acc, permission) => {
    (acc[permission.module] ??= []).push(permission);
    return acc;
  }, {});

  return (
    <AppShell title="الإعدادات">
      <div className="flex gap-2 mb-4 flex-wrap">
        {([['branches', 'الفروع'], ['users', 'المستخدمون'], ['roles', 'الأدوار والصلاحيات'], ['settings', 'إعدادات النظام'], ['advanced', 'الإعدادات المتقدمة'], ['eta', 'الفاتورة الإلكترونية (مصر)'], ['zatca', 'الضريبة الإلكترونية (السعودية)'], ['backup', 'النسخ الاحتياطي'], ['audit', 'سجل العمليات']] as const).map(([key, label]) => (
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
        <div className="space-y-4 max-w-4xl">
          <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-extrabold text-slate-800">إعدادات النظام</div>
              <div className="text-xs text-slate-500">إعدادات عامة تسري على النظام كله (وليست لكل جهاز أو فرع). عدّل بعناية ثم اضغط حفظ.</div>
            </div>
            <div className="flex items-center gap-2">
              {settingsSaved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ بنجاح</span>}
              <button className="btn-primary" onClick={saveSettings}>حفظ الإعدادات</button>
            </div>
          </div>

          {SETTING_SECTIONS.map((section) => (
            <div key={section.id} className="card p-5">
              <div className="font-bold text-slate-800">{section.title}</div>
              <div className="text-xs text-slate-500 mb-3 mt-0.5">{section.desc}</div>
              <div className="grid sm:grid-cols-2 gap-4">
                {section.fields.map((field) => (
                  <SettingFieldRow
                    key={field.key}
                    field={field}
                    value={settings[field.key]}
                    onChange={(next) => setSettings({ ...settings, [field.key]: next })}
                  />
                ))}
              </div>
            </div>
          ))}

          {Object.keys(settings).filter((k) => !KNOWN_SETTING_KEYS.has(k)).length > 0 && (
            <div className="card p-5">
              <div className="font-bold text-amber-800">مفاتيح أخرى (غير معروفة)</div>
              <div className="text-xs text-amber-700 mt-1 mb-3">هذه القيم تُحفظ كما هي — غير موثقة أو موروثة من إصدار قديم.</div>
              <div className="space-y-3">
                {Object.keys(settings).filter((k) => !KNOWN_SETTING_KEYS.has(k)).map((key) => (
                  <div key={key}>
                    <label className="label font-mono">{key}</label>
                    <input className="input" value={settings[key] ?? ''} onChange={(e) => setSettings({ ...settings, [key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <button className="btn-primary mt-4" onClick={saveSettings}>حفظ الإعدادات</button>
            </div>
          )}
        </div>
      )}

      {tab === 'advanced' && (
        <div className="space-y-4 max-w-5xl">
          <div className="card p-4">
            <div className="font-extrabold text-slate-800">الإعدادات المتقدمة</div>
            <div className="text-xs text-slate-500 mt-1">
              القابلة للتطبيق في WaselERP (ويب + PostgreSQL + وكيل طباعة) — مقسمة حسب «على الجهاز» / «للفرع النشط»، مثل تبويبات «اعدادات الطابعه» و«POS» و«اعدادات السيرفر» في دليل Ezees.
              البنود غير المدعومة موضحة بالأسباب في أسفل الصفحة بدل حقول وهمية.
            </div>
          </div>

          <PrintAgentPanel />
          <BranchServiceChargeCard />

          <div className="card p-5">
            <div className="font-bold text-slate-800 mb-1">غير مدعوم في هذا الإصدار (مع الأسباب)</div>
            <div className="text-xs text-slate-500 mb-3">هذه البنود من دليل Ezees («الإعدادات المتقدمة») وتُترك حتى يُطلب سوقيًا، أو لأن المعمارية تختلف (سطح مكتب + SQL Server).</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {ADVANCED_UNAVAILABLE.map((item) => (
                <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="text-[13px] font-bold text-slate-700">{item.title}</div>
                  <div className="text-[11px] text-slate-500 mt-1 leading-5">{item.reason}</div>
                </div>
              ))}
            </div>
          </div>
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

      {tab === 'backup' && (
        <div className="max-w-3xl space-y-4">
          <div className="card p-5 border-amber-300 bg-amber-50">
            <div className="font-extrabold text-amber-900 inline-flex items-center gap-2">
              <span aria-hidden="true">⚠</span> قبل أي عملية استعادة
            </div>
            <p className="text-xs text-amber-900 mt-2 leading-6">
              الاستعادة تستبدل كل جداول قاعدة البيانات بالكامل (مسح كامل ثم إعادة إدخال من الملف).
              نزّل نسخة جديدة قبل الاستعادة، وتأكد أن الجهاز الهدف هو نفسه بيئة الإنتاج. تُسجَّل العملية في سجل العمليات.
            </p>
          </div>

          <div className="card p-6 space-y-3">
            <div className="font-bold text-slate-800">تنزيل نسخة احتياطية كاملة</div>
            <div className="text-xs text-slate-500 leading-6">
              ملف JSON واحد يحتوي كل الجداول (المبيعات، المخزون، الخزينة، القيود المحاسبية…). مناسب للأرشفة قبل أي تحديث كبير.
            </div>
            <button className="btn-primary" onClick={downloadBackup} disabled={backupBusy}>
              {backupBusy ? 'جارٍ إنشاء النسخة…' : 'تنزيل النسخة الآن'}
            </button>
          </div>

          <div className="card p-6 space-y-3">
            <div className="font-bold text-rose-700">استعادة من نسخة احتياطية</div>
            <div className="text-xs text-slate-500 leading-6">
              اختر ملف JSON تم تنزيله من هذا الزر نفسه. بعد التأكيد ستُستبدل كل البيانات الحالية.
            </div>
            <label className={`btn-danger inline-flex ${backupBusy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
              {backupBusy ? 'جارٍ التنفيذ…' : 'اختيار ملف النسخة للاستعادة…'}
              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={restoreBackup}
                disabled={backupBusy}
              />
            </label>
            {backupNote && <div className="text-xs font-semibold text-slate-600">{backupNote}</div>}
          </div>
        </div>
      )}

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
