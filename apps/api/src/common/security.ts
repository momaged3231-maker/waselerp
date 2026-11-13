import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from './database/database.service';

// --------------------------------------------------------------------- //
// Password hashing (scrypt — no native dependency, salted per user)
// --------------------------------------------------------------------- //
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --------------------------------------------------------------------- //
// Current user model
// --------------------------------------------------------------------- //
export interface AuthUser {
  userId: number;
  userName: string;
  fullName: string;
  defaultBranchId: number | null;
  permissions: string[];
  branchIds: number[];
  isCashier: boolean;
  isSalesRep: boolean;
  maxDiscountPct: number;
}

export const IS_PUBLIC = 'wasel:public';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = 'wasel:permissions';
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS, codes);

/**
 * OR variant: the user needs at least one of the listed permissions.
 * Use it for shared screens (sales/purchases, dashboard, ...) where the
 * old AND semantics locked out every non-admin role.
 */
export const ANY_PERMISSIONS = 'wasel:anyPermissions';
export const RequireAnyPermission = (...codes: string[]) => SetMetadata(ANY_PERMISSIONS, codes);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const CurrentBranch = createParamDecorator((_data: unknown, ctx: ExecutionContext): number => {
  const request = ctx.switchToHttp().getRequest();
  const header = Number(request.headers['x-branch-id']);
  const user: AuthUser = request.user;
  if (Number.isFinite(header) && header > 0) {
    if (user.branchIds.length === 0 || user.branchIds.includes(header)) return header;
    throw new ForbiddenException('هذا الفرع غير مسموح لك');
  }
  return user.defaultBranchId ?? user.branchIds[0] ?? 0;
});

// --------------------------------------------------------------------- //
// Guards
// --------------------------------------------------------------------- //
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;
    // EventSource cannot send headers, so SSE passes the token as a query param.
    const queryToken = (request.query as any)?.access_token;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
    if (!token) throw new UnauthorizedException('يجب تسجيل الدخول');

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('انتهت الجلسة، سجل دخول من جديد');
    }

    const user = await this.loadUser(payload.sub);
    if (!user) throw new UnauthorizedException('المستخدم غير موجود أو موقوف');
    request.user = user;
    return true;
  }

  private async loadUser(userId: number): Promise<AuthUser | null> {
    const row = await this.db.one(
      `SELECT u.user_id, u.user_name, u.full_name, u.default_branch_id, u.is_cashier, u.is_sales_rep,
              u.max_discount_pct
         FROM users u WHERE u.user_id = $1 AND u.is_active = true`,
      [userId],
    );
    if (!row) return null;

    const permissions = (
      await this.db.query<{ code: string }>(
        `SELECT DISTINCT p.code
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.permission_id = rp.permission_id
          WHERE ur.user_id = $1`,
        [userId],
      )
    ).map((r) => r.code);

    const branchRows = await this.db.query<{ branch_id: number }>(
      'SELECT branch_id FROM user_branches WHERE user_id = $1',
      [userId],
    );

    return {
      userId: row.user_id,
      userName: row.user_name,
      fullName: row.full_name,
      defaultBranchId: row.default_branch_id,
      permissions,
      branchIds: branchRows.map((b) => b.branch_id),
      isCashier: row.is_cashier,
      isSalesRep: row.is_sales_rep,
      maxDiscountPct: Number(row.max_discount_pct),
    };
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets);
    const anyRequired = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, targets);

    const user: AuthUser = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException();

    if (anyRequired?.length) {
      const allowed = anyRequired.some((code) => user.permissions.includes(code));
      if (!allowed) throw new ForbiddenException('ليس لديك صلاحية لهذه العملية');
    }

    if (required?.length) {
      const missing = required.filter((code) => !user.permissions.includes(code));
      if (missing.length) throw new ForbiddenException('ليس لديك صلاحية لهذه العملية');
    }

    return true;
  }
}
