import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { applyMovement, getWarehouseCost } from '../../common/stock';
import {
  assertPeriodOpen, cashAccountGlId, postJournal, requireMapping, voidJournal,
} from '../../common/posting';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

/**
 * Maintenance Centers (إدارة مراكز الصيانة) — P8.
 *
 * Mirrors the Ezees guide: intake an order with an advance, inspect it and
 * consume spare parts (deducted from the branch's default warehouse), then
 * settle the balance on delivery. The advance and the delivery payment post
 * Dr Cash / Cr Other Income by the guide's accounting effect; deleting an
 * order reverses its journals. Parts consumed are NOT restocked on delete.
 */

const TICKET_LIST_SELECT = `
      t.ticket_id AS "ticketId", t.branch_id AS "branchId", t.ticket_no AS "ticketNo",
      t.customer_name AS "customerName", t.phone, t.phone2, t.product_id AS "productId",
      p.name AS "productName", t.model_id AS "modelId", m.name AS "modelName",
      t.serial_no AS "serialNo", t.item_color AS "itemColor",
      t.accessories, t.product_condition AS "productCondition", t.customer_notes AS "customerNotes",
      t.max_charge AS "maxCharge", t.received_at AS "receivedAt", t.expected_delivery AS "expectedDelivery",
      t.estimated_cost AS "estimatedCost", t.actual_cost AS "actualCost", t.total_paid AS "totalPaid",
      t.advance_amount AS "advanceAmount", t.last_payment_amount AS "lastPaymentAmount",
      t.inspection_status AS "inspectionStatus", t.delivery_status AS "deliveryStatus",
      t.check_report AS "checkReport", t.engineer_id AS "engineerId", u.full_name AS "engineerName",
      COALESCE((SELECT SUM(pt.quantity * pt.unit_cost) FROM maintenance_ticket_parts pt
                 WHERE pt.ticket_id = t.ticket_id), 0) AS "partsCost",
      COALESCE((SELECT SUM(pt.quantity * pt.unit_price) FROM maintenance_ticket_parts pt
                 WHERE pt.ticket_id = t.ticket_id), 0) AS "partsValue"
     FROM maintenance_tickets t
     JOIN maintenance_products p ON p.product_id = t.product_id
     JOIN maintenance_models m ON m.model_id = t.model_id
     LEFT JOIN users u ON u.user_id = t.engineer_id`;

@Injectable()
export class MaintenanceService {
  constructor(private readonly db: DatabaseService) {}

  // --------------------------------------------------------------- products
  products(includeInactive = false) {
    return this.db.query(
      `SELECT product_id AS "productId", name, is_active AS "isActive",
              (SELECT COUNT(*)::int FROM maintenance_models m WHERE m.product_id = p.product_id) AS "modelCount"
         FROM maintenance_products p
        WHERE ($1::boolean OR is_active = true)
        ORDER BY name`,
      [includeInactive],
    );
  }

  async createProduct(dto: { name?: string }, user: AuthUser) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم المنتج مطلوب');
    try {
      const row = await this.db.one(
        `INSERT INTO maintenance_products (name) VALUES ($1) RETURNING product_id AS "productId"`,
        [name],
      );
      return row;
    } catch (error: any) {
      throw new BadRequestException('هذا المنتج مسجل من قبل');
    }
  }

  async updateProduct(id: number, dto: { name?: string; isActive?: boolean }) {
    const row = await this.db.one(
      `UPDATE maintenance_products SET name = COALESCE(NULLIF($2, ''), name), is_active = COALESCE($3, is_active)
        WHERE product_id = $1 RETURNING product_id AS "productId"`,
      [id, dto?.name ?? '', dto?.isActive ?? null],
    );
    if (!row) throw new NotFoundException('المنتج غير موجود');
    return row;
  }

  async deleteProduct(id: number) {
    const used = await this.db.one<{ count: string }>(
      'SELECT COUNT(*) AS count FROM maintenance_tickets WHERE product_id = $1', [id],
    );
    if (Number(used?.count ?? 0) > 0) throw new BadRequestException('لا يمكن حذف المنتج لأنه مستخدم في أذون صيانة');
    await this.db.query('DELETE FROM maintenance_products WHERE product_id = $1', [id]);
    return { deleted: true };
  }

  // ---------------------------------------------------------------- models
  models(productId?: number) {
    return this.db.query(
      `SELECT model_id AS "modelId", product_id AS "productId", name, is_active AS "isActive"
         FROM maintenance_models
        WHERE ($1::int IS NULL OR product_id = $1)
        ORDER BY name`,
      [productId ?? null],
    );
  }

  async createModel(dto: { productId?: number; name?: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!dto?.productId) throw new BadRequestException('اختر المنتج');
    if (!name) throw new BadRequestException('اسم الموديل مطلوب');
    try {
      return await this.db.one(
        `INSERT INTO maintenance_models (product_id, name) VALUES ($1, $2) RETURNING model_id AS "modelId"`,
        [dto.productId, name],
      );
    } catch {
      throw new BadRequestException('هذا الموديل مسجل من قبل لهذا المنتج');
    }
  }

  async updateModel(id: number, dto: { name?: string; isActive?: boolean }) {
    const row = await this.db.one(
      `UPDATE maintenance_models SET name = COALESCE(NULLIF($2, ''), name), is_active = COALESCE($3, is_active)
        WHERE model_id = $1 RETURNING model_id AS "modelId"`,
      [id, dto?.name ?? '', dto?.isActive ?? null],
    );
    if (!row) throw new NotFoundException('الموديل غير موجود');
    return row;
  }

  async deleteModel(id: number) {
    const used = await this.db.one<{ count: string }>(
      'SELECT COUNT(*) AS count FROM maintenance_tickets WHERE model_id = $1', [id],
    );
    if (Number(used?.count ?? 0) > 0) throw new BadRequestException('لا يمكن حذف الموديل لأنه مستخدم في أذون صيانة');
    await this.db.query('DELETE FROM maintenance_models WHERE model_id = $1', [id]);
    return { deleted: true };
  }

  // --------------------------------------------------- fault categories
  faultCategories() {
    return this.db.query(
      `SELECT fault_category_id AS "categoryId", name, sort_order AS "sortOrder", is_active AS "isActive",
              (SELECT COUNT(*)::int FROM fault_subcategories sc WHERE sc.fault_category_id = c.fault_category_id) AS "subcategoryCount"
         FROM fault_categories c ORDER BY sort_order, name`,
    );
  }

  async createFaultCategory(dto: { name?: string; sortOrder?: number }) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم التصنيف مطلوب');
    try {
      return await this.db.one(
        `INSERT INTO fault_categories (name, sort_order) VALUES ($1, $2) RETURNING fault_category_id AS "categoryId"`,
        [name, Number(dto?.sortOrder ?? 0)],
      );
    } catch {
      throw new BadRequestException('هذا التصنيف مسجل من قبل');
    }
  }

  async updateFaultCategory(id: number, dto: { name?: string; sortOrder?: number; isActive?: boolean }) {
    const row = await this.db.one(
      `UPDATE fault_categories
          SET name = COALESCE(NULLIF($2, ''), name), sort_order = COALESCE($3, sort_order), is_active = COALESCE($4, is_active)
        WHERE fault_category_id = $1 RETURNING fault_category_id AS "categoryId"`,
      [id, dto?.name ?? '', dto?.sortOrder ?? null, dto?.isActive ?? null],
    );
    if (!row) throw new NotFoundException('التصنيف غير موجود');
    return row;
  }

  async deleteFaultCategory(id: number) {
    await this.db.query('DELETE FROM fault_categories WHERE fault_category_id = $1', [id]);
    return { deleted: true };
  }

  faultSubcategories(categoryId?: number) {
    return this.db.query(
      `SELECT sc.fault_subcategory_id AS "subcategoryId", sc.fault_category_id AS "categoryId",
              sc.name, sc.is_active AS "isActive"
         FROM fault_subcategories sc
        WHERE ($1::int IS NULL OR sc.fault_category_id = $1)
        ORDER BY sc.name`,
      [categoryId ?? null],
    );
  }

  async createFaultSubcategory(dto: { faultCategoryId?: number; name?: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!dto?.faultCategoryId) throw new BadRequestException('اختر التصنيف الرئيسي');
    if (!name) throw new BadRequestException('اسم العطل مطلوب');
    try {
      return await this.db.one(
        `INSERT INTO fault_subcategories (fault_category_id, name) VALUES ($1, $2)
         RETURNING fault_subcategory_id AS "subcategoryId"`,
        [dto.faultCategoryId, name],
      );
    } catch {
      throw new BadRequestException('هذا العطل مسجل من قبل في نفس التصنيف');
    }
  }

  async updateFaultSubcategory(id: number, dto: { name?: string; isActive?: boolean }) {
    const row = await this.db.one(
      `UPDATE fault_subcategories
          SET name = COALESCE(NULLIF($2, ''), name), is_active = COALESCE($3, is_active)
        WHERE fault_subcategory_id = $1 RETURNING fault_subcategory_id AS "subcategoryId"`,
      [id, dto?.name ?? '', dto?.isActive ?? null],
    );
    if (!row) throw new NotFoundException('هذا العطل غير موجود');
    return row;
  }

  async deleteFaultSubcategory(id: number) {
    await this.db.query('DELETE FROM fault_subcategories WHERE fault_subcategory_id = $1', [id]);
    return { deleted: true };
  }

  // ------------------------------------------------------------- engineers
  engineers() {
    return this.db.query(
      `SELECT user_id AS "userId", full_name AS "fullName", user_name AS "userName"
         FROM users WHERE is_active = true AND is_sales_rep = true ORDER BY full_name`,
    );
  }

  private async defaultWarehouseId(client: any, branchId: number): Promise<number | null> {
    const row = await client.query(
      `SELECT warehouse_id FROM warehouses
        WHERE branch_id = $1::int AND is_active = true
        ORDER BY is_default DESC, warehouse_id LIMIT 1`,
      [branchId],
    );
    return row.rows.length ? Number(row.rows[0].warehouse_id) : null;
  }

  private async postMaintenanceCash(
    client: any,
    input: { branchId: number; amount: number; cashAccountId: number; description: string; sourceId: number; userId: number },
  ) {
    if (!input.amount || input.amount <= 0 || !input.cashAccountId) return null;
    const cash = await cashAccountGlId(client, input.cashAccountId);
    if (!cash) throw new BadRequestException('حساب الخزينة غير موجود في شجرة الحسابات');
    const other = await requireMapping(client, 'OTHER_INCOME', 'الإيرادات الأخرى');
    const today = new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(client, input.branchId, today);
    return postJournal(client, {
      branchId: input.branchId,
      journalDate: today,
      journalType: 4,
      description: input.description,
      sourceType: 'maintenance_ticket',
      sourceId: input.sourceId,
      userId: input.userId,
      lines: [
        { accountId: cash, debit: input.amount, credit: 0, description: input.description },
        { accountId: other.accountId, debit: 0, credit: input.amount, description: input.description },
      ],
    });
  }

  private ticketNo(branchCode: string | null, sequence: number) {
    const prefix = String(branchCode ?? 'M').replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase() || 'M';
    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  private assertTicketBranch(ticket: any, branchId: number) {
    if (Number(ticket?.branch_id) !== branchId) {
      throw new BadRequestException('هذا الإذن يتبع فرعًا آخر — غيّر الفرع من الأعلى أولًا');
    }
  }

  private async nextTicketNo(client: any, branchId: number, branchCode: string | null) {
    const { rows } = await client.query(
      `INSERT INTO number_sequences (sequence_key, last_number) VALUES ($1, 1)
       ON CONFLICT (sequence_key) DO UPDATE SET last_number = number_sequences.last_number + 1
       RETURNING last_number`,
      [`maintenance_ticket:${branchId}`],
    );
    return this.ticketNo(branchCode, Number(rows[0].last_number));
  }

  // --------------------------------------------------------------- tickets
  async listTickets(params: {
    branchId: number; all?: boolean; from?: string; to?: string; search?: string;
    productId?: number; modelId?: number; inspectionStatus?: number; deliveryStatus?: number;
    paymentStatus?: number; page?: number; pageSize?: number;
  }) {
    const w: string[] = [];
    const values: any[] = [];
    const put = (value: any, cast = 'text') => {
      values.push(value);
      return `$${values.length}::${cast}`;
    };

    if (!params.all) w.push(`t.branch_id = ${put(params.branchId, 'int')}`);
    if (params.from) w.push(`t.received_at::date >= ${put(params.from, 'date')}`);
    if (params.to) w.push(`t.received_at::date <= ${put(params.to, 'date')}`);
    if (params.productId) w.push(`t.product_id = ${put(params.productId, 'int')}`);
    if (params.modelId) w.push(`t.model_id = ${put(params.modelId, 'int')}`);
    if (params.inspectionStatus !== undefined && Number.isFinite(params.inspectionStatus)) {
      w.push(`t.inspection_status = ${put(params.inspectionStatus, 'smallint')}`);
    }
    if (params.deliveryStatus !== undefined && Number.isFinite(params.deliveryStatus)) {
      w.push(`t.delivery_status = ${put(params.deliveryStatus, 'smallint')}`);
    }
    if (params.paymentStatus === 1) w.push(`COALESCE(t.actual_cost, t.estimated_cost) - t.total_paid <= 0.004`);
    if (params.paymentStatus === 0) w.push(`COALESCE(t.actual_cost, t.estimated_cost) - t.total_paid > 0.004`);
    const search = String(params.search ?? '').trim();
    if (search.length >= 2) {
      const idx = values.length + 1;
      values.push(`%${search}%`);
      values.push(`${search}%`);
      w.push(`(t.ticket_no ILIKE $${idx} OR t.customer_name ILIKE $${idx} OR t.phone LIKE $${idx + 1} OR t.phone2 LIKE $${idx + 1})`);
    }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const whereValues = [...values];

    const page = Math.max(1, Number(params.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 50)));

    const items = await this.db.query(
      `SELECT ${TICKET_LIST_SELECT} ${where}
        ORDER BY t.received_at DESC
        LIMIT ${put(pageSize, 'int')} OFFSET ${put((page - 1) * pageSize, 'int')}`,
      values,
    );

    const row = await this.db.one<any>(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(COALESCE(t.actual_cost, t.estimated_cost)), 0) AS "totalValue",
              COALESCE(SUM(t.total_paid), 0) AS "totalPaid",
              COALESCE(SUM(COALESCE(t.actual_cost, t.estimated_cost) - t.total_paid), 0) AS "totalRemaining",
              COALESCE(SUM((SELECT COALESCE(SUM(p2.quantity * p2.unit_cost), 0) FROM maintenance_ticket_parts p2
                             WHERE p2.ticket_id = t.ticket_id)), 0) AS "partsCost"
         FROM maintenance_tickets t ${where}`,
      whereValues,
    );

    return {
      items,
      page,
      pageSize,
      total: Number(row?.total ?? 0),
      totals: {
        totalValue: Number(row?.totalValue ?? 0),
        totalPaid: Number(row?.totalPaid ?? 0),
        totalRemaining: Number(row?.totalRemaining ?? 0),
        partsCost: Number(row?.partsCost ?? 0),
      },
    };
  }

  async findTicket(id: number, branchId: number) {
    const ticket = await this.db.one(
      `SELECT ${TICKET_LIST_SELECT} WHERE t.ticket_id = $1::int`,
      [id],
    );
    if (!ticket) return null;
    const parts = await this.db.query(
      `SELECT pt.ticket_part_id AS "ticketPartId", pt.item_id AS "itemId", i.name AS "itemName",
              i.code AS "itemCode", pt.quantity, pt.unit_price AS "unitPrice", pt.unit_cost AS "unitCost"
         FROM maintenance_ticket_parts pt JOIN items i ON i.item_id = pt.item_id
        WHERE pt.ticket_id = $1::int
        ORDER BY i.name`,
      [id],
    );
    return { ...ticket, parts };
  }

  private async validateTicketInput(dto: any) {
    const customerName = String(dto?.customerName ?? '').trim();
    const phone = String(dto?.phone ?? '').replace(/\D/g, '');
    const phone2 = String(dto?.phone2 ?? '').replace(/\D/g, '');
    if (!customerName) throw new BadRequestException('اسم العميل مطلوب');
    if (phone.length < 10) throw new BadRequestException('رقم الهاتف غير صحيح');
    const productId = Number(dto?.productId ?? 0);
    const modelId = Number(dto?.modelId ?? 0);
    if (!productId) throw new BadRequestException('اختر المنتج');
    if (!modelId) throw new BadRequestException('اختر الموديل');
    const model = await this.db.one(
      'SELECT 1 AS ok FROM maintenance_models WHERE model_id = $1::int AND product_id = $2::int',
      [modelId, productId],
    );
    if (!model) throw new BadRequestException('الموديل لا يتبع هذا المنتج');
    if (!String(dto?.productCondition ?? '').trim()) {
      throw new BadRequestException('وصف حالة الجهاز مطلوب');
    }
    return { customerName, phone, phone2: phone2 || null, productId, modelId };
  }

  async createTicket(dto: any, user: AuthUser, branchId: number) {
    const input = await this.validateTicketInput(dto);
    const paid = Number(dto?.paidAmount ?? 0);
    const cashAccountId = dto?.cashAccountId ? Number(dto.cashAccountId) : null;
    if (paid > 0 && !cashAccountId) throw new BadRequestException('اختر الخزينة لتسجيل المقدم');

    return this.db.transaction(async (client) => {
      const branch = await client.query(
        'SELECT code FROM branches WHERE branch_id = $1::int',
        [branchId],
      );
      const branchCode = branch.rows[0]?.code ?? 'M';
      const ticketNo = await this.nextTicketNo(client, branchId, branchCode);

      const result = await client.query(
        `INSERT INTO maintenance_tickets
           (branch_id, branch_cash_account_id, ticket_no, customer_name, phone, phone2, product_id, model_id,
            serial_no, item_color, accessories, product_condition, customer_notes, max_charge,
            expected_delivery, estimated_cost, total_paid, advance_amount, created_by)
         VALUES ($1::int, $2::int, $3::text, $4::text, $5::text, $6::text, $7::int, $8::int,
                 $9::text, $10::text, $11::jsonb, $12::text, $13::text, $14::numeric,
                 $15::date, $16::numeric, $17::numeric, $17::numeric, $18::int)
         RETURNING ticket_id`,
        [
          branchId, cashAccountId, ticketNo, input.customerName, input.phone, input.phone2,
          input.productId, input.modelId, String(dto?.serialNo ?? '').trim() || null,
          String(dto?.itemColor ?? '').trim() || null,
          JSON.stringify(dto?.accessories ?? {}),
          String(dto?.productCondition ?? '').trim(),
          String(dto?.customerNotes ?? '').trim() || null,
          Number(dto?.maxCharge ?? 0),
          dto?.expectedDelivery ? String(dto.expectedDelivery) : null,
          Number(dto?.estimatedCost ?? 0),
          paid,
          user.userId,
        ],
      );
      const ticketId = Number(result.rows[0].ticket_id);

      if (paid > 0) {
        const journalId = await this.postMaintenanceCash(client, {
          branchId, amount: paid, cashAccountId: cashAccountId!,
          description: `مقدم صيانة — ${ticketNo}`, sourceId: ticketId, userId: user.userId,
        });
        if (journalId) {
          await client.query(
            `UPDATE maintenance_tickets SET advance_journal_id = $2::bigint, advance_posted = true WHERE ticket_id = $1::bigint`,
            [ticketId, journalId],
          );
        }
      }
      return { ticketId, ticketNo };
    });
  }

  async updateTicket(id: number, dto: any, user: AuthUser, branchId: number) {
    const input = await this.validateTicketInput(dto);
    const paid = Number(dto?.paidAmount ?? 0);
    const cashAccountId = dto?.cashAccountId ? Number(dto.cashAccountId) : null;

    return this.db.transaction(async (client) => {
      const current = await client.query(
        `SELECT * FROM maintenance_tickets WHERE ticket_id = $1::bigint`,
        [id],
      );
      if (!current.rows.length) throw new NotFoundException('الإذن غير موجود');
      const ticket = current.rows[0];
      this.assertTicketBranch(ticket, branchId);
      if (Number(ticket.delivery_status) === 1 && !user.permissions.includes('users.manage')) {
        throw new BadRequestException('عفوا، لا يجوز تعديل إذن تم تسليمه مسبقًا');
      }
      const oldAdvance = Number(ticket.advance_amount ?? 0);
      const diff = paid - oldAdvance;

      // Replace the advance journal when the advance changes.
      if (ticket.advance_journal_id) {
        await voidJournal(client, Number(ticket.advance_journal_id));
      }
      let advanceJournalId: number | null = null;
      if (paid > 0) {
        if (!cashAccountId) throw new BadRequestException('اختر الخزينة لتسجيل المقدم');
        advanceJournalId = await this.postMaintenanceCash(client, {
          branchId, amount: paid, cashAccountId: cashAccountId!,
          description: `مقدم صيانة — ${ticket.ticket_no}`, sourceId: id, userId: user.userId,
        });
      }

      await client.query(
        `UPDATE maintenance_tickets SET
            branch_cash_account_id = $2::int, customer_name = $3::text, phone = $4::text, phone2 = $5::text,
            product_id = $6::int, model_id = $7::int, serial_no = $8::text, item_color = $9::text,
            accessories = $10::jsonb, product_condition = $11::text, customer_notes = $12::text,
            max_charge = $13::numeric, expected_delivery = $14::date, estimated_cost = $15::numeric,
            advance_amount = $16::numeric, advance_journal_id = $17::bigint,
            advance_posted = $19::boolean,
            total_paid = total_paid + $18::numeric
          WHERE ticket_id = $1::bigint`,
        [
          id, cashAccountId, input.customerName, input.phone, input.phone2, input.productId, input.modelId,
          String(dto?.serialNo ?? '').trim() || null, String(dto?.itemColor ?? '').trim() || null,
          JSON.stringify(dto?.accessories ?? {}), String(dto?.productCondition ?? '').trim(),
          String(dto?.customerNotes ?? '').trim() || null, Number(dto?.maxCharge ?? 0),
          dto?.expectedDelivery ? String(dto.expectedDelivery) : null,
          Number(dto?.estimatedCost ?? 0), paid, advanceJournalId, diff, paid > 0,
        ],
      );
      return { updated: true };
    });
  }

  async deleteTicket(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const current = await client.query(
        'SELECT branch_id, delivery_status, advance_journal_id, payment_journal_id FROM maintenance_tickets WHERE ticket_id = $1::bigint',
        [id],
      );
      if (!current.rows.length) throw new NotFoundException('الإذن غير موجود');
      this.assertTicketBranch(current.rows[0], branchId);
      if (Number(current.rows[0].delivery_status) === 1 && !user.permissions.includes('users.manage')) {
        throw new BadRequestException('عفوا، لا يجوز حذف إذن تم تسليمه مسبقًا');
      }
      if (current.rows[0].advance_journal_id) await voidJournal(client, Number(current.rows[0].advance_journal_id));
      if (current.rows[0].payment_journal_id) await voidJournal(client, Number(current.rows[0].payment_journal_id));
      await client.query('DELETE FROM maintenance_tickets WHERE ticket_id = $1::bigint', [id]);
      return { deleted: true };
    });
  }

  /** Inspection: set engineer/report/status, and reconcile spare parts with the warehouse. */
  async inspectTicket(id: number, dto: any, user: AuthUser, branchId: number) {
    const inspectionStatus = Number(dto?.inspectionStatus);
    if (![0, 1, 2, 3, 4].includes(inspectionStatus)) {
      throw new BadRequestException('حالة الفحص غير صحيحة');
    }
    const engineerId = Number(dto?.engineerId ?? 0);
    if (!engineerId) throw new BadRequestException('اختر المهندس المسئول');
    const engineer = await this.db.one(
      'SELECT 1 AS ok FROM users WHERE user_id = $1::int AND is_active = true AND is_sales_rep = true',
      [engineerId],
    );
    if (!engineer) throw new BadRequestException('المهندس المختار غير مفعّل');

    return this.db.transaction(async (client) => {
      const current = await client.query(
        'SELECT * FROM maintenance_tickets WHERE ticket_id = $1::bigint',
        [id],
      );
      if (!current.rows.length) throw new NotFoundException('الإذن غير موجود');
      this.assertTicketBranch(current.rows[0], branchId);
      if (Number(current.rows[0].delivery_status) === 1 && !user.permissions.includes('users.manage')) {
        throw new BadRequestException('الجهاز مسلّم بالفعل — يلزم صلاحية خاصة لتعديل الفحص بعد التسليم');
      }
      const ticket = current.rows[0];

      const warehouseId = await this.defaultWarehouseId(client, branchId);

      // --- reconcile parts with the ledger -----------------------------------
      const desired = new Map<number, number>();
      const desiredPrices = new Map<number, number>();
      for (const line of Array.isArray(dto?.parts) ? dto.parts : []) {
        const itemId = Number(line?.itemId ?? 0);
        const quantity = Number(line?.quantity ?? 0);
        if (itemId && quantity >= 0) {
          desired.set(itemId, (desired.get(itemId) ?? 0) + quantity);
          if (line?.unitPrice !== undefined) desiredPrices.set(itemId, Number(line.unitPrice));
        }
      }
      const currentParts = await client.query(
        'SELECT item_id, quantity, unit_cost, unit_price FROM maintenance_ticket_parts WHERE ticket_id = $1::bigint',
        [id],
      );
      const currentMap = new Map<number, { quantity: number; unitCost: number; unitPrice: number }>();
      for (const row of currentParts.rows) {
        currentMap.set(Number(row.item_id), {
          quantity: Number(row.quantity), unitCost: Number(row.unit_cost), unitPrice: Number(row.unit_price),
        });
      }
      const itemIds = new Set([...desired.keys(), ...currentMap.keys()]);
      if (itemIds.size && !warehouseId) {
        throw new BadRequestException('لا يوجد مخزن افتراضي نشط للفرع — لا يمكن خصم قطع الغيار');
      }

      for (const itemId of itemIds) {
        const want = desired.get(itemId) ?? 0;
        const have = currentMap.get(itemId)?.quantity ?? 0;
        const { rows: itemRows } = await client.query(
          `SELECT i.name, i.base_unit_id, i.sell_price, i.cost_price
             FROM items i WHERE i.item_id = $1::int`,
          [itemId],
        );
        if (!itemRows.length) throw new BadRequestException(`الصنف رقم ${itemId} غير موجود`);
        const item = itemRows[0];
        const baseUnitId = Number(item.base_unit_id);
        const unitCost = warehouseId ? await getWarehouseCost(client, itemId, warehouseId) : Number(item.cost_price ?? 0);
        const unitPrice = desiredPrices.get(itemId) ?? Number(item.sell_price ?? 0);

        const diff = want - have;
        if (diff > 0 && warehouseId) {
          await applyMovement(client, {
            branchId, warehouseId, itemId, unitId: baseUnitId, moveType: 'adjustmentOut',
            quantity: diff, unitCost: unitCost > 0 ? unitCost : Number(item.cost_price ?? 0),
            referenceType: 4, referenceId: id, referenceNo: ticket.ticket_no,
            notes: 'قطع غيار صيانة', userId: user.userId, baseUnitId,
          });
        } else if (diff < 0 && warehouseId) {
          await applyMovement(client, {
            branchId, warehouseId, itemId, unitId: baseUnitId, moveType: 'adjustment',
            quantity: -diff, unitCost: currentMap.get(itemId)?.unitCost ?? unitCost,
            referenceType: 4, referenceId: id, referenceNo: ticket.ticket_no,
            notes: 'استرجاع قطع غيار صيانة', userId: user.userId, baseUnitId,
          });
        }

        if (want === 0) {
          await client.query('DELETE FROM maintenance_ticket_parts WHERE ticket_id = $1::bigint AND item_id = $2::int', [id, itemId]);
        } else {
          await client.query(
            `INSERT INTO maintenance_ticket_parts (ticket_id, item_id, quantity, unit_price, unit_cost)
             VALUES ($1::bigint, $2::int, $3::numeric, $4::numeric, $5::numeric)
             ON CONFLICT (ticket_id, item_id) DO UPDATE SET
               quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, unit_cost = EXCLUDED.unit_cost`,
            [id, itemId, want, unitPrice, unitCost > 0 ? unitCost : Number(item.cost_price ?? 0)],
          );
        }
      }

      await client.query(
        `UPDATE maintenance_tickets SET
            engineer_id = $2::int, inspection_status = $3::smallint, check_report = $4::text,
            actual_cost = COALESCE($5::numeric, actual_cost), expected_delivery = COALESCE($6::date, expected_delivery)
          WHERE ticket_id = $1::bigint`,
        [
          id, engineerId, inspectionStatus, String(dto?.checkReport ?? '').trim() || null,
          dto?.actualCost !== undefined ? Number(dto.actualCost) : null,
          dto?.expectedDelivery ? String(dto.expectedDelivery) : null,
        ],
      );
      return { saved: true };
    });
  }

  /** Delivery & settlement: collects the balance, marks the order delivered, locks it. */
  async deliverTicket(id: number, dto: any, user: AuthUser, branchId: number) {
    const paid = Number(dto?.paidAmount ?? 0);
    const delivered = dto?.delivered !== false;
    const cashAccountId = dto?.cashAccountId ? Number(dto.cashAccountId) : null;

    return this.db.transaction(async (client) => {
      const current = await client.query(
        'SELECT * FROM maintenance_tickets WHERE ticket_id = $1::bigint',
        [id],
      );
      if (!current.rows.length) throw new NotFoundException('الإذن غير موجود');
      const ticket = current.rows[0];
      this.assertTicketBranch(ticket, branchId);
      if (Number(ticket.delivery_status) === 1 && !user.permissions.includes('users.manage')) {
        throw new BadRequestException('عفوا، الإذن مسلّم ومقفل');
      }
      if (paid > 0 && !(cashAccountId ?? ticket.branch_cash_account_id)) {
        throw new BadRequestException('اختر الخزينة لتسجيل السداد');
      }
      const accountId = cashAccountId ?? ticket.branch_cash_account_id;

      // Replace the previous settlement journal (re-save case).
      const oldPayment = Number(ticket.last_payment_amount ?? 0);
      if (ticket.payment_journal_id) {
        await voidJournal(client, Number(ticket.payment_journal_id));
      }
      let paymentJournalId: number | null = null;
      if (paid > 0) {
        paymentJournalId = await this.postMaintenanceCash(client, {
          branchId, amount: paid, cashAccountId: accountId,
          description: `سداد صيانة — ${ticket.ticket_no}`, sourceId: id, userId: user.userId,
        });
      }

      // Cost of the consumed parts at purchase cost (perpetual inventory).
      if (paid > 0) {
        const partsCostRows = await client.query(
          `SELECT COALESCE(SUM(quantity * unit_cost), 0) AS cost FROM maintenance_ticket_parts WHERE ticket_id = $1::bigint`,
          [id],
        );
        const partsCost = Number(partsCostRows.rows[0]?.cost ?? 0);
        if (partsCost > 0.004) {
          const cogs = await requireMapping(client, 'COGS', 'تكلفة المبيعات');
          const inventory = await requireMapping(client, 'INVENTORY', 'المخزون');
          const today = new Date().toISOString().slice(0, 10);
          await assertPeriodOpen(client, branchId, today);
          await postJournal(client, {
            branchId, journalDate: today, journalType: 2,
            description: `تكلفة قطع صيانة — ${ticket.ticket_no}`,
            sourceType: 'maintenance_ticket', sourceId: id, userId: user.userId,
            lines: [
              { accountId: cogs.accountId, debit: partsCost, credit: 0, description: 'قطع غيار صيانة' },
              { accountId: inventory.accountId, debit: 0, credit: partsCost, description: 'خروج مخزون' },
            ],
          });
        }
      }

      await client.query(
        `UPDATE maintenance_tickets SET
            branch_cash_account_id = $2::int, payment_journal_id = $3::bigint,
            last_payment_amount = $4::numeric, total_paid = total_paid - $5::numeric + $4::numeric,
            delivery_status = ${delivered ? 1 : 0},
            delivered_by = CASE WHEN $6::boolean THEN $7::int ELSE delivered_by END,
            delivered_at = CASE WHEN $6::boolean THEN now() ELSE delivered_at END
          WHERE ticket_id = $1::bigint`,
        [id, accountId, paymentJournalId, paid, oldPayment, delivered, user.userId],
      );
      return { delivered, paid };
    });
  }

  // --------------------------------------------------------------- report
  async serviceReport(params: {
    branchId: number; all?: boolean; from?: string; to?: string; engineerId?: number;
    paymentStatus?: number; deliveryStatus?: number; inspectionStatus?: number; customer?: string;
  }) {
    const w: string[] = [];
    const values: any[] = [];
    const put = (value: any, cast = 'text') => {
      values.push(value);
      return `$${values.length}::${cast}`;
    };
    if (!params.all) w.push(`t.branch_id = ${put(params.branchId, 'int')}`);
    if (params.from) w.push(`t.received_at::date >= ${put(params.from, 'date')}`);
    if (params.to) w.push(`t.received_at::date <= ${put(params.to, 'date')}`);
    if (params.engineerId) w.push(`t.engineer_id = ${put(params.engineerId, 'int')}`);
    if (params.inspectionStatus !== undefined && Number.isFinite(Number(params.inspectionStatus))) {
      w.push(`t.inspection_status = ${put(Number(params.inspectionStatus), 'smallint')}`);
    }
    if (params.deliveryStatus !== undefined && Number.isFinite(Number(params.deliveryStatus))) {
      w.push(`t.delivery_status = ${put(Number(params.deliveryStatus), 'smallint')}`);
    }
    if (params.paymentStatus === 1) w.push(`COALESCE(t.actual_cost, t.estimated_cost) - t.total_paid <= 0.004`);
    if (params.paymentStatus === 0) w.push(`COALESCE(t.actual_cost, t.estimated_cost) - t.total_paid > 0.004`);
    if (params.customer) w.push(`t.customer_name ILIKE ${put(`%${params.customer}%`, 'text')}`);
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const rows = await this.db.query(
      `SELECT ${TICKET_LIST_SELECT} ${where}
        ORDER BY t.received_at DESC LIMIT 500`,
      values,
    );
    const totals = rows.reduce((acc: any, row: any) => {
      const value = Number(row.actualCost ?? row.estimatedCost ?? 0);
      acc.total += value;
      acc.paid += Number(row.totalPaid ?? 0);
      acc.remaining += value - Number(row.totalPaid ?? 0);
      acc.partsCost += Number(row.partsCost ?? 0);
      return acc;
    }, { total: 0, paid: 0, remaining: 0, partsCost: 0 });

    return { items: rows, totals: { ...totals, profit: totals.total - totals.partsCost } };
  }
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly service: MaintenanceService) {}

  // reference data
  @RequirePermissions('maintenance.view')
  @Get('products')
  products(@Query('all') all?: string) {
    return this.service.products(all === '1');
  }

  @RequirePermissions('maintenance.manage')
  @Post('products')
  createProduct(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.createProduct(dto, user);
  }

  @RequirePermissions('maintenance.manage')
  @Put('products/:id')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateProduct(id, dto);
  }

  @RequirePermissions('maintenance.manage')
  @Delete('products/:id')
  deleteProduct(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteProduct(id);
  }

  @RequirePermissions('maintenance.view')
  @Get('models')
  models(@Query('productId') productId?: string) {
    return this.service.models(productId ? Number(productId) : undefined);
  }

  @RequirePermissions('maintenance.manage')
  @Post('models')
  createModel(@Body() dto: any) {
    return this.service.createModel(dto);
  }

  @RequirePermissions('maintenance.manage')
  @Put('models/:id')
  updateModel(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateModel(id, dto);
  }

  @RequirePermissions('maintenance.manage')
  @Delete('models/:id')
  deleteModel(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteModel(id);
  }

  @RequirePermissions('maintenance.view')
  @Get('fault-categories')
  faultCategories() {
    return this.service.faultCategories();
  }

  @RequirePermissions('maintenance.manage')
  @Post('fault-categories')
  createFaultCategory(@Body() dto: any) {
    return this.service.createFaultCategory(dto);
  }

  @RequirePermissions('maintenance.manage')
  @Put('fault-categories/:id')
  updateFaultCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateFaultCategory(id, dto);
  }

  @RequirePermissions('maintenance.manage')
  @Delete('fault-categories/:id')
  deleteFaultCategory(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteFaultCategory(id);
  }

  @RequirePermissions('maintenance.view')
  @Get('fault-subcategories')
  faultSubcategories(@Query('categoryId') categoryId?: string) {
    return this.service.faultSubcategories(categoryId ? Number(categoryId) : undefined);
  }

  @RequirePermissions('maintenance.manage')
  @Post('fault-subcategories')
  createFaultSubcategory(@Body() dto: any) {
    return this.service.createFaultSubcategory(dto);
  }

  @RequirePermissions('maintenance.manage')
  @Put('fault-subcategories/:id')
  updateFaultSubcategory(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.updateFaultSubcategory(id, dto);
  }

  @RequirePermissions('maintenance.manage')
  @Delete('fault-subcategories/:id')
  deleteFaultSubcategory(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteFaultSubcategory(id);
  }

  @RequirePermissions('maintenance.view')
  @Get('engineers')
  engineers() {
    return this.service.engineers();
  }

  // tickets
  @RequirePermissions('maintenance.view')
  @Get('tickets')
  listTickets(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.listTickets({
      branchId,
      all: query?.all === '1',
      from: query?.from,
      to: query?.to,
      search: query?.search,
      productId: query?.productId ? Number(query.productId) : undefined,
      modelId: query?.modelId ? Number(query.modelId) : undefined,
      inspectionStatus: query?.inspectionStatus !== undefined ? Number(query.inspectionStatus) : undefined,
      deliveryStatus: query?.deliveryStatus !== undefined ? Number(query.deliveryStatus) : undefined,
      paymentStatus: query?.paymentStatus !== undefined ? Number(query.paymentStatus) : undefined,
      page: query?.page ? Number(query.page) : undefined,
      pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @RequirePermissions('maintenance.view')
  @Get('tickets/:id')
  findTicket(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.findTicket(id, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Post('tickets')
  createTicket(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createTicket(dto, user, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Put('tickets/:id')
  updateTicket(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.updateTicket(id, dto, user, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Delete('tickets/:id')
  deleteTicket(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.deleteTicket(id, user, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Post('tickets/:id/inspect')
  inspectTicket(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.inspectTicket(id, dto, user, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Post('tickets/:id/deliver')
  deliverTicket(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.deliverTicket(id, dto, user, branchId);
  }

  @RequirePermissions('maintenance.manage')
  @Post('tickets/:id/print-receipt')
  async printReceipt(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    const ticket = await this.service.findTicket(id, branchId);
    if (!ticket) throw new NotFoundException('الإذن غير موجود');
    return {
      ticketNo: ticket.ticketNo,
      customerName: ticket.customerName,
      productName: ticket.productName,
      modelName: ticket.modelName,
      serialNo: ticket.serialNo,
      estimatedCost: ticket.estimatedCost,
      advanceAmount: ticket.advanceAmount,
    };
  }

  @RequirePermissions('maintenance.view')
  @Get('reports/services')
  serviceReport(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.serviceReport({
      branchId,
      all: query?.all === '1',
      from: query?.from,
      to: query?.to,
      engineerId: query?.engineerId ? Number(query.engineerId) : undefined,
      paymentStatus: query?.paymentStatus !== undefined ? Number(query.paymentStatus) : undefined,
      deliveryStatus: query?.deliveryStatus !== undefined ? Number(query.deliveryStatus) : undefined,
      inspectionStatus: query?.inspectionStatus !== undefined ? Number(query.inspectionStatus) : undefined,
      customer: query?.customer,
    });
  }
}

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
