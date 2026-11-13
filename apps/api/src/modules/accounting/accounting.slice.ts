import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { PoolClient } from 'pg';
import { postJournal, resolveMapping, voidJournal, JournalLineInput } from '../../common/posting';
import {
  AuthUser, CurrentBranch, CurrentUser, RequirePermissions,
} from '../../common/security';

/** Account classes used across the module. */
export const ACCOUNT_TYPE = {
  ASSET: 1, LIABILITY: 2, EQUITY: 3, REVENUE: 4, EXPENSE: 5,
} as const;

export interface JournalLineDto {
  accountId: number;
  debit?: number;
  credit?: number;
  description?: string;
  costCenterId?: number | null;
  partyId?: number | null;
}

@Injectable()
export class AccountingService {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------------ //
  //  Chart of accounts
  // ------------------------------------------------------------------ //
  async accounts(options: { includeInactive?: boolean } = {}) {
    const rows = await this.db.query<any>(
      `SELECT a.account_id AS "accountId", a.code, a.name, a.name_en AS "nameEn",
              a.account_type AS "accountType", a.parent_id AS "parentId",
              a.is_group AS "isGroup", a.is_active AS "isActive",
              a.normal_side AS "normalSide", a.currency_code AS "currencyCode",
              a.require_cost_center AS "requireCostCenter", a.notes,
              p.code AS "parentCode", p.name AS "parentName",
              (SELECT COUNT(*)::int FROM gl_accounts c WHERE c.parent_id = a.account_id) AS "childCount",
              (SELECT COUNT(*)::int FROM gl_entries e WHERE e.account_id = a.account_id) AS "entryCount"
         FROM gl_accounts a
         LEFT JOIN gl_accounts p ON p.account_id = a.parent_id
        WHERE ($1::boolean = true OR a.is_active = true)
        ORDER BY a.code`,
      [!!options.includeInactive],
    );
    return this.buildTree(rows);
  }

  /** Builds a nested tree from the flat account list. */
  private buildTree(rows: any[]): any[] {
    const byId = new Map<number, any>();
    for (const row of rows) byId.set(Number(row.accountId), { ...row, children: [] });
    const roots: any[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(Number(node.parentId)) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async account(id: number) {
    const row = await this.db.one<any>(
      `SELECT a.account_id AS "accountId", a.code, a.name, a.name_en AS "nameEn",
              a.account_type AS "accountType", a.parent_id AS "parentId",
              a.is_group AS "isGroup", a.is_active AS "isActive",
              a.normal_side AS "normalSide", a.currency_code AS "currencyCode",
              a.require_cost_center AS "requireCostCenter", a.notes
         FROM gl_accounts a WHERE a.account_id = $1::int`,
      [id],
    );
    if (!row) throw new BadRequestException('الحساب غير موجود');
    return row;
  }

  async createAccount(dto: any) {
    const code = String(dto.code ?? '').trim();
    const name = String(dto.name ?? '').trim();
    if (!code || !name) throw new BadRequestException('كود الحساب واسمه مطلوبان');
    const accountType = Number(dto.accountType);
    if (!Object.values(ACCOUNT_TYPE).includes(accountType as any)) {
      throw new BadRequestException('نوع الحساب غير صحيح');
    }
    const parentId = dto.parentId ? Number(dto.parentId) : null;
    if (parentId) {
      const parent = await this.db.one<any>(
        'SELECT account_id, account_type, is_group FROM gl_accounts WHERE account_id = $1::int',
        [parentId],
      );
      if (!parent) throw new BadRequestException('الحساب الأب غير موجود');
      if (!parent.is_group) throw new BadRequestException('الحساب الأب يجب أن يكون حسابًا تجميعيًا');
      if (Number(parent.account_type) !== accountType) {
        throw new BadRequestException('نوع الحساب يجب أن يطابق نوع الحساب الأب');
      }
    }
    const row = await this.db.one<{ account_id: number }>(
      `INSERT INTO gl_accounts
         (code, name, name_en, account_type, parent_id, is_group, is_active, normal_side,
          currency_code, require_cost_center, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING account_id`,
      [code, name, dto.nameEn ?? null, accountType, parentId, !!dto.isGroup,
        dto.isActive !== false, Number(dto.normalSide ?? (accountType === ACCOUNT_TYPE.ASSET || accountType === ACCOUNT_TYPE.EXPENSE ? 1 : 2)),
        dto.currencyCode ?? 'EGP', !!dto.requireCostCenter, dto.notes ?? null],
    );
    return { accountId: Number(row.account_id) };
  }

  async updateAccount(id: number, dto: any) {
    const existing = await this.db.one<any>('SELECT * FROM gl_accounts WHERE account_id = $1::int', [id]);
    if (!existing) throw new BadRequestException('الحساب غير موجود');
    await this.db.query(
      `UPDATE gl_accounts SET name = $2, name_en = $3, account_type = $4, parent_id = $5,
              is_group = $6, is_active = $7, normal_side = $8, currency_code = $9,
              require_cost_center = $10, notes = $11
        WHERE account_id = $1::int`,
      [id, dto.name ?? existing.name, dto.nameEn ?? existing.name_en,
        Number(dto.accountType ?? existing.account_type),
        dto.parentId === undefined ? existing.parent_id : (dto.parentId ? Number(dto.parentId) : null),
        dto.isGroup === undefined ? existing.is_group : !!dto.isGroup,
        dto.isActive === undefined ? existing.is_active : !!dto.isActive,
        Number(dto.normalSide ?? existing.normal_side),
        dto.currencyCode ?? existing.currency_code,
        dto.requireCostCenter === undefined ? existing.require_cost_center : !!dto.requireCostCenter,
        dto.notes ?? existing.notes],
    );
    return { accountId: id };
  }

  async deleteAccount(id: number) {
    const used = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM gl_entries WHERE account_id = $1::int',
      [id],
    );
    if (Number(used.c) > 0) {
      await this.db.query('UPDATE gl_accounts SET is_active = false WHERE account_id = $1::int', [id]);
      return { deactivated: true };
    }
    const children = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM gl_accounts WHERE parent_id = $1::int',
      [id],
    );
    if (Number(children.c) > 0) throw new BadRequestException('لا يمكن حذف حساب له حسابات فرعية');
    await this.db.query('DELETE FROM gl_mappings WHERE account_id = $1::int', [id]);
    await this.db.query('DELETE FROM gl_accounts WHERE account_id = $1::int', [id]);
    return { deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Mappings (business concept → account)
  // ------------------------------------------------------------------ //
  async mappings() {
    return this.db.query<any>(
      `SELECT m.mapping_key AS "mappingKey", m.description, m.account_id AS "accountId",
              a.code AS "accountCode", a.name AS "accountName", a.account_type AS "accountType"
         FROM gl_mappings m JOIN gl_accounts a ON a.account_id = m.account_id
        ORDER BY m.mapping_key`,
    );
  }

  async setMapping(key: string, dto: any) {
    const accountId = Number(dto.accountId);
    const account = await this.db.one<any>(
      'SELECT account_id, is_group FROM gl_accounts WHERE account_id = $1::int',
      [accountId],
    );
    if (!account) throw new BadRequestException('الحساب غير موجود');
    if (account.is_group) throw new BadRequestException('لا يمكن ربط حساب تجميعي');
    await this.db.query(
      `INSERT INTO gl_mappings (mapping_key, account_id, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (mapping_key) DO UPDATE SET account_id = EXCLUDED.account_id,
         description = EXCLUDED.description`,
      [key, accountId, dto.description ?? null],
    );
    return { mappingKey: key, accountId };
  }

  // ------------------------------------------------------------------ //
  //  Cost centres and currencies
  // ------------------------------------------------------------------ //
  async costCenters() {
    return this.db.query<any>(
      `SELECT c.cost_center_id AS "costCenterId", c.code, c.name, c.parent_id AS "parentId",
              c.is_active AS "isActive", c.notes,
              p.name AS "parentName",
              (SELECT COUNT(*)::int FROM gl_entries e WHERE e.cost_center_id = c.cost_center_id) AS "entryCount"
         FROM cost_centers c LEFT JOIN cost_centers p ON p.cost_center_id = c.parent_id
        ORDER BY c.code`,
    );
  }

  async createCostCenter(dto: any) {
    const code = String(dto.code ?? '').trim();
    const name = String(dto.name ?? '').trim();
    if (!code || !name) throw new BadRequestException('كود مركز التكلفة واسمه مطلوبان');
    const row = await this.db.one<{ cost_center_id: number }>(
      `INSERT INTO cost_centers (code, name, parent_id, is_active, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING cost_center_id`,
      [code, name, dto.parentId ? Number(dto.parentId) : null, dto.isActive !== false, dto.notes ?? null],
    );
    return { costCenterId: Number(row.cost_center_id) };
  }

  async updateCostCenter(id: number, dto: any) {
    await this.db.query(
      `UPDATE cost_centers SET name = $2, parent_id = $3, is_active = $4, notes = $5
        WHERE cost_center_id = $1::int`,
      [id, dto.name ?? undefined, dto.parentId === undefined ? undefined : (dto.parentId ? Number(dto.parentId) : null),
        dto.isActive === undefined ? undefined : !!dto.isActive, dto.notes ?? undefined],
    );
    return { costCenterId: id };
  }

  async currencies() {
    return this.db.query<any>(
      `SELECT currency_code AS "currencyCode", name, symbol, is_base AS "isBase", rate,
              updated_at AS "updatedAt"
         FROM currencies ORDER BY is_base DESC, currency_code`,
    );
  }

  async saveCurrency(dto: any) {
    const code = String(dto.currencyCode ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('كود العملة مطلوب');
    await this.db.query(
      `INSERT INTO currencies (currency_code, name, symbol, is_base, rate)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (currency_code) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol,
         is_base = EXCLUDED.is_base, rate = EXCLUDED.rate, updated_at = now()`,
      [code, dto.name ?? code, dto.symbol ?? null, !!dto.isBase, Number(dto.rate ?? 1)],
    );
    return { currencyCode: code };
  }

  // ------------------------------------------------------------------ //
  //  Journals
  // ------------------------------------------------------------------ //
  async listJournals(params: {
    branchId: number; from?: string; to?: string; type?: number; status?: number;
    search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT j.journal_id AS "journalId", j.journal_no AS "journalNo", j.journal_date AS "journalDate",
              j.journal_type AS "journalType", j.description, j.status,
              j.source_type AS "sourceType", j.source_id AS "sourceId",
              j.total_debit AS "totalDebit", j.total_credit AS "totalCredit",
              j.currency_code AS "currencyCode", j.exchange_rate AS "exchangeRate",
              b.name AS "branchName", u.full_name AS "createdBy", j.created_at AS "createdAt",
              p.name AS "periodName"
         FROM gl_journals j
         JOIN branches b ON b.branch_id = j.branch_id
         LEFT JOIN users u ON u.user_id = j.created_by
         LEFT JOIN periods p ON p.period_id = j.period_id
        WHERE ($1::int = 0 OR j.branch_id = $1::int)
          AND ($2::date IS NULL OR j.journal_date >= $2::date)
          AND ($3::date IS NULL OR j.journal_date <= $3::date)
          AND ($4::int = 0 OR j.journal_type = $4::int)
          AND ($5::int = 0 OR j.status = $5::int)
          AND ($6::text = '' OR j.journal_no ILIKE $6 OR COALESCE(j.description,'') ILIKE $6)
        ORDER BY j.journal_date DESC, j.journal_id DESC
        LIMIT $7::int`,
      [params.branchId, params.from ?? null, params.to ?? null, params.type ?? 0,
        params.status ?? 0, like, params.limit],
    );
  }

  async journal(id: number) {
    const header = await this.db.one<any>(
      `SELECT j.journal_id AS "journalId", j.journal_no AS "journalNo", j.journal_date AS "journalDate",
              j.journal_type AS "journalType", j.description, j.status,
              j.source_type AS "sourceType", j.source_id AS "sourceId",
              j.total_debit AS "totalDebit", j.total_credit AS "totalCredit",
              j.currency_code AS "currencyCode", j.exchange_rate AS "exchangeRate",
              j.branch_id AS "branchId", j.period_id AS "periodId",
              b.name AS "branchName", u.full_name AS "createdBy", j.created_at AS "createdAt"
         FROM gl_journals j
         JOIN branches b ON b.branch_id = j.branch_id
         LEFT JOIN users u ON u.user_id = j.created_by
        WHERE j.journal_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('القيد غير موجود');
    const lines = await this.db.query<any>(
      `SELECT e.entry_id AS "entryId", e.line_no AS "lineNo", e.account_id AS "accountId",
              a.code AS "accountCode", a.name AS "accountName", a.account_type AS "accountType",
              e.debit, e.credit, e.description, e.cost_center_id AS "costCenterId",
              cc.name AS "costCenterName", e.party_id AS "partyId", p.name AS "partyName"
         FROM gl_entries e
         JOIN gl_accounts a ON a.account_id = e.account_id
         LEFT JOIN cost_centers cc ON cc.cost_center_id = e.cost_center_id
         LEFT JOIN parties p ON p.party_id = e.party_id
        WHERE e.journal_id = $1::bigint
        ORDER BY e.line_no`,
      [id],
    );
    return { header, lines };
  }

  /** Creates a manual journal (draft or posted). */
  async createJournal(dto: any, user: AuthUser, branchId: number) {
    const lines: JournalLineDto[] = Array.isArray(dto.lines) ? dto.lines : [];
    if (lines.length < 2) throw new BadRequestException('أضف سطرين على الأقل للقيد');
    return this.db.transaction(async (client) => {
      const journalId = await postJournal(client, {
        branchId: dto.branchId ? Number(dto.branchId) : branchId,
        journalDate: dto.journalDate,
        journalType: 1,
        description: dto.description ?? 'قيد يدوي',
        sourceType: 'manual',
        lines: lines.map((line) => ({
          accountId: Number(line.accountId),
          debit: Number(line.debit ?? 0),
          credit: Number(line.credit ?? 0),
          description: line.description,
          costCenterId: line.costCenterId ? Number(line.costCenterId) : null,
          partyId: line.partyId ? Number(line.partyId) : null,
        })),
        userId: user.userId,
        post: dto.post !== false,
      });
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.journal.create','gl_journal',$3,$4)`,
        [user.userId, branchId, String(journalId), dto.description ?? 'قيد يدوي'],
      );
      return { journalId };
    });
  }

  async postJournalById(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM gl_journals WHERE journal_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('القيد غير موجود');
      if (Number(header.rows[0].status) !== 1) throw new BadRequestException('القيد مرحّل بالفعل');
      const sum = await client.query<any>(
        `SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c
           FROM gl_entries WHERE journal_id = $1::bigint`,
        [id],
      );
      const debit = Number(sum.rows[0].d);
      const credit = Number(sum.rows[0].c);
      if (debit <= 0 || Math.abs(debit - credit) > 0.005) {
        throw new BadRequestException('القيد غير متوازن ولا يمكن ترحيله');
      }
      await client.query(
        `UPDATE gl_journals SET status = 2, posted_at = now(),
                total_debit = $2::numeric, total_credit = $3::numeric
          WHERE journal_id = $1::bigint`,
        [id, debit, credit],
      );
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.journal.post','gl_journal',$3,$4)`,
        [user.userId, Number(header.rows[0].branch_id), String(id), 'ترحيل قيد'],
      );
      return { journalId: id, status: 2 };
    });
  }

  async voidJournalById(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM gl_journals WHERE journal_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('القيد غير موجود');
      if (Number(header.rows[0].status) === 3) throw new BadRequestException('القيد ملغى بالفعل');
      await voidJournal(client, id);
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.journal.void','gl_journal',$3,$4)`,
        [user.userId, Number(header.rows[0].branch_id), String(id), 'إلغاء قيد'],
      );
      return { journalId: id, status: 3 };
    });
  }

  // ------------------------------------------------------------------ //
  //  Vouchers (receipt / payment)
  // ------------------------------------------------------------------ //
  async listVouchers(params: { branchId: number; type?: number; partyId?: number; from?: string; to?: string; limit: number }) {
    return this.db.query<any>(
      `SELECT v.voucher_id AS "voucherId", v.voucher_no AS "voucherNo", v.voucher_type AS "voucherType",
              v.voucher_date AS "voucherDate", v.amount, v.description, v.status,
              v.payment_method AS "paymentMethod", p.name AS "partyName", p.party_id AS "partyId",
              c.name AS "cashAccountName", c.cash_account_id AS "cashAccountId",
              j.journal_no AS "journalNo", j.journal_id AS "journalId", u.full_name AS "createdBy",
              COALESCE((SELECT SUM(a.amount) FROM invoice_allocations a
                         WHERE a.voucher_id = v.voucher_id), 0) AS allocatedAmount
         FROM vouchers v
         LEFT JOIN parties p ON p.party_id = v.party_id
         LEFT JOIN cash_accounts c ON c.cash_account_id = v.cash_account_id
         LEFT JOIN gl_journals j ON j.journal_id = v.journal_id
         LEFT JOIN users u ON u.user_id = v.created_by
        WHERE ($1::int = 0 OR v.branch_id = $1::int)
          AND ($2::int = 0 OR v.voucher_type = $2::int)
          AND ($3::int = 0 OR v.party_id = $3::int)
          AND ($4::date IS NULL OR v.voucher_date >= $4::date)
          AND ($5::date IS NULL OR v.voucher_date <= $5::date)
        ORDER BY v.voucher_date DESC, v.voucher_id DESC
        LIMIT $6::int`,
      [params.branchId, params.type ?? 0, params.partyId ?? 0,
        params.from ?? null, params.to ?? null, params.limit],
    );
  }

  /**
   * Receipt / payment voucher.
   * Posts a cash journal and mirrors the movement into the cash drawer so
   * the treasury screen and the general ledger never disagree.
   *
   * `allocations` settles the voucher against specific open invoices
   * (the invoices keep their own remaining amount up to date).
   */
  async createVoucher(dto: any, user: AuthUser, branchId: number) {
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    const voucherType = Number(dto.voucherType ?? 1);
    if (![1, 2].includes(voucherType)) throw new BadRequestException('نوع السند غير صحيح');
    const cashAccountId = Number(dto.cashAccountId);
    if (!cashAccountId) throw new BadRequestException('حدد حساب الخزينة');

    const allocations: { invoiceId: number; amount: number }[] = [];
    for (const allocation of Array.isArray(dto.allocations) ? dto.allocations : []) {
      const value = Number(allocation.amount ?? 0);
      if (!(value > 0)) continue;
      allocations.push({ invoiceId: Number(allocation.invoiceId), amount: value });
    }
    const allocatedTotal = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (allocatedTotal > amount + 0.005) {
      throw new BadRequestException('مجموع التخصيصات أكبر من مبلغ السند');
    }

    return this.db.transaction(async (client) => {
      const account = await client.query<any>(
        'SELECT cash_account_id, branch_id, gl_account_id, name FROM cash_accounts WHERE cash_account_id = $1::int',
        [cashAccountId],
      );
      if (!account.rows.length) throw new BadRequestException('حساب الخزينة غير موجود');
      if (Number(account.rows[0].branch_id) !== Number(branchId)) {
        throw new BadRequestException('حساب الخزينة لا يتبع الفرع الحالي');
      }
      const glAccountId = account.rows[0].gl_account_id
        ?? (await resolveMapping(client, 'CASH'))?.accountId;
      if (!glAccountId) throw new BadRequestException('حساب الخزينة غير مرتبط بحساب محاسبي');

      const counterKey = await client.query<{ last_number: string }>(
        `INSERT INTO number_sequences (sequence_key, last_number) VALUES ($1, 1)
         ON CONFLICT (sequence_key) DO UPDATE SET last_number = number_sequences.last_number + 1
         RETURNING last_number`,
        [`voucher:${branchId}`],
      );
      const voucherNo = `VQ-${new Date().getFullYear()}-${String(counterKey.rows[0].last_number).padStart(6, '0')}`;

      const counterpartyKey = voucherType === 1 ? 'AR' : 'AP';
      const counterparty = await resolveMapping(client, counterpartyKey);
      if (!counterparty) {
        throw new BadRequestException(
          `لم يتم ربط حساب ${voucherType === 1 ? 'ذمم العملاء' : 'ذمم الموردين'} بعد`,
        );
      }
      const partyId = dto.partyId ? Number(dto.partyId) : null;
      if (!partyId) throw new BadRequestException('حدد الطرف المقابل للسند');

      const lines = voucherType === 1
        ? [
          { accountId: glAccountId, debit: amount, description: dto.description ?? 'سند قبض' },
          { accountId: counterparty.accountId, credit: amount, partyId, description: dto.description ?? 'سند قبض' },
        ]
        : [
          { accountId: counterparty.accountId, debit: amount, partyId, description: dto.description ?? 'سند صرف' },
          { accountId: glAccountId, credit: amount, description: dto.description ?? 'سند صرف' },
        ];

      const journalId = await postJournal(client, {
        branchId,
        journalDate: dto.voucherDate,
        journalType: 4,
        description: dto.description ?? (voucherType === 1 ? 'سند قبض' : 'سند صرف'),
        sourceType: 'voucher',
        lines,
        userId: user.userId,
      });

      const inserted = await client.query<{ voucher_id: number }>(
        `INSERT INTO vouchers
           (voucher_no, voucher_type, voucher_date, branch_id, party_id, cash_account_id,
            payment_method, amount, description, journal_id, status, created_by)
         VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4,$5,$6,$7,$8,$9,$10,1,$11)
         RETURNING voucher_id`,
        [voucherNo, voucherType, dto.voucherDate ?? null, branchId, partyId, cashAccountId,
          Number(dto.paymentMethod ?? 1), amount, dto.description ?? null, journalId, user.userId],
      );

      // Mirror into the treasury so the drawer balance stays correct.
      await client.query(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, amount, transaction_date, description,
            party_id, created_by)
         VALUES ($1,$2,$3,$4, COALESCE($5::date, CURRENT_DATE),$6,$7,$8)`,
        [branchId, cashAccountId, voucherType === 1 ? 1 : 2, amount, dto.voucherDate ?? null,
          `${voucherType === 1 ? 'سند قبض' : 'سند صرف'} ${voucherNo}`, partyId, user.userId],
      );

      const party = await client.query<any>(
        'SELECT party_type, name FROM parties WHERE party_id = $1::int',
        [partyId],
      );
      // Party ledger convention: direction 1 increases the balance (they owe
      // us / we owe them), direction 2 decreases it. Both a customer receipt
      // and a supplier payment settle the balance, so both are credits here.
      await client.query(
        `INSERT INTO ledger_entries
           (branch_id, party_id, entry_date, direction, entry_type, amount, cash_account_id,
            reference_no, notes, created_by)
         VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), 2, 2, $4, $5,$6,$7,$8)`,
        [branchId, partyId, dto.voucherDate ?? null, amount,
          cashAccountId, voucherNo, dto.description ?? null, user.userId],
      );

      // ---- settle the allocated invoices ----------------------------------
      const voucherId = Number(inserted.rows[0].voucher_id);
      const settled: any[] = [];
      for (const allocation of allocations) {
        const invoice = await client.query<any>(
          `SELECT invoice_id, invoice_no, invoice_type, party_id, total_amount, paid_amount, status
             FROM invoices WHERE invoice_id = $1::bigint FOR UPDATE`,
          [allocation.invoiceId],
        );
        if (!invoice.rows.length) throw new BadRequestException('الفاتورة غير موجودة');
        const target = invoice.rows[0];
        if (Number(target.status) === 3) throw new BadRequestException('الفاتورة ملغاة');
        const expectedType = voucherType === 1 ? 1 : 2;
        if (Number(target.invoice_type) !== expectedType) {
          throw new BadRequestException('نوع الفاتورة لا يطابق نوع السند');
        }
        if (Number(target.party_id ?? 0) !== Number(partyId)) {
          throw new BadRequestException('الفاتورة تخص طرفًا آخر');
        }
        const remaining = Number(target.total_amount) - Number(target.paid_amount);
        if (allocation.amount > remaining + 0.005) {
          throw new BadRequestException(
            `المبلغ المخصَّص أكبر من المتبقي على الفاتورة ${target.invoice_no}`,
          );
        }

        await client.query(
          `INSERT INTO invoice_allocations (voucher_id, invoice_id, amount)
           VALUES ($1::bigint, $2::bigint, $3::numeric)`,
          [voucherId, allocation.invoiceId, allocation.amount],
        );
        await client.query(
          `INSERT INTO invoice_payments
             (invoice_id, payment_method, amount, cash_account_id, reference_no, notes, created_by)
           VALUES ($1::bigint,$2::int,$3::numeric,$4::int,$5::text,$6::text,$7::int)`,
          [allocation.invoiceId, Number(dto.paymentMethod ?? 1), allocation.amount,
            cashAccountId, voucherNo, dto.description ?? null, user.userId],
        );
        const newPaid = Number(target.paid_amount) + allocation.amount;
        const newRemaining = Number(target.total_amount) - newPaid;
        await client.query(
          `UPDATE invoices
              SET paid_amount = $2::numeric,
                  payment_type = CASE WHEN $3::numeric <= 0 THEN 1 ELSE 3 END
            WHERE invoice_id = $1::bigint`,
          [allocation.invoiceId, newPaid, newRemaining],
        );
        settled.push({
          invoiceId: Number(target.invoice_id),
          invoiceNo: target.invoice_no,
          amount: allocation.amount,
          remaining: Math.round(newRemaining * 100) / 100,
        });
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.voucher.create','voucher',$3,$4)`,
        [user.userId, branchId, String(voucherId),
          `${voucherType === 1 ? 'قبض' : 'صرف'} ${amount} - ${party.rows[0]?.name ?? ''}`],
      );

      return { voucherId, voucherNo, journalId, allocated: settled };
    });
  }

  /** Cancels a voucher: voids the journal and reverses the treasury movement. */
  async cancelVoucher(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        'SELECT * FROM vouchers WHERE voucher_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!row.rows.length) throw new BadRequestException('السند غير موجود');
      const voucher = row.rows[0];
      if (Number(voucher.status) === 2) throw new BadRequestException('السند ملغى بالفعل');

      if (voucher.journal_id) {
        await client.query(
          'UPDATE gl_journals SET status = 3, posted_at = NULL WHERE journal_id = $1::bigint',
          [voucher.journal_id],
        );
      }
      await client.query(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, amount, transaction_date, description,
            party_id, created_by)
         VALUES ($1,$2,$3,$4, CURRENT_DATE, $5,$6,$7)`,
        [Number(voucher.branch_id), Number(voucher.cash_account_id),
          Number(voucher.voucher_type) === 1 ? 2 : 1, Number(voucher.amount),
          `عكس سند ${voucher.voucher_no}`, voucher.party_id, user.userId],
      );
      await client.query(
        `INSERT INTO ledger_entries
           (branch_id, party_id, entry_date, direction, entry_type, amount, cash_account_id,
            reference_no, notes, created_by)
         VALUES ($1,$2, now(), 1, 5, $3, $4,$5,$6,$7)`,
        [Number(voucher.branch_id), voucher.party_id, Number(voucher.amount),
          voucher.cash_account_id, voucher.voucher_no, `عكس ${voucher.voucher_no}`, user.userId],
      );
      await client.query('UPDATE vouchers SET status = 2 WHERE voucher_id = $1::bigint', [id]);

      // Release the invoices that were settled by this voucher.
      const allocations = await client.query<any>(
        `SELECT allocation_id, invoice_id, amount FROM invoice_allocations WHERE voucher_id = $1::bigint`,
        [id],
      );
      for (const allocation of allocations.rows) {
        const invoice = await client.query<any>(
          'SELECT total_amount, paid_amount FROM invoices WHERE invoice_id = $1::bigint FOR UPDATE',
          [allocation.invoice_id],
        );
        if (invoice.rows.length) {
          const newPaid = Math.max(0, Number(invoice.rows[0].paid_amount) - Number(allocation.amount));
          const newRemaining = Number(invoice.rows[0].total_amount) - newPaid;
          await client.query(
            `UPDATE invoices SET paid_amount = $2::numeric,
                    payment_type = CASE WHEN $2::numeric <= 0 THEN 2 WHEN $3::numeric <= 0 THEN 1 ELSE 3 END
              WHERE invoice_id = $1::bigint`,
            [allocation.invoice_id, newPaid, newRemaining],
          );
        }
        await client.query(
          `DELETE FROM invoice_payments WHERE invoice_id = $1::bigint AND reference_no = $2::text`,
          [allocation.invoice_id, voucher.voucher_no],
        );
      }
      await client.query('DELETE FROM invoice_allocations WHERE voucher_id = $1::bigint', [id]);

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.voucher.cancel','voucher',$3,$4)`,
        [user.userId, Number(voucher.branch_id), String(id), `إلغاء ${voucher.voucher_no}`],
      );
      return { voucherId: id, status: 2 };
    });
  }

  // ------------------------------------------------------------------ //
  //  Checks
  // ------------------------------------------------------------------ //
  async listChecks(params: { branchId: number; status?: number; direction?: number; limit: number }) {
    return this.db.query<any>(
      `SELECT k.check_id AS "checkId", k.direction, k.check_no AS "checkNo", k.bank_name AS "bankName",
              k.amount, k.due_date AS "dueDate", k.status, k.notes,
              k.party_id AS "partyId", p.name AS "partyName",
              k.cash_account_id AS "cashAccountId", c.name AS "cashAccountName",
              k.created_at AS "createdAt"
         FROM checks k
         LEFT JOIN parties p ON p.party_id = k.party_id
         LEFT JOIN cash_accounts c ON c.cash_account_id = k.cash_account_id
        WHERE ($1::int = 0 OR k.branch_id = $1::int)
          AND ($2::int = 0 OR k.status = $2::int)
          AND ($3::int = 0 OR k.direction = $3::int)
        ORDER BY k.created_at DESC
        LIMIT $4::int`,
      [params.branchId, params.status ?? 0, params.direction ?? 0, params.limit],
    );
  }

  async createCheck(dto: any, user: AuthUser, branchId: number) {
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    if (!dto.checkNo) throw new BadRequestException('رقم الشيك مطلوب');
    const direction = Number(dto.direction ?? 1);
    if (![1, 2].includes(direction)) throw new BadRequestException('اتجاه الشيك غير صحيح');
    const row = await this.db.one<{ check_id: number }>(
      `INSERT INTO checks
         (branch_id, direction, check_no, bank_name, amount, due_date, party_id,
          cash_account_id, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10) RETURNING check_id`,
      [branchId, direction, String(dto.checkNo).trim(), dto.bankName ?? null, amount,
        dto.dueDate ?? null, dto.partyId ? Number(dto.partyId) : null,
        dto.cashAccountId ? Number(dto.cashAccountId) : null, dto.notes ?? null, user.userId],
    );
    return { checkId: Number(row.check_id) };
  }

  async updateCheckStatus(id: number, dto: any, user: AuthUser) {
    const status = Number(dto.status);
    if (![1, 2, 3, 4].includes(status)) throw new BadRequestException('حالة الشيك غير صحيحة');
    await this.db.query(
      `UPDATE checks SET status = $2, notes = COALESCE($3, notes) WHERE check_id = $1::bigint`,
      [id, status, dto.notes ?? null],
    );
    return { checkId: id, status };
  }

  /** Marks a received check as collected: moves the money into the drawer. */
  async collectCheck(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        'SELECT * FROM checks WHERE check_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!row.rows.length) throw new BadRequestException('الشيك غير موجود');
      const check = row.rows[0];
      if (Number(check.status) !== 1) throw new BadRequestException('الشيك ليس تحت التحصيل');
      const cashAccountId = Number(check.cash_account_id);
      if (!cashAccountId) throw new BadRequestException('حدد حساب الخزينة للتحصيل');

      const account = await client.query<any>(
        'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
        [cashAccountId],
      );
      const glAccountId = account.rows[0]?.gl_account_id ?? (await resolveMapping(client, 'CASH'))?.accountId;
      if (!glAccountId) throw new BadRequestException('حساب الخزينة غير مرتبط بحساب محاسبي');

      const ar = await resolveMapping(client, 'AR');
      const amount = Number(check.amount);
      if (ar) {
        await postJournal(client, {
          branchId,
          journalType: 5,
          description: `تحصيل شيك ${check.check_no}`,
          sourceType: 'check',
          sourceId: id,
          lines: [
            { accountId: glAccountId, debit: amount, description: 'تحصيل شيك' },
            { accountId: ar.accountId, credit: amount, partyId: check.party_id, description: 'تحصيل شيك' },
          ],
          userId: user.userId,
        });
      }
      await client.query(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, amount, transaction_date, description, party_id, created_by)
         VALUES ($1,$2,1,$3, CURRENT_DATE, $4,$5,$6)`,
        [branchId, cashAccountId, amount, `تحصيل شيك ${check.check_no}`, check.party_id, user.userId],
      );
      await client.query('UPDATE checks SET status = 2 WHERE check_id = $1::bigint', [id]);
      return { checkId: id, status: 2 };
    });
  }

  // ------------------------------------------------------------------ //
  //  Periods
  // ------------------------------------------------------------------ //
  async listPeriods(branchId: number) {
    return this.db.query<any>(
      `SELECT p.period_id AS "periodId", p.name, p.start_date AS "startDate", p.end_date AS "endDate",
              p.is_closed AS "isClosed", p.closed_at AS "closedAt", p.notes,
              u.full_name AS "closedBy",
              (SELECT COUNT(*)::int FROM gl_journals j WHERE j.period_id = p.period_id) AS "journalCount"
         FROM periods p LEFT JOIN users u ON u.user_id = p.closed_by
        WHERE ($1::int = 0 OR p.branch_id = $1::int)
        ORDER BY p.start_date DESC`,
      [branchId],
    );
  }

  async createPeriod(dto: any, branchId: number) {
    if (!dto.startDate) throw new BadRequestException('تاريخ بداية الفترة مطلوب');
    const name = dto.name ?? `${dto.startDate}`;

    // Two bounded periods may not cover the same days: the period lookup
    // would otherwise pick an arbitrary one and the lock would be unreliable.
    const overlap = await this.db.one<any>(
      `SELECT period_id, name FROM periods
        WHERE branch_id = $1::int
          AND end_date IS NOT NULL
          AND ($2::date IS NULL OR end_date >= $2::date)
          AND ($3::date IS NULL OR start_date <= $3::date)
          AND ($4::text IS NULL OR name <> $4)
        LIMIT 1`,
      [branchId, dto.endDate ?? null, dto.startDate, name],
    );
    if (overlap) {
      throw new BadRequestException(
        `الفترة «${overlap.name}» تغطي نفس التاريخ — لا يمكن فتح فترة متداخلة`,
      );
    }

    const row = await this.db.one<{ period_id: number }>(
      `INSERT INTO periods (branch_id, name, start_date, end_date, is_closed, notes)
       VALUES ($1,$2,$3,$4,false,$5)
       ON CONFLICT (branch_id, name) DO UPDATE SET start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, notes = EXCLUDED.notes
       RETURNING period_id`,
      [branchId, name, dto.startDate, dto.endDate ?? null, dto.notes ?? null],
    );
    return { periodId: Number(row.period_id), name };
  }

  /** Closes a period: blocks any later posting dated inside it. */
  async closePeriod(id: number, user: AuthUser) {
    const row = await this.db.one<any>(
      'SELECT period_id, name, is_closed FROM periods WHERE period_id = $1::int',
      [id],
    );
    if (!row) throw new BadRequestException('الفترة غير موجودة');
    if (row.is_closed) throw new BadRequestException('الفترة مقفلة بالفعل');
    await this.db.query(
      `UPDATE periods SET is_closed = true, closed_at = now(), closed_by = $2 WHERE period_id = $1::int`,
      [id, user.userId],
    );
    return { periodId: id, isClosed: true };
  }

  async reopenPeriod(id: number, user: AuthUser) {
    const row = await this.db.one<any>('SELECT period_id, is_closed FROM periods WHERE period_id = $1::int', [id]);
    if (!row) throw new BadRequestException('الفترة غير موجودة');
    await this.db.query(
      'UPDATE periods SET is_closed = false, closed_at = NULL, closed_by = NULL WHERE period_id = $1::int',
      [id],
    );
    return { periodId: id, isClosed: false };
  }

  // ------------------------------------------------------------------ //
  //  Year-end closing
  // ------------------------------------------------------------------ //
  /**
   * Closes the books for a year: revenue and expense accounts are zeroed
   * and the result is transferred to retained earnings.
   */
  async closeYear(body: { year?: number; asOf?: string }, user: AuthUser, branchId: number) {
    const year = Number(body.year ?? new Date().getFullYear());
    const from = `${year}-01-01`;
    const to = body.asOf ?? `${year}-12-31`;

    return this.db.transaction(async (client) => {
      const balances = await client.query<any>(
        `SELECT a.account_id, a.code, a.name, a.account_type,
                COALESCE(SUM(e.debit),0) AS debit, COALESCE(SUM(e.credit),0) AS credit
           FROM gl_accounts a
           JOIN gl_entries e ON e.account_id = a.account_id
           JOIN gl_journals j ON j.journal_id = e.journal_id
          WHERE j.status = 2
            AND a.account_type IN (4, 5)
            AND j.journal_date >= $1::date AND j.journal_date <= $2::date
            AND ($3::int = 0 OR j.branch_id = $3::int)
          GROUP BY a.account_id, a.code, a.name, a.account_type`,
        [from, to, branchId],
      );
      if (!balances.rows.length) {
        throw new BadRequestException(`لا توجد حركات في السنة ${year} لإقفالها`);
      }

      const revenue = balances.rows
        .filter((row: any) => Number(row.account_type) === ACCOUNT_TYPE.REVENUE)
        .map((row: any) => ({ ...row, amount: Number(row.credit) - Number(row.debit) }))
        .filter((row: any) => Math.abs(row.amount) > 0.005);
      const expense = balances.rows
        .filter((row: any) => Number(row.account_type) === ACCOUNT_TYPE.EXPENSE)
        .map((row: any) => ({ ...row, amount: Number(row.debit) - Number(row.credit) }))
        .filter((row: any) => Math.abs(row.amount) > 0.005);

      const totalRevenue = revenue.reduce((sum: number, row: any) => sum + row.amount, 0);
      const totalExpense = expense.reduce((sum: number, row: any) => sum + row.amount, 0);
      const netProfit = Math.round((totalRevenue - totalExpense) * 100) / 100;

      const retained = await resolveMapping(client, 'RETAINED_EARNINGS');
      if (!retained) {
        throw new BadRequestException(
          'اربط حساب «الأرباح المحتجزة» (3103) من شاشة الربط المحاسبي قبل إقفال السنة',
        );
      }

      const lines: JournalLineInput[] = [];
      // Revenue is closed with a debit, expense with a credit. Accounts that
      // carry a balance on the opposite side (sales returns, purchase
      // refunds…) are closed in the direction of their own balance.
      for (const row of revenue) {
        if (row.amount > 0) {
          lines.push({ accountId: Number(row.account_id), debit: row.amount, description: `إقفال ${row.name}` });
        } else if (row.amount < 0) {
          lines.push({ accountId: Number(row.account_id), credit: -row.amount, description: `إقفال ${row.name}` });
        }
      }
      for (const row of expense) {
        if (row.amount > 0) {
          lines.push({ accountId: Number(row.account_id), credit: row.amount, description: `إقفال ${row.name}` });
        } else if (row.amount < 0) {
          lines.push({ accountId: Number(row.account_id), debit: -row.amount, description: `إقفال ${row.name}` });
        }
      }
      if (netProfit >= 0) {
        lines.push({
          accountId: retained.accountId,
          credit: netProfit,
          description: 'أرباح السنة',
        });
      } else {
        lines.push({
          accountId: retained.accountId,
          debit: -netProfit,
          description: 'خسائر السنة',
        });
      }

      const journalId = await postJournal(client, {
        branchId,
        journalDate: body.asOf ?? `${year}-12-31`,
        journalType: 8,
        description: `قيد إقفال السنة ${year}`,
        sourceType: 'year_closing',
        sourceId: year,
        lines,
        userId: user.userId,
      });

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'gl.year.close','gl_journal',$3,$4)`,
        [user.userId, branchId, String(journalId), `إقفال السنة ${year} — ربح ${netProfit}`],
      );

      return {
        journalId,
        year,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpense: Math.round(totalExpense * 100) / 100,
        netProfit,
      };
    });
  }

  // ------------------------------------------------------------------ //
  //  Recurring journals
  // ------------------------------------------------------------------ //
  async listRecurring(branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT r.recurring_id AS "recurringId", r.name, r.description, r.frequency,
              r.day_of_month AS "dayOfMonth", r.next_date AS "nextDate",
              r.branch_id AS "branchId", r.is_active AS "isActive",
              u.full_name AS "createdBy"
         FROM recurring_journals r LEFT JOIN users u ON u.user_id = r.created_by
        WHERE ($1::int = 0 OR r.branch_id = $1::int)
        ORDER BY r.is_active DESC, r.name`,
      [branchId],
    );
    for (const row of rows) {
      const lines = await this.db.query<any>(
        `SELECT l.line_no AS "lineNo", l.account_id AS "accountId", a.code AS "accountCode",
                a.name AS "accountName", l.debit, l.credit, l.description,
                l.cost_center_id AS "costCenterId"
           FROM recurring_journal_lines l JOIN gl_accounts a ON a.account_id = l.account_id
          WHERE l.recurring_id = $1::int ORDER BY l.line_no`,
        [row.recurringId],
      );
      row.lines = lines;
    }
    return rows;
  }

  async saveRecurring(dto: any, user: AuthUser, branchId: number) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (lines.length < 2) throw new BadRequestException('أضف سطرين على الأقل للقيد المتكرر');
    const debit = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
    const credit = lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0);
    if (Math.abs(debit - credit) > 0.005) {
      throw new BadRequestException('القيد المتكرر غير متوازن');
    }

    return this.db.transaction(async (client) => {
      const recurringId = dto.recurringId ? Number(dto.recurringId) : null;
      let id = recurringId;
      if (id) {
        await client.query(
          `UPDATE recurring_journals SET name = $2, description = $3, frequency = $4,
                  day_of_month = $5, next_date = $6, is_active = $7, branch_id = $8
            WHERE recurring_id = $1::int`,
          [id, dto.name, dto.description ?? null, Number(dto.frequency ?? 1),
            Number(dto.dayOfMonth ?? 1), dto.nextDate ?? null,
            dto.isActive !== false, branchId],
        );
        await client.query('DELETE FROM recurring_journal_lines WHERE recurring_id = $1::int', [id]);
      } else {
        const inserted = await client.query<{ recurring_id: number }>(
          `INSERT INTO recurring_journals
             (name, description, frequency, day_of_month, next_date, branch_id, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING recurring_id`,
          [dto.name, dto.description ?? null, Number(dto.frequency ?? 1),
            Number(dto.dayOfMonth ?? 1), dto.nextDate ?? null, branchId,
            dto.isActive !== false, user.userId],
        );
        id = Number(inserted.rows[0].recurring_id);
      }

      let lineNo = 1;
      for (const line of lines) {
        await client.query(
          `INSERT INTO recurring_journal_lines
             (recurring_id, line_no, account_id, debit, credit, description, cost_center_id)
           VALUES ($1::int,$2::int,$3::int,$4::numeric,$5::numeric,$6::text,$7::int)`,
          [id, lineNo++, Number(line.accountId), Number(line.debit ?? 0), Number(line.credit ?? 0),
            line.description ?? null, line.costCenterId ? Number(line.costCenterId) : null],
        );
      }

      return { recurringId: id };
    });
  }

  async deleteRecurring(id: number) {
    await this.db.query('DELETE FROM recurring_journals WHERE recurring_id = $1::int', [id]);
    return { recurringId: id, deleted: true };
  }

  /** Posts every recurring template that is due on or before today. */
  async runRecurring(user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const due = await client.query<any>(
        `SELECT recurring_id, name, description, frequency, next_date
           FROM recurring_journals
          WHERE is_active = true
            AND ($1::int = 0 OR branch_id = $1::int)
            AND next_date IS NOT NULL AND next_date <= CURRENT_DATE
          ORDER BY next_date`,
        [branchId],
      );

      const posted: any[] = [];
      for (const template of due.rows) {
        const lines = await client.query<any>(
          `SELECT account_id, debit, credit, description, cost_center_id
             FROM recurring_journal_lines WHERE recurring_id = $1::int ORDER BY line_no`,
          [template.recurring_id],
        );
        if (lines.rows.length < 2) continue;

        const journalId = await postJournal(client, {
          branchId,
          journalDate: template.next_date,
          journalType: 1,
          description: template.description ?? template.name,
          sourceType: 'recurring',
          sourceId: Number(template.recurring_id),
          lines: lines.rows.map((line: any) => ({
            accountId: Number(line.account_id),
            debit: Number(line.debit),
            credit: Number(line.credit),
            description: line.description,
            costCenterId: line.cost_center_id,
          })),
          userId: user.userId,
        });

        // Roll the template forward to its next due date.
        const next = await this.nextRecurringDate(client, template.frequency, Number(template.day_of_month ?? 1), template.next_date);
        await client.query(
          'UPDATE recurring_journals SET next_date = $2::date WHERE recurring_id = $1::int',
          [template.recurring_id, next],
        );

        posted.push({ recurringId: Number(template.recurring_id), name: template.name, journalId, nextDate: next });
      }

      return { posted: posted.length, journals: posted };
    });
  }

  /** Computes the next due date of a recurring template. */
  private async nextRecurringDate(client: PoolClient, frequency: number, dayOfMonth: number, current: string): Promise<string> {
    const { rows } = await client.query<{ next: string }>(
      `SELECT CASE
                WHEN $1::int = 3 THEN (CURRENT_DATE + INTERVAL '1 day')::date
                WHEN $1::int = 2 THEN (CURRENT_DATE + INTERVAL '7 days')::date
                WHEN $1::int = 4 THEN (date_trunc('quarter', CURRENT_DATE) + INTERVAL '3 months')::date
                WHEN $1::int = 5 THEN (date_trunc('year', CURRENT_DATE) + INTERVAL '1 year')::date
                ELSE (date_trunc('month', $2::date) + INTERVAL '1 month')::date
              END AS next`,
      [frequency, current],
    );
    return rows[0].next;
  }

  /** Open invoices of a party — used to settle a receipt against them. */
  async openInvoices(params: { partyId: number; type?: number; branchId: number }) {
    const type = params.type ?? 1;
    return this.db.query<any>(
      `SELECT i.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo", i.invoice_date AS "invoiceDate",
              i.invoice_type AS "invoiceType", i.total_amount AS "totalAmount",
              i.paid_amount AS "paidAmount",
              (i.total_amount - i.paid_amount) AS remaining,
              i.due_date AS "dueDate"
         FROM invoices i
        WHERE i.party_id = $1::int
          AND i.invoice_type = $2::int
          AND i.status <> 3
          AND ($3::int = 0 OR i.branch_id = $3::int)
          AND (i.total_amount - i.paid_amount) > 0.005
        ORDER BY i.invoice_date, i.invoice_id`,
      [params.partyId, type, params.branchId],
    );
  }

  /** Allocations of a voucher. */
  async voucherAllocations(id: number) {
    return this.db.query<any>(
      `SELECT a.allocation_id AS "allocationId", a.invoice_id AS "invoiceId",
              i.invoice_no AS "invoiceNo", a.amount, a.created_at AS "createdAt"
         FROM invoice_allocations a
         LEFT JOIN invoices i ON i.invoice_id = a.invoice_id
        WHERE a.voucher_id = $1::bigint ORDER BY a.allocation_id`,
      [id],
    );
  }

  // ------------------------------------------------------------------ //
  //  Financial reports
  // ------------------------------------------------------------------ //
  /** Signed balance per account for a date range (positive = normal side). */
  private async accountBalances(params: { branchId: number; from?: string; to?: string }) {
    return this.db.query<any>(
      `SELECT a.account_id AS "accountId", a.code, a.name, a.account_type AS "accountType",
              a.parent_id AS "parentId", a.is_group AS "isGroup", a.normal_side AS "normalSide",
              COALESCE(SUM(e.debit),0) AS debit, COALESCE(SUM(e.credit),0) AS credit
         FROM gl_accounts a
         LEFT JOIN gl_entries e ON e.account_id = a.account_id
              AND e.journal_id IN (SELECT journal_id FROM gl_journals
                                    WHERE status = 2
                                      AND ($1::int = 0 OR branch_id = $1::int)
                                      AND ($2::date IS NULL OR journal_date >= $2::date)
                                      AND ($3::date IS NULL OR journal_date <= $3::date))
        WHERE a.is_group = false
        GROUP BY a.account_id, a.code, a.name, a.account_type, a.parent_id, a.is_group, a.normal_side
        ORDER BY a.code`,
      [params.branchId, params.from ?? null, params.to ?? null],
    );
  }

  async trialBalance(params: { branchId: number; from?: string; to?: string }) {
    const rows = await this.accountBalances(params);
    const lines = rows
      .map((row: any) => {
        const debit = Number(row.debit);
        const credit = Number(row.credit);
        const net = debit - credit;
        const isDebitNormal = Number(row.normalSide) === 1;
        return {
          accountId: Number(row.accountId),
          code: row.code,
          name: row.name,
          accountType: Number(row.accountType),
          // The net balance always sits on its own side: a debit balance in the
          // debit column, a credit balance in the credit column.
          debit: Math.max(net, 0),
          credit: Math.max(-net, 0),
          rawDebit: debit,
          rawCredit: credit,
          balance: isDebitNormal ? net : -net,
        };
      })
      .filter((row: any) => row.rawDebit !== 0 || row.rawCredit !== 0);

    const totalDebit = lines.reduce((sum: number, row: any) => sum + row.debit, 0);
    const totalCredit = lines.reduce((sum: number, row: any) => sum + row.credit, 0);
    return {
      lines,
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }

  async profitAndLoss(params: { branchId: number; from?: string; to?: string }) {
    const rows = await this.accountBalances(params);
    const revenue = rows
      .filter((row: any) => Number(row.accountType) === ACCOUNT_TYPE.REVENUE)
      .map((row: any) => ({
        accountId: Number(row.accountId), code: row.code, name: row.name,
        amount: Math.round((Number(row.credit) - Number(row.debit)) * 100) / 100,
      }))
      .filter((row: any) => row.amount !== 0);
    const expense = rows
      .filter((row: any) => Number(row.accountType) === ACCOUNT_TYPE.EXPENSE)
      .map((row: any) => ({
        accountId: Number(row.accountId), code: row.code, name: row.name,
        amount: Math.round((Number(row.debit) - Number(row.credit)) * 100) / 100,
      }))
      .filter((row: any) => row.amount !== 0);

    const totalRevenue = revenue.reduce((sum: number, row: any) => sum + row.amount, 0);
    const totalExpense = expense.reduce((sum: number, row: any) => sum + row.amount, 0);
    const netProfit = Math.round((totalRevenue - totalExpense) * 100) / 100;
    return {
      revenue, expense, totalRevenue, totalExpense, netProfit,
      netLoss: netProfit < 0,
      from: params.from ?? null,
      to: params.to ?? null,
    };
  }

  async balanceSheet(params: { branchId: number; asOf?: string }) {
    const rows = await this.accountBalances({ ...params, from: undefined, to: params.asOf });
    // Balances are shown on their normal side: assets and expenses on the debit
    // side, liabilities, equity and revenue on the credit side.
    const pick = (type: number) => rows
      .filter((row: any) => Number(row.accountType) === type)
      .map((row: any) => {
        const net = Number(row.debit) - Number(row.credit);
        const isDebitNormal = Number(row.normalSide) === 1;
        return {
          accountId: Number(row.accountId), code: row.code, name: row.name,
          amount: Math.round((isDebitNormal ? net : -net) * 100) / 100,
        };
      })
      .filter((row: any) => row.amount !== 0);

    // Revenue carries a credit balance and expense a debit balance, so the
    // profit is the opposite of their net balance: Σ(-net).
    const netProfit = rows
      .filter((row: any) => [ACCOUNT_TYPE.REVENUE as number, ACCOUNT_TYPE.EXPENSE as number].includes(Number(row.accountType)))
      .reduce((sum: number, row: any) => {
        const net = Number(row.debit) - Number(row.credit);
        return sum - net;
      }, 0);

    const assets = pick(ACCOUNT_TYPE.ASSET);
    const liabilities = pick(ACCOUNT_TYPE.LIABILITY);
    const equity = pick(ACCOUNT_TYPE.EQUITY);

    const totalAssets = assets.reduce((sum: number, row: any) => sum + row.amount, 0);
    const totalLiabilities = liabilities.reduce((sum: number, row: any) => sum + row.amount, 0);
    const totalEquity = equity.reduce((sum: number, row: any) => sum + row.amount, 0);
    const profit = Math.round(netProfit * 100) / 100;

    return {
      assets, liabilities, equity,
      profit,
      totalAssets: Math.round(totalAssets * 100) / 100,
      totalLiabilities: Math.round(totalLiabilities * 100) / 100,
      totalEquity: Math.round(totalEquity * 100) / 100,
      totalLiabilitiesAndEquity: Math.round((totalLiabilities + totalEquity + profit) * 100) / 100,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity + profit)) < 0.01,
      asOf: params.asOf ?? null,
    };
  }

  async generalLedger(params: { branchId: number; accountId: number; from?: string; to?: string }) {
    const account = await this.db.one<any>(
      'SELECT account_id, code, name, account_type, normal_side FROM gl_accounts WHERE account_id = $1::int',
      [params.accountId],
    );
    if (!account) throw new BadRequestException('الحساب غير موجود');

    const rows = await this.db.query<any>(
      `SELECT e.entry_id AS "entryId", e.journal_id AS "journalId", e.line_no AS "lineNo",
              j.journal_no AS "journalNo", j.journal_date AS "journalDate", j.description AS "journalDescription",
              e.description, e.debit, e.credit,
              p.name AS "partyName", cc.name AS "costCenterName"
         FROM gl_entries e
         JOIN gl_journals j ON j.journal_id = e.journal_id
         LEFT JOIN parties p ON p.party_id = e.party_id
         LEFT JOIN cost_centers cc ON cc.cost_center_id = e.cost_center_id
        WHERE e.account_id = $1::int
          AND j.status = 2
          AND ($2::int = 0 OR j.branch_id = $2::int)
          AND ($3::date IS NULL OR j.journal_date >= $3::date)
          AND ($4::date IS NULL OR j.journal_date <= $4::date)
        ORDER BY j.journal_date, j.journal_id, e.line_no`,
      [params.accountId, params.branchId, params.from ?? null, params.to ?? null],
    );

    const isDebitNormal = Number(account.normal_side) === 1;
    let running = 0;
    const lines = rows.map((row: any) => {
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      running += isDebitNormal ? debit - credit : credit - debit;
      return {
        ...row,
        debit, credit,
        balance: Math.round(running * 100) / 100,
      };
    });

    return {
      account: {
        accountId: Number(account.account_id), code: account.code, name: account.name,
        accountType: Number(account.account_type),
      },
      lines,
      totalDebit: Math.round(lines.reduce((sum: number, r: any) => sum + r.debit, 0) * 100) / 100,
      totalCredit: Math.round(lines.reduce((sum: number, r: any) => sum + r.credit, 0) * 100) / 100,
      closingBalance: Math.round(running * 100) / 100,
    };
  }

  /** Cost centre profitability / spending for a period. */
  async costCenterReport(params: { branchId: number; from?: string; to?: string }) {
    const rows = await this.db.query<any>(
      `SELECT cc.cost_center_id AS "costCenterId", cc.code, cc.name,
              COALESCE(SUM(e.debit),0) AS debit, COALESCE(SUM(e.credit),0) AS credit
         FROM cost_centers cc
         LEFT JOIN gl_entries e ON e.cost_center_id = cc.cost_center_id
              AND e.journal_id IN (SELECT journal_id FROM gl_journals
                                    WHERE status = 2
                                      AND ($1::int = 0 OR branch_id = $1::int)
                                      AND ($2::date IS NULL OR journal_date >= $2::date)
                                      AND ($3::date IS NULL OR journal_date <= $3::date))
        GROUP BY cc.cost_center_id, cc.code, cc.name
        ORDER BY cc.code`,
      [params.branchId, params.from ?? null, params.to ?? null],
    );
    const lines = rows.map((row: any) => {
      const debit = Number(row.debit);
      const credit = Number(row.credit);
      return {
        costCenterId: Number(row.costCenterId),
        code: row.code,
        name: row.name,
        debit: Math.round(debit * 100) / 100,
        credit: Math.round(credit * 100) / 100,
        net: Math.round((debit - credit) * 100) / 100,
      };
    });
    return {
      lines,
      totalDebit: Math.round(lines.reduce((sum, row) => sum + row.debit, 0) * 100) / 100,
      totalCredit: Math.round(lines.reduce((sum, row) => sum + row.credit, 0) * 100) / 100,
    };
  }

  /** VAT summary used by the Egyptian tax return and the invoice screens. */  async taxSummary(params: { branchId: number; from?: string; to?: string }) {
    const rows = await this.accountBalances(params);
    const output = rows
      .filter((row: any) => row.code === '2102')
      .reduce((sum: number, row: any) => sum + (Number(row.credit) - Number(row.debit)), 0);
    const input = rows
      .filter((row: any) => row.code === '1105')
      .reduce((sum: number, row: any) => sum + (Number(row.debit) - Number(row.credit)), 0);
    const sales = rows
      .filter((row: any) => row.code === '4101')
      .reduce((sum: number, row: any) => sum + (Number(row.credit) - Number(row.debit)), 0);
    const purchases = rows
      .filter((row: any) => row.code === '5102')
      .reduce((sum: number, row: any) => sum + (Number(row.debit) - Number(row.credit)), 0);

    const netVat = Math.round((output - input) * 100) / 100;
    return {
      outputVat: Math.round(output * 100) / 100,
      inputVat: Math.round(input * 100) / 100,
      netVat,
      payable: netVat > 0 ? netVat : 0,
      refundable: netVat < 0 ? -netVat : 0,
      sales: Math.round(sales * 100) / 100,
      purchases: Math.round(purchases * 100) / 100,
      from: params.from ?? null,
      to: params.to ?? null,
    };
  }
}

@Controller('accounting')
export class AccountingController {
  constructor(private readonly service: AccountingService) {}

  // ---- chart of accounts -------------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('accounts')
  listAccounts(@Query('includeInactive') includeInactive: string) {
    return this.service.accounts({ includeInactive: includeInactive === 'true' });
  }

  @RequirePermissions('accounting.view')
  @Get('accounts/:id')
  account(@Param('id', ParseIntPipe) id: number) {
    return this.service.account(id);
  }

  @RequirePermissions('accounting.manage')
  @Post('accounts')
  createAccount(@Body() dto: any) {
    return this.service.createAccount(dto);
  }

  @RequirePermissions('accounting.manage')
  @Put('accounts/:id')
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateAccount(id, dto);
  }

  @RequirePermissions('accounting.manage')
  @Delete('accounts/:id')
  deleteAccount(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteAccount(id);
  }

  // ---- mappings ------------------------------------------------------ //
  @RequirePermissions('accounting.view')
  @Get('mappings')
  mappings() {
    return this.service.mappings();
  }

  @RequirePermissions('accounting.manage')
  @Put('mappings/:key')
  setMapping(@Param('key') key: string, @Body() dto: any) {
    return this.service.setMapping(key, dto);
  }

  // ---- cost centres & currencies ------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('cost-centers')
  costCenters() {
    return this.service.costCenters();
  }

  @RequirePermissions('accounting.manage')
  @Post('cost-centers')
  createCostCenter(@Body() dto: any) {
    return this.service.createCostCenter(dto);
  }

  @RequirePermissions('accounting.manage')
  @Put('cost-centers/:id')
  updateCostCenter(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateCostCenter(id, dto);
  }

  @RequirePermissions('accounting.view')
  @Get('currencies')
  currencies() {
    return this.service.currencies();
  }

  @RequirePermissions('accounting.manage')
  @Post('currencies')
  saveCurrency(@Body() dto: any) {
    return this.service.saveCurrency(dto);
  }

  // ---- journals ------------------------------------------------------ //
  @RequirePermissions('accounting.view')
  @Get('journals')
  listJournals(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type: string,
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listJournals({
      branchId, from, to,
      type: Number(type) || 0, status: Number(status) || 0, search,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('accounting.view')
  @Get('journals/:id')
  journal(@Param('id', ParseIntPipe) id: number) {
    return this.service.journal(id);
  }

  @RequirePermissions('accounting.manage')
  @Post('journals')
  createJournal(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createJournal(dto, user, branchId);
  }

  @RequirePermissions('accounting.post')
  @Post('journals/:id/post')
  postJournal(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.postJournalById(id, user);
  }

  @RequirePermissions('accounting.post')
  @Post('journals/:id/void')
  voidJournal(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.voidJournalById(id, user);
  }

  // ---- vouchers ------------------------------------------------------ //
  @RequirePermissions('accounting.view')
  @Get('vouchers')
  listVouchers(
    @Query('type') type: string,
    @Query('partyId') partyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listVouchers({
      branchId, type: Number(type) || 0, partyId: Number(partyId) || 0, from, to,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('accounting.view')
  @Get('open-invoices')
  openInvoices(
    @Query('partyId') partyId: string,
    @Query('type') type: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.openInvoices({
      partyId: Number(partyId) || 0,
      type: Number(type) || 1,
      branchId,
    });
  }

  @RequirePermissions('accounting.view')
  @Get('vouchers/:id/allocations')
  voucherAllocations(@Param('id', ParseIntPipe) id: number) {
    return this.service.voucherAllocations(id);
  }

  @RequirePermissions('accounting.manage')
  @Post('vouchers')
  createVoucher(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createVoucher(dto, user, branchId);
  }

  @RequirePermissions('accounting.post')
  @Post('vouchers/:id/cancel')
  cancelVoucher(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.cancelVoucher(id, user);
  }

  // ---- checks -------------------------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('checks')
  listChecks(
    @Query('status') status: string,
    @Query('direction') direction: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listChecks({
      branchId, status: Number(status) || 0, direction: Number(direction) || 0,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('accounting.manage')
  @Post('checks')
  createCheck(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createCheck(dto, user, branchId);
  }

  @RequirePermissions('accounting.manage')
  @Put('checks/:id')
  updateCheck(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.updateCheckStatus(id, dto, user);
  }

  @RequirePermissions('accounting.post')
  @Post('checks/:id/collect')
  collectCheck(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.collectCheck(id, user, branchId);
  }

  // ---- periods ------------------------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('periods')
  listPeriods(@CurrentBranch() branchId: number) {
    return this.service.listPeriods(branchId);
  }

  @RequirePermissions('accounting.manage')
  @Post('periods')
  createPeriod(@Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.createPeriod(dto, branchId);
  }

  @RequirePermissions('accounting.close')
  @Post('periods/:id/close')
  closePeriod(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.closePeriod(id, user);
  }

  @RequirePermissions('accounting.close')
  @Post('periods/:id/reopen')
  reopenPeriod(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.reopenPeriod(id, user);
  }

  // ---- year end ------------------------------------------------------ //
  @RequirePermissions('accounting.close')
  @Post('close-year')
  closeYear(@Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.closeYear(body ?? {}, user, branchId);
  }

  // ---- recurring journals -------------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('recurring')
  listRecurring(@CurrentBranch() branchId: number) {
    return this.service.listRecurring(branchId);
  }

  @RequirePermissions('accounting.manage')
  @Post('recurring')
  saveRecurring(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveRecurring(dto, user, branchId);
  }

  @RequirePermissions('accounting.manage')
  @Delete('recurring/:id')
  deleteRecurring(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteRecurring(id);
  }

  @RequirePermissions('accounting.post')
  @Post('recurring/run')
  runRecurring(@CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.runRecurring(user, branchId);
  }

  // ---- reports ------------------------------------------------------- //
  @RequirePermissions('accounting.view')
  @Get('reports/trial-balance')
  trialBalance(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.trialBalance({ branchId, from, to });
  }

  @RequirePermissions('accounting.view')
  @Get('reports/profit-loss')
  profitAndLoss(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.profitAndLoss({ branchId, from, to });
  }

  @RequirePermissions('accounting.view')
  @Get('reports/balance-sheet')
  balanceSheet(@Query('asOf') asOf: string, @CurrentBranch() branchId: number) {
    return this.service.balanceSheet({ branchId, asOf });
  }

  @RequirePermissions('accounting.view')
  @Get('reports/general-ledger')
  generalLedger(
    @Query('accountId') accountId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.generalLedger({
      branchId, accountId: Number(accountId), from, to,
    });
  }

  @RequirePermissions('accounting.view')
  @Get('reports/tax-summary')
  taxSummary(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.taxSummary({ branchId, from, to });
  }

  @RequirePermissions('accounting.view')
  @Get('reports/cost-centers')
  costCenterReport(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.costCenterReport({ branchId, from, to });
  }
}

@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
