import {
  Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentUser, RequireAnyPermission, RequirePermissions, hashPassword } from '../../common/security';

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
    const row = await this.db.one<any>(
      `INSERT INTO branches (code, name, name_en, address, city, phone, tax_number, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING branch_id`,
      [body.code, body.name, body.nameEn ?? null, body.address ?? null, body.city ?? null, body.phone ?? null,
        body.taxNumber ?? null, body.isActive ?? true, body.notes ?? null],
    );
    return { branchId: Number(row.branch_id) };
  }

  async updateBranch(id: number, body: any) {
    await this.db.query(
      `UPDATE branches SET code=$2, name=$3, name_en=$4, address=$5, city=$6, phone=$7, tax_number=$8,
              is_active=$9, notes=$10 WHERE branch_id=$1`,
      [id, body.code, body.name, body.nameEn ?? null, body.address ?? null, body.city ?? null, body.phone ?? null,
        body.taxNumber ?? null, body.isActive ?? true, body.notes ?? null],
    );
    return { branchId: id };
  }

  // ---------------- users ---------------- //
  async users() {
    const users = await this.db.query(
      `SELECT u.user_id AS "userId", u.user_name AS "userName", u.full_name AS "fullName", u.email, u.phone,
              u.is_active AS "isActive", u.is_cashier AS "isCashier", u.is_sales_rep AS "isSalesRep",
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
                          max_discount_pct, is_active, is_cashier, is_sales_rep)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING user_id`,
      [body.userName, body.fullName ?? body.userName, hash, salt, body.email ?? null, body.phone ?? null,
        body.defaultBranchId ?? null, Number(body.maxDiscountPct ?? 0), body.isActive ?? true,
        body.isCashier ?? false, body.isSalesRep ?? false],
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
              is_active=$7, is_cashier=$8, is_sales_rep=$9 WHERE user_id=$1`,
      [id, body.fullName, body.email ?? null, body.phone ?? null, body.defaultBranchId ?? null,
        Number(body.maxDiscountPct ?? 0), body.isActive ?? true, body.isCashier ?? false, body.isSalesRep ?? false],
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
  async audit(limit: number, action?: string) {
    return this.db.query(
      `SELECT a.activity_log_id AS "activityLogId", a.created_at AS "createdAt", a.action, a.entity,
              a.entity_id AS "entityId", a.details, u.full_name AS "userName", b.name AS "branchName"
         FROM activity_log a
         LEFT JOIN users u ON u.user_id = a.user_id
         LEFT JOIN branches b ON b.branch_id = a.branch_id
        WHERE ($1::text = '' OR a.action = $1)
        ORDER BY a.activity_log_id DESC LIMIT $2`,
      [action ?? '', limit],
    );
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

  @RequireAnyPermission('settings.manage', 'users.manage')
  @Get('audit')
  audit(@Query('limit') limit: string, @Query('action') action: string) {
    return this.service.audit(Math.min(Number(limit) || 100, 1000), action);
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
