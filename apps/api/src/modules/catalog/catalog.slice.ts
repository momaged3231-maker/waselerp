import { Controller, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Body } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { RequirePermissions, CurrentBranch, CurrentUser, AuthUser } from '../../common/security';

// --------------------------------------------------------------------- //
// Branch / warehouse / unit / category lookups (read-mostly)
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
}

@Controller('catalog')
export class CatalogController {
  constructor(private readonly service: CatalogLookupService) {}

  @Get('branches')
  branches() {
    return this.service.branches();
  }

  @Get('warehouses')
  warehouses(@CurrentBranch() branchId: number, @CurrentUser() user: AuthUser) {
    return this.service.warehouses(branchId, user.userId);
  }

  @Get('units')
  units() {
    return this.service.units();
  }

  @Get('categories')
  categories() {
    return this.service.categories();
  }

  @Get('categories/tree')
  categoriesTree() {
    return this.service.categoriesTree();
  }

  @RequirePermissions('categories.manage')
  @Post('categories')
  createCategory(@Body() body: any) {
    return this.service.createCategory(body);
  }

  @RequirePermissions('categories.manage')
  @Put('categories/:id')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.service.updateCategory(id, body);
  }

  @RequirePermissions('units.manage')
  @Post('units')
  createUnit(@Body() body: any) {
    return this.service.createUnit(body);
  }

  @RequirePermissions('warehouses.manage')
  @Post('warehouses')
  createWarehouse(@Body() body: any) {
    return this.service.createWarehouse(body);
  }
}

@Module({
  controllers: [CatalogController],
  providers: [CatalogLookupService],
  exports: [CatalogLookupService],
})
export class CatalogModule {}
