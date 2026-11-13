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

/** Money is rounded to two decimals. */
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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
              i.name AS "itemName", m.name, m.price, m.max_quantity AS "maxQuantity",
              m.sort_order AS "sortOrder", m.is_active AS "isActive"
         FROM item_modifiers m JOIN items i ON i.item_id = m.item_id
        WHERE ($1::int = 0 OR m.item_id = $1::int)
        ORDER BY i.code, m.sort_order, m.name`,
      [itemId ?? 0],
    );
  }

  async saveModifier(dto: any) {
    if (!dto.itemId || !dto.name) throw new BadRequestException('الصنف واسم الإضافة مطلوبان');
    const row = await this.db.one<{ modifier_id: number }>(
      `INSERT INTO item_modifiers (item_id, name, price, max_quantity, sort_order, is_active)
       VALUES ($1::int,$2,$3::numeric,$4::numeric,$5::int,$6)
       RETURNING modifier_id`,
      [Number(dto.itemId), String(dto.name).trim(), Number(dto.price ?? 0),
        Number(dto.maxQuantity ?? 0), Number(dto.sortOrder ?? 0), dto.isActive !== false],
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

  // ------------------------------------------------------------------ //
  //  Restaurant halls (القاعات)
  // ------------------------------------------------------------------ //
  async listHalls(branchId: number, userId?: number) {
    const rows = await this.db.query<any>(
      `SELECT h.hall_id AS "hallId", h.name, h.code, h.table_count AS "tableCount",
              h.branch_id AS "branchId", h.user_ids AS "userIds", h.is_active AS "isActive", h.notes,
              (SELECT count(*)::int FROM restaurant_tables t
                WHERE t.hall_id = h.hall_id AND t.is_active = true) AS "activeTables"
         FROM restaurant_halls h
        WHERE h.branch_id = $1::int AND h.is_active = true
        ORDER BY h.code`,
      [branchId],
    );
    return rows.map((row: any) => ({
      ...row,
      userIds: Array.isArray(row.userIds) ? row.userIds.map(Number) : [],
      // A hall with no users assigned is open to everybody.
      canWork: !userId || !row.userIds?.length || row.userIds.map(Number).includes(Number(userId)),
    }));
  }

  /**
   * Creates a hall and generates its tables from the code:
   * code "A" with 10 tables produces A1 .. A10.
   */
  async saveHall(dto: any, user: AuthUser, branchId: number) {
    const name = String(dto.name ?? '').trim();
    const code = String(dto.code ?? '').trim().toUpperCase();
    if (!name) throw new BadRequestException('اسم القاعة مطلوب');
    if (!code) throw new BadRequestException('كود القاعة مطلوب');
    const tableCount = Math.max(1, Number(dto.tableCount ?? 10));
    const userIds = (Array.isArray(dto.userIds) ? dto.userIds : []).map(Number).filter(Boolean);

    return this.db.transaction(async (client) => {
      const duplicate = await client.query<any>(
        `SELECT hall_id, name FROM restaurant_halls
          WHERE branch_id = $1::int AND (name = $2::text OR code = $3::text) LIMIT 1`,
        [branchId, name, code],
      );
      if (duplicate.rows.length) {
        throw new BadRequestException(
          duplicate.rows[0].name === name
            ? 'القاعة بنفس الاسم موجودة بالفعل في هذا الفرع'
            : 'كود القاعة مستخدم في قاعة أخرى',
        );
      }

      const inserted = await client.query<{ hall_id: number }>(
        `INSERT INTO restaurant_halls
           (branch_id, name, code, table_count, user_ids, is_active, notes)
         VALUES ($1::int,$2,$3,$4::int,$5::int[],$6,$7)
         RETURNING hall_id`,
        [branchId, name, code, tableCount, userIds, dto.isActive !== false, dto.notes ?? null],
      );
      const hallId = Number(inserted.rows[0].hall_id);

      for (let index = 1; index <= tableCount; index += 1) {
        await client.query(
          `INSERT INTO restaurant_tables (hall_id, branch_id, name, table_type, capacity, is_active)
           VALUES ($1::int,$2::int,$3,$4::int,$5::int,true)
           ON CONFLICT (branch_id, name) DO UPDATE SET hall_id = EXCLUDED.hall_id`,
          [hallId, branchId, `${code}${index}`, Number(dto.tableType ?? 1), Number(dto.capacity ?? 4)],
        );
      }

      return { hallId, name, code, tableCount };
    });
  }

  async deleteHall(id: number) {
    const hall = await this.db.one<any>(
      'SELECT hall_id, name, branch_id FROM restaurant_halls WHERE hall_id = $1::int',
      [id],
    );
    if (!hall) throw new BadRequestException('القاعة غير موجودة');
    const hallsCount = await this.db.one<{ c: number }>(
      'SELECT count(*)::int AS c FROM restaurant_halls WHERE branch_id = $1::int',
      [hall.branch_id],
    );
    if (Number(hallsCount.c) <= 1) {
      throw new BadRequestException('القاعة الأولى في النظام محمية ولا يمكن حذفها');
    }
    const open = await this.db.one<{ c: number }>(
      `SELECT count(*)::int AS c FROM table_orders o
         JOIN restaurant_tables t ON t.table_id = o.table_id
        WHERE t.hall_id = $1::int AND o.status <> 4`,
      [id],
    );
    if (Number(open.c) > 0) {
      throw new BadRequestException('على القاعة طلبات مفتوحة — أغلقها أولاً');
    }
    await this.db.query('DELETE FROM restaurant_halls WHERE hall_id = $1::int', [id]);
    return { hallId: id, deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Ready-made kitchen notes (ملاحظات جاهزة)
  // ------------------------------------------------------------------ //
  async listNoteTemplates(branchId: number) {
    return this.db.query<any>(
      `SELECT note_id AS "noteId", name, is_active AS "isActive"
         FROM note_templates
        WHERE ($1::int = 0 OR branch_id IS NULL OR branch_id = $1::int)
        ORDER BY name`,
      [branchId],
    );
  }

  async saveNoteTemplate(dto: any, branchId: number) {
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('نص الملاحظة مطلوب');
    const row = await this.db.one<{ note_id: number }>(
      `INSERT INTO note_templates (branch_id, name, is_active)
       VALUES ($1::int,$2,$3)
       RETURNING note_id`,
      [branchId, name, dto.isActive !== false],
    );
    return { noteId: Number(row.note_id) };
  }

  async deleteNoteTemplate(id: number) {
    await this.db.query('DELETE FROM note_templates WHERE note_id = $1::int', [id]);
    return { noteId: id, deleted: true };
  }

  // ------------------------------------------------------------------ //
  //  Restaurant settings
  // ------------------------------------------------------------------ //
  async getSettings(branchId: number) {
    const row = await this.db.one<any>(
      `SELECT s.settings_id AS "settingsId", s.branch_id AS "branchId",
              s.service_charge_per_guest AS "serviceChargePerGuest",
              s.service_charge_minimum AS "serviceChargeMinimum",
              s.service_charge_mode AS "serviceChargeMode",
              s.service_charge_account_id AS "serviceChargeAccountId",
              a.code AS "serviceChargeAccountCode", a.name AS "serviceChargeAccountName",
              s.kitchen_columns AS "kitchenColumns", s.notes
         FROM restaurant_settings s
         LEFT JOIN gl_accounts a ON a.account_id = s.service_charge_account_id
        WHERE s.branch_id = $1::int`,
      [branchId],
    );
    return row ?? {
      settingsId: null,
      branchId,
      serviceChargePerGuest: 0,
      serviceChargeMinimum: 0,
      serviceChargeAccountId: null,
      kitchenColumns: [],
    };
  }

  async saveSettings(dto: any, branchId: number) {
    const columns = Array.isArray(dto.kitchenColumns)
      ? dto.kitchenColumns.map((column) => Number(column)).filter((column) => Number.isFinite(column))
      : [];
    await this.db.query(
      `INSERT INTO restaurant_settings
         (branch_id, service_charge_per_guest, service_charge_minimum, service_charge_mode,
          service_charge_account_id, kitchen_columns, notes)
       VALUES ($1::int,$2::numeric,$3::numeric,$4::int,$5::int,$6::jsonb,$7)
       ON CONFLICT (branch_id) DO UPDATE SET
         service_charge_per_guest = EXCLUDED.service_charge_per_guest,
         service_charge_minimum = EXCLUDED.service_charge_minimum,
         service_charge_mode = EXCLUDED.service_charge_mode,
         service_charge_account_id = EXCLUDED.service_charge_account_id,
         kitchen_columns = EXCLUDED.kitchen_columns,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [branchId, Number(dto.serviceChargePerGuest ?? 0), Number(dto.serviceChargeMinimum ?? 0),
        Number(dto.serviceChargeMode ?? 1),
        dto.serviceChargeAccountId ? Number(dto.serviceChargeAccountId) : null,
        JSON.stringify(columns), dto.notes ?? null],
    );
    return this.getSettings(branchId);
  }

  /**
   * The service charge of a table order.
   *
   * Two methods, exactly as the manual describes:
   *  - amount per guest: charge = rate × guests
   *  - minimum per guest: the minimum is rate × guests; when the order total
   *    is below it, the difference is charged on top.
   */
  private async serviceChargeFor(branchId: number, guestCount: number, orderTotal: number) {
    const settings = await this.db.query<any>(
      `SELECT service_charge_per_guest, service_charge_minimum, service_charge_mode
         FROM restaurant_settings WHERE branch_id = $1::int`,
      [branchId],
    );
    if (!settings.length) return 0;
    const row = settings[0];
    const rate = Number(row.service_charge_per_guest ?? 0);
    if (rate <= 0) return 0;
    const guests = Math.max(1, guestCount);
    const minimum = Number(row.service_charge_minimum ?? 0);
    const mode = Number(row.service_charge_mode ?? 1);

    if (mode === 2) {
      // Minimum per guest: the customer always pays at least rate × guests.
      const floor = rate * guests;
      const shortfall = floor - orderTotal;
      return shortfall > 0 ? round2(shortfall) : 0;
    }
    return round2(rate * guests);
  }

  // ------------------------------------------------------------------ //
  //  Splitting and moving table orders
  // ------------------------------------------------------------------ //
  /**
   * Moves some lines of a table order to another table.
   * Only lines the kitchen has not started yet can be moved.
   */
  async splitTableOrder(id: number, dto: any, user: AuthUser, branchId: number) {
    const lineIds = (Array.isArray(dto.lineIds) ? dto.lineIds : []).map(Number).filter(Boolean);
    if (!lineIds.length) throw new BadRequestException('اختر السطور المراد فصلها');
    const targetTableId = Number(dto.tableId);
    if (!targetTableId) throw new BadRequestException('اختر الطاولة الجديدة');

    return this.db.transaction(async (client) => {
      const orderResult = await client.query<any>(
        'SELECT * FROM table_orders WHERE table_order_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!orderResult.rows.length) throw new BadRequestException('الطلب غير موجود');
      const order = orderResult.rows[0];
      if (Number(order.status) === 4) throw new BadRequestException('الطلب مغلق بالفعل');

      const lines = await client.query<any>(
        `SELECT * FROM table_order_lines
          WHERE table_order_id = $1::bigint AND table_order_line_id = ANY($2::bigint[])
          FOR UPDATE`,
        [id, lineIds],
      );
      if (lines.rows.length !== lineIds.length) {
        throw new BadRequestException('بعض السطور غير موجودة في هذا الطلب');
      }
      const allLines = await client.query<any>(
        'SELECT count(*)::int AS c FROM table_order_lines WHERE table_order_id = $1::bigint',
        [id],
      );
      if (Number(allLines.rows[0].c) > 0 && lineIds.length >= Number(allLines.rows[0].c)) {
        throw new BadRequestException('لا يمكن فصل كل أصناف الطلب — استخدم نقل المائدة بدلًا من ذلك');
      }
      const started = lines.rows.filter((line) => Number(line.kitchen_status) !== 1);
      if (started.length) {
        throw new BadRequestException('لا يمكن فصل سطور بدأت بالفعل في المطبخ');
      }

      const table = await client.query<any>(
        'SELECT table_id, name FROM restaurant_tables WHERE table_id = $1::int AND is_active = true',
        [targetTableId],
      );
      if (!table.rows.length) throw new BadRequestException('الطاولة غير موجودة');
      const busy = await client.query<any>(
        `SELECT count(*)::int AS c FROM table_orders
          WHERE table_id = $1::int AND status <> 4 AND table_order_id <> $2::bigint`,
        [targetTableId, id],
      );
      if (Number(busy.rows[0].c) > 0) {
        throw new BadRequestException('الطاولة عليها طلب مفتوح آخر');
      }

      // The target order: reuse the open one on that table or create it.
      const targetResult = await client.query<any>(
        `SELECT table_order_id FROM table_orders
          WHERE table_id = $1::int AND status <> 4 LIMIT 1`,
        [targetTableId],
      );
      let targetOrderId: number;
      if (targetResult.rows.length) {
        targetOrderId = Number(targetResult.rows[0].table_order_id);
      } else {
        const serial = await this.nextNumber(client, `tableorder:${branchId}`);
        const created = await client.query<{ table_order_id: number }>(
          `INSERT INTO table_orders
             (order_no, branch_id, table_id, party_id, guest_count, status, subtotal, tax_amount,
              total_amount, notes, created_by)
           VALUES ($1,$2::int,$3::int,$4::int,$5::int,1,0,0,0,$6,$7::int)
           RETURNING table_order_id`,
          [`TO-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`, branchId, targetTableId,
            order.party_id ?? null, Number(dto.guestCount ?? 1),
            `مفصول من الطلب ${order.order_no}`, user.userId],
        );
        targetOrderId = Number(created.rows[0].table_order_id);
      }

      const nextLineNo = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM table_order_lines WHERE table_order_id = $1::bigint',
        [targetOrderId],
      );
      let lineNo = Number(nextLineNo.rows[0].n);
      for (const line of lines.rows) {
        await client.query(
          `INSERT INTO table_order_lines
             (table_order_id, line_number, item_id, unit_id, quantity, unit_price, discount_pct,
              tax_pct, line_total, notes, kitchen_status)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,$8::numeric,
                   $9::numeric,$10::text,1)`,
          [targetOrderId, lineNo++, line.item_id, line.unit_id, line.quantity, line.unit_price,
            line.discount_pct, line.tax_pct, line.line_total, line.notes],
        );
        await client.query(
          'DELETE FROM table_order_lines WHERE table_order_line_id = $1::bigint',
          [line.table_order_line_id],
        );
      }

      // Re-total both orders from their own lines.
      for (const orderId of [id, targetOrderId]) {
        await this.retotalOrder(client, orderId);
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'order.split','table_order',$3::bigint,$4)`,
        [user.userId, branchId, id, `فصل ${lines.rows.length} سطر إلى الطاولة ${table.rows[0].name}`],
      );

      return { sourceOrderId: id, targetOrderId, movedLines: lines.rows.length };
    });
  }

  /** Moves a whole order to another (free) table. */
  async moveTableOrder(id: number, dto: any, user: AuthUser) {
    const targetTableId = Number(dto.tableId);
    if (!targetTableId) throw new BadRequestException('اختر الطاولة الجديدة');

    return this.db.transaction(async (client) => {
      const orderResult = await client.query<any>(
        'SELECT * FROM table_orders WHERE table_order_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!orderResult.rows.length) throw new BadRequestException('الطلب غير موجود');
      const order = orderResult.rows[0];
      if (Number(order.status) === 4) throw new BadRequestException('الطلب مغلق بالفعل');
      if (Number(order.table_id) === targetTableId) {
        throw new BadRequestException('الطلب على نفس الطاولة بالفعل');
      }

      const table = await client.query<any>(
        'SELECT table_id, name FROM restaurant_tables WHERE table_id = $1::int AND is_active = true',
        [targetTableId],
      );
      if (!table.rows.length) throw new BadRequestException('الطاولة غير موجودة');
      const busy = await client.query<any>(
        `SELECT count(*)::int AS c FROM table_orders
          WHERE table_id = $1::int AND status <> 4 AND table_order_id <> $2::bigint`,
        [targetTableId, id],
      );
      if (Number(busy.rows[0].c) > 0) {
        throw new BadRequestException('الطاولة عليها طلب مفتوح آخر');
      }

      await client.query(
        'UPDATE table_orders SET table_id = $2::int WHERE table_order_id = $1::bigint',
        [id, targetTableId],
      );
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'order.move','table_order',$3::bigint,$4)`,
        [user.userId, Number(order.branch_id), id, `نقل الطلب ${order.order_no} إلى الطاولة ${table.rows[0].name}`],
      );
      return { tableOrderId: id, tableId: targetTableId, tableName: table.rows[0].name };
    });
  }

  /** Recomputes the totals of a table order from its lines. */
  private async retotalOrder(client: PoolClient, orderId: number) {
    const totals = await client.query<any>(
      `SELECT COALESCE(SUM(line_total), 0) AS total FROM table_order_lines WHERE table_order_id = $1::bigint`,
      [orderId],
    );
    const total = round2(Number(totals.rows[0].total ?? 0));
    await client.query(
      'UPDATE table_orders SET total_amount = $2::numeric, subtotal = $2::numeric, tax_amount = 0 WHERE table_order_id = $1::bigint',
      [orderId, total],
    );
  }

  /** The kitchen screen: every line that is not served yet, one column per category. */
  async kitchen(branchId: number, categoryId?: number) {
    return this.db.query<any>(
      `SELECT l.table_order_line_id AS "lineId", o.order_no AS "orderNo", o.created_at AS "createdAt",
              t.name AS "tableName", o.guest_count AS "guestCount",
              l.kitchen_status AS "kitchenStatus", i.code AS "itemCode", i.name AS "itemName",
              i.category_id AS "categoryId", c.name AS "categoryName",
              l.quantity, l.notes, u.name AS "unitName"
         FROM table_order_lines l
         JOIN table_orders o ON o.table_order_id = l.table_order_id
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN categories c ON c.category_id = i.category_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
         LEFT JOIN restaurant_tables t ON t.table_id = o.table_id
        WHERE o.branch_id = $1::int AND o.status <> 4 AND l.kitchen_status <> 4
          AND ($2::int = 0 OR i.category_id = $2::int)
        ORDER BY o.created_at, l.line_number`,
      [branchId, categoryId ?? 0],
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

    // The service charge comes from the branch settings unless overridden.
    const orderTotal = order.lines.reduce(
      (sum: number, line: any) => sum + Number(line.lineTotal ?? 0),
      0,
    );
    const serviceCharge = dto.serviceCharge !== undefined
      ? Math.max(0, round2(Number(dto.serviceCharge)))
      : await this.serviceChargeFor(branchId, Number(order.header.guestCount ?? 1), orderTotal);

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
      serviceCharge,
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

  // ---- halls ---------------------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('halls')
  listHalls(@CurrentBranch() branchId: number, @CurrentUser() user: AuthUser) {
    return this.service.listHalls(branchId, user.userId);
  }

  @RequirePermissions('items.manage')
  @Post('halls')
  saveHall(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.saveHall(dto, user, branchId);
  }

  @RequirePermissions('items.manage')
  @Delete('halls/:id')
  deleteHall(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteHall(id);
  }

  // ---- ready-made notes ----------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('note-templates')
  listNoteTemplates(@CurrentBranch() branchId: number) {
    return this.service.listNoteTemplates(branchId);
  }

  @RequirePermissions('items.manage')
  @Post('note-templates')
  saveNoteTemplate(@Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.saveNoteTemplate(dto, branchId);
  }

  @RequirePermissions('items.manage')
  @Delete('note-templates/:id')
  deleteNoteTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteNoteTemplate(id);
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

  @RequirePermissions('pos.operate')
  @Post('table-orders/:id/split')
  splitTableOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.splitTableOrder(id, dto ?? {}, user, branchId);
  }

  @RequirePermissions('pos.operate')
  @Post('table-orders/:id/move')
  moveTableOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.moveTableOrder(id, dto ?? {}, user);
  }

  // ---- kitchen display ------------------------------------------------ //
  @RequirePermissions('pos.operate')
  @Get('kitchen')
  kitchen(@Query('categoryId') categoryId: string, @CurrentBranch() branchId: number) {
    return this.service.kitchen(branchId, categoryId ? Number(categoryId) : undefined);
  }

  // ---- restaurant settings -------------------------------------------- //
  @RequirePermissions('pos.operate')
  @Get('settings')
  getSettings(@CurrentBranch() branchId: number) {
    return this.service.getSettings(branchId);
  }

  @RequirePermissions('items.manage')
  @Put('settings')
  saveSettings(@Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.saveSettings(dto ?? {}, branchId);
  }
}

@Module({
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService],
})
export class PosModule {}
