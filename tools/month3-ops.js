/*
 * M3 — November 2026 operations (the third mini-month after October closes).
 * Purpose: prove the E6 closing rolls forward cleanly — November entries start on the
 * zeroed books and close into retained earnings independently.
 */
const BASE = 'http://127.0.0.1:4250/api';
const daysBefore = (d) => { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0, 10); };
let token = null;
let branchId = null;

async function call(method, path, body, branchOverride) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const active = branchOverride ?? branchId;
  if (active) headers['x-branch-id'] = String(active);
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

(async () => {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const whMain = (await call('GET', '/catalog/warehouses')).find((w) => w.code === 'WH-MAIN');
  const whSub = (await call('GET', '/catalog/warehouses')).find((w) => String(w.code).startsWith('WH-SUB'));
  const PCS = (await call('GET', '/catalog/units')).find((u) => u.code === 'PCS').unitId;

  const itemsList = await call('GET', '/items?pageSize=20');
  const items = new Map();
  for (const i of (itemsList.items ?? itemsList)) items.set(i.code, i);
  const item = (code) => items.get(code)?.itemId;
  const itemSell = (code) => items.get(code)?.sellPrice;
  const itemCost = (code) => items.get(code)?.costPrice;

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
    if (!found) throw new Error(`GL account ${code} not found in ${JSON.stringify(accountsTree).slice(0, 500)}`);
    return Number(found.accountId);
  };

  const partiesList = await call('GET', '/parties?type=1&pageSize=10');
  const party = (name) => (partiesList.items ?? []).find((p) => p.name === name)?.partyId;
  const custNil = 1;
  const custZone = 2;
  const supSpeed = 3;
  const supMobile = 4;

  // November 1 — purchase laptops at a HIGHER price than October (cost increase)
  const p1 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: supSpeed, paymentType: 2, paidAmount: 0,
    invoiceDate: '2026-11-01', notes: 'شراء نوفمبر — P-NOV-1 — ارتفاع التكلفة',
    lines: [
      { itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 4, unitPrice: 12500, discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('P-NOV-1:', p1.invoiceId);

  // November 5 — sale to Nil (آجل): 2 LAP-I7 + random discount
  const s1 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: '2026-11-05', notes: 'آجل شركة النيل — NOV-S1',
    lines: [
      { itemId: item('M2-LAP-I7'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-LAP-I7'), discountPct: 0, taxPct: 14 },
      { itemId: item('M2-MON-27'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-MON-27'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('NOV-S1:', s1.invoiceId);

  // November 8 — cash sale with 10% discount (M2-MOU-LOG)
  const s2 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 720,
    invoiceDate: '2026-11-08', notes: 'بيع نقدي بخصم 10% — NOV-S2',
    lines: [
      { itemId: item('M2-MOU-LOG'), unitId: PCS, quantity: 2, unitPrice: itemSell('M2-MOU-LOG'), discountPct: 10, taxPct: 0 },
    ],
  });
  console.log('NOV-S2:', s2.invoiceId);

  // November 9 — cash printer purchase (1110)
  const p2 = await call('POST', '/sales/invoices', {
    invoiceType: 2, warehouseId: whMain.warehouseId,
    partyId: null, paymentType: 1, cashAccountId: 1, paidAmount: 13000,
    invoiceDate: '2026-11-09', notes: 'شراء نقدي — NOV-P2',
    lines: [
      { itemId: item('M2-PRN-HP'), unitId: PCS, quantity: 2, unitPrice: 5800, discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('NOV-P2:', p2.invoiceId);

  // November 10 — آجل sale عيال (iPhone) — big ticket
  const s3 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: '2026-11-10', notes: 'آجل شركة النيل — NOV-S3 (iPhone)',
    lines: [
      { itemId: item('M2-IPHONE'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-IPHONE'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('NOV-S3:', s3.invoiceId);

  // November 11 — deposit 20,000 from cash to bank
  await call('POST', '/accounting/journals', {
    description: 'إيداع نوفمبر من الخزينة', journalDate: '2026-11-11', post: true,
    lines: [
      { accountId: glId('1102'), debit: 20000, description: 'إيداع', partyId: null },
      { accountId: glId('1101'), credit: 20000, description: 'سحب من الخزينة', partyId: null },
    ],
  });
  console.log('NOV deposit: 20,000');

  // November 12 — سند صرف payroll to single employee Ahmed (basic 8000)
  const hrDept = await call('POST', '/hr/departments', { name: 'شهر نوفمبر', branchId });
  const emp = await call('POST', '/hr/employees', { name: 'موظف NOV', departmentId: hrDept.departmentId, jobTitle: 'أخصائي', basicSalary: 8000, allowances: 0, deductions: 0, phone: '01033330000', nationalId: '33333333333333', hireDate: '2026-11-01' });
  await call('POST', '/hr/payroll/generate', { periodMonth: '2026-11' }, branchId);
  const pay = await call('POST', '/hr/payroll/pay', { cashAccountId: 1, periodMonth: '2026-11' });
  console.log('NOV payroll paid:', JSON.stringify(pay));

  // November 13 — count: 1 KB-LOG missing (damage variant) + 2 cables shortage
  const empList = await call('GET', '/hr/employees');
  const empRows = empList.items ?? empList;
  const empId = empRows?.[0]?.employeeId;
  const count = await call('POST', '/stock-counts', { warehouseId: whMain.warehouseId, employeeId: empId, countDate: '2026-11-12', notes: 'جرد نوفمبر' });
  await call('POST', `/stock-counts/${count.stockCountId}/lines`, { itemId: item('M2-KB-LOG'), unitId: PCS, countedQty: 14 });
  await call('POST', `/stock-counts/${count.stockCountId}/approve`, {});
  console.log('NOV count approved');

  // November 14 — bank expense (electricity Nov)
  const elecNov = await call('POST', '/accounting/journals', {
    description: 'فاتورة كهرباء نوفمبر', journalDate: '2026-11-14', post: true,
    lines: [
      { accountId: glId('5105'), debit: 1800, description: 'كهرباء', partyId: null },
      { accountId: glId('1102'), credit: 1800, description: 'سحب من البنك', partyId: null },
    ],
  });
  console.log('NOV electricity:', elecNov.journalId);

  // November 15 — آجل sale II + quotation converted to invoice
  const s4 = await call('POST', '/sales/invoices', {
    invoiceType: 1, warehouseId: whMain.warehouseId,
    partyId: custNil, paymentType: 2, paidAmount: 0,
    invoiceDate: '2026-11-15', notes: 'آجل شركة النيل — NOV-S4',
    lines: [
      { itemId: item('M2-LAP-I9'), unitId: PCS, quantity: 1, unitPrice: itemSell('M2-LAP-I9'), discountPct: 0, taxPct: 14 },
    ],
  });
  console.log('NOV-S4:', s4.invoiceId);

  console.log('\n[month3] November scenario executed.');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
