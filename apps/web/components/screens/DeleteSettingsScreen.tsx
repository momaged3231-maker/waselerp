'use client';

import { useSettings, SettingToggle } from './SettingsKit';

/**
 * «الإعدادات ← الحذف» (D29) — master delete switch + one switch per screen.
 * Missing keys mean ON everywhere (the API double-checks too).
 * The SettingsContext «حفظ» button persists everything in one shot.
 */

const SCREENS: [string, string][] = [
  ['items', 'الأصناف'],
  ['parties', 'العملاء والموردين'],
  ['categories', 'فئات الأصناف'],
  ['units', 'الوحدات'],
  ['customerGroups', 'مجموعات العملاء'],
  ['customerClassifications', 'التصنيفات المخصصة'],
  ['bankAccounts', 'الخزائن والحسابات البنكية'],
  ['attachments', 'المرفقات'],
  ['hrDepartments', 'الإدارات'],
  ['hrComponents', 'مكونات المرتب'],
  ['hrLatencyTiers', 'شرائح الخصم للتأخير'],
  ['hrEarlyPermissions', 'أذونات الانصراف المبكر'],
  ['hrAdvances', 'السلف'],
  ['accountingAccounts', 'الحسابات'],
  ['accountingRecurring', 'القيود المتكررة'],
  ['crmLeads', 'العملاء المحتملون'],
  ['crmActivities', 'الأنشطة'],
  ['crmSources', 'مصادر العملاء المحتملين'],
  ['reminders', 'التذكيرات'],
  ['printProfiles', 'ملفات الطباعة'],
  ['priceLists', 'قوائم الأسعار'],
  ['coupons', 'الكوبونات'],
  ['giftOffers', 'عروض الهدايا'],
  ['maintenanceProducts', 'منتجات الصيانة'],
  ['maintenanceTickets', 'تذاكر الصيانة'],
  ['pos', 'POS (القاعات والموائع والمعدلات والملاحظات)'],
  ['stockVouchers', 'أذون المخزن'],
  ['stockTransfers', 'التحويلات'],
  ['stockCounts', 'الجرد'],
  ['reportDefinitions', 'تعريفات التقارير'],
];

export default function DeleteSettingsScreen() {
  const { map, setValue } = useSettings();
  const boolValue = (key: string) => String(map[key] ?? 'true').trim().toLowerCase() !== 'false' && String(map[key] ?? 'true').trim().toLowerCase() !== '0';
  const setBool = (key: string, value: boolean) => setValue(key, value ? 'true' : 'false');

  const masterOn = boolValue('DeleteEnabled');
  const enabledCount = SCREENS.filter(([key]) => boolValue(`DeleteEnabled_${key}`)).length;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-extrabold text-slate-800">تفعيل الحذف على النظام كله</div>
            <p className="text-xs text-slate-500 mt-1 leading-5">
              المفتاح الرئيسي — عند إيقافه يتعطل الحذف في كل الشاشات دفعة واحدة (الزر بيختفي في الواجهة
              والسيرفر يرفض العملية برسالة واضحة). التفعيل المخصص لكل شاشة بالأسفل.
            </p>
          </div>
          <SettingToggle checked={masterOn} onToggle={() => setBool('DeleteEnabled', !masterOn)} label="تفعيل الحذف على النظام كله" />
        </div>
      </div>

      <div className={`card p-5 transition-opacity ${masterOn ? '' : 'opacity-50'}`}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="font-extrabold text-slate-800">الحذف لكل شاشة</div>
          <span className="text-[11px] text-slate-500">{enabledCount} / {SCREENS.length} شاشة مسموحة الحذف</span>
        </div>
        <p className="text-xs text-slate-500 mb-3 leading-5">
          لكل شاشة توجل مستقل. الإيقاف يخفي أزرار الحذف في الشاشة دي فقط، والسيرفر يرفض العملية لو اتنفت بأي شكل.
          تشغيل المفتاح الرئيسي فوق يعيد الحذف للكل دفعة.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          {SCREENS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-3 py-2 hover:border-slate-300 transition">
              <span className="min-w-0 text-[13px] font-bold text-slate-700 leading-5">
                {label}
                <small dir="ltr" className="block text-[9px] font-normal text-slate-400 truncate">DeleteEnabled_{key}</small>
              </span>
              <SettingToggle
                checked={boolValue(`DeleteEnabled_${key}`)}
                onToggle={() => setBool(`DeleteEnabled_${key}`, !boolValue(`DeleteEnabled_${key}`))}
                label={label}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-slate-400 leading-5">
        ملاحظة: الإيقاف يخص الحذف فقط — العرض والتعديل والحفظ لا تتأثر. الحذف يتم فعليًا في السيرفر (تحقق مزدوج).
      </div>
    </div>
  );
}
