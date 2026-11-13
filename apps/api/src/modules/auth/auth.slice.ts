import { Body, Controller, Get, Injectable, Module, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../../common/database/database.service';
import {
  AuthUser,
  CurrentUser,
  Public,
  hashPassword,
  verifyPassword,
} from '../../common/security';

export interface LoginDto {
  userName: string;
  password: string;
  branchId?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const row = await this.db.one<any>(
      `SELECT user_id, user_name, full_name, default_branch_id, password_hash, password_salt,
              is_cashier, is_sales_rep, max_discount_pct, is_active
         FROM users WHERE lower(user_name) = lower($1)`,
      [dto.userName ?? ''],
    );

    if (!row || !row.is_active || !verifyPassword(dto.password ?? '', row.password_hash, row.password_salt)) {
      throw new UnauthorizedException('اسم المستخدم أو كلمة المرور غير صحيحة');
    }

    const permissions = (
      await this.db.query<{ code: string }>(
        `SELECT DISTINCT p.code
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE ur.user_id = $1`,
        [row.user_id],
      )
    ).map((r) => r.code);

    const branchRows = await this.db.query<{ branch_id: number; code: string; name: string }>(
      `SELECT b.branch_id, b.code, b.name
         FROM branches b
        WHERE b.is_active = true
          AND (EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = $1 AND ub.branch_id = b.branch_id)
               OR NOT EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = $1))
        ORDER BY b.branch_id`,
      [row.user_id],
    );

    const branchIds = branchRows.map((b) => b.branch_id);
    const activeBranch =
      dto.branchId && branchIds.includes(dto.branchId)
        ? dto.branchId
        : row.default_branch_id ?? branchIds[0] ?? null;

    const secret = this.config.get<string>('JWT_SECRET') ?? 'wasel-dev-secret-change-me';
    const expiresIn = this.config.get<string>('JWT_EXPIRES') ?? '15m';
    const accessToken = await this.jwt.signAsync(
      {
        sub: row.user_id,
        name: row.full_name,
        branch: activeBranch,
        perms: permissions,
        branches: branchIds,
      },
      { secret, expiresIn },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: row.user_id, name: row.full_name, typ: 'refresh' },
      { secret, expiresIn: '7d' },
    );

    await this.db.query('UPDATE users SET last_login_at = now() WHERE user_id = $1', [row.user_id]);

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      user: {
        userId: row.user_id,
        userName: row.user_name,
        fullName: row.full_name,
        defaultBranchId: row.default_branch_id,
        isCashier: row.is_cashier,
        isSalesRep: row.is_sales_rep,
        maxDiscountPct: Number(row.max_discount_pct),
      },
      permissions,
      branches: branchRows.map((b) => ({ branchId: b.branch_id, code: b.code, name: b.name })),
      activeBranchId: activeBranch,
    };
  }

  async refresh(refreshToken: string) {
    const secret = this.config.get<string>('JWT_SECRET') ?? 'wasel-dev-secret-change-me';
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret });
    } catch {
      throw new UnauthorizedException('جلسة غير صالحة');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedException('نوع التوكن غير صحيح');

    const row = await this.db.one<any>('SELECT user_name FROM users WHERE user_id = $1 AND is_active = true', [payload.sub]);
    if (!row) throw new UnauthorizedException('المستخدم غير موجود');

    const permissions = (
      await this.db.query<{ code: string }>(
        `SELECT DISTINCT p.code FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE ur.user_id = $1`,
        [payload.sub],
      )
    ).map((r) => r.code);

    const branchRows = await this.db.query<{ branch_id: number }>(
      'SELECT branch_id FROM user_branches WHERE user_id = $1',
      [payload.sub],
    );

    const accessToken = await this.jwt.signAsync(
      {
        sub: payload.sub,
        name: payload.name,
        branch: payload.branch,
        perms: permissions,
        branches: branchRows.map((b) => b.branch_id),
      },
      { secret, expiresIn: this.config.get<string>('JWT_EXPIRES') ?? '15m' },
    );

    return {
      accessToken,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      permissions,
    };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
