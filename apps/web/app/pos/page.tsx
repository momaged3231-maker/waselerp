'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { apiFetch, formatMoney } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLiveEvents } from '@/lib/live';
import { isNetworkError, offlineQueue, useOfflineQueue } from '@/lib/offline';
import { agentHealth, openDrawer, printReceipt } from '@/lib/print';
import { IconCash, IconCart, IconCheck, IconMinus, IconPlus, IconPrinter, IconSearch, IconTrash, IconX, IconGift, IconRefresh } from '@/components/POSIcons';

type ItemUnit = {
  unitId: number; unitName: string; factor: number;
  sellPrice?: number; buyPrice?: number; isDefault?: boolean;
};

type Line = {
  itemId: number; code: string; name: string; unitId: number; unitName?: string;
  quantity: number; unitPrice: number; discountPct: number; taxPct: number; onHandQty: number;
  factor: number; units: ItemUnit[]; isGift?: boolean; discountAmount?: number;
};

export default function PosPage() {
  const { session, can } = useSession();
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
  const [party, setParty] = useState<any>(null);
  const [paidAmount, setPaidAmount] = useState<number>(0);
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [printContext, setPrintContext] = useState<any>(null);
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
  const [reps, setReps] = useState<any[]>([]);
  const [repId, setRepId] = useState<number | null>(null);
  const [returnMode, setReturnMode] = useState(false);
  const [returnNo, setReturnNo] = useState('');
  const [returnInvoice, setReturnInvoice] = useState<any>(null);
  const [returnLines, setReturnLines] = useState<any[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [tendered, setTendered] = useState('');
  const [tenderError, setTenderError] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [showBulkDiscount, setShowBulkDiscount] = useState(false);
  const [bulkMode, setBulkMode] = useState<'pct' | 'amount'>('pct');
  const [bulkValue, setBulkValue] = useState('');
  const [lastInvoiceNo, setLastInvoiceNo] = useState('');
  const [draftAvailable, setDraftAvailable] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refreshKey, setRefreshKey] = useState(0);
  const [discountModes, setDiscountModes] = useState<Record<number, 'pct' | 'amount'>>({});

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
    apiFetch<any[]>('/sales/reps').then(setReps).catch(() => setReps([]));
    apiFetch('/sales/print-context').then(setPrintContext).catch(() => {});
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
  }, [search, session?.activeBranchId, partyId, refreshKey]);

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
    setCart((current) => current.map((l) => {
      if (l.itemId !== itemId) return l;
      const gross = l.quantity * l.unitPrice;
      return { ...l, discountPct: value, discountAmount: gross * (value / 100) };
    }));
  }

  function setLineDiscountAmount(itemId: number, amount: number) {
    const max = session?.user.maxDiscountPct ?? 0;
    setCart((current) => current.map((l) => {
      if (l.itemId !== itemId) return l;
      const gross = l.quantity * l.unitPrice;
      const raw = Math.max(0, amount);
      const pct = gross > 0 ? Math.min((raw / gross) * 100, max) : 0;
      return { ...l, discountPct: pct, discountAmount: gross * (pct / 100) };
    }));
  }

  function lineDiscountMode(lineId: number): 'pct' | 'amount' {
    return discountModes[lineId] ?? 'pct';
  }

  function toggleLineDiscountMode(lineId: number) {
    setDiscountModes((m) => ({ ...m, [lineId]: (m[lineId] ?? 'pct') === 'pct' ? 'amount' : 'pct' }));
  }

  function toggleGift(itemId: number) {
    if (!can('sales.giveaway')) { setMessage('ليست لديك صلاحية منح أصناف مجانًا'); return; }
    setCart((c) => c.map((l) => (l.itemId === itemId
      ? { ...l, isGift: !l.isGift, discountPct: !l.isGift ? 0 : l.discountPct }
      : l)));
  }

  const giftLinePrice = (l: Line) => (l.isGift ? 0 : l.unitPrice);

  function applyBulkDiscount() {
    const value = Number(bulkValue);
    if (!Number.isFinite(value) || value <= 0) { setBulkValue(''); return; }
    const max = session?.user.maxDiscountPct ?? 0;
    if (bulkMode === 'pct') {
      const v = Math.min(value, max);
      setCart((c) => c.map((l) => (l.isGift ? l : { ...l, discountPct: v })));
    } else {
      const billable = cart.filter((l) => !l.isGift);
      if (!billable.length) { setMessage('السلة فارغة'); return; }
      const each = value / billable.length;
      setCart((c) => c.map((l) => {
        if (l.isGift) return l;
        const lineTotal = l.quantity * l.unitPrice;
        const pct = lineTotal > 0 ? (each / lineTotal) * 100 : 0;
        return { ...l, discountPct: Math.min(pct, max) };
      }));
    }
    setShowBulkDiscount(false);
    setBulkValue('');
    setMessage('تم تطبيق الخصم على كل الأصناف');
  }

  function openPayment() {
    if (!cart.length) { setMessage('السلة فارغة'); return; }
    setTendered(String(totals.total.toFixed(2)));
    setTenderError('');
    setPaymentOpen(true);
  }

  function confirmPayment() {
    if (paymentType === 1) {
      const amount = Number(tendered || 0);
      if (amount + 1e-9 < totals.total) {
        setTenderError('المدفوع أقل من الإجمالي — الفارق لا يمكن أن يكون آجلًا في بيع نقدي (اختر مختلط أو آجل)');
        return;
      }
    }
    setPaymentOpen(false);
    checkout();
  }

  function clearCart() {
    setCart([]);
    setPartyId(null);
    setPaidAmount(0);
    setDiscountPct(0);
    window.localStorage.removeItem('wasel.pos.draft');
  }

  function restoreDraft() {
    try {
      const raw = window.localStorage.getItem('wasel.pos.draft');
      if (!raw) { setDraftAvailable(false); return; }
      const saved = JSON.parse(raw);
      if (saved?.cart?.length) {
        setCart(saved.cart);
        setPartyId(saved.partyId ?? null);
        if (saved.warehouseId) setWarehouseId(saved.warehouseId);
        setOrderType(saved.orderType ?? 1);
        setDiscountPct(Number(saved.discountPct ?? 0));
        setMessage('تم استعادة الفاتورة غير المحفوظة');
      }
    } catch { /* ignore corrupt draft */ }
    window.localStorage.removeItem('wasel.pos.draft');
    setDraftAvailable(false);
  }

  function dismissDraft() {
    window.localStorage.removeItem('wasel.pos.draft');
    setDraftAvailable(false);
  }

  const tenderRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, l) => sum + l.quantity * giftLinePrice(l), 0);
    const lineDiscount = cart.reduce((sum, l) => sum + l.quantity * giftLinePrice(l) * (l.discountPct / 100), 0);
    const afterLineDiscount = subtotal - lineDiscount;
    const headerDiscount = afterLineDiscount * (discountPct / 100);
    const taxable = afterLineDiscount - headerDiscount;
    const tax = cart.reduce((sum, l) => sum + l.quantity * giftLinePrice(l) * (1 - l.discountPct / 100) * (l.taxPct / 100), 0);
    const fee = orderType === 2 ? Number(deliveryFee || 0) : 0;
    const total = taxable + tax + fee;
    return { subtotal, lineDiscount, headerDiscount, tax, fee, total, remaining: total - paidAmount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, discountPct, paidAmount, orderType, deliveryFee]);

  // ask to restore an unfinished invoice after a crash/reload, like Ezees does
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('wasel.pos.draft');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.cart?.length) setDraftAvailable(true);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the in-progress cart on the device so a power cut never loses the bill
  useEffect(() => {
    if (!cart.length) {
      window.localStorage.removeItem('wasel.pos.draft');
      return;
    }
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem('wasel.pos.draft', JSON.stringify({
          cart, partyId, warehouseId, orderType, discountPct, at: Date.now(),
        }));
      } catch { /* ignore quota */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [cart, partyId, warehouseId, orderType, discountPct]);

  // cashier keyboard shortcuts: F1 جديد · F2 حفظ/تأكيد · F4 طباعة · F6 حذف/إغلاق · F7 المدفوع
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key;
      if (!['F1', 'F2', 'F4', 'F6', 'F7', 'Escape'].includes(key)) return;
      e.preventDefault();
      if (key === 'F1') {
        clearCart();
        setMessage('تم تفريغ الفاتورة');
      } else if (key === 'F2') {
        if (paymentOpen) confirmPayment();
        else openPayment();
      } else if (key === 'F4') {
        if (receipt) printCurrentReceipt();
      } else if (key === 'F6') {
        if (paymentOpen) setPaymentOpen(false);
        else if (cart.length && window.confirm('مسح كل الأصناف من الفاتورة؟')) clearCart();
      } else if (key === 'F7') {
        if (paymentOpen) tenderRef.current?.focus();
        else openPayment();
      } else if (key === 'Escape') {
        if (paymentOpen) setPaymentOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
      invoiceDate: invoiceDate || undefined,
      repId: repId ?? undefined,
      couponCode: couponCode.trim() || undefined,
      clientRequestId,
      lines: cart.map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        taxPct: l.taxPct,
        ...(l.isGift ? { isGift: true } : {}),
      })),
    };

    try {
      const result = await apiFetch<any>('/sales/invoices', { method: 'POST', body: payload });
      const detail = await apiFetch<any>(`/sales/invoices/${result.invoiceId}`);
      setReceipt(detail);
      setLastInvoiceNo(detail?.header?.invoiceNo ?? '');
      setCouponCode('');
      clearCart();
      searchRef.current?.focus();
      // الطباعة التلقائية بعد الحفظ (حسب الدليل)؛ تمرر الإيصال الصريح للدالة
      window.setTimeout(() => printReceiptOf(detail).catch(() => {}), 400);
    } catch (error: any) {
      if (isNetworkError(error)) {
        // no connectivity: keep the sale locally and sync it automatically later
        await offlineQueue.enqueue({ id: clientRequestId, url: '/sales/invoices', body: payload });
        setMessage('تعذر الاتصال بالسيرفر — تم حفظ الفاتورة محليًا وسيتم إرسالها تلقائيًا عند رجوع الشبكة');
        clearCart();
      } else {
        setMessage(error?.message ?? 'تعذر حفظ الفاتورة');
      }
    } finally {
      setBusy(false);
      // The sale changes the drawer contents; keep the shift card in sync.
      loadShift().catch(() => {});
    }
  }

  /** Prints the receipt: A4/A5 go through the browser; thermal goes through the agent. */
  async function printReceiptOf(detail: any) {
    if (!detail) return;
    setPrintError('');
    const ctx = printContext ?? {};
    const paperSize = ctx.receiptPaperSize ?? 'thermal80';
    const isBrowserPaper = paperSize === 'a5' || paperSize === 'a4';

    if (!isBrowserPaper) {
      const health = await agentHealth();
      if (health?.ok) {
        try {
          const width = paperSize === 'thermal58' ? 32 : 42;
          await printReceipt({
            store: {
              name: ctx.companyName || 'واصل ERP',
              address: ctx.companyAddress ?? '',
              phone: ctx.companyPhone ?? '',
              taxNumber: ctx.taxNumber ?? '',
            },
            header: detail.header,
            lines: detail.lines,
            footer: ctx.invoiceFooter || 'شكراً لتعاملكم معنا',
            showTax: ctx.showTaxOnReceipt !== false,
            taxName: ctx.taxName || 'الضريبة',
            showBranch: ctx.receiptShowBranchName !== false,
            showParty: ctx.receiptShowPartyName !== false,
            showTotals: ctx.receiptShowTotals !== false,
          }, undefined, { width, copies: Number(ctx.receiptCopies ?? 1) });
          await openDrawer().catch(() => {});
          return;
        } catch (error: any) {
          setPrintError(error?.message ?? 'فشلت الطباعة');
        }
      }
    }

    // Browser fallback (also the primary path for A4/A5 paper)
    window.print();
  }

  async function printCurrentReceipt() {
    if (!receipt) { setMessage('لا توجد فاتورة مطبوعة حاليًا'); return; }
    return printReceiptOf(receipt);
  }

  const selectedParty = party;
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <AppShell title="نقطة البيع">
      {draftAvailable && (
        <div className="card p-3 mb-4 flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50 text-sm text-amber-900">
          <span>توجد فاتورة غير محفوظة من جلسة سابقة — هل ترغب في استعادتها؟</span>
          <div className="flex gap-2 mr-auto">
            <button className="btn-soft text-xs" onClick={dismissDraft}>تجاهل</button>
            <button className="btn-primary text-xs" onClick={restoreDraft}>استعادة</button>
          </div>
        </div>
      )}
      {requireShift && !currentShift && (
        <div className="card p-4 mb-4 border-amber-300 bg-amber-50 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <IconCash className="w-6 h-6" />
            </div>
            <div>
              <div className="font-extrabold text-amber-900">لا توجد وردية مفتوحة</div>
              <div className="text-sm text-amber-800">يجب فتح وردية على الخزينة قبل بدء البيع.</div>
            </div>
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
        <div className="card p-3 mb-4 flex flex-wrap items-center justify-between gap-2 text-sm bg-emerald-50/70 border-emerald-100">
          <div className="flex items-center gap-2">
            <span className="badge bg-emerald-100 text-emerald-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              وردية #{currentShift.shiftNo}
            </span>
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

      {/* invoice date + manual refresh — visible always, like the Ezees toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <span dir="ltr">تاريخ الفاتورة</span>
          <input
            type="date"
            className="input py-1.5 w-40"
            dir="ltr"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            aria-label="تاريخ الفاتورة"
          />
          {invoiceDate !== new Date().toISOString().slice(0, 10) && (
            <button className="text-brand-600 underline text-[11px]" onClick={() => setInvoiceDate(new Date().toISOString().slice(0, 10))}>
              اليوم
            </button>
          )}
        </label>
      </div>

      <div className="pos-grid gap-4">
        {/* ---------------- Products ---------------- */}
        <div className="card p-3 lg:order-1 flex flex-col">
          <div className="flex items-center justify-between px-1 mb-2">
            <h2 className="font-extrabold text-slate-700">منيو المخزون</h2>
            <div className="flex items-center gap-2">
              <button
                className="w-8 h-8 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                onClick={() => setRefreshKey((k) => k + 1)}
                aria-label="تحديث البيانات"
                title="تحديث البيانات"
              >
                <IconRefresh className="w-4 h-4" />
              </button>
              <button
                className="w-8 h-8 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                onClick={() => printCurrentReceipt()}
                aria-label="طباعة"
                title="طباعة آخر إيصال (F4)"
              >
                <IconPrinter className="w-4 h-4" />
              </button>
              <span className="badge bg-slate-100 text-slate-600">{results.length} منتج</span>
            </div>
          </div>

          <div className="relative mb-2">
            <IconSearch className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            <input
              ref={searchRef}
              className="input h-12 rounded-2xl text-base"
              placeholder="امسح الباركود أو ابحث بالاسم / الكود"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              dir="auto"
              aria-label="ابحث عن منتج"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center"
                aria-label="مسح نص البحث"
              >
                <IconX className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-2 text-xs">
            <span className={`badge ${queue.online ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${queue.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              {queue.online ? 'متصل بالسيرفر' : 'أوفلاين'}
            </span>
            {queue.pendingCount > 0 && (
              <button className="badge bg-amber-50 text-amber-700" onClick={() => queue.flush()}>
                {queue.pendingCount} فاتورة بانتظار الإرسال
              </button>
            )}
            <span className={`badge ${agentOnline ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${agentOnline ? 'bg-blue-500' : 'bg-slate-400'}`} />
              {agentOnline ? 'وكيل الطباعة متصل' : 'وكيل الطباعة غير متصل'}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto max-h-[55vh]">
            <div className="grid grid-cols-2 gap-2">
              {results.map((item) => (
                <button
                  key={item.itemId}
                  type="button"
                  onClick={() => addItem(item)}
                  className="text-right rounded-2xl border border-slate-200 bg-white p-3 hover:border-brand-400 hover:bg-brand-50/60 active:scale-[0.98] transition flex flex-col gap-1.5 min-h-[88px]"
                >
                  <div className="text-sm font-bold truncate w-full">{item.name}</div>
                  <div className="text-[11px] text-slate-500 truncate w-full">{item.code} · {item.baseUnitName}</div>
                  <div className="mt-auto pt-1 w-full flex items-center justify-between gap-2">
                    <span className="font-extrabold text-brand-700">{formatMoney(item.sellPrice)}</span>
                    {Number(item.onHandQty) > 0 ? (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-md px-1.5 py-0.5">رصيد {Number(item.onHandQty).toFixed(0)}</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 rounded-md px-1.5 py-0.5">نفاد</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {results.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-10">لا توجد نتائج</div>
            )}
          </div>
        </div>

        {/* ---------------- Cart ---------------- */}
        <div className="card p-3 lg:order-2 flex flex-col">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="font-extrabold text-slate-700 flex items-center gap-2">
              <IconCart className="w-5 h-5 text-brand-600" />
              الفاتورة الحالية
              {itemCount > 0 && <span className="badge bg-brand-50 text-brand-700">{itemCount}</span>}
              {lastInvoiceNo && (
                <span className="text-[10px] font-normal text-slate-400 hidden sm:inline">آخر فاتورة {lastInvoiceNo}</span>
              )}
            </h2>
            <div className="flex items-center gap-2">
              <button className="btn-soft text-xs" onClick={() => openDrawer().catch(() => {})} aria-label="فتح درج النقود" title="فتح درج النقود">فتح الدرج</button>
              <button className="btn-soft text-xs" onClick={clearCart}>إفراغ</button>
            </div>
          </div>

          <div className="flex-1 max-h-[40vh] overflow-y-auto space-y-2 pr-1">
            {cart.map((line) => (
              <div key={line.itemId} className={`rounded-2xl border p-2.5 ${line.isGift ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-slate-50/70'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm truncate">
                      {line.name}
                      {line.isGift && <span className="badge bg-emerald-100 text-emerald-700 mr-2 align-middle">هدية</span>}
                    </div>
                    <div className="text-[11px] text-slate-500">{line.code}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className={`w-8 h-8 rounded-xl flex items-center justify-center ${line.isGift ? 'bg-emerald-100 text-emerald-600' : 'text-slate-400 hover:bg-slate-200/60'}`}
                      onClick={() => toggleGift(line.itemId)}
                      aria-label={line.isGift ? 'تحويل لبيع عادي' : 'تحويل لهدية'}
                      title="هدية للعميل (بسعر صفر)"
                    >
                      <IconGift className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-xl text-rose-500 hover:bg-rose-50 flex items-center justify-center"
                      onClick={() => setCart((c) => c.filter((l) => l.itemId !== line.itemId))}
                      aria-label="حذف من الفاتورة"
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-12 gap-2 mt-2 items-center">
                  <div className="col-span-3 flex items-center gap-1">
                    <button type="button" className="btn-soft px-2 h-9 flex items-center justify-center rounded-xl" onClick={() => changeQuantity(line.itemId, -1)} aria-label="خصم">
                      <IconMinus className="w-4 h-4" />
                    </button>
                    <input
                      className="input px-2 h-9 text-center"
                      value={line.quantity}
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        setCart((c) => c.map((l) => (l.itemId === line.itemId ? { ...l, quantity: qty } : l)));
                      }}
                      aria-label="الكمية"
                    />
                    <button type="button" className="btn-soft px-2 h-9 flex items-center justify-center rounded-xl" onClick={() => changeQuantity(line.itemId, 1)} aria-label="زيادة">
                      <IconPlus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="col-span-2">
                    <select
                      className="input px-2 h-9 text-xs"
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
                    {line.isGift ? (
                      <input className="input px-2 h-9 text-sm bg-emerald-100/50 text-emerald-700 font-bold" readOnly value="هدية 0.00" aria-label="هدية" />
                    ) : (
                      <input
                        className="input px-2 h-9 text-sm"
                        type="number"
                        value={line.unitPrice}
                        onChange={(e) => setLinePrice(line.itemId, Number(e.target.value))}
                      />
                    )}
                  </div>

                  <div className="col-span-2">
                    {line.isGift ? (
                      <input className="input px-2 h-9 text-sm bg-emerald-100/50 text-emerald-700 font-bold" readOnly value="0" aria-label="خصم هدية" />
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          className="input px-2 h-9 text-sm w-full"
                          type="number"
                          value={lineDiscountMode(line.itemId) === 'pct' ? line.discountPct : (line.discountAmount ?? 0)}
                          onChange={(e) => lineDiscountMode(line.itemId) === 'pct'
                            ? setLineDiscount(line.itemId, Number(e.target.value))
                            : setLineDiscountAmount(line.itemId, Number(e.target.value))}
                          title={lineDiscountMode(line.itemId) === 'pct' ? 'خصم %' : 'خصم مبلغ'}
                          aria-label={lineDiscountMode(line.itemId) === 'pct' ? 'خصم الفاتورة بالنسبة' : 'خصم الفاتورة بالمبلغ'}
                        />
                        <button
                          type="button"
                          className="btn-soft px-2 h-9 text-[11px] font-extrabold shrink-0 rounded-xl"
                          onClick={() => toggleLineDiscountMode(line.itemId)}
                          title="التبديل بين نسبة٪ ومبلغ"
                          aria-label="تبديل نوع الخصم"
                        >
                          {lineDiscountMode(line.itemId) === 'pct' ? '٪' : 'ج'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="col-span-2 font-bold text-sm text-left">
                    {line.isGift ? <span className="text-emerald-700">هدية</span> : formatMoney(line.quantity * line.unitPrice * (1 - line.discountPct / 100))}
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

          {/* bulk discount on all lines */}
          <div className="flex items-center gap-2 mt-2">
            <button className="btn-soft text-xs" onClick={() => setShowBulkDiscount((v) => !v)} disabled={!cart.length}>
              خصم على كل الأصناف
            </button>
          </div>
          {showBulkDiscount && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-slate-300 p-2.5">
              <input autoFocus className="input w-24 text-center" type="number" min={0} step="0.01" value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)} placeholder="0" dir="ltr" />
              <select className="input w-24" value={bulkMode} onChange={(e) => setBulkMode(e.target.value as 'pct' | 'amount')}>
                <option value="pct">نسبة %</option>
                <option value="amount">مبلغ</option>
              </select>
              <button className="btn-primary text-xs" onClick={applyBulkDiscount}>تطبيق</button>
              <button className="btn-soft text-xs" onClick={() => { setShowBulkDiscount(false); setBulkValue(''); }}>إلغاء</button>
              <span className="text-[10px] text-slate-400">في وضع «مبلغ» يُوزَّع الخصم بالتساوي على الأسطر</span>
            </div>
          )}

          {/* totals */}
          <div className="mt-3 pt-3 border-t border-dashed border-slate-200 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">الإجمالي قبل الخصم</span><span>{formatMoney(totals.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">خصم الفاتورة</span><span>{formatMoney(totals.headerDiscount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">الضريبة</span><span>{formatMoney(totals.tax)}</span></div>
            {totals.fee > 0 && (
              <div className="flex justify-between"><span className="text-slate-500">رسوم التوصيل</span><span>{formatMoney(totals.fee)}</span></div>
            )}
            <div className="flex justify-between items-baseline pt-2 border-t border-dashed border-slate-200">
              <span className="font-extrabold text-slate-700">المطلوب</span>
              <span className="font-extrabold text-lg text-brand-700">{formatMoney(totals.total)}</span>
            </div>
          </div>

          {/* payment */}
          <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
            <div className="mb-2 flex items-center gap-2">
              <input className="input" placeholder="كود الكوبون (اختياري)" value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)} dir="ltr" aria-label="كود الكوبون" />
            </div>
            <div className="text-xs font-extrabold text-slate-600 mb-2">طريقة الدفع</div>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="طريقة الدفع">
              {([
                { value: 1, label: 'نقدي' },
                { value: 2, label: 'آجل' },
                { value: 3, label: 'مختلط' },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPaymentType(m.value)}
                  aria-pressed={paymentType === m.value}
                  className={`py-2.5 rounded-xl text-sm font-bold transition ${
                    paymentType === m.value
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <select className="input" value={warehouseId ?? ''} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                {warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name}</option>)}
              </select>

              <div className="relative">
                <input className="input" placeholder="ابحث عن عميل" onChange={(e) => searchParty(e.target.value)} />
                {parties.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full card max-h-48 overflow-y-auto">
                    {parties.map((p) => (
                      <button
                        key={p.partyId}
                        onClick={() => { setPartyId(p.partyId); setParty(p); setParties([]); }}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        {p.name} {p.phone && <span dir="ltr" className="text-[11px] text-slate-400">{p.phone}</span>}
                        {Number(p.balance) !== 0 && <span className="text-xs text-rose-500">({formatMoney(p.balance)})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <select className="input" value={cashAccountId ?? ''} onChange={(e) => setCashAccountId(Number(e.target.value))}
                disabled={!!currentShift}>
                {cashAccounts.map((a) => (
                  <option key={a.cashAccountId} value={a.cashAccountId}>{a.name} ({formatMoney(a.balance)})</option>
                ))}
              </select>
            </div>

            <div className="mt-2">
              <div className="text-xs font-extrabold text-slate-600 mb-1.5">نوع الطلب</div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {([
                  { value: 1, label: 'ماشر' },
                  { value: 2, label: 'توصيل' },
                  { value: 3, label: 'سفري' },
                  { value: 4, label: 'طاولة' },
                ] as const).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOrderType(o.value)}
                    className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                      orderType === o.value ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {reps.length > 0 && (
              <div className="mt-2">
                <label className="text-[11px] font-extrabold text-slate-600 mb-1 block">المندوب (اختياري)</label>
                <select className="input" value={repId ?? ''} onChange={(e) => setRepId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— بدون مندوب —</option>
                  {reps.map((r) => <option key={r.userId} value={r.userId}>{r.fullName}</option>)}
                </select>
              </div>
            )}

            {paymentType === 3 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
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
              </div>
            )}
          </div>

          {selectedParty && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>العميل: {selectedParty.name}{selectedParty.phone ? <span dir="ltr"> · {selectedParty.phone}</span> : null}</span>
              <button className="text-rose-500 font-semibold hover:underline" onClick={() => { setPartyId(null); setParty(null); }}>
                إزالة العميل
              </button>
            </div>
          )}

          {selectedParty && paymentType !== 1 && Number(selectedParty.creditLimit ?? 0) > 0 && (() => {
            const paid = paymentType === 2 ? 0 : Math.min(Number(totals.total), (Number(paidAmount) || 0) + (Number(secondPayment?.amount) || 0));
            const remaining = Math.max(0, Number(totals.total) - paid);
            const balance = Number(selectedParty.balance ?? 0);
            const limit = Number(selectedParty.creditLimit);
            const availableBefore = limit - balance;
            const exceeds = remaining > availableBefore + 0.005;
            return (
              <div className={`mt-2 rounded-xl border px-3 py-2 text-[11px] leading-5 ${exceeds ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                <div className="font-extrabold">حد الائتمان</div>
                <div className="flex flex-wrap gap-x-3">
                  <span>المديونية الحالية: <b>{formatMoney(balance)}</b></span>
                  <span>الحد: <b>{formatMoney(limit)}</b></span>
                  <span>المتاح: <b>{formatMoney(Math.max(0, availableBefore))}</b></span>
                </div>
                {remaining > 0 && (
                  <div className="mt-0.5">
                    {exceeds
                      ? <>ستتجاوز الحد بـ <b>{formatMoney(remaining - availableBefore)}</b> — النظام سيرفض الحفظ الآجل حتى سداد جزء من الرصيد.</>
                      : <>بعد هذه الفاتورة: <b>{formatMoney(balance + remaining)}</b> من <b>{formatMoney(limit)}</b>.</>}
                  </div>
                )}
              </div>
            );
          })()}

          <button className={`w-full mt-2 text-xs ${returnMode ? 'btn-primary' : 'btn-soft'}`}
            onClick={() => { setReturnMode((v) => !v); setReturnInvoice(null); setReturnLines([]); }}>
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

          <button className="btn-success w-full mt-3 py-3 text-base" onClick={openPayment} disabled={busy || !cart.length}>
            {busy ? 'جارٍ الحفظ…' : `إتمام البيع — ${formatMoney(totals.total)}`}
          </button>
          {cart.length > 0 && (
            <button className="btn-soft w-full mt-2 text-xs" onClick={parkCart} disabled={busy}>
              تعليق الفاتورة
            </button>
          )}
        </div>
      </div>

      {/* ---------------- Payment window ---------------- */}
      {paymentOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPaymentOpen(false)}>
          <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="تأكيد الدفع">
            <div className="text-[11px] text-slate-400 flex items-center justify-between">
              <span>نافذة الدفع</span>
              <span>رقم الفاتورة — جديد</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-sm font-bold text-slate-600">الإجمالي</span>
              <span className="text-2xl font-extrabold text-brand-700">{formatMoney(totals.total)}</span>
            </div>

            <label className="label mt-4">المدفوع</label>
            <input
              ref={tenderRef}
              className="input text-lg font-bold text-center"
              type="number"
              step="0.01"
              dir="ltr"
              value={tendered}
              autoFocus
              onChange={(e) => { setTendered(e.target.value); setTenderError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmPayment(); }}
              aria-label="المبلغ المدفوع"
            />
            <button className="btn-soft text-xs w-full mt-2" onClick={() => setTendered(String(totals.total.toFixed(2)))}>
              المبلغ كامل
            </button>

            <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-dashed border-slate-200">
              <span className="text-sm text-slate-500">الباقي للعميل</span>
              <span className="text-xl font-extrabold text-emerald-600">{formatMoney(Math.max(0, Number(tendered || 0) - totals.total))}</span>
            </div>

            {tenderError && (
              <div className="mt-2 rounded-xl bg-rose-50 text-rose-700 text-xs px-3 py-2 border border-rose-200">{tenderError}</div>
            )}

            <div className="flex gap-2 mt-4">
              <button className="btn-soft flex-1" onClick={() => setPaymentOpen(false)}>إلغاء</button>
              <button className="btn-success flex-1 text-base" onClick={confirmPayment} disabled={busy}>
                {busy ? 'جارٍ الحفظ…' : 'تأكيد وحفظ'}
              </button>
            </div>
            <div className="text-[10px] text-slate-400 mt-2 text-center">Enter للتأكيد · Esc للإلغاء · F7 ينتقل للمبلغ المدفوع</div>
          </div>
        </div>
      )}

      {/* ---------------- Receipt ---------------- */}
      {receipt && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          {printContext?.receiptPaperSize === 'a5' && <style>{'@media print { @page { size: A5; } }'}</style>}
          {printContext?.receiptPaperSize === 'a4' && <style>{'@media print { @page { size: A4; } }'}</style>}
          <div className="card w-full max-w-sm p-5 max-h-[90vh] overflow-y-auto">
            <div className="text-center border-b border-dashed border-slate-300 pb-3 mb-3">
              <div className="font-extrabold text-lg">{printContext?.companyName || 'واصل ERP'}</div>
              {printContext?.companyAddress && <div className="text-xs text-slate-500">{printContext.companyAddress}</div>}
              {printContext?.companyPhone && <div className="text-[11px] text-slate-500">هاتف: <span dir="ltr">{printContext.companyPhone}</span></div>}
              {printContext?.taxNumber && <div className="text-[11px] text-slate-500">الرقم الضريبي: <span dir="ltr">{printContext.taxNumber}</span></div>}
              <div className="text-xs text-slate-500 mt-1">فاتورة مبيعات</div>
              <div className="text-xs text-slate-500">{receipt.header.invoiceNo}</div>
              <div className="text-xs text-slate-500">{new Date(receipt.header.invoiceDate).toLocaleString('ar-EG')}</div>
              {printContext?.receiptShowPartyName !== false && receipt.header.partyName && (
                <div className="text-xs text-slate-600 font-semibold">العميل: {receipt.header.partyName}</div>
              )}
              {printContext?.receiptShowBranchName !== false && receipt.header.branchName && (
                <div className="text-xs text-slate-500">الفرع: {receipt.header.branchName}</div>
              )}
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
              {printContext?.receiptShowTotals !== false && (
                <>
                  <div className="flex justify-between"><span>الإجمالي</span><span>{formatMoney(receipt.header.subTotal)}</span></div>
                  <div className="flex justify-between"><span>الخصم</span><span>{formatMoney(receipt.header.discountAmount)}</span></div>
                </>
              )}
              {printContext?.showTaxOnReceipt !== false && (
                <div className="flex justify-between">
                  <span>{printContext?.taxName || 'الضريبة'}</span>
                  <span>{formatMoney(receipt.header.taxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-extrabold"><span>المطلوب</span><span>{formatMoney(receipt.header.totalAmount)}</span></div>
              <div className="flex justify-between"><span>المدفوع</span><span>{formatMoney(receipt.header.paidAmount)}</span></div>
            </div>

            {printContext?.invoiceFooter && <div className="mt-2 text-center text-xs text-slate-500">{printContext.invoiceFooter}</div>}

            {printError && <div className="text-xs text-rose-600">{printError}</div>}
            <div className="flex gap-2 mt-4">
              <button className="btn-soft flex-1" onClick={printCurrentReceipt}>
                <IconPrinter className="w-4 h-4" /> طباعة{' '}
                {printContext?.receiptPaperSize === 'a5' ? '(A5)'
                  : printContext?.receiptPaperSize === 'a4' ? '(A4)'
                    : printContext?.receiptPaperSize === 'thermal58' ? '(58مم)'
                      : agentOnline ? '(الوكيل)' : '(المتصفح)'}
              </button>
              <button className="btn-primary flex-1" onClick={() => setReceipt(null)}>
                <IconCheck className="w-4 h-4" /> إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
