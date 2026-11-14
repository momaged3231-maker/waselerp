'use client';

import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Ticket = any;
type Tab = 'new' | 'followup' | 'inspect' | 'deliver' | 'reports' | 'setup';

const INSPECTION_LABEL: Record<number, string> = {
  0: 'انتظار الفحص',
  1: 'قيد الفحص',
  2: 'تم الرفض',
  3: 'تم الاصلاح',
  4: 'ارتجاع',
};
const INSPECTION_BADGE: Record<number, string> = {
  0: 'bg-amber-50 text-amber-700',
  1: 'bg-blue-50 text-blue-700',
  2: 'bg-rose-50 text-rose-700',
  3: 'bg-emerald-50 text-emerald-700',
  4: 'bg-slate-100 text-slate-600',
};

const emptyForm = () => ({
  cashAccountId: '' as string | number,
  customerName: '', phone: '', phone2: '', productId: '', modelId: '', serialNo: '', itemColor: '',
  battery: false, charger: false, otherAccessory: '', productCondition: '', customerNotes: '',
  maxCharge: '', expectedDelivery: '', estimatedCost: '', paidAmount: '',
});

export default function MaintenancePage() {
  const { session, can } = useSession();
  const canManage = can('maintenance.manage');
  const [tab, setTab] = useState<Tab>('new');

  const [products, setProducts] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [faultCategories, setFaultCategories] = useState<any[]>([]);
  const [faultSubcategories, setFaultSubcategories] = useState<any[]>([]);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [engineers, setEngineers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState(emptyForm());
  const [editingTicket, setEditingTicket] = useState<number | null>(null);

  const [items, setItems] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [filters, setFilters] = useState({ from: '', to: '', search: '', inspectionStatus: '', all: false });
  const [selected, setSelected] = useState<Ticket | null>(null);

  const [inspectForm, setInspectForm] = useState<any>({
    engineerId: '', inspectionStatus: 1, checkReport: '', actualCost: '', expectedDelivery: '', parts: [],
  });
  const [partSearch, setPartSearch] = useState('');
  const [partResults, setPartResults] = useState<any[]>([]);

  const [deliverForm, setDeliverForm] = useState<any>({ paidAmount: '', delivered: true, cashAccountId: '' });

  const [report, setReport] = useState<any>(null);
  const [reportFilters, setReportFilters] = useState({ from: '', to: '', paymentStatus: '', deliveryStatus: '', inspectionStatus: '', customer: '' });

  const [newProduct, setNewProduct] = useState('');
  const [newModel, setNewModel] = useState({ productId: '', name: '' });
  const [newCategory, setNewCategory] = useState('');
  const [newSubcategory, setNewSubcategory] = useState({ categoryId: '', name: '' });
  const [faultPick, setFaultPick] = useState({ categoryId: '', subcategoryId: '' });

  async function loadReference() {
    const [products, models, categories, subcategories, engineers, accounts] = await Promise.all([
      apiFetch<any[]>('/maintenance/products').catch(() => []),
      apiFetch<any[]>('/maintenance/models').catch(() => []),
      apiFetch<any[]>('/maintenance/fault-categories').catch(() => []),
      apiFetch<any[]>('/maintenance/fault-subcategories').catch(() => []),
      apiFetch<any[]>('/maintenance/engineers').catch(() => []),
      apiFetch<any[]>('/treasury/accounts').catch(() => []),
    ]);
    setProducts(products);
    setModels(models);
    setFaultCategories(categories);
    setFaultSubcategories(subcategories);
    setEngineers(engineers);
    setCashAccounts(accounts);
  }

  useEffect(() => { loadReference(); }, []);

  const productModels = useMemo(
    () => models.filter((m) => String(m.productId) === String(form.productId)),
    [models, form.productId],
  );

  const subcategoriesFor = useMemo(
    () => faultSubcategories.filter((s) => String(s.categoryId) === String(faultPick.categoryId)),
    [faultSubcategories, faultPick.categoryId],
  );

  async function loadList() {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.inspectionStatus !== '') params.set('inspectionStatus', filters.inspectionStatus);
    if (filters.all) params.set('all', '1');
    try {
      const data = await apiFetch<any>(`/maintenance/tickets?${params}`);
      setItems(data.items ?? []);
      setTotals(data.totals ?? null);
    } catch {
      setItems([]);
      setTotals(null);
    }
  }

  async function loadReport() {
    const params = new URLSearchParams();
    if (reportFilters.from) params.set('from', reportFilters.from);
    if (reportFilters.to) params.set('to', reportFilters.to);
    if (reportFilters.paymentStatus !== '') params.set('paymentStatus', reportFilters.paymentStatus);
    if (reportFilters.deliveryStatus !== '') params.set('deliveryStatus', reportFilters.deliveryStatus);
    if (reportFilters.inspectionStatus !== '') params.set('inspectionStatus', reportFilters.inspectionStatus);
    if (reportFilters.customer.trim()) params.set('customer', reportFilters.customer.trim());
    try {
      setReport(await apiFetch<any>(`/maintenance/reports/services?${params}`));
    } catch {
      setReport(null);
    }
  }

  useEffect(() => { if (tab === 'followup') loadList(); }, [tab]);
  useEffect(() => { if (tab === 'reports') loadReport(); }, [tab]);

  useEffect(() => {
    if (partSearch.trim().length < 2) {
      setPartResults([]);
      return;
    }
    const timer = setTimeout(() => {
      apiFetch<any>(`/items?search=${encodeURIComponent(partSearch.trim())}&pageSize=10`)
        .then((data) => setPartResults(data.items ?? []))
        .catch(() => setPartResults([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [partSearch]);

  const formAccessories = () => ({
    battery: !!form.battery,
    charger: !!form.charger,
    other: form.otherAccessory.trim() || undefined,
  });

  const formPayload = () => ({
    customerName: form.customerName,
    phone: form.phone,
    phone2: form.phone2 || undefined,
    productId: Number(form.productId),
    modelId: Number(form.modelId),
    serialNo: form.serialNo || undefined,
    itemColor: form.itemColor || undefined,
    accessories: formAccessories(),
    productCondition: form.productCondition,
    customerNotes: form.customerNotes || undefined,
    maxCharge: Number(form.maxCharge || 0),
    expectedDelivery: form.expectedDelivery || undefined,
    estimatedCost: Number(form.estimatedCost || 0),
    paidAmount: Number(form.paidAmount || 0),
    cashAccountId: form.cashAccountId ? Number(form.cashAccountId) : undefined,
  });

  function resetForm() {
    setForm(emptyForm());
    setEditingTicket(null);
    setFaultPick({ categoryId: '', subcategoryId: '' });
  }

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      const payload = formPayload();
      if (editingTicket) {
        await apiFetch(`/maintenance/tickets/${editingTicket}`, { method: 'PUT', body: payload });
        setMessage('تم تعديل الإذن');
        resetForm();
        await loadList();
        setTab('followup');
      } else {
        const result = await apiFetch<any>('/maintenance/tickets', { method: 'POST', body: payload });
        setMessage(`تم الحفظ — رقم الإذن ${result.ticketNo}`);
        resetForm();
      }
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ الإذن');
    }
  }

  async function openInspect(ticket: Ticket) {
    setSelected(ticket);
    setInspectForm({
      engineerId: ticket.engineerId ?? '',
      inspectionStatus: ticket.inspectionStatus ?? 1,
      checkReport: ticket.checkReport ?? '',
      actualCost: ticket.actualCost ?? '',
      expectedDelivery: ticket.expectedDelivery ? String(ticket.expectedDelivery).slice(0, 10) : '',
      parts: (ticket.parts ?? []).map((p: any) => ({ ...p, key: p.itemId })),
    });
    setTab('inspect');
    setError('');
    setMessage('');
  }

  async function saveInspect() {
    if (!selected) return;
    setError('');
    setMessage('');
    try {
      await apiFetch(`/maintenance/tickets/${selected.ticketId}/inspect`, {
        method: 'POST',
        body: {
          engineerId: Number(inspectForm.engineerId),
          inspectionStatus: Number(inspectForm.inspectionStatus),
          checkReport: inspectForm.checkReport,
          actualCost: inspectForm.actualCost === '' ? undefined : Number(inspectForm.actualCost),
          expectedDelivery: inspectForm.expectedDelivery || undefined,
          parts: inspectForm.parts.map((p: any) => ({ itemId: p.itemId, quantity: Number(p.quantity), unitPrice: Number(p.unitPrice ?? 0) })),
        },
      });
      setMessage('تم حفظ الفحص');
      await loadList();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ الفحص');
    }
  }

  async function openDeliver(ticket: Ticket) {
    setSelected(ticket);
    const remaining = Math.max(0, Number(ticket.actualCost ?? ticket.estimatedCost ?? 0) - Number(ticket.totalPaid ?? 0));
    setDeliverForm({
      paidAmount: ticket.inspectionStatus === 2 ? '0' : String(remaining),
      delivered: true,
      cashAccountId: ticket.branchCashAccountId ? String(ticket.branchCashAccountId) : '',
    });
    setTab('deliver');
    setError('');
    setMessage('');
  }

  async function saveDeliver() {
    if (!selected) return;
    setError('');
    setMessage('');
    try {
      await apiFetch(`/maintenance/tickets/${selected.ticketId}/deliver`, {
        method: 'POST',
        body: {
          paidAmount: Number(deliverForm.paidAmount || 0),
          delivered: !!deliverForm.delivered,
          cashAccountId: deliverForm.cashAccountId ? Number(deliverForm.cashAccountId) : undefined,
        },
      });
      setMessage('تم السداد والتسليم');
      await loadList();
      setTab('followup');
    } catch (err: any) {
      setError(err?.message ?? 'تعذر السداد والتسليم');
    }
  }

  async function removeTicket(ticket: Ticket) {
    if (!window.confirm(`حذف الإذن ${ticket.ticketNo}؟`)) return;
    try {
      await apiFetch(`/maintenance/tickets/${ticket.ticketId}`, { method: 'DELETE' });
      setMessage('تم حذف الإذن');
      await loadList();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر الحذف');
    }
  }

  function startEdit(ticket: Ticket) {
    setForm({
      cashAccountId: ticket.branchCashAccountId ? String(ticket.branchCashAccountId) : '',
      customerName: ticket.customerName,
      phone: ticket.phone,
      phone2: ticket.phone2 ?? '',
      productId: String(ticket.productId),
      modelId: String(ticket.modelId),
      serialNo: ticket.serialNo ?? '',
      itemColor: ticket.itemColor ?? '',
      battery: !!ticket.accessories?.battery,
      charger: !!ticket.accessories?.charger,
      otherAccessory: ticket.accessories?.other ?? '',
      productCondition: ticket.productCondition,
      customerNotes: ticket.customerNotes ?? '',
      maxCharge: String(ticket.maxCharge ?? ''),
      expectedDelivery: ticket.expectedDelivery ? String(ticket.expectedDelivery).slice(0, 10) : '',
      estimatedCost: String(ticket.estimatedCost ?? ''),
      paidAmount: String(ticket.advanceAmount ?? 0),
    });
    setEditingTicket(ticket.ticketId);
    setTab('new');
  }

  const remaining = Math.max(0, Number(form.estimatedCost || 0) - Number(form.paidAmount || 0));

  const tabButton = (key: Tab, label: string) => (
    <button key={key} onClick={() => setTab(key)} className={tab === key ? 'btn-primary' : 'btn-soft'}>{label}</button>
  );

  const addFaultNote = () => {
    const fault = faultSubcategories.find((s) => String(s.subcategoryId) === String(faultPick.subcategoryId));
    if (!fault) return;
    setForm((f) => ({ ...f, customerNotes: (f.customerNotes ? f.customerNotes + '، ' : '') + fault.name }));
  };
  return (
    <AppShell title="مراكز الصيانة">
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabButton('new', editingTicket ? 'تعديل الإذن' : 'جديد')}
        {tabButton('followup', 'متابعة')}
        {tabButton('inspect', 'الفحص')}
        {tabButton('deliver', 'تسليم وسداد')}
        {tabButton('reports', 'تقارير الخدمات')}
        {tabButton('setup', 'تعريفات')}
      </div>

      {error && <div className="mb-3 rounded-xl bg-rose-50 text-rose-700 text-sm px-4 py-3 border border-rose-200">{error}</div>}
      {message && <div className="mb-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm px-4 py-3 border border-emerald-200">{message}</div>}

      {tab === 'new' && (
        <form onSubmit={submitIntake} className="grid lg:grid-cols-3 gap-4">
          <div className="card p-5 space-y-3 lg:col-span-2">
            <div className="font-bold text-slate-800">{editingTicket ? 'تعديل بيانات الإذن' : 'إذن صيانة جديد'}</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">اسم العميل *</label>
                <input className="input" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
              </div>
              <div>
                <label className="label">الهاتف * (10 أرقام على الأقل)</label>
                <input className="input" dir="ltr" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">هاتف آخر</label>
                <input className="input" dir="ltr" value={form.phone2} onChange={(e) => setForm({ ...form, phone2: e.target.value })} />
              </div>
              <div>
                <label className="label">المنتج *</label>
                <select className="input" required value={form.productId}
                  onChange={(e) => setForm({ ...form, productId: e.target.value, modelId: '' })}>
                  <option value="">— اختر —</option>
                  {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الموديل *</label>
                <select className="input" required value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
                  <option value="">— اختر —</option>
                  {productModels.map((m) => <option key={m.modelId} value={m.modelId}>{m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">الرقم المسلسل</label>
                <input className="input" dir="ltr" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} />
              </div>
              <div>
                <label className="label">اللون</label>
                <input className="input" value={form.itemColor} onChange={(e) => setForm({ ...form, itemColor: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">الملحقات المستلمة</label>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.battery} onChange={(e) => setForm({ ...form, battery: e.target.checked })} />بطارية</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={form.charger} onChange={(e) => setForm({ ...form, charger: e.target.checked })} />شاحن</label>
                <label className="flex items-center gap-2"><input type="text" className="input w-48" placeholder="أخرى" value={form.otherAccessory} onChange={(e) => setForm({ ...form, otherAccessory: e.target.value })} /></label>
              </div>
            </div>

            <div>
              <label className="label">وصف الجهاز (الحالة الظاهرة عند الاستلام) *</label>
              <textarea className="input h-20" required value={form.productCondition} onChange={(e) => setForm({ ...form, productCondition: e.target.value })} placeholder="خدوش، كسر، ..." />
            </div>

            <div>
              <label className="label">ملاحظات العميل</label>
              <textarea className="input h-16" value={form.customerNotes} onChange={(e) => setForm({ ...form, customerNotes: e.target.value })} />
              <div className="flex gap-2 mt-2">
                <select className="input" value={faultPick.categoryId} onChange={(e) => setFaultPick({ categoryId: e.target.value, subcategoryId: '' })}>
                  <option value="">— تصنيف رئيسي —</option>
                  {faultCategories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
                </select>
                <select className="input" value={faultPick.subcategoryId} onChange={(e) => setFaultPick({ ...faultPick, subcategoryId: e.target.value })}>
                  <option value="">— عطل تفصيلي —</option>
                  {subcategoriesFor.map((s) => <option key={s.subcategoryId} value={s.subcategoryId}>{s.name}</option>)}
                </select>
                <button type="button" className="btn-soft text-xs" onClick={addFaultNote} disabled={!faultPick.subcategoryId}>إضافة</button>
              </div>
            </div>
          </div>

          <div className="card p-5 space-y-3 h-fit">
            <div className="font-bold text-slate-800">التكلفة والسداد</div>
            <div>
              <label className="label">أقصى تكلفة وافق عليها العميل</label>
              <input className="input" type="number" step="0.01" dir="ltr" value={form.maxCharge} onChange={(e) => setForm({ ...form, maxCharge: e.target.value })} />
            </div>
            <div>
              <label className="label">تاريخ التسليم المتوقع</label>
              <input className="input" type="date" value={form.expectedDelivery} onChange={(e) => setForm({ ...form, expectedDelivery: e.target.value })} />
            </div>
            <div>
              <label className="label">التكلفة المتوقعة</label>
              <input className="input" type="number" step="0.01" dir="ltr" value={form.estimatedCost} onChange={(e) => setForm({ ...form, estimatedCost: e.target.value })} />
            </div>
            <div>
              <label className="label">الخزينة (يُقيَّد المقدم فيها)</label>
              <select className="input" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })}>
                <option value="">— اختر —</option>
                {cashAccounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">المقدم</label>
              <input className="input" type="number" step="0.01" dir="ltr" value={form.paidAmount} onChange={(e) => setForm({ ...form, paidAmount: e.target.value })} />
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-sm flex justify-between">
              <span className="text-slate-500">المتبقي</span>
              <span className="font-extrabold text-brand-700">{formatMoney(remaining)}</span>
            </div>
            <button type="submit" className="btn-primary w-full">{editingTicket ? 'حفظ التعديلات' : 'حفظ الإذن'}</button>
            {editingTicket && (
              <button type="button" className="btn-soft w-full" onClick={resetForm}>إلغاء التعديل</button>
            )}
          </div>
        </form>
      )}
      {tab === 'followup' && (
        <div className="space-y-3">
          <div className="card p-4 flex flex-wrap items-end gap-2">
            <div>
              <label className="label">من</label>
              <input className="input" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </div>
            <div>
              <label className="label">إلى</label>
              <input className="input" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </div>
            <div>
              <label className="label">حالة الفحص</label>
              <select className="input" value={filters.inspectionStatus} onChange={(e) => setFilters({ ...filters, inspectionStatus: e.target.value })}>
                <option value="">الكل</option>
                <option value="0">انتظار الفحص</option>
                <option value="1">قيد الفحص</option>
                <option value="2">تم الرفض</option>
                <option value="3">تم الاصلاح</option>
                <option value="4">ارتجاع</option>
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="label">بحث (رقم / اسم / هاتف)</label>
              <input className="input" dir="auto" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} placeholder="اكتب للبحث" />
            </div>
            <button className="btn-primary" onClick={loadList}>عرض</button>
            <label className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-brand-600" checked={filters.all} onChange={(e) => setFilters({ ...filters, all: e.target.checked })} />
              كل الفروع (للاطلاع فقط)
            </label>
          </div>

          {filters.all && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-2">
              وضع متابعة فروع — تظهر أذون كل الفروع للاطلاع فقط. للتعديل والفحص والتسليم اختر فرعك من الأعلى.
            </div>
          )}

          <div className="card">
            <div className="card-title"><span>الأذون</span>
              {totals && (
                <span className="text-xs font-normal text-slate-500">
                  الإجمالي {formatMoney(totals.totalValue)} · مدفوع {formatMoney(totals.totalPaid)} · متبقي {formatMoney(totals.totalRemaining)} · خامات {formatMoney(totals.partsCost)}
                </span>
              )}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الرقم</th><th>العميل</th><th>الموديل</th><th>الاستلام</th><th>قيمة</th><th>مدفوع</th><th>متبقي</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {items.map((t) => (
                    <tr key={t.ticketId}>
                      <td className="font-mono text-xs">{t.ticketNo}</td>
                      <td className="font-semibold">{t.customerName}<div className="text-[11px] text-slate-400" dir="ltr">{t.phone}</div></td>
                      <td>{t.productName} {t.modelName}</td>
                      <td className="text-xs">{new Date(t.receivedAt).toLocaleDateString('ar-EG')}</td>
                      <td>{formatMoney(t.actualCost ?? t.estimatedCost)}</td>
                      <td>{formatMoney(t.totalPaid)}</td>
                      <td className="font-bold">{formatMoney(Math.max(0, Number(t.actualCost ?? t.estimatedCost ?? 0) - Number(t.totalPaid ?? 0)))}</td>
                      <td>
                        <span className={`badge ${INSPECTION_BADGE[t.inspectionStatus] ?? 'bg-slate-100'}`}>{INSPECTION_LABEL[t.inspectionStatus]}</span>
                        {Number(t.deliveryStatus) === 1 && <span className="badge bg-emerald-50 text-emerald-700 mr-1">مسلّم</span>}
                      </td>
                      <td>
                        {!filters.all && (
                          <div className="flex gap-1">
                            <button className="btn-soft text-[11px] py-1" onClick={() => openInspect(t)}>فحص</button>
                            <button className="btn-soft text-[11px] py-1" onClick={() => openDeliver(t)}>تسليم</button>
                            <button className="btn-soft text-[11px] py-1" onClick={() => startEdit(t)}>تعديل</button>
                            <button className="text-rose-500 text-[11px] py-1" onClick={() => removeTicket(t)}>حذف</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-slate-400 py-8">لا توجد أذون مطابقة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'inspect' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card p-5 space-y-3 lg:col-span-2">
            <div className="font-bold text-slate-800">فحص الإذن {selected?.ticketNo}</div>
            {!selected && <div className="text-sm text-slate-400 py-8 text-center">اختر إذنًا من تبويب «متابعة» أولًا</div>}
            {selected && (
              <>
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 grid sm:grid-cols-2 gap-1">
                  <div>العميل: <b>{selected.customerName}</b> — {selected.phone}</div>
                  <div>الجهاز: {selected.productName} {selected.modelName} {selected.serialNo ? `· ${selected.serialNo}` : ''}</div>
                  <div className="sm:col-span-2">الشكوى: {selected.customerNotes || '—'}</div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">المهندس المسئول *</label>
                    <select className="input" value={inspectForm.engineerId} onChange={(e) => setInspectForm({ ...inspectForm, engineerId: e.target.value })}>
                      <option value="">— اختر —</option>
                      {engineers.map((en) => <option key={en.userId} value={en.userId}>{en.fullName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">حالة الفحص</label>
                    <select className="input" value={inspectForm.inspectionStatus} onChange={(e) => setInspectForm({ ...inspectForm, inspectionStatus: Number(e.target.value) })}>
                      <option value={0}>لم يتم الفحص</option>
                      <option value={1}>قيد الفحص</option>
                      <option value={2}>تم الرفض</option>
                      <option value={3}>تم الاصلاح</option>
                      <option value={4}>ارتجاع</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">التكلفة الفعلية</label>
                    <input className="input" type="number" step="0.01" dir="ltr" value={inspectForm.actualCost} onChange={(e) => setInspectForm({ ...inspectForm, actualCost: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">تاريخ التسليم</label>
                    <input className="input" type="date" value={inspectForm.expectedDelivery} onChange={(e) => setInspectForm({ ...inspectForm, expectedDelivery: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="label">تقرير الفحص</label>
                  <textarea className="input h-20" value={inspectForm.checkReport} onChange={(e) => setInspectForm({ ...inspectForm, checkReport: e.target.value })} placeholder="ما وُجد في الجهاز وما تم عمله" />
                </div>
              </>
            )}
          </div>

          <div className="card p-5 space-y-3 h-fit">
            <div className="font-bold text-slate-800">قطع الغيار</div>
            <div className="relative">
              <input className="input" placeholder="ابحث بالاسم / الكود / الباركود" value={partSearch} onChange={(e) => setPartSearch(e.target.value)} />
              {partResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full card max-h-48 overflow-y-auto">
                  {partResults.map((item) => (
                    <button key={item.itemId} className="w-full text-right px-3 py-2 text-sm hover:bg-slate-50 flex justify-between gap-2"
                      onClick={() => {
                        setInspectForm((f: any) => ({
                          ...f,
                          parts: [...f.parts.filter((p: any) => p.itemId !== item.itemId),
                                  { itemId: item.itemId, itemCode: item.code, itemName: item.name, quantity: 1, unitPrice: Number(item.sellPrice ?? 0), unitCost: Number(item.costPrice ?? 0), key: item.itemId }],
                        }));
                        setPartSearch('');
                        setPartResults([]);
                      }}>
                      <span className="truncate">{item.name}</span>
                      <span className="text-xs text-slate-400 shrink-0">{item.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {inspectForm.parts.map((p: any, i: number) => (
                <div key={p.itemId} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate">{p.itemName}</div>
                    <div className="text-[10px] text-slate-400">{p.itemCode} · {formatMoney(p.unitPrice)}</div>
                  </div>
                  <input className="input w-16 px-2 py-1 text-center text-xs" type="number" step="0.001" value={p.quantity}
                    onChange={(e) => setInspectForm((f: any) => ({ ...f, parts: f.parts.map((pp: any, j: number) => j === i ? { ...pp, quantity: Number(e.target.value) } : pp) }))} />
                  <button className="w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50" onClick={() => setInspectForm((f: any) => ({ ...f, parts: f.parts.filter((_: any, j: number) => j !== i) }))} aria-label="حذف">×</button>
                </div>
              ))}
              {inspectForm.parts.length === 0 && <div className="text-xs text-slate-400 text-center py-4">لا توجد قطع — امسح الباركود أو ابحث</div>}
            </div>
            <div className="flex justify-between text-xs border-t border-slate-100 pt-2">
              <span className="text-slate-500">إجمالي الكمية</span>
              <b>{inspectForm.parts.reduce((s: number, p: any) => s + Number(p.quantity || 0), 0)}</b>
            </div>
            <button className="btn-primary w-full" onClick={saveInspect} disabled={!selected}>حفظ الفحص</button>
          </div>
        </div>
      )}

      {tab === 'deliver' && (
        <div className="grid lg:grid-cols-2 gap-4 max-w-4xl">
          <div className="card p-5 space-y-3">
            <div className="font-bold text-slate-800">تسليم الإذن {selected?.ticketNo}</div>
            {!selected && <div className="text-sm text-slate-400 py-8 text-center">اختر إذنًا من تبويب «متابعة» أولًا</div>}
            {selected && (
              <>
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 grid grid-cols-2 gap-2">
                  <div>العميل: <b>{selected.customerName}</b></div>
                  <div>الجهاز: {selected.productName} {selected.modelName}</div>
                  <div>تكلفة: <b>{formatMoney(selected.actualCost ?? selected.estimatedCost)}</b></div>
                  <div>مقدم/مدفوع: <b>{formatMoney(selected.totalPaid)}</b></div>
                  <div className="col-span-2">الحالة: {INSPECTION_LABEL[selected.inspectionStatus]}</div>
                </div>
                <div>
                  <label className="label">المبلغ المدفوع الآن</label>
                  <input className="input text-lg font-bold" type="number" step="0.01" dir="ltr" value={deliverForm.paidAmount}
                    onChange={(e) => setDeliverForm({ ...deliverForm, paidAmount: e.target.value })} />
                  <div className="text-[11px] text-slate-500 mt-1">المتبقي للفاتورة {formatMoney(Math.max(0, Number(selected.actualCost ?? selected.estimatedCost ?? 0) - Number(selected.totalPaid ?? 0)))}</div>
                </div>
                <div>
                  <label className="label">الخزينة</label>
                  <select className="input" value={deliverForm.cashAccountId} onChange={(e) => setDeliverForm({ ...deliverForm, cashAccountId: e.target.value })}>
                    <option value="">— اختر (الافتراضي خزينة الإذن) —</option>
                    {cashAccounts.map((a) => <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>)}
                  </select>
                </div>
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4 cursor-pointer">
                  <span className="text-sm font-bold text-slate-700">استلم العميل الجهاز (تم التسليم)</span>
                  <input type="checkbox" className="w-5 h-5 accent-brand-600" checked={deliverForm.delivered}
                    onChange={() => setDeliverForm({ ...deliverForm, delivered: !deliverForm.delivered })} />
                </label>
                <button className="btn-success w-full py-3" onClick={saveDeliver}>سداد وتسليم</button>
              </>
            )}
          </div>
          <div className="card p-5 text-xs text-slate-500 leading-6">
            <div className="font-bold text-slate-700 mb-2">ملاحظات</div>
            <ul className="list-disc pr-4 space-y-1">
              <li>عند الحفظ يُقيَّد المبلغ تلقائيًا في الخزينة (Dr خزينة / Cr إيرادات أخرى).</li>
              <li>مقدم الاستلام يُرتب أيضًا على نفس القيد — تعديل الإذن يستبدل قيد المقدم بالقيمة الجديدة.</li>
              <li>قطع الغيار تُخصم من المخزن الافتراضي للفرع عند حفظ الفحص.</li>
              <li>عميل الصيانة لا يُسجَّل في شاشة العملاء.</li>
              <li>الإذن المسلَّم مقفل أمام التعديل إلا لمدير النظام.</li>
            </ul>
          </div>
        </div>
      )}
      {tab === 'reports' && (
        <div className="space-y-3">
          <div className="card p-4 flex flex-wrap items-end gap-2">
            <div><label className="label">من</label><input className="input" type="date" value={reportFilters.from} onChange={(e) => setReportFilters({ ...reportFilters, from: e.target.value })} /></div>
            <div><label className="label">إلى</label><input className="input" type="date" value={reportFilters.to} onChange={(e) => setReportFilters({ ...reportFilters, to: e.target.value })} /></div>
            <div><label className="label">السداد</label>
              <select className="input" value={reportFilters.paymentStatus} onChange={(e) => setReportFilters({ ...reportFilters, paymentStatus: e.target.value })}>
                <option value="">الكل</option><option value="1">مسدد</option><option value="0">غير مسدد</option>
              </select>
            </div>
            <div><label className="label">التسليم</label>
              <select className="input" value={reportFilters.deliveryStatus} onChange={(e) => setReportFilters({ ...reportFilters, deliveryStatus: e.target.value })}>
                <option value="">الكل</option><option value="1">تم التسليم</option><option value="0">لم يتم التسليم</option>
              </select>
            </div>
            <div className="flex-1 min-w-40"><label className="label">اسم العميل</label>
              <input className="input" value={reportFilters.customer} onChange={(e) => setReportFilters({ ...reportFilters, customer: e.target.value })} placeholder="تصفية بالاسم" />
            </div>
            <button className="btn-primary" onClick={loadReport}>عرض</button>
          </div>

          {report && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'إجمالي القيمة', value: formatMoney(report.totals.total) },
                  { label: 'المدفوع', value: formatMoney(report.totals.paid) },
                  { label: 'المتبقي', value: formatMoney(report.totals.remaining) },
                  { label: 'الربح', value: formatMoney(report.totals.profit) },
                ].map((card) => (
                  <div key={card.label} className="card p-4">
                    <div className="text-[11px] text-slate-500">{card.label}</div>
                    <div className="text-lg font-extrabold text-slate-800 mt-1">{card.value}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title"><span>تقرير الخدمات ({report.items.length})</span></div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>الرقم</th><th>العميل</th><th>المهندس</th><th>القيمة</th><th>مدفوع</th><th>المتبقي</th><th>خامات</th><th>الحالة</th></tr></thead>
                    <tbody>
                      {report.items.map((t: any) => (
                        <tr key={t.ticketId}>
                          <td className="font-mono text-xs">{t.ticketNo}</td>
                          <td>{t.customerName}</td>
                          <td>{t.engineerName ?? '—'}</td>
                          <td>{formatMoney(t.actualCost ?? t.estimatedCost)}</td>
                          <td>{formatMoney(t.totalPaid)}</td>
                          <td>{formatMoney(Math.max(0, Number(t.actualCost ?? t.estimatedCost ?? 0) - Number(t.totalPaid ?? 0)))}</td>
                          <td>{formatMoney(t.partsCost)}</td>
                          <td>{INSPECTION_LABEL[t.inspectionStatus]}</td>
                        </tr>
                      ))}
                      {report.items.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">لا توجد نتائج</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'setup' && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card p-5 space-y-3">
            <div className="font-bold text-slate-800">المنتجات (أنواع الأجهزة)</div>
            <div className="flex gap-2">
              <input className="input" placeholder="مثال: موبايل" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} />
              <button className="btn-primary" onClick={async () => {
                if (!newProduct.trim()) return;
                try { await apiFetch('/maintenance/products', { method: 'POST', body: { name: newProduct.trim() } }); setNewProduct(''); await loadReference(); } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
              }}>إضافة</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {products.map((p) => (
                <div key={p.productId} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-slate-200 px-3 py-1.5">
                  <span>{p.name} <span className="text-xs text-slate-400">({p.modelCount ?? 0} موديل)</span></span>
                  <button className="text-rose-500 text-xs" onClick={async () => { try { await apiFetch(`/maintenance/products/${p.productId}`, { method: 'DELETE' }); await loadReference(); } catch (err: any) { setError(err?.message); } }}>حذف</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="font-bold text-slate-800">الموديلات</div>
            <div className="flex gap-2">
              <select className="input" value={newModel.productId} onChange={(e) => setNewModel({ ...newModel, productId: e.target.value })}>
                <option value="">— المنتج —</option>
                {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
              </select>
              <input className="input" placeholder="مثال: Galaxy A54" value={newModel.name} onChange={(e) => setNewModel({ ...newModel, name: e.target.value })} />
              <button className="btn-primary" onClick={async () => {
                if (!newModel.productId || !newModel.name.trim()) return;
                try { await apiFetch('/maintenance/models', { method: 'POST', body: { productId: Number(newModel.productId), name: newModel.name.trim() } }); setNewModel({ ...newModel, name: '' }); await loadReference(); } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
              }}>إضافة</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {models.slice(0, 60).map((m) => (
                <div key={m.modelId} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-slate-200 px-3 py-1.5">
                  <span>{products.find((p) => p.productId === m.productId)?.name} — {m.name}</span>
                  <button className="text-rose-500 text-xs" onClick={async () => { try { await apiFetch(`/maintenance/models/${m.modelId}`, { method: 'DELETE' }); await loadReference(); } catch (err: any) { setError(err?.message); } }}>حذف</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="font-bold text-slate-800">التصنيفات الرئيسية (مجموعات الأعطال)</div>
            <div className="flex gap-2">
              <input className="input" placeholder="مثال: شاشة" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
              <button className="btn-primary" onClick={async () => {
                if (!newCategory.trim()) return;
                try { await apiFetch('/maintenance/fault-categories', { method: 'POST', body: { name: newCategory.trim() } }); setNewCategory(''); await loadReference(); } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
              }}>إضافة</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {faultCategories.map((c) => (
                <div key={c.categoryId} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-slate-200 px-3 py-1.5">
                  <span>{c.name} <span className="text-xs text-slate-400">({c.subcategoryCount ?? 0})</span></span>
                  <button className="text-rose-500 text-xs" onClick={async () => { try { await apiFetch(`/maintenance/fault-categories/${c.categoryId}`, { method: 'DELETE' }); await loadReference(); } catch (err: any) { setError(err?.message); } }}>حذف</button>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <div className="font-bold text-slate-800">التصنيفات الفرعية (الأعطال)</div>
            <div className="flex gap-2">
              <select className="input" value={newSubcategory.categoryId} onChange={(e) => setNewSubcategory({ ...newSubcategory, categoryId: e.target.value })}>
                <option value="">— التصنيف —</option>
                {faultCategories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}
              </select>
              <input className="input" placeholder="مثال: كسر شاشة" value={newSubcategory.name} onChange={(e) => setNewSubcategory({ ...newSubcategory, name: e.target.value })} />
              <button className="btn-primary" onClick={async () => {
                if (!newSubcategory.categoryId || !newSubcategory.name.trim()) return;
                try { await apiFetch('/maintenance/fault-subcategories', { method: 'POST', body: { faultCategoryId: Number(newSubcategory.categoryId), name: newSubcategory.name.trim() } }); setNewSubcategory({ ...newSubcategory, name: '' }); await loadReference(); } catch (err: any) { setError(err?.message ?? 'تعذر الحفظ'); }
              }}>إضافة</button>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {faultSubcategories.slice(0, 80).map((s) => (
                <div key={s.subcategoryId} className="flex items-center justify-between gap-2 text-sm rounded-xl border border-slate-200 px-3 py-1.5">
                  <span>{faultCategories.find((c) => c.categoryId === s.categoryId)?.name} — {s.name}</span>
                  <button className="text-rose-500 text-xs" onClick={async () => { try { await apiFetch(`/maintenance/fault-subcategories/${s.subcategoryId}`, { method: 'DELETE' }); await loadReference(); } catch (err: any) { setError(err?.message); } }}>حذف</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
