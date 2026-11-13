import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Query, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { postJournal, resolveMapping } from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/security';

export interface InstallmentPlanInput {
  partyId: number;
  invoiceId?: number;
  title?: string;
  totalAmount: number;
  downPayment?: number;
  installmentCount: number;
  frequency?: number;   // 1 monthly, 2 weekly
  startDate: string;
  notes?: string;
  guarantorPartyId?: number;
  guarantorName?: string;
  guarantorPhone?: string;
  guarantorIdNumber?: string;
}

@Injectable()
export class InstallmentsService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: { partyId?: number; branchId: number; status?: number }) {
    return this.db.query(
      `SELECT p.installment_plan_id AS "planId", p.plan_no AS "planNo", p.title, p.total_amount AS "totalAmount",
              p.down_payment AS "downPayment", p.installment_count AS "installmentCount", p.frequency,
              p.start_date AS "startDate", pa.name AS "partyName", p.party_id AS "partyId",
              (SELECT COUNT(*)::int FROM installment_schedule s WHERE s.installment_plan_id = p.installment_plan_id) AS "scheduleCount",
              (SELECT COUNT(*)::int FROM installment_schedule s WHERE s.installment_plan_id = p.installment_plan_id AND s.status = 1) AS "dueCount",
              COALESCE((SELECT SUM(s.amount) FROM installment_schedule s WHERE s.installment_plan_id = p.installment_plan_id), 0) AS "scheduledAmount",
              COALESCE((SELECT SUM(s.paid_amount) FROM installment_schedule s WHERE s.installment_plan_id = p.installment_plan_id), 0) AS "paidAmount"
         FROM installment_plans p JOIN parties pa ON pa.party_id = p.party_id
        WHERE ($1::int = 0 OR p.party_id = $1)
          AND ($2::int = 0 OR p.branch_id = $2)
        ORDER BY p.installment_plan_id DESC`,
      [params.partyId ?? 0, params.branchId],
    );
  }

  async findOne(id: number) {
    const plan = await this.db.one<any>(
      `SELECT p.installment_plan_id AS "planId", p.plan_no AS "planNo", p.title, p.total_amount AS "totalAmount",
              p.down_payment AS "downPayment", p.installment_count AS "installmentCount", p.frequency,
              p.start_date AS "startDate", p.notes, p.party_id AS "partyId", pa.name AS "partyName",
              p.invoice_id AS "invoiceId",
               p.guarantor_party_id AS "guarantorPartyId", p.guarantor_name AS "guarantorName",
               p.guarantor_phone AS "guarantorPhone", p.guarantor_id_number AS "guarantorIdNumber"
         FROM installment_plans p JOIN parties pa ON pa.party_id = p.party_id
        WHERE p.installment_plan_id = $1`,
      [id],
    );
    if (!plan) return null;

    const schedule = await this.db.query(
      `SELECT s.installment_schedule_id AS "scheduleId", s.installment_no AS "installmentNo", s.due_date AS "dueDate",
              s.amount, s.paid_amount AS "paidAmount", s.paid_date AS "paidDate", s.status
         FROM installment_schedule s WHERE s.installment_plan_id = $1 ORDER BY s.installment_no`,
      [id],
    );
    return { plan, schedule };
  }

  /** Creates a plan and its schedule; the financed amount is booked on the party ledger. */
  async create(dto: InstallmentPlanInput, user: AuthUser, branchId: number) {
    if (!dto.partyId) throw new BadRequestException('العميل مطلوب');
    if (!dto.installmentCount || dto.installmentCount < 1) throw new BadRequestException('عدد الأقساط غير صحيح');
    const downPayment = Number(dto.downPayment ?? 0);
    const financed = Number(dto.totalAmount) - downPayment;
    if (financed <= 0) throw new BadRequestException('المبلغ financed يجب أن يكون أكبر من الدفعة المقدمة');

    return this.db.transaction(async (client) => {
      const serial = await this.db.nextNumber(client, `installment:${branchId}`);
      const planNo = `INS-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;

      const plan = await client.query<{ installment_plan_id: number }>(
        `INSERT INTO installment_plans
           (plan_no, branch_id, party_id, title, total_amount, down_payment, installment_count, frequency,
            start_date, invoice_id, notes, created_by, guarantor_party_id, guarantor_name, guarantor_phone, guarantor_id_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15,$16) RETURNING installment_plan_id`,
        [planNo, branchId, dto.partyId, dto.title ?? `تقسيط فاتورة`, Number(dto.totalAmount), downPayment,
          dto.installmentCount, dto.frequency ?? 1, dto.startDate, dto.invoiceId ?? null, dto.notes ?? null, user.userId,
          dto.guarantorPartyId ?? null, dto.guarantorName ?? null, dto.guarantorPhone ?? null, dto.guarantorIdNumber ?? null],
      );
      const planId = Number(plan.rows[0].installment_plan_id);

      const count = Number(dto.installmentCount);
      const base = Math.floor((financed / count) * 100) / 100;
      let allocated = 0;
      for (let i = 0; i < count; i++) {
        const amount = i === count - 1 ? Math.round((financed - allocated) * 100) / 100 : base;
        allocated += amount;
        const dueDate = new Date(dto.startDate);
        if ((dto.frequency ?? 1) === 2) dueDate.setDate(dueDate.getDate() + 7 * (i + 1));
        else dueDate.setMonth(dueDate.getMonth() + (i + 1));
        await client.query(
          `INSERT INTO installment_schedule (installment_plan_id, installment_no, due_date, amount, paid_amount, status)
           VALUES ($1,$2,$3::date,$4,0,1)`,
          [planId, i + 1, dueDate.toISOString().slice(0, 10), amount],
        );
      }

      if (financed > 0) {
        await client.query(
          `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, reference_no, notes, created_by)
           VALUES ($1,$2,1,1,$3,$4,$5,$6)`,
          [branchId, dto.partyId, financed, planNo, 'تمويل التقسيط', user.userId],
        );
      }

      return { planId, planNo, financed, installments: count };
    });
  }

  /** Records a payment against an installment and credits the party ledger. */
  async pay(scheduleId: number, body: { amount: number; paidDate?: string; cashAccountId?: number; notes?: string },
    user: AuthUser, branchId: number) {
    if (!(Number(body.amount) > 0)) throw new BadRequestException('المبلغ يجب أن يكون أكبر من صفر');

    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        `SELECT s.*, p.party_id, p.plan_no, p.branch_id
           FROM installment_schedule s JOIN installment_plans p ON p.installment_plan_id = s.installment_plan_id
          WHERE s.installment_schedule_id = $1 FOR UPDATE`,
        [scheduleId],
      );
      if (!row.rows.length) throw new BadRequestException('القسط غير موجود');
      const schedule = row.rows[0];

      const remaining = Number(schedule.amount) - Number(schedule.paid_amount);
      const amount = Math.min(Number(body.amount), remaining);

      await client.query(
        `UPDATE installment_schedule
            SET paid_amount = paid_amount + $2,
                paid_date = COALESCE($3::date, paid_date),
                status = CASE WHEN paid_amount + $2 >= amount THEN 2 WHEN paid_amount + $2 > 0 THEN 3 ELSE 1 END
          WHERE installment_schedule_id = $1`,
        [scheduleId, amount, body.paidDate ?? null],
      );

      await client.query(
        `INSERT INTO ledger_entries (branch_id, party_id, direction, entry_type, amount, cash_account_id, reference_no, notes, created_by)
         VALUES ($1,$2,2,2,$3,$4,$5,$6,$7)`,
        [branchId, schedule.party_id, amount, body.cashAccountId ?? null, schedule.plan_no,
          body.notes ?? 'سداد قسط', user.userId],
      );

      if (body.cashAccountId) {
        await client.query(
          `INSERT INTO cash_transactions (branch_id, cash_account_id, direction, amount, transaction_date, description, party_id, created_by)
           VALUES ($1,$2,1,$3, COALESCE($4::date, now()), $5, $6, $7)`,
          [branchId, body.cashAccountId, amount, body.paidDate ?? null,
            `سداد قسط - ${schedule.plan_no}`, schedule.party_id, user.userId],
        );

        // General ledger: cash in, receivable out.
        const cash = await client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
          [body.cashAccountId],
        );
        const cashAccount = cash.rows[0]?.gl_account_id ?? (await resolveMapping(client, 'CASH'))?.accountId;
        const receivable = await resolveMapping(client, 'AR');
        if (cashAccount && receivable) {
          await postJournal(client, {
            branchId,
            journalType: 4,
            description: `سداد قسط - ${schedule.plan_no}`,
            sourceType: 'installment',
            sourceId: scheduleId,
            lines: [
              { accountId: cashAccount, debit: amount, description: 'تحصيل قسط' },
              { accountId: receivable.accountId, credit: amount, partyId: schedule.party_id, description: 'سداد قسط' },
            ],
            userId: user.userId,
          });
        }
      }

      return { scheduleId, paid: amount, remaining: remaining - amount };
    });
  }

  /** Upcoming installments inside a window (used for alerts). */
  async due(days: number, branchId: number) {
    return this.db.query(
      `SELECT s.installment_schedule_id AS "scheduleId", s.installment_no AS "installmentNo", s.due_date AS "dueDate",
              s.amount, s.paid_amount AS "paidAmount", pa.name AS "partyName", pa.phone, p.plan_no AS "planNo",
              (s.amount - s.paid_amount) AS remaining
         FROM installment_schedule s
         JOIN installment_plans p ON p.installment_plan_id = s.installment_plan_id
         JOIN parties pa ON pa.party_id = p.party_id
        WHERE s.status <> 2
          AND s.due_date <= CURRENT_DATE + ($1::int || ' days')::interval
          AND ($2::int = 0 OR p.branch_id = $2)
        ORDER BY s.due_date`,
      [days, branchId],
    );
  }
}

@Controller('installments')
export class InstallmentsController {
  constructor(private readonly service: InstallmentsService) {}

  @RequireAnyPermission('parties.ledger', 'sales.view')
  @Get('plans')
  list(@Query('partyId') partyId: string, @CurrentBranch() branchId: number) {
    return this.service.list({ partyId: partyId ? Number(partyId) : undefined, branchId });
  }

  @RequirePermissions('parties.ledger')
  @Get('due')
  due(@Query('days') days: string, @CurrentBranch() branchId: number) {
    return this.service.due(Number(days) || 7, branchId);
  }

  @RequirePermissions('parties.ledger')
  @Get('plans/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @RequireAnyPermission('sales.manage', 'parties.manage')
  @Post('plans')
  create(@Body() dto: InstallmentPlanInput, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  @RequireAnyPermission('cash.manage', 'parties.ledger')
  @Post('schedule/:id/pay')
  pay(@Param('id', ParseIntPipe) id: number, @Body() body: { amount: number; paidDate?: string; cashAccountId?: number; notes?: string },
    @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.pay(id, body, user, branchId);
  }
}

@Module({
  controllers: [InstallmentsController],
  providers: [InstallmentsService],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
