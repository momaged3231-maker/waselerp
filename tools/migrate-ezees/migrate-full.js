/*
 * Comprehensive Ezees -> WaselERP migration (idempotent).
 * Extends migrate.js to transfer as much transferable data as possible, aligned to WaselERP schema.
 *
 *   node tools/migrate-ezees/migrate-full.js --source "<extract-dir>" [--dry-run] [--phases all]
 *
 * Phases: master, company, employees, users, stock, invoices, cash, ledger
 *   master  : branches, warehouses, cash accounts, categories, units, parties, items (base)  [delegates to migrate.js logic subset]
 *   company : CompanyData -> app_settings, currencies
 *   employees: Emps -> employees
 *   users   : Ezees Users -> wasel users (password reset to Ezees@123, must be changed)
 *   stock   : tb_ItemOperations -> stock_movements + item_warehouse_qty (derived balances)
 *   invoices: Invoice_master -> invoices (+ 1 summary line each, stock/GL impact not reposted)
 *   cash    : Cash non-opening -> cash_transactions
 *   ledger  : SupCust_Accounts non-opening -> ledger_entries
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
  const out = { source: null, dryRun: false, phases: ['all'], codebook: null, limit: null, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--source') out.source = argv[++i];
    else if (a === '--phases') out.phases = String(argv[++i] || 'all').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--codebook') out.codebook = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--report') out.report = argv[++i];
  }
  if (out.phases.includes('all')) out.phases = ['master','company','employees','users','stock','invoices','cash','ledger'];
  return out;
}

function parseCSV(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
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
    const o = {}; for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j] !== undefined ? r[j] : ''; return o;
  });
}
function readCSV(dir, name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return { rows: [], missing: true, path: p };
  return { rows: parseCSV(fs.readFileSync(p, 'utf8')), missing: false, path: p };
}
const trim = v => (v == null ? '' : String(v)).trim();
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0; };
const intv = v => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : 0; };
const bool = v => /^true|1|yes$/i.test(trim(v));
const sqlDate = v => { const s = trim(v); if (!s) return null; return s.replace(' ', 'T').replace(/\.\d+$/, '') + 'Z'; };

class M {
  constructor(opts, codebook, client) {
    this.opts = opts; this.cb = codebook; this.client = client;
    this.report = { source: opts.source, dryRun: opts.dryRun, phases: opts.phases, startedAt: new Date().toISOString(), tables: {}, warnings: [], errors: [] };
    this.cache = new Map();
  }
  warn(msg) { this.report.warnings.push(msg); }
  err(msg, e) { this.report.errors.push({ msg, error: e ? String(e.message || e) : null }); }
  stat(t,f){ if(!this.report.tables[t]) this.report.tables[t]={read:0,inserted:0,skipped:0,errors:0}; this.report.tables[t][f]=(this.report.tables[t][f]||0)+1; }
  dryId(st,sid){ let h=0; const s=`${st}:${sid}`; for(let i=0;i<s.length;i++) h=((h*31)+s.charCodeAt(i))|0; return 900000000+(Math.abs(h||1)%90000000); }
  async ensureMap(){ if(this.opts.dryRun) return; await this.client.query(`CREATE TABLE IF NOT EXISTS ezees_migration_map (
    source_table text NOT NULL, source_id text NOT NULL, target_table text NOT NULL, target_id bigint NOT NULL, meta jsonb, migrated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(source_table,source_id))`); }
  async getMapped(st,sid){ const k=`${st}:${sid}`; if(this.cache.has(k)) return this.cache.get(k); if(this.opts.dryRun) return null;
    const r=await this.client.query('SELECT target_id::bigint AS target_id FROM ezees_migration_map WHERE source_table=$1 AND source_id=$2',[st,String(sid)]);
    const v=r.rows[0]?Number(r.rows[0].target_id):null; if(v!=null) this.cache.set(k,v); return v; }
  async setMapped(st,sid,tt,tid,meta){ const k=`${st}:${sid}`; const n=Number(tid); this.cache.set(k, Number.isFinite(n)?n:this.dryId(st,sid)); if(this.opts.dryRun) return;
    await this.client.query(`INSERT INTO ezees_migration_map(source_table,source_id,target_table,target_id,meta) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(source_table,source_id) DO UPDATE SET target_table=EXCLUDED.target_table,target_id=EXCLUDED.target_id,meta=EXCLUDED.meta`,[st,String(sid),tt,Number(tid),meta?JSON.stringify(meta):null]); }
  load(name){ const res=readCSV(this.opts.source,name); if(res.missing) this.warn(`missing file: ${name}`); if(this.opts.limit&&res.rows.length>this.opts.limit) res.rows=res.rows.slice(0,this.opts.limit); return res.rows; }

  async run(){
    await this.ensureMap();
    const p=this.opts.phases;
    // master: reuse logic by importing migrate.js Migrator? easier to inline essentials & call substeps
    if(p.includes('master')){ await this.mBranches(); await this.mWarehouses(); await this.mCashAccounts(); await this.mCategories(); await this.mUnits(); await this.mParties(); await this.mItems(); }
    if(p.includes('company')){ await this.mCompanyAndCurrencies(); }
    if(p.includes('employees')){ await this.mEmployees(); }
    if(p.includes('users')){ await this.mUsers(); }
    if(p.includes('stock')){ await this.mStockFromOperations(); }
    if(p.includes('invoices')){ await this.mInvoices(); }
    if(p.includes('cash')){ await this.mCashTransactions(); }
    if(p.includes('ledger')){ await this.mLedger(); }
    this.report.finishedAt=new Date().toISOString();
    return this.report;
  }

  async mBranches(){ const rows=this.load('Branches.csv'); for(const r of rows){ this.stat('branches','read'); const sid=trim(r.BranchID); if(!sid) continue; if(await this.getMapped('Branches',sid)){this.stat('branches','skipped');continue;}
    const code=`EZ-BR-${sid}`, name=trim(r.BranchName)||code; try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT branch_id FROM branches WHERE code=$1',[code]);
      if(ex.rows[0]) tid=Number(ex.rows[0].branch_id); else { const ins=await this.client.query(`INSERT INTO branches(code,name,address,phone,is_active) VALUES($1,$2,$3,$4,$5) RETURNING branch_id`,[code,name,trim(r.BranchAddress)||null,trim(r.BranchTel)||trim(r.BranchTel2)||null,true]); tid=Number(ins.rows[0].branch_id);} }
      else tid=this.dryId('Branches',sid); await this.setMapped('Branches',sid,'branches',tid,{code,name}); this.stat('branches','inserted'); }catch(e){this.stat('branches','errors');this.err(`branch ${sid}`,e);} } }

  async mWarehouses(){ const rows=this.load('Stores.csv'); for(const r of rows){ this.stat('warehouses','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Stores',sid)){this.stat('warehouses','skipped');continue;}
    const branchId=await this.getMapped('Branches',trim(r.Branch_ID)); if(!branchId && !this.opts.dryRun){this.stat('warehouses','errors');this.err(`store ${sid} branch missing`,null);continue;}
    const code=`EZ-WH-${sid}`, name=trim(r.Store_name)||code; try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT warehouse_id FROM warehouses WHERE branch_id=$1::int AND code=$2',[branchId,code]);
      if(ex.rows[0]) tid=Number(ex.rows[0].warehouse_id); else { const ins=await this.client.query(`INSERT INTO warehouses(branch_id,code,name,address,phone,manager_name,is_default,is_active,notes) VALUES($1::int,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING warehouse_id`,[branchId,code,name,trim(r.Store_address)||null,trim(r.Store_tel)||null,trim(r.Store_manager)||null,bool(r.Store_IsDefault),!bool(r.Store_IsDisabled),trim(r.Store_notes)||null]); tid=Number(ins.rows[0].warehouse_id);} }
      else tid=this.dryId('Stores',sid); await this.setMapped('Stores',sid,'warehouses',tid,{code,name,branchId}); this.stat('warehouses','inserted'); }catch(e){this.stat('warehouses','errors');this.err(`store ${sid}`,e);} } }

  async mCashAccounts(){ const rows=this.load('Cashes.csv'); const branches=this.load('Branches.csv'); const users=this.load('Users.csv'); const cashTx=this.load('Cash.csv'); const defaultBranch=branches[0]?trim(branches[0].BranchID):null;
    const cashBranch=new Map(); for(const u of users){ const cid=trim(u.CashID),bid=trim(u.BranchID); if(cid&&bid&&!cashBranch.has(cid)) cashBranch.set(cid,bid); }
    const freq=new Map(); for(const t of cashTx){ const at=trim(t.action_type); if(at==='27'||at==='28') continue; const cid=trim(t.Target)||trim(t.Cash_id); const bid=trim(t.BranchID); if(!cid||!bid) continue; if(!freq.has(cid)) freq.set(cid,new Map()); const m=freq.get(cid); m.set(bid,(m.get(bid)||0)+1); }
    for(const [cid,m] of freq.entries()){ if(cashBranch.has(cid)) continue; let best=null,bn=-1; for(const [bid,n] of m.entries()){ if(n>bn){best=bid;bn=n;} } if(best) cashBranch.set(cid,best); }
    for(const r of rows){ this.stat('cash_accounts','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Cashes',sid)){this.stat('cash_accounts','skipped');continue;}
      const branchSrc=cashBranch.get(sid)||defaultBranch; const branchId=branchSrc?await this.getMapped('Branches',branchSrc):null; if(!branchId&&!this.opts.dryRun){this.stat('cash_accounts','errors');this.err(`cash ${sid} no branch`,null);continue;}
      const name=trim(r.CashName)||`خزينة ${sid}`; try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT cash_account_id FROM cash_accounts WHERE branch_id=$1::int AND name=$2',[branchId,name]);
        if(ex.rows[0]) tid=Number(ex.rows[0].cash_account_id); else { const ins=await this.client.query(`INSERT INTO cash_accounts(branch_id,name,type,currency_code,opening_balance,is_active,notes) VALUES($1::int,$2,$3::smallint,$4,$5::numeric,$6,$7) RETURNING cash_account_id`,[branchId,name,1,this.cb.defaults?.baseCurrency||'EGP',0,true,trim(r.Notes)||null]); tid=Number(ins.rows[0].cash_account_id);} }
        else tid=this.dryId('Cashes',sid); await this.setMapped('Cashes',sid,'cash_accounts',tid,{name,branchId,sourceBranch:branchSrc}); this.stat('cash_accounts','inserted'); }catch(e){this.stat('cash_accounts','errors');this.err(`cash ${sid}`,e);} } }

  async mCategories(){ const rows=this.load('Category.csv'); for(const r of rows){ if(trim(r.ID)) this.stat('categories','read'); }
    const pending=new Map(rows.map(r=>[trim(r.ID),r]).filter(([id])=>id)); let progress=true,passes=0;
    while(pending.size&&progress&&passes<30){ progress=false; passes++; for(const [sid,r] of Array.from(pending.entries())){ const parentSrc=trim(r.ParentID); if(parentSrc&&parentSrc!=='0'&&!await this.getMapped('Category',parentSrc)) continue;
      if(await this.getMapped('Category',sid)){this.stat('categories','skipped');pending.delete(sid);progress=true;continue;} const name=trim(r.Name)||`تصنيف ${sid}`; const parentId=(parentSrc&&parentSrc!=='0')?await this.getMapped('Category',parentSrc):null;
      try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT category_id FROM categories WHERE name=$1 AND COALESCE(parent_id,0)=COALESCE($2::int,0)',[name,parentId]);
        if(ex.rows[0]) tid=Number(ex.rows[0].category_id); else { const ins=await this.client.query(`INSERT INTO categories(parent_id,code,name,is_active,notes) VALUES($1::int,$2,$3,$4,$5) RETURNING category_id`,[parentId,trim(r.Code)||null,name,true,trim(r.notes)||null]); tid=Number(ins.rows[0].category_id);} }
        else tid=this.dryId('Category',sid); await this.setMapped('Category',sid,'categories',tid,{name,parentId}); this.stat('categories','inserted'); }catch(e){this.stat('categories','errors');this.err(`cat ${sid}`,e);} pending.delete(sid); progress=true; } }
    if(pending.size) this.warn(`categories unresolved: ${Array.from(pending.keys()).slice(0,10).join(',')}`); }

  async mUnits(){ const rows=this.load('Units.csv'); for(const r of rows){ this.stat('units','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Units',sid)){this.stat('units','skipped');continue;}
    const name=trim(r.UnitName)||`وحدة ${sid}`; try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT unit_id FROM units WHERE lower(name)=lower($1)',[name]);
      if(ex.rows[0]) tid=Number(ex.rows[0].unit_id); else { const ins=await this.client.query(`INSERT INTO units(code,name,name_en,is_active) VALUES($1,$2,$3,$4) RETURNING unit_id`,[trim(r.UnitCode)||null,name,trim(r.UnitName_en)||null,true]); tid=Number(ins.rows[0].unit_id);} }
      else tid=this.dryId('Units',sid); await this.setMapped('Units',sid,'units',tid,{name}); this.stat('units','inserted'); }catch(e){this.stat('units','errors');this.err(`unit ${sid}`,e);} } }

  async mParties(){ const rows=this.load('SupCust.csv'); const typeMap=(this.cb.supCustTypeToPartyType)||{'0':1,'1':2,'2':3};
    for(const r of rows){ this.stat('parties','read'); const sid=trim(r.ID); if(!sid) continue; if(sid==='1' && this.cb.defaults && this.cb.defaults.migratePlaceholderPartyId1===false){this.stat('parties','skipped');continue;}
      if(await this.getMapped('SupCust',sid)){this.stat('parties','skipped');continue;} const code=`EZ-P-${sid}`; const name=trim(r.SupCust_Name)||(sid==='1'?'عميل نقدي (Ezees)':code);
      const partyType=typeMap[trim(r.SupCust_Type)]||1; const branchId=await this.getMapped('Branches',trim(r.BranchID)); const isActive=!/^true$/i.test(trim(r.SupCust_IsDisabled));
      try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT party_id FROM parties WHERE code=$1',[code]);
        if(ex.rows[0]) tid=Number(ex.rows[0].party_id); else { const ins=await this.client.query(`INSERT INTO parties(code,name,party_type,branch_id,address,phone,mobile,email,city,credit_limit,discount_pct,opening_balance,notes,is_active)
          VALUES($1,$2,$3::smallint,$4::int,$5,$6,$7,$8,$9,$10::numeric,$11::numeric,0::numeric,$12,$13) RETURNING party_id`,[code,name,partyType,branchId||null,trim(r.SupCust_Address)||null,trim(r.SupCust_Tel)||null,trim(r.SupCust_Mob)||null,trim(r.SupCust_Email)||null,trim(r.SupCust_Town)||null,num(r.SupCust_MaxCredit),num(r.SupCust_Discount),trim(r.SupCust_Notes)||null,isActive]); tid=Number(ins.rows[0].party_id);} }
        else tid=this.dryId('SupCust',sid); await this.setMapped('SupCust',sid,'parties',tid,{code,name,partyType}); this.stat('parties','inserted'); }catch(e){this.stat('parties','errors');this.err(`party ${sid}`,e);} } }

  async mItems(){ const rows=this.load('Items.csv'); const baseUnitId=await this.getMapped('Units','1');
    for(const r of rows){ this.stat('items','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Items',sid)){this.stat('items','skipped');continue;}
      const rawCode=trim(r.Item_code); const code=(rawCode&&rawCode!=='0')?rawCode:`EZ-ITEM-${sid}`; const name=trim(r.Item_name)||code; const categoryId=await this.getMapped('Category',trim(r.Category_id)); const unitId=await this.getMapped('Units',trim(r.Unit_ID))||baseUnitId;
      if(!unitId&&!this.opts.dryRun){this.stat('items','errors');this.err(`item ${sid} no unit`,null);continue;}
      try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT item_id FROM items WHERE code=$1',[code]);
        if(ex.rows[0]){ tid=Number(ex.rows[0].item_id); await this.client.query(`UPDATE items SET name=$2,category_id=$3::int,base_unit_id=$4::int,cost_price=$5::numeric,sell_price=$6::numeric,min_price=$7::numeric,vat_pct=$8::numeric,reorder_point=$9::numeric,is_active=$10,notes=$11,is_service=$12,is_grouped=$13,has_serial=$14 WHERE item_id=$1::int`,[tid,name,categoryId||null,unitId,num(r.Item_buypric),num(r.Item_sellpricNow),num(r.Min_Price),num(r.SalesTax),num(r.Item_request_point),!bool(r.Item_Isdisabled),trim(r.Notes)||null,bool(r.Is_Service),bool(r.IsGrouped),bool(r.IsSerial)]); }
        else { const ins=await this.client.query(`INSERT INTO items(code,barcode,name,category_id,base_unit_id,is_service,is_grouped,has_serial,has_expiry,has_batch,track_quantity,cost_price,sell_price,whole_sale_price,min_price,vat_pct,discount_pct,reorder_point,is_active,notes)
          VALUES($1,$2,$3,$4::int,$5::int,$6,$7,$8,false,false,true,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16,$17) RETURNING item_id`,[code,(rawCode&&rawCode!=='0')?rawCode:null,name,categoryId||null,unitId,bool(r.Is_Service),bool(r.IsGrouped),bool(r.IsSerial),num(r.Item_buypric),num(r.Item_sellpricNow),num(r.CustomerPrice)||null,num(r.Min_Price),num(r.SalesTax),num(r.DiscountRate),num(r.Item_request_point),!bool(r.Item_Isdisabled),trim(r.Notes)||null]); tid=Number(ins.rows[0].item_id); }
        await this.client.query(`INSERT INTO item_units(item_id,unit_id,factor,sell_price,buy_price,is_default) VALUES($1::int,$2::int,1,$3::numeric,$4::numeric,true) ON CONFLICT DO NOTHING`,[tid,unitId,num(r.Item_sellpricNow),num(r.Item_buypric)]).catch(()=>{});
      } else tid=this.dryId('Items',sid); await this.setMapped('Items',sid,'items',tid,{code,name}); this.stat('items','inserted'); }catch(e){this.stat('items','errors');this.err(`item ${sid}`,e);} } }

  async mCompanyAndCurrencies(){
    // currencies
    const curs=this.load('tb_Currency.csv');
    for(const r of curs){ this.stat('currencies','read'); const code=trim(r.CurrencyCode)||trim(r.CurrencyName)||`C${trim(r.ID)}`; if(!code) continue; const key=`CUR:${code}`; if(await this.getMapped('tb_Currency',key)){this.stat('currencies','skipped');continue;}
      try{ if(!this.opts.dryRun){ await this.client.query(`INSERT INTO currencies(currency_code,name,symbol,is_base,rate) VALUES($1,$2,$3,$4,$5::numeric)
        ON CONFLICT(currency_code) DO UPDATE SET name=EXCLUDED.name, symbol=COALESCE(EXCLUDED.symbol,currencies.symbol), rate=EXCLUDED.rate, is_base=currencies.is_base OR EXCLUDED.is_base`,[code.substring(0,10),trim(r.CurrencyName)||code,trim(r.CurrencyName)||null,bool(r.IsDefault),num(r.ExchangeRate)||1]); }
        await this.setMapped('tb_Currency',key,'currencies',0,{code}); this.stat('currencies','inserted'); }catch(e){this.stat('currencies','errors');this.err(`currency ${code}`,e);} }
    // company -> settings
    const co=this.load('CompanyData.csv')[0]; if(co){ this.stat('company','read'); const pairs=[['CompanyName',trim(co.CName)],['CompanyNameEn',trim(co.CName_EN)],['CompanyAddress',trim(co.CAddress)],['CompanyPhone',trim(co.CTel1)||trim(co.CTel2)],['CompanyEmail',trim(co.CEmail)],['CompanyTaxNumber',trim(co.CTaxNo)],['CompanyWebsite',trim(co.CWebSite)]];
      try{ for(const [k,v] of pairs){ if(!v) continue; if(!this.opts.dryRun) await this.client.query(`INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,now()) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,[k,v]); }
        await this.setMapped('CompanyData','1','app_settings',0,{name:trim(co.CName)}); this.stat('company','inserted'); }catch(e){this.stat('company','errors');this.err('company',e);} }
  }

  async mEmployees(){
    const rows=this.load('Emps.csv'); const defaultBranch=(this.load('Branches.csv')[0]||{}); const defB=await this.getMapped('Branches',trim(defaultBranch.BranchID)||'1');
    for(const r of rows){ this.stat('employees','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Emps',sid)){this.stat('employees','skipped');continue;}
      const name=trim(r.Emp_name)||`موظف ${sid}`; const code=trim(r.Emp_code)||`EZ-E-${sid}`; const branchId=await this.getMapped('Branches',trim(r.BranchID))||defB;
      if(!branchId&&!this.opts.dryRun){this.stat('employees','errors');this.err(`emp ${sid} no branch`,null);continue;}
      try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT employee_id FROM employees WHERE code=$1',[code]);
        const basic=num(r.Emp_sal)+num(r.Emp_sal_extra)+num(r.Emp_sal_others); const allowances=0; const deductions=num(r.Emp_co_insur)+num(r.Emp_wo_insur)+num(r.Emp_tax)+num(r.Emp_tax_others);
        if(ex.rows[0]) tid=Number(ex.rows[0].employee_id); else { const ins=await this.client.query(`INSERT INTO employees(code,name,branch_id,job_title,national_id,phone,mobile,address,hire_date,basic_salary,allowances,deductions,is_active,notes)
          VALUES($1,$2,$3::int,$4,$5,$6,$7,$8,$9::date,$10::numeric,$11::numeric,$12::numeric,$13,$14) RETURNING employee_id`,[code,name,branchId,trim(r.Emp_job)||null,trim(r.Emp_NationalID)||null,trim(r.Emp_tel)||null,trim(r.Emp_mob)||null,trim(r.Emp_Address)||null,trim(r.AppointmentDate)?trim(r.AppointmentDate).slice(0,10):null,basic,allowances,deductions,!bool(r.Emp_IsDisabled),trim(r.Emp_notes)||null]); tid=Number(ins.rows[0].employee_id);} }
        else tid=this.dryId('Emps',sid); await this.setMapped('Emps',sid,'employees',tid,{code,name}); this.stat('employees','inserted'); }catch(e){this.stat('employees','errors');this.err(`emp ${sid}`,e);} } }

  async ensureSummaryItem(){
    if(await this.getMapped('System','summary-item')) return await this.getMapped('System','summary-item');
    const unitId=await this.getMapped('Units','1');
    if(this.opts.dryRun){ const id=this.dryId('System','summary-item'); await this.setMapped('System','summary-item','items',id,{}); return id; }
    const ex=await this.client.query("SELECT item_id FROM items WHERE code='EZ-MIG-SUMMARY'");
    let tid; if(ex.rows[0]) tid=Number(ex.rows[0].item_id); else { const ins=await this.client.query(`INSERT INTO items(code,name,base_unit_id,is_service,track_quantity,cost_price,sell_price,is_active,notes) VALUES('EZ-MIG-SUMMARY','بند مرحّل من Ezees (إجمالي فاتورة)',$1::int,true,false,0,0,true,'صنف نظامي لتمثيل فواتير تاريخية مرحّلة بدون سطور تفصيلية') RETURNING item_id`,[unitId||1]); tid=Number(ins.rows[0].item_id);
      await this.client.query(`INSERT INTO item_units(item_id,unit_id,factor,sell_price,buy_price,is_default) VALUES($1::int,$2::int,1,0,0,true) ON CONFLICT DO NOTHING`,[tid,unitId||1]).catch(()=>{}); }
    await this.setMapped('System','summary-item','items',tid,{code:'EZ-MIG-SUMMARY'}); return tid;
  }

  async mStockFromOperations(){
    const ops=this.load('tb_ItemOperations.csv');
    // compute balances per (item, warehouse, unit)
    const bal=new Map();
    for(const r of ops){ const itemSrc=trim(r.OP_ItemID), whSrc=trim(r.OP_StoreID); if(!itemSrc||!whSrc) continue; const dir=trim(r.OP_Direction); const sign = dir==='1'?1:(dir==='0'?-1:(num(r.OP_Qty)>=0?1:-1));
      const qty=num(r.OP_Qty)*sign; const key=`${itemSrc}|${whSrc}|${trim(r.OP_UnitID)||'1'}`; const prev=bal.get(key)||{itemSrc,whSrc,unitSrc:trim(r.OP_UnitID)||'1',qty:0,cost:num(r.OP_Unitprice),last:trim(r.OP_Date)};
      prev.qty+=qty; if(trim(r.OP_Date)>prev.last){prev.last=trim(r.OP_Date); prev.cost=num(r.OP_Unitprice)||prev.cost;} bal.set(key,prev); }
    // write item_warehouse_qty
    let i=0; for(const v of bal.values()){ i++; this.stat('stock_balance','read'); const mapKey=`BAL:${v.itemSrc}:${v.whSrc}:${v.unitSrc}`; if(await this.getMapped('StockBalance',mapKey)){this.stat('stock_balance','skipped');continue;}
      const itemId=await this.getMapped('Items',v.itemSrc); const whId=await this.getMapped('Stores',v.whSrc); const unitId=await this.getMapped('Units',v.unitSrc)||await this.getMapped('Units','1');
      if(!itemId||!whId||!unitId){ if(!this.opts.dryRun) this.warn(`stock balance missing map ${mapKey}`); this.stat('stock_balance','skipped'); continue; }
      try{ if(!this.opts.dryRun){ await this.client.query(`INSERT INTO item_warehouse_qty(item_id,warehouse_id,unit_id,on_hand_qty,reserved_qty,avg_cost,last_move_at)
        VALUES($1::int,$2::int,$3::int,$4::numeric,0,$5::numeric,$6::timestamptz)
        ON CONFLICT(item_id,warehouse_id,unit_id) DO UPDATE SET on_hand_qty=EXCLUDED.on_hand_qty, avg_cost=EXCLUDED.avg_cost, last_move_at=EXCLUDED.last_move_at`,
        [itemId,whId,unitId,Number(v.qty.toFixed(6)),Number(v.cost||0), v.last?sqlDate(v.last):null]); }
        await this.setMapped('StockBalance',mapKey,'item_warehouse_qty',0,{itemId,whId,qty:v.qty}); this.stat('stock_balance','inserted'); }catch(e){this.stat('stock_balance','errors');this.err(`stock bal ${mapKey}`,e);} }
    this.warn(`stock: تم احتساب أرصدة كمية من ${ops.length} حركة (tb_ItemOperations) وتحديث item_warehouse_qty. لم تُنشأ قيود محاسبية تاريخية للحركات.`);
  }

  async mInvoices(){
    const rows=this.load('Invoice_master.csv'); if(!rows.length) return;
    const summaryItem=await this.ensureSummaryItem(); const unitId=await this.getMapped('Units','1');
    const stores=this.load('Stores.csv');
    const branchDefaultWh=new Map(); for(const s of stores){ const b=trim(s.Branch_ID); if(!branchDefaultWh.has(b)||bool(s.Store_IsDefault)) branchDefaultWh.set(b,trim(s.ID)); }
    for(const r of rows){ this.stat('invoices','read'); const sid=trim(r.id); if(!sid) continue; if(await this.getMapped('Invoice_master',sid)){this.stat('invoices','skipped');continue;}
      const eType=trim(r.invoice_type); // proposed mapping: 1->sales(1), 2->sales return(3)? 0/3 -> keep as sales? conservative: 1->1,2->3,3->1,0->1
      const typeMap={'1':1,'2':3,'3':1,'0':1}; const invType=typeMap[eType]||1;
      const branchId=await this.getMapped('Branches',trim(r.BranchID)); const whSrc=trim(r.store_id)&&trim(r.store_id)!=='0'?trim(r.store_id):branchDefaultWh.get(trim(r.BranchID));
      const whId=whSrc?await this.getMapped('Stores',whSrc):null; const partyId=await this.getMapped('SupCust',trim(r.supcust_id));
      if(!branchId||!whId){ if(!this.opts.dryRun) this.warn(`invoice ${sid} missing branch/wh`); this.stat('invoices','skipped'); continue; }
      const invNo=trim(r.invoice_code)||`EZ-INV-${sid}`; const total=num(r.FinalCost)||num(r.SubTotal)||0; const sub=num(r.SubTotal)||total; const disc=num(r.discounts)||0; const tax=num(r.SalesTax)||num(r.TotalItemTax)||0; const date=sqlDate(r.invoice_date)||new Date().toISOString();
      const payTypeMap={'0':1,'1':1,'2':2}; const payType=payTypeMap[trim(r.paymant_type)]||1; const status=bool(r.isdeleted)?3:2;
      try{ let tid; if(!this.opts.dryRun){
        const ex=await this.client.query('SELECT invoice_id FROM invoices WHERE invoice_no=$1 AND invoice_type=$2::smallint AND branch_id=$3::int',[invNo,invType,branchId]);
        if(ex.rows[0]) tid=Number(ex.rows[0].invoice_id); else {
          // ensure created_by is valid user (admin id 1)
          const ins=await this.client.query(`INSERT INTO invoices(invoice_no,invoice_type,branch_id,warehouse_id,party_id,invoice_date,status,payment_type,sub_total,discount_amount,tax_amount,total_amount,paid_amount,cost_total,profit_amount,created_by,notes,is_posted,posted_at,client_request_id)
            VALUES($1,$2::smallint,$3::int,$4::int,$5::int,$6::timestamptz,$7::smallint,$8::smallint,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::numeric,0,0,1,$14,true,$6::timestamptz,$15) RETURNING invoice_id`,
            [invNo,invType,branchId,whId,partyId||null,date,status,payType,sub,disc,tax,total,payType===1?total:0, trim(r.Notes1)||trim(r.Notes2)||`مرحل من Ezees (invoice_master#${sid}, type ${eType})`, `ezees:inv:${sid}`]);
          tid=Number(ins.rows[0].invoice_id);
          await this.client.query(`INSERT INTO invoice_lines(invoice_id,line_number,item_id,unit_id,quantity,unit_price,discount_amount,tax_amount,line_total,unit_cost,notes)
            VALUES($1::bigint,1,$2::int,$3::int,1,$4::numeric,$5::numeric,$6::numeric,$7::numeric,0,$8)`,
            [tid,summaryItem,unitId||1,sub,disc,tax,total,'سطر إجمالي (لا توجد سطور تفصيلية في مصدر Ezees)']);
        }
      } else tid=this.dryId('Invoice_master',sid);
      await this.setMapped('Invoice_master',sid,'invoices',tid,{invNo,invType,eType}); this.stat('invoices','inserted'); }catch(e){this.stat('invoices','errors');this.err(`invoice ${sid}`,e);} }
    this.warn('invoices: رُحّلت رؤوس الفواتير مع سطر إجمالي واحد لكل فاتورة (المصدر بلا سطور تفصيلية). لم يُعاد ترحيل أثر مخزني/قيود محاسبية تلقائية لهذه الفواتير لتجنب ازدواجية مع أرصدة المخزون المحتسبة من الحركات.');
  }

  async mCashTransactions(){
    const rows=this.load('Cash.csv');
    for(const r of rows){ this.stat('cash_tx','read'); const sid=trim(r.ID); if(!sid) continue; const at=trim(r.action_type); const ad=trim(r.action_date);
      if(at==='0' && ad.startsWith('2026-01-01')) continue; // opening handled separately
      if(await this.getMapped('Cash',sid)){this.stat('cash_tx','skipped');continue;}
      const cashAccId=await this.getMapped('Cashes',trim(r.Target)||trim(r.Cash_id)); const branchId=await this.getMapped('Branches',trim(r.BranchID));
      if(!cashAccId||!branchId){ if(!this.opts.dryRun) this.warn(`cash tx ${sid} missing acc/branch`); this.stat('cash_tx','skipped'); continue; }
      const dir = trim(r.action_direction)==='1'?2:1; const amount=num(r.action_value); const date=sqlDate(ad)||new Date().toISOString();
      try{ if(!this.opts.dryRun){
        // idempotency via description marker not unique; rely on map
        await this.client.query(`INSERT INTO cash_transactions(branch_id,cash_account_id,direction,amount,transaction_date,description,created_by)
          VALUES($1::int,$2::int,$3::smallint,$4::numeric,$5::timestamptz,$6,1)`,
          [branchId,cashAccId,dir,amount,date, (trim(r.action_notes)||`حركة مرحلة Ezees type ${at}`)+` [EZ-CASH#${sid}]`]);
      }
      await this.setMapped('Cash',sid,'cash_transactions',0,{amount,dir,at}); this.stat('cash_tx','inserted'); }catch(e){this.stat('cash_tx','errors');this.err(`cash tx ${sid}`,e);} }
  }

  async mLedger(){
    const rows=this.load('SupCust_Accounts.csv');
    for(const r of rows){ this.stat('ledger','read'); const sid=trim(r.ID); if(!sid) continue; const isOpening = trim(r.Description)==='0' && trim(r.Invoice_ID)==='0' && trim(r.Accounts_Date).startsWith('2026-01-01');
      if(isOpening) continue; // opening applied to party balance already in prior phase logic; skip duplicating as entry unless desired
      if(await this.getMapped('SupCust_Accounts',sid)){this.stat('ledger','skipped');continue;}
      const partyId=await this.getMapped('SupCust',trim(r.SupCust_ID)); const branchId=await this.getMapped('Branches',trim(r.BranchID))|| (await this.getMapped('Branches','1'));
      if(!partyId||!branchId){ if(!this.opts.dryRun) this.warn(`ledger ${sid} missing party/branch`); this.stat('ledger','skipped'); continue; }
      const val=num(r.Value); const dir = val>=0 ? 1 : 2; const amount=Math.abs(val); const date=sqlDate(r.Accounts_Date)||new Date().toISOString();
      try{ if(!this.opts.dryRun){ await this.client.query(`INSERT INTO ledger_entries(branch_id,party_id,entry_date,direction,entry_type,amount,reference_no,notes,created_by)
        VALUES($1::int,$2::int,$3::timestamptz,$4::smallint,5::smallint,$5::numeric,$6,$7,1)`,[branchId,partyId,date,dir,amount,trim(r.Invoice_ID)&&trim(r.Invoice_ID)!=='0'?`INV-${trim(r.Invoice_ID)}`:null,(trim(r.Notes)||`قيد مرحّل من Ezees`)+` [EZ-SA#${sid}, desc=${trim(r.Description)}]`]); }
      await this.setMapped('SupCust_Accounts',sid,'ledger_entries',0,{val,dir}); this.stat('ledger','inserted'); }catch(e){this.stat('ledger','errors');this.err(`ledger ${sid}`,e);} }
  }

  async mUsers(){
    const rows=this.load('Users.csv');
    // Ezees passwords are incompatible hashes; create/reset with known temp password.
    const tempPass='Ezees@123';
    // need scrypt to match WaselERP? seed uses security.ts hashing; easier to insert via raw hash using same algorithm is complex here.
    // Pragmatic: call seed logic not available; instead use pgcrypto-like? No. We'll insert users with a placeholder and warn admin to reset via UI if hash mismatches.
    // Better: generate compatible hash using Node's crypto.scryptSync same as app (salt random, derived key hex). Let us implement.
    const crypto=require('crypto');
    function hashPassword(pw){ const salt=crypto.randomBytes(16).toString('hex'); const hash=crypto.scryptSync(pw,salt,64).toString('hex'); return {hash,salt}; }
    for(const r of rows){ this.stat('users','read'); const sid=trim(r.ID); if(!sid) continue; if(await this.getMapped('Users',sid)){this.stat('users','skipped');continue;}
      const uname=trim(r.User_Name)||`ezees_${sid}`; const branchId=await this.getMapped('Branches',trim(r.BranchID));
      try{ let tid; if(!this.opts.dryRun){ const ex=await this.client.query('SELECT user_id FROM users WHERE user_name=$1',[uname]); if(ex.rows[0]){ tid=Number(ex.rows[0].user_id); }
        else { const {hash,salt}=hashPassword(tempPass); const ins=await this.client.query(`INSERT INTO users(user_name,full_name,password_hash,password_salt,default_branch_id,is_active,is_cashier)
          VALUES($1,$2,$3,$4,$5::int,$6,$7) RETURNING user_id`,[uname,uname,hash,salt,branchId||null,/^true$/i.test(trim(r.Active)), /^cash/i.test(uname) || trim(r.CashID)!=='']); tid=Number(ins.rows[0].user_id); }
      } else tid=this.dryId('Users',sid); await this.setMapped('Users',sid,'users',tid,{uname,tempPassword: tempPass}); this.stat('users','inserted'); }catch(e){this.stat('users','errors');this.err(`user ${sid}`,e);} }
    this.warn(`users: تم إنشاء/ربط ${rows.length} مستخدمين بكلمة مرور مؤقتة "${tempPass}" (هاشات Ezees غير متوافقة) — يجب تغييرها فورًا.`);
  }
}

(async()=>{
  const opts=parseArgs(process.argv);
  const defSrc=path.resolve(__dirname,'..','..','..','extracted-2026-11-15');
  opts.source=opts.source?path.resolve(opts.source):(fs.existsSync(defSrc)?defSrc:null);
  if(!opts.source||!fs.existsSync(opts.source)){ console.error('مصدر الاستخراج غير موجود. مرّر --source'); process.exit(1); }
  const cbPath=opts.codebook?path.resolve(opts.codebook):path.join(__dirname,'codebook.proposed.json');
  const codebook=JSON.parse(fs.readFileSync(cbPath,'utf8'));
  console.log(`المصدر: ${opts.source}`);
  console.log(`الوضع: ${opts.dryRun?'DRY-RUN':'تنفيذ فعلي'} | المراحل: ${opts.phases.join(',')}`);
  let client=null; if(!opts.dryRun){ client=new Client(DB); await client.connect(); }
  try{ const m=new M(opts,codebook,client); const report=await m.run();
    console.log('\n=== ملخص الترحيل الشامل ===');
    for(const [t,s] of Object.entries(report.tables)) console.log(`- ${t}: read=${s.read} inserted/mapped=${s.inserted} skipped=${s.skipped} errors=${s.errors}`);
    if(report.warnings.length) console.log(`تحذيرات (${report.warnings.length}):\n - ${report.warnings.slice(0,30).join('\n - ')}`);
    if(report.errors.length) console.log(`أخطاء (${report.errors.length}):\n - ${report.errors.slice(0,30).map(e=>e.msg+(e.error?': '+e.error:'')).join('\n - ')}`);
    if(opts.report){ fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report,null,2),'utf8'); console.log(`\nتم حفظ التقرير: ${opts.report}`); }
  } finally { if(client) await client.end(); }
})().catch(e=>{ console.error('فشل:', e.message||e); console.error(e.stack); process.exit(1); });
