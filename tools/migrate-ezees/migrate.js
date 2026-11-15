/*
 * Ezees (CSV extract) -> WaselERP (PostgreSQL) idempotent migration tool.
 *
 * Usage:
 *   node tools/migrate-ezees/migrate.js --source "<extract-dir>" [--dry-run] [--phases master]
 *
 * See README.md in this folder.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'node_modules', 'pg'));

const DB = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'wasel',
};

function parseArgs(argv) {
  const out = { source: null, dryRun: false, phases: ['master'], codebook: null, limit: null, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--phases') out.phases = String(argv[++i] || 'master').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--codebook') out.codebook = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--report') out.report = argv[++i];
  }
  if (out.phases.includes('all')) out.phases = ['master', 'opening-stock', 'opening-parties', 'opening-cash'];
  return out;
}

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(x => x !== '')).map(r => {
    const o = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] !== undefined ? r[j] : '';
    return o;
  });
}

function readCSV(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return { rows: [], missing: true, path: p };
  const text = fs.readFileSync(p, 'utf8');
  return { rows: parseCSV(text), missing: false, path: p };
}

const trim = v => (v == null ? '' : String(v)).trim();
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0; };
const int = v => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : 0; };
const bool = v => /^true|1|yes$/i.test(trim(v));

class Migrator {
  constructor(opts, codebook, client) {
    this.opts = opts;
    this.cb = codebook;
    this.client = client;
    this.report = { source: opts.source, dryRun: opts.dryRun, phases: opts.phases, startedAt: new Date().toISOString(), tables: {}, warnings: [], errors: [] };
    this.cache = new Map(); // "table:id" -> target_id
  }

  warn(msg) { this.report.warnings.push(msg); }
  err(msg, e) { this.report.errors.push({ msg, error: e ? String(e.message || e) : null }); }

  async ensureMapTable() {
    if (this.opts.dryRun) return;
    await this.client.query(`CREATE TABLE IF NOT EXISTS ezees_migration_map (
      source_table text NOT NULL,
      source_id text NOT NULL,
      target_table text NOT NULL,
      target_id bigint NOT NULL,
      meta jsonb,
      migrated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (source_table, source_id)
    )`);
  }

  dryId(sourceTable, sourceId) {
    // stable numeric surrogate for dry-run (keeps FK-like logic working in-memory)
    let h = 0;
    const s = `${sourceTable}:${sourceId}`;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
    const n = Math.abs(h) || 1;
    return 900000000 + (n % 90000000);
  }

  async getMapped(sourceTable, sourceId) {
    const key = `${sourceTable}:${sourceId}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.opts.dryRun) return null;
    const r = await this.client.query(
      'SELECT target_id::bigint AS target_id FROM ezees_migration_map WHERE source_table=$1 AND source_id=$2',
      [sourceTable, String(sourceId)]
    );
    const val = r.rows[0] ? Number(r.rows[0].target_id) : null;
    if (val != null) this.cache.set(key, val);
    return val;
  }

  async setMapped(sourceTable, sourceId, targetTable, targetId, meta) {
    const key = `${sourceTable}:${sourceId}`;
    const numId = Number(targetId);
    this.cache.set(key, Number.isFinite(numId) ? numId : this.dryId(sourceTable, sourceId));
    if (this.opts.dryRun) return;
    await this.client.query(
      `INSERT INTO ezees_migration_map (source_table, source_id, target_table, target_id, meta)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_table, source_id) DO UPDATE SET target_table=EXCLUDED.target_table, target_id=EXCLUDED.target_id, meta=EXCLUDED.meta`,
      [sourceTable, String(sourceId), targetTable, Number(targetId), meta ? JSON.stringify(meta) : null]
    );
  }

  stat(table, field) {
    if (!this.report.tables[table]) this.report.tables[table] = { read: 0, inserted: 0, skipped: 0, errors: 0 };
    this.report.tables[table][field] = (this.report.tables[table][field] || 0) + 1;
  }

  load(tableFile) {
    const res = readCSV(this.opts.source, tableFile);
    if (res.missing) this.warn(`missing file: ${tableFile}`);
    if (this.opts.limit && res.rows.length > this.opts.limit) res.rows = res.rows.slice(0, this.opts.limit);
    return res.rows;
  }

  async run() {
    await this.ensureMapTable();
    if (this.opts.phases.includes('master')) {
      await this.migrateBranches();
      await this.migrateWarehouses();
      await this.migrateCashAccounts();
      await this.migrateCategories();
      await this.migrateUnits();
      await this.migrateParties();
      await this.migrateItems();
    }
    if (this.opts.phases.includes('opening-stock')) await this.migrateOpeningStock();
    if (this.opts.phases.includes('opening-parties')) await this.migrateOpeningPartyBalances();
    if (this.opts.phases.includes('opening-cash')) await this.migrateOpeningCash();
    this.report.finishedAt = new Date().toISOString();
    return this.report;
  }

  async migrateBranches() {
    const rows = this.load('Branches.csv');
    for (const r of rows) {
      this.stat('branches', 'read');
      const sid = trim(r.BranchID); if (!sid) continue;
      if (await this.getMapped('Branches', sid)) { this.stat('branches', 'skipped'); continue; }
      const code = `EZ-BR-${sid}`;
      const name = trim(r.BranchName) || code;
      try {
        let targetId;
        if (!this.opts.dryRun) {
          const ex = await this.client.query('SELECT branch_id FROM branches WHERE code=$1', [code]);
          if (ex.rows[0]) targetId = Number(ex.rows[0].branch_id);
          else {
            const ins = await this.client.query(
              `INSERT INTO branches (code,name,address,phone,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING branch_id`,
              [code, name, trim(r.BranchAddress) || null, trim(r.BranchTel) || trim(r.BranchTel2) || null, true]
            );
            targetId = Number(ins.rows[0].branch_id);
          }
        } else targetId = this.dryId('Branches', sid);
        await this.setMapped('Branches', sid, 'branches', targetId, { code, name });
        this.stat('branches', 'inserted');
      } catch (e) { this.stat('branches', 'errors'); this.err(`branch ${sid}`, e); }
    }
  }

  async migrateWarehouses() {
    const rows = this.load('Stores.csv');
    for (const r of rows) {
      this.stat('warehouses', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (await this.getMapped('Stores', sid)) { this.stat('warehouses', 'skipped'); continue; }
      const branchId = await this.getMapped('Branches', trim(r.Branch_ID));
      if (!branchId && !this.opts.dryRun) { this.stat('warehouses', 'errors'); this.err(`store ${sid}: branch ${r.Branch_ID} not mapped`, null); continue; }
      const code = `EZ-WH-${sid}`;
      const name = trim(r.Store_name) || code;
      const isDefault = bool(r.Store_IsDefault);
      const isActive = !bool(r.Store_IsDisabled);
      try {
        let targetId;
        if (!this.opts.dryRun) {
          const ex = await this.client.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1::int AND code=$2', [branchId, code]);
          if (ex.rows[0]) targetId = Number(ex.rows[0].warehouse_id);
          else {
            const ins = await this.client.query(
              `INSERT INTO warehouses (branch_id,code,name,address,phone,manager_name,is_default,is_active,notes)
               VALUES ($1::int,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING warehouse_id`,
              [branchId, code, name, trim(r.Store_address) || null, trim(r.Store_tel) || null, trim(r.Store_manager) || null, isDefault, isActive, trim(r.Store_notes) || null]
            );
            targetId = Number(ins.rows[0].warehouse_id);
          }
        } else targetId = this.dryId('Stores', sid);
        await this.setMapped('Stores', sid, 'warehouses', targetId, { code, name, branchId });
        this.stat('warehouses', 'inserted');
      } catch (e) { this.stat('warehouses', 'errors'); this.err(`store ${sid}`, e); }
    }
  }

  async migrateCashAccounts() {
    const rows = this.load('Cashes.csv');
    const branches = this.load('Branches.csv');
    const users = this.load('Users.csv');
    const cashTx = this.load('Cash.csv');
    const defaultBranch = branches[0] ? trim(branches[0].BranchID) : null;

    // Infer cash-account -> branch from strongest evidence:
    // 1) Users.CashID -> Users.BranchID, 2) most frequent BranchID per Cash.Target (excluding transfers 27/28), 3) default.
    const cashBranch = new Map();
    for (const u of users) {
      const cid = trim(u.CashID), bid = trim(u.BranchID);
      if (cid && bid && !cashBranch.has(cid)) cashBranch.set(cid, bid);
    }
    const freq = new Map(); // cashId -> Map(branchId,count)
    for (const t of cashTx) {
      const at = trim(t.action_type);
      if (at === '27' || at === '28') continue;
      const cid = trim(t.Target) || trim(t.Cash_id);
      const bid = trim(t.BranchID);
      if (!cid || !bid) continue;
      if (!freq.has(cid)) freq.set(cid, new Map());
      const m = freq.get(cid);
      m.set(bid, (m.get(bid) || 0) + 1);
    }
    for (const [cid, m] of freq.entries()) {
      if (cashBranch.has(cid)) continue;
      let best = null, bestN = -1;
      for (const [bid, n] of m.entries()) { if (n > bestN) { best = bid; bestN = n; } }
      if (best) cashBranch.set(cid, best);
    }

    for (const r of rows) {
      this.stat('cash_accounts', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (await this.getMapped('Cashes', sid)) { this.stat('cash_accounts', 'skipped'); continue; }
      const branchSrc = cashBranch.get(sid) || defaultBranch;
      const branchId = branchSrc ? await this.getMapped('Branches', branchSrc) : null;
      if (!branchId && !this.opts.dryRun) { this.stat('cash_accounts', 'errors'); this.err(`cash ${sid}: no branch mapped`, null); continue; }
      const name = trim(r.CashName) || `خزينة ${sid}`;
      try {
        let targetId;
        if (!this.opts.dryRun) {
          // lookup by (branch_id, name) to avoid collisions across branches
          const ex = await this.client.query('SELECT cash_account_id FROM cash_accounts WHERE branch_id=$1::int AND name=$2', [branchId, name]);
          if (ex.rows[0]) targetId = Number(ex.rows[0].cash_account_id);
          else {
            const ins = await this.client.query(
              `INSERT INTO cash_accounts (branch_id,name,type,currency_code,opening_balance,is_active,notes)
               VALUES ($1::int,$2,$3::smallint,$4,$5::numeric,$6,$7) RETURNING cash_account_id`,
              [branchId, name, 1, this.cb.defaults?.baseCurrency || 'EGP', 0, true, trim(r.Notes) || null]
            );
            targetId = Number(ins.rows[0].cash_account_id);
          }
        } else targetId = this.dryId('Cashes', sid);
        await this.setMapped('Cashes', sid, 'cash_accounts', targetId, { name, branchId, sourceBranch: branchSrc, inferredFrom: cashBranch.has(sid) ? 'users/cash-usage' : 'default' });
        this.stat('cash_accounts', 'inserted');
      } catch (e) { this.stat('cash_accounts', 'errors'); this.err(`cash ${sid}`, e); }
    }
  }

  async migrateCategories() {
    const rows = this.load('Category.csv');
    for (const r of rows) { if (trim(r.ID)) this.stat('categories', 'read'); }
    // ensure parents first by simple multi-pass
    const pending = new Map(rows.map(r => [trim(r.ID), r]).filter(([id]) => id));
    let progress = true, passes = 0;
    while (pending.size && progress && passes < 30) {
      progress = false; passes++;
      for (const [sid, r] of Array.from(pending.entries())) {
        const parentSrc = trim(r.ParentID);
        if (parentSrc && parentSrc !== '0' && !await this.getMapped('Category', parentSrc)) continue; // wait parent
        if (await this.getMapped('Category', sid)) { this.stat('categories', 'skipped'); pending.delete(sid); progress = true; continue; }
        const name = trim(r.Name) || `تصنيف ${sid}`;
        const parentId = (parentSrc && parentSrc !== '0') ? await this.getMapped('Category', parentSrc) : null;
        try {
          let targetId;
          if (!this.opts.dryRun) {
            const ex = await this.client.query('SELECT category_id FROM categories WHERE name=$1 AND COALESCE(parent_id,0)=COALESCE($2::int,0)', [name, parentId]);
            if (ex.rows[0]) targetId = Number(ex.rows[0].category_id);
            else {
              const ins = await this.client.query(
                `INSERT INTO categories (parent_id,code,name,is_active,notes) VALUES ($1::int,$2,$3,$4,$5) RETURNING category_id`,
                [parentId, trim(r.Code) || null, name, true, trim(r.notes) || null]
              );
              targetId = Number(ins.rows[0].category_id);
            }
          } else targetId = this.dryId('Category', sid);
          await this.setMapped('Category', sid, 'categories', targetId, { name, parentId });
          this.stat('categories', 'inserted');
        } catch (e) { this.stat('categories', 'errors'); this.err(`category ${sid}`, e); }
        pending.delete(sid); progress = true;
      }
    }
    if (pending.size) this.warn(`categories unresolved (missing parents?): ${Array.from(pending.keys()).slice(0,10).join(',')}${pending.size>10?'...':''}`);
  }

  async migrateUnits() {
    const rows = this.load('Units.csv');
    for (const r of rows) {
      this.stat('units', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (await this.getMapped('Units', sid)) { this.stat('units', 'skipped'); continue; }
      const name = trim(r.UnitName) || `وحدة ${sid}`;
      try {
        let targetId;
        if (!this.opts.dryRun) {
          const ex = await this.client.query('SELECT unit_id FROM units WHERE lower(name)=lower($1)', [name]);
          if (ex.rows[0]) targetId = Number(ex.rows[0].unit_id);
          else {
            const ins = await this.client.query(
              `INSERT INTO units (code,name,name_en,is_active) VALUES ($1,$2,$3,$4) RETURNING unit_id`,
              [trim(r.UnitCode) || null, name, trim(r.UnitName_en) || null, true]
            );
            targetId = Number(ins.rows[0].unit_id);
          }
        } else targetId = this.dryId('Units', sid);
        await this.setMapped('Units', sid, 'units', targetId, { name });
        this.stat('units', 'inserted');
      } catch (e) { this.stat('units', 'errors'); this.err(`unit ${sid}`, e); }
    }
  }

  async migrateParties() {
    const rows = this.load('SupCust.csv');
    const typeMap = this.cb.supCustTypeToPartyType || { '0': 1, '1': 2, '2': 3 };
    for (const r of rows) {
      this.stat('parties', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (sid === '1' && this.cb.defaults && this.cb.defaults.migratePlaceholderPartyId1 === false) { this.stat('parties', 'skipped'); continue; }
      if (await this.getMapped('SupCust', sid)) { this.stat('parties', 'skipped'); continue; }
      const code = `EZ-P-${sid}`;
      const name = trim(r.SupCust_Name) || (sid === '1' ? 'عميل نقدي (Ezees)' : code);
      const partyType = typeMap[trim(r.SupCust_Type)] || 1;
      const branchId = await this.getMapped('Branches', trim(r.BranchID));
      const isActive = !/^true$/i.test(trim(r.SupCust_IsDisabled));
      try {
        let targetId;
        if (!this.opts.dryRun) {
          const ex = await this.client.query('SELECT party_id FROM parties WHERE code=$1', [code]);
          if (ex.rows[0]) targetId = Number(ex.rows[0].party_id);
          else {
            const ins = await this.client.query(
              `INSERT INTO parties (code,name,party_type,branch_id,address,phone,mobile,email,city,credit_limit,discount_pct,opening_balance,notes,is_active)
               VALUES ($1,$2,$3::smallint,$4::int,$5,$6,$7,$8,$9,$10::numeric,$11::numeric,$12::numeric,$13,$14) RETURNING party_id`,
              [code, name, partyType, branchId || null, trim(r.SupCust_Address) || null, trim(r.SupCust_Tel) || null, trim(r.SupCust_Mob) || null,
               trim(r.SupCust_Email) || null, trim(r.SupCust_Town) || null, num(r.SupCust_MaxCredit), num(r.SupCust_Discount), 0, trim(r.SupCust_Notes) || null, isActive]
            );
            targetId = Number(ins.rows[0].party_id);
          }
        } else targetId = this.dryId('SupCust', sid);
        await this.setMapped('SupCust', sid, 'parties', targetId, { code, name, partyType });
        this.stat('parties', 'inserted');
      } catch (e) { this.stat('parties', 'errors'); this.err(`party ${sid}`, e); }
    }
  }

  async migrateItems() {
    const rows = this.load('Items.csv');
    // pick a base unit fallback
    const baseUnitId = await this.getMapped('Units', '1');
    for (const r of rows) {
      this.stat('items', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (await this.getMapped('Items', sid)) { this.stat('items', 'skipped'); continue; }
      const rawCode = trim(r.Item_code);
      const code = rawCode && rawCode !== '0' ? rawCode : `EZ-ITEM-${sid}`;
      const name = trim(r.Item_name) || code;
      const categoryId = await this.getMapped('Category', trim(r.Category_id));
      const unitId = await this.getMapped('Units', trim(r.Unit_ID)) || baseUnitId;
      if (!unitId && !this.opts.dryRun) { this.stat('items', 'errors'); this.err(`item ${sid}: no base unit`, null); continue; }
      try {
        let targetId;
        if (!this.opts.dryRun) {
          const ex = await this.client.query('SELECT item_id FROM items WHERE code=$1', [code]);
          if (ex.rows[0]) {
            targetId = Number(ex.rows[0].item_id);
            await this.client.query(
              `UPDATE items SET name=$2, category_id=$3::int, base_unit_id=$4::int, cost_price=$5::numeric, sell_price=$6::numeric,
                min_price=$7::numeric, vat_pct=$8::numeric, reorder_point=$9::numeric, is_active=$10, notes=$11
               WHERE item_id=$1::int`,
              [targetId, name, categoryId || null, unitId, num(r.Item_buypric), num(r.Item_sellpricNow), num(r.Min_Price), num(r.SalesTax), num(r.Item_request_point), !bool(r.Item_Isdisabled), trim(r.Notes) || null]
            );
          } else {
            const ins = await this.client.query(
              `INSERT INTO items (code,barcode,name,category_id,base_unit_id,is_service,is_grouped,has_serial,has_expiry,has_batch,track_quantity,
                 cost_price,sell_price,whole_sale_price,min_price,vat_pct,discount_pct,reorder_point,is_active,notes)
               VALUES ($1,$2,$3,$4::int,$5::int,$6,$7,$8,$9,$10,$11,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17::numeric,$18::numeric,$19,$20)
               RETURNING item_id`,
              [code, rawCode && rawCode !== '0' ? rawCode : null, name, categoryId || null, unitId, bool(r.Is_Service), bool(r.IsGrouped), bool(r.IsSerial), false, false, true,
               num(r.Item_buypric), num(r.Item_sellpricNow), num(r.CustomerPrice) || null, num(r.Min_Price), num(r.SalesTax), num(r.DiscountRate), num(r.Item_request_point), !bool(r.Item_Isdisabled), trim(r.Notes) || null]
            );
            targetId = Number(ins.rows[0].item_id);
            // base unit line
            await this.client.query(
              `INSERT INTO item_units (item_id,unit_id,factor,sell_price,buy_price,is_default) VALUES ($1::int,$2::int,1,$3::numeric,$4::numeric,true)
               ON CONFLICT DO NOTHING`,
              [targetId, unitId, num(r.Item_sellpricNow), num(r.Item_buypric)]
            ).catch(()=>{});
          }
        } else targetId = this.dryId('Items', sid);
        await this.setMapped('Items', sid, 'items', targetId, { code, name });
        this.stat('items', 'inserted');
      } catch (e) { this.stat('items', 'errors'); this.err(`item ${sid} (${code})`, e); }
    }
  }

  async migrateOpeningStock() {
    const mode = (this.cb.defaults && this.cb.defaults.openingStockSource) || 'items_evaluation';
    if (mode !== 'items_evaluation') { this.warn(`opening-stock source '${mode}' not implemented; use items_evaluation`); return; }
    const evals = this.load('Items_evaluation.csv');
    const stores = this.load('Stores.csv');
    // map branch->default warehouse target
    const branchWh = {};
    for (const s of stores) {
      const b = trim(s.Branch_ID);
      if (!branchWh[b] || bool(s.Store_IsDefault)) branchWh[b] = trim(s.ID);
    }
    for (const r of evals) {
      this.stat('opening_stock', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (await this.getMapped('Items_evaluation', sid)) { this.stat('opening_stock', 'skipped'); continue; }
      const itemId = await this.getMapped('Items', trim(r.ItemID));
      const whSrc = branchWh[trim(r.BranchID)];
      const whId = whSrc ? await this.getMapped('Stores', whSrc) : null;
      if (!itemId || !whId) { if (!this.opts.dryRun) this.warn(`opening stock ${sid}: missing item/warehouse mapping`); this.stat('opening_stock', 'skipped'); continue; }
      // qty unknown in evaluation row; we store avg cost reference as a zero-qty snapshot marker in meta only unless qty provided.
      // Safer trial: record mapping/meta without altering balances (requires confirmed qty source).
      await this.setMapped('Items_evaluation', sid, 'item_warehouse_qty', 0, { itemId, whId, avgc: num(r.AVGC), fifo: num(r.FIFO), lifo: num(r.LIFO), note: 'cost-reference-only; qty not applied (needs approved stock basis)' });
      this.stat('opening_stock', 'inserted');
    }
    this.warn('opening-stock: تم تسجيل تقييمات التكلفة كمرجع فقط دون تعديل أرصدة كمية (يتطلب أساس مخزون معتمد/كميات).');
  }

  async migrateOpeningPartyBalances() {
    const rows = this.load('SupCust_Accounts.csv');
    for (const r of rows) {
      this.stat('opening_parties', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      const isOpening = trim(r.Description) === '0' && trim(r.Invoice_ID) === '0' && trim(r.Accounts_Date).startsWith('2026-01-01');
      if (!isOpening) { continue; }
      if (await this.getMapped('SupCust_Accounts_opening', sid)) { this.stat('opening_parties', 'skipped'); continue; }
      const partyId = await this.getMapped('SupCust', trim(r.SupCust_ID));
      if (!partyId) { if (!this.opts.dryRun) this.warn(`opening party ${sid}: party not mapped`); this.stat('opening_parties', 'skipped'); continue; }
      const value = num(r.Value);
      try {
        if (!this.opts.dryRun) {
          // store as party opening_balance (idempotent via map; additive caution: set if currently 0 for this mapped source)
          await this.client.query('UPDATE parties SET opening_balance = opening_balance + $1::numeric WHERE party_id=$2::int', [value, partyId]);
        }
        await this.setMapped('SupCust_Accounts_opening', sid, 'parties.opening_balance', partyId, { value, sourceId: sid });
        this.stat('opening_parties', 'inserted');
      } catch (e) { this.stat('opening_parties', 'errors'); this.err(`opening party ${sid}`, e); }
    }
  }

  async migrateOpeningCash() {
    const rows = this.load('Cash.csv');
    for (const r of rows) {
      this.stat('opening_cash', 'read');
      const sid = trim(r.ID); if (!sid) continue;
      if (!(trim(r.action_type) === '0' && trim(r.action_date).startsWith('2026-01-01'))) continue;
      if (await this.getMapped('Cash_opening', sid)) { this.stat('opening_cash', 'skipped'); continue; }
      // Cash rows use Target as cash/drawer id in this dataset (matches Cashes.ID in samples)
      const acctId = await this.getMapped('Cashes', trim(r.Target) || trim(r.Cash_id));
      if (!acctId) { if (!this.opts.dryRun) this.warn(`opening cash ${sid}: account not mapped`); this.stat('opening_cash', 'skipped'); continue; }
      const value = num(r.action_value);
      try {
        if (!this.opts.dryRun) {
          await this.client.query('UPDATE cash_accounts SET opening_balance = opening_balance + $1::numeric WHERE cash_account_id=$2::int', [value, acctId]);
        }
        await this.setMapped('Cash_opening', sid, 'cash_accounts.opening_balance', acctId, { value, sourceId: sid });
        this.stat('opening_cash', 'inserted');
      } catch (e) { this.stat('opening_cash', 'errors'); this.err(`opening cash ${sid}`, e); }
    }
  }
}

(async () => {
  const opts = parseArgs(process.argv);
  const defaultSource = path.resolve(__dirname, '..', '..', '..', 'extracted-2026-11-15');
  opts.source = opts.source ? path.resolve(opts.source) : (fs.existsSync(defaultSource) ? defaultSource : null);
  if (!opts.source || !fs.existsSync(opts.source)) {
    console.error('مصدر الاستخراج غير موجود. مرّر --source "<path-to-extracted-csv-dir>"');
    process.exit(1);
  }
  const cbPath = opts.codebook ? path.resolve(opts.codebook) : path.join(__dirname, 'codebook.proposed.json');
  const codebook = JSON.parse(fs.readFileSync(cbPath, 'utf8'));
  if (codebook.meta && codebook.meta.status === 'PROPOSED_NOT_APPROVED') {
    console.log('تنبيه: codebook مقترح وغير معتمد نهائيًا (PROPOSED_NOT_APPROVED). راجع tools/migrate-ezees/codebook.proposed.json');
  }
  console.log(`المصدر: ${opts.source}`);
  console.log(`الوضع: ${opts.dryRun ? 'DRY-RUN (بدون كتابة)' : 'تنفيذ فعلي'} | المراحل: ${opts.phases.join(',')}`);

  let client = null;
  if (!opts.dryRun) {
    client = new Client(DB);
    await client.connect();
  }
  try {
    const migrator = new Migrator(opts, codebook, client);
    const report = await migrator.run();
    console.log('\n=== ملخص الترحيل ===');
    for (const [t, s] of Object.entries(report.tables)) {
      console.log(`- ${t}: read=${s.read} inserted/mapped=${s.inserted} skipped=${s.skipped} errors=${s.errors}`);
    }
    if (report.warnings.length) console.log(`تحذيرات (${report.warnings.length}):\n - ${report.warnings.slice(0,20).join('\n - ')}`);
    if (report.errors.length) console.log(`أخطاء (${report.errors.length}):\n - ${report.errors.slice(0,20).map(e=>e.msg+ (e.error?': '+e.error:'')).join('\n - ')}`);
    if (opts.report) { fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2), 'utf8'); console.log(`\nتم حفظ التقرير: ${opts.report}`); }
  } finally {
    if (client) await client.end();
  }
})().catch(e => { console.error('فشل الترحيل:', e.message || e); process.exit(1); });
