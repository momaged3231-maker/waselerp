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

const STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'أذن صادر تم إنشاؤه', 3: 'أذن وارد تم إنشاؤه', 4: 'مكتمل', 5: 'ملغي',
};

/**
 * Stock transfer (تحويل غير مباشر بين مخازن).
 *
 * trasfer indirect: يخرج الصنف من مخزن المصدر عبر أذن صادر (نوع 2)،
 * ثم يستلم في مخزن الوجهة عبر أذن وارد (نوع 1). كل أذن يُنشأ ويُعتمد
 * بشكل مستقل داخل نفس السند التجميعي.
 */
@Injectable()
export class StockTransferService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: {
    branchId: number; status?: number; fromWarehouseId?: number; toWarehouseId?: number;
    from?: string; to?: string; search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT t.stock_transfer_id AS "stockTransferId", t.transfer_no AS "transferNo",
              t.transfer_date AS "transferDate", t.branch_id AS "branchId",
              t.from_warehouse_id AS "fromWarehouseId", fw.name AS "fromWarehouseName",
              t.to_warehouse_id AS "toWarehouseId", tw.name AS "toWarehouseName",
              t.status, t.notes, t.outbound_voucher_id AS "outboundVoucherId",
              t.inbound_voucher_id AS "inboundVoucherId",
              t.created_at AS "createdAt", t.approved_at AS "approvedAt",
              t.received_at AS "receivedAt", t.completed_at AS "completedAt",
              u.full_name AS "createdBy",
              (SELECT count(*)::int FROM stock_transfer_lines l
                WHERE l.stock_transfer_id = t.stock_transfer_id) AS "lineCount"
         FROM stock_transfers t
         JOIN warehouses fw ON fw.warehouse_id = t.from_warehouse_id
         JOIN warehouses tw ON tw.warehouse_id = t.to_warehouse_id
         LEFT JOIN users u ON u.user_id = t.created_by
        WHERE ($1::int = 0 OR t.branch_id = $1::int)
          AND ($2::int = 0 OR t.status = $2::int)
          AND ($3::int = 0 OR t.from_warehouse_id = $3::int)
          AND ($4::int = 0 OR t.to_warehouse_id = $4::int)
          AND ($5::date IS NULL OR t.transfer_date >= $5::date)
          AND ($6::date IS NULL OR t.transfer_date <= $6::date)
          AND ($7::text = '' OR t.transfer_no ILIKE $8)
        ORDER BY t.transfer_date DESC, t.stock_transfer_id DESC
        LIMIT $9::int`,
      [params.branchId, params.status ?? 0, params.fromWarehouseId ?? 0,
        params.toWarehouseId ?? 0, params.from ?? null, params.to ?? null,
        search, like, params.limit],
    );
  }

  async findOne(id: number) {
    const header = await this.db.one<any>(
      `SELECT t.stock_transfer_id AS "stockTransferId", t.transfer_no AS "transferNo",
              t.transfer_date AS "transferDate", t.branch_id AS "branchId",
              t.from_warehouse_id AS "fromWarehouseId", fw.name AS "fromWarehouseName",
              t.to_warehouse_id AS "toWarehouseId", tw.name AS "toWarehouseName",
              t.status, t.notes, t.outbound_voucher_id AS "outboundVoucherId",
              t.inbound_voucher_id AS "inboundVoucherId",
              t.created_at AS "createdAt", t.approved_at AS "approvedAt",
              t.received_at AS "receivedAt", t.completed_at AS "completedAt",
              u.full_name AS "createdBy"
         FROM stock_transfers t
         JOIN warehouses fw ON fw.warehouse_id = t.from_warehouse_id
         JOIN warehouses tw ON tw.warehouse_id = t.to_warehouse_id
         LEFT JOIN users u ON u.user_id = t.created_by
        WHERE t.stock_transfer_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('تحويل المخزون غير موجود');

    const lines = await this.db.query<any>(
      `SELECT l.stock_transfer_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName",
              l.quantity AS "quantity", l.unit_cost AS "unitCost",
              (l.quantity * l.unit_cost) AS "lineValue",
              l.serial_no AS "serialNo", l.expiry_date AS "expiryDate", l.notes
         FROM stock_transfer_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.stock_transfer_id = $1::bigint
        ORDER BY l.line_number`,
      [id],
    );

    return { header, lines };
  }

  /** Creates a new draft transfer between two warehouses of the same branch. */
  async create(dto: any, user: AuthUser, branchId: number) {
    const fromWarehouseId = Number(dto.fromWarehouseId);
    const toWarehouseId = Number(dto.toWarehouseId);
    if (!fromWarehouseId || !toWarehouseId) {
      throw new BadRequestException('حدد مخزني fuente والوجهة');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('مخازن fuente والوجهة يجب أن تكون مختلفة');
    }

    return this.db.transaction(async (client) => {
      const whs = await client.query<any>(
        `SELECT warehouse_id, branch_id FROM warehouses
          WHERE warehouse_id IN ($1::int,$2::int) AND is_active = true`,
        [fromWarehouseId, toWarehouseId],
      );
      if (whs.rows.length !== 2) throw new BadRequestException('أحد المخازن غير موجود');
      for (const row of whs.rows) {
        if (Number(row.branch_id) !== Number(branchId)) {
          throw new BadRequestException('أحد المخازن لا يتبع الفرع الحالي');
        }
      }

      const serial = await this.db.nextNumber(client, `stocktransfer:${branchId}`);
      const transferNo = `ST-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ stock_transfer_id: number }>(
        `INSERT INTO stock_transfers
           (transfer_no, transfer_date, branch_id, from_warehouse_id, to_warehouse_id,
            status, notes, created_by)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::int, $4::int, $5::int, 1, $6, $7::int)
         RETURNING stock_transfer_id`,
        [transferNo, dto.transferDate ?? null, branchId, fromWarehouseId, toWarehouseId,
          dto.notes ?? null, user.userId],
      );
      return { stockTransferId: Number(inserted.rows[0].stock_transfer_id), transferNo };
    });
  }

  /** Edits the header of a draft transfer. */
  async update(id: number, dto: any) {
    const header = await this.draftHeader(id);
    await this.db.query(
      `UPDATE stock_transfers SET transfer_date = COALESCE($2::date, transfer_date),
              from_warehouse_id = COALESCE($3::int, from_warehouse_id),
              to_warehouse_id = COALESCE($4::int, to_warehouse_id),
              notes = COALESCE($5, notes)
        WHERE stock_transfer_id = $1::bigint`,
      [id, dto.transferDate ?? null, dto.fromWarehouseId ? Number(dto.fromWarehouseId) : null,
        dto.toWarehouseId ? Number(dto.toWarehouseId) : null, dto.notes ?? null],
    );
    return { stockTransferId: id };
  }

  private async draftHeader(id: number) {
    const row = await this.db.one<any>(
      'SELECT stock_transfer_id, status FROM stock_transfers WHERE stock_transfer_id = $1::bigint',
      [id],
    );
    if (!row) throw new BadRequestException('تحويل المخزون غير موجود');
    if (Number(row.status) === 4) throw new BadRequestException('التحويل مكتمل ولا يمكن تعديله');
    if (Number(row.status) === 5) throw new BadRequestException('التحويل ملغي');
    return row;
  }

  /** Adds a line to a draft transfer. Same item + same unit merges quantities. */
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
        `SELECT stock_transfer_line_id, quantity, unit_id
           FROM stock_transfer_lines
          WHERE stock_transfer_id = $1::bigint AND item_id = $2::int AND unit_id = $3::int
          FOR UPDATE`,
        [id, itemId, unitId],
      );

      if (existing.rows.length) {
        const line = existing.rows[0];
        const newQty = round6(Number(line.quantity) + qtyBase);
        await client.query(
          `UPDATE stock_transfer_lines SET quantity = $2::numeric WHERE stock_transfer_line_id = $1::bigint`,
          [line.stock_transfer_line_id, newQty],
        );
        return { added: true, merged: true, quantity: newQty };
      }

      const lineNo = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM stock_transfer_lines WHERE stock_transfer_id = $1::bigint',
        [id],
      );
      const unitCost = Number(dto.unitCost ?? 0) > 0 ? Number(dto.unitCost)
        : (await getWarehouseCost(client, itemId, Number(header.from_warehouse_id))) || Number(item.rows[0].cost_price ?? 0);

      await client.query(
        `INSERT INTO stock_transfer_lines
           (stock_transfer_id, line_number, item_id, unit_id, quantity, unit_cost, serial_no, expiry_date, notes)
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
        'SELECT * FROM stock_transfer_lines WHERE stock_transfer_line_id = $1::bigint AND stock_transfer_id = $2::bigint',
        [lineId, id],
      );
      if (!line.rows.length) throw new BadRequestException('السطر غير موجود');
      const quantity = Number(dto.quantity ?? line.rows[0].quantity);
      if (quantity <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
      await client.query(
        `UPDATE stock_transfer_lines
            SET quantity = $2::numeric, unit_cost = COALESCE($3, unit_cost),
                notes = COALESCE($4, notes)
          WHERE stock_transfer_line_id = $1::bigint`,
        [lineId, quantity, dto.unitCost ?? null, dto.notes ?? null],
      );
      return { lineId, quantity };
    });
  }

  /** Removes a line from a draft transfer. */
  async removeLine(id: number, lineId: number) {
    await this.draftHeader(id);
    await this.db.query(
      'DELETE FROM stock_transfer_lines WHERE stock_transfer_line_id = $1::bigint AND stock_transfer_id = $2::bigint',
      [lineId, id],
    );
    return { lineId, deleted: true };
  }

  /**
   * Approves the transfer: creates and approves an OUTBOUND voucher (type 2)
   * from the source warehouse. Stock leaves the source at this point.
   */
  async approve(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM stock_transfers WHERE stock_transfer_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('تحويل المخزون غير موجود');
      const transfer = header.rows[0];
      if (Number(transfer.status) !== 1) {
        throw new BadRequestException('يمكن إنشاء أذن الصادر فقط من حالة مسودة');
      }

      const lines = await client.query<any>(
        'SELECT * FROM stock_transfer_lines WHERE stock_transfer_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد أصناف في التحويل');

      // Create outbound voucher (type 2 = outgoing) from source warehouse.
      const outSerial = await this.db.nextNumber(client, `stockvoucher:${Number(transfer.branch_id)}`);
      const outNo = `SV-${new Date().getFullYear()}-${String(outSerial).padStart(6, '0')}`;
      const outVoucher = await client.query<{ stock_voucher_id: number }>(
        `INSERT INTO stock_vouchers
           (voucher_no, voucher_date, branch_id, warehouse_id, voucher_type, status, notes, created_by)
         VALUES ($1, $2::date, $3::int, $4::int, 2, 2, $5, $6::int)
         RETURNING stock_voucher_id`,
        [outNo, transfer.transfer_date, transfer.branch_id, transfer.from_warehouse_id,
          `تحويل غير مباشر ${transfer.transfer_no}`, user.userId],
      );
      const outVoucherId = Number(outVoucher.rows[0].stock_voucher_id);

      let netValue = 0;
      const journalLines: any[] = [];

      for (const line of lines.rows) {
        const qtyBase = round6(Number(line.quantity));
        const unitCost = Number(line.unit_cost ?? 0);
        const value = round2(qtyBase * unitCost);
        netValue = round2(netValue + value);

        await client.query(
          `INSERT INTO stock_voucher_lines
             (stock_voucher_id, line_number, item_id, unit_id, quantity, unit_cost,
              serial_no, expiry_date, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
          [outVoucherId, line.line_number, line.item_id, line.unit_id, qtyBase,
            round2(unitCost), line.serial_no, line.expiry_date, line.notes],
        );

        await applyMovement(client, {
          branchId: Number(transfer.branch_id),
          warehouseId: Number(transfer.from_warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: 'sales',
          quantity: qtyBase,
          unitCost,
          referenceType: 3,
          referenceId: id,
          referenceNo: outNo,
          userId: user.userId,
          notes: `تحويل غير مباشر خارج ${transfer.transfer_no}`,
        });

        journalLines.push(
          { accountId: await this.resolveMappingId(client, 'COGS'), debit: value, description: 'صادر تحويل' },
          { accountId: await this.resolveMappingId(client, 'INVENTORY'), credit: value, description: 'تخفيض مخزون مصدر' },
        );
      }

      let journalId: number | null = null;
      if (journalLines.length) {
        journalId = await postJournal(client, {
          branchId: Number(transfer.branch_id),
          journalType: 8,
          description: `أذن صادر للتحويل ${transfer.transfer_no}`,
          sourceType: 'stock_transfer',
          sourceId: id,
          lines: journalLines,
          userId: user.userId,
          autoBalance: true,
        });
      }

      await client.query(
        `UPDATE stock_transfers
            SET status = 2, outbound_voucher_id = $2::bigint, gl_journal_id = $3::bigint,
                approved_by = $4::int, approved_at = now()
          WHERE stock_transfer_id = $1::bigint`,
        [id, outVoucherId, journalId, user.userId],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.transfer.approve','stock_transfer',$3::bigint,$4)`,
        [user.userId, Number(transfer.branch_id), id,
          `اعتماد تحويل غير مباشر ${transfer.transfer_no} (أذن صادر)`],
      );

      return { stockTransferId: id, status: 2, outboundVoucherId: outVoucherId, journalId };
    });
  }

  /**
   * Receives the transfer: creates and approves an INBOUND voucher (type 1)
   * at the destination warehouse. Stock arrives at the destination.
   */
  async receive(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM stock_transfers WHERE stock_transfer_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('تحويل المخزون غير موجود');
      const transfer = header.rows[0];
      if (Number(transfer.status) !== 2) {
        throw new BadRequestException('يمكن الاستلام فقط بعد إنشاء أذن الصادر');
      }
      if (Number(transfer.inbound_voucher_id ?? 0) > 0) {
        throw new BadRequestException('تم استلام هذا التحويل مسبقاً');
      }

      const lines = await client.query<any>(
        'SELECT * FROM stock_transfer_lines WHERE stock_transfer_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد أصناف في التحويل');

      // Create inbound voucher (type 1 = incoming) at destination warehouse.
      const inSerial = await this.db.nextNumber(client, `stockvoucher:${Number(transfer.branch_id)}`);
      const inNo = `SV-${new Date().getFullYear()}-${String(inSerial).padStart(6, '0')}`;
      const inVoucher = await client.query<{ stock_voucher_id: number }>(
        `INSERT INTO stock_vouchers
           (voucher_no, voucher_date, branch_id, warehouse_id, voucher_type, status, notes, created_by)
         VALUES ($1, $2::date, $3::int, $4::int, 1, 2, $5, $6::int)
         RETURNING stock_voucher_id`,
        [inNo, transfer.transfer_date, transfer.branch_id, transfer.to_warehouse_id,
          `تحويل غير مباشر ${transfer.transfer_no}`, user.userId],
      );
      const inVoucherId = Number(inVoucher.rows[0].stock_voucher_id);

      let netValue = 0;
      const journalLines: any[] = [];

      for (const line of lines.rows) {
        const qtyBase = round6(Number(line.quantity));
        const unitCost = Number(line.unit_cost ?? 0);
        const value = round2(qtyBase * unitCost);
        netValue = round2(netValue + value);

        await client.query(
          `INSERT INTO stock_voucher_lines
             (stock_voucher_id, line_number, item_id, unit_id, quantity, unit_cost,
              serial_no, expiry_date, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
          [inVoucherId, line.line_number, line.item_id, line.unit_id, qtyBase,
            round2(unitCost), line.serial_no, line.expiry_date, line.notes],
        );

        await applyMovement(client, {
          branchId: Number(transfer.branch_id),
          warehouseId: Number(transfer.to_warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: 'purchase',
          quantity: qtyBase,
          unitCost,
          referenceType: 3,
          referenceId: id,
          referenceNo: inNo,
          userId: user.userId,
          notes: `تحويل غير مباشر وارد ${transfer.transfer_no}`,
        });

        journalLines.push(
          { accountId: await this.resolveMappingId(client, 'INVENTORY'), debit: value, description: 'وارد تحويل' },
          { accountId: await this.resolveMappingId(client, 'INVENTORY_ADDITION'), credit: value, description: 'إضافات مخزون وجههة' },
        );
      }

      let journalId: number | null = null;
      if (journalLines.length) {
        journalId = await postJournal(client, {
          branchId: Number(transfer.branch_id),
          journalType: 8,
          description: `أذن وارد للتحويل ${transfer.transfer_no}`,
          sourceType: 'stock_transfer',
          sourceId: id,
          lines: journalLines,
          userId: user.userId,
          autoBalance: true,
        });
      }

      await client.query(
        `UPDATE stock_transfers
            SET status = 4, inbound_voucher_id = $2::bigint, gl_journal_id = $3::bigint,
                completed_at = now()
          WHERE stock_transfer_id = $1::bigint`,
        [id, inVoucherId, journalId],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.transfer.receive','stock_transfer',$3::bigint,$4)`,
        [user.userId, Number(transfer.branch_id), id,
          `استلام تحويل غير مباشر ${transfer.transfer_no} (أذن وارد)`],
      );

      return { stockTransferId: id, status: 4, inboundVoucherId: inVoucherId, journalId };
    });
  }

  /** Deletes a draft transfer. Transferred ones cannot be deleted. */
  async remove(id: number) {
    const header = await this.draftHeader(id);
    await this.db.query('DELETE FROM stock_transfers WHERE stock_transfer_id = $1::bigint', [id]);
    return { stockTransferId: id, deleted: true };
  }

  private async resolveMappingId(client: PoolClient, key: string): Promise<number> {
    const mapping = await resolveMapping(client, key);
    if (!mapping) {
      throw new BadRequestException(`الربط المحاسبي غير مضبوط: ${key}`);
    }
    return mapping.accountId;
  }

}

@Controller('stock-transfers')
export class StockTransferController {
  constructor(private readonly service: StockTransferService) {}

  @RequirePermissions('stock.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('fromWarehouseId') fromWarehouseId: string,
    @Query('toWarehouseId') toWarehouseId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.list({
      branchId,
      status: Number(status) || 0,
      fromWarehouseId: Number(fromWarehouseId) || 0,
      toWarehouseId: Number(toWarehouseId) || 0,
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
  @Post(':id/receive')
  receive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.receive(id, user);
  }

  @RequirePermissions('stock.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
