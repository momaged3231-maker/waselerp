import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/security';
import { postJournal, requireMapping, resolveMapping } from '../../common/posting';

const STATUS: Record<number, string> = { 1: 'تحت التحصيل', 2: 'محصّل', 3: 'مرتد', 4: 'ملغي' };
const DIR: Record<number, string> = { 1: 'قبض (وارد)', 2: 'صرف (صادر)' };

@Injectable()
export class ChecksService {
  constructor(private readonly db: DatabaseService) {}

  async list(branchId: number, q?: { status?: number; direction?: number; search?: string; from?: string; to?: string }) {
    const status = q?.status ? Number(q.status) : 0;
    const direction = q?.direction ? Number(q.direction) : 0;
    const search = String(q?.search ?? '').trim();
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT c.check_id AS "checkId", c.direction, c.check_no AS "checkNo", c.bank_name AS "bankName",
              c.amount, c.due_date AS "dueDate", c.status, c.notes, c.created_at AS "createdAt",
              c.party_id AS "partyId", p.name AS "partyName",
              c.cash_account_id AS "cashAccountId", a.name AS "cashAccountName",
              c.voucher_id AS "voucherId", u.full_name AS "createdBy"
         FROM checks c
         LEFT JOIN parties p ON p.party_id = c.party_id
         LEFT JOIN cash_accounts a ON a.cash_account_id = c.cash_account_id
         LEFT JOIN users u ON u.user_id = c.created_by
        WHERE c.branch_id = $1::int
          AND ($2::int = 0 OR c.status = $2::int)
          AND ($3::int = 0 OR c.direction = $3::int)
          AND ($4::text = '' OR c.check_no ILIKE $5::text OR COALESCE(p.name,'') ILIKE $5::text OR COALESCE(c.bank_name,'') ILIKE $5::text)
        ORDER BY c.due_date NULLS LAST, c.check_id DESC`,
      [branchId, status, direction, search, like],
    );
  }

  private async postIssuanceJournal(client: any, check: any, user: AuthUser) {
    const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
    const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
    const ar = await requireMapping(client, 'AR', 'ذمم العملاء');
    const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
    const direction = Number(check.direction);
    const amount = Number(check.amount);
    const partyId = check.party_id ? Number(check.party_id) : null;
    if (direction === 1) {
      await postJournal(client, {
        branchId: check.branch_id, journalType: 5, description: `شيك قبض ${check.check_no}`,
        sourceType: 'check', sourceId: Number(check.check_id), userId: user.userId, autoBalance: false,
        lines: [
          { accountId: notesRec.accountId, debit: amount, description: 'شيك قبض' },
          { accountId: ar.accountId, credit: amount, partyId, description: 'شيك قبض' },
        ],
      });
    } else {
      await postJournal(client, {
        branchId: check.branch_id, journalType: 5, description: `شيك صرف ${check.check_no}`,
        sourceType: 'check', sourceId: Number(check.check_id), userId: user.userId, autoBalance: false,
        lines: [
          { accountId: ap.accountId, debit: amount, partyId, description: 'شيك صرف' },
          { accountId: notesPay.accountId, credit: amount, description: 'شيك صرف' },
        ],
      });
    }
  }

  private async postReversalJournal(client: any, check: any, user: AuthUser) {
    const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
    const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
    const ar = await requireMapping(client, 'AR', 'ذمم العملاء');
    const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
    const direction = Number(check.direction);
    const amount = Number(check.amount);
    const partyId = check.party_id ? Number(check.party_id) : null;
    if (direction === 1) {
      await postJournal(client, {
        branchId: check.branch_id, journalType: 5, description: `عكس شيك قبض ${check.check_no}`,
        sourceType: 'check_reversal', sourceId: Number(check.check_id), userId: user.userId, autoBalance: false,
        lines: [
          { accountId: ar.accountId, debit: amount, partyId, description: 'عكس شيك قبض' },
          { accountId: notesRec.accountId, credit: amount, description: 'عكس شيك قبض' },
        ],
      });
    } else {
      await postJournal(client, {
        branchId: check.branch_id, journalType: 5, description: `عكس شيك صرف ${check.check_no}`,
        sourceType: 'check_reversal', sourceId: Number(check.check_id), userId: user.userId, autoBalance: false,
        lines: [
          { accountId: notesPay.accountId, debit: amount, description: 'عكس شيك صرف' },
          { accountId: ap.accountId, credit: amount, partyId, description: 'عكس شيك صرف' },
        ],
      });
    }
  }

  private async resolveCashGl(client: any, check: any, preferredId?: number | null) {
    let cashAccountId = Number(preferredId ?? check.cash_account_id ?? 0) || null;
    if (!cashAccountId) {
      const row = await client.query(
        `SELECT cash_account_id FROM cash_accounts WHERE branch_id = $1::int AND is_active = true ORDER BY type, cash_account_id LIMIT 1`,
        [check.branch_id],
      );
      cashAccountId = Number(row.rows[0]?.cash_account_id ?? 0) || null;
    }
    if (cashAccountId) {
      const row = await client.query(
        'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
        [cashAccountId],
      );
      const gl = row.rows[0]?.gl_account_id;
      if (gl) return { cashAccountId, glAccountId: Number(gl) };
    }
    const cash = await resolveMapping(client, 'CASH');
    if (!cash) throw new BadRequestException('لا يوجد حساب خزينة/بنك مربوط — اربط الحساب البنكي بحساب محاسبي من «الحسابات البنكية والخزائن»');
    return { cashAccountId, glAccountId: Number(cash.accountId) };
  }

  async create(dto: any, branchId: number, user: AuthUser) {
    const direction = Number(dto.direction);
    if (![1, 2].includes(direction)) throw new BadRequestException('اتجاه الشيك غير صحيح');
    const amount = Number(dto.amount);
    if (!(amount > 0)) throw new BadRequestException('قيمة الشيك يجب أن تكون أكبر من صفر');
    const checkNo = String(dto.checkNo ?? '').trim();
    if (!checkNo) throw new BadRequestException('رقم الشيك مطلوب');
    if (dto.cashAccountId) {
      const acc = await this.db.one<{ branch_id: number }>('SELECT branch_id FROM cash_accounts WHERE cash_account_id=$1::int', [Number(dto.cashAccountId)]);
      if (!acc || Number(acc.branch_id) !== Number(branchId)) throw new BadRequestException('حساب الخزينة غير تابع للفرع');
    }

    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        `INSERT INTO checks (branch_id,direction,check_no,bank_name,amount,due_date,party_id,voucher_id,cash_account_id,status,notes,created_by)
         VALUES ($1::int,$2::int,$3::text,$4::text,$5::numeric,$6::date,$7::int,$8::bigint,$9::int,1,$10::text,$11::int)
         RETURNING check_id AS "checkId", check_no AS "checkNo", amount`,
        [branchId, direction, checkNo, dto.bankName || null, amount, dto.dueDate || null,
         dto.partyId ? Number(dto.partyId) : null, dto.voucherId ? Number(dto.voucherId) : null,
         dto.cashAccountId ? Number(dto.cashAccountId) : null, dto.notes || null, user.userId],
      );
      const check = {
        check_id: row.rows[0].checkId, branch_id: branchId, direction, amount,
        check_no: checkNo, party_id: dto.partyId ? Number(dto.partyId) : null,
        cash_account_id: dto.cashAccountId ? Number(dto.cashAccountId) : null,
      };
      // Party ledger: a check is a payment-like settlement both ways.
      if (check.party_id) {
        await client.query(
          `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, reference_no, notes, created_by)
           VALUES ($1::int,$2::int,2,2,$3::numeric,$4::text,$5::text,$6::int)`,
          [branchId, check.party_id, amount, checkNo, direction === 1 ? 'شيك قبض' : 'شيك صرف', user.userId],
        );
      }
      await this.postIssuanceJournal(client, check, user);
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'check.create','check',$3,$4)`,
        [user.userId, branchId, String(check.check_id), `${DIR[direction]} ${checkNo}`],
      );
      return { checkId: Number(check.check_id), checkNo, amount, direction, status: 1 };
    });
  }

  async updateStatus(id: number, status: number, branchId: number, user: AuthUser, notes?: string, cashAccountId?: number | null) {
    const st = Number(status);
    if (![2, 3, 4].includes(st)) throw new BadRequestException('الحالة المطلوبة غير صحيحة — التحصيل/الارتداد/الإلغاء فقط من هنا');
    const existing = await this.db.one<any>(
      `SELECT check_id, status, direction, amount, check_no, party_id, cash_account_id, branch_id
         FROM checks WHERE check_id=$1::int AND branch_id=$2::int`,
      [id, branchId],
    );
    if (!existing) throw new BadRequestException('الشيك غير موجود');
    if (Number(existing.status) !== 1) throw new BadRequestException('لا يمكن تعديل شيك خرج من حالة «تحت التحصيل»');

    return this.db.transaction(async (client) => {
      const check = existing;
      const amount = Number(check.amount);
      const direction = Number(check.direction);
      const partyId = check.party_id ? Number(check.party_id) : null;

      if (st === 2) {
        const { cashAccountId: resolved, glAccountId } = await this.resolveCashGl(client, check, cashAccountId);
        const notesRec = await requireMapping(client, 'NOTES_RECEIVABLE', 'أوراق قبض');
        const notesPay = await requireMapping(client, 'NOTES_PAYABLE', 'أوراق دفع');
        if (direction === 1) {
          await postJournal(client, {
            branchId, journalType: 5, description: `تحصيل شيك ${check.check_no}`,
            sourceType: 'check_collect', sourceId: id, userId: user.userId,
            lines: [
              { accountId: glAccountId, debit: amount, description: 'تحصيل شيك' },
              { accountId: notesRec.accountId, credit: amount, partyId, description: 'تحصيل شيك' },
            ],
          });
        } else {
          await postJournal(client, {
            branchId, journalType: 5, description: `صرف شيك ${check.check_no}`,
            sourceType: 'check_collect', sourceId: id, userId: user.userId,
            lines: [
              { accountId: notesPay.accountId, debit: amount, partyId, description: 'صرف شيك' },
              { accountId: glAccountId, credit: amount, description: 'صرف شيك' },
            ],
          });
        }
        await client.query(
          `INSERT INTO cash_transactions (branch_id, cash_account_id, direction, amount, transaction_date, description, party_id, created_by)
           VALUES ($1::int,$2::int,$3::smallint,$4::numeric, CURRENT_DATE, $5::text,$6::int,$7::int)`,
          [branchId, resolved, direction === 1 ? 1 : 2, amount, `${direction === 1 ? 'تحصيل' : 'صرف'} شيك ${check.check_no}`, partyId, user.userId],
        );
        await client.query('UPDATE checks SET status=2, cash_account_id = COALESCE($2::int, cash_account_id) WHERE check_id=$1::int',
          [id, cashAccountId ?? null]);
      } else {
        // مرتجع / ملغي — عكس قيد الاستلام (الذمة تعود)
        await this.postReversalJournal(client, check, user);
        if (partyId) {
          await client.query(
            `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, reference_no, notes, created_by)
             VALUES ($1::int,$2::int,1,2,$3::numeric,$4::text,$5::text,$6::int)`,
            [branchId, partyId, amount, check.check_no, st === 3 ? 'شيك مرتد' : 'شيك ملغي', user.userId],
          );
        }
        await client.query('UPDATE checks SET status=$2, notes = COALESCE($3::text, notes) WHERE check_id=$1::int',
          [id, st, notes ?? null]);
      }
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'check.status','check',$3,$4)`,
        [user.userId, branchId, String(id), `status=${st} (${STATUS[st]})`],
      );
      return { checkId: id, status: st };
    });
  }

  async summary(branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT status, direction, count(*)::int AS count, COALESCE(sum(amount),0)::numeric AS total
         FROM checks WHERE branch_id=$1::int GROUP BY status, direction ORDER BY status, direction`,
      [branchId],
    );
    return { rows };
  }

  /** Securities report: rows + aging buckets for due-unchecked notes + totals. */
  async report(branchId: number, q?: { from?: string; to?: string; direction?: number; status?: number; search?: string }) {
    const direction = q?.direction ? Number(q.direction) : 0;
    const status = q?.status ? Number(q.status) : 0;
    const search = String(q?.search ?? '').trim();
    const like = `%${search}%`;
    const rows = await this.db.query<any>(
      `SELECT c.check_id AS "checkId", c.direction, c.check_no AS "checkNo", c.bank_name AS "bankName",
              c.amount, c.due_date AS "dueDate", c.status, c.notes, c.created_at AS "createdAt",
              p.name AS "partyName", c.party_id AS "partyId"
         FROM checks c
         LEFT JOIN parties p ON p.party_id = c.party_id
        WHERE c.branch_id = $1::int
          AND ($2::int = 0 OR c.direction = $2::int)
          AND ($3::int = 0 OR c.status = $3::int)
          AND ($4::text = '' OR c.check_no ILIKE $5::text OR COALESCE(p.name,'') ILIKE $5::text OR COALESCE(c.bank_name,'') ILIKE $5::text)
          AND ($6::date IS NULL OR c.due_date >= $6::date)
          AND ($7::date IS NULL OR c.due_date <= $7::date)
        ORDER BY c.due_date NULLS LAST, c.check_id DESC`,
      [branchId, direction, status, search, like, q?.from ?? null, q?.to ?? null],
    );

    const today = new Date().toISOString().slice(0, 10);
    const aging = { d0_7: 0, d8_15: 0, d16_30: 0, d31plus: 0 };
    let outstanding = 0;
    let overdueCount = 0;
    let collected = 0;
    let paidOut = 0;
    for (const row of rows) {
      const amount = Number(row.amount ?? 0);
      if (Number(row.status) === 1) {
        outstanding += amount;
        if (row.dueDate && String(row.dueDate).slice(0, 10) < today) {
          overdueCount += 1;
          const days = Math.floor((Date.now() - new Date(row.dueDate).getTime()) / 86400000);
          if (days <= 7) aging.d0_7 += amount;
          else if (days <= 15) aging.d8_15 += amount;
          else if (days <= 30) aging.d16_30 += amount;
          else aging.d31plus += amount;
        }
      } else if (Number(row.status) === 2) {
        if (Number(row.direction) === 1) collected += amount; else paidOut += amount;
      }
    }
    return {
      items: rows,
      totals: { rows: rows.length, outstanding, overdueCount, collected, paidOut },
      aging,
    };
  }
}

@Controller('checks')
export class ChecksController {
  constructor(private readonly svc: ChecksService) {}

  @RequireAnyPermission('accounting.view', 'cash.view')
  @Get()
  list(@CurrentBranch() b: number, @Query('status') status?: string, @Query('direction') direction?: string, @Query('search') search?: string) {
    return this.svc.list(b, { status: status ? Number(status) : undefined, direction: direction ? Number(direction) : undefined, search });
  }

  @RequireAnyPermission('accounting.view', 'cash.view')
  @Get('summary')
  summary(@CurrentBranch() b: number) { return this.svc.summary(b); }

  @RequireAnyPermission('accounting.view', 'cash.view')
  @Get('report')
  report(@CurrentBranch() b: number, @Query('from') from?: string, @Query('to') to?: string,
         @Query('direction') direction?: string, @Query('status') status?: string, @Query('search') search?: string) {
    return this.svc.report(b, { from, to, direction: direction ? Number(direction) : undefined,
      status: status ? Number(status) : undefined, search });
  }

  @RequirePermissions('accounting.manage')
  @Post()
  create(@Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) { return this.svc.create(body, b, u); }

  @RequirePermissions('accounting.manage')
  @Put(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) {
    return this.svc.updateStatus(id, Number(body?.status), b, u, body?.notes, body?.cashAccountId ? Number(body.cashAccountId) : null);
  }
}

@Module({ controllers: [ChecksController], providers: [ChecksService] })
export class ChecksModule {}
