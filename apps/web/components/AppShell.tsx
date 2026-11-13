'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/lib/session';
import { useOfflineQueue } from '@/lib/offline';

type NavItem = { href: string; label: string; icon: string; permission?: string };

const NAV: NavItem[] = [
  { href: '/', label: 'الرئيسية', icon: '🏠', permission: 'dashboard.view' },
  { href: '/pos', label: 'نقطة البيع', icon: '🛒', permission: 'pos.operate' },
  { href: '/restaurant', label: 'المطاعم', icon: '🍽️', permission: 'pos.operate' },
  { href: '/invoices', label: 'الفواتير', icon: '🧾', permission: 'sales.view' },
  { href: '/documents', label: 'العروض والأوامر', icon: '📑', permission: 'sales.view' },
  { href: '/items', label: 'الأصناف', icon: '📦', permission: 'items.view' },
  { href: '/pricing', label: 'قوائم الأسعار', icon: '🏷️', permission: 'items.view' },
  { href: '/inventory', label: 'المخزون', icon: '🏬', permission: 'stock.view' },
  { href: '/stock-count', label: 'سند الجرد', icon: '🧮', permission: 'stock.view' },
  { href: '/stock-voucher', label: 'أذون المخازن', icon: '📦', permission: 'stock.view' },
  { href: '/parties', label: 'العملاء والموردين', icon: '👥', permission: 'parties.view' },
  { href: '/installments', label: 'التقسيط', icon: '📆', permission: 'parties.ledger' },
  { href: '/treasury', label: 'الخزينة', icon: '💰', permission: 'cash.view' },
  { href: '/accounting', label: 'المحاسبة', icon: '📚', permission: 'accounting.view' },
  { href: '/reports', label: 'التقارير', icon: '📊', permission: 'reports.view' },
  { href: '/hr', label: 'شئون العاملين', icon: '👔', permission: 'hr.view' },
  { href: '/admin', label: 'الإعدادات', icon: '⚙️', permission: 'users.manage' },
];

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

  const items = NAV.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 right-0 z-40 w-64 bg-slate-900 text-slate-200 flex flex-col transition-transform
                    lg:static lg:translate-x-0 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="px-5 py-5 border-b border-white/10">
          <div className="text-lg font-extrabold text-white">واصل <span className="text-brand-400">ERP</span></div>
          <div className="text-[11px] text-slate-400 mt-1">نظام إدارة الفروع والمبيعات</div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active ? 'bg-brand-600 text-white' : 'hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 text-xs text-slate-400">
          الإصدار 1.0.0 · WaselERP
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden btn-soft px-3" onClick={() => setOpen(true)} aria-label="القائمة">☰</button>

          <h1 className="font-bold text-slate-700 text-lg hidden sm:block">{title ?? 'واصل ERP'}</h1>

          <div className="flex-1" />

          {!queue.online && (
            <span className="badge bg-rose-50 text-rose-700">📴 أوفلاين</span>
          )}
          {queue.pendingCount > 0 && (
            <button
              className="badge bg-amber-50 text-amber-700"
              onClick={() => queue.flush()}
              title="إرسال الفواتير المحفوظة محليًا"
            >
              {queue.pendingCount} بانتظار الإرسال
            </button>
          )}

          {session.branches.length > 1 && (
            <select
              className="input w-44 py-2"
              value={session.activeBranchId ?? ''}
              onChange={(e) => switchBranch(Number(e.target.value))}
            >
              {session.branches.map((branch) => (
                <option key={branch.branchId} value={branch.branchId}>{branch.name}</option>
              ))}
            </select>
          )}

          <div className="hidden md:flex items-center gap-2 text-sm">
            <span className="font-semibold text-slate-700">{session.user.fullName}</span>
            <span className="badge bg-brand-50 text-brand-700">
              {session.branches.find((b) => b.branchId === session.activeBranchId)?.name ?? 'فرع'}
            </span>
          </div>

          <button className="btn-soft" onClick={logout}>خروج</button>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
