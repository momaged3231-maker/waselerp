'use client';

import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { invalidateDeleteTogglesCache } from '@/lib/delete-toggles';

/**
 * Settings kit — shared context + declarative field rendering for the «الإعدادات» hub.
 * All tabs backed by app_settings read/write through this single context, so the
 * top-level «حفظ» / «تحديث البيانات» buttons work everywhere at once.
 */

export type SettingField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  desc?: string;
  placeholder?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  unit?: string;
  options?: { value: string; label: string }[];
};

export type SettingSection = { id: string; title: string; desc: string; fields: SettingField[] };

// ------------------------------------------------------------------ //
//  Sections — split across the hub tabs (no key is rendered twice as an editable field)
// ------------------------------------------------------------------ //

export const GENERAL_SECTIONS: SettingSection[] = [
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
    id: 'items',
    title: 'الأصناف',
    desc: 'سلوك تعريف الأصناف',
    fields: [
      { key: 'ItemCodeAuto', label: 'كود الصنف تلقائيًا', type: 'boolean', desc: 'عند الحفظ بكود فارغ، يُولّد النظام كودًا ITM-000001 تلقائيًا (مخصص لكل فرع/قاعدة بيانات)' },
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
  {
    id: 'time',
    title: 'الوقت والتوقيت',
    desc: 'ساعة النظام ومزامنة الوقت مع السيرفر',
    fields: [
      {
        key: 'DisplayTimezone',
        label: 'توقيت الساعة (الدولة/المنطقة)',
        type: 'select',
        desc: 'المنطقة الزمنية المعروضة في الأوقات (الافتتاحية/الإغلاقية) للفترة — قيمة افتراضية «مصر»',
        options: [
          { value: 'Africa/Cairo', label: 'مصر — القاهرة' },
          { value: 'Africa/Casablanca', label: 'المغرب — الرباط' },
          { value: 'Europe/London', label: 'بريطانيا — لندن' },
          { value: 'Europe/Berlin', label: 'ألمانيا — برلين' },
          { value: 'Asia/Dubai', label: 'الإمارات — دبي' },
          { value: 'Asia/Beirut', label: 'لبنان — بيروت' },
          { value: 'Asia/Amman', label: 'الأردن — عمّان' },
          { value: 'Asia/Qatar', label: 'قطر — الدار' },
          { value: 'Asia/Kuwait', label: 'الكويت — الكويت' },
          { value: 'Asia/Riyadh', label: 'السعودية — الرياض' },
          { value: 'UTC', label: 'UTC — توقيت عالمي' },
        ],
      },
      {
        key: 'TimeFromServer',
        label: 'مزامنة الوقت مع السيرفر',
        type: 'boolean',
        desc: 'عند التفعيل تعرض الأوقات من ساعة السيرفر بدل توقيت الجهاز',
      },
    ],
  },
];

export const INVOICE_SECTIONS: SettingSection[] = [
  {
    id: 'tax',
    title: 'الضريبة',
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
    id: 'receipt-sections',
    title: 'إظهار الأقسام في ورقة الفاتورة',
    desc: 'ما يظهر تحت الإجماليات في الإيصال المطبوع',
    fields: [
      { key: 'ReceiptShowBranchName', label: 'إظهار اسم الفرع في الإيصال', type: 'boolean', desc: 'سطر «الفرع: …» تحت رقم الفاتورة' },
      { key: 'ReceiptShowPartyName', label: 'إظهار اسم العميل في الإيصال', type: 'boolean', desc: 'سطر «العميل: …» — للعملاء المحددين في البيع' },
      { key: 'ReceiptShowTotals', label: 'إظهار إجماليات الفاتورة في الإيصال', type: 'boolean', desc: 'الإجمالي + الخصم (المطلوب/المدفوع يظهران دائمًا)' },
    ],
  },
];

export const PRINTER_SECTIONS: SettingSection[] = [
  {
    id: 'print',
    title: 'الطباعة والإيصال',
    desc: 'تُطبّق على الإيصال المطبوع (وكيل الطباعة أو معاينة المتصفح) — تغييرها يسري على كل الفروع',
    fields: [
      { key: 'ReceiptCopies', label: 'عدد نسخ الإيصال المطبوعة', type: 'number', dir: 'ltr', unit: 'نسخة', desc: '1–5 نسخ — كل نسخة تُرسل لطابعة الكاشير (وكيل الطباعة فقط)' },
      {
        key: 'ReceiptPaperSize',
        label: 'مقاس ورق الإيصال',
        type: 'select',
        desc: 'حراري 80مم / 58مم عبر وكيل الطباعة، أو A5 / A4 في نافذة طباعة المتصفح',
        options: [
          { value: 'thermal80', label: 'إيصال حراري 80مم (وكيل الطباعة)' },
          { value: 'thermal58', label: 'إيصال حراري 58مم (وكيل الطباعة)' },
          { value: 'a5', label: 'شاشة A5 (طباعة المتصفح)' },
          { value: 'a4', label: 'شاشة A4 (طباعة المتصفح)' },
        ],
      },
      { key: 'KitchenTicketEnabled', label: 'طباعة تذكرة مطبخ عند إرسال الطلب للمطبخ', type: 'boolean', desc: 'تذكرة بلا أسعار تُطبع على طابعة الكاشير/المطبخ عند «إرسال للمطبخ» من شاشة المطاعم' },
      { key: 'KitchenTicketCopies', label: 'عدد نسخ تذكرة المطبخ', type: 'number', dir: 'ltr', unit: 'نسخة', desc: '1–3 نسخ لكل تذكرة مطبخ' },
      { key: 'KitchenPrinterName', label: 'طابعة تذكرة المطبخ (اسم طابعة Windows)', type: 'text', dir: 'ltr', desc: 'اتركه فارغًا = الطابعة الافتراضية للوكيل. مثال: "KitchenPrinter" — نفس الاسم كما يظهر في قائمة الطابعات' },
    ],
  },
];

export const BARCODE_SECTIONS: SettingSection[] = [
  {
    id: 'barcodes',
    title: 'ملصقات الباركود',
    desc: 'تُطبّق على شاشة «المخازن ← طباعة الباركود» — تُحدد ما يظهر على كل ملصق وكم مرة يُطبع',
    fields: [
      {
        key: 'BarcodeLabelFormat',
        label: 'حجم الملصق الافتراضي',
        type: 'select',
        desc: 'الحجم الذي تُفتح عليه شاشة طباعة الباركود (يمكن تغييره لكل طبعة)',
        options: [
          { value: 'small', label: 'صغير' },
          { value: 'medium', label: 'متوسط' },
          { value: 'large', label: 'كبير' },
        ],
      },
      { key: 'BarcodeLabelCopies', label: 'عدد نسخ الملصق الواحد', type: 'number', dir: 'ltr', unit: 'نسخة', desc: '1–10 — كل صنف محدد يُطبع بعدد النسخ هذا في كل طبعة' },
      { key: 'BarcodeShowName', label: 'إظهار اسم الصنف على الملصق', type: 'boolean', desc: 'اسم الصنف أسفل الباركود' },
      { key: 'BarcodeShowCode', label: 'إظهار كود الصنف النصي أسفل الباركود', type: 'boolean', desc: 'الكود بصيغة نصية تحت الخطوط (EAN-13)' },
      { key: 'BarcodeShowPrice', label: 'إظهار سعر البيع على الملصق', type: 'boolean', desc: 'سعر البيع بالجنيه أسفل الباركود' },
    ],
  },
];

export const EXTRAS_SECTIONS: SettingSection[] = [
  {
    id: 'attachments',
    title: 'المرفقات',
    desc: 'سياسات رفع الملفات — تُطبق على كل الكيانات: فواتير، أصناف، عملاء/موردين، أذون صيانة، موظفون، عملاء محتملون',
    fields: [
      { key: 'AttachmentMaxKb', label: 'أقصى حجم للملف الواحد', type: 'number', dir: 'ltr', unit: 'KB', desc: 'الافتراضي 5120 كيلوبايت (5MB) — يُفحص على الخادم عند الرفع وعلى الشاشة قبل الرفع' },
      { key: 'AttachmentMaxPerEntity', label: 'أقصى عدد مرفقات لكل كيان', type: 'number', dir: 'ltr', unit: 'ملف', desc: 'الافتراضي 20 ملفًا لكل فاتورة/صنف/عميل/إذن صيانة… — الرفع يُرفض بعد تجاوز الحد' },
    ],
  },
  {
    id: 'hr',
    title: 'الموارد البشرية',
    desc: 'نسب ونطاق التأمينات المستخدمة عند توليد المرتبات',
    fields: [
      { key: 'InsuranceEmployeePct', label: 'نسبة تأمينات الموظف', type: 'number', dir: 'ltr', unit: '%', desc: 'تُخصم من صافي المرتب (الافتراضي 11%) — تُحسب على الأجر التأميني' },
      { key: 'InsuranceEmployerPct', label: 'نسبة تأمينات الشركة', type: 'number', dir: 'ltr', unit: '%', desc: 'حصة الشركة في التأمينات وتُرحّل لمصروف المرتبات (الافتراضي 18.75%)' },
      { key: 'InsuranceInsurableMin', label: 'الحد الأدنى للأجر التأميني', type: 'number', dir: 'ltr', unit: 'ج.م', desc: '0 = بلا حد — الراتب الأقل من هذا الحد يُحتسب التأمين عليه' },
      { key: 'InsuranceInsurableMax', label: 'الحد الأقصى للأجر التأميني', type: 'number', dir: 'ltr', unit: 'ج.م', desc: '0 = بلا حد — الراتب الأعلى من هذا الحد يُحتسب التأمين على الحد فقط' },
    ],
  },
];

export const POS_SECTIONS: SettingSection[] = [
  {
    id: 'pos',
    title: 'نقطة البيع والكاشير',
    desc: 'سلوك نقطة البيع وإلزام فتح وردية وطلبات المبيعات',
    fields: [
      {
        key: 'RequireCashierShift',
        label: 'إلزام فتح وردية قبل البيع',
        type: 'boolean',
        desc: 'لا يمكن إتمام بيع من نقطة البيع بدون وردية مفتوحة على الخزينة',
      },
      {
        key: 'RequireRepOnSale',
        label: 'المندوب إلزامي عند تسجيل فاتورة',
        type: 'boolean',
        desc: 'رفض حفظ فاتورة المبيعات/المرتجع بدون اختيار مندوب مبيعات',
      },
      {
        key: 'RequireCustomerOnSale',
        label: 'تحديد العميل إلزامي عند تسجيل فاتورة',
        type: 'boolean',
        desc: 'رفض حفظ فاتورة مبيعات/مرتجع بدون اختيار عميل — طلبات الطاولات مستثناة (عميلها غير معروف)',
      },
      {
        key: 'BlockBelowCostSale',
        label: 'منع البيع بأقل من التكلفة',
        type: 'boolean',
        desc: 'رفض حفظ بيع/مرتجع بسعر أقل من تكلفة الصنف (الهدايا مستثناة)',
      },
      {
        key: 'DefaultPaymentType',
        label: 'نمط الدفع الافتراضي في نقطة البيع',
        type: 'select',
        desc: 'الخيار الذي يفتح عليه شاشة الدفع دائمًا',
        options: [
          { value: '1', label: 'نقدي' },
          { value: '2', label: 'آجل' },
          { value: '3', label: 'مختلط (نقدي + بطاقة/محفظة)' },
        ],
      },
      {
        key: 'AutoPrintReceipt',
        label: 'طباعة الإيصال تلقائيًا بعد البيع',
        type: 'boolean',
        desc: 'عند التعطيل تظهر الفاتورة لطباعتها يدويًا دون إرسال تلقائي للطابعة',
      },
      {
        key: 'DefaultOrderType',
        label: 'نوع الطلب الافتراضي في نقطة البيع',
        type: 'select',
        desc: 'النوع الذي يُفتح عليه شاشة نقطة البيع (ماشر / توصيل / سفري / طاولة)',
        options: [
          { value: '1', label: 'ماشر' },
          { value: '2', label: 'توصيل' },
          { value: '3', label: 'سفري' },
          { value: '4', label: 'طاولة' },
        ],
      },
    ],
  },
];

export const RESTAURANT_SECTIONS: SettingSection[] = [
  {
    id: 'restaurant-kitchen-ticket',
    title: 'ورقة المطبخ',
    desc: 'تذكرة المطبخ تُطبع عند «إرسال للمطبخ» — تُطبّق على فرع هذا الجهاز',
    fields: [
      { key: 'KitchenPrinterName', label: 'طابعة ورقة المطبخ', type: 'text', dir: 'ltr', placeholder: 'Microsoft Print to PDF', desc: 'الطابعة الافتراضية لورقة المطبخ. مثال على اسم طابعة Windows: "Microsoft Print to PDF" — يُترك فارغًا = طابعة الوكيل الافتراضية' },
      { key: 'KitchenTicketCopies', label: 'عدد النسخ', type: 'number', dir: 'ltr', unit: 'نسخة', desc: '1–3 نسخ لكل تذكرة مطبخ' },
      { key: 'KitchenTicketEnabled', label: 'طباعة ورقة مطبخ', type: 'boolean', desc: 'طباعة تذكرة بلا أسعار (أو بأسعار حسب الإعداد) عند إرسال الطلب للمطبخ من شاشة المطاعم' },
      { key: 'KitchenTicketPerCategory', label: 'طباعة ورقة المطبخ طبقاً لمجموعة الصنف', type: 'boolean', desc: 'تذكرة مستقلة لكل مجموعة أصناف (المجموعة تُذكر في رأس التذكرة) على نفس طابعة المطبخ' },
      { key: 'KitchenTicketShowPrice', label: 'طباعة سعر الصنف في ورق المطبخ', type: 'boolean', desc: 'يظهر سعر كل صنف بجانب كميته + إجمالي أسفل التذكرة (بدل تذكرة بلا أسعار)' },
    ],
  },
  {
    id: 'restaurant-display',
    title: 'شاشة المطبخ',
    desc: 'تحديث سجل أصناف المطبخ المنتظرة تلقائيًا',
    fields: [
      { key: 'KitchenDisplayAutoRefresh', label: 'تحديث شاشة المطبخ تلقائيًا', type: 'boolean', desc: 'إعادة تحميل قائمة أصناف المطبخ كل 5 ثوانٍ؛ عند التعطيل استخدم زر «تحديث» يدويًا' },
    ],
  },
  {
    id: 'restaurant-mode',
    title: 'نظام العمل',
    desc: 'النظام الافتراضي والملاحظات التشغيلية للمطعم',
    fields: [
      {
        key: 'DefaultOrderType',
        label: 'نظام العمل الافتراضي للمطعم',
        type: 'select',
        desc: 'نفس مفتاح نقطة البيع — تُفتح عليه قوائم الطلب افتراضيًا (يُشترك مع تبويب POS)',
        options: [
          { value: '4', label: 'صالة (طاولة)' },
          { value: '2', label: 'توصيل' },
          { value: '3', label: 'سفري' },
          { value: '1', label: 'ماشر' },
        ],
      },
      { key: 'RestaurantDefaultTableCount', label: 'عدد الموائد', type: 'number', dir: 'ltr', unit: 'مائدة', desc: 'العدد الابتدائي عند إنشاء قاعة جديدة (يمكن تغييره لكل قاعة) — الافتراضي 20' },
      { key: 'RestaurantAutoPay', label: 'وضع السداد التلقائي', type: 'boolean', desc: 'عند «إغلاق وإصدار فاتورة» تُسجَّل الفاتورة نقدًا بالمبلغ كاملاً تلقائيًا — عطّله لاختيار طريقة الدفع والمبلغ يدويًا' },
      { key: 'RestaurantHideHall', label: 'اخفاء نظام الصالة', type: 'boolean', desc: 'إخفاء «طاولة» من نقطة البيع + إخفاء تبويبات الطاولات في شاشة المطاعم + رفض أي فاتورة صالة على الخادم' },
      { key: 'RestaurantHideDelivery', label: 'اخفاء نظام التوصيل', type: 'boolean', desc: 'إخفاء «توصيل» من نقطة البيع + رفض أي فاتورة توصيل على الخادم' },
    ],
  },
];

export const KNOWN_SETTING_KEYS = new Set(
  [...GENERAL_SECTIONS, ...INVOICE_SECTIONS, ...PRINTER_SECTIONS, ...BARCODE_SECTIONS, ...EXTRAS_SECTIONS, ...POS_SECTIONS, ...RESTAURANT_SECTIONS]
    .flatMap((section) => section.fields.map((field) => field.key)),
);
// Company identity keys are managed in Definitions → «بيانات الشركة» and must not be duplicated here.
export const MOVED_SETTING_KEYS = new Set(['CompanyName', 'CompanyPhone', 'CompanyAddress', 'TaxNumber', 'InvoiceFooter']);

// Arabic labels for every known key — reuses the field labels from the structured tabs.
const ARABIC_SETTING_LABELS_INTERNAL: Record<string, string> = {};
for (const sections of [GENERAL_SECTIONS, INVOICE_SECTIONS, PRINTER_SECTIONS, BARCODE_SECTIONS, EXTRAS_SECTIONS, POS_SECTIONS, RESTAURANT_SECTIONS]) {
  for (const section of sections) {
    for (const field of section.fields) ARABIC_SETTING_LABELS_INTERNAL[field.key] = field.label;
  }
}
export const ARABIC_SETTING_LABELS: Record<string, string> = {
  ...ARABIC_SETTING_LABELS_INTERNAL,
  CompanyName: 'اسم الشركة',
  CompanyPhone: 'هاتف الشركة',
  CompanyAddress: 'عنوان الشركة',
  TaxNumber: 'الرقم الضريبي للشركة',
  InvoiceFooter: 'تذييل الفاتورة',
  DeleteEnabled: 'تفعيل الحذف على النظام كله (تبويب «الحذف»)',
};

// ------------------------------------------------------------------ //
//  Settings context — single source of truth for the app_settings map
// ------------------------------------------------------------------ //

type SettingsContextValue = {
  map: Record<string, string>;
  loading: boolean;
  error: string;
  savedAt: number | null;
  setValue: (key: string, value: string) => void;
  saveAll: () => Promise<void>;
  reloadAll: () => Promise<void>;
  refreshKey: number;
  bumpRefresh: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const fresh = await apiFetch<Record<string, string>>('/admin/settings');
      setMap(fresh ?? {});
    } catch (e: any) {
      setError(e?.message ?? 'تعذر تحميل الإعدادات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const setValue = useCallback((key: string, value: string) => {
    setMap((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveAll = useCallback(async () => {
    setError('');
    try {
      const fresh = await apiFetch<Record<string, string>>('/admin/settings', { method: 'PUT', body: map });
      setMap(fresh ?? map);
      setSavedAt(Date.now());
      invalidateDeleteTogglesCache();
    } catch (e: any) {
      setError(e?.message ?? 'تعذر حفظ الإعدادات');
    }
  }, [map]);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const value = useMemo<SettingsContextValue>(
    () => ({ map, loading, error, savedAt, setValue, saveAll, reloadAll, refreshKey, bumpRefresh }),
    [map, loading, error, savedAt, setValue, saveAll, reloadAll, refreshKey, bumpRefresh],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within <SettingsProvider>');
  return ctx;
}

/** Bump helper — used by the top-level «تحديث البيانات» button to re-mount tab bodies. */
export function useRefreshKey() {
  return useContext(SettingsContext)?.refreshKey ?? 1;
}

// ------------------------------------------------------------------ //
//  Rendering helpers
// ------------------------------------------------------------------ //

/** Animated on/off toggle — slides left/right, emerald when on, slate when off. */
export function SettingToggle({ checked, onToggle, label }: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 ${
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? 'translate-x-[22px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

/** True for the four boolean spellings stored in app_settings. */
export function isBooleanSettingValue(value: string | undefined): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === 'true' || v === 'false' || v === '1' || v === '0';
}

export function SettingFieldRow({ field, value, onChange }: {
  field: SettingField;
  value: string | undefined;
  onChange: (next: string) => void;
}) {
  if (field.type === 'boolean') {
    const checked = value === 'true' || value === '1';
    return (
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-700">{field.label}</span>
          {field.desc && <span className="block text-xs text-slate-500 mt-1 leading-5">{field.desc}</span>}
        </span>
        <SettingToggle checked={checked} onToggle={() => onChange(checked ? 'false' : 'true')} label={field.label} />
      </div>
    );
  }

  if (field.type === 'select') {
    return (
      <div>
        <label className="label">{field.label}</label>
        <span className="block text-xs text-slate-400 mb-1.5 -mt-1 leading-5">{field.desc}</span>
        <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="label">{field.label}</label>
      <span className="block text-xs text-slate-400 mb-1.5 -mt-1 leading-5">{field.desc}</span>
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

/** Renders a list of sections bound to the shared settings context. */
export function SettingSections({ sections }: { sections: SettingSection[] }) {
  const { map, setValue } = useSettings();
  return (
    <div className="space-y-4 max-w-4xl">
      {sections.map((section) => (
        <div key={section.id} className="card p-5">
          <div className="font-bold text-slate-800">{section.title}</div>
          <div className="text-xs text-slate-500 mb-3 mt-0.5">{section.desc}</div>
          <div className="grid sm:grid-cols-2 gap-4">
            {section.fields.map((field) => (
              <SettingFieldRow key={field.key} field={field} value={map[field.key]} onChange={(next) => setValue(field.key, next)} />
            ))}
          </div>
        </div>
      ))}
      <div className="card p-4 border-sky-200 bg-sky-50 text-sky-900 text-xs leading-6">
        <b>بيانات الشركة (الاسم/العنوان/التليفون/الرقم الضريبي/تذييل الفاتورة)</b> تُدار من «البيانات الأساسية ← بيانات الشركة» —
        أي تعديل هناك ينعكس فورًا على طباعة الإيصال والفاتورة.
      </div>
    </div>
  );
}

/** Raw view of every app_settings key — «إعدادات النظام» tab. Booleans render as animated toggles; labels are Arabic. */
export function AllSettingsRaw() {
  const { map, setValue, saveAll } = useSettings();
  const [query, setQuery] = useState('');
  const keys = Object.keys(map).sort((a, b) => a.localeCompare(b));
  const term = query.trim().toLowerCase();
  const visible = keys.filter((key) => {
    if (!term) return true;
    const label = (ARABIC_SETTING_LABELS[key] ?? '').toLowerCase();
    return key.toLowerCase().includes(term)
      || label.includes(term)
      || String(map[key] ?? '').toLowerCase().includes(term);
  });
  const unknown = keys.filter((key) => !KNOWN_SETTING_KEYS.has(key) && !MOVED_SETTING_KEYS.has(key));

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="font-extrabold text-slate-800">إعدادات النظام — كل المفاتيح</div>
          <div className="text-[11px] text-slate-500 mt-0.5">كل ما في جدول الإعدادات كما هو — المفاتيح موثقة بتسميات عربية والقيم المنطقية تُعرض كمفتاح تبديل. «مفاتيح غير موثقة»: {unknown.length}.</div>
        </div>
        <div className="flex-1" />
        <input className="input w-56 py-1.5" placeholder="بحث عن مفتاح أو قيمة…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {visible.map((key) => {
          const moved = MOVED_SETTING_KEYS.has(key);
          const known = KNOWN_SETTING_KEYS.has(key);
          const label = ARABIC_SETTING_LABELS[key];
          const rawValue = map[key] ?? '';
          const isBool = isBooleanSettingValue(rawValue);
          const checked = String(rawValue).trim().toLowerCase() === 'true' || String(rawValue).trim() === '1';
          return (
            <div key={key} className={`rounded-2xl border border-slate-200 p-4 ${moved ? 'bg-slate-50/60' : 'hover:border-slate-300'} transition`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800 leading-6">
                    {label ?? <span dir="ltr" className="font-mono text-xs">{key}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {label && <span className="font-mono text-[10px] text-slate-400" dir="ltr">{key}</span>}
                    {known && <span className="badge bg-emerald-50 text-emerald-700 !text-[9px]">موثق</span>}
                    {moved && <span className="badge bg-sky-50 text-sky-700 !text-[9px]">البيانات الأساسية</span>}
                    {!known && !moved && <span className="badge bg-slate-100 text-slate-500 !text-[9px]">غير موثق</span>}
                  </div>
                </div>
                {isBool && !moved && (
                  <SettingToggle checked={checked} onToggle={() => setValue(key, checked ? 'false' : 'true')} label={label ?? key} />
                )}
              </div>
              {!isBool && (
                <input
                  className={`input mt-3 ${moved ? 'bg-slate-50 text-slate-400' : ''}`}
                  dir="auto"
                  value={rawValue}
                  readOnly={moved}
                  onChange={(e) => setValue(key, e.target.value)}
                />
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div className="text-sm text-slate-400 col-span-2 py-8 text-center">لا توجد مفاتيح مطابقة للبحث</div>}
      </div>

      <div className="card p-4 flex justify-end">
        <button className="btn-primary" onClick={saveAll}>حفظ كل المفاتيح</button>
      </div>

      {unknown.length > 0 && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-amber-800 text-xs leading-6">
          <b>{unknown.length} مفتاحًا غير موثق</b> — قيم محفوظة كما هي من إصدارات سابقة أو من تكاملات خارجية (مثل بوابة الضريبة).
          تُحفظ بلا تعديل من هنا إلا إذا كنت تعرف ما تفعله.
        </div>
      )}
    </div>
  );
}

export const ADVANCED_UNAVAILABLE: { title: string; reason: string }[] = [
  { title: 'البريد والرسائل (Email / SMS / واتساب)', reason: 'يحتاج مزود خارجي وفاتورة شهرية — يبقى ضمن P7 عند اختيار مزود' },
  { title: 'المظهر/الخط/اللغة لكل جهاز (Style)', reason: 'واجهة ويب بحجم واحد — العربي افتراضيًا؛ لا توجد مقاربة تنفيذ للاستعداد' },
  { title: 'إعدادات اتصال قاعدة البيانات من الجهاز', reason: 'الاتصال عبر بيئة الـ API و`DATABASE_URL` — ليست واجهة مستخدم عميل لأسباب أمنية' },
  { title: 'ميزان الباركود وشاشة عرض العميل والمودم', reason: 'أجهزة COM/تسلسلي — خارج قدرات الويب؛ تحتاج وكيل/جسر أجهزة محلي' },
  { title: 'تصنيع الأصناف المجمعة تلقائيًا', reason: 'وحدة BOM/تصنيع لم تُطلب سوقيًا بعد' },
  { title: 'مستخلصات المقاولات (Contractor)', reason: 'وحدة متخصصة (P8) — لا تُبنى إلا بطلب سوقي واضح' },
  { title: 'إظهار/إخفاء الوحدات بكود دعم (ExtraModule)', reason: 'مُستبدلة بأدوار RBAC وتقييد المخازن/الصناديق للمستخدمين (P7)' },
  { title: 'النسخ الاحتياطي من جهاز الكاشير', reason: 'يُنفذ على مستوى السيرفر/PostgreSQL (أدوات `tools/pg` والنسخ الاحتياطي الخارجي ضمن P7)' },
  { title: 'التنبيه بميعاد التسليم قبل X دقيقة (مطاعم)', reason: 'لا يوجد حقل «موعد التسليم» في طلبات المطاعم/POS — يُضاف مع موديول التوصيل المطلوب من العميل' },
];
