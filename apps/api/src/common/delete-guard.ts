import { BadRequestException } from '@nestjs/common';

/**
 * Deletion gate for the whole system — D29.
 *
 * Two switches must both be on for a delete to succeed:
 *   1. `DeleteEnabled`          — master switch for the whole system
 *   2. `DeleteEnabled_<key>`    — per-screen switch
 *
 * Missing keys (e.g. fresh databases without the seed) are treated as ON so
 * behaviour is identical to before D29 — nothing breaks, nothing locks.
 * The Settings UI mirrors this: a missing key renders the toggle ON.
 */

/** Arabic labels for each screen's delete switch (single source of truth). */
export const DELETE_SCREENS: Record<string, string> = {
  items: 'الأصناف',
  parties: 'العملاء والموردين',
  categories: 'فئات الأصناف',
  units: 'الوحدات',
  customerGroups: 'مجموعات العملاء',
  customerClassifications: 'التصنيفات المخصصة',
  bankAccounts: 'الخزائن والحسابات البنكية',
  attachments: 'المرفقات',
  hrDepartments: 'الإدارات',
  hrComponents: 'مكونات المرتب',
  hrLatencyTiers: 'شرائح الخصم للتأخير',
  hrEarlyPermissions: 'أذونات الانصراف المبكر',
  hrAdvances: 'السلف',
  accountingAccounts: 'الحسابات',
  accountingRecurring: 'القيود المتكررة',
  crmLeads: 'العملاء المحتملون',
  crmActivities: 'الأنشطة',
  crmSources: 'مصادر العملاء المحتملين',
  reminders: 'التذكيرات',
  printProfiles: 'ملفات الطباعة',
  priceLists: 'قوائم الأسعار',
  coupons: 'الكوبونات',
  giftOffers: 'عروض الهدايا',
  maintenanceProducts: 'منتجات الصيانة',
  maintenanceTickets: 'تذاكر الصيانة',
  pos: 'POS (القاعات والموائع والمعدلات والملاحظات)',
  stockVouchers: 'أذون المخزن',
  stockTransfers: 'التحويلات',
  branchTransfers: 'التحويلات بين الفروع',
  stockCounts: 'الجرد',
  reportDefinitions: 'تعريفات التقارير',
};

const TRUTHY = ['true', '1', 'yes'];

export const isTruthySetting = (value: string | null | undefined): boolean =>
  value == null ? true : TRUTHY.includes(String(value).trim().toLowerCase());

type Querier = {
  query: <T extends Record<string, unknown> = any>(sql: string, params?: unknown[]) => Promise<T[]>;
};

/** Throws BadRequestException with a clear Arabic message when deletion is paused. */
export async function assertDeletionAllowed(db: Querier, screenKey: string): Promise<void> {
  const rows = await db.query<{ setting_key: string; setting_value: string | null }>(
    `SELECT setting_key, setting_value FROM app_settings
      WHERE setting_key IN ('DeleteEnabled', $1::text)`,
    [`DeleteEnabled_${screenKey}`],
  );
  const map = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  if (!isTruthySetting(map.get('DeleteEnabled'))) {
    throw new BadRequestException('الحذف متوقف — شغّله من «الإعدادات ← الحذف»');
  }
  if (!isTruthySetting(map.get(`DeleteEnabled_${screenKey}`))) {
    throw new BadRequestException(
      `الحذف متوقف لشاشة «${DELETE_SCREENS[screenKey] ?? screenKey}» — شغّله من «الإعدادات ← الحذف»`,
    );
  }
}

/**
 * Counts rows in every table whose foreign key points at `referencedTable`'s `referencedColumn`.
 * Used to refuse a hard delete that would orphan history.
 * Table and column names come from pg_catalog — never from user input.
 */
export async function countReferencingRows(
  db: Querier,
  referencedTable: string,
  referencedColumn: string,
  id: number,
): Promise<{ table: string; column: string; count: number }[]> {
  const fks = await db.query<{ table_name: string; column_name: string }>(
    `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.confrelid = $1::regclass AND c.contype = 'f' AND a.attname = $2::text`,
    [referencedTable, referencedColumn],
  );
  const refs: { table: string; column: string; count: number }[] = [];
  for (const fk of fks) {
    const rows = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${fk.table_name} WHERE ${fk.column_name} = $1::int`,
      [id],
    );
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) refs.push({ table: fk.table_name, column: fk.column_name, count });
  }
  return refs;
}
