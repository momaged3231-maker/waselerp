import { BadRequestException, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Body, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed, countReferencingRows } from '../../common/delete-guard';
import { RequirePermissions, CurrentBranch, CurrentUser, AuthUser } from '../../common/security';

// --------------------------------------------------------------------- //
// Branch / warehouse / unit / category / reference masters (banks, colors, sizes, governorates)
// --------------------------------------------------------------------- //
@Injectable()
export class CatalogLookupService {
  constructor(private readonly db: DatabaseService) {}

  async branches() {
    return this.db.query(
      `SELECT b.branch_id AS "branchId", b.code, b.name, b.name_en AS "nameEn", b.city, b.phone,
              b.is_active AS "isActive",
              (SELECT COUNT(*)::int FROM warehouses w WHERE w.branch_id = b.branch_id AND w.is_active) AS "warehouseCount"
         FROM branches b ORDER BY b.branch_id`,
    );
  }

  async warehouses(branchId?: number, userId?: number) {
    return this.db.query(
      `SELECT w.warehouse_id AS "warehouseId", w.branch_id AS "branchId", b.name AS "branchName",
              w.name, w.code, w.is_default AS "isDefault", w.is_active AS "isActive"
         FROM warehouses w JOIN branches b ON b.branch_id = w.branch_id
        WHERE ($1::int IS NULL OR w.branch_id = $1)
          AND ($2::int IS NULL OR NOT EXISTS (SELECT 1 FROM user_warehouses u WHERE u.user_id = $2)
               OR w.warehouse_id IN (SELECT warehouse_id FROM user_warehouses WHERE user_id = $2))
        ORDER BY b.name, w.name`,
      [branchId ?? null, userId ?? null],
    );
  }

  async units() {
    return this.db.query(
      `SELECT unit_id AS "unitId", name, name_en AS "nameEn", code FROM units WHERE is_active = true ORDER BY unit_id`,
    );
  }

  async categories() {
    return this.db.query(
      `SELECT c.category_id AS "categoryId", c.name, c.name_en AS "nameEn", c.code, c.parent_id AS "parentId",
              c.is_active AS "isActive",
              (SELECT COUNT(*)::int FROM items i WHERE i.category_id = c.category_id) AS "itemCount"
         FROM categories c ORDER BY c.name`,
    );
  }

  async categoriesTree() {
    const rows = await this.categories();
    const byParent = new Map<number | null, any[]>();
    for (const row of rows) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row);
      byParent.set(row.parentId, list);
    }
    const build = (parentId: number | null): any[] =>
      (byParent.get(parentId) ?? []).map((c) => ({ ...c, children: build(c.categoryId) }));
    return build(null);
  }

  async createCategory(body: any) {
    const row = await this.db.one<any>(
      `INSERT INTO categories (parent_id, code, name, name_en, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING category_id`,
      [body.parentId ?? null, body.code ?? null, body.name, body.nameEn ?? null,
        body.isActive ?? true, body.notes ?? null],
    );
    return { categoryId: Number(row.category_id) };
  }

  async updateCategory(id: number, body: any) {
    await this.db.query(
      `UPDATE categories SET parent_id=$2, code=$3, name=$4, name_en=$5, is_active=$6, notes=$7
        WHERE category_id=$1`,
      [id, body.parentId ?? null, body.code ?? null, body.name, body.nameEn ?? null,
        body.isActive ?? true, body.notes ?? null],
    );
    return { categoryId: id };
  }

  async createUnit(body: any) {
    const row = await this.db.one<any>(
      `INSERT INTO units (code, name, name_en, is_active) VALUES ($1,$2,$3,$4) RETURNING unit_id`,
      [body.code ?? null, body.name, body.nameEn ?? null, body.isActive ?? true],
    );
    return { unitId: Number(row.unit_id) };
  }

  async deleteCategory(id: number) {
    await assertDeletionAllowed(this.db, 'categories');
    const refs = await countReferencingRows(this.db, 'categories', 'category_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف الفئة — مستخدم فيها: ${detail}. انقل الأصناف أولًا أو عطل الفئة`);
    }
    await this.db.query('DELETE FROM categories WHERE category_id = $1::int', [id]);
    return { deleted: true };
  }

  async deleteUnit(id: number) {
    await assertDeletionAllowed(this.db, 'units');
    const refs = await countReferencingRows(this.db, 'units', 'unit_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف الوحدة — مستخدمة في: ${detail}`);
    }
    await this.db.query('DELETE FROM units WHERE unit_id = $1::int', [id]);
    return { deleted: true };
  }

  async createWarehouse(body: any) {
    const row = await this.db.one<any>(
      `INSERT INTO warehouses (branch_id, code, name, name_en, address, phone, manager_name, is_default, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING warehouse_id`,
      [body.branchId ?? 1, body.code ?? null, body.name, body.nameEn ?? null, body.address ?? null,
        body.phone ?? null, body.managerName ?? null, body.isDefault ?? false, body.isActive ?? true,
        body.notes ?? null],
    );
    return { warehouseId: Number(row.warehouse_id) };
  }

  // ---- banks ----
  async banks() {
    return this.db.query(
      `SELECT b.bank_id AS "bankId", b.code, b.name, b.name_en AS "nameEn", b.is_active AS "isActive", b.notes,
              b.created_at AS "createdAt",
              (SELECT COUNT(*)::int FROM cash_accounts c WHERE c.bank_id = b.bank_id) AS "accountCount"
         FROM banks b ORDER BY b.name`,
    );
  }

  async createBank(body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم البنك مطلوب');
    const row = await this.db.one<any>(
      `INSERT INTO banks (code, name, name_en, is_active, notes)
       VALUES ($1::text, $2::text, $3::text, $4::boolean, $5::text) RETURNING bank_id`,
      [body.code?.trim() || null, name, body.nameEn?.trim() || null, body.isActive ?? true, body.notes?.trim() || null],
    );
    return { bankId: Number(row.bank_id) };
  }

  async updateBank(id: number, body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم البنك مطلوب');
    await this.db.query(
      `UPDATE banks SET code=$2::text, name=$3::text, name_en=$4::text, is_active=$5::boolean, notes=$6::text
        WHERE bank_id=$1::int`,
      [id, body.code?.trim() || null, name, body.nameEn?.trim() || null, body.isActive ?? true, body.notes?.trim() || null],
    );
    await this.db.query(
      `UPDATE cash_accounts SET bank_name=$2::text WHERE bank_id=$1::int`,
      [id, name],
    );
    return { bankId: id };
  }

  async deleteBank(id: number) {
    const refs = await countReferencingRows(this.db, 'banks', 'bank_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف البنك — مستخدم في: ${detail}`);
    }
    await this.db.query('DELETE FROM banks WHERE bank_id = $1::int', [id]);
    return { deleted: true };
  }

  // ---- colors ----
  async colors() {
    return this.db.query(
      `SELECT color_id AS "colorId", code, name, name_en AS "nameEn", hex_value AS "hexValue",
              is_active AS "isActive", notes
         FROM colors ORDER BY name`,
    );
  }

  async createColor(body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم اللون مطلوب');
    const row = await this.db.one<any>(
      `INSERT INTO colors (code, name, name_en, hex_value, is_active, notes)
       VALUES ($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::text) RETURNING color_id`,
      [body.code?.trim() || null, name, body.nameEn?.trim() || null, body.hexValue?.trim() || body.hex_value?.trim() || null, body.isActive ?? true, body.notes?.trim() || null],
    );
    return { colorId: Number(row.color_id) };
  }

  async updateColor(id: number, body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم اللون مطلوب');
    await this.db.query(
      `UPDATE colors SET code=$2::text, name=$3::text, name_en=$4::text, hex_value=$5::text, is_active=$6::boolean, notes=$7::text
        WHERE color_id=$1::int`,
      [id, body.code?.trim() || null, name, body.nameEn?.trim() || null, body.hexValue?.trim() || body.hex_value?.trim() || null, body.isActive ?? true, body.notes?.trim() || null],
    );
    return { colorId: id };
  }

  async deleteColor(id: number) {
    const refs = await countReferencingRows(this.db, 'colors', 'color_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف اللون — مستخدم في: ${detail}`);
    }
    await this.db.query('DELETE FROM colors WHERE color_id = $1::int', [id]);
    return { deleted: true };
  }

  // ---- sizes ----
  async sizes() {
    return this.db.query(
      `SELECT size_id AS "sizeId", code, name, name_en AS "nameEn", sort_order AS "sortOrder",
              is_active AS "isActive", notes
         FROM sizes ORDER BY sort_order, name`,
    );
  }

  async createSize(body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المقاس مطلوب');
    const row = await this.db.one<any>(
      `INSERT INTO sizes (code, name, name_en, sort_order, is_active, notes)
       VALUES ($1::text,$2::text,$3::text,$4::int,$5::boolean,$6::text) RETURNING size_id`,
      [body.code?.trim() || null, name, body.nameEn?.trim() || null, Number(body.sortOrder ?? body.sort_order ?? 0), body.isActive ?? true, body.notes?.trim() || null],
    );
    return { sizeId: Number(row.size_id) };
  }

  async updateSize(id: number, body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المقاس مطلوب');
    await this.db.query(
      `UPDATE sizes SET code=$2::text, name=$3::text, name_en=$4::text, sort_order=$5::int, is_active=$6::boolean, notes=$7::text
        WHERE size_id=$1::int`,
      [id, body.code?.trim() || null, name, body.nameEn?.trim() || null, Number(body.sortOrder ?? body.sort_order ?? 0), body.isActive ?? true, body.notes?.trim() || null],
    );
    return { sizeId: id };
  }

  async deleteSize(id: number) {
    const refs = await countReferencingRows(this.db, 'sizes', 'size_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف المقاس — مستخدم في: ${detail}`);
    }
    await this.db.query('DELETE FROM sizes WHERE size_id = $1::int', [id]);
    return { deleted: true };
  }

  // ---- governorates ----
  async governorates(countryId?: number) {
    return this.db.query(
      `SELECT g.governorate_id AS "governorateId", g.code, g.name, g.name_en AS "nameEn",
              g.country_id AS "countryId", c.name AS "countryName", g.country_code AS "countryCode",
              g.shipping_fees AS "shippingFees", g.is_active AS "isActive", g.notes
         FROM governorates g
         LEFT JOIN countries c ON c.country_id = g.country_id
        WHERE ($1::int IS NULL OR g.country_id = $1::int)
        ORDER BY g.name`,
      [countryId ?? null],
    );
  }

  async createGovernorate(body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المحافظة مطلوب');
    const countryId = body.countryId ?? body.country_id ?? null;
    const row = await this.db.one<any>(
      `INSERT INTO governorates (code, name, name_en, country_id, country_code, shipping_fees, is_active, notes)
       VALUES ($1::text,$2::text,$3::text,$4::int,$5::text,$6::numeric,$7::boolean,$8::text) RETURNING governorate_id`,
      [body.code?.trim() || null, name, body.nameEn?.trim() || null, countryId ? Number(countryId) : null,
        body.countryCode?.trim() || body.country_code?.trim() || null, Number(body.shippingFees ?? body.shipping_fees ?? 0),
        body.isActive ?? true, body.notes?.trim() || null],
    );
    return { governorateId: Number(row.governorate_id) };
  }

  async updateGovernorate(id: number, body: any) {
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المحافظة مطلوب');
    const countryId = body.countryId ?? body.country_id ?? null;
    await this.db.query(
      `UPDATE governorates SET code=$2::text, name=$3::text, name_en=$4::text, country_id=$5::int, country_code=$6::text,
              shipping_fees=$7::numeric, is_active=$8::boolean, notes=$9::text
        WHERE governorate_id=$1::int`,
      [id, body.code?.trim() || null, name, body.nameEn?.trim() || null, countryId ? Number(countryId) : null,
        body.countryCode?.trim() || body.country_code?.trim() || null, Number(body.shippingFees ?? body.shipping_fees ?? 0),
        body.isActive ?? true, body.notes?.trim() || null],
    );
    return { governorateId: id };
  }

  async deleteGovernorate(id: number) {
    const refs = await countReferencingRows(this.db, 'governorates', 'governorate_id', id);
    if (refs.length) {
      const detail = refs.map((r) => `${r.table} (${r.count})`).join('، ');
      throw new BadRequestException(`لا يمكن حذف المحافظة — مستخدمة في: ${detail}`);
    }
    await this.db.query('DELETE FROM governorates WHERE governorate_id = $1::int', [id]);
    return { deleted: true };
  }
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly service: CatalogLookupService) {}

  @Get('branches')
  branches() { return this.service.branches(); }

  @Get('warehouses')
  warehouses(@CurrentBranch() branchId: number, @CurrentUser() user: AuthUser) {
    return this.service.warehouses(branchId, user.userId);
  }

  @Get('units')
  units() { return this.service.units(); }

  @Get('categories')
  categories() { return this.service.categories(); }

  @Get('categories/tree')
  categoriesTree() { return this.service.categoriesTree(); }

  @RequirePermissions('categories.manage')
  @Post('categories')
  createCategory(@Body() body: any) { return this.service.createCategory(body); }

  @RequirePermissions('categories.manage')
  @Put('categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.updateCategory(id, body); }

  @RequirePermissions('units.manage')
  @Post('units')
  createUnit(@Body() body: any) { return this.service.createUnit(body); }

  @RequirePermissions('warehouses.manage')
  @Post('warehouses')
  createWarehouse(@Body() body: any) { return this.service.createWarehouse(body); }

  @RequirePermissions('categories.manage')
  @Delete('categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) { return this.service.deleteCategory(id); }

  @RequirePermissions('units.manage')
  @Delete('units/:id')
  deleteUnit(@Param('id', ParseIntPipe) id: number) { return this.service.deleteUnit(id); }

  // banks
  @Get('banks')
  banks() { return this.service.banks(); }

  @RequirePermissions('cash.manage')
  @Post('banks')
  createBank(@Body() body: any) { return this.service.createBank(body); }

  @RequirePermissions('cash.manage')
  @Put('banks/:id')
  updateBank(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.updateBank(id, body); }

  @RequirePermissions('cash.manage')
  @Delete('banks/:id')
  deleteBank(@Param('id', ParseIntPipe) id: number) { return this.service.deleteBank(id); }

  // colors
  @Get('colors')
  colors() { return this.service.colors(); }

  @RequirePermissions('settings.manage')
  @Post('colors')
  createColor(@Body() body: any) { return this.service.createColor(body); }

  @RequirePermissions('settings.manage')
  @Put('colors/:id')
  updateColor(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.updateColor(id, body); }

  @RequirePermissions('settings.manage')
  @Delete('colors/:id')
  deleteColor(@Param('id', ParseIntPipe) id: number) { return this.service.deleteColor(id); }

  // sizes
  @Get('sizes')
  sizes() { return this.service.sizes(); }

  @RequirePermissions('settings.manage')
  @Post('sizes')
  createSize(@Body() body: any) { return this.service.createSize(body); }

  @RequirePermissions('settings.manage')
  @Put('sizes/:id')
  updateSize(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.updateSize(id, body); }

  @RequirePermissions('settings.manage')
  @Delete('sizes/:id')
  deleteSize(@Param('id', ParseIntPipe) id: number) { return this.service.deleteSize(id); }

  // governorates
  @Get('governorates')
  governorates(@Query('countryId') countryId?: string) {
    return this.service.governorates(countryId ? Number(countryId) : undefined);
  }

  @RequirePermissions('settings.manage')
  @Post('governorates')
  createGovernorate(@Body() body: any) { return this.service.createGovernorate(body); }

  @RequirePermissions('settings.manage')
  @Put('governorates/:id')
  updateGovernorate(@Param('id', ParseIntPipe) id: number, @Body() body: any) { return this.service.updateGovernorate(id, body); }

  @RequirePermissions('settings.manage')
  @Delete('governorates/:id')
  deleteGovernorate(@Param('id', ParseIntPipe) id: number) { return this.service.deleteGovernorate(id); }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogLookupService],
  exports: [CatalogLookupService],
})
export class CatalogModule {}
