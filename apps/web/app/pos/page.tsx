'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLiveEvents } from '@/lib/live';
import { isNetworkError, offlineQueue, useOfflineQueue } from '@/lib/offline';
import { agentHealth, openDrawer, printReceipt } from '@/lib/print';

type ItemUnit = {
  unitId: number; unitName: string; factor: number;
  sellPrice?: number; buyPrice?: number; isDefault?: boolean;
};

type Line = {
  itemId: number; code: string; name: string; unitId: number; unitName?: string;
  quantity: number; unitPrice: number; discountPct: number; taxPct: number; onHandQty: number;
  factor: number; units: ItemUnit[];
};

export default function PosPage() {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [cashAccounts, setCashAccounts] = useState<any[]>([]);
  const [cashAccountId, setCashAccountId] = useState<number | null>(null);
  const [parties, setParties] = useState<any[]>([]);
  const [partyId, setPartyId] = useState<number | null>(null);
  const [paymentType, setPaymentType] = useState(1);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [printError, setPrintError] = useState('');
  const [currentShift, setCurrentShift] = useState<any>(null);
  const [requireShift, setRequireShift] = useState(false);
  const [shiftAccountId, setShiftAccountId] = useState<number | null>(null);
  const [shiftOpening, setShiftOpening] = useState<number>(0);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [secondPayment, setSecondPayment] = useState<{ method: number; amount: number; accountId: number | null } | null>(null);
  const [orderType, setOrderType] = useState(1);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [heldCarts, setHeldCarts] = useState<any[]>([]);
  const [returnMode, setReturnMode] = useState(false);
  const [returnNo, setReturnNo] = useState('');
  const [returnInvoice, setReturnInvoice] = useState<any>(null);
  const [returnLines, setReturnLines] = useState<any[]>([]);

  async function loadHeld() {
    apiFetch<any[]>('/pos/held').then(setHeldCarts).catch(() => {});
  }

  async function findInvoice() {
    setMessage('');
    setError('');
    try {
      const data = await apiFetch<any>(`/sales/invoices?search=${encodeURIComponent(returnNo.trim())}&type=1`);
      const row = (data.items ?? []).find((item: any) => item.invoiceNo === returnNo.trim());
      if (!row) { setError('لا توجد فاتورة بهذا الرقم'); return; }
      const detail = await apiFetch(`/sales/invoices/${row.invoiceId}`);
      setReturnInvoice(detail);
      setReturnLines(detail.lines.map((line: any) => ({
        itemId: line.itemId, unitId: line.unitId, quantity: 0,
        maxQuantity: Number(line.quantity), unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct), taxPct: Number(line.taxPct),
        name: line.itemName,
      })));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function submitReturn() {
    setMessage('');
    setError('');
    const lines = returnLines.filter((line) => Number(line.quantity) > 0);
    if (!lines.length) { setError('حدد الكميات المراد إرجاعها'); return; }
    try {
      const result = await apiFetch('/sales/invoices', {
        method: 'POST',
        body: {
          invoiceType: 3,
          branchId: session?.activeBranchId,
          warehouseId: returnInvoice.header.warehouseId,
          partyId: returnInvoice.header.partyId ?? undefined,
          paymentType: 2,
          parentInvoiceId: returnInvoice.header.invoiceId,
          notes: `مرتجع كاشير — ${returnInvoice.header.invoiceNo}`,
          lines: lines.map((line) => ({
            itemId: line.itemId, unitId: line.unitId, quantity: line.quantity,
            unitPrice: line.unitPrice, discountPct: line.discountPct, taxPct: line.taxPct,
          })),
        },
      });
      setMessage(`تم إنشاء المرتجع ${result.invoiceNo}`);
      setReturnInvoice(null);
      setReturnLines([]);
      setReturnNo('');
      setReturnMode(false);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => { loadHeld(); }, [session?.activeBranchId]);

  async function parkCart() {
    setMessage('');
    try {
      await apiFetch('/pos/held', {
        method: 'POST',
        body: {
          partyId: partyId ?? undefined,
          customerName: selectedParty?.name,
          warehouseId,
          lines: cart.map((l) => ({
            itemId: l.itemId, unitId: l.unitId, quantity: l.quantity, unitPrice: l.unitPrice,
          })),
        },
      });
      setCart([]);
      setPartyId(null);
      setDiscountPct(0);
      setMessage('تم تعليق الفاتورة');
      await loadHeld();
    } catch (error: any) {
      setMessage(error?.message ?? 'تعذر تعليق الفاتورة');
    }
  }

  async function resumeCart(held: any) {
    setCart((held.payload?.lines ?? []).map((line: any) => ({
      itemId: line.itemId,
      code: '',
      name: '',
      unitId: line.unitId,
      unitName: '',
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: 0,
      taxPct: 0,
      onHandQty: 0,
      factor: 1,
      units: [],
    })));
    setPartyId(held.partyId ?? null);
    await apiFetch(`/pos/held/${held.heldId}`, { method: 'DELETE' });
    await loadHeld();
    setMessage('تم استرجاع الفاتورة المعلّقة');
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const queue = useOfflineQueue();

  async function loadAccounts() {
    const rows = await apiFetch<any[]>('/treasury/accounts').catch(() => []);
    setCashAccounts(rows);
    return rows;
  }

  async function loadShift() {
    const [shift, policy] = await Promise.all([
      apiFetch<any>('/treasury/shifts/current').catch(() => null),
      apiFetch<any>('/treasury/shifts/policy').catch(() => ({ requireShift: false })),
    ]);
    setCurrentShift(shift);
    setRequireShift(!!policy?.requireShift);
    if (shift?.cashAccountId) setCashAccountId(Number(shift.cashAccountId));
    return shift;
  }

  useEffect(() => {
    if (!session) return;
    apiFetch('/catalog/warehouses').then((rows: any[]) => {
      setWarehouses(rows);
      if (rows.length) setWarehouseId(rows.find((r) => r.isDefault)?.warehouseId ?? rows[0].warehouseId);
    }).catch(() => {});
    loadAccounts().then((rows) => {
      setCashAccountId((value) => value ?? rows[0]?.cashAccountId ?? null);
      setShiftAccountId((value) => value ?? rows[0]?.cashAccountId ?? null);
    });
    loadShift();
    agentHealth().then((health) => setAgentOnline(!!health?.ok)).catch(() => setAgentOnline(false));
  }, [session?.activeBranchId]);

  async function openShift() {
    setShiftError('');
    setShiftBusy(true);
    try {
      const accountId = shiftAccountId ?? cashAccounts[0]?.cashAccountId;
      if (!accountId) { setShiftError('لا يوجد حساب خزينة في هذا الفرع'); return; }
      await apiFetch('/treasury/shifts/open', {
        method: 'POST',
        body: { cashAccountId: accountId, openingBalance: Number(shiftOpening) },
      });
      setShiftOpening(0);
      await loadAccounts();
      await loadShift();
    } catch (error: any) {
      setShiftError(error?.message ?? 'تعذر فتح الوردية');
    } finally {
      setShiftBusy(false);
    }
  }

  // live updates from other branches (stock / prices / new invoices)
  const refreshTimer = useRef<any>(null);
  useLiveEvents((event) => {
    if (event.type === 'connected') return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      apiFetch(`/items?search=${encodeURIComponent(search)}&pageSize=40&partyId=${partyId ?? ''}`)
        .then((data: any) => setResults(data.items ?? []))
        .catch(() => {});
    }, 400);
  });

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      apiFetch(`/items?search=${encodeURIComponent(search)}&pageSize=40&partyId=${partyId ?? ''}`)
        .then((data: any) => setResults(data.items ?? []))
        .catch(() => {});
    }, 220);
    return () => clearTimeout(timer);
  }, [search, session?.activeBranchId, partyId]);

  async function searchParty(term: string) {
    const data = await apiFetch<any>(`/parties?search=${encodeURIComponent(term)}&type=1&pageSize=20`);
    setParties(data.items ?? []);
  }

  function addItem(item: any) {
    setCart((current) => {
      const existing = current.find((l) => l.itemId === item.itemId);
      if (existing) {
        return current.map((l) => (l.itemId === item.itemId
          ? { ...l, quantity: l.quantity + 1 }
          : l));
      }
      const units: ItemUnit[] = (item.units ?? []).map((unit: any) => ({
        unitId: unit.unitId,
        unitName: unit.unitName,
        factor: Number(unit.factor),
        sellPrice: unit.sellPrice === null ? undefined : Number(unit.sellPrice),
        isDefault: unit.isDefault,
      }));
      const defaultUnit = units.find((unit) => unit.isDefault) ?? units[0];
      const unitId = defaultUnit?.unitId ?? item.baseUnitId;
      // The item search already returns the price of the customer's list.
      const unitPrice = item.listPrice !== undefined && item.listPrice !== null
        ? Number(item.listPrice)
        : (defaultUnit?.sellPrice ?? Number(item.sellPrice ?? 0));

      return [...current, {
        itemId: item.itemId,
        code: item.code,
        name: item.name,
        unitId,
        unitName: defaultUnit?.unitName ?? item.baseUnitName,
        quantity: 1,
        unitPrice,
        discountPct: Number(item.discountPct ?? 0),
        taxPct: Number(item.vatPct ?? 0),
        onHandQty: Number(item.onHandQty ?? 0),
        factor: defaultUnit?.factor ?? 1,
        units,
      }];
    });
  }

  /** Switching the selling unit keeps the quantity and applies that unit's price. */
  function changeLineUnit(itemId: number, unitId: number) {
    setCart((current) => current.map((line) => {
      if (line.itemId !== itemId) return line;
      const unit = line.units.find((u) => u.unitId === unitId);
      if (!unit) return line;
      return {
        ...line,
        unitId: unit.unitId,
        unitName: unit.unitName,
        factor: unit.factor,
        unitPrice: unit.sellPrice ?? line.unitPrice,
      };
    }));
  }

  function changeQuantity(itemId: number, delta: number) {
    setCart((current) => current
      .map((l) => (l.itemId === itemId ? { ...l, quantity: Math.max(0, l.quantity + delta) } : l))
      .filter((l) => l.quantity > 0));
  }

  function setLinePrice(itemId: number, price: number) {
    setCart((current) => current.map((l) => (l.itemId === itemId ? { ...l, unitPrice: price } : l)));
  }

  function setLineDiscount(itemId: number, pct: number) {
    const max = session?.user.maxDiscountPct ?? 0;
    const value = Math.min(pct, max);
    setCart((current) => current.map((l) => (l.itemId === itemId ? { ...l, discountPct: value } : l)));
  }

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const lineDiscount = cart.reduce((sum, l) => sum + l.quantity * l.unitPrice * (l.discountPct / 100), 0);
    const afterLineDiscount = subtotal - lineDiscount;
    const headerDiscount = afterLineDiscount * (discountPct / 100);
    const taxable = afterLineDiscount - headerDiscount;
    const tax = cart.reduce((sum, l) => sum + l.quantity * l.unitPrice * (1 - l.discountPct / 100) * (l.taxPct / 100), 0);
    const fee = orderType === 2 ? Number(deliveryFee || 0) : 0;
    const total = taxable + tax + fee;
    return { subtotal, lineDiscount, headerDiscount, tax, fee, total, remaining: total - paidAmount };
  }, [cart, discountPct, paidAmount, orderType, deliveryFee]);

  async function checkout() {
    if (!cart.length) { setMessage('السلة فارغة'); return; }
    if (!warehouseId) { setMessage('اختر المخزن'); return; }
    if (requireShift && session?.user.isCashier && !currentShift) {
      setMessage('يجب فتح وردية قبل تسجيل البيع');
      return;
    }
    setBusy(true);
    setMessage('');

    const clientRequestId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Split payments: cash + card + wallet on a single invoice.
    const payments: any[] = [];
    if (paymentType === 1) {
      payments.push({ method: 1, amount: totals.total, cashAccountId: cashAccountId ?? undefined });
    } else if (paymentType === 3) {
      if (paidAmount > 0) {
        payments.push({ method: 1, amount: paidAmount, cashAccountId: cashAccountId ?? undefined });
      }
      if (secondPayment && secondPayment.amount > 0) {
        payments.push({
          method: secondPayment.method,
          amount: secondPayment.amount,
          cashAccountId: secondPayment.accountId ?? cashAccountId ?? undefined,
        });
      }
    }

    const payload = {
      invoiceType: 1,
      branchId: session?.activeBranchId,
      warehouseId,
      partyId: partyId ?? undefined,
      paymentType,
      cashAccountId: paymentType === 2 ? undefined : cashAccountId ?? undefined,
      paidAmount: paymentType === 1 ? totals.total : paymentType === 3 ? paidAmount : 0,
      payments: payments.length ? payments : undefined,
      orderType,
      deliveryAddress: orderType === 2 ? deliveryAddress : undefined,
      deliveryFee: orderType === 2 ? deliveryFee : 0,
      driverName: orderType === 2 ? driverName : undefined,
      driverPhone: orderType === 2 ? driverPhone : undefined,
      discountPct,
      discountAmount: 0,
      clientRequestId,
      lines: cart.map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        taxPct: l.taxPct,
      })),
    };

    try {
      const result = await apiFetch<any>('/sales/invoices', { method: 'POST', body: payload });
      const detail = await apiFetch<any>(`/sales/invoices/${result.invoiceId}`);
      setReceipt(detail);
      setCart([]);
      setPartyId(null);
      setPaidAmount(0);
      setDiscountPct(0);
      searchRef.current?.focus();
    } catch (error: any) {
      if (isNetworkError(error)) {
        // no connectivity: keep the sale locally and sync it automatically later
        await offlineQueue.enqueue({ id: clientRequestId, url: '/sales/invoices', body: payload });
        setMessage('تعذر الاتصال بالسيرفر — تم حفظ الفاتورة محليًا وسيتم إرسالها تلقائيًا عند رجوع الشبكة');
        setCart([]);
        setPartyId(null);
        setPaidAmount(0);
        setDiscountPct(0);
      } else {
        setMessage(error?.message ?? 'تعذر حفظ الفاتورة');
      }
    } finally {
      setBusy(false);
      // The sale changes the drawer contents; keep the shift card in sync.
      loadShift().catch(() => {});
    }
  }

  /** Prints the receipt through the local print agent, falling back to the browser. */
  async function printCurrentReceipt() {
    if (!receipt) return;
    setPrintError('');
    const health = await agentHealth();
    if (health?.ok) {
      try {
        await printReceipt({
          store: { name: 'واصل ERP', phone: '', taxNumber: '' },
          header: receipt.header,
          lines: receipt.lines,
          footer: 'شكراً لتعاملكم معنا',
        });
        await openDrawer().catch(() => {});
        return;
      } catch (error: any) {
        setPrintError(error?.message ?? 'فشلت الطباعة');
      }
    }
    window.print();
  }

  const selectedParty = parties.find((p) => p.partyId === partyId);

  return (
    <AppShell title="نقطة البيع">
      {requireShift && !currentShift && (
        <div className="card p-4 mb-4 border-amber-300 bg-amber-50 space-y-3">
          <div>
            <div className="font-bold text-amber-900">لا توجد وردية مفتوحة</div>
            <div className="text-sm text-amber-800">يجب فتح وردية على الخزينة قبل بدء البيع.</div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 sm:items-end">
            <div>
              <label className="label">حساب الخزينة</label>
              <select className="input" value={shiftAccountId ?? ''}
                onChange={(e) => setShiftAccountId(Number(e.target.value))}>
                {cashAccounts.map((a) => (
                  <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">رصيد بداية الوردية</label>
              <input className="input" type="number" step="0.01" value={shiftOpening}
                onChange={(e) => setShiftOpening(Number(e.target.value))} />
            </div>
            <button className="btn-primary" onClick={openShift} disabled={shiftBusy}>
              {shiftBusy ? 'جارٍ الفتح…' : 'فتح وردية'}
            </button>
          </div>
          {shiftError && <div className="text-sm text-rose-600">{shiftError}</div>}
        </div>
      )}

      {currentShift && (
        <div className="card p-3 mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="badge bg-emerald-50 text-emerald-700">وردية #{currentShift.shiftNo}</span>
            <span className="text-slate-500">{currentShift.cashAccountName}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-500">
              المتوقع في الدرج: <b className="text-slate-800">{formatMoney(currentShift.expectedCash)}</b>
            </span>
            <Link href="/treasury" className="btn-soft text-xs">إدارة الوردية</Link>
          </div>
        </div>
      )}

      <div className="pos-grid gap-4">
        {/* ---------------- Products ---------------- */}
        <div className="card p-4 lg:order-2">
          <div className="flex gap-2 mb-3">
            <input
              ref={searchRef}
              className="input"
              placeholder="امسح الباركود أو ابحث بالاسم / الكود"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              dir="auto"
            />
            <button className="btn-soft">🔍</button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <span className={`badge ${queue.online ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              {queue.online ? '🌐 متصل بالسيرفر' : '📴 أوفلاين'}
            </span>
            {queue.pendingCount > 0 && (
              <button className="badge bg-amber-50 text-amber-700" onClick={() => queue.flush()}>
                {queue.pendingCount} فاتورة بانتظار الإرسال
              </button>
            )}
            <span className={`badge ${agentOnline ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
              {agentOnline ? '🖨️ وكيل الطباعة متصل' : '🖨️ وكيل الطباعة غير متصل'}
            </span>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {results.map((item) => (
              <button
                key={item.itemId}
                onClick={() => addItem(item)}
                className="w-full text-right rounded-xl border border-slate-200 p-3 hover:border-brand-400 hover:bg-brand-50/40 transition flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{item.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {item.code} · {item.baseUnitName}
                    {Number(item.onHandQty) > 0 ? ` · رصيد ${Number(item.onHandQty).toFixed(0)}` : ''}
                  </div>
                </div>
                <div className="font-extrabold text-brand-700 shrink-0">{formatMoney(item.sellPrice)}</div>
              </button>
            ))}
            {results.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-8">لا توجد نتائج</div>
            )}
          </div>
        </div>

        {/* ---------------- Cart ---------------- */}
        <div className="card p-4 lg:order-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold">الفاتورة الحالية</h2>
            <button className="btn-soft text-xs" onClick={() => setCart([])}>إفراغ</button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[42vh] space-y-2">
            {cart.map((line) => (
              <div key={line.itemId} className="rounded-xl border border-slate-200 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{line.name}</div>
                    <div className="text-[11px] text-slate-500">{line.code}</div>
                  </div>
                  <button className="text-rose-500 text-xs" onClick={() => setCart((c) => c.filter((l) => l.itemId !== line.itemId))}>
                    حذف
                  </button>
                </div>

                <div className="grid grid-cols-12 gap-2 mt-2 items-center">
                  <div className="col-span-3 flex items-center gap-1">
                    <button className="btn-soft px-2 py-1" onClick={() => changeQuantity(line.itemId, -1)}>−</button>
                    <input
                      className="input px-2 py-1 text-center"
                      value={line.quantity}
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        setCart((c) => c.map((l) => (l.itemId === line.itemId ? { ...l, quantity: qty } : l)));
                      }}
                    />
                    <button className="btn-soft px-2 py-1" onClick={() => changeQuantity(line.itemId, 1)}>+</button>
                  </div>

                  <div className="col-span-2">
                    <select
                      className="input px-2 py-1 text-xs"
                      value={line.unitId}
                      onChange={(e) => changeLineUnit(line.itemId, Number(e.target.value))}
                    >
                      {line.units.length === 0 && <option value={line.unitId}>{line.unitName}</option>}
                      {line.units.map((unit) => (
                        <option key={unit.unitId} value={unit.unitId}>
                          {unit.unitName}{unit.factor !== 1 ? ` (×${unit.factor})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-3">
                    <input
                      className="input px-2 py-1 text-sm"
                      type="number"
                      value={line.unitPrice}
                      onChange={(e) => setLinePrice(line.itemId, Number(e.target.value))}
                    />
                  </div>

                  <div className="col-span-2">
                    <input
                      className="input px-2 py-1 text-sm"
                      type="number"
                      value={line.discountPct}
                      onChange={(e) => setLineDiscount(line.itemId, Number(e.target.value))}
                      title="خصم %"
                    />
                  </div>

                  <div className="col-span-2 font-bold text-sm text-left">
                    {formatMoney(line.quantity * line.unitPrice * (1 - line.discountPct / 100))}
                  </div>
                </div>

                {line.factor !== 1 && (
                  <div className="text-[11px] text-slate-500 mt-1">
                    الوحدة الأساسية: {line.unitName} — المعامل ×{line.factor}
                    {' '}(الرصيد المتاح {line.onHandQty.toFixed(2)} وحدة أساسية
                    = {(line.onHandQty / line.factor).toFixed(2)} {line.unitName})
                  </div>
                )}
              </div>
            ))}
            {cart.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-10">امسح صنف لإضافته</div>
            )}
          </div>

          {/* totals */}
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">الإجمالي قبل الخصم</span><span>{formatMoney(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">خصم الفاتورة</span><span>{formatMoney(totals.headerDiscount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">الضريبة</span><span>{formatMoney(totals.tax)}</span></div>
            {totals.fee > 0 && (
              <div className="flex justify-between"><span className="text-slate-500">رسوم التوصيل</span><span>{formatMoney(totals.fee)}</span></div>
            )}
            <div className="flex justify-between text-lg font-extrabold text-brand-700 border-t border-dashed border-slate-200 pt-2">
              <span>المطلوب</span><span>{formatMoney(totals.total)}</span>
            </div>
          </div>

          {/* payment */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select className="input" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
              {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
            </select>

            <div className="relative">
              <input
                className="input"
                placeholder="ابحث عن عميل"
                onChange={(e) => searchParty(e.target.value)}
              />
              {parties.length > 0 && (
                <div className="absolute z-20 mt-1 w-full card max-h-48 overflow-y-auto">
                  {parties.map((p) => (
                    <button
                      key={p.partyId}
                      onClick={() => { setPartyId(p.partyId); setParties([]); }}
                      className="w-full text-right px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      {p.name} {Number(p.balance) !== 0 && <span className="text-xs text-rose-500">({formatMoney(p.balance)})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <select className="input" value={paymentType} onChange={(e) => setPaymentType(Number(e.target.value))}>
              <option value={1}>نقدي</option>
              <option value={2}>آجل (على الحساب)</option>
              <option value={3}>مختلط</option>
            </select>

            <select className="input" value={orderType} onChange={(e) => setOrderType(Number(e.target.value))}>
              <option value={1}>ماشر (داخل المحل)</option>
              <option value={2}>توصيل</option>
              <option value={3}>سفري</option>
              <option value={4}>صالة / طاولة</option>
            </select>

            <select className="input" value={cashAccountId ?? ''} onChange={(e) => setCashAccountId(Number(e.target.value))}
              disabled={!!currentShift}>
              {cashAccounts.map((a) => (
                <option key={a.cashAccountId} value={a.cashAccountId}>{a.name} ({formatMoney(a.balance)})</option>
              ))}
            </select>

            {paymentType === 3 && (
              <>
                <input
                  className="input col-span-2"
                  type="number"
                  placeholder="المبلغ المدفوع نقدًا"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(Number(e.target.value))}
                />
                {secondPayment ? (
                  <div className="col-span-2 grid grid-cols-3 gap-2 items-end">
                    <select
                      className="input py-1.5 text-xs"
                      value={secondPayment.method}
                      onChange={(e) => setSecondPayment({ ...secondPayment, method: Number(e.target.value) })}
                    >
                      <option value={1}>نقدي</option>
                      <option value={2}>بطاقة</option>
                      <option value={3}>تحويل بنكي</option>
                      <option value={4}>محفظة إلكترونية</option>
                      <option value={5}>شيك</option>
                    </select>
                    <input
                      className="input py-1.5 text-xs" type="number" step="0.01" placeholder="المبلغ"
                      value={secondPayment.amount || ''}
                      onChange={(e) => setSecondPayment({ ...secondPayment, amount: Number(e.target.value) })}
                    />
                    <select
                      className="input py-1.5 text-xs"
                      value={secondPayment.accountId ?? ''}
                      onChange={(e) => setSecondPayment({ ...secondPayment, accountId: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">— نفس الحساب —</option>
                      {cashAccounts.map((a) => (
                        <option key={a.cashAccountId} value={a.cashAccountId}>{a.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn-soft text-xs col-span-3"
                      onClick={() => setSecondPayment(null)}
                    >
                      حذف الدفعة الثانية
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-soft text-xs col-span-2"
                    onClick={() => setSecondPayment({ method: 2, amount: 0, accountId: null })}
                  >
                    + دفعة ثانية (بطاقة/محفظة)
                  </button>
                )}
              </>
            )}
          </div>

          {orderType === 2 && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input
                className="input col-span-2" placeholder="عنوان التوصيل"
                value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
              />
              <input
                className="input" placeholder="السائق" value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              />
              <input
                className="input" placeholder="تليفون السائق" dir="ltr" value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
              />
              <input
                className="input col-span-2" type="number" step="0.01" placeholder="رسوم التوصيل"
                value={deliveryFee || ''} onChange={(e) => setDeliveryFee(Number(e.target.value))}
              />
            </div>
          )}

          {selectedParty && (
            <div className="mt-2 text-xs text-slate-500">العميل: {selectedParty.name}</div>
          )}

          <button
            className={`w-full mt-2 text-xs ${returnMode ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => { setReturnMode((v) => !v); setReturnInvoice(null); setReturnLines([]); }}
          >
            {returnMode ? 'إلغاء وضع المرتجع' : 'مرتجع من فاتورة سابقة'}
          </button>

          {returnMode && (
            <div className="mt-2 border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
              <div className="flex gap-2">
                <input className="input" placeholder="رقم الفاتورة" value={returnNo}
                  onChange={(e) => setReturnNo(e.target.value)} dir="ltr" />
                <button className="btn-soft text-xs" onClick={findInvoice}>بحث</button>
              </div>

              {returnInvoice && (
                <>
                  <div className="text-[11px] text-slate-600">
                    {returnInvoice.header.invoiceNo} · {returnInvoice.header.partyName ?? 'عميل نقدي'}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {returnLines.map((line, index) => (
                      <div key={line.itemId} className="flex items-center gap-2 text-[11px]">
                        <span className="flex-1 truncate">{line.name}</span>
                        <span className="text-slate-400">من {line.maxQuantity}</span>
                        <input
                          className="input py-0.5 text-xs w-16" type="number" step="0.001"
                          min={0} max={line.maxQuantity}
                          value={line.quantity || ''}
                          onChange={(e) => setReturnLines((rows) => rows.map((r, i) => i === index
                            ? { ...r, quantity: Number(e.target.value) }
                            : r))}
                        />
                      </div>
                    ))}
                  </div>
                  <button className="btn-primary w-full text-xs" onClick={submitReturn}>تنفيذ المرتجع</button>
                </>
              )}
            </div>
          )}

          {heldCarts.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-bold text-slate-600">فواتير معلّقة</div>
              <div className="space-y-1 mt-1">
                {heldCarts.map((held) => (
                  <div key={held.heldId} className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-slate-500">{held.heldNo}</span>
                    <span className="flex-1">{held.customerName ?? 'بدون اسم'}</span>
                    <span className="font-bold">{formatMoney(held.totalAmount)}</span>
                    <button className="btn-soft text-[11px] py-0.5" onClick={() => resumeCart(held)}>استرجاع</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {message && (
            <div className="mt-2 rounded-xl bg-rose-50 text-rose-700 text-sm px-3 py-2 border border-rose-200">{message}</div>
          )}
          {error && (
            <div className="mt-2 rounded-xl bg-rose-50 text-rose-700 text-sm px-3 py-2 border border-rose-200">{error}</div>
          )}

          <button className="btn-success w-full mt-3 py-3 text-base" onClick={checkout} disabled={busy || !cart.length}>
            {busy ? 'جارٍ الحفظ…' : `إتمام البيع — ${formatMoney(totals.total)}`}
          </button>
          {cart.length > 0 && (
            <button className="btn-soft w-full mt-2 text-xs" onClick={parkCart} disabled={busy}>
              تعليق الفاتورة
            </button>
          )}
        </div>
      </div>

      {/* ---------------- Receipt ---------------- */}
      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="card w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
            <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
              <div className="font-extrabold text-lg">واصل ERP</div>
              <div className="text-xs text-slate-500">فاتورة مبيعات</div>
              <div className="text-xs text-slate-500">{receipt.header.invoiceNo}</div>
              <div className="text-xs text-slate-500">{new Date(receipt.header.invoiceDate).toLocaleString('ar-EG')}</div>
            </div>

            <table className="w-full text-xs">
              <tbody>
                {receipt.lines.map((line: any) => (
                  <tr key={line.invoiceLineId} className="border-b border-slate-100">
                    <td className="py-1.5">{line.itemName}<div className="text-[10px] text-slate-400">{line.quantity} × {formatMoney(line.unitPrice)}</div></td>
                    <td className="py-1.5 text-left font-bold">{formatMoney(line.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 space-y-1 text-xs border-t border-dashed border-slate-300 pt-2">
              <div className="flex justify-between"><span>الإجمالي</span><span>{formatMoney(receipt.header.subTotal)}</span></div>
              <div className="flex justify-between"><span>الخصم</span><span>{formatMoney(receipt.header.discountAmount)}</span></div>
              <div className="flex justify-between"><span>الضريبة</span><span>{formatMoney(receipt.header.taxAmount)}</span></div>
              <div className="flex justify-between text-sm font-extrabold"><span>المطلوب</span><span>{formatMoney(receipt.header.totalAmount)}</span></div>
              <div className="flex justify-between"><span>المدفوع</span><span>{formatMoney(receipt.header.paidAmount)}</span></div>
            </div>

            {printError && <div className="text-xs text-rose-600">{printError}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-soft flex-1" onClick={printCurrentReceipt}>
                🖨️ طباعة {agentOnline ? '(الوكيل)' : '(المتصفح)'}
              </button>
              <button className="btn-primary flex-1" onClick={() => setReceipt(null)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
