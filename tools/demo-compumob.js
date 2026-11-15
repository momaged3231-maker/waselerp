/*
 * CompuMob demo dataset — matches the shop the owner described:
 *
 *   Branch 1 (المعادي): كمبيوتر + كاميرات مراقبة + أنظمة أمنية + صيانة
 *                       + طباعة أوراق وتغليف
 *   Branch 2 (المقطم):  موبايل + إكسسوارات + صيانة موبايل
 *   6 employees (users + HR employees) spread over the two branches
 *   2 bank accounts + Vodafone Cash wallet + a cash drawer per branch
 *   Purchases + ~5 weeks of sales, maintenance products/models/tickets,
 *   a quotation, a sales order and bank deposits.
 *
 *   node tools/demo-compumob.js               # API on localhost:4000
 *   API_BASE=https://host/api node tools/demo-compumob.js
 *
 * Run on a fresh database: schema + migrate-all + seed + seed-reference first.
 * Re-runnable: it aborts politely when the demo already exists.
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
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

async function main() {
  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  branchId = login.activeBranchId;

  const probe = await call('GET', '/items?search=CMB-&pageSize=1');
  if ((probe.items ?? probe).length) {
    console.log('[demo] بيانات CompuMob موجودة بالفعل — للتصفير وإعادة البناء:');
    console.log('[demo]   node tools/pg/migrate-all.js wasel && node tools/pg/seed-reference.js wasel && npm run db:seed');
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
  const branchMain = await ensureBranch('MAIN', 'CompuMob — فرع المعادي (كمبيوتر وكاميرات وأنظمة أمنية)', {
    address: 'المعادي، شارع 9، القاهرة', phone: '0223807000', city: 'القاهرة',
  });
  const branchMobile = await ensureBranch('CP2', 'CompuMob — فرع المقطم (موبايل وإكسسوارات)', {
    address: 'المقطم، شارع 9، القاهرة', phone: '0225089000', city: 'القاهرة',
  });

  // ---------------- warehouses ----------------
  // The maintenance inspection consumes parts from the branch's DEFAULT
  // warehouse, so the demo stocks the default shelves — not new ones.
  const warehouses = await call('GET', '/catalog/warehouses');
  async function defaultWarehouse(branch, code, name) {
    const existing = warehouses.find((w) => Number(w.branchId) === Number(branch));
    if (existing) return existing.warehouseId;
    const created = await call('POST', '/catalog/warehouses', {
      branchId: branch, code, name, isDefault: true,
    });
    warehouses.push({ ...created, branchId: branch, isDefault: true });
    return created.warehouseId;
  }
  const whMain = await defaultWarehouse(branchMain, 'WH-MAIN', 'مخزن المعادي الرئيسي');
  const whMobile = await defaultWarehouse(branchMobile, 'WH-CP2', 'مخزن المقطم');

  // ---------------- treasury accounts ----------------
  const accounts = await call('GET', '/treasury/accounts');
  /** Reuses an existing cash account with the same name (demo must be re-runnable). */
  async function ensureAccount(branch, body) {
    const existing = accounts.find((a) => a.name === body.name);
    if (existing) return existing;
    const created = await call('POST', '/treasury/accounts', body, branch);
    accounts.push(created);
    return created;
  }
  const drawerMain = await ensureAccount(branchMain, {
    name: 'خزينة فرع المعادي', type: 1, openingBalance: 12000,
  });
  const bankNbe = await ensureAccount(branchMain, {
    name: 'حساب البنك الأهلي — المعادي', type: 2,
    bankName: 'البنك الأهلي المصري', accountNo: 'EG380190000000000012345678', openingBalance: 150000,
  });
  const bankCib = await ensureAccount(branchMain, {
    name: 'حساب البنك التجاري الدولي CIB', type: 2,
    bankName: 'البنك التجاري الدولي', accountNo: 'EG120001000000000222333444', openingBalance: 95000,
  });
  const cardAccount = await ensureAccount(branchMain, {
    name: 'حساب تسوية البطاقات', type: 3,
    bankName: 'البنك التجاري الدولي', accountNo: 'CARD-SETTLE-01', openingBalance: 0,
  });
  const wallet = await ensureAccount(branchMain, {
    name: 'محفظة فودافون كاش V.Cash', type: 4, openingBalance: 8000,
  });
  const drawerMobile = await ensureAccount(branchMobile, {
    name: 'خزينة فرع المقطم', type: 1, openingBalance: 25000,
  });
  const bankCairo = await ensureAccount(branchMobile, {
    name: 'حساب بنك القاهرة — المقطم', type: 2,
    bankName: 'بنك القاهرة', accountNo: 'EG010000000000002200000001', openingBalance: 80000,
  });

  // ---------------- employees + users (6) ----------------
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

  async function ensureEmployee(branch, userName, name, jobTitle, departmentId, phone, roleNeedle) {
    const user = await ensureUser(userName, name, {
      defaultBranchId: branch,
      isCashier: jobTitle.includes('كاشير') || jobTitle.includes('مدير'),
      // مهندسو الصيانة يحتاجون is_sales_rep — تحقق /maintenance/tickets/:id/inspect يرفض غير ذلك
      isSalesRep: jobTitle.includes('مندوب') || jobTitle.includes('مهندس'),
      phone, roleNeedle,
    });
    const list = await call('GET', '/hr/employees', undefined, branch);
    const found = list.find((e) => e.name === name);
    if (found) return { ...found, userId: user.userId };
    const created = await call('POST', '/hr/employees', {
      name, jobTitle, departmentId, phone, mobile: phone, nationalId: null,
    }, branch);
    return { ...created, userId: user.userId };
  }

  const depSales1 = await ensureDepartment(branchMain, 'المبيعات — المعادي');
  const depService1 = await ensureDepartment(branchMain, 'الصيانة — المعادي');
  const depSales2 = await ensureDepartment(branchMobile, 'المبيعات — المقطم');
  const depService2 = await ensureDepartment(branchMobile, 'الصيانة — المقطم');

  const staff = {
    manager: await ensureEmployee(branchMain, 'ahmdsbr', 'أحمد صبري', 'مدير الفرع', depSales1, '01001234501', ['مدير', 'admin']),
    cashier1: await ensureEmployee(branchMain, 'mhmudqd', 'محمود القاضي', 'كاشير', depSales1, '01001234502', ['كاشير', 'cashier']),
    engineer1: await ensureEmployee(branchMain, 'sarnam', 'سارة نعم', 'مهندسة صيانة كمبيوتر', depService1, '01001234503', ['مهندس', 'engineer', 'فني']),
    cashier2: await ensureEmployee(branchMobile, 'umrmhtm', 'عمر رمضان', 'كاشير ومندوب', depSales2, '01001234504', ['كاشير', 'cashier', 'مندوب', 'sales']),
    cashier3: await ensureEmployee(branchMobile, 'mnshrf', 'منى شريف', 'كاشيرة', depSales2, '01001234505', ['كاشير', 'cashier']),
    engineer2: await ensureEmployee(branchMobile, 'yasmshq', 'ياسمين شقيق', 'مهندسة صيانة موبايل', depService2, '01001234506', ['مهندس', 'engineer', 'فني']),
  };

  // ---------------- categories + units + items ----------------
  const units = await call('GET', '/catalog/units');
  const unit = (code) => units.find((u) => u.code === code)?.unitId ?? units[0].unitId;
  const PCS = unit('PCS');
  const BOX = unit('BOX');
  const PKT = unit('PKT');
  const KG = unit('KG');

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

  /** code, name, categoryId, baseUnit, cost, sell, vat, [unit, factor, price] */
  const items = [
    ['CMB-LAP-DELL-I7', 'لابتوب Dell Latitude i7', catComputer, PCS, 22000, 25500, 14, [[PCS, 1, 25500]]],
    ['CMB-PC-GAMER-1', 'كمبيوتر تجميع جيمنج RTX', catComputer, PCS, 18000, 21500, 14, [[PCS, 1, 21500]]],
    ['CMB-MON-24', 'شاشة 24 بوصة IPS', catComputer, PCS, 3500, 4200, 14, [[PCS, 1, 4200]]],
    ['CMB-KB-LOG', 'كيبورد وماوس لاسلكي', catComputer, PKT, 480, 650, 14, [[PKT, 1, 650], [BOX, 10, 6200]]],
    ['CMB-CAM-HIK-2MP', 'كاميرا مراقبة Hikvision 2MP', catCctv, PCS, 850, 1150, 14, [[PCS, 1, 1150], [BOX, 8, 8900]]],
    ['CMB-DVR-8CH', 'مسجل DVR 8 قنوات', catCctv, PCS, 1900, 2450, 14, [[PCS, 1, 2450]]],
    ['CMB-HDD-4TB', 'هارد تسجيل 4TB مراقبة', catCctv, PCS, 2600, 3200, 14, [[PCS, 1, 3200]]],
    ['CMB-NVR-16', 'مسجل شبكي NVR 16 قناة', catCctv, PCS, 4300, 5300, 14, [[PCS, 1, 5300]]],
    ['CMB-ACC-FACE', 'جهاز تحكم بالدخول بالوجه', catSecurity, PCS, 5800, 7200, 14, [[PCS, 1, 7200]]],
    ['CMB-ALARM-KIT', 'كيت إنذار سرقة 6 أقطاب', catSecurity, PKT, 3400, 4300, 14, [[PKT, 1, 4300]]],
    ['CMB-PRN-HP-LASER', 'طابعة HP LaserJet', catPrinters, PCS, 4200, 4950, 14, [[PCS, 1, 4950]]],
    ['CMB-TONER-85A', 'تونر 85A أصلي', catPrinters, PCS, 450, 620, 14, [[PCS, 1, 620], [BOX, 6, 3550]]],
    ['CMB-ROLL-80', 'رول كاشير 80مم', catPaper, PKT, 95, 135, 14, [[PKT, 1, 135], [BOX, 50, 6300]]],
    ['CMB-KRAFT-ROLL', 'رول كرافت تغليف 60سم', catPaper, PCS, 210, 290, 14, [[PCS, 1, 290], [BOX, 6, 1650]]],
    ['CMB-BAG-KRAFT', 'أكياس كرافت مقاس وسط', catPaper, BOX, 180, 260, 14, [[BOX, 1, 260]]],
    ['CMB-STICK-A4', 'استيكر A4 للتغليف', catPaper, BOX, 145, 200, 14, [[BOX, 1, 200]]],
    ['CMB-MOB-IP15', 'iPhone 15 128GB', catMobiles, PCS, 38000, 42500, 14, [[PCS, 1, 42500]]],
    ['CMB-MOB-A55', 'Samsung Galaxy A55', catMobiles, PCS, 14500, 16800, 14, [[PCS, 1, 16800]]],
    ['CMB-MOB-R13C', 'Xiaomi Redmi 13C', catMobiles, PCS, 6500, 7600, 14, [[PCS, 1, 7600]]],
    ['CMB-ACC-CHG20', 'شاحن سريع 20W أصلي', catAccessories, PCS, 180, 260, 14, [[PCS, 1, 260], [BOX, 20, 4800]]],
    ['CMB-ACC-CASE', 'جراب موبايل مقاوم', catAccessories, PCS, 45, 85, 14, [[PCS, 1, 85], [BOX, 30, 2300]]],
    ['CMB-ACC-GLASS', 'شاشة حماية زجاج', catAccessories, PCS, 25, 50, 14, [[PCS, 1, 50], [BOX, 50, 2200]]],
    ['CMB-ACC-PWB', 'باور بانك 10000mAh', catAccessories, PCS, 350, 480, 14, [[PCS, 1, 480], [BOX, 10, 4500]]],
    ['CMB-ACC-BT', 'هيدفون بلوتوث', catAccessories, PCS, 420, 580, 14, [[PCS, 1, 580]]],
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
          unitId, factor, sellPrice: price, buyPrice: Math.round(costPrice * factor * 100) / 100,
          isDefault: index === 0,
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
    ['مطعم كشري المصري', '01211111105', 'المقطم، شارع 9', 60000, 2],
    ['مركز Classe الطبي', '01211111106', 'المعادي، شارع 161', 300000, 1],
    ['متجر Horizon للإلكترونيات', '01211111107', 'مدينة نصر', 400000, 1],
    ['عميل نقدي — د. هالة', '01000000000', 'المقطم', 30000, 2],
  ];
  const customerIds = { main: [], mobile: [] };
  for (const [name, phone, address, creditLimit, branch] of customers) {
    const party = await call('POST', '/parties', {
      name, partyType: 1, phone, address, creditLimit, isActive: true,
      taxNumber: name.includes('شركة') || name.includes('مركز') ? '345-678-901' : null,
    });
    (branch === 1 ? customerIds.main : customerIds.mobile).push(party.partyId);
  }
  const suppliers = [
    ['الموزع المعتمد — Dell/HP مصر', '01222222201', 'القاهرة، عبد العزيز', 400000, 1],
    ['مورد كاميرات الأمان العالمي', '01222222202', 'القاهرة، وسط البلد', 350000, 1],
    ['مصنع الورق والتغليف النيل', '01222222203', 'الإسكندرية', 250000, 1],
    ['موزع موبايلات الدلتا', '01222222204', 'القاهرة، العتبة', 500000, 2],
  ];
  const supplierIds = { main: [], mobile: [] };
  for (const [name, phone, address, creditLimit, branch] of suppliers) {
    const party = await call('POST', '/parties', {
      name, partyType: 2, phone, address, creditLimit, isActive: true,
    });
    (branch === 1 ? supplierIds.main : supplierIds.mobile).push(party.partyId);
  }

  // ---------------- price lists ----------------
  const wholesale = await call('POST', '/pricing/lists', {
    name: 'أسعار الجملة — الشركات والمكاتب', code: 'CMB-WHOLESALE', listType: 2, priority: 30, discountPct: 8,
  });
  await call('POST', `/pricing/lists/${wholesale.priceListId}/lines`, {
    lines: created.slice(0, 15).map((item) => ({
      itemId: item.itemId, unitId: item.baseUnitId,
      price: Math.round(item.sellPrice * 0.92 * 100) / 100,
    })),
  });

  // ---------------- purchases (planned after the sales plan below, so the
  // stock always covers the whole month — no mid-demo stock-outs) -------------
  async function purchase(branch, warehouseId, supplierId, bank, days, codes, needMap) {
    const lines = codes
      .map((code) => {
        const item = byCode(code);
        return { item, need: needMap.get(item.itemId) ?? 0 };
      })
      .filter((row) => row.need > 0)
      .map((row) => ({
        itemId: row.item.itemId, unitId: row.item.baseUnitId,
        // every code list is disjoint, so each purchase must cover its share in full
        quantity: Math.ceil(row.need) + 6,
        unitPrice: row.item.costPrice, discountPct: 0, taxPct: row.item.vatPct,
      }));
    if (!lines.length) return;
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId: branch, warehouseId, partyId: supplierId,
      paymentType: 3, cashAccountId: bank, paidAmount: Math.round(total * 0.5 * 100) / 100,
      invoiceDate: daysAgo(days), lines, notes: 'توريد بضاعة — CompuMob',
    }, branch);
  }

  // Branch split matches the categories: main = computer/cctv/security/printers/paper
  // (indexes 0-15), mobile branch = phones/accessories/spares (indexes 16-26).
  const mainCodes = items.slice(0, 16).map((row) => row[0]);
  const mobileCodes = items.slice(16).map((row) => row[0]);

  function makeSaleLines(branchCodes, lineCount) {
    const lines = [];
    for (let l = 0; l < lineCount; l += 1) {
      const item = byCode(pick(branchCodes));
      const useBigUnit = random() > 0.8 && item.unitRows.length > 1;
      const [unitId, , price] = useBigUnit ? item.unitRows[1] : item.unitRows[0];
      const factor = useBigUnit ? item.unitRows[1][1] : 1;
      lines.push({
        itemId: item.itemId, unitId, factor,
        quantity: factor > 6 ? between(1, 2) : price > 15000 ? between(1, 2) : between(1, 6),
        unitPrice: price,
        discountPct: random() > 0.85 ? 5 : 0,
        taxPct: item.vatPct,
      });
    }
    return lines;
  }

  function settle(total, drawer, card) {
    const roll = random();
    const payments = [];
    let paidAmount = 0;
    if (roll < 0.5) {
      payments.push({ method: 1, amount: Math.round(total * 100) / 100, cashAccountId: drawer.cashAccountId });
      paidAmount = total;
    } else if (roll < 0.7) {
      const cashPart = Math.round(total * 0.5 * 100) / 100;
      payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
      paidAmount = cashPart;
    } else if (card && roll < 0.85) {
      const cashPart = Math.round(total * 0.4 * 100) / 100;
      payments.push({ method: 1, amount: cashPart, cashAccountId: drawer.cashAccountId });
      payments.push({ method: 2, amount: Math.round((total - cashPart) * 100) / 100, cashAccountId: card.cashAccountId });
      paidAmount = total;
    }
    return { payments, paidAmount };
  }

  // ---------------- plan the month of sales first ----------------
  const salesPlan = [];
  for (let day = 29; day >= 0; day -= 1) {
    for (const branch of [branchMain, branchMobile]) {
      if (random() < 0.25) continue;
      const isMain = branch === branchMain;
      const branchCodes = isMain ? mainCodes : mobileCodes;
      const drawer = isMain ? drawerMain : drawerMobile;
      const card = isMain ? cardAccount : null;
      const party = pick(isMain ? customerIds.main : customerIds.mobile);
      const warehouseId = isMain ? whMain : whMobile;
      const lines = makeSaleLines(branchCodes, between(1, 5));
      const gross = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPct / 100), 0);
      const tax = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice * (1 - line.discountPct / 100) * (line.taxPct / 100), 0);
      const total = gross + tax;
      const { payments, paidAmount } = settle(total, drawer, card);
      salesPlan.push({ branch, isMain, party, warehouseId, drawer, card, lines, total, payments, paidAmount, day });
    }
  }

  // ---------------- purchases that cover exactly what the plan needs ----------------
  // Per-branch needs: stock lives in each branch's own warehouse, so every
  // branch must be stocked for exactly what ITS sales plan (plus maintenance
  // inspections) consumes.
  const neededMain = new Map();
  const neededMobile = new Map();
  for (const sale of salesPlan) {
    const map = sale.isMain ? neededMain : neededMobile;
    for (const line of sale.lines) {
      map.set(line.itemId, (map.get(line.itemId) ?? 0) + line.quantity * line.factor);
    }
  }
  // maintenance inspections consume spare parts on top of the sales plan
  const addNeed = (map, code, qty) => {
    const item = byCode(code);
    map.set(item.itemId, (map.get(item.itemId) ?? 0) + qty);
  };
  addNeed(neededMain, 'CMB-SPR-SSD-512', 1);   // laptop repair at المعادي
  addNeed(neededMobile, 'CMB-SPR-SCR-MB', 1);  // phone repair at المقطم
  addNeed(neededMobile, 'CMB-SPR-BAT-MB', 1);
  // the confirmed sales order reserves stock on top of the sales plan
  for (const orderCode of ['CMB-LAP-DELL-I7', 'CMB-MON-24', 'CMB-PRN-HP-LASER']) {
    addNeed(neededMain, orderCode, 3);
  }
  await purchase(branchMain, whMain, supplierIds.main[0], bankNbe.cashAccountId, 28,
    ['CMB-LAP-DELL-I7', 'CMB-PC-GAMER-1', 'CMB-MON-24', 'CMB-KB-LOG', 'CMB-PRN-HP-LASER', 'CMB-TONER-85A', 'CMB-SPR-SSD-512'], neededMain);
  await purchase(branchMain, whMain, supplierIds.main[1], bankCib.cashAccountId, 24,
    ['CMB-CAM-HIK-2MP', 'CMB-DVR-8CH', 'CMB-HDD-4TB', 'CMB-NVR-16', 'CMB-ACC-FACE', 'CMB-ALARM-KIT'], neededMain);
  await purchase(branchMain, whMain, supplierIds.main[2], bankNbe.cashAccountId, 20,
    ['CMB-ROLL-80', 'CMB-KRAFT-ROLL', 'CMB-BAG-KRAFT', 'CMB-STICK-A4'], neededMain);
  await purchase(branchMobile, whMobile, supplierIds.mobile[0], bankCairo.cashAccountId, 26,
    ['CMB-MOB-IP15', 'CMB-MOB-A55', 'CMB-MOB-R13C'], neededMobile);
  await purchase(branchMobile, whMobile, supplierIds.mobile[0], bankCairo.cashAccountId, 18,
    ['CMB-ACC-CHG20', 'CMB-ACC-CASE', 'CMB-ACC-GLASS', 'CMB-ACC-PWB', 'CMB-ACC-BT', 'CMB-SPR-SCR-MB', 'CMB-SPR-BAT-MB', 'CMB-SPR-SSD-512'], neededMobile);

  // ---------------- execute the sales plan ----------------
  const cashCategories = await call('GET', '/treasury/categories');
  const depositCategory = cashCategories.find((c) => c.direction === 1);

  let salesCount = 0;
  for (const sale of salesPlan) {
    await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId: sale.branch, warehouseId: sale.warehouseId, partyId: sale.party,
      paymentType: sale.paidAmount >= sale.total - 0.01 ? 1 : sale.paidAmount > 0 ? 3 : 2,
      cashAccountId: sale.drawer.cashAccountId,
      paidAmount: Math.round(sale.paidAmount * 100) / 100,
      payments: sale.payments.length ? sale.payments : undefined,
      invoiceDate: daysAgo(sale.day),
      lines: sale.lines, notes: '',
    }, sale.branch);
    salesCount += 1;
  }

  // ---------------- bank deposits + wallet receipts ----------------
  for (let day = 29; day >= 0; day -= 1) {
    if (random() > 0.6 && depositCategory) {
      await call('POST', '/treasury/transactions', {
        cashAccountId: bankNbe.cashAccountId, direction: 1,
        categoryId: depositCategory.categoryId, amount: between(3000, 12000),
        description: 'إيداع نقدية — فرع المعادي', transactionDate: daysAgo(day),
      });
    }
    if (random() > 0.7 && depositCategory) {
      await call('POST', '/treasury/transactions', {
        cashAccountId: bankCairo.cashAccountId, direction: 1,
        categoryId: depositCategory.categoryId, amount: between(2000, 9000),
        description: 'إيداع نقدية — فرع المقطم', transactionDate: daysAgo(day),
      });
    }
  }

  // ---------------- receipt voucher settling a credit invoice ----------------
  const creditSales = await call('GET', '/sales/invoices?type=1&pageSize=200', undefined, branchMain);
  const openInvoice = (creditSales.items ?? [])
    .filter((row) => row.partyId && Number(row.paidAmount) < Number(row.totalAmount))
    .sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))[0];
  if (openInvoice) {
    const remaining = Number(openInvoice.remaining ?? 0);
    const amount = Math.round(remaining * 0.5 * 100) / 100;
    if (amount > 0) {
      await call('POST', '/accounting/vouchers', {
        voucherType: 1, partyId: openInvoice.partyId,
        cashAccountId: bankNbe.cashAccountId, amount, paymentMethod: 3,
        description: 'تحصيل دفعة من عميل — تحويل بنكي',
        allocations: [{ invoiceId: openInvoice.invoiceId, amount }],
      }, branchMain);
    }
  }

  // ---------------- maintenance: products, models, tickets ----------------
  const prodLaptop = await call('POST', '/maintenance/products', { name: 'لابتوب' });
  const prodMobile = await call('POST', '/maintenance/products', { name: 'موبايل' });
  const prodPrinter = await call('POST', '/maintenance/products', { name: 'طابعة' });
  const modelDell = await call('POST', '/maintenance/models', { productId: prodLaptop.productId, name: 'Dell Latitude 5520' });
  await call('POST', '/maintenance/models', { productId: prodPrinter.productId, name: 'HP LaserJet M1136' });
  const modelIPhone = await call('POST', '/maintenance/models', { productId: prodMobile.productId, name: 'iPhone 13' });

  const ticketMain = await call('POST', '/maintenance/tickets', {
    customerName: 'مكتب الأهرام للمحاسبة', phone: '01211111101',
    productId: prodLaptop.productId, modelId: modelDell.modelId,
    productCondition: 'لا يعمل بالشاحن', customerNotes: 'البطارية لا تشحن',
    estimatedCost: 1200, paidAmount: 400, cashAccountId: drawerMain.cashAccountId,
  }, branchMain);
  await call('POST', `/maintenance/tickets/${ticketMain.ticketId}/inspect`, {
    engineerId: staff.engineer1.userId, inspectionStatus: 3,
    checkReport: 'تالف البطارية — استبدال', actualCost: 900,
    parts: [{ itemId: byCode('CMB-SPR-SSD-512').itemId, quantity: 1 }],
  }, branchMain);

  const ticketMobile = await call('POST', '/maintenance/tickets', {
    customerName: 'عميل نقدي — د. هالة', phone: '01000000000',
    productId: prodMobile.productId, modelId: modelIPhone.modelId,
    productCondition: 'الشاشة مكسورة', customerNotes: 'سقوط بالمياه',
    estimatedCost: 2600, paidAmount: 500, cashAccountId: drawerMobile.cashAccountId,
  }, branchMobile);
  await call('POST', `/maintenance/tickets/${ticketMobile.ticketId}/inspect`, {
    engineerId: staff.engineer2.userId, inspectionStatus: 3,
    checkReport: 'استبدال شاشة وبطارية', actualCost: 2100,
    parts: [
      { itemId: byCode('CMB-SPR-SCR-MB').itemId, quantity: 1 },
      { itemId: byCode('CMB-SPR-BAT-MB').itemId, quantity: 1 },
    ],
  }, branchMobile);

  // ---------------- quotation + sales order ----------------
  const quotation = await call('POST', '/quotations', {
    partyId: customerIds.main[1],
    validUntil: daysAgo(-14),
    notes: 'عرض سعر شبكة كاميرات — فيلا التجمع',
    lines: [byCode('CMB-CAM-HIK-2MP'), byCode('CMB-DVR-8CH'), byCode('CMB-HDD-4TB'), byCode('CMB-ACC-FACE')]
      .map((item) => ({
        itemId: item.itemId, unitId: item.baseUnitId,
        quantity: between(2, 8), unitPrice: item.sellPrice, taxPct: item.vatPct,
      })),
  }, branchMain);

  const order = await call('POST', '/orders', {
    orderType: 1, partyId: customerIds.main[0], warehouseId: whMain,
    expectedDate: daysAgo(-7), notes: 'توريد مكتب محاسبة',
    lines: [byCode('CMB-LAP-DELL-I7'), byCode('CMB-MON-24'), byCode('CMB-PRN-HP-LASER')]
      .map((item) => ({
        itemId: item.itemId, unitId: item.baseUnitId,
        quantity: between(1, 3), unitPrice: item.sellPrice, taxPct: item.vatPct,
      })),
  }, branchMain);
  await call('POST', `/orders/${order.orderId}/status`, { status: 2 }, branchMain);

  // ---------------- company identity ----------------
  await call('PUT', '/admin/settings', {
    CompanyName: 'CompuMob — كمبيوتر وكاميرات وأنظمة أمنية',
    CompanyPhone: '0223807000',
    CompanyAddress: 'المعادي، شارع 9، القاهرة',
    InvoiceFooter: 'شكراً لتعاملكم مع CompuMob — ضمان الصيانة 30 يوم',
  });

  console.log('[demo] تم إنشاء ديمو CompuMob:');
  console.log(`   - فرعان: MAIN (كمبيوتر/كاميرات/أمن/طباعة وتغليف) + CP2 (موبايل)`);
  console.log(`   - 6 موظفين/مستخدمين — كلمة سر المستخدمين: Demo@1234`);
  console.log(`   - خزائن: درجان نقديان + بنك أهلي + CIB + بنك القاهرة + بطاقات + V.Cash`);
  console.log(`   - ${created.length} صنف · ${customers.length} عميل · ${suppliers.length} مورد`);
  console.log(`   - ${salesCount} فاتورة بيع خلال 30 يوم على الفرعين`);
  console.log(`   - تذكرتا صيانة + عرض سعر + أمر بيع + إيداعات بنكية`);
  console.log(`   - الدخول: admin / admin123`);
}

main().catch((error) => {
  console.error('[demo] فشل:', error.message);
  process.exit(1);
});
