'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { SettingSections, SettingToggle, useSettings, RESTAURANT_SECTIONS } from '@/components/screens/SettingsKit';

const CHARGE_MODES = [
  { value: 1, label: 'مبلغ ثابت لكل ضيف' },
  { value: 2, label: 'حد أدنى لإجمالي الفاتورة (يُضاف الفرق)' },
  { value: 3, label: 'نسبة % من إجمالي الفاتورة' },
];

/** Reads the master restaurant toggle from the shared settings map (default ON). */
export function isRestaurantsEnabled(map: Record<string, string>): boolean {
  const raw = String(map['RestaurantsEnabled'] ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

/** «مطاعم» — المفتاح الرئيسي لوحدة المطاعم بالكامل + كل إعدادات المطعم مجتمعة هنا (مطبخ/شاشة/نظام عمل) + رسوم الخدمة (للفرع). */
export default function RestaurantSettingsScreen() {
  const { map, setValue } = useSettings();
  const enabled = isRestaurantsEnabled(map);
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setSettings(await apiFetch('/pos/settings'));
  }

  useEffect(() => { load().catch(() => setSettings(null)); }, []);

  async function saveServiceCharge() {
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const savedSettings = await apiFetch('/pos/settings', {
        method: 'PUT',
        body: settings,
      });
      setSettings(savedSettings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ رسوم الخدمة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Master switch — one place for the whole restaurant unit */}
      <div className={`card p-5 border-2 transition-colors ${enabled ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold text-slate-800">وحدة المطاعم — المفتاح الرئيسي</span>
              <span className={`badge ${enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{enabled ? 'مفعّلة' : 'معطلة'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1.5 leading-6">
              كل شيء خاص بالمطاعم في مكان واحد: الصالة والطاولات وشاشة المطبخ والإرسال للمطبخ وإعدادات التشغيل أدناه.
              التعطيل يُخفي «المطاعم» من القائمة الجانبية ويُخفي «طاولة» من نقطة البيع ويُظهر هذه الشاشة للتعديل فقط بعد التفعيل —
              ويرفض الخادم أي عملية مطعم برسالة عربية. بقية السيستم (مبيعات/مخزون/محاسبة/خزينة) لا يتأثر.
              <span className="block mt-1 text-slate-400">التوصيل (توصيل) له مفتاحه المستقل داخل «نظام العمل ← إخفاء نظام التوصيل».</span>
            </p>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <SettingToggle
              checked={enabled}
              onToggle={() => setValue('RestaurantsEnabled', enabled ? 'false' : 'true')}
              label="تفعيل وحدة المطاعم"
            />
            <span className="text-[10px] text-slate-500">يُحفظ بزر «حفظ» أعلى الصفحة</span>
          </div>
        </div>
      </div>

      {!enabled && (
        <div className="card p-4 border-amber-200 bg-amber-50 text-amber-900 text-xs leading-6">
          <b>وحدة المطاعم معطلة</b> — كل الإعدادات أسفل هذه البطاقة مقفلة (عرض فقط). لتعديلها فعّل «وحدة المطاعم» في الأعلى ثم احفظ.
          عند التعطيل أيضًا: القائمة الجانبية لا تُظهر «المطاعم» · نقطة البيع لا تُظهر «طاولة» · وشاشة المطاعم تفتح بإشعار التعطيل.
        </div>
      )}

      <div className={`space-y-4 ${enabled ? '' : 'opacity-50 pointer-events-none select-none'}`} aria-disabled={!enabled}>
        <SettingSections sections={RESTAURANT_SECTIONS} />

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold text-slate-800">رسوم الخدمة (للفرع النشط)</div>
            <div className="text-xs text-slate-500 mt-0.5">تنطبق على طلب الطاولة — تُحتسب عند «إغلاق وإصدار الفاتورة» وتظهر في الفاتورة كـ «رسوم خدمة»</div>
          </div>
        </div>

        {settings === null && <div className="text-sm text-slate-400 py-6 text-center">تعذر تحميل إعدادات الفرع</div>}
        {settings && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div className="sm:col-span-2">
                <label className="label">طريقة احتساب رسوم الخدمة</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {CHARGE_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setSettings({ ...settings, serviceChargeMode: mode.value })}
                      className={`py-2.5 px-3 rounded-xl text-xs font-bold transition text-right ${
                        Number(settings.serviceChargeMode ?? 1) === mode.value
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {Number(settings.serviceChargeMode ?? 1) === 3 ? (
                <div>
                  <label className="label">نسبة رسوم الخدمة</label>
                  <div className="relative">
                    <input
                      className="input pl-9"
                      type="number" step="0.01" min="0" dir="ltr"
                      value={settings.serviceChargePct ?? 0}
                      onChange={(e) => setSettings({ ...settings, serviceChargePct: e.target.value })}
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400 pointer-events-none">%</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="label">سعر رسوم الخدمة (لكل ضيف)</label>
                  <input
                    className="input"
                    type="number" step="0.01" min="0" dir="ltr"
                    value={settings.serviceChargePerGuest ?? 0}
                    onChange={(e) => setSettings({ ...settings, serviceChargePerGuest: e.target.value })}
                  />
                </div>
              )}

              {Number(settings.serviceChargeMode ?? 1) !== 3 && (
                <div>
                  <label className="label">الحد الأدنى (للخدمة)</label>
                  <input
                    className="input"
                    type="number" step="0.01" min="0" dir="ltr"
                    value={settings.serviceChargeMinimum ?? 0}
                    onChange={(e) => setSettings({ ...settings, serviceChargeMinimum: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="text-[11px] text-slate-400 mt-3 leading-5">
              مثال «نسبة %»: فاتورة 500.00 ج.م × 15% = 75.00 ج.م رسوم خدمة — تُضاف على الفاتورة عند الإغلاق (وتُقيّد محاسبيًا حسب ربط الحساب).
              «الحد الأدنى» يُطبّق فقط في وضعي «مبلغ ثابت / حد أدنى». كل الحقول تُحفظ للفرع النشط وتُستخدم عند «إغلاق وإصدار فاتورة» فقط.
            </div>
            {error && <div className="text-sm text-rose-600 mt-3">{error}</div>}
            <div className="flex items-center gap-2 justify-end mt-4 border-t border-slate-100 pt-4">
              {saved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ للفرع النشط</span>}
              <button className="btn-primary" onClick={saveServiceCharge} disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ رسوم الخدمة'}
              </button>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
