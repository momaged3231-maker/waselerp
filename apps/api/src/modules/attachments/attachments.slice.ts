import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Injectable, Module, Param, ParseIntPipe, Post, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed } from '../../common/delete-guard';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

/**
 * D4 — entities that may carry attachments.
 * Table/idColumn come from this constant map only (never from user input),
 * so interpolating them into the existence check is safe.
 * `branchScoped: false` = global rows shared across branches (items).
 */
const ENTITIES: Record<string, { label: string; table: string; idColumn: string; branchScoped: boolean }> = {
  invoice: { label: 'فاتورة', table: 'invoices', idColumn: 'invoice_id', branchScoped: true },
  item: { label: 'صنف', table: 'items', idColumn: 'item_id', branchScoped: false },
  party: { label: 'عميل/مورد', table: 'parties', idColumn: 'party_id', branchScoped: true },
  maintenance_ticket: { label: 'إذن صيانة', table: 'maintenance_tickets', idColumn: 'ticket_id', branchScoped: true },
  employee: { label: 'موظف', table: 'employees', idColumn: 'employee_id', branchScoped: true },
  lead: { label: 'عميل محتمل', table: 'crm_leads', idColumn: 'lead_id', branchScoped: true },
};

/** Allowed content categories — kept in sync with the upload input in AttachmentsPanel. */
const ALLOWED_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt'];
const ALLOWED_LABEL = 'صور (png/jpg/gif/webp)، PDF، Word، Excel، CSV، نص';

function isAllowedFile(fileName: string, mimeType: string | null): boolean {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (ALLOWED_EXT.includes(ext)) return true;
  if (mimeType && mimeType.startsWith('image/')) return true;
  if (mimeType && ['application/pdf', 'text/plain', 'text/csv'].includes(mimeType)) return true;
  return false;
}

@Injectable()
export class AttachmentsService {
  constructor(private readonly db: DatabaseService) {}

  async limits() {
    const policies = await this.db.query<any>(
      `SELECT entity_type AS "entityType", max_size_mb AS "maxSizeMb", max_count_per_entity AS "maxCountPerEntity"
         FROM attachment_policies ORDER BY entity_type`,
    );
    const invoice = policies.find((p: any) => p.entityType === 'invoice') ?? policies[0];
    const maxSizeMb = Number(invoice?.maxSizeMb ?? 5);
    const maxCount = Number(invoice?.maxCountPerEntity ?? 10);
    return {
      maxKb: maxSizeMb * 1024,
      maxPerEntity: maxCount,
      allowedTypes: ALLOWED_LABEL,
      entityTypes: Object.keys(ENTITIES),
      policies,
    };
  }

  async list(params: { branchId: number; entityType: string; entityId: number }) {
    return this.db.query<any>(
      `SELECT a.attachment_id AS "attachmentId", a.branch_id AS "branchId",
              a.entity_type AS "entityType", a.entity_id AS "entityId",
              a.file_name AS "fileName", a.mime_type AS "mimeType",
              a.file_size AS "fileSize", a.uploaded_by AS "uploadedBy",
              u.full_name AS "uploadedByName",
              a.created_at AS "createdAt"
         FROM attachments a
         LEFT JOIN users u ON u.user_id = a.uploaded_by
        WHERE a.branch_id = $1::int AND a.entity_type = $2::text AND a.entity_id = $3::bigint
        ORDER BY a.created_at DESC`,
      [params.branchId, params.entityType, params.entityId],
    );
  }

  async findOne(id: number, branchId: number) {
    const row = await this.db.one<any>(
      `SELECT attachment_id AS "attachmentId", branch_id AS "branchId",
              entity_type AS "entityType", entity_id AS "entityId",
              file_name AS "fileName", mime_type AS "mimeType",
              file_size AS "fileSize", content, uploaded_by AS "uploadedBy",
              created_at AS "createdAt"
         FROM attachments
        WHERE attachment_id = $1::bigint AND branch_id = $2::int`,
      [id, branchId],
    );
    if (!row) throw new BadRequestException('المرفق غير موجود');
    return {
      ...row,
      contentBase64: Buffer.isBuffer(row.content)
        ? row.content.toString('base64')
        : Buffer.from(row.content).toString('base64'),
    };
  }

  async create(dto: any, user: AuthUser, branchId: number) {
    const entityType = String(dto.entityType ?? '').trim();
    const entityId = Number(dto.entityId);
    const fileName = String(dto.fileName ?? '').trim();
    if (!entityId || !fileName) {
      throw new BadRequestException('رقم الكيان واسم الملف مطلوبة');
    }
    const entity = ENTITIES[entityType];
    if (!entity) {
      throw new BadRequestException(`نوع كيان غير مدعوم — الأنواع المتاحة: ${Object.keys(ENTITIES).join('، ')}`);
    }
    const mimeType = dto.mimeType ? String(dto.mimeType) : null;
    if (!isAllowedFile(fileName, mimeType)) {
      throw new BadRequestException(`نوع ملف غير مسموح — الأنواع المسموحة: ${ALLOWED_LABEL}`);
    }

    const raw = String(dto.contentBase64 ?? '');
    const base64 = raw.includes(',') ? raw.split(',').pop() ?? '' : raw;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('محتوى الملف غير صالح');
    }

    return this.db.transaction(async (client) => {
      // GAP-08: per-entity policies (size in MB, count) — configurable via /admin/attachment-policies.
      const policyRow = await client.query<any>(
        `SELECT max_size_mb AS "maxSizeMb", max_count_per_entity AS "maxCountPerEntity"
           FROM attachment_policies WHERE entity_type = $1::text`,
        [entityType],
      );
      const maxSizeMb = Number(policyRow.rows[0]?.maxSizeMb ?? 5);
      const maxCount = Number(policyRow.rows[0]?.maxCountPerEntity ?? 10);
      const maxBytes = maxSizeMb * 1024 * 1024;
      if (!buffer.length || buffer.length > maxBytes) {
        throw new HttpException(`حجم الملف يتجاوز الحد (${maxSizeMb} MB)`, HttpStatus.PAYLOAD_TOO_LARGE);
      }
      const countRow = await client.query<any>(
        `SELECT count(*)::int AS count FROM attachments
          WHERE branch_id = $1::int AND entity_type = $2::text AND entity_id = $3::bigint`,
        [branchId, entityType, entityId],
      );
      if (Number(countRow.rows[0]?.count ?? 0) >= maxCount) {
        throw new BadRequestException(`عدد المرفقات تجاوز الحد (${maxCount})`);
      }

      // The target row must exist in this branch (items are global — no branch filter).
      const exists = await client.query<any>(
        entity.branchScoped
          ? `SELECT 1 FROM ${entity.table} WHERE ${entity.idColumn} = $1::int AND branch_id = $2::int`
          : `SELECT 1 FROM ${entity.table} WHERE ${entity.idColumn} = $1::int`,
        entity.branchScoped ? [entityId, branchId] : [entityId],
      );
      if (!exists.rows.length) {
        throw new BadRequestException(`${entity.label} رقم ${entityId} غير موجود${entity.branchScoped ? ' في هذا الفرع' : ''}`);
      }

      let attachmentId: number;
      try {
        const row = await client.query<any>(
          `INSERT INTO attachments
             (branch_id, entity_type, entity_id, file_name, mime_type, file_size, content, uploaded_by)
           VALUES ($1::int,$2::text,$3::bigint,$4::text,$5::text,$6::int,$7::bytea,$8::int)
           RETURNING attachment_id`,
          [branchId, entityType, entityId, fileName, mimeType, buffer.length, buffer, user.userId],
        );
        attachmentId = Number(row.rows[0].attachment_id);
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new BadRequestException('يوجد مرفق بنفس الاسم لهذا الكيان — غيّر اسم الملف');
        }
        throw err;
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, $2::int, 'attachment.create', $3::text, $4::text, $5::text)`,
        [user.userId, branchId, entityType, String(entityId), `رفع مرفق: ${fileName} (${Math.ceil(buffer.length / 1024)} KB)`],
      );
      return { attachmentId };
    });
  }

  async remove(id: number, user: AuthUser, branchId: number) {
    await assertDeletionAllowed(this.db, 'attachments');
    await this.db.transaction(async (client) => {
      const row = await client.query<any>(
        `SELECT entity_type, entity_id, file_name FROM attachments
          WHERE attachment_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!row.rows.length) throw new BadRequestException('المرفق غير موجود');
      const target = row.rows[0];
      await client.query(
        'DELETE FROM attachments WHERE attachment_id = $1::bigint AND branch_id = $2::int',
        [id, branchId],
      );
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int, $2::int, 'attachment.delete', $3::text, $4::text, $5::text)`,
        [user.userId, branchId, target.entity_type, String(target.entity_id), `حذف مرفق: ${target.file_name}`],
      );
    });
    return { attachmentId: id, deleted: true };
  }
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  /** Upload policies, readable by every attachments user (the panel needs them client-side). */
  @RequirePermissions('attachments.view')
  @Get('limits')
  limits() {
    return this.service.limits();
  }

  @RequirePermissions('attachments.view')
  @Get()
  list(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.list({
      branchId,
      entityType: entityType ?? '',
      entityId: Number(entityId) || 0,
    });
  }

  @RequirePermissions('attachments.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.findOne(id, branchId);
  }

  @RequirePermissions('attachments.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  @RequirePermissions('attachments.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.remove(id, user, branchId);
  }
}

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
