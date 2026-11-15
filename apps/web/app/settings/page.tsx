'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import {
  SettingsProvider, useSettings,
  SettingSections, AllSettingsRaw, ADVANCED_UNAVAILABLE,
  GENERAL_SECTIONS, INVOICE_SECTIONS, PRINTER_SECTIONS, BARCODE_SECTIONS, EXTRAS_SECTIONS, POS_SECTIONS,
} from '@/components/screens/SettingsKit';
import ServerSettingsScreen from '@/components/screens/ServerSettingsScreen';
import RestaurantSettingsScreen from '@/components/screens/RestaurantSettingsScreen';
import UsersSettingsScreen from '@/components/screens/UsersSettingsScreen';
import RolesSettingsScreen from '@/components/screens/RolesSettingsScreen';
import BranchServiceChargeCard from '@/components/screens/BranchServiceChargeCard';
import PrintProfilesScreen from '@/components/screens/PrintProfilesScreen';
import EtaSettingsScreen from '@/components/screens/EtaSettingsScreen';
import ZatcaSettingsScreen from '@/components/screens/ZatcaSettingsScreen';
import BackupScreen from '@/components/screens/BackupScreen';

type SettingTab =
  | 'general'
  | 'server'
  | 'invoice'
  | 'printer'
  | 'barcode'
  | 'extras'
  | 'pos'
  | 'restaurants'
  | 'users'
  | 'roles'
  | 'system'
  | 'advanced'
  | 'print-profiles'
  | 'eta'
  | 'zatca'
  | 'backup';

const TABS: { key: SettingTab; label: string }[] = [
  { key: 'general', label: 'إعدادات عامة' },
  { key: 'server', label: 'إعدادات السيرفر' },
  { key: 'invoice', label: 'إعدادات الفواتير' },
  { key: 'printer', label: 'إعدادات الطابعة' },
  { key: 'barcode', label: 'طباعة الباركود' },
  { key: 'extras', label: 'إعدادات إضافية' },
  { key: 'pos', label: 'POS' },
  { key: 'restaurants', label: 'مطاعم' },
  { key: 'users', label: 'المستخدمون' },
  { key: 'roles', label: 'الأدوار والصلاحيات' },
  { key: 'system', label: 'إعدادات النظام' },
  { key: 'advanced', label: 'الإعدادات المتقدمة' },
  { key: 'print-profiles', label: 'ملفات الطباعة (المحطات)' },
  { key: 'eta', label: 'الفاتورة الإلكترونية (مصر)' },
  { key: 'zatca', label: 'الضريبة الإلكترونية (السعودية)' },
  { key: 'backup', label: 'النسخ الاحتياطي' },
];

function SettingsInner() {
  const [tab, setTab] = useState<SettingTab>('general');
  const { map, loading, error, savedAt, saveAll, reloadAll, bumpRefresh, refreshKey } = useSettings();

  const saved = savedAt !== null && Date.now() - savedAt < 4000;

  const renderTab = () => {
    switch (tab) {
      case 'general':
        return <SettingSections sections={GENERAL_SECTIONS} />;
      case 'server':
        return <ServerSettingsScreen />;
      case 'invoice':
        return <SettingSections sections={INVOICE_SECTIONS} />;
      case 'printer':
        return <SettingSections sections={PRINTER_SECTIONS} />;
      case 'barcode':
        return <SettingSections sections={BARCODE_SECTIONS} />;
      case 'extras':
        return <SettingSections sections={EXTRAS_SECTIONS} />;
      case 'pos':
        return <SettingSections sections={POS_SECTIONS} />;
      case 'restaurants':
        return <RestaurantSettingsScreen />;
      case 'users':
        return <UsersSettingsScreen />;
      case 'roles':
        return <RolesSettingsScreen />;
      case 'system':
        return <AllSettingsRaw />;
      case 'advanced':
        return (
          <div className="space-y-4 max-w-5xl">
            <div className="card p-4">
              <div className="font-extrabold text-slate-800">الإعدادات المتقدمة</div>
              <div className="text-xs text-slate-500 mt-1">
                القابلة للتطبيق في WaselERP (ويب + PostgreSQL + وكيل طباعة) — مقسمة حسب «على الجهاز» / «للفرع النشط»، مثل تبويبات «اعدادات الطابعه» و«POS» و«اعدادات السيرفر» في دليل Ezees.
                البنود غير المدعومة موضحة بالأسباب في أسفل الصفحة بدل حقول وهمية.
              </div>
            </div>
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
        );
      case 'print-profiles':
        return <PrintProfilesScreen />;
      case 'eta':
        return <EtaSettingsScreen />;
      case 'zatca':
        return <ZatcaSettingsScreen />;
      case 'backup':
        return <BackupScreen />;
      default:
        return null;
    }
  };

  return (
    <AppShell title="الإعدادات">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={tab === t.key ? 'btn-primary' : 'btn-soft'}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={saveAll} disabled={loading}>حفظ</button>
        <button className="btn-soft" onClick={async () => { await reloadAll(); bumpRefresh(); }} disabled={loading}>تحديث البيانات</button>
        {saved && <span className="badge bg-emerald-50 text-emerald-700">✓ تم الحفظ بنجاح</span>}
        {loading && <span className="text-xs text-slate-400">جارٍ تحميل الإعدادات…</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
        <div className="flex-1" />
        <span className="text-[11px] text-slate-400">«حفظ» يحفظ الإعدادات فقط — باقي التبويبات لها حفظها الخاص بها (المستخدمون / الأدوار / الباك آب / ETA / ZATCA / ملفات الطباعة)</span>
      </div>

      <div key={refreshKey}>
        {renderTab()}
      </div>
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <SettingsProvider>
      <SettingsInner />
    </SettingsProvider>
  );
}
