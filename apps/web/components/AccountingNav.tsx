'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/accounting', label: 'شجرة الحسابات' },
  { href: '/accounting/journals', label: 'القيود' },
  { href: '/accounting/vouchers', label: 'السندات والشيكات' },
  { href: '/accounting/securities', label: 'الأوراق المالية والبنوك' },
  { href: '/accounting/bank-recon', label: 'المطابقة البنكية' },
  { href: '/accounting/assets', label: 'الأصول الثابتة' },
  { href: '/accounting/reports', label: 'التقارير المالية' },
];

/** Sub navigation shared by every accounting screen. */
export default function AccountingNav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link key={tab.href} href={tab.href} className={active ? 'btn-primary' : 'btn-soft'}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
