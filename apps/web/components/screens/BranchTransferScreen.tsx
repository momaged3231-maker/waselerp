'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiFetch, formatDate, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import DeleteButton from '@/components/DeleteButton';

const STATUS: Record<number, string> = {
  1: 'مسودة',
  2: 'صادر — بانتظار الاستلام',
  4: 'مكتمل — مستلم',
  5: 'ملغي',
};

const badgeFor = (status: number) =>
  status === 1 ? 'bg-slate-100 text-slate-600'
  : status === 2 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
  : status === 4 ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
  : 'bg-rose-50 text-rose-600 ring-1 ring-rose-200';

export default function BranchTransferScreen() {
  const { session, can } = useSession();
  const activeBranch = Number(session?.activeBranchId ?? 0);

  const canView = can('transfer.interbranch.view');
  const canManage = can('transfer.interbranch.manage');
  const canCancel = can('transfer.interbranch.cancel');

  const [rows, setRows] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [sourceWarehouses, setSourceWarehouses] = useState<any[]>([]);
  const [destWarehouses, setDestWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [itemSearch, setItemSearch] = useState('');

  const [statusFilter, setStatusFilter] = useState(0);
  const [search, setSearch] = useState('');

  const [headerForm, setHeaderForm] = useState({
    toBranchId: 0, fromWarehouseId: 0, toWarehouseId: 0, transferDate: '', notes: '',
  });
  const [lineForm, setLineForm] = useState({ itemId: 0, unitId: 1, quantity: 0, serialNo: '', expiryDate: '', notes: '' });

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((i: any) =>
      String(i.code ?? '').toLowerCase().includes(q) || String(i.name ?? '').toLowerCase().includes(q))
      .slice(0, 50);
  }, [items, itemSearch]);

  async function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', String(statusFilter));
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '100');
    const [list, wh, branchRows, itemRows] = await Promise.all([
      apiFetch<any[]>(`/branch-transfers?${params.toString()}`),
      apiFetch<any[]>('/catalog/warehouses'),
      apiFetch<any[]>('/catalog/branches'),
      apiFetch<any>('/items?pageSize=200'),
    ]);
    setRows(list);
    setSourceWarehouses(wh);
    setBranches(branchRows.filter((b: any) => b.branchId !== activeBranch && b.isActive !== false));
    setItems(itemRows.items ?? itemRows);
  }

  useEffect(() => { load().catch((e) => setError(e.message)); }, [statusFilter]);

  // Load destination warehouses whenever the destination branch changes
  useEffect(() => {
    if (!headerForm.toBranchId) { setDestWarehouses([]); return; }
    apiFetch<any[]>(`/catalog/warehouses?branchId=${headerForm.toBranchId}`)
      .then(setDestWarehouses)
      .catch((e) => setError(e.message));
  }, [headerForm.toBranchId]);

  async function open(id: number) {
    setError(''); setMessage('');
    try {
      const detail = await apiFetch(`/branch-transfers/${id}`);
      setSelected(detail);
    } catch (e: any) { setError(e.message); }
  }

  async function createTransfer() {
    setError(''); setMessage('');
    if (!headerForm.fromWarehouseId || !headerForm.toWarehouseId) {
      setError('اختر مخزن المصدر بالكامل ثم مخزن الوجهة');
      return;
    }
    try {
      const result = await apiFetch<any>('/branch-transfers', {
        method: 'POST',
        body: {
          fromWarehouseId: Number(headerForm.fromWarehouseId),
          toWarehouseId: Number(headerForm.toWarehouseId),
          transferDate: headerForm.transferDate || undefined,
          notes: headerForm.notes || undefined,
          clientRequestId: `web-${crypto.randomUUID()}`,
        },
      });
      setMessage(`تم إنشاء التحويل ${result.transferNo}`);
      setHeaderForm({ toBranchId: 0, fromWarehouseId: 0, toWarehouseId: 0, transferDate: '', notes: '' });
      await open(result.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function addLine() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/lines`, {
        method: 'POST',
        body: { itemId: lineForm.itemId, unitId: lineForm.unitId, quantity: lineForm.quantity, serialNo: lineForm.serialNo || undefined, expiryDate: lineForm.expiryDate || undefined, notes: lineForm.notes || undefined },
      });
      setLineForm({ itemId: 0, unitId: 1, quantity: 0, serialNo: '', expiryDate: '', notes: '' });
      await open(selected.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function updateLine(lineId: number, field: string, value: any) {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/lines/${lineId}`, {
        method: 'PUT', body: { [field]: value },
      });
      await open(selected.branchTransferId);
    } catch (e: any) { setError(e.message); }
  }

  async function removeLine(lineId: number) {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/lines/${lineId}`, { method: 'DELETE' });
      await open(selected.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function removeDraft() {
    if (!selected) return;
    setError('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}`, { method: 'DELETE' });
      setSelected(null);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function approve() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/approve`, { method: 'POST', body: {} });
      setMessage('تم الاعتماد وصدور الحرد — البضاعة الآن في الطريق');
      await open(selected.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function receive() {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/receive`, { method: 'POST', body: {} });
      setMessage('تم الاستلام — أُقفل مخزون الوجهة بمبلغ مطابق للاعتماد');
      await open(selected.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function cancel() {
    if (!selected) return;
    const reason = window.prompt('سبب الإلغاء (إلزامي):');
    if (!reason || !reason.trim()) { setError('سبب الإلغاء إلزامي'); return; }
    setError(''); setMessage('');
    try {
      await apiFetch(`/branch-transfers/${selected.branchTransferId}/cancel`, {
        method: 'POST', body: { reason: reason.trim() },
      });
      setMessage('تم الإلغاء وعكس الأثر المخزني والمحاسبي');
      await open(selected.branchTransferId);
      await load();
    } catch (e: any) { setError(e.message); }
  }

  const isSource = selected && Number(selected.fromBranchId) === activeBranch;
  const isDest = selected && Number(selected.toBranchId) === activeBranch;
  const status = Number(selected?.status ?? 0);
  const totalValue = selected ? selected.lines.reduce((s: number, l: any) => s + Number(l.lineValue ?? 0), 0) : 0;

  if (!canView) {
    return (
      <div className="card p-6 text-center text-slate-500">
        لا تملك صلاحية عرض التحويلات بين الفروع — اطلب <span className="font-mono">transfer.interbranch.view</span> من مدير النظام.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 no-print">
        {/* ───────────────────────── القائمة + إنشاء ───────────────────────── */}
      <div className="space-y-4">
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-bold">التحويلات بين الفروع</div>
            <button className="btn-soft text-xs" onClick={() => { setSearch(''); load().catch(() => {}); }}>تحديث</button>
          </div>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="بحث برقم التحويل…" value={search}
              onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load().catch(() => {})} />
            <select className="input w-36" value={statusFilter} onChange={(e) => setStatusFilter(Number(e.target.value))}>
              <option value={0}>الكل</option>
              <option value={1}>مسودة</option>
              <option value={2}>بانتظار الاستلام</option>
              <option value={4}>مكتمل</option>
              <option value={5}>ملغي</option>
            </select>
          </div>
          <div className="max-h-none overflow-visible divide-y divide-slate-100">
            {rows.length === 0 && <div className="text-center text-slate-400 text-sm py-6">لا توجد تحويلات مطابقة</div>}
            {rows.map((row) => (
              <button key={row.branchTransferId} onClick={() => open(row.branchTransferId)}
                className={`w-full text-right px-2 py-2 hover:bg-slate-50 transition-colors ${selected?.branchTransferId === row.branchTransferId ? 'bg-sky-50' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{row.transferNo}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${badgeFor(Number(row.status))}`}>{STATUS[Number(row.status)]}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 flex items-center justify-between gap-2">
                  <span>{row.fromBranchName} ↤ {row.toBranchName}</span>
                  <span>{formatMoney(row.totalValue)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {canManage && (
          <div className="card p-4 space-y-3">
            <div className="font-bold">تحويل جديد <span className="text-xs font-normal text-slate-400">(من هذا الفرع إلى فرع آخر)</span></div>
            <div>
              <label className="label">مخزن المصدر (هذا الفرع)</label>
              <select className="input" value={headerForm.fromWarehouseId}
                onChange={(e) => setHeaderForm({ ...headerForm, fromWarehouseId: Number(e.target.value) })}>
                <option value={0}>اختر…</option>
                {sourceWarehouses.map((w: any) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">فرع الوجهة</label>
              <select className="input" value={headerForm.toBranchId}
                onChange={(e) => setHeaderForm({ ...headerForm, toBranchId: Number(e.target.value), toWarehouseId: 0 })}>
                <option value={0}>اختر الفرع…</option>
                {branches.map((b: any) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">مخزن الوجهة</label>
              <select className="input" value={headerForm.toWarehouseId} disabled={!headerForm.toBranchId}
                onChange={(e) => setHeaderForm({ ...headerForm, toWarehouseId: Number(e.target.value) })}>
                <option value={0}>{headerForm.toBranchId ? 'اختر المخزن…' : 'اختر الفرع أولًا'}</option>
                {destWarehouses.map((w: any) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">التاريخ</label>
                <input className="input" type="date" value={headerForm.transferDate}
                  onChange={(e) => setHeaderForm({ ...headerForm, transferDate: e.target.value })} />
              </div>
              <div>
                <label className="label">ملاحظات</label>
                <input className="input" value={headerForm.notes}
                  onChange={(e) => setHeaderForm({ ...headerForm, notes: e.target.value })} />
              </div>
            </div>
            <button className="btn-primary w-full" disabled={!headerForm.fromWarehouseId || !headerForm.toWarehouseId} onClick={createTransfer}>
              إنشاء سند التحويل
            </button>
          </div>
        )}
      </div>

      {/* ───────────────────────── تفاصيل المستند ───────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {error && <div className="card p-3 text-sm text-rose-600 border-rose-200">{error}</div>}
        {message && <div className="card p-3 text-sm text-emerald-700 border-emerald-200">{message}</div>}

        {!selected && <div className="card p-8 text-center text-slate-400">اختر تحويلًا من القائمة أو أنشئ واحدًا جديدًا</div>}

        {selected && (
          <>
            <div className="card">
              <div className="card-title flex-wrap gap-y-2">
                <span className="font-mono">{selected.transferNo}</span>
                <span className={`text-xs px-2.5 py-1 rounded-full ${badgeFor(status)}`}>
                  {status === 2 && '⚠ '}{STATUS[status]}
                </span>
                {status === 2 && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    البضاعة في الطريق — الحساب الوسيط 1108 يحمل قيمتها حتى الاستلام
                  </span>
                )}
                <div className="ms-auto flex gap-2">
                  <button className="btn-soft text-xs" onClick={() => window.print()}>طباعة A5</button>
                  {status === 1 && (
                    <DeleteButton screenKey="branchTransfers" className="btn-soft text-xs text-rose-600"
                      confirmText="حذف المسودة نهائيًا؟" label="حذف المسودة" onDelete={removeDraft} />
                  )}
                </div>
              </div>
              <div className="px-4 pb-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-slate-600">
                <div><div className="text-slate-400">من</div><div className="font-semibold">{selected.fromBranchName} ← {selected.fromWarehouseName}</div></div>
                <div><div className="text-slate-400">إلى</div><div className="font-semibold">{selected.toBranchName} ← {selected.toWarehouseName}</div></div>
                <div><div className="text-slate-400">التاريخ</div><div>{formatDate(selected.transferDate)}</div></div>
                <div><div className="text-slate-400">القيمة الإجمالية</div><div className="font-bold font-num">{formatMoney(selected.totalValue)}</div></div>
                {selected.outboundVoucherId && <div><div className="text-slate-400">حرد صادر</div><div className="font-mono">#{selected.outboundVoucherId}</div></div>}
                {selected.inboundVoucherId && <div><div className="text-slate-400">حرد وارد</div><div className="font-mono">#{selected.inboundVoucherId}</div></div>}
                {selected.outboundJournalId && <div><div className="text-slate-400">قيد الإصدار</div><div className="font-mono">#{selected.outboundJournalId}</div></div>}
                {selected.inboundJournalId && <div><div className="text-slate-400">قيد الاستلام</div><div className="font-mono">#{selected.inboundJournalId}</div></div>}
              </div>
            </div>

            <div className="card">
              <div className="card-title">بنود التحويل</div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر التكلفة</th><th>القيمة</th><th>السيريال</th>
                      {status === 1 && canManage && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line: any) => (
                      <tr key={line.lineId}>
                        <td className="text-xs">
                          <div className="font-semibold">{line.itemName}</div>
                          <div className="text-slate-400 font-mono">{line.itemCode}</div>
                        </td>
                        <td className="text-xs">{line.unitName}</td>
                        <td className="text-xs">
                          {status === 1 && canManage
                            ? <input className="input py-0.5 text-xs w-20" type="number" step="0.001" value={line.quantity} onChange={(e) => updateLine(line.lineId, 'quantity', Number(e.target.value))} />
                            : Number(line.quantity).toFixed(3)}
                        </td>
                        <td className="text-xs">{formatMoney(line.unitCost)}</td>
                        <td className="text-xs">{formatMoney(line.lineValue)}</td>
                        <td className="text-xs">{line.serialNo ?? '—'}</td>
                        {status === 1 && canManage && (
                          <td className="text-xs">
                            <button className="text-rose-600 hover:underline" onClick={() => removeLine(line.lineId)}>حذف</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {selected.lines.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-slate-400 py-6">لا توجد بنود — أضف أصنافًا من البطاقة الجانبية</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="px-4 pb-3 text-left text-sm font-bold">الإجمالي: <span className="font-num">{formatMoney(totalValue)}</span></div>
            </div>

            <div className="card p-4 flex flex-wrap gap-2 items-center">
              <div className="text-sm text-slate-500 me-auto">الإجراءات حسب حالة المستند والصلاحيات:</div>
              {status === 1 && isSource && canManage && (
                <button className="btn-primary" onClick={approve}>اعتماد وصدور الحرد (فرع المصدر)</button>
              )}
              {status === 2 && isDest && canManage && (
                <button className="btn-primary" onClick={receive}>استلام الوارد (فرع الوجهة)</button>
              )}
              {status === 2 && canCancel && (
                <button className="btn-soft text-rose-600 border-rose-200" onClick={cancel}>إلغاء وإعادة للمصدر</button>
              )}
              {status === 4 && <span className="text-xs text-emerald-700">مكتمل — لا يمكن تعديله أو إلغاؤه من هذه الشاشة (العكس بعد الاستلام يتطلب مستند عكس متكامل — خارج النسخة الحالية)</span>}
              {status === 5 && <span className="text-xs text-rose-600">ملغي{selected.cancelReason ? ` — ${selected.cancelReason}` : ''}{selected.cancelledAt ? ` (${formatDate(selected.cancelledAt)})` : ''}</span>}
              {status === 2 && isSource && !canManage && <span className="text-xs text-slate-400">الاعتماد من فرع المصدر فقط — بدّل الفرع من القائمة العلوية</span>}
              {status === 2 && isDest && !canManage && <span className="text-xs text-slate-400">الاستلام من فرع الوجهة فقط</span>}
            </div>

            {status === 1 && canManage && isSource && (
              <div className="card p-4 space-y-3">
                <div className="font-bold">إضافة أصناف للتحويل</div>
                <input className="input" placeholder="ابحث بكود أو اسم الصنف…" value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)} />
                <select className="input" value={lineForm.itemId} onChange={(e) => setLineForm({ ...lineForm, itemId: Number(e.target.value) })}>
                  <option value={0}>— اختر الصنف —</option>
                  {filteredItems.map((i: any) => <option key={i.itemId} value={i.itemId}>{i.code} — {i.name}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="number" step="0.001" placeholder="الكمية"
                    value={lineForm.quantity || ''} onChange={(e) => setLineForm({ ...lineForm, quantity: Number(e.target.value) })} />
                  <input className="input" placeholder="الرقم المسلسل (اختياري)" value={lineForm.serialNo}
                    onChange={(e) => setLineForm({ ...lineForm, serialNo: e.target.value })} />
                </div>
                <div className="text-[11px] text-slate-500">التكلفة تُؤخذ تلقائيًا من متوسط تكلفة مخزن المصدر — لا تُقبل تكلفة يدوية.</div>
                <button className="btn-primary w-full" disabled={!lineForm.itemId || !lineForm.quantity} onClick={addLine}>إضافة للبند</button>
              </div>
            )}
          </>
        )}
      </div>

      </div>

      {/* ───────────────── إذن تحويل A5 — يُطبع فقط ───────────────── */}
      {selected && (
        <div className="bt-print-only" aria-hidden="true">
          <div style={{ width: '148mm', margin: '0 auto', fontFamily: 'inherit', color: '#0f172a' }}>
            <div style={{ border: '1.5px solid #0f172a', borderRadius: 8, padding: '14px 18px' }}>
              <div style={{ textAlign: 'center', borderBottom: '2px solid #0f172a', paddingBottom: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>إذن تحويل بين فروع</div>
                <div style={{ fontSize: 11, color: '#475569' }}>وثيقة رسمية — لا تُعدَّل بعد الاعتماد — تُعتمد بتوقيع الطرفين</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 8 }}>
                <div>الرقم: <b className="font-mono">{selected.transferNo}</b></div>
                <div>التاريخ: <b>{formatDate(selected.transferDate)}</b></div>
                <div>الحالة: <b>{STATUS[status]}</b></div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, marginBottom: 8 }}>
                <div style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ color: '#64748b', fontSize: 10 }}>من (المُسلِّم)</div>
                  <div><b>{selected.fromBranchName}</b></div>
                  <div>المخزن: {selected.fromWarehouseName}</div>
                </div>
                <div style={{ flex: 1, border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px' }}>
                  <div style={{ color: '#64748b', fontSize: 10 }}>إلى (المُستلِم)</div>
                  <div><b>{selected.toBranchName}</b></div>
                  <div>المخزن: {selected.toWarehouseName}</div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    {['#', 'الصنف', 'الكود', 'الكمية', 'تكلفة الوحدة', 'القيمة'].map((h) => (
                      <th key={h} style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l: any, i: number) => (
                    <tr key={l.lineId}>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{i + 1}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{l.itemName}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', fontFamily: 'monospace' }}>{l.itemCode}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{Number(l.quantity).toFixed(3)}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{formatMoney(l.unitCost)}</td>
                      <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{formatMoney(l.lineValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ border: '1px solid #0f172a', padding: '4px 6px', fontWeight: 800, textAlign: 'left' }}>الإجمالي</td>
                    <td style={{ border: '1px solid #0f172a', padding: '4px 6px', fontWeight: 800 }}>{formatMoney(totalValue)}</td>
                  </tr>
                </tfoot>
              </table>
              {selected.notes && <div style={{ fontSize: 11, marginTop: 6 }}>ملاحظات: {selected.notes}</div>}
              <div style={{ display: 'flex', gap: 24, marginTop: 26, fontSize: 11 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ borderTop: '1px solid #0f172a', paddingTop: 4 }}>توقيع المُسلِّم (فرع المصدر) — الاسم والتوقيع والختم</div>
                  <div style={{ height: 40 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ borderTop: '1px solid #0f172a', paddingTop: 4 }}>توقيع المُستلِم (فرع الوجهة) — الاسم والتوقيع والختم</div>
                  <div style={{ height: 40 }} />
                </div>
              </div>
              <div style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 8 }}>
                تُسلَّم نسخة للأرشيف ونسخة لفرع الوجهة — أي عجز/زيادة عند الاستلام يُسجَّل على سند الاستلام بحضور الطرفين.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
