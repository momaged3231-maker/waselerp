'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ComponentType } from 'react';
import { useSession } from '@/lib/session';
import { useOfflineQueue } from '@/lib/offline';
import {
  IconHome, IconCart, IconUtensils, IconWrench, IconReceipt, IconFileText, IconBox,
  IconTag, IconWarehouse, IconClipboardCheck, IconPackage, IconArrowsSwitch, IconUsers,
  IconCalendar, IconWallet, IconBookOpen, IconChartBar, IconBriefcase,
  IconBarcode, IconDeviceMobile, IconBell, IconFolder, IconSettings, IconLogout,
  IconMenu, IconCloudUp, IconWifiOff, IconBuilding, IconChevronDown,
} from '@/components/icons';

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: string;
};

type NavGroup = { key: string; label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    label: 'نظرة عامة',
    items: [
      { href: '/', label: 'الرئيسية', icon: IconHome, permission: 'dashboard.view' },
      { href: '/reminders', label: 'التذكيرات', icon: IconBell, permission: 'dashboard.view' },
    ],
  },
  {
    key: 'operations',
    label: 'التشغيل',
    items: [
      { href: '/pos', label: 'نقطة البيع', icon: IconCart, permission: 'pos.operate' },
      { href: '/restaurant', label: 'المطاعم', icon: IconUtensils, permission: 'pos.operate' },
      { href: '/maintenance', label: 'الصيانة', icon: IconWrench, permission: 'maintenance.view' },
    ],
  },
  {
    key: 'sales',
    label: 'المبيعات',
    items: [
      { href: '/invoices', label: 'الفواتير', icon: IconReceipt, permission: 'sales.view' },
      { href: '/documents', label: 'العروض والأوامر', icon: IconFileText, permission: 'sales.view' },
      { href: '/pricing', label: 'قوائم الأسعار', icon: IconTag, permission: 'items.view' },
      { href: '/parties', label: 'العملاء والموردين', icon: IconUsers, permission: 'parties.view' },
      { href: '/installments', label: 'التقسيط', icon: IconCalendar, permission: 'parties.ledger' },
    ],
  },
  {
    key: 'inventory',
    label: 'المخزون',
    items: [
      { href: '/items', label: 'الأصناف', icon: IconBox, permission: 'items.view' },
      { href: '/inventory', label: 'حركة المخزون', icon: IconWarehouse, permission: 'stock.view' },
      { href: '/stock-count', label: 'سند الجرد', icon: IconClipboardCheck, permission: 'stock.view' },
      { href: '/stock-voucher', label: 'أذون المخازن', icon: IconPackage, permission: 'stock.view' },
      { href: '/stock-transfer', label: 'تحويل غير مباشر', icon: IconArrowsSwitch, permission: 'stock.view' },
      { href: '/labels', label: 'ملصقات الأصناف', icon: IconBarcode, permission: 'stock.view' },
      { href: '/mobile-stocktake', label: 'جرد موبايل', icon: IconDeviceMobile, permission: 'stock.manage' },
    ],
  },
  {
    key: 'finance',
    label: 'المالية والمحاسبة',
    items: [
      { href: '/treasury', label: 'الخزينة', icon: IconWallet, permission: 'cash.view' },
      { href: '/accounting', label: 'المحاسبة', icon: IconBookOpen, permission: 'accounting.view' },
      { href: '/reports/builder', label: 'منشئ التقارير', icon: IconChartBar, permission: 'reports.view' },
      { href: '/reports', label: 'التقارير', icon: IconChartBar, permission: 'reports.view' },
    ],
  },
  {
    key: 'system',
    label: 'النظام والإدارة',
    items: [
      { href: '/hr', label: 'شئون العاملين', icon: IconBriefcase, permission: 'hr.view' },
      { href: '/crm', label: 'إدارة العملاء CRM', icon: IconUsers, permission: 'crm.view' },
      { href: '/definitions', label: 'البيانات الأساسية', icon: IconFolder, permission: 'items.view' },
      { href: '/admin', label: 'الإعدادات', icon: IconSettings, permission: 'users.manage' },
    ],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[parts.length - 1][0];
}

function LogoMark() {
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <rect width="38" height="38" rx="11" fill="#1447e1" />
      <rect x="8.5" y="8.5" width="21" height="21" rx="6.5" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M13.5 22.5 17 14l3.5 8.5 2.6-6.2 2.1 6.2" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const { session, loading, logout, can, switchBranch } = useSession();
  const queue = useOfflineQueue();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) router.replace('/login/');
  }, [loading, session, router]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">جارٍ التحميل…</div>
    );
  }

  const activeBranch = session.branches.find((b) => b.branchId === session.activeBranchId);

  const groups = NAV_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-50 focus:rounded-lg focus:bg-brand-700 focus:text-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold"
      >
        تخطي إلى المحتوى
      </a>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-[272px] bg-slate-950 text-slate-300 flex flex-col transition-transform duration-200 ease-out
                    lg:static lg:translate-x-0 ${open ? 'translate-x-0 shadow-2xl' : 'translate-x-full'}`}
      >
        {/* Brand */}
        <div className="px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <LogoMark />
            <div className="min-w-0">
              <div className="text-[17px] font-extrabold text-white leading-6 tracking-tight">
                واصل <span className="text-brand-400">ERP</span>
              </div>
              <div className="text-[10.5px] text-slate-500 leading-4 mt-0.5">نظام إدارة الفروع والمبيعات</div>
            </div>
          </div>
          {activeBranch && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 py-2">
              <IconBuilding className="w-4 h-4 text-brand-300 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-slate-500 leading-4">الفرع النشط</div>
                <div className="text-[12px] font-bold text-slate-100 leading-4 truncate">{activeBranch.name}</div>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 scrollbar-dark" aria-label="التنقل الرئيسي">
          {groups.map((group) => (
            <div key={group.key} className="mb-3 last:mb-0">
              <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const IconCmp = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-3 py-[9px] text-[13px] font-medium cursor-pointer transition-colors duration-150 outline-none
                        focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset
                        ${active
                          ? 'bg-brand-600/15 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'}`}
                    >
                      {active && (
                        <span className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-brand-400" aria-hidden="true" />
                      )}
                      <IconCmp
                        className={`w-[18px] h-[18px] shrink-0 transition-colors duration-150 ${
                          active ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-200'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User + version */}
        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04] transition-colors duration-150">
            <div
              className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-white text-[12px] font-extrabold flex items-center justify-center select-none"
              aria-hidden="true"
            >
              {initials(session.user.fullName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold text-slate-100 leading-4 truncate">{session.user.fullName}</div>
              <div className="text-[10px] text-slate-500 leading-4 mt-0.5 truncate" dir="ltr">@{session.user.userName}</div>
            </div>
            <button
              onClick={logout}
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              className="w-9 h-9 rounded-lg inline-flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <IconLogout className="w-[18px] h-[18px]" />
            </button>
          </div>
          <div className="px-2 pt-2 flex items-center justify-between text-[10px] text-slate-600">
            <span>WaselERP · الإصدار 1.0.0</span>
            <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />متصل</span>
          </div>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-14 bg-white/95 backdrop-blur border-b border-slate-200 px-4 flex items-center gap-3">
          <button
            className="lg:hidden w-10 h-10 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            onClick={() => setOpen(true)}
            aria-label="فتح القائمة"
          >
            <IconMenu className="w-5 h-5" />
          </button>

          <h1 className="font-extrabold text-slate-800 text-[15px] hidden sm:block truncate">{title ?? 'لوحة المعلومات'}</h1>

          <div className="flex-1" />

          {!queue.online && (
            <span className="badge bg-rose-50 text-rose-700 gap-1.5 border border-rose-200">
              <IconWifiOff className="w-3.5 h-3.5" /> أوفلاين
            </span>
          )}
          {queue.pendingCount > 0 && (
            <button
              className="badge bg-amber-50 text-amber-800 gap-1.5 border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              onClick={() => queue.flush()}
              title="إرسال الفواتير المحفوظة محليًا"
            >
              <IconCloudUp className="w-3.5 h-3.5" />
              {queue.pendingCount} بانتظار الإرسال
            </button>
          )}

          {session.branches.length > 1 && (
            <label className="relative inline-flex items-center">
              <span className="sr-only">اختيار الفرع</span>
              <select
                className="appearance-none h-9 ps-3 pe-8 rounded-lg border border-slate-200 bg-slate-50 text-[12px] font-bold text-slate-700 hover:border-slate-300 hover:bg-white transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand-500 max-w-[180px]"
                value={session.activeBranchId ?? ''}
                onChange={(e) => switchBranch(Number(e.target.value))}
              >
                {session.branches.map((branch) => (
                  <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>
                ))}
              </select>
              <IconChevronDown className="w-4 h-4 text-slate-400 absolute left-2 pointer-events-none" />
            </label>
          )}
        </header>

        <main id="main-content" className="flex-1 p-4 lg:p-6 scroll-mt-20">{children}</main>
      </div>
    </div>
  );
}
