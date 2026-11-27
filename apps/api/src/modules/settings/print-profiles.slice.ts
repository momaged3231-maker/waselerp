import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Req,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed } from '../../common/delete-guard';
import { AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/security';
import { logActivity } from '../../common/audit';
import { Request } from 'express';

const PAPER_SIZES = ['thermal80', 'thermal58', 'a5', 'a4'];

const SELECT_PROFILE = `
  SELECT profile_id, branch_id, name, code, default_printer, paper_size,
         receipt_copies, auto_open_drawer, receipt_width,
         kitchen_ticket_enabled, kitchen_ticket_copies, kitchen_printer_name,
         show_tax_on_receipt, receipt_show_branch_name, receipt_show_party_name,
         receipt_show_totals, is_default, created_at
    FROM print_profiles`;

function alias(row: any) {
  return {
    profileId: Number(row.profile_id),
    branchId: Number(row.branch_id),
    name: row.name,
    code: row.code,
    defaultPrinter: row.default_printer,
    paperSize: row.paper_size,
    receiptCopies: Number(row.receipt_copies),
    autoOpenDrawer: row.auto_open_drawer,
    receiptWidth: Number(row.receipt_width),
    kitchenTicketEnabled: row.kitchen_ticket_enabled,
    kitchenTicketCopies: Number(row.kitchen_ticket_copies),
    kitchenPrinterName: row.kitchen_printer_name,
    showTaxOnReceipt: row.show_tax_on_receipt,
    receiptShowBranchName: row.receipt_show_branch_name,
    receiptShowPartyName: row.receipt_show_party_name,
    receiptShowTotals: row.receipt_show_totals,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

/** Tri-state: true / false / null (null = follow the global setting). */
function boolOrNull(value: any): boolean | null {
  if (value === null || value === undefined || value === '') return null;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Rejects duplicate profile names inside a branch with a clean 400 (the DB index is the last guard). */
async function assertNameFree(
  client: PoolClient,
  name: string,
  branchId: number,
  excludeId?: number,
) {
  const { rows } = await client.query<any>(
    `SELECT profile_id FROM print_profiles
      WHERE branch_id = $1::int AND lower(name) = lower($2::text) AND ($3::int = 0 OR profile_id <> $3::int)`,
    [branchId, name, excludeId ?? 0],
  );
  if (rows.length) throw new BadRequestException('اسم ملف الطباعة مستخدم بالفعل في هذا الفرع');
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Normalizes the write payload; throws on invalid enum values. */
function sanitize(dto: any) {
  const name = String(dto?.name ?? '').trim();
  if (!name) throw new BadRequestException('اسم ملف الطباعة مطلوب');
  if (name.length > 120) throw new BadRequestException('الاسم طويل جدًا (120 حرفًا كحد أقصى)');
  const paperSize = PAPER_SIZES.includes(dto?.paperSize) ? dto.paperSize : 'thermal80';
  return {
    name,
    code: dto?.code ? String(dto.code).trim().slice(0, 60) : null,
    defaultPrinter: dto?.defaultPrinter ? String(dto.defaultPrinter).trim().slice(0, 120) : null,
    paperSize,
    receiptCopies: clampInt(dto?.receiptCopies, 1, 5, 1),
    autoOpenDrawer: boolOrNull(dto?.autoOpenDrawer) ?? true,
    receiptWidth: clampInt(dto?.receiptWidth, 20, 48, 42),
    kitchenTicketEnabled: boolOrNull(dto?.kitchenTicketEnabled) ?? false,
    kitchenTicketCopies: clampInt(dto?.kitchenTicketCopies, 1, 3, 1),
    kitchenPrinterName: dto?.kitchenPrinterName ? String(dto.kitchenPrinterName).trim().slice(0, 120) : null,
    showTaxOnReceipt: boolOrNull(dto?.showTaxOnReceipt),
    receiptShowBranchName: boolOrNull(dto?.receiptShowBranchName),
    receiptShowPartyName: boolOrNull(dto?.receiptShowPartyName),
    receiptShowTotals: boolOrNull(dto?.receiptShowTotals),
    isDefault: boolOrNull(dto?.isDefault) ?? false,
  };
}

@Injectable()
export class PrintProfilesService {
  constructor(private readonly db: DatabaseService) {}

  async list(branchId: number) {
    const rows = await this.db.query<any>(
      `${SELECT_PROFILE} WHERE branch_id = $1::int ORDER BY is_default DESC, profile_id ASC`,
      [branchId],
    );
    return rows.map(alias);
  }

  async get(id: number, branchId: number) {
    const row = await this.db.one<any>(
      `${SELECT_PROFILE} WHERE profile_id = $1::int AND branch_id = $2::int`,
      [id, branchId],
    );
    if (!row) throw new BadRequestException('ملف الطباعة غير موجود');
    return alias(row);
  }

  /** The branch default (used by POS when no explicit profile is chosen). */
  async defaultOf(branchId: number) {
    const row = await this.db.one<any>(
      `${SELECT_PROFILE} WHERE branch_id = $1::int AND is_default = true`,
      [branchId],
    );
    return row ? alias(row) : null;
  }

  async create(dto: any, user: AuthUser, branchId: number, ip: string) {
    const data = sanitize(dto);
    return this.db.transaction(async (client) => {
      await assertNameFree(client, data.name, branchId);
      if (data.isDefault) {
        await client.query('UPDATE print_profiles SET is_default = false WHERE branch_id = $1::int', [branchId]);
      }
      const { rows } = await client.query<any>(
        `INSERT INTO print_profiles
           (branch_id, name, code, default_printer, paper_size, receipt_copies, auto_open_drawer,
            receipt_width, kitchen_ticket_enabled, kitchen_ticket_copies, kitchen_printer_name,
            show_tax_on_receipt, receipt_show_branch_name, receipt_show_party_name, receipt_show_totals, is_default)
         VALUES ($1::int,$2::text,$3::text,$4::text,$5::text,$6::int,$7::bool,$8::int,$9::bool,$10::int,$11::text,
                 $12::bool,$13::bool,$14::bool,$15::bool,$16::bool)
         RETURNING profile_id, branch_id, name, code, default_printer, paper_size, receipt_copies,
                   auto_open_drawer, receipt_width, kitchen_ticket_enabled, kitchen_ticket_copies,
                   kitchen_printer_name, show_tax_on_receipt, receipt_show_branch_name,
                   receipt_show_party_name, receipt_show_totals, is_default, created_at`,
        [branchId, data.name, data.code, data.defaultPrinter, data.paperSize, data.receiptCopies,
         data.autoOpenDrawer, data.receiptWidth, data.kitchenTicketEnabled, data.kitchenTicketCopies,
         data.kitchenPrinterName, data.showTaxOnReceipt, data.receiptShowBranchName,
         data.receiptShowPartyName, data.receiptShowTotals, data.isDefault],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'print_profile.create',
        entity: 'print_profile', entityId: String(rows[0].profile_id), details: data.name, ip });
      return alias(rows[0]);
    });
  }

  async update(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const data = sanitize(dto);
    await this.get(id, branchId);
    return this.db.transaction(async (client) => {
      await assertNameFree(client, data.name, branchId, id);
      if (data.isDefault) {
        await client.query(
          'UPDATE print_profiles SET is_default = false WHERE branch_id = $1::int AND profile_id <> $2::int',
          [branchId, id],
        );
      }
      const { rows } = await client.query<any>(
        `UPDATE print_profiles SET
           name = $3::text, code = $4::text, default_printer = $5::text, paper_size = $6::text,
           receipt_copies = $7::int, auto_open_drawer = $8::bool, receipt_width = $9::int,
           kitchen_ticket_enabled = $10::bool, kitchen_ticket_copies = $11::int, kitchen_printer_name = $12::text,
           show_tax_on_receipt = $13::bool, receipt_show_branch_name = $14::bool,
           receipt_show_party_name = $15::bool, receipt_show_totals = $16::bool, is_default = $17::bool
         WHERE profile_id = $1::int AND branch_id = $2::int
         RETURNING profile_id, branch_id, name, code, default_printer, paper_size, receipt_copies,
                   auto_open_drawer, receipt_width, kitchen_ticket_enabled, kitchen_ticket_copies,
                   kitchen_printer_name, show_tax_on_receipt, receipt_show_branch_name,
                   receipt_show_party_name, receipt_show_totals, is_default, created_at`,
        [id, branchId, data.name, data.code, data.defaultPrinter, data.paperSize, data.receiptCopies,
         data.autoOpenDrawer, data.receiptWidth, data.kitchenTicketEnabled, data.kitchenTicketCopies,
         data.kitchenPrinterName, data.showTaxOnReceipt, data.receiptShowBranchName,
         data.receiptShowPartyName, data.receiptShowTotals, data.isDefault],
      );
      await logActivity(client, { userId: user.userId, branchId, action: 'print_profile.update',
        entity: 'print_profile', entityId: String(id), details: data.name, ip });
      return alias(rows[0]);
    });
  }

  async remove(id: number, user: AuthUser, branchId: number, ip: string) {
    await assertDeletionAllowed(this.db, 'printProfiles');
    const existing = await this.get(id, branchId);
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM print_profiles WHERE profile_id = $1::int AND branch_id = $2::int', [id, branchId]);
      await logActivity(client, { userId: user.userId, branchId, action: 'print_profile.delete',
        entity: 'print_profile', entityId: String(id), details: existing.name, ip });
    });
    return { profileId: id, deleted: true };
  }
}

@Controller('settings/print-profiles')
export class PrintProfilesController {
  constructor(private readonly service: PrintProfilesService) {}

  /** Readable by POS/sales users — they need it to pick the station profile. */
  @RequireAnyPermission('settings.manage', 'pos.operate', 'sales.view')
  @Get()
  list(@CurrentBranch() branchId: number) {
    return this.service.list(branchId);
  }

  @RequirePermissions('settings.manage')
  @Post()
  create(@Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.create(body, user, branchId, ip);
  }

  @RequirePermissions('settings.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.update(id, body, user, branchId, ip);
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.remove(id, user, branchId, ip);
  }
}

@Module({ controllers: [PrintProfilesController], providers: [PrintProfilesService] })
export class PrintProfilesModule {}
