import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { resolvePrices } from '../../common/pricing';
import { CurrentBranch, CurrentUser, AuthUser, RequirePermissions } from '../../common/security';
import { LiveEventsService } from '../events/live-events.service';
import { EventsModule } from '../events/events.slice';

export interface ItemDto {
  itemId?: number;
  code: string;
  barcode?: string;
  name: string;
  nameEn?: string;
  categoryId?: number;
  baseUnitId: number;
  costPrice: number;
  sellPrice: number;
  vatPct?: number;
  discountPct?: number;
  reorderPoint?: number;
  isService?: boolean;
  hasSerial?: boolean;
  isActive?: boolean;
  notes?: string;
}

@Injectable()
export class ItemsService {
  constructor(private readonly db: DatabaseService, private readonly live: LiveEventsService) {}

  async search(params: {
    search?: string; categoryId?: number; warehouseId?: number; page: number; pageSize: number;
    includeInactive?: boolean; partyId?: number; branchId?: number;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;

    const where = `
      WHERE ($1::text = '' OR i.name ILIKE $2 OR i.code ILIKE $2 OR COALESCE(i.barcode,'') ILIKE $2)
        AND ($3::int IS NULL OR i.category_id = $3)
        AND ($4::boolean = false OR i.is_active = true)
        AND ($5::int IS NULL OR EXISTS (
              SELECT 1 FROM item_warehouse_qty q2
               WHERE q2.item_id = i.item_id AND q2.warehouse_id = $5 AND q2.unit_id = i.base_unit_id))`;

    const args = [
      search, like, params.categoryId ?? null, params.includeInactive ?? false, params.warehouseId ?? null,
    ];

    const items = await this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.name_en AS "nameEn", i.barcode,
              i.category_id AS "categoryId", c.name AS "categoryName",
              i.base_unit_id AS "baseUnitId", u.name AS "baseUnitName",
              i.cost_price AS "costPrice", i.sell_price AS "sellPrice",
              i.vat_pct AS "vatPct", i.discount_pct AS "discountPct", i.reorder_point AS "reorderPoint",
              i.is_service AS "isService", i.has_serial AS "hasSerial", i.is_active AS "isActive",
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id
                           AND ($5::int IS NULL OR q.warehouse_id = $5)), 0) AS "onHandQty",
              COALESCE((SELECT json_agg(json_build_object(
                          'unitId', iu.unit_id, 'unitName', u2.name, 'factor', iu.factor,
                          'sellPrice', iu.sell_price, 'buyPrice', iu.buy_price, 'isDefault', iu.is_default)
                          ORDER BY iu.factor)
                          FROM item_units iu JOIN units u2 ON u2.unit_id = iu.unit_id
                         WHERE iu.item_id = i.item_id), '[]'::json) AS units
         FROM items i
         LEFT JOIN categories c ON c.category_id = i.category_id
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
         ${where}
        ORDER BY i.name
        LIMIT $6 OFFSET $7`,
      [...args, params.pageSize, offset],
    );

    const total = await this.db.count(
      `SELECT COUNT(*)::int AS count FROM items i ${where}`,
      args,
    );

    // When a customer is selected the price list of that customer wins over
    // the price on the item card.
    let priced = items;
    if (params.partyId) {
      const prices = await resolvePrices(this.db, {
        itemIds: items.map((row: any) => Number(row.itemId)),
        partyId: params.partyId,
        branchId: params.branchId,
      });
      priced = items.map((row: any) => {
        const resolved = prices.get(Number(row.itemId));
        if (!resolved) return row;
        return {
          ...row,
          sellPrice: resolved.finalPrice,
          listPrice: resolved.price,
          priceListId: resolved.priceListId,
          priceListName: resolved.priceListName,
        };
      });
    }

    return { items: priced, total, page: params.page, pageSize: params.pageSize };
  }

  async findOne(id: number, warehouseId?: number) {
    const row = await this.db.one(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.name_en AS "nameEn", i.barcode,
              i.category_id AS "categoryId", c.name AS "categoryName",
              i.base_unit_id AS "baseUnitId", u.name AS "baseUnitName",
              i.cost_price AS "costPrice", i.sell_price AS "sellPrice",
              i.vat_pct AS "vatPct", i.discount_pct AS "discountPct", i.reorder_point AS "reorderPoint",
              i.is_service AS "isService", i.has_serial AS "hasSerial", i.is_active AS "isActive",
              i.notes,
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id), 0) AS "onHandQty"
         FROM items i
         LEFT JOIN categories c ON c.category_id = i.category_id
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.item_id = $1`,
      [id],
    );
    if (!row) return null;
    const units = await this.db.query(
      `SELECT iu.item_unit_id AS "itemUnitId", iu.unit_id AS "unitId", u.name AS "unitName",
              iu.factor, iu.sell_price AS "sellPrice", iu.buy_price AS "buyPrice", iu.is_default AS "isDefault"
         FROM item_units iu JOIN units u ON u.unit_id = iu.unit_id
        WHERE iu.item_id = $1 ORDER BY iu.factor`,
      [id],
    );
    return { ...row, units };
  }

  /** Fast barcode / code lookup used by the POS scanner. */
  async lookupByCode(code: string, warehouseId?: number) {
    const rows = await this.db.query(
      `SELECT i.item_id AS "itemId", i.code, i.name, i.barcode, i.base_unit_id AS "baseUnitId",
              i.sell_price AS "sellPrice", i.cost_price AS "costPrice", i.vat_pct AS "vatPct",
              i.discount_pct AS "discountPct", i.is_service AS "isService", i.has_serial AS "hasSerial",
              u.name AS "unitName",
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id
                           AND ($2::int IS NULL OR q.warehouse_id = $2)), 0) AS "onHandQty"
         FROM items i LEFT JOIN units u ON u.unit_id = i.base_unit_id
        WHERE i.is_active = true AND (i.barcode = $1 OR i.code = $1)
        LIMIT 5`,
      [code, warehouseId ?? null],
    );
    return rows;
  }

  async create(dto: ItemDto, user: AuthUser) {
    const row = await this.db.one(
      `INSERT INTO items (code, barcode, name, name_en, category_id, base_unit_id, cost_price, sell_price,
                          vat_pct, discount_pct, reorder_point, is_service, has_serial, is_active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING item_id`,
      [
        dto.code, dto.barcode ?? null, dto.name, dto.nameEn ?? null, dto.categoryId ?? null,
        dto.baseUnitId, dto.costPrice, dto.sellPrice, dto.vatPct ?? 0, dto.discountPct ?? 0,
        dto.reorderPoint ?? 0, dto.isService ?? false, dto.hasSerial ?? false, dto.isActive ?? true, dto.notes ?? null,
      ],
    );
    this.live.publish({ type: 'item.updated', itemIds: [Number(row.item_id)] });
    return { itemId: row.item_id };
  }

  async update(id: number, dto: ItemDto) {
    await this.db.query(
      `UPDATE items SET code=$2, barcode=$3, name=$4, name_en=$5, category_id=$6, base_unit_id=$7,
              cost_price=$8, sell_price=$9, vat_pct=$10, discount_pct=$11, reorder_point=$12,
              is_service=$13, has_serial=$14, is_active=$15, notes=$16, version = version + 1
        WHERE item_id=$1`,
      [
        id, dto.code, dto.barcode ?? null, dto.name, dto.nameEn ?? null, dto.categoryId ?? null,
        dto.baseUnitId, dto.costPrice, dto.sellPrice, dto.vatPct ?? 0, dto.discountPct ?? 0,
        dto.reorderPoint ?? 0, dto.isService ?? false, dto.hasSerial ?? false, dto.isActive ?? true, dto.notes ?? null,
      ],
    );
    this.live.publish({ type: 'item.updated', itemIds: [id] });
    return { itemId: id };
  }

  async remove(id: number) {
    await this.db.query('UPDATE items SET is_active = false, version = version + 1 WHERE item_id = $1', [id]);
    return { itemId: id };
  }

  async saveUnits(itemId: number, units: { unitId: number; factor: number; sellPrice?: number; buyPrice?: number }[]) {
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM item_units WHERE item_id = $1', [itemId]);
      for (const unit of units) {
        await client.query(
          `INSERT INTO item_units (item_id, unit_id, factor, sell_price, buy_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [itemId, unit.unitId, unit.factor, unit.sellPrice ?? null, unit.buyPrice ?? null],
        );
      }
    });
    return { itemId, unitCount: units.length };
  }
}

@Controller('items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @RequirePermissions('items.view')
  @Get()
  search(
    @Query('search') search: string,
    @Query('categoryId') categoryId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('partyId') partyId: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.search({
      search,
      categoryId: categoryId ? Number(categoryId) : undefined,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
      includeInactive: false,
      partyId: partyId ? Number(partyId) : undefined,
      branchId,
    });
  }

  @RequirePermissions('items.view')
  @Get('lookup')
  lookup(@Query('code') code: string, @CurrentBranch() branchId: number) {
    return this.service.lookupByCode(code, branchId);
  }

  @RequirePermissions('items.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.findOne(id, branchId);
  }

  @RequirePermissions('items.manage')
  @Post()
  create(@Body() dto: ItemDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @RequirePermissions('items.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: ItemDto) {
    return this.service.update(id, dto);
  }

  @RequirePermissions('items.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @RequirePermissions('items.manage')
  @Post(':id/units')
  saveUnits(@Param('id', ParseIntPipe) id: number, @Body() body: { units: any[] }) {
    return this.service.saveUnits(id, body.units ?? []);
  }
}

@Module({
  imports: [EventsModule],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
