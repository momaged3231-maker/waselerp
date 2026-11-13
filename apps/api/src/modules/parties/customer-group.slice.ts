import { Body, Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query, Delete } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, RequirePermissions } from '../../common/security';

@Injectable()
export class CustomerGroupsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    return this.db.query<any>(
      `SELECT customer_group_id AS "groupId", name, name_en AS "nameEn", notes, is_active AS "isActive", created_at AS "createdAt"
         FROM customer_groups ORDER BY name`,
    );
  }

  async create(dto: any) {
    const row = await this.db.one<any>(
      `INSERT INTO customer_groups (name, name_en, notes, is_active)
       VALUES ($1,$2,$3,$4) RETURNING customer_group_id AS "groupId"`,
      [dto.name, dto.nameEn ?? null, dto.notes ?? null, dto.isActive ?? true],
    );
    return row;
  }

  async update(id: number, dto: any) {
    await this.db.query(
      `UPDATE customer_groups SET name = COALESCE($2, name), name_en = COALESCE($3, name_en),
              notes = COALESCE($4, notes), is_active = COALESCE($5, is_active)
        WHERE customer_group_id = $1`,
      [id, dto.name ?? null, dto.nameEn ?? null, dto.notes ?? null, dto.isActive ?? null],
    );
    return { groupId: id };
  }
}

@Injectable()
export class CustomerClassificationsService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    return this.db.query<any>(
      `SELECT classification_id AS "classificationId", name, name_en AS "nameEn",
              discount_pct AS "discountPct", credit_limit AS "creditLimit", grace_days AS "graceDays",
              notes, is_active AS "isActive", created_at AS "createdAt"
         FROM customer_classifications ORDER BY name`,
    );
  }

  async create(dto: any) {
    const row = await this.db.one<any>(
      `INSERT INTO customer_classifications (name, name_en, discount_pct, credit_limit, grace_days, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING classification_id AS "classificationId"`,
      [dto.name, dto.nameEn ?? null, dto.discountPct ?? 0, dto.creditLimit ?? 0, dto.graceDays ?? 0, dto.notes ?? null, dto.isActive ?? true],
    );
    return row;
  }

  async update(id: number, dto: any) {
    await this.db.query(
      `UPDATE customer_classifications SET name = COALESCE($2, name), name_en = COALESCE($3, name_en),
              discount_pct = COALESCE($4, discount_pct), credit_limit = COALESCE($5, credit_limit),
              grace_days = COALESCE($6, grace_days), notes = COALESCE($7, notes),
              is_active = COALESCE($8, is_active)
        WHERE classification_id = $1`,
      [id, dto.name ?? null, dto.nameEn ?? null, dto.discountPct ?? null, dto.creditLimit ?? null, dto.graceDays ?? null, dto.notes ?? null, dto.isActive ?? null],
    );
    return { classificationId: id };
  }
}

@Controller('customer-groups')
export class CustomerGroupsController {
  constructor(private readonly service: CustomerGroupsService) {}
  @RequirePermissions('parties.view')
  @Get() list() { return this.service.list(); }
  @RequirePermissions('parties.manage')
  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @RequirePermissions('parties.manage')
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }
}

@Controller('customer-classifications')
export class CustomerClassificationsController {
  constructor(private readonly service: CustomerClassificationsService) {}
  @RequirePermissions('parties.view')
  @Get() list() { return this.service.list(); }
  @RequirePermissions('parties.manage')
  @Post() create(@Body() dto: any) { return this.service.create(dto); }
  @RequirePermissions('parties.manage')
  @Put(':id') update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) { return this.service.update(id, dto); }
}

@Module({
  providers: [CustomerGroupsService, CustomerClassificationsService],
  controllers: [CustomerGroupsController, CustomerClassificationsController],
})
export class CustomerGroupsModule {}
