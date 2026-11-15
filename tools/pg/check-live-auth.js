/* Replicate the auth.login SQL exactly against the live Supabase DB. */
const path = require('path');
const { Client } = require(path.join('D:/New folder (2)/waselerp', 'apps', 'api', 'node_modules', 'pg'));
const URL = 'postgresql://postgres.lkrywkixijclebyjxxoo:15qw4d5wq64r8q4wr86@aws-1-eu-west-2.pooler.supabase.com:6543/postgres';
// NOTE: no `?sslmode=require` — newer pg treats it as verify-full and fails
// against Supabase's chain even with an explicit ssl object. TLS is forced
// by the ssl option below instead.
(async () => {
  const c = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('CONNECTED via pooler + TLS');

  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position`
  );
  console.log('users columns:', cols.rows.map((r) => r.column_name).join(','));

  const q1 = await c.query(
    `SELECT user_id, user_name, full_name, default_branch_id, password_hash, password_salt,
            is_cashier, is_sales_rep, max_discount_pct, is_active
       FROM users WHERE lower(user_name) = lower($1)`,
    ['admin'],
  );
  console.log('Q1 login select:', q1.rows.length, 'row — user:', q1.rows[0]?.user_name, 'active:', q1.rows[0]?.is_active);

  const uid = q1.rows[0]?.user_id;
  const q2 = await c.query(
    `SELECT DISTINCT p.code FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE ur.user_id = $1`, [uid],
  );
  console.log('Q2 permissions:', q2.rows.length);

  const q3 = await c.query(
    `SELECT b.branch_id, b.code, b.name FROM branches b
      WHERE b.is_active = true
        AND (EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = $1 AND ub.branch_id = b.branch_id)
             OR NOT EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = $1))
      ORDER BY b.branch_id`, [uid],
  );
  console.log('Q3 branches:', q3.rows.map((r) => r.code).join(','));

  // column checks for tables the broader app uses on first screens
  for (const t of ['banks', 'colors', 'sizes', 'governorates', 'cash_accounts', 'user_branches']) {
    const ok = await c.query('SELECT to_regclass($1)::text AS t', ['public.' + t]);
    console.log('table', t, '=', ok.rows[0].t ?? 'MISSING');
  }
  const cnt = await c.query('SELECT (SELECT count(*) FROM banks) b, (SELECT count(*) FROM governorates) g');
  console.log('banks:', cnt.rows[0].b, 'governorates:', cnt.rows[0].g);

  await c.end();
  console.log('ALL LOGIN QUERIES OK — schema drift is NOT the cause');
})().catch((e) => { console.error('QUERY-FAIL:', e.message); process.exit(1); });
