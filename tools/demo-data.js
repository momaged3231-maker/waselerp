/* Creates a small demo dataset through the API (keeps the stock ledger consistent). */
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

(async () => {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const warehouses = await call('GET', '/catalog/warehouses');
  const warehouseId = warehouses[0].warehouseId;
  const accounts = await call('GET', '/treasury/accounts');
  const cashAccountId = accounts[0].cashAccountId;

  // categories
  const categoryNames = ['ألبان', 'مشروبات', 'متنوعات', 'أدوات نظافة'];
  const existingCategories = await call('GET', '/catalog/categories');
  const categoryIds = [];
  for (const name of categoryNames) {
    const found = existingCategories.find((c) => c.name === name);
    if (found) {
      categoryIds.push(found.categoryId);
    } else {
      const created = await call('POST', '/catalog/categories', { name });
      categoryIds.push(created.categoryId);
    }
  }
  const pickCategory = (index) => categoryIds[index] ?? null;

  const units = await call('GET', '/catalog/units');
  const unitByCode = (code) => units.find((u) => u.code === code)?.unitId ?? units[0].unitId;
  const piece = unitByCode('PCS');
  const pack = unitByCode('PKT');
  const box = unitByCode('BOX');

  const items = [
    { code: 'DRK-WTR-1500', name: 'مياه معدنية 1.5 لتر', categoryId: pickCategory(1), costPrice: 8, sellPrice: 12, vatPct: 0, unitIds: [piece, pack, box], factors: [1, 6, 24], prices: [12, 70, 280] },
    { code: 'DRK-JCE-1L', name: 'عصير برتقال 1 لتر', categoryId: pickCategory(1), costPrice: 18, sellPrice: 28, vatPct: 0, unitIds: [piece, box], factors: [1, 12], prices: [28, 330] },
    { code: 'MLK-FRS-1L', name: 'لبن جهينة 1 لتر', categoryId: pickCategory(0), costPrice: 22, sellPrice: 32, vatPct: 0, unitIds: [piece], factors: [1], prices: [32] },
    { code: 'DET-SOAP-1L', name: 'سائل أطباق 1 لتر', categoryId: pickCategory(3), costPrice: 25, sellPrice: 38, vatPct: 14, unitIds: [piece, box], factors: [1, 6], prices: [38, 225] },
    { code: 'RST-SUG-1KG', name: 'سكر 1 كجم', categoryId: pickCategory(2), costPrice: 28, sellPrice: 40, vatPct: 0, unitIds: [piece, box], factors: [1, 10], prices: [40, 395] },
  ];

  const created = [];
  for (const item of items) {
    const saved = await call('POST', '/items', {
      code: item.code, name: item.name, categoryId: item.categoryId, baseUnitId: item.unitIds[0],
      costPrice: item.costPrice, sellPrice: item.sellPrice, vatPct: item.vatPct,
      reorderPoint: 10, isActive: true,
    });
    await call('POST', `/items/${saved.itemId}/units`, {
      units: item.unitIds.map((unitId, index) => ({
        unitId, factor: item.factors[index], sellPrice: item.prices[index], buyPrice: item.costPrice * item.factors[index],
      })),
    });
    created.push({ ...item, itemId: saved.itemId });
  }

  // customer
  const party = await call('POST', '/parties', {
    name: 'عميل نقدي تجريبي', partyType: 1, phone: '01000000000',
    address: 'الجيزة', creditLimit: 5000, discountPct: 0, isActive: true,
  });

  // opening stock through a purchase invoice (keeps the ledger consistent)
  const purchaseLines = created.map((item, index) => ({
    itemId: item.itemId,
    unitId: item.unitIds[0],
    quantity: 50 + index * 10,
    unitPrice: item.costPrice,
    discountPct: 0,
    taxPct: 0,
  }));
  await call('POST', '/sales/invoices', {
    invoiceType: 2, branchId, warehouseId, partyId: party.partyId, paymentType: 1,
    cashAccountId, paidAmount: purchaseLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    lines: purchaseLines, notes: 'رصيد افتتاحي',
  });

  // a sample sale
  await call('POST', '/sales/invoices', {
    invoiceType: 1, branchId, warehouseId, partyId: party.partyId, paymentType: 3,
    cashAccountId, paidAmount: 100, discountPct: 0,
    lines: [
      { itemId: created[0].itemId, unitId: piece, quantity: 3, unitPrice: 12, taxPct: 0 },
      { itemId: created[2].itemId, unitId: piece, quantity: 2, unitPrice: 32, taxPct: 0 },
    ],
    notes: 'فاتورة تجريبية',
  });

  console.log(`[demo] created ${created.length} items, 1 customer, opening stock and a sample sale`);
  console.log('[demo] items:');
  for (const item of created) console.log(`   - ${item.code} ${item.name} (${item.unitIds.length} وحدة)`);
})().catch((error) => {
  console.error('[demo] failed:', error.message);
  process.exit(1);
});
