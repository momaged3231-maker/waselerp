/*
 * Realistic demo dataset for a Cairo wholesale grocery.
 *
 * Creates a full trading month: categories, items with multi-unit pricing,
 * customers and suppliers, price lists, a coupon, cash accounts, purchases,
 * ~30 sales spread over the last 30 days, a receipt voucher that settles an
 * invoice, a quotation, a sales order and a restaurant table order.
 *
 *   node tools/demo-data.js
 *
 * The dataset is meant to run on a fresh database — run
 * `node tools/pg/run-sql.js wasel db/reset-dev-data.sql` first.
 */
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

/** Deterministic pseudo random so every run produces the same dataset. */
let seed = 20261113;
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const daysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

async function main() {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const existing = await call('GET', '/items?search=DEMO&pageSize=5');
  if ((existing.items ?? []).length) {
    console.log('[demo] يبدو أن بيانات الديمو موجودة بالفعل.');
    console.log('[demo] نفّذ أولًا:  node tools\\pg\\run-sql.js wasel db\\reset-dev-data.sql');
    return;
  }

  const warehouses = await call('GET', '/catalog/warehouses');
  const warehouseId = warehouses[0].warehouseId;

  // ---------------- categories ----------------
  const categoryNames = [
    'مواد غذائية', 'ألبان وأجبان', 'مشروبات', 'خضار وفاكهة', 'لحوم ودواجن',
    'مخبوزات وسناكس', 'منظفات', 'عناية شخصية', 'أدوات منزلية',
  ];
  const categoryIds = {};
  for (const name of categoryNames) {
    const created = await call('POST', '/catalog/categories', { name });
    categoryIds[name] = created.categoryId;
  }

  const units = await call('GET', '/catalog/units');
  const unit = (code) => units.find((u) => u.code === code)?.unitId ?? units[0].unitId;
  const PCS = unit('PCS');
  const PKT = unit('PKT');
  const BOX = unit('BOX');
  const KG = unit('KG');
  const LTR = unit('LTR');

  // ---------------- cash accounts ----------------
  const accounts = await call('GET', '/treasury/accounts');
  const drawer = accounts.find((a) => a.type === 1) ?? accounts[0];

  /** Reuses an existing cash account with the same name (demo must be re-runnable). */
  async function ensureAccount(body) {
    const existing = accounts.find((a) => a.name === body.name);
    if (existing) {
      await call('PUT', `/treasury/accounts/${existing.cashAccountId}`, body);
      return existing;
    }
    const created = await call('POST', '/treasury/accounts', body);
    accounts.push(created);
    return created;
  }

  const bankAccount = await ensureAccount({
    name: 'حساب البنك الأهلي — فرع المعادي', type: 2,
    bankName: 'البنك الأهلي المصري', accountNo: 'EG380190000000000012345678',
    openingBalance: 150000,
  });
  const cardAccount = await ensureAccount({
    name: 'حساب تسوية البطاقات', type: 3,
    bankName: 'البنك التجاري الدولي', accountNo: 'CARD-SETTLE-01', openingBalance: 0,
  });
  const walletAccount = await ensureAccount({
    name: 'محفظة فودافون كاش', type: 4, openingBalance: 5000,
  });

  // ---------------- items ----------------
  const items = [
    // code, name, category, baseUnit, cost, sell, vat, [unit, factor, price]
    ['DEMO-RICE-1KG', 'أرز مصري فاخر 1 كجم', 'مواد غذائية', KG, 28, 38, 0, [[KG, 1, 38]]],
    ['DEMO-MAC-400G', 'مكرونة اسباجتي 400 جم', 'مواد غذائية', PKT, 18, 25, 0, [[PKT, 1, 25], [BOX, 24, 585]]],
    ['DEMO-SUG-1KG', 'سكر أبيض معبأ 1 كجم', 'مواد غذائية', KG, 28, 36, 0, [[KG, 1, 36], [BOX, 10, 350]]],
    ['DEMO-OIL-1L', 'زيوت عافية 1 لتر', 'مواد غذائية', LTR, 85, 110, 0, [[LTR, 1, 110], [BOX, 6, 650]]],
    ['DEMO-LENTIL-1KG', 'عدس أصفر 1 كجم', 'مواد غذائية', KG, 42, 55, 0, [[KG, 1, 55]]],
    ['DEMO-RICE-5KG', 'أرز بسمتي 5 كجم', 'مواد غذائية', PKT, 135, 170, 0, [[PKT, 1, 170]]],
    ['DEMO-TEA-100', 'شاي ليبتون 100 كيس', 'مواد غذائية', PKT, 60, 85, 0, [[PKT, 1, 85], [BOX, 6, 500]]],
    ['DEMO-MILK-1L', 'لبن جهينة كامل الدسم 1 لتر', 'ألبان وأجبان', LTR, 32, 38, 0, [[LTR, 1, 38], [BOX, 12, 445]]],
    ['DEMO-YOG-105', 'زبادي 105 جم', 'ألبان وأجبان', PCS, 8, 12, 0, [[PCS, 1, 12], [BOX, 12, 140]]],
    ['DEMO-CHEESE-500', 'جبنة بيضاء 500 جم', 'ألبان وأجبان', PKT, 65, 85, 0, [[PKT, 1, 85]]],
    ['DEMO-ROMI-1KG', 'جبنة رومي 1 كجم', 'ألبان وأجبان', KG, 110, 140, 0, [[KG, 1, 140]]],
    ['DEMO-BUTTER-1KG', 'سمن نباتي 1 كجم', 'ألبان وأجبان', KG, 130, 160, 0, [[KG, 1, 160]]],
    ['DEMO-WATER-1.5', 'مياه معدنية 1.5 لتر', 'مشروبات', PCS, 8, 12, 0, [[PCS, 1, 12], [BOX, 24, 275]]],
    ['DEMO-COLA-1L', 'كوكاكولا 1 لتر', 'مشروبات', PCS, 22, 28, 0, [[PCS, 1, 28], [BOX, 12, 320]]],
    ['DEMO-JUICE-1L', 'عصير برتقال 1 لتر', 'مشروبات', LTR, 18, 28, 0, [[LTR, 1, 28], [BOX, 12, 325]]],
    ['DEMO-NESCAFE-200', 'نسكافيه 200 جرام', 'مشروبات', PKT, 220, 275, 0, [[PKT, 1, 275]]],
    ['DEMO-TOMATO-1KG', 'طماطم 1 كجم', 'خضار وفاكهة', KG, 12, 18, 0, [[KG, 1, 18]]],
    ['DEMO-POTATO-1KG', 'بطاطس 1 كجم', 'خضار وفاكهة', KG, 10, 15, 0, [[KG, 1, 15], [BOX, 25, 360]]],
    ['DEMO-ONION-1KG', 'بصل 1 كجم', 'خضار وفاكهة', KG, 8, 12, 0, [[KG, 1, 12]]],
    ['DEMO-BANANA-1KG', 'موز 1 كجم', 'خضار وفاكهة', KG, 25, 35, 0, [[KG, 1, 35]]],
    ['DEMO-APPLE-1KG', 'تفاح أحمر 1 كجم', 'خضار وفاكهة', KG, 30, 42, 0, [[KG, 1, 42]]],
    ['DEMO-MIN-BEEF', 'لحم مفروم 1 كجم', 'لحوم و دواجن', KG, 180, 220, 0, [[KG, 1, 220]]],
    ['DEMO-CHICK-BREAST', 'صدور دجاج 1 كجم', 'لحوم و دواجن', KG, 120, 150, 0, [[KG, 1, 150]]],
    ['DEMO-EGG-30', 'بيض بلدي طبق 30 بيضة', 'لحوم و دواجن', BOX, 95, 120, 0, [[BOX, 1, 120]]],
    ['DEMO-BISCUIT', 'بسكويت شوكولاتة عبوة', 'مخبوزات وسناكس', PKT, 85, 110, 0, [[PKT, 1, 110], [BOX, 12, 1280]]],
    ['DEMO-CROISSANT', 'كرواسون شوكولاتة 55 جم', 'مخبوزات وسناكس', PCS, 15, 22, 0, [[PCS, 1, 22], [BOX, 40, 850]]],
    ['DEMO-DETERGENT-2K', 'مسحوق غسيل 2 كجم', 'منظفات', PKT, 95, 125, 14, [[PKT, 1, 125]]],
    ['DEMO-DISH-1L', 'سائل أطباق 1 لتر', 'منظفات', LTR, 25, 38, 14, [[LTR, 1, 38], [BOX, 6, 220]]],
    ['DEMO-FLOOR-1L', 'منظف أرضيات 1 لتر', 'منظفات', LTR, 45, 65, 14, [[LTR, 1, 65]]],
    ['DEMO-SOAP-1L', 'صابون سائل 1 لتر', 'منظفات', LTR, 30, 45, 14, [[LTR, 1, 45]]],
    ['DEMO-SHAMPOO-400', 'شامبو 400 مل', 'عناية شخصية', PCS, 65, 90, 14, [[PCS, 1, 90]]],
    ['DEMO-TOOTHPASTE', 'معجون أسنان 100 مل', 'عناية شخصية', PCS, 35, 50, 14, [[PCS, 1, 50], [BOX, 12, 580]]],
    ['DEMO-TISSUE', 'مناديل ورقية علبة', 'عناية شخصية', PCS, 18, 25, 14, [[PCS, 1, 25]]],
    ['DEMO-POT-TF', 'إناء طهي تيفال 22 سم', 'أدوات منزلية', PCS, 210, 285, 14, [[PCS, 1, 285]]],
    ['DEMO-DISHES-12', 'طقم صحون 12 قطعة', 'أدوات منزلية', BOX, 180, 240, 14, [[BOX, 1, 240]]],
    ['DEMO-KETTLE-2L', 'غلاية 2 لتر', 'أدوات منزلية', PCS, 320, 425, 14, [[PCS, 1, 425]]],
    ['DEMO-BLENDER', 'مفرمة خضار 500 واط', 'أدوات منزلية', PCS, 950, 1250, 14, [[PCS, 1, 1250]]],
    ['DEMO-GLASS-6', 'أكواب زجاجية 6 قطع', 'أدوات منزلية', BOX, 60, 85, 14, [[BOX, 1, 85]]],
    ['DEMO-BAG', 'كيس تسوق كبير', 'مواد غذائية', PCS, 5, 8, 0, [[PCS, 1, 8], [BOX, 100, 700]]],
    ['DEMO-BATTERY-AA', 'بطاريات AA 4 قطع', 'أدوات منزلية', PKT, 35, 50, 14, [[PKT, 1, 50]]],
  ];

  const created = [];
  for (const [code, name, category, baseUnit, cost, sell, vat, unitRows] of items) {
    const saved = await call('POST', '/items', {
      code, name, categoryId: categoryIds[category], baseUnitId: baseUnit,
      costPrice: cost, sellPrice: sell, vatPct: vat, reorderPoint: 20, minPrice: cost,
      isActive: true,
    });
    await call('POST', `/items/${saved.itemId}/units`, {
      units: unitRows.map(([unitId, factor, price], index) => ({
        unitId, factor, sellPrice: price, buyPrice: Math.round(cost * factor * 100) / 100,
        isDefault: index === 0,
      })),
    });
    created.push({ itemId: saved.itemId, code, name, category, baseUnit, cost, sell, vat, unitRows });
  }
  const byCode = (code) => created.find((item) => item.code === code);

  // ---------------- price lists ----------------
  /** Reuses the list when the code already exists so the demo can re-run. */
  async function ensurePriceList(body) {
    const lists = await call('GET', '/pricing/lists');
    const existing = lists.find((list) => list.code === body.code);
    if (existing) {
      await call('PUT', `/pricing/lists/${existing.priceListId}`, body);
      return existing.priceListId;
    }
    const created = await call('POST', '/pricing/lists', body);
    return created.priceListId;
  }

  const retail = await call('GET', '/pricing/lists');
  void retail;
  const wholesaleId = await ensurePriceList({
    name: 'قائمة أسعار الجملة', code: 'WHOLESALE', listType: 2, priority: 30, discountPct: 12,
  });
  await call('POST', `/pricing/lists/${wholesaleId}/lines`, {
    lines: created.map((item) => ({
      itemId: item.itemId,
      unitId: item.baseUnit,
      price: Math.round(item.sell * 0.9 * 100) / 100,
    })),
  });
  const juiceId = await ensurePriceList({
    name: 'قائمة المشروبات', code: 'DRINKS', listType: 3, priority: 20, discountPct: 5,
  });
  await call('POST', `/pricing/lists/${juiceId}/lines`, {
    lines: created
      .filter((item) => ['مشروبات', 'ألبان وأجبان'].includes(item.category))
      .map((item) => ({ itemId: item.itemId, unitId: item.baseUnit, price: item.sell })),
  });

  // ---------------- coupon ----------------
  await call('POST', '/pricing/coupons', {
    code: 'WELCOME10', name: 'خصم ترحيب للعملاء الجدد',
    discountType: 1, discountValue: 10, minInvoiceAmount: 300, maxDiscount: 100, isActive: true,
  });

  // ---------------- parties ----------------
  const customers = [
    ['بقالة الحاج محمد إبراهيم', '01012345678', 'المعادي، شارع 9', 150000, 'customer'],
    ['سوبر ماركت النور', '01123456789', 'المعادي، شارع 21', 400000, 'customer'],
    ['أم أحمد سامي', '01223456780', 'الجيزة، شارع الهرم', 80000, 'customer'],
    ['محل العزبي للبقالة', '01034567891', 'حلوان، شارع 조사', 200000, 'customer'],
    ['شركة النيل للتجارة', '01287654321', 'القاهرة الجديدة، التجمع', 800000, 'customer'],
    ['مطعم Shiraz', '01176543210', 'المعادي، شارع 9', 250000, 'customer'],
    ['صيدلية د. شريف', '01098765432', 'القاهرة، مدينة نصر', 300000, 'customer'],
    ['مقاهي Sheba', '01555555555', 'الجيزة، شارع الهرم', 200000, 'customer'],
  ];
  const customerIds = [];
  for (const [name, phone, address, creditLimit] of customers) {
    const createdParty = await call('POST', '/parties', {
      name, partyType: 1, phone, address, creditLimit,
      taxNumber: name.includes('شركة') ? '345-678-901' : null,
      priceListId: name.includes('النور') || name.includes('النيل') ? wholesaleId : null,
      isActive: true,
    });
    customerIds.push(createdParty.partyId);
  }

  const suppliers = [
    ['مصنع جهينة للألبان', '01099887766', 'القاهرة، السادس', 200000],
    ['شركة النصر للتموين', '01288776655', 'الإسكندرية', 300000],
    ['مورد الجملة للخضار', '01177665544', 'القاهرة، العباسية', 150000],
    ['شركة سكر مصر للتجارة', '01066554433', 'القاهرة، المعادي', 250000],
  ];
  const supplierIds = [];
  for (const [name, phone, address, creditLimit] of suppliers) {
    const createdParty = await call('POST', '/parties', {
      name, partyType: 2, phone, address, creditLimit, isActive: true,
    });
    supplierIds.push(createdParty.partyId);
  }

  // ---------------- restaurant halls, notes & modifiers ----------------
  // The hall code is the prefix of the table numbers (A + 4 tables -> A1..A4).
  const existingHalls = await call('GET', '/pos/halls');
  for (const hall of [
    { name: 'الدور الأرضي', code: 'A', tableCount: 4 },
    { name: 'التراس', code: 'T', tableCount: 2 },
  ]) {
    if (existingHalls.some((row) => row.name === hall.name)) continue;
    await call('POST', '/pos/halls', { ...hall, tableType: 1, capacity: 4 });
  }
  const existingNotes = await call('GET', '/pos/note-templates');
  for (const note of ['بدون بصل', 'حار', 'بدون ملح']) {
    if (existingNotes.some((row) => row.name === note)) continue;
    await call('POST', '/pos/note-templates', { name: note });
  }

  const croissant = byCode('DEMO-CROISSANT');
  const existingModifiers = await call('GET', `/pos/modifiers?itemId=${croissant.itemId}`);
  if (!existingModifiers.length) {
    await call('POST', '/pos/modifiers', {
      itemId: croissant.itemId, name: 'إضافة جبنة', price: 8, maxQuantity: 3,
    });
    await call('POST', '/pos/modifiers', {
      itemId: croissant.itemId, name: 'إضافة بسكويت', price: 0, maxQuantity: 1,
    });
  }

  // ---------------- plan the month of sales first ----------------
  // The stock is bought afterwards to cover exactly what the sales need, so
  // the demo never runs out of an item.
  const salesPlan = [];
  for (let day = 29; day >= 0; day -= 1) {
    const invoicesToday = between(0, 3);
    for (let n = 0; n < invoicesToday; n += 1) {
      const customerId = pick(customerIds);
      const lineCount = between(2, 6);
      const lines = [];
      for (let l = 0; l < lineCount; l += 1) {
        const item = pick(created);
        const useBigUnit = random() > 0.75 && item.unitRows.length > 1;
        const [unitId, factor, price] = useBigUnit ? item.unitRows[1] : item.unitRows[0];
        lines.push({
          itemId: item.itemId,
          unitId,
          factor,
          // A carton holds many base units, so the sold quantity stays small.
          // Expensive items move in small quantities, like in a real shop.
          quantity: factor > 6 ? between(1, 3) : price > 300 ? between(1, 2) : between(1, 8),
          unitPrice: price,
          discountPct: random() > 0.85 ? 5 : 0,
          taxPct: item.vat,
        });
      }
      const gross = lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPct / 100),
        0,
      );
      const total = gross + lines.reduce(
        (sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPct / 100) * (line.taxPct / 100),
        0,
      );

      const roll = random();
      const payments = [];
      let paidAmount = 0;
      if (roll < 0.45) {
        payments.push({ method: 1, amount: Math.round(total * 100) / 100, cashAccountId: drawer.cashAccountId });
        paidAmount = total;
      } else if (roll < 0.7) {
        const cashPart = Math.round(total * 0.6 * 100) / 100;
        payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
        paidAmount = cashPart;
      } else if (roll < 0.85) {
        const cashPart = Math.round(total * 0.4 * 100) / 100;
        payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
        payments.push({ method: 2, amount: Math.round((total - cashPart) * 100) / 100, cashAccountId: cardAccount.cashAccountId });
        paidAmount = total;
      }

      salesPlan.push({
        day, customerId, lines, total, payments, paidAmount,
        headerDiscount: random() > 0.9 ? 3 : 0,
      });
    }
  }

  // ---------------- purchases (the stock the plan needs) ----------------
  const needed = new Map();
  for (const sale of salesPlan) {
    for (const line of sale.lines) {
      needed.set(line.itemId, (needed.get(line.itemId) ?? 0) + line.quantity * line.factor);
    }
  }
  const purchaseBatches = [
    { days: 28, supplier: 0, share: 0.35 },
    { days: 21, supplier: 1, share: 0.25 },
    { days: 14, supplier: 2, share: 0.2 },
    { days: 7, supplier: 3, share: 0.2 },
  ];
  for (const batch of purchaseBatches) {
    const lines = created
      .map((item) => ({
        itemId: item.itemId,
        unitId: item.baseUnit,
        quantity: Math.max(5, Math.ceil(((needed.get(item.itemId) ?? 0) + 10) * batch.share)),
        unitPrice: item.cost,
        discountPct: 0,
        taxPct: item.vat,
      }))
      .filter((line) => line.quantity > 0);
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    await call('POST', '/sales/invoices', {
      invoiceType: 2,
      branchId,
      warehouseId,
      partyId: supplierIds[batch.supplier],
      paymentType: 1,
      cashAccountId: bankAccount.cashAccountId,
      paidAmount: Math.round(total * 0.6 * 100) / 100,
      invoiceDate: daysAgo(batch.days),
      lines,
      notes: 'شراء بضاعة',
    });
  }

  // ---------------- sales across the last 30 days ----------------
  const cashCategories = await call('GET', '/treasury/categories');
  const depositCategory = cashCategories.find((c) => c.direction === 1);

  let salesCount = 0;
  for (const sale of salesPlan) {
    const { day, customerId, lines, total, payments, paidAmount } = sale;
    await call('POST', '/sales/invoices', {
      invoiceType: 1,
      branchId,
      warehouseId,
      partyId: customerId,
      paymentType: paidAmount >= total - 0.01 ? 1 : paidAmount > 0 ? 3 : 2,
      cashAccountId: drawer.cashAccountId,
      paidAmount: Math.round(paidAmount * 100) / 100,
      payments: payments.length ? payments : undefined,
      invoiceDate: daysAgo(day),
      discountPct: sale.headerDiscount,
      lines: lines.map(({ factor, ...line }) => line),
      notes: '',
    });
    salesCount += 1;
  }

  for (let day = 29; day >= 0; day -= 1) {

    // daily cash deposit into the bank
    if (random() > 0.55 && depositCategory) {
      await call('POST', '/treasury/transactions', {
        cashAccountId: bankAccount.cashAccountId,
        direction: 1,
        categoryId: depositCategory.categoryId,
        amount: between(2000, 9000),
        description: 'إيداع نقدية بالفرع',
        transactionDate: daysAgo(day),
      });
    }
  }

  // ---------------- a receipt voucher that settles an invoice ----------------
  const creditSales = await call('GET', '/sales/invoices?type=1&pageSize=200');
  const openInvoice = (creditSales.items ?? [])
    .filter((row) => row.partyId && Number(row.paidAmount) < Number(row.totalAmount))
    .sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))[0];
  if (openInvoice) {
    // Settle half of whatever is still open on the invoice.
    const remaining = Number(openInvoice.remaining ?? 0);
    const amount = Math.round(remaining * 0.5 * 100) / 100;
    if (amount > 0) {
      await call('POST', '/accounting/vouchers', {
        voucherType: 1,
        partyId: openInvoice.partyId,
        cashAccountId: bankAccount.cashAccountId,
        amount,
        paymentMethod: 3,
        description: 'تحصيل دفعة من العميل',
        allocations: [{ invoiceId: openInvoice.invoiceId, amount }],
      });
    }
  }

  // ---------------- a quotation and a sales order ----------------
  const quotation = await call('POST', '/quotations', {
    partyId: customerIds[1],
    validUntil: daysAgo(-14),
    notes: 'عرض سعر أسبوع',
    lines: created.slice(0, 4).map((item) => ({
      itemId: item.itemId,
      unitId: item.baseUnit,
      quantity: between(20, 60),
      unitPrice: item.sell,
      taxPct: item.vat,
    })),
  });

  const order = await call('POST', '/orders', {
    orderType: 1,
    partyId: customerIds[4],
    warehouseId,
    expectedDate: daysAgo(-7),
    notes: 'توريد أسبوعي',
    lines: created.slice(4, 10).map((item) => ({
      itemId: item.itemId,
      unitId: item.baseUnit,
      quantity: between(30, 90),
      unitPrice: item.sell,
      taxPct: item.vat,
    })),
  });
  await call('POST', `/orders/${order.orderId}/status`, { status: 2 });

  // ---------------- a restaurant table order ----------------
  const tables = await call('GET', '/pos/tables');
  await call('POST', '/pos/table-orders', {
    tableId: tables[0].tableId,
    guestCount: 4,
    lines: created.slice(0, 3).map((item) => ({
      itemId: item.itemId,
      unitId: item.baseUnit,
      quantity: between(1, 3),
      unitPrice: item.sell,
      taxPct: item.vat,
    })),
  });

  console.log(`[demo] تم إنشاء بيانات الديمو:`);
  console.log(`   - ${categoryNames.length} تصنيف · ${created.length} صنف`);
  console.log(`   - ${customerIds.length} عميل · ${supplierIds.length} مورد`);
  console.log(`   - ${salesCount} فاتورة بيع على مدى 30 يوم`);
  console.log(`   - حسابات خزينة: درج + بنك + بطاقات + محفظة`);
  console.log(`   - عرض سعر ${quotation.quotationId} · أمر بيع ${order.orderId} · طلب طاولة مفتوح`);
}

main().catch((error) => {
  console.error('[demo] فشل:', error.message);
  process.exit(1);
});
