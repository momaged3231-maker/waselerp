/*
 * CompuMob — كومبوموب للتجارة — demo dataset (all numbers whole integers).
 *
 * Business: كمبيوتر، لابتوب، ماك بوك، صيانة، موبايلات، إكسسوارات، شبكات،
 * أنظمة أمنية (كاميرات)، ورق طباعة وطباعة، تغليف هدايا.
 *
 * Two branches, both owned by علاء:
 *   فرع المعادي  — كمبيوتر وإكسسوار (MAIN)
 *   فرع المقطم   — موبايل وإكسسوار  (CP2)
 *
 * Staff (6) + علاء (owner/admin):
 *   أحمد صابر (صيانة) · محمود القاضي (فني كاميرات) · عمر حاتم (فني كاميرات)
 *   سارة النمر (كاشيرة فرع المعادي) · منة أشرف (كاشير فرع المقطم) · ياسمين شفيق (كاشيرة فرع المقطم)
 *
 * Run on a FRESH database:
 *   node tools/pg/run-sql.js wasel db/reset-dev-data.sql
 *   node tools/demo-compumob.js
 */
const path = require('path');
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

let token = null;
let activeBranch = null;

async function call(method, path, body, branchHeader) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  headers['x-branch-id'] = String(branchHeader ?? activeBranch ?? 1);
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} (branch ${branchHeader ?? activeBranch}) -> ${response.status} ${JSON.stringify(data)}`);
  return data;
}

const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

/** Fixture SQL — same pattern as tools/pg/run-sql.js. Runs before the API work. */
async function sql(statements) {
  const { Client } = require(path.resolve(process.cwd(), 'apps/api/node_modules/pg'));
  const client = new Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:5432/wasel' });
  await client.connect();
  try {
    for (const s of statements) await client.query(s);
  } finally {
    await client.end();
  }
}

async function main() {
  // ---- fixture SQL: امسح الـ seed القديم نظافة تامة ----
  // The reset script keeps branches/users/settings/categories — wipe the leftovers we are replacing.
  await sql([
    'DELETE FROM categories',
    "UPDATE branches SET name = 'فرع المعادي — كمبيوتر وإكسسوار' WHERE branch_id = 1",
    "UPDATE users SET full_name = 'علاء مالك (المالك)' WHERE user_id = 1",
    "UPDATE cash_accounts SET name = 'خزينة فرع المعادي' WHERE cash_account_id = 1",
    // idempotent re-run: wipe the partial branch-2 fixtures created by crashed passes
    "DELETE FROM warehouses WHERE code = 'WH-CP2'",
    "DELETE FROM cash_accounts WHERE name IN ('خزينة فرع المقطم', 'بنك القاهرة — فرع المقطم')",
    "UPDATE app_settings SET setting_value = 'false' WHERE setting_key = 'RequireRepOnSale'",
  ]);

  const login = await call('POST', '/auth/login', { userName: 'admin', password: 'admin123' });
  token = login.accessToken;
  activeBranch = login.activeBranchId ?? 1;

  // ---- company identity ----
  await call('PUT', '/admin/settings', {
    CompanyName: 'CompuMob — كومبوموب للتجارة',
    CompanyPhone: '01012345678',
    CompanyAddress: 'المعادي، شارع 9، القاهرة',
    TaxNumber: '345-678-901',
    InvoiceFooter: 'شكراً لتعاملكم معنا — CompuMob',
  });

  // ---- branch 2 (exists after a previous run; create otherwise) ----
  const branchList = await call('GET', '/admin/branches');
  let branch2 = (branchList ?? []).find((b) => b.code === 'CP2');
  if (!branch2) {
    branch2 = await call('POST', '/admin/branches', {
      code: 'CP2', name: 'فرع المقطم — موبايل وإكسسوار', isActive: true,
    });
  }
  const branch2Id = Number(branch2.branchId);

  // ---- warehouse for branch 2 ----
  const warehousesAll = await call('GET', '/catalog/warehouses', null, 1);
  let warehouse2Id = null;
  for (const wh of warehousesAll ?? []) {
    if (Number(wh.branchId) === branch2Id) warehouse2Id = wh.warehouseId;
  }
  if (!warehouse2Id) {
    const wh2 = await call('POST', '/catalog/warehouses', {
      branchId: branch2Id, code: 'WH-CP2', name: 'مخزن المقطم', isDefault: true, isActive: true,
    }, branch2Id);
    warehouse2Id = wh2.warehouseId;
  }

  // ---- cash accounts for branch 2 (created against branch 2 context) ----
  const accountsAfterReset = await call('GET', '/treasury/accounts', null, 1);
  const byBranch = (type) => (accountsAfterReset ?? []).find((a) => a.type === type && Number(a.branchId) === branch2Id);
  let branch2Cash = byBranch(1);
  let branch2Bank = byBranch(2);
  if (!branch2Cash) {
    branch2Cash = await call('POST', '/treasury/accounts', {
      name: 'خزينة فرع المقطم', type: 1, openingBalance: 25000,
    }, branch2Id);
  }
  if (!branch2Bank) {
    branch2Bank = await call('POST', '/treasury/accounts', {
      name: 'بنك القاهرة — فرع المقطم', type: 2,
      bankName: 'بنك القاهرة', accountNo: 'EG010000000000002200000001', openingBalance: 80000,
    }, branch2Id);
  }

  // ---- staff: 6 users (IDs are stable on fresh DB: 2..7) ----
  const staff = [
    ['ahmdsbr', 'أحمد صابر — فني صيانة', 5, 1],
    ['mhmudqd', 'محمود القاضي — فني كاميرات أول', 5, 1],
    ['umrmhtm', 'عمر حاتم — فني كاميرات ثانٍ', 5, branch2Id],
    ['sarnam', 'سارة النمر — كاشيرة', 3, 1],
    ['mnshrf', 'منة أشرف — كاشير فرع', 3, branch2Id],
    ['yasmshq', 'ياسمين شفيق — كاشيرة فرع', 3, branch2Id],
  ];
  const existingUsers = await call('GET', '/admin/users');
  const userByName = new Map((existingUsers ?? []).map((u) => [u.userName, u]));
  const staffUserIds = {};
  for (const [userName, fullName, roleId] of staff) {
    if (userByName.has(userName)) { staffUserIds[userName] = userByName.get(userName).userId; continue; }
    try {
      const created = await call('POST', '/admin/users', { userName, fullName, password: 'admin123', roleIds: [roleId] }, 1);
      staffUserIds[userName] = created.userId;
    } catch (e) {
      console.log('[compumob] تعذر إنشاء المستخدم', userName, e.message);
    }
  }

  // ---- categories (fresh after fixture wipe) ----
  const categoryNames = [
    'أجهزة كمبيوتر وشاشات', 'أجهزة ماك بوك', 'إكسسوارات كمبيوتر', 'بطاريات', 'أجهزة تخزين وذاكرة',
    'أجهزة شبكات', 'أنظمة أمنية وكاميرات', 'موبايلات', 'إكسسوارات موبايل', 'طباعة وورق',
    'منتجات تغليف', 'خدمات POS',
  ];
  const categoryIds = {};
  for (const name of categoryNames) {
    const created = await call('POST', '/catalog/categories', { name });
    categoryIds[name] = created.categoryId;
  }

  const units = await call('GET', '/catalog/units');
  const unit = (code) => units.find((u) => u.code === code)?.unitId ?? units[0].unitId;
  const PCS = unit('PCS');

  // ---- items: all whole numbers ----
  const items = [
    ['CPM-LT-E14', 'لابتوب لينوفو ثينك باد E14', 'أجهزة كمبيوتر وشاشات', 13000, 15500],
    ['CPM-LT-E840', 'لابتوب إتش بي إليت بوك 840 G8', 'أجهزة كمبيوتر وشاشات', 17000, 19800],
    ['CPM-LT-DELL5420', 'لابتوب Dell Latitude 5420', 'أجهزة كمبيوتر وشاشات', 15500, 18000],
    ['CPM-LT-HP245', 'لابتوب إتش بي 245 G9', 'أجهزة كمبيوتر وشاشات', 11500, 14000],
    ['CPM-PC-HP', 'كمبيوتر مكتبي HP (i5)', 'أجهزة كمبيوتر وشاشات', 14000, 16500],
    ['CPM-MON-27', 'شاشة Dell 27 بوصة', 'أجهزة كمبيوتر وشاشات', 4200, 5100],

    ['CPM-MB-PRO13', 'MacBook Pro 13', 'أجهزة ماك بوك', 42000, 49000],
    ['CPM-MB-AIR13', 'MacBook Air 13', 'أجهزة ماك بوك', 37000, 43000],
    ['CPM-MB-PRO16', 'MacBook Pro 16', 'أجهزة ماك بوك', 88000, 102000],

    ['CPM-ACC-MOUSE', 'ماوس لاسلكي', 'إكسسوارات كمبيوتر', 80, 150],
    ['CPM-ACC-KB', 'كيبورد لاسلكي', 'إكسسوارات كمبيوتر', 110, 200],
    ['CPM-ACC-BAG', 'حقيبة لابتوب', 'إكسسوارات كمبيوتر', 130, 240],
    ['CPM-ACC-SLEEVE', 'غلاف لابتوب 15.6', 'إكسسوارات كمبيوتر', 60, 120],
    ['CPM-ACC-STAND', 'ستند لابتوب ألومنيوم', 'إكسسوارات كمبيوتر', 180, 320],

    ['CPM-BAT-HP', 'بطارية لابتوب HP', 'بطاريات', 700, 1100],
    ['CPM-BAT-DELL', 'بطارية لابتوب Dell', 'بطاريات', 780, 1200],
    ['CPM-BAT-LN', 'بطارية لابتوب Lenovo', 'بطاريات', 650, 1000],
    ['CPM-BAT-MB', 'بطارية ماك بوك', 'بطاريات', 850, 1350],

    ['CPM-SSD-256', 'SSD 256GB', 'أجهزة تخزين وذاكرة', 1000, 1500],
    ['CPM-SSD-512', 'SSD 512GB', 'أجهزة تخزين وذاكرة', 1600, 2400],
    ['CPM-SSD-1TB', 'SSD 1TB', 'أجهزة تخزين وذاكرة', 2700, 3900],
    ['CPM-RAM-8', 'رام DDR4 8GB', 'أجهزة تخزين وذاكرة', 600, 900],
    ['CPM-RAM-16', 'رام DDR4 16GB', 'أجهزة تخزين وذاكرة', 1100, 1600],
    ['CPM-USB-64', 'فلاشة USB 64GB', 'أجهزة تخزين وذاكرة', 180, 300],

    ['CPM-NET-TPLINK', 'راوتر TP-Link', 'أجهزة شبكات', 900, 1350],
    ['CPM-NET-HUAWEI', 'راوتر Huawei', 'أجهزة شبكات', 750, 1150],
    ['CPM-NET-SW8', 'سويتش 8 منافذ', 'أجهزة شبكات', 520, 800],
    ['CPM-NET-SW16', 'سويتش 16 منفذ', 'أجهزة شبكات', 1300, 1900],
    ['CPM-NET-AP', 'أكسس بوينت', 'أجهزة شبكات', 750, 1150],
    ['CPM-NET-CAT6', 'كابل شبكات Cat6 (305 متر)', 'أجهزة شبكات', 2800, 4200],

    ['CPM-SEC-CAM1', 'كاميرا داخلية 2MP', 'أنظمة أمنية وكاميرات', 420, 750],
    ['CPM-SEC-CAM2', 'كاميرا خارجية 2MP مقاومة', 'أنظمة أمنية وكاميرات', 580, 950],
    ['CPM-SEC-CAM4', 'كاميرا 4MP', 'أنظمة أمنية وكاميرات', 750, 1200],
    ['CPM-SEC-CAM8', 'كاميرا 8MP', 'أنظمة أمنية وكاميرات', 1400, 2300],
    ['CPM-SEC-DVR', 'جهاز تسجيل DVR (4 قنوات)', 'أنظمة أمنية وكاميرات', 850, 1400],
    ['CPM-SEC-NVR', 'جهاز تسجيل NVR (8 قنوات)', 'أنظمة أمنية وكاميرات', 2400, 3600],
    ['CPM-SEC-HDD1', 'هارد مراقبة 1TB', 'أنظمة أمنية وكاميرات', 1500, 2200],
    ['CPM-SEC-HDD2', 'هارد مراقبة 2TB', 'أنظمة أمنية وكاميرات', 2700, 3800],
    ['CPM-SEC-PSU', 'مصدر كهرباء 12V', 'أنظمة أمنية وكاميرات', 180, 320],
    ['CPM-SEC-CBL', 'كابل كاميرا (100 متر)', 'أنظمة أمنية وكاميرات', 650, 1100],

    ['CPM-PH-IP15', 'آيفون 15', 'موبايلات', 35000, 42000],
    ['CPM-PH-IP15PRO', 'آيفون 15 برو', 'موبايلات', 45000, 54000],
    ['CPM-PH-S24', 'سامسونج S24', 'موبايلات', 28000, 33000],
    ['CPM-PH-S24U', 'سامسونج S24 ألترا', 'موبايلات', 40000, 47000],
    ['CPM-PH-A55', 'سامسونج A55', 'موبايلات', 13000, 15500],
    ['CPM-PH-RMNT13', 'شاومي Redmi Note 13', 'موبايلات', 9500, 11500],

    ['CPM-MAC-USBC', 'كابل USB-C سريع', 'إكسسوارات موبايل', 45, 80],
    ['CPM-MAC-CHG20', 'شاحن سريع 20W', 'إكسسوارات موبايل', 150, 220],
    ['CPM-MAC-MBCHG', 'شاحن ماك بوك 96W', 'إكسسوارات موبايل', 500, 750],
    ['CPM-MAC-PB10', 'باور بانك 10000', 'إكسسوارات موبايل', 520, 750],
    ['CPM-MAC-PB20', 'باور بانك 20000', 'إكسسوارات موبايل', 750, 1100],
    ['CPM-MAC-CAR', 'حامل هاتف (للسيارة)', 'إكسسوارات موبايل', 70, 130],
    ['CPM-MAC-HP', 'سماعة بلوتوث', 'إكسسوارات موبايل', 550, 950],
    ['CPM-MAC-CSIP15', 'كفر آيفون 15', 'إكسسوارات موبايل', 100, 200],
    ['CPM-MAC-CSS24', 'كفر سامسونج S24', 'إكسسوارات موبايل', 90, 180],
    ['CPM-MAC-SGS24', 'واقي شاشة سامسونج', 'إكسسوارات موبايل', 30, 65],
    ['CPM-MAC-SGIP', 'واقي شاشة آيفون', 'إكسسوارات موبايل', 35, 70],

    ['CPM-PRT-PAPER', 'ورق A4 (علبة 5000 صفحة)', 'طباعة وورق', 550, 850],
    ['CPM-PRT-REAM', 'ورق A4 (رزمة 500 صفحة)', 'طباعة وورق', 65, 100],
    ['CPM-PRT-HP', 'حبر HP أسود', 'طباعة وورق', 350, 550],
    ['CPM-PRT-HPC', 'حبر HP ملون', 'طباعة وورق', 480, 750],
    ['CPM-PRT-T26A', 'تونر HP 26A', 'طباعة وورق', 650, 1150],
    ['CPM-PRT-TBR', 'تونر Brother', 'طباعة وورق', 520, 950],
    ['CPM-PRT-CPA4', 'ورق طباعة ملون A4 (علبة)', 'طباعة وورق', 620, 950],

    ['CPM-WRP-TAPE', 'رول شريط سيلوي', 'منتجات تغليف', 25, 55],
    ['CPM-WRP-WP', 'ورق تغليف ملون رول', 'منتجات تغليف', 100, 200],
    ['CPM-WRP-BAGS', 'أكياس تغليف صغيرة', 'منتجات تغليف', 20, 45],
    ['CPM-WRP-BAGM', 'أكياس تغليف متوسطة', 'منتجات تغليف', 30, 65],
    ['CPM-WRP-BAGL', 'أكياس تغليف كبيرة', 'منتجات تغليف', 45, 90],
    ['CPM-WRP-SH', 'شنط هدايا صغيرة', 'منتجات تغليف', 12, 28],
    ['CPM-WRP-SHM', 'شنط هدايا متوسطة', 'منتجات تغليف', 20, 48],
    ['CPM-WRP-SHL', 'شنط هدايا كبيرة', 'منتجات تغليف', 35, 70],
    ['CPM-WRP-PACK', 'شريط كارتون', 'منتجات تغليف', 45, 80],
    ['CPM-WRP-STK', 'ملصقات لاصقة', 'منتجات تغليف', 25, 60],
  ];

  const created = [];
  for (const [code, name, category, cost, sell] of items) {
    const saved = await call('POST', '/items', {
      code, name, categoryId: categoryIds[category], baseUnitId: PCS,
      costPrice: cost, sellPrice: sell, vatPct: 0, reorderPoint: 3,
    });
    created.push({ itemId: saved.itemId, code, name, category, cost, sell });
  }

  // ---- POS service items (sold at the counter, no stock) ----
  const services = [
    ['CPM-SVC-PW', 'طباعة صفحة (أسود)', 'خدمات POS', 0, 2],
    ['CPM-SVC-PC', 'طباعة صفحة (ملون)', 'خدمات POS', 0, 5],
    ['CPM-SVC-COPY', 'تصوير صفحة', 'خدمات POS', 0, 1],
    ['CPM-SVC-PHOTO', 'طباعة صورة 10×15', 'خدمات POS', 0, 15],
    ['CPM-SVC-A4P', 'طباعة صورة A4', 'خدمات POS', 0, 25],
    ['CPM-SVC-WRPS', 'تغليف هدية صغيرة', 'خدمات POS', 0, 20],
    ['CPM-SVC-WRPM', 'تغليف هدية متوسطة', 'خدمات POS', 0, 30],
    ['CPM-SVC-WRPL', 'تغليف هدية كبيرة', 'خدمات POS', 0, 50],
  ];
  for (const [code, name, category, cost, sell] of services) {
    const saved = await call('POST', '/items', {
      code, name, categoryId: categoryIds[category], baseUnitId: PCS,
      costPrice: 0, sellPrice: sell, vatPct: 0, isService: true,
    });
    created.push({ itemId: saved.itemId, code, name, category, cost, sell });
  }

  const byCode = (code) => created.find((item) => item.code === code);

  // ---- branch 1 cash accounts: discover + rename originals ----
  const accounts = await call('GET', '/treasury/accounts', null, 1);
  const drawer1 = (accounts ?? []).find((a) => a.type === 1 && Number(a.branchId) === 1);
  const cardAccount = (accounts ?? []).find((a) => a.type === 3 && Number(a.branchId) === 1);

  // ---- parties ----
  const customers = [
    ['شركة النور للمقاولات', '01223456780', 'المعادي، شارع 21', 500000],
    ['سمارت سيكيورتي هوم', '01098765432', 'مدينة نصر، شارع عباس', 800000],
    ['محل التكنولوجيا الحديثة', '01123456789', 'المعادي، شارع 9', 300000],
    ['شركة التقنية الحديثة', '01287654321', 'التجمع الخامس', 600000],
    ['مركز الصيانة الذهبي', '01034567891', 'المعادي، شارع 9', 150000],
    ['منزل أم أحمد', '01555555555', 'الجيزة، الهرم', 0],
    ['محل عبد العزيز للموبايل', '01012345678', 'المعادي، شارع 50', 250000],
    ['علي محمد — ماك بوك', '01176543210', 'الجيزة، الدقي', 0],
  ];
  const customerIds = [];
  for (const [name, phone, address, creditLimit] of customers) {
    const createdParty = await call('POST', '/parties', {
      name, partyType: 1, phone, address, creditLimit, isActive: true,
    }, 1);
    customerIds.push(createdParty.partyId);
  }

  const suppliers = [
    ['شركة النصر للإلكترونيات', '01099887766', 'الجيزة، الهرم', 800000],
    ['توزيعة مصر للموبايل', '01288776655', 'القاهرة، مدينة نصر', 500000],
    ['شركة شبكة الجيزة للكاميرات', '01177665544', 'الجيزة، الهرم', 400000],
    ['توزيعة المعادي للكمبيوتر', '01066554433', 'المعادي، شارع 9', 300000],
  ];
  const supplierIds = [];
  for (const [name, phone, address, creditLimit] of suppliers) {
    const createdParty = await call('POST', '/parties', {
      name, partyType: 2, phone, address, creditLimit, isActive: true,
    }, 1);
    supplierIds.push(createdParty.partyId);
  }

  const warehousesBranch1 = (await call('GET', '/catalog/warehouses', null, 1)) ?? [];
  const warehouse1 = warehousesBranch1.find((w) => Number(w.branchId) === 1)?.warehouseId;

  // ---------- sales plans (branch 1 + branch 2), used to size purchases ----------
  const salesPlan = [
    [29, 0, [[0, 1, PCS], [5, 1, PCS], [9, 1, PCS], [33, 2, PCS], [34, 1, PCS]]],
    [27, 3, [[11, 3, PCS], [9, 4, PCS], [13, 2, PCS]]],
    [26, 1, [[31, 2, PCS], [35, 4, PCS], [37, 8, PCS], [38, 12, PCS], [30, 1, PCS], [32, 1, PCS]]],
    [24, 5, [[1, 1, PCS], [0, 1, PCS], [44, 1, PCS], [24, 2, PCS], [10, 1, PCS]]],
    [22, 2, [[18, 2, PCS], [22, 1, PCS], [21, 1, PCS], [27, 2, PCS]]],
    [21, 6, [[41, 1, PCS], [45, 1, PCS]]],
    [19, 1, [[30, 4, PCS], [35, 2, PCS], [38, 10, PCS], [36, 2, PCS], [39, 5, PCS]]],
    [18, 7, [[2, 1, PCS], [3, 1, PCS]]],
    [16, 0, [[37, 4, PCS], [34, 2, PCS]]],
    [14, 3, [[27, 4, PCS], [9, 2, PCS], [13, 3, PCS], [25, 6, PCS], [26, 2, PCS]]],
    [12, 6, [[40, 2, PCS], [41, 1, PCS], [43, 5, PCS]]],
    [11, 1, [[33, 1, PCS], [32, 2, PCS], [37, 2, PCS], [34, 4, PCS], [35, 4, PCS], [39, 8, PCS]]],
    [9, 2, [[5, 1, PCS], [18, 1, PCS], [22, 2, PCS], [24, 1, PCS]]],
    [8, 5, [[62, 1, PCS], [67, 2, PCS], [70, 3, PCS], [72, 2, PCS]]],
    [7, 4, [[56, 1, PCS], [59, 2, PCS], [57, 1, PCS], [55, 2, PCS]]],
    [6, 7, [[0, 2, PCS], [4, 1, PCS]]],
    [5, 3, [[52, 1, PCS], [51, 1, PCS]]],
    [4, 1, [[35, 4, PCS], [36, 1, PCS], [34, 4, PCS], [37, 8, PCS]]],
    [3, 2, [[9, 3, PCS], [27, 2, PCS], [24, 2, PCS], [10, 1, PCS]]],
    [2, 6, [[40, 1, PCS], [41, 1, PCS], [46, 2, PCS]]],
    [1, 0, [[33, 4, PCS], [38, 8, PCS], [37, 4, PCS]]],
    [0, 5, [[76, 1, PCS], [77, 1, PCS]]],
  ];

  const cp2SalesPlan = [
    [28, 6, [[42, 1, PCS], [48, 2, PCS]]],
    [25, 6, [[46, 1, PCS], [50, 1, PCS], [47, 1, PCS], [49, 2, PCS]]],
    [21, 7, [[44, 1, PCS], [45, 1, PCS]]],
    [17, 7, [[41, 1, PCS], [50, 1, PCS]]],
    [13, 6, [[42, 1, PCS], [48, 1, PCS], [49, 1, PCS], [47, 1, PCS], [45, 1, PCS]]],
    [8, 7, [[46, 1, PCS], [42, 1, PCS]]],
    [2, 6, [[41, 1, PCS], [48, 2, PCS]]],
  ];

  // ---------- compute stock needed (branch 1 from salesPlan, branch 2 from cp2SalesPlan) ----------
  // branch 1 needs enough for its own sales; branch 2 buys its own stock separately
  const b1Needed = new Map();
  for (const [, , lines] of salesPlan) {
    for (const [idx, qty] of lines) {
      b1Needed.set(idx, (b1Needed.get(idx) ?? 0) + qty);
    }
  }
  const b2Needed = new Map();
  for (const [, , lines] of cp2SalesPlan) {
    for (const [idx, qty] of lines) {
      b2Needed.set(idx, (b2Needed.get(idx) ?? 0) + qty);
    }
  }

  // ---------- base stock: touch every item so the demo looks full ----------
  const baseStock = created.map((item) => ({
    itemId: item.itemId, unitId: PCS,
    quantity:
      item.category === 'أجهزة ماك بوك' ? 1 :
      item.category === 'موبايلات' ? 2 :
      item.category === 'أجهزة كمبيوتر وشاشات' ? 3 :
      item.category === 'أنظمة أمنية وكاميرات' ? 6 :
      item.category === 'أجهزة شبكات' ? 8 : 6,
    unitPrice: item.cost, discountPct: 0, taxPct: 0,
  }));
  const baseTotal = baseStock.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  await call('POST', '/sales/invoices', {
    invoiceType: 2, branchId: 1, warehouseId: warehouse1,
    partyId: supplierIds[0], paymentType: 1, cashAccountId: drawer1?.cashAccountId ?? 1,
    paidAmount: Math.floor(baseTotal * 0.8), invoiceDate: daysAgo(20), lines: baseStock, notes: 'تشكيل المخزون الافتتاحي',
  }, 1);

  // ---------- buy for branch 1 (4 batches over time) ----------
  const b1Batches = [
    { days: 25, supplierIndex: 0, share: 0.4 },
    { days: 17, supplierIndex: 1, share: 0.25 },
    { days: 10, supplierIndex: 2, share: 0.2 },
    { days: 4, supplierIndex: 3, share: 0.15 },
  ];
  for (const batch of b1Batches) {
    const slice = [...b1Needed.entries()].map(([idx, qty]) => ({
      itemId: created[idx].itemId, unitId: PCS,
      quantity: Math.ceil(qty * (1 + batch.share * 1.2)), // 20% buffer above needed
      unitPrice: created[idx].cost, discountPct: 0, taxPct: 0,
    })).filter((l) => l.quantity > 0);
    const total = slice.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId: 1, warehouseId: warehouse1,
      partyId: supplierIds[batch.supplierIndex],
      paymentType: 1, cashAccountId: drawer1?.cashAccountId ?? 1,
      paidAmount: Math.floor(total * 0.7), invoiceDate: daysAgo(batch.days), lines: slice, notes: 'توريد',
    }, 1);
  }

  // ---------- buy for branch 2 ----------
  if (warehouse2Id) {
    const slice = [...b2Needed.entries()].map(([idx, qty]) => ({
      itemId: created[idx].itemId, unitId: PCS,
      quantity: Math.ceil(qty * 1.5), // generous buffer, small quantities
      unitPrice: created[idx].cost, discountPct: 0, taxPct: 0,
    })).filter((l) => l.quantity > 0);
    const total = slice.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    await call('POST', '/sales/invoices', {
      invoiceType: 2, branchId: branch2Id, warehouseId: warehouse2Id,
      partyId: supplierIds[1], paymentType: 1,
      cashAccountId: branch2Cash.cashAccountId ?? branch2Cash,
      paidAmount: Math.floor(total * 0.7), invoiceDate: daysAgo(15), lines: slice, notes: 'توريد فرع المقطم',
    }, branch2Id);
  }

  // ---- sales last 30 days (branch 1) ----
  const branch1Drawer = drawer1?.cashAccountId ?? null;
  const cardAccountId = cardAccount?.cashAccountId ?? null;
  const sales = [
    [29, 0, [[0, 1, PCS], [5, 1, PCS], [9, 1, PCS], [33, 2, PCS], [34, 1, PCS]]],
    [27, 3, [[11, 3, PCS], [9, 4, PCS], [13, 2, PCS]]],
    [26, 1, [[31, 2, PCS], [35, 4, PCS], [37, 8, PCS], [38, 12, PCS], [30, 1, PCS], [32, 1, PCS]]],
    [24, 5, [[1, 1, PCS], [0, 1, PCS], [44, 1, PCS], [24, 2, PCS], [10, 1, PCS]]],
    [22, 2, [[18, 2, PCS], [22, 1, PCS], [21, 1, PCS], [27, 2, PCS]]],
    [21, 6, [[41, 1, PCS], [45, 1, PCS]]],
    [19, 1, [[30, 4, PCS], [35, 2, PCS], [38, 10, PCS], [36, 2, PCS], [39, 5, PCS]]],
    [18, 7, [[2, 1, PCS], [3, 1, PCS]]],
    [16, 0, [[37, 4, PCS], [34, 2, PCS]]],
    [14, 3, [[27, 4, PCS], [9, 2, PCS], [13, 3, PCS], [25, 6, PCS], [26, 2, PCS]]],
    [12, 6, [[40, 2, PCS], [41, 1, PCS], [43, 5, PCS]]],
    [11, 1, [[33, 1, PCS], [32, 2, PCS], [37, 2, PCS], [34, 4, PCS], [35, 4, PCS], [39, 8, PCS]]],
    [9, 2, [[5, 1, PCS], [18, 1, PCS], [22, 2, PCS], [24, 1, PCS]]],
    [8, 5, [[62, 1, PCS], [67, 2, PCS], [70, 3, PCS], [72, 2, PCS]]],
    [7, 4, [[56, 1, PCS], [59, 2, PCS], [57, 1, PCS], [55, 2, PCS]]],
    [6, 7, [[0, 2, PCS], [4, 1, PCS]]],
    [5, 3, [[52, 1, PCS], [51, 1, PCS]]],
    [4, 1, [[35, 4, PCS], [36, 1, PCS], [34, 4, PCS], [37, 8, PCS]]],
    [3, 2, [[9, 3, PCS], [27, 2, PCS], [24, 2, PCS], [10, 1, PCS]]],
    [2, 6, [[40, 1, PCS], [41, 1, PCS], [46, 2, PCS]]],
    [1, 0, [[33, 4, PCS], [38, 8, PCS], [37, 4, PCS]]],
    [0, 5, [[76, 1, PCS], [77, 1, PCS]]],
  ];

  for (const [day, customerIndex, lines] of sales) {
    const resolved = lines.map(([idx, qty, unit]) => {
      const item = created[idx];
      return { itemId: item.itemId, unitId: unit, quantity: qty, unitPrice: item.sell, discountPct: 0, taxPct: 0 };
    });
    const total = resolved.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const cashPart = Math.floor(total * 0.6);
    const cardPart = total - cashPart;
    await call('POST', '/sales/invoices', {
      invoiceType: 1, branchId: 1, warehouseId: warehouse1,
      partyId: customerIds[customerIndex],
      paymentType: 3,
      cashAccountId: drawer1?.cashAccountId ?? 1,
      paidAmount: cashPart,
      payments: [
        { method: 1, amount: cashPart, cashAccountId: branch1Drawer },
        { method: 2, amount: cardPart, cashAccountId: cardAccountId },
      ],
      invoiceDate: daysAgo(day), lines: resolved, notes: '',
    }, 1);
  }

  // ---- branch 2 sales ----
  if (warehouse2Id) {
    const cp2Sales = [
      [28, 6, [[42, 1, PCS], [48, 2, PCS]]],
      [25, 6, [[46, 1, PCS], [50, 1, PCS], [47, 1, PCS], [49, 2, PCS]]],
      [21, 7, [[44, 1, PCS], [45, 1, PCS]]],
      [17, 7, [[41, 1, PCS], [50, 1, PCS]]],
      [13, 6, [[42, 1, PCS], [48, 1, PCS], [49, 1, PCS], [47, 1, PCS], [45, 1, PCS]]],
      [8, 7, [[46, 1, PCS], [42, 1, PCS]]],
      [2, 6, [[41, 1, PCS], [48, 2, PCS]]],
    ];
    for (const [day, customerIndex, lines] of cp2Sales) {
      const resolved = lines.map(([idx, qty, unit]) => {
        const item = created[idx];
        return { itemId: item.itemId, unitId: unit, quantity: qty, unitPrice: item.sell, discountPct: 0, taxPct: 0 };
      });
      const total = resolved.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      await call('POST', '/sales/invoices', {
        invoiceType: 1, branchId: branch2Id, warehouseId: warehouse2Id,
        partyId: customerIds[customerIndex],
        paymentType: 1, cashAccountId: branch2Cash.cashAccountId ?? branch2Cash,
        paidAmount: total, invoiceDate: daysAgo(day), lines: resolved, notes: '',
      }, branch2Id);
    }
  }

  // ---- a daily cash deposit into the bank ----
  const cashCategories = await call('GET', '/treasury/categories', null, 1);
  const depositCategory = (cashCategories ?? []).find((c) => c.direction === 1);
  for (const day of [23, 15, 7, 1]) {
    if (!depositCategory) continue;
    await call('POST', '/treasury/transactions', {
      cashAccountId: (accounts ?? []).find((a) => a.type === 2 && Number(a.branchId) === 1)?.cashAccountId,
      direction: 1, categoryId: depositCategory.categoryId,
      amount: 5000, description: 'إيداع يومية الكاشير', transactionDate: daysAgo(day),
    }, 1);
  }

  // ---- maintenance tickets ----
  const maintProducts = await call('GET', '/maintenance/products', null, 1);
  const product = (maintProducts ?? [])[0];
  const maintModels = await call('GET', `/maintenance/models?productId=${product?.productId ?? 1}`, null, 1);
  const model = (maintModels ?? [])[0];

  const tickets = [
    ['عميل محل 9 — صيانة لابتوب Lenovo', '01012345678', product?.productId ?? 1, model?.modelId ?? 1, 'شاشة سوداء بعد فتح الجهاز — السبب لوحة الأم', 2500, 1200],
    ['أحمد سمير — ماك بوك برو', '01122334455', product?.productId ?? 1, model?.modelId ?? 1, 'صيانة MacBook Pro 13 — إستبدال بطارية', 1800, 800],
    ['محل التكنولوجيا الحديثة — تركيب 6 كاميرات', '01123456789', product?.productId ?? 1, model?.modelId ?? 1, 'تركيب وتشغيل 4 كاميرات خارجية + DVR + هارد 1TB', 6000, 2500],
  ];
  for (const [customerName, phone, productId, modelId, notes, maxCharge, advance] of tickets) {
    try {
      await call('POST', '/maintenance/tickets', {
        customerName, phone,
        productId, modelId,
        accessories: {}, productCondition: 'يعمل',
        customerNotes: notes, maxCharge, estimatedCost: maxCharge,
        paidAmount: advance, cashAccountId: branch1Drawer ?? 1,
      }, 1);
    } catch (e) {
      console.log('[compumob] تعذر إنشاء تذكرة صيانة:', e.message);
    }
  }

  // ---- HR: departments + employees ----
  try {
    const deptMaint = await call('POST', '/hr/departments', { name: 'الصيانة والدعم الفني', branchId: 1 }, 1);
    const deptSales = await call('POST', '/hr/departments', { name: 'المبيعات', branchId: 1 }, 1);
    const deptSec = await call('POST', '/hr/departments', { name: 'الأنظمة الأمنية والشبكات', branchId: 1 }, 1);

    const mkEmp = async (name, phone, deptId, salary, userName) => {
      try {
        await call('POST', '/hr/employees', {
          name, phone, nationalId: '0000000000', hireDate: daysAgo(200),
          departmentId: deptId, jobTitle: 'فني', basicSalary: salary, allowances: 500,
          userId: staffUserIds[userName] ?? null,
        }, 1);
      } catch (e) {
        console.log('[compumob] تعذر إنشاء موظف', name, e.message);
      }
    };
    await mkEmp('أحمد صابر', '01012345671', deptMaint?.departmentId, 9000, 'ahmdsbr');
    await mkEmp('محمود القاضي', '01012345672', deptSec?.departmentId, 8000, 'mhmudqd');
    await mkEmp('سارة النمر', '01012345673', deptSales?.departmentId, 7000, 'sarnam');
  } catch (e) {
    console.log('[compumob] HR غير متاح:', e.message);
  }

  console.log('[compumob] تم إنشاء بيانات الديمو بالكامل — علاء + 6 موظفين');
  console.log('[compumob] عدد المخزون وسلطة المنتجات: جهاز واحد لكل مخزن، \'كل الأرقام أعداد صحيحة بدون كسور\'');
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
