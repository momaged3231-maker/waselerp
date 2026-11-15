/* Phase 4 — Month 2 scenario: scenario data (the independent model) */

module.exports = {
  company: 'شركة مراجعة لحسابات الأشهر — فرع ثانٍ',
  branchCode: 'MAIN',
  branchName: 'فرع المعادي',

  // ---- items to create ----
  items: [
    { code: 'M2-LAP-I7', name: 'لابتوب Dell i7', sellPrice: 15000, vatPct: 14, openingQty: 10, openingCost: 12000 },
    { code: 'M2-MON-27', name: 'شاشة Dell 27 بوصة', sellPrice: 4200, vatPct: 14, openingQty: 10, openingCost: 3500 },
    { code: 'M2-PRN-HP', name: 'طابعة HP Laser', sellPrice: 6000, vatPct: 14, openingQty: 8, openingCost: 4000 },
    { code: 'M2-KB-LOG', name: 'كيبورد لاسلكي', sellPrice: 700, vatPct: 0, openingQty: 20, openingCost: 400 },
    { code: 'M2-MOU-LOG', name: 'ماوس لاسلكي', sellPrice: 400, vatPct: 0, openingQty: 15, openingCost: 200 },
    { code: 'M2-LAP-I9', name: 'لابتوب Dell i9', sellPrice: 16500, vatPct: 14, openingQty: 0, openingCost: 0 },
    { code: 'M2-TONER-85A', name: 'تونر 85A', sellPrice: 900, vatPct: 0, openingQty: 0, openingCost: 0 },
    { code: 'M2-IPHONE', name: 'iPhone 15', sellPrice: 42000, vatPct: 14, openingQty: 0, openingCost: 0 },
    { code: 'M2-CBL-VGA', name: 'كابل VGA', sellPrice: 70, vatPct: 0, openingQty: 30, openingCost: 40 },
  ],

  // ---- parties ----
  customers: [
    { name: 'شركة النيل للأنظمة', type: 1, phone: '0122220002', address: 'المعادي، شارع 9', creditLimit: 600000 },
    { name: 'محل Laptop Zone', type: 1, phone: '0122220003', address: 'المعادي', creditLimit: 150000 },
  ],
  suppliers: [
    { name: 'شركة سبيد تك للتوزيع', type: 2, phone: '0122220001', address: 'التجمع الخامس', creditLimit: 600000 },
    { name: 'شركة موبايلى للتوزيع', type: 2, phone: '0122220004', address: 'التجمع الخامس', creditLimit: 800000 },
  ],

  // ---- opening balances ----
  opening: {
    cash: 50000,
    bank: 400000,
    ar: 80000,  // owed by شركة النيل للأنظمة
    ap: 200000, // owed to شركة سبيد تك للتوزيع
  },

  // ---- day-by-day scenario ----
  // daysAgo(days) = today - days
  days: [
    { day: 29, type: 'opening' },   // opening voucher + opening journal
    { day: 27, type: 'purchase', party: 'شركة سبيد تك للتوزيع', lines: [
        { item: 'M2-LAP-I9', qty: 5, unitPrice: 14000, discountPct: 0, vatPct: 14 },
        { item: 'M2-MON-27', qty: 5, unitPrice: 3500, discountPct: 0, vatPct: 14 },
      ], paymentType: 2, paidAmount: 0, note: 'شراء آجل سبيد تك' },
    { day: 25, type: 'sale', party: null, lines: [
        { item: 'M2-LAP-I7', qty: 2, discountPct: 0 },
        { item: 'M2-KB-LOG', qty: 3, discountPct: 0 },
      ], paymentType: 1, paidAmount: null, note: 'بيع نقدي عام' },
    { day: 23, type: 'purchase', party: 'شركة سبيد تك للتوزيع', lines: [
        { item: 'M2-LAP-I7', qty: 10, unitPrice: 10800, discountPct: 0, vatPct: 14 },
      ], paymentType: 2, paidAmount: 0, note: 'شراء آجل بنفس البضاعة بسعر أقل (10%)' },
    { day: 22, type: 'sale', party: 'شركة النيل للأنظمة', lines: [
        { item: 'M2-LAP-I7', qty: 1, discountPct: 0 },
        { item: 'M2-PRN-HP', qty: 1, discountPct: 0 },
      ], paymentType: 2, paidAmount: 0, note: 'آجل شركة النيل' },
    { day: 20, type: 'purchase', party: null, lines: [
        { item: 'M2-TONER-85A', qty: 6, unitPrice: 500, discountPct: 0, vatPct: 0 },
      ], paymentType: 1, paidAmount: 3000, note: 'شراء نقدي تونر' },
    { day: 19, type: 'sale', party: null, lines: [
        { item: 'M2-MOU-LOG', qty: 2, discountPct: 10 },
      ], paymentType: 1, paidAmount: null, note: 'بيع نقدي بحد تأشيري 10%' },
    { day: 17, type: 'sale_return', paymentType: 1, lines: [
        { item: 'M2-KB-LOG', qty: 1, discountPct: 0 },
      ], note: 'مرتجع جزئي من S1' },
    { day: 16, type: 'purchase', party: 'شركة موبايلى للتوزيع', lines: [
        { item: 'M2-IPHONE', qty: 6, unitPrice: 35000, discountPct: 0, vatPct: 14 },
      ], paymentType: 2, paidAmount: 0, note: 'شراء آجل موبايلى' },
    { day: 15, type: 'sale', party: 'شركة النيل للأنظمة', lines: [
        { item: 'M2-LAP-I9', qty: 1, discountPct: 0 },
        { item: 'M2-MON-27', qty: 2, discountPct: 0 },
      ], paymentType: 2, paidAmount: 0, note: 'آجل شركة النيل II' },
    { day: 13, type: 'transfer', fromWarehouse: 'main', toWarehouse: 'sub', lines: [
        { item: 'M2-LAP-I7', qty: 2 },
      ], note: 'تحويل داخلي بين المخازن' },
    { day: 11, type: 'purchase', party: 'شركة سبيد تك للتوزيع', lines: [
        { item: 'M2-MON-27', qty: 5, unitPrice: 3500, discountPct: 4, vatPct: 14 },
      ], paymentType: 2, paidAmount: 0, note: 'شراء خصم 4% على 27"' },
    { day: 10, type: 'sale', party: null, lines: [
        { item: 'M2-MON-27', qty: 1, discountPct: 0 },
        { item: 'M2-KB-LOG', qty: 1, discountPct: 0 },
      ], paymentType: 1, paidAmount: null, note: 'بيع نقدي عام II' },
    { day: 9, type: 'create_then_cancel', party: null, lines: [
        { item: 'M2-PRN-HP', qty: 1, discountPct: 0 },
      ], note: 'S6 نقدي ثم أُلغيت' },
    { day: 7, type: 'sale_return', paymentType: 2, party: 'شركة النيل للأنظمة', lines: [
        { item: 'M2-PRN-HP', qty: 1, discountPct: 0 },
      ], note: 'مرتجع شركة النيل (طابعة)' },
    { day: 5, type: 'collection', party: 'شركة النيل للأنظمة', amount: 15000, note: 'تحصيل نقدي من آجل' },
    { day: 4, type: 'count_shortage', lines: [
        { item: 'M2-MOU-LOG', qty: 1 },
      ], note: 'جرد — زيادة ماوس (العد أكبر من رصيد النظام بـ1)' },
    { day: 4, type: 'damage', lines: [
        { item: 'M2-KB-LOG', qty: 2 },
      ], note: 'تالف' },
    { day: 4, type: 'expense', accountCode: '5104', amount: 8000, note: 'إيجار أكتوبر' },
    { day: 4, type: 'expense', accountCode: '5105', amount: 1500, note: 'كهرباء أكتوبر' },
    { day: 3, type: 'payroll', employees: [
        { name: 'أحمد صبري', basic: 8000, allowance: 200 },
        { name: 'سلمى حسن', basic: 6000, allowance: 200 },
      ], note: 'رواتب أكتوبر' },
    { day: 2, type: 'deposit', amount: 25000, note: 'إيداع من الخزينة إلى البنك' },
    { day: 1, type: 'quotation_order_invoice', party: 'شركة النيل للأنظمة', paymentType: 2, lines: [
        { item: 'M2-LAP-I9', qty: 1, discountPct: 0 },
        { item: 'M2-PRN-HP', qty: 2, discountPct: 0 },
      ], note: 'عرض سعر + أمر + فاتورة — شركة النيل' },
  ],
};
