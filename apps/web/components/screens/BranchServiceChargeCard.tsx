'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

/** Service-charge settings for the ACTIVE branch (restaurants/halls) — consumed by the POS/restaurant screens. */
export default function BranchServiceChargeCard() {
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
