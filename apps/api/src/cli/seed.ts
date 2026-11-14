/* Seeds baseline data: permissions, roles, admin user, branch, units, cash account, settings. */
import { Client } from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

const CONFIG = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'wasel',
};

const PERMISSIONS: [string, string, string][] = [
  ['dashboard.view', 'الرئيسية', 'عرض لوحة المعلومات'],
  ['items.view', 'الأصناف', 'عرض الأصناف'],
  ['items.manage', 'الأصناف', 'إضافة وتعديل الأصناف'],
  ['categories.manage', 'الأصناف', 'إدارة الفئات'],
  ['units.manage', 'الأصناف', 'إدارة الوحدات'],
  ['warehouses.manage', 'المخازن', 'إدارة المخازن'],
  ['parties.view', 'العملاء والموردين', 'عرض العملاء والموردين'],
  ['parties.manage', 'العملاء والموردين', 'إضافة وتعديل العملاء والموردين'],
  ['parties.ledger', 'العملاء والموردين', 'كشوف الحسابات'],
  ['sales.view', 'المبيعات', 'عرض فواتير المبيعات'],
  ['sales.manage', 'المبيعات', 'إنشاء وتعديل فواتير المبيعات'],
  ['sales.giveaway', 'المبيعات', 'منح أصناف مجانًا (هدايا)'],
  ['pos.operate', 'نقطة البيع', 'تشغيل نقطة البيع'],
  ['purchases.view', 'المشتريات', 'عرض فواتير المشتريات'],
  ['purchases.manage', 'المشتريات', 'إنشاء وتعديل فواتير المشتريات'],
  ['stock.view', 'المخزون', 'عرض المخزون'],
  ['stock.manage', 'المخزون', 'التحويلات والجرد والتسوية'],
  ['cash.view', 'الخزينة', 'عرض الخزينة'],
  ['cash.manage', 'الخزينة', 'حركات الخزينة والتحويلات'],
  ['reports.view', 'التقارير', 'استخراج التقارير'],
  ['hr.view', 'شئون العاملين', 'عرض بيانات العاملين'],
  ['hr.manage', 'شئون العاملين', 'إدارة الحضور والمرتبات'],
  ['users.manage', 'الإعدادات', 'إدارة المستخدمين والصلاحيات'],
  ['settings.manage', 'الإعدادات', 'إدارة إعدادات النظام'],
  ['accounting.view', 'المحاسبة', 'عرض الحسابات والقيود والتقارير المالية'],
  ['accounting.manage', 'المحاسبة', 'إدارة شجرة الحسابات والقيود والسندات'],
  ['accounting.post', 'المحاسبة', 'ترحيل القيود وإقفال الفترات'],
  ['accounting.close', 'المحاسبة', 'إقفال الفترات المحاسبية وفتحها'],
  ['attachments.view', 'المرفقات', 'عرض المرفقات'],
  ['attachments.manage', 'المرفقات', 'إضافة وحذف المرفقات'],
  ['maintenance.view', 'الصيانة', 'عرض أذون الصيانة والتقارير'],
  ['maintenance.manage', 'الصيانة', 'استلام وفحص وتسليم وتعديل وحذف أذون الصيانة'],
];

const ROLES: { name: string; nameEn: string; codes: string[] }[] = [
  { name: 'مدير النظام', nameEn: 'Administrator', codes: PERMISSIONS.map((p) => p[0]) },
  {
    name: 'محاسب', nameEn: 'Accountant',
    codes: ['dashboard.view', 'items.view', 'parties.view', 'parties.manage', 'parties.ledger',
      'sales.view', 'purchases.view', 'purchases.manage', 'stock.view', 'cash.view', 'cash.manage',
      'reports.view', 'hr.view', 'accounting.view', 'accounting.manage', 'accounting.post'],
  },
  {
    name: 'كاشير', nameEn: 'Cashier',
    codes: ['dashboard.view', 'items.view', 'parties.view', 'sales.view', 'pos.operate', 'cash.view', 'cash.manage'],
  },
  {
    name: 'مندوب مبيعات', nameEn: 'SalesRep',
    codes: ['dashboard.view', 'items.view', 'parties.view', 'sales.view', 'sales.manage', 'stock.view', 'cash.view'],
  },
  {
    name: 'أمين مخزن', nameEn: 'StoreKeeper',
    codes: ['dashboard.view', 'items.view', 'items.manage', 'stock.view', 'stock.manage',
      'purchases.view', 'purchases.manage', 'attachments.view', 'attachments.manage'],
  },
];

const SETTINGS: [string, string][] = [
  ['CompanyName', 'شركتي للتجارة'],
  ['CompanyPhone', ''],
  ['CompanyAddress', ''],
  ['TaxNumber', ''],
  ['InvoiceFooter', 'شكراً لتعاملكم معنا'],
  ['DefaultVatPct', '0'],
  ['AllowNegativeStock', 'false'],
  ['RequireCashierShift', 'false'],
  ['EnableGLPosting', 'true'],
];

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Standard Egyptian chart of accounts used by the general ledger.
 * `normalSide`: 1 = debit, 2 = credit.
 */
const CHART: {
  code: string; name: string; nameEn: string; type: number; group?: boolean;
  normal?: number; parent?: string; mapping?: string; mappingLabel?: string;
}[] = [
  { code: '1', name: 'الأصول', nameEn: 'Assets', type: 1, group: true },
  { code: '11', name: 'الأصول المتداولة', nameEn: 'Current Assets', type: 1, group: true, parent: '1' },
  { code: '1101', name: 'النقدية بالصندوق', nameEn: 'Cash on Hand', type: 1, mapping: 'CASH', mappingLabel: 'النقدية بالصندوق', parent: '11' },
  { code: '1102', name: 'النقدية بالبنك', nameEn: 'Cash at Bank', type: 1, mapping: 'BANK', mappingLabel: 'النقدية بالبنك', parent: '11' },
  { code: '1103', name: 'ذمم العملاء (مدينون)', nameEn: 'Accounts Receivable', type: 1, mapping: 'AR', mappingLabel: 'ذمم العملاء', parent: '11' },
  { code: '1104', name: 'المخزون', nameEn: 'Inventory', type: 1, mapping: 'INVENTORY', mappingLabel: 'المخزون', parent: '11' },
  { code: '1105', name: 'ضريبة القيمة المضافة (مدخلات)', nameEn: 'VAT Input', type: 1, mapping: 'VAT_INPUT', mappingLabel: 'ضريبة القيمة المضافة (مدخلات)', parent: '11' },
  { code: '1106', name: 'مصروفات مدفوعة مقدماً', nameEn: 'Prepaid Expenses', type: 1, parent: '11' },
  { code: '12', name: 'الأصول الثابتة', nameEn: 'Fixed Assets', type: 1, group: true, parent: '1' },
  { code: '1201', name: 'أثاث وتجهيزات', nameEn: 'Furniture & Fixtures', type: 1, parent: '12' },
  { code: '1202', name: 'مجمع إهلاك الأصول الثابتة', nameEn: 'Accumulated Depreciation', type: 1, normal: 2, parent: '12' },

  { code: '2', name: 'الخصوم', nameEn: 'Liabilities', type: 2, group: true },
  { code: '21', name: 'الخصوم المتداولة', nameEn: 'Current Liabilities', type: 2, group: true, parent: '2' },
  { code: '2101', name: 'ذمم الموردين (دائنون)', nameEn: 'Accounts Payable', type: 2, mapping: 'AP', mappingLabel: 'ذمم الموردين', parent: '21' },
  { code: '2102', name: 'ضريبة القيمة المضافة (مخرجات)', nameEn: 'VAT Output', type: 2, mapping: 'VAT_OUTPUT', mappingLabel: 'ضريبة القيمة المضافة (مخرجات)', parent: '21' },
  { code: '2103', name: 'مصروفات مستحقة', nameEn: 'Accrued Expenses', type: 2, parent: '21' },
  { code: '2104', name: 'قروض قصيرة الأجل', nameEn: 'Short Term Loans', type: 2, parent: '21' },

  { code: '3', name: 'حقوق الملكية', nameEn: 'Equity', type: 3, group: true },
  { code: '3101', name: 'رأس المال', nameEn: 'Capital', type: 3, parent: '3' },
  { code: '3102', name: 'المسحوبات الشخصية', nameEn: 'Owner Drawings', type: 3, normal: 1, parent: '3' },
  { code: '3103', name: 'الأرباح المحتجزة', nameEn: 'Retained Earnings', type: 3, parent: '3', mapping: 'RETAINED_EARNINGS', mappingLabel: 'الأرباح المحتجزة' },

  { code: '4', name: 'الإيرادات', nameEn: 'Revenues', type: 4, group: true },
  { code: '4101', name: 'المبيعات', nameEn: 'Sales', type: 4, mapping: 'SALES', mappingLabel: 'المبيعات', parent: '4' },
  { code: '4102', name: 'مردودات المبيعات', nameEn: 'Sales Returns', type: 4, normal: 1, mapping: 'SALES_RETURNS', mappingLabel: 'مردودات المبيعات', parent: '4' },
  { code: '4103', name: 'خصم مسموح به', nameEn: 'Discounts Allowed', type: 4, normal: 1, mapping: 'DISCOUNT', mappingLabel: 'خصم مسموح به', parent: '4' },
  { code: '4104', name: 'إيرادات أخرى', nameEn: 'Other Income', type: 4, mapping: 'OTHER_INCOME', mappingLabel: 'إيرادات أخرى', parent: '4' },
  { code: '4105', name: 'إيرادات التوصيل', nameEn: 'Delivery Revenue', type: 4, mapping: 'DELIVERY_FEE', mappingLabel: 'إيرادات التوصيل', parent: '4' },
  { code: '4106', name: 'إيرادات الخدمة', nameEn: 'Service Charge', type: 4, mapping: 'SERVICE_CHARGE', mappingLabel: 'إيرادات الخدمة', parent: '4' },

  { code: '5', name: 'المصروفات', nameEn: 'Expenses', type: 5, group: true },
  { code: '5101', name: 'تكلفة المبيعات', nameEn: 'Cost of Sales', type: 5, mapping: 'COGS', mappingLabel: 'تكلفة المبيعات', parent: '5' },
  { code: '5102', name: 'مردودات المشتريات', nameEn: 'Purchase Returns', type: 5, mapping: 'PURCHASE_RETURNS', mappingLabel: 'مردودات المشتريات', parent: '5' },
  { code: '5103', name: 'الرواتب والأجور', nameEn: 'Salaries & Wages', type: 5, mapping: 'SALARY_EXPENSE', mappingLabel: 'الرواتب والأجور', parent: '5' },
  { code: '5104', name: 'إيجارات', nameEn: 'Rent', type: 5, parent: '5' },
  { code: '5105', name: 'كهرباء ومياه واتصالات', nameEn: 'Utilities', type: 5, parent: '5' },
  { code: '5106', name: 'مصروفات إدارية وعمومية', nameEn: 'General Expenses', type: 5, mapping: 'OTHER_EXPENSE', mappingLabel: 'مصروفات إدارية', parent: '5' },
  { code: '5107', name: 'مصروفات مالية', nameEn: 'Financial Expenses', type: 5, parent: '5' },
  { code: '5108', name: 'إهلاكات الأصول الثابتة', nameEn: 'Depreciation', type: 5, parent: '5' },
  { code: '5109', name: 'خصم الموردين', nameEn: 'Purchase Discounts', type: 5, normal: 2, parent: '5', mapping: 'PURCHASE_DISCOUNT', mappingLabel: 'خصم الموردين' },
  { code: '5110', name: 'فروقات الصندوق', nameEn: 'Cash Short / Over', type: 5, parent: '5', mapping: 'CASH_DIFF', mappingLabel: 'فروقات الصندوق' },
  { code: '5111', name: 'فروقات الجرد', nameEn: 'Inventory Variance', type: 5, parent: '5', mapping: 'INVENTORY_VARIANCE', mappingLabel: 'فروقات الجرد' },
  { code: '5112', name: 'تالف وهادر', nameEn: 'Damage & Wastage', type: 5, parent: '5', mapping: 'DAMAGE_EXPENSE', mappingLabel: 'تالف وهادر' },
  { code: '5113', name: 'إضافات مخزون', nameEn: 'Inventory Additions', type: 5, parent: '5', mapping: 'INVENTORY_ADDITION', mappingLabel: 'إضافات مخزون' },
];

const CURRENCIES: [string, string, string, boolean, number][] = [
  ['EGP', 'الجنيه المصري', 'ج.م', true, 1],
  ['USD', 'الدولار الأمريكي', '$', false, 48.5],
  ['EUR', 'اليورو', '€', false, 53.0],
  ['SAR', 'الريال السعودي', 'ر.س', false, 12.9],
  ['AED', 'الدرهم الإماراتي', 'د.إ', false, 13.2],
];

const COST_CENTERS: [string, string][] = [
  ['MAIN', 'الفرع الرئيسي'],
  ['ADM', 'الإدارة'],
  ['SALES', 'المبيعات'],
  ['WH', 'المخازن'],
];

/** Inserts the chart of accounts, the concept mappings, currencies and cost centres. */
async function seedChartOfAccounts(client: Client) {
  const ids = new Map<string, number>();
  for (const row of CHART) {
    const parentId = row.parent ? ids.get(row.parent) ?? null : null;
    const result = await client.query<{ account_id: number }>(
      `INSERT INTO gl_accounts
         (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side, currency_code)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,'EGP')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, name_en = EXCLUDED.name_en,
         account_type = EXCLUDED.account_type, parent_id = EXCLUDED.parent_id,
         is_group = EXCLUDED.is_group, normal_side = EXCLUDED.normal_side
       RETURNING account_id`,
      [row.code, row.name, row.nameEn, row.type, parentId, !!row.group,
        row.normal ?? (row.type === 1 || row.type === 5 ? 1 : 2)],
    );
    ids.set(row.code, Number(result.rows[0].account_id));
  }

  for (const row of CHART) {
    if (!row.mapping) continue;
    await client.query(
      `INSERT INTO gl_mappings (mapping_key, account_id, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (mapping_key) DO UPDATE SET account_id = EXCLUDED.account_id,
         description = EXCLUDED.description`,
      [row.mapping, ids.get(row.code), row.mappingLabel ?? row.name],
    );
  }

  for (const [code, name, symbol, isBase, rate] of CURRENCIES) {
    await client.query(
      `INSERT INTO currencies (currency_code, name, symbol, is_base, rate)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (currency_code) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol,
         is_base = EXCLUDED.is_base, rate = EXCLUDED.rate`,
      [code, name, symbol, isBase, rate],
    );
  }

  for (const [code, name] of COST_CENTERS) {
    await client.query(
      `INSERT INTO cost_centers (code, name, is_active) VALUES ($1,$2,true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [code, name],
    );
  }

  // Default price lists (no lines — the user fills them from the grid).
  const priceLists: [string, string, number, number][] = [
    ['RETAIL', 'قائمة الأسعار النقدية', 1, 10],
    ['WHOLE', 'قائمة الأسعار الجملة', 2, 20],
  ];
  for (const [code, name, listType, priority] of priceLists) {
    const existing = await client.query(
      'SELECT price_list_id FROM price_lists WHERE code = $1::text LIMIT 1',
      [code],
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE price_lists SET name = $2, list_type = $3, priority = $4
          WHERE price_list_id = $1::int`,
        [existing.rows[0].price_list_id, name, listType, priority],
      );
    } else {
      await client.query(
        `INSERT INTO price_lists (name, code, list_type, priority) VALUES ($1,$2,$3,$4)`,
        [name, code, listType, priority],
      );
    }
  }

  // Link the seeded cash account and cash categories to their GL accounts.
  await client.query(
    `UPDATE cash_accounts c SET gl_account_id = a.account_id
       FROM gl_accounts a
      WHERE a.code = '1101' AND c.gl_account_id IS NULL`,
  );
  await client.query(
    `UPDATE cash_categories c SET gl_account_id = a.account_id
       FROM gl_accounts a
      WHERE a.code = '5106' AND c.gl_account_id IS NULL AND c.direction = 2`,
  );
  await client.query(
    `UPDATE cash_categories c SET gl_account_id = a.account_id
       FROM gl_accounts a
      WHERE a.code = '4104' AND c.gl_account_id IS NULL AND c.direction = 1`,
  );
}

(async () => {
  const client = new Client(CONFIG);
  await client.connect();

  for (const [code, module, name] of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (code, module, name) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, name = EXCLUDED.name`,
      [code, module, name],
    );
  }

  for (const role of ROLES) {
    await client.query(
      `INSERT INTO roles (name, name_en, is_system) VALUES ($1,$2,true)
       ON CONFLICT (name) DO NOTHING`,
      [role.name, role.nameEn],
    );
    const roleId = await client.query('SELECT role_id FROM roles WHERE name = $1', [role.name]);
    for (const code of role.codes) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM permissions WHERE code = $2
         ON CONFLICT DO NOTHING`,
        [roleId.rows[0].role_id, code],
      );
    }
  }

  const userCount = await client.query('SELECT count(*)::int AS c FROM users');
  if (userCount.rows[0].c === 0) {
    const { hash, salt } = hashPassword('admin123');
    const user = await client.query(
      `INSERT INTO users (user_name, full_name, password_hash, password_salt, max_discount_pct, is_active, is_cashier)
       VALUES ('admin','مدير النظام',$1,$2,100,true,true) RETURNING user_id`,
      [hash, salt],
    );
    const role = await client.query("SELECT role_id FROM roles WHERE name = 'مدير النظام'");
    await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)', [
      user.rows[0].user_id,
      role.rows[0].role_id,
    ]);
    console.log('[seed] admin user created (admin / admin123)');
  }

  const branchCount = await client.query('SELECT count(*)::int AS c FROM branches');
  if (branchCount.rows[0].c === 0) {
    const branch = await client.query(
      `INSERT INTO branches (code, name, is_active) VALUES ('MAIN','الفرع الرئيسي',true) RETURNING branch_id`,
    );
    const branchId = branch.rows[0].branch_id;
    await client.query(
      `INSERT INTO warehouses (branch_id, code, name, is_default, is_active) VALUES ($1,'WH-MAIN','المخزن الرئيسي',true,true)`,
      [branchId],
    );
    await client.query(
      `INSERT INTO periods (branch_id, name, start_date, is_closed, notes) VALUES ($1,'الفترة الحالية','2020-01-01',false,'فترة افتتاحية')`,
      [branchId],
    );
    await client.query(`INSERT INTO cash_categories (name, direction) VALUES ('إيداع نقدي',1),('سحب نقدي',2)`);
    await client.query(
      `INSERT INTO cash_accounts (branch_id, name, type, currency_code, opening_balance, is_active)
       VALUES ($1,'الخزينة الرئيسية',1,'EGP',0,true)`,
      [branchId],
    );
    await client.query('UPDATE users SET default_branch_id = $1 WHERE user_name = $2', [branchId, 'admin']);
    console.log('[seed] main branch created');
  }

  const unitCount = await client.query('SELECT count(*)::int AS c FROM units');
  if (unitCount.rows[0].c === 0) {
    await client.query(
      `INSERT INTO units (code, name, name_en) VALUES
       ('PCS','قطعة','Piece'),('PKT','عبوة','Pack'),('BOX','كرتونة','Box'),
       ('KG','كيلو','Kilogram'),('LTR','لتر','Litre'),('SVC','خدمة','Service')`,
    );
  }

  for (const [key, value] of SETTINGS) {
    await client.query(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ($1,$2)
       ON CONFLICT (setting_key) DO NOTHING`,
      [key, value],
    );
  }

  await seedChartOfAccounts(client);

  const counts = await client.query(
    `SELECT (SELECT count(*)::int FROM permissions) AS permissions,
            (SELECT count(*)::int FROM roles) AS roles,
            (SELECT count(*)::int FROM users) AS users,
            (SELECT count(*)::int FROM branches) AS branches`,
  );
  console.log('[seed] done', counts.rows[0]);
  await client.end();
})().catch((error) => {
  console.error('[seed] error:', error);
  process.exit(1);
});
