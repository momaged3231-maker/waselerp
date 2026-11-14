import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param,
  ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { cashAccountGlId, postJournal, requireMapping } from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const STATUS_LABEL: Record<string, number> = {
  present: 1, 'حاضر': 1, '1': 1,
  absent: 2, 'غائب': 2, '2': 2,
  leave: 3, 'إجازة': 3, 'اجازة': 3, '3': 3,
  holiday: 4, 'عطلة': 4, '4': 4,
};

function monthStart(period: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(period ?? ''));
  if (!match) throw new BadRequestException('صيغة الشهر غير صحيحة (YYYY-MM)');
  return `${match[1]}-${match[2]}-01`;
}
function monthEnd(period: string): string {
  const start = new Date(`${monthStart(period)}T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}
function nextMonthStart(period: string): string {
  const start = new Date(`${monthStart(period)}T00:00:00Z`);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/** Minimal CSV reader: handles quoted fields, commas and CRLF. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(current); current = ''; }
      else current += ch;
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
  };
  const headers = split(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
    return row;
  });
}

function pick(row: Record<string, any>, keys: string[]): string {
  const lower: Record<string, any> = {};
  for (const key of Object.keys(row)) lower[key.toLowerCase()] = row[key];
  for (const key of keys) {
    const value = row[key] ?? lower[key.toLowerCase()];
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return '';
}

@Injectable()
export class HrService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------------------------------------------------------- departments
  async listDepartments(branchId: number) {
    return this.db.query<any>(
      `SELECT d.department_id AS "departmentId", d.name, d.is_active AS "isActive", d.branch_id AS "branchId",
              (SELECT count(*)::int FROM employees e WHERE e.department_id = d.department_id) AS "employeeCount"
         FROM departments d WHERE ($1::int = 0 OR d.branch_id = $1) ORDER BY d.name`,
      [branchId],
    );
  }
  async createDepartment(dto: any, branchId: number) {
    if (!String(dto.name ?? '').trim()) throw new BadRequestException('اسم الإدارة مطلوب');
    return this.db.one<any>(
      `INSERT INTO departments (branch_id, name, is_active) VALUES ($1,$2,$3) RETURNING department_id AS "departmentId"`,
      [branchId, String(dto.name).trim(), dto.isActive ?? true],
    );
  }
  async updateDepartment(id: number, dto: any) {
    await this.db.query(
      `UPDATE departments SET name = COALESCE($2, name), is_active = COALESCE($3, is_active) WHERE department_id = $1`,
      [id, dto.name ?? null, dto.isActive ?? null],
    );
    return { departmentId: id };
  }
  async removeDepartment(id: number) {
    const used = await this.db.one<any>(`SELECT count(*)::int AS n FROM employees WHERE department_id = $1`, [id]);
    if (Number(used?.n ?? 0) > 0) throw new BadRequestException('لا يمكن حذف إدارة بها موظفون');
    await this.db.query(`DELETE FROM departments WHERE department_id = $1`, [id]);
    return { departmentId: id, deleted: true };
  }

  // ---------------------------------------------------------------- employees
  async listEmployees(branchId: number, search?: string) {
    const like = `%${search?.trim() ?? ''}%`;
    return this.db.query<any>(
      `SELECT e.employee_id AS "employeeId", e.code, e.name, e.branch_id AS "branchId", b.name AS "branchName",
              e.department_id AS "departmentId", d.name AS "departmentName", e.job_title AS "jobTitle",
              e.national_id AS "nationalId", e.phone, e.mobile, e.hire_date AS "hireDate",
              e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              e.work_days_mask AS "workDaysMask", e.user_id AS "userId", e.is_active AS "isActive",
              EXISTS (SELECT 1 FROM attendances a WHERE a.employee_id = e.employee_id
                      AND a.work_date = CURRENT_DATE AND a.status = 1) AS "todayAttendance",
              (SELECT COALESCE(sum(x.amount - x.deducted_amount),0) FROM employee_advances x
                WHERE x.employee_id = e.employee_id AND x.status = 1) AS "advanceBalance",
              e.created_at AS "createdAt"
         FROM employees e
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN branches b ON b.branch_id = e.branch_id
        WHERE ($1::int = 0 OR e.branch_id = $1)
          AND ($2::text = '' OR e.name ILIKE $3 OR e.code ILIKE $3 OR e.mobile ILIKE $3)
        ORDER BY e.name`,
      [branchId, search?.trim() ?? '', like],
    );
  }
  async getEmployee(id: number) {
    const row = await this.db.one<any>(
      `SELECT e.employee_id AS "employeeId", e.code, e.name, e.branch_id AS "branchId", b.name AS "branchName",
              e.department_id AS "departmentId", d.name AS "departmentName", e.job_title AS "jobTitle",
              e.national_id AS "nationalId", e.phone, e.mobile, e.address,
              e.hire_date AS "hireDate", e.birth_date AS "birthDate",
              e.basic_salary AS "basicSalary", e.allowances, e.deductions,
              e.work_days_mask AS "workDaysMask", e.user_id AS "userId", e.is_active AS "isActive", e.notes
         FROM employees e
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN branches b ON b.branch_id = e.branch_id
        WHERE e.employee_id = $1`,
      [id],
    );
    if (!row) throw new BadRequestException('الموظف غير موجود');
    return row;
  }
  async createEmployee(dto: any, branchId: number) {
    if (!String(dto.name ?? '').trim()) throw new BadRequestException('اسم الموظف مطلوب');
    return this.db.one<any>(
      `INSERT INTO employees (code, name, branch_id, department_id, job_title, national_id, phone, mobile,
                              address, hire_date, birth_date, basic_salary, allowances, deductions,
                              work_days_mask, user_id, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11::date,$12,$13,$14,$15,$16,$17,$18)
       RETURNING employee_id AS "employeeId"`,
      [dto.code ?? null, String(dto.name).trim(), branchId, dto.departmentId ?? null,
       dto.jobTitle ?? null, dto.nationalId ?? null, dto.phone ?? null, dto.mobile ?? null,
       dto.address ?? null, dto.hireDate ?? null, dto.birthDate ?? null,
       dto.basicSalary ?? 0, dto.allowances ?? 0, dto.deductions ?? 0,
       dto.workDaysMask ?? 31, dto.userId ?? null, dto.isActive ?? true, dto.notes ?? null],
    );
  }
  async updateEmployee(id: number, dto: any) {
    await this.db.query(
      `UPDATE employees SET name = COALESCE($2, name), code = COALESCE($3, code),
              department_id = COALESCE($4, department_id), job_title = COALESCE($5, job_title),
              national_id = COALESCE($6, national_id), phone = COALESCE($7, phone),
              mobile = COALESCE($8, mobile), address = COALESCE($9, address),
              hire_date = COALESCE($10::date, hire_date), birth_date = COALESCE($11::date, birth_date),
              basic_salary = COALESCE($12, basic_salary), allowances = COALESCE($13, allowances),
              deductions = COALESCE($14, deductions), work_days_mask = COALESCE($15, work_days_mask),
              user_id = COALESCE($16, user_id), is_active = COALESCE($17, is_active),
              notes = COALESCE($18, notes)
        WHERE employee_id = $1`,
      [id, dto.name ?? null, dto.code ?? null, dto.departmentId ?? null, dto.jobTitle ?? null,
       dto.nationalId ?? null, dto.phone ?? null, dto.mobile ?? null, dto.address ?? null,
       dto.hireDate ?? null, dto.birthDate ?? null, dto.basicSalary ?? null, dto.allowances ?? null,
       dto.deductions ?? null, dto.workDaysMask ?? null, dto.userId ?? null,
       dto.isActive ?? null, dto.notes ?? null],
    );
    return { employeeId: id };
  }

  // ---------------------------------------------------------------- salary components
  async listComponents() {
    return this.db.query<any>(
      `SELECT component_id AS "componentId", name, component_type AS "componentType",
              calc_type AS "calcType", amount, is_active AS "isActive", notes,
              (SELECT count(*)::int FROM employee_salary_components c
                WHERE c.component_id = salary_components.component_id) AS "employeeCount"
         FROM salary_components ORDER BY component_type, name`,
    );
  }
  async createComponent(dto: any) {
    if (!String(dto.name ?? '').trim()) throw new BadRequestException('اسم المكوّن مطلوب');
    const type = Number(dto.componentType ?? 1);
    if (![1, 2, 3].includes(type)) throw new BadRequestException('نوع المكوّن غير صحيح');
    const calc = Number(dto.calcType ?? 1);
    if (![1, 2].includes(calc)) throw new BadRequestException('طريقة الحساب غير صحيحة');
    return this.db.one<any>(
      `INSERT INTO salary_components (name, component_type, calc_type, amount, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING component_id AS "componentId"`,
      [String(dto.name).trim(), type, calc, dto.amount ?? 0, dto.isActive ?? true, dto.notes ?? null],
    );
  }
  async updateComponent(id: number, dto: any) {
    await this.db.query(
      `UPDATE salary_components SET name = COALESCE($2, name), component_type = COALESCE($3, component_type),
              calc_type = COALESCE($4, calc_type), amount = COALESCE($5, amount),
              is_active = COALESCE($6, is_active), notes = COALESCE($7, notes)
        WHERE component_id = $1`,
      [id, dto.name ?? null, dto.componentType ?? null, dto.calcType ?? null,
       dto.amount ?? null, dto.isActive ?? null, dto.notes ?? null],
    );
    return { componentId: id };
  }
  async removeComponent(id: number) {
    await this.db.query(`DELETE FROM salary_components WHERE component_id = $1`, [id]);
    return { componentId: id, deleted: true };
  }
  async listEmployeeComponents(employeeId: number) {
    return this.db.query<any>(
      `SELECT c.component_id AS "componentId", c.name, c.component_type AS "componentType",
              c.calc_type AS "calcType", c.amount AS "baseAmount",
              ec.amount_override AS "amountOverride", COALESCE(ec.is_active, false) AS "assigned"
         FROM salary_components c
         LEFT JOIN employee_salary_components ec
                ON ec.component_id = c.component_id AND ec.employee_id = $1
        WHERE c.is_active = true
        ORDER BY c.component_type, c.name`,
      [employeeId],
    );
  }
  async setEmployeeComponents(employeeId: number, dto: any) {
    const rows: any[] = Array.isArray(dto?.components) ? dto.components : [];
    await this.db.transaction(async (client) => {
      await client.query(`DELETE FROM employee_salary_components WHERE employee_id = $1`, [employeeId]);
      for (const row of rows) {
        if (!row?.componentId) continue;
        await client.query(
          `INSERT INTO employee_salary_components (employee_id, component_id, amount_override, is_active)
           VALUES ($1::int,$2::int,$3::numeric,$4::boolean)
           ON CONFLICT (employee_id, component_id)
           DO UPDATE SET amount_override = EXCLUDED.amount_override, is_active = EXCLUDED.is_active`,
          [employeeId, Number(row.componentId), row.amountOverride ?? null, row.assigned !== false],
        );
      }
    });
    return { employeeId, saved: rows.length };
  }

  // ---------------------------------------------------------------- attendance
  async listAttendance(params: { branchId: number; employeeId?: number; from?: string; to?: string }) {
    return this.db.query<any>(
      `SELECT a.attendance_id AS "attendanceId", a.employee_id AS "employeeId", e.name AS "employeeName",
              a.work_date AS "workDate", a.check_in AS "checkIn", a.check_out AS "checkOut",
              a.status, a.overtime_minutes AS "overtimeMinutes", a.late_minutes AS "lateMinutes", a.notes
         FROM attendances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE ($1::int = 0 OR a.branch_id = $1)
          AND ($2::int = 0 OR a.employee_id = $2)
          AND ($3::date IS NULL OR a.work_date >= $3::date)
          AND ($4::date IS NULL OR a.work_date <= $4::date)
        ORDER BY a.work_date DESC, e.name`,
      [params.branchId, params.employeeId ?? 0, params.from ?? null, params.to ?? null],
    );
  }
  private async upsertAttendanceRow(client: PoolClient, dto: any, branchId: number) {
    const existing = await client.query<any>(
      `SELECT attendance_id FROM attendances WHERE employee_id = $1 AND work_date = $2::date`,
      [Number(dto.employeeId), dto.workDate],
    );
    const values = [
      dto.status ?? 1, dto.overtimeMinutes ?? 0, dto.lateMinutes ?? 0,
      dto.notes ?? null, dto.checkIn ?? null, dto.checkOut ?? null,
    ];
    if (existing.rows.length) {
      await client.query(
        `UPDATE attendances SET status = $2, overtime_minutes = $3, late_minutes = $4, notes = $5,
                check_in = COALESCE($6::timestamptz, check_in),
                check_out = COALESCE($7::timestamptz, check_out)
          WHERE attendance_id = $1`,
        [existing.rows[0].attendance_id, ...values],
      );
      return { attendanceId: Number(existing.rows[0].attendance_id), updated: true };
    }
    const row = await client.query<any>(
      `INSERT INTO attendances (employee_id, branch_id, work_date, status, overtime_minutes, late_minutes,
                                notes, check_in, check_out)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz)
       RETURNING attendance_id`,
      [Number(dto.employeeId), branchId, dto.workDate, ...values],
    );
    return { attendanceId: Number(row.rows[0].attendance_id), updated: false };
  }
  async upsertAttendance(dto: any, branchId: number) {
    if (!dto.employeeId) throw new BadRequestException('الموظف مطلوب');
    if (!dto.workDate) throw new BadRequestException('تاريخ اليوم مطلوب');
    return this.db.transaction((client) => this.upsertAttendanceRow(client, dto, branchId));
  }

  /** Imports a fingerprint / Excel CSV export. */
  async importAttendance(dto: any, branchId: number) {
    const rows: Record<string, any>[] = Array.isArray(dto?.rows)
      ? dto.rows
      : parseCsv(String(dto?.csv ?? ''));
    if (!rows.length) throw new BadRequestException('لا توجد صفوف للاستيراد');

    const employees = await this.db.query<any>(
      `SELECT employee_id AS "employeeId", code, name, branch_id AS "branchId" FROM employees WHERE is_active = true`,
    );
    const byCode = new Map<string, any>();
    const byId = new Map<number, any>();
    for (const employee of employees) {
      if (employee.code) byCode.set(String(employee.code).trim().toLowerCase(), employee);
      byId.set(Number(employee.employeeId), employee);
    }

    let imported = 0;
    const errors: string[] = [];
    await this.db.transaction(async (client) => {
      for (let index = 0; index < rows.length; index += 1) {
        const raw = rows[index];
        const code = String(pick(raw, ['code', 'employee_code', 'employeecode', 'كود', 'الكود']) ?? '').trim();
        const idCell = String(pick(raw, ['employeeid', 'employee_id', 'id', 'الرقم']) ?? '').trim();
        const employee = (idCell && byId.get(Number(idCell))) || (code && byCode.get(code.toLowerCase()));
        const workDate = pick(raw, ['date', 'work_date', 'workdate', 'day', 'التاريخ']);
        if (!employee) { errors.push(`صف ${index + 2}: موظف غير معروف (${code || idCell || '—'})`); continue; }
        if (!workDate) { errors.push(`صف ${index + 2}: التاريخ مفقود`); continue; }

        const statusCell = pick(raw, ['status', 'state', 'الحالة', 'حالة']);
        const statusKey = String(statusCell).trim().toLowerCase();
        const status = STATUS_LABEL[statusKey] ?? STATUS_LABEL[String(statusCell).trim()] ?? 1;
        const time = (value: string) => {
          if (!value) return null;
          if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return `${workDate}T${value.length === 5 ? `${value}:00` : value}`;
          return value;
        };
        try {
          const saved = await this.upsertAttendanceRow(client, {
            employeeId: employee.employeeId,
            workDate,
            status,
            overtimeMinutes: Number(pick(raw, ['overtime', 'overtime_minutes', 'overtimeminutes', 'إضافي']) || 0),
            lateMinutes: Number(pick(raw, ['late', 'late_minutes', 'lateminutes', 'تأخير']) || 0),
            checkIn: time(pick(raw, ['check_in', 'checkin', 'in', 'الحضور'])),
            checkOut: time(pick(raw, ['check_out', 'checkout', 'out', 'الانصراف'])),
            notes: pick(raw, ['notes', 'note', 'ملاحظات']) || null,
          }, employee.branchId ?? branchId);
          if (saved.attendanceId) imported += 1;
        } catch (error: any) {
          errors.push(`صف ${index + 2}: ${error?.message ?? 'خطأ غير معروف'}`);
        }
      }
    });
    return { imported, skipped: rows.length - imported, errors };
  }

  // ---------------------------------------------------------------- leave requests
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
    if (!dto.employeeId || !dto.startDate || !dto.endDate) {
      throw new BadRequestException('الموظف وتاريخ البداية والنهاية مطلوبون');
    }
    const start = new Date(`${dto.startDate}T00:00:00Z`);
    const end = new Date(`${dto.endDate}T00:00:00Z`);
    const days = dto.days ?? Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const row = await this.db.one<any>(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, days, status, notes, created_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8) RETURNING leave_request_id AS "leaveId"`,
      [dto.employeeId, dto.leaveType ?? 1, dto.startDate, dto.endDate, days, dto.status ?? 1, dto.notes ?? null, user.userId],
    );
    return { ...row, days };
  }
  async updateLeaveStatus(id: number, status: number) {
    if (![1, 2, 3].includes(Number(status))) throw new BadRequestException('حالة الإجازة غير صحيحة');
    await this.db.query(`UPDATE leave_requests SET status = $2 WHERE leave_request_id = $1`, [id, status]);
    return { leaveId: id, status };
  }

  // ---------------------------------------------------------------- advances
  async listAdvances(params: { branchId: number; employeeId?: number; status?: number }) {
    return this.db.query<any>(
      `SELECT a.advance_id AS "advanceId", a.employee_id AS "employeeId", e.name AS "employeeName",
              a.advance_date AS "advanceDate", a.amount, a.monthly_deduction AS "monthlyDeduction",
              a.deducted_amount AS "deductedAmount", (a.amount - a.deducted_amount) AS "remaining",
              a.status, a.notes, a.gl_journal_id AS "glJournalId", a.created_at AS "createdAt"
         FROM employee_advances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE ($1::int = 0 OR a.branch_id = $1)
          AND ($2::int = 0 OR a.employee_id = $2)
          AND ($3::int = 0 OR a.status = $3)
        ORDER BY a.advance_date DESC, a.advance_id DESC`,
      [params.branchId, params.employeeId ?? 0, params.status ?? 0],
    );
  }
  async createAdvance(dto: any, user: AuthUser, branchId: number) {
    const amount = round2(Number(dto.amount ?? 0));
    if (!dto.employeeId || amount <= 0) throw new BadRequestException('الموظف والمبلغ مطلوبان');
    const monthly = round2(Number(dto.monthlyDeduction ?? 0));
    if (monthly < 0) throw new BadRequestException('الخصم الشهري غير صحيح');
    return this.db.one<any>(
      `INSERT INTO employee_advances (employee_id, branch_id, advance_date, amount, monthly_deduction, notes, created_by)
       VALUES ($1,$2,COALESCE($3::date,CURRENT_DATE),$4,$5,$6,$7)
       RETURNING advance_id AS "advanceId"`,
      [dto.employeeId, branchId, dto.advanceDate ?? null, amount, monthly, dto.notes ?? null, user.userId],
    );
  }
  /** Pays the advance out of a cash account (Dr Employee Advances / Cr Cash). */
  async payAdvance(id: number, dto: any, user: AuthUser) {
    const cashAccountId = Number(dto?.cashAccountId);
    if (!cashAccountId) throw new BadRequestException('اختر صندوق الصرف');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<any>(
        `SELECT advance_id, employee_id, branch_id, amount, gl_journal_id, status, advance_date
           FROM employee_advances WHERE advance_id = $1::bigint FOR UPDATE`,
        [id],
      );
      if (!rows.length) throw new BadRequestException('السلفة غير موجودة');
      const advance = rows[0];
      if (Number(advance.status) !== 1) throw new BadRequestException('السلفة ليست مفتوحة');
      if (advance.gl_journal_id) throw new BadRequestException('تم صرف السلفة بالفعل');
      const advanceAccount = await requireMapping(client, 'EMPLOYEE_ADVANCE', 'سلف الموظفين');
      const cashGl = await cashAccountGlId(client, cashAccountId);
      if (!cashGl) throw new BadRequestException('صندوق الصرف غير مربوط بحساب محاسبي');
      const journalId = await postJournal(client, {
        branchId: Number(advance.branch_id),
        journalDate: advance.advance_date,
        description: `صرف سلفة موظف #${advance.employee_id}`,
        sourceType: 'employee_advance', sourceId: id, userId: user.userId, autoBalance: true,
        lines: [
          { accountId: advanceAccount.accountId, debit: Number(advance.amount), description: 'سلفة موظف' },
          { accountId: cashGl, credit: Number(advance.amount), description: 'صرف سلفة' },
        ],
      });
      // The journal's branch comes from the current branch, so pass it explicitly.
      await client.query(
        `UPDATE employee_advances SET cash_account_id = $2, gl_journal_id = $3 WHERE advance_id = $1`,
        [id, cashAccountId, journalId],
      );
      return { advanceId: id, journalId, paid: true };
    });
  }
  async cancelAdvance(id: number) {
    const row = await this.db.one<any>(
      `SELECT advance_id, deducted_amount, gl_journal_id FROM employee_advances WHERE advance_id = $1`, [id],
    );
    if (!row) throw new BadRequestException('السلفة غير موجودة');
    if (Number(row.deducted_amount) > 0) throw new BadRequestException('لا يمكن إلغاء سلفة بدأ خصمها');
    if (row.gl_journal_id) throw new BadRequestException('لا يمكن إلغاء سلفة مصروفة — اعمل قيد عكسي');
    await this.db.query(`UPDATE employee_advances SET status = 3 WHERE advance_id = $1`, [id]);
    return { advanceId: id, status: 3 };
  }

  // ---------------------------------------------------------------- salaries
  async listSalaryPays(params: { branchId: number; employeeId?: number; month?: string }) {
    const period = params.month ? (params.month.length === 7 ? `${params.month}-01` : params.month) : null;
    return this.db.query<any>(
      `SELECT s.salary_pay_id AS "salaryPayId", s.employee_id AS "employeeId", e.name AS "employeeName",
              e.job_title AS "jobTitle", s.period_month AS "periodMonth", s.basic_salary AS "basicSalary",
              s.allowances, s.overtime_amount AS "overtimeAmount", s.deductions, s.bonus,
              s.insurance_employee AS "insuranceEmployee", s.insurance_employer AS "insuranceEmployer",
              s.advance_deduction AS "advanceDeduction", s.gross_pay AS "grossPay",
              s.net_pay AS "netPay", s.status, s.payment_date AS "paymentDate",
              s.gl_journal_id AS "glJournalId", s.payment_journal_id AS "paymentJournalId",
              s.created_at AS "createdAt"
         FROM salary_pays s JOIN employees e ON e.employee_id = s.employee_id
        WHERE ($1::int = 0 OR s.branch_id = $1)
          AND ($2::int = 0 OR s.employee_id = $2)
          AND ($3::date IS NULL OR s.period_month = $3::date)
        ORDER BY s.period_month DESC, e.name`,
      [params.branchId, params.employeeId ?? 0, period],
    );
  }

  async createSalaryPay(dto: any, user: AuthUser, branchId: number) {
    const periodMonth = String(dto.periodMonth ?? '').length === 7
      ? monthStart(String(dto.periodMonth)) : dto.periodMonth;
    const netPay = round2(
      Number(dto.basicSalary ?? 0) + Number(dto.allowances ?? 0) + Number(dto.overtimeAmount ?? 0)
      + Number(dto.bonus ?? 0) - Number(dto.deductions ?? 0)
      - Number(dto.insuranceEmployee ?? 0) - Number(dto.advanceDeduction ?? 0),
    );
    const row = await this.db.one<any>(
      `INSERT INTO salary_pays (employee_id, branch_id, period_month, basic_salary, allowances,
              overtime_amount, deductions, bonus, insurance_employee, insurance_employer,
              advance_deduction, gross_pay, net_pay, status, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING salary_pay_id AS "salaryPayId"`,
      [dto.employeeId, branchId, periodMonth, dto.basicSalary ?? 0, dto.allowances ?? 0,
       dto.overtimeAmount ?? 0, dto.deductions ?? 0, dto.bonus ?? 0,
       dto.insuranceEmployee ?? 0, dto.insuranceEmployer ?? 0, dto.advanceDeduction ?? 0,
       dto.grossPay ?? (Number(dto.basicSalary ?? 0) + Number(dto.allowances ?? 0)
         + Number(dto.overtimeAmount ?? 0) + Number(dto.bonus ?? 0)),
       netPay, dto.status ?? 1, user.userId],
    );
    return { ...row, netPay };
  }

  /**
   * Generates the whole month's payroll: components, overtime, unpaid leave,
   * insurance and open advances, then posts the accrual journal.
   */
  async generatePayroll(dto: any, user: AuthUser, branchId: number) {
    const period = monthStart(dto?.periodMonth);
    const end = monthEnd(dto?.periodMonth);
    const next = nextMonthStart(dto?.periodMonth);
    const insuranceEmployeePct = Number(await this.db.one<any>(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'InsuranceEmployeePct'`,
    ).then((row) => row?.setting_value ?? '0').catch(() => 0)) || 0;
    const insuranceEmployerPct = Number(await this.db.one<any>(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'InsuranceEmployerPct'`,
    ).then((row) => row?.setting_value ?? '0').catch(() => 0)) || 0;

    return this.db.transaction(async (client) => {
      const employees = await client.query<any>(
        `SELECT employee_id AS "employeeId", branch_id AS "branchId", name, basic_salary AS "basicSalary",
                allowances, deductions
           FROM employees
          WHERE is_active = true AND ($1::int = 0 OR branch_id = $1::int)
          ORDER BY employee_id`,
        [branchId],
      );
      if (!employees.rows.length) throw new BadRequestException('لا يوجد موظفون نشطون');

      const assignments = await client.query<any>(
        `SELECT ec.employee_id AS "employeeId", c.component_id AS "componentId", c.name,
                c.component_type AS "componentType", c.calc_type AS "calcType",
                COALESCE(ec.amount_override, c.amount) AS amount
           FROM employee_salary_components ec
           JOIN salary_components c ON c.component_id = ec.component_id
          WHERE ec.is_active = true AND c.is_active = true`,
      );
      const byEmployee = new Map<number, any[]>();
      for (const row of assignments.rows) {
        const key = Number(row.employeeId);
        if (!byEmployee.has(key)) byEmployee.set(key, []);
        byEmployee.get(key)!.push(row);
      }

      const attendance = await client.query<any>(
        `SELECT employee_id AS "employeeId", COALESCE(sum(overtime_minutes),0)::int AS "overtimeMinutes"
           FROM attendances
          WHERE work_date >= $1::date AND work_date < $2::date
          GROUP BY employee_id`,
        [period, next],
      );
      const overtimeByEmployee = new Map<number, number>(
        attendance.rows.map((row) => [Number(row.employeeId), Number(row.overtimeMinutes ?? 0)]),
      );

      const leaves = await client.query<any>(
        `SELECT employee_id AS "employeeId",
                COALESCE(sum((LEAST(end_date, $2::date) - GREATEST(start_date, $1::date)) + 1),0)::numeric AS days
           FROM leave_requests
          WHERE leave_type = 3 AND status = 2
            AND start_date <= $2::date AND end_date >= $1::date
          GROUP BY employee_id`,
        [period, end],
      );
      const unpaidByEmployee = new Map<number, number>(
        leaves.rows.map((row) => [Number(row.employeeId), Number(row.days ?? 0)]),
      );

      const salaryAccount = await requireMapping(client, 'SALARY_EXPENSE', 'مصروف المرتبات');
      const payableAccount = await requireMapping(client, 'SALARY_PAYABLE', 'مرتبات مستحقة');
      const advanceAccount = await requireMapping(client, 'EMPLOYEE_ADVANCE', 'سلف الموظفين');
      const insuranceAccount = await requireMapping(client, 'INSURANCE_PAYABLE', 'تأمينات مستحقة');
      const deductionAccount = await requireMapping(client, 'SALARY_DEDUCTION', 'خصومات وغرامات');

      let generated = 0;
      let skipped = 0;
      let zeroSalary = 0;
      let totalGross = 0;
      let totalNet = 0;

      for (const employee of employees.rows) {
        const employeeId = Number(employee.employeeId);
        const existing = await client.query<any>(
          `SELECT salary_pay_id, status, gl_journal_id FROM salary_pays
            WHERE employee_id = $1::int AND period_month = $2::date FOR UPDATE`,
          [employeeId, period],
        );
        if (existing.rows.length && Number(existing.rows[0].status) === 2) {
          skipped += 1;
          continue;
        }

        const basic = round2(Number(employee.basicSalary ?? 0));
        const lines: { componentId: number | null; name: string; lineType: number; amount: number }[] = [];
        let allowances = 0;
        let deductions = 0;
        for (const component of byEmployee.get(employeeId) ?? []) {
          const value = Number(component.calcType) === 2
            ? round2(basic * Number(component.amount ?? 0) / 100)
            : round2(Number(component.amount ?? 0));
          if (Number(component.componentType) === 1) {
            allowances = round2(allowances + value);
            lines.push({ componentId: Number(component.componentId), name: String(component.name), lineType: 1, amount: value });
          } else if (Number(component.componentType) === 2) {
            deductions = round2(deductions + value);
            lines.push({ componentId: Number(component.componentId), name: String(component.name), lineType: 2, amount: value });
          }
        }
        // The employee's own fixed allowances/deductions stay in the total.
        allowances = round2(allowances + Number(employee.allowances ?? 0));
        deductions = round2(deductions + Number(employee.deductions ?? 0));

        const hourlyRate = basic / Math.max(1, 30 * 8);
        const overtimeMinutes = overtimeByEmployee.get(employeeId) ?? 0;
        const overtimeAmount = round2((overtimeMinutes / 60) * hourlyRate);

        const unpaidDays = Math.min(30, unpaidByEmployee.get(employeeId) ?? 0);
        const unpaidAmount = round2((basic / 30) * unpaidDays);

        const insuranceEmployee = round2(basic * insuranceEmployeePct / 100);
        const insuranceEmployer = round2(basic * insuranceEmployerPct / 100);

        // Open advances are repaid by their monthly deduction.
        const advances = await client.query<any>(
          `SELECT advance_id, amount, deducted_amount, monthly_deduction
             FROM employee_advances
            WHERE employee_id = $1::int AND status = 1 AND (amount - deducted_amount) > 0
            ORDER BY advance_date, advance_id FOR UPDATE`,
          [employeeId],
        );
        let advanceDeduction = 0;
        const advanceDeductions: { advanceId: number; amount: number }[] = [];
        if (existing.rows.length) {
          // Re-generating a draft: give back what the previous draft deducted.
          const previous = await client.query<any>(
            `SELECT advance_id, amount FROM advance_deductions WHERE salary_pay_id = $1::bigint`,
            [existing.rows[0].salary_pay_id],
          );
          for (const row of previous.rows) {
            await client.query(
              `UPDATE employee_advances SET deducted_amount = GREATEST(0, deducted_amount - $2::numeric)
                WHERE advance_id = $1::bigint`,
              [row.advance_id, Number(row.amount)],
            );
          }
          await client.query(`DELETE FROM advance_deductions WHERE salary_pay_id = $1::bigint`,
            [existing.rows[0].salary_pay_id]);
        }
        for (const advance of advances.rows) {
          const remaining = round2(Number(advance.amount) - Number(advance.deducted_amount));
          if (remaining <= 0) continue;
          const monthly = Number(advance.monthly_deduction) > 0 ? Number(advance.monthly_deduction) : remaining;
          const take = round2(Math.min(remaining, monthly));
          if (take <= 0) continue;
          advanceDeduction = round2(advanceDeduction + take);
          advanceDeductions.push({ advanceId: Number(advance.advance_id), amount: take });
        }

        const gross = round2(basic + allowances + overtimeAmount);
        const net = round2(gross - deductions - unpaidAmount - insuranceEmployee - advanceDeduction);
        // A zero-net employee (no basic salary / deductions wipe it out) has nothing
        // to accrue and the accounting engine refuses zero-value journal lines.
        if (gross <= 0 || net <= 0) {
          zeroSalary += 1;
          continue;
        }
        totalGross = round2(totalGross + gross);
        totalNet = round2(totalNet + net);

        let salaryPayId: number;
        if (existing.rows.length) {
          salaryPayId = Number(existing.rows[0].salary_pay_id);
          await client.query(
            `UPDATE salary_pays SET basic_salary = $2, allowances = $3, overtime_amount = $4, deductions = $5,
                    insurance_employee = $6, insurance_employer = $7, advance_deduction = $8,
                    unpaid_leave_days = $9, gross_pay = $10, net_pay = $11, bonus = 0
              WHERE salary_pay_id = $1`,
            [salaryPayId, basic, allowances, overtimeAmount, deductions, insuranceEmployee, insuranceEmployer,
             advanceDeduction, unpaidDays, gross, net],
          );
          await client.query(`DELETE FROM salary_pay_lines WHERE salary_pay_id = $1`, [salaryPayId]);
        } else {
          const inserted = await client.query<any>(
            `INSERT INTO salary_pays (employee_id, branch_id, period_month, basic_salary, allowances,
                    overtime_amount, deductions, bonus, insurance_employee, insurance_employer,
                    advance_deduction, unpaid_leave_days, gross_pay, net_pay, status, created_by)
             VALUES ($1,$2,$3::date,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,1,$14)
             RETURNING salary_pay_id`,
            [employeeId, branchId || employee.branch_id, period, basic, allowances, overtimeAmount, deductions,
             insuranceEmployee, insuranceEmployer, advanceDeduction, unpaidDays, gross, net, user.userId],
          );
          salaryPayId = Number(inserted.rows[0].salary_pay_id);
        }

        const allLines = [
          { name: 'الراتب الأساسي', lineType: 1, amount: basic },
          ...lines,
          ...(overtimeAmount > 0 ? [{ name: 'وقت إضافي', lineType: 1, amount: overtimeAmount }] : []),
          ...(unpaidAmount > 0 ? [{ name: `إجازة غير مدفوعة (${unpaidDays} يوم)`, lineType: 2, amount: unpaidAmount }] : []),
          ...(insuranceEmployee > 0 ? [{ name: 'تأمينات الموظف', lineType: 2, amount: insuranceEmployee }] : []),
          ...(advanceDeduction > 0 ? [{ name: 'خصم سلفة', lineType: 2, amount: advanceDeduction }] : []),
        ];
        for (let index = 0; index < allLines.length; index += 1) {
          const line = allLines[index] as any;
          await client.query(
            `INSERT INTO salary_pay_lines (salary_pay_id, component_id, name, line_type, amount, sort_order)
             VALUES ($1::bigint,$2::int,$3::text,$4::smallint,$5::numeric,$6::int)`,
            [salaryPayId, line.componentId ?? null, line.name, line.lineType, line.amount, index + 1],
          );
        }
        for (const deduction of advanceDeductions) {
          await client.query(
            `INSERT INTO advance_deductions (advance_id, salary_pay_id, amount) VALUES ($1,$2,$3)`,
            [deduction.advanceId, salaryPayId, deduction.amount],
          );
          await client.query(
            `UPDATE employee_advances
                SET deducted_amount = deducted_amount + $2::numeric,
                    status = CASE WHEN deducted_amount + $2::numeric >= amount THEN 2 ELSE status END
              WHERE advance_id = $1::bigint`,
            [deduction.advanceId, deduction.amount],
          );
        }

        const journalLines: any[] = [
          { accountId: salaryAccount.accountId, debit: round2(gross + insuranceEmployer), description: `مرتبات ${period.slice(0, 7)}` },
          { accountId: payableAccount.accountId, credit: net, description: 'صافي مستحق' },
        ];
        const otherDeductions = round2(deductions + unpaidAmount);
        if (otherDeductions > 0) {
          journalLines.push({ accountId: deductionAccount.accountId, credit: otherDeductions, description: 'خصومات' });
        }
        if (advanceDeduction > 0) {
          journalLines.push({ accountId: advanceAccount.accountId, credit: advanceDeduction, description: 'خصم سلف' });
        }
        if (insuranceEmployee + insuranceEmployer > 0) {
          journalLines.push({
            accountId: insuranceAccount.accountId,
            credit: round2(insuranceEmployee + insuranceEmployer),
            description: 'تأمينات',
          });
        }
        // Re-generating a draft replaces its journal instead of stacking them.
        if (existing.rows.length && existing.rows[0].gl_journal_id) {
          const old = await client.query<any>(`SELECT status FROM gl_journals WHERE journal_id = $1`,
            [existing.rows[0].gl_journal_id]);
          if (old.rows.length && Number(old.rows[0].status) === 2) {
            throw new BadRequestException('المرتب مرحّل بقيد مرحّل بالفعل — لا يمكن إعادة توليده');
          }
          await client.query(`DELETE FROM gl_entries WHERE journal_id = $1`, [existing.rows[0].gl_journal_id]);
          await client.query(`DELETE FROM gl_journals WHERE journal_id = $1`, [existing.rows[0].gl_journal_id]);
        }
        const journalId = await postJournal(client, {
          branchId: branchId || Number(employee.branch_id),
          journalDate: period,
          description: `استحقاق مرتبات ${period.slice(0, 7)} — ${employee.name}`,
          sourceType: 'salary_pay', sourceId: salaryPayId, userId: user.userId, autoBalance: true,
          lines: journalLines,
        });
        await client.query(`UPDATE salary_pays SET gl_journal_id = $2 WHERE salary_pay_id = $1`,
          [salaryPayId, journalId]);
        generated += 1;
      }

      return { periodMonth: period.slice(0, 7), generated, skipped, zeroSalary, totalGross, totalNet };
    });
  }

  /** Marks drafts as paid and posts Dr Salaries Payable / Cr Cash. */
  async payPayroll(dto: any, user: AuthUser, branchId: number) {
    const cashAccountId = Number(dto?.cashAccountId);
    if (!cashAccountId) throw new BadRequestException('اختر صندوق صرف المرتبات');
    const period = dto?.periodMonth ? monthStart(dto.periodMonth) : null;
    const ids: number[] = Array.isArray(dto?.salaryPayIds)
      ? dto.salaryPayIds.map(Number).filter((id) => id > 0) : [];
    return this.db.transaction(async (client) => {
      const payable = await requireMapping(client, 'SALARY_PAYABLE', 'مرتبات مستحقة');
      const cashGl = await cashAccountGlId(client, cashAccountId);
      if (!cashGl) throw new BadRequestException('صندوق الصرف غير مربوط بحساب محاسبي');
      const rows = await client.query<any>(
        `SELECT salary_pay_id AS "salaryPayId", net_pay AS "netPay", period_month AS "periodMonth", branch_id AS "branchId"
           FROM salary_pays
          WHERE status = 1
            AND ($1::int = 0 OR branch_id = $1::int)
            AND ($2::date IS NULL OR period_month = $2::date)
            AND (cardinality($3::int[]) = 0 OR salary_pay_id = ANY($3::int[]))
          FOR UPDATE`,
        [branchId, period, ids],
      );
      if (!rows.rows.length) throw new BadRequestException('لا توجد مرتبات مسودة للصرف');
      let paid = 0;
      let total = 0;
      for (const row of rows.rows) {
        const net = round2(Number(row.netPay));
        if (net <= 0) continue;
        const journalId = await postJournal(client, {
          branchId: Number(row.branchId),
          journalDate: new Date().toISOString().slice(0, 10),
          description: `صرف مرتبات ${String(row.periodMonth).slice(0, 7)}`,
          sourceType: 'salary_payment', sourceId: Number(row.salaryPayId), userId: user.userId, autoBalance: true,
          lines: [
            { accountId: payable.accountId, debit: net, description: 'صرف مستحقات' },
            { accountId: cashGl, credit: net, description: 'صرف من الخزينة' },
          ],
        });
        await client.query(
          `UPDATE salary_pays SET status = 2, payment_date = CURRENT_DATE, cash_account_id = $2,
                  payment_journal_id = $3, paid_by = $4
            WHERE salary_pay_id = $1`,
          [row.salaryPayId, cashAccountId, journalId, user.userId],
        );
        paid += 1;
        total = round2(total + net);
      }
      return { paid, total };
    });
  }

  async getPayslip(id: number) {
    const salary = await this.db.one<any>(
      `SELECT s.salary_pay_id AS "salaryPayId", s.employee_id AS "employeeId", e.name AS "employeeName",
              e.code AS "employeeCode", e.job_title AS "jobTitle", d.name AS "departmentName",
              s.period_month AS "periodMonth", s.basic_salary AS "basicSalary", s.allowances,
              s.overtime_amount AS "overtimeAmount", s.deductions, s.bonus,
              s.insurance_employee AS "insuranceEmployee", s.insurance_employer AS "insuranceEmployer",
              s.advance_deduction AS "advanceDeduction", s.unpaid_leave_days AS "unpaidLeaveDays",
              s.gross_pay AS "grossPay", s.net_pay AS "netPay", s.status,
              s.payment_date AS "paymentDate", s.gl_journal_id AS "glJournalId",
              s.payment_journal_id AS "paymentJournalId", b.name AS "branchName"
         FROM salary_pays s
         JOIN employees e ON e.employee_id = s.employee_id
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN branches b ON b.branch_id = s.branch_id
        WHERE s.salary_pay_id = $1`,
      [id],
    );
    if (!salary) throw new BadRequestException('المرتب غير موجود');
    const lines = await this.db.query<any>(
      `SELECT name, line_type AS "lineType", amount FROM salary_pay_lines
        WHERE salary_pay_id = $1 ORDER BY sort_order, salary_pay_line_id`, [id],
    );
    return { ...salary, lines };
  }

  async updateSalaryPayStatus(id: number, status: number) {
    if (![1, 2].includes(Number(status))) throw new BadRequestException('حالة المرتب غير صحيحة');
    await this.db.query(`UPDATE salary_pays SET status = $2 WHERE salary_pay_id = $1`, [id, status]);
    return { salaryPayId: id, status };
  }

  // ---------------------------------------------------------------- HR reports
  async payrollSummary(branchId: number, month?: string) {
    const period = month ? monthStart(month) : null;
    const rows = await this.db.query<any>(
      `SELECT to_char(period_month, 'YYYY-MM') AS "month",
              count(*)::int AS "employees",
              count(*) FILTER (WHERE status = 2)::int AS "paidCount",
              COALESCE(sum(gross_pay),0) AS "totalGross",
              COALESCE(sum(net_pay),0) AS "totalNet",
              COALESCE(sum(deductions),0) AS "totalDeductions",
              COALESCE(sum(insurance_employee + insurance_employer),0) AS "totalInsurance",
              COALESCE(sum(advance_deduction),0) AS "totalAdvances"
         FROM salary_pays
        WHERE ($1::int = 0 OR branch_id = $1)
          AND ($2::date IS NULL OR period_month = $2::date)
        GROUP BY period_month ORDER BY period_month DESC`,
      [branchId, period],
    );
    return { items: rows, totals: rows.reduce((acc: any, row: any) => ({
      employees: acc.employees + Number(row.employees),
      totalGross: round2(acc.totalGross + Number(row.totalGross)),
      totalNet: round2(acc.totalNet + Number(row.totalNet)),
    }), { employees: 0, totalGross: 0, totalNet: 0 }) };
  }
  async attendanceSummary(params: { branchId: number; from?: string; to?: string }) {
    return this.db.query<any>(
      `SELECT e.employee_id AS "employeeId", e.name AS "employeeName",
              count(*) FILTER (WHERE a.status = 1)::int AS "presentDays",
              count(*) FILTER (WHERE a.status = 2)::int AS "absentDays",
              count(*) FILTER (WHERE a.status = 3)::int AS "leaveDays",
              COALESCE(sum(a.overtime_minutes),0)::int AS "overtimeMinutes",
              COALESCE(sum(a.late_minutes),0)::int AS "lateMinutes"
         FROM attendances a JOIN employees e ON e.employee_id = a.employee_id
        WHERE ($1::int = 0 OR a.branch_id = $1)
          AND ($2::date IS NULL OR a.work_date >= $2::date)
          AND ($3::date IS NULL OR a.work_date <= $3::date)
        GROUP BY e.employee_id, e.name ORDER BY e.name`,
      [params.branchId, params.from ?? null, params.to ?? null],
    );
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
  @RequirePermissions('hr.manage')
  @Delete('departments/:id') removeDepartment(@Param('id', ParseIntPipe) id: number) { return this.service.removeDepartment(id); }

  @RequirePermissions('hr.view')
  @Get('employees') listEmployees(@CurrentBranch() branchId: number, @Query('search') search: string) { return this.service.listEmployees(branchId, search); }
  @RequirePermissions('hr.view')
  @Get('employees/:id') getEmployee(@Param('id', ParseIntPipe) id: number) { return this.service.getEmployee(id); }
  @RequirePermissions('hr.manage')
  @Post('employees') createEmployee(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.createEmployee(dto, branchId); }
  @RequirePermissions('hr.manage')
  @Put('employees/:id') updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateEmployee(id, dto); }
  @RequirePermissions('hr.view')
  @Get('employees/:id/components') listEmployeeComponents(@Param('id', ParseIntPipe) id: number) { return this.service.listEmployeeComponents(id); }
  @RequirePermissions('hr.manage')
  @Put('employees/:id/components') setEmployeeComponents(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.setEmployeeComponents(id, dto); }

  @RequirePermissions('hr.view')
  @Get('components') listComponents() { return this.service.listComponents(); }
  @RequirePermissions('hr.manage')
  @Post('components') createComponent(@Body() dto: any) { return this.service.createComponent(dto); }
  @RequirePermissions('hr.manage')
  @Put('components/:id') updateComponent(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateComponent(id, dto); }
  @RequirePermissions('hr.manage')
  @Delete('components/:id') removeComponent(@Param('id', ParseIntPipe) id: number) { return this.service.removeComponent(id); }

  @RequirePermissions('hr.view')
  @Get('attendance') listAttendance(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.listAttendance({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, from, to });
  }
  @RequirePermissions('hr.manage')
  @Post('attendance') upsertAttendance(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.upsertAttendance(dto, branchId); }
  @RequirePermissions('hr.manage')
  @Post('attendance/import') importAttendance(@Body() dto: any, @CurrentBranch() branchId: number) { return this.service.importAttendance(dto, branchId); }

  @RequirePermissions('hr.view')
  @Get('leaves') listLeaves(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('status') status: string) {
    return this.service.listLeaves({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, status: status ? Number(status) : undefined });
  }
  @RequirePermissions('hr.manage')
  @Post('leaves') createLeave(@Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.createLeave(dto, user); }
  @RequirePermissions('hr.manage')
  @Put('leaves/:id/status') updateLeaveStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateLeaveStatus(id, dto.status); }

  @RequirePermissions('hr.view')
  @Get('advances') listAdvances(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('status') status: string) {
    return this.service.listAdvances({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, status: status ? Number(status) : undefined });
  }
  @RequirePermissions('hr.manage')
  @Post('advances') createAdvance(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.createAdvance(dto, user, branchId); }
  @RequirePermissions('hr.manage')
  @Post('advances/:id/pay') payAdvance(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser) { return this.service.payAdvance(id, dto, user); }
  @RequirePermissions('hr.manage')
  @Delete('advances/:id') cancelAdvance(@Param('id', ParseIntPipe) id: number) { return this.service.cancelAdvance(id); }

  @RequirePermissions('hr.view')
  @Get('salaries') listSalaryPays(@CurrentBranch() branchId: number, @Query('employeeId') employeeId: string, @Query('month') month: string) {
    return this.service.listSalaryPays({ branchId, employeeId: employeeId ? Number(employeeId) : undefined, month });
  }
  @RequirePermissions('hr.view')
  @Get('salaries/:id/payslip') getPayslip(@Param('id', ParseIntPipe) id: number) { return this.service.getPayslip(id); }
  @RequirePermissions('hr.manage')
  @Post('salary') createSalaryPay(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.createSalaryPay(dto, user, branchId); }
  @RequirePermissions('hr.manage')
  @Post('payroll/generate') generatePayroll(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.generatePayroll(dto, user, branchId); }
  @RequirePermissions('hr.manage')
  @Post('payroll/pay') payPayroll(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) { return this.service.payPayroll(dto, user, branchId); }
  @RequirePermissions('hr.manage')
  @Put('salaries/:id/status') updateSalaryPayStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.updateSalaryPayStatus(id, dto.status); }

  @RequirePermissions('hr.view')
  @Get('reports/payroll-summary') payrollSummary(@CurrentBranch() branchId: number, @Query('month') month: string) { return this.service.payrollSummary(branchId, month); }
  @RequirePermissions('hr.view')
  @Get('reports/attendance-summary') attendanceSummary(@CurrentBranch() branchId: number, @Query('from') from: string, @Query('to') to: string) {
    return this.service.attendanceSummary({ branchId, from, to });
  }
}

@Module({
  providers: [HrService],
  controllers: [HrController],
})
export class HrModule {}
