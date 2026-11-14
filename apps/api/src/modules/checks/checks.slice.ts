import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/security';

const STATUS: Record<number, string> = { 1: 'تحت التحصيل', 2: 'محصّل', 3: 'مرتد', 4: 'ملغي' };
const DIR: Record<number, string> = { 1: 'قبض (وارد)', 2: 'صرف (صادر)' };

@Injectable()
export class ChecksService {
  constructor(private readonly db: DatabaseService) {}

  async list(branchId: number, q?: { status?: number; direction?: number }) {
    const status = q?.status ? Number(q.status) : 0;
    const direction = q?.direction ? Number(q.direction) : 0;
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
        ORDER BY c.due_date NULLS LAST, c.check_id DESC`,
      [branchId, status, direction],
    );
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
    const row = await this.db.one<any>(
      `INSERT INTO checks (branch_id,direction,check_no,bank_name,amount,due_date,party_id,voucher_id,cash_account_id,status,notes,created_by)
       VALUES ($1::int,$2::int,$3::text,$4::text,$5::numeric,$6::date,$7::int,$8::bigint,$9::int,$10::int,$11::text,$12::int)
       RETURNING check_id AS "checkId", check_no AS "checkNo", status, amount`,
      [branchId, direction, checkNo, dto.bankName || null, amount, dto.dueDate || null,
       dto.partyId ? Number(dto.partyId) : null, dto.voucherId ? Number(dto.voucherId) : null,
       dto.cashAccountId ? Number(dto.cashAccountId) : null, Number(dto.status ?? 1), dto.notes || null, user.userId],
    );
    await this.db.query(
      `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
       VALUES ($1,$2,'check.create','check',$3,$4)`,
      [user.userId, branchId, String(row.checkId), `${DIR[direction]} ${checkNo}`],
    );
    return row;
  }

  async updateStatus(id: number, status: number, branchId: number, user: AuthUser, notes?: string) {
    const st = Number(status);
    if (![1, 2, 3, 4].includes(st)) throw new BadRequestException('حالة الشيك غير صحيحة');
    const existing = await this.db.one<any>('SELECT check_id, status, direction, amount, check_no FROM checks WHERE check_id=$1::int AND branch_id=$2::int', [id, branchId]);
    if (!existing) throw new BadRequestException('الشيك غير موجود');
    if (Number(existing.status) === 4 && st !== 4) throw new BadRequestException('لا يمكن تعديل شيك ملغي');
    const row = await this.db.one<any>(
      `UPDATE checks SET status=$3::int, notes = COALESCE($4::text, notes)
        WHERE check_id=$1::int AND branch_id=$2::int
       RETURNING check_id AS "checkId", status, check_no AS "checkNo"`,
      [id, branchId, st, notes ?? null],
    );
    await this.db.query(
      `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
       VALUES ($1,$2,'check.status','check',$3,$4)`,
      [user.userId, branchId, String(id), `status=${st} (${STATUS[st]})`],
    );
    return row;
  }

  async summary(branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT status, direction, count(*)::int AS count, COALESCE(sum(amount),0)::numeric AS total
         FROM checks WHERE branch_id=$1::int GROUP BY status, direction ORDER BY status, direction`,
      [branchId],
    );
    return { rows };
  }
}

@Controller('checks')
export class ChecksController {
  constructor(private readonly svc: ChecksService) {}

  @RequireAnyPermission('accounting.view', 'cash.view')
  @Get()
  list(@CurrentBranch() b: number, @Query('status') status?: string, @Query('direction') direction?: string) {
    return this.svc.list(b, { status: status ? Number(status) : undefined, direction: direction ? Number(direction) : undefined });
  }

  @RequireAnyPermission('accounting.view', 'cash.view')
  @Get('summary')
  summary(@CurrentBranch() b: number) { return this.svc.summary(b); }

  @RequirePermissions('accounting.manage')
  @Post()
  create(@Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) { return this.svc.create(body, b, u); }

  @RequirePermissions('accounting.manage')
  @Put(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentBranch() b: number, @CurrentUser() u: AuthUser) {
    return this.svc.updateStatus(id, Number(body?.status), b, u, body?.notes);
  }
}

@Module({ controllers: [ChecksController], providers: [ChecksService] })
export class ChecksModule {}
