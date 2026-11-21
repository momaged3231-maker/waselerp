import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  Param, ParseIntPipe, Post, Query, ForbiddenException, Req, Res,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { applyMovement, toBaseUnits } from '../../common/stock';
import { assertPeriodOpen, postJournal, resolveMapping, reverseJournal } from '../../common/posting';
import { asIsoDate } from '../../common/dates';
import { logActivity } from '../../common/audit';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const round6 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 1e6) / 1e6;

/**
 * Phase-2 B1 — Goods Receipt Note (محضر استلام البضاعة) from a purchase order.
 *
 * B1 ADDS a new path — it does NOT touch invoice type 2 (that is B2/TD-27).
 * On posting, each ACCEPTED line:
 *   - applyMovement('purchase') → stock_movements + item_warehouse_qty (IN)
 *   - journal line  Dr INVENTORY (1104)
 * The total of accepted values posts as one balanced journal:
 *   - Cr GRNI (2107), with party (supplier) + branch dimension at gl_entries level.
 * Rejected/damaged/missing quantities are memo-only (no stock, no value).
 */
@Injectable()
export class PurchaseReceiptService {
  constructor(private readonly db: DatabaseService) {}

  /** per-type, per-branch, per-year sequence using document_sequences (OI-15). */
  private async nextReceiptNo(client: PoolClient, branchId: number, date: string): Promise<string> {
    const year = Number(date.slice(0, 4));
    const seq = await client.query<{ last_seq: number }>(
      `INSERT INTO document_sequences (doc_type, branch_id, year, last_seq)
       VALUES ('grn', $1::int, $2::smallint, 1)
       ON CONFLICT (doc_type, branch_id, year)
       DO UPDATE SET last_seq = document_sequences.last_seq + 1
       RETURNING last_seq`,
      [branchId, year],
    );
    return `GRN-${branchId}-${year}-${String(seq.rows[0].last_seq).padStart(6, '0')}`;
  }

  async list(params: { branchId: number; status?: number; orderId?: number; from?: string; to?: string; limit: number }) {
    return this.db.query<any>(
      `SELECT r.receipt_id AS "receiptId", r.receipt_no AS "receiptNo",
              r.receipt_date AS "receiptDate", r.created_at AS "createdAt", r.branch_id AS "branchId",
              r.warehouse_id AS "warehouseId", w.name AS "warehouseName",
              r.order_id AS "orderId", o.order_no AS "orderNo",
              r.party_id AS "partyId", p.name AS "partyName",
              r.status, r.posting_status AS "postingStatus",
              r.received_by AS "receivedBy", r.inspected_by AS "inspectedBy",
              r.external_inspector_name AS "externalInspectorName",
              r.gl_journal_id AS "glJournalId", r.notes,
              u.full_name AS "createdBy",
              (SELECT count(*)::int FROM purchase_receipt_lines l WHERE l.receipt_id = r.receipt_id) AS "lineCount"
         FROM purchase_receipts r
         LEFT JOIN warehouses w ON w.warehouse_id = r.warehouse_id
         LEFT JOIN orders o ON o.order_id = r.order_id
         LEFT JOIN parties p ON p.party_id = r.party_id
         LEFT JOIN users u ON u.user_id = r.created_by
        WHERE ($1::int = 0 OR r.branch_id = $1::int)
          AND ($2::int = 0 OR r.status = $2::int)
          AND ($3::bigint = 0 OR r.order_id = $3::bigint)
          AND ($4::date IS NULL OR r.receipt_date >= $4::date)
          AND ($5::date IS NULL OR r.receipt_date <= $5::date)
        ORDER BY r.receipt_date DESC, r.receipt_id DESC
        LIMIT $6::int`,
      [params.branchId, params.status ?? 0, params.orderId ?? 0, params.from ?? null, params.to ?? null, params.limit],
    );
  }

  async findOne(id: number) {
    const header = await this.db.one<any>(
      `SELECT r.receipt_id AS "receiptId", r.receipt_no AS "receiptNo",
              r.receipt_date AS "receiptDate", r.created_at AS "createdAt", r.branch_id AS "branchId",
              r.warehouse_id AS "warehouseId", r.order_id AS "orderId",
              r.party_id AS "partyId", r.status, r.posting_status AS "postingStatus",
              r.received_by AS "receivedBy", r.inspected_by AS "inspectedBy",
              r.external_inspector_name AS "externalInspectorName",
              r.gl_journal_id AS "glJournalId", r.notes
         FROM purchase_receipts r WHERE r.receipt_id = $1::bigint`,
      [id],
    );
    if (!header) throw new BadRequestException('محضر الاستلام غير موجود');
    const lines = await this.db.query<any>(
      `SELECT l.line_id AS "lineId", l.line_no AS "lineNo",
              l.order_line_id AS "orderLineId", l.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              l.unit_id AS "unitId", un.name AS "unitName",
              l.ordered_qty AS "orderedQty", l.received_qty AS "receivedQty",
              l.accepted_qty AS "acceptedQty", l.rejected_qty AS "rejectedQty",
              l.damaged_qty AS "damagedQty", l.missing_qty AS "missingQty",
              l.unit_cost AS "unitCost", l.cost_value AS "costValue", l.reason,
              l.inspected_by AS "inspectedBy", l.inspected_at AS "inspectedAt"
         FROM purchase_receipt_lines l
         JOIN items i ON i.item_id = l.item_id
         LEFT JOIN units un ON un.unit_id = l.unit_id
        WHERE l.receipt_id = $1::bigint ORDER BY l.line_no`,
      [id],
    );
    const rejections = await this.db.query<any>(
      `SELECT x.rejection_id AS "rejectionId", x.line_id AS "lineId",
              x.rejected_qty AS "rejectedQty", x.reason, x.decision,
              x.decided_by AS "decidedBy", x.decided_at AS "decidedAt", x.notes
         FROM purchase_rejections x
         JOIN purchase_receipt_lines l ON l.line_id = x.line_id
        WHERE l.receipt_id = $1::bigint ORDER BY x.rejection_id`,
      [id],
    );
    return { header, lines, rejections };
  }

  /**
   * Creates and posts a GRN from a purchase order. All writes in ONE transaction.
   */
  async create(dto: any, user: AuthUser, branchId: number, ip: string) {
    const orderId = Number(dto.orderId ?? 0);
    if (!orderId) throw new BadRequestException('أمر الشراء مطلوب');
    const warehouseId = Number(dto.warehouseId ?? 0);
    if (!warehouseId) throw new BadRequestException('المخزن مطلوب');

    const receivedBy = dto.receivedBy ? Number(dto.receivedBy) : Number(user.userId);
    const inspectedBy = dto.inspectedBy ? Number(dto.inspectedBy) : 0;
    if (!receivedBy) throw new BadRequestException('موظف الاستلام (receivedBy) مطلوب');
    if (!inspectedBy) throw new BadRequestException('المفتش (inspectedBy) مطلوب — لا يمكن استلام بضاعة بلا فحص');

    const incoming = Array.isArray(dto.lines) ? dto.lines : [];
    if (!incoming.length) throw new BadRequestException('أضف سطرًا واحدًا على الأقل');

    const reason = String(dto.reason ?? '').trim();
    const wantsOverReceipt = incoming.some((l: any) => Number(l.acceptedQty ?? l.receivedQty ?? 0) > 0);
    // GAP-06: idempotency key (null/undefined/empty => no dedupe).
    const clientRequestId = String(dto.clientRequestId ?? '').trim() || null;
    // Fast path: retry after committed request — short-circuit before validations
    // that depend on state mutated by the original (e.g. PO delivered_qty).
    if (clientRequestId) {
      const existing = await this.db.one<any>(
        `SELECT receipt_id AS "receiptId", receipt_no AS "receiptNo",
                posting_status AS "postingStatus", gl_journal_id AS "journalId"
           FROM purchase_receipts WHERE client_request_id = $1`,
        [clientRequestId],
      );
      if (existing) return { ...existing, duplicate: true };
    }

    try {
      return await this.db.transaction(async (client) => {
      // 1) PO header — must be purchase order, confirmed/partial, same branch.
      const po = await client.query<any>(
        `SELECT o.order_id, o.branch_id, o.party_id, o.warehouse_id, o.status, o.order_type
           FROM orders o WHERE o.order_id = $1::bigint FOR UPDATE`,
        [orderId],
      );
      if (!po.rows.length) throw new BadRequestException('أمر الشراء غير موجود');
      const poRow = po.rows[0];
      if (Number(poRow.order_type) !== 2) throw new BadRequestException('الأمر ليس أمر شراء');
      if (Number(poRow.branch_id) !== Number(branchId)) {
        throw new BadRequestException('أمر الشراء يخص فرعًا آخر');
      }
      // A GRN always adds to a supplier liability (GRNI with party dimension).
      // A purchase order without a supplier has no valid AP/GRNI counterpart — reject it.
      if (poRow.party_id == null || Number(poRow.party_id) === 0) {
        throw new BadRequestException('أمر الشراء ليس له مورد — لا يمكن استلام بضاعة بلا مورد (GRNI يحتاج بُعد المورد)');
      }
      const poStatus = Number(poRow.status);
      if (poStatus !== 2 && poStatus !== 3) {
        throw new BadRequestException('يمكن الاستلام من أمر مؤكد أو مُسلَّم جزئيًا فقط');
      }
      // Warehouse must belong to receiving branch.
      const wh = await client.query<any>(
        'SELECT branch_id FROM warehouses WHERE warehouse_id = $1::int AND is_active = true',
        [warehouseId],
      );
      if (!wh.rows.length || Number(wh.rows[0].branch_id) !== Number(branchId)) {
        throw new BadRequestException('المخزن لا يتبع الفرع الحالي');
      }

      // Supplier over-receipt policy.
      let overPct = 0;
      if (poRow.party_id) {
        const party = await client.query<any>(
          'SELECT default_over_receipt_pct FROM parties WHERE party_id = $1::int',
          [poRow.party_id],
        );
        overPct = Number(party.rows[0]?.default_over_receipt_pct ?? 0);
      }

      const receiptDate = asIsoDate(dto.receiptDate ?? new Date().toISOString().slice(0, 10));
      const periodId = await assertPeriodOpen(client, branchId, receiptDate);

      // 2) Validate quantities against each order line (with already-received).
      const poLines = await client.query<any>(
        `SELECT l.order_line_id, l.line_number, l.item_id, l.unit_id, l.quantity, l.delivered_qty, l.unit_price
           FROM order_lines l WHERE l.order_id = $1::bigint ORDER BY l.line_number`,
        [orderId],
      );
      const byLine = new Map<number, any>();
      for (const l of poLines.rows) byLine.set(Number(l.order_line_id), l);

      const prepared: any[] = [];
      for (const l of incoming) {
        const orderLineId = Number(l.orderLineId ?? 0);
        const poLine = byLine.get(orderLineId);
        if (!poLine) throw new BadRequestException(`سطر الأمر رقم ${orderLineId} غير موجود`);
        const accepted = round6(Number(l.acceptedQty ?? 0));
        const rejected = round6(Number(l.rejectedQty ?? 0));
        const damaged = round6(Number(l.damagedQty ?? 0));
        const missing = round6(Number(l.missingQty ?? 0));
        if (accepted < 0 || rejected < 0 || damaged < 0 || missing < 0) {
          throw new BadRequestException('الكميات لا تكون سالبة');
        }
        const receivedTotal = round6(accepted + rejected + damaged + missing);
        if (receivedTotal <= 0) throw new BadRequestException('أدخل كمية مستلمة واحدة على الأقل');

        const ordered = round6(Number(poLine.quantity));
        const already = round6(Number(poLine.delivered_qty ?? 0));
        const remaining = round6(ordered - already);
        const tolerance = round6(ordered * overPct / 100);
        const allowedMax = round6(remaining + tolerance);

        if (receivedTotal > allowedMax + 1e-6) {
          if (!user.permissions.includes('purchases.approve_exception') || !reason) {
            throw new BadRequestException(
              `الكمية المستلمة (${receivedTotal}) تتجاوز المتبقي من أمر الشراء (${remaining}) — تجاوز الاستلام يحتاج صلاحية purchases.approve_exception وسببًا إلزاميًا`,
            );
          }
        }

        const unitPrice = Number(l.unitCost ?? poLine.unit_price ?? 0);
        const baseQty = await toBaseUnits(client, Number(poLine.item_id), Number(poLine.unit_id ?? l.unitId ?? poLine.unit_id), accepted);
        prepared.push({
          orderLineId, lineNo: Number(poLine.line_number), itemId: Number(poLine.item_id),
          unitId: Number(l.unitId ?? poLine.unit_id), orderedQty: ordered,
          accepted, rejected, damaged, missing, unitCost: round2(unitPrice),
          baseQty: round6(baseQty), reason: l.reason ?? null,
          serialNo: l.serialNo ?? null, expiryDate: l.expiryDate ?? null,
        });
      }

      // 3) Insert receipt header.
      const receiptNo = await this.nextReceiptNo(client, branchId, receiptDate);
      const inserted = await client.query<{ receipt_id: number }>(
        `INSERT INTO purchase_receipts
           (receipt_no, branch_id, warehouse_id, order_id, party_id, receipt_date,
            status, received_by, inspected_by, external_inspector_name, inspected_at,
            notes, created_by, posting_status, client_request_id)
         VALUES ($1,$2::int,$3::int,$4::bigint,$5::int,$6::date,1,$7::int,$8::int,$9,$10,
                 $11,$12::int,1,$13)
         RETURNING receipt_id`,
        [receiptNo, branchId, warehouseId, orderId, poRow.party_id ?? null, receiptDate,
          receivedBy, inspectedBy, dto.externalInspectorName ?? null, new Date().toISOString(),
          dto.notes ?? null, user.userId, clientRequestId],
      );
      const receiptId = Number(inserted.rows[0].receipt_id);

      // 4) Insert lines + rejections + apply movements, collect journal lines.
      const journalLines: any[] = [];
      let totalValue = 0;
      const inventoryId = await this.resolveMappingId(client, 'INVENTORY');
      const grniId = await this.resolveMappingId(client, 'GRNI');

      for (const line of prepared) {
        await client.query(
          `INSERT INTO purchase_receipt_lines
             (receipt_id, line_no, order_line_id, item_id, unit_id, ordered_qty,
              received_qty, accepted_qty, rejected_qty, missing_qty, damaged_qty,
              unit_cost, reason, inspected_by, inspected_at)
           VALUES ($1::bigint,$2::int,$3::bigint,$4::int,$5::int,$6::numeric,
                   $7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric,
                   $12::numeric,$13,$14::int,$15)`,
          [receiptId, line.lineNo, line.orderLineId, line.itemId, line.unitId, line.orderedQty,
            line.receivedTotal ?? round6(line.accepted + line.rejected + line.damaged + line.missing),
            line.accepted, line.rejected, line.missing, line.damaged, line.unitCost,
            line.reason, inspectedBy, new Date().toISOString()],
        );
        const lineIdResult = await client.query<{ line_id: number }>(
          'SELECT line_id FROM purchase_receipt_lines WHERE receipt_id = $1::bigint AND line_no = $2::int',
          [receiptId, line.lineNo],
        );
        const lineId = Number(lineIdResult.rows[0].line_id);

        if (line.rejected > 0) {
          await client.query(
            `INSERT INTO purchase_rejections (line_id, rejected_qty, reason, decision, decided_by, decided_at)
             VALUES ($1::bigint,$2::numeric,$3,6,$4::int,$5)`,
            [lineId, line.rejected, line.reason ?? 'كمية مرفوضة عند الاستلام', inspectedBy, new Date().toISOString()],
          );
        }

        if (line.accepted > 0) {
          const value = round2(line.baseQty * line.unitCost);
          totalValue = round2(totalValue + value);
          await applyMovement(client, {
            branchId,
            warehouseId,
            itemId: line.itemId,
            unitId: line.unitId,
            // baseUnitId must be the item's base unit — applyMovement resolves it
            // when omitted. Passing the purchase unit writes stock under the
            // wrong unit_id, invisible to balances/sales (found in B2 smoke).
            moveType: 'purchase',
            quantity: line.baseQty,
            unitCost: line.unitCost,
            referenceType: 1,
            referenceId: receiptId,
            referenceNo: receiptNo,
            periodId,
            serialNo: line.serialNo,
            expiryDate: line.expiryDate,
            userId: user.userId,
            notes: `استلام ${receiptNo}`,
          });
          journalLines.push({ accountId: inventoryId, debit: value, credit: 0, description: `استلام — ${receiptNo}` });
        }

        // Advance delivered_qty on the PO line by the received total.
        const receivedTotalLine = round6(line.accepted + line.rejected + line.damaged + line.missing);
        await client.query(
          'UPDATE order_lines SET delivered_qty = delivered_qty + $2 WHERE order_line_id = $1::bigint',
          [line.orderLineId, receivedTotalLine],
        );
      }

      // 5) One balanced journal: Dr INVENTORY (per accepted line) / Cr GRNI (total).
      let journalId: number | null = null;
      if (journalLines.length && totalValue > 0) {
        journalLines.push({ accountId: grniId, debit: 0, credit: totalValue, partyId: poRow.party_id ?? null, description: ` GRNI — ${receiptNo}` });
        journalId = await postJournal(client, {
          branchId,
          journalType: 9,
          journalDate: receiptDate,
          description: `محضر استلام ${receiptNo}`,
          sourceType: 'grn',
          sourceId: receiptId,
          lines: journalLines,
          userId: user.userId,
        });
      }

      // 6) Mark posted + link journal.
      await client.query(
        'UPDATE purchase_receipts SET posting_status = 2, gl_journal_id = $2::bigint WHERE receipt_id = $1::bigint',
        [receiptId, journalId],
      );
      await logActivity(client, {
        userId: user.userId,
        branchId,
        action: 'purchases.grn.create',
        entity: 'purchase_receipt',
        entityId: String(receiptId),
        details: `استلام ${receiptNo} — قيمة ${totalValue}`,
        ip,
      });

      return { receiptId, receiptNo, postingStatus: 2, journalId, totalValue, lineCount: prepared.length };
      });
    } catch (err: any) {
      // GAP-06: atomic idempotency — UNIQUE (ux_purchase_receipts_client_request) aborts tx.
      if (clientRequestId && err?.code === '23505' && String(err?.constraint ?? '') === 'ux_purchase_receipts_client_request') {
        const existing = await this.db.one<any>(
          `SELECT receipt_id AS "receiptId", receipt_no AS "receiptNo",
                  posting_status AS "postingStatus", gl_journal_id AS "journalId"
             FROM purchase_receipts WHERE client_request_id = $1`,
          [clientRequestId],
        );
        if (existing) return { ...existing, duplicate: true };
      }
      throw err;
    }
  }

  /** Reverses a posted GRN: mirror journal + reverse stock movements + status=reversed. */
  async reverse(id: number, user: AuthUser, branchId: number, ip: string) {
    return this.db.transaction(async (client) => {
      const r = await client.query<any>(
        'SELECT * FROM purchase_receipts WHERE receipt_id = $1::bigint FOR UPDATE',
        [id],
      );
      if (!r.rows.length) throw new BadRequestException('محضر الاستلام غير موجود');
      const receipt = r.rows[0];
      if (Number(receipt.branch_id) !== Number(branchId)) throw new BadRequestException('محضر الاستلام يخص فرعًا آخر');
      if (Number(receipt.posting_status) !== 2) throw new BadRequestException('يمكن عكس محضر مُرحَّل فقط');
      if (!receipt.gl_journal_id) throw new BadRequestException('لا يوجد قيد مرتبط بمحضر الاستلام');

      // Reverse the journal (mirror).
      await reverseJournal(client, Number(receipt.gl_journal_id), {
        userId: user.userId,
        description: `عكس محضر استلام ${receipt.receipt_no}`,
      });

      // Reverse stock movements for accepted lines.
      const lines = await client.query<any>(
        'SELECT * FROM purchase_receipt_lines WHERE receipt_id = $1::bigint AND accepted_qty > 0 ORDER BY line_no',
        [id],
      );
      for (const line of lines.rows) {
        const baseQty = await toBaseUnits(client, Number(line.item_id), Number(line.unit_id), Number(line.accepted_qty));
        await applyMovement(client, {
          branchId,
          warehouseId: Number(receipt.warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          // baseUnitId omitted — applyMovement resolves the item's real base unit.
          moveType: 'purchaseReturn',
          quantity: baseQty,
          unitCost: Number(line.unit_cost),
          referenceType: 1,
          referenceId: id,
          referenceNo: receipt.receipt_no,
          userId: user.userId,
          notes: `عكس استلام ${receipt.receipt_no}`,
        });
        // Roll back delivered_qty on PO line.
        if (line.order_line_id) {
          await client.query(
            'UPDATE order_lines SET delivered_qty = GREATEST(delivered_qty - $2, 0) WHERE order_line_id = $1::bigint',
            [line.order_line_id, Number(line.accepted_qty)],
          );
        }
      }

      await client.query(
        'UPDATE purchase_receipts SET posting_status = 3 WHERE receipt_id = $1::bigint',
        [id],
      );
      await logActivity(client, {
        userId: user.userId,
        branchId,
        action: 'purchases.grn.reverse',
        entity: 'purchase_receipt',
        entityId: String(id),
        details: `عكس محضر استلام ${receipt.receipt_no}`,
        ip,
      });
      return { receiptId: id, postingStatus: 3, reversed: true };
    });
  }

  private async resolveMappingId(client: PoolClient, key: string): Promise<number> {
    const mapping = await resolveMapping(client, key);
    if (!mapping) throw new BadRequestException(`الربط المحاسبي غير مضبوط: ${key}`);
    return mapping.accountId;
  }
}

@Controller('purchases/receipts')
export class PurchaseReceiptController {
  constructor(private readonly service: PurchaseReceiptService) {}

  @RequirePermissions('purchases.view')
  @Get()
  list(
    @Query('status') status: string,
    @Query('orderId') orderId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.list({
      branchId, status: Number(status) || 0, orderId: Number(orderId) || 0,
      from, to, limit: Math.min(Number(limit) || 100, 500),
    });
  }

  @RequirePermissions('purchases.view')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @RequirePermissions('purchases.receive')
  @Post()
  async create(
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const result = await this.service.create(dto, user, branchId, ip);
    if (result?.duplicate) res.status(200);
    return result;
  }

  @RequirePermissions('purchases.receive')
  @Post(':id/reverse')
  reverse(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.reverse(id, user, branchId, ip);
  }
}

@Module({
  controllers: [PurchaseReceiptController],
  providers: [PurchaseReceiptService],
})
export class PurchaseReceiptModule {}
