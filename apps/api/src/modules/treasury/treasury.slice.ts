import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { getBooleanSetting } from '../../common/settings';
import { postCashJournal, postJournal, resolveMapping } from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

export interface CashTransactionInput {
  cashAccountId: number;
  direction: number;      // 1 in, 2 out
  categoryId?: number;
  amount: number;
  transactionDate?: string;
  description?: string;
  partyId?: number;
}

@Injectable()
export class TreasuryService {
  constructor(private readonly db: DatabaseService) {}

  async accounts(branchId: number) {
    return this.db.query(
      `SELECT c.cash_account_id AS "cashAccountId", c.branch_id AS "branchId", b.name AS "branchName",
              c.name, c.type, c.bank_name AS "bankName", c.account_no AS "accountNo",
              c.currency_code AS "currencyCode", c.is_active AS "isActive", c.notes,
              c.gl_account_id AS "glAccountId", a.code AS "glAccountCode", a.name AS "glAccountName",
              c.opening_balance + COALESCE((
                SELECT SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE -t.amount END)
                  FROM cash_transactions t WHERE t.cash_account_id = c.cash_account_id), 0) AS balance
         FROM cash_accounts c JOIN branches b ON b.branch_id = c.branch_id
         LEFT JOIN gl_accounts a ON a.account_id = c.gl_account_id
        WHERE ($1::int = 0 OR c.branch_id = $1)
        ORDER BY c.cash_account_id`,
      [branchId],
    );
  }

  async categories() {
    return this.db.query(
      `SELECT cash_category_id AS "categoryId", name, direction FROM cash_categories ORDER BY direction, name`,
    );
  }

  /** Creates a cash account (drawer, bank, card settlement, wallet…). */
  async createAccount(dto: any, user: AuthUser, branchId: number) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم الحساب مطلوب');
    const type = Number(dto.type ?? 1);
    if (![1, 2, 3, 4].includes(type)) throw new BadRequestException('نوع الحساب غير صحيح');

    return this.db.transaction(async (client) => {
      const glAccountId = dto.glAccountId ? Number(dto.glAccountId) : null;
      if (glAccountId) {
        const account = await client.query(
          'SELECT account_id FROM gl_accounts WHERE account_id = $1::int',
          [glAccountId],
        );
        if (!account.rows.length) throw new BadRequestException('الحساب المحاسبي غير موجود');
      }
      const inserted = await client.query<{ cash_account_id: number }>(
        `INSERT INTO cash_accounts
           (branch_id, name, type, account_no, bank_name, currency_code, opening_balance,
            is_active, notes, gl_account_id)
         VALUES ($1::int,$2,$3::int,$4,$5,$6,$7::numeric,$8,$9,$10::int)
         RETURNING cash_account_id`,
        [branchId, name, type, dto.accountNo ?? null, dto.bankName ?? null,
          dto.currencyCode ?? 'EGP', Number(dto.openingBalance ?? 0),
          dto.isActive !== false, dto.notes ?? null, glAccountId],
      );
      const accountId = Number(inserted.rows[0].cash_account_id);

      // An opening balance is money that enters the drawer: post it.
      const opening = Number(dto.openingBalance ?? 0);
      if (opening > 0) {
        await client.query(
          `INSERT INTO cash_transactions
             (branch_id, cash_account_id, direction, amount, transaction_date, description, created_by)
           VALUES ($1::int,$2::int,1,$3::numeric, now(), $4,$5::int)`,
          [branchId, accountId, opening, 'رصيد افتتاحي', user.userId],
        );
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2,'cash.account.create','cash_account',$3,$4)`,
        [user.userId, branchId, String(accountId), name],
      );
      return { cashAccountId: accountId };
    });
  }

  async updateAccount(id: number, dto: any) {
    const existing = await this.db.one<any>(
      'SELECT * FROM cash_accounts WHERE cash_account_id = $1::int',
      [id],
    );
    if (!existing) throw new BadRequestException('حساب الخزينة غير موجود');
    await this.db.query(
      `UPDATE cash_accounts SET name = $2, type = $3::int, account_no = $4, bank_name = $5,
              currency_code = $6, is_active = $7, notes = $8, gl_account_id = $9
        WHERE cash_account_id = $1::int`,
      [id, dto.name ?? existing.name, Number(dto.type ?? existing.type),
        dto.accountNo ?? existing.account_no, dto.bankName ?? existing.bank_name,
        dto.currencyCode ?? existing.currency_code,
        dto.isActive === undefined ? existing.is_active : !!dto.isActive,
        dto.notes ?? existing.notes,
        dto.glAccountId === undefined ? existing.gl_account_id : (dto.glAccountId ? Number(dto.glAccountId) : null)],
    );
    return { cashAccountId: id };
  }

  async deleteAccount(id: number) {
    const used = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM cash_transactions WHERE cash_account_id = $1::int',
      [id],
    );
    if (Number(used.c) > 0) {
      throw new BadRequestException('الحساب عليه حركات — لا يمكن حذفه');
    }
    await this.db.query('DELETE FROM cash_accounts WHERE cash_account_id = $1::int', [id]);
    return { cashAccountId: id, deleted: true };
  }

  async transactions(params: { accountId?: number; branchId: number; from?: string; to?: string; limit: number }) {
    return this.db.query(
      `SELECT t.cash_transaction_id AS "transactionId", t.transaction_date AS "transactionDate", t.direction,
              t.amount, t.description, c.name AS "cashAccountName", cat.name AS "categoryName",
              p.name AS "partyName", i.invoice_no AS "referenceNo", u.full_name AS "createdBy",
              t.shift_id AS "shiftId"
         FROM cash_transactions t
         JOIN cash_accounts c ON c.cash_account_id = t.cash_account_id
         LEFT JOIN cash_categories cat ON cat.cash_category_id = t.category_id
         LEFT JOIN parties p ON p.party_id = t.party_id
         LEFT JOIN invoices i ON i.invoice_id = t.invoice_id
         LEFT JOIN users u ON u.user_id = t.created_by
        WHERE ($1::int = 0 OR t.cash_account_id = $1)
          AND ($2::int = 0 OR t.branch_id = $2)
          AND ($3::date IS NULL OR t.transaction_date >= $3::date)
          AND ($4::date IS NULL OR t.transaction_date <= $4::date)
        ORDER BY t.transaction_date DESC, t.cash_transaction_id DESC LIMIT $5`,
      [params.accountId ?? 0, params.branchId, params.from ?? null, params.to ?? null, params.limit],
    );
  }

  async addTransaction(dto: CashTransactionInput, user: AuthUser, branchId: number) {
    if (!(Number(dto.amount) > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    return this.db.transaction(async (client) => {
      const requireShift = await getBooleanSetting(client, 'RequireCashierShift', false);
      const shift = await client.query<{ shift_id: number }>(
        `SELECT shift_id FROM shifts
          WHERE cashier_id = $1 AND cash_account_id = $2 AND status = 1
          ORDER BY opened_at DESC LIMIT 1`,
        [user.userId, dto.cashAccountId],
      );
      const shiftId = shift.rows.length ? Number(shift.rows[0].shift_id) : null;
      if (requireShift && user.isCashier && !shiftId) {
        throw new BadRequestException('يجب فتح وردية على هذا الحساب قبل تسجيل الحركة');
      }

      const result = await client.query<{ cash_transaction_id: number }>(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, category_id, amount, transaction_date, description,
            party_id, shift_id, created_by)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), $7, $8, $9, $10) RETURNING cash_transaction_id`,
        [branchId, dto.cashAccountId, dto.direction, dto.categoryId ?? null, Number(dto.amount),
          dto.transactionDate ?? null, dto.description ?? null, dto.partyId ?? null, shiftId, user.userId],
      );

      // Mirror the movement in the general ledger.
      const category = dto.categoryId
        ? await client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_categories WHERE cash_category_id = $1::int',
          [dto.categoryId],
        )
        : { rows: [] as any[] };
      await postCashJournal(client, {
        branchId,
        direction: Number(dto.direction),
        amount: Number(dto.amount),
        cashAccountId: Number(dto.cashAccountId),
        categoryAccountId: category.rows[0]?.gl_account_id ?? null,
        description: dto.description ?? (dto.direction === 1 ? 'إيداع نقدي' : 'سحب نقدي'),
        partyId: dto.partyId ?? null,
        userId: user.userId,
        sourceType: 'cash_transaction',
        sourceId: Number(result.rows[0].cash_transaction_id),
        journalDate: dto.transactionDate ? String(dto.transactionDate).slice(0, 10) : undefined,
      });

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'cash.transaction','cash_transaction',$3,$4)`,
        [user.userId, branchId, String(result.rows[0].cash_transaction_id),
          `${dto.direction === 1 ? 'إيداع' : 'سحب'} ${dto.amount}`],
      );
      return { transactionId: Number(result.rows[0].cash_transaction_id) };
    });
  }

  /** Moves money between two cash accounts as a paired in/out entry. */
  async transfer(body: { fromAccountId: number; toAccountId: number; amount: number; description?: string }, user: AuthUser, branchId: number) {
    if (!(Number(body.amount) > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');
    if (body.fromAccountId === body.toAccountId) throw new BadRequestException('لا يمكن التحويل لنفس الحساب');

    return this.db.transaction(async (client) => {
      const group = await this.db.nextNumber(client, `cashtransfer:${branchId}`);
      const insert = async (accountId: number, direction: number) => {
        const shift = await client.query<{ shift_id: number }>(
          `SELECT shift_id FROM shifts
            WHERE cashier_id = $1 AND cash_account_id = $2 AND status = 1
            ORDER BY opened_at DESC LIMIT 1`,
          [user.userId, accountId],
        );
        await client.query(
          `INSERT INTO cash_transactions
             (branch_id, cash_account_id, direction, amount, transaction_date, description, transfer_group_id,
              shift_id, created_by)
           VALUES ($1,$2,$3,$4, now(), $5, $6, $7, $8)`,
          [branchId, accountId, direction, Number(body.amount), body.description ?? 'تحويل بين الحسابات', group,
            shift.rows.length ? Number(shift.rows[0].shift_id) : null, user.userId],
        );
      };
      await insert(body.fromAccountId, 2);
      await insert(body.toAccountId, 1);

      // A transfer is a single balanced journal between the two accounts.
      const [from, to] = await Promise.all([
        client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
          [body.fromAccountId],
        ),
        client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
          [body.toAccountId],
        ),
      ]);
      const fromAccount = from.rows[0]?.gl_account_id ?? null;
      const toAccount = to.rows[0]?.gl_account_id ?? null;
      if (fromAccount && toAccount) {
        await postJournal(client, {
          branchId,
          journalType: 4,
          description: body.description ?? 'تحويل بين الحسابات',
          sourceType: 'cash_transfer',
          sourceId: group,
          lines: [
            { accountId: toAccount, debit: Number(body.amount), description: 'تحويل' },
            { accountId: fromAccount, credit: Number(body.amount), description: 'تحويل' },
          ],
          userId: user.userId,
        });
      }

      return { transferGroupId: group };
    });
  }

  // ------------------------------------------------------------------ //
  //  Cashier shifts
  // ------------------------------------------------------------------ //
  async currentShift(cashierId: number) {
    const shift = await this.db.one<any>(
      `SELECT s.shift_id AS "shiftId", s.branch_id AS "branchId", s.cash_account_id AS "cashAccountId",
              c.name AS "cashAccountName", s.shift_no AS "shiftNo", s.opened_at AS "openedAt",
              s.opening_balance AS "openingBalance", s.status,
              COALESCE((SELECT SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE 0 END)
                          FROM cash_transactions t WHERE t.shift_id = s.shift_id), 0) AS "cashIn",
              COALESCE((SELECT SUM(CASE WHEN t.direction = 2 THEN t.amount ELSE 0 END)
                          FROM cash_transactions t WHERE t.shift_id = s.shift_id), 0) AS "cashOut"
         FROM shifts s JOIN cash_accounts c ON c.cash_account_id = s.cash_account_id
        WHERE s.cashier_id = $1 AND s.status = 1 ORDER BY s.opened_at DESC LIMIT 1`,
      [cashierId],
    );
    if (!shift) return null;
    const expected = Number(shift.openingBalance) + Number(shift.cashIn) - Number(shift.cashOut);
    return { ...shift, expectedCash: expected };
  }

  async openShift(body: { cashAccountId: number; openingBalance?: number }, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const account = await client.query<{ branch_id: number }>(
        'SELECT branch_id FROM cash_accounts WHERE cash_account_id = $1 AND is_active = true',
        [body.cashAccountId],
      );
      if (!account.rows.length) throw new BadRequestException('حساب الخزينة غير موجود');
      if (Number(account.rows[0].branch_id) !== Number(branchId)) {
        throw new BadRequestException('حساب الخزينة لا يتبع الفرع الحالي');
      }

      const existing = await client.query(
        `SELECT shift_id FROM shifts
          WHERE status = 1 AND (cashier_id = $1 OR cash_account_id = $2) FOR UPDATE`,
        [user.userId, body.cashAccountId],
      );
      if (existing.rows.length) {
        throw new BadRequestException('يوجد وردية مفتوحة بالفعل لهذا المستخدم أو هذا الحساب');
      }

      const serial = await this.db.nextNumber(client, `shift:${branchId}`);
      const result = await client.query<any>(
        `INSERT INTO shifts (branch_id, cash_account_id, cashier_id, shift_no, opening_balance, status)
         VALUES ($1,$2,$3,$4,$5,1) RETURNING shift_id AS "shiftId", shift_no AS "shiftNo",
                                                         opening_balance AS "openingBalance"`,
        [branchId, body.cashAccountId, user.userId, serial, Number(body.openingBalance ?? 0)],
      );
      return result.rows[0];
    });
  }

  async closeShift(body: { countedCash?: number; notes?: string }, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const shiftResult = await client.query<any>(
        `SELECT s.*, c.name AS cash_account_name
           FROM shifts s JOIN cash_accounts c ON c.cash_account_id = s.cash_account_id
          WHERE s.cashier_id = $1 AND s.status = 1
          ORDER BY s.opened_at DESC LIMIT 1 FOR UPDATE`,
        [user.userId],
      );
      if (!shiftResult.rows.length) throw new BadRequestException('لا يوجد وردية مفتوحة');
      const shift = shiftResult.rows[0];

      // All cash movements tied to this shift, plus legacy rows that predate the shift link.
      const totals = await client.query<any>(
        `SELECT COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE -amount END), 0) AS net,
                COALESCE(SUM(CASE WHEN direction = 1 THEN amount ELSE 0 END), 0) AS cash_in,
                COALESCE(SUM(CASE WHEN direction = 2 THEN amount ELSE 0 END), 0) AS cash_out
           FROM cash_transactions
          WHERE shift_id = $1
             OR (shift_id IS NULL AND cash_account_id = $2 AND transaction_date >= $3)`,
        [shift.shift_id, shift.cash_account_id, shift.opened_at],
      );
      const net = Number(totals.rows[0]?.net ?? 0);
      const expectedTotal = Number(shift.opening_balance) + net;
      const counted = body.countedCash === undefined || body.countedCash === null
        ? expectedTotal
        : Number(body.countedCash);
      const difference = counted - expectedTotal;

      await client.query(
        `UPDATE shifts SET closed_at = now(), expected_cash = $2, counted_cash = $3, difference = $4,
                status = 2, notes = $5 WHERE shift_id = $1`,
        [shift.shift_id, expectedTotal, counted, difference, body.notes ?? null],
      );

      // Post the shortage / overage so the drawer balance matches the physical count.
      if (Math.abs(difference) > 0.004) {
        const isOverage = difference > 0;
        await client.query(
          `INSERT INTO cash_transactions
             (branch_id, cash_account_id, direction, amount, transaction_date, description, shift_id, created_by)
           VALUES ($1,$2,$3,$4, now(), $5, $6, $7)`,
          [
            branchId, shift.cash_account_id, isOverage ? 1 : 2, Math.abs(difference),
            isOverage ? 'زيادة في وردية الكاشير' : 'عجز في وردية الكاشير',
            shift.shift_id, user.userId,
          ],
        );

        // General ledger: a shortage is an expense, an overage is a credit.
        const cashGl = await client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
          [shift.cash_account_id],
        );
        const cashAccount = cashGl.rows[0]?.gl_account_id
          ?? (await resolveMapping(client, 'CASH'))?.accountId;
        if (cashAccount) {
          const diffAccount = await resolveMapping(client, 'CASH_DIFF');
          if (diffAccount) {
            const amount = Math.abs(difference);
            await postJournal(client, {
              branchId,
              journalType: 4,
              description: isOverage ? 'زيادة في وردية الكاشير' : 'عجز في وردية الكاشير',
              sourceType: 'shift',
              sourceId: Number(shift.shift_id),
              lines: isOverage
                ? [
                  { accountId: cashAccount, debit: amount, description: 'زيادة في وردية الكاشير' },
                  { accountId: diffAccount.accountId, credit: amount, description: 'زيادة في وردية الكاشير' },
                ]
                : [
                  { accountId: diffAccount.accountId, debit: amount, description: 'عجز في وردية الكاشير' },
                  { accountId: cashAccount, credit: amount, description: 'عجز في وردية الكاشير' },
                ],
              userId: user.userId,
            });
          }
        }
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'shift.close','shift',$3,$4)`,
        [user.userId, branchId, String(shift.shift_id),
          `إغلاق وردية ${shift.shift_no}: متوقع ${expectedTotal} / فعلي ${counted}`],
      );

      return {
        shiftId: Number(shift.shift_id),
        shiftNo: Number(shift.shift_no),
        openingBalance: Number(shift.opening_balance),
        cashIn: Number(totals.rows[0]?.cash_in ?? 0),
        cashOut: Number(totals.rows[0]?.cash_out ?? 0),
        expectedCash: expectedTotal,
        countedCash: counted,
        difference,
      };
    });
  }

  /** Whether the POS must have an open cashier shift before selling. */
  async shiftPolicy() {
    const row = await this.db.one<{ setting_value: string | null }>(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'RequireCashierShift'`,
    );
    return { requireShift: row?.setting_value === 'true' || row?.setting_value === '1' };
  }

  async listShifts(branchId: number, limit = 50) {
    return this.db.query(
      `SELECT s.shift_id AS "shiftId", s.shift_no AS "shiftNo", s.opened_at AS "openedAt",
              s.closed_at AS "closedAt", s.opening_balance AS "openingBalance",
              s.expected_cash AS "expectedCash", s.counted_cash AS "countedCash",
              s.difference, s.status, s.notes, c.name AS "cashAccountName", u.full_name AS "cashierName"
         FROM shifts s
         JOIN cash_accounts c ON c.cash_account_id = s.cash_account_id
         JOIN users u ON u.user_id = s.cashier_id
        WHERE ($1::int = 0 OR s.branch_id = $1)
        ORDER BY s.opened_at DESC LIMIT $2`,
      [branchId, limit],
    );
  }

  async shiftSummary(id: number) {
    const shift = await this.db.one<any>(
      `SELECT s.shift_id AS "shiftId", s.shift_no AS "shiftNo", s.branch_id AS "branchId",
              s.cash_account_id AS "cashAccountId",
              s.opened_at AS "openedAt", s.closed_at AS "closedAt", s.opening_balance AS "openingBalance",
              s.expected_cash AS "expectedCash", s.counted_cash AS "countedCash", s.difference,
              s.status, s.notes, c.name AS "cashAccountName", u.full_name AS "cashierName"
         FROM shifts s
         JOIN cash_accounts c ON c.cash_account_id = s.cash_account_id
         JOIN users u ON u.user_id = s.cashier_id
        WHERE s.shift_id = $1`,
      [id],
    );
    if (!shift) return null;

    const rows = await this.db.query(
      `SELECT t.cash_transaction_id AS "transactionId", t.transaction_date AS "transactionDate",
              t.direction, t.amount, t.description, i.invoice_no AS "referenceNo"
         FROM cash_transactions t
         LEFT JOIN invoices i ON i.invoice_id = t.invoice_id
        WHERE t.shift_id = $1
           OR (t.shift_id IS NULL AND t.cash_account_id = $2 AND t.transaction_date >= $3
               AND ($4::timestamptz IS NULL OR t.transaction_date <= $4::timestamptz))
        ORDER BY t.transaction_date, t.cash_transaction_id`,
      [id, shift.cashAccountId, shift.openedAt, shift.closedAt],
    );

    const cashIn = rows
      .filter((row: any) => Number(row.direction) === 1)
      .reduce((sum: number, row: any) => sum + Number(row.amount), 0);
    const cashOut = rows
      .filter((row: any) => Number(row.direction) === 2)
      .reduce((sum: number, row: any) => sum + Number(row.amount), 0);

    return { shift, transactions: rows, cashIn, cashOut };
  }
}

@Controller('treasury')
export class TreasuryController {
  constructor(private readonly service: TreasuryService) {}

  @RequirePermissions('cash.view')
  @Get('accounts')
  accounts(@CurrentBranch() branchId: number) {
    return this.service.accounts(branchId);
  }

  @RequirePermissions('cash.manage')
  @Post('accounts')
  createAccount(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createAccount(dto, user, branchId);
  }

  @RequirePermissions('cash.manage')
  @Put('accounts/:id')
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateAccount(id, dto);
  }

  @RequirePermissions('cash.manage')
  @Delete('accounts/:id')
  deleteAccount(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteAccount(id);
  }

  @RequirePermissions('cash.view')
  @Get('categories')
  categories() {
    return this.service.categories();
  }

  @RequirePermissions('cash.view')
  @Get('transactions')
  transactions(
    @Query('accountId') accountId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.transactions({
      accountId: accountId ? Number(accountId) : undefined,
      branchId, from, to,
      limit: Math.min(Number(limit) || 100, 1000),
    });
  }

  @RequirePermissions('cash.manage')
  @Post('transactions')
  addTransaction(@Body() dto: CashTransactionInput, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.addTransaction(dto, user, branchId);
  }

  @RequirePermissions('cash.manage')
  @Post('transfer')
  transfer(@Body() body: { fromAccountId: number; toAccountId: number; amount: number; description?: string },
    @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.transfer(body, user, branchId);
  }

  @RequirePermissions('cash.view')
  @Get('shifts')
  listShifts(@CurrentBranch() branchId: number, @Query('limit') limit: string) {
    return this.service.listShifts(branchId, Math.min(Number(limit) || 50, 200));
  }

  @RequirePermissions('cash.view')
  @Get('shifts/current')
  currentShift(@CurrentUser() user: AuthUser) {
    return this.service.currentShift(user.userId);
  }

  @RequirePermissions('cash.view')
  @Get('shifts/policy')
  shiftPolicy() {
    return this.service.shiftPolicy();
  }

  @RequirePermissions('cash.view')
  @Get('shifts/:id')
  shiftSummary(@Param('id', ParseIntPipe) id: number) {
    return this.service.shiftSummary(id);
  }

  @RequirePermissions('cash.manage')
  @Post('shifts/open')
  openShift(@Body() body: { cashAccountId: number; openingBalance?: number }, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.openShift(body, user, branchId);
  }

  @RequirePermissions('cash.manage')
  @Post('shifts/close')
  closeShift(@Body() body: { countedCash?: number; notes?: string }, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.closeShift(body, user, branchId);
  }
}

@Module({
  controllers: [TreasuryController],
  providers: [TreasuryService],
  exports: [TreasuryService],
})
export class TreasuryModule {}
