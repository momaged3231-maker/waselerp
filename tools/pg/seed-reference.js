/*
 * Seeds the reference masters used by the Definitions screens:
 *   banks (CIB / NBE / Banque du Caire), colors, sizes, Egypt governorates —
 * then links cash_accounts.bank_id to the banks master by name.
 *
 * Idempotent by design: every seed only runs while its table is empty, so it
 * is safe on a fresh database and on an existing one (never duplicates rows).
 *
 *   node tools/pg/seed-reference.js <database>          # local PG via PGHOST/PGPORT
 *   DATABASE_URL=... node tools/pg/seed-reference.js    # managed DB (Supabase/Neon/...)
 */
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const DATABASE = process.argv[2] ?? 'wasel';

const BANKS = [
  ['NBE', 'البنك الأهلي المصري', 'National Bank of Egypt'],
  ['CIB', 'البنك التجاري الدولي', 'Commercial International Bank'],
  ['BDC', 'بنك القاهرة', 'Banque du Caire'],
];
const COLORS = [
  ['BLK', 'أسود', 'Black', '#000000'],
  ['WHT', 'أبيض', 'White', '#FFFFFF'],
  ['SLV', 'فضي', 'Silver', '#C0C0C0'],
  ['GLD', 'ذهبي', 'Gold', '#FFD700'],
  ['GRY', 'رمادي', 'Grey', '#808080'],
  ['BLU', 'أزرق', 'Blue', '#0000FF'],
  ['RED', 'أحمر', 'Red', '#FF0000'],
  ['GRN', 'أخضر', 'Green', '#008000'],
];
const SIZES = [
  ['S', 'صغير', 'Small', 1],
  ['M', 'متوسط', 'Medium', 2],
  ['L', 'كبير', 'Large', 3],
  ['XL', 'X كبير', 'Extra Large', 4],
  ['XXL', 'XX كبير', 'Double Extra Large', 5],
];
const GOVERNORATES = [
  ['EG-C', 'القاهرة', 'Cairo'],
  ['EG-G', 'الجيزة', 'Giza'],
  ['EG-ALX', 'الإسكندرية', 'Alexandria'],
  ['EG-QB', 'القليوبية', 'Qalyubia'],
  ['EG-SH', 'الشرقية', 'Sharqia'],
  ['EG-DK', 'الدقهلية', 'Dakahlia'],
  ['EG-GH', 'الغربية', 'Gharbia'],
  ['EG-MN', 'المنوفية', 'Monufia'],
  ['EG-BH', 'البحيرة', 'Beheira'],
  ['EG-KFS', 'كفر الشيخ', 'Kafr El Sheikh'],
  ['EG-DT', 'دمياط', 'Damietta'],
  ['EG-PS', 'بورسعيد', 'Port Said'],
  ['EG-IS', 'الإسماعيلية', 'Ismailia'],
  ['EG-SUZ', 'السويس', 'Suez'],
  ['EG-SN', 'شمال سيناء', 'North Sinai'],
  ['EG-SS', 'جنوب سيناء', 'South Sinai'],
  ['EG-BS', 'البحر الأحمر', 'Red Sea'],
  ['EG-MT', 'مطروح', 'Matrouh'],
  ['EG-FYM', 'الفيوم', 'Fayoum'],
  ['EG-BNS', 'بني سويف', 'Beni Suef'],
  ['EG-MNIA', 'المنيا', 'Minya'],
  ['EG-AS', 'أسيوط', 'Assiut'],
  ['EG-SHG', 'سوهاج', 'Sohag'],
  ['EG-QN', 'قنا', 'Qena'],
  ['EG-LX', 'الأقصر', 'Luxor'],
  ['EG-ASN', 'أسوان', 'Aswan'],
  ['EG-WD', 'الوادي الجديد', 'New Valley'],
];

function clientConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const managed = /sslmode=require|pooler\.|supabase\.|neon\.tech|render\.com/i.test(url);
    return { connectionString: url, ssl: managed ? { rejectUnauthorized: false } : undefined };
  }
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: DATABASE,
  };
}

async function count(client, table) {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(rows[0].n);
}

async function seedIfEmpty(client, table, insert, rows, label) {
  if ((await count(client, table)) > 0) {
    console.log(`[seed-ref] ${label}: already has data, skip`);
    return 0;
  }
  for (const row of rows) await client.query(insert, row);
  console.log(`[seed-ref] ${label}: inserted ${rows.length}`);
  return rows.length;
}

async function main() {
  const client = new Client(clientConfig());
  await client.connect();

  await seedIfEmpty(
    client,
    'banks',
    'INSERT INTO banks (code, name, name_en) VALUES ($1, $2, $3)',
    BANKS,
    'banks'
  );
  await seedIfEmpty(
    client,
    'colors',
    'INSERT INTO colors (code, name, name_en, hex_value) VALUES ($1, $2, $3, $4)',
    COLORS,
    'colors'
  );
  await seedIfEmpty(
    client,
    'sizes',
    'INSERT INTO sizes (code, name, name_en, sort_order) VALUES ($1, $2, $3, $4)',
    SIZES,
    'sizes'
  );

  if ((await count(client, 'governorates')) === 0) {
    const cols = (
      await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'countries'"
      )
    ).rows.map((r) => r.column_name);
    let conditions = '1=0';
    if (cols.includes('name_en')) conditions += " OR name_en ILIKE '%egypt%'";
    if (cols.includes('name')) conditions += " OR name ILIKE '%مصر%'";
    if (cols.includes('code')) conditions += " OR upper(code) = 'EG'";
    const egypt = (
      await client.query(`SELECT country_id, code FROM countries WHERE ${conditions} LIMIT 1`)
    ).rows[0];
    if (egypt) {
      console.log(`[seed-ref] egypt country: id=${egypt.country_id} code=${egypt.code}`);
    } else {
      console.log('[seed-ref] egypt country not found — country_id left null');
    }
    for (const [code, name, nameEn] of GOVERNORATES) {
      await client.query(
        'INSERT INTO governorates (code, name, name_en, country_id, country_code) VALUES ($1, $2, $3, $4, $5)',
        [code, name, nameEn, egypt ? egypt.country_id : null, egypt ? egypt.code : null]
      );
    }
    console.log(`[seed-ref] governorates: inserted ${GOVERNORATES.length}`);
  } else {
    console.log('[seed-ref] governorates: already has data, skip');
  }

  const linked = await client.query(
    `UPDATE cash_accounts ca SET bank_id = b.bank_id
     FROM banks b
     WHERE ca.bank_name IS NOT NULL AND ca.bank_id IS NULL AND b.name = ca.bank_name
     RETURNING ca.cash_account_id`
  );
  console.log(`[seed-ref] cash_accounts linked to banks: ${linked.rows.length}`);

  await client.end();
  console.log('[seed-ref] done');
}

main().catch((e) => {
  console.error('[seed-ref] fatal: ' + e.message);
  process.exit(1);
});
