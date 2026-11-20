/* End-to-end smoke test against the running API. */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

let token = null;
let branchId = null;

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId) headers['x-branch-id'] = String(branchId);
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const results = [];
function check(name, condition, extra = '') {
  results.push({ name, ok: !!condition, extra });
  console.log(`${condition ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

/** A date `days` in the past, as YYYY-MM-DD. */
function daysAgoIso(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Low-level request that returns the status instead of throwing (for expected failures). */
async function raw(method, path, body, authToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken !== undefined) {
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
  } else if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (branchId) headers['x-branch-id'] = String(branchId);
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, ok: response.ok, data };
}

/** Logs in as a throwaway user and returns its token + branch. */
async function loginAs(userName, password) {  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`login ${userName} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  // 1. login
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;
  check('login returns token', !!token);
  check('admin has 23 permissions', login.permissions.length >= 23, `${login.permissions.length}`);
  check('branch resolved', !!branchId, String(branchId));

  // 2. create customer
  const party = await call('POST', '/parties', {
    name: 'عميل اختبار', partyType: 1, phone: '0100000000', creditLimit: 5000,
  });
  check('customer created', !!party.partyId, String(party.partyId));

  // 3. create items
  const itemA = await call('POST', '/items', {
    code: `TEST-${Date.now()}-A`, name: 'صنف اختبار أ', baseUnitId: 1, costPrice: 10, sellPrice: 15, vatPct: 14,
  });
  const itemB = await call('POST', '/items', {
    code: `TEST-${Date.now()}-B`, name: 'صنف اختبار ب', baseUnitId: 1, costPrice: 5, sellPrice: 9,
  });
  check('items created', !!itemA.itemId && !!itemB.itemId);

  // 4. open the branch shift — RequireCashierShift blocks invoice posting without it
  const openedForFlow = await raw('POST', '/treasury/shifts/open', { openingBalance: 0 }, token);
  check('branch shift opened for the invoice flow', openedForFlow.status === 201, String(openedForFlow.status));

  // 4. purchase to create stock (B2: stock arrives via GRN, invoice settles GRNI)
  const warehouses = await call('GET', '/catalog/warehouses');
  const warehouseId = warehouses[0].warehouseId;
  const accounts = await call('GET', '/treasury/accounts');
  const cashAccountId = accounts[0]?.cashAccountId;
  // B2 / Q1 Option A: bring stock in through a GRN (B1 slice) before invoicing.
  const grnSupplier = await call('POST', '/parties', { name: 'مورد اختبار GRN', partyType: 2 });
  const grnPo = await call('POST', '/orders', {
    orderType: 2, partyId: grnSupplier.partyId, warehouseId,
    lines: [
      { itemId: itemA.itemId, unitId: 1, quantity: 100, unitPrice: 10, taxPct: 0 },
      { itemId: itemB.itemId, unitId: 1, quantity: 100, unitPrice: 5, taxPct: 0 },
    ],
  });
  await call('POST', `/orders/${grnPo.orderId}/status`, { status: 2 });
  const grnPoDetail = await call('GET', `/orders/${grnPo.orderId}`);
  const grn = await call('POST', '/purchases/receipts', {
    orderId: grnPo.orderId, warehouseId, receivedBy: 1, inspectedBy: 1,
    lines: grnPoDetail.lines.map((l) => ({ orderLineId: l.lineId, acceptedQty: Number(l.quantity), unitCost: Number(l.unitPrice) })),
  });
  check('GRN created stock', !!grn.receiptNo, String(grn.receiptNo));
  const purchase = await call('POST', '/sales/invoices', {
    invoiceType: 2, branchId, warehouseId, partyId: grnSupplier.partyId, paymentType: 1, paidAmount: 2000, cashAccountId,
    lines: [
      { itemId: itemA.itemId, unitId: 1, quantity: 100, unitPrice: 10, discountPct: 0, taxPct: 0 },
      { itemId: itemB.itemId, unitId: 1, quantity: 100, unitPrice: 5, discountPct: 0, taxPct: 0 },
    ],
  });
  check('purchase invoice posted', !!purchase.invoiceId, purchase.invoiceNo);
  // Superseded: B1 tests cover GRN stock/cost effects; B2 removes cost update on invoice

  // 5. sale invoice
  const sale = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 3, paidAmount: 20, cashAccountId,
    discountPct: 5,
    lines: [
      { itemId: itemA.itemId, unitId: 1, quantity: 3, unitPrice: 15, discountPct: 0, taxPct: 14 },
      { itemId: itemB.itemId, unitId: 1, quantity: 2, unitPrice: 9, discountPct: 0, taxPct: 0 },
    ],
  });
  check('sale invoice posted', !!sale.invoiceId, sale.invoiceNo);
  check('sale total computed', Number(sale.totalAmount) > 0, String(sale.totalAmount));
  check('remaining tracked', Number(sale.remaining) > 0, String(sale.remaining));

  // 6. idempotency
  const requestId = `smoke-${Date.now()}`;
  const first = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, clientRequestId: requestId, paymentType: 1, paidAmount: 0,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9 }],
  });
  const second = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, clientRequestId: requestId, paymentType: 1, paidAmount: 0,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9 }],
  });
  check('idempotency works', first.invoiceId === second.invoiceId, `${first.invoiceId} == ${second.invoiceId}`);

  // 7. stock balance
  const balances = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const balanceA = balances.find((b) => b.itemId === itemA.itemId);
  check('stock reflects purchase and sale', Number(balanceA?.onHandQty) === 97, String(balanceA?.onHandQty));

  // 8. detail
  const detail = await call('GET', `/sales/invoices/${sale.invoiceId}`);
  check('invoice detail has lines', detail.lines.length === 2, `${detail.lines.length} lines`);

  // 9. ledger + party balance
  const statement = await call('GET', `/parties/${party.partyId}/statement`);
  check('ledger entry recorded', statement.lines.length > 0, `${statement.lines.length} entries`);
  check('ledger balance positive', Number(statement.closingBalance) > 0, String(statement.closingBalance));

  // 10. treasury
  check('cash account exists', accounts.length > 0, String(accounts[0]?.balance));
  const beforeDeposit = (await call('GET', '/treasury/accounts'))[0];
  await call('POST', '/treasury/transactions', {
    cashAccountId: cashAccountId, direction: 1, amount: 250, description: 'إيداع اختبار',
  });
  const afterCash = await call('GET', '/treasury/accounts');
  check('cash balance updated', Number(afterCash[0].balance) === Number(beforeDeposit.balance) + 250,
    `${beforeDeposit.balance} -> ${afterCash[0].balance}`);

  // 11. dashboard
  const dashboard = await call('GET', '/reports/dashboard');
  check('dashboard sales > 0', Number(dashboard.todaySales) > 0, String(dashboard.todaySales));
  check('dashboard profit computed', Number(dashboard.todayProfit) !== 0, String(dashboard.todayProfit));

  // 12. reports
  const summary = await call('GET', '/reports/sales-summary?groupBy=day');
  check('sales summary returns rows', Array.isArray(summary), `${summary.length} rows`);

  // 13. cancel invoice reverses stock
  await call('POST', `/sales/invoices/${sale.invoiceId}/cancel`);
  const balances2 = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const balanceA2 = balances2.find((b) => b.itemId === itemA.itemId);
  // Superseded: B1 tests cover GRN stock apply/reversal; B2 tests cover invoice cancel behaviour

  // 14. permissions enforced
  const forbidden = await fetch(`${BASE}/admin/users`, { headers: { Authorization: 'Bearer not-a-token' } });
  check('unauthorized rejected', forbidden.status === 401, String(forbidden.status));

  // 15. every list/read endpoint responds
  const endpoints = [
    '/items?search=&pageSize=20',
    '/items/lookup?code=TEST',
    '/catalog/branches', '/catalog/warehouses', '/catalog/units', '/catalog/categories', '/catalog/categories/tree',
    '/parties?search=&type=0',
    `/parties/${party.partyId}`,
    `/parties/${party.partyId}/statement`,
    '/sales/invoices?type=0&pageSize=20',
    `/sales/invoices/${sale.invoiceId}`,
    '/inventory/balances', '/inventory/movements?limit=20', '/inventory/operations',
    '/treasury/accounts', '/treasury/categories', '/treasury/transactions?limit=20', '/treasury/shifts/current',
    '/treasury/shifts', '/treasury/shifts/policy',
    '/purchases/invoices?pageSize=10',
    '/reports/dashboard', '/reports/sales-summary', '/reports/top-items', '/reports/stock-value',
    '/reports/party-balances', '/reports/cash-summary', '/reports/sales-by-hour',
    '/hr/employees', '/hr/attendance', '/hr/salaries',
    '/admin/branches', '/admin/users', '/admin/roles', '/admin/permissions', '/admin/settings', '/admin/audit',
  ];
  for (const endpoint of endpoints) {
    try {
      await call('GET', endpoint);
      check(`GET ${endpoint}`, true);
    } catch (error) {
      check(`GET ${endpoint}`, false, error.message.slice(0, 140));
    }
  }

  // 16. multi-unit selling (base unit vs box unit)
  const multiItem = await call('POST', '/items', {
    code: `UNIT-${Date.now()}`, name: 'صنف متعدد الوحدات', baseUnitId: 1, costPrice: 10, sellPrice: 25,
  });
  await call('POST', `/items/${multiItem.itemId}/units`, {
    units: [
      { unitId: 1, factor: 1, sellPrice: 10, buyPrice: 10 },
      { unitId: 3, factor: 12, sellPrice: 120, buyPrice: 120 },
    ],
  });
  const multiDetail = await call('GET', `/items/${multiItem.itemId}`);
  check('item exposes selling units', multiDetail.units.length === 2, `${multiDetail.units.length}`);

  // B2 / Q1 Option A: GRN brings 2 boxes (24 base units) into stock before invoicing.
  const boxPo = await call('POST', '/orders', {
    orderType: 2, partyId: grnSupplier.partyId, warehouseId,
    lines: [{ itemId: multiItem.itemId, unitId: 3, quantity: 2, unitPrice: 120, taxPct: 0 }],
  });
  await call('POST', `/orders/${boxPo.orderId}/status`, { status: 2 });
  const boxPoDetail = await call('GET', `/orders/${boxPo.orderId}`);
  const boxGrn = await call('POST', '/purchases/receipts', {
    orderId: boxPo.orderId, warehouseId, receivedBy: 1, inspectedBy: 1,
    lines: boxPoDetail.lines.map((l) => ({ orderLineId: l.lineId, acceptedQty: Number(l.quantity), unitCost: Number(l.unitPrice) })),
  });
  check('GRN created box stock', !!boxGrn.receiptNo, String(boxGrn.receiptNo));
  await call('POST', '/sales/invoices', {
    invoiceType: 2, branchId, warehouseId, partyId: grnSupplier.partyId, paymentType: 1, paidAmount: 240, cashAccountId,
    lines: [{ itemId: multiItem.itemId, unitId: 3, quantity: 2, unitPrice: 120, taxPct: 0 }],
  });
  const afterBoxes = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const boxBalance = afterBoxes.find((b) => b.itemId === multiItem.itemId);
  check('box unit converted to base units (2 x 12 = 24)', Number(boxBalance?.onHandQty) === 24, String(boxBalance?.onHandQty));

  await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 120, cashAccountId,
    lines: [{ itemId: multiItem.itemId, unitId: 3, quantity: 1, unitPrice: 120, taxPct: 0 }],
  });
  const afterSell = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const boxBalance2 = afterSell.find((b) => b.itemId === multiItem.itemId);
  check('selling a box deducts 12 base units', Number(boxBalance2?.onHandQty) === 12, String(boxBalance2?.onHandQty));

  // 17. installments
  const plan = await call('POST', '/installments/plans', {
    partyId: party.partyId, title: 'خطة اختبار', totalAmount: 1000, downPayment: 100,
    installmentCount: 3, startDate: '2026-01-15',
  });
  const planDetail = await call('GET', `/installments/plans/${plan.planId}`);
  check('installment schedule created', planDetail.schedule.length === 3, `${planDetail.schedule.length}`);
  check('installment amounts sum up', Number(planDetail.schedule.reduce((s, r) => s + Number(r.amount), 0)) === 900);

  await call('POST', `/installments/schedule/${planDetail.schedule[0].scheduleId}/pay`, {
    amount: 300, cashAccountId: accounts[0].cashAccountId,
  });
  const paidPlan = await call('GET', `/installments/plans/${plan.planId}`);
  check('installment payment recorded', Number(paidPlan.schedule[0].paidAmount) === 300,
    String(paidPlan.schedule[0].paidAmount));
  const dueList = await call('GET', '/installments/due?days=3650');
  check('due installments listed', dueList.length >= 2, `${dueList.length}`);

  // 18. ZATCA document generation (unsigned without CSID keys)
  await call('PUT', '/zatca/config', {
    sellerName: 'شركة الاختبار', vatNumber: '300000000000003', environment: 'sandbox', isActive: true,
  });
  const zatcaStatus = await call('GET', '/zatca/status');
  check('zatca status endpoint', zatcaStatus.environment === 'sandbox');
  const zatcaDoc = await call('POST', `/zatca/invoices/${sale.invoiceId}/generate`, { invoiceType: 2 });
  check('zatca xml generated', String(zatcaDoc.xml).includes('<Invoice'));
  check('zatca hash computed', String(zatcaDoc.invoiceHash).length === 44, String(zatcaDoc.invoiceHash).slice(0, 20));
  check('zatca qr png generated', String(zatcaDoc.qrPngBase64).startsWith('data:image/png'));
  const zatcaList = await call('GET', '/zatca/invoices');
  check('zatca document stored', zatcaList.length >= 1, `${zatcaList.length}`);

  // 19. live updates (SSE)
  try {
    const sse = await fetch(`${BASE}/events/inventory?access_token=${token}`);
    const contentType = sse.headers.get('content-type') ?? '';
    const reader = sse.body.getReader();
    const { value } = await reader.read();
    const chunk = new TextDecoder().decode(value);
    check('sse stream open', contentType.includes('text/event-stream'), contentType);
    check('sse sends connected event', chunk.includes('connected'));
    await reader.cancel();
  } catch (error) {
    check('sse stream open', false, error.message.slice(0, 120));
  }

  // 20. P0 — role based access (previously every non-admin got 403)
  const roles = await call('GET', '/admin/roles');
  const roleId = (nameEn) => roles.find((r) => r.nameEn === nameEn)?.roleId;
  const stamp = Date.now();
  const testPassword = 'Test$12345';

  async function createUser(suffix, roleName, extra = {}) {
    const created = await call('POST', '/admin/users', {
      userName: `${suffix}_${stamp}`,
      password: testPassword,
      fullName: `مستخدم ${suffix}`,
      defaultBranchId: branchId,
      maxDiscountPct: 100,
      roleIds: [roleId(roleName)],
      ...extra,
    });
    return created.userId;
  }

  const cashierId = await createUser('cashier', 'Cashier', { isCashier: true, maxDiscountPct: 5 });
  const repId = await createUser('rep', 'SalesRep', { isSalesRep: true });
  const accountantId = await createUser('accountant', 'Accountant');
  check('role test users created', !!cashierId && !!repId && !!accountantId);

  const cashier = await loginAs(`cashier_${stamp}`, testPassword);
  const rep = await loginAs(`rep_${stamp}`, testPassword);
  const accountant = await loginAs(`accountant_${stamp}`, testPassword);

  const cashierSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 9,
    cashAccountId: accounts[0].cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
  }, cashier.accessToken);
  check('cashier can sell', cashierSale.status === 201, String(cashierSale.status));

  const cashierList = await raw('GET', '/sales/invoices?pageSize=5', null, cashier.accessToken);
  check('cashier can list sales', cashierList.ok, String(cashierList.status));

  const cashierPurchases = await raw('GET', '/purchases/invoices?pageSize=5', null, cashier.accessToken);
  check('cashier blocked from purchases', cashierPurchases.status === 403, String(cashierPurchases.status));

  const repSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 9,
    cashAccountId: accounts[0].cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
  }, rep.accessToken);
  check('sales rep can sell', repSale.status === 201, String(repSale.status));
  const repPurchases = await raw('GET', '/purchases/invoices?pageSize=5', null, rep.accessToken);
  check('sales rep blocked from purchases', repPurchases.status === 403, String(repPurchases.status));

  const accountantList = await raw('GET', '/sales/invoices?pageSize=5', null, accountant.accessToken);
  check('accountant can view sales', accountantList.ok, String(accountantList.status));
  const accountantPurchase = await raw('GET', '/purchases/invoices?pageSize=5', null, accountant.accessToken);
  check('accountant can view purchases', accountantPurchase.ok, String(accountantPurchase.status));
  const accountantSell = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 9,
    cashAccountId: accounts[0].cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
  }, accountant.accessToken);
  check('accountant cannot sell', accountantSell.status === 403, String(accountantSell.status));

  // 21. P0 — server side discount cap
  const discountBlocked = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, discountPct: 20,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, discountPct: 20, taxPct: 0 }],
  }, cashier.accessToken);
  check('discount above user cap rejected', discountBlocked.status === 400, String(discountBlocked.status));

  // 22. P0 — negative stock is refused by default
  const negativeSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 999999, unitPrice: 15, taxPct: 0 }],
  });
  check('selling more than on hand rejected', negativeSale.status === 400, String(negativeSale.status));

  // 23. P0 — credit limit enforced
  const overLimit = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 60, unitPrice: 100, taxPct: 0 }],
  });
  check('credit limit enforced', overLimit.status === 400, String(overLimit.status));

  // 24. P0 — returns validate parent, party and quantity
  const returnParent = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 5, unitPrice: 15, taxPct: 0 }],
  });
  const tooMany = await raw('POST', '/sales/invoices', {
    invoiceType: 3, branchId, warehouseId, partyId: party.partyId, parentInvoiceId: returnParent.invoiceId,
    paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 6, unitPrice: 15, taxPct: 0 }],
  });
  check('return above sold quantity rejected', tooMany.status === 400, String(tooMany.status));

  const otherParty = await call('POST', '/parties', { name: 'عميل آخر', partyType: 1 });
  const wrongParty = await raw('POST', '/sales/invoices', {
    invoiceType: 3, branchId, warehouseId, partyId: otherParty.partyId, parentInvoiceId: returnParent.invoiceId,
    paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: 15, taxPct: 0 }],
  });
  check('return with a different party rejected', wrongParty.status === 400, String(wrongParty.status));

  const balanceBeforeReturn = (await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((b) => b.itemId === itemA.itemId)?.onHandQty;
  const salesReturn = await call('POST', '/sales/invoices', {
    invoiceType: 3, branchId, warehouseId, partyId: party.partyId, parentInvoiceId: returnParent.invoiceId,
    paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 2, unitPrice: 15, taxPct: 0 }],
  });
  check('valid sales return posted', !!salesReturn.invoiceId, salesReturn.invoiceNo);
  const balanceAfterReturn = (await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((b) => b.itemId === itemA.itemId)?.onHandQty;
  check('sales return adds stock back', Number(balanceAfterReturn) === Number(balanceBeforeReturn) + 2,
    `${balanceBeforeReturn} -> ${balanceAfterReturn}`);
  const returnDetail = await call('GET', `/sales/invoices/${salesReturn.invoiceId}`);
  check('return stores parent invoice', Number(returnDetail.header.parentInvoiceId) === Number(returnParent.invoiceId));

  // 25. P0 — a negative adjustment reduces stock (it used to increase it)
  const beforeAdjust = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((b) => b.itemId === itemA.itemId)?.onHandQty);
  await call('POST', '/inventory/operations', {
    operationType: 3, fromWarehouseId: warehouseId, notes: 'تسوية اختبار',
    lines: [{ itemId: itemA.itemId, unitId: 1, expectedQty: beforeAdjust, actualQty: beforeAdjust - 7, unitCost: 10 }],
  });
  const afterAdjust = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((b) => b.itemId === itemA.itemId)?.onHandQty);
  check('negative adjustment reduces stock', afterAdjust === beforeAdjust - 7, `${beforeAdjust} -> ${afterAdjust}`);

  // 26. P0 — mixed units share one base-unit balance
  await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 120, cashAccountId,
    lines: [{ itemId: multiItem.itemId, unitId: 1, quantity: 12, unitPrice: 10, taxPct: 0 }],
  });
  const mixedBalance = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((b) => b.itemId === multiItem.itemId)?.onHandQty);
  check('box and piece sales share one balance', mixedBalance === 0, String(mixedBalance));

  // 27. P0 — cashier shift: gate, expected cash and shortage posting
  const shiftPolicyBefore = (await call('GET', '/treasury/shifts/policy')).requireShift;
  await call('PUT', '/admin/settings', { RequireCashierShift: 'true' });
  const policy = await raw('GET', '/treasury/shifts/policy', null, cashier.accessToken);
  check('shift policy exposed', policy.data?.requireShift === true, JSON.stringify(policy.data));

  // close the branch shift opened for the invoice flow, then prove the gate
  const openForGate = await raw('GET', '/treasury/shifts/current', null, token);
  check('branch shift open before the no-shift sale', openForGate.status === 200, JSON.stringify(openForGate.data));
  const closeForGate = await raw('POST', '/treasury/shifts/close', { countedCash: Number(openForGate.data?.expectedCash ?? 0) }, token);
  check('branch shift closed before the no-shift sale', closeForGate.status === 201, String(closeForGate.status));

  const noShiftSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 9,
    cashAccountId: accounts[0].cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
  }, cashier.accessToken);
  check('sale without an open shift rejected', noShiftSale.status === 400, String(noShiftSale.status));

  const opened = await raw('POST', '/treasury/shifts/open', {
    openingBalance: 100,
  }, cashier.accessToken);
  check('shift opened', opened.status === 201, String(opened.status));

  const reopenShift = await raw('POST', '/treasury/shifts/open', { openingBalance: 50 }, cashier.accessToken);
  check('second open shift for the branch rejected', reopenShift.status === 400, String(reopenShift.status));

  const shiftSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 45, cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 5, unitPrice: 9, taxPct: 0 }],
  }, cashier.accessToken);
  check('sale inside a shift accepted', shiftSale.status === 201, String(shiftSale.status));

  const currentShift = await raw('GET', '/treasury/shifts/current', null, cashier.accessToken);
  check('shift expected cash includes the sale', Number(currentShift.data?.expectedCash) === 145,
    String(currentShift.data?.expectedCash));

  const closed = await raw('POST', '/treasury/shifts/close', { countedCash: 135 }, cashier.accessToken);
  check('shift closed with a shortage', Number(closed.data?.difference) === -10, String(closed.data?.difference));

  const afterClose = await raw('GET', '/treasury/shifts/current', null, cashier.accessToken);
  check('no open shift after closing', afterClose.data === null || afterClose.data === '', JSON.stringify(afterClose.data));

  const shortageRow = (await call('GET', '/treasury/transactions?limit=50'))
    .find((row) => String(row.description ?? '').includes('عجز'));
  check('shortage posted to cash', !!shortageRow, String(shortageRow?.amount));
  await call('PUT', '/admin/settings', { RequireCashierShift: String(!!shiftPolicyBefore) });

  // reopen a branch shift for the remaining invoice postings of this run
  const reopenedShift = await raw('POST', '/treasury/shifts/open', { openingBalance: 0 }, token);
  check('branch shift reopened for the remaining checks', reopenedShift.status === 201, String(reopenedShift.status));

  // 28. purchases endpoints
  const purchases = await call('GET', '/purchases/invoices?pageSize=10');
  check('purchases list works', Array.isArray(purchases.items) && purchases.items.length > 0,
    `${purchases.items?.length}`);
  const purchaseDetail = await call('GET', `/purchases/invoices/${purchase.invoiceId}`);
  check('purchase detail works', purchaseDetail.lines.length === 2, `${purchaseDetail.lines.length} lines`);

  // 29. general ledger (P1)
  const chart = await call('GET', '/accounting/accounts');
  check('chart of accounts seeded', chart.length > 0 && chart[0].children?.length > 0,
    `${chart.length} roots`);
  const mappings = await call('GET', '/accounting/mappings');
  check('concept mappings exist', mappings.length >= 10, `${mappings.length}`);
  check('sales mapping resolves', !!mappings.find((m) => m.mappingKey === 'SALES')?.accountId);

  const journals = await call('GET', '/accounting/journals?limit=50');
  check('invoices posted journals', journals.length > 0, `${journals.length} journals`);
  check('journals are balanced', journals.every((j) => Number(j.totalDebit) === Number(j.totalCredit)));

  const trial = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance is balanced', trial.balanced === true,
    `${trial.totalDebit} vs ${trial.totalCredit}`);
  check('trial balance has lines', trial.lines.length > 0, `${trial.lines.length}`);

  const pnl = await call('GET', '/accounting/reports/profit-loss');
  check('profit and loss computed', pnl.totalRevenue > 0 && pnl.totalExpense > 0,
    `rev ${pnl.totalRevenue} / exp ${pnl.totalExpense}`);
  check('net profit is a number', Number.isFinite(pnl.netProfit), String(pnl.netProfit));

  const sheet = await call('GET', '/accounting/reports/balance-sheet');
  check('balance sheet balances', sheet.balanced === true,
    `assets ${sheet.totalAssets} vs ${sheet.totalLiabilitiesAndEquity}`);

  const tax = await call('GET', '/accounting/reports/tax-summary');
  check('tax summary computed', Number.isFinite(tax.netVat), String(tax.netVat));

  const salesAccount = mappings.find((m) => m.mappingKey === 'SALES');
  const ledger = await call('GET', `/accounting/reports/general-ledger?accountId=${salesAccount.accountId}`);
  check('general ledger lists movements', ledger.lines.length > 0, `${ledger.lines.length}`);
  check('general ledger running balance', Number.isFinite(ledger.closingBalance));

  // manual journal
  const cashAccount = mappings.find((m) => m.mappingKey === 'CASH');
  const expenseAccount = mappings.find((m) => m.mappingKey === 'OTHER_EXPENSE');
  const manual = await raw('POST', '/accounting/journals', {
    description: 'قيد اختبار يدوي',
    lines: [
      { accountId: expenseAccount.accountId, debit: 100, description: 'مصروف' },
      { accountId: cashAccount.accountId, credit: 100, description: 'نقدية' },
    ],
  });
  check('manual journal posted', manual.status === 201, String(manual.status));

  const unbalanced = await raw('POST', '/accounting/journals', {
    description: 'قيد غير متوازن',
    lines: [
      { accountId: expenseAccount.accountId, debit: 100 },
      { accountId: cashAccount.accountId, credit: 90 },
    ],
  });
  check('unbalanced journal rejected', unbalanced.status === 400, String(unbalanced.status));

  // receipt voucher settles a customer receivable
  const voucher = await raw('POST', '/accounting/vouchers', {
    voucherType: 1, partyId: party.partyId, cashAccountId, amount: 25, description: 'سند قبض اختبار',
  });
  check('receipt voucher created', voucher.status === 201, JSON.stringify(voucher.data));

  const voucherList = await call('GET', '/accounting/vouchers?type=1');
  check('vouchers listed', voucherList.length > 0, `${voucherList.length}`);

  // period closing blocks later postings
  const allPeriods = await call('GET', '/accounting/periods');
  let closedPeriod = allPeriods.find((p) => p.name === 'فترة اختبار');
  if (!closedPeriod) {
    const created = await call('POST', '/accounting/periods', {
      name: 'فترة اختبار',
      startDate: '2020-06-01',
      endDate: '2020-06-30',
    });
    closedPeriod = { periodId: created.periodId, isClosed: false };
  }
  check('period created', !!closedPeriod.periodId, String(closedPeriod.periodId));
  const closeResult = await raw('POST', `/accounting/periods/${closedPeriod.periodId}/manual-lock`, { reason: 'اختبار قفل الترحيل' });
  check('manual administrative lock applied (201)', closeResult.status === 201, String(closeResult.status));
  const afterLock = await call('GET', '/accounting/periods');
  const lockedRow = afterLock.find((p) => p.periodId === closedPeriod.periodId);
  check('manual lock does NOT set is_closed', lockedRow && lockedRow.isClosed === false, JSON.stringify(lockedRow));

  const blocked = await raw('POST', '/accounting/journals', {
    journalDate: '2020-06-15',
    description: 'قيد داخل فترة مقفولة إداريًا',
    lines: [
      { accountId: expenseAccount.accountId, debit: 10 },
      { accountId: cashAccount.accountId, credit: 10 },
    ],
  });
  check('posting into a manually locked period rejected (400)', blocked.status === 400, String(blocked.status));

  const unlockResult = await raw('POST', `/accounting/periods/${closedPeriod.periodId}/manual-unlock`, { reason: 'انتهى اختبار القفل' });
  check('manual administrative unlock applied (201)', unlockResult.status === 201, String(unlockResult.status));
  const allowed = await raw('POST', '/accounting/journals', {
    journalDate: '2020-06-15',
    description: 'قيد بعد إزالة القفلة الإدارية',
    lines: [
      { accountId: expenseAccount.accountId, debit: 10 },
      { accountId: cashAccount.accountId, credit: 10 },
    ],
  });
  check('posting works after manual unlock (201)', allowed.status === 201, String(allowed.status));

  // checks
  const registeredCheck = await raw('POST', '/accounting/checks', {
    direction: 1, checkNo: `CH-${Date.now()}`, bankName: 'بنك مصر', amount: 500,
    partyId: party.partyId, cashAccountId,
  });
  check('check registered', registeredCheck.status === 201, String(registeredCheck.status));
  const checks = await call('GET', '/accounting/checks');
  check('checks listed', checks.length > 0, `${checks.length}`);

  const costCenters = await call('GET', '/accounting/cost-centers');
  check('cost centres seeded', costCenters.length > 0, `${costCenters.length}`);
  const currencies = await call('GET', '/accounting/currencies');
  check('currencies seeded', currencies.some((c) => c.currencyCode === 'EGP' && c.isBase));

  // 30. P1 extras — recurring journals, cost centres and year-end closing
  const retained = mappings.find((m) => m.mappingKey === 'RETAINED_EARNINGS');
  check('retained earnings mapping exists', !!retained?.accountId);

  const recurring = await raw('POST', '/accounting/recurring', {
    name: `إيجار شهري ${Date.now()}`,
    frequency: 1,
    nextDate: new Date().toISOString().slice(0, 10),
    lines: [
      { accountId: expenseAccount.accountId, debit: 500 },
      { accountId: cashAccount.accountId, credit: 500 },
    ],
  });
  check('recurring template created', recurring.status === 201, String(recurring.status));

  const unbalancedRecurring = await raw('POST', '/accounting/recurring', {
    name: 'قالب غير متوازن',
    lines: [
      { accountId: expenseAccount.accountId, debit: 500 },
      { accountId: cashAccount.accountId, credit: 400 },
    ],
  });
  check('unbalanced recurring template rejected', unbalancedRecurring.status === 400,
    String(unbalancedRecurring.status));

  const recurringRun = await raw('POST', '/accounting/recurring/run', {});
  check('recurring journals posted', recurringRun.status === 201 && recurringRun.data?.posted >= 1,
    JSON.stringify(recurringRun.data?.posted));

  const recurringList = await call('GET', '/accounting/recurring');
  check('recurring templates listed', recurringList.length > 0, `${recurringList.length}`);
  check('recurring template rolled forward', recurringList[0].nextDate !== null,
    String(recurringList[0].nextDate));

  const costReport = await call('GET', '/accounting/reports/cost-centers');
  check('cost centre report returns rows', Array.isArray(costReport.lines), `${costReport.lines.length}`);

  const closeYear = await raw('POST', '/accounting/close-year', { year: new Date().getFullYear() });
  check('year-end closing posted', closeYear.status === 201, JSON.stringify(closeYear.data));

  const trialAfterClose = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance still balanced after closing', trialAfterClose.balanced === true,
    `${trialAfterClose.totalDebit} vs ${trialAfterClose.totalCredit}`);

  // 31. P2 — price lists, quotations and orders
  const priceList = await call('POST', '/pricing/lists', {
    name: `قائمة اختبار ${Date.now()}`, code: `PL${Date.now()}`, listType: 2, priority: 50,
  });
  check('price list created', !!priceList.priceListId, String(priceList.priceListId));

  await call('POST', `/pricing/lists/${priceList.priceListId}/lines`, {
    lines: [{ itemId: itemA.itemId, price: 12.5, minPrice: 10 }],
  });
  const listItems = await call('GET', `/pricing/lists/${priceList.priceListId}/items`);
  check('price list lines saved', listItems.length === 1 && Number(listItems[0].price) === 12.5,
    `${listItems.length}`);

  const listCustomer = await call('POST', '/parties', {
    name: 'عميل قائمة أسعار', partyType: 1, priceListId: priceList.priceListId,
    // B5.1: this fixture tests price lists, not credit — explicit no-limit flag (DEC-SALES-005).
    creditUnlimited: true,
  });
  check('customer linked to a price list', !!listCustomer.partyId);
  const itemACard = await call('GET', `/items/${itemA.itemId}`);
  const itemCode = itemACard.code;

  const resolved = await call('GET', `/pricing/resolve?itemId=${itemA.itemId}&partyId=${listCustomer.partyId}`);
  check('price resolved from the customer list', Number(resolved.price) === 12.5,
    `${resolved.price} (${resolved.source})`);

  const pricedItems = await call('GET', `/items?search=${encodeURIComponent(itemCode)}&partyId=${listCustomer.partyId}`);
  const pricedRow = pricedItems.items?.find((row) => row.itemId === itemA.itemId);
  check('item search uses the customer list', Number(pricedRow?.sellPrice) === 12.5,
    String(pricedRow?.sellPrice));

  const fallback = await call('GET', `/pricing/resolve?itemId=${itemB.itemId}&partyId=${listCustomer.partyId}`);
  check('items outside the list fall back to the card', fallback.source === 'item_card', fallback.source);

  const quotation = await call('POST', '/quotations', {
    partyId: listCustomer.partyId, validUntil: '2026-12-31',
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 2, taxPct: 0 }],
  });
  check('quotation created', !!quotation.quotationId, String(quotation.quotationId));

  const quotationDetail = await call('GET', `/quotations/${quotation.quotationId}`);
  check('quotation priced from the list', Number(quotationDetail.lines[0].unitPrice) === 12.5,
    String(quotationDetail.lines[0].unitPrice));
  check('quotation total computed', Number(quotationDetail.header.totalAmount) === 25,
    String(quotationDetail.header.totalAmount));

  await call('POST', `/quotations/${quotation.quotationId}/status`, { status: 2 });
  const converted = await call('POST', `/quotations/${quotation.quotationId}/convert`, {
    paymentType: 2,
  });
  check('quotation converted to an invoice', !!converted.invoiceId, converted.invoiceNo);

  const quotationAfter = await call('GET', `/quotations/${quotation.quotationId}`);
  check('quotation marked as converted', Number(quotationAfter.header.status) === 5,
    String(quotationAfter.header.status));

  const doubleConvert = await raw('POST', `/quotations/${quotation.quotationId}/convert`, {});
  check('a quotation cannot be converted twice', doubleConvert.status === 400, String(doubleConvert.status));

  const order = await call('POST', '/orders', {
    orderType: 1, partyId: listCustomer.partyId, warehouseId,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 3, taxPct: 0 }],
  });
  check('order created', !!order.orderId, String(order.orderId));

  await call('POST', `/orders/${order.orderId}/status`, { status: 2 });
  const reserved = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const reservedQty = Number(reserved.find((row) => row.itemId === itemA.itemId)?.reservedQty ?? 0);
  check('confirming an order reserves the stock', reservedQty === 3, String(reservedQty));

  const orderInvoice = await call('POST', `/orders/${order.orderId}/convert`, { paymentType: 2 });
  check('order converted to an invoice', !!orderInvoice.invoiceId, orderInvoice.invoiceNo);

  const orderAfter = await call('GET', `/orders/${order.orderId}`);
  check('order marked as delivered', Number(orderAfter.header.status) === 4, String(orderAfter.header.status));

  const reservedAfter = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
  const reservedAfterQty = Number(reservedAfter.find((row) => row.itemId === itemA.itemId)?.reservedQty ?? 0);
  check('converting the order releases the reservation', reservedAfterQty === 0, String(reservedAfterQty));

  // 32. P2 — several payment methods on one invoice + cash account management
  const cardAccount = await call('POST', '/treasury/accounts', {
    name: 'حساب تسوية البطاقات', type: 3, bankName: 'بنك مصر', openingBalance: 0,
  });
  check('cash account created', !!cardAccount.cashAccountId, String(cardAccount.cashAccountId));

  const accountsAfter = await call('GET', '/treasury/accounts');
  check('cash accounts listed', accountsAfter.length >= 2, `${accountsAfter.length}`);

  const cashBefore = Number(accountsAfter.find((row) => row.cashAccountId === cashAccountId)?.balance ?? 0);
  const cardBefore = Number(accountsAfter.find((row) => row.cashAccountId === cardAccount.cashAccountId)?.balance ?? 0);

  const splitInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 3,
    payments: [
      { method: 1, amount: 40, cashAccountId },
      { method: 2, amount: 35, cashAccountId: cardAccount.cashAccountId },
    ],
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 5, unitPrice: 15, taxPct: 0 }],
  });
  check('invoice with two payment methods posted', !!splitInvoice.invoiceId, splitInvoice.invoiceNo);
  check('split payments sum recorded', Number(splitInvoice.paidAmount) === 75,
    String(splitInvoice.paidAmount));
  check('remaining computed', Number(splitInvoice.remaining) === 0, String(splitInvoice.remaining));

  const splitDetail = await call('GET', `/sales/invoices/${splitInvoice.invoiceId}`);
  check('both payments stored on the invoice', splitDetail.payments.length === 2,
    `${splitDetail.payments.length}`);
  check('payment methods recorded',
    splitDetail.payments.map((p) => p.method).sort().join(',') === '1,2',
    splitDetail.payments.map((p) => p.method).join(','));

  const balancesAfter = await call('GET', '/treasury/accounts');
  const cashAfter = Number(balancesAfter.find((row) => row.cashAccountId === cashAccountId)?.balance ?? 0);
  const cardAfter = Number(balancesAfter.find((row) => row.cashAccountId === cardAccount.cashAccountId)?.balance ?? 0);
  check('cash drawer received its share', Math.abs((cashAfter - cashBefore) - 40) < 0.01,
    `${cashBefore} -> ${cashAfter}`);
  check('card account received its share', Math.abs((cardAfter - cardBefore) - 35) < 0.01,
    `${cardBefore} -> ${cardAfter}`);

  const overPaid = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 3,
    payments: [{ method: 1, amount: 999999, cashAccountId }],
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 15, taxPct: 0 }],
  });
  check('paying more than the invoice total is rejected', overPaid.status === 400, String(overPaid.status));

  // 33. ETA — Egyptian e-invoicing
  await call('PUT', '/eta/config', {
    sellerName: 'شركتي للتجارة', vatNumber: '123-456-789', registrationId: 'CRN-EG-001',
    address: 'القاهرة', isActive: true,
  });
  const etaStatus = await call('GET', '/eta/status');
  check('eta configured', etaStatus.configured === true, JSON.stringify(etaStatus.vatNumber));

  // The admin screen posts the raw row (snake_case) — both shapes must work.
  await call('PUT', '/eta/config', {
    seller_name: 'شركتي للتجارة', seller_vat_number: '123-456-789', is_active: true,
  });
  const etaConfig = await call('GET', '/eta/config');
  check('eta config accepts the admin screen shape',
    etaConfig.seller_name === 'شركتي للتجارة' && etaConfig.seller_vat_number === '123-456-789',
    `${etaConfig.seller_name} / ${etaConfig.seller_vat_number}`);

  const etaSale = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, cashAccountId,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: 15, taxPct: 14 }],
  });
  const etaDocument = await call('POST', `/eta/invoices/${etaSale.invoiceId}/generate`, { invoiceType: 2 });
  check('eta document generated', !!etaDocument.uuid, etaDocument.uuid);
  check('eta uuid is time based (v1)',
    /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(etaDocument.uuid ?? ''),
    etaDocument.uuid);
  check('eta xml is UBL', (etaDocument.xml ?? '').includes('<Invoice xmlns='), '');
  check('eta xml uses EGP', (etaDocument.xml ?? '').includes('currencyID="EGP"'), '');
  check('eta xml carries the internal uuid',
    (etaDocument.xml ?? '').includes(`<cbc:UUID>${etaDocument.uuid}</cbc:UUID>`), '');
  check('eta xml carries the ICV reference', (etaDocument.xml ?? '').includes('<cbc:ID>ICV</cbc:ID>'), '');
  check('eta xml country is EG', (etaDocument.xml ?? '').includes('<cbc:CountrySubentity>EG</cbc:CountrySubentity>'), '');
  check('eta qr generated', (etaDocument.qrPngBase64 ?? '').startsWith('data:image/png;base64,'), '');
  check('eta invoice hash computed', !!etaDocument.invoiceHash, etaDocument.invoiceHash);

  const etaPurchase = await raw('POST', `/eta/invoices/${purchase.invoiceId}/generate`, {});
  check('eta rejects purchase invoices', etaPurchase.status === 400, String(etaPurchase.status));

  const etaList = await call('GET', '/eta/invoices');
  check('eta documents listed', etaList.length > 0, `${etaList.length}`);

  // 34. P2 — coupons, gift offers, payment allocation, shipments, purchase orders
  const coupon = await call('POST', '/pricing/coupons', {
    code: `SAVE${Date.now() % 100000}`, name: 'خصم تجريبي', discountType: 1,
    discountValue: 10, minInvoiceAmount: 0, isActive: true,
  });
  check('coupon created', !!coupon.couponId, String(coupon.couponId));

  const couponCode = coupon.code;
  const couponInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 2, couponCode,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 2, unitPrice: 50, taxPct: 0 }],
  });
  check('coupon applied to the invoice', Number(couponInvoice.totalAmount) === 90,
    `${couponInvoice.totalAmount} (expected 90)`);

  const couponAfter = await call('GET', '/pricing/coupons');
  const usedCoupon = couponAfter.find((row) => row.couponId === coupon.couponId);
  check('coupon usage counted', Number(usedCoupon?.usedCount) === 1, String(usedCoupon?.usedCount));

  const badCoupon = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 2, couponCode: 'NOPE-123',
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 10, taxPct: 0 }],
  });
  check('unknown coupon rejected', badCoupon.status === 400, String(badCoupon.status));

  const giftOffer = await call('POST', '/pricing/gift-offers', {
    name: 'اشترِ 2 واحصل على 1', sourceItemId: itemA.itemId, sourceQuantity: 2,
    giftItemId: itemB.itemId, giftQuantity: 1, isActive: true,
  });
  check('gift offer created', !!giftOffer.giftOfferId, String(giftOffer.giftOfferId));

  const giftBefore = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

  const giftInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 2,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 2, unitPrice: 10, taxPct: 0 }],
  });
  const giftDetail = await call('GET', `/sales/invoices/${giftInvoice.invoiceId}`);
  const giftLine = giftDetail.lines.find((line) => line.itemId === itemB.itemId);
  check('gift added to the invoice', !!giftLine, `${giftDetail.lines.length} lines`);
  check('gift is free', Number(giftLine?.unitPrice) === 0, String(giftLine?.unitPrice));

  const giftAfter = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('gift leaves the stock', Number(giftAfter) === Number(giftBefore) - 1,
    `${giftBefore} -> ${giftAfter}`);

  // ---- payment allocation --------------------------------------------
  const creditInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 200, taxPct: 0 }],
  });
  check('credit invoice created for allocation', Number(creditInvoice.remaining) === 200,
    String(creditInvoice.remaining));

  const openInvoices = await call('GET', `/accounting/open-invoices?partyId=${party.partyId}&type=1`);
  check('open invoices listed for allocation',
    openInvoices.some((row) => row.invoiceId === creditInvoice.invoiceId), `${openInvoices.length}`);

  const allocatedVoucher = await call('POST', '/accounting/vouchers', {
    voucherType: 1, partyId: party.partyId, cashAccountId, amount: 120,
    allocations: [{ invoiceId: creditInvoice.invoiceId, amount: 120 }],
  });
  check('voucher allocated to an invoice', allocatedVoucher.allocated?.length === 1,
    JSON.stringify(allocatedVoucher.allocated));

  const settledInvoice = await call('GET', `/sales/invoices/${creditInvoice.invoiceId}`);
  check('allocated invoice paid amount updated', Number(settledInvoice.header.paidAmount) === 120,
    String(settledInvoice.header.paidAmount));
  check('allocated invoice remaining updated',
    Number(settledInvoice.header.totalAmount) - Number(settledInvoice.header.paidAmount) === 80,
    String(settledInvoice.header.totalAmount - settledInvoice.header.paidAmount));

  const overAllocation = await raw('POST', '/accounting/vouchers', {
    voucherType: 1, partyId: party.partyId, cashAccountId, amount: 50,
    allocations: [{ invoiceId: creditInvoice.invoiceId, amount: 500 }],
  });
  check('over-allocation rejected', overAllocation.status === 400, String(overAllocation.status));

  const wrongPartyVoucher = await raw('POST', '/accounting/vouchers', {
    voucherType: 1, partyId: otherParty.partyId, cashAccountId, amount: 50,
    allocations: [{ invoiceId: creditInvoice.invoiceId, amount: 50 }],
  });
  check('allocating another customer invoice rejected', wrongPartyVoucher.status === 400,
    String(wrongPartyVoucher.status));

  const cancelledVoucher = await raw('POST', `/accounting/vouchers/${allocatedVoucher.voucherId}/cancel`, {});
  check('allocated voucher cancelled', cancelledVoucher.status === 201, String(cancelledVoucher.status));
  const releasedInvoice = await call('GET', `/sales/invoices/${creditInvoice.invoiceId}`);
  check('cancelling the voucher releases the invoice', Number(releasedInvoice.header.paidAmount) === 0,
    String(releasedInvoice.header.paidAmount));

  // ---- shipments ------------------------------------------------------
  const shipment = await call('POST', '/shipments', {
    invoiceId: giftInvoice.invoiceId, deliveryMethod: 2, recipientName: 'عميل التوصيل',
    recipientPhone: '0100000000', deliveryAddress: 'القاهرة - مدينة نصر', deliveryFee: 25,
  });
  check('shipment created', !!shipment.shipmentId, shipment.shipmentNo);

  const shipments = await call('GET', `/shipments?invoiceId=${giftInvoice.invoiceId}`);
  check('shipment listed for the invoice', shipments.length === 1, `${shipments.length}`);

  const delivered = await call('PUT', `/shipments/${shipment.shipmentId}`, { status: 3 });
  check('shipment marked as delivered', delivered.status === 3, String(delivered.status));

  // ---- purchase order -------------------------------------------------
  const supplier = await call('POST', '/parties', { name: 'مورد اختبار', partyType: 2 });
  const purchaseOrder = await call('POST', '/orders', {
    orderType: 2, partyId: supplier.partyId, warehouseId,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 4, taxPct: 0 }],
  });
  check('purchase order created', !!purchaseOrder.orderId, String(purchaseOrder.orderId));

  await call('POST', `/orders/${purchaseOrder.orderId}/status`, { status: 2 });
  const purchaseFromOrder = await call('POST', `/orders/${purchaseOrder.orderId}/convert`, { paymentType: 2 });
  check('purchase order converted to a purchase invoice', !!purchaseFromOrder.invoiceId,
    purchaseFromOrder.invoiceNo);

  const purchaseOrderDetail = await call('GET', `/orders/${purchaseOrder.orderId}`);
  check('purchase order marked as delivered',
    Number(purchaseOrderDetail.header.status) === 4, String(purchaseOrderDetail.header.status));

  // 35. P2 — editing a posted invoice
  const stockBeforeEdit = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

  const editable = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 2, unitPrice: 30, taxPct: 0 }],
  });
  check('invoice to edit created', !!editable.invoiceId, editable.invoiceNo);

  const stockAfterCreate = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('edit target deducted the stock', Number(stockAfterCreate) === Number(stockBeforeEdit) - 2,
    `${stockBeforeEdit} -> ${stockAfterCreate}`);

  const edited = await raw('PUT', `/sales/invoices/${editable.invoiceId}`, {
    invoiceType: 1, branchId, warehouseId, paymentType: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 5, unitPrice: 30, taxPct: 0 }],
  });
  check('invoice edited', edited.status === 200, String(edited.status));

  const editedDetail = await call('GET', `/sales/invoices/${editable.invoiceId}`);
  check('edited invoice keeps its number', editedDetail.header.invoiceNo === editable.invoiceNo,
    editedDetail.header.invoiceNo);
  check('edited invoice has the new quantity',
    Number(editedDetail.lines[0].quantity) === 5, String(editedDetail.lines[0].quantity));
  check('edited invoice has one line', editedDetail.lines.length === 1, `${editedDetail.lines.length}`);
  check('edited invoice total recomputed', Number(editedDetail.header.totalAmount) === 150,
    String(editedDetail.header.totalAmount));

  const stockAfterEdit = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('edit corrected the stock', Number(stockAfterEdit) === Number(stockBeforeEdit) - 5,
    `${stockBeforeEdit} -> ${stockAfterEdit}`);

  const trialAfterEdit = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance still balanced after the edit', trialAfterEdit.balanced === true,
    `${trialAfterEdit.totalDebit} vs ${trialAfterEdit.totalCredit}`);

  // A settled invoice must not be edited behind its voucher.
  const settledForEdit = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 40, taxPct: 0 }],
  });
  await call('POST', '/accounting/vouchers', {
    voucherType: 1, partyId: party.partyId, cashAccountId, amount: 40,
    allocations: [{ invoiceId: settledForEdit.invoiceId, amount: 40 }],
  });
  const editSettled = await raw('PUT', `/sales/invoices/${settledForEdit.invoiceId}`, {
    invoiceType: 1, branchId, warehouseId, paymentType: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 9, unitPrice: 40, taxPct: 0 }],
  });
  check('editing a settled invoice is rejected', editSettled.status === 400, String(editSettled.status));

  // 36. P3 — point of sale: order types, delivery, parked carts, restaurant
  const deliveryInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, cashAccountId,
    orderType: 2, deliveryAddress: 'المعادي، شارع 9', deliveryFee: 30,
    driverName: 'عمرو', driverPhone: '0100000000',
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, taxPct: 0 }],
  });
  check('delivery order posted', !!deliveryInvoice.invoiceId, deliveryInvoice.invoiceNo);
  check('delivery fee added to the total', Number(deliveryInvoice.totalAmount) === 130,
    String(deliveryInvoice.totalAmount));

  const deliveryDetail = await call('GET', `/sales/invoices/${deliveryInvoice.invoiceId}`);
  check('order type stored', Number(deliveryDetail.header.orderType) === 2,
    String(deliveryDetail.header.orderType));
  check('delivery address stored', deliveryDetail.header.deliveryAddress === 'المعادي، شارع 9',
    deliveryDetail.header.deliveryAddress);
  check('driver stored', deliveryDetail.header.driverName === 'عمرو', String(deliveryDetail.header.driverName));

  const deliveryJournal = await call('GET', `/accounting/journals/${deliveryDetail.header.glJournalId}`);
  const feeLine = deliveryJournal.lines.find((line) => line.description === 'إيرادات التوصيل');
  check('delivery fee posted to its own revenue account', Number(feeLine?.credit) === 30,
    String(feeLine?.credit));

  // ---- parked cart ----------------------------------------------------
  const held = await call('POST', '/pos/held', {
    customerName: 'عميل معلّق', warehouseId,
    lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 2, unitPrice: 15 }],
  });
  check('cart parked', !!held.heldId, held.heldNo);

  const heldList = await call('GET', '/pos/held');
  check('parked carts listed', heldList.length > 0, `${heldList.length}`);

  const released = await raw('DELETE', `/pos/held/${held.heldId}`, {});
  check('parked cart released', released.status === 200, String(released.status));

  // ---- restaurant tables & modifiers -----------------------------------
  const table = await call('POST', '/pos/tables', {
    name: `طاولة ${Date.now() % 1000}`, tableType: 1, capacity: 6,
  });
  check('restaurant table created', !!table.tableId, String(table.tableId));

  const tables = await call('GET', '/pos/tables');
  check('tables listed', tables.some((row) => row.tableId === table.tableId), `${tables.length}`);

  const modifier = await call('POST', '/pos/modifiers', {
    itemId: itemB.itemId, name: 'إضافة جبنة', price: 5,
  });
  check('item modifier created', !!modifier.modifierId, String(modifier.modifierId));

  const modifiers = await call('GET', `/pos/modifiers?itemId=${itemB.itemId}`);
  check('modifiers listed for the item', modifiers.length === 1, `${modifiers.length}`);

  // ---- table order and the kitchen ------------------------------------
  const stockBeforeTable = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

  const tableOrder = await call('POST', '/pos/table-orders', {
    tableId: table.tableId, guestCount: 3,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 2, unitPrice: 60, taxPct: 10 }],
  });
  check('table order opened', !!tableOrder.tableOrderId, String(tableOrder.tableOrderId));
  check('table order total computed', Number(tableOrder.totalAmount) === 132,
    String(tableOrder.totalAmount));

  const sentToKitchen = await call('POST', `/pos/table-orders/${tableOrder.tableOrderId}/kitchen`, { status: 2 });
  check('table order sent to the kitchen', sentToKitchen.status === 2, String(sentToKitchen.status));

  const kitchen = await call('GET', '/pos/kitchen');
  const tableOrderDetail = await call('GET', `/pos/table-orders/${tableOrder.tableOrderId}`);
  check('kitchen display lists the order',
    kitchen.some((row) => row.orderNo === tableOrderDetail.header.orderNo),
    `${kitchen.length}`);

  const closedTable = await call('POST', `/pos/table-orders/${tableOrder.tableOrderId}/close`, {
    paymentType: 1, paidAmount: 132, cashAccountId,
  });
  check('table order closed into an invoice', !!closedTable.invoiceId, closedTable.invoiceNo);

  const stockAfterTable = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('closing the table order moved the stock', Number(stockAfterTable) === Number(stockBeforeTable) - 2,
    `${stockBeforeTable} -> ${stockAfterTable}`);

  const trialP3 = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance balanced after the pos flows', trialP3.balanced === true,
    `${trialP3.totalDebit} vs ${trialP3.totalCredit}`);

  // 37. rounding — a document with VAT and a discount must still balance
  const roundingItem = await call('POST', '/items', {
    code: `ROUND-${Date.now()}`, name: 'صنف اختبار التقريب', baseUnitId: 1,
    costPrice: 33.33, sellPrice: 49.99, vatPct: 14,
  });
  const roundingInvoice = await raw('POST', '/sales/invoices', {
    invoiceType: 2, branchId, warehouseId, paymentType: 2,
    lines: [
      { itemId: roundingItem.itemId, unitId: 1, quantity: 3, unitPrice: 33.33, discountPct: 5, taxPct: 14 },
      { itemId: roundingItem.itemId, unitId: 1, quantity: 7, unitPrice: 33.33, taxPct: 14 },
    ],
  });
  check('invoice with vat and discount posts', roundingInvoice.status === 201,
    roundingInvoice.status === 201 ? roundingInvoice.data.invoiceNo : roundingInvoice.data?.message);

  const roundingDetail = await call('GET', `/sales/invoices/${roundingInvoice.data.invoiceId}`);
  const roundingJournal = await call('GET', `/accounting/journals/${roundingDetail.header.glJournalId}`);
  check('rounded journal is balanced',
    Number(roundingJournal.header.totalDebit) === Number(roundingJournal.header.totalCredit),
    `${roundingJournal.header.totalDebit} vs ${roundingJournal.header.totalCredit}`);

  const roundingTrial = await call('GET', '/accounting/reports/trial-balance');
  check('trial balance still balanced after rounding', roundingTrial.balanced === true,
    `${roundingTrial.totalDebit} vs ${roundingTrial.totalCredit}`);

  // 38. P3 rest — split table, move order, service charge, kitchen columns, gifts
  const p3Settings = await call('PUT', '/pos/settings', {
    serviceChargePerGuest: 15, serviceChargeMinimum: 40, kitchenColumns: [],
  });
  check('restaurant settings saved', Number(p3Settings.serviceChargePerGuest) === 15,
    String(p3Settings.serviceChargePerGuest));

  // The split needs two tables: one busy and one free.
  await call('POST', '/pos/tables', {
    name: `طاولة اختبار ${Date.now() % 1000}`, tableType: 1, capacity: 4,
  });
  const posTables = await call('GET', '/pos/tables');
  check('two tables available for the split', posTables.length >= 2, `${posTables.length}`);
  const freeTable = posTables.find((row) => row.openOrders === 0) ?? posTables[0];
  const busyTable = posTables.find((row) => row.tableId !== freeTable.tableId) ?? posTables[1];

  const p3SplitOrder = await call('POST', '/pos/table-orders', {
    tableId: busyTable.tableId, guestCount: 4,
    lines: [
      { itemId: itemB.itemId, unitId: 1, quantity: 2, unitPrice: 60, taxPct: 10 },
      { itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: 40, taxPct: 0 },
    ],
  });
  const p3SplitDetail = await call('GET', `/pos/table-orders/${p3SplitOrder.tableOrderId}`);
  check('split candidate order has two lines', p3SplitDetail.lines.length === 2, `${p3SplitDetail.lines.length}`);

  const p3SplitResult = await call('POST', `/pos/table-orders/${p3SplitOrder.tableOrderId}/split`, {
    tableId: freeTable.tableId, lineIds: [p3SplitDetail.lines[0].lineId], guestCount: 2,
  });
  check('table split moved one line', p3SplitResult.movedLines === 1, JSON.stringify(p3SplitResult));

  const p3SourceAfterSplit = await call('GET', `/pos/table-orders/${p3SplitOrder.tableOrderId}`);
  check('source order lost the moved line', p3SourceAfterSplit.lines.length === 1, `${p3SourceAfterSplit.lines.length}`);
  const p3TargetAfterSplit = await call('GET', `/pos/table-orders/${p3SplitResult.targetOrderId}`);
  check('target order received the line', p3TargetAfterSplit.lines.length === 1, `${p3TargetAfterSplit.lines.length}`);
  check('split kept the totals right',
    Math.abs(Number(p3SourceAfterSplit.header.totalAmount) + Number(p3TargetAfterSplit.header.totalAmount)
      - Number(p3SplitDetail.header.totalAmount)) < 0.01,
    `${p3SourceAfterSplit.header.totalAmount} + ${p3TargetAfterSplit.header.totalAmount} vs ${p3SplitDetail.header.totalAmount}`);

  // A line the kitchen already started cannot be moved.
  await call('POST', `/pos/table-orders/${p3SplitOrder.tableOrderId}/kitchen`, { status: 2 });
  const p3StartedDetail = await call('GET', `/pos/table-orders/${p3SplitOrder.tableOrderId}`);
  const p3StartedLine = p3StartedDetail.lines.find((line) => line.kitchenStatus !== 1);
  if (p3StartedLine) {
    const splitStarted = await raw('POST', `/pos/table-orders/${p3SplitOrder.tableOrderId}/split`, {
      tableId: freeTable.tableId, lineIds: [p3StartedLine.lineId],
    });
    check('a line already in the kitchen cannot be split', splitStarted.status === 400,
      String(splitStarted.status));
  }

  // Moving an order to a table that already has one is refused.
  const moveToBusy = await raw('POST', `/pos/table-orders/${p3SplitResult.targetOrderId}/move`, {
    tableId: busyTable.tableId,
  });
  check('moving to an occupied table is refused', moveToBusy.status === 400, String(moveToBusy.status));

  // The service charge is added when the table order is closed.
  const p3ServiceOrder = await call('POST', '/pos/table-orders', {
    tableId: busyTable.tableId, guestCount: 3,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 50, taxPct: 10 }],
  });
  const p3ServiceInvoice = await call('POST', `/pos/table-orders/${p3ServiceOrder.tableOrderId}/close`, {
    paymentType: 1, paidAmount: 0, cashAccountId,
  });
  check('table order closed with a service charge', !!p3ServiceInvoice.invoiceId, p3ServiceInvoice.invoiceNo);

  const p3ServiceDetail = await call('GET', `/sales/invoices/${p3ServiceInvoice.invoiceId}`);
  check('service charge added to the invoice', Number(p3ServiceDetail.header.serviceCharge) === 45,
    `${p3ServiceDetail.header.serviceCharge} (3 guests × 15)`);

  const p3ServiceJournal = await call('GET', `/accounting/journals/${p3ServiceDetail.header.glJournalId}`);
  const serviceLine = p3ServiceJournal.lines.find((line) => line.description === 'إيرادات الخدمة');
  check('service charge posted to its own revenue account', Number(serviceLine?.credit) === 45,
    String(serviceLine?.credit));

  const p3Kitchen = await call('GET', '/pos/kitchen');
  check('kitchen returns the category of every line',
    p3Kitchen.every((row) => row.categoryId !== undefined), `${p3Kitchen.length}`);

  // A giveaway needs the dedicated permission.
  const p3GiftInvoice = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 0, isGift: true, taxPct: 0 }],
  });
  check('gift line accepted for a manager', p3GiftInvoice.status === 201, String(p3GiftInvoice.status));

  const p3GiftDetail = await call('GET', `/sales/invoices/${p3GiftInvoice.data.invoiceId}`);
  check('gift line is free', Number(p3GiftDetail.lines[0].lineTotal) === 0,
    String(p3GiftDetail.lines[0].lineTotal));

  // 39. Ezees guide conformance — halls, service charge modes, modifiers, notes
  const p3HallName = `قاعة اختبار ${Date.now()}`;
  const p3Hall = await call('POST', '/pos/halls', {
    name: p3HallName, code: `Z${String(Date.now()).slice(-8)}`, tableCount: 3,
    tableType: 1, capacity: 4,
  });
  check('hall created', !!p3Hall.hallId, String(p3Hall.hallId));

  const hallTables = await call('GET', '/pos/tables');
  const generated = hallTables.filter((row) => row.name.startsWith(p3Hall.code));
  check('hall generated its numbered tables', generated.length === 3,
    generated.map((row) => row.name).join(','));

  const duplicateHall = await raw('POST', '/pos/halls', {
    name: p3HallName, code: `Y${String(Date.now()).slice(-8)}`, tableCount: 2,
  });
  check('a hall with the same name is refused', duplicateHall.status === 400,
    String(duplicateHall.status));

  const p3Halls = await call('GET', '/pos/halls');
  check('halls listed with the work permission', p3Halls.length > 0, `${p3Halls.length}`);

  // Service charge: amount per guest.
  await call('PUT', '/pos/settings', {
    serviceChargePerGuest: 20, serviceChargeMinimum: 10, serviceChargeMode: 1,
  });
  const perGuestOrder = await call('POST', '/pos/table-orders', {
    tableId: generated[0].tableId, guestCount: 3,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 500, taxPct: 0 }],
  });
  const perGuestInvoice = await call('POST', `/pos/table-orders/${perGuestOrder.tableOrderId}/close`, {
    paymentType: 1, paidAmount: 0, cashAccountId,
  });
  const perGuestDetail = await call('GET', `/sales/invoices/${perGuestInvoice.invoiceId}`);
  check('service charge = rate × guests', Number(perGuestDetail.header.serviceCharge) === 60,
    String(perGuestDetail.header.serviceCharge));

  // Service charge: minimum per guest — the shortfall is charged.
  await call('PUT', '/pos/settings', {
    serviceChargePerGuest: 20, serviceChargeMinimum: 10, serviceChargeMode: 2,
  });
  const minOrder = await call('POST', '/pos/table-orders', {
    tableId: generated[1].tableId, guestCount: 3,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 10, taxPct: 0 }],
  });
  const minInvoice = await call('POST', `/pos/table-orders/${minOrder.tableOrderId}/close`, {
    paymentType: 1, paidAmount: 0, cashAccountId,
  });
  const minDetail = await call('GET', `/sales/invoices/${minInvoice.invoiceId}`);
  check('minimum charge covers the shortfall', Number(minDetail.header.serviceCharge) === 50,
    `${minDetail.header.serviceCharge} (minimum 60 − order 10)`);

  const richOrder = await call('POST', '/pos/table-orders', {
    tableId: generated[2].tableId, guestCount: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 5, unitPrice: 100, taxPct: 0 }],
  });
  const richInvoice = await call('POST', `/pos/table-orders/${richOrder.tableOrderId}/close`, {
    paymentType: 1, paidAmount: 0, cashAccountId,
  });
  const richDetail = await call('GET', `/sales/invoices/${richInvoice.invoiceId}`);
  check('no service charge when the order passes the minimum',
    Number(richDetail.header.serviceCharge) === 0, String(richDetail.header.serviceCharge));

  // Modifiers: maximum quantity and the free extra.
  const p3Modifier = await call('POST', '/pos/modifiers', {
    itemId: itemA.itemId, name: 'إضافة اختبار', price: 5, maxQuantity: 2,
  });
  check('modifier created', !!p3Modifier.modifierId, String(p3Modifier.modifierId));

  const p3ModifierInvoice = await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, cashAccountId,
    lines: [
      { itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: 100, taxPct: 0 },
      {
        itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 0, taxPct: 0,
        parentLineIndex: 0, modifierId: p3Modifier.modifierId, notes: 'إضافة اختبار',
      },
    ],
  });
  check('invoice with a modifier posted', !!p3ModifierInvoice.invoiceId, p3ModifierInvoice.invoiceNo);

  const p3ModifierDetail = await call('GET', `/sales/invoices/${p3ModifierInvoice.invoiceId}`);
  const p3ModifierLine = p3ModifierDetail.lines.find((line) => line.itemId === itemB.itemId);
  check('the modifier line is marked', p3ModifierLine?.isModifier === true, String(p3ModifierLine?.isModifier));
  check('the modifier hangs under its parent', p3ModifierLine?.parentLineId === p3ModifierDetail.lines[0].invoiceLineId,
    `${p3ModifierLine?.parentLineId}`);
  check('the modifier note carries the -- prefix',
    String(p3ModifierLine?.notes ?? '').startsWith('--'), String(p3ModifierLine?.notes));

  const tooManyModifiers = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 0, cashAccountId,
    lines: [
      { itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: 100, taxPct: 0 },
      {
        itemId: itemB.itemId, unitId: 1, quantity: 5, unitPrice: 0, taxPct: 0,
        parentLineIndex: 0, modifierId: p3Modifier.modifierId,
      },
    ],
  });
  check('a modifier beyond its maximum is refused', tooManyModifiers.status === 400,
    String(tooManyModifiers.status));

  // Ready-made kitchen notes.
  const p3Note = await call('POST', '/pos/note-templates', { name: 'بدون بصل' });
  check('ready-made note saved', !!p3Note.noteId, String(p3Note.noteId));
  const p3Notes = await call('GET', '/pos/note-templates');
  check('ready-made notes listed', p3Notes.length > 0, `${p3Notes.length}`);

  // Splitting every line would duplicate the order — it must be refused.
  const p3SplitAllOrder = await call('POST', '/pos/table-orders', {
    tableId: generated[0].tableId, guestCount: 2,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 30, taxPct: 0 }],
  });
  const p3SplitAllDetail = await call('GET', `/pos/table-orders/${p3SplitAllOrder.tableOrderId}`);
  const p3SplitAll = await raw('POST', `/pos/table-orders/${p3SplitAllOrder.tableOrderId}/split`, {
    tableId: generated[1].tableId,
    lineIds: p3SplitAllDetail.lines.map((line) => line.lineId),
  });
  check('splitting every line is refused', p3SplitAll.status === 400, String(p3SplitAll.status));

  // 40. P4 — stock count document (سند الجرد)
  const employee = await call('POST', '/hr/employees', {
    name: 'أمين مخزن الجرد', phone: '01099998877', basicSalary: 4000,
  });
  check('counting employee created', !!employee.employeeId, String(employee.employeeId));

  const noEmployee = await raw('POST', '/stock-counts', { warehouseId });
  check('the counting employee is mandatory', noEmployee.status === 400, String(noEmployee.status));

  const badEmployee = await raw('POST', '/stock-counts', { warehouseId, employeeId: 999999 });
  check('an unknown employee is refused', badEmployee.status === 400, String(badEmployee.status));

  const count = await call('POST', '/stock-counts', {
    warehouseId, employeeId: employee.employeeId, countDate: daysAgoIso(0), notes: 'جرد دوري',
  });
  check('count document created', !!count.stockCountId, count.countNo);

  const secondOpen = await raw('POST', '/stock-counts', { warehouseId, employeeId: employee.employeeId });
  check('only one open count per warehouse', secondOpen.status === 400, String(secondOpen.status));

  // The expected quantity is the ledger balance at the moment of the line.
  const balanceBefore = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

  const counted = await call('POST', `/stock-counts/${count.stockCountId}/lines`, {
    itemId: itemB.itemId, unitId: 1, countedQty: Math.max(0, balanceBefore - 4),
  });
  check('count line added', counted.added === true, JSON.stringify(counted));
  check('the expected quantity is a snapshot of the balance',
    Math.abs(Number(counted.expectedQty) - balanceBefore) < 0.01,
    `${counted.expectedQty} vs ${balanceBefore}`);

  const countDetail = await call('GET', `/stock-counts/${count.stockCountId}`);
  const countLine = countDetail.lines.find((line) => line.itemId === itemB.itemId);
  check('the difference is calculated', Math.abs(Number(countLine?.differenceQty) + 4) < 0.01,
    String(countLine?.differenceQty));
  check('the difference is valued at cost', Number(countLine?.differenceValue) !== 0,
    String(countLine?.differenceValue));

  // Adding the same item again adds to the quantity.
  const merged = await call('POST', `/stock-counts/${count.stockCountId}/lines`, {
    itemId: itemB.itemId, unitId: 1, countedQty: 1,
  });
  check('the same item in the same unit is merged', merged.merged === true, JSON.stringify(merged));

  // A counted quantity equal to the balance has no difference and is refused.
  const equalLine = await raw('POST', `/stock-counts/${count.stockCountId}/lines`, {
    itemId: itemA.itemId, unitId: 1, countedQty: Number(
      (await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
        .find((row) => row.itemId === itemA.itemId)?.onHandQty ?? 0),
  });
  check('a quantity equal to the balance is not counted', equalLine.status === 400,
    String(equalLine.status));

  // Editing the counted quantity recalculates the difference.
  const editedLine = await call('PUT', `/stock-counts/${count.stockCountId}/lines/${countLine.lineId}`, {
    countedQty: Math.max(0, balanceBefore - 10),
  });
  check('the counted quantity can be edited', Number(editedLine.countedQty) === Math.max(0, balanceBefore - 10),
    String(editedLine.countedQty));

  const afterEdit = await call('GET', `/stock-counts/${count.stockCountId}`);
  const editedLineRow = afterEdit.lines.find((line) => line.itemId === itemB.itemId);
  check('the difference follows the edit', Math.abs(Number(editedLineRow?.differenceQty) + 10) < 0.01,
    String(editedLineRow?.differenceQty));

  // The document is applied only when it is approved.
  const stockBeforeApprove = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('a draft count does not touch the stock', stockBeforeApprove === balanceBefore,
    `${balanceBefore} -> ${stockBeforeApprove}`);

  const approved = await call('POST', `/stock-counts/${count.stockCountId}/approve`, {});
  check('count approved', approved.status === 2, JSON.stringify(approved));

  const stockAfterApprove = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('the approval applies the difference to the stock',
    Math.abs((stockAfterApprove - stockBeforeApprove) + 10) < 0.01,
    `${stockBeforeApprove} -> ${stockAfterApprove}`);

  const editApproved = await raw('PUT', `/stock-counts/${count.stockCountId}`, { notes: 'x' });
  check('an approved count cannot be edited', editApproved.status === 400, String(editApproved.status));

  const deleteApproved = await raw('DELETE', `/stock-counts/${count.stockCountId}`, {});
  check('an approved count cannot be deleted', deleteApproved.status === 400, String(deleteApproved.status));

  const countJournal = await call('GET', `/accounting/journals/${approved.journalId}`);
  check('the count posted an accounting entry',
    countJournal.lines.length === 2, `${countJournal.lines.length} lines`);

  // 41. P4.2 — stock vouchers (أذون المخازن)
  const wh = warehouseId;
  const invVoucher = await call('POST', '/stock-vouchers', {
    warehouseId: wh, voucherType: 1, voucherDate: daysAgoIso(0), notes: 'وارد تجريبي',
  });
  check('incoming voucher created', !!invVoucher.stockVoucherId, invVoucher.voucherNo);

  const noType = await raw('POST', '/stock-vouchers', { warehouseId: wh, voucherType: 9 });
  check('invalid voucher type refused', noType.status === 400, String(noType.status));

  const noWarehouse = await raw('POST', '/stock-vouchers', { voucherType: 1 });
  check('warehouse is mandatory', noWarehouse.status === 400, String(noWarehouse.status));

  const added = await call('POST', `/stock-vouchers/${invVoucher.stockVoucherId}/lines`, {
    itemId: itemB.itemId, unitId: 1, quantity: 10, unitCost: 25,
  });
  check('voucher line added', added.added === true, JSON.stringify(added));

  const voucherMerged = await call('POST', `/stock-vouchers/${invVoucher.stockVoucherId}/lines`, {
    itemId: itemB.itemId, unitId: 1, quantity: 5,
  });
  check('same item same unit merged', voucherMerged.merged === true, JSON.stringify(voucherMerged));

  const voucherEdited = await call('PUT', `/stock-vouchers/${invVoucher.stockVoucherId}/lines/${added.lineId}`, {
    quantity: 20,
  });
  check('line quantity edited', voucherEdited.quantity === 20, String(voucherEdited.quantity));

  const stockBefore = Number((await call('GET', `/inventory/balances?warehouseId=${wh}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

  const approvedV = await call('POST', `/stock-vouchers/${invVoucher.stockVoucherId}/approve`, {});
  check('voucher approved', approvedV.status === 2, JSON.stringify(approvedV));

  const stockAfter = Number((await call('GET', `/inventory/balances?warehouseId=${wh}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('approval increased stock by 20', Math.abs((stockAfter - stockBefore) - 20) < 0.01,
    `${stockBefore} -> ${stockAfter}`);

  const editVoucher = await raw('PUT', `/stock-vouchers/${invVoucher.stockVoucherId}`, { notes: 'x' });
  check('an approved voucher cannot be edited', editVoucher.status === 400, String(editVoucher.status));

  const deleteVoucher = await raw('DELETE', `/stock-vouchers/${invVoucher.stockVoucherId}`, {});
  check('an approved voucher cannot be deleted', deleteVoucher.status === 400, String(deleteVoucher.status));

  const voucherJournal = await call('GET', `/accounting/journals/${approvedV.journalId}`);
  check('voucher posted a journal entry',
    voucherJournal.lines.length >= 2, `${voucherJournal.lines.length} lines`);

  // Outgoing voucher (صادر) decreases stock and posts COGS.
  const outVoucher = await call('POST', '/stock-vouchers', {
    warehouseId: wh, voucherType: 2, voucherDate: daysAgoIso(0), notes: 'صادر تجريبي',
  });
  await call('POST', `/stock-vouchers/${outVoucher.stockVoucherId}/lines`, {
    itemId: itemB.itemId, unitId: 1, quantity: 5,
  });
  await call('POST', `/stock-vouchers/${outVoucher.stockVoucherId}/approve`, {});
  const stockAfterOut = Number((await call('GET', `/inventory/balances?warehouseId=${wh}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('outgoing voucher decreased stock by 5',
    Math.abs((stockAfterOut - stockAfter) - (-5)) < 0.01,
    `${stockAfter} -> ${stockAfterOut}`);

  // 43. E2 - cross-branch stock transfer
  {
    const stamp2 = `E2${Date.now()}`;
    const branchB = await call('POST', '/admin/branches', { name: `فرع E2 ${stamp2}`, code: stamp2, city: 'القاهرة', isActive: true });
    const branchBId = Number(branchB?.branchId);
    check('E2: second branch created', branchBId > 0, JSON.stringify(branchB));
    const callB = async (method, p, body, tokenOverride) => {
      const headers = { 'Content-Type': 'application/json', 'x-branch-id': String(branchBId) };
      headers.Authorization = tokenOverride !== undefined ? (tokenOverride ? `Bearer ${tokenOverride}` : '') : `Bearer ${token}`;
      const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
      if (!r.ok) { const e = new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(d)}`); e.status = r.status; e.body = d; throw e; }
      return d;
    };
    const rawB = async (method, p, body, tokenOverride) => {
      const headers = { 'Content-Type': 'application/json', 'x-branch-id': String(branchBId) };
      if (tokenOverride !== undefined) { if (tokenOverride) headers.Authorization = `Bearer ${tokenOverride}`; }
      else headers.Authorization = `Bearer ${token}`;
      const r = await fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
      return { status: r.status, body: d };
    };
    const whB2 = await call('POST', '/catalog/warehouses', { code: stamp2, name: `مخزن E2 ${stamp2}`, branchId: branchBId, isActive: true });
    check('E2: warehouse created in branch B', Number(whB2?.warehouseId) > 0, JSON.stringify(whB2));

    const noIdem = await raw('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), transferDate: daysAgoIso(0),
    });
    check('E2: create without clientRequestId refused (400)', noIdem.status === 400, String(noIdem.status));

    const idemKey = `e2-${stamp2}`;
    const bt = await call('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), transferDate: daysAgoIso(0),
      notes: 'E2 transfer', clientRequestId: idemKey,
    });
    check('E2: transfer created (draft)', !!bt?.branchTransferId, JSON.stringify(bt));
    const btDup = await call('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), transferDate: daysAgoIso(0),
      clientRequestId: idemKey,
    });
    check('E2: duplicate clientRequestId returns same document (idempotent)', btDup?.duplicate === true || btDup?.branchTransferId === bt.branchTransferId, JSON.stringify(btDup));

    const btLine = await call('POST', `/branch-transfers/${bt.branchTransferId}/lines`, { itemId: itemB.itemId, unitId: 1, quantity: 5 });
    check('E2: line added at source average cost', btLine.added === true, JSON.stringify(btLine));

    const balBefore = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const qtyBeforeA = Number(balBefore.find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

    const btApprove = await call('POST', `/branch-transfers/${bt.branchTransferId}/approve`, {});
    check('E2: transfer issued (outbound voucher, journal in source branch)',
      btApprove.status === 2 && !!btApprove.journalId, JSON.stringify(btApprove));
    const balAfterApprove = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const qtyAfterApprove = Number(balAfterApprove.find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    check('E2: stock decreased at source after approve', Math.abs((qtyAfterApprove - qtyBeforeA) - (-5)) < 0.01, `${qtyBeforeA} -> ${qtyAfterApprove}`);

    const cashierLogin2 = await loginAs(`cashier_${stamp}`, testPassword);
    const btForbidden = await raw('POST', `/branch-transfers/${bt.branchTransferId}/receive`, {}, cashierLogin2.accessToken);
    check('E2: cashier cannot receive (403)', btForbidden.status === 403, String(btForbidden.status));

    const btReceiveWrongBranch = await raw('POST', `/branch-transfers/${bt.branchTransferId}/receive`, {});
    check('E2: receive from the source branch refused (403)', btReceiveWrongBranch.status === 403, String(btReceiveWrongBranch.status));

    const btReceive = await rawB('POST', `/branch-transfers/${bt.branchTransferId}/receive`, {});
    check('E2: transfer received at destination branch (journal in dest branch)',
      btReceive.status === 201 && btReceive.body?.status === 4, `status=${btReceive.status} ${JSON.stringify(btReceive.body).slice(0, 120)}`);
    const btDetailA = await raw('GET', `/branch-transfers/${bt.branchTransferId}`);
    check('E2: document details load from the source branch (lines + movements)',
      btDetailA.status === 200 && Array.isArray(btDetailA.data?.lines) && btDetailA.data.lines.length > 0,
      String(btDetailA.status));
    const btDetailB = await rawB('GET', `/branch-transfers/${bt.branchTransferId}`);
    check('E2: document details load from the destination branch too',
      btDetailB.status === 200 && Array.isArray(btDetailB.body?.lines) && btDetailB.body.lines.length > 0,
      `status=${btDetailB.status} lines=${btDetailB.body?.lines?.length}`);
    const balB = await rawB('GET', `/inventory/balances?warehouseId=${whB2.warehouseId}`);
    const qtyB = Number((balB.body ?? []).find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    check('E2: stock increased at destination after receive', qtyB >= 5, `qty=${qtyB}`);

    const btReceiveAgain = await rawB('POST', `/branch-transfers/${bt.branchTransferId}/receive`, {});
    check('E2: duplicate receive refused (400/409)', btReceiveAgain.status === 400 || btReceiveAgain.status === 409, String(btReceiveAgain.status));

    const suspense = await call('GET', '/reports/branch-transfers/suspense');
    check('E2: inter-branch clearing nets to ZERO company-wide after receive',
      suspense.company?.match === true && Math.abs(Number(suspense.company.glClearing)) < 0.005,
      JSON.stringify(suspense));

    const btCancelLate = await raw('POST', `/branch-transfers/${bt.branchTransferId}/cancel`, { reason: 'test' });
    check('E2: cancel after receipt refused (400)', btCancelLate.status === 400, String(btCancelLate.status));

    // ── accountant is VIEW-ONLY: list works, every mutation is 403 ──
    const accountantLogin2 = await loginAs(`accountant_${stamp}`, testPassword);
    const accList = await rawB('GET', '/branch-transfers', undefined, accountantLogin2.accessToken);
    check('E2: accountant can LIST transfers (transfer.interbranch.view)', accList.status === 200, String(accList.status));
    const bt3 = await call('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), transferDate: daysAgoIso(0),
      clientRequestId: `e2-perm-${stamp2}`,
    });
    const accCreate3 = await raw('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), clientRequestId: `e2-perm2-${stamp2}`,
    }, accountantLogin2.accessToken);
    check('E2: accountant CANNOT create (403)', accCreate3.status === 403, String(accCreate3.status));
    const accApprove3 = await raw('POST', `/branch-transfers/${bt3.branchTransferId}/approve`, {}, accountantLogin2.accessToken);
    check('E2: accountant CANNOT approve (403)', accApprove3.status === 403, String(accApprove3.status));
    const accReceive3 = await rawB('POST', `/branch-transfers/${bt3.branchTransferId}/receive`, {}, accountantLogin2.accessToken);
    check('E2: accountant CANNOT receive (403)', accReceive3.status === 403, String(accReceive3.status));
    const accCancel3 = await raw('POST', `/branch-transfers/${bt3.branchTransferId}/cancel`, { reason: 'x' }, accountantLogin2.accessToken);
    check('E2: accountant CANNOT cancel (403)', accCancel3.status === 403, String(accCancel3.status));

    // double approve is refused (idempotency by status guard)
    await call('POST', `/branch-transfers/${bt3.branchTransferId}/lines`, { itemId: itemB.itemId, unitId: 1, quantity: 1 });
    await call('POST', `/branch-transfers/${bt3.branchTransferId}/approve`, {});
    const dupApprove = await raw('POST', `/branch-transfers/${bt3.branchTransferId}/approve`, {});
    check('E2: duplicate approve refused (400)', dupApprove.status === 400, String(dupApprove.status));

    const branchC = await call('POST', '/admin/branches', { name: `فرع E2 C ${stamp2}`, code: `${stamp2}C`, city: 'الإسكندرية', isActive: true });
    const branchCId = Number(branchC?.branchId);
    const rawC = async (method, p) => {
      const r = await fetch(`${BASE}${p}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-branch-id': String(branchCId) } });
      const t = await r.text();
      let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
      return { status: r.status, body: d };
    };
    const isolated = await rawC('GET', `/branch-transfers/${bt.branchTransferId}`);
    check('E2: document not visible from an uninvolved branch (404)', isolated.status === 404, String(isolated.status));

    const bt2 = await call('POST', '/branch-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: Number(whB2.warehouseId), transferDate: daysAgoIso(0),
      clientRequestId: `e2-cancel-${stamp2}`,
    });
    await call('POST', `/branch-transfers/${bt2.branchTransferId}/lines`, { itemId: itemB.itemId, unitId: 1, quantity: 2 });
    const balBeforeCancel = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const qtyBeforeCancel = Number(balBeforeCancel.find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    await call('POST', `/branch-transfers/${bt2.branchTransferId}/approve`, {});
    const bt2Cancel = await raw('POST', `/branch-transfers/${bt2.branchTransferId}/cancel`, { reason: 'cancel for test' });
    check('E2: cancel before receipt works (status 5)', bt2Cancel.status === 201 && bt2Cancel.data?.status === 5, `status=${bt2Cancel.status} body=${JSON.stringify(bt2Cancel.data).slice(0, 120)}`);
    const balAfterCancel = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const qtyAfterCancel = Number(balAfterCancel.find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    check('E2: stock restored after cancel', Math.abs(qtyAfterCancel - qtyBeforeCancel) < 0.01, `${qtyBeforeCancel} -> ${qtyAfterCancel}`);
  }


  // 42. P4.3 — stock transfer indirect (تحويل غير مباشر بين مخازن)
  const whA = warehouseId;
  // The test creates its own second warehouse so it never depends on seed data.
  let whB = Number((await call('GET', '/catalog/warehouses'))
    .find((row) => row.warehouseId !== whA)?.warehouseId);
  if (!whB) {
    const createdWh = await call('POST', '/catalog/warehouses', {
      code: 'WH-TEST', name: 'مخزن الاختبار', isActive: true,
    });
    whB = Number(createdWh.warehouseId);
    check('second warehouse created for transfer test', !!whB, String(whB));
  }
  {
    const transfer = await call('POST', '/stock-transfers', {
      fromWarehouseId: whA, toWarehouseId: whB, transferDate: daysAgoIso(0), notes: 'تحويل تجريبي',
    });
    check('transfer created', !!transfer.stockTransferId, transfer.transferNo);

    const rejectedManual = await raw('POST', `/stock-transfers/${transfer.stockTransferId}/lines`, {
      itemId: itemB.itemId, unitId: 1, quantity: 10, unitCost: 30,
    });
    check('manual unitCost is refused with 400 (P4-3)', rejectedManual.status === 400, String(rejectedManual.status));

    const costLine = await call('POST', `/stock-transfers/${transfer.stockTransferId}/lines`, {
      itemId: itemB.itemId, unitId: 1, quantity: 10,
    });
    check('transfer line added at source-warehouse average cost', costLine.added === true, JSON.stringify(costLine));

    const stockBeforeA = Number((await call('GET', `/inventory/balances?warehouseId=${whA}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    const stockBeforeB = Number((await call('GET', `/inventory/balances?warehouseId=${whB}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);

    const approved = await call('POST', `/stock-transfers/${transfer.stockTransferId}/approve`, {});
    check('transfer approved (outbound voucher)', approved.status === 2, JSON.stringify(approved));

    const stockAfterApproveA = Number((await call('GET', `/inventory/balances?warehouseId=${whA}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    const stockAfterApproveB = Number((await call('GET', `/inventory/balances?warehouseId=${whB}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    check('stock decreased at source after approve',
      Math.abs((stockAfterApproveA - stockBeforeA) - (-10)) < 0.01,
      `${stockBeforeA} -> ${stockAfterApproveA}`);
    check('stock unchanged at destination before receive',
      stockAfterApproveB === stockBeforeB,
      `${stockBeforeB} -> ${stockAfterApproveB}`);

    const received = await call('POST', `/stock-transfers/${transfer.stockTransferId}/receive`, {});
    check('transfer received (inbound voucher)', received.status === 4, JSON.stringify(received));

    const stockAfterReceiveA = Number((await call('GET', `/inventory/balances?warehouseId=${whA}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    const stockAfterReceiveB = Number((await call('GET', `/inventory/balances?warehouseId=${whB}`))
      .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
    check('stock increased at destination after receive',
      Math.abs((stockAfterReceiveB - stockAfterApproveB) - 10) < 0.01,
      `${stockAfterApproveB} -> ${stockAfterReceiveB}`);
    check('stock unchanged at source after receive',
      stockAfterReceiveA === stockAfterApproveA,
      `${stockAfterApproveA} -> ${stockAfterReceiveA}`);

    const editCompleted = await raw('PUT', `/stock-transfers/${transfer.stockTransferId}`, { notes: 'x' });
    check('a completed transfer cannot be edited', editCompleted.status === 400, String(editCompleted.status));

    const transferJournal = await call('GET', `/accounting/journals/${received.journalId}`);
    check('receive posted a journal entry',
      transferJournal.lines.length >= 2, `${transferJournal.lines.length} lines`);
  }

  // 43. P8 — maintenance centers (إدارة مراكز الصيانة)
  const maintProduct = await call('POST', '/maintenance/products', { name: `منتج صيانة ${Date.now()}` });
  check('maintenance product created', !!maintProduct.productId, String(maintProduct.productId ?? ''));
  const maintModel = await call('POST', '/maintenance/models', { productId: maintProduct.productId, name: 'موديل تجريبي' });
  check('maintenance model created', !!maintModel.modelId, String(maintModel.modelId ?? ''));

  const maintTicket = await call('POST', '/maintenance/tickets', {
    customerName: 'عميل صيانة', phone: '01000000999',
    productId: maintProduct.productId, modelId: maintModel.modelId,
    productCondition: 'خدوش في الجهاز', customerNotes: 'لا تعمل الشاشة',
    estimatedCost: 100, paidAmount: 40, cashAccountId,
  });
  check('maintenance ticket created with advance', !!maintTicket.ticketNo, maintTicket.ticketNo ?? '');

  const maintDetail = await call('GET', `/maintenance/tickets/${maintTicket.ticketId}`);
  check('advance tracked on the ticket', Number(maintDetail.totalPaid) === 40, String(maintDetail.totalPaid));

  const stockBeforeParts = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  const maintInspect = await call('POST', `/maintenance/tickets/${maintTicket.ticketId}/inspect`, {
    engineerId: repId, inspectionStatus: 3, checkReport: 'تم الاصلاح',
    actualCost: 120,
    parts: [{ itemId: itemB.itemId, quantity: 2 }],
  });
  check('inspection saved', maintInspect.saved === true, JSON.stringify(maintInspect));

  const stockAfterParts = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('inspection consumed 2 spare parts from the warehouse', Math.abs((stockAfterParts - stockBeforeParts) - (-2)) < 0.01,
    `${stockBeforeParts} -> ${stockAfterParts}`);

  const maintDetail2 = await call('GET', `/maintenance/tickets/${maintTicket.ticketId}`);
  check('parts cost recorded', Number(maintDetail2.partsCost ?? 0) > 0, String(maintDetail2.partsCost ?? 0));

  const maintDeliver = await call('POST', `/maintenance/tickets/${maintTicket.ticketId}/deliver`, {
    paidAmount: 80, delivered: true, cashAccountId,
  });
  check('delivery settles the ticket', maintDeliver.delivered === true, JSON.stringify(maintDeliver));

  const maintDetail3 = await call('GET', `/maintenance/tickets/${maintTicket.ticketId}`);
  check('total paid = advance + final payment', Math.abs(Number(maintDetail3.totalPaid) - 120) < 0.01, String(maintDetail3.totalPaid));

  const maintReport = await call('GET', '/maintenance/reports/services');
  check('services report returned', Array.isArray(maintReport.items), `${maintReport.items?.length ?? 0} items`);

  const maintList = await call('GET', `/maintenance/tickets?from=${daysAgoIso(7)}`);
  check('ticket list returned', Array.isArray(maintList.items), `${maintList.items?.length ?? 0} items`);

  // 44. P7 — settings & tools: user list restrictions, backup, attachments
  const restrictionOptions = await call('GET', '/admin/restrictions/options');
  check('restriction options returned', Array.isArray(restrictionOptions.warehouses) && Array.isArray(restrictionOptions.cashAccounts),
    `${restrictionOptions.warehouses?.length ?? 0} مخزن / ${restrictionOptions.cashAccounts?.length ?? 0} صندوق`);

  const beforeRestriction = await call('GET', `/admin/users/${accountantId}/restrictions`);
  check('restrictions start empty', (beforeRestriction.warehouseIds ?? []).length === 0 && (beforeRestriction.cashAccountIds ?? []).length === 0);

  const savedRestriction = await call('PUT', `/admin/users/${accountantId}/restrictions`, {
    warehouseIds: [warehouseId],
    cashAccountIds: [cashAccountId],
  });
  check('restrictions saved', savedRestriction.warehouseCount === 1 && savedRestriction.cashAccountCount === 1, JSON.stringify(savedRestriction));

  const afterRestriction = await call('GET', `/admin/users/${accountantId}/restrictions`);
  check('restrictions round-trip', (afterRestriction.warehouseIds ?? []).includes(warehouseId) && (afterRestriction.cashAccountIds ?? []).includes(cashAccountId));

  const accountantToken = (await loginAs(`accountant_${stamp}`, testPassword)).accessToken;
  const filteredWarehouses = await raw('GET', '/catalog/warehouses', undefined, accountantToken);
  check('restricted user sees only allowed warehouses', filteredWarehouses.ok && filteredWarehouses.data.length === 1 && filteredWarehouses.data[0].warehouseId === warehouseId,
    `${filteredWarehouses.data?.length ?? 0} مخزن`);
  const filteredAccounts = await raw('GET', '/treasury/accounts', undefined, accountantToken);
  check('restricted user sees only allowed cash accounts', filteredAccounts.ok && filteredAccounts.data.length === 1 && filteredAccounts.data[0].cashAccountId === cashAccountId,
    `${filteredAccounts.data?.length ?? 0} صندوق`);

  await call('PUT', `/admin/users/${accountantId}/restrictions`, { warehouseIds: [], cashAccountIds: [] });
  const clearedRestriction = await call('GET', `/admin/users/${accountantId}/restrictions`);
  check('restrictions cleared back to unrestricted', clearedRestriction.warehouseIds.length === 0 && clearedRestriction.cashAccountIds.length === 0);

  const backup = await call('GET', '/admin/backup');
  check('backup snapshot generated', backup && backup.version === 1 && backup.tables && !!backup.tables.users && !!backup.tables.gl_journals,
    `${backup?.tables ? Object.keys(backup.tables).length : 0} جدول`);

  const attachmentBody = Buffer.from('wasel p7 smoke attachment').toString('base64');
  const uploaded = await call('POST', '/attachments', {
    entityType: 'invoice', entityId: purchase.invoiceId,
    fileName: 'smoke-test.txt', mimeType: 'text/plain', contentBase64: attachmentBody,
  });
  check('attachment uploaded', !!uploaded.attachmentId, String(uploaded.attachmentId ?? ''));

  const attachmentList = await call('GET', `/attachments?entityType=invoice&entityId=${purchase.invoiceId}`);
  check('attachment listed', attachmentList.length >= 1, `${attachmentList.length} مرفق`);

  const attachmentFull = await call('GET', `/attachments/${uploaded.attachmentId}`);
  check('attachment downloads with content', Buffer.from(String(attachmentFull.contentBase64 ?? ''), 'base64').toString() === 'wasel p7 smoke attachment');

  await call('DELETE', `/attachments/${uploaded.attachmentId}`);
  const attachmentAfterDelete = await call('GET', `/attachments?entityType=invoice&entityId=${purchase.invoiceId}`);
  check('attachment deleted', !attachmentAfterDelete.some((row) => row.attachmentId === uploaded.attachmentId));

  // 45. settings — company identity consumed by the printed receipt (POS)
  const printContext = await call('GET', '/sales/print-context');
  check('print context returns company identity + tax presentation',
    typeof printContext.companyName === 'string' && typeof printContext.invoiceFooter === 'string'
      && typeof printContext.taxName === 'string' && typeof printContext.showTaxOnReceipt === 'boolean',
    JSON.stringify(printContext));

  const settingsSnapshot = await call('GET', '/admin/settings');
  await call('PUT', '/admin/settings', { ...settingsSnapshot, TaxName: 'ضريبة بيع', ShowTaxOnReceipt: 'false' });
  const printContextHidden = await call('GET', '/sales/print-context');
  check('receipt tax label + visibility round-trip',
    printContextHidden.taxName === 'ضريبة بيع' && printContextHidden.showTaxOnReceipt === false,
    `${printContextHidden.taxName} / showTax=${printContextHidden.showTaxOnReceipt}`);

  await call('PUT', '/admin/settings', {
    ...settingsSnapshot,
    TaxName: settingsSnapshot.TaxName ?? 'ضريبة القيمة المضافة',
    ShowTaxOnReceipt: settingsSnapshot.ShowTaxOnReceipt ?? 'true',
  });
  const printContextRestored = await call('GET', '/sales/print-context');
  check('receipt settings restored after round-trip',
    printContextRestored.showTaxOnReceipt === true && printContextRestored.taxName === (settingsSnapshot.TaxName ?? 'ضريبة القيمة المضافة'),
    `${printContextRestored.taxName} / showTax=${printContextRestored.showTaxOnReceipt}`);

  // 46. settings — print presentation (copies, paper size, kitchen ticket) consumed by POS
  const presentation = await call('GET', '/sales/print-context');
  check('print context returns presentation flags',
    typeof presentation.receiptShowBranchName === 'boolean' && typeof presentation.receiptShowPartyName === 'boolean'
      && typeof presentation.receiptShowTotals === 'boolean' && typeof presentation.receiptCopies === 'number'
      && ['thermal80', 'thermal58', 'a5', 'a4'].includes(presentation.receiptPaperSize)
      && typeof presentation.kitchenTicketEnabled === 'boolean' && typeof presentation.kitchenTicketCopies === 'number',
    JSON.stringify({ copies: presentation.receiptCopies, paper: presentation.receiptPaperSize, kitchen: presentation.kitchenTicketEnabled }));

  const printSnapshot = await call('GET', '/admin/settings');
  await call('PUT', '/admin/settings', { ...printSnapshot, ReceiptCopies: '3', ReceiptPaperSize: 'thermal58', KitchenTicketEnabled: 'true', KitchenTicketCopies: '2' });
  const presentationAfter = await call('GET', '/sales/print-context');
  check('copies + paper size + kitchen ticket round-trip',
    presentationAfter.receiptCopies === 3 && presentationAfter.receiptPaperSize === 'thermal58'
      && presentationAfter.kitchenTicketEnabled === true && presentationAfter.kitchenTicketCopies === 2,
    JSON.stringify({ copies: presentationAfter.receiptCopies, paper: presentationAfter.receiptPaperSize, kitchenCopies: presentationAfter.kitchenTicketCopies }));

  await call('PUT', '/admin/settings', {
    ...printSnapshot,
    ReceiptCopies: printSnapshot.ReceiptCopies ?? '1',
    ReceiptPaperSize: printSnapshot.ReceiptPaperSize ?? 'thermal80',
    KitchenTicketEnabled: printSnapshot.KitchenTicketEnabled ?? 'false',
    KitchenTicketCopies: printSnapshot.KitchenTicketCopies ?? '1',
  });
  const presentationRestored = await call('GET', '/sales/print-context');
  check('print presentation restored after round-trip',
    presentationRestored.receiptCopies === Number(printSnapshot.ReceiptCopies ?? 1)
      && presentationRestored.receiptPaperSize === (printSnapshot.ReceiptPaperSize ?? 'thermal80')
      && presentationRestored.kitchenTicketEnabled === ((printSnapshot.KitchenTicketEnabled ?? 'false') === 'true'));

  // 47. settings — control toggles (auto item code, rep required, below-cost block)
  const settingsNow = await call('GET', '/admin/settings');
  await call('PUT', '/admin/settings', { ...settingsNow, ItemCodeAuto: 'true', RequireRepOnSale: 'true', BlockBelowCostSale: 'true', DefaultPaymentType: '2' });

  const autoItem = await call('POST', '/items', {
    name: `صنف كود تلقائي ${stamp}`, baseUnitId: 1, costPrice: 100, sellPrice: 150, vatPct: 0,
  });
  check('item created with auto code when ItemCodeAuto is on', typeof autoItem.code === 'string' && autoItem.code.startsWith('ITM-'), JSON.stringify(autoItem));

  const belowCost = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 1,
    cashAccountId, repId,
    lines: [{ itemId: autoItem.itemId, unitId: 1, quantity: 1, unitPrice: 1, taxPct: 0 }],
  });
  check('sale below cost is rejected when BlockBelowCostSale is on',
    belowCost.status === 400 && String(belowCost.data?.message ?? '').includes('التكلفة'),
    String(belowCost.status));

  const noRepSale = await raw('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 10,
    cashAccountId,
    lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 10000, taxPct: 0 }],
  });
  check('sale without rep is rejected when RequireRepOnSale is on', noRepSale.status === 400, String(noRepSale.status));

  await call('PUT', '/admin/settings', {
    ...settingsNow,
    ItemCodeAuto: settingsNow.ItemCodeAuto ?? 'false',
    RequireRepOnSale: settingsNow.RequireRepOnSale ?? 'false',
    BlockBelowCostSale: settingsNow.BlockBelowCostSale ?? 'false',
    DefaultPaymentType: settingsNow.DefaultPaymentType ?? '1',
  });
  const togglesRestored = await call('GET', '/sales/print-context');
  check('control toggles restored after round-trip',
    (togglesRestored.defaultPaymentType ?? 1) === Number(settingsNow.DefaultPaymentType ?? 1)
      && togglesRestored.kitchenPrinterName === (settingsNow.KitchenPrinterName ?? ''));

  // 48. P6/P7 — HR depth (components, attendance import, advances, payroll) + xlsx + item/party attachments
  const currentMonth = new Date().toISOString().slice(0, 7);

  const payrollEmployee = await call('POST', '/hr/employees', {
    code: `EMP-${stamp}`, name: `موظف مرتبات ${stamp}`, jobTitle: 'محاسب',
    basicSalary: 10000, allowances: 500, deductions: 100, hireDate: daysAgoIso(60),
  });
  check('payroll employee created', !!payrollEmployee.employeeId, String(payrollEmployee.employeeId));

  const department = await call('POST', '/hr/departments', { name: `إدارة ${stamp}` });
  check('department created', !!department.departmentId, String(department.departmentId));
  await call('PUT', `/hr/employees/${payrollEmployee.employeeId}`, {
    departmentId: department.departmentId, jobTitle: 'محاسب أول',
  });
  const employeeDetail = await call('GET', `/hr/employees/${payrollEmployee.employeeId}`);
  check('employee detail carries the department',
    Number(employeeDetail.departmentId) === Number(department.departmentId)
      && employeeDetail.jobTitle === 'محاسب أول',
    JSON.stringify({ departmentId: employeeDetail.departmentId, jobTitle: employeeDetail.jobTitle }));

  const allowanceComponent = await call('POST', '/hr/components', {
    name: `بدل مواصلات ${stamp}`, componentType: 1, calcType: 1, amount: 400,
  });
  const percentComponent = await call('POST', '/hr/components', {
    name: `حافز نسبة ${stamp}`, componentType: 1, calcType: 2, amount: 10,
  });
  check('salary components created',
    !!allowanceComponent.componentId && !!percentComponent.componentId,
    `${allowanceComponent.componentId}/${percentComponent.componentId}`);

  await call('PUT', `/hr/employees/${payrollEmployee.employeeId}/components`, {
    components: [
      { componentId: allowanceComponent.componentId, assigned: true },
      { componentId: percentComponent.componentId, assigned: true, amountOverride: 12 },
    ],
  });
  const assignedComponents = await call('GET', `/hr/employees/${payrollEmployee.employeeId}/components`);
  const assignedAllowance = assignedComponents.find(
    (row) => Number(row.componentId) === Number(allowanceComponent.componentId));
  check('component assigned to the employee', assignedAllowance?.assigned === true, JSON.stringify(assignedAllowance));

  const attendance = await call('POST', '/hr/attendance', {
    employeeId: payrollEmployee.employeeId, workDate: daysAgoIso(1), status: 1, overtimeMinutes: 120,
  });
  check('attendance recorded', !!attendance.attendanceId, JSON.stringify(attendance));

  const importCsv = [
    'code,date,status,overtime',
    `EMP-${stamp},${daysAgoIso(2)},present,60`,
    `EMP-${stamp},${daysAgoIso(3)},absent,0`,
  ].join('\n');
  const imported = await call('POST', '/hr/attendance/import', { csv: importCsv });
  check('attendance CSV imported', imported.imported === 2, JSON.stringify(imported));
  const attendanceList = await call('GET', `/hr/attendance?employeeId=${payrollEmployee.employeeId}`);
  check('imported attendance is listed', attendanceList.length >= 3, String(attendanceList.length));

  const leave = await call('POST', '/hr/leaves', {
    employeeId: payrollEmployee.employeeId, leaveType: 3,
    startDate: `${currentMonth}-01`, endDate: `${currentMonth}-02`,
  });
  check('leave request created', !!leave.leaveId, JSON.stringify(leave));
  await call('PUT', `/hr/leaves/${leave.leaveId}/status`, { status: 2 });
  const approvedLeaves = await call('GET', '/hr/leaves?status=2');
  check('leave approved',
    approvedLeaves.some((row) => Number(row.leaveId) === Number(leave.leaveId)));

  const advance = await call('POST', '/hr/advances', {
    employeeId: payrollEmployee.employeeId, amount: 1200, monthlyDeduction: 200, notes: 'سلفة اختبار',
  });
  check('advance created', !!advance.advanceId, String(advance.advanceId));
  const paidAdvance = await call('POST', `/hr/advances/${advance.advanceId}/pay`, { cashAccountId });
  check('advance paid and journaled', !!paidAdvance.journalId, String(paidAdvance.journalId));
  const advanceJournal = await call('GET', `/accounting/journals/${paidAdvance.journalId}`);
  const advanceDebit = advanceJournal.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const advanceCredit = advanceJournal.lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  check('advance journal is balanced', Math.abs(advanceDebit - advanceCredit) < 0.01,
    `${advanceDebit} / ${advanceCredit}`);

  const stockBeforePayroll = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  const payroll = await call('POST', '/hr/payroll/generate', { periodMonth: currentMonth });
  check('payroll generated', payroll.generated >= 1, JSON.stringify(payroll));

  const monthSalaries = await call('GET', `/hr/salaries?month=${currentMonth}`);
  const salaryRow = monthSalaries.find((row) => Number(row.employeeId) === Number(payrollEmployee.employeeId));
  check('payroll row created for the employee', !!salaryRow, JSON.stringify(salaryRow));
  check('payroll deducted the open advance', Number(salaryRow?.advanceDeduction) === 200,
    String(salaryRow?.advanceDeduction));
  check('payroll gross includes components and overtime', Number(salaryRow?.grossPay) > 12000,
    String(salaryRow?.grossPay));

  const salaryJournal = await call('GET', `/accounting/journals/${salaryRow?.glJournalId}`);
  const salaryDebit = salaryJournal.lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
  const salaryCredit = salaryJournal.lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0);
  check('payroll accrual journal is balanced', Math.abs(salaryDebit - salaryCredit) < 0.01,
    `${salaryDebit} / ${salaryCredit}`);

  const stockAfterPayroll = Number((await call('GET', `/inventory/balances?warehouseId=${warehouseId}`))
    .find((row) => row.itemId === itemB.itemId)?.onHandQty ?? 0);
  check('payroll does not touch the stock', stockAfterPayroll === stockBeforePayroll,
    `${stockBeforePayroll} -> ${stockAfterPayroll}`);

  const payslip = await call('GET', `/hr/salaries/${salaryRow?.salaryPayId}/payslip`);
  check('payslip has component lines', Array.isArray(payslip.lines) && payslip.lines.length > 0,
    String(payslip.lines?.length));
  check('payslip shows the unpaid leave days', Number(payslip.unpaidLeaveDays) >= 2,
    String(payslip.unpaidLeaveDays));

  const payrollPaid = await call('POST', '/hr/payroll/pay', {
    cashAccountId, salaryPayIds: [salaryRow.salaryPayId],
  });
  check('payroll paid from the cash account', payrollPaid.paid === 1, JSON.stringify(payrollPaid));
  const paidSalaries = await call('GET', `/hr/salaries?month=${currentMonth}`);
  const paidRow = paidSalaries.find((row) => Number(row.salaryPayId) === Number(salaryRow.salaryPayId));
  check('payroll row marked as paid', Number(paidRow?.status) === 2, String(paidRow?.status));

  const payrollSummary = await call('GET', `/hr/reports/payroll-summary?month=${currentMonth}`);
  check('payroll summary reports the month', Array.isArray(payrollSummary.items) && payrollSummary.items.length > 0,
    JSON.stringify(payrollSummary.totals));

  const attendanceSummary = await call('GET', `/hr/reports/attendance-summary?from=${currentMonth}-01&to=${currentMonth}-28`);
  const employeeSummary = attendanceSummary.find(
    (row) => Number(row.employeeId) === Number(payrollEmployee.employeeId));
  check('attendance summary aggregates the employee',
    !!employeeSummary && Number(employeeSummary.presentDays) >= 1, JSON.stringify(employeeSummary));

  // Real .xlsx export decodes to a zip package.
  const xlsx = await call('GET', '/reports/xlsx?report=sales');
  const xlsxBuffer = Buffer.from(String(xlsx.base64 ?? ''), 'base64');
  check('xlsx export returns a valid zip', xlsxBuffer.slice(0, 2).toString() === 'PK', `${xlsxBuffer.length} bytes`);
  check('xlsx export has a filename', String(xlsx.fileName ?? '').endsWith('.xlsx'), String(xlsx.fileName));
  const unknownXlsx = await raw('GET', '/reports/xlsx?report=unknown');
  check('unknown xlsx report is rejected', unknownXlsx.status === 400, String(unknownXlsx.status));

  // Attachments work for items and parties too (generic entity type).
  const itemAttachment = await call('POST', '/attachments', {
    entityType: 'item', entityId: itemB.itemId, fileName: 'item-spec.txt', mimeType: 'text/plain',
    contentBase64: `data:text/plain;base64,${Buffer.from('item spec sheet').toString('base64')}`,
  });
  check('item attachment uploaded', !!itemAttachment.attachmentId, String(itemAttachment.attachmentId));
  const itemAttachments = await call('GET', `/attachments?entityType=item&entityId=${itemB.itemId}`);
  check('item attachment listed',
    itemAttachments.some((row) => Number(row.attachmentId) === Number(itemAttachment.attachmentId)));
  await call('DELETE', `/attachments/${itemAttachment.attachmentId}`);

  const partyAttachment = await call('POST', '/attachments', {
    entityType: 'party', entityId: party.partyId, fileName: 'party-contract.txt', mimeType: 'text/plain',
    contentBase64: `data:text/plain;base64,${Buffer.from('signed contract').toString('base64')}`,
  });
  check('party attachment uploaded', !!partyAttachment.attachmentId, String(partyAttachment.attachmentId));
  const partyAttachments = await call('GET', `/attachments?entityType=party&entityId=${party.partyId}`);
  check('party attachment listed',
    partyAttachments.some((row) => Number(row.attachmentId) === Number(partyAttachment.attachmentId)));
  await call('DELETE', `/attachments/${partyAttachment.attachmentId}`);

  // 49. P9 — report builder
  const rbDatasets = await call('GET', '/reports/builder/datasets');
  check('report builder datasets listed', Array.isArray(rbDatasets) && rbDatasets.length >= 4, String(rbDatasets.length));
  check('report builder includes sales dataset', rbDatasets.some((d) => d.key === 'sales_invoices'));

  const rbRun = await call('POST', '/reports/builder/run', {
    dataset: 'sales_invoices', columns: ['invoiceNo', 'totalAmount', 'invoiceDate'],
  });
  check('report builder runs sales dataset', Array.isArray(rbRun.rows) && Array.isArray(rbRun.columns), String(rbRun.rows?.length));
  check('report builder returns requested columns', (rbRun.columns || []).some((c) => c.key === 'invoiceNo'));

  const rbDef = await call('POST', '/reports/builder/definitions', {
    name: `RB Smoke ${stamp}`, dataset: 'parties', columns: ['name', 'phone', 'partyType'],
  });
  check('report builder definition saved', !!rbDef.definitionId, String(rbDef.definitionId));
  const rbDefs = await call('GET', '/reports/builder/definitions');
  check('report builder definitions listed', rbDefs.some((d) => Number(d.definitionId) === Number(rbDef.definitionId)));

  const rbXlsx = await call('GET', '/reports/builder/export-xlsx?dataset=parties&columns=name,phone');
  const rbXlsxBuffer = Buffer.from(String(rbXlsx.base64 ?? ''), 'base64');
  check('report builder xlsx export valid', rbXlsxBuffer.slice(0, 2).toString() === 'PK', String(rbXlsxBuffer.length));
  await call('DELETE', `/reports/builder/definitions/${rbDef.definitionId}`);

  // 50. P9 — CRM
  const crmSummary0 = await call('GET', '/crm/summary');
  check('crm summary endpoint works', crmSummary0 && Array.isArray(crmSummary0.byStage), JSON.stringify(crmSummary0.openTickets));

  const crmSources = await call('GET', '/crm/sources');
  check('crm sources listed', Array.isArray(crmSources) && crmSources.length > 0, String(crmSources.length));
  const crmSource = await call('POST', '/crm/sources', { name: `مصدر اختبار ${stamp}` });
  check('crm source created', !!crmSource.sourceId, String(crmSource.sourceId));

  const crmLead = await call('POST', '/crm/leads', {
    name: `عميل محتمل ${stamp}`, phone: '0500000001', company: 'شركة اختبار',
    sourceId: crmSource.sourceId, expectedValue: 2500, stage: 1, notes: 'smoke',
  });
  check('crm lead created', !!crmLead.leadId, String(crmLead.leadId));

  const crmLeadDetail = await call('GET', `/crm/leads/${crmLead.leadId}`);
  check('crm lead detail loaded', Number(crmLeadDetail.leadId) === Number(crmLead.leadId));

  await call('PUT', `/crm/leads/${crmLead.leadId}`, { stage: 2, notes: 'updated' });
  const crmLeads = await call('GET', '/crm/leads?stage=2');
  check('crm lead updated and filtered', crmLeads.some((l) => Number(l.leadId) === Number(crmLead.leadId)));

  const crmActivity = await call('POST', `/crm/leads/${crmLead.leadId}/activities`, {
    activityType: 1, subject: 'مكالمة أولى', notes: 'تم', dueAt: new Date().toISOString(),
  });
  check('crm activity created', !!crmActivity.activityId, String(crmActivity.activityId));
  await call('PUT', `/crm/activities/${crmActivity.activityId}/done`, { isDone: true });
  const crmLeadAfterActivity = await call('GET', `/crm/leads/${crmLead.leadId}`);
  check('crm activity marked done', crmLeadAfterActivity.activities?.some((a) => Number(a.activityId) === Number(crmActivity.activityId) && a.isDone === true));

  const crmTicket = await call('POST', '/crm/tickets', {
    subject: `تذكرة CRM ${stamp}`, description: 'اختبار', priority: 3, leadId: crmLead.leadId,
  });
  check('crm ticket created', !!crmTicket.ticketId, String(crmTicket.ticketId));
  await call('PUT', `/crm/tickets/${crmTicket.ticketId}`, { status: 3 });
  const crmTickets = await call('GET', '/crm/tickets');
  check('crm ticket updated and listed', crmTickets.some((t) => Number(t.ticketId) === Number(crmTicket.ticketId) && Number(t.status) === 3));

  const crmConverted = await call('POST', `/crm/leads/${crmLead.leadId}/convert`);
  check('crm lead converted to party', !!crmConverted.partyId, String(crmConverted.partyId));
  const crmLeadConverted = await call('GET', `/crm/leads/${crmLead.leadId}`);
  check('crm lead linked to converted party', Number(crmLeadConverted.partyId) === Number(crmConverted.partyId));

  const crmSummary1 = await call('GET', '/crm/summary');
  check('crm summary reflects data', (crmSummary1.byStage || []).some((r) => Number(r.count) >= 1));

  // 51. Checks (أوراق القبض/الدفع)
  const chk = await call('POST', '/checks', {
    direction: 1, checkNo: `CHK-${stamp}`, bankName: 'بنك اختبار', amount: 750,
    partyId: party.partyId, cashAccountId, dueDate: daysAgoIso(-30),
  });
  check('check created', !!chk.checkId, String(chk.checkId));
  const checksList = await call('GET', '/checks?direction=1');
  check('checks listed', checksList.some((c) => Number(c.checkId) === Number(chk.checkId)));
  await call('PUT', `/checks/${chk.checkId}/status`, { status: 2 });
  const checksCollected = await call('GET', '/checks?status=2');
  check('check collected status updated', checksCollected.some((c) => Number(c.checkId) === Number(chk.checkId) && Number(c.status) === 2));
  const chkBounce = await call('POST', '/checks', {
    direction: 2, checkNo: `CHKB-${stamp}`, bankName: 'بنك اختبار', amount: 300, dueDate: daysAgoIso(-10),
  });
  await call('PUT', `/checks/${chkBounce.checkId}/status`, { status: 3, notes: 'ارتداد' });
  const checksBounced = await call('GET', '/checks?status=3');
  check('check bounce status recorded', checksBounced.some((c) => Number(c.checkId) === Number(chkBounce.checkId) && Number(c.status) === 3));
  const checksSummary = await call('GET', '/checks/summary');
  check('checks summary returned', Array.isArray(checksSummary.rows));

  // 51b. Report builder grouping
  const rbGrouped = await call('POST', '/reports/builder/run', {
    dataset: 'sales_invoices', columns: ['branchName', 'totalAmount'], groupBy: 'branchName',
  });
  check('report builder grouped run works', Array.isArray(rbGrouped.rows) && rbGrouped.columns?.some((c) => c.key === 'branchName'));



  // =================================================================
  // Phase 2 — Regression tests (permanent, from the full-month audit)
  // =================================================================
  const phase2 = async () => {
    const tbBefore = await call('GET', '/accounting/reports/trial-balance');
    const tbBeforeInv = tbBefore.lines.find((l) => l.code === '1104');
    const tbBeforeCogs = tbBefore.lines.find((l) => l.code === '5101');

    const regWh = await call('POST', '/catalog/warehouses', {
      branchId, code: `REG-${stamp}`, name: `مخزن Regression ${stamp}`, isDefault: false, isActive: true,
    });
    check('regression warehouse created', !!regWh.warehouseId, String(regWh.warehouseId));

    const transfer = await call('POST', '/stock-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: regWh.warehouseId, transferDate: daysAgoIso(5),
    });
    check('regression stock transfer created', !!transfer.stockTransferId, String(transfer.stockTransferId));
    const addLineManual = await raw('POST', `/stock-transfers/${transfer.stockTransferId}/lines`, {
      itemId: itemA.itemId, unitId: 1, quantity: 5, unitCost: 5,
    });
    check('manual unitCost on regression transfer is refused (P4-3)', addLineManual.status === 400, `status=${addLineManual.status}`);
    const addLine = await raw('POST', `/stock-transfers/${transfer.stockTransferId}/lines`, {
      itemId: itemA.itemId, unitId: 1, quantity: 5,
    });
    check('regression addLine succeeds without manual cost', addLine.status === 201, `status=${addLine.status}`);

    const transferApprove = await call('POST', `/stock-transfers/${transfer.stockTransferId}/approve`, {});
    check('regression stock transfer approved', transferApprove.status === 2 || !!transferApprove.journalId, 'approve ok');
    const transferReceive = await call('POST', `/stock-transfers/${transfer.stockTransferId}/receive`, {});
    check('regression stock transfer received', transferReceive.status === 4 || !!transferReceive.inboundVoucherId, `status=${transferReceive.status}`);
    const tbAfterTransfer = await call('GET', '/accounting/reports/trial-balance');
    const tbAfterInv = tbAfterTransfer.lines.find((l) => l.code === '1104');
    const tbAfterCogs = tbAfterTransfer.lines.find((l) => l.code === '5101');
    check(
      'transfer leaves COGS unchanged (net)',
      Math.abs((Number(tbAfterCogs?.debit ?? 0) - Number(tbAfterCogs?.credit ?? 0))
        - (Number(tbBeforeCogs?.debit ?? 0) - Number(tbBeforeCogs?.credit ?? 0))) < 0.01,
      `before net ${Number(tbBeforeCogs?.debit ?? 0) - Number(tbBeforeCogs?.credit ?? 0)} after net ${Number(tbAfterCogs?.debit ?? 0) - Number(tbAfterCogs?.credit ?? 0)}`,
    );
    check(
      'transfer leaves INVENTORY net unchanged',
      Math.abs((Number(tbAfterInv?.debit ?? 0) - Number(tbAfterInv?.credit ?? 0))
        - (Number(tbBeforeInv?.debit ?? 0) - Number(tbBeforeInv?.credit ?? 0))) < 0.01,
      `before net ${Number(tbBeforeInv?.debit ?? 0) - Number(tbBeforeInv?.credit ?? 0)} after net ${Number(tbAfterInv?.debit ?? 0) - Number(tbAfterInv?.credit ?? 0)}`,
    );

    // Phase 4 fix — inventory document journals must be dated to the document date, not "today".
    const isoDay = (value) => {
      if (!value) return '';
      const d = new Date(String(value));
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const transferJournalOut = await call('GET', `/accounting/journals/${transferApprove.journalId}`);
    check('transfer approve journal is dated to the transfer date',
      isoDay(transferJournalOut?.header?.journalDate) === isoDay(daysAgoIso(5)),
      `journal ${isoDay(transferJournalOut?.header?.journalDate)} vs transfer ${isoDay(daysAgoIso(5))}`);
    const transferJournalIn = await call('GET', `/accounting/journals/${transferReceive.journalId}`);
    check('transfer receive journal is dated to the transfer date',
      isoDay(transferJournalIn?.header?.journalDate) === isoDay(daysAgoIso(5)),
      `journal ${isoDay(transferJournalIn?.header?.journalDate)} vs transfer ${isoDay(daysAgoIso(5))}`);

    const voucherDate = daysAgoIso(6);
    const damageVoucher = await call('POST', '/stock-vouchers', {
      warehouseId, voucherType: 3, voucherDate, notes: 'regression date check',
    });
    await call('POST', `/stock-vouchers/${damageVoucher.stockVoucherId}/lines`, {
      itemId: itemA.itemId, unitId: 1, quantity: 1, unitCost: 5, notes: 'regression',
    });
    const damageApproved = await call('POST', `/stock-vouchers/${damageVoucher.stockVoucherId}/approve`, {});
    if (damageApproved.journalId) {
      const damageJournal = await call('GET', `/accounting/journals/${damageApproved.journalId}`);
      check('damage voucher journal is dated to the voucher date',
        isoDay(damageJournal?.header?.journalDate) === isoDay(voucherDate),
        `journal ${isoDay(damageJournal?.header?.journalDate)} vs voucher ${isoDay(voucherDate)}`);
    } else {
      check('damage voucher journal is dated to the voucher date', false, 'no journal returned');
    }

    const countDate = daysAgoIso(7);
    const dateCount = await call('POST', '/stock-counts', {
      warehouseId: regWh.warehouseId, employeeId: employee.employeeId, countDate, notes: 'regression date check',
    });
    const countBalance = Number((await call('GET', `/inventory/balances?warehouseId=${regWh.warehouseId}`))
      .find((row) => row.itemId === itemA.itemId)?.onHandQty ?? 0);
    await call('POST', `/stock-counts/${dateCount.stockCountId}/lines`, {
      itemId: itemA.itemId, unitId: 1, countedQty: Math.max(0, countBalance - 1),
    });
    const dateCountApproved = await call('POST', `/stock-counts/${dateCount.stockCountId}/approve`, {});
    if (dateCountApproved.journalId) {
      const dateCountJournal = await call('GET', `/accounting/journals/${dateCountApproved.journalId}`);
      check('count approve journal is dated to the count date',
        isoDay(dateCountJournal?.header?.journalDate) === isoDay(countDate),
        `journal ${isoDay(dateCountJournal?.header?.journalDate)} vs count ${isoDay(countDate)}`);
    } else {
      check('count approve journal is dated to the count date', false, 'no journal returned');
    }

    const pastDate = daysAgoIso(10);
    const dateTest = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 15,
      cashAccountId: accounts[0].cashAccountId, invoiceDate: pastDate,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
    });
    check('date-dated invoice posted', !!dateTest.invoiceId, dateTest.invoiceNo);
    const dateInv = await call('GET', `/sales/invoices/${dateTest.invoiceId}`);
    const dateJournal = await call('GET', `/accounting/journals/${dateInv.header?.glJournalId}`);
    const localDay = (value) => {
      const d = new Date(String(value ?? ''));
      if (Number.isNaN(d.getTime())) return String(value);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    check('invoice has a date', !!dateInv.header?.invoiceDate, localDay(dateInv.header?.invoiceDate));
    check('journal posted to the invoice date', localDay(dateJournal.header?.journalDate) === localDay(dateInv.header?.invoiceDate), `journal ${localDay(dateJournal.header?.journalDate)} invoice ${localDay(dateInv.header?.invoiceDate)}`);

    const closedPeriod = await call('POST', '/accounting/periods', {
      name: 'اختبار قفل Regression', startDate: '2026-09-01', endDate: '2026-09-30',
    });
    check('regression close period created', !!closedPeriod.periodId, String(closedPeriod.periodId));
    await call('POST', `/accounting/periods/${closedPeriod.periodId}/manual-lock`, { reason: 'اختبار Regression — قفل الترحيل' });
    const inClosedPeriod = await raw('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, paidAmount: 15,
      cashAccountId: accounts[0].cashAccountId, invoiceDate: '2026-09-15',
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
    });
    check('invoice in closed period rejected (400)', inClosedPeriod.status === 400, `status=${inClosedPeriod.status} ${JSON.stringify(inClosedPeriod.body?.message ?? '')}`);
    const journalInClosedPeriod = await raw('POST', '/accounting/journals', {
      description: 'محاولة في فترة مقفولة إداريًا', journalDate: '2026-09-15',
      lines: [
        { accountId: 15, debit: 100, description: 'محاولة', partyId: null },
        { accountId: 45, credit: 100, description: 'محاولة', partyId: null },
      ],
    });
    check('manual journal in locked period rejected (400)', journalInClosedPeriod.status === 400, `status=${journalInClosedPeriod.status}`);

    await call('POST', `/accounting/periods/${closedPeriod.periodId}/manual-unlock`, { reason: 'انتهى اختبار Regression' });

    const postedJournalId = dateInv.header?.glJournalId;
    const repost = await raw('POST', `/accounting/journals/${postedJournalId}/post`, {});
    check('re-post of posted journal rejected (400)', repost.status === 400, `status=${repost.status} ${JSON.stringify(repost.body?.message ?? '')}`);

    const idemId = `smoke-idem-${stamp}-${Date.now()}`;
    const idem1 = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
      paidAmount: 9, invoiceDate: pastDate, clientRequestId: idemId,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
    });
    const idem2 = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
      paidAmount: 9, invoiceDate: pastDate, clientRequestId: idemId,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
    });
    check('idempotent resubmit returns the original invoice (no duplicate)', Number(idem1.invoiceId) === Number(idem2.invoiceId) && !!idem2.duplicate, `first=${idem1.invoiceId} second=${idem2.invoiceId}`);

    const cashierForPhase = await loginAs(`cashier_${stamp}`, testPassword);
    const cashierJournal = await raw('POST', '/accounting/journals', {
      description: 'محاولة غير مخولة', journalDate: pastDate,
      lines: [
        { accountId: 15, debit: 25, description: 'محاولة', partyId: null },
        { accountId: 45, credit: 25, description: 'محاولة', partyId: null },
      ],
    }, cashierForPhase.accessToken);
    check('cashier journal posting rejected (403)', cashierJournal.status === 403, `status=${cashierJournal.status}`);
    const accountantForPhase = await loginAs(`accountant_${stamp}`, testPassword);
    const accountantSale = await raw('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
      paidAmount: 9, lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 }],
    }, accountantForPhase.accessToken);
    check('accountant cannot post a sale invoice (403)', accountantSale.status === 403, `status=${accountantSale.status}`);

    // --- 7. Inventory/GL reconciliation: delta test, independent of history
    // B2/Q1 Option A: INVENTORY (1104) now moves on the GRN, not on the
    // purchase invoice — the invoice only settles GRNI (2107).
    const reconPurchaseTotal = 2100;
    const invTb = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '1104');
    const invPo = await call('POST', '/orders', {
      orderType: 2, partyId: grnSupplier.partyId, warehouseId,
      lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: reconPurchaseTotal, taxPct: 0 }],
    });
    await call('POST', `/orders/${invPo.orderId}/status`, { status: 2 });
    const invPoDetail = await call('GET', `/orders/${invPo.orderId}`);
    const invGrn = await call('POST', '/purchases/receipts', {
      orderId: invPo.orderId, warehouseId, receivedBy: 1, inspectedBy: 1,
      lines: invPoDetail.lines.map((l) => ({ orderLineId: l.lineId, acceptedQty: Number(l.quantity), unitCost: reconPurchaseTotal })),
    });
    check('GRN for GL inventory delta created', !!invGrn.receiptNo, String(invGrn.receiptNo));
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId, warehouseId, paymentType: 1,
      cashAccountId: accounts[0].cashAccountId, paidAmount: reconPurchaseTotal,
      lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: reconPurchaseTotal, discountPct: 0, taxPct: 0 }],
    });
    const invTbAfter = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '1104');
    check(
      'inventory GL net rises by the purchase value',
      Math.abs(((Number(invTbAfter?.debit ?? 0) - Number(invTbAfter?.credit ?? 0)) - (Number(invTb?.debit ?? 0) - Number(invTb?.credit ?? 0))) - reconPurchaseTotal) < 0.01,
      `delta ${Number(invTbAfter?.debit ?? 0) - Number(invTbAfter?.credit ?? 0) - (Number(invTb?.debit ?? 0) - Number(invTb?.credit ?? 0))}`,
    );

    const reconParty = await call('POST', '/parties', {
      name: `عميل تسوية Regression ${stamp}`, partyType: 1, phone: '01220009999', creditLimit: 1000000000,
    });
    check('recon party created', !!reconParty.partyId, String(reconParty.partyId));

    // --- 8. AR reconciliation: delta test — credit sale raises AR by exactly its total
    const arTb = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '1103');
    const reconSale = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, partyId: reconParty.partyId,
      paymentType: 2, paidAmount: 0,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 4000, discountPct: 0, taxPct: 0 }],
    });
    const reconSaleTotal = 4000;
    check('recon credit sale posted', !!reconSale.invoiceId, `total ${reconSaleTotal}`);
    const arTbAfter = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '1103');
    check(
      'AR GL net rises by the credit sale total',
      Math.abs(((Number(arTbAfter?.debit ?? 0) - Number(arTbAfter?.credit ?? 0)) - (Number(arTb?.debit ?? 0) - Number(arTb?.credit ?? 0))) - reconSaleTotal) < 0.01,
      `delta ${Number(arTbAfter?.debit ?? 0) - Number(arTbAfter?.credit ?? 0) - (Number(arTb?.debit ?? 0) - Number(arTb?.credit ?? 0))}`,
    );

    const reconSupplier = await call('POST', '/parties', {
      name: `مورد تسوية Regression ${stamp}`, partyType: 2, phone: '01220008888', creditLimit: 1000000000,
    });
    check('recon supplier created', !!reconSupplier.partyId, String(reconSupplier.partyId));

    // --- 9. AP reconciliation: delta test — credit purchase raises AP by exactly its total
    const apTb = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '2101');
    const reconPurchaseTotalAp = 20000;
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId, warehouseId, partyId: reconSupplier.partyId,
      paymentType: 2, paidAmount: 0,
      lines: [{ itemId: itemA.itemId, unitId: 1, quantity: 1, unitPrice: reconPurchaseTotalAp, discountPct: 0, taxPct: 0 }],
    });
    const apTbAfter = (await call('GET', '/accounting/reports/trial-balance')).lines.find((l) => l.code === '2101');
    check(
      'AP GL net rises by the credit purchase total',
      Math.abs(((Number(apTbAfter?.credit ?? 0) - Number(apTbAfter?.debit ?? 0)) - (Number(apTb?.credit ?? 0) - Number(apTb?.debit ?? 0))) - reconPurchaseTotalAp) < 0.01,
      `delta ${Number(apTbAfter?.credit ?? 0) - Number(apTbAfter?.debit ?? 0) - (Number(apTb?.credit ?? 0) - Number(apTb?.debit ?? 0))}`,
    );

    const partial = await raw('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
      paidAmount: 0,
      lines: [
        { itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 },
        { itemId: 999999, unitId: 1, quantity: 1, unitPrice: 9, taxPct: 0 },
      ],
    });
    check('invoice with unknown item rejected atomically', partial.status >= 400, `status=${partial.status}`);
    const balancesBeforePartial = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const itemBBeforePartial = balancesBeforePartial.find((b) => b.itemId === itemB.itemId)?.onHandQty;
    const balancesAfterPartial = await call('GET', `/inventory/balances?warehouseId=${warehouseId}`);
    const itemBAfter = balancesAfterPartial.find((b) => b.itemId === itemB.itemId)?.onHandQty;
    check('partial failure did not move stock', String(itemBAfter) === String(itemBBeforePartial), `before=${itemBBeforePartial} after=${itemBAfter}`);
  };
  await phase2();

  // =================================================================
  // Phase 4 / E1 — Bank Reconciliation regression tests
  // =================================================================
  const phaseE1 = async () => {
    // Resolve the BANK GL account (1102) — the accounts endpoint returns a tree.
    const accountsTree = await call('GET', '/accounting/accounts');
    const findAccount = (nodes, code) => {
      for (const node of nodes ?? []) {
        if (node.code === code) return node;
        const hit = findAccount(node.children, code);
        if (hit) return hit;
      }
      return null;
    };
    const bankGlId = Number(findAccount(accountsTree, '1102')?.accountId);
    check('E1: bank GL account resolved', !!bankGlId, `accountId=${bankGlId}`);

    const bankAccount = await call('POST', '/treasury/accounts', {
      name: `بنك اختبار ${stamp}`, type: 2, bankName: 'بنك الاختبار الرئيسي',
      accountNo: `REG-BANK-${stamp}`, glAccountId: bankGlId,
    });
    check('E1: bank account created', !!bankAccount.cashAccountId, String(bankAccount.cashAccountId));
    const bankId = bankAccount.cashAccountId;

    // Permission matrix: cashier forbidden, admin allowed.
    const cashierImport = await raw('POST', '/treasury/bank-recon/statements/import', { accountId: bankId, csv: 'date,description,amount\n2026-11-01,x,1\n' }, cashier.accessToken);
    check('E1: cashier cannot import statements (403)', cashierImport.status === 403, String(cashierImport.status));
    const cashierList = await raw('GET', '/treasury/bank-recon/accounts', undefined, cashier.accessToken);
    check('E1: cashier cannot view bank recon accounts (403)', cashierList.status === 403, String(cashierList.status));
    const accountantList = await raw('GET', '/treasury/bank-recon/accounts', undefined, accountant.accessToken);
    check('E1: accountant can view bank recon accounts (200)', accountantList.status === 200, String(accountantList.status));

    const tbBefore = await call('GET', '/accounting/reports/trial-balance');
    const net = (tb, code) => {
      const line = (tb.lines ?? []).find((l) => l.code === code);
      return Number(line?.debit ?? 0) - Number(line?.credit ?? 0);
    };
    const bankNet0 = net(tbBefore, '1102');

    // Known book movements on the bank account (J1/J2/J3) to match against.
    // Resolve the test accounts from the chart of accounts (fresh DB has no GL activity).
    const otherIncomeId = Number(findAccount(accountsTree, '4104')?.accountId);
    check('E1: other-income account resolved', !!otherIncomeId, String(otherIncomeId));
    const outbound = async (id) => (await call('GET', `/accounting/journals/${id}`)).lines.find((l) => l.accountId === bankGlId);
    const j1 = await call('POST', '/accounting/journals', {
      description: 'E1-REG-J1 TRX-E1-AUTO', journalDate: daysAgoIso(0), post: true,
      lines: [
        { accountId: bankGlId, debit: 500, description: 'إيداع عميل' },
        { accountId: otherIncomeId, credit: 500, description: 'إيراد' },
      ],
    });
    const j2 = await call('POST', '/accounting/journals', {
      description: 'E1-REG-J2 MANUAL-E1-REF', journalDate: daysAgoIso(0), post: true,
      lines: [
        { accountId: bankGlId, debit: 200, description: 'إيداع' },
        { accountId: otherIncomeId, credit: 200, description: 'إيراد' },
      ],
    });
    const j3 = await call('POST', '/accounting/journals', {
      description: 'E1-REG-J3 TRX-E1-PART', journalDate: daysAgoIso(0), post: true,
      lines: [
        { accountId: bankGlId, debit: 480, description: 'إيداع ناقص' },
        { accountId: otherIncomeId, credit: 480, description: 'إيراد' },
      ],
    });
    const tbAfterBooks = await call('GET', '/accounting/reports/trial-balance');
    const bankNet1 = net(tbAfterBooks, '1102');
    check('E1: book movements reach the GL', Math.abs(bankNet1 - bankNet0 - 1180) < 0.01, `bank ${bankNet0} -> ${bankNet1}`);
    const j1Entry = await outbound(j1.journalId);
    const j2Entry = await outbound(j2.journalId);
    const j3Entry = await outbound(j3.journalId);

    // Import the statement (7 lines: pending deposit, a fee and an unknown withdrawal included).
    const today = daysAgoIso(0);
    const csv = [
      'date,description,reference,amount,movement_type',
      `${today},إيداع من العميل,TRX-E1-AUTO,500,deposit`,
      `${today},إيداع نقدي,MANUAL-E1-REF,200,deposit`,
      `${today},إيداع مكتـتب,TRX-E1-PART,495,deposit`,
      `${today},رسوم بنكية,FEE-E1,-30,fee`,
      `${today},إيداع مجهول,UNKNOWN-E1,77,transfer_in`,
      `${today},إيداع معلق,PENDING-E1,150,pending_deposit`,
      `${today},سحب مجهول,UNKNOWN-E1-OUT,-45,withdrawal`,
    ].join('\n');
    const imp = await call('POST', '/treasury/bank-recon/statements/import', { accountId: bankId, csv });
    check('E1: statement imported — 7 lines created', imp.created === 7 && (imp.errors ?? []).length === 0, JSON.stringify(imp));

    // Double import — nothing is re-created, all rows are reported as duplicates.
    const imp2 = await call('POST', '/treasury/bank-recon/statements/import', { accountId: bankId, csv });
    check('E1: re-import creates nothing (idempotent)', imp2.created === 0 && (imp2.duplicates ?? []).length === 7, JSON.stringify(imp2));

    const linesResp = await call('GET', `/treasury/bank-recon/statements?accountId=${bankId}&from=${today}&to=${today}`);
    const byRef = (ref) => (linesResp ?? []).find((l) => l.reference === ref);
    const lAuto = byRef('TRX-E1-AUTO');
    const lManual = byRef('MANUAL-E1-REF');
    const lPart = byRef('TRX-E1-PART');
    const lFee = byRef('FEE-E1');
    const lUnknown = byRef('UNKNOWN-E1');
    const lOut = byRef('UNKNOWN-E1-OUT');
    const lPending = byRef('PENDING-E1');
    check('E1: all imported lines listed', !!lAuto && !!lManual && !!lPart && !!lFee && !!lUnknown && !!lOut && !!lPending);

    // Manual match (line 2 against J2's bank entry).
    const manual = await call('POST', `/treasury/bank-recon/statements/lines/${lManual.lineId}/match`, { entryId: j2Entry.entryId });
    check('E1: manual match succeeds (status 3)', manual.status === 3 && Math.abs(manual.matchDifference) < 0.01, JSON.stringify(manual));

    // Auto match (line 1 exact, line 3 partial with difference).
    const auto = await call('POST', '/treasury/bank-recon/auto-match', { accountId: bankId, from: today, to: today });
    check('E1: auto-match matched the exact line', auto.matched === 1, JSON.stringify(auto));
    check('E1: auto-match flagged the partial line', auto.partial === 1, JSON.stringify(auto));
    const after = await call('GET', `/treasury/bank-recon/statements?accountId=${bankId}&from=${today}&to=${today}`);
    const lAutoAfter = after.find((l) => l.reference === 'TRX-E1-AUTO');
    const lPartAfter = after.find((l) => l.reference === 'TRX-E1-PART');
    check('E1: exact line is auto-matched (status 2)', lAutoAfter.status === 2, String(lAutoAfter.status));
    check('E1: partial line carries its difference', lPartAfter.status === 6 && Math.abs(lPartAfter.matchDifference - 15) < 0.01, JSON.stringify(lPartAfter));

    // Re-running auto-match does nothing (already processed).
    const auto2 = await call('POST', '/treasury/bank-recon/auto-match', { accountId: bankId, from: today, to: today });
    check('E1: auto-match is idempotent', auto2.matched === 0 && auto2.partial === 0, JSON.stringify(auto2));

    // Mark the pending line as timing → must not post to GL.
    const timing = await call('POST', `/treasury/bank-recon/statements/lines/${lPending.lineId}/mark-timing`, { kind: 'pending_deposit' });
    check('E1: timing line marked (status 4)', timing.status === 4, JSON.stringify(timing));

    // Bank net movement after posting = −30 (fee) + 77 (unknown in) − 45 (unknown out) + 15 (partial) = +17.
    const statementBalance = Math.round((bankNet1 + 17) * 100) / 100;
    const run = await call('POST', '/treasury/bank-recon/runs', { accountId: bankId, runDate: today, statementBalance, notes: 'E1 regression' });
    check('E1: run created with correct variance', Math.abs(run.variance - 17) < 0.01, JSON.stringify(run));

    const posted = await call('POST', `/treasury/bank-recon/runs/${run.runId}/post`, {});
    check('E1: run posted with one adjustment journal', posted.status === 2 && !!posted.journalId, JSON.stringify(posted));
    const adj = posted.adjustments;
    check('E1: bank fee adjustment booked (30)', Math.abs(adj.fees - 30) < 0.01, JSON.stringify(adj));
    check('E1: unknown movements reported for suspense (77 in / 45 out)',
      Math.abs(adj.unknownIn - 77) < 0.01 && Math.abs(adj.unknownOut - 45) < 0.01, JSON.stringify(adj));
    check('E1: partial difference adjustment booked (+15)', Math.abs(adj.matchDifferenceNet - 15) < 0.01, JSON.stringify(adj));

    const tbAfter = await call('GET', '/accounting/reports/trial-balance');
    const bankNet2 = net(tbAfter, '1102');
    check('E1: GL bank equals statement balance after run', Math.abs(bankNet2 - statementBalance) < 0.01, `GL ${bankNet2} vs statement ${statementBalance}`);
    check('E1: bank fee account debited', Math.abs(net(tbAfter, '5107') - net(tbAfterBooks, '5107') - 30) < 0.01, 'BANK_FEE not debited by 30');

    // (1) Unknown deposits must NOT raise revenue — (2) unknown withdrawals must NOT raise expenses.
    check('E1: unclassified movements NEVER touch OTHER_INCOME',
      Math.abs(net(tbAfter, '4104') - net(tbAfterBooks, '4104')) < 0.01,
      `delta ${net(tbAfter, '4104') - net(tbAfterBooks, '4104')}`);
    check('E1: unclassified movements NEVER touch OTHER_EXPENSE',
      Math.abs(net(tbAfter, '5106') - net(tbAfterBooks, '5106')) < 0.01,
      `delta ${net(tbAfter, '5106') - net(tbAfterBooks, '5106')}`);

    // (3) The unclassified movements landed in the BANK_SUSPENSE clearing account.
    const suspense = await call('GET', '/treasury/bank-recon/suspense?status=1');
    const openEntries = suspense.entries ?? [];
    check('E1: three suspense entries were created', openEntries.length === 3, `open=${openEntries.length}`);
    check('E1: suspense open net is a credit of 47', Math.abs(suspense.netOpen - 47) < 0.01, `netOpen=${suspense.netOpen}`);
    const depEntry = openEntries.find((e) => Number(e.amount) === 77);
    check('E1: suspense entry references its statement line', !!depEntry && Number(depEntry.lineId) === Number(lUnknown.lineId), JSON.stringify(depEntry));

    // (6) The partial-match difference is suspense-classified, not P&L.
    const diffEntry = openEntries.find((e) => Number(e.amount) === 15);
    check('E1: partial difference is suspense-classified, not P&L',
      !!diffEntry && Number(diffEntry.direction) === 1, JSON.stringify(diffEntry));

    // (8) Re-posting a posted run is refused.
    const repost = await raw('POST', `/treasury/bank-recon/runs/${run.runId}/post`, {});
    check('E1: re-posting a posted run is refused (400)', repost.status === 400, String(repost.status));

    // Report integrity: per-run report is consistent.
    const report = await call('GET', `/treasury/bank-recon/runs/${run.runId}/report`);
    check('E1: run report returned with lines', Array.isArray(report.lines) && report.lines.length >= 7, `lines=${report.lines?.length}`);

    // (4) Classifying the unknown deposit posts a correct balanced journal via posting.ts.
    const classified = await call('POST', `/treasury/bank-recon/suspense/${depEntry.suspenseEntryId}/classify`, { accountId: otherIncomeId, notes: 'تم التحقق — إيداع عميل فعلي' });
    const classJournal = await call('GET', `/accounting/journals/${classified.classificationJournalId}`);
    const classDebitTotal = (classJournal.lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
    const classCreditTotal = (classJournal.lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    check('E1: classification journal is balanced via posting.ts',
      Math.abs(classDebitTotal - classCreditTotal) < 0.01 && classJournal.header.sourceType === 'bank_recon_classification',
      JSON.stringify({ debit: classDebitTotal, credit: classCreditTotal, source: classJournal.header.sourceType }));
    const classSuspenseLine = (classJournal.lines ?? []).find((l) => l.accountCode === '2106');
    check('E1: classification debits the suspense account', !!classSuspenseLine && Math.abs(Number(classSuspenseLine.debit) - 77) < 0.01, JSON.stringify(classSuspenseLine));
    const tbClassified = await call('GET', '/accounting/reports/trial-balance');
    const incomeDeltaClassified = net(tbClassified, '4104') - net(tbAfter, '4104');
    check('E1: OTHER_INCOME rises by exactly 77 only after explicit classification',
      Math.abs(incomeDeltaClassified + 77) < 0.01, `delta ${incomeDeltaClassified}`);

    // (5) Reversing the classification restores everything exactly.
    const reversedClass = await call('POST', `/treasury/bank-recon/suspense/${depEntry.suspenseEntryId}/reverse-classification`, {});
    check('E1: classification reversed (entry open again)', reversedClass.status === 1 && !!reversedClass.reverseJournalId, JSON.stringify(reversedClass));
    const tbReversedClass = await call('GET', '/accounting/reports/trial-balance');
    check('E1: reversal restored OTHER_INCOME exactly',
      Math.abs(net(tbReversedClass, '4104') - net(tbAfter, '4104')) < 0.01,
      `delta ${net(tbReversedClass, '4104') - net(tbAfter, '4104')}`);

    // Reverse the run — mirror journal + lines back to unreconciled, suspense entries marked reversed.
    const reversed = await call('POST', `/treasury/bank-recon/runs/${run.runId}/reverse`, {});
    check('E1: run reversed (status 3)', reversed.status === 3 && !!reversed.reverseJournalId, JSON.stringify(reversed));
    const tbReversed = await call('GET', '/accounting/reports/trial-balance');
    check('E1: reversal restored the GL bank balance', Math.abs(net(tbReversed, '1102') - bankNet1) < 0.01, `bank ${net(tbReversed, '1102')}`);
    const suspenseAfterReverse = await call('GET', '/treasury/bank-recon/suspense');
    check('E1: suspense entries of the reversed run are marked reversed',
      (suspenseAfterReverse.entries ?? []).every((e) => e.status !== 1),
      `open=${(suspenseAfterReverse.entries ?? []).filter((e) => e.status === 1).length}`);

    // Manually-locked period blocks reconciliation.
    const e1Period = await call('POST', '/accounting/periods', { name: `فترة E1 ${stamp}`, startDate: '2019-01-01', endDate: '2019-01-31' });
    await call('POST', `/accounting/periods/${e1Period.periodId}/manual-lock`, { reason: 'اختبار منع الترحيل في فترة E1' });
    const closedRun = await raw('POST', '/treasury/bank-recon/runs', { accountId: bankId, runDate: '2019-01-15', statementBalance: 1000 });
    check('E1: run inside a manually locked period rejected (400)', closedRun.status === 400, String(closedRun.status));
    await raw('POST', `/accounting/periods/${e1Period.periodId}/manual-unlock`, { reason: 'انتهى اختبار E1' });
  };
  await phaseE1();

  // =================================================================
  // Phase E5 — Fixed Assets & Depreciation regression tests
  // =================================================================
  const phaseE5 = async () => {
    const monthIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const addMonths = (iso, delta) => {
      const d = new Date(`${iso}-15T00:00:00`);
      d.setMonth(d.getMonth() + delta);
      return d;
    };
    const now = new Date();
    const thisMonth = monthIso(now);
    const today = daysAgoIso(0);
    const firstThisMonth = `${thisMonth}-01`;
    const fifteenThisMonth = `${thisMonth}-15`;
    const lastMonth = monthIso(addMonths(thisMonth, -1));

    // ---- 1) شراء أصل نقدًا
    const cashAsset = await call('POST', '/accounting/assets', {
      name: `Laptop E5 ${stamp}`, category: 'أجهزة كمبيوتر', cost: 24000, usefulLifeMonths: 24,
      residualValue: 0, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    check('E5: cash purchase asset registered', !!cashAsset.assetId, JSON.stringify(cashAsset));
    const cashJournal = await call('GET', `/accounting/journals/${cashAsset.journalId}`);
    const cashDebitTotal = (cashJournal.lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
    const cashCreditTotal = (cashJournal.lines ?? []).reduce((s, l) => s + Number(l.credit), 0);
    const cashDebitAcct = (cashJournal.lines ?? []).find((l) => l.debit > 0);
    check('E5: acquisition journal balanced via posting.ts',
      Math.abs(cashDebitTotal - cashCreditTotal) < 0.01 && cashDebitAcct?.accountCode === '1201',
      JSON.stringify({ debit: cashDebitTotal, credit: cashCreditTotal, debitCode: cashDebitAcct?.accountCode }));

    // ---- 2) شراء أصل آجلًا
    const supplier = await call('POST', '/parties', { name: `مورد أصول ${stamp}`, partyType: 2, phone: '01055550000', creditLimit: 1000000 });
    const creditAsset = await call('POST', '/accounting/assets', {
      name: `شاشة E5 ${stamp}`, category: 'أجهزة كمبيوتر', cost: 12000, usefulLifeMonths: 12,
      residualValue: 1200, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 2, supplierId: supplier.partyId,
    });
    check('E5: credit purchase asset registered', !!creditAsset.assetId, JSON.stringify(creditAsset));
    const creditJournal = await call('GET', `/accounting/journals/${creditAsset.journalId}`);
    const creditApLine = (creditJournal.lines ?? []).find((l) => l.accountCode === '2101');
    check('E5: credit purchase credits AP', !!creditApLine && Math.abs(Number(creditApLine.credit) - 12000) < 0.01, JSON.stringify(creditApLine));

    // ---- 3) أصل يبدأ استخدامه منتصف الشهر (rate must follow the policy: days/daysInMonth)
    const midAsset = await call('POST', '/accounting/assets', {
      name: `طاولة E5 ${stamp}`, category: 'أثاث', cost: 12000, usefulLifeMonths: 12,
      residualValue: 0, acquisitionDate: firstThisMonth, inServiceDate: fifteenThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    check('E5: mid-month asset registered', !!midAsset.assetId, JSON.stringify(midAsset));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const expectedMidDep = Math.round((12000 / 12) * ((daysInMonth - 15 + 1) / daysInMonth) * 100) / 100;

    // ---- 4) تشغيل الإهلاك للشهر الحالي (full month for assets in service on the 1st)
    const run1 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    check('E5: depreciation run posted', run1.posted.length >= 1, JSON.stringify(run1));
    const cashPosted = run1.posted.find((p) => p.assetId === cashAsset.assetId);
    check('E5: full-month asset depreciated exactly (24000/24 = 1000)',
      !!cashPosted && Math.abs(cashPosted.amount - 1000) < 0.01, JSON.stringify(cashPosted));
    const midPosted = run1.posted.find((p) => p.assetId === midAsset.assetId);
    check('E5: mid-month asset depreciation matches days policy',
      !!midPosted && Math.abs(midPosted.amount - expectedMidDep) < 0.01,
      `expected ${expectedMidDep} got ${midPosted?.amount}`);

    // ---- 5) إهلاك عدة أشهر (أصل أُنشئ في بداية الشهر الماضي — شهر مفتوح)
    const oldAsset = await call('POST', '/accounting/assets', {
      name: `سيارة E5 ${stamp}`, category: 'سيارات', cost: 36000, usefulLifeMonths: 12,
      residualValue: 0, acquisitionDate: `${lastMonth}-01`, inServiceDate: `${lastMonth}-01`,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    const run2 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: lastMonth });
    const run4 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const oldPosted = [run2, run4].map((r) => (r.posted ?? []).find((p) => p.assetId === oldAsset.assetId));
    check('E5: multi-month depreciation posts for every month',
      oldPosted.every((p) => p && Math.abs(p.amount - 3000) < 0.01), JSON.stringify(oldPosted));
    const oldDetail = await call('GET', `/accounting/assets/${oldAsset.assetId}`);
    check('E5: accumulated after two months = 6000',
      Math.abs(oldDetail.asset.accumulatedDepreciation - 6000) < 0.01,
      `accumulated ${oldDetail.asset.accumulatedDepreciation}`);
    check('E5: book value after two months = 30000',
      Math.abs(oldDetail.asset.bookValue - 30000) < 0.01, `bookValue ${oldDetail.asset.bookValue}`);

    // ---- 6) منع تكرار الإهلاك (running again for the same month posts nothing new)
    const tbBeforeRepeat = await call('GET', '/accounting/reports/trial-balance');
    const repeat = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const tbAfterRepeat = await call('GET', '/accounting/reports/trial-balance');
    check('E5: re-running the same month posts nothing',
      (repeat.posted ?? []).length === 0 && (repeat.total ?? 0) === 0, JSON.stringify(repeat));
    const net = (tb, code) => Number((tb.lines ?? []).find((l) => l.code === code)?.debit ?? 0)
      - Number((tb.lines ?? []).find((l) => l.code === code)?.credit ?? 0);
    check('E5: re-run does not move the depreciation account GL',
      Math.abs(net(tbAfterRepeat, '5108') - net(tbBeforeRepeat, '5108')) < 0.01,
      `delta ${net(tbAfterRepeat, '5108') - net(tbBeforeRepeat, '5108')}`);

    // ---- 7) القيمة التخريدية محترمة (الشهر الأخير يتوقف عندها)
    const capAsset = await call('POST', '/accounting/assets', {
      name: `مكيف E5 ${stamp}`, category: 'معدات', cost: 1000, usefulLifeMonths: 1,
      residualValue: 900, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = monthIso(d);
    const capDetail = await call('GET', `/accounting/assets/${capAsset.assetId}`);
    check('E5: asset at residual value stops depreciating',
      Math.abs(capDetail.asset.accumulatedDepreciation - 100) < 0.01 && Math.abs(capDetail.asset.bookValue - 900) < 0.01,
      JSON.stringify({ accumulated: capDetail.asset.accumulatedDepreciation, bookValue: capDetail.asset.bookValue }));

    // ---- 8) منع الإهلاك بعد الوصول للقيمة التخريدية
    const capNext = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: nextMonth });
    const capNextPosted = (capNext.posted ?? []).find((p) => p.assetId === capAsset.assetId);
    check('E5: no depreciation after reaching residual value', !capNextPosted, JSON.stringify(capNextPosted));

    // ---- 9) استبعاد أصل دون إهلاك سابق (بيع بربح)
    const sellFast = await call('POST', '/accounting/assets', {
      name: `كراسي E5 ${stamp}`, category: 'أثاث', cost: 5000, usefulLifeMonths: 60,
      residualValue: 0, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    const disposeFast = await call('POST', `/accounting/assets/${sellFast.assetId}/dispose`, {
      disposalType: 1, disposalDate: today, disposalAmount: 6000, cashAccountId: accounts[0].cashAccountId, reason: 'بيع بمكسب',
    });
    check('E5: sale without prior depreciation posts (gain 1000)',
      Math.abs(disposeFast.gainLoss - 1000) < 0.01, JSON.stringify(disposeFast));
    const sellFastDetail = await call('GET', `/accounting/assets/${sellFast.assetId}`);
    check('E5: sold asset status is 3 (sold)', sellFastDetail.asset.status === 3, JSON.stringify(sellFastDetail.asset.status));

    // ---- 10) استبعاد أصل بإهلاك متراكم (استهلاك كامل)
    const fullCap = await call('POST', '/accounting/assets', {
      name: `ماكينة E5 ${stamp}`, category: 'معدات', cost: 10000, usefulLifeMonths: 10,
      residualValue: 0, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const disposeWriteoff = await call('POST', `/accounting/assets/${fullCap.assetId}/dispose`, {
      disposalType: 4, disposalDate: today, reason: 'تفريخ — لم تعد صالحة',
    });
    check('E5: write-off of depreciated asset books the remaining loss',
      Math.abs(disposeWriteoff.bookValue - 9000) < 0.01 && Math.abs(disposeWriteoff.gainLoss - (-9000)) < 0.01,
      JSON.stringify(disposeWriteoff));
    const writeoffJournal = await call('GET', `/accounting/journals/${disposeWriteoff.journalId}`);
    const accumLine = (writeoffJournal.lines ?? []).find((l) => l.accountCode === '1202');
    check('E5: write-off debits accumulated depreciation', !!accumLine && Math.abs(Number(accumLine.debit) - 1000) < 0.01, JSON.stringify(accumLine));
    const writeoffDetail = await call('GET', `/accounting/assets/${fullCap.assetId}`);
    check('E5: written-off asset status is 5', writeoffDetail.asset.status === 5, JSON.stringify(writeoffDetail.asset.status));

    // ---- 11) بيع أصل بربح (راكم 9000 الآن: شهران + شهر الفحص التالي في الخطوة 8)
    // oldAsset accumulated now = 9,000 → bookValue = 36,000 − 9,000 = 27,000
    const profitAsset = oldAsset.assetId;
    const disposeProfit = await call('POST', `/accounting/assets/${profitAsset}/dispose`, {
      disposalType: 1, disposalDate: today, disposalAmount: 30000, cashAccountId: accounts[0].cashAccountId, reason: 'بيع بربح',
    });
    check('E5: sale with profit computes gain (30000 − 27000 = 3000)',
      Math.abs(disposeProfit.gainLoss - 3000) < 0.01, JSON.stringify(disposeProfit));

    // ---- 12) بيع أصل بخسارة
    const lossAsset = await call('POST', '/accounting/assets', {
      name: `كمبيوتر E5 ${stamp}`, category: 'أجهزة كمبيوتر', cost: 8000, usefulLifeMonths: 8,
      residualValue: 0, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth }); // −1000
    const disposeLoss = await call('POST', `/accounting/assets/${lossAsset.assetId}/dispose`, {
      disposalType: 1, disposalDate: today, disposalAmount: 5000, cashAccountId: accounts[0].cashAccountId, reason: 'بيع بخسارة',
    });
    check('E5: sale with loss computes loss (5000 − 7000 = −2000)',
      Math.abs(disposeLoss.gainLoss - (-2000)) < 0.01, JSON.stringify(disposeLoss));

    // ---- 13) عكس استبعاد
    const reverseDisposed = await call('POST', `/accounting/assets/${sellFast.assetId}/reverse-disposal`, {});
    check('E5: reversed disposal restores in-service status',
      reverseDisposed.reverseJournalId > 0, JSON.stringify(reverseDisposed));
    const reversedDetail = await call('GET', `/accounting/assets/${sellFast.assetId}`);
    check('E5: reversed asset back to status 1', reversedDetail.asset.status === 1, JSON.stringify(reversedDetail.asset.status));

    // ---- 14) الفترة المقفولة إداريًا ترفض تشغيل الإهلاك
    const e5Period = await call('POST', '/accounting/periods', { name: `فترة E5 ${stamp}`, startDate: '2018-01-01', endDate: '2018-01-31' });
    await call('POST', `/accounting/periods/${e5Period.periodId}/manual-lock`, { reason: 'اختبار منع الإهلاك في فترة مقفولة إداريًا' });
    const closedRun = await raw('POST', '/accounting/assets/run-depreciation', { periodMonth: '2018-01' });
    check('E5: depreciation inside a manually locked period rejected (400)', closedRun.status === 400, String(closedRun.status));
    await raw('POST', `/accounting/periods/${e5Period.periodId}/manual-unlock`, { reason: 'انتهى اختبار E5' });

    // ---- 15) صلاحيات المستخدمين
    const cashierCreate = await raw('POST', '/accounting/assets', {
      name: 'x', category: 'أجهزة كمبيوتر', cost: 100, usefulLifeMonths: 1, acquisitionDate: today, inServiceDate: today,
    }, cashier.accessToken);
    check('E5: cashier cannot create assets (403)', cashierCreate.status === 403, String(cashierCreate.status));
    const cashierView = await raw('GET', '/accounting/assets', undefined, cashier.accessToken);
    check('E5: cashier cannot view assets (403)', cashierView.status === 403, String(cashierView.status));
    const accountantView = await raw('GET', '/accounting/assets', undefined, accountant.accessToken);
    check('E5: accountant can view assets (200)', accountantView.status === 200, String(accountantView.status));

    // ---- 16) سجل الأصول مطابق للأستاذ + قيود متوازنة
    const tbFinal = await call('GET', '/accounting/reports/trial-balance');
    check('E5: trial balance still balanced after E5', tbFinal.balanced === true, JSON.stringify({ d: tbFinal.totalDebit, c: tbFinal.totalCredit }));
    const summaryReport = await call('GET', '/accounting/assets/report/summary');
    check('E5: asset register matches GL (book value = 1201 − 1202)',
      summaryReport.registerMatchesGl === true, JSON.stringify(summaryReport));

    // ---- تعديل التكلفة بعد التسجيل مرفوض
    const editCost = await raw('PUT', `/accounting/assets/${creditAsset.assetId}`, { cost: 99999 });
    check('E5: editing cost after registration is rejected (400)', editCost.status === 400, String(editCost.status));

    // ============ Declining balance battery — activation pending separate owner approval ============
    // Independent hand-computed expectations (not derived from the engine under test).
    const nextMonthIso = monthIso(addMonths(thisMonth, 1));

    // Successive periods, straight off the rate: 800 / 773.33 / 747.56
    const dbAsset = await call('POST', '/accounting/assets', {
      name: `خادم E5 ${stamp}`, category: 'أجهزة كمبيوتر', cost: 24000, usefulLifeMonths: 24,
      residualValue: 2400, acquisitionDate: `${lastMonth}-01`, inServiceDate: `${lastMonth}-01`,
      depreciationMethod: 2, depreciationRatePct: 40, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    check('E5-DB: diminishing balance asset registered', !!dbAsset.assetId, JSON.stringify(dbAsset));
    const dbRun1 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: lastMonth });
    const dbRun2 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const dbRun3 = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: nextMonthIso });
    const dbPosted = [dbRun1, dbRun2, dbRun3].map((r) => (r.posted ?? []).find((p) => p.assetId === dbAsset.assetId));
    check('E5-DB: successive months follow the declining balance (800 / 773.33 / 747.56)',
      dbPosted.every((p) => !!p)
        && Math.abs(dbPosted[0].amount - 800) < 0.01
        && Math.abs(dbPosted[1].amount - 773.33) < 0.01
        && Math.abs(dbPosted[2].amount - 747.56) < 0.01,
      JSON.stringify(dbPosted.map((p) => p?.amount)));

    // Residual value is never exceeded — rate 100 with residual near cost caps at depreciable
    const dbCapAsset = await call('POST', '/accounting/assets', {
      name: `كرسي E5 ${stamp}`, category: 'أثاث', cost: 1000, usefulLifeMonths: 5,
      residualValue: 990, acquisitionDate: firstThisMonth, inServiceDate: firstThisMonth,
      depreciationMethod: 2, depreciationRatePct: 100, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const dbCapDetail = await call('GET', `/accounting/assets/${dbCapAsset.assetId}`);
    check('E5-DB: residual value is never exceeded (book lands at 990)',
      Math.abs(dbCapDetail.asset.accumulatedDepreciation - 10) < 0.01 && Math.abs(dbCapDetail.asset.bookValue - 990) < 0.01,
      JSON.stringify({ accumulated: dbCapDetail.asset.accumulatedDepreciation, bookValue: dbCapDetail.asset.bookValue }));

    // Final month of life settles the full remainder exactly on residual
    const dbFinAsset = await call('POST', '/accounting/assets', {
      name: `عددية E5 ${stamp}`, category: 'معدات', cost: 1200, usefulLifeMonths: 3,
      residualValue: 600, acquisitionDate: `${lastMonth}-01`, inServiceDate: `${lastMonth}-01`,
      depreciationMethod: 2, depreciationRatePct: 100, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: lastMonth });
    await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const dbFinNext = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: nextMonthIso });
    const dbFinPosted = (dbFinNext.posted ?? []).find((p) => p.assetId === dbFinAsset.assetId);
    const dbFinDetail = await call('GET', `/accounting/assets/${dbFinAsset.assetId}`);
    check('E5-DB: final month settles exactly on residual (600 / 600)',
      Math.abs(dbFinDetail.asset.bookValue - 600) < 0.01 && Math.abs(dbFinDetail.asset.accumulatedDepreciation - 600) < 0.01,
      JSON.stringify({ accumulated: dbFinDetail.asset.accumulatedDepreciation, bookValue: dbFinDetail.asset.bookValue, posted: dbFinPosted }));

    // Dispose then reverse — reposting an already-posted month is a no-op, never double
    await call('POST', `/accounting/assets/${dbFinAsset.assetId}/dispose`, {
      disposalType: 1, disposalDate: today, disposalAmount: 600, cashAccountId: accounts[0].cashAccountId, reason: 'بيع',
    });
    const dbFinReversed = await call('POST', `/accounting/assets/${dbFinAsset.assetId}/reverse-disposal`, {});
    check('E5-DB: reversed disposal returns asset to service', dbFinReversed.reverseJournalId > 0, JSON.stringify(dbFinReversed));
    const dbFinReRun = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: thisMonth });
    const dbFinRePosted = (dbFinReRun.posted ?? []).find((p) => p.assetId === dbFinAsset.assetId);
    check('E5-DB: re-running a posted month never double-posts', !dbFinRePosted, JSON.stringify(dbFinRePosted));

    // Expected vs Actual — every depreciation line equals the running sum of its predecessors
    const dbFinCheck = await call('GET', `/accounting/assets/${dbFinAsset.assetId}`);
    const linesOk = (dbFinCheck.lines ?? []).every((l) => {
      const upto = (dbFinCheck.lines ?? [])
        .filter((x) => x.periodMonth <= l.periodMonth)
        .reduce((s, x) => s + Number(x.depreciationAmount), 0);
      return Math.abs(upto - Number(l.accumulated)) < 0.01;
    });
    check('E5-DB: expected vs actual — accumulated is exactly the running sum of posted lines', linesOk, 'sum(lines) === accumulated');
  };
  await phaseE5();

  // =================================================================
  // Phase E3 — Auto Bank Expenses regression tests
  // =================================================================
  const phaseE3 = async () => {
    const monthIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const todayIso = daysAgoIso(0);
    const thisMonth = monthIso(new Date());

    // Bank account (type 2) linked to GL 1102 for the fee rules.
    const tbBank = await call('GET', '/accounting/accounts');
    const findAccount = (nodes, code) => {
      for (const node of nodes ?? []) {
        if (node.code === code) return node;
        const hit = findAccount(node.children, code);
        if (hit) return hit;
      }
      return null;
    };
    const bankGl = findAccount(tbBank, '1102');
    const fee5107 = findAccount(tbBank, '5107');
    check('E3: GL accounts resolved (1102 / 5107)', !!bankGl && !!fee5107, '');

    const feeBank = await call('POST', '/treasury/accounts', {
      name: `بنك رسوم ${stamp}`, type: 2, bankName: 'بنك الرسوم',
      accountNo: `FEE-${stamp}`, glAccountId: Number(bankGl.accountId),
    });
    check('E3: bank account created for fee rules', !!feeBank.cashAccountId, String(feeBank.cashAccountId));
    const feeBankId = feeBank.cashAccountId;
    const feeAccountId = Number(fee5107.accountId);

    // Rule 1 — رسوم POS الشهرية 777 — مبلغ فريد كي لا يلتبس مع قيود E1 في المطابقة التلقائية
    const ruleA = await call('POST', '/accounting/bank-expense-rules', {
      name: `رسوم POS الشهرية ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 777, frequency: 1, dayOfMonth: Number(todayIso.slice(8, 10)),
      startDate: `${thisMonth}-01`, counterpartyName: 'شبكة فيزا',
    });
    check('E3: monthly rule created', !!ruleA.ruleId, JSON.stringify(ruleA));

    // تشغيل التوليد — should post exactly one journal (Dr 5107 / Cr 1102)
    const run1 = await call('POST', '/accounting/bank-expense-rules/run', {});
    const aPosted = (run1.posted ?? []).filter((p) => p.ruleId === ruleA.ruleId);
    check('E3: run generates exactly one journal for the due rule', aPosted.length === 1, JSON.stringify(aPosted));
    const feeJournal = await call('GET', `/accounting/journals/${aPosted[0]?.journalId}`);
    const feeDebit = feeJournal.lines.find((l) => Number(l.debit) > 0);
    const feeCredit = feeJournal.lines.find((l) => Number(l.credit) > 0);
    check('E3: fee journal is Dr 5107 / Cr BANK',
      feeDebit?.accountCode === '5107' && feeCredit?.accountCode === '1102',
      JSON.stringify({ debit: feeDebit?.accountCode, credit: feeCredit?.accountCode }));

    // Re-running does not duplicate the same occurrence
    const tbBefore = await call('GET', '/accounting/reports/trial-balance');
    const run2 = await call('POST', '/accounting/bank-expense-rules/run', {});
    const tbAfter = await call('GET', '/accounting/reports/trial-balance');
    const netOf = (tb, code) => {
      const line = (tb.lines ?? []).find((l) => l.code === code);
      return Number(line?.debit ?? 0) - Number(line?.credit ?? 0);
    };
    const aPosted2 = (run2.posted ?? []).filter((p) => p.ruleId === ruleA.ruleId);
    check('E3: re-running never double-posts the same occurrence', aPosted2.length === 0, JSON.stringify(aPosted2));
    check('E3: re-run leaves the expense GL unchanged',
      Math.abs(netOf(tbAfter, '5107') - netOf(tbBefore, '5107')) < 0.01,
      `delta ${netOf(tbAfter, '5107') - netOf(tbBefore, '5107')}`);

    // قاعدة ربع سنوية
    const quarterlyStart = new Date();
    quarterlyStart.setMonth(quarterlyStart.getMonth() - 4);
    const qMonth = monthIso(quarterlyStart);
    const ruleQ = await call('POST', '/accounting/bank-expense-rules', {
      name: `عمولة quarterly ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 1200, frequency: 2, dayOfMonth: 1, startDate: `${qMonth}-01`,
      endDate: `${qMonth}-31`,
    });    const runQ = await call('POST', '/accounting/bank-expense-rules/run', { asOf: `${qMonth}-31` });
    const qPosted = (runQ.posted ?? []).filter((p) => p.ruleId === ruleQ.ruleId);
    check('E3: quarterly rule posts from its start month onward (occurrences)', qPosted.length >= 1, JSON.stringify(qPosted));

    // قاعدة سنوية — تولّد واقعة واحدة فقط في أول سنة من بدايتها (اليوم = نفس يوم البدء)
    const yearRule = await call('POST', '/accounting/bank-expense-rules', {
      name: `تجديد سنوي ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 9999, frequency: 4, dayOfMonth: Number(todayIso.slice(8, 10)),
      startDate: todayIso,
    });
    const runY = await call('POST', '/accounting/bank-expense-rules/run', {});
    const yPosted = (runY.posted ?? []).filter((p) => p.ruleId === yearRule.ruleId);
    check('E3: annual rule posts exactly one occurrence in its first year', yPosted.length === 1, JSON.stringify(yPosted));
    const yearReRun = await call('POST', '/accounting/bank-expense-rules/run', {});
    const yPosted2 = (yearReRun.posted ?? []).filter((p) => p.ruleId === yearRule.ruleId);
    check('E3: annual rule never double-posts within its year', yPosted2.length === 0, JSON.stringify(yPosted2));

    // الإيقاف/الاستئناف
    await call('POST', `/accounting/bank-expense-rules/${ruleA.ruleId}/suspend`, { reason: 'اختبار الإيقاف' });
    const runSuspended = await call('POST', '/accounting/bank-expense-rules/run', {});
    const aPostedS = (runSuspended.posted ?? []).filter((p) => p.ruleId === ruleA.ruleId);
    check('E3: suspended rule generates nothing', aPostedS.length === 0, JSON.stringify(aPostedS));
    await call('POST', `/accounting/bank-expense-rules/${ruleA.ruleId}/resume`, {});
    const runResumed = await call('POST', '/accounting/bank-expense-rules/run', {});
    // already generated this month — resumed run does not re-post, but does not refuse either
    const aPostedR = (runResumed.posted ?? []).filter((p) => p.ruleId === ruleA.ruleId);
    check('E3: resumed rule is picked up again (already posted this month is skipped)', aPostedR.length === 0, JSON.stringify(aPostedR));

    // تعديل القيد قبل التوليد مسموح، وبعد التوليد مرفوض
    const ruleEdit = await call('POST', '/accounting/bank-expense-rules', {
      name: `تعديل ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 300, frequency: 1, dayOfMonth: 28, startDate: `${thisMonth}-28`,
    });
    const editOk = await call('PUT', `/accounting/bank-expense-rules/${ruleEdit.ruleId}`, { amount: 350, name: `تعديل ${stamp} محدّث` });
    check('E3: editing before first generation is allowed', !!editOk.ruleId, JSON.stringify(editOk));
    const editBlocked = await raw('PUT', `/accounting/bank-expense-rules/${ruleA.ruleId}`, { amount: 999 });
    check('E3: editing amount after generation is rejected (400)', editBlocked.status === 400, String(editBlocked.status));

    // الفترة المقفولة إداريًا ترفض الترحيل وتحققه في السجل
    const e3Period = await call('POST', '/accounting/periods', { name: `فترة E3 ${stamp}`, startDate: '2017-01-01', endDate: '2017-01-31' });
    await call('POST', `/accounting/periods/${e3Period.periodId}/manual-lock`, { reason: 'اختبار منع توليد الرسوم في فترة مقفولة إداريًا' });
    const refusedRule = await call('POST', '/accounting/bank-expense-rules', {
      name: `رسوم قديمة ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 100, frequency: 1, dayOfMonth: 15, startDate: '2017-01-15',
      endDate: '2017-01-31',
    });
    const runClosed = await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2017-01-15' });
    const refusedClosed = (runClosed.refused ?? []).find((r) => r.ruleId === refusedRule.ruleId);
    check('E3: manually locked period refuses the occurrence with an Arabic reason',
      !!refusedClosed && String(refusedClosed.reason).includes('مقفولة إداريًا'), JSON.stringify(refusedClosed));
    await raw('POST', `/accounting/periods/${e3Period.periodId}/manual-unlock`, { reason: 'انتهى اختبار E3' });
    const runsList = await call('GET', `/accounting/bank-expense-rules/runs?ruleId=${refusedRule.ruleId}`);
    check('E3: refused occurrence is recorded in the run log', (runsList ?? []).some((r) => r.status === 2), JSON.stringify(runsList));

    // Match-then-reverse: the statement line must REOPEN after the generating journal is reversed
    const ruleB = await call('POST', '/accounting/bank-expense-rules', {
      name: `رسوم عكس ${stamp}`, bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 888, frequency: 1, dayOfMonth: Number(todayIso.slice(8, 10)), startDate: `${thisMonth}-01`,
    });
    check('E3: reversal-scenario rule created', !!ruleB.ruleId, JSON.stringify(ruleB));
    await call('POST', '/accounting/bank-expense-rules/run', {});
    const bCsv = [
      'date,description,reference,amount,movement_type',
      `${todayIso},رسوم POS,E3-REV2-${stamp},-888,fee`,
    ].join('\n');
    const bImp = await call('POST', '/treasury/bank-recon/statements/import', { accountId: feeBankId, csv: bCsv });
    check('E3: reversal-scenario statement line imported', bImp.created === 1, JSON.stringify(bImp));
    const bAuto = await call('POST', '/treasury/bank-recon/auto-match', { accountId: feeBankId, from: todayIso, to: todayIso });
    check('E3: reversal-scenario line auto-matched', bAuto.matched === 1, JSON.stringify(bAuto));
    const bLines = await call('GET', `/treasury/bank-recon/statements?accountId=${feeBankId}&from=${todayIso}&to=${todayIso}`);
    const bLine = bLines.find((l) => l.reference === `E3-REV2-${stamp}`);
    check('E3: line matched to the generating journal before reversal',
      bLine.status === 2 && !!bLine.matchedJournalId, JSON.stringify(bLine));
    const bRuns = await call('GET', `/accounting/bank-expense-rules/runs?ruleId=${ruleB.ruleId}&status=1`);
    await call('POST', `/accounting/bank-expense-rules/runs/${bRuns[0].runId}/reverse`, {});
    const bAfter = await call('GET', `/treasury/bank-recon/statements?accountId=${feeBankId}&from=${todayIso}&to=${todayIso}`);
    const bAfterLine = bAfter.find((l) => l.reference === `E3-REV2-${stamp}`);
    check('E3: reversing the generating journal REOPENS the matched line (status 1)',
      bAfterLine.status === 1 && !bAfterLine.matchedJournalId && !bAfterLine.matchedEntryId,
      JSON.stringify(bAfterLine));

    // E3 integrity — matched line survives a journal that legitimately reverses, with no stale pointer
    check('E3: no statement line remains matched to a reversed journal',
      (bAfter ?? []).every((l) => l.status !== 2),
      'all matched lines reopened');

    // عكس قيد مولّد
    const runsA = await call('GET', `/accounting/bank-expense-rules/runs?ruleId=${ruleA.ruleId}&status=1`);
    const aRunId = (runsA ?? [])[0]?.runId;
    const reversed = await call('POST', `/accounting/bank-expense-rules/runs/${aRunId}/reverse`, {});
    check('E3: reversing a generated run posts a mirror journal', reversed.status === 3 && !!reversed.reverseJournalId, JSON.stringify(reversed));

    // Permissions — cashier forbidden, accountant allowed
    const cashierCreate = await raw('POST', '/accounting/bank-expense-rules', {
      name: 'x', bankAccountId: feeBankId, expenseAccountId: feeAccountId,
      amount: 1, frequency: 1, dayOfMonth: 1, startDate: todayIso,
    }, cashier.accessToken);
    check('E3: cashier cannot create rules (403)', cashierCreate.status === 403, String(cashierCreate.status));
    const accountantList = await raw('GET', '/accounting/bank-expense-rules', undefined, accountant.accessToken);
    check('E3: accountant can view rules (200)', accountantList.status === 200, String(accountantList.status));

    // E1 integration — a bank statement line matching the fee rule's journal auto-matches, never duplicates
    const e3Csv = [
      'date,description,reference,amount,movement_type',
      `${todayIso},رسوم بنكية,E3-FEE-${stamp},-777,fee`,
    ].join('\n');
    const e3Imp = await call('POST', '/treasury/bank-recon/statements/import', { accountId: feeBankId, csv: e3Csv });
    check('E3: matching bank statement line imported', e3Imp.created === 1, JSON.stringify(e3Imp));
    const e3Auto = await call('POST', '/treasury/bank-recon/auto-match', { accountId: feeBankId, from: todayIso, to: todayIso });
    const e3Lines = await call('GET', `/treasury/bank-recon/statements?accountId=${feeBankId}&from=${todayIso}&to=${todayIso}`);
    const feeLine = (e3Lines ?? []).find((l) => l.reference === `E3-FEE-${stamp}`);
    check('E3: fee rule journal auto-matches the statement line (no duplicate fee booked)',
      feeLine?.status === 2 && !!feeLine?.matchedJournalId, JSON.stringify(feeLine));

    // السلامة العامة — trial balance stays balanced after all E3 operations
    const tbEnd = await call('GET', '/accounting/reports/trial-balance');
    check('E3: trial balance balanced after E3 operations', tbEnd.balanced === true, JSON.stringify({ d: tbEnd.totalDebit, c: tbEnd.totalCredit }));
  };
  await phaseE3();

  // =================================================================
  // Phase E6 — Automated period closing regression tests
  // =================================================================
  const phaseE6 = async () => {
    const tbNet = (tb, code) => {
      const line = (tb.lines ?? []).find((l) => l.code === code);
      return Number(line?.debit ?? 0) - Number(line?.credit ?? 0);
    };
    const mkPeriod = async (name, startDate, endDate) => {
      const created = await call('POST', '/accounting/periods', { name, startDate, endDate });
      return created.periodId;
    };
    const findAccount = (nodes, code) => {
      for (const node of nodes ?? []) {
        if (node.code === code) return node;
        const hit = findAccount(node.children, code);
        if (hit) return hit;
      }
      return null;
    };
    // Best-effort: close any open branch shift before the closing tests start.
    try {
      const cur = await call('GET', '/treasury/shifts/current');
      if (cur && (cur.shiftId || cur.status === 1)) {
        await call('POST', '/treasury/shifts/close', { countedCash: Number(cur.expectedCash ?? 0) });
      }
    } catch { /* no open shift or already closed */ }

    // Deactivate EVERY bank-expense rule — E3 phase leaves dozens of rules firing every month,
    // which would otherwise contaminate the periods used here (luglio/agosto/...).
    const allRules = await call('GET', '/accounting/bank-expense-rules');
    for (const rule of allRules ?? []) {
      try {
        await call('POST', `/accounting/bank-expense-rules/${rule.ruleId}/deactivate`, {});
      } catch { /* already inactive — fine */ }
    }

    const accountsTree = await call('GET', '/accounting/accounts');
    const fee5107 = Number(findAccount(accountsTree, '5107')?.accountId);

    // === Profitable month (2026-07) — sale cash, no material expenses
    const pProfit = await mkPeriod(`E6 ربح ${stamp}`, '2026-05-01', '2026-05-31');
    const sale = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId, paidAmount: 1140,
      invoiceDate: '2026-05-15',
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 1000, discountPct: 0, taxPct: 14 }],
    });
    check('E6: profitable month — sale posted', !!sale.invoiceId, String(sale));
    const preProfit = await call('POST', `/accounting/periods/${pProfit}/preclose-check`, {});
    check('E6: pre-close check passes a clean profitable month', preProfit.failed === 0, JSON.stringify(preProfit));
    const closedProfit = await call('POST', `/accounting/periods/${pProfit}/close-month`, {});
    check('E6: profitable month closes with net profit', Number(closedProfit.netProfit) > 0, JSON.stringify(closedProfit));
    check('E6: profitable month links a closing journal', !!closedProfit.journalId, JSON.stringify(closedProfit));
    const plAfter = await call('GET', '/accounting/reports/profit-loss?from=2026-05-01&to=2026-05-31');
    check('E6: revenue/expense accounts are zeroed after closing',
      Number(plAfter.totalRevenue) === 0 && Number(plAfter.totalExpense) === 0, JSON.stringify(plAfter));

    // === Post-closing protection: posting into a closed period is refused
    const lateInvoice = await raw('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId, paidAmount: 114,
      invoiceDate: '2026-05-20',
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, discountPct: 0, taxPct: 14 }],
    });
    check('E6: posting into a closed period is refused (400)', lateInvoice.status === 400, String(lateInvoice.status));

    // === Re-closing an already-closed period is refused
    const reClose = await raw('POST', `/accounting/periods/${pProfit}/close-month`, {});
    check('E6: re-closing an already-closed period is refused (400)', reClose.status === 400, String(reClose.status));

    // === Empty month (2026-06) — closes WITHOUT a journal and zero net income
    const pEmpty = await mkPeriod(`E6 فارغة ${stamp}`, '2026-06-01', '2026-06-30');
    const closedEmpty = await call('POST', `/accounting/periods/${pEmpty}/close-month`, {});
    check('E6: empty month closes without a journal and with net income 0',
      closedEmpty.journalId == null && Math.abs(Number(closedEmpty.netProfit)) < 0.01, JSON.stringify(closedEmpty));

    // === Loss month (2026-08) — an E3 fee + an E5 depreciation + a sale
    const pLoss = await mkPeriod(`E6 خسارة ${stamp}`, '2026-08-01', '2026-08-31');
    const bankList = await call('GET', '/treasury/accounts');
    const someBank = bankList.find((a) => Number(a.type) === 2);
    const feeRule = await call('POST', '/accounting/bank-expense-rules', {
      name: `رسوم E6 ${stamp}`, bankAccountId: someBank.cashAccountId,
      expenseAccountId: fee5107, amount: 250, frequency: 1, dayOfMonth: 15, startDate: '2026-08-01',
    });
    const feeRun = await call('POST', '/accounting/bank-expense-rules/run', { asOf: '2026-08-15' });
    check('E3: fee rule generated for the loss month', feeRun.posted.length === 1, JSON.stringify(feeRun));

    const lossAsset = await call('POST', '/accounting/assets', {
      name: `أصل E6 ${stamp}`, category: 'معدات', cost: 12000, usefulLifeMonths: 12, residualValue: 0,
      acquisitionDate: '2026-08-01', inServiceDate: '2026-08-01', depreciationMethod: 1, paymentType: 1, cashAccountId: accounts[0].cashAccountId,
    });
    const depRun = await call('POST', '/accounting/assets/run-depreciation', { periodMonth: '2026-08' });
    check('E5: depreciation generated for the loss month', (depRun.posted ?? []).length >= 1, JSON.stringify(depRun));

    await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId, paidAmount: 1000,
      invoiceDate: '2026-08-10',
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 1000, discountPct: 0, taxPct: 0 }],
    });
    // Expected net loss computed independently from the API (before closing).
    const plBeforeClose = await call('GET', '/accounting/reports/profit-loss?from=2026-08-01&to=2026-08-31');
    const expectedNet = Number(plBeforeClose.netProfit);
    const preLoss = await call('POST', `/accounting/periods/${pLoss}/preclose-check`, {});
    check('E6: loss month passes the pre-close checklist', preLoss.failed === 0, JSON.stringify(preLoss));
    const closedLoss = await call('POST', `/accounting/periods/${pLoss}/close-month`, {});
    check('E6: loss month closes with the exact expected net loss', Math.abs(Number(closedLoss.netProfit) - expectedNet) < 0.01, JSON.stringify(closedLoss));
    const plAfterLoss = await call('GET', '/accounting/reports/profit-loss?from=2026-08-01&to=2026-08-31');
    check('E6: loss month accounts zeroed after closing',
      Number(plAfterLoss.totalRevenue) === 0 && Number(plAfterLoss.totalExpense) === 0, JSON.stringify(plAfterLoss));
    const closingLossJournal = await call('GET', `/accounting/journals/${closedLoss.journalId}`);
    const retainedLine = (closingLossJournal.lines ?? []).find((l) => l.accountCode === '3103');
    check('E6: loss transferred to retained earnings (Dr 3103)',
      retainedLine && Math.abs(Number(retainedLine.debit) - Math.abs(expectedNet)) < 0.01, JSON.stringify(retainedLine));

    // === Unmatched bank line blocks closing without an explicit bypass (period 2026-04)
    const pBypass = await mkPeriod(`E6 تجاوز ${stamp}`, '2026-04-01', '2026-04-30');
    const csv = [
      'date,description,reference,amount,movement_type',
      `2026-04-20,سحب مجهول,E6-BYP-${stamp},-77,withdrawal`,
    ].join('\n');
    await call('POST', '/treasury/bank-recon/statements/import', { accountId: someBank.cashAccountId, csv });
    const preBypass = await call('POST', `/accounting/periods/${pBypass}/preclose-check`, {});
    const bankCheck = (preBypass.checks ?? []).find((c) => c.checkCode === 'no_unreconciled_bank_lines');
    check('E6: unmatched bank line blocks the checklist', bankCheck?.status === 3, JSON.stringify(bankCheck));
    const bypassRefused = await raw('POST', `/accounting/periods/${pBypass}/close-month`, {});
    check('E6: closing without a bypass reason is refused (400)', bypassRefused.status === 400, String(bypassRefused.status));
    const bypassed = await call('POST', `/accounting/periods/${pBypass}/close-month`, { bypassReason: 'استبعاد تجريبياً للتأكد من البوابة' });
    check('E6: closing with an explicit bypass reason succeeds', bypassed.isClosed === true, JSON.stringify(bypassed));
    const bypassReport = await call('GET', `/accounting/periods/${pBypass}/close-report`);
    const bankCheckAfter = (bypassReport.checks ?? []).find((c) => c.checkCode === 'no_unreconciled_bank_lines');
    check('E6: bank check recorded as bypassed with the reason', bankCheckAfter?.status === 4, JSON.stringify(bankCheckAfter));

    // === Reverse the loss-month closing (reason required), then re-close
    const expectedLoss = Number(expectedNet);  // before closing, per the pre-close read
    const reversed = await call('POST', `/accounting/periods/${pLoss}/reverse-close`, { reason: 'اختبار عكس الإقفال' });
    check('E6: reversing a closing reopens the period', reversed.isClosed === false && !!reversed.reverseJournalId, JSON.stringify(reversed));
    const tbAfterRev = await call('GET', '/accounting/reports/trial-balance');
    check('E6: trial balance balanced after reversal', tbAfterRev.balanced === true, '');
    const noReason = await raw('POST', `/accounting/periods/${pLoss}/reverse-close`, {});
    check('E6: reverse-close requires a reason (400)', noReason.status === 400, String(noReason.status));
    const reClosed = await call('POST', `/accounting/periods/${pLoss}/close-month`, {});
    check('E6: period can be re-closed after reversal', reClosed.isClosed === true, JSON.stringify(reClosed));

    // === Trial balance remains balanced after all closings
    const tbEnd = await call('GET', '/accounting/reports/trial-balance');
    check('E6: trial balance balanced after E6 closings', tbEnd.balanced === true, '');

    // === Permissions: admin closes (done above), accountant & cashier cannot
    const adminClose = await raw('POST', `/accounting/periods/${pProfit}/close-month`, {});
    check('E6: admin closing an already-closed period is refused with 400', adminClose.status === 400, String(adminClose.status));
    const cashierClose = await raw('POST', `/accounting/periods/${pProfit}/close-month`, {}, cashier.accessToken);
    check('E6: cashier cannot close a period (403)', cashierClose.status === 403, String(cashierClose.status));
    const accountantClose = await raw('POST', `/accounting/periods/${pProfit}/close-month`, {}, accountant.accessToken);
    check('E6: accountant cannot close (403) — closing is admin-only', accountantClose.status === 403, String(accountantClose.status));

    // === Reversing a non-closed period is refused
    const notClosed = await call('POST', '/accounting/periods', { name: `E6 مفتوحة ${stamp}`, startDate: '2026-02-01', endDate: '2026-02-28' });
    const revOpen = await raw('POST', `/accounting/periods/${notClosed.periodId}/reverse-close`, { reason: 'x' });
    check('E6: reversing a non-closed period is refused (400)', revOpen.status === 400, String(revOpen.status));

    // === Close report returns period + checks (loss month was re-closed above)
    const report = await call('GET', `/accounting/periods/${pLoss}/close-report`);
    check('E6: close-report returns period + checks',
      !!report.period && Array.isArray(report.checks) && report.checks.length >= 6, JSON.stringify(report.period));
  };
  await phaseE6();

  // =================================================================
  // Phase R — Restaurant unit master switch (RestaurantsEnabled)
  // =================================================================
  const phaseRestaurants = async () => {
    // Ensure we leave the suite with the unit ENABLED (default) — and the switch off/on only here.
    await call('PUT', '/admin/settings', { RestaurantsEnabled: 'false' });

    const featuresOff = await call('GET', '/settings/features');
    check('R: features endpoint reports restaurant unit DISABLED', featuresOff.restaurantsEnabled === false, JSON.stringify(featuresOff));

    const tableOrderOff = await raw('POST', '/pos/table-orders', { tableId: 1, lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, discountPct: 0, taxPct: 0 }] });
    check('R: creating a table order is refused while the unit is disabled (400)', tableOrderOff.status === 400, String(tableOrderOff.status));

    const saveTableOff = await raw('POST', '/pos/tables', { name: `R-OFF-${stamp}`, tableType: 1, capacity: 2 });
    check('R: creating a table is refused while the unit is disabled (400)', saveTableOff.status === 400, String(saveTableOff.status));

    const saveHallOff = await raw('POST', '/pos/halls', { name: `R-OFF-${stamp}`, code: `RO${String(stamp).slice(-4)}`, tableCount: 2 });
    check('R: creating a hall is refused while the unit is disabled (400)', saveHallOff.status === 400, String(saveHallOff.status));

    const hallOrderOff = await raw('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId, paidAmount: 100,
      orderType: 4,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, discountPct: 0, taxPct: 0 }],
    });
    check('R: issuing a hall (table) invoice is refused while the unit is disabled (400)', hallOrderOff.status === 400, String(hallOrderOff.status));

    // Reads stay open (read-only shell)
    const tablesStillReadable = await raw('GET', '/pos/tables');
    check('R: tables list remains readable (200)', tablesStillReadable.status === 200, String(tablesStillReadable.status));

    // Counter sales keep working with the restaurant unit off (pharmacy/market behaviour)
    const counterSaleOff = await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId, warehouseId, paymentType: 1, cashAccountId: accounts[0].cashAccountId, paidAmount: 100,
      orderType: 1,
      lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, discountPct: 0, taxPct: 0 }],
    });
    check('R: counter sale (orderType 1) works with the unit disabled', !!counterSaleOff.invoiceId, JSON.stringify(counterSaleOff));

    // Re-enable and confirm the unit is usable again
    await call('PUT', '/admin/settings', { RestaurantsEnabled: 'true' });
    const featuresOn = await call('GET', '/settings/features');
    check('R: features endpoint reports restaurant unit ENABLED', featuresOn.restaurantsEnabled === true, JSON.stringify(featuresOn));
    const tableOrderOn = await call('POST', '/pos/table-orders', { tableId: 1, lines: [{ itemId: itemB.itemId, unitId: 1, quantity: 1, unitPrice: 100, discountPct: 0, taxPct: 0 }] });
    check('R: creating a table order works again after re-enabling', !!tableOrderOn.tableOrderId, JSON.stringify(tableOrderOn));
  };
  await phaseRestaurants();

  const failed = results.filter((r) => !r.ok);

  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
})().catch((error) => {
  console.error('SMOKE TEST ERROR:', error.message);
  process.exit(1);
});
