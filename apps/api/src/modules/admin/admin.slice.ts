import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, BadRequestException, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequireAnyPermission, RequirePermissions, hashPassword } from '../../common/security';
import { logActivity } from '../../common/audit';

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  // ---------------- branches ---------------- //
  async branches() {
    return this.db.query(
      `SELECT branch_id AS "branchId", code, name, name_en AS "nameEn", address, city, phone,
              tax_number AS "taxNumber", is_active AS "isActive", notes
         FROM branches ORDER BY branch_id`,
    );
  }

  async createBranch(body: any) {
    try {
      const row = await this.db.one<any>(
        `INSERT INTO branches (code, name, name_en, address, city, phone, tax_number, is_active, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING branch_id`,
        [body.code, body.name, body.nameEn ?? null, body.address ?? null, body.city ?? null, body.phone ?? null,
          body.taxNumber ?? null, body.isActive ?? true, body.notes ?? null],
      );
      return { branchId: Number(row.branch_id) };
    } catch (error: any) {
      if (error?.code === '23505') throw new BadRequestException('الكود مستخدم من قبل لفرع آخر — اختر كودًا مختلفًا');
      throw error;
    }
  }

  async updateBranch(id: number, body: any) {
    try {
      await this.db.query(
        `UPDATE branches SET code=$2, name=$3, name_en=$4, address=$5, city=$6, phone=$7, tax_number=$8,
                is_active=$9, notes=$10 WHERE branch_id=$1`,
        [id, body.code, body.name, body.nameEn ?? null, body.address ?? null, body.city ?? null, body.phone ?? null,
          body.taxNumber ?? null, body.isActive ?? true, body.notes ?? null],
      );
    } catch (error: any) {
      if (error?.code === '23505') throw new BadRequestException('الكود مستخدم من قبل لفرع آخر — اختر كودًا مختلفًا');
      throw error;
    }
    return { branchId: id };
  }

  // ---------------- users ---------------- //
  async users() {
    const users = await this.db.query(
      `SELECT u.user_id AS "userId", u.user_name AS "userName", u.full_name AS "fullName", u.email, u.phone,
              u.is_active AS "isActive", u.is_cashier AS "isCashier", u.is_sales_rep AS "isSalesRep",
              u.commission_pct AS "commissionPct",
              u.default_branch_id AS "defaultBranchId", u.max_discount_pct AS "maxDiscountPct",
              u.last_login_at AS "lastLoginAt",
              COALESCE((SELECT json_agg(r.name) FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id
                         WHERE ur.user_id = u.user_id), '[]'::json) AS roles
         FROM users u ORDER BY u.full_name`,
    );
    return users;
  }

  async createUser(body: any) {
    if (!body.userName || !body.password) throw new BadRequestException('اسم المستخدم وكلمة المرور مطلوبان');
    const { hash, salt } = hashPassword(body.password);
    const row = await this.db.one<any>(
      `INSERT INTO users (user_name, full_name, password_hash, password_salt, email, phone, default_branch_id,
                          max_discount_pct, is_active, is_cashier, is_sales_rep, commission_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING user_id`,
      [body.userName, body.fullName ?? body.userName, hash, salt, body.email ?? null, body.phone ?? null,
        body.defaultBranchId ?? null, Number(body.maxDiscountPct ?? 0), body.isActive ?? true,
        body.isCashier ?? false, body.isSalesRep ?? false, Number(body.commissionPct ?? 0)],
    );
    const userId = Number(row.user_id);
    if (body.roleIds?.length) {
      for (const roleId of body.roleIds) {
        await this.db.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [userId, roleId],
        );
      }
    }
    return { userId };
  }

  async updateUser(id: number, body: any) {
    await this.db.query(
      `UPDATE users SET full_name=$2, email=$3, phone=$4, default_branch_id=$5, max_discount_pct=$6,
              is_active=$7, is_cashier=$8, is_sales_rep=$9, commission_pct=$10 WHERE user_id=$1`,
      [id, body.fullName, body.email ?? null, body.phone ?? null, body.defaultBranchId ?? null,
        Number(body.maxDiscountPct ?? 0), body.isActive ?? true, body.isCashier ?? false, body.isSalesRep ?? false,
        Number(body.commissionPct ?? 0)],
    );
    if (body.password) {
      const { hash, salt } = hashPassword(body.password);
      await this.db.query('UPDATE users SET password_hash=$2, password_salt=$3 WHERE user_id=$1', [id, hash, salt]);
    }
    if (body.roleIds) {
      await this.db.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
      for (const roleId of body.roleIds) {
        await this.db.query(
          'INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [id, roleId],
        );
      }
    }
    return { userId: id };
  }

  async setUserBranches(id: number, branchIds: number[]) {
    await this.db.query('DELETE FROM user_branches WHERE user_id = $1', [id]);
    for (const branchId of branchIds ?? []) {
      await this.db.query(
        'INSERT INTO user_branches (user_id, branch_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [id, branchId],
      );
    }
    return { userId: id, branchCount: (branchIds ?? []).length };
  }

  // ---------------- user scope restrictions (P7) ---------------- //
  async restrictionOptions() {
    const warehouses = await this.db.query(
      `SELECT w.warehouse_id AS "warehouseId", w.code, w.name, w.is_active AS "isActive",
              b.branch_id AS "branchId", b.name AS "branchName"
         FROM warehouses w JOIN branches b ON b.branch_id = w.branch_id
        ORDER BY b.branch_id, w.name`,
    );
    const cashAccounts = await this.db.query(
      `SELECT c.cash_account_id AS "cashAccountId", c.name, c.type, c.is_active AS "isActive",
              b.branch_id AS "branchId", b.name AS "branchName"
         FROM cash_accounts c JOIN branches b ON b.branch_id = c.branch_id
        ORDER BY b.branch_id, c.name`,
    );
    return { warehouses, cashAccounts };
  }

  async userRestrictions(id: number) {
    const warehouseRows = await this.db.query(
      'SELECT warehouse_id AS "warehouseId" FROM user_warehouses WHERE user_id = $1::int ORDER BY warehouse_id',
      [id],
    );
    const cashRows = await this.db.query(
      'SELECT cash_account_id AS "cashAccountId" FROM user_cash_accounts WHERE user_id = $1::int ORDER BY cash_account_id',
      [id],
    );
    return {
      warehouseIds: warehouseRows.map((r: any) => Number(r.warehouseId)),
      cashAccountIds: cashRows.map((r: any) => Number(r.cashAccountId)),
    };
  }

  async setUserRestrictions(id: number, body: any, actor: AuthUser, ip: string) {
    const clean = (list: any) =>
      [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
    const warehouseIds = clean(body?.warehouseIds);
    const cashAccountIds = clean(body?.cashAccountIds);

    const target = await this.db.one<any>('SELECT user_id FROM users WHERE user_id = $1::int', [id]);
    if (!target) throw new BadRequestException('المستخدم غير موجود');

    return this.db.transaction(async (client) => {
      await client.query('DELETE FROM user_warehouses WHERE user_id = $1::int', [id]);
      for (const warehouseId of warehouseIds) {
        await client.query(
          'INSERT INTO user_warehouses (user_id, warehouse_id) VALUES ($1::int,$2::int) ON CONFLICT DO NOTHING',
          [id, warehouseId],
        );
      }
      await client.query('DELETE FROM user_cash_accounts WHERE user_id = $1::int', [id]);
      for (const cashAccountId of cashAccountIds) {
        await client.query(
          'INSERT INTO user_cash_accounts (user_id, cash_account_id) VALUES ($1::int,$2::int) ON CONFLICT DO NOTHING',
          [id, cashAccountId],
        );
      }
      await logActivity(client, { userId: actor.userId, branchId: null, action: 'user.restrictions',
        entity: 'user', entityId: String(id),
        details: `تقييد القوائم — مخازن: ${warehouseIds.length}، صناديق/خزائن: ${cashAccountIds.length} (الفاضي = الكل مسموح)`, ip });
      return { userId: id, warehouseCount: warehouseIds.length, cashAccountCount: cashAccountIds.length };
    });
  }

  // ---------------- roles & permissions ---------------- //
  async roles() {
    const roles = await this.db.query(
      `SELECT role_id AS "roleId", name, name_en AS "nameEn", is_system AS "isSystem" FROM roles ORDER BY role_id`,
    );
    for (const role of roles) {
      role.permissions = (
        await this.db.query<{ code: string }>(
          `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.permission_id = rp.permission_id
            WHERE rp.role_id = $1 ORDER BY p.code`,
          [role.roleId],
        )
      ).map((p) => p.code);
    }
    return roles;
  }

  async permissions() {
    return this.db.query(
      `SELECT permission_id AS "permissionId", code, module, name FROM permissions ORDER BY module, code`,
    );
  }

  async setRolePermissions(roleId: number, codes: string[]) {
    await this.db.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const code of codes ?? []) {
      await this.db.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, permission_id FROM permissions WHERE code = $2 ON CONFLICT DO NOTHING`,
        [roleId, code],
      );
    }
    return { roleId, permissionCount: (codes ?? []).length };
  }

  // ---------------- settings ---------------- //
  async settings() {
    const rows = await this.db.query('SELECT setting_key, setting_value FROM app_settings ORDER BY setting_key');
    const map: Record<string, string> = {};
    for (const row of rows) map[row.setting_key] = row.setting_value;
    return map;
  }

  async updateSettings(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values ?? {})) {
      await this.db.query(
        `INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ($1,$2, now())
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
        [key, value ?? null],
      );
    }
    return this.settings();
  }

  // ---------------- audit ---------------- //
  async audit(limit: number, action?: string, userId?: number, from?: string, to?: string, search?: string) {
    const params: any[] = [];
    const where: string[] = [];
    const put = (value: any, cast = 'text') => {
      params.push(value);
      return `$${params.length}::${cast}`;
    };
    if (action && action.trim()) where.push(`a.action = ${put(action.trim())}`);
    if (userId && Number(userId) > 0) where.push(`a.user_id = ${put(Number(userId), 'int')}`);
    if (from) where.push(`a.created_at::date >= ${put(from, 'date')}`);
    if (to) where.push(`a.created_at::date <= ${put(to, 'date')}`);
    if (search && search.trim()) {
      const like = `%${search.trim()}%`;
      const idx = params.length + 1;
      params.push(like);
      where.push(`(a.details ILIKE $${idx} OR COALESCE(a.entity,'') ILIKE $${idx} OR COALESCE(a.entity_id,'') ILIKE $${idx} OR a.action ILIKE $${idx})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.query(
      `SELECT a.activity_log_id AS "activityLogId", a.created_at AS "createdAt", a.action, a.entity,
              a.entity_id AS "entityId", a.details, a.user_id AS "userId", u.full_name AS "userName", b.name AS "branchName"
         FROM activity_log a
         LEFT JOIN users u ON u.user_id = a.user_id
         LEFT JOIN branches b ON b.branch_id = a.branch_id
         ${whereSql}
         ORDER BY a.activity_log_id DESC LIMIT ${put(Math.min(Math.max(Number(limit) || 200, 1), 1000), 'int')}`,
      params,
    );
  }

  // ---------------- attachment policies (GAP-08) ---------------- //
  async attachmentPolicies() {
    return this.db.query(
      `SELECT entity_type AS "entityType", max_size_mb AS "maxSizeMb", max_count_per_entity AS "maxCountPerEntity",
              updated_by AS "updatedBy", updated_at AS "updatedAt"
         FROM attachment_policies ORDER BY entity_type`,
    );
  }

  async updateAttachmentPolicy(entityType: string, body: any, actor: AuthUser, ip: string) {
    const type = String(entityType ?? '').trim();
    const maxSizeMb = Math.trunc(Number(body?.maxSizeMb ?? body?.max_size_mb));
    const maxCount = Math.trunc(Number(body?.maxCountPerEntity ?? body?.max_count_per_entity));
    if (!type) throw new BadRequestException('نوع الكيان مطلوب');
    if (!Number.isFinite(maxSizeMb) || maxSizeMb < 1 || maxSizeMb > 100) {
      throw new BadRequestException('الحد الأقصى للحجم يجب أن يكون بين 1 و100 ميجابايت');
    }
    if (!Number.isFinite(maxCount) || maxCount < 1) {
      throw new BadRequestException('الحد الأقصى لعدد المرفقات يجب أن يكون 1 على الأقل');
    }
    return this.db.transaction(async (client) => {
      const exists = await client.query<any>(
        'SELECT 1 FROM attachment_policies WHERE entity_type = $1::text',
        [type],
      );
      if (!exists.rows.length) throw new BadRequestException('نوع الكيان غير معروف في سياسات المرفقات');
      await client.query(
        `UPDATE attachment_policies
            SET max_size_mb = $2::int, max_count_per_entity = $3::int, updated_by = $4::int, updated_at = now()
          WHERE entity_type = $1::text`,
        [type, maxSizeMb, maxCount, actor.userId],
      );
      await logActivity(client, { userId: actor.userId, branchId: null, action: 'attachment_policy.update',
        entity: 'attachment_policy', entityId: type,
        details: `تحديث سياسة المرفقات (${type}): الحجم ${maxSizeMb}MB، العدد ${maxCount}`, ip });
      const row = await client.query<any>(
        `SELECT entity_type AS "entityType", max_size_mb AS "maxSizeMb", max_count_per_entity AS "maxCountPerEntity",
                updated_by AS "updatedBy", updated_at AS "updatedAt"
           FROM attachment_policies WHERE entity_type = $1::text`,
        [type],
      );
      return row.rows[0];
    });
  }

  /** Read-only diagnostics for the support team — Tools → «بيانات الدعم الفني». */
  async supportInfo() {
    const dbInfo = await this.db.one<any>(
      `SELECT version() AS version, current_database() AS name`,
    );
    const size = await this.db.one<any>(
      `SELECT pg_database_size(current_database()) AS size`,
    );
    const tables = await this.db.one<any>(
      `SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    const counts: any = await this.db.one<any>(
      `SELECT (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM items) AS items,
              (SELECT count(*)::int FROM parties) AS parties,
              (SELECT count(*)::int FROM invoices) AS invoices,
              (SELECT count(*)::int FROM attachments) AS attachments,
              (SELECT coalesce(sum(file_size),0)::bigint FROM attachments) AS attachment_bytes,
              (SELECT count(*)::int FROM app_settings) AS settings`,
    ) ?? {};
    return {
      appVersion: process.env.npm_package_version ?? '1.0.0',
      nodeVersion: process.version,
      dbName: String(dbInfo?.name ?? ''),
      dbVersion: String(dbInfo?.version ?? ''),
      dbSizeBytes: Number(size?.size ?? 0),
      tables: Number(tables?.c ?? 0),
      users: Number(counts.users ?? 0),
      items: Number(counts.items ?? 0),
      parties: Number(counts.parties ?? 0),
      invoices: Number(counts.invoices ?? 0),
      attachments: Number(counts.attachments ?? 0),
      attachmentBytes: Number(counts.attachment_bytes ?? 0),
      settingsKeys: Number(counts.settings ?? 0),
      uptimeSeconds: Math.floor(process.uptime()),
      serverTime: new Date().toISOString(),
      isEmbeddedPglite: String(dbInfo?.version ?? '').toLowerCase().includes('pglite'),
    };
  }
}

@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @RequirePermissions('users.manage')
  @Get('branches')
  branches() {
    return this.service.branches();
  }

  @RequirePermissions('users.manage')
  @Post('branches')
  createBranch(@Body() body: any) {
    return this.service.createBranch(body);
  }

  @RequirePermissions('users.manage')
  @Put('branches/:id')
  updateBranch(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateBranch(id, body);
  }

  @RequirePermissions('users.manage')
  @Get('users')
  users() {
    return this.service.users();
  }

  @RequirePermissions('users.manage')
  @Post('users')
  createUser(@Body() body: any, @CurrentUser() actor: AuthUser) {
    return this.service.createUser(body);
  }

  @RequirePermissions('users.manage')
  @Put('users/:id')
  updateUser(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateUser(id, body);
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/branches')
  setUserBranches(@Param('id', ParseIntPipe) id: number, @Body() body: { branchIds: number[] }) {
    return this.service.setUserBranches(id, body.branchIds ?? []);
  }

  @RequirePermissions('users.manage')
  @Get('restrictions/options')
  restrictionOptions() {
    return this.service.restrictionOptions();
  }

  @RequirePermissions('users.manage')
  @Get('users/:id/restrictions')
  userRestrictions(@Param('id', ParseIntPipe) id: number) {
    return this.service.userRestrictions(id);
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/restrictions')
  setUserRestrictions(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.setUserRestrictions(id, body, actor, ip);
  }

  @RequirePermissions('users.manage')
  @Get('roles')
  roles() {
    return this.service.roles();
  }

  @RequirePermissions('users.manage')
  @Get('permissions')
  permissions() {
    return this.service.permissions();
  }

  @RequirePermissions('users.manage')
  @Put('roles/:id/permissions')
  setRolePermissions(@Param('id', ParseIntPipe) id: number, @Body() body: { codes: string[] }) {
    return this.service.setRolePermissions(id, body.codes ?? []);
  }

  @RequirePermissions('settings.manage')
  @Get('settings')
  settings() {
    return this.service.settings();
  }

  @RequirePermissions('settings.manage')
  @Put('settings')
  updateSettings(@Body() body: Record<string, string>) {
    return this.service.updateSettings(body);
  }

  /** Tools → «بيانات الدعم الفني» — read-only diagnostics, no secrets. */
  @RequirePermissions('settings.manage')
  @Get('support-info')
  supportInfo() {
    return this.service.supportInfo();
  }

  @RequirePermissions('admin.manage_attachments')
  @Get('attachment-policies')
  attachmentPolicies() {
    return this.service.attachmentPolicies();
  }

  @RequirePermissions('admin.manage_attachments')
  @Put('attachment-policies/:entityType')
  updateAttachmentPolicy(
    @Param('entityType') entityType: string,
    @Body() body: any,
    @CurrentUser() actor: AuthUser,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.updateAttachmentPolicy(entityType, body, actor, ip);
  }

  @RequireAnyPermission('settings.manage', 'users.manage')
  @Get('audit')
  audit(
    @Query('limit') limit: string,
    @Query('action') action: string,
    @Query('userId') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('search') search: string,
  ) {
    return this.service.audit(
      Math.min(Math.max(Number(limit) || 200, 1), 1000),
      action,
      userId ? Number(userId) : undefined,
      from,
      to,
      search,
    );
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
