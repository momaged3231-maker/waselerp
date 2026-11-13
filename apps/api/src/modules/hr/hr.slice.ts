import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, Delete } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

@Injectable()
export class HrService {
  constructor(private readonly db: DatabaseService) {}

  // ---- Departments ----
  async listDepartments(branchId: number) {
    return this.db.query<any>(
      `SELECT d.department_id AS "departmentId", d.name, d.is_active AS "isActive", d.branch_id AS "branchId"
         FROM departments d WHERE ($1::int = 0 OR d.branch_id = $1) ORDER BY d.name`,
      [branchId],
    );
  }
  async createDepartment(dto: any, branchId: number) {
    const row = await this.db.one<any>(
      `INSERT INTO departments (branch_id, name, is_active) VALUES ($1,$2,$3) RETURNING department_id AS "departmentId"`,
      [branchId, dto.name, dto.isActive ?? true],
    );
    return row;
  }
  async updateDepartment(id: number, dto: any) {
    await this.db.query(`UPDATE departments SET name = COALESCE($2, name), is_active = COALESCE($3, is_active) WHERE department_id = $1`,
      [id, dto.name ?? null, dto.isActive ?? null]);
    return { departmentId: id };
  }

  // ---- Employees ----
  async listEmployees(branchId: number, search?: string) {
    const like = `%${search?.trim() ?? ''}%`;
    return this.db.query<any>(
      `SELECT e.employee_id AS "employeeId", e.name, e.branch_id AS "branchId", e.department_id AS "departmentId",
              d.name AS "departmentName", e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              e.work_days_mask AS "workDaysMask", e.user_id AS "userId", e.is_active AS "isActive",
              e.created_at AS "createdAt"
         FROM employees e LEFT JOIN departments d ON d.department_id = e.department_id
        WHERE ($1::int = 0 OR e.branch_id = $1)
          AND ($2::text = '' OR e.name ILIKE $3)
        ORDER BY e.name`,
      [branchId, search?.trim() ?? '', like],
    );
  }
  async getEmployee(id: number) {
    return this.db.one<any>(
      `SELECT e.employee_id AS "employeeId", e.name, e.branch_id AS "branchId", e.department_id AS "departmentId",
              d.name AS "departmentName", e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              e.work_days_mask AS "workDaysMask", e.user_id AS "userId", e.is_active AS "isActive"
         FROM employees e LEFT JOIN departments d ON d.department_id = e.department_id
        WHERE e.employee_id = $1`,
      [id],
    );
  }
  async createEmployee(dto: any, branchId: number) {
    const row = await this.db.one<any>(
      `INSERT INTO employees (name, branch_id, department_id, basic_salary, allowances, deductions, work_days_mask, user_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING employee_id AS "employeeId"`,
      [dto.name, branchId, dto.departmentId ?? null, dto.basicSalary ?? 0, dto.allowances ?? 0,
       dto.deductions ?? 0, dto.workDaysMask ?? 31, dto.userId ?? null, dto.isActive ?? true],
    );
    return row;
  }
  async updateEmployee(id: number, dto: any) {
    await this.db.query(
      `UPDATE employees SET name = COALESCE($2, name), department_id = COALESCE($3, department_id),
              basic_salary = COALESCE($4, basic_salary), allowances = COALESCE($5, allowances),
              deductions = COALESCE($6, deductions), work_days_mask = COALESCE($7, work_days_mask),
              user_id = COALESCE($8, user_id), is_active = COALESCE($9, is_active)
        WHERE employee_id = $1`,
      [id, dto.name ?? null, dto.departmentId ?? null, dto.basicSalary ?? null, dto.allowances ?? null,
       dto.deductions ?? null, dto.workDaysMask ?? null, dto.userId ?? null, dto.isActive ?? null],
    );
    return { employeeId: id };
  }

  // ---- Attendance ----
  async listAttendance(params: { branchId: number; employeeId?: number; from?: string; to?: string }) {
    return this.db.query<any>(
      `SELECT a.attendance_id AS "attendanceId", a.employee_id AS "employeeId", e.name AS "employeeName",
              a.work_date AS "workDate", a.status, a.overtime_minutes AS "overtimeMinutes",
              a.late_minutes AS "lateMinutes", a.notes
         FROM attendances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE ($1::int = 0 OR a.branch_id = $1)
          AND ($2::int = 0 OR a.employee_id = $2)
          AND ($3::date IS NULL OR a.work_date >= $3::date)
          AND ($4::date IS NULL OR a.work_date <= $4::date)
        ORDER BY a.work_date DESC, e.name`,
      [params.branchId, params.employeeId ?? 0, params.from ?? null, params.to ?? null],
    );
  }
  async upsertAttendance(dto: any, branchId: number) {
    const existing = await this.db.one<any>(
      `SELECT attendance_id FROM attendances WHERE employee_id = $1 AND work_date = $2::date`,
      [dto.employeeId, dto.workDate],
    );
    if (existing) {
      await this.db.query(
        `UPDATE attendances SET status = $2, overtime_minutes = $3, late_minutes = $4, notes = $5
          WHERE attendance_id = $1`,
        [existing.attendance_id, dto.status ?? 1, dto.overtimeMinutes ?? 0, dto.lateMinutes ?? 0, dto.notes ?? null],
      );
      return { attendanceId: existing.attendance_id, updated: true };
    }
    const row = await this.db.one<any>(
      `INSERT INTO attendances (employee_id, branch_id, work_date, status, overtime_minutes, late_minutes, notes)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7) RETURNING attendance_id AS "attendanceId"`,
      [dto.employeeId, branchId, dto.workDate, dto.status ?? 1, dto.overtimeMinutes ?? 0, dto.lateMinutes ?? 0, dto.notes ?? null],
    );
    return { attendanceId: row.attendance_id, updated: false };
  }

  // ---- Leave requests ----
  async listLeaves(params: { branchId: number; employeeId?: number; status?: number }) {
    return this.db.query<any>(
      `SELECT l.leave_request_id AS "leaveId", l.employee_id AS "employeeId", e.name AS "employeeName",
              l.leave_type AS "leaveType", l.start_date AS "startDate", l.end_date AS "endDate",
              l.days, l.status, l.notes, l.created_at AS "createdAt"
         FROM leave_requests l JOIN employees e ON e.employee_id = l.employee_id
        WHERE ($1::int = 0 OR e.branch_id = $1)
          AND ($2::int = 0 OR l.employee_id = $2)
          AND ($3::int = 0 OR l.status = $3)
        ORDER BY l.created_at DESC`,
      [params.branchId, params.employeeId ?? 0, params.status ?? 0],
    );
  }
  async createLeave(dto: any, user: AuthUser) {
    const row = await this.db.one<any>(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, status, notes, created_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8) RETURNING leave_request_id AS "leaveId"`,
      [dto.employeeId, dto.leaveType, dto.startDate, dto.endDate, dto.days ?? 0, dto.status ?? 1, dto.notes ?? null, user.userId],
    );
    return row;
  }
  async updateLeaveStatus(id: number, status: number) {
    await this.db.query(`UPDATE leave_requests SET status = $2 WHERE leave_request_id = $1`, [id, status]);
    return { leaveId: id, status };
  }

  // ---- Salary pays ----
  async listSalaryPays(params: { branchId: number; employeeId?: number; month?: string }) {
    return this.db.query<any>(
      `SELECT s.salary_pay_id AS "salaryPayId", s.employee_id AS "employeeId", e.name AS "employeeName",
              s.period_month AS "periodMonth", s.basic_salary AS "basicSalary", s.allowances, s.overtime_amount AS "overtimeAmount",
              s.deductions, s.bonus, s.net_pay AS "netPay", s.status, s.created_at AS "createdAt"
         FROM salary_pays s JOIN employees e ON e.employee_id = s.employee_id
        WHERE ($1::int = 0 OR s.branch_id = $1)
          AND ($2::int = 0 OR s.employee_id = $2)
          AND ($3::date IS NULL OR s.period_month = $3::date)
        ORDER BY s.period_month DESC, e.name`,
      [params.branchId, params.employeeId ?? 0, params.month ?? null],
    );
  }
  async createSalaryPay(dto: any, user: AuthUser, branchId: number) {
    const netPay = Number(dto.basicSalary ?? 0) + Number(dto.allowances ?? 0) + Number(dto.overtimeAmount ?? 0)
      + Number(dto.bonus ?? 0) - Number(dto.deductions ?? 0);
    const row = await this.db.one<any>(
      `INSERT INTO salary_pays (employee_id, branch_id, period_month, basic_salary, allowances, overtime_amount, deductions, bonus, net_pay, status, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING salary_pay_id AS "salaryPayId"`,
      [dto.employeeId, branchId, dto.periodMonth, dto.basicSalary ?? 0, dto.allowances ?? 0,
       dto.overtimeAmount ?? 0, dto.deductions ?? 0, dto.bonus ?? 0, netPay, dto.status ?? 1, user.userId],
    );
    return { ...row, netPay };
  }
  async updateSalaryPayStatus(id: number, status: number) {
    await this.db.query(`UPDATE salary_pays SET status = $2 WHERE salary_pay_id = $1`, [id, status]);
    return { salaryPayId: id, status };
  }
}

@Controller('hr')
export class HrController {
  constructor(private readonly service: HrService) {}

  @RequirePermissions('hr.view')
  @Get('departments') listDepartments(@CurrentBranch() branchId: number) { return this.service.listDepartments(branchId); }
  @RequirePermissions('hr.manage')
  @Post('departments') createDepartment(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.createDepartment(dto, branchId); }
  @RequirePermissions('hr.manage')
  @Put('departments/:id') updateDepartment(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateDepartment(id, dto); }

  @RequirePermissions('hr.view')
  @Get('employees') listEmployees(@CurrentBranch() branchId: number, @Query('search') search: string) { return this.service.listEmployees(branchId, search); }
  @RequirePermissions('hr.view')
  @Get('employees/:id') getEmployee(@Param('id', ParseIntPipe) id: number) { return this.service.getEmployee(id); }
  @RequirePermissions('hr.manage')
  @Post('employees') createEmployee(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.createEmployee(dto, branchId); }
  @RequirePermissions('hr.manage')
  @Put('employees/:id') updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateEmployee(id, dto); }

  @RequirePermissions('hr.view')
  @Get('attendance') listAttendance(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.listAttendance({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, from, to });
  }
  @RequirePermissions('hr.manage')
  @Post('attendance') upsertAttendance(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.upsertAttendance(dto, branchId); }

  @RequirePermissions('hr.view')
  @Get('leaves') listLeaves(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('status') status: string) {
    return this.service.listLeaves({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, status: status ? Number(status) : undefined });
  }
  @RequirePermissions('hr.manage')
  @Post('leaves') createLeave(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.createLeave(dto, user); }
  @RequirePermissions('hr.manage')
  @Put('leaves/:id/status') updateLeaveStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateLeaveStatus(id, dto.status); }

  @RequirePermissions('hr.view')
  @Get('salary') listSalaryPays(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('month') month: string) {
    return this.service.listSalaryPays({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, month });
  }
  @RequirePermissions('hr.manage')
  @Post('salary') createSalaryPay(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.createSalaryPay(dto, user, branchId); }
  @RequirePermissions('hr.manage')
  @Put('salary/:id/status') updateSalaryPayStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateSalaryPayStatus(id, dto.status); }
}

@Module({
  providers: [HrService],
  controllers: [HrController],
})
export class HrModule {}
