'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import AccountingNav from '@/components/AccountingNav';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';

type Account = {
  accountId: number; code: string; name: string; accountType: number;
  isGroup: boolean; isActive: boolean; normalSide: number;
  childCount: number; entryCount: number; children: Account[];
};

const TYPE_LABEL: Record<number, string> = {
  1: 'أصول', 2: 'خصوم', 3: 'حقوق ملكية', 4: 'إيرادات', 5: 'مصروفات',
};

export default function AccountingAccountsPage() {
  const { session, can } = useSession();
  const [tree, setTree] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [periods, setPeriods] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const canManage = can('accounting.manage');
  const canClose = can('accounting.close');

  async function load() {
    const [t, m, c, cur, p] = await Promise.all([
      apiFetch<Account[]>('/accounting/accounts?includeInactive=true'),
      apiFetch<any[]>('/accounting/mappings'),
      apiFetch<any[]>('/accounting/cost-centers'),
      apiFetch<any[]>('/accounting/currencies'),
      apiFetch<any[]>('/accounting/periods'),
    ]);
    setTree(t);
    setMappings(m);
    setCostCenters(c);
    setCurrencies(cur);
    setPeriods(p);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function saveMapping(key: string, accountId: number) {
    setError('');
    setMessage('');
    try {
      await apiFetch(`/accounting/mappings/${key}`, { method: 'PUT', body: { accountId } });
      setMessage('تم حفظ الربط المحاسبي');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function togglePeriod(id: number, close: boolean) {
    setError('');
    setMessage('');
    try {
      await apiFetch(`/accounting/periods/${id}/${close ? 'close' : 'reopen'}`, { method: 'POST' });
      setMessage(close ? 'تم إقفال الفترة' : 'تم فتح الفترة');
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function renderNode(node: Account, depth = 0): React.ReactNode {
    const hasChildren = node.children?.length > 0;
    const open = expanded[node.accountId] ?? depth < 2;
    return (
      <div key={node.accountId}>
        <div
          className={`flex items-center gap-2 py-1.5 border-b border-slate-100 text-sm ${node.isActive ? '' : 'opacity-50'}`}
          style={{ paddingInlineStart: depth * 20 }}
        >
          <button
            className="w-5 text-slate-400 hover:text-slate-700"
            onClick={() => setExpanded((s) => ({ ...s, [node.accountId]: !open }))}
            disabled={!hasChildren}
          >
            {hasChildren ? (open ? '▾' : '▸') : '·'}
          </button>
          <span className="font-mono text-xs text-slate-400 w-16">{node.code}</span>
          <span className={`flex-1 ${node.isGroup ? 'font-bold' : ''}`}>{node.name}</span>
          <span className="badge bg-slate-100 text-slate-600">{TYPE_LABEL[node.accountType]}</span>
          <span className="text-xs text-slate-400 w-20 text-left">
            {node.entryCount > 0 ? `${node.entryCount} حركة` : '—'}
          </span>
        </div>
        {hasChildren && open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  return (
    <AppShell title="المحاسبة">
      <AccountingNav />

      {error && <div className="card p-3 mb-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>}
      {message && <div className="card p-3 mb-3 border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">{message}</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card">
          <div className="card-title"><span>شجرة الحسابات</span></div>
          <div className="px-4 pb-4">
            {tree.map((node) => renderNode(node))}
            {tree.length === 0 && <div className="text-center text-slate-400 py-8">لا توجد حسابات</div>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="card-title"><span>الربط المحاسبي التلقائي</span></div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-slate-500">
                يحدد هذا الربط حساب كل مستند: أي حساب يُستخدم للمبيعات أو المخزون أو الخزينة…
              </p>
              {mappings.map((row) => (
                <div key={row.mappingKey} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-40 shrink-0 truncate">{row.description ?? row.mappingKey}</span>
                  <select
                    className="input py-1 text-xs flex-1"
                    value={row.accountId ?? ''}
                    disabled={!canManage}
                    onChange={(e) => saveMapping(row.mappingKey, Number(e.target.value))}
                  >
                    {flatten(tree).map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.code} — {account.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><span>مراكز التكلفة</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الاسم</th><th>الحركات</th></tr></thead>
                <tbody>
                  {costCenters.map((row) => (
                    <tr key={row.costCenterId}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>{row.name}</td>
                      <td className="text-slate-400">{row.entryCount}</td>
                    </tr>
                  ))}
                  {costCenters.length === 0 && <tr><td colSpan={3} className="text-center text-slate-400 py-6">لا توجد مراكز</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><span>العملات</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الكود</th><th>الاسم</th><th>السعر</th></tr></thead>
                <tbody>
                  {currencies.map((row) => (
                    <tr key={row.currencyCode}>
                      <td className="font-mono text-xs">{row.currencyCode}</td>
                      <td>{row.name}</td>
                      <td className="font-bold">{Number(row.rate).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title"><span>الفترات المحاسبية</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الفترة</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                  {periods.map((row) => (
                    <tr key={row.periodId}>
                      <td className="font-semibold">{row.name}</td>
                      <td className="text-xs">{row.startDate}</td>
                      <td className="text-xs">{row.endDate ?? '—'}</td>
                      <td>
                        <span className={`badge ${row.isClosed ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                          {row.isClosed ? 'مقفلة' : 'مفتوحة'}
                        </span>
                      </td>
                      <td>
                        {canClose && (
                          <button
                            className="btn-soft text-xs"
                            onClick={() => togglePeriod(row.periodId, !row.isClosed)}
                          >
                            {row.isClosed ? 'فتح' : 'إقفال'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {periods.length === 0 && <tr><td colSpan={5} className="text-center text-slate-400 py-6">لا توجد فترات</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {session && (
            <div className="card p-4 text-xs text-slate-500 space-y-1">
              <div className="font-bold text-slate-700">ملاحظات</div>
              <div>• إقفال الفترة يمنع ترحيل أي مستند بتاريخ داخلها.</div>
              <div>• تغيير الربط يؤثر على المستندات الجديدة فقط.</div>
              <div>• الحسابات التجميعية لا تقبل القيود المباشرة.</div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Flattens the account tree for the mapping dropdowns. */
function flatten(nodes: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (list: Account[]) => {
    for (const node of list) {
      if (!node.isGroup) out.push(node);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes ?? []);
  return out;
}
