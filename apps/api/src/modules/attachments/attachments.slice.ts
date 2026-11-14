import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

const MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class AttachmentsService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: { branchId: number; entityType: string; entityId: number }) {
    return this.db.query<any>(
      `SELECT attachment_id AS "attachmentId", branch_id AS "branchId",
              entity_type AS "entityType", entity_id AS "entityId",
              file_name AS "fileName", mime_type AS "mimeType",
              file_size AS "fileSize", uploaded_by AS "uploadedBy",
              created_at AS "createdAt"
         FROM attachments
        WHERE branch_id = $1::int AND entity_type = $2::text AND entity_id = $3::bigint
        ORDER BY created_at DESC`,
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
    if (!entityType || !entityId || !fileName) {
      throw new BadRequestException('نوع الكيان ورقمه واسم الملف مطلوبة');
    }
    const raw = String(dto.contentBase64 ?? '');
    const base64 = raw.includes(',') ? raw.split(',').pop() ?? '' : raw;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('محتوى الملف غير صالح');
    }
    if (!buffer.length || buffer.length > MAX_BYTES) {
      throw new BadRequestException('حجم الملف غير صالح (الحد 5MB)');
    }
    const mimeType = dto.mimeType ? String(dto.mimeType) : null;

    const row = await this.db.one<any>(
      `INSERT INTO attachments
         (branch_id, entity_type, entity_id, file_name, mime_type, file_size, content, uploaded_by)
       VALUES ($1::int,$2::text,$3::bigint,$4::text,$5::text,$6::int,$7::bytea,$8::int)
       RETURNING attachment_id`,
      [branchId, entityType, entityId, fileName, mimeType, buffer.length, buffer, user.userId],
    );
    return { attachmentId: Number(row.attachment_id) };
  }

  async remove(id: number, branchId: number) {
    await this.db.query(
      'DELETE FROM attachments WHERE attachment_id = $1::bigint AND branch_id = $2::int',
      [id, branchId],
    );
    return { attachmentId: id, deleted: true };
  }
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

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
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.remove(id, branchId);
  }
}

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
