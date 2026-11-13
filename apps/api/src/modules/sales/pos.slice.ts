import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { PoolClient } from 'pg';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { SalesService } from './sales.slice';

/**
 * Point of sale extras: parked carts, restaurant tables, item modifiers,
 * open table orders and the kitchen display.
 */
@Injectable()
export class PosService {
  constructor(private readonly db: DatabaseService, private readonly sales: SalesService) {}

  // ------------------------------------------------------------------ //
  //  Parked carts (تعليق الفاتورة)
  // ------------------------------------------------------------------ //
  async listHeld(branchId: number) {
    return this.db.query<any>(
      `SELECT h.held_id AS "heldId", h.held_no AS "heldNo", h.customer_name AS "customerName",
              h.party_id AS "partyId", p.name AS "partyName", h.total_amount AS "totalAmount",
              h.notes, h.created_at AS "createdAt", u.full_name AS "createdBy",
              (h.payload->'lines') AS lines
         FROM held_invoices h
         LEFT JOIN parties p ON p.party_id = h.party_id
         LEFT JOIN users u ON u.user_id = h.created_by
        WHERE h.branch_id = $1::int
        ORDER BY h.created_at DESC`,
      [branchId],
    );
  }

  async hold(dto: any, user: AuthUser, branchId: number) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!lines.length) throw new BadRequestException('السلة فارغة');
    const total = lines.reduce(
      (sum: number, line: any) => sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
      0,
    );

    return this.db.transaction(async (client) => {
      const serial = await this.nextNumber(client, `held:${branchId}`);
      const heldNo = `HLD-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ held_id: number }>(
        `INSERT INTO held_invoices
           (held_no, branch_id, party_id, customer_name, warehouse_id, payload, total_amount, notes, created_by)
         VALUES ($1,$2::int,$3::int,$4,$5::int,$6::jsonb,$7::numeric,$8,$9::int)
         RETURNING held_id`,
        [heldNo, branchId, dto.partyId ? Number(dto.partyId) : null,
          dto.customerName ?? null, dto.warehouseId ? Number(dto.warehouseId) : null,
          JSON.stringify(dto), Math.round(total * 100) / 100, dto.notes ?? null, user.userId],
      );
      return { heldId: Number(inserted.rows[0].held_id), heldNo };
    });
  }

  async releaseHeld(id: number) {
    const row = await this.db.one<any>(
      'SELECT held_id, held_no FROM held_invoices WHERE held_id = $1::bigint',
      [id],
    );
    if (!row) throw new BadRequestException('الفاتورة المعلّقة غير موجودة');
    await this.db.query('DELETE FROM held_invoices WHERE held_id = $1::bigint', [id]);
    return { heldId: id, released: true };
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

  // ------------------------------------------------------------------ //
  //  Restaurant tables
  // ------------------------------------------------------------------ //
  async listTables(branchId: number) {
    return this.db.query<any>(
      `SELECT t.table_id AS "tableId", t.name, t.table_type AS "tableType", t.capacity,
              t.is_active AS "isActive", t.notes,
              (SELECT count(*)::int FROM table_orders o
                WHERE o.table_id = t.table_id AND o.status IN (1,2,3)) AS "openOrders"
         FROM restaurant_tables t
        WHERE ($1::int = 0 OR t.branch_id = $1::int)
        ORDER BY t.table_type, t.name`,
      [branchId],
    );
  }

  async saveTable(dto: any, branchId: number) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم الطاولة مطلوب');
    const row = await this.db.one<{ table_id: number }>(
      `INSERT INTO restaurant_tables (branch_id, name, table_type, capacity, is_active, notes)
       VALUES ($1::int,$2,$3::int,$4::int,$5,$6)
       ON CONFLICT (branch_id, name) DO UPDATE SET table_type = EXCLUDED.table_type,
         capacity = EXCLUDED.capacity, is_active = EXCLUDED.is_active, notes = EXCLUDED.notes
       RETURNING table_id`,
      [branchId, name, Number(dto.tableType ?? 1), Number(dto.capacity ?? 4),
        dto.isActive !== false, dto.notes ?? null],
    );
    return { tableId: Number(row.table_id) };
  }

  async deleteTable(id: number) {
    const open = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM table_orders WHERE table_id = $1::int AND status <> 4',
      [id],
    );
    if (Number(open.c) > 0) throw new BadRequestException('على الطاولة طلبات مفتوحة');
    await this.db.query('DELETE FROM restaurant_tables WHERE table_id = $1::int', [id]);
    return { tableId: id, deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Item modifiers (الطبقات والإضافات)
  // ------------------------------------------------------------------ //
  async listModifiers(itemId?: number) {
    return this.db.query<any>(
      `SELECT m.modifier_id AS "modifierId", m.item_id AS "itemId", i.code AS "itemCode",
              i.name AS "itemName", m.name, m.price, m.is_active AS "isActive"
         FROM item_modifiers m JOIN items i ON i.item_id = m.item_id
        WHERE ($1::int = 0 OR m.item_id = $1::int)
        ORDER BY i.code, m.name`,
      [itemId ?? 0],
    );
  }

  async saveModifier(dto: any) {
    if (!dto.itemId || !dto.name) throw new BadRequestException('الصنف واسم الإضافة مطلوبان');
    const row = await this.db.one<{ modifier_id: number }>(
      `INSERT INTO item_modifiers (item_id, name, price, is_active)
       VALUES ($1::int,$2,$3::numeric,$4)
       RETURNING modifier_id`,
      [Number(dto.itemId), String(dto.name).trim(), Number(dto.price ?? 0), dto.isActive !== false],
    );
    return { modifierId: Number(row.modifier_id) };
  }

  async deleteModifier(id: number) {
    await this.db.query('DELETE FROM item_modifiers WHERE modifier_id = $1::int', [id]);
    return { modifierId: id, deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Table orders and the kitchen display
  // ------------------------------------------------------------------ //
  async listTableOrders(params: { branchId: number; status?: number; limit: number }) {
    return this.db.query<any>(
      `SELECT o.table_order_id AS "tableOrderId", o.order_no AS "orderNo", o.table_id AS "tableId",
              t.name AS "tableName", o.guest_count AS "guestCount", o.status,
              o.subtotal AS "subTotal", o.tax_amount AS "taxAmount", o.total_amount AS "totalAmount",
              o.notes, o.created_at AS "createdAt", u.full_name AS "createdBy",
              o.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo"
         FROM table_orders o
         LEFT JOIN restaurant_tables t ON t.table_id = o.table_id
         LEFT JOIN users u ON u.user_id = o.created_by
         LEFT JOIN invoices i ON i.invoice_id = o.invoice_id
        WHERE ($1::int = 0 OR o.branch_id = $1::int)
          AND ($2::int = 0 OR o.status = $2::int)
        ORDER BY o.created_at DESC
        LIMIT $3::int`,
      [params.branchId, params.status ?? 0, params.limit],
    );
  }

  async tableOrder(id: number) {
    const header = await this.db.one<any>(
      `SELECT o.table_order_id AS "tableOrderId", o.order_no AS "orderNo", o.branch_id AS "branchId",
              o.table_id AS "tableId", t.name AS "tableName", o.party_id AS "partyId",
              o.guest_count AS "guestCount", o.status, o.subtotal AS "subTotal",
              o.tax_amount AS "taxAmount", o.total_amount AS "totalAmount", o.notes,
              o.invoice_id AS "invoiceId"
         FROM table_orders o LEFT JOIN restaurant_tables t ON t.table_id = o.table_id
        WHERE o.table_order_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('الطلب غير موجود');
    const lines = await this.db.query<any>(
      `SELECT l.table_order_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName", l.quantity, l.unit_price AS "unitPrice",
              l.discount_pct AS "discountPct", l.tax_pct AS "taxPct", l.line_total AS "lineTotal",
              l.notes, l.kitchen_status AS "kitchenStatus"
         FROM table_order_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.table_order_id = $1::bigint ORDER BY l.line_number`,
      [id],
    );
    return { header, lines };
  }

  async saveTableOrder(dto: any, user: AuthUser, branchId: number) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!lines.length) throw new BadRequestException('أضف صنفًا واحدًا على الأقل');

    return this.db.transaction(async (client) => {
      const subtotal = lines.reduce(
        (sum: number, line: any) => sum + Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
        0,
      );
      const taxAmount = lines.reduce(
        (sum: number, line: any) => sum
          + (Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0)) * (Number(line.taxPct ?? 0) / 100),
        0,
      );
      const total = Math.round((subtotal + taxAmount) * 100) / 100;

      let orderId = dto.tableOrderId ? Number(dto.tableOrderId) : null;
      if (orderId) {
        const existing = await client.query<any>(
          'SELECT status FROM table_orders WHERE table_order_id = $1::bigint FOR UPDATE',
          [orderId],
        );
        if (!existing.rows.length) throw new BadRequestException('الطلب غير موجود');
        if (Number(existing.rows[0].status) === 4) {
          throw new BadRequestException('لا يمكن تعديل طلب مغلق');
        }
        await client.query(
          `UPDATE table_orders SET table_id = $2::int, party_id = $3::int, guest_count = $4::int,
                  subtotal = $5::numeric, tax_amount = $6::numeric, total_amount = $7::numeric, notes = $8
            WHERE table_order_id = $1::bigint`,
          [orderId, dto.tableId ? Number(dto.tableId) : null,
            dto.partyId ? Number(dto.partyId) : null, Number(dto.guestCount ?? 1),
            subtotal, taxAmount, total, dto.notes ?? null],
        );
        await client.query('DELETE FROM table_order_lines WHERE table_order_id = $1::bigint', [orderId]);
      } else {
        const serial = await this.nextNumber(client, `tableorder:${branchId}`);
        const orderNo = `TO-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
        const inserted = await client.query<{ table_order_id: number }>(
          `INSERT INTO table_orders
             (order_no, branch_id, table_id, party_id, guest_count, status, subtotal, tax_amount,
              total_amount, notes, created_by)
           VALUES ($1,$2::int,$3::int,$4::int,$5::int,1,$6::numeric,$7::numeric,$8::numeric,$9,$10::int)
           RETURNING table_order_id`,
          [orderNo, branchId, dto.tableId ? Number(dto.tableId) : null,
            dto.partyId ? Number(dto.partyId) : null, Number(dto.guestCount ?? 1),
            subtotal, taxAmount, total, dto.notes ?? null, user.userId],
        );
        orderId = Number(inserted.rows[0].table_order_id);
      }

      let lineNumber = 1;
      for (const line of lines) {
        const quantity = Number(line.quantity ?? 0);
        if (!(quantity > 0)) continue;
        const unitPrice = Number(line.unitPrice ?? 0);
        const taxPct = Number(line.taxPct ?? 0);
        const discountPct = Number(line.discountPct ?? 0);
        const net = quantity * unitPrice * (1 - discountPct / 100);
        await client.query(
          `INSERT INTO table_order_lines
             (table_order_id, line_number, item_id, unit_id, quantity, unit_price, discount_pct,
              tax_pct, line_total, notes, kitchen_status)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,$8::numeric,
                   $9::numeric,$10::text,$11::int)`,
          [orderId, lineNumber++, Number(line.itemId), Number(line.unitId ?? 0), quantity, unitPrice,
            discountPct, taxPct, Math.round((net + net * (taxPct / 100)) * 100) / 100,
            line.notes ?? null, Number(line.kitchenStatus ?? 1)],
        );
      }

      return { tableOrderId: orderId, totalAmount: total };
    });
  }

  /** Moves a table order (or one of its lines) through the kitchen states. */
  async setKitchenStatus(id: number, dto: any) {
    const status = Number(dto.status);
    if (![1, 2, 3, 4].includes(status)) throw new BadRequestException('حالة المطبخ غير صحيحة');

    if (dto.lineId) {
      await this.db.query(
        'UPDATE table_order_lines SET kitchen_status = $2::int WHERE table_order_line_id = $1::bigint',
        [Number(dto.lineId), status],
      );
      return { lineId: Number(dto.lineId), kitchenStatus: status };
    }

    const order = await this.db.one<any>(
      'SELECT table_order_id, status FROM table_orders WHERE table_order_id = $1::bigint',
      [id],
    );
    if (!order) throw new BadRequestException('الطلب غير موجود');
    if (Number(order.status) === 4) throw new BadRequestException('الطلب مغلق');

    await this.db.query(
      'UPDATE table_orders SET status = $2::int WHERE table_order_id = $1::bigint',
      [id, status],
    );
    if (status === 2) {
      await this.db.query(
        'UPDATE table_order_lines SET kitchen_status = 2 WHERE table_order_id = $1::bigint AND kitchen_status = 1',
        [id],
      );
    }
    return { tableOrderId: id, status };
  }

  /** The kitchen screen: every line that is not served yet. */
  async kitchen(branchId: number) {
    return this.db.query<any>(
      `SELECT l.table_order_line_id AS "lineId", o.order_no AS "orderNo", o.created_at AS "createdAt",
              t.name AS "tableName", o.guest_count AS "guestCount",
              l.kitchen_status AS "kitchenStatus", i.code AS "itemCode", i.name AS "itemName",
              l.quantity, l.notes, u.name AS "unitName"
         FROM table_order_lines l
         JOIN table_orders o ON o.table_order_id = l.table_order_id
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
         LEFT JOIN restaurant_tables t ON t.table_id = o.table_id
        WHERE o.branch_id = $1::int AND o.status <> 4 AND l.kitchen_status <> 4
        ORDER BY o.created_at, l.line_number`,
      [branchId],
    );
  }

  /** Closes a table order by turning it into a sales invoice. */
  async closeTableOrder(id: number, dto: any, user: AuthUser, branchId: number) {
    const order = await this.tableOrder(id);
    if (Number(order.header.invoiceId)) {
      throw new BadRequestException('الطلب محوَّل لفاتورة بالفعل');
    }
    if (Number(order.header.status) === 4) throw new BadRequestException('الطلب مغلق بالفعل');

    const warehouseId = dto.warehouseId
      ? Number(dto.warehouseId)
      : Number((await this.db.one<any>(
        'SELECT warehouse_id FROM warehouses WHERE branch_id = $1::int AND is_active = true ORDER BY is_default DESC LIMIT 1',
        [branchId],
      ))?.warehouse_id ?? 0);
    if (!warehouseId) throw new BadRequestException('حدد المخزن');

    const invoice = await this.sales.create({
      invoiceType: 1,
      branchId,
      warehouseId,
      partyId: order.header.partyId ?? undefined,
      paymentType: Number(dto.paymentType ?? 1),
      paidAmount: Number(dto.paidAmount ?? 0),
      cashAccountId: dto.cashAccountId ?? undefined,
      orderType: 4,
      tableRef: order.header.tableName ?? undefined,
      notes: `طلب طاولة ${order.header.orderNo}`,
      lines: order.lines.map((line: any) => ({
        itemId: line.itemId,
        unitId: line.unitId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct),
        taxPct: Number(line.taxPct),
      })),
    } as any, user, branchId);

    await this.db.query(
      'UPDATE table_orders SET status = 4, invoice_id = $2::bigint WHERE table_order_id = $1::bigint',
      [id, invoice.invoiceId],
    );
    return { ...invoice, tableOrderId: id };
  }
}

@Controller('pos')
export class PosController {
  constructor(private readonly service: PosService) {}

  // ---- parked carts -------------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('held')
  listHeld(@CurrentBranch() branchId: number) {
    return this.service.listHeld(branchId);
  }

  @RequirePermissions('pos.operate')
  @Post('held')
  hold(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.hold(dto, user, branchId);
  }

  @RequirePermissions('pos.operate')
  @Delete('held/:id')
  releaseHeld(@Param('id', ParseIntPipe) id: number) {
    return this.service.releaseHeld(id);
  }

  // ---- tables -------------------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('tables')
  listTables(@CurrentBranch() branchId: number) {
    return this.service.listTables(branchId);
  }

  @RequirePermissions('items.manage')
  @Post('tables')
  saveTable(@Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.saveTable(dto, branchId);
  }

  @RequirePermissions('items.manage')
  @Delete('tables/:id')
  deleteTable(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteTable(id);
  }

  // ---- modifiers ----------------------------------------------------- //
  @RequirePermissions('items.view')
  @Get('modifiers')
  listModifiers(@Query('itemId') itemId: string) {
    return this.service.listModifiers(itemId ? Number(itemId) : undefined);
  }

  @RequirePermissions('items.manage')
  @Post('modifiers')
  saveModifier(@Body() dto: any) {
    return this.service.saveModifier(dto);
  }

  @RequirePermissions('items.manage')
  @Delete('modifiers/:id')
  deleteModifier(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteModifier(id);
  }

  // ---- table orders -------------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('table-orders')
  listTableOrders(
    @Query('status') status: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listTableOrders({
      branchId,
      status: Number(status) || 0,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('pos.operate')
  @Get('table-orders/:id')
  tableOrder(@Param('id', ParseIntPipe) id: number) {
    return this.service.tableOrder(id);
  }

  @RequirePermissions('pos.operate')
  @Post('table-orders')
  saveTableOrder(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveTableOrder(dto, user, branchId);
  }

  @RequirePermissions('pos.operate')
  @Post('table-orders/:id/kitchen')
  kitchenStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.setKitchenStatus(id, dto);
  }

  @RequirePermissions('pos.operate')
  @Post('table-orders/:id/close')
  closeTableOrder(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number) {
    return this.service.closeTableOrder(id, dto ?? {}, user, branchId);
  }

  // ---- kitchen display ------------------------------------------------ //
  @RequirePermissions('pos.operate')
  @Get('kitchen')
  kitchen(@CurrentBranch() branchId: number) {
    return this.service.kitchen(branchId);
  }
}

@Module({
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
