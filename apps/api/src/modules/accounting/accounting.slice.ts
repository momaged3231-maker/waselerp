import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post, Put, Query,
  BadRequestException, ForbiddenException, Req, Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed } from '../../common/delete-guard';
import { PoolClient } from 'pg';
import { postJournal, requireMapping, resolveMapping, voidJournal, reverseJournal, JournalLineInput } from '../../common/posting';
import { logActivity } from '../../common/audit';
import { asIsoDate } from '../../common/dates';
import { occurrencesBetween } from '../../common/occurrences';
import { depreciationForMonth, monthsInRange, monthBounds } from '../../common/depreciation';
import {
  AuthUser, CurrentBranch, CurrentUser, RequirePermissions,
} from '../../common/security';

/** Account classes used across the module. */
export const ACCOUNT_TYPE = {
  ASSET: 1, LIABILITY: 2, EQUITY: 3, REVENUE: 4, EXPENSE: 5,
} as const;

/** Two-decimal money rounding (budgets are stored as numeric(18,2)). */
const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
    await assertDeletionAllowed(this.db, 'accountingAccounts');
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
  async createJournal(dto: any, user: AuthUser, branchId: number, ip: string) {
    const lines: JournalLineDto[] = Array.isArray(dto.lines) ? dto.lines : [];
    if (lines.length < 2) throw new BadRequestException('أضف سطرين على الأقل للقيد');
    // EXPLICIT EXCEPTION: backpost into a closed/locked period. Requires the dedicated
    // `accounting.backpost` permission and a mandatory reason — every other document
    // flow (invoices, vouchers, E3/E5/payroll…) stays hard-blocked.
    const backpostReason = String(dto?.backpostReason ?? '').trim();
    if (backpostReason) {
      if (!user.permissions.includes('accounting.backpost')) {
        throw new ForbiddenException('ترحيل قيد إلى فترة مقفلة يتطلب صلاحية accounting.backpost — غير مصرح لك');
      }
    } else if (String(dto?.backpostReason ?? '') !== '') {
      throw new BadRequestException('backpostReason يجب أن يكون نصًا غير فارغ');
    }
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
        currencyCode: dto.currencyCode ? String(dto.currencyCode).trim().toUpperCase() : undefined,
        exchangeRate: dto.exchangeRate === undefined || dto.exchangeRate === null || dto.exchangeRate === ''
          ? undefined
          : Number(dto.exchangeRate),
        backpostReason: backpostReason || null,
      });
      await logActivity(client, {
        userId: user.userId,
        branchId,
        action: 'gl.journal.create',
        entity: 'gl_journal',
        entityId: String(journalId),
        details: dto.description ?? 'قيد يدوي',
        ip,
      });
      return { journalId };
    });
  }

  async postJournalById(id: number, user: AuthUser, ip: string) {
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
      await logActivity(client, { userId: user.userId, branchId: Number(header.rows[0].branch_id),
        action: 'gl.journal.post', entity: 'gl_journal', entityId: String(id), details: 'ترحيل قيد', ip });
      return { journalId: id, status: 2 };
    });
  }

  async voidJournalById(id: number, user: AuthUser, ip: string) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM gl_journals WHERE journal_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('القيد غير موجود');
      if (Number(header.rows[0].status) === 3) throw new BadRequestException('القيد ملغى بالفعل');
      await voidJournal(client, id);
      await logActivity(client, { userId: user.userId, branchId: Number(header.rows[0].branch_id),
        action: 'gl.journal.void', entity: 'gl_journal', entityId: String(id), details: 'إلغاء قيد', ip });
      return { journalId: id, status: 3 };
    });
  }

  // ------------------------------------------------------------------ //
  //  Vouchers (receipt / payment)
  // ------------------------------------------------------------------ //
  async listVouchers(params: { branchId: number; type?: number; partyId?: number; from?: string; to?: string; limit: number }) {
    return this.db.query<any>(
      `SELECT v.voucher_id AS "voucherId", v.voucher_no AS "voucherNo", v.voucher_type AS "voucherType",
              v.voucher_date AS "voucherDate", v.created_at AS "createdAt", v.amount, v.description, v.status,
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
  async createVoucher(dto: any, user: AuthUser, branchId: number, ip: string) {
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    const voucherType = Number(dto.voucherType ?? 1);
    if (![1, 2].includes(voucherType)) throw new BadRequestException('نوع السند غير صحيح');
    const cashAccountId = Number(dto.cashAccountId);
    if (!cashAccountId) throw new BadRequestException('حدد حساب الخزينة');
    // GAP-06: idempotency key (null/undefined/empty => no dedupe).
    const clientRequestId = String(dto.clientRequestId ?? '').trim() || null;
    // Fast path: retry after committed request — short-circuit before side effects.
    if (clientRequestId) {
      const existing = await this.db.one<any>(
        `SELECT voucher_id AS "voucherId", voucher_no AS "voucherNo", journal_id AS "journalId"
           FROM vouchers WHERE client_request_id = $1`,
        [clientRequestId],
      );
      if (existing) return { ...existing, duplicate: true };
    }

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

    try {
      return await this.db.transaction(async (client) => {
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
            payment_method, amount, description, journal_id, status, created_by, client_request_id)
         VALUES ($1,$2, COALESCE($3::date, CURRENT_DATE), $4,$5,$6,$7,$8,$9,$10,1,$11,$12)
         RETURNING voucher_id`,
        [voucherNo, voucherType, dto.voucherDate ?? null, branchId, partyId, cashAccountId,
          Number(dto.paymentMethod ?? 1), amount, dto.description ?? null, journalId, user.userId, clientRequestId],
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

      const voucherAction = voucherType === 1 ? 'voucher.receipt' : 'voucher.payment';
      await logActivity(client, {
        userId: user.userId,
        branchId,
        action: voucherAction,
        entity: 'voucher',
        entityId: String(voucherId),
        details: `${voucherType === 1 ? 'قبض' : 'صرف'} ${amount} - ${party.rows[0]?.name ?? ''}`,
        ip,
      });

      return { voucherId, voucherNo, journalId, allocated: settled };
      });
    } catch (err: any) {
      // GAP-06: atomic idempotency — UNIQUE (ux_vouchers_client_request) aborts tx.
      if (clientRequestId && err?.code === '23505' && String(err?.constraint ?? '') === 'ux_vouchers_client_request') {
        const existing = await this.db.one<any>(
          `SELECT voucher_id AS "voucherId", voucher_no AS "voucherNo", journal_id AS "journalId"
             FROM vouchers WHERE client_request_id = $1`,
          [clientRequestId],
        );
        if (existing) return { ...existing, duplicate: true };
      }
      throw err;
    }
  }

  /** Cancels a voucher: voids the journal and reverses the treasury movement. */
  async cancelVoucher(id: number, user: AuthUser, ip: string) {
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

      await logActivity(client, { userId: user.userId, branchId: Number(voucher.branch_id),
        action: 'gl.voucher.cancel', entity: 'voucher', entityId: String(id), details: `إلغاء ${voucher.voucher_no}`, ip });
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

    return this.db.transaction(async (client) => {
      const row = await client.query<{ check_id: number }>(
        `INSERT INTO checks
           (branch_id, direction, check_no, bank_name, amount, due_date, party_id,
            cash_account_id, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10) RETURNING check_id`,
        [branchId, direction, String(dto.checkNo).trim(), dto.bankName ?? null, amount,
         dto.dueDate ?? null, dto.partyId ? Number(dto.partyId) : null,
         dto.cashAccountId ? Number(dto.cashAccountId) : null, dto.notes ?? null, user.userId],
      );
      const checkId = Number(row.rows[0].check_id);
      const partyId = dto.partyId ? Number(dto.partyId) : null;
      // Party ledger: a check is a payment-like settlement both ways.
      if (partyId) {
        await client.query(
          `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, reference_no, notes, created_by)
           VALUES ($1::int,$2::int,2,2,$3::numeric,$4::text,$5::text,$6::int)`,
          [branchId, partyId, amount, String(dto.checkNo).trim(),
            direction === 1 ? 'شيك قبض' : 'شيك صرف', user.userId],
        );
      }
      // Journal: recognize the note as an asset (or liability).
      const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
      const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
      const ar = await requireMapping(client, 'AR', 'ذمم العملاء');
      const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
      if (direction === 1) {
        await postJournal(client, {
          branchId, journalType: 5, description: `شيك قبض ${dto.checkNo}`,
          sourceType: 'check', sourceId: checkId, userId: user.userId, autoBalance: false,
          lines: [
            { accountId: notesRec.accountId, debit: amount, description: 'شيك قبض' },
            { accountId: ar.accountId, credit: amount, partyId, description: 'شيك قبض' },
          ],
        });
      } else {
        await postJournal(client, {
          branchId, journalType: 5, description: `شيك صرف ${dto.checkNo}`,
          sourceType: 'check', sourceId: checkId, userId: user.userId, autoBalance: false,
          lines: [
            { accountId: ap.accountId, debit: amount, partyId, description: 'شيك صرف' },
            { accountId: notesPay.accountId, credit: amount, description: 'شيك صرف' },
          ],
        });
      }
      return { checkId };
    });
  }

  async updateCheckStatus(id: number, dto: any, user: AuthUser, branchId: number) {
    const status = Number(dto.status);
    if (![1, 2, 3, 4].includes(status)) throw new BadRequestException('حالة الشيك غير صحيحة');

    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        'SELECT * FROM checks WHERE check_id = $1::bigint AND branch_id = $2::int FOR UPDATE',
        [id, branchId],
      );
      if (!row.rows.length) throw new BadRequestException('الشيك غير موجود');
      const check = row.rows[0];
      if (Number(check.status) !== 1) {
        throw new BadRequestException('لا يمكن تعديل شيك خرج من حالة «تحت التحصيل»');
      }

      if (status === 1) {
        await client.query('UPDATE checks SET status=1, notes = COALESCE($2::text, notes) WHERE check_id = $1::bigint', [id, dto.notes ?? null]);
        return { checkId: id, status: 1 };
      }
      if (status === 2) {
        // delegate to the shared collection logic
        return this.collectCheck(id, user, branchId);
      }
      // bounce / cancel: reverse the issuance (money-wise and party-wise)
      const direction = Number(check.direction ?? 1);
      const amount = Number(check.amount);
      const partyId = check.party_id ? Number(check.party_id) : null;
      const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
      const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
      const ar = await requireMapping(client, 'AR', 'ذمم العملاء');
      const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
      if (direction === 1) {
        await postJournal(client, {
          branchId, journalType: 5, description: `عكس شيك قبض ${check.check_no} (${status === 3 ? 'مرتد' : 'ملغي'})`,
          sourceType: 'check_reversal', sourceId: id, userId: user.userId, autoBalance: false,
          lines: [
            { accountId: ar.accountId, debit: amount, partyId, description: 'عكس شيك قبض' },
            { accountId: notesRec.accountId, credit: amount, description: 'عكس شيك قبض' },
          ],
        });
      } else {
        await postJournal(client, {
          branchId, journalType: 5, description: `عكس شيك صرف ${check.check_no} (${status === 3 ? 'مرتد' : 'ملغي'})`,
          sourceType: 'check_reversal', sourceId: id, userId: user.userId, autoBalance: false,
          lines: [
            { accountId: notesPay.accountId, debit: amount, description: 'عكس شيك صرف' },
            { accountId: ap.accountId, credit: amount, partyId, description: 'عكس شيك صرف' },
          ],
        });
      }
      if (partyId) {
        await client.query(
          `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, reference_no, notes, created_by)
           VALUES ($1::int,$2::int,1,2,$3::numeric,$4::text,$5::text,$6::int)`,
          [branchId, partyId, amount, check.check_no, status === 3 ? 'شيك مرتد' : 'شيك ملغي', user.userId],
        );
      }
      await client.query('UPDATE checks SET status = $2, notes = COALESCE($3::text, notes) WHERE check_id = $1::bigint',
        [id, status, dto.notes ?? null]);
      return { checkId: id, status };
    });
  }

  /** Marks a check as collected: moves the money between the drawer/bank and the note. */
  async collectCheck(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        'SELECT * FROM checks WHERE check_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!row.rows.length) throw new BadRequestException('الشيك غير موجود');
      const check = row.rows[0];
      if (Number(check.status) !== 1) throw new BadRequestException('الشيك ليس تحت التحصيل');
      const branchOfCheck = Number(check.branch_id ?? branchId);
      if (branchOfCheck !== Number(branchId)) throw new BadRequestException('الشيك يتبع فرعًا آخر');

      // Resolve the cash/bank account with a sensible fallback (drawer first).
      let cashAccountId = Number(check.cash_account_id ?? 0) || null;
      if (!cashAccountId) {
        const fallback = await client.query<any>(
          `SELECT cash_account_id FROM cash_accounts WHERE branch_id = $1::int AND is_active = true ORDER BY type, cash_account_id LIMIT 1`,
          [branchId],
        );
        cashAccountId = Number(fallback.rows[0]?.cash_account_id ?? 0) || null;
      }

      const account = cashAccountId
        ? await client.query<any>('SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int', [cashAccountId])
        : null;
      const glAccountId = account?.rows[0]?.gl_account_id ?? (await resolveMapping(client, 'CASH'))?.accountId;
      if (!glAccountId) throw new BadRequestException('حساب الخزينة غير مرتبط بحساب محاسبي');

      const direction = Number(check.direction ?? 1);
      const amount = Number(check.amount);
      const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
      const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
      const partyId = check.party_id ? Number(check.party_id) : null;
      if (direction === 1) {
        await postJournal(client, {
          branchId,
          journalType: 5,
          description: `تحصيل شيك ${check.check_no}`,
          sourceType: 'check_collect',
          sourceId: id,
          lines: [
            { accountId: glAccountId, debit: amount, description: 'تحصيل شيك' },
            { accountId: notesRec.accountId, credit: amount, partyId, description: 'تحصيل شيك' },
          ],
          userId: user.userId,
        });
      } else {
        await postJournal(client, {
          branchId,
          journalType: 5,
          description: `صرف شيك ${check.check_no}`,
          sourceType: 'check_collect',
          sourceId: id,
          lines: [
            { accountId: notesPay.accountId, debit: amount, partyId, description: 'صرف شيك' },
            { accountId: glAccountId, credit: amount, description: 'صرف شيك' },
          ],
          userId: user.userId,
        });
      }
      await client.query(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, amount, transaction_date, description, party_id, created_by)
         VALUES ($1,$2,$3,$4, CURRENT_DATE, $5,$6,$7)`,
        [branchId, cashAccountId, direction === 1 ? 1 : 2, amount,
         `${direction === 1 ? 'تحصيل' : 'صرف'} شيك ${check.check_no}`, partyId, user.userId],
      );
      await client.query('UPDATE checks SET status = 2, cash_account_id = $2::int WHERE check_id = $1::bigint', [id, cashAccountId]);
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
              p.manual_lock AS "manualLock", p.manual_lock_at AS "manualLockAt", p.manual_lock_reason AS "manualLockReason",
              l.full_name AS "manualLockedBy",
              (SELECT COUNT(*)::int FROM gl_journals j WHERE j.period_id = p.period_id) AS "journalCount"
         FROM periods p LEFT JOIN users u ON u.user_id = p.closed_by
              LEFT JOIN users l ON l.user_id = p.manual_lock_by
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

  /**
   * MANUAL administrative lock — freezes the period administratively:
   * no journals, no postings, no closing, no reversal. It does NOT touch
   * `is_closed`, `closing_entry_id`, `net_income` — the accounting state is
   * untouched by design. Audited with a mandatory reason.
   */
  async manualLock(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب القفل الإداري إلزامي — اذكر السبب (مثل: حفظ الدفاتر أثناء التدقيق)');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT period_id, name, is_closed, manual_lock FROM periods
          WHERE period_id = $1::int AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('الفترة غير موجودة في هذا الفرع');
      const p = rows[0];
      if (p.manual_lock) throw new BadRequestException('الفترة مقفولة إداريًا بالفعل');
      await client.query(
        `UPDATE periods SET manual_lock = true, manual_lock_at = now(), manual_lock_by = $2::int, manual_lock_reason = $3
          WHERE period_id = $1::int`,
        [id, user.userId, reason],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'period.manual_lock',
        entity: 'period', entityId: String(id), details: `قفل إداري للفترة «${p.name}» — ${reason}`, ip });
      return { periodId: id, manualLock: true, isClosed: !!p.is_closed, reason };
    });
  }

  /** MANUAL administrative unlock — lifts the administrative freeze. Accounting state unchanged. */
  async manualUnlock(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب إزالة القفلة الإدارية إلزامي — اذكر السبب');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT period_id, name, is_closed, manual_lock FROM periods
          WHERE period_id = $1::int AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('الفترة غير موجودة في هذا الفرع');
      const p = rows[0];
      if (!p.manual_lock) throw new BadRequestException('الفترة غير مقفولة إداريًا');
      await client.query(
        `UPDATE periods SET manual_lock = false, manual_lock_at = NULL, manual_lock_by = NULL, manual_lock_reason = NULL
          WHERE period_id = $1::int`,
        [id],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'period.manual_unlock',
        entity: 'period', entityId: String(id), details: `إزالة القفلة الإدارية عن الفترة «${p.name}» — ${reason}`, ip });
      return { periodId: id, manualLock: false, isClosed: !!p.is_closed, reason };
    });
  }

  // ------------------------------------------------------------------ //
  //  E6 — Automated period closing
  // ------------------------------------------------------------------ //

  private async periodByIdForBranch(client: PoolClient, id: number, branchId: number, forUpdate = false) {
    const select = forUpdate ? 'SELECT * FROM periods WHERE period_id = $1::int AND branch_id = $2::int FOR UPDATE'
      : 'SELECT * FROM periods WHERE period_id = $1::int AND branch_id = $2::int';
    const { rows } = await client.query(select, [id, branchId]);
    if (!rows.length) throw new BadRequestException('الفترة غير موجودة في هذا الفرع');
    return rows[0];
  }

  /** Revenue/expense per account for a date range — shared by yearly and period closing. */
  private async revenueExpenseBalances(client: PoolClient, from: string, to: string, branchId: number) {
    const balances = await client.query<any>(
      `SELECT a.account_id AS "accountId", a.code, a.name, a.account_type AS "accountType",
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
    const revenue = balances.rows
      .filter((row: any) => Number(row.accountType) === ACCOUNT_TYPE.REVENUE)
      .map((row: any) => ({ ...row, amount: Math.round((Number(row.credit) - Number(row.debit)) * 100) / 100 }))
      .filter((row: any) => Math.abs(row.amount) > 0.005);
    const expense = balances.rows
      .filter((row: any) => Number(row.accountType) === ACCOUNT_TYPE.EXPENSE)
      .map((row: any) => ({ ...row, amount: Math.round((Number(row.debit) - Number(row.credit)) * 100) / 100 }))
      .filter((row: any) => Math.abs(row.amount) > 0.005);

    const totalRevenue = revenue.reduce((sum: number, row: any) => sum + row.amount, 0);
    const totalExpense = expense.reduce((sum: number, row: any) => sum + row.amount, 0);
    const netProfit = Math.round((totalRevenue - totalExpense) * 100) / 100;
    return { revenue, expense, totalRevenue, totalExpense, netProfit };
  }

  /**
   * Runs the closing checklist for a period and persists every result in
   * period_close_checks (idempotent per period+check via UNIQUE upsert).
   * Never throws: returns the check rows; the closing call enforces them.
   */
  private async runCloseChecklist(client: PoolClient, period: any, branchId: number, userId: number | null, ip: string,
    opts?: { bypassReason?: string | null; overrides?: { checkCode: string; dueKey: string; reason: string }[] | null; canOverride?: boolean; dryRun?: boolean }) {
    type DueItem = { key: string; label: string; amount: number };
    const bypassReason = opts?.bypassReason ?? null;
    const from = asIsoDate(period.start_date)!;
    const to = asIsoDate(period.end_date) ?? new Date().toISOString().slice(0, 10);
    const results: { checkCode: string; checkLabel: string; status: number; details?: string | null }[] = [];

    const record = async (checkCode: string, checkLabel: string, status: number, details?: string | null) => {
      results.push({ checkCode, checkLabel, status, details: details ?? null });
      await client.query(
        `INSERT INTO period_close_checks (period_id, branch_id, check_code, check_label, status, details, checked_at, resolved_by)
         VALUES ($1::int, $2::int, $3, $4, $5::smallint, $6, now(), $7::int)
         ON CONFLICT (period_id, check_code) DO UPDATE
           SET status = EXCLUDED.status, details = EXCLUDED.details, checked_at = now(), resolved_by = EXCLUDED.resolved_by`,
        [period.period_id, branchId, checkCode, checkLabel, status, details ?? null, userId],
      );
    };

    /**
     * Splits the missing dues of an E3/E5 check into waived vs remaining.
     * Overrides (per-item or whole-check legacy bypassReason) only apply when the
     * caller holds the dedicated permission `accounting.close_override`; otherwise
     * the request fails closed with 403 and nothing is written or bypassed.
     */
    const waive = (missing: DueItem[], checkCode: string) => {
      const canOv = !!opts?.canOverride;
      const waiverReason = String(opts?.bypassReason ?? '').trim() || null;
      const perItem = (opts?.overrides ?? []).filter((o) => o.checkCode === checkCode && !!String(o.reason ?? '').trim());
      const wantsOverride = !!waiverReason || (opts?.overrides ?? []).some((o) => o.checkCode === checkCode);
      if (wantsOverride && !canOv) {
        throw new ForbiddenException('تجاوز فحوص الإقفال E3 وE5 يتطلب صلاحية accounting.close_override — غير مصرح لك');
      }
      if (!canOv || (!waiverReason && perItem.length === 0)) return { waived: [] as { item: DueItem; reason: string }[], remaining: missing };
      if (waiverReason) return { waived: missing.map((item) => ({ item, reason: waiverReason })), remaining: [] as DueItem[] };
      const keyOf = (s: string) => s;
      const waived: { item: DueItem; reason: string }[] = [];
      const remaining: DueItem[] = [];
      for (const item of missing) {
        const match = perItem.find((o) => keyOf(o.dueKey) === item.key);
        if (match) waived.push({ item, reason: String(match.reason).trim() });
        else remaining.push(item);
      }
      return { waived, remaining };
    };

    /** Writes the immutable override audit rows for the waived dues (transactional with the close). */
    const recordOverrides = async (waived: { item: DueItem; reason: string }[], checkCode: string) => {
      if (!waived.length || opts?.dryRun) return;
      for (const { item, reason } of waived) {
        try {
          await client.query(
            `INSERT INTO period_close_overrides (period_id, branch_id, check_code, due_key, due_label, due_amount, reason, created_by)
             VALUES ($1::int,$2::int,$3,$4,$5,$6::numeric,$7,$8::int)`,
            [period.period_id, branchId, checkCode, item.key, item.label, item.amount, reason, userId],
          );
        } catch (err: any) {
          if (err?.code === '23505') {
            throw new BadRequestException('تم تسجيل تجاوز مكرر لهذا الاستحقاق في هذه الفترة — غير مسموح بتغييره بعد اعتماده');
          }
          throw new BadRequestException('تعذر تسجيل تجاوز الإقفال — راجع السجل');
        }
      }
      for (const { item, reason } of waived) {
        await logActivity(client, { userId: userId ?? 0, branchId, action: 'period.close_override',
          entity: 'period', entityId: String(period.period_id),
          details: `تجاوز «${item.label}» بمبلغ ${item.amount.toFixed(2)} — ${reason}`, ip });
      }
    };

    // 1) Every posted journal in the period is balanced
    const imb = await client.query(
      `SELECT COUNT(*)::int AS n FROM gl_journals
        WHERE branch_id = $1::int AND status = 2
          AND journal_date BETWEEN $2::date AND $3::date
          AND ABS(total_debit - total_credit) > 0.005`,
      [branchId, from, to],
    );
    const imbCount = Number(imb.rows[0]?.n ?? 0);
    await record('journals_balanced', 'كل القيود في الفترة متوازنة', imbCount === 0 ? 2 : 3,
      imbCount === 0 ? null : `قيود غير متوازنة: ${imbCount}`);

    // 2) No draft (unposted) journals in the period
    const drafts = await client.query(
      `SELECT COUNT(*)::int AS n FROM gl_journals
        WHERE branch_id = $1::int AND status = 1
          AND journal_date BETWEEN $2::date AND $3::date`,
      [branchId, from, to],
    );
    const draftCount = Number(drafts.rows[0]?.n ?? 0);
    await record('no_draft_journals', 'لا توجد قيود غير مرحّلة (مسودة)', draftCount === 0 ? 2 : 3,
      draftCount === 0 ? null : `قيود مسودة: ${draftCount}`);

    // 3) No draft invoices in the period
    const draftInv = await client.query(
      `SELECT COUNT(*)::int AS n FROM invoices
        WHERE branch_id = $1::int AND status = 1
          AND invoice_date::date BETWEEN $2::date AND $3::date`,
      [branchId, from, to],
    );
    const draftInvCount = Number(draftInv.rows[0]?.n ?? 0);
    await record('no_draft_invoices', 'لا توجد فواتير غير معتمدة (مسودة)', draftInvCount === 0 ? 2 : 3,
      draftInvCount === 0 ? null : `فواتير مسودة: ${draftInvCount}`);

    // 4) No open shifts in the branch (one shift per branch — D32)
    const shifts = await client.query(`SELECT COUNT(*)::int AS n FROM shifts WHERE branch_id = $1::int AND status = 1`, [branchId]);
    const openShifts = Number(shifts.rows[0]?.n ?? 0);
    await record('no_open_shifts', 'لا توجد ورديات مفتوحة في الفرع', openShifts === 0 ? 2 : 3,
      openShifts === 0 ? null : `ورديات مفتوحة: ${openShifts}`);

    // 5) Belt-and-braces: EVERY posted journal in the branch balances (all time)
    const tb = await client.query(
      `SELECT COUNT(*)::int AS n FROM gl_journals
        WHERE branch_id = $1::int AND status = 2
          AND ABS(total_debit - total_credit) > 0.005`,
      [branchId],
    );
    const tbBad = Number(tb.rows[0]?.n ?? 0);
    await record('trial_balance_balanced', 'ميزان الأستاذ متوازن (كل التاريخ)', tbBad === 0 ? 2 : 3,
      tbBad === 0 ? null : `قيود غير متوازنة (كل الوقت): ${tbBad}`);

    // 6) Unmatched bank statement lines in range — bypassable only with an explicit reason
    let unmatched = 0;
    try {
      const r = await client.query(
        `SELECT COUNT(*)::int AS n FROM bank_statement_lines
          WHERE branch_id = $1::int AND status = 1
            AND movement_type NOT IN (10, 11)
            AND statement_date BETWEEN $2::date AND $3::date`,
        [branchId, from, to],
      );
      unmatched = Number(r.rows[0]?.n ?? 0);
    } catch {
      unmatched = 0; // bank_statement_lines may be absent on older installs
    }
    if (unmatched === 0) {
      await record('no_unreconciled_bank_lines', 'لا توجد سطور كشف بنكي غير مطابقة', 2, null);
    } else if (bypassReason) {
      await record('no_unreconciled_bank_lines', 'لا توجد سطور كشف بنكي غير مطابقة', 4,
        `تجاهل ${unmatched} سطرًا غير مطابق بقرار مصرّح: ${bypassReason}`);
    } else {
      await record('no_unreconciled_bank_lines', 'لا توجد سطور كشف بنكي غير مطابقة', 3,
        `سطور غير مطابقة: ${unmatched} — أدخل bypassReason لإقفال الفترة بتجاهلها`);
    }

    // 7) E3 — every due bank-expense occurrence in the period has a posted run.
    // Active rules only (`is_active = false` is an explicit opt-out); a suspended
    // rule stops being due ON its suspension date (earlier occurrences stay due).
    // A closed accounting period for the occurrence is NOT an excuse: an
    // occurrence refused because its period was locked stays due and blocks this close.
    {
      const { rows: rules } = await client.query(
        `SELECT rule_id, name, frequency, day_of_month, start_date, end_date, is_active, suspended_at, amount
           FROM bank_expense_rules
          WHERE branch_id = $1::int`,
        [branchId],
      );
      const missing: DueItem[] = [];
      for (const rule of rules) {
        if (!rule.is_active) continue;
        const ruleStart = asIsoDate(rule.start_date)!;
        const ruleEnd = asIsoDate(rule.end_date);
        const upper = ruleEnd && ruleEnd < to ? ruleEnd : to;
        const suspended = rule.suspended_at ? asIsoDate(rule.suspended_at) : null;
        for (const occ of occurrencesBetween(ruleStart, Number(rule.day_of_month), Number(rule.frequency), from, upper)) {
          if (suspended && occ >= suspended) continue; // suspended before this occurrence — not due
          const hit = await client.query(
            `SELECT 1 FROM bank_expense_runs WHERE rule_id = $1::int AND period_key = $2::date AND status = 1`,
            [rule.rule_id, occ],
          );
          if (!hit.rows.length) {
            missing.push({
              key: `rule:${Number(rule.rule_id)}:${occ}`,
              label: `${rule.name} — ${occ}`,
              amount: Math.round(Number(rule.amount) * 100) / 100,
            });
          }
        }
      }
      const { waived, remaining } = waive(missing, 'e3_bank_expense_due');
      await recordOverrides(waived, 'e3_bank_expense_due');
      const label = 'كل استحقاقات الرسوم البنكية (E3) في الفترة مقيّدة';
      if (remaining.length === 0) {
        await record('e3_bank_expense_due', label, waived.length ? 4 : 2,
          waived.length ? `تجاوز ${waived.length} استحقاقًا بقرار مصرّح — ${waived.map((w) => `${w.item.label} (${w.item.amount.toFixed(2)}) — ${w.reason}`).join('؛ ')}` : null);
      } else {
        const parts = [`${remaining.length} استحقاقًا لم يولّد لها E3: ${remaining.slice(0, 8).map((m) => `${m.label} (${m.amount.toFixed(2)})`).join('؛ ')}${remaining.length > 8 ? ' …' : ''}`];
        if (waived.length) parts.push(`${waived.length} استحقاقًا مُتجاوزًا: ${waived.map((w) => `${w.item.label} (${w.item.amount.toFixed(2)})`).join('؛ ')}`);
        await record('e3_bank_expense_due', label, 3, parts.join(' — '));
      }
    }

    // 8) E5 — every due depreciation month overlapping the period has been posted.
    // Due = in-service (status 1, the population E5 can post), computable amount
    // > 0 for that month, no asset_depreciation_lines row. Fully-depreciated
    // assets (remaining = 0) and assets entering service after the month are not
    // due. Assets of status 3/4/5 (disposed/written-off) cannot be posted by E5,
    // so they do not block the close — the asset register may then show a book
    // value mismatch vs GL; post depreciation BEFORE disposing to avoid it.
    {
      const months = monthsInRange(from, to);
      const missing: DueItem[] = [];
      const { rows: assets } = await client.query(
        `SELECT a.* FROM fixed_assets a
          WHERE a.branch_id = $1::int AND a.status = 1 AND a.in_service_date <= $2::date`,
        [branchId, to],
      );
      for (const monthDate of months) {
        const { last } = monthBounds(monthDate.slice(0, 7));
        for (const asset of assets) {
          if (asIsoDate(asset.in_service_date)! > last) continue; // not in service this month
          const accRow = await client.query<{ acc: string | null }>(
            `SELECT COALESCE(SUM(depreciation_amount), 0)::numeric acc FROM asset_depreciation_lines
              WHERE asset_id = $1::int AND period_month < $2::date`,
            [asset.asset_id, monthDate],
          );
          const amount = depreciationForMonth(asset, monthDate, Number(accRow.rows[0]?.acc ?? 0));
          if (!(amount > 0)) continue; // residual reached / fully consumed / stub day 0
          const hit = await client.query(
            `SELECT 1 FROM asset_depreciation_lines WHERE asset_id = $1::int AND period_month = $2::date`,
            [asset.asset_id, monthDate],
          );
          if (!hit.rows.length) {
            missing.push({
              key: `asset:${Number(asset.asset_id)}:${monthDate.slice(0, 7)}`,
              label: `${asset.asset_code} «${asset.name}» — ${monthDate.slice(0, 7)}`,
              amount,
            });
          }
        }
      }
      const { waived, remaining } = waive(missing, 'e5_depreciation_due');
      await recordOverrides(waived, 'e5_depreciation_due');
      const label = 'كل استحقاقات الإهلاك (E5) في الفترة مقيّدة';
      if (remaining.length === 0) {
        await record('e5_depreciation_due', label, waived.length ? 4 : 2,
          waived.length ? `تجاوز ${waived.length} شهر إهلاك بقرار مصرّح — ${waived.map((w) => `${w.item.label} (${w.item.amount.toFixed(2)}) — ${w.reason}`).join('؛ ')}` : null);
      } else {
        const parts = [`${remaining.length} شهر إهلاك مستحق غير مسجّل: ${remaining.slice(0, 8).map((m) => `${m.label} (${m.amount.toFixed(2)})`).join('؛ ')}${remaining.length > 8 ? ' …' : ''}`];
        if (waived.length) parts.push(`${waived.length} عنصر مُتجاوز: ${waived.map((w) => `${w.item.label} (${w.item.amount.toFixed(2)})`).join('؛ ')}`);
        await record('e5_depreciation_due', label, 3, parts.join(' — '));
      }
    }

    const failed = results.filter((c) => c.status === 3).length;
    return {
      periodId: period.period_id, name: period.name, from, to,
      checks: results,
      passed: results.filter((c) => c.status === 2).length,
      bypassed: results.filter((c) => c.status === 4).length,
      failed,
    };
  }

  /** Pre-close check — runs the checklist, stores results, returns them. No journal, no close. */
  async preCloseCheck(id: number, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const period = await this.periodByIdForBranch(client, id, branchId);
      const out = await this.runCloseChecklist(client, period, branchId, user.userId, ip, { dryRun: true });
      return { ...out, overrideAvailable: !!user.permissions.includes('accounting.close_override') };
    });
  }

  /**
   * The automated closing: checklist → zero revenue/expense into RETAINED_EARNINGS
   * (one balanced journal, source_type = 'period_close') → period is_closed + entry linked.
   * Idempotent: an already-closed period is refused with an Arabic message.
   * An empty (no movement) period closes WITHOUT a journal (closing_entry_id = NULL).
   */
  async closeMonth(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const bypassReason = String(dto?.bypassReason ?? '').trim() || null;
    const overrides: { checkCode: string; dueKey: string; reason: string }[] = Array.isArray(dto?.overrides)
      ? dto.overrides
          .filter((o: any) => o && ['e3_bank_expense_due', 'e5_depreciation_due'].includes(String(o.checkCode)))
          .map((o: any) => ({ checkCode: String(o.checkCode), dueKey: String(o.dueKey ?? '').trim(), reason: String(o.reason ?? '').trim() }))
      : [];
    for (const o of overrides) {
      if (!o.dueKey) throw new BadRequestException('كل قيد تجاوز (override) يحتاج dueKey — العنصر المطلوب تجاوزه');
      if (!o.reason) throw new BadRequestException('سبب التجاوز إلزامي لكل عنصر');
    }
    if (bypassReason === null && overrides.length === 0 && (dto?.bypassReason !== undefined || dto?.overrides !== undefined)) {
      // explicit but empty override payload — treat as none, do not error
    }
    const canOverride = !!user.permissions.includes('accounting.close_override');
    return this.db.transaction(async (client) => {
      // FOR UPDATE: a concurrent close/reopen of the SAME period must wait for us —
      // exactly one request wins; the loser re-reads the row and refuses.
      const period = await this.periodByIdForBranch(client, id, branchId, true);
      if (period.is_closed) {
        throw new BadRequestException(`الفترة «${period.name}» مقفلة بالفعل — لا يمكن إقفالها مرة أخرى`);
      }
      if (period.manual_lock) {
        throw new BadRequestException(`الفترة «${period.name}» مقفولة إداريًا — أزل القفلة الإدارية قبل الإقفال المحاسبي`);
      }
      const checklist = await this.runCloseChecklist(client, period, branchId, user.userId, ip, {
        bypassReason,
        overrides: overrides.length ? overrides : null,
        canOverride,
      });
      if (checklist.failed > 0) {
        const parts = checklist.checks
          .filter((c) => c.status === 3)
          .map((c) => `${c.checkLabel}${c.details ? ` — ${c.details}` : ''}`);
        throw new BadRequestException(`تعذر الإقفال — ${parts.join(' ؛ ')}`);
      }

      const from = asIsoDate(period.start_date)!;
      const to = asIsoDate(period.end_date) ?? new Date().toISOString().slice(0, 10);
      const { revenue, expense, totalRevenue, totalExpense, netProfit } = await this.revenueExpenseBalances(client, from, to, branchId);

      let journalId: number | null = null;
      if (revenue.length || expense.length) {
        const retained = await requireMapping(client, 'RETAINED_EARNINGS', 'الأرباح المحتجزة');
        const lines: JournalLineInput[] = [];
        // Revenue closes with a debit; contra revenue (returns/discounts) closes with its own sign.
        for (const row of revenue) {
          if (row.amount > 0) lines.push({ accountId: Number(row.accountId), debit: row.amount, description: `إقفال ${row.name}` });
          else lines.push({ accountId: Number(row.accountId), credit: -row.amount, description: `إقفال ${row.name}` });
        }
        // Expense closes with a credit; contra expense closes with its own sign.
        for (const row of expense) {
          if (row.amount > 0) lines.push({ accountId: Number(row.accountId), credit: row.amount, description: `إقفال ${row.name}` });
          else lines.push({ accountId: Number(row.accountId), debit: -row.amount, description: `إقفال ${row.name}` });
        }
        if (netProfit >= 0) {
          lines.push({ accountId: retained.accountId, credit: netProfit, description: 'أرباح الفترة' });
        } else {
          lines.push({ accountId: retained.accountId, debit: -netProfit, description: 'خسائر الفترة' });
        }
        journalId = await postJournal(client, {
          branchId, journalType: 8, journalDate: to,
          description: `قيد إقفال «${period.name}»`,
          sourceType: 'period_close', sourceId: period.period_id, userId: user.userId, autoBalance: true,
          lines,
        });
      }

      // Atomic compare-and-swap: only the transaction that flips is_closed=false→true
      // may record the closing — if another one already won, 0 rows come back and the
      // whole transaction (including the closing journal) rolls back.
      const updated = await client.query(
        `UPDATE periods
            SET is_closed = true, closed_at = now(), closed_by = $2::int,
                closing_entry_id = $3::bigint, net_income = $4::numeric
          WHERE period_id = $1::int AND is_closed = false
          RETURNING period_id`,
        [period.period_id, user.userId, journalId, netProfit.toFixed(2)],
      );
      if (updated.rows.length !== 1) {
        throw new BadRequestException('تعذر إقفال الفترة — تغيرت حالتها أثناء التنفيذ، أعد المحاولة');
      }
      await logActivity(client, { userId: user.userId, branchId, action: 'period.close',
        entity: 'period', entityId: String(period.period_id),
        details: journalId
          ? `إقفال «${period.name}» — صافي ${netProfit} — قيد #${journalId}`
          : `إقفال «${period.name}» — بلا حركات (دخل 0)`, ip });
      return {
        periodId: period.period_id, isClosed: true, journalId, netProfit,
        totalRevenue, totalExpense, checklist,
      };
    });
  }

  /**
   * Reverses a closing: mirror journal (if one was posted) + period reopened.
   * Never rewrites history — the closing and its reversal both remain in the ledger.
   */
  async reverseClose(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب العكس إلزامي — اذكر سبب إعادة فتح الفترة');
    return this.db.transaction(async (client) => {
      // FOR UPDATE — two concurrent reversals of the same period must serialize;
      // the loser sees is_closed=false and is refused.
      const period = await this.periodByIdForBranch(client, id, branchId, true);
      if (!period.is_closed) throw new BadRequestException(`الفترة «${period.name}» ليست مقفلة`);
      if (period.manual_lock) {
        throw new BadRequestException(`الفترة «${period.name}» مقفولة إداريًا — أزل القفلة الإدارية قبل عكس الإقفال`);
      }
      const entryId = period.closing_entry_id ? Number(period.closing_entry_id) : null;
      const reverseDate = asIsoDate(period.end_date) ?? asIsoDate(new Date().toISOString().slice(0, 10))!;
      // Reopen FIRST: the mirror journal must be dated INSIDE the period it reverses.
      // A reversal dated outside the period leaves the period's window without the
      // mirror, and a re-close would drop the period result out of RETAINED_EARNINGS.
      await client.query(
        `UPDATE periods SET is_closed = false, closed_at = NULL, closed_by = NULL,
                closing_entry_id = NULL, net_income = NULL
          WHERE period_id = $1::int`,
        [period.period_id],
      );
      if (!entryId) {
        await logActivity(client, { userId: user.userId, branchId, action: 'period.reverse_close',
          entity: 'period', entityId: String(period.period_id),
          details: `عكس إقفال «${period.name}» (بلا قيد) — ${reason}`, ip });
        return { periodId: period.period_id, isClosed: false, reverseJournalId: null, reason };
      }
      const reverseJournalId = await reverseJournal(client, entryId, {
        userId: user.userId, date: reverseDate,
        description: `عكس إقفال «${period.name}» — ${reason}`,
        journalType: 6,
      });
      await logActivity(client, { userId: user.userId, branchId, action: 'period.reverse_close',
        entity: 'period', entityId: String(period.period_id),
        details: `عكس إقفال «${period.name}» — ${reverseJournalId ? `قيد عكسي #${reverseJournalId}` : 'بلا قيد'} — ${reason}`, ip });
      return { periodId: period.period_id, isClosed: false, reverseJournalId, reason };
    });
  }

  /** Read-only closing report: period row + checklist + the closing journal (if any). */
  async periodCloseReport(id: number, branchId: number) {
    const period = await this.db.one<any>(
      `SELECT p.period_id AS "periodId", p.name, p.start_date AS "startDate", p.end_date AS "endDate",
              p.is_closed AS "isClosed", p.closed_at AS "closedAt", p.net_income AS "netIncome",
              p.closing_entry_id AS "closingEntryId", p.notes, u.full_name AS "closedBy",
              p.manual_lock AS "manualLock", p.manual_lock_at AS "manualLockAt", p.manual_lock_reason AS "manualLockReason",
              l.full_name AS "manualLockedBy"
         FROM periods p LEFT JOIN users u ON u.user_id = p.closed_by
              LEFT JOIN users l ON l.user_id = p.manual_lock_by
        WHERE p.period_id = $1::int AND p.branch_id = $2::int`,
      [id, branchId],
    );
    if (!period) throw new BadRequestException('الفترة غير موجودة');
    const checks = await this.db.query<any>(
      `SELECT check_code AS "checkCode", check_label AS "checkLabel", status, details, checked_at AS "checkedAt"
         FROM period_close_checks WHERE period_id = $1::int ORDER BY check_id`,
      [id],
    );
    const overrides = await this.db.query<any>(
      `SELECT o.override_id AS "overrideId", o.check_code AS "checkCode", o.due_key AS "dueKey",
              o.due_label AS "dueLabel", o.due_amount::numeric AS "dueAmount", o.reason,
              o.created_at AS "createdAt", u.full_name AS "overriddenBy"
         FROM period_close_overrides o JOIN users u ON u.user_id = o.created_by
        WHERE o.period_id = $1::int ORDER BY o.created_at ASC, o.override_id ASC`,
      [id],
    );
    const closingJournal = period.closingEntryId
      ? await this.journal(Number(period.closingEntryId))
      : null;
    return {
      period,
      checks: checks.map((c) => ({ ...c, statusName: c.status === 2 ? 'ناجح' : c.status === 3 ? 'فاشل' : c.status === 4 ? 'مستثنى بقرار' : 'معلق' })),
      closingJournal,
      overrides,
    };
  }

  // ------------------------------------------------------------------ //
  //  Year-end closing
  // ------------------------------------------------------------------ //
  /**
   * Closes the books for a year: revenue and expense accounts are zeroed
   * and the result is transferred to retained earnings.
   */
  async closeYear(body: { year?: number; asOf?: string }, user: AuthUser, branchId: number, ip: string) {
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

      await logActivity(client, { userId: user.userId, branchId, action: 'gl.year.close',
        entity: 'gl_journal', entityId: String(journalId), details: `إقفال السنة ${year} — ربح ${netProfit}`, ip });

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
    await assertDeletionAllowed(this.db, 'accountingRecurring');
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
              i.invoice_type AS "invoiceType", i.party_id AS "partyId", i.total_amount AS "totalAmount",
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
    // Presentation follows the *account type's* natural side, not each account's
    // `normal_side`. A contra account (e.g. accumulated depreciation 1202, an
    // ASSET that grows on the credit side) must show as a negative amount inside
    // its section; flipping it by `normal_side` added it back as a positive asset
    // and broke A = L + E + profit by exactly twice its balance.
    const pick = (type: number) => rows
      .filter((row: any) => Number(row.accountType) === type)
      .map((row: any) => {
        const net = Number(row.debit) - Number(row.credit);
        const debitNatural = type === ACCOUNT_TYPE.ASSET || type === ACCOUNT_TYPE.EXPENSE;
        return {
          accountId: Number(row.accountId), code: row.code, name: row.name,
          amount: Math.round((debitNatural ? net : -net) * 100) / 100,
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

  // ------------------------------------------------------------------ //
  //  GL-10 — Budgets (v1: base currency, revenue + expense only)
  // ------------------------------------------------------------------ //
  private async baseCurrency(client: PoolClient, requested?: string | null): Promise<string> {
    const row = await client.query<{ currency_code: string }>(
      `SELECT currency_code FROM currencies WHERE is_base = true ORDER BY currency_code LIMIT 1`,
    );
    const base = row.rows[0]?.currency_code ?? 'EGP';
    const wanted = String(requested ?? base).trim().toUpperCase();
    if (wanted !== String(base).toUpperCase()) {
      throw new BadRequestException('الموازنات بالعملة الأجنبية غير مدعومة في v1');
    }
    return base;
  }

  /**
   * Budget lines are revenue (type 4) or expense (type 5) only, on postable
   * (non-group) accounts, month 1..12, non-negative, with no duplicate key.
   */
  private async validateBudgetLines(client: PoolClient, lines: any[]) {
    if (!Array.isArray(lines) || !lines.length) {
      throw new BadRequestException('الموازنة تحتاج بندًا واحدًا على الأقل');
    }
    const accountIds = [...new Set(lines.map((l) => Number(l.accountId)))];
    if (accountIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('بند الموازنة بلا حساب صحيح');
    }
    const accounts = await client.query<any>(
      `SELECT account_id, code, account_type, is_group FROM gl_accounts WHERE account_id = ANY($1::int[])`,
      [accountIds],
    );
    const byId = new Map(accounts.rows.map((r: any) => [Number(r.account_id), r]));

    const ccIds = [...new Set(
      lines.map((l) => (l.costCenterId == null || l.costCenterId === '' ? null : Number(l.costCenterId)))
        .filter((v): v is number => v != null),
    )];
    if (ccIds.length) {
      const cc = await client.query<any>(
        `SELECT cost_center_id FROM cost_centers WHERE cost_center_id = ANY($1::int[])`, [ccIds],
      );
      const found = new Set(cc.rows.map((r: any) => Number(r.cost_center_id)));
      const missing = ccIds.filter((id) => !found.has(Number(id)));
      if (missing.length) throw new BadRequestException(`مركز تكلفة غير موجود: ${missing.join(', ')}`);
    }

    const seen = new Set<string>();
    const clean: { accountId: number; costCenterId: number | null; periodMonth: number; plannedAmount: number }[] = [];
    for (const line of lines) {
      const accountId = Number(line.accountId);
      const account = byId.get(accountId);
      if (!account) throw new BadRequestException(`الحساب ${accountId} غير موجود`);
      if (Number(account.account_type) !== ACCOUNT_TYPE.REVENUE && Number(account.account_type) !== ACCOUNT_TYPE.EXPENSE) {
        throw new BadRequestException(`الحساب ${account.code}: الموازنات مسموحة للإيرادات والمصروفات فقط`);
      }
      if (account.is_group) {
        throw new BadRequestException(`الحساب ${account.code} تجميعي — اختر حسابًا قابلًا للترحيل`);
      }
      const periodMonth = Number(line.periodMonth);
      if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
        throw new BadRequestException('شهر الموازنة يجب أن يكون بين 1 و12');
      }
      const plannedAmount = Number(line.plannedAmount ?? 0);
      if (!Number.isFinite(plannedAmount) || plannedAmount < 0) {
        throw new BadRequestException('المبلغ المخطط لا يمكن أن يكون سالبًا');
      }
      const costCenterId = line.costCenterId == null || line.costCenterId === '' ? null : Number(line.costCenterId);
      const key = `${accountId}|${costCenterId ?? 'N'}|${periodMonth}`;
      if (seen.has(key)) {
        throw new BadRequestException(`بند مكرر: الحساب ${account.code} — شهر ${periodMonth}`);
      }
      seen.add(key);
      clean.push({ accountId, costCenterId, periodMonth, plannedAmount: round2(plannedAmount) });
    }
    return clean;
  }

  private async insertBudgetLines(client: PoolClient, budgetId: number, lines: any[]) {
    for (const line of lines) {
      await client.query(
        `INSERT INTO budget_lines (budget_id, account_id, cost_center_id, period_month, planned_amount)
         VALUES ($1::bigint,$2::int,$3::int,$4::smallint,$5::numeric)`,
        [budgetId, line.accountId, line.costCenterId, line.periodMonth, line.plannedAmount],
      );
    }
  }

  async listBudgets(params: { branchId: number; year?: number; status?: number }) {
    return this.db.query<any>(
      `SELECT b.budget_id AS "budgetId", b.branch_id AS "branchId", b.year, b.name, b.status,
              b.currency_code AS "currencyCode",
              b.created_by AS "createdBy", cu.full_name AS "createdByName",
              b.approved_by AS "approvedBy", au.full_name AS "approvedByName",
              b.approved_at AS "approvedAt",
              b.same_user_approval_reason AS "sameUserApprovalReason",
              b.closed_by AS "closedBy", b.closed_at AS "closedAt",
              b.supersedes_id AS "supersedesId", b.superseded_by AS "supersededBy",
              (SELECT COALESCE(SUM(planned_amount), 0) FROM budget_lines WHERE budget_id = b.budget_id) AS "plannedTotal"
         FROM budgets b
         LEFT JOIN users cu ON cu.user_id = b.created_by
         LEFT JOIN users au ON au.user_id = b.approved_by
        WHERE b.branch_id = $1::int
          AND ($2::int = 0 OR b.year = $2::int)
          AND ($3::int = 0 OR b.status = $3::int)
        ORDER BY b.year DESC, b.budget_id DESC`,
      [params.branchId, params.year ?? 0, params.status ?? 0],
    );
  }

  async getBudget(id: number) {
    const header = await this.db.query<any>(
      `SELECT b.budget_id AS "budgetId", b.branch_id AS "branchId", b.year, b.name, b.status,
              b.currency_code AS "currencyCode", b.notes,
              b.created_by AS "createdBy", cu.full_name AS "createdByName",
              b.approved_by AS "approvedBy", au.full_name AS "approvedByName",
              b.approved_at AS "approvedAt",
              b.same_user_approval_reason AS "sameUserApprovalReason",
              b.closed_by AS "closedBy", b.closed_at AS "closedAt",
              b.supersedes_id AS "supersedesId", b.superseded_by AS "supersededBy",
              b.created_at AS "createdAt"
         FROM budgets b
         LEFT JOIN users cu ON cu.user_id = b.created_by
         LEFT JOIN users au ON au.user_id = b.approved_by
        WHERE b.budget_id = $1::bigint`,
      [id],
    );
    if (!header.length) throw new BadRequestException('الموازنة غير موجودة');
    const lines = await this.db.query<any>(
      `SELECT bl.line_id AS "lineId", bl.account_id AS "accountId",
              a.code AS "accountCode", a.name AS "accountName",
              a.account_type AS "accountType",
              bl.cost_center_id AS "costCenterId", cc.name AS "costCenterName",
              bl.period_month AS "periodMonth", bl.planned_amount AS "plannedAmount"
         FROM budget_lines bl
         JOIN gl_accounts a ON a.account_id = bl.account_id
         LEFT JOIN cost_centers cc ON cc.cost_center_id = bl.cost_center_id
        WHERE bl.budget_id = $1::bigint
        ORDER BY bl.period_month, a.code, bl.cost_center_id NULLS FIRST`,
      [id],
    );
    const plannedTotal = round2(lines.reduce((sum: number, l: any) => sum + Number(l.plannedAmount), 0));
    return { ...header[0], lines, plannedTotal };
  }

  async createBudget(dto: any, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const name = String(dto.name ?? '').trim();
      if (!name) throw new BadRequestException('اسم الموازنة مطلوب');
      const year = Number(dto.year);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) {
        throw new BadRequestException('سنة الموازنة يجب أن تكون بين 2020 و2100');
      }
      const currency = await this.baseCurrency(client, dto.currencyCode);
      const lines = await this.validateBudgetLines(client, dto.lines);
      const dup = await client.query<any>(
        `SELECT 1 FROM budgets WHERE branch_id = $1::int AND year = $2::int AND name = $3::text`,
        [branchId, year, name],
      );
      if (dup.rows.length) throw new BadRequestException('توجد موازنة بنفس الاسم لنفس الفرع والسنة');
      const ins = await client.query<{ budget_id: number }>(
        `INSERT INTO budgets (branch_id, year, name, status, currency_code, created_by, notes)
         VALUES ($1::int,$2::int,$3::text,1,$4::text,$5::int,$6::text)
         RETURNING budget_id`,
        [branchId, year, name, currency, user.userId, dto.notes ?? null],
      );
      const budgetId = Number(ins.rows[0].budget_id);
      await this.insertBudgetLines(client, budgetId, lines);
      await logActivity(client, { userId: user.userId, branchId, action: 'budget.create',
        entity: 'budget', entityId: String(budgetId), details: `إنشاء موازنة ${year} — ${name} (${lines.length} بندًا)`, ip });
      return { budgetId, status: 1, lines: lines.length };
    });
  }

  async updateBudget(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const cur = await client.query<any>(
        `SELECT budget_id, status, created_by FROM budgets
          WHERE budget_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!cur.rows.length) throw new BadRequestException('الموازنة غير موجودة');
      const status = Number(cur.rows[0].status);
      if (status === 2) throw new BadRequestException('لا يمكن تعديل موازنة معتمدة، استخدم revise');
      if (status !== 1) throw new BadRequestException('لا يمكن تعديل موازنة مغلقة أو مستبدلة');

      if (dto.name !== undefined) {
        const name = String(dto.name).trim();
        if (!name) throw new BadRequestException('اسم الموازنة مطلوب');
        const dup = await client.query<any>(
          `SELECT 1 FROM budgets WHERE branch_id = $1::int AND year = (SELECT year FROM budgets WHERE budget_id = $2::bigint)
             AND name = $3::text AND budget_id <> $2::bigint`,
          [branchId, id, name],
        );
        if (dup.rows.length) throw new BadRequestException('توجد موازنة بنفس الاسم لنفس الفرع والسنة');
        await client.query(`UPDATE budgets SET name = $2::text WHERE budget_id = $1::bigint`, [id, name]);
      }
      if (dto.notes !== undefined) {
        await client.query(`UPDATE budgets SET notes = $2::text WHERE budget_id = $1::bigint`, [id, dto.notes ?? null]);
      }
      if (dto.lines !== undefined) {
        const lines = await this.validateBudgetLines(client, dto.lines);
        await client.query('DELETE FROM budget_lines WHERE budget_id = $1::bigint', [id]);
        await this.insertBudgetLines(client, id, lines);
      }
      await logActivity(client, { userId: user.userId, branchId, action: 'budget.update',
        entity: 'budget', entityId: String(id), details: 'تعديل موازنة مسودة', ip });
      return { budgetId: id, status };
    });
  }

  async approveBudget(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const cur = await client.query<any>(
        `SELECT budget_id, status, created_by FROM budgets
          WHERE budget_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!cur.rows.length) throw new BadRequestException('الموازنة غير موجودة');
      if (Number(cur.rows[0].status) !== 1) {
        throw new BadRequestException('يمكن اعتماد الموازنة في حالة المسودة فقط');
      }
      const createdBy = Number(cur.rows[0].created_by);
      const reason = String(dto?.sameUserApprovalReason ?? '').trim();
      if (createdBy === user.userId && !reason) {
        throw new BadRequestException('اعتماد المُنشئ لموازنته يتطلب سببًا إلزاميًا (sameUserApprovalReason)');
      }
      const lineCount = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM budget_lines WHERE budget_id = $1::bigint`, [id],
      );
      if (!Number(lineCount.rows[0].c)) throw new BadRequestException('لا يمكن اعتماد موازنة بلا بنود');

      await client.query(
        `UPDATE budgets
            SET status = 2, approved_by = $2::int, approved_at = now(),
                same_user_approval_reason = $3::text
          WHERE budget_id = $1::bigint`,
        [id, user.userId, createdBy === user.userId ? reason : (reason || null)],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'budget.approve',
        entity: 'budget', entityId: String(id),
        details: createdBy === user.userId ? `اعتماد ذاتي — ${reason}` : 'اعتماد موازنة', ip });
      return {
        budgetId: id, status: 2, approvedBy: user.userId, createdBy,
        sameUserApprovalReason: createdBy === user.userId ? reason : null,
      };
    });
  }

  async closeBudget(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const cur = await client.query<any>(
        `SELECT budget_id, status FROM budgets
          WHERE budget_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!cur.rows.length) throw new BadRequestException('الموازنة غير موجودة');
      if (Number(cur.rows[0].status) !== 2) {
        throw new BadRequestException('يمكن إغلاق موازنة معتمدة فقط');
      }
      await client.query(
        `UPDATE budgets SET status = 3, closed_by = $2::int, closed_at = now()
          WHERE budget_id = $1::bigint`,
        [id, user.userId],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'budget.close',
        entity: 'budget', entityId: String(id),
        details: dto?.reason ? `إغلاق موازنة — ${String(dto.reason).trim()}` : 'إغلاق موازنة', ip });
      return { budgetId: id, status: 3 };
    });
  }

  /** Approved budgets are never edited in place: a revision is a new draft. */
  async reviseBudget(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const cur = await client.query<any>(
        `SELECT * FROM budgets WHERE budget_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!cur.rows.length) throw new BadRequestException('الموازنة غير موجودة');
      const old = cur.rows[0];
      if (Number(old.status) !== 2) throw new BadRequestException('يمكن مراجعة موازنة معتمدة فقط');
      if (old.superseded_by) throw new BadRequestException('الموازنة مستبدلة بالفعل');

      const baseName = String(old.name).replace(/ \(إصدار \d+\)$/, '');
      const chain = await client.query<{ c: number }>(
        `SELECT count(*)::int AS c FROM budgets
          WHERE branch_id = $1::int AND year = $2::int
            AND (name = $3::text OR name LIKE $3::text || ' (إصدار %')`,
        [old.branch_id, old.year, baseName],
      );
      const requested = String(dto?.name ?? '').trim();
      const name = requested || `${baseName} (إصدار ${Number(chain.rows[0].c) + 1})`;

      const ins = await client.query<{ budget_id: number }>(
        `INSERT INTO budgets
           (branch_id, year, name, status, currency_code, created_by, notes, supersedes_id)
         VALUES ($1::int,$2::int,$3::text,1,$4::text,$5::int,$6::text,$7::bigint)
         RETURNING budget_id`,
        [old.branch_id, old.year, name, old.currency_code, user.userId,
          dto?.notes ?? old.notes ?? null, id],
      );
      const newId = Number(ins.rows[0].budget_id);

      if (Array.isArray(dto?.lines) && dto.lines.length) {
        const lines = await this.validateBudgetLines(client, dto.lines);
        await this.insertBudgetLines(client, newId, lines);
      } else {
        await client.query(
          `INSERT INTO budget_lines (budget_id, account_id, cost_center_id, period_month, planned_amount)
           SELECT $2::bigint, account_id, cost_center_id, period_month, planned_amount
             FROM budget_lines WHERE budget_id = $1::bigint`,
          [id, newId],
        );
      }
      await client.query(
        `UPDATE budgets SET status = 4, superseded_by = $2::bigint WHERE budget_id = $1::bigint`,
        [id, newId],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'budget.revise',
        entity: 'budget', entityId: String(newId), details: `مراجعة موازنة — يستبدل #${id}`, ip });
      return { budgetId: newId, supersedesId: id, supersededStatus: 4 };
    });
  }

  async budgetVsActual(params: { budgetId: number; branchId: number; month?: number }) {
    const header = await this.db.query<any>(
      `SELECT budget_id AS "budgetId", branch_id AS "branchId", year, name, status,
              currency_code AS "currencyCode"
         FROM budgets WHERE budget_id = $1::bigint`,
      [params.budgetId],
    );
    if (!header.length) throw new BadRequestException('الموازنة غير موجودة');
    const budget = header[0];
    if (Number(budget.branchId) !== Number(params.branchId)) {
      throw new BadRequestException('الموازنة تتبع فرعًا آخر');
    }
    const rows = await this.db.query<any>(
      `SELECT v.line_id AS "lineId", v.account_id AS "accountId",
              v.account_code AS "accountCode", v.account_name AS "accountName",
              v.account_type AS "accountType",
              v.cost_center_id AS "costCenterId", cc.name AS "costCenterName",
              v.period_month AS "periodMonth",
              v.planned_amount AS "plannedAmount", v.actual_amount AS "actualAmount"
         FROM v_budget_actual v
         LEFT JOIN cost_centers cc ON cc.cost_center_id = v.cost_center_id
        WHERE v.budget_id = $1::bigint
          AND ($2::int = 0 OR v.period_month = $2::int)
        ORDER BY v.period_month, v.account_code, v.cost_center_id NULLS FIRST`,
      [params.budgetId, params.month ?? 0],
    );
    const lines = rows.map((r: any) => {
      const plannedAmount = round2(Number(r.plannedAmount));
      const actualAmount = round2(Number(r.actualAmount));
      const variance = round2(plannedAmount - actualAmount);
      return {
        ...r,
        plannedAmount,
        actualAmount,
        variance,
        variancePct: plannedAmount ? round2((variance / plannedAmount) * 100) : null,
        overBudget: variance < -0.005,
      };
    });
    const sum = (rows2: any[], key: 'plannedAmount' | 'actualAmount') =>
      round2(rows2.reduce((s: number, l: any) => s + l[key], 0));
    const allocated = lines.filter((l: any) => l.costCenterId != null);
    const unallocated = lines.filter((l: any) => l.costCenterId == null);
    const totals = {
      planned: sum(lines, 'plannedAmount'),
      actual: sum(lines, 'actualAmount'),
    };
    (totals as any).variance = round2(totals.planned - totals.actual);
    (totals as any).overBudgetLines = lines.filter((l: any) => l.overBudget).length;
    return {
      budget,
      month: params.month ?? null,
      lines,
      totals,
      allocated: { lines: allocated.length, planned: sum(allocated, 'plannedAmount'), actual: sum(allocated, 'actualAmount') },
      unallocated: { lines: unallocated.length, planned: sum(unallocated, 'plannedAmount'), actual: sum(unallocated, 'actualAmount') },
    };
  }

  /** Warning-only over-budget report. Never blocks posting. */
  async budgetAlerts(params: { branchId: number; year: number; month?: number }) {
    const rows = await this.db.query<any>(
      `SELECT b.budget_id AS "budgetId", b.name AS "budgetName", b.status, b.year,
              v.period_month AS "periodMonth",
              v.account_id AS "accountId", v.account_code AS "accountCode",
              v.account_name AS "accountName",
              v.cost_center_id AS "costCenterId", cc.name AS "costCenterName",
              v.planned_amount AS "plannedAmount", v.actual_amount AS "actualAmount"
         FROM v_budget_actual v
         JOIN budgets b ON b.budget_id = v.budget_id
         LEFT JOIN cost_centers cc ON cc.cost_center_id = v.cost_center_id
        WHERE b.branch_id = $1::int AND b.year = $2::int
          AND b.status IN (2, 3)
          AND ($3::int = 0 OR v.period_month = $3::int)
          AND v.actual_amount > v.planned_amount + 0.005
        ORDER BY v.period_month, v.account_code`,
      [params.branchId, params.year, params.month ?? 0],
    );
    return rows.map((r: any) => {
      const plannedAmount = round2(Number(r.plannedAmount));
      const actualAmount = round2(Number(r.actualAmount));
      return { ...r, plannedAmount, actualAmount, excess: round2(actualAmount - plannedAmount) };
    });
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
  createJournal(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.createJournal(dto, user, branchId, ip);
  }

  @RequirePermissions('accounting.post')
  @Post('journals/:id/post')
  postJournal(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.postJournalById(id, user, ip);
  }

  @RequirePermissions('accounting.post')
  @Post('journals/:id/void')
  voidJournal(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.voidJournalById(id, user, ip);
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
  async createVoucher(
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const result = await this.service.createVoucher(dto, user, branchId, ip);
    if (result?.duplicate) res.status(200);
    return result;
  }

  @RequirePermissions('accounting.post')
  @Post('vouchers/:id/cancel')
  cancelVoucher(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.cancelVoucher(id, user, ip);
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
  updateCheck(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.updateCheckStatus(id, dto, user, branchId);
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

  @RequirePermissions('periods.admin')
  @Post('periods/:id/manual-lock')
  manualLock(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.manualLock(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('periods.admin')
  @Post('periods/:id/manual-unlock')
  manualUnlock(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.manualUnlock(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.close')
  @Post('periods/:id/preclose-check')
  preCloseCheck(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.preCloseCheck(id, user, branchId, ip);
  }

  @RequirePermissions('accounting.close')
  @Post('periods/:id/close-month')
  closeMonth(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.closeMonth(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.close')
  @Post('periods/:id/reverse-close')
  reverseClose(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.reverseClose(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.view')
  @Get('periods/:id/close-report')
  periodCloseReport(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.periodCloseReport(id, branchId);
  }

  // ---- year end ------------------------------------------------------ //
  @RequirePermissions('accounting.close')
  @Post('close-year')
  closeYear(@Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.closeYear(body ?? {}, user, branchId, ip);
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

  // ---- GL-10 budgets ------------------------------------------------ //
  @RequirePermissions('accounting.view')
  @Get('budgets')
  listBudgets(
    @Query('year') year: string,
    @Query('status') status: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listBudgets({
      branchId,
      year: year ? Number(year) : undefined,
      status: status ? Number(status) : undefined,
    });
  }

  @RequirePermissions('accounting.view')
  @Get('budgets/:id')
  getBudget(@Param('id', ParseIntPipe) id: number) {
    return this.service.getBudget(id);
  }

  @RequirePermissions('accounting.manage')
  @Post('budgets')
  createBudget(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.createBudget(dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.manage')
  @Patch('budgets/:id')
  updateBudget(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.updateBudget(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.approve_budget')
  @Post('budgets/:id/approve')
  approveBudget(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.approveBudget(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.close_budget')
  @Post('budgets/:id/close')
  closeBudget(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.closeBudget(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.manage')
  @Post('budgets/:id/revise')
  reviseBudget(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.reviseBudget(id, dto ?? {}, user, branchId, ip);
  }

  @RequirePermissions('accounting.view')
  @Get('reports/budget-vs-actual')
  async budgetVsActual(
    @Query('budget_id') budgetId: string,
    @Query('month') month: string,
    @Query('format') format: string,
    @CurrentBranch() branchId: number,
  ) {
    const report = await this.service.budgetVsActual({
      budgetId: Number(budgetId),
      branchId,
      month: month ? Number(month) : undefined,
    });
    if (String(format).toLowerCase() === 'csv') {
      const cell = (v: any) => {
        const s = v == null ? '' : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['الشهر', 'الكود', 'الحساب', 'النوع', 'مركز التكلفة', 'المخطط', 'الفعلي', 'الفرق', 'النسبة %', 'تجاوز'];
      const typeName = (t: number) => (Number(t) === 4 ? 'إيراد' : 'مصروف');
      const rows = report.lines.map((l: any) => [
        l.periodMonth, l.accountCode, l.accountName, typeName(l.accountType),
        l.costCenterName ?? 'غير موزّع', l.plannedAmount, l.actualAmount, l.variance,
        l.variancePct ?? '', l.overBudget ? 'نعم' : 'لا',
      ]);
      const totalsRow = ['', '', 'الإجمالي', '', '', report.totals.planned, report.totals.actual,
        (report.totals as any).variance, '', (report.totals as any).overBudgetLines];
      const csv = [header, ...rows, totalsRow].map((r) => r.map(cell).join(',')).join('\r\n');
      return {
        fileName: `budget-vs-actual-${report.budget.budgetId}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        base64: Buffer.from('\uFEFF' + csv, 'utf-8').toString('base64'),
      };
    }
    return report;
  }

  @RequirePermissions('accounting.view')
  @Get('reports/budget-alerts')
  budgetAlerts(
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.budgetAlerts({
      branchId,
      year: year ? Number(year) : new Date().getFullYear(),
      month: month ? Number(month) : undefined,
    });
  }
}

@Module({
  controllers: [AccountingController],
  providers: [AccountingService],
  exports: [AccountingService],
})
export class AccountingModule {}
