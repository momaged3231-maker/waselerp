import {
  Body, Controller, Delete, Get, Injectable, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { assertDeletionAllowed } from '../../common/delete-guard';
import { applyMovement, getWarehouseCost, toBaseUnits } from '../../common/stock';
import { postJournal, resolvePeriod } from '../../common/posting';
import { asIsoDate } from '../../common/dates';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';



/** Money rounds to 2dp, quantities to 6dp (matches the same-branch transfer). */
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round6 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

const STATUS: Record<number, string> = {
  1: 'مسودة', 2: 'صدر من هنا — بانتظار الاستلام', 4: 'مكتمل — مستلم', 5: 'ملغي',
};

type HeaderRow = {
  branch_transfer_id: number;
  transfer_no: string;
  transfer_date: string;
  from_branch_id: number;
  to_branch_id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  status: number | string;
  total_value: string | number;
  notes: string | null;
  client_request_id: string | null;
  outbound_voucher_id: number | null;
  inbound_voucher_id: number | null;
  outbound_journal_id: number | null;
  inbound_journal_id: number | null;
  created_by: number;
  approved_by: number | null;
  approved_at: string | null;
  received_at: string | null;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

/**
 * Cross-branch (inter-branch) stock transfer — E2.
 *
 * Dispatched goods leave the SOURCE branch through an OUTBOUND voucher and an
 * `transfer_out` ledger movement; the DESTINATION branch accepts them through
 * an INBOUND voucher and an `transfer_in` movement. The amounts are valued at
 * the source warehouse's moving-average cost and never re-valued in transit.
 *
 * Accounting policy (approved):
 *   issue  : Dr 1108 (BRANCH_TRANSFER_CLEARING) / Cr 1104 (INVENTORY) — SOURCE branch
 *   receipt: Dr 1104 (INVENTORY) / Cr 1108 (BRANCH_TRANSFER_CLEARING) — DESTINATION branch
 * No P&L or retained-earnings effect anywhere; 1108 must reach ZERO once all
 * shipments are received, and it is always visible in the transfer report.
 */
@Injectable()
export class BranchTransferService {
  constructor(private readonly db: DatabaseService) {}

  private async requireBranchOpenAtDate(client: PoolClient, branchId: number, date: string, what: string) {
    const period = await resolvePeriod(client, branchId, date as string);
    if (period.isClosed) {
      throw new BadRequestException(`الفترة المحاسبية للفرع «${period.name ?? branchId}» مقفلة — ${what}`);
    }
    if (period.manualLock) {
      throw new BadRequestException(`الفترة «${period.name ?? branchId}» مقفولة إداريًا — ${what}`);
    }
    return period;
  }

  private scopeWhere(branchId: number) {
    return { sql: '(t.from_branch_id = $1::int OR t.to_branch_id = $1::int)', params: [branchId] };
  }

  async list(params: {
    branchId: number; status?: number; fromBranchId?: number; toBranchId?: number;
    from?: string; to?: string; search?: string; limit: number;
  }) {
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    const scope = this.scopeWhere(params.branchId);
    return this.db.query<any>(
      `SELECT t.branch_transfer_id AS "branchTransferId", t.transfer_no AS "transferNo",
              t.transfer_date AS "transferDate",
              t.from_branch_id AS "fromBranchId", fb.name AS "fromBranchName",
              t.to_branch_id AS "toBranchId", tb.name AS "toBranchName",
              t.from_warehouse_id AS "fromWarehouseId", fw.name AS "fromWarehouseName",
              t.to_warehouse_id AS "toWarehouseId", tw.name AS "toWarehouseName",
              t.status, t.total_value AS "totalValue", t.notes,
              t.outbound_voucher_id AS "outboundVoucherId", t.inbound_voucher_id AS "inboundVoucherId",
              t.created_at AS "createdAt", t.approved_at AS "approvedAt", t.received_at AS "receivedAt",
              u.full_name AS "createdBy",
              (SELECT count(*)::int FROM branch_transfer_lines l
                WHERE l.branch_transfer_id = t.branch_transfer_id) AS "lineCount"
         FROM branch_transfers t
         JOIN branches fb ON fb.branch_id = t.from_branch_id
         JOIN branches tb ON tb.branch_id = t.to_branch_id
         JOIN warehouses fw ON fw.warehouse_id = t.from_warehouse_id
         JOIN warehouses tw ON tw.warehouse_id = t.to_warehouse_id
         LEFT JOIN users u ON u.user_id = t.created_by
        WHERE ${scope.sql}
          AND ($2::int = 0 OR t.status = $2::int)
          AND ($3::int = 0 OR t.from_branch_id = $3::int)
          AND ($4::int = 0 OR t.to_branch_id = $4::int)
          AND ($5::date IS NULL OR t.transfer_date >= $5::date)
          AND ($6::date IS NULL OR t.transfer_date <= $6::date)
          AND ($7::text = '' OR t.transfer_no ILIKE $8)
        ORDER BY t.transfer_date DESC, t.branch_transfer_id DESC
        LIMIT $9::int`,
      [params.branchId, params.status ?? 0, params.fromBranchId ?? 0, params.toBranchId ?? 0,
        params.from ?? null, params.to ?? null, search, like, params.limit],
    );
  }

  async findOne(id: number, branchId: number) {
    const row = await this.db.one<any>(
      `SELECT t.branch_transfer_id AS "branchTransferId", t.transfer_no AS "transferNo",
              t.transfer_date AS "transferDate",
              t.from_branch_id AS "fromBranchId", fb.name AS "fromBranchName",
              t.to_branch_id AS "toBranchId", tb.name AS "toBranchName",
              t.from_warehouse_id AS "fromWarehouseId", fw.name AS "fromWarehouseName",
              t.to_warehouse_id AS "toWarehouseId", tw.name AS "toWarehouseName",
              t.status, t.total_value AS "totalValue", t.notes, t.client_request_id AS "clientRequestId",
              t.outbound_voucher_id AS "outboundVoucherId", t.inbound_voucher_id AS "inboundVoucherId",
              t.outbound_journal_id AS "outboundJournalId", t.inbound_journal_id AS "inboundJournalId",
              t.created_at AS "createdAt", t.approved_at AS "approvedAt", t.received_at AS "receivedAt",
              t.cancelled_at AS "cancelledAt", t.cancel_reason AS "cancelReason",
              u.full_name AS "createdBy", uv.full_name AS "approvedBy",
              cv.full_name AS "cancelledBy"
         FROM branch_transfers t
         JOIN branches fb ON fb.branch_id = t.from_branch_id
         JOIN branches tb ON tb.branch_id = t.to_branch_id
         JOIN warehouses fw ON fw.warehouse_id = t.from_warehouse_id
         JOIN warehouses tw ON tw.warehouse_id = t.to_warehouse_id
         LEFT JOIN users u ON u.user_id = t.created_by
         LEFT JOIN users uv ON uv.user_id = t.approved_by
         LEFT JOIN users cv ON cv.user_id = t.cancelled_by
        WHERE t.branch_transfer_id = $1::bigint
          AND (t.from_branch_id = $2::int OR t.to_branch_id = $2::int)`,
      [id, branchId],
    );
    if (!row) throw new NotFoundException('سند التحويل غير موجود في هذا الفرع');
    const lines = await this.db.query<any>(
      `SELECT l.line_id AS "lineId", l.line_number AS "lineNumber",
              l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", un.name AS "unitName",
              l.quantity, l.unit_cost AS "unitCost",
              (l.quantity * l.unit_cost) AS "lineValue",
              l.serial_no AS "serialNo", l.expiry_date AS "expiryDate", l.notes
         FROM branch_transfer_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units un ON un.unit_id = l.unit_id
        WHERE l.branch_transfer_id = $1::bigint
        ORDER BY l.line_number`,
      [id],
    );
    const movements = await this.db.query<any>(
      `SELECT m.move_type AS "moveType", m.move_date AS "moveDate", m.quantity,
              m.unit_cost AS "unitCost", m.reference_no AS "referenceNo",
              m.warehouse_id AS "warehouseId", w.name AS "warehouseName", m.branch_id AS "branchId"
         FROM stock_movements m
         LEFT JOIN warehouses w ON w.warehouse_id = m.warehouse_id
        WHERE (m.reference_id = $1::bigint AND m.reference_no LIKE 'BT-%')
        ORDER BY m.stock_movement_id`,
      [id],
    );
    return { ...row, lines, statusName: STATUS[Number(row.status)] ?? '—', movements };
  }

  /** Creates a draft transfer (current branch = the SOURCE branch). */
  async create(dto: any, user: AuthUser, branchId: number) {
    const fromWarehouseId = Number(dto.fromWarehouseId);
    const toWarehouseId = Number(dto.toWarehouseId);
    const clientRequestId = String(dto.clientRequestId ?? '').trim();
    if (!fromWarehouseId || !toWarehouseId) {
      throw new BadRequestException('حدد مخزن المصدر ومخزن الوجهة');
    }
    if (fromWarehouseId === toWarehouseId) {
      throw new BadRequestException('مخزن المصدر والوجهة لا يمكن أن يكونا المخزن نفسه');
    }
    if (!clientRequestId) {
      throw new BadRequestException('clientRequestId مطلوب — لا يمكن إنشاء تحويل بين فروع بدون مفتاح منع التكرار');
    }

    // idempotency — same clientRequestId returns the original document
    const existing = await this.db.one<any>(
      'SELECT branch_transfer_id, transfer_no FROM branch_transfers WHERE client_request_id = $1',
      [clientRequestId],
    );
    if (existing) {
      return { branchTransferId: Number(existing.branch_transfer_id), transferNo: existing.transfer_no, duplicate: true };
    }

    return this.db.transaction(async (client) => {
      const whs = await client.query<any>(
        `SELECT warehouse_id, branch_id FROM warehouses WHERE warehouse_id IN ($1::int,$2::int) AND is_active = true`,
        [fromWarehouseId, toWarehouseId],
      );
      if (whs.rows.length !== 2) throw new BadRequestException('أحد المخزنين غير موجود أو غير نشط');
      const byId = new Map<number, number>(whs.rows.map((r: any) => [Number(r.warehouse_id), Number(r.branch_id)]));
      const fromBranch = byId.get(fromWarehouseId)!;
      const toBranch = byId.get(toWarehouseId)!;
      if (fromBranch !== branchId) {
        throw new ForbiddenException('لا يمكن إنشاء تحويل بين فروع باسم فرع آخر — أنشئه من فرع المصدر');
      }
      if (fromBranch === toBranch) {
        throw new BadRequestException('التحويل بين مخزنين في نفس الفرع — استخدم شاشة «تحويل مخزن» المعتادة');
      }
      // Both branches must be open — we will post journals and movements into both.
      await this.requireBranchOpenAtDate(client, fromBranch, asIsoDate(dto.transferDate) ?? new Date().toISOString().slice(0, 10), 'لا يمكن إنشاء التحويل');
      await this.requireBranchOpenAtDate(client, toBranch, asIsoDate(dto.transferDate) ?? new Date().toISOString().slice(0, 10), 'لا يمكن إنشاء التحويل');

      const serial = await this.db.nextNumber(client, `branchtransfer:${fromBranch}:${toBranch}`);
      const transferNo = `BT-${fromBranch}-${toBranch}-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const inserted = await client.query<{ branch_transfer_id: number }>(
        `INSERT INTO branch_transfers
           (transfer_no, transfer_date, from_branch_id, to_branch_id, from_warehouse_id, to_warehouse_id,
            status, notes, client_request_id, created_by)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3::int, $4::int, $5::int, $6::int, 1, $7, $8, $9::int)
         RETURNING branch_transfer_id`,
        [transferNo, dto.transferDate ?? null, fromBranch, toBranch, fromWarehouseId, toWarehouseId,
          dto.notes ?? null, clientRequestId, user.userId],
      );
      return { branchTransferId: Number(inserted.rows[0].branch_transfer_id), transferNo, duplicate: false };
    });
  }

  /** Edits a draft header (still draft only, and still both-branches-open). */
  async update(id: number, dto: any, user: AuthUser, branchId: number) {
    const header = await this.draftHeader(id, branchId);
    if (dto.toWarehouseId) {
      const wh = await this.db.one<any>('SELECT warehouse_id, branch_id FROM warehouses WHERE warehouse_id = $1::int AND is_active = true', [Number(dto.toWarehouseId)]);
      if (!wh) throw new BadRequestException('مخزن الوجهة غير موجود أو غير نشط');
      if (Number(wh.branch_id) === Number(header.from_branch_id)) {
        throw new BadRequestException('الوجهة في نفس فرع المصدر — غير مسموح');
      }
    }    await this.db.query(
      `UPDATE branch_transfers SET transfer_date = COALESCE($2::date, transfer_date),
              to_warehouse_id = COALESCE($3::int, to_warehouse_id),
              notes = COALESCE($4, notes)
        WHERE branch_transfer_id = $1::bigint`,
      [id, dto.transferDate ?? null, dto.toWarehouseId ? Number(dto.toWarehouseId) : null, dto.notes ?? null],
    );
    return { branchTransferId: id };
  }

  private async draftHeader(id: number, branchId: number): Promise<HeaderRow> {
    const row = await this.db.one<any>(
      `SELECT * FROM branch_transfers WHERE branch_transfer_id = $1::bigint
         AND (from_branch_id = $2::int OR to_branch_id = $2::int)`,
      [id, branchId],
    );
    if (!row) throw new NotFoundException('سند التحويل غير موجود في هذا الفرع');
    if (Number(row.status) === 4) throw new BadRequestException('التحويل مكتمل — لا يمكن تعديله');
    if (Number(row.status) === 5) throw new BadRequestException('التحويل ملغي');
    if (Number(row.status) !== 1) throw new BadRequestException('لا يمكن تعديل سند بعد اعتماده — استخدم الإلغاء قبل الاستلام فقط');
    return row as HeaderRow;
  }

  /** Adds a line to a draft transfer. Same item + same unit merges quantities. */
  async addLine(id: number, dto: any, branchId: number) {
    if (dto.unitCost != null && Number(dto.unitCost) > 0) {
      throw new BadRequestException('تكلفة السطر تُحدَّد تلقائيًا من متوسط تكلفة مخزن المصدر — لا تقبل تكلفة يدوية');
    }
    const header = await this.draftHeader(id, branchId);
    const itemId = Number(dto.itemId);
    if (!itemId) throw new BadRequestException('حدد الصنف');
    const quantity = Number(dto.quantity ?? 0);
    if (quantity <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');

    return this.db.transaction(async (client) => {
      const item = await client.query<any>(
        'SELECT item_id, base_unit_id, cost_price, name FROM items WHERE item_id = $1::int AND is_active = true',
        [itemId],
      );
      if (!item.rows.length) throw new BadRequestException('الصنف غير موجود');
      const baseUnitId = Number(item.rows[0].base_unit_id);
      const unitId = dto.unitId ? Number(dto.unitId) : baseUnitId;
      const qtyBase = await toBaseUnits(client, itemId, unitId, quantity);

      const existing = await client.query<any>(
        `SELECT line_id, quantity, unit_id FROM branch_transfer_lines
          WHERE branch_transfer_id = $1::bigint AND item_id = $2::int AND unit_id = $3::int
          FOR UPDATE`,
        [id, itemId, unitId],
      );
      if (existing.rows.length) {
        const line = existing.rows[0];
        const newQty = round6(Number(line.quantity) + qtyBase);
        await client.query('UPDATE branch_transfer_lines SET quantity = $2::numeric WHERE line_id = $1::bigint',
          [line.line_id, newQty]);
        await client.query('UPDATE branch_transfers SET total_value = (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint) WHERE branch_transfer_id = $1::bigint', [id]);
        return { added: true, merged: true, quantity: newQty };
      }

      const lineNo = await client.query<{ n: number }>(
        'SELECT COALESCE(MAX(line_number), 0) + 1 AS n FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint',
        [id],
      );
      const unitCost = (await getWarehouseCost(client, itemId, Number(header.from_warehouse_id))) || Number(item.rows[0].cost_price ?? 0);
      await client.query(
        `INSERT INTO branch_transfer_lines
           (branch_transfer_id, line_number, item_id, unit_id, quantity, unit_cost, serial_no, expiry_date, notes)
         VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
        [id, Number(lineNo.rows[0].n), itemId, unitId, qtyBase, round2(unitCost),
          dto.serialNo ?? null, dto.expiryDate ?? null, dto.notes ?? null],
      );
      await client.query(
        'UPDATE branch_transfers SET total_value = (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint) WHERE branch_transfer_id = $1::bigint',
        [id],
      );
      return { added: true, merged: false, quantity: qtyBase };
    });
  }

  /** Edits a line quantity (draft only). */
  async updateLine(id: number, lineId: number, dto: any, branchId: number) {
    if (dto.unitCost != null && Number(dto.unitCost) > 0) {
      throw new BadRequestException('لا تقبل تكلفة يدوية — التكلفة دائمًا من متوسط مخزن المصدر');
    }
    await this.draftHeader(id, branchId);
    return this.db.transaction(async (client) => {
      const line = await client.query<any>(
        'SELECT * FROM branch_transfer_lines WHERE line_id = $1::bigint AND branch_transfer_id = $2::bigint',
        [lineId, id],
      );
      if (!line.rows.length) throw new BadRequestException('السطر غير موجود');
      const quantity = Number(dto.quantity ?? line.rows[0].quantity);
      if (quantity <= 0) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
      await client.query(
        'UPDATE branch_transfer_lines SET quantity = $2::numeric, notes = COALESCE($3, notes) WHERE line_id = $1::bigint',
        [lineId, quantity, dto.notes ?? null],
      );
      await client.query(
        'UPDATE branch_transfers SET total_value = (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint) WHERE branch_transfer_id = $1::bigint',
        [id],
      );
      return { lineId, quantity };
    });
  }

  /** Removes a line (draft only). */
  async removeLine(id: number, lineId: number, branchId: number) {
    await assertDeletionAllowed(this.db, 'branchTransfers');
    await this.draftHeader(id, branchId);
    await this.db.query(
      'DELETE FROM branch_transfer_lines WHERE line_id = $1::bigint AND branch_transfer_id = $2::bigint',
      [lineId, id],
    );
    await this.db.query(
      'UPDATE branch_transfers SET total_value = (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint) WHERE branch_transfer_id = $1::bigint',
      [id],
    );
    return { lineId, deleted: true };
  }

  /**
   * Issues the transfer from its SOURCE branch: outbound voucher → ledger →
   * journal Dr 1108 / Cr 1104 in the SOURCE branch → status 2.
   * Both branches must be open (receive is refused while the destination is locked too).
   */
  async approve(id: number, user: AuthUser, branchId: number) {
    if (!user.permissions?.includes('transfer.interbranch.manage')) {
      throw new ForbiddenException('اعتماد التحويل بين الفروع يتطلب صلاحية transfer.interbranch.manage');
    }
    return this.db.transaction(async (client) => {
      const transfer = await client.query<HeaderRow>(
        `SELECT * FROM branch_transfers WHERE branch_transfer_id = $1::bigint
           AND (from_branch_id = $2::int OR to_branch_id = $2::int) FOR UPDATE`,
        [id, branchId],
      );
      if (!transfer.rows.length) throw new NotFoundException('سند التحويل غير موجود في هذا الفرع');
      const t = transfer.rows[0];
      if (Number(t.status) !== 1) {
        throw new BadRequestException('لا يمكن اعتماد سند غير مسودة — العملية سبق تنفيذها');
      }
      if (Number(t.from_branch_id) !== branchId) {
        throw new ForbiddenException('الاعتماد يتم في فرع المصدر — بدّل الفرع الحالي');
      }
      const date = asIsoDate(t.transfer_date) ?? new Date().toISOString().slice(0, 10);
      // Both branches must be open — receipts into a locked destination are refused too (up-front).
      await this.requireBranchOpenAtDate(client, Number(t.from_branch_id), date, 'لا يمكن اعتماد التحويل');
      await this.requireBranchOpenAtDate(client, Number(t.to_branch_id), date, 'لا يمكن اعتماد التحويل — فرع الوجهة مقفول');

      const lines = await client.query<any>(
        'SELECT * FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد بنود على التحويل');

      const outSerial = await this.db.nextNumber(client, `stockvoucher:${Number(t.from_branch_id)}`);
      const outNo = `SV-${new Date().getFullYear()}-${String(outSerial).padStart(6, '0')}`;
      const outVoucher = await client.query<{ stock_voucher_id: number }>(
        `INSERT INTO stock_vouchers
           (voucher_no, voucher_date, branch_id, warehouse_id, voucher_type, status, notes, created_by)
         VALUES ($1, $2::date, $3::int, $4::int, 2, 2, $5, $6::int)
         RETURNING stock_voucher_id`,
        [outNo, date, Number(t.from_branch_id), Number(t.from_warehouse_id),
          `تحويل بين فروع ${t.transfer_no} — خارج`, user.userId],
      );
      const outVoucherId = Number(outVoucher.rows[0].stock_voucher_id);

      let netValue = 0;
      const journalLines: any[] = [];
      const invt = await this.requireMappingId(client, 'INVENTORY', 'المخزون');
      const clearing = await this.requireMappingId(client, 'BRANCH_TRANSFER_CLEARING', 'مخزون بين الفروع — حساب وسيط');

      for (const line of lines.rows) {
        const qtyBase = round6(Number(line.quantity));
        const unitCost = Number(line.unit_cost ?? 0);
        const value = round2(qtyBase * unitCost);
        netValue = round2(netValue + value);

        await client.query(
          `INSERT INTO stock_voucher_lines
             (stock_voucher_id, line_number, item_id, unit_id, quantity, unit_cost, serial_no, expiry_date, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
          [outVoucherId, line.line_number, line.item_id, line.unit_id, qtyBase,
            round2(unitCost), line.serial_no, line.expiry_date, line.notes],
        );

        await applyMovement(client, {
          branchId: Number(t.from_branch_id),
          warehouseId: Number(t.from_warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: 'transferOut',
          quantity: qtyBase,
          unitCost,
          referenceType: 2,
          referenceId: id,
          referenceNo: t.transfer_no,
          userId: user.userId,
          notes: `تحويل بين فروع ${t.transfer_no} — خارج`,
        });

        journalLines.push(
          { accountId: clearing, debit: value, description: 'تحويل بين فروع — المخزون في الطريق' },
          { accountId: invt, credit: value, description: 'تحويل بين فروع — صادر من المصدر' },
        );
      }

      const journalId = await postJournal(client, {
        branchId: Number(t.from_branch_id),
        journalType: 8,
        journalDate: date,
        description: `تحويل بين فروع ${t.transfer_no} — صادر`,
        sourceType: 'branch_transfer',
        sourceId: id,
        lines: journalLines,
        userId: user.userId,
        autoBalance: true,
      });

      await client.query(
        `UPDATE branch_transfers
            SET status = 2, outbound_voucher_id = $2::bigint, outbound_journal_id = $3::bigint,
                approved_by = $4::int, approved_at = now(), total_value = $5::numeric
          WHERE branch_transfer_id = $1::bigint`,
        [id, outVoucherId, journalId, user.userId, netValue],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.branch_transfer.approve','branch_transfer',$3::bigint,$4)`,
        [user.userId, Number(t.from_branch_id), id,
          `اعتماد تحويل بين فروع ${t.transfer_no} إلى فرع ${t.to_branch_id}`],
      );
      return { branchTransferId: id, status: 2, outboundVoucherId: outVoucherId, journalId, totalValue: netValue };
    });
  }

  /**
   * Receives the transfer at the DESTINATION branch: inbound voucher → ledger →
   * journal Dr 1104 / Cr 1108 in the DESTINATION branch (same cost) → status 4.
   */
  async receive(id: number, user: AuthUser, branchId: number) {
    if (!user.permissions?.includes('transfer.interbranch.manage')) {
      throw new ForbiddenException('استلام التحويل بين الفروع يتطلب صلاحية transfer.interbranch.manage');
    }
    return this.db.transaction(async (client) => {
      const transfer = await client.query<HeaderRow>(
        `SELECT * FROM branch_transfers WHERE branch_transfer_id = $1::bigint
           AND (from_branch_id = $2::int OR to_branch_id = $2::int) FOR UPDATE`,
        [id, branchId],
      );
      if (!transfer.rows.length) throw new NotFoundException('سند التحويل غير موجود في هذا الفرع');
      const t = transfer.rows[0];
      if (Number(t.status) !== 2) {
        throw new BadRequestException('يمكن الاستلام فقط بعد اعتماد الإرسال — المستند غير جاهز للاستلام');
      }
      if (Number(t.to_branch_id) !== branchId) {
        throw new ForbiddenException('الاستلام يتم في فرع الوجهة — بدّل الفرع الحالي');
      }
      const date = asIsoDate(t.transfer_date) ?? new Date().toISOString().slice(0, 10);
      await this.requireBranchOpenAtDate(client, Number(t.to_branch_id), date, 'لا يمكن استلام التحويل — فرع الوجهة مقفول');
      await this.requireBranchOpenAtDate(client, Number(t.from_branch_id), date, 'لا يمكن استلام التحويل — فرع المصدر مقفول');

      const lines = await client.query<any>(
        'SELECT * FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint ORDER BY line_number',
        [id],
      );
      if (!lines.rows.length) throw new BadRequestException('لا توجد بنود على التحويل');

      const inSerial = await this.db.nextNumber(client, `stockvoucher:${Number(t.to_branch_id)}`);
      const inNo = `SV-${new Date().getFullYear()}-${String(inSerial).padStart(6, '0')}`;
      const inVoucher = await client.query<{ stock_voucher_id: number }>(
        `INSERT INTO stock_vouchers
           (voucher_no, voucher_date, branch_id, warehouse_id, voucher_type, status, notes, created_by)
         VALUES ($1, $2::date, $3::int, $4::int, 1, 2, $5, $6::int)
         RETURNING stock_voucher_id`,
        [inNo, date, Number(t.to_branch_id), Number(t.to_warehouse_id),
          `تحويل بين فروع ${t.transfer_no} — وارد`, user.userId],
      );
      const inVoucherId = Number(inVoucher.rows[0].stock_voucher_id);

      let netValue = 0;
      const journalLines: any[] = [];
      const invt = await this.requireMappingId(client, 'INVENTORY', 'المخزون');
      const clearing = await this.requireMappingId(client, 'BRANCH_TRANSFER_CLEARING', 'مخزون بين الفروع — حساب وسيط');

      for (const line of lines.rows) {
        const qtyBase = round6(Number(line.quantity));
        const unitCost = Number(line.unit_cost ?? 0);   // EXACT same cost as issued — no re-valuation
        const value = round2(qtyBase * unitCost);
        netValue = round2(netValue + value);

        await client.query(
          `INSERT INTO stock_voucher_lines
             (stock_voucher_id, line_number, item_id, unit_id, quantity, unit_cost, serial_no, expiry_date, notes)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::text,$8::date,$9::text)`,
          [inVoucherId, line.line_number, line.item_id, line.unit_id, qtyBase,
            round2(unitCost), line.serial_no, line.expiry_date, line.notes],
        );

        await applyMovement(client, {
          branchId: Number(t.to_branch_id),
          warehouseId: Number(t.to_warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: 'transferIn',
          quantity: qtyBase,
          unitCost,
          referenceType: 2,
          referenceId: id,
          referenceNo: t.transfer_no,
          userId: user.userId,
          notes: `تحويل بين فروع ${t.transfer_no} — وارد`,
        });

        journalLines.push(
          { accountId: invt, debit: value, description: 'تحويل بين فروع — وارد إلى الوجهة' },
          { accountId: clearing, credit: value, description: 'تحويل بين فروع — إقفال المخزون في الطريق' },
        );
      }

      const journalId = await postJournal(client, {
        branchId: Number(t.to_branch_id),
        journalType: 8,
        journalDate: date,
        description: `تحويل بين فروع ${t.transfer_no} — وارد`,
        sourceType: 'branch_transfer',
        sourceId: id,
        lines: journalLines,
        userId: user.userId,
        autoBalance: true,
      });

      await client.query(
        `UPDATE branch_transfers
            SET status = 4, inbound_voucher_id = $2::bigint, inbound_journal_id = $3::bigint,
                received_at = now(), total_value = $4::numeric
          WHERE branch_transfer_id = $1::bigint`,
        [id, inVoucherId, journalId, netValue],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.branch_transfer.receive','branch_transfer',$3::bigint,$4)`,
        [user.userId, Number(t.to_branch_id), id,
          `استلام تحويل بين فروع ${t.transfer_no} واصلًا من فرع ${t.from_branch_id}`],
      );
      return { branchTransferId: id, status: 4, inboundVoucherId: inVoucherId, journalId, totalValue: netValue };
    });
  }

  /**
   * Cancels an ISSUED (not yet received) transfer: reverses the outbound voucher,
   * the ledger movement and the issue journal — atomically. Status 4 is NOT
   * cancelable from here (integrated reversal workflow is out of scope).
   */
  async cancel(id: number, dto: any, user: AuthUser, branchId: number) {
    if (!user.permissions?.includes('transfer.interbranch.cancel')) {
      throw new ForbiddenException('إلغاء التحويل بين الفروع يتطلب صلاحية transfer.interbranch.cancel');
    }
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب الإلغاء إلزامي — اذكر السبب (مثل: خطأ في الكمية)');
    return this.db.transaction(async (client) => {
      const transfer = await client.query<HeaderRow>(
        `SELECT * FROM branch_transfers WHERE branch_transfer_id = $1::bigint
           AND (from_branch_id = $2::int OR to_branch_id = $2::int) FOR UPDATE`,
        [id, branchId],
      );
      if (!transfer.rows.length) throw new NotFoundException('سند التحويل غير موجود في هذا الفرع');
      const t = transfer.rows[0];
      if (Number(t.status) === 4) {
        throw new BadRequestException('لا يمكن إلغاء تحويل مكتمل — يلزم مستند عكس متكامل (غير متاح في هذه النسخة)');
      }
      if (Number(t.status) === 1) {
        throw new BadRequestException('المستند مسودة — استخدم حذف المسودة بدل الإلغاء');
      }
      if (Number(t.status) !== 2) {
        throw new BadRequestException('لا يمكن إلغاء هذا السند في حالته الحالية');
      }
      const date = asIsoDate(t.transfer_date) ?? new Date().toISOString().slice(0, 10);
      await this.requireBranchOpenAtDate(client, Number(t.from_branch_id), date, 'لا يمكن الإلغاء — فرع المصدر مقفول');
      await this.requireBranchOpenAtDate(client, Number(t.to_branch_id), date, 'لا يمكن الإلغاء — فرع الوجهة مقفول');

      const lines = await client.query<any>(
        'SELECT * FROM branch_transfer_lines WHERE branch_transfer_id = $1::bigint ORDER BY line_number',
        [id],
      );

      // Reverse the ledger movement: goods return to the source warehouse, same cost.
      for (const line of lines.rows) {
        await applyMovement(client, {
          branchId: Number(t.from_branch_id),
          warehouseId: Number(t.from_warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: 'transferIn',
          quantity: round6(Number(line.quantity)),
          unitCost: Number(line.unit_cost ?? 0),
          referenceType: 2,
          referenceId: id,
          referenceNo: t.transfer_no,
          userId: user.userId,
          notes: `إلغاء تحويل بين فروع ${t.transfer_no}`,
        });
      }

      // Reverse the issue journal: Dr 1104 / Cr 1108 in the SOURCE branch.
      const invt = await this.requireMappingId(client, 'INVENTORY', 'المخزون');
      const clearing = await this.requireMappingId(client, 'BRANCH_TRANSFER_CLEARING', 'مخزون بين الفروع — حساب وسيط');
      const journalLines: any[] = [];
      let netValue = 0;
      for (const line of lines.rows) {
        const value = round2(round6(Number(line.quantity)) * Number(line.unit_cost ?? 0));
        netValue = round2(netValue + value);
        journalLines.push(
          { accountId: invt, debit: value, description: 'إلغاء تحويل — رد المخزون للمصدر' },
          { accountId: clearing, credit: value, description: 'إلغاء تحويل — إبطال المخزون في الطريق' },
        );
      }
      const journalId = await postJournal(client, {
        branchId: Number(t.from_branch_id),
        journalType: 8,
        journalDate: date,
        description: `إلغاء تحويل بين فروع ${t.transfer_no}`,
        sourceType: 'branch_transfer_cancel',
        sourceId: id,
        lines: journalLines,
        userId: user.userId,
        autoBalance: true,
      });

      await client.query(
        `UPDATE branch_transfers
            SET status = 5, cancelled_by = $2::int, cancelled_at = now(), cancel_reason = $3
          WHERE branch_transfer_id = $1::bigint`,
        [id, user.userId, reason],
      );

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,'stock.branch_transfer.cancel','branch_transfer',$3::bigint,$4)`,
        [user.userId, Number(t.from_branch_id), id,
          `إلغاء تحويل بين فروع ${t.transfer_no} — ${reason}`],
      );
      return { branchTransferId: id, status: 5, journalId, cancelled: true };
    });
  }

  /** Deletes a draft transfer. Approved/received ones cannot be deleted. */
  async remove(id: number, branchId: number) {
    await assertDeletionAllowed(this.db, 'branchTransfers');
    const header = await this.draftHeader(id, branchId);
    if (Number(header.status) !== 1) throw new BadRequestException('لا يمكن حذف سند بعد اعتماده');
    await this.db.query('DELETE FROM branch_transfers WHERE branch_transfer_id = $1::bigint', [id]);
    return { branchTransferId: id, deleted: true };
  }

  private async requireMappingId(client: PoolClient, key: string, label: string): Promise<number> {
    const { rows } = await client.query<any>('SELECT account_id FROM gl_mappings WHERE mapping_key = $1', [key]);
    if (!rows.length) throw new BadRequestException(`الربط المحاسبي «${label}» (${key}) غير موجود — راجع gl_mappings`);
    return Number(rows[0].account_id);
  }
}

@Controller('branch-transfers')
export class BranchTransferController {
  constructor(private readonly service: BranchTransferService) {}

  @RequirePermissions('transfer.interbranch.view')
  @Get()
  list(@CurrentBranch() branchId: number, @Query('status') status?: string, @Query('from') from?: string,
       @Query('to') to?: string, @Query('search') search?: string, @Query('limit') limit?: string) {
    return this.service.list({
      branchId, status: status ? Number(status) : undefined, fromBranchId: undefined, toBranchId: undefined,
      from: from || undefined, to: to || undefined, search: search || undefined,
      limit: Math.min(Math.max(limit ? Number(limit) : 100, 1), 500),
    });
  }

  @RequirePermissions('transfer.interbranch.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.findOne(id, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Post()
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto ?? {}, user, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.update(id, dto ?? {}, user, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Post(':id/lines')
  addLine(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.addLine(id, dto ?? {}, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Put(':id/lines/:lineId')
  updateLine(@Param('id', ParseIntPipe) id: number, @Param('lineId', ParseIntPipe) lineId: number,
             @Body() dto: any, @CurrentBranch() branchId: number) {
    return this.service.updateLine(id, lineId, dto ?? {}, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Delete(':id/lines/:lineId')
  removeLine(@Param('id', ParseIntPipe) id: number, @Param('lineId', ParseIntPipe) lineId: number, @CurrentBranch() branchId: number) {
    return this.service.removeLine(id, lineId, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Post(':id/approve')
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.approve(id, user, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Post(':id/receive')
  receive(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.receive(id, user, branchId);
  }

  @RequirePermissions('transfer.interbranch.cancel')
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.cancel(id, dto ?? {}, user, branchId);
  }

  @RequirePermissions('transfer.interbranch.manage')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.remove(id, branchId);
  }
}
