import {
  Body, Controller, Get, Injectable, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { PoolClient } from 'pg';
import { toBaseUnits } from '../../common/stock';
import { resolvePrices, asRunner } from '../../common/pricing';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { SalesService } from './sales.slice';

/**
 * Quotations and orders.
 *
 * Both live in the sales slice because converting them into an invoice uses
 * the very same invoice engine (`SalesService.create`), and slices must not
 * import each other.
 */

export const QUOTATION_STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'مُرسل', 3: 'مقبول', 4: 'مرفوض', 5: 'مُحوَّل لفاتورة', 6: 'منتهي',
};
export const ORDER_STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'مؤكد', 3: 'تم جزئيًا', 4: 'تم التسليم', 5: 'ملغى',
};

@Injectable()
export class DocumentsService {
  constructor(private readonly db: DatabaseService, private readonly sales: SalesService) {}

  // ------------------------------------------------------------------ //
  //  Quotations
  // ------------------------------------------------------------------ //
  async listQuotations(params: {
    branchId: number; status?: number; partyId?: number; search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT q.quotation_id AS "quotationId", q.quotation_no AS "quotationNo",
              q.quotation_date AS "quotationDate", q.valid_until AS "validUntil",
              q.party_id AS "partyId", p.name AS "partyName", q.status,
              q.subtotal AS "subTotal", q.discount_amount AS "discountAmount",
              q.tax_amount AS "taxAmount", q.total_amount AS "totalAmount",
              q.notes, q.converted_invoice_id AS "convertedInvoiceId",
              i.invoice_no AS "convertedInvoiceNo", q.created_at AS "createdAt",
              u.full_name AS "createdBy",
              (SELECT count(*)::int FROM quotation_lines l WHERE l.quotation_id = q.quotation_id) AS "lineCount"
         FROM quotations q
         LEFT JOIN parties p ON p.party_id = q.party_id
         LEFT JOIN invoices i ON i.invoice_id = q.converted_invoice_id
         LEFT JOIN users u ON u.user_id = q.created_by
        WHERE ($1::int = 0 OR q.branch_id = $1::int)
          AND ($2::int = 0 OR q.status = $2::int)
          AND ($3::int = 0 OR q.party_id = $3::int)
          AND ($4::text = '' OR q.quotation_no ILIKE $5 OR COALESCE(p.name,'') ILIKE $5)
        ORDER BY q.quotation_date DESC, q.quotation_id DESC
        LIMIT $6::int`,
      [params.branchId, params.status ?? 0, params.partyId ?? 0, search, like, params.limit],
    );
  }

  async quotation(id: number) {
    const header = await this.db.one<any>(
      `SELECT q.quotation_id AS "quotationId", q.quotation_no AS "quotationNo",
              q.quotation_date AS "quotationDate", q.valid_until AS "validUntil",
              q.branch_id AS "branchId", q.party_id AS "partyId", p.name AS "partyName",
              q.price_list_id AS "priceListId", q.warehouse_id AS "warehouseId",
              q.status, q.subtotal AS "subTotal", q.discount_amount AS "discountAmount",
              q.tax_amount AS "taxAmount", q.total_amount AS "totalAmount", q.notes,
              q.converted_invoice_id AS "convertedInvoiceId", u.full_name AS "createdBy"
         FROM quotations q
         LEFT JOIN parties p ON p.party_id = q.party_id
         LEFT JOIN users u ON u.user_id = q.created_by
        WHERE q.quotation_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('عرض السعر غير موجود');
    const lines = await this.db.query<any>(
      `SELECT l.quotation_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName",
              l.quantity, l.unit_price AS "unitPrice", l.discount_pct AS "discountPct",
              l.tax_pct AS "taxPct", l.line_total AS "lineTotal", l.notes
         FROM quotation_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.quotation_id = $1::bigint ORDER BY l.line_number`,
      [id],
    );
    return { header, lines };
  }

  async saveQuotation(dto: any, user: AuthUser, branchId: number) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!lines.length) throw new BadRequestException('أضف صنفًا واحدًا على الأقل');

    return this.db.transaction(async (client) => {
      const partyId = dto.partyId ? Number(dto.partyId) : null;
      const itemIds = lines.map((line) => Number(line.itemId)).filter(Boolean);
      const listPrices = partyId
        ? await resolvePrices(asRunner(client), { itemIds, partyId, branchId })
        : new Map();

      let subtotal = 0;
      let discountAmount = 0;
      let taxAmount = 0;
      const computed = lines.map((line, index) => {
        const quantity = Number(line.quantity ?? 0);
        if (!(quantity > 0)) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
        const resolved = listPrices.get(Number(line.itemId));
        const unitPrice = line.unitPrice === undefined || line.unitPrice === null
          ? Number(resolved?.price ?? 0)
          : Number(line.unitPrice);
        const discountPct = Number(line.discountPct ?? 0);
        const taxPct = Number(line.taxPct ?? 0);
        const gross = quantity * unitPrice;
        const discount = gross * (discountPct / 100);
        const net = gross - discount;
        const tax = net * (taxPct / 100);
        subtotal += gross;
        discountAmount += discount;
        taxAmount += tax;
        return {
          lineNumber: index + 1,
          itemId: Number(line.itemId),
          unitId: Number(line.unitId ?? 0),
          quantity, unitPrice, discountPct, taxPct,
          lineTotal: net + tax,
          notes: line.notes ?? null,
        };
      });
      const headerDiscount = Number(dto.discountAmount ?? 0);
      const totalAmount = subtotal - discountAmount - headerDiscount + taxAmount;

      let quotationId = dto.quotationId ? Number(dto.quotationId) : null;
      if (quotationId) {
        const existing = await client.query<any>(
          'SELECT status FROM quotations WHERE quotation_id = $1::bigint FOR UPDATE',
          [quotationId],
        );
        if (!existing.rows.length) throw new BadRequestException('عرض السعر غير موجود');
        if ([3, 4, 5].includes(Number(existing.rows[0].status))) {
          throw new BadRequestException('لا يمكن تعديل عرض سعر مقبول أو مرفوض أو محوَّل');
        }
        await client.query(
          `UPDATE quotations SET quotation_date = COALESCE($2::date, CURRENT_DATE), valid_until = $3, party_id = $4,
                  price_list_id = $5, warehouse_id = $6, subtotal = $7, discount_amount = $8,
                  tax_amount = $9, total_amount = $10, notes = $11
            WHERE quotation_id = $1::bigint`,
          [quotationId, dto.quotationDate ?? null, dto.validUntil ?? null, partyId,
            dto.priceListId ? Number(dto.priceListId) : null,
            dto.warehouseId ? Number(dto.warehouseId) : null,
            subtotal, discountAmount + headerDiscount, taxAmount, totalAmount, dto.notes ?? null],
        );
        await client.query('DELETE FROM quotation_lines WHERE quotation_id = $1::bigint', [quotationId]);
      } else {
        const serial = await this.db.nextNumber(client, `quotation:${branchId}`);
        const inserted = await client.query<{ quotation_id: number }>(
          `INSERT INTO quotations
             (quotation_no, quotation_date, valid_until, branch_id, party_id, price_list_id,
              warehouse_id, status, subtotal, discount_amount, tax_amount, total_amount, notes, created_by)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, 1, $8, $9, $10, $11, $12, $13)
           RETURNING quotation_id`,
          [`Q-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`,
            dto.quotationDate ?? null, dto.validUntil ?? null, branchId, partyId,
            dto.priceListId ? Number(dto.priceListId) : null,
            dto.warehouseId ? Number(dto.warehouseId) : null,
            subtotal, discountAmount + headerDiscount, taxAmount, totalAmount,
            dto.notes ?? null, user.userId],
        );
        quotationId = Number(inserted.rows[0].quotation_id);
      }

      for (const line of computed) {
        await client.query(
          `INSERT INTO quotation_lines
             (quotation_id, line_number, item_id, unit_id, quantity, unit_price, discount_pct,
              tax_pct, line_total, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,
                   $8::numeric,$9::numeric,$10::text)`,
          [quotationId, line.lineNumber, line.itemId, line.unitId, line.quantity, line.unitPrice,
            line.discountPct, line.taxPct, line.lineTotal, line.notes],
        );
      }

      return { quotationId };
    });
  }

  async setQuotationStatus(id: number, dto: any) {
    const status = Number(dto.status);
    if (!QUOTATION_STATUS[status]) throw new BadRequestException('حالة عرض السعر غير صحيحة');
    const row = await this.db.one<any>(
      'SELECT status, converted_invoice_id FROM quotations WHERE quotation_id = $1::bigint',
      [id],
    );
    if (!row) throw new BadRequestException('عرض السعر غير موجود');
    if (Number(row.converted_invoice_id)) {
      throw new BadRequestException('عرض السعر محوَّل لفاتورة بالفعل');
    }
    await this.db.query('UPDATE quotations SET status = $2 WHERE quotation_id = $1::bigint', [id, status]);
    return { quotationId: id, status };
  }

  /** Turns a quotation into a sales invoice. */
  async convertQuotation(id: number, dto: any, user: AuthUser, branchId: number) {
    const quotation = await this.quotation(id);
    if (Number(quotation.header.convertedInvoiceId)) {
      throw new BadRequestException('عرض السعر محوَّل لفاتورة بالفعل');
    }
    if (![2, 3].includes(Number(quotation.header.status))) {
      throw new BadRequestException('يمكن تحويل عرض السعر المُرسل أو المقبول فقط');
    }
    const warehouses = await this.db.query<any>(
      'SELECT warehouse_id FROM warehouses WHERE branch_id = $1::int AND is_active = true ORDER BY is_default DESC LIMIT 1',
      [branchId],
    );
    const warehouseId = dto.warehouseId
      ? Number(dto.warehouseId)
      : Number(quotation.header.warehouseId ?? warehouses[0]?.warehouse_id ?? 0);
    if (!warehouseId) throw new BadRequestException('حدد المخزن');

    const invoice = await this.sales.create({
      invoiceType: 1,
      branchId,
      warehouseId,
      partyId: quotation.header.partyId ?? undefined,
      paymentType: Number(dto.paymentType ?? 2),
      paidAmount: Number(dto.paidAmount ?? 0),
      cashAccountId: dto.cashAccountId ?? undefined,
      notes: `تحويل عرض السعر ${quotation.header.quotationNo}`,
      lines: quotation.lines.map((line: any) => ({
        itemId: line.itemId,
        unitId: line.unitId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct),
        taxPct: Number(line.taxPct),
      })),
    } as any, user, branchId);

    await this.db.query(
      `UPDATE quotations SET status = 5, converted_invoice_id = $2::bigint WHERE quotation_id = $1::bigint`,
      [id, invoice.invoiceId],
    );
    return { ...invoice, quotationId: id };
  }

  // ------------------------------------------------------------------ //
  //  Orders
  // ------------------------------------------------------------------ //
  async listOrders(params: {
    branchId: number; status?: number; type?: number; partyId?: number; search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT o.order_id AS "orderId", o.order_no AS "orderNo", o.order_date AS "orderDate",
              o.expected_date AS "expectedDate", o.party_id AS "partyId", p.name AS "partyName",
              o.order_type AS "orderType", o.status, o.subtotal AS "subTotal",
              o.discount_amount AS "discountAmount", o.tax_amount AS "taxAmount",
              o.total_amount AS "totalAmount", o.notes, o.converted_invoice_id AS "convertedInvoiceId",
              i.invoice_no AS "convertedInvoiceNo", u.full_name AS "createdBy",
              (SELECT count(*)::int FROM order_lines l WHERE l.order_id = o.order_id) AS "lineCount"
         FROM orders o
         LEFT JOIN parties p ON p.party_id = o.party_id
         LEFT JOIN invoices i ON i.invoice_id = o.converted_invoice_id
         LEFT JOIN users u ON u.user_id = o.created_by
        WHERE ($1::int = 0 OR o.branch_id = $1::int)
          AND ($2::int = 0 OR o.status = $2::int)
          AND ($3::int = 0 OR o.order_type = $3::int)
          AND ($4::int = 0 OR o.party_id = $4::int)
          AND ($5::text = '' OR o.order_no ILIKE $6 OR COALESCE(p.name,'') ILIKE $6)
        ORDER BY o.order_date DESC, o.order_id DESC
        LIMIT $7::int`,
      [params.branchId, params.status ?? 0, params.type ?? 0, params.partyId ?? 0,
        search, like, params.limit],
    );
  }

  async order(id: number) {
    const header = await this.db.one<any>(
      `SELECT o.order_id AS "orderId", o.order_no AS "orderNo", o.order_date AS "orderDate",
              o.expected_date AS "expectedDate", o.branch_id AS "branchId",
              o.party_id AS "partyId", p.name AS "partyName", o.warehouse_id AS "warehouseId",
              o.order_type AS "orderType", o.status, o.subtotal AS "subTotal",
              o.discount_amount AS "discountAmount", o.tax_amount AS "taxAmount",
              o.total_amount AS "totalAmount", o.notes,
              o.converted_invoice_id AS "convertedInvoiceId", u.full_name AS "createdBy"
         FROM orders o
         LEFT JOIN parties p ON p.party_id = o.party_id
         LEFT JOIN users u ON u.user_id = o.created_by
        WHERE o.order_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('الأمر غير موجود');
    const lines = await this.db.query<any>(
      `SELECT l.order_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName", l.quantity, l.delivered_qty AS "deliveredQty",
              l.unit_price AS "unitPrice", l.discount_pct AS "discountPct",
              l.tax_pct AS "taxPct", l.line_total AS "lineTotal", l.notes,
              COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                          WHERE q.item_id = l.item_id AND q.unit_id = i.base_unit_id
                            AND q.warehouse_id = o.warehouse_id), 0) AS "onHandQty"
         FROM order_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
         JOIN orders o ON o.order_id = l.order_id
        WHERE l.order_id = $1::bigint ORDER BY l.line_number`,
      [id],
    );
    return { header, lines };
  }

  async saveOrder(dto: any, user: AuthUser, branchId: number) {
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!lines.length) throw new BadRequestException('أضف صنفًا واحدًا على الأقل');
    const orderType = Number(dto.orderType ?? 1);
    if (![1, 2].includes(orderType)) throw new BadRequestException('نوع الأمر غير صحيح');

    return this.db.transaction(async (client) => {
      const partyId = dto.partyId ? Number(dto.partyId) : null;
      const itemIds = lines.map((line) => Number(line.itemId)).filter(Boolean);
      const listPrices = partyId
        ? await resolvePrices(asRunner(client), { itemIds, partyId, branchId })
        : new Map();

      let subtotal = 0;
      let discountAmount = 0;
      let taxAmount = 0;
      const computed = lines.map((line, index) => {
        const quantity = Number(line.quantity ?? 0);
        if (!(quantity > 0)) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
        const resolved = listPrices.get(Number(line.itemId));
        const unitPrice = line.unitPrice === undefined || line.unitPrice === null
          ? Number(resolved?.price ?? 0)
          : Number(line.unitPrice);
        const discountPct = Number(line.discountPct ?? 0);
        const taxPct = Number(line.taxPct ?? 0);
        const gross = quantity * unitPrice;
        const discount = gross * (discountPct / 100);
        const net = gross - discount;
        const tax = net * (taxPct / 100);
        subtotal += gross;
        discountAmount += discount;
        taxAmount += tax;
        return {
          lineNumber: index + 1,
          itemId: Number(line.itemId),
          unitId: Number(line.unitId ?? 0),
          quantity, unitPrice, discountPct, taxPct,
          lineTotal: net + tax,
          notes: line.notes ?? null,
        };
      });
      const headerDiscount = Number(dto.discountAmount ?? 0);
      const totalAmount = subtotal - discountAmount - headerDiscount + taxAmount;

      let orderId = dto.orderId ? Number(dto.orderId) : null;
      if (orderId) {
        const existing = await client.query<any>(
          'SELECT status FROM orders WHERE order_id = $1::bigint FOR UPDATE',
          [orderId],
        );
        if (!existing.rows.length) throw new BadRequestException('الأمر غير موجود');
        if ([4, 5].includes(Number(existing.rows[0].status))) {
          throw new BadRequestException('لا يمكن تعديل أمر تم تسليمه أو ملغى');
        }
        await client.query(
          `UPDATE orders SET order_date = COALESCE($2::date, CURRENT_DATE), expected_date = $3, party_id = $4, warehouse_id = $5,
                  order_type = $6, subtotal = $7, discount_amount = $8, tax_amount = $9,
                  total_amount = $10, notes = $11
            WHERE order_id = $1::bigint`,
          [orderId, dto.orderDate ?? null, dto.expectedDate ?? null, partyId,
            dto.warehouseId ? Number(dto.warehouseId) : null, orderType,
            subtotal, discountAmount + headerDiscount, taxAmount, totalAmount, dto.notes ?? null],
        );
        await client.query('DELETE FROM order_lines WHERE order_id = $1::bigint', [orderId]);
      } else {
        const serial = await this.db.nextNumber(client, `order:${branchId}`);
        const prefix = orderType === 1 ? 'SO' : 'PO';
        const inserted = await client.query<{ order_id: number }>(
          `INSERT INTO orders
             (order_no, order_date, expected_date, branch_id, party_id, warehouse_id, order_type,
              status, subtotal, discount_amount, tax_amount, total_amount, notes, created_by)
           VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, 1, $8, $9, $10, $11, $12, $13)
           RETURNING order_id`,
          [`${prefix}-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`,
            dto.orderDate ?? null, dto.expectedDate ?? null, branchId, partyId,
            dto.warehouseId ? Number(dto.warehouseId) : null, orderType,
            subtotal, discountAmount + headerDiscount, taxAmount, totalAmount,
            dto.notes ?? null, user.userId],
        );
        orderId = Number(inserted.rows[0].order_id);
      }

      for (const line of computed) {
        await client.query(
          `INSERT INTO order_lines
             (order_id, line_number, item_id, unit_id, quantity, delivered_qty, unit_price,
              discount_pct, tax_pct, line_total, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,0,$6::numeric,$7::numeric,
                   $8::numeric,$9::numeric,$10::text)`,
          [orderId, line.lineNumber, line.itemId, line.unitId, line.quantity, line.unitPrice,
            line.discountPct, line.taxPct, line.lineTotal, line.notes],
        );
      }

      return { orderId };
    });
  }

  /**
   * Confirms an order and reserves the stock so the goods cannot be sold
   * twice. Cancelling an order releases the reservation.
   */
  async setOrderStatus(id: number, dto: any, user: AuthUser) {
    const status = Number(dto.status);
    if (!ORDER_STATUS[status]) throw new BadRequestException('حالة الأمر غير صحيحة');

    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        'SELECT * FROM orders WHERE order_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!row.rows.length) throw new BadRequestException('الأمر غير موجود');
      const order = row.rows[0];
      const previous = Number(order.status);

      if (previous === status) return { orderId: id, status };

      const lines = await client.query<any>(
        'SELECT * FROM order_lines WHERE order_id = $1::bigint ORDER BY line_number',
        [id],
      );

      // Reserving / releasing the stock only makes sense for sales orders.
      if (Number(order.order_type) === 1 && order.warehouse_id) {
        if (previous === 1 && status === 2) {
          for (const line of lines.rows) {
            const baseQty = await toBaseUnits(client, Number(line.item_id), Number(line.unit_id), Number(line.quantity));
            await client.query(
              `UPDATE item_warehouse_qty SET reserved_qty = reserved_qty + $4
                WHERE item_id = $1::int AND warehouse_id = $2::int AND unit_id = $3::int`,
              [Number(line.item_id), Number(order.warehouse_id), await this.baseUnitOf(client, Number(line.item_id)), baseQty],
            );
          }
        } else if (previous === 2 && status === 5) {
          for (const line of lines.rows) {
            const baseQty = await toBaseUnits(client, Number(line.item_id), Number(line.unit_id), Number(line.quantity));
            await client.query(
              `UPDATE item_warehouse_qty SET reserved_qty = GREATEST(reserved_qty - $4, 0)
                WHERE item_id = $1::int AND warehouse_id = $2::int AND unit_id = $3::int`,
              [Number(line.item_id), Number(order.warehouse_id), await this.baseUnitOf(client, Number(line.item_id)), baseQty],
            );
          }
        }
      }

      await client.query('UPDATE orders SET status = $2 WHERE order_id = $1::bigint', [id, status]);
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'order.status','order',$3,$4)`,
        [user.userId, Number(order.branch_id), String(id),
          `${ORDER_STATUS[previous]} ← ${ORDER_STATUS[status]}`],
      );
      return { orderId: id, status };
    });
  }

  private async baseUnitOf(client: PoolClient, itemId: number): Promise<number> {
    const row = await client.query<{ base_unit_id: number }>(
      'SELECT base_unit_id FROM items WHERE item_id = $1::int',
      [itemId],
    );
    return Number(row.rows[0]?.base_unit_id ?? 0);
  }

  /** Turns a sales or purchase order into an invoice. */
  async convertOrder(id: number, dto: any, user: AuthUser, branchId: number) {
    const order = await this.order(id);
    if (Number(order.header.convertedInvoiceId)) {
      throw new BadRequestException('الأمر محوَّل لفاتورة بالفعل');
    }
    if (![2, 3].includes(Number(order.header.status))) {
      throw new BadRequestException('يمكن تحويل الأمر المؤكد أو المُسلَّم جزئيًا فقط');
    }
    const isPurchase = Number(order.header.orderType) === 2;
    const warehouseId = dto.warehouseId ?? Number(order.header.warehouseId ?? 0);
    if (!warehouseId) throw new BadRequestException('حدد المخزن');

    // Only the not yet delivered quantities become an invoice.
    const lines = order.lines
      .map((line: any) => ({
        ...line,
        pending: Number(line.quantity) - Number(line.deliveredQty),
      }))
      .filter((line: any) => line.pending > 0.000001);

    if (!lines.length) throw new BadRequestException('تم تسليم كل أصناف الأمر');

    const invoice = await this.sales.create({
      invoiceType: isPurchase ? 2 : 1,
      branchId,
      warehouseId,
      partyId: order.header.partyId ?? undefined,
      paymentType: Number(dto.paymentType ?? 2),
      paidAmount: Number(dto.paidAmount ?? 0),
      cashAccountId: dto.cashAccountId ?? undefined,
      notes: `تحويل الأمر ${order.header.orderNo}`,
      lines: lines.map((line: any) => ({
        itemId: line.itemId,
        unitId: line.unitId,
        quantity: line.pending,
        unitPrice: Number(line.unitPrice),
        discountPct: Number(line.discountPct),
        taxPct: Number(line.taxPct),
      })),
    } as any, user, branchId);

    await this.db.transaction(async (client) => {
      for (const line of lines) {
        await client.query(
          `UPDATE order_lines SET delivered_qty = delivered_qty + $2
            WHERE order_line_id = $1::bigint`,
          [line.lineId, line.pending],
        );
      }
      const remaining = await client.query<any>(
        `SELECT COALESCE(SUM(quantity - delivered_qty), 0) AS pending
           FROM order_lines WHERE order_id = $1::bigint`,
        [id],
      );
      const pending = Number(remaining.rows[0].pending ?? 0);
      await client.query(
        'UPDATE orders SET status = $2, converted_invoice_id = $3::bigint WHERE order_id = $1::bigint',
        [id, pending > 0.000001 ? 3 : 4, invoice.invoiceId],
      );

      // Release the reservation that was taken when the order was confirmed.
      if (!isPurchase && order.header.warehouseId) {
        for (const line of lines) {
          const baseQty = await toBaseUnits(client, Number(line.itemId), Number(line.unitId), line.pending);
          await client.query(
            `UPDATE item_warehouse_qty SET reserved_qty = GREATEST(reserved_qty - $4, 0)
              WHERE item_id = $1::int AND warehouse_id = $2::int AND unit_id = $3::int`,
            [Number(line.itemId), Number(order.header.warehouseId),
              await this.baseUnitOf(client, Number(line.itemId)), baseQty],
          );
        }
      }
    });

    return { ...invoice, orderId: id };
  }
  // ------------------------------------------------------------------ //
  //  Shipments / delivery
  // ------------------------------------------------------------------ //
  async listShipments(params: {
    branchId: number; status?: number; invoiceId?: number; limit: number;
  }) {
    return this.db.query<any>(
      `SELECT s.shipment_id AS "shipmentId", s.shipment_no AS "shipmentNo",
              s.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo",
              s.order_id AS "orderId", o.order_no AS "orderNo",
              s.status, s.delivery_method AS "deliveryMethod",
              s.carrier_name AS "carrierName", s.tracking_no AS "trackingNo",
              s.ship_date AS "shipDate", s.delivered_at AS "deliveredAt",
              s.recipient_name AS "recipientName", s.recipient_phone AS "recipientPhone",
              s.delivery_address AS "deliveryAddress", s.delivery_fee AS "deliveryFee",
              s.notes, s.created_at AS "createdAt",
              p.name AS "partyName", u.full_name AS "createdBy"
         FROM shipments s
         LEFT JOIN invoices i ON i.invoice_id = s.invoice_id
         LEFT JOIN orders o ON o.order_id = s.order_id
         LEFT JOIN parties p ON p.party_id = COALESCE(i.party_id, o.party_id)
         LEFT JOIN users u ON u.user_id = s.created_by
        WHERE ($1::int = 0 OR s.branch_id = $1::int)
          AND ($2::int = 0 OR s.status = $2::int)
          AND ($3::int = 0 OR s.invoice_id = $3::int)
        ORDER BY s.created_at DESC, s.shipment_id DESC
        LIMIT $4::int`,
      [params.branchId, params.status ?? 0, params.invoiceId ?? 0, params.limit],
    );
  }

  async saveShipment(dto: any, user: AuthUser, branchId: number) {
    const invoiceId = dto.invoiceId ? Number(dto.invoiceId) : null;
    const orderId = dto.orderId ? Number(dto.orderId) : null;
    if (!invoiceId && !orderId) {
      throw new BadRequestException('اربط الشحنة بفاتورة أو بأمر');
    }
    const status = Number(dto.status ?? 1);
    if (![1, 2, 3, 4].includes(status)) throw new BadRequestException('حالة الشحنة غير صحيحة');

    return this.db.transaction(async (client) => {
      if (invoiceId) {
        const invoice = await client.query<any>(
          'SELECT invoice_id, party_id, branch_id FROM invoices WHERE invoice_id = $1::bigint',
          [invoiceId],
        );
        if (!invoice.rows.length) throw new BadRequestException('الفاتورة غير موجودة');
        if (Number(invoice.rows[0].branch_id) !== Number(branchId)) {
          throw new BadRequestException('الفاتورة لا تتبع الفرع الحالي');
        }
      }

      const serial = await this.db.nextNumber(client, `shipment:${branchId}`);
      const shipmentNo = `SH-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ shipment_id: number }>(
        `INSERT INTO shipments
           (shipment_no, invoice_id, order_id, branch_id, status, delivery_method, carrier_name,
            tracking_no, ship_date, recipient_name, recipient_phone, delivery_address,
            delivery_fee, notes, created_by)
         VALUES ($1,$2::bigint,$3::bigint,$4::int,$5::int,$6::int,$7,$8,
                 COALESCE($9::date, CURRENT_DATE),$10,$11,$12,$13::numeric,$14,$15::int)
         RETURNING shipment_id`,
        [shipmentNo, invoiceId, orderId, branchId, status, Number(dto.deliveryMethod ?? 1),
          dto.carrierName ?? null, dto.trackingNo ?? null, dto.shipDate ?? null,
          dto.recipientName ?? null, dto.recipientPhone ?? null, dto.deliveryAddress ?? null,
          Number(dto.deliveryFee ?? 0), dto.notes ?? null, user.userId],
      );
      return { shipmentId: Number(inserted.rows[0].shipment_id), shipmentNo };
    });
  }

  async updateShipment(id: number, dto: any) {
    const existing = await this.db.one<any>(
      'SELECT shipment_id, status FROM shipments WHERE shipment_id = $1::int',
      [id],
    );
    if (!existing) throw new BadRequestException('الشحنة غير موجودة');
    const status = dto.status === undefined ? Number(existing.status) : Number(dto.status);
    if (![1, 2, 3, 4].includes(status)) throw new BadRequestException('حالة الشحنة غير صحيحة');
    await this.db.query(
      `UPDATE shipments SET status = $2::int, carrier_name = COALESCE($3, carrier_name),
              tracking_no = COALESCE($4, tracking_no), ship_date = COALESCE($5::date, ship_date),
              delivered_at = CASE WHEN $2::int = 3 THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
              delivery_fee = COALESCE($6::numeric, delivery_fee), notes = COALESCE($7, notes)
        WHERE shipment_id = $1::int`,
      [id, status, dto.carrierName ?? null, dto.trackingNo ?? null, dto.shipDate ?? null,
        dto.deliveryFee ?? null, dto.notes ?? null],
    );
    return { shipmentId: id, status };
  }
}

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly service: DocumentsService) {}

  @RequirePermissions('sales.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('invoiceId') invoiceId: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listShipments({
      branchId,
      status: Number(status) || 0,
      invoiceId: Number(invoiceId) || 0,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('sales.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveShipment(dto, user, branchId);
  }

  @RequirePermissions('sales.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateShipment(id, dto);
  }
}

@Controller('quotations')
export class QuotationsController {
  constructor(private readonly service: DocumentsService) {}

  @RequirePermissions('sales.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('partyId') partyId: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listQuotations({
      branchId,
      status: Number(status) || 0,
      partyId: Number(partyId) || 0,
      search,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('sales.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.quotation(id);
  }

  @RequirePermissions('sales.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveQuotation(dto, user, branchId);
  }

  @RequirePermissions('sales.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number) {
    return this.service.saveQuotation({ ...dto, quotationId: id }, user, branchId);
  }

  @RequirePermissions('sales.manage')
  @Post(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.setQuotationStatus(id, dto);
  }

  @RequirePermissions('sales.manage')
  @Post(':id/convert')
  convert(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number) {
    return this.service.convertQuotation(id, dto ?? {}, user, branchId);
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: DocumentsService) {}

  @RequirePermissions('sales.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('type') type: string,
    @Query('partyId') partyId: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.listOrders({
      branchId,
      status: Number(status) || 0,
      type: Number(type) || 0,
      partyId: Number(partyId) || 0,
      search,
      limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('sales.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.order(id);
  }

  @RequirePermissions('sales.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveOrder(dto, user, branchId);
  }

  @RequirePermissions('sales.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number) {
    return this.service.saveOrder({ ...dto, orderId: id }, user, branchId);
  }

  @RequirePermissions('sales.manage')
  @Post(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.setOrderStatus(id, dto, user);
  }

  @RequirePermissions('sales.manage')
  @Post(':id/convert')
  convert(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number) {
    return this.service.convertOrder(id, dto ?? {}, user, branchId);
  }
}
