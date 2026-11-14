'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import Link from 'next/link';

type DefinitionKey =
  | 'branches' | 'warehouses' | 'units' | 'colors' | 'sizes'
  | 'categories' | 'custom-groups' | 'items' | 'parties' | 'vendors' | 'reps'
  | 'currencies' | 'banks' | 'bank-accounts' | 'countries' | 'governorates' | 'cities' | 'company';

const NAV: { key: DefinitionKey; label: string }[] = [
  { key: 'branches', label: 'تعريف الفروع' },
  { key: 'warehouses', label: 'تعريف مخزن' },
  { key: 'units', label: 'تعريف الوحدات' },
  { key: 'colors', label: 'تعريف ألوان' },
  { key: 'sizes', label: 'تعريف مقاسات' },
  { key: 'categories', label: 'تعريف فئات الأصناف' },
  { key: 'custom-groups', label: 'تعريف فئات مخصصة' },
  { key: 'items', label: 'تعريف صنف' },
  { key: 'parties', label: 'تعريف العملاء' },
  { key: 'vendors', label: 'تعريف الموردين' },
  { key: 'reps', label: 'تعريف المندوبين' },
  { key: 'currencies', label: 'أسعار العملات' },
  { key: 'banks', label: 'تعريف البنوك' },
  { key: 'bank-accounts', label: 'تعريف الحسابات البنكية' },
  { key: 'countries', label: 'الدول' },
  { key: 'governorates', label: 'المحافظات' },
  { key: 'cities', label: 'المدن' },
  { key: 'company', label: 'بيانات الشركة' },
];

function MissingCard({ title, reason, alt }: { title: string; reason: string; alt?: string }) {
  return (
    <div className="card p-6 max-w-3xl">
      <div className="font-extrabold text-lg text-slate-700">{title}</div>
      <div className="text-sm text-slate-500 mt-2 leading-6">{reason}</div>
      {alt ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3">البديل: {alt}</div>
      ) : null}
    </div>
  );
}

function LinkCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <div className="card p-6 max-w-3xl">
      <div className="font-extrabold text-lg text-slate-700">{title}</div>
      <div className="text-sm text-slate-500 mt-2">{desc}</div>
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        هذه الشاشة موجودة بالفعل في النظام — استخدم الرابط:{' '}
        <Link href={href} className="text-brand-700 font-bold underline">{href}</Link>
      </div>
    </div>
  );
}

function DataTable({ columns, rows, empty }: { columns: [string, string][]; rows: any[]; empty?: string }) {
  return (
    <div className="table-wrap max-h-96 overflow-y-auto">
      <table className="table">
        <thead><tr>{columns.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row._tmp ?? i}>
              {columns.map(([k]) => <td key={k}>{row[k] ?? '—'}</td>)}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="text-center text-slate-400 py-6">{empty ?? 'لا توجد بيانات'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function DefinitionsPage() {
  const { can } = useSession();
  const [key, setKey] = useState<DefinitionKey>('branches');

  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [classifications, setClassifications] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [countries, setCountries] = useState<any[]>([]);
  const [cities, setCities] = useState<any[]>([]);

  const [form, setForm] = useState<any>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setError('');
    setMessage('');
    try {
      if (key === 'warehouses') setWarehouses(await apiFetch('/catalog/warehouses'));
      if (key === 'units') setUnits(await apiFetch('/catalog/units'));
      if (key === 'categories') setCategories(await apiFetch('/catalog/categories'));
      if (key === 'custom-groups') setClassifications(await apiFetch('/customer-classifications'));
      if (key === 'reps') setReps(await apiFetch('/sales/reps'));
      if (key === 'countries') setCountries(await apiFetch('/shipping/countries'));
      if (key === 'cities') setCities(await apiFetch('/shipping/cities'));
    } catch (e: any) {
      setError(e?.message ?? 'تعذر التحميل');
    }
  }

  useEffect(() => { load(); }, [key]);

  async function save(payload: any, path: string, reloadKey?: string) {
    setError('');
    setMessage('');
    try {
      await apiFetch(path, { method: 'POST', body: payload });
      setMessage('تم الحفظ بنجاح');
      setForm({});
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر الحفظ');
    }
  }

  async function saveEdit(payload: any, path: string) {
    setError('');
    setMessage('');
    try {
      await apiFetch(path, { method: 'PUT', body: payload });
      setMessage('تم التحديث بنجاح');
      setForm({});
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر الحفظ');
    }
  }

  const renderContent = () => {
    if (error) return <div className="card p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>;
    if (message) return <div className="card p-4 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>;

    switch (key) {
      case 'branches':
        return <LinkCard title="تعريف الفروع" desc="إدارة الفروع (إنشاء/تعديل/تفعيل) موجودة في شاشة الإعدادات." href="/admin" />;
      case 'items':
        return <LinkCard title="تعريف صنف" desc="كتالوج الأصناف والباركود والوحدات والأسعار — في شاشة الأصناف." href="/items" />;
      case 'parties':
        return <LinkCard title="تعريف العملاء" desc="العملاء (كود، اسم، رصيد، حد ائتمان، قائمة أسعار، مجموعة/تصنيف)." href="/parties" />;
      case 'vendors':
        return <LinkCard title="تعريف الموردين" desc="نفس شاشة العملاء — العملاء والموردون في صفحة واحدة بنمطين." href="/parties" />;
      case 'currencies':
        return <LinkCard title="أسعار العملات" desc="إدارة العملات وأسعار الصرف — في شاشة المحاسبة (تبويب العملات)." href="/accounting" />;
      case 'bank-accounts':
        return <LinkCard title="تعريف الحسابات البنكية" desc="الحسابات البنكية والمحفظة والدفع على الحساب — في شاشة الخزينة (نوع = بنك)." href="/treasury" />;
      case 'company':
        return <LinkCard title="بيانات الشركة" desc="الاسم التجاري، التليفون، العنوان، الرقم الضريبي، تذييل الفاتورة — في إعدادات النظام." href="/admin" />;

      case 'warehouses':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>المخازن ({warehouses.length})</span></div>
              <DataTable columns={[['code', 'الكود'], ['name', 'الاسم'], ['isDefault', 'افتراضي'], ['isActive', 'نشط']]}
                rows={warehouses} empty="لا توجد مخازن" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">مخزن جديد</div>
              <div><label className="label">الكود</label><input className="input" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><label className="label">الاسم *</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-brand-600" checked={!!form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />مخزن افتراضي للفرع</label>
              <button className="btn-primary w-full" onClick={() => save({ code: form.code || null, name: form.name, isDefault: !!form.isDefault }, '/catalog/warehouses')}>إضافة</button>
              <div className="text-[11px] text-slate-400">لا يوجد تعديل/تعطيل من الواجهة (الـ API تدعم الإضافة فقط).</div>
            </div>
          </div>
        );

      case 'units':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>الوحدات ({units.length})</span></div>
              <DataTable columns={[['code', 'الكود'], ['name', 'الاسم'], ['factor', 'المعامل']]}
                rows={units} empty="لا توجد وحدات" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">وحدة جديدة</div>
              <div><label className="label">الكود</label><input className="input" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" /></div>
              <div><label className="label">الاسم *</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">المعامل (بالنسبة للأساس)</label><input className="input" type="number" step="0.0001" dir="ltr" value={form.factor ?? ''} onChange={(e) => setForm({ ...form, factor: e.target.value })} /></div>
              <button className="btn-primary w-full" onClick={() => save({ code: form.code || null, name: form.name, factor: Number(form.factor || 1) }, '/catalog/units')}>إضافة</button>
            </div>
          </div>
        );

      case 'categories':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>فئات الأصناف ({categories.length})</span></div>
              <DataTable columns={[['code', 'الكود'], ['name', 'الاسم'], ['isActive', 'نشط']]}
                rows={categories} empty="لا توجد فئات" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">{form.id ? 'تعديل الفئة' : 'فئة جديدة'}</div>
              <div><label className="label">الكود</label><input className="input" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
              <div><label className="label">الاسم *</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              {form.id ? (
                <button className="btn-primary w-full" onClick={() => saveEdit({ code: form.code || null, name: form.name, isActive: form.isActive !== false }, `/catalog/categories/${form.id}`)}>حفظ التعديل</button>
              ) : (
                <button className="btn-primary w-full" onClick={() => save({ code: form.code || null, name: form.name }, '/catalog/categories')}>إضافة</button>
              )}
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <button key={c.categoryId} className="btn-soft text-[11px] py-0.5" onClick={() => setForm({ id: c.categoryId, code: c.code, name: c.name, isActive: c.isActive })}>{c.name}</button>
                ))}
              </div>
              <div className="text-[11px] text-slate-400">لا يوجد حذف من الواجهة (حذف الفئات غير مسموح بالباك إند حفاظًا على سلامة الأصناف).</div>
            </div>
          </div>
        );

      case 'custom-groups':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>فئات مخصصة للعملاء ({classifications.length})</span></div>
              <DataTable columns={[['name', 'الاسم'], ['discountPct', 'خصم %'], ['creditLimit', 'حد ائتمان'], ['graceDays', 'فترة سماح']]}
                rows={classifications} empty="لا توجد فئات" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">{form.id ? 'تعديل الفئة' : 'فئة جديدة'}</div>
              <div><label className="label">الاسم *</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><label className="label">خصم %</label><input className="input" type="number" dir="ltr" value={form.discountPct ?? ''} onChange={(e) => setForm({ ...form, discountPct: e.target.value })} /></div>
                <div><label className="label">حد ائتمان</label><input className="input" type="number" step="0.01" dir="ltr" value={form.creditLimit ?? ''} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></div>
                <div><label className="label">فترة سماح (يوم)</label><input className="input" type="number" dir="ltr" value={form.graceDays ?? ''} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} /></div>
              </div>
              {form.id ? (
                <button className="btn-primary w-full" onClick={() => saveEdit({ name: form.name, discountPct: Number(form.discountPct || 0), creditLimit: Number(form.creditLimit || 0), graceDays: Number(form.graceDays || 0) }, `/customer-classifications/${form.id}`)}>حفظ التعديل</button>
              ) : (
                <button className="btn-primary w-full" onClick={() => save({ name: form.name, discountPct: Number(form.discountPct || 0), creditLimit: Number(form.creditLimit || 0), graceDays: Number(form.graceDays || 0) }, '/customer-classifications')}>إضافة</button>
              )}
              <div className="flex flex-wrap gap-1">
                {classifications.map((c) => (
                  <button key={c.id ?? c.groupId ?? c.classificationId} className="btn-soft text-[11px] py-0.5" onClick={() => setForm({ id: c.id ?? c.groupId ?? c.classificationId, name: c.name, discountPct: c.discountPct, creditLimit: c.creditLimit, graceDays: c.graceDays })}>{c.name}</button>
                ))}
              </div>
            </div>
          </div>
        );

      case 'reps':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>المندوبين ({reps.length})</span></div>
              <DataTable columns={[['userName', 'المستخدم'], ['fullName', 'الاسم'], ['commissionPct', 'عمولة %']]}
                rows={reps} empty="لا يوجد مندوبون نشطون" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">إضافة مندوب</div>
              <div className="text-sm text-slate-500">المندوب = مستخدم بدور «مندوب مبيعات» وحالة نشطة. أضف المستخدم أولاً من شاشة الإعدادات مع تفعيل «مندوب» ✅، ثم سيظهر هنا تلقائيًا.</div>
              <Link href="/admin" className="btn-primary w-full">فتح شاشة الإعدادات لإضافة مندوب</Link>
            </div>
          </div>
        );

      case 'countries':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>الدول ({countries.length})</span></div>
              <DataTable columns={[['code', 'الكود'], ['name', 'الاسم'], ['nameEn', 'الاسم الإنجليزي']]}
                rows={countries} empty="لا توجد دول" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">دولة جديدة</div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">الكود</label><input className="input" dir="ltr" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="EG" /></div>
                <div><label className="label">الاسم</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              </div>
              <div><label className="label">الاسم الإنجليزي</label><input className="input" dir="ltr" value={form.nameEn ?? ''} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
              <button className="btn-primary w-full" onClick={() => save({ code: form.code, name: form.name, nameEn: form.nameEn || null }, '/shipping/countries')}>إضافة</button>
            </div>
          </div>
        );

      case 'cities':
        return (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <div className="card-title"><span>المدن ({cities.length})</span></div>
              <DataTable columns={[['name', 'اسم المدينة'], ['cityNameAr', 'الاسم الإنجليزي'], ['countryId', 'الدولة (id)']]}
                rows={cities} empty="لا توجد مدن" />
            </div>
            <div className="card p-5 space-y-3 h-fit">
              <div className="font-bold">مدينة جديدة</div>
              <div><label className="label">الدولة (id)</label><input className="input" type="number" dir="ltr" value={form.countryId ?? ''} onChange={(e) => setForm({ ...form, countryId: e.target.value })} /></div>
              <div><label className="label">اسم المدينة</label><input className="input" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">الاسم الإنجليزي</label><input className="input" dir="ltr" value={form.nameEn ?? ''} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></div>
              <button className="btn-primary w-full" onClick={() => save({ countryId: Number(form.countryId), name: form.name, nameEn: form.nameEn || null }, '/shipping/cities')}>إضافة</button>
            </div>
          </div>
        );

      case 'colors':
        return <MissingCard title="تعريف ألوان" reason="لا يوجد جدول أو نموذج بيانات للألوان في النظام — هي خاصة بمجالات الأقمشة/الموضة (مقاس ولون لكل قطعة). لا تتوفر في نطاق عمل هذا النظام (بيع التجزئة العام + مطعم + صيانة). أي صناعة ملابس تحتاج وحدة متخصصة تُبنى بطلب سوقي واضح." alt="أضيفها كخصائص متغيرة في بطاقة الصنف لو احتجت (حقل ملاحظات أو وحدات متعددة)." />;
      case 'sizes':
        return <MissingCard title="تعريف مقاسات" reason="نفس سبب الألوان — جدول/نموذج منفصل للمقاسات غير منفذ. نظام «وحدات متعددة + معامل تحويل» يغطي وحدات القياس (كرتون/قطعة/كيلو)، بينما «المقاس» كسمة تجارية مختلفة غير مدعومة الآن." alt="استخدم حقل «اسم الصنف» لفرز مقاسات (مثال: «تيشيرت أحمر 38»)." />;
      case 'governorates':
        return <MissingCard title="المحافظات" reason="لا يوجد جدول محافظات في النظام. لدينا جدول المدن والدول ضمن وحدة الشحن والتسليم — المحافظات اختيارية ويمكن إضافتها كعمود/فقرة في نفس الجدول عند الحاجة." alt="التزم بـ «المدن» + «الدول» في وحدة الشحن — أو اطلب إضافة المحافظات كجدول مستقل." />;
      case 'banks':
        return <MissingCard title="تعريف البنوك" reason="لا يوجد جدول مرجعي للبنوك في النظام. اسم البنك يُحفظ كنص حر مع الحساب البنكي (الخزينة › نوع = بنك). اختيار اسم البنك من قائمة ثابنة غير موحدة." alt="اختيار البنك يتم عند إنشاء الحساب البنكي («اسم البنك» نص حر). أضيف جدول «البنوك» كمرجع عند الرغبة." />;
      default:
        return <MissingCard title="قسم غير مكتمل" reason="هذي القيمة غير معرّفة." />;
    }
  };

  return (
    <AppShell title="البيانات الأساسية">
      <div className="flex gap-2 mb-4 flex-wrap">
        {NAV.map((item) => (
          <button
            key={item.key}
            onClick={() => { setKey(item.key); setError(''); setMessage(''); setForm({}); }}
            className={key === item.key ? 'btn-primary' : 'btn-soft'}
          >
            {item.label}
          </button>
        ))}
      </div>

      {renderContent()}
    </AppShell>
  );
}
