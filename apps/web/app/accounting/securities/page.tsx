'use client';

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import ChecksScreen from '@/components/screens/ChecksScreen';
import BankTransactionsScreen from '@/components/screens/BankTransactionsScreen';
import SecuritiesReportScreen from '@/components/screens/SecuritiesReportScreen';
import BankReportScreen from '@/components/screens/BankReportScreen';

type Tab = 'checks' | 'bank-transactions' | 'securities-report' | 'bank-report';
const TABS: [Tab, string][] = [
  ['checks', 'أوراق القبض والدفع'],
  ['bank-transactions', 'المعاملات البنكية'],
  ['securities-report', 'تقرير الاوراق الماليه'],
  ['bank-report', 'تقرير الحسابات البنكيه'],
];

/**
 * «الأوراق المالية والبنوك» — instruments (checks/notes receivable & payable),
 * bank transactions, and the two reports. Ctrl+R navigates here (Ezees reference).
 */
export default function SecuritiesPage() {
  const [tab, setTab] = useState<Tab>('checks');

  return (
    <AppShell title="الأوراق المالية والبنوك">
      <AccountingNav />
      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'btn-primary' : 'btn-soft'} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'checks' && <ChecksScreen />}
      {tab === 'bank-transactions' && <BankTransactionsScreen />}
      {tab === 'securities-report' && <SecuritiesReportScreen />}
      {tab === 'bank-report' && <BankReportScreen />}
    </AppShell>
  );
}
