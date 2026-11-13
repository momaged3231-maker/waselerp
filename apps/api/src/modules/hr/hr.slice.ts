import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { postCashJournal } from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

@Injectable()
export class HrService {
  constructor(private readonly db: DatabaseService) {}

  async employees(branchId: number, search: string) {
    const like = `%${search.trim()}%`;
    return this.db.query(
      `SELECT e.employee_id AS "employeeId", e.code, e.name, e.job_title AS "jobTitle", e.mobile, e.phone,
              d.name AS "departmentName", e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              e.hire_date AS "hireDate", e.is_active AS "isActive", b.name AS "branchName",
              (SELECT COUNT(*)::int FROM attendances a
                WHERE a.employee_id = e.employee_id AND a.work_date = CURRENT_DATE) AS "todayAttendance"
         FROM employees e
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN branches b ON b.branch_id = e.branch_id
        WHERE ($1::int = 0 OR e.branch_id = $1)
          AND ($2::text = '' OR e.name ILIKE $3 OR COALESCE(e.code,'') ILIKE $3)
        ORDER BY e.name`,
      [branchId, search.trim(), like],
    );
  }

  async createEmployee(body: any, branchId: number) {
    if (!body.name) throw new BadRequestException('اسم الموظف مطلوب');
    const row = await this.db.one<any>(
      `INSERT INTO employees (code, name, branch_id, department_id, job_title, national_id, phone, mobile,
                              hire_date, birth_date, basic_salary, allowances, deductions, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING employee_id`,
      [body.code ?? null, body.name, body.branchId ?? branchId, body.departmentId ?? null, body.jobTitle ?? null,
        body.nationalId ?? null, body.phone ?? null, body.mobile ?? null, body.hireDate ?? null,
        body.birthDate ?? null, Number(body.basicSalary ?? 0), Number(body.allowances ?? 0),
        Number(body.deductions ?? 0), body.isActive ?? true],
    );
    return { employeeId: Number(row.employee_id) };
  }

  async updateEmployee(id: number, body: any) {
    await this.db.query(
      `UPDATE employees SET code=$2, name=$3, department_id=$4, job_title=$5, national_id=$6, phone=$7,
              mobile=$8, hire_date=$9, birth_date=$10, basic_salary=$11, allowances=$12, deductions=$13,
              is_active=$14 WHERE employee_id=$1`,
      [id, body.code ?? null, body.name, body.departmentId ?? null, body.jobTitle ?? null, body.nationalId ?? null,
        body.phone ?? null, body.mobile ?? null, body.hireDate ?? null, body.birthDate ?? null,
        Number(body.basicSalary ?? 0), Number(body.allowances ?? 0), Number(body.deductions ?? 0),
        body.isActive ?? true],
    );
    return { employeeId: id };
  }

  async attendance(params: { employeeId?: number; branchId: number; from: string; to: string }) {
    return this.db.query(
      `SELECT a.attendance_id AS "attendanceId", a.work_date AS "workDate", a.check_in AS "checkIn",
              a.check_out AS "checkOut", a.status, a.overtime_minutes AS "overtimeMinutes",
              a.late_minutes AS "lateMinutes", a.notes, e.name AS "employeeName", e.code AS "employeeCode"
         FROM attendances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE ($1::int IS NULL OR a.employee_id = $1)
          AND ($2::int = 0 OR a.branch_id = $2)
          AND ($3::date IS NULL OR a.work_date >= $3::date)
          AND ($4::date IS NULL OR a.work_date <= $4::date)
        ORDER BY a.work_date DESC, e.name LIMIT 500`,
      [params.employeeId ?? null, params.branchId, params.from || null, params.to || null],
    );
  }

  /** Records one attendance row (check-in / check-out / absent). */
  async recordAttendance(body: any, user: AuthUser, branchId: number) {
    if (!body.employeeId) throw new BadRequestException('الموظف مطلوب');
    const workDate = body.workDate ?? new Date().toISOString().slice(0, 10);
    const existing = await this.db.one<any>(
      'SELECT attendance_id FROM attendances WHERE employee_id = $1 AND work_date = $2::date',
      [body.employeeId, workDate],
    );

    if (existing) {
      const row = await this.db.one<any>(
        `UPDATE attendances SET check_in = COALESCE($3, check_in), check_out = COALESCE($4, check_out),
                status = COALESCE($5, status), overtime_minutes = COALESCE($6, overtime_minutes), notes = $7
          WHERE attendance_id = $1 RETURNING attendance_id AS "attendanceId"`,
        [existing.attendance_id, body.checkIn ?? null, body.checkOut ?? null, body.status ?? null,
          body.overtimeMinutes ?? null, body.notes ?? null],
      );
      return row;
    }

    const row = await this.db.one<any>(
      `INSERT INTO attendances (employee_id, branch_id, work_date, check_in, check_out, status, overtime_minutes, notes)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8) RETURNING attendance_id AS "attendanceId"`,
      [body.employeeId, branchId, workDate, body.checkIn ?? null, body.checkOut ?? null,
        body.status ?? 1, body.overtimeMinutes ?? 0, body.notes ?? null],
    );
    return row;
  }

  /** Salary sheet for a month: basic + allowances + overtime - deductions. */
  async salarySheet(branchId: number, month: string) {
    const periodMonth = month ? `${month}-01` : new Date().toISOString().slice(0, 7) + '-01';
    return this.db.query(
      `SELECT e.employee_id AS "employeeId", e.name, e.job_title AS "jobTitle", b.name AS "branchName",
              e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              COALESCE((
                SELECT SUM(a.overtime_minutes) FROM attendances a
                 WHERE a.employee_id = e.employee_id
                   AND a.work_date >= $2::date AND a.work_date < ($2::date + INTERVAL '1 month')
              ), 0) AS "overtimeMinutes",
              sp.salary_pay_id AS "salaryPayId", sp.net_pay AS "netPay", sp.status
         FROM employees e
         LEFT JOIN branches b ON b.branch_id = e.branch_id
         LEFT JOIN salary_pays sp ON sp.employee_id = e.employee_id AND sp.period_month = $2::date
        WHERE e.is_active = true AND ($1::int = 0 OR e.branch_id = $1)
        ORDER BY e.name`,
      [branchId, periodMonth],
    );
  }

  async paySalary(body: any, user: AuthUser, branchId: number) {
    if (!body.employeeId) throw new BadRequestException('الموظف مطلوب');
    const periodMonth = body.month ? `${body.month}-01` : new Date().toISOString().slice(0, 7) + '-01';
    const employee = await this.db.one<any>(
      'SELECT employee_id, basic_salary, allowances, deductions FROM employees WHERE employee_id = $1',
      [body.employeeId],
    );
    if (!employee) throw new BadRequestException('الموظف غير موجود');

    const overtime = await this.db.one<any>(
      `SELECT COALESCE(SUM(overtime_minutes),0) AS minutes FROM attendances
        WHERE employee_id = $1 AND work_date >= $2::date AND work_date < ($2::date + INTERVAL '1 month')`,
      [body.employeeId, periodMonth],
    );
    const hourly = Number(employee.basic_salary) / 240;
    const overtimeAmount = (Number(overtime?.minutes ?? 0) / 60) * hourly;

    const basic = Number(employee.basic_salary);
    const allowances = Number(employee.allowances);
    const deductions = Number(employee.deductions) + Number(body.extraDeduction ?? 0);
    const bonus = Number(body.bonus ?? 0);
    const net = basic + allowances + overtimeAmount + bonus - deductions;

    const row = await this.db.one<any>(
      `INSERT INTO salary_pays (employee_id, branch_id, period_month, basic_salary, allowances, overtime_amount,
                                 deductions, bonus, net_pay, payment_date, cash_account_id, status, notes, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10::date,$11,2,$12,$13)
       ON CONFLICT DO NOTHING
       RETURNING salary_pay_id AS "salaryPayId", net_pay AS "netPay"`,
      [body.employeeId, branchId, periodMonth, basic, allowances, overtimeAmount, deductions, bonus, net,
        body.paymentDate ?? new Date().toISOString().slice(0, 10), body.cashAccountId ?? null,
        body.notes ?? null, user.userId],
    );

    if (row.salaryPayId && body.cashAccountId) {
      await this.db.query(
        `INSERT INTO cash_transactions (branch_id, cash_account_id, direction, amount, transaction_date, description, created_by)
         VALUES ($1,$2,2,$3, now(), $4, $5)`,
        [branchId, body.cashAccountId, net, `مرتب ${body.employeeId}`, user.userId],
      );
      await this.db.transaction(async (client) => {
        await postCashJournal(client, {
          branchId,
          direction: 2,
          amount: net,
          cashAccountId: Number(body.cashAccountId),
          description: `مرتب ${body.employeeId}`,
          userId: user.userId,
          sourceType: 'salary',
          sourceId: row.salaryPayId ? Number(row.salaryPayId) : null,
        });
      });
    }
    return row ?? { salaryPayId: null, netPay: net };
  }
}

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  @RequirePermissions('hr.view')
  @Get('employees')
  employees(@CurrentBranch() branchId: number, @Query('search') search = '') {
    return this.service.employees(branchId, search);
  }

  @RequirePermissions('hr.manage')
  @Post('employees')
  createEmployee(@Body() body: any, @CurrentBranch() branchId: number) {
    return this.service.createEmployee(body, branchId);
  }

  @RequirePermissions('hr.manage')
  @Put('employees/:id')
  updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateEmployee(id, body);
  }

  @RequirePermissions('hr.view')
  @Get('attendance')
  attendance(@Query('employeeId') employeeId: string, @Query('from') from: string, @Query('to') to: string, @CurrentBranch() branchId: number) {
    return this.service.attendance({ employeeId: employeeId ? Number(employeeId) : undefined, branchId, from, to });
  }

  @RequirePermissions('hr.manage')
  @Post('attendance')
  recordAttendance(@Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.recordAttendance(body, user, branchId);
  }

  @RequirePermissions('hr.view')
  @Get('salaries')
  salarySheet(@CurrentBranch() branchId: number, @Query('month') month: string) {
    return this.service.salarySheet(branchId, month);
  }

  @RequirePermissions('hr.manage')
  @Post('salaries/pay')
  paySalary(@Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.paySalary(body, user, branchId);
  }
}

@Module({
  controllers: [HrController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
