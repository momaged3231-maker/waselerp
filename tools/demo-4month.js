/*
 * CompuMob — كومبوموب للتجارة — محاكاة كاملة لمدة 4 شهور (أرقام صحيحة فقط: أقل رقم 1 ومضاعفتها).
 *
 * محل الكمبيوتر (المعادي) + محل موبايل (المقطم) — فرعين لعلاء.
 * الفترة: من 2026-07-16 إلى اليوم (تشمل أغسطس/سبتمبر/أكتوبر/نوفمبر 2026).
 * سبتمبر أبطأ من باقي الشهور (موسم هدوء) + خصم يوم كامل = صفر + «بضاعة تالفة» mid-September — شهر قد يظهر خسارة.
 *
 * قابل للتشغيل أكثر من مرة: بيرفض التشغيل لو بيانات CPM موجودة بالفعل.
 * تشغيل بعد: wipe-db.js --yes → migrate-all.js → seed.ts → seed-reference.js
 *
 *   node tools/demo-4month.js
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

let token = null;
let branchId = null;

async function call(method, path, body, branchOverride) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const active = branchOverride ?? branchId;
  if (active) headers['x-branch-id'] = String(active);
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
let seed = 20261116;
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (min, max) => Math.floor(random() * (max - min + 1)) + min;
const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};
const whole = (n) => Math.round(n); // safety net: every stored money figure stays an integer

async function main() {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const probe = await call('GET', '/items?search=CMB-&pageSize=1');
  if ((probe.items ?? probe).length) {
    console.log('[4m] بيانات CompuMob موجودة بالفعل — لإعادة البناء:');
    console.log('[4m]   node tools/pg/wipe-db.js --yes && node tools/pg/migrate-all.js wasel && npx ts-node --transpile-only src/cli/seed.ts (من apps/api) && node tools/pg/seed-reference.js wasel');
    return;
  }

  // ---------------- branches ----------------
  const branchList = await call('GET', '/catalog/branches');
  async function ensureBranch(code, name, extra) {
    const found = branchList.find((b) => b.code === code);
    if (found) {
      await call('PUT', `/admin/branches/${found.branchId}`, { code, name, ...extra, isActive: true });
      return found.branchId;
    }
    const created = await call('POST', '/admin/branches', { code, name, ...extra });
    return created.branchId;
  }
  const branchMain = await ensureBranch('MAIN', 'CompuMob — فرع المعادي (كمبيوتر وتسجيل وكاميرات)', {
    address: 'المعادي، شارع 9، القاهرة', phone: '0223807000', city: 'القاهرة',
  });
  const branchMobile = await ensureBranch('CP2', 'CompuMob — فرع المقطم (موبايل وإكسسوارات)', {
    address: 'المقطم، شارع 9، القاهرة', phone: '0225089000', city: 'القاهرة',
  });

  // ---------------- warehouses ----------------
  const warehouses = await call('GET', '/catalog/warehouses');
  async function defaultWarehouse(branch, code, name) {
    const existing = warehouses.find((w) => Number(w.branchId) === Number(branch));
    if (existing) return existing.warehouseId;
    const created = await call('POST', '/catalog/warehouses', { branchId: branch, code, name, isDefault: true });
    warehouses.push({ ...created, branchId: branch, isDefault: true });
    return created.warehouseId;
  }
  const whMain = await defaultWarehouse(branchMain, 'WH-MAIN', 'مخزن المعادي الرئيسي');
  const whMobile = await defaultWarehouse(branchMobile, 'WH-CP2', 'مخزن المقطم');

  // ---------------- treasury accounts ----------------
  const accounts = await call('GET', '/treasury/accounts');
  async function ensureAccount(branch, body) {
    const existing = accounts.find((a) => a.name === body.name);
    if (existing) return existing;
    const created = await call('POST', '/treasury/accounts', body, branch);
    accounts.push(created);
    return created;
  }
  const drawerMain = await ensureAccount(branchMain, { name: 'خزينة فرع المعادي', type: 1, openingBalance: 12000 });
  const bankNbeMain = await ensureAccount(branchMain, {
    name: 'حساب البنك الأهلي — المعادي', type: 2,
    bankName: 'البنك الأهلي المصري', accountNo: 'EG380190000000000012345678', openingBalance: 150000,
  });
  const bankCibMain = await ensureAccount(branchMain, {
    name: 'حساب البنك التجاري الدولي CIB', type: 2,
    bankName: 'البنك التجاري الدولي', accountNo: 'EG120001000000000222333444', openingBalance: 95000,
  });
  const cardAccount = await ensureAccount(branchMain, {
    name: 'حساب تسوية البطاقات', type: 3,
    bankName: 'البنك التجاري الدولي', accountNo: 'CARD-SETTLE-01', openingBalance: 0,
  });
  const wallet = await ensureAccount(branchMain, { name: 'محفظة فودافون كاش V.Cash', type: 4, openingBalance: 8000 });
  const drawerMobile = await ensureAccount(branchMobile, { name: 'خزينة فرع المقطم', type: 1, openingBalance: 25000 });
  const bankCairo = await ensureAccount(branchMobile, {
    name: 'حساب بنك القاهرة — المقطم', type: 2,
    bankName: 'بنك القاهرة', accountNo: 'EG010000000000002200000001', openingBalance: 80000,
  });

  // ---------------- employees + users (6) ----------------
  // Basic salaries are multiples of 400 so insurance math stays whole-number (11% و18.75%).
  const roles = await call('GET', '/admin/roles');
  const roleId = (needle) => {
    const role = roles.find((r) => String(r.name ?? r.code ?? '').includes(needle));
    return role ? role.roleId : undefined;
  };

  async function ensureUser(userName, fullName, opts) {
    const users = await call('GET', '/admin/users');
    const found = users.find((u) => u.userName === userName);
    if (found) return found;
    const roleIds = [];
    for (const needle of opts.roleNeedle ?? []) {
      const rid = roleId(needle);
      if (rid) roleIds.push(rid);
    }
    const created = await call('POST', '/admin/users', {
      userName, fullName, password: 'Demo@1234', isActive: true,
      email: `${userName}@compumob.eg`, phone: opts.phone ?? null,
      defaultBranchId: opts.defaultBranchId, isCashier: !!opts.isCashier,
      isSalesRep: !!opts.isSalesRep, maxDiscountPct: opts.maxDiscountPct ?? 10, roleIds,
    });
    return { userId: created.userId, userName, fullName };
  }

  async function ensureDepartment(branch, name) {
    const list = await call('GET', '/hr/departments', undefined, branch);
    const found = list.find((d) => d.name === name);
    if (found) return found.departmentId;
    const created = await call('POST', '/hr/departments', { name }, branch);
    return created.departmentId;
  }

  async function ensureEmployee(branch, userName, name, jobTitle, departmentId, phone, basicSalary, roleNeedle) {
    const user = await ensureUser(userName, name, {
      defaultBranchId: branch,
      isCashier: jobTitle.includes('كاشير') || jobTitle.includes('مدير'),
      isSalesRep: jobTitle.includes('مندوب') || jobTitle.includes('مهندس'),
      phone, roleNeedle,
    });
    const list = await call('GET', '/hr/employees', undefined, branch);
    const found = list.find((e) => e.name === name);
    if (found) return { ...found, userId: user.userId };
    const created = await call('POST', '/hr/employees', {
      name, jobTitle, departmentId, phone, mobile: phone, nationalId: null,
      basicSalary, allowances: 400, hireDate: daysAgo(400), userId: user.userId,
    }, branch);
    return { ...created, userId: user.userId };
  }

  const depSales1 = await ensureDepartment(branchMain, 'المبيعات والكمبيوتر — المعادي');
  const depService1 = await ensureDepartment(branchMain, 'الصيانة — المعادي');
  const depSales2 = await ensureDepartment(branchMobile, 'المبيعات — المقطم');
  const depService2 = await ensureDepartment(branchMobile, 'الصيانة والموبايل — المقطم');

  const staff = {
    manager: await ensureEmployee(branchMain, 'ahmdsbr', 'أحمد صبري', 'مدير الفرع', depSales1, '01001234501', 8000, ['مدير', 'admin']),
    cashier1: await ensureEmployee(branchMain, 'mhmudqd', 'محمود القاضي', 'كاشير', depSales1, '01001234502', 6400, ['كاشير', 'cashier']),
    engineer1: await ensureEmployee(branchMain, 'sarnam', 'سارة نعم', 'مهندسة صيانة كمبيوتر', depService1, '01001234503', 7200, ['مهندس', 'engineer', 'فني']),
    cashier2: await ensureEmployee(branchMobile, 'umrmhtm', 'عمر رمضان', 'كاشير ومندوب', depSales2, '01001234504', 5600, ['كاشير', 'cashier', 'مندوب', 'sales']),
    cashier3: await ensureEmployee(branchMobile, 'mnshrf', 'منى شريف', 'كاشيرة', depSales2, '01001234505', 5200, ['كاشير', 'cashier']),
    engineer2: await ensureEmployee(branchMobile, 'yasmshq', 'ياسمين شقيق', 'مهندسة صيانة موبايل', depService2, '01001234506', 6000, ['مهندس', 'engineer', 'فني']),
  };

  // ---------------- services (POS: طباعة وتصوير وتغليف) ----------------
  const serviceCat = await ensureCategory('خدمات طباعة وتغليف');
  const services = [
    ['CMB-SVC-PRINT-A4', 'طباعة صفحة A4 أبيض', 2],
    ['CMB-SVC-PRINT-COL', 'طباعة صفحة A4 ملونة', 5],
    ['CMB-SVC-COPY', 'تصوير صفحة', 1],
    ['CMB-SVC-PHOTO10', 'طباعة صورة 10×15', 15],
    ['CMB-SVC-PHOTOA4', 'طباعة صورة A4', 25],
    ['CMB-SVC-WRAP-S', 'تغليف هدية صغيرة', 20],
    ['CMB-SVC-WRAP-M', 'تغليف هدية متوسطة', 30],
    ['CMB-SVC-WRAP-L', 'تغليف هدية كبيرة', 50],
  ];
  for (const [code, name, sell] of services) {
    const saved = await call('POST', '/items', {
      code, name, categoryId: serviceCat, baseUnitId: PCS,
      costPrice: 0, sellPrice: sell, vatPct: 0, isService: true, isActive: true,
    });
    created.push({ itemId: saved.itemId, code, name, baseUnitId: PCS, costPrice: 0, sellPrice: sell, vatPct: 0, unitRows: [[PCS, 1, sell]] });
  }

  const wholesale = await call('POST', '/pricing/lists', {
    name: 'أسعار الجملة — الشركات والمكاتب', code: 'CMB-WHOLESALE', listType: 2, priority: 30, discountPct: 8,
  });
  await call('POST', `/pricing/lists/${wholesale.priceListId}/lines`, {
    lines: created.slice(0, 15).map((item) => ({
      itemId: item.itemId, unitId: item.baseUnitId,
      price: whole(item.sellPrice * 0.92),
    })),
  });

  // ---------------- sales plan: 4 شهور كاملة (أغسطس إلى نوفمبر) ----------------
  // Sep = شهر هدوء (مبيعات قليلة + بضاعة تالفة) واحتمال خسارة الشهر هو العرض الحقيقي.
  const mainCodes = items.slice(0, 16).map((row) => row[0]);
  const mobileCodes = items.slice(16).map((row) => row[0]);
  const mainCodesAll = [...mainCodes, ...services.map((s) => s[0])];
  const mobileCodesAll = [...mobileCodes, ...services.map((s) => s[0])];

  function makeSaleLines(branchCodes, lineCount) {
    const lines = [];
    for (let l = 0; l < lineCount; l += 1) {
      const item = byCode(pick(branchCodes));
      const [unitId, , price] = item.unitRows[0];
      lines.push({
        itemId: item.itemId, unitId, factor: 1,
        quantity: price > 15000 ? 1 : price > 1000 ? between(1, 2) : between(1, 6),
        unitPrice: price, discountPct: 0, taxPct: 0,
      });
    }
    return lines;
  }

  function settle(total, drawer, card) {
    const roll = random();
    const payments = [];
    let paidAmount = 0;
    if (roll < 0.5) {
      payments.push({ method: 1, amount: whole(total), cashAccountId: drawer.cashAccountId });
      paidAmount = whole(total);
    } else if (roll < 0.7) {
      const cashPart = whole(total * 0.5);
      payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
      paidAmount = cashPart;
    } else if (card && roll < 0.85) {
      const cashPart = whole(total * 0.4);
      payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
      payments.push({ method: 2, amount: whole(total - cashPart), cashAccountId: card.cashAccountId });
      paidAmount = whole(total);
    } else {
      paidAmount = 0; // آجل بالكامل
    }
    return { payments, paidAmount };
  }

  const salesPlan = [];
  for (let day = 123; day >= 0; day -= 1) {
    const date = new Date(Date.now() - day * 86400000);
    const month = date.getMonth() + 1;
    const dow = date.getDay();
    const isPlateauMonth = month === 9;
    const isWeekend = dow === 5 || dow === 6;
    for (const branch of [branchMain, branchMobile]) {
      const skip = isPlateauMonth ? (random() < 0.45) : (random() < 0.10);
      if (skip) continue;
      const isMain = branch === branchMain;
      const branchCodes = isMain ? mainCodesAll : mobileCodesAll;
      const drawer = isMain ? drawerMain : drawerMobile;
      const card = isMain ? cardAccount : null;
      const party = customerIds[pick(isMain ? mainCustomers : mobileCustomers)];
      const warehouseId = isMain ? whMain : whMobile;
      const events = isWeekend ? 2 : 1;
      for (let k = 0; k < events; k += 1) {
        const lines = makeSaleLines(branchCodes, isWeekend ? between(2, 5) : between(1, 4));
        const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
        const { payments, paidAmount } = settle(total, drawer, card);
        salesPlan.push({ branch, isMain, party, warehouseId, drawer, card, lines, total, payments, paidAmount, day });
      }
    }
  }

  // ---------------- purchases: موجة افتتاحية + موجة مستودع ثاني + موجة ثالثة ----------------
  // تُقيَّد الكميات لما تحتاجه الخطة الفعلية لكل مخزن على حدة.
  const neededMain = new Map();
  const neededMobile = new Map();
  for (const sale of salesPlan) {
    const map = sale.isMain ? neededMain : neededMobile;
    for (const line of sale.lines) map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.quantity);
  }
  const addNeed = (map, code, qty) => {
    const item = byCode(code);
    map.set(item.itemId, (map.get(item.itemId) ?? 0) + qty);
  };
  addNeed(neededMain, 'CMB-SPR-SSD-512', 2);
  addNeed(neededMain, 'CMB-SPR-SSD-512', 1);
  addNeed(neededMain, 'CMB-SPR-SSD-512', 1);
  addNeed(neededMobile, 'CMB-SPR-SCR-MB', 2);
  addNeed(neededMobile, 'CMB-SPR-BAT-MB', 2);

  async function purchase(branch, warehouseId, supplierId, drawer, days, needed, share) {
    const lines = [...needed.entries()].map(([itemId, qty]) => {
      const item = created.find((c) => c.itemId === itemId);
      return {
        itemId, unitId: item.baseUnitId,
        quantity: Math.max(1, Math.ceil(qty * share) + (share >= 1 ? 4 : 1)),
        unitPrice: item.costPrice, discountPct: 0, taxPct: 0,
      };
    }).filter((l) => l.quantity > 0);
    if (!lines.length) return;
    const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId: branch, warehouseId, partyId: supplierId,
      paymentType: 3, cashAccountId: drawer.cashAccountId,
      paidAmount: whole(total * 0.6),
      invoiceDate: daysAgo(days), lines, notes: 'توريد بضاعة — CompuMob',
    }, branch);
  }
  // global waves across the 4 months: Aug opening, mid Sep restock, late Oct restock
  await purchase(branchMain, whMain, supplierIds[0], drawerMain, 116, neededMain, 0.6);
  await purchase(branchMobile, whMobile, supplierIds[1], drawerMobile, 116, neededMobile, 0.6);
  await purchase(branchMain, whMain, supplierIds[0], drawerMain, 57, neededMain, 0.28);
  await purchase(branchMobile, whMobile, supplierIds[1], drawerMobile, 57, neededMobile, 0.28);
  await purchase(branchMain, whMain, supplierIds[0], drawerMain, 21, neededMain, 0.18);
  await purchase(branchMobile, whMobile, supplierIds[1], drawerMobile, 21, neededMobile, 0.18);

  // ---------------- execute the sales plan (with real dates) ----------------
  let posted = 0;
  for (const sale of salesPlan) {
    const payload = {
      invoiceType: 1, branchId: sale.branch, warehouseId: sale.warehouseId,
      partyId: sale.party,
      paymentType: sale.card ? 3 : sale.paidAmount === sale.total ? 1 : sale.paidAmount > 0 ? 3 : 2,
      cashAccountId: sale.drawer.cashAccountId,
      paidAmount: sale.paidAmount,
      payments: sale.payments.length ? sale.payments : undefined,
      invoiceDate: daysAgo(sale.day), lines: sale.lines, notes: '',
    };
    try {
      await call('POST', '/sales/invoices', payload, sale.branch);
      posted += 1;
    } catch (e) {
      console.log(`[4m] تعذر الفاتورة branch=${sale.branch} day=${sale.day}: ${e.message.slice(0, 120)}`);
    }
  }
  console.log(`[4m] المبيعات: ${posted}/${salesPlan.length} فاتورة عبر 4 شهور`);

  // ---------------- إيداعات أسبوعية (كاشير → بنك) ----------------
  const cashCategories = await call('GET', '/treasury/categories', undefined, branchMain);
  const depositCategory = (cashCategories ?? []).find((c) => c.direction === 1);
  for (const day of [110, 96, 82, 68, 54, 40, 26, 12]) {
    if (depositCategory) {
      await call('POST', '/treasury/transactions', {
        cashAccountId: bankNbeMain.cashAccountId,
        direction: 1, categoryId: depositCategory.categoryId,
        amount: day % 2 ? 6000 : 4500,
        description: 'إيداع يومية الكاشير — CompuMob',
        transactionDate: daysAgo(day),
      }, branchMain);
    }
  }

  // ---------------- بضاعة تالفة (منتصف سبتمبر) — شهر قد يعرض خسارة ----------------
  const damagedLines = [
    { item: byCode('CMB-HDD-4TB'), quantity: 3, cost: 2600 },
    { item: byCode('CMB-CAM-HIK-2MP'), quantity: 2, cost: 850 },
    { item: byCode('CMB-NVR-16'), quantity: 1, cost: 4300 },
  ];
  const voucher = await call('POST', '/stock-vouchers', {
    warehouseId: whMain, voucherType: 3, voucherDate: daysAgo(52), notes: 'تالف — عبوة تخزين وكاميرات (شهر سبتمبر)',
  }, branchMain);
  for (const l of damagedLines) {
    await call('POST', `/stock-vouchers/${voucher.stockVoucherId ?? voucher.id}/lines`, {
      itemId: l.item.itemId, unitId: l.item.baseUnitId, quantity: l.quantity, unitCost: l.cost, notes: '',
    }, branchMain);
  }
  await call('POST', `/stock-vouchers/${voucher.stockVoucherId ?? voucher.id}/approve`, {}, branchMain);
  console.log('[4m] بون تالفة سبتمبر: ~13,800 ج.م (6 وحدات) — اعتُمدت وطُبّقت على المخزون');

  // ---------------- تذاكر صيانة على مدى الشهور ----------------
  const maintProducts = await call('GET', '/maintenance/products', undefined, branchMain);
  const maintProduct = (maintProducts ?? [])[0];
  const maintModels = await call('GET', `/maintenance/models?productId=${maintProduct?.productId ?? 1}`, undefined, branchMain);
  const maintModel = (maintModels ?? [])[0];
  const drawers = [drawerMain, drawerMobile];
  const tickets = [
    ['عميل المعادي — صيانة لابتوب Lenovo', '01011110001', 100, 1, 2500, 1200],
    ['سارة — ماك بوك برو بطارية', '01011110002', 88, 1, 1800, 900],
    ['محل التكنولوجيا الحديثة — تركيب 6 كاميرات', '01011110003', 74, 1, 6000, 2500],
    ['عميل المقطم — شاشة موبايل', '01011110004', 52, 2, 2500, 1000],
    ['أحمد — كاميرا 2MP قديمة', '01011110005', 31, 1, 4500, 0],
    ['شركة النيل — صيانة سويتش ومراقبة', '01011110006', 9, 1, 12000, 5000],
  ];
  for (const [customerName, phone, days, branchFlag, maxCharge, advance] of tickets) {
    try {
      await call('POST', '/maintenance/tickets', {
        customerName, phone,
        productId: maintProduct?.productId ?? 1, modelId: maintModel?.modelId ?? 1,
        accessories: {}, productCondition: 'يعمل',
        customerNotes: customerName, maxCharge, estimatedCost: maxCharge,
        paidAmount: advance, cashAccountId: drawers[branchFlag - 1].cashAccountId,
      }, branchFlag === 1 ? branchMain : branchMobile);
    } catch (e) {
      console.log('[4m] تعذر إنشاء تذكرة صيانة:', e.message.slice(0, 90));
    }
  }
  console.log('[4m] تذاكر الصيانة موزعة على 4 شهور');

  // ---------------- عرض سعر → فاتورة: طلب شركة النور للأنظمة الأمنية ----------------
  const laptop = byCode('CMB-LAP-DELL-I7');
  const monitor = byCode('CMB-MON-24');
  const quotation = await call('POST', '/quotations', {
    quotationDate: daysAgo(23), validUntil: daysAgo(16),
    partyId: customerIds[1], warehouseId: whMain,
    lines: [
      { itemId: laptop.itemId, unitId: laptop.baseUnitId, quantity: 8, unitPrice: 25500, discountPct: 0, taxPct: 0 },
      { itemId: monitor.itemId, unitId: monitor.baseUnitId, quantity: 4, unitPrice: 4200, discountPct: 0, taxPct: 0 },
    ],
    notes: 'عرض سعر — 8 لابتوب + 4 شاشات لمدارس',
  }, branchMain);
  await call('POST', `/quotations/${quotation.quotationId}/status`, { status: 2 }, branchMain);
  const converted = await call('POST', `/quotations/${quotation.quotationId}/convert`, {}, branchMain);
  console.log(`[4m] عرض السعر ${quotation.quotationId} ← فاتورة #${converted?.invoiceId ?? '—'}`);

  // ---------------- المرتبات: 4 شهور مولّدة ومصروفة (كل الأرقام أعداد صحيحة) ----------------
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    for (const branch of [branchMain, branchMobile]) {
      const drawer = branch === branchMain ? drawerMain : drawerMobile;
      const gen = await call('POST', '/hr/payroll/generate', { periodMonth: month }, branch);
      const pay = await call('POST', '/hr/payroll/pay', { cashAccountId: drawer.cashAccountId, periodMonth: month }, branch);
      console.log(`[4m] الراتب ${month} فرع ${branch === branchMain ? 'المعادي' : 'المقطم'}: generate ${JSON.stringify(gen).slice(0, 120)} | pay ${JSON.stringify(pay).slice(0, 120)}`);
    }
  }

  // ---------------- ملخص المحاكاة ----------------
  const invCountMain = await call('GET', '/sales/invoices?pageSize=1', undefined, branchMain);
  const invCountMobile = await call('GET', '/sales/invoices?pageSize=1', undefined, branchMobile);
  const months = [
    ['2026-08', 'أغسطس', '2026-08-01', '2026-08-31'],
    ['2026-09', 'سبتمبر', '2026-09-01', '2026-09-30'],
    ['2026-10', 'أكتوبر', '2026-10-01', '2026-10-31'],
    ['2026-11', 'نوفمبر', '2026-11-01', '2026-11-16'],
  ];
  console.log('\n========== CompuMob — الأرباح والخسائر لكل شهر (قبل الشركاء وتكاليف تشغيلية أخرى) ==========');
  for (const [key, name, from, to] of months) {
    for (const branch of [branchMain, branchMobile]) {
      try {
        const pl = await call('GET', `/accounting/reports/profit-loss?from=${from}&to=${to}`, undefined, branch);
        const summary = pl?.summary ?? {};
        console.log(`${name} ${branch === branchMain ? 'المعادي' : 'المقطم'}:`,
          `إيرادات ${Math.round(Number(summary.revenue ?? 0)).toLocaleString('en')}`,
          `| مصروفات ${Math.round(Number(summary.expenses ?? 0)).toLocaleString('en')}`,
          `| صافي ${Math.round(Number(summary.netProfit ?? 0)).toLocaleString('en')}`);
      } catch {
        console.log(`${name} ${branch === branchMain ? 'المعادي' : 'المقطم'}: profit-loss غير متاح من الـ API — تحقق محليًا من التقارير`);
      }
    }
  }
  console.log(`\n[4m] تم بناء المحاكاة بالكامل. فواتير: المعادي ${invCountMain?.total ?? '?'} · المقطم ${invCountMobile?.total ?? '?'}`);
  console.log('[4m] علاء هو admin/admin123 — 6 موظفين بأرقام صحيحة — مفيش أي كسور في أي رقم.');
}
  // ---------------- categories + units + items (vat = 0 — كل الأرقام صحيحة) ----------------
  const units = await call('GET', '/catalog/units');
  const unit = (code) => units.find((u) => u.code === code)?.unitId ?? units[0].unitId;
  const PCS = unit('PCS');
  const BOX = unit('BOX');
  const PKT = unit('PKT');

  async function ensureCategory(name, parentId) {
    const list = await call('GET', '/catalog/categories');
    const found = list.find((c) => c.name === name);
    if (found) return found.categoryId;
    const created = await call('POST', '/catalog/categories', { name, parentId: parentId ?? null });
    return created.categoryId;
  }

  const catComputer = await ensureCategory('أجهزة كمبيوتر ولابتوب');
  const catCctv = await ensureCategory('كاميرات مراقبة وتسجيل');
  const catSecurity = await ensureCategory('أنظمة أمن وتحكم بالدخول');
  const catPrinters = await ensureCategory('طابعات وحبر');
  const catPaper = await ensureCategory('أوراق طباعة وتغليف');
  const catMobiles = await ensureCategory('موبايلات');
  const catAccessories = await ensureCategory('إكسسوارات موبايل');
  const catSpare = await ensureCategory('قطع غيار صيانة');

  // code, name, categoryId, baseUnit, cost, sell, vat=0, [units]
  const items = [
    ['CMB-LAP-DELL-I7', 'لابتوب Dell Latitude i7', catComputer, PCS, 22000, 25500, 0, [[PCS, 1, 25500]]],
    ['CMB-PC-GAMER-1', 'كمبيوتر تجميع جيمنج RTX', catComputer, PCS, 18000, 21500, 0, [[PCS, 1, 21500]]],
    ['CMB-MON-24', 'شاشة 24 بوصة IPS', catComputer, PCS, 3500, 4200, 0, [[PCS, 1, 4200]]],
    ['CMB-KB-LOG', 'كيبورد وماوس لاسلكي', catComputer, PKT, 480, 650, 0, [[PKT, 1, 650], [BOX, 10, 6200]]],
    ['CMB-CAM-HIK-2MP', 'كاميرا مراقبة Hikvision 2MP', catCctv, PCS, 850, 1150, 0, [[PCS, 1, 1150], [BOX, 8, 8900]]],
    ['CMB-DVR-8CH', 'مسجل DVR 8 قنوات', catCctv, PCS, 1900, 2450, 0, [[PCS, 1, 2450]]],
    ['CMB-HDD-4TB', 'هارد تسجيل 4TB مراقبة', catCctv, PCS, 2600, 3200, 0, [[PCS, 1, 3200]]],
    ['CMB-NVR-16', 'مسجل شبكي NVR 16 قناة', catCctv, PCS, 4300, 5300, 0, [[PCS, 1, 5300]]],
    ['CMB-ACC-FACE', 'جهاز تحكم بالدخول بالوجه', catSecurity, PCS, 5800, 7200, 0, [[PCS, 1, 7200]]],
    ['CMB-ALARM-KIT', 'كيت إنذار سرقة 6 أقطاب', catSecurity, PKT, 3400, 4300, 0, [[PKT, 1, 4300]]],
    ['CMB-PRN-HP-LASER', 'طابعة HP LaserJet', catPrinters, PCS, 4200, 4950, 0, [[PCS, 1, 4950]]],
    ['CMB-TONER-85A', 'تونر 85A أصلي', catPrinters, PCS, 450, 620, 0, [[PCS, 1, 620], [BOX, 6, 3550]]],
    ['CMB-ROLL-80', 'رول كاشير 80مم', catPaper, PKT, 95, 135, 0, [[PKT, 1, 135], [BOX, 50, 6300]]],
    ['CMB-KRAFT-ROLL', 'رول كرافت تغليف 60سم', catPaper, PCS, 210, 290, 0, [[PCS, 1, 290], [BOX, 6, 1650]]],
    ['CMB-BAG-KRAFT', 'أكياس كرافت مقاس وسط', catPaper, BOX, 180, 260, 0, [[BOX, 1, 260]]],
    ['CMB-STICK-A4', 'استيكر A4 للتغليف', catPaper, BOX, 145, 200, 0, [[BOX, 1, 200]]],
    ['CMB-MOB-IP15', 'iPhone 15 128GB', catMobiles, PCS, 38000, 42500, 0, [[PCS, 1, 42500]]],
    ['CMB-MOB-A55', 'Samsung Galaxy A55', catMobiles, PCS, 14500, 16800, 0, [[PCS, 1, 16800]]],
    ['CMB-MOB-R13C', 'Xiaomi Redmi 13C', catMobiles, PCS, 6500, 7600, 0, [[PCS, 1, 7600]]],
    ['CMB-ACC-CHG20', 'شاحن سريع 20W أصلي', catAccessories, PCS, 180, 260, 0, [[PCS, 1, 260], [BOX, 20, 4800]]],
    ['CMB-ACC-CASE', 'جراب موبايل مقاوم', catAccessories, PCS, 45, 85, 0, [[PCS, 1, 85], [BOX, 30, 2300]]],
    ['CMB-ACC-GLASS', 'شاشة حماية زجاج', catAccessories, PCS, 25, 50, 0, [[PCS, 1, 50], [BOX, 50, 2200]]],
    ['CMB-ACC-PWB', 'باور بانك 10000mAh', catAccessories, PCS, 350, 480, 0, [[PCS, 1, 480], [BOX, 10, 4500]]],
    ['CMB-ACC-BT', 'هيدفون بلوتوث', catAccessories, PCS, 420, 580, 0, [[PCS, 1, 580]]],
    ['CMB-SPR-SCR-MB', 'شاشة موبايل بديلة (قطعة غيار)', catSpare, PCS, 800, 1200, 0, [[PCS, 1, 1200]]],
    ['CMB-SPR-BAT-MB', 'بطارية موبايل أصلية', catSpare, PCS, 300, 450, 0, [[PCS, 1, 450]]],
    ['CMB-SPR-SSD-512', 'SSD 512GB (قطعة غيار)', catSpare, PCS, 1250, 1650, 0, [[PCS, 1, 1650]]],
  ];

  const created = [];
  for (const [code, name, categoryId, baseUnitId, costPrice, sellPrice, vatPct, unitRows] of items) {
    const saved = await call('POST', '/items', {
      code, name, categoryId, baseUnitId,
      costPrice, sellPrice, vatPct, reorderPoint: 5, minPrice: costPrice, isActive: true,
    });
    if (unitRows.length > 1) {
      await call('POST', `/items/${saved.itemId}/units`, {
        units: unitRows.map(([unitId, factor, price], index) => ({
          unitId, factor, sellPrice: price, buyPrice: whole(costPrice * factor), isDefault: index === 0,
        })),
      });
    }
    created.push({ itemId: saved.itemId, code, name, baseUnitId, costPrice, sellPrice, vatPct, unitRows });
  }
  const byCode = (code) => created.find((item) => item.code === code);

  // ---------------- parties ----------------
  const customers = [
    ['مكتب الأهرام للمحاسبة', '01211111101', 'المعادي، شارع 9', 200000, 1],
    ['شركة النيل للأنظمة الأمنية', '01211111102', 'التجمع الخامس', 500000, 1],
    ['صيدلية الشفاء', '01211111103', 'المقطم، دائري', 120000, 2],
    ['مقهى Laptop Zone', '01211111104', 'المعادي، قصر العيني', 80000, 1],
    ['مدارس النور الدولية', '01211111105', 'التجمع الخامس', 300000, 1],
    ['عيادة د. مراد', '01211111106', 'المعادي', 0, 1],
    ['شركة الفجر للمقاولات', '01211111107', 'المعادي', 400000, 1],
    ['فندق بورتو المقطم', '01211111108', 'المقطم، دائري', 350000, 1],
    ['سوبر ماركت الفجر', '01211111109', 'المقطم، دائري', 150000, 2],
    ['موبايل كيوز المقطم', '01211111110', 'المقطم، دائري', 200000, 1],
    ['محل The Phone Show', '01211111111', 'المعادي، شارع 9', 180000, 1],
    ['محل موبايل سنتر', '01211111112', 'المقطم، دائري', 170000, 1],
  ];
  const customerIds = [];
  for (const [name, phone, address, creditLimit, type] of customers) {
    const created = await call('POST', '/parties', {
      name, partyType: type, phone, address, creditLimit, isActive: true,
    });
    customerIds.push(created.partyId);
  }
  const mainCustomers = [0, 1, 3, 4, 5, 6, 10];      // indexes into customers[]
  const mobileCustomers = [2, 7, 8, 9, 11];
  const suppliers = [
    ['شركة سبيد تك للتوزيع', '0221110001', 'التجمع الخامس', 1],
    ['شركة جلوبال موبايل', '0221110002', 'مدينة نصر', 1],
    ['شركة كاميرا برو', '0221110003', 'الهرم', 1],
  ];
  const supplierIds = [];
  for (const [name, phone, address, _] of suppliers) {
    const created = await call('POST', '/parties', {
      name, partyType: 2, phone, address, creditLimit: 600000, isActive: true,
    });
    supplierIds.push(created.partyId);
  }

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});

