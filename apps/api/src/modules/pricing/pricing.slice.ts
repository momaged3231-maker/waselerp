import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { resolvePrice } from '../../common/pricing';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

/**
 * Price lists.
 *
 * A list holds one price per item (and optionally per selling unit). Lists are
 * resolved for a customer in this order:
 *   1. the list assigned to the customer,
 *   2. the list of the branch,
 *   3. the highest priority active list,
 *   4. the price on the item card.
 */
@Injectable()
export class PricingService {
  constructor(private readonly db: DatabaseService) {}

  async lists(branchId: number) {
    return this.db.query<any>(
      `SELECT p.price_list_id AS "priceListId", p.name, p.code, p.list_type AS "listType",
              p.branch_id AS "branchId", b.name AS "branchName", p.priority,
              p.discount_pct AS "discountPct", p.start_date AS "startDate", p.end_date AS "endDate",
              p.notes, p.is_active AS "isActive",
              (SELECT count(*)::int FROM price_list_lines l WHERE l.price_list_id = p.price_list_id) AS "lineCount",
              (SELECT count(*)::int FROM parties pa WHERE pa.price_list_id = p.price_list_id) AS "partyCount"
         FROM price_lists p LEFT JOIN branches b ON b.branch_id = p.branch_id
        WHERE ($1::int = 0 OR p.branch_id = $1::int OR p.branch_id IS NULL)
        ORDER BY p.priority DESC, p.name`,
      [branchId],
    );
  }

  async list(id: number) {
    const header = await this.db.one<any>(
      `SELECT price_list_id AS "priceListId", name, code, list_type AS "listType",
              branch_id AS "branchId", priority, discount_pct AS "discountPct",
              start_date AS "startDate", end_date AS "endDate", notes, is_active AS "isActive"
         FROM price_lists WHERE price_list_id = $1::int`,
      [id],
    );
    if (!header) throw new BadRequestException('قائمة الأسعار غير موجودة');
    const lines = await this.db.query<any>(
      `SELECT l.price_list_line_id AS "priceListLineId", l.item_id AS "itemId", i.code AS "itemCode",
              i.name AS "itemName", l.unit_id AS "unitId", u.name AS "unitName",
              l.price, l.min_price AS "minPrice",
              l.start_date AS "startDate", l.end_date AS "endDate"
         FROM price_list_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.price_list_id = $1::int
        ORDER BY i.code, u.name`,
      [id],
    );
    return { header, lines };
  }

  async saveList(dto: any) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم قائمة الأسعار مطلوب');
    const row = await this.db.one<{ price_list_id: number }>(
      `INSERT INTO price_lists
         (name, code, list_type, branch_id, priority, discount_pct, start_date, end_date, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (price_list_id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code,
         list_type = EXCLUDED.list_type, branch_id = EXCLUDED.branch_id, priority = EXCLUDED.priority,
         discount_pct = EXCLUDED.discount_pct, start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, notes = EXCLUDED.notes, is_active = EXCLUDED.is_active
       RETURNING price_list_id`,
      [name, dto.code ?? null, Number(dto.listType ?? 1),
        dto.branchId ? Number(dto.branchId) : null, Number(dto.priority ?? 0),
        Number(dto.discountPct ?? 0), dto.startDate ?? null, dto.endDate ?? null,
        dto.notes ?? null, dto.isActive !== false],
    );
    return { priceListId: Number(row.price_list_id) };
  }

  async updateList(id: number, dto: any) {
    const existing = await this.db.one<any>('SELECT * FROM price_lists WHERE price_list_id = $1::int', [id]);
    if (!existing) throw new BadRequestException('قائمة الأسعار غير موجودة');
    await this.db.query(
      `UPDATE price_lists SET name = $2, code = $3, list_type = $4, branch_id = $5, priority = $6,
              discount_pct = $7, start_date = $8, end_date = $9, notes = $10, is_active = $11
        WHERE price_list_id = $1::int`,
      [id, dto.name ?? existing.name, dto.code ?? existing.code,
        Number(dto.listType ?? existing.list_type),
        dto.branchId === undefined ? existing.branch_id : (dto.branchId ? Number(dto.branchId) : null),
        Number(dto.priority ?? existing.priority),
        Number(dto.discountPct ?? existing.discount_pct),
        dto.startDate ?? existing.start_date, dto.endDate ?? existing.end_date,
        dto.notes ?? existing.notes, dto.isActive === undefined ? existing.is_active : !!dto.isActive],
    );
    return { priceListId: id };
  }

  async deleteList(id: number) {
    const used = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM parties WHERE price_list_id = $1::int',
      [id],
    );
    if (Number(used.c) > 0) {
      throw new BadRequestException('القائمة مرتبطة بعملاء — ألغِ الربط أولاً');
    }
    await this.db.query('DELETE FROM price_lists WHERE price_list_id = $1::int', [id]);
    return { priceListId: id, deleted: true };
  }

  /** Replaces the whole content of a list (bulk edit from the grid). */
  async saveLines(id: number, dto: any) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    return this.db.transaction(async (client) => {
      const header = await client.query('SELECT price_list_id FROM price_lists WHERE price_list_id = $1::int', [id]);
      if (!header.rows.length) throw new BadRequestException('قائمة الأسعار غير موجودة');

      if (dto.replace !== false) {
        await client.query('DELETE FROM price_list_lines WHERE price_list_id = $1::int', [id]);
      }
      for (const line of lines) {
        if (!line.itemId) continue;
        const price = Number(line.price ?? 0);
        if (price < 0) throw new BadRequestException('السعر لا يمكن أن يكون سالبًا');
        const unitId = line.unitId ? Number(line.unitId) : null;
        // Replace the price of the same item/unit instead of relying on a
        // unique constraint (the unit is nullable).
        await client.query(
          `DELETE FROM price_list_lines
            WHERE price_list_id = $1::int AND item_id = $2::int
              AND unit_id IS NOT DISTINCT FROM $3::int`,
          [id, Number(line.itemId), unitId],
        );
        await client.query(
          `INSERT INTO price_list_lines
             (price_list_id, item_id, unit_id, price, min_price, start_date, end_date)
           VALUES ($1::int,$2::int,$3::int,$4::numeric,$5::numeric,$6::date,$7::date)`,
          [id, Number(line.itemId), unitId, price,
            Number(line.minPrice ?? 0), line.startDate ?? null, line.endDate ?? null],
        );
      }
      return { priceListId: id, lineCount: lines.length };
    });
  }

  /**
   * Resolves the price of an item for a customer.
   * Returns the price and the list it came from.
   */
  async resolve(params: {
    itemId: number; unitId?: number; partyId?: number; branchId?: number; date?: string;
  }) {
    const price = await resolvePrice(this.db, params);
    if (!price) throw new BadRequestException('الصنف غير موجود');
    return price;
  }

  /** Resolves the price list assigned to a customer (or the branch default). */
  async listForParty(partyId: number) {
    const row = await this.db.one<any>(
      `SELECT p.price_list_id AS "priceListId", p.name, p.list_type AS "listType",
              p.discount_pct AS "discountPct"
         FROM parties pa JOIN price_lists p ON p.price_list_id = pa.price_list_id
        WHERE pa.party_id = $1::int AND p.is_active = true`,
      [partyId],
    );
    return row ?? null;
  }

  /** Items of a list with their prices, for the POS picker. */
  async listItems(priceListId: number, search?: string) {
    const like = `%${(search ?? '').trim()}%`;
    return this.db.query<any>(
      `SELECT l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName", l.price, l.min_price AS "minPrice",
              i.barcode, i.vat_pct AS "vatPct", i.sell_price AS "cardPrice"
         FROM price_list_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.price_list_id = $1::int
          AND ($2::text = '' OR i.code ILIKE $2 OR i.name ILIKE $2 OR i.barcode ILIKE $2)
        ORDER BY i.code`,
      [priceListId, like],
    );
  }
  // ------------------------------------------------------------------ //
  //  Coupons
  // ------------------------------------------------------------------ //
  async listCoupons(branchId: number) {
    return this.db.query<any>(
      `SELECT c.coupon_id AS "couponId", c.code, c.name, c.discount_type AS "discountType",
              c.discount_value AS "discountValue", c.min_invoice_amount AS "minInvoiceAmount",
              c.max_discount AS "maxDiscount", c.branch_id AS "branchId", b.name AS "branchName",
              c.start_date AS "startDate", c.end_date AS "endDate", c.usage_limit AS "usageLimit",
              c.used_count AS "usedCount", c.is_active AS "isActive"
         FROM coupons c LEFT JOIN branches b ON b.branch_id = c.branch_id
        WHERE ($1::int = 0 OR c.branch_id = $1::int OR c.branch_id IS NULL)
        ORDER BY c.code`,
      [branchId],
    );
  }

  async saveCoupon(dto: any) {
    const code = String(dto.code ?? '').trim().toUpperCase();
    if (!code) throw new BadRequestException('كود الكوبون مطلوب');
    const row = await this.db.one<{ coupon_id: number }>(
      `INSERT INTO coupons
         (code, name, discount_type, discount_value, min_invoice_amount, max_discount, branch_id,
          start_date, end_date, usage_limit, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, discount_type = EXCLUDED.discount_type,
         discount_value = EXCLUDED.discount_value, min_invoice_amount = EXCLUDED.min_invoice_amount,
         max_discount = EXCLUDED.max_discount, branch_id = EXCLUDED.branch_id,
         start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
         usage_limit = EXCLUDED.usage_limit, is_active = EXCLUDED.is_active
       RETURNING coupon_id`,
      [code, dto.name ?? null, Number(dto.discountType ?? 1), Number(dto.discountValue ?? 0),
        Number(dto.minInvoiceAmount ?? 0), dto.maxDiscount ?? null,
        dto.branchId ? Number(dto.branchId) : null, dto.startDate ?? null, dto.endDate ?? null,
        dto.usageLimit ?? null, dto.isActive !== false],
    );
    return { couponId: Number(row.coupon_id), code };
  }

  async deleteCoupon(id: number) {
    await this.db.query('DELETE FROM coupons WHERE coupon_id = $1::int', [id]);
    return { couponId: id, deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Gift offers (buy X get Y free)
  // ------------------------------------------------------------------ //
  async listGiftOffers() {
    return this.db.query<any>(
      `SELECT g.gift_offer_id AS "giftOfferId", g.name,
              g.source_item_id AS "sourceItemId", si.code AS "sourceItemCode", si.name AS "sourceItemName",
              g.source_quantity AS "sourceQuantity",
              g.gift_item_id AS "giftItemId", gi.code AS "giftItemCode", gi.name AS "giftItemName",
              g.gift_quantity AS "giftQuantity", g.gift_unit_id AS "giftUnitId",
              g.bundle_price AS "bundlePrice", g.start_date AS "startDate", g.end_date AS "endDate",
              g.is_active AS "isActive"
         FROM gift_offers g
         JOIN items si ON si.item_id = g.source_item_id
         JOIN items gi ON gi.item_id = g.gift_item_id
        ORDER BY g.name`,
    );
  }

  async saveGiftOffer(dto: any) {
    if (!dto.sourceItemId || !dto.giftItemId) {
      throw new BadRequestException('الصنف المصدر وصنف الهدية مطلوبان');
    }
    const row = await this.db.one<{ gift_offer_id: number }>(
      `INSERT INTO gift_offers
         (name, source_item_id, source_quantity, gift_item_id, gift_quantity, gift_unit_id,
          bundle_price, start_date, end_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING gift_offer_id`,
      [dto.name ?? 'عرض هدية', Number(dto.sourceItemId), Number(dto.sourceQuantity ?? 1),
        Number(dto.giftItemId), Number(dto.giftQuantity ?? 1),
        dto.giftUnitId ? Number(dto.giftUnitId) : null, dto.bundlePrice ?? null,
        dto.startDate ?? null, dto.endDate ?? null, dto.isActive !== false],
    );
    return { giftOfferId: Number(row.gift_offer_id) };
  }

  async updateGiftOffer(id: number, dto: any) {
    await this.db.query(
      `UPDATE gift_offers SET name = $2, source_item_id = $3, source_quantity = $4, gift_item_id = $5,
              gift_quantity = $6, gift_unit_id = $7, bundle_price = $8, start_date = $9, end_date = $10,
              is_active = $11
        WHERE gift_offer_id = $1::int`,
      [id, dto.name ?? 'عرض هدية', Number(dto.sourceItemId), Number(dto.sourceQuantity ?? 1),
        Number(dto.giftItemId), Number(dto.giftQuantity ?? 1),
        dto.giftUnitId ? Number(dto.giftUnitId) : null, dto.bundlePrice ?? null,
        dto.startDate ?? null, dto.endDate ?? null, dto.isActive !== false],
    );
    return { giftOfferId: id };
  }

  async deleteGiftOffer(id: number) {
    await this.db.query('DELETE FROM gift_offers WHERE gift_offer_id = $1::int', [id]);
    return { giftOfferId: id, deleted: true };
  }
}

@Controller('pricing')
export class PricingController {
  constructor(private readonly service: PricingService) {}

  @RequirePermissions('items.view')
  @Get('lists')
  lists(@CurrentBranch() branchId: number) {
    return this.service.lists(branchId);
  }

  @RequirePermissions('items.view')
  @Get('lists/:id')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.service.list(id);
  }

  @RequirePermissions('items.manage')
  @Post('lists')
  saveList(@Body() dto: any) {
    return this.service.saveList(dto);
  }

  @RequirePermissions('items.manage')
  @Put('lists/:id')
  updateList(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateList(id, dto);
  }

  @RequirePermissions('items.manage')
  @Delete('lists/:id')
  deleteList(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteList(id);
  }

  @RequirePermissions('items.manage')
  @Post('lists/:id/lines')
  saveLines(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.saveLines(id, dto);
  }

  @RequirePermissions('items.view')
  @Get('lists/:id/items')
  listItems(@Param('id', ParseIntPipe) id: number, @Query('search') search: string) {
    return this.service.listItems(id, search);
  }

  @RequirePermissions('items.view')
  @Get('resolve')
  resolve(
    @Query('itemId') itemId: string,
    @Query('unitId') unitId: string,
    @Query('partyId') partyId: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.resolve({
      itemId: Number(itemId),
      unitId: unitId ? Number(unitId) : undefined,
      partyId: partyId ? Number(partyId) : undefined,
      branchId,
    });
  }

  // ---- coupons ------------------------------------------------------- //
  @RequirePermissions('items.view')
  @Get('coupons')
  listCoupons(@CurrentBranch() branchId: number) {
    return this.service.listCoupons(branchId);
  }

  @RequirePermissions('items.manage')
  @Post('coupons')
  saveCoupon(@Body() dto: any) {
    return this.service.saveCoupon(dto);
  }

  @RequirePermissions('items.manage')
  @Delete('coupons/:id')
  deleteCoupon(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteCoupon(id);
  }

  // ---- gift offers --------------------------------------------------- //
  @RequirePermissions('items.view')
  @Get('gift-offers')
  listGiftOffers() {
    return this.service.listGiftOffers();
  }

  @RequirePermissions('items.manage')
  @Post('gift-offers')
  saveGiftOffer(@Body() dto: any) {
    return this.service.saveGiftOffer(dto);
  }

  @RequirePermissions('items.manage')
  @Put('gift-offers/:id')
  updateGiftOffer(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateGiftOffer(id, dto);
  }

  @RequirePermissions('items.manage')
  @Delete('gift-offers/:id')
  deleteGiftOffer(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteGiftOffer(id);
  }
}

@Module({
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
