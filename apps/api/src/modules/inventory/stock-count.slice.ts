import {
  Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
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

/**
 * Stock count (سند الجرد).
 *
 * A counting document that stays a draft while the warehouse is counted and
 * is applied to the stock only when it is approved. The expected quantity of
 * every line is a snapshot of the ledger balance taken when the line was added.
 */
@Injectable()
export class StockCountService {
  constructor(private readonly db: DatabaseService) {}

  async list(params: {
    branchId: number; status?: number; warehouseId?: number; from?: string; to?: string;
    search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    return this.db.query<any>(
      `SELECT c.stock_count_id AS "stockCountId", c.count_no AS "countNo", c.count_date AS "countDate",
              c.warehouse_id AS "warehouseId", w.name AS "warehouseName",
              c.employee_id AS "employeeId", e.name AS "employeeName",
              c.status, c.notes, c.total_expected AS "totalExpected",
              c.total_counted AS "totalCounted", c.total_difference AS "totalDifference",
              c.total_value AS "totalValue", c.created_at AS "createdAt",
              c.approved_at AS "approvedAt", u.full_name AS "createdBy",
              (SELECT count(*)::int FROM stock_count_lines l
                WHERE l.stock_count_id = c.stock_count_id) AS "lineCount"
         FROM stock_counts c
         JOIN warehouses w ON w.warehouse_id = c.warehouse_id
         JOIN employees e ON e.employee_id = c.employee_id
         LEFT JOIN users u ON u.user_id = c.created_by
        WHERE ($1::int = 0 OR c.branch_id = $1::int)
          AND ($2::int = 0 OR c.status = $2::int)
          AND ($3::int = 0 OR c.warehouse_id = $3::int)
          AND ($4::date IS NULL OR c.count_date >= $4::date)
          AND ($5::date IS NULL OR c.count_date <= $5::date)
          AND ($6::text = '' OR c.count_no ILIKE $7 OR COALESCE(e.name, '') ILIKE $7)
        ORDER BY c.count_date DESC, c.stock_count_id DESC
        LIMIT $8::int`,
      [params.branchId, params.status ?? 0, params.warehouseId ?? 0, params.from ?? null,
        params.to ?? null, search, like, params.limit],
    );
  }

  async findOne(id: number) {
    const header = await this.db.one<any>(
      `SELECT c.stock_count_id AS "stockCountId", c.count_no AS "countNo", c.count_date AS "countDate",
              c.branch_id AS "branchId", c.warehouse_id AS "warehouseId", w.name AS "warehouseName",
              c.employee_id AS "employeeId", e.name AS "employeeName",
              c.status, c.notes, c.total_expected AS "totalExpected",
              c.total_counted AS "totalCounted", c.total_difference AS "totalDifference",
              c.total_value AS "totalValue", c.gl_journal_id AS "glJournalId",
              c.created_at AS "createdAt", c.approved_at AS "approvedAt", u.full_name AS "createdBy"
         FROM stock_counts c
         JOIN warehouses w ON w.warehouse_id = c.warehouse_id
         JOIN employees e ON e.employee_id = c.employee_id
         LEFT JOIN users u ON u.user_id = c.created_by
        WHERE c.stock_count_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('سند الجرد غير موجود');

    const lines = await this.db.query<any>(
      `SELECT l.stock_count_line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", u.name AS "unitName",
              l.counted_qty AS "countedQty", l.expected_qty AS "expectedQty",
              l.difference_qty AS "differenceQty", l.unit_cost AS "unitCost",
              (l.difference_qty * l.unit_cost) AS "differenceValue",
              l.expiry_date AS "expiryDate", l.notes
         FROM stock_count_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.stock_count_id = $1::bigint
        ORDER BY l.line_number`,
      [id],
    );

    // The live balance is shown next to the counted quantity for reference.
    for (const line of lines) {
      const balance = await this.currentBalance(header.warehouseId, line.itemId);
      line.currentBalance = balance;
    }

    return { header, lines };
  }

  /** The ledger balance of an item in a warehouse, in base units. */
  private async currentBalance(warehouseId: number, itemId: number): Promise<number> {
    const row = await this.db.one<any>(
      `SELECT q.on_hand_qty AS qty
         FROM item_warehouse_qty q
         JOIN items i ON i.item_id = q.item_id
        WHERE q.item_id = $1::int AND q.warehouse_id = $2::int AND q.unit_id = i.base_unit_id`,
      [itemId, warehouseId],
    );
    return round6(Number(row?.qty ?? 0));
  }

  /** Creates an empty counting document. */
  async create(dto: any, user: AuthUser, branchId: number) {
    const warehouseId = Number(dto.warehouseId);
    if (!warehouseId) throw new BadRequestException('اختر المخزن');
    const employeeId = Number(dto.employeeId);
    if (!employeeId) throw new BadRequestException('الموظف المختص إلزامي');

    return this.db.transaction(async (client) => {
      const warehouse = await client.query<any>(
        'SELECT warehouse_id, branch_id FROM warehouses WHERE warehouse_id = $1::int AND is_active = true',
        [warehouseId],
      );
      if (!warehouse.rows.length) throw new BadRequestException('المخزن غير موجود');
      if (Number(warehouse.rows[0].branch_id) !== Number(branchId)) {
        throw new BadRequestException('المخزن لا يتبع الفرع الحالي');
      }

      const employee = await client.query<any>(
        'SELECT employee_id, name FROM employees WHERE employee_id = $1::int AND is_active = true',
        [employeeId],
      );
      if (!employee.rows.length) {
        throw new BadRequestException('الموظف المختص غير موجود في قائمة الموظفين');
      }

      // Only one open count per warehouse.
      const open = await client.query<any>(
        `SELECT count_no FROM stock_counts
          WHERE warehouse_id = $1::int AND status = 1 LIMIT 1`,
        [warehouseId],
      );
      if (open.rows.length) {
        throw new BadRequestException(
          `يوجد سند جرد غير معتمد للمخزن (${open.rows[0].count_no}) — اعتمده أو احذفه أولًا`,
        );
      }

      // Pending warehouse movements must be approved before counting.
      const pending = await client.query<any>(
        `SELECT operation_no FROM stock_operations
          WHERE status = 1
            AND (from_warehouse_id = $1::int OR to_warehouse_id = $1::int)
          LIMIT 1`,
        [warehouseId],
      );
      if (pending.rows.length) {
        throw new BadRequestException(
          `اعتمد كل الحركات المعلّقة على المخزن قبل الجرد (${pending.rows[0].operation_no})`,
        );
      }

      const serial = await this.nextNumber(client, `stockcount:${branchId}`);
      const countNo = `SC-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ stock_count_id: number }>(
        `INSERT INTO stock_counts
           (count_no, count_date, branch_id, warehouse_id, employee_id, notes, status, created_by)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::int, $4::int, $5::int, $6, 1, $7::int)
         RETURNING stock_count_id`,
        [countNo, dto.countDate ?? null, branchId, warehouseId, employeeId,
          dto.notes ?? null, user.userId],
      );
      return { stockCountId: Number(inserted.rows[0].stock_count_id), countNo };
    });
  }

  /** Edits the header of a draft document. */
  async update(id: number, dto: any) {
    const header = await this.draftHeader(id);
    await this.db.query(
      `UPDATE stock_counts SET count_date = COALESCE($2::date, count_date),
              employee_id = COALESCE($3::int, employee_id),
              notes = COALESCE($4, notes)
        WHERE stock_count_id = $1::bigint`,
      [id, dto.countDate ?? null, dto.employeeId ? Number(dto.employeeId) : null, dto.notes ?? null],
    );
    return { stockCountId: id, warehouseId: header.warehouse_id };
  }

  private async draftHeader(id: number) {
    const row = await this.db.one<any>(
      'SELECT stock_count_id, warehouse_id, status FROM stock_counts WHERE stock_count_id = $1::bigint',
      [id],
    );
    if (!row) throw new BadRequestException('سند الجرد غير موجود');
    if (Number(row.status) === 2) throw new BadRequestException('السند المعتمد لا يمكن تعديله');
    if (Number(row.status) === 3) throw new BadRequestException('السند ملغى');
    return row;
  }

  /**
   * Adds a counted line. Adding the same item again in the same unit adds the
   * quantity to the existing line, and an item whose counted quantity equals
   * the balance is not added at all (it has no difference).
   */
  async addLine(id: number, dto: any) {
    const header = await this.draftHeader(id);
    const itemId = Number(dto.itemId);
    if (!itemId) throw new BadRequestException('اختر الصنف');
    const countedQty = Number(dto.countedQty ?? 0);
    if (countedQty < 0) throw new BadRequestException('الكمية لا يمكن أن تكون سالبة');

    return this.db.transaction(async (client) => {
      const item = await client.query<any>(
        `SELECT item_id, base_unit_id, cost_price, name FROM items WHERE item_id = $1::int AND is_active = true`,
        [itemId],
      );
      if (!item.rows.length) throw new BadRequestException('الصنف غير موجود');
      const baseUnitId = Number(item.rows[0].base_unit_id);
      const unitId = dto.unitId ? Number(dto.unitId) : baseUnitId;

      // The expected quantity is a snapshot of the ledger balance right now.
      const balance = await this.balanceIn(client, Number(header.warehouse_id), itemId, baseUnitId);
      const countedBase = await toBaseUnits(client, itemId, unitId, countedQty);

      const existing = await client.query<any>(
        `SELECT stock_count_line_id, counted_qty, expected_qty, unit_id
           FROM stock_count_lines
          WHERE stock_count_id = $1::bigint AND item_id = $2::int AND unit_id = $3::int
          FOR UPDATE`,
        [id, itemId, unitId],
      );

      if (existing.rows.length) {
        const line = existing.rows[0];
        const newCounted = round6(Number(line.counted_qty) + countedBase);
        await client.query(
          `UPDATE stock_count_lines SET counted_qty = $2::numeric WHERE stock_count_line_id = $1::bigint`,
          [line.stock_count_line_id, newCounted],
        );
        await this.recalculate(client, id);
        return { added: true, merged: true, countedQty: newCounted };
      }

      if (round6(countedBase) === balance) {
        throw new BadRequestException('كمية الصنف مطابقة للرصيد الفعلي — لا يوجد فرق');
      }

      const lineNo = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM stock_count_lines WHERE stock_count_id = $1::bigint',
        [id],
      );
      const unitCost = await getWarehouseCost(client, itemId, Number(header.warehouse_id));
      const cost = unitCost > 0 ? unitCost : Number(item.rows[0].cost_price ?? 0);

      await client.query(
        `INSERT INTO stock_count_lines
           (stock_count_id, line_number, item_id, unit_id, counted_qty, expected_qty,
            difference_qty, unit_cost, expiry_date, notes)
         VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::date,$10::text)`,
        [id, Number(lineNo.rows[0].n), itemId, unitId, countedBase, balance,
          round6(countedBase - balance), round2(cost), dto.expiryDate ?? null, dto.notes ?? null],
      );
      await this.recalculate(client, id);
      return { added: true, merged: false, countedQty: countedBase, expectedQty: balance };
    });
  }

  /** Edits the counted quantity of a line and recalculates the difference. */
  async updateLine(id: number, lineId: number, dto: any) {
    await this.draftHeader(id);
    return this.db.transaction(async (client) => {
      const line = await client.query<any>(
        'SELECT * FROM stock_count_lines WHERE stock_count_line_id = $1::bigint AND stock_count_id = $2::bigint',
        [lineId, id],
      );
      if (!line.rows.length) throw new BadRequestException('السطر غير موجود');
      const countedQty = Number(dto.countedQty ?? line.rows[0].counted_qty);
      await client.query(
        `UPDATE stock_count_lines
            SET counted_qty = $2::numeric, difference_qty = $3::numeric, notes = COALESCE($4, notes)
          WHERE stock_count_line_id = $1::bigint`,
        [lineId, countedQty, round6(countedQty - Number(line.rows[0].expected_qty)), dto.notes ?? null],
      );
      await this.recalculate(client, id);
      return { lineId, countedQty };
    });
  }

  /**
   * Adds a group of items with one uniform quantity: a whole category, all
   * the items, or the items of one supplier.
   */
  async addGroup(id: number, dto: any) {
    const header = await this.draftHeader(id);
    const quantity = Number(dto.quantity ?? 0);

    return this.db.transaction(async (client) => {
      const items = await client.query<any>(
        `SELECT i.item_id, i.base_unit_id, i.cost_price, i.name
           FROM items i
          WHERE i.is_active = true
            AND ($1::int = 0 OR i.category_id = $1::int)
            AND ($2::int = 0 OR EXISTS (
                  SELECT 1 FROM stock_operation_lines sol
                    JOIN stock_operations so ON so.stock_operation_id = sol.stock_operation_id
                   WHERE so.operation_type = 2 AND sol.item_id = i.item_id))
          ORDER BY i.code`,
        [dto.categoryId ? Number(dto.categoryId) : 0, dto.supplierId ? Number(dto.supplierId) : 0],
      );
      if (!items.rows.length) throw new BadRequestException('لا توجد أصناف مطابقة');

      let added = 0;
      let skipped = 0;
      let stopped = false;
      for (const item of items.rows) {
        if (stopped) { skipped += 1; continue; }
        const balance = await this.balanceIn(
          client, Number(header.warehouse_id), Number(item.item_id), Number(item.base_unit_id),
        );
        const countedBase = round6(quantity * Number(item.base_unit_id ? 1 : 1));
        if (round6(countedBase) === balance) { skipped += 1; continue; }

        const existing = await client.query<any>(
          `SELECT stock_count_line_id FROM stock_count_lines
            WHERE stock_count_id = $1::bigint AND item_id = $2::int AND unit_id = $3::int`,
          [id, item.item_id, item.base_unit_id],
        );
        if (existing.rows.length) {
          // The item was already counted in another unit: the guide stops here.
          stopped = true;
          skipped += 1;
          continue;
        }

        const lineNo = await client.query<{ n: number }>(
          'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM stock_count_lines WHERE stock_count_id = $1::bigint',
          [id],
        );
        const unitCost = await getWarehouseCost(client, Number(item.item_id), Number(header.warehouse_id));
        const cost = unitCost > 0 ? unitCost : Number(item.cost_price ?? 0);
        await client.query(
          `INSERT INTO stock_count_lines
             (stock_count_id, line_number, item_id, unit_id, counted_qty, expected_qty,
              difference_qty, unit_cost, expiry_date, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,$8::numeric,NULL,$9::text)`,
          [id, Number(lineNo.rows[0].n), item.item_id, item.base_unit_id, countedBase, balance,
            round6(countedBase - balance), round2(cost), item.name],
        );
        added += 1;
      }
      await this.recalculate(client, id);
      return { added, skipped };
    });
  }

  /**
   * Imports counted quantities from a spreadsheet.
   * The columns are Name, Code, Qty (and optionally Unit, Expire).
   * Rows with an unknown code are reported and ignored.
   */
  async importRows(id: number, rows: any[]) {
    await this.draftHeader(id);
    const parsed: any[] = [];
    const missing: string[] = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const code = String(row.code ?? row.Code ?? '').trim();
      const name = String(row.name ?? row.Name ?? '').trim();
      const quantity = Number(row.qty ?? row.Qty ?? row.quantity ?? 0);
      if (!code && !name) continue;
      const item = await this.db.one<any>(
        `SELECT item_id, base_unit_id FROM items
          WHERE ($1::text <> '' AND code = $1::text) OR ($2::text <> '' AND name = $2::text)
          LIMIT 1`,
        [code, code ? '' : name],
      );
      if (!item) { missing.push(code || name); continue; }
      parsed.push({
        itemId: Number(item.item_id),
        unitId: Number(item.base_unit_id),
        countedQty: quantity,
        expiryDate: row.expire ?? row.Expire ?? null,
      });
    }

    for (const line of parsed) {
      try {
        await this.addLine(id, line);
      } catch {
        // A line without a difference is simply not counted.
      }
    }
    return { imported: parsed.length, missing };
  }

  /**
   * Approves the document: the differences are applied to the warehouse and
   * an accounting entry is posted for their value.
   */
  async approve(id: number, user: AuthUser) {
    return this.db.transaction(async (client) => {
      const header = await client.query<any>(
        'SELECT * FROM stock_counts WHERE stock_count_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!header.rows.length) throw new BadRequestException('سند الجرد غير موجود');
      const count = header.rows[0];
      if (Number(count.status) === 2) throw new BadRequestException('السند معتمد بالفعل');

      const lines = await client.query<any>(
        'SELECT * FROM stock_count_lines WHERE stock_count_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد أصناف في السند');

      let netValue = 0;
      for (const line of lines.rows) {
        const difference = round6(Number(line.counted_qty) - Number(line.expected_qty));
        if (difference === 0) continue;
        const value = round2(difference * Number(line.unit_cost ?? 0));
        netValue = round2(netValue + value);

        await applyMovement(client, {
          branchId: Number(count.branch_id),
          warehouseId: Number(count.warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: difference > 0 ? 'countGain' : 'countLoss',
          quantity: Math.abs(difference),
          unitCost: Number(line.unit_cost ?? 0),
          referenceType: 3,
          referenceId: id,
          referenceNo: count.count_no,
          userId: user.userId,
          notes: `تسوية جرد ${count.count_no}`,
        });
      }

      // The accounting entry for the value of the difference.
      let journalId: number | null = null;
      if (netValue !== 0) {
        const inventory = await resolveMapping(client, 'INVENTORY');
        const variance = await resolveMapping(client, 'INVENTORY_VARIANCE');
        if (inventory && variance) {
          journalId = await postJournal(client, {
            branchId: Number(count.branch_id),
            journalType: 7,
            description: `تسوية جرد ${count.count_no}`,
            sourceType: 'stock_count',
            sourceId: id,
            lines: netValue > 0
              ? [
                { accountId: inventory.accountId, debit: netValue, description: 'زيادة جرد' },
                { accountId: variance.accountId, credit: netValue, description: 'فروقات الجرد' },
              ]
              : [
                { accountId: variance.accountId, debit: -netValue, description: 'فروقات الجرد' },
                { accountId: inventory.accountId, credit: -netValue, description: 'عجز جرد' },
              ],
            userId: user.userId,
            autoBalance: true,
          });
        }
      }

      await client.query(
        `UPDATE stock_counts
            SET status = 2, approved_by = $2::int, approved_at = now(),
                total_value = $3::numeric, gl_journal_id = $4::bigint
          WHERE stock_count_id = $1::bigint`,
        [id, user.userId, netValue, journalId],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.count.approve','stock_count',$3::bigint,$4)`,
        [user.userId, Number(count.branch_id), id,
          `اعتماد سند الجرد ${count.count_no} بقيمة ${netValue}`],
      );

      return { stockCountId: id, status: 2, totalValue: netValue, journalId };
    });
  }

  /** Deletes a draft document. An approved one can never be deleted. */
  async remove(id: number) {
    const header = await this.draftHeader(id);
    await this.db.query('DELETE FROM stock_counts WHERE stock_count_id = $1::bigint', [id]);
    return { stockCountId: id, deleted: true, warehouseId: header.warehouse_id };
  }

  /** Recomputes the totals of a document from its lines. */
  private async recalculate(client: PoolClient, id: number) {
    const totals = await client.query<any>(
      `SELECT COALESCE(SUM(expected_qty),0) AS expected,
              COALESCE(SUM(counted_qty),0) AS counted,
              COALESCE(SUM(difference_qty),0) AS difference,
              COALESCE(SUM(difference_qty * unit_cost),0) AS value
         FROM stock_count_lines WHERE stock_count_id = $1::bigint`,
      [id],
    );
    await client.query(
      `UPDATE stock_counts
          SET total_expected = $2::numeric, total_counted = $3::numeric,
              total_difference = $4::numeric, total_value = $5::numeric
        WHERE stock_count_id = $1::bigint`,
      [id, round6(totals.rows[0].expected), round6(totals.rows[0].counted),
        round6(totals.rows[0].difference), round2(totals.rows[0].value)],
    );
  }

  private async balanceIn(
    client: PoolClient, warehouseId: number, itemId: number, baseUnitId: number,
  ): Promise<number> {
    const row = await client.query<any>(
      `SELECT on_hand_qty FROM item_warehouse_qty
        WHERE item_id = $1::int AND warehouse_id = $2::int AND unit_id = $3::int`,
      [itemId, warehouseId, baseUnitId],
    );
    return round6(Number(row.rows[0]?.on_hand_qty ?? 0));
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

@Controller('stock-counts')
export class StockCountController {
  constructor(private readonly service: StockCountService) {}

  @RequirePermissions('stock.view')
  @Get()
  list(
    @Query('status') status: string,
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
  @Post(':id/groups')
  addGroup(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.addGroup(id, dto);
  }

  @RequirePermissions('stock.manage')
  @Post(':id/import')
  importRows(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.service.importRows(id, dto.rows ?? []);
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
