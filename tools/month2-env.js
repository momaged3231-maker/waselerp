/* Phase 4 — Month 2 Scenario part 1: environment setup (settings, warehouses, items, parties, opening). */
const BASE = 'http://127.0.0.1:4250/api';
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
  try { return JSON.parse(t); } catch { if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0,300)}`); return t; }
}

const daysAgo = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

(async () => {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;
  const stamp = Date.now();

  // Company identity
  await call('PUT', '/admin/settings', { CompanyName: 'شركة مراجعة لحسابات الأشهر — فرع ثانٍ', CompanyPhone: '0223000000', CompanyAddress: 'المعادي، القاهرة', TaxNumber: '111-222-333', InvoiceFooter: 'شكراً لوقتكم' });

  // Sub-warehouse in same branch
  let sub = null;
  try {
    sub = await call('POST', '/catalog/warehouses', { branchId, code: `WH-SUB-${stamp}`, name: `مخزن المعرض ${stamp}`, isDefault: false, isActive: true });
  } catch (e) {
    const list = await call('GET', '/catalog/warehouses');
    sub = list.find((w) => String(w.code).startsWith('WH-SUB'));
  }
  console.log('sub:', sub?.warehouseId ?? sub?.id);

  const PCS = (await call('GET', '/catalog/units')).find((u) => u.code === 'PCS').unitId;

  // Categories (quick: one per item group)
  const catOf = async (name) => {
    const list = await call('GET', '/catalog/categories');
    const found = list.find((c) => c.name === name);
    if (found) return found.categoryId;
    return (await call('POST', '/catalog/categories', { name })).categoryId;
  };
  const catComputer = await catOf('أجهزة كمبيوتر');
  const catMonitors = await catOf('شاشات');
  const catPrinters = await catOf('طابعات وحبر');
  const catAccessories = await catOf('اكسسوارات');
  const catPhones = await catOf('هواتف');
  const catCables = await catOf('كابلات');

  const items = [
    ['M2-LAP-I7','لابتوب Dell i7', catComputer, 12000, 15000, 14, 10],
    ['M2-MON-27','شاشة Dell 27 بوصة', catMonitors, 3500, 4200, 14, 10],
    ['M2-PRN-HP','طابعة HP Laser', catPrinters, 4000, 6000, 14, 8],
    ['M2-KB-LOG','كيبورد لاسلكي', catAccessories, 400, 700, 0, 20],
    ['M2-MOU-LOG','ماوس لاسلكي', catAccessories, 200, 400, 0, 15],
    ['M2-LAP-I9','لابتوب Dell i9', catComputer, 14000, 16500, 14, 0],
    ['M2-TONER-85A','تونر 85A', catPrinters, 500, 900, 0, 0],
    ['M2-IPHONE','iPhone 15', catPhones, 35000, 42000, 14, 0],
    ['M2-CBL-VGA','كابل VGA', catCables, 40, 70, 0, 30],
  ];
  const createdItems = [];
  for (const [code, name, c, cost, sell, vat, opening] of items) {
    const saved = await call('POST', '/items', { code, name, categoryId: c, baseUnitId: PCS, costPrice: cost, sellPrice: sell, vatPct: vat, reorderPoint: 5, isActive: true });
    createdItems.push({ itemId: saved.itemId, code, name, cost, sell, vat, opening });
  }
  console.log('items created:', createdItems.map((i) => i.itemId).join(','));

  // Parties
  const party = async (name, type, phone, address, creditLimit) => {
    const created = await call('POST', '/parties', { name, partyType: type, phone, address, creditLimit, isActive: true });
    return created.partyId;
  };
  const custNil = await party('شركة النيل للأنظمة', 1, '0122220002', 'المعادي، شارع 9', 600000);
  const custZone = await party('محل Laptop Zone', 1, '0122220003', 'المعادي', 150000);
  const supSpeed = await party('شركة سبيد تك للتوزيع', 2, '0122220001', 'التجمع الخامس', 600000);
  const supMobile = await party('شركة موبايلى للتوزيع', 2, '0122220004', 'التجمع الخامس', 800000);
  console.log('parties:', { custNil, custZone, supSpeed, supMobile });

  // Open shift
  await call('POST', '/treasury/shifts/open', { openingBalance: 0 });
  console.log('shift opened');

  // Opening stock voucher
  const whMain = (await call('GET', '/catalog/warehouses'))[0];
  const opening = await call('POST', '/stock-vouchers', { warehouseId: whMain.warehouseId, voucherType: 4, voucherDate: daysAgo(29), notes: 'رصيد افتتاحي شهر أكتوبر — شركة مراجعة' });
  for (const it of createdItems) {
    if (it.opening > 0) {
      await call('POST', `/stock-vouchers/${opening.stockVoucherId}/lines`, { itemId: it.itemId, unitId: PCS, quantity: it.opening, unitCost: it.cost, notes: 'افتتاحي' });
    }
  }
  await call('POST', `/stock-vouchers/${opening.stockVoucherId}/approve`, {});
  console.log('opening stock approved, value:', createdItems.reduce((s, i) => s + i.opening * i.cost, 0));

  // Resolve GL account ids by CODE — never hardcode (seed order can shift between releases).
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
  console.log('gl ids resolved by code');

  // Opening journal — Dr 50k cash / 400k bank / 80k AR | Cr 200k AP / 330k capital
  await call('POST', '/accounting/journals', {
    description: 'قيد افتتاحي — شركة مراجعة لحسابات الأشهر', journalDate: daysAgo(29), post: true,
    lines: [
      { accountId: glId('1101'), debit: 50000, description: 'افتتاحي — الخزينة', partyId: null },
      { accountId: glId('1102'), debit: 400000, description: 'افتتاحي — بنك', partyId: null },
      { accountId: glId('1103'), debit: 80000, description: 'افتتاحي — ذمم مدينة', partyId: custNil },
      { accountId: glId('2101'), credit: 200000, description: 'افتتاحي — ذمم دائنة', partyId: supSpeed },
      { accountId: glId('3101'), credit: 330000, description: 'افتتاحي — رأس المال', partyId: null },
    ],
  });
  console.log('opening journal posted');
  process.exit(0);
})().catch((err) => { console.error('FATAL', err); process.exit(1); });
