/* Phase 4 — Month 2 Operations driver: executes all 30 days of operations via API. */
const BASE = process.env.M2_BASE ?? 'http://127.0.0.1:4250/api';
let token = null;
let branchId = null;

async function call(method, path, body, branchOverride) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const active = branchOverride ?? branchId;
  if (active) headers['x-branch-id'] = String(active);
  const r = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(data)}`);
  return data;
}

async function raw(method, path, body, tokenOverride) {
  const headers = { 'Content-Type': 'application/json' };
  if (tokenOverride !== undefined) {
    if (tokenOverride) headers.Authorization = `Bearer ${tokenOverride}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (branchId) headers['x-branch-id'] = String(branchId);
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  try { return { status: r.status, ok: r.ok, body: t ? JSON.parse(t) : null }; } catch { return { status: r.status, ok: r.ok, body: t }; }
}

const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

(async () => {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const daysAgoIso = (d) => {
    // M3 anchor: month2 lives entirely inside أكتوبر 2026 so month3 can follow via E6 closing.
    const dt = new Date(2026, 9, 31);
    dt.setDate(dt.getDate() - d);
    return dt.toISOString().slice(0, 10);
  };

  const whMain = (await call('GET', '/catalog/warehouses')).find((w) => w.code === 'WH-MAIN');
  const whSub = (await call('GET', '/catalog/warehouses')).find((w) => String(w.code).startsWith('WH-SUB'));
  const PCS = (await call('GET', '/catalog/units')).find((u) => u.code === 'PCS').unitId;

  const itemsList = await call('GET', '/items?pageSize=20');
  const items = new Map();
  for (const i of (itemsList.items ?? itemsList)) items.set(i.code, i);
  const item = (code) => items.get(code)?.itemId;
  const itemSell = (code) => items.get(code)?.sellPrice;
  const itemVat = (code) => items.get(code)?.vatPct;
  const itemCost = (code) => items.get(code)?.costPrice;

  // ---- parties
  const partiesList = await call('GET', '/parties?type=1&pageSize=10');
  const partyByName = (name) => (partiesList.items ?? []).find((p) => p.name === name)?.partyId;
  const custNil = 1;
  const custZone = 2;
  const supSpeed = 3;
  const supMobile = 4;

  console.log('=== executing the day-by-day ===');

  // Day 27 — P1: purchase آجل سبيد تك
  const p1 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: supSpeed, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(27), notes: 'شراء آجل سبيد تك — P1',
    lines: [
      { itemId: item('M2-LAP-I9'), unitId: PCS, quantity: 5, unitPrice: 14000, discountPct: 0, taxPct: 14 },
      { itemId: item('M2-MON-27'), unitId: PCS, quantity: 5, unitPrice: 3500, discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('P1:', p1.invoiceId, 'total 99,750');

  // Day 25 — S1 sale نقدي
  const s1 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 36300,
    invoiceDate: daysAgoIso(25), notes: 'بيع نقدي — S1',
    lines: [
      { itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-LAP-I7'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-KB-LOG'), unitId: PCS, quantity: 3, unitPrice: itemSell('M2-KB-LOG'), discountPct: 0, taxPct: 0 },
    ],
  });
  console.log('S1:', s1.invoiceId, 'total 36,300');

  // Day 23 — P2: purchase (cost dropped!) آجل
  const p2 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: supSpeed, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(23), notes: 'شراء آجل — P2 — cost dropped 12k→10.8k',
    lines: [
      { itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 10, unitPrice: 10800, discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('P2:', p2.invoiceId, 'total 123,120');

  // Day 22 — S2: آجل نيابة عن شركة النيل
  const s2 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(22), notes: 'آجل شركة النيل — S2',
    lines: [
      { itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-LAP-I7'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-PRN-HP'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-PRN-HP'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('S2:', s2.invoiceId, 'total 23,940');

  // Day 20 — P3: cash purchase
  const p3 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 3000,
    invoiceDate: daysAgoIso(20), notes: 'شراء نقدي تونر — P3',
    lines: [
      { itemId: item('M2-TONER-85A'), unitId: PCS, quantity: 6, unitPrice: 500, discountPct: 0, taxPct: 0 },
    ],
  });
  console.log('P3:', p3.invoiceId);

  // Day 19 — S3: نقدي بخصم 10%
  const s3 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 720,
    invoiceDate: daysAgoIso(19), notes: 'بيع نقدي بخصم 10% — S3',
    lines: [
      { itemId: item('M2-MOU-LOG'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-MOU-LOG'), discountPct: 10, taxPct: 0 },
    ],
  });
  console.log('S3:', s3.invoiceId);

  // Day 17 — مرتجع S1 (return 1 keyboard)
  const s1return = await call('POST', '/sales/invoices', {
    invoiceType: 3, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 700,
    invoiceDate: daysAgoIso(17), parentInvoiceId: s1.invoiceId,
    notes: 'مرتجع جزئي — S1return',
    lines: [
      { itemId: item('M2-KB-LOG'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-KB-LOG'), discountPct: 0, taxPct: 0 },
    ],
  });
  console.log('S1-return:', s1return.invoiceId);

  // Day 16 — P4: آجل موبايلى
  const p4 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: supMobile, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(16), notes: 'شراء آجل موبايلى — P4',
    lines: [
      { itemId: item('M2-IPHONE'), unitId: PCS, quantity: 6, unitPrice: 35000, discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('P4:', p4.invoiceId, 'total 239,400');

  // Day 15 — S4 آجل II
  const s4 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(15), notes: 'آجل شركة النيل — S4',
    lines: [
      { itemId: item('M2-LAP-I9'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-LAP-I9'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-MON-27'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-MON-27'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('S4:', s4.invoiceId, 'total 28,386');

  // Day 13 — transfer between warehouses same branch (WH-MAIN → WH-SUB)
  const transfer = await call('POST', '/stock-transfers', {
    fromWarehouseId: whMain.warehouseId, toWarehouseId: whSub.warehouseId, transferDate: daysAgoIso(13), notes: 'تحويل داخلي بين المخازن — Day 13',
  });
  // P4-3 — no manual unitCost: the API derives the cost from the source warehouse average.
  await call('POST', `/stock-transfers/${transfer.stockTransferId}/lines`, {
    itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 2,
  });
  await call('POST', `/stock-transfers/${transfer.stockTransferId}/approve`, {});
  await call('POST', `/stock-transfers/${transfer.stockTransferId}/receive`, {});
  console.log('Transfer done');

  // Day 11 — P5 آجل خصم 4%
  const p5 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: supSpeed, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(11), notes: 'شراء سبيد تك خصم 4% — P5',
    lines: [
      { itemId: item('M2-MON-27'), unitId: PCS, quantity: 5, unitPrice: 3500, discountPct: 4, taxPct: 14 },
    ],
  });
  console.log('P5:', p5.invoiceId, 'total 19,152');

  // Day 10 — S5 نقدي عام II
  const s5 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 5488,
    invoiceDate: daysAgoIso(10), notes: 'بيع نقدي — S5',
    lines: [
      { itemId: item('M2-MON-27'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-MON-27'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-KB-LOG'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-KB-LOG'), discountPct: 0, taxPct: 0 },
    ],
  });
  console.log('S5:', s5.invoiceId);

  // Day 9 — S6 نقدي ثم أُلغيت
  const s6 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 6840,
    invoiceDate: daysAgoIso(9), notes: 'S6 نقدي',
    lines: [
      { itemId: item('M2-PRN-HP'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-PRN-HP'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('S6 created:', s6.invoiceId);
  const s6cancel = await call('POST', `/sales/invoices/${s6.invoiceId}/cancel`, {});
  console.log('S6 cancelled:', JSON.stringify(s6cancel));

  // Day 7 — مرتجع شركة النيل (PRN من S2)
  const s2return = await call('POST', '/sales/invoices', {
    invoiceType: 3, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: daysAgoIso(7), parentInvoiceId: s2.invoiceId,
    notes: 'مرتجع شركة النيل — S2 return',
    lines: [
      { itemId: item('M2-PRN-HP'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-PRN-HP'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('S2-return:', s2return.invoiceId);

  // Day 5 — سند قبض جزئي من شركة النيل (آجل)
  const collection = await call('POST', '/accounting/vouchers', {
    voucherType: 1, cashAccountId: 1, partyId: custNil, amount: 15000,
    voucherDate: daysAgoIso(5), paymentMethod: 1,
    description: 'تحصيل جزئي — شركة النيل', allocations: [{ invoiceId: s2.invoiceId, amount: 15000 }],
  });
  console.log('collection:', collection.voucherId);

  // Day 4 — تالف
  const damage = await call('POST', '/stock-vouchers', { warehouseId: whMain.warehouseId, voucherType: 3, voucherDate: daysAgoIso(4), notes: 'تالف 2 كيبورد' });
  const dmgLines = [
    { itemId: item('M2-KB-LOG'), unitId: PCS, quantity: 2, unitCost: 400, notes: 'مكسر' },
  ];
  for (const l of dmgLines) {
    await call('POST', `/stock-vouchers/${damage.stockVoucherId}/lines`, l);
  }
  await call('POST', `/stock-vouchers/${damage.stockVoucherId}/approve`, {});
  console.log('Damage voucher approved');

  // Resolve GL ids by CODE — the seed order shifts ids between releases.
  const accountsTree = await call('GET', '/accounting/accounts');
  const findAccount = (nodes, code) => {
    for (const node of nodes ?? []) {
      if (node.code === code) return node;
      const hit = findAccount(node.children, code);
      if (hit) return hit;
    }
    return null;
  };
  const glId = (code) => {
    const found = findAccount(accountsTree, code);
    if (!found) throw new Error(`GL account ${code} not found`);
    return Number(found.accountId);
  };

  // Day 4 — مصروفات
  const rent = await call('POST', '/accounting/journals', {
    description: 'إيجار أكتوبر', journalDate: daysAgoIso(4), post: true,
    lines: [
      { accountId: glId('5104'), debit: 8000, description: 'إيجار المحل', partyId: null },
      { accountId: glId('1101'), credit: 8000, description: 'سحب من الخزينة', partyId: null },
    ],
  });
  console.log('Rent journal:', rent.journalId);

  const elec = await call('POST', '/accounting/journals', {
    description: 'كهرباء أكتوبر', journalDate: daysAgoIso(4), post: true,
    lines: [
      { accountId: glId('5105'), debit: 1500, description: 'فاتورة كهرباء', partyId: null },
      { accountId: glId('1101'), credit: 1500, description: 'سحب من الخزينة', partyId: null },
    ],
  });
  console.log('Electric journal:', elec.journalId);

  // Day 3 — رواتب الموظفين 2 (احتاج HR أولاً)
  const dept = await call('POST', '/hr/departments', { name: 'الإدارة', branchId });
  const empA = await call('POST', '/hr/employees', { name: 'أحمد صبري', departmentId: dept.departmentId, jobTitle: 'مدير', basicSalary: 8000, allowances: 200, deductions: 0, phone: '01011110000', nationalId: '11111111111111', hireDate: '2026-01-05' });
  const empB = await call('POST', '/hr/employees', { name: 'سلمى حسن', departmentId: dept.departmentId, jobTitle: 'محاسب', basicSalary: 6000, allowances: 200, deductions: 0, phone: '01022220000', nationalId: '22222222222222', hireDate: '2026-02-01' });
  const gen = await call('POST', '/hr/payroll/generate', { periodMonth: '2026-10' }, branchId);
  console.log('Payroll generated:', JSON.stringify(gen));
  const pay = await call('POST', '/hr/payroll/pay', { cashAccountId: 1, periodMonth: '2026-10' });
  console.log('Payroll paid:', JSON.stringify(pay));

  // الجرد بعد أن تم إنشاء موظفين
  const empList = await call('GET', '/hr/employees');
  const empRows = empList.items ?? empList;
  const empId = empRows?.[0]?.employeeId;
  console.log('Employee id:', empId);
  const sc = await call('POST', '/stock-counts', { warehouseId: whMain.warehouseId, employeeId: empId, countDate: daysAgoIso(4), notes: 'الجرد الدوري — أكتوبر' });
  const cntLines = [
    { itemId: item('M2-MOU-LOG'), unitId: PCS, quantity: 14 }, // عجز 1
  ];
  for (const l of cntLines) {
    await call('POST', `/stock-counts/${sc.stockCountId}/lines`, { ...l, countedQty: l.quantity });
  }
  try {
    await call('POST', `/stock-counts/${sc.stockCountId}/approve`, {});
    console.log('Count approved');
  } catch (e) {
    console.log('Count approve failed:', e.message);
  }

  // Day 2 — إيداع من الخزينة إلى البنك
  const dep = await call('POST', '/accounting/journals', {
    description: 'إيداع من الخزينة إلى البنك', journalDate: daysAgoIso(2), post: true,
    lines: [
      { accountId: glId('1102'), debit: 25000, description: 'إيداع', partyId: null },
      { accountId: glId('1101'), credit: 25000, description: 'سحب من الخزينة', partyId: null },
    ],
  });
  console.log('Deposit journal:', dep.journalId);

  // Day 1 — عرض سعر + أمر + فاتورة شركة النيل
  const quot = await call('POST', '/quotations', { partyId: custNil, warehouseId: whMain.warehouseId, quotationDate: daysAgoIso(1), validUntil: daysAgoIso(1), totalAmount: 32490, lines: [
      { itemId: item('M2-LAP-I9'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-LAP-I9'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-PRN-HP'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-PRN-HP'), discountPct: 0, taxPct: 14 },
    ], notes: 'عرض سعر — شركة النيل للأنظمة' });
  console.log('Quotation:', quot.quotationId);
  await call('POST', `/quotations/${quot.quotationId}/status`, { status: 2 }, branchId);
  const converted = await call('POST', `/quotations/${quot.quotationId}/convert`, { invoiceDate: daysAgoIso(1), warehouseId: whMain.warehouseId });
  console.log('Quotation converted:', JSON.stringify(converted));

  console.log('\n[month2] All day-by-day operations complete.');
  process.exit(0);
})().catch((err) => { console.error('FATAL', err); process.exit(1); });
