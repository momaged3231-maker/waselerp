import {
  Body, Controller, Delete, Get, Injectable, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { applyMovement, getWarehouseCost, toBaseUnits } from '../../common/stock';
import { postJournal, resolveMapping } from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

/** Money is rounded to two decimals; quantities to six. */
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round6 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

const TYPE_LABEL: Record<number, string> = {
  1: 'وارد', 2: 'صادر', 3: 'تالف', 4: 'افتتاحي',
};

/**
 * Stock voucher (أذن مخزن).
 *
 * A warehouse voucher that stays a draft while being prepared and is applied
 * to the stock only when it is approved. Supported types:
 *  1 incoming  (وارد)   — increases stock, posts Dr INVENTORY / Cr INVENTORY_ADDITION
 *  2 outgoing  (صادر)   — decreases stock, posts Dr COGS / Cr INVENTORY
 *  3 damage    (تالف)    — decreases stock, posts Dr DAMAGE_EXPENSE / Cr INVENTORY
 *  4 opening   (افتتاحي) — increases stock, posts Dr INVENTORY / Cr RETAINED_EARNINGS
 */
@Injectable()
export class StockVoucherService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: {
    branchId: number; status?: number; type?: number; warehouseId?: number;
    from?: string; to?: string; search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT v.stock_voucher_id AS "stockVoucherId", v.voucher_no AS "voucherNo",
              v.voucher_date AS "voucherDate", v.warehouse_id AS "warehouseId",
              w.name AS "warehouseName", v.voucher_type AS "voucherType",
              v.status, v.notes, v.gl_journal_id AS "glJournalId",
              v.created_at AS "createdAt", v.approved_at AS "approvedAt",
              u.full_name AS "createdBy",
              (SELECT count(*)::int FROM stock_voucher_lines l
                WHERE l.stock_voucher_id = v.stock_voucher_id) AS "lineCount"
         FROM stock_vouchers v
         JOIN warehouses w ON w.warehouse_id = v.warehouse_id
        WHERE ($1::int = 0 OR v.branch_id = $1::int)
          AND ($2::int = 0 OR v.status = $2::int)
          AND ($3::int = 0 OR v.voucher_type = $3::int)
          AND ($4::int = 0 OR v.warehouse_id = $4::int)
          AND ($5::date IS NULL OR v.voucher_date >= $5::date)
          AND ($6::date IS NULL OR v.voucher_date <= $6::date)
          AND ($7::text = '' OR v.voucher_no ILIKE $8)
        ORDER BY v.voucher_date DESC, v.stock_voucher_id DESC
        LIMIT $9::int`,
      [params.branchId, params.status ?? 0, params.type ?? 0, params.warehouseId ?? 0,
        params.from ?? null, params.to ?? null, search, like, params.limit],
    );
  }

  async findOne(id: number) {
    const header = await this.db.one<any>(
      `SELECT v.stock_voucher_id AS "stockVoucherId", v.voucher_no AS "voucherNo",
              v.voucher_date AS "voucherDate", v.branch_id AS "branchId",
              v.warehouse_id AS "warehouseId", w.name AS "warehouseName",
              v.voucher_type AS "voucherType", v.status, v.notes,
              v.gl_journal_id AS "glJournalId",
              v.created_at AS "createdAt", v.approved_at AS "approvedAt",
              u.full_name AS "createdBy"
         FROM stock_vouchers v
         JOIN warehouses w ON w.warehouse_id = v.warehouse_id
         LEFT JOIN users u ON u.user_id = v.created_by
        WHERE v.stock_voucher_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('أذن المخزن غير موجود');

    const lines = await this.db.query<any>(
      `SELECT l.stock_voucher_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName",
              l.quantity AS "quantity", l.unit_cost AS "unitCost",
              (l.quantity * l.unit_cost) AS "lineValue",
              l.serial_no AS "serialNo", l.expiry_date AS "expiryDate", l.notes
         FROM stock_voucher_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.stock_voucher_id = $1::bigint
        ORDER BY l.line_number`,
      [id],
    );

    return { header, lines };
  }

  /** Creates an empty voucher (draft). */
  async create(dto: any, user: AuthUser, branchId: number) {
    const warehouseId = Number(dto.warehouseId);
    if (!warehouseId) throw new BadRequestException('اختر المخزن');
    const voucherType = Number(dto.voucherType);
    if (!voucherType || ![1, 2, 3, 4].includes(voucherType)) {
      throw new BadRequestException('نوع الأذن غير صحيح');
    }

    return this.db.transaction(async (client) => {
      const warehouse = await client.query<any>(
        'SELECT warehouse_id, branch_id FROM warehouses WHERE warehouse_id = $1::int AND is_active = true',
        [warehouseId],
      );
      if (!warehouse.rows.length) throw new BadRequestException('المخزن غير موجود');
      if (Number(warehouse.rows[0].branch_id) !== Number(branchId)) {
        throw new BadRequestException('المخزن لا يتبع الفرع الحالي');
      }

      const serial = await this.nextNumber(client, `stockvoucher:${branchId}`);
      const voucherNo = `SV-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ stock_voucher_id: number }>(
        `INSERT INTO stock_vouchers
           (voucher_no, voucher_date, branch_id, warehouse_id, voucher_type, status, notes, created_by)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::int, $4::int, $5::int, 1, $6, $7::int)
         RETURNING stock_voucher_id`,
        [voucherNo, dto.voucherDate ?? null, branchId, warehouseId, voucherType,
          dto.notes ?? null, user.userId],
      );
      return { stockVoucherId: Number(inserted.rows[0].stock_voucher_id), voucherNo };
    });
  }

  /** Edits the header of a draft voucher. */
  async update(id: number, dto: any) {
    const header = await this.draftHeader(id);
    await this.db.query(
      `UPDATE stock_vouchers SET voucher_date = COALESCE($2::date, voucher_date),
              warehouse_id = COALESCE($3::int, warehouse_id),
              voucher_type = COALESCE($4::int, voucher_type),
              notes = COALESCE($5, notes)
        WHERE stock_voucher_id = $1::bigint`,
      [id, dto.voucherDate ?? null, dto.warehouseId ? Number(dto.warehouseId) : null,
        dto.voucherType ? Number(dto.voucherType) : null, dto.notes ?? null],
    );
    return { stockVoucherId: id, warehouseId: header.warehouse_id };
  }

  private async draftHeader(id: number) {
    const row = await this.db.one<any>(
      'SELECT stock_voucher_id, warehouse_id, status FROM stock_vouchers WHERE stock_voucher_id = $1::bigint',
      [id],
    );
    if (!row) throw new BadRequestException('أذن المخزن غير موجود');
    if (Number(row.status) === 2) throw new BadRequestException('الأذن المعتمد لا يمكن تعديله');
    if (Number(row.status) === 3) throw new BadRequestException('الأذن ملغى');
    return row;
  }

  /** Adds a line to a draft voucher. Same item + same unit merges quantities. */
  async addLine(id: number, dto: any) {
    const header = await this.draftHeader(id);
    const itemId = Number(dto.itemId);
    if (!itemId) throw new BadRequestException('اختر الصنف');
    const quantity = Number(dto.quantity ?? 0);
    if (quantity <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');

    return this.db.transaction(async (client) => {
      const item = await client.query<any>(
        `SELECT item_id, base_unit_id, cost_price, name FROM items WHERE item_id = $1::int AND is_active = true`,
        [itemId],
      );
      if (!item.rows.length) throw new BadRequestException('الصنف غير موجود');
      const baseUnitId = Number(item.rows[0].base_unit_id);
      const unitId = dto.unitId ? Number(dto.unitId) : baseUnitId;
      const qtyBase = await toBaseUnits(client, itemId, unitId, quantity);

      const existing = await client.query<any>(
        `SELECT stock_voucher_line_id, quantity, unit_id
           FROM stock_voucher_lines
          WHERE stock_voucher_id = $1::bigint AND item_id = $2::int AND unit_id = $3::int
          FOR UPDATE`,
        [id, itemId, unitId],
      );

      if (existing.rows.length) {
        const line = existing.rows[0];
        const newQty = round6(Number(line.quantity) + qtyBase);
        await client.query(
          `UPDATE stock_voucher_lines SET quantity = $2::numeric WHERE stock_voucher_line_id = $1::bigint`,
          [line.stock_voucher_line_id, newQty],
        );
        return { added: true, merged: true, quantity: newQty };
      }

      const lineNo = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM stock_voucher_lines WHERE stock_voucher_id = $1::bigint',
        [id],
      );
      const unitCost = Number(dto.unitCost ?? 0) > 0 ? Number(dto.unitCost)
        : (await getWarehouseCost(client, itemId, Number(header.warehouse_id))) || Number(item.rows[0].cost_price ?? 0);

      await client.query(
        `INSERT INTO stock_voucher_lines
           (stock_voucher_id, line_number, item_id, unit_id, quantity, unit_cost, serial_no, expiry_date, notes)
         VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
        [id, Number(lineNo.rows[0].n), itemId, unitId, qtyBase, round2(unitCost),
          dto.serialNo ?? null, dto.expiryDate ?? null, dto.notes ?? null],
      );
      return { added: true, merged: false, quantity: qtyBase };
    });
  }

  /** Edits the quantity of a line. */
  async updateLine(id: number, lineId: number, dto: any) {
    await this.draftHeader(id);
    return this.db.transaction(async (client) => {
      const line = await client.query<any>(
        'SELECT * FROM stock_voucher_lines WHERE stock_voucher_line_id = $1::bigint AND stock_voucher_id = $2::bigint',
        [lineId, id],
      );
      if (!line.rows.length) throw new BadRequestException('السطر غير موجود');
      const quantity = Number(dto.quantity ?? line.rows[0].quantity);
      if (quantity <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
      await client.query(
        `UPDATE stock_voucher_lines
            SET quantity = $2::numeric, unit_cost = COALESCE($3, unit_cost),
                notes = COALESCE($4, notes)
          WHERE stock_voucher_line_id = $1::bigint`,
        [lineId, quantity, dto.unitCost ?? null, dto.notes ?? null],
      );
      return { lineId, quantity };
    });
  }

  /** Removes a line from a draft voucher. */
  async removeLine(id: number, lineId: number) {
    await this.draftHeader(id);
    await this.db.query(
      'DELETE FROM stock_voucher_lines WHERE stock_voucher_line_id = $1::bigint AND stock_voucher_id = $2::bigint',
      [lineId, id],
    );
    return { lineId, deleted: true };
  }

  /**
   * Approves the voucher: applies stock movements and posts an accounting entry.
   */
  async approve(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM stock_vouchers WHERE stock_voucher_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('أذن المخزن غير موجود');
      const voucher = header.rows[0];
      if (Number(voucher.status) === 2) throw new BadRequestException('الأذن معتمد بالفعل');

      const lines = await client.query<any>(
        'SELECT * FROM stock_voucher_lines WHERE stock_voucher_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد أصناف في الأذن');

      const voucherType = Number(voucher.voucher_type);
      let netValue = 0;
      const journalLines: any[] = [];

      for (const line of lines.rows) {
        const qtyBase = round6(Number(line.quantity));
        const unitCost = Number(line.unit_cost ?? 0);
        const value = round2(qtyBase * unitCost);
        netValue = round2(netValue + value);

        // Movement type and sign depend on the voucher type.
        let moveType: 'purchase' | 'sales' | 'adjustmentOut' | 'opening';
        if (voucherType === 1) moveType = 'purchase';
        else if (voucherType === 2) moveType = 'sales';
        else if (voucherType === 3) moveType = 'adjustmentOut';
        else moveType = 'opening';

        await applyMovement(client, {
          branchId: Number(voucher.branch_id),
          warehouseId: Number(voucher.warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType,
          quantity: qtyBase,
          unitCost,
          referenceType: 3,
          referenceId: id,
          referenceNo: voucher.voucher_no,
          userId: user.userId,
          notes: `أذن مخزن ${voucher.voucher_no}`,
        });

        // Journal lines per voucher type.
        if (voucherType === 1) {
          // Incoming: Dr INVENTORY / Cr INVENTORY_ADDITION
          journalLines.push(
            { accountId: await this.resolveMappingId(client, 'INVENTORY'), debit: value, description: 'وارد مخزون' },
            { accountId: await this.resolveMappingId(client, 'INVENTORY_ADDITION'), credit: value, description: 'إضافات مخزون' },
          );
        } else if (voucherType === 2) {
          // Outgoing: Dr COGS / Cr INVENTORY
          journalLines.push(
            { accountId: await this.resolveMappingId(client, 'COGS'), debit: value, description: 'صادر مخزون' },
            { accountId: await this.resolveMappingId(client, 'INVENTORY'), credit: value, description: 'تخفيض مخزون' },
          );
        } else if (voucherType === 3) {
          // Damage: Dr DAMAGE_EXPENSE / Cr INVENTORY
          journalLines.push(
            { accountId: await this.resolveMappingId(client, 'DAMAGE_EXPENSE'), debit: value, description: 'تالف وهادر' },
            { accountId: await this.resolveMappingId(client, 'INVENTORY'), credit: value, description: 'تخفيض مخزون تالف' },
          );
        } else {
          // Opening: Dr INVENTORY / Cr RETAINED_EARNINGS
          journalLines.push(
            { accountId: await this.resolveMappingId(client, 'INVENTORY'), debit: value, description: 'رصيد افتتاحي' },
            { accountId: await this.resolveMappingId(client, 'RETAINED_EARNINGS'), credit: value, description: 'رصيد افتتاحي' },
          );
        }
      }

      let journalId: number | null = null;
      if (journalLines.length) {
        journalId = await postJournal(client, {
          branchId: Number(voucher.branch_id),
          journalType: 8,
          description: `أذن مخزن ${voucher.voucher_no} (${TYPE_LABEL[voucherType]})`,
          sourceType: 'stock_voucher',
          sourceId: id,
          lines: journalLines,
          userId: user.userId,
          autoBalance: true,
        });
      }

      await client.query(
        `UPDATE stock_vouchers
            SET status = 2, approved_by = $2::int, approved_at = now(), gl_journal_id = $3::bigint
          WHERE stock_voucher_id = $1::bigint`,
        [id, user.userId, journalId],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.voucher.approve','stock_voucher',$3::bigint,$4)`,
        [user.userId, Number(voucher.branch_id), id,
          `اعتماد أذن مخزن ${voucher.voucher_no} (${TYPE_LABEL[voucherType]})`],
      );

      return { stockVoucherId: id, status: 2, totalValue: netValue, journalId };
    });
  }

  /** Deletes a draft voucher. An approved one can never be deleted. */
  async remove(id: number) {
    const header = await this.draftHeader(id);
    await this.db.query('DELETE FROM stock_vouchers WHERE stock_voucher_id = $1::bigint', [id]);
    return { stockVoucherId: id, deleted: true, warehouseId: header.warehouse_id };
  }

  private async resolveMappingId(client: PoolClient, key: string): Promise<number> {
    const mapping = await resolveMapping(client, key);
    if (!mapping) {
      throw new BadRequestException(`الربط المحاسبي غير مضبوط: ${key}`);
    }
    return mapping.accountId;
  }

  private async nextNumber(client: PoolClient, key: string): Promise<number> {
    const { rows } = await client.query<{ last_number: string }>(
      `INSERT INTO number_sequences (sequence_key, last_number) VALUES ($1, 1)
       ON CONFLICT (sequence_key) DO UPDATE SET last_number = number_sequences.last_number + 1
       RETURNING last_number`,
      [key],
    );
    return Number(rows[0].last_number);
  }
}

@Controller('stock-vouchers')
export class StockVoucherController {
  constructor(private readonly service: StockVoucherService) {}

  @RequirePermissions('stock.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('type') type: string,
    @Query('warehouseId') warehouseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.list({
      branchId,
      status: Number(status) || 0,
      type: Number(type) || 0,
      warehouseId: Number(warehouseId) || 0,
      from, to, search,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('stock.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @RequirePermissions('stock.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  @RequirePermissions('stock.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @RequirePermissions('stock.manage')
  @Post(':id/lines')
  addLine(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.addLine(id, dto);
  }

  @RequirePermissions('stock.manage')
  @Put(':id/lines/:lineId')
  updateLine(
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() dto: any,
  ) {
    return this.service.updateLine(id, lineId, dto);
  }

  @RequirePermissions('stock.manage')
  @Delete(':id/lines/:lineId')
  removeLine(
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
  ) {
    return this.service.removeLine(id, lineId);
  }

  @RequirePermissions('stock.manage')
  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @RequirePermissions('stock.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
