import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed, countReferencingRows } from '../../common/delete-guard';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { postJournal, requireMapping } from '../../common/posting';
import { parseImportFile, buildTemplateXlsx, applyHeaderAliases, PARTY_IMPORT_ALIASES } from '../../common/spreadsheet';

export interface PartyDto {
  partyId?: number;
  code?: string;
  name: string;
  nameEn?: string;
  partyType: number;
  phone?: string;
  mobile?: string;
  address?: string;
  taxNumber?: string;
  creditLimit?: number;
  discountPct?: number;
  isActive?: boolean;
  notes?: string;
  priceListId?: number | null;
  customerGroupId?: number | null;
  classificationId?: number | null;
  salesRepId?: number | null;
}

@Injectable()
export class PartiesService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: { search?: string; type?: number; page: number; pageSize: number }) {
    const offset = (params.page - 1) * params.pageSize;
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    const type = params.type ?? 0;

    const where = `WHERE ($1::text = '' OR p.name ILIKE $2 OR COALESCE(p.code,'') ILIKE $2 OR COALESCE(p.phone,'') ILIKE $2)
                   AND ($3::int = 0 OR p.party_type = $3 OR p.party_type = 3)`;

    const items = await this.db.query(
      `SELECT p.party_id AS "partyId", p.code, p.name, p.name_en AS "nameEn", p.party_type AS "partyType",
              p.phone, p.mobile, p.address, p.tax_number AS "taxNumber",
              p.credit_limit AS "creditLimit", p.discount_pct AS "discountPct", p.is_active AS "isActive",
              p.price_list_id AS "priceListId", pl.name AS "priceListName",
              p.customer_group_id AS "customerGroupId", cg.name AS "customerGroupName",
              p.classification_id AS "classificationId", cc.name AS "classificationName",
              p.sales_rep_id AS "salesRepId", u.full_name AS "salesRepName",
              COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                          FROM ledger_entries l WHERE l.party_id = p.party_id), p.opening_balance) AS balance
         FROM parties p
         LEFT JOIN price_lists pl ON pl.price_list_id = p.price_list_id
         LEFT JOIN customer_groups cg ON cg.customer_group_id = p.customer_group_id
         LEFT JOIN customer_classifications cc ON cc.classification_id = p.classification_id
         LEFT JOIN users u ON u.user_id = p.sales_rep_id ${where}
        ORDER BY p.name LIMIT $4 OFFSET $5`,
      [search, like, type, params.pageSize, offset],
    );

    const total = await this.db.count(`SELECT COUNT(*)::int AS count FROM parties p ${where}`, [search, like, type]);
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async findOne(id: number) {
    const row = await this.db.one(
      `SELECT p.party_id AS "partyId", p.code, p.name, p.name_en AS "nameEn", p.party_type AS "partyType",
              p.phone, p.mobile, p.address, p.tax_number AS "taxNumber", p.city, p.area,
              p.credit_limit AS "creditLimit", p.discount_pct AS "discountPct", p.is_active AS "isActive",
              p.price_list_id AS "priceListId", pl.name AS "priceListName",
              p.customer_group_id AS "customerGroupId", cg.name AS "customerGroupName",
              p.classification_id AS "classificationId", cc.name AS "classificationName",
              p.sales_rep_id AS "salesRepId", u.full_name AS "salesRepName",
              p.notes, p.opening_balance AS "openingBalance",
              COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                          FROM ledger_entries l WHERE l.party_id = p.party_id), p.opening_balance) AS balance
         FROM parties p
         LEFT JOIN price_lists pl ON pl.price_list_id = p.price_list_id
         LEFT JOIN customer_groups cg ON cg.customer_group_id = p.customer_group_id
         LEFT JOIN customer_classifications cc ON cc.classification_id = p.classification_id
         LEFT JOIN users u ON u.user_id = p.sales_rep_id
        WHERE p.party_id = $1`,
      [id],
    );
    if (!row) return null;

    const ledger = await this.db.query(
      `SELECT l.ledger_entry_id AS "entryId", l.entry_date AS "entryDate", l.direction, l.entry_type AS "entryType",
              l.amount, l.reference_no AS "referenceNo", l.notes, i.invoice_no AS "invoiceNo"
         FROM ledger_entries l LEFT JOIN invoices i ON i.invoice_id = l.invoice_id
        WHERE l.party_id = $1 ORDER BY l.entry_date DESC, l.ledger_entry_id DESC LIMIT 200`,
      [id],
    );
    return { ...row, ledger };
  }

  async create(dto: PartyDto, user: AuthUser) {
    const row = await this.db.one(
      `INSERT INTO parties (code, name, name_en, party_type, branch_id, address, phone, mobile, tax_number,
                            credit_limit, discount_pct, is_active, notes, price_list_id, customer_group_id, classification_id, sales_rep_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING party_id`,
      [
        dto.code ?? null, dto.name, dto.nameEn ?? null, dto.partyType, user.defaultBranchId,
        dto.address ?? null, dto.phone ?? null, dto.mobile ?? null, dto.taxNumber ?? null,
        dto.creditLimit ?? 0, dto.discountPct ?? 0, dto.isActive ?? true, dto.notes ?? null,
        dto.priceListId ? Number(dto.priceListId) : null,
        dto.customerGroupId ? Number(dto.customerGroupId) : null,
        dto.classificationId ? Number(dto.classificationId) : null,
        dto.salesRepId ? Number(dto.salesRepId) : null,
      ],
    );
    return { partyId: row.party_id };
  }

  async update(id: number, dto: PartyDto) {
    await this.db.query(
      `UPDATE parties SET code=$2, name=$3, name_en=$4, party_type=$5, address=$6, phone=$7, mobile=$8,
              tax_number=$9, credit_limit=$10, discount_pct=$11, is_active=$12, notes=$13,
              price_list_id=$14, customer_group_id=$15, classification_id=$16, sales_rep_id=$17, version = version + 1
        WHERE party_id=$1`,
      [
        id, dto.code ?? null, dto.name, dto.nameEn ?? null, dto.partyType, dto.address ?? null,
        dto.phone ?? null, dto.mobile ?? null, dto.taxNumber ?? null, dto.creditLimit ?? 0,
        dto.discountPct ?? 0, dto.isActive ?? true, dto.notes ?? null,
        dto.priceListId === undefined ? null : (dto.priceListId ? Number(dto.priceListId) : null),
        dto.customerGroupId === undefined ? null : (dto.customerGroupId ? Number(dto.customerGroupId) : null),
        dto.classificationId === undefined ? null : (dto.classificationId ? Number(dto.classificationId) : null),
        dto.salesRepId === undefined ? null : (dto.salesRepId ? Number(dto.salesRepId) : null),
      ],
    );
    return { partyId: id };
  }

  /** Receivables / payables report for one party. */
  async statement(id: number) {
    const party = await this.findOne(id);
    if (!party) return null;
    const rows = await this.db.query(
      `SELECT l.ledger_entry_id AS "entryId", l.entry_date AS "entryDate", l.direction, l.entry_type AS "entryType",
              l.amount, l.reference_no AS "referenceNo", l.notes, i.invoice_no AS "invoiceNo"
         FROM ledger_entries l LEFT JOIN invoices i ON i.invoice_id = l.invoice_id
        WHERE l.party_id = $1 ORDER BY l.entry_date, l.ledger_entry_id`,
      [id],
    );
    let running = Number(party.openingBalance ?? 0);
    const lines = rows.map((row: any) => {
      running += row.direction === 1 ? Number(row.amount) : -Number(row.amount);
      return { ...row, running };
    });
    return { party, lines, closingBalance: running };
  }

  // ------------------------------------------------------------------ //
  //  Tools → «استيراد عملاء وموردين» + «تعيين أرصدة البداية»
  // ------------------------------------------------------------------ //

  private static readonly IMPORT_HEADER = ['code', 'name', 'type', 'phone', 'mobile', 'email', 'address', 'tax_number', 'credit_limit', 'discount_pct', 'customer_group', 'classification', 'sales_rep'];
  private static readonly IMPORT_EXAMPLE: (string | number)[] = ['C-0001', 'شركة الوصل', 'عميل', '01000000000', '', '', 'الجيزة', '', 0, 0, '', '', ''];

  template(format: string) {
    if (format === 'xlsx') {
      return {
        fileName: 'parties-import-template.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: buildTemplateXlsx(PartiesService.IMPORT_HEADER, PartiesService.IMPORT_EXAMPLE).toString('base64'),
      };
    }
    const csv = [PartiesService.IMPORT_HEADER.join(','), PartiesService.IMPORT_EXAMPLE.join(',')].join('\r\n') + '\r\n';
    return {
      fileName: 'parties-import-template.csv',
      mimeType: 'text/csv; charset=utf-8',
      base64: Buffer.from('﻿' + csv, 'utf-8').toString('base64'),
    };
  }

  private parseNumberish(value: string | undefined, fallback = 0): number {
    if (value === undefined || String(value).trim() === '') return fallback;
    const cleaned = String(value)
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[^\d.,\-]/g, '')
      .replace(/,/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }

  private parsePartyType(value: string | undefined): number | null {
    const raw = String(value ?? '').trim().toLowerCase();
    if (['1', 'عميل', 'عميل/مورد', 'customer', 'عملا'].includes(raw)) return 1;
    if (['2', 'مورد', 'supplier', 'موردين'].includes(raw)) return 2;
    if (['3', 'عميل ومورد', 'both', 'عميل/مورد مشترك'].includes(raw)) return 3;
    return null;
  }

  private async resolvePartiesRows(raw: Record<string, string>[], client: import('pg').PoolClient) {
    const [groups, classifications, reps] = await Promise.all([
      client.query<any>('SELECT customer_group_id AS id, name FROM customer_groups'),
      client.query<any>('SELECT classification_id AS id, name FROM customer_classifications'),
      client.query<any>('SELECT user_id AS id, user_name, full_name FROM users WHERE is_sales_rep = true'),
    ]);
    const byName = (rows: any[], getKey: (row: any) => string[]) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        for (const key of getKey(row)) {
          if (key) map.set(String(key).trim().toLowerCase(), Number(row.id));
        }
      }
      return map;
    };
    const groupByName = byName(groups.rows, (r) => [r.name]);
    const classByName = byName(classifications.rows, (r) => [r.name]);
    const repByName = byName(reps.rows, (r) => [r.user_name, r.full_name]);

    const rows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    raw.forEach((rawRow, index) => {
      const line = index + 2; // header is line 1
      const name = String(rawRow.name ?? '').trim();
      if (!name) { errors.push({ row: line, message: 'الاسم مطلوب' }); return; }
      const partyType = this.parsePartyType(rawRow.type);
      if (!partyType) { errors.push({ row: line, message: `النوع غير مفهوم: ${rawRow.type ?? ''} — اكتب «عميل» أو «مورد» أو «عميل ومورد»` }); return; }
      const creditLimit = this.parseNumberish(rawRow.credit_limit, 0);
      const discountPct = this.parseNumberish(rawRow.discount_pct, 0);
      const groupRef = String(rawRow.customer_group ?? '').trim();
      const classRef = String(rawRow.classification ?? '').trim();
      const repRef = String(rawRow.sales_rep ?? '').trim();
      const customerGroupId = groupRef ? groupByName.get(groupRef.toLowerCase()) ?? null : null;
      if (groupRef && customerGroupId === null) { errors.push({ row: line, message: `مجموعة العملاء غير موجودة: ${groupRef}` }); return; }
      const classificationId = classRef ? classByName.get(classRef.toLowerCase()) ?? null : null;
      if (classRef && classificationId === null) { errors.push({ row: line, message: `التصنيف غير موجود: ${classRef}` }); return; }
      const salesRepId = repRef ? repByName.get(repRef.toLowerCase()) ?? null : null;
      if (repRef && salesRepId === null) { errors.push({ row: line, message: `المندوب غير موجود: ${repRef}` }); return; }
      rows.push({
        line, code: String(rawRow.code ?? '').trim(), name, partyType,
        phone: String(rawRow.phone ?? '').trim() || null,
        mobile: String(rawRow.mobile ?? '').trim() || null,
        email: String(rawRow.email ?? '').trim() || null,
        address: String(rawRow.address ?? '').trim() || null,
        taxNumber: String(rawRow.tax_number ?? '').trim() || null,
        creditLimit, discountPct, customerGroupId, classificationId, salesRepId,
      });
    });
    return { rows, errors };
  }

  async importFile(dto: any, user: AuthUser, branchId: number) {
    const mode = dto?.mode === 'apply' ? 'apply' : 'preview';
    const parsed = parseImportFile({ csv: dto?.csv, xlsxBase64: dto?.xlsxBase64 });
    if (!parsed.raw.length) throw new BadRequestException('الملف لا يحتوي أي صفوف بيانات');
    const withAliases = applyHeaderAliases(parsed.raw, PARTY_IMPORT_ALIASES);

    return this.db.transaction(async (client) => {
      const { rows, errors } = await this.resolvePartiesRows(withAliases, client);
      if (mode === 'preview') {
        return { mode, total: parsed.raw.length, valid: rows.length, invalid: errors.length, errors, sample: rows.slice(0, 10) };
      }
      let created = 0;
      let updated = 0;
      const failed: { row: number; message: string }[] = [...errors];
      for (const row of rows) {
        try {
          const existing = row.code
            ? (await client.query<any>('SELECT party_id AS id FROM parties WHERE code = $1', [row.code])).rows[0]
            : null;
          if (existing) {
            await client.query(
              `UPDATE parties SET name=$2, party_type=$3, address=$4, phone=$5, mobile=$6, tax_number=$7,
                      credit_limit=$8, discount_pct=$9, customer_group_id=$10, classification_id=$11, sales_rep_id=$12,
                      version = version + 1
               WHERE party_id=$1`,
              [existing.id, row.name, row.partyType, row.address, row.phone, row.mobile, row.taxNumber,
                row.creditLimit, row.discountPct, row.customerGroupId, row.classificationId, row.salesRepId],
            );
            updated += 1;
          } else {
            await client.query(
              `INSERT INTO parties (code, name, party_type, branch_id, address, phone, mobile, tax_number,
                      credit_limit, discount_pct, is_active, customer_group_id, classification_id, sales_rep_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13)`,
              [row.code || null, row.name, row.partyType, user.defaultBranchId, row.address, row.phone, row.mobile,
                row.taxNumber, row.creditLimit, row.discountPct, row.customerGroupId, row.classificationId, row.salesRepId],
            );
            created += 1;
          }
        } catch (error: any) {
          failed.push({ row: row.line, message: error?.message ?? 'تعذر الحفظ' });
        }
      }
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, $2::int, 'party.import', 'party', NULL, $3::text)`,
        [user.userId, branchId, `استيراد عملاء/موردين: ${created} جديد، ${updated} محدّث، ${failed.length} فاشل`],
      );
      return { mode, total: parsed.raw.length, created, updated, failed };
    });
  }

  /** Lists every active party with its balance and whether opening entries were posted. */
  async openingBalancesList(params: { search?: string; type?: number }) {
    const search = (params.search ?? '').trim();
    const like = `%${search}%`;
    const type = params.type ?? 0;
    return this.db.query(
      `SELECT p.party_id AS "partyId", p.code, p.name, p.party_type AS "partyType",
              COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                          FROM ledger_entries l WHERE l.party_id = p.party_id), 0) AS balance,
              COALESCE((SELECT SUM(l.amount) FROM ledger_entries l WHERE l.party_id = p.party_id AND l.entry_type = 4), 0) AS "openingAmount",
              (SELECT count(*)::int FROM ledger_entries l WHERE l.party_id = p.party_id AND l.entry_type = 4) AS "openingRows"
         FROM parties p
        WHERE p.is_active = true
          AND ($1::text = '' OR p.name ILIKE $2 OR COALESCE(p.code,'') ILIKE $2 OR COALESCE(p.phone,'') ILIKE $2)
          AND ($3::int = 0 OR p.party_type = $3 OR p.party_type = 3)
        ORDER BY p.name LIMIT 500`,
      [search, like, type],
    );
  }

  /** Posts opening balances as ledger entries (entry_type=4) + one balanced journal. */
  async setOpeningBalances(dto: any, user: AuthUser, branchId: number) {
    const date = String(dto?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('صيغة التاريخ غير صحيحة (YYYY-MM-DD)');
    const entries = (Array.isArray(dto?.entries) ? dto.entries : [])
      .map((entry: any) => ({ partyId: Number(entry?.partyId), amount: Number(entry?.amount) }))
      .filter((entry: any) => Number.isFinite(entry.partyId) && entry.partyId > 0
        && Number.isFinite(entry.amount) && Math.abs(entry.amount) <= 999999999 && entry.amount !== 0);
    if (!entries.length) throw new BadRequestException('أدخل مبلغًا لا يساوي صفرًا لطرفٍ واحد على الأقل');

    return this.db.transaction(async (client) => {
      const ids = [...new Set(entries.map((entry: any) => entry.partyId))] as number[];
      const existing = await client.query<any>(
        `SELECT party_id FROM ledger_entries WHERE entry_type = 4 AND party_id = ANY($1::int[]) GROUP BY party_id`,
        [ids],
      );
      const alreadyOpen = new Set(existing.rows.map((row: any) => Number(row.party_id)));

      const [ar, ap, equity] = await Promise.all([
        requireMapping(client, 'AR', 'ذمم العملاء'),
        requireMapping(client, 'AP', 'ذمم الموردين'),
        requireMapping(client, 'RETAINED_EARNINGS', 'الأرباح المحتجزة'),
      ]);

      const journalLines: any[] = [];
      let arTotal = 0;
      let apTotal = 0;
      const saved: string[] = [];
      const skippedExisting: number[] = [];
      const partyNames = new Map<number, string>();

      for (const entry of entries) {
        if (alreadyOpen.has(entry.partyId)) { skippedExisting.push(entry.partyId); continue; }
        const party = (await client.query<any>(
          'SELECT name FROM parties WHERE party_id = $1::int AND is_active = true', [entry.partyId],
        )).rows[0];
        if (!party) { skippedExisting.push(entry.partyId); continue; }
        partyNames.set(entry.partyId, party.name);
        const signed = Math.round(entry.amount * 100) / 100;
        await client.query(
          `INSERT INTO ledger_entries (branch_id, party_id, entry_date, direction, entry_type, amount, reference_no, notes, created_by)
           VALUES ($1::int,$2::int,$3::date,$4::smallint,4,$5::numeric,'OPENING','أرصدة افتتاحية',$6::int)`,
          [branchId, entry.partyId, date, signed >= 0 ? 1 : 2, Math.abs(signed), user.userId],
        );
        await client.query('UPDATE parties SET opening_balance = 0 WHERE party_id = $1::int', [entry.partyId]);
        if (signed > 0) {
          arTotal = Math.round((arTotal + signed) * 100) / 100;
          journalLines.push({ accountId: ar.accountId, debit: signed, description: `رصيد افتتاحي — ${party.name}` });
        } else {
          apTotal = Math.round((apTotal + Math.abs(signed)) * 100) / 100;
          journalLines.push({ accountId: ap.accountId, credit: Math.abs(signed), description: `رصيد افتتاحي — ${party.name}` });
        }
        saved.push(party.name);
      }

      if (!journalLines.length) {
        return { saved: 0, skippedExisting, date, arTotal: 0, apTotal: 0, journalId: null };
      }
      // Balance the journal with the opening-equity plug (only if the two legs differ).
      const plug = Math.round((arTotal - apTotal) * 100) / 100;
      if (plug > 0) journalLines.push({ accountId: equity.accountId, credit: plug, description: 'أرصدة افتتاحية (فرق الأرصدة)' });
      else if (plug < 0) journalLines.push({ accountId: equity.accountId, debit: Math.abs(plug), description: 'أرصدة افتتاحية (فرق الأرصدة)' });

      const journalId = await postJournal(client, {
        branchId, journalDate: date, journalType: 2,
        description: `أرصدة افتتاحية — ${date}`,
        sourceType: 'opening_balance', userId: user.userId, autoBalance: false,
        lines: journalLines,
      });
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, $2::int, 'party.opening_balance', 'party', NULL, $3::text)`,
        [user.userId, branchId, `أرصدة افتتاحية: ${saved.length} طرف (${saved.join('، ')})`],
      );
      return { saved: saved.length, skippedExisting, date, arTotal, apTotal, journalId };
    });
  }

  /** Hard delete a party — refused while any FK anywhere points at it. */
  async deleteParty(id: number, user: AuthUser, branchId: number) {
    await assertDeletionAllowed(this.db, 'parties');
    const refs = await countReferencingRows(this.db, 'parties', 'party_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف هذا الطرف — عليه حركات: ${detail}. عطّله بدل الحذف`);
    }
    await this.db.query('DELETE FROM parties WHERE party_id = $1::int', [id]);
    await this.db.query(
      `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
       VALUES ($1::int, $2::int, 'party.delete', 'party', $3::int, $4::text)`,
      [user.userId, branchId, id, `حذف طرف #${id}`],
    );
    return { deleted: true };
  }
}

@Controller('parties')
export class PartiesController {
  constructor(private readonly service: PartiesService) {}

  // ---- Tools: import + opening balances (registered before @Get(':id')) ----
  @RequirePermissions('parties.manage')
  @Get('import/template')
  importTemplate(@Query('format') format: string) {
    return this.service.template(String(format ?? 'csv').toLowerCase() === 'xlsx' ? 'xlsx' : 'csv');
  }

  @RequirePermissions('parties.manage')
  @Post('import')
  importFile(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.importFile(dto, user, branchId);
  }

  @RequirePermissions('parties.view')
  @Get('opening-balances')
  openingBalancesList(@Query('search') search: string, @Query('type') type: string) {
    return this.service.openingBalancesList({ search, type: type ? Number(type) : 0 });
  }

  @RequirePermissions('parties.manage')
  @Post('opening-balances')
  setOpeningBalances(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.setOpeningBalances(dto, user, branchId);
  }

  @RequirePermissions('parties.view')
  @Get()
  list(@Query('search') search: string, @Query('type') type: string, @Query('page') page: string, @Query('pageSize') pageSize: string) {
    return this.service.list({
      search,
      type: type ? Number(type) : 0,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
    });
  }

  @RequirePermissions('parties.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @RequirePermissions('parties.ledger')
  @Get(':id/statement')
  statement(@Param('id', ParseIntPipe) id: number) {
    return this.service.statement(id);
  }

  @RequirePermissions('parties.manage')
  @Post()
  create(@Body() dto: PartyDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @RequirePermissions('parties.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PartyDto) {
    return this.service.update(id, dto);
  }

  @RequirePermissions('parties.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.deleteParty(id, user, branchId);
  }
}

@Module({
  controllers: [PartiesController],
  providers: [PartiesService],
  exports: [PartiesService],
})
export class PartiesModule {}
