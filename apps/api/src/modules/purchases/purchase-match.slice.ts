import {
  BadRequestException, Controller, ForbiddenException, Get, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, Post, Body, Query, HttpCode, Req,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { logActivity } from '../../common/audit';
import { Request } from 'express';

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const round6 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 1e6) / 1e6;

/** DEC-PURCH-024 — 90-day GRNI aging alert. */
const GRNI_ALERT_DAYS = 90;

/**
 * Phase-2 B3 — reporting + exception-approval layer over the B1 (GRN) and
 * B2 (invoice → GRNI/PPV) settlement paths.
 *
 * This slice is READ-ONLY for settlement:
 *  - it does NOT post journals (postInvoiceJournal in B2 is the only path),
 *  - it does NOT move stock (applyMovement in B1 is the only path),
 *  - the exception endpoint only records the waive / unmatched link audit.
 *
 * Design reference: docs/PURCHASE-CYCLE-DECISIONS.md §1.6, §7 (R-5, C-3).
 */
@Injectable()
export class PurchaseMatchService {
  constructor(private readonly db: DatabaseService) {}

  private async assertPurchaseInvoice(client: PoolClient, invoiceId: number, branchId: number) {
    const r = await client.query<any>(
      `SELECT invoice_id, invoice_no, invoice_type, branch_id, party_id, status
         FROM invoices WHERE invoice_id = $1::bigint`,
      [invoiceId],
    );
    if (!r.rows.length) throw new NotFoundException('الفاتورة غير موجودة');
    const h = r.rows[0];
    if (![2, 4].includes(Number(h.invoice_type))) {
      throw new BadRequestException('الفاتورة ليست فاتورة مشتريات');
    }
    if (branchId && Number(h.branch_id) !== Number(branchId)) {
      throw new ForbiddenException('الفاتورة تخص فرعًا آخر');
    }
    return h;
  }

  // ------------------------------------------------------------------- //
  //  B3.1 — three-way match (non-blocking, informational)
  // ------------------------------------------------------------------- //
  async match(invoiceId: number, branchId: number) {
    return this.db.transaction(async (client) => {
      const h = await this.assertPurchaseInvoice(client, invoiceId, branchId);
      const rows = await client.query<any>(
        `SELECT il.invoice_line_id, il.line_number, il.item_id, it.code AS item_code, il.unit_id,
                il.quantity AS invoice_qty, il.unit_price AS invoice_price,
                COALESCE(lk.accepted_qty, 0)      AS accepted_qty,
                COALESCE(lk.grn_unit_cost, 0)     AS grn_unit_cost,
                COALESCE(lk.linked_qty, 0)        AS linked_qty,
                lk.receipt_no, lk.receipt_line_id, lk.receipt_id,
                lk.order_line_id, lk.order_no, lk.po_qty, lk.po_price
           FROM invoice_lines il
           JOIN items it ON it.item_id = il.item_id
           LEFT JOIN (
             SELECT pil.invoice_id, pil.item_id,
                    SUM(prl.accepted_qty) AS accepted_qty,
                    SUM(prl.accepted_qty * prl.unit_cost)
                      / NULLIF(SUM(prl.accepted_qty), 0) AS grn_unit_cost,
                    SUM(pil.invoiced_qty) AS linked_qty,
                    MIN(pr.receipt_no) AS receipt_no,
                    MIN(prl.line_id) AS receipt_line_id,
                    MIN(pr.receipt_id) AS receipt_id,
                    MIN(ol.order_line_id) AS order_line_id,
                    MIN(o.order_no) AS order_no,
                    SUM(ol.quantity) AS po_qty,
                    SUM(ol.quantity * ol.unit_price) / NULLIF(SUM(ol.quantity), 0) AS po_price
               FROM purchase_invoice_links pil
               JOIN purchase_receipt_lines prl ON prl.line_id = pil.receipt_line_id
               JOIN purchase_receipts pr ON pr.receipt_id = pil.receipt_id
               LEFT JOIN order_lines ol ON ol.order_line_id = prl.order_line_id
               LEFT JOIN orders o ON o.order_id = ol.order_id
              WHERE pil.invoice_id = $1::bigint AND pil.voided_at IS NULL
              GROUP BY pil.invoice_id, pil.item_id
           ) lk ON lk.invoice_id = il.invoice_id AND lk.item_id = il.item_id
          WHERE il.invoice_id = $1::bigint
          ORDER BY il.line_number`,
        [invoiceId],
      );

      const lines = rows.rows.map((r: any) => {
        const invoiceQty = round6(r.invoice_qty);
        const acceptedQty = round6(r.accepted_qty);
        const invoicePrice = Number(r.invoice_price);
        const grnCost = Number(r.grn_unit_cost);
        const qtyVariance = round6(invoiceQty - acceptedQty);
        const priceVariance = round2((invoicePrice - grnCost) * invoiceQty);
        const status = r.receipt_line_id == null
          ? 'no_receipt'
          : qtyVariance > 1e-6 ? 'qty_over' : 'matched';
        return {
          invoiceLineId: Number(r.invoice_line_id),
          lineNumber: Number(r.line_number),
          itemId: Number(r.item_id),
          itemCode: r.item_code,
          unitId: Number(r.unit_id),
          poLine: r.order_line_id == null ? null : {
            orderLineId: Number(r.order_line_id),
            orderNo: r.order_no,
            qty: round6(r.po_qty),
            price: round2(r.po_price),
          },
          grnLine: r.receipt_line_id == null ? null : {
            receiptLineId: Number(r.receipt_line_id),
            receiptId: r.receipt_id == null ? null : Number(r.receipt_id),
            receiptNo: r.receipt_no,
            acceptedQty,
            unitCost: round2(grnCost),
          },
          invoiceLine: { qty: invoiceQty, price: round2(invoicePrice) },
          linkedQty: round6(r.linked_qty),
          qtyVariance,
          priceVariance,
          priceOver: priceVariance > 0.005, // warning flag — non-blocking per design (C-3)
          status,
        };
      });

      const summary = {
        totalLines: lines.length,
        matched: lines.filter((l) => l.status === 'matched').length,
        qtyOver: lines.filter((l) => l.status === 'qty_over').length,
        priceOver: lines.filter((l) => l.priceOver).length,
        noReceipt: lines.filter((l) => l.status === 'no_receipt').length,
      };
      return {
        invoiceId: Number(h.invoice_id),
        invoiceNo: h.invoice_no,
        invoiceType: Number(h.invoice_type),
        branchId: Number(h.branch_id),
        partyId: h.party_id == null ? null : Number(h.party_id),
        documentStatus: Number(h.status),
        lines,
        summary,
      };
    });
  }

  // ------------------------------------------------------------------- //
  //  B3.2 — exception approval (audit only; never posts a journal)
  // ------------------------------------------------------------------- //
  async approveException(invoiceId: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب الاستثناء إلزامي');
    const links = Array.isArray(dto?.links) ? dto.links : [];
    if (!links.length) throw new BadRequestException('أضف سطرًا واحدًا على الأقل للاستثناء');

    return this.db.transaction(async (client) => {
      const h = await this.assertPurchaseInvoice(client, invoiceId, branchId);
      let orderId: number | null = null;
      let receiptId: number | null = null;

      for (const link of links) {
        const rlId = Number(link.receipt_line_id ?? link.receiptLineId ?? 0);
        const qty = round6(Number(link.qty ?? 0));
        if (!rlId || !(qty > 0)) throw new BadRequestException('بيانات ربط الاستثناء غير صحيحة');
        const rl = await client.query<any>(
          `SELECT prl.receipt_id, prl.item_id, prl.accepted_qty, pr.order_id, pr.branch_id
             FROM purchase_receipt_lines prl
             JOIN purchase_receipts pr ON pr.receipt_id = prl.receipt_id
            WHERE prl.line_id = $1::bigint`,
          [rlId],
        );
        if (!rl.rows.length) throw new NotFoundException('سطر محضر الاستلام غير موجود');
        const row = rl.rows[0];
        if (branchId && Number(row.branch_id) !== Number(branchId)) {
          throw new ForbiddenException('سطر الاستلام يخص فرعًا آخر');
        }
        receiptId = receiptId ?? Number(row.receipt_id);
        orderId = orderId ?? (row.order_id == null ? null : Number(row.order_id));

        // Record the excess as an UNMATCHED link: receipt_line_id is NULL by
        // design — v_open_purchase_lines joins on that column, so an unmatched
        // marker never reduces the GRN's open quantity or touches the GL.
        // voided_at stays NULL: this is active audit data, not a cancelled link.
        await client.query(
          `INSERT INTO purchase_invoice_links
             (invoice_id, receipt_id, receipt_line_id, item_id, invoiced_qty)
           VALUES ($1::bigint, $2::bigint, NULL, $3::int, $4::numeric)`,
          [invoiceId, Number(row.receipt_id), Number(row.item_id), qty],
        );
      }

      const ins = await client.query<{ override_id: number }>(
        `INSERT INTO purchase_match_overrides
           (invoice_id, order_id, receipt_id, overridden_by, reason, overridden_at)
         VALUES ($1::bigint, $2::bigint, $3::bigint, $4::int, $5, now())
         RETURNING override_id`,
        [invoiceId, orderId, receiptId, user.userId, reason],
      );

      await logActivity(client, { userId: user.userId, branchId: Number(h.branch_id),
        action: 'purchase.match_exception', entity: 'invoice', entityId: String(invoiceId),
        details: JSON.stringify({ reason, links }), ip });

      return {
        overrideId: Number(ins.rows[0].override_id),
        invoiceId: Number(invoiceId),
        status: 'approved',
        reason,
        unmatchedLinks: links.length,
      };
    });
  }

  // ------------------------------------------------------------------- //
  //  B3.3 — GRNI aging (0-30 / 31-60 / 61-90 / >90 + alert)
  // ------------------------------------------------------------------- //
  async grniAging(params: { branchId: number; partyId?: number }) {
    const rows = await this.db.query<any>(
      `SELECT party_id, branch_id, receipt_id, receipt_line_id, item_id,
              open_qty, open_value, receipt_date,
              (CURRENT_DATE - receipt_date::date) AS age_days
         FROM v_open_purchase_lines
        WHERE ($1::int = 0 OR branch_id = $1::int)
          AND ($2::int = 0 OR party_id = $2::int)
        ORDER BY age_days DESC`,
      [params.branchId ?? 0, params.partyId ?? 0],
    );

    const bucketOf = (d: number) => d <= 30 ? '0-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '>90';
    const order = ['0-30', '31-60', '61-90', '>90'];
    const acc: Record<string, { bucket: string; lines: number; qty: number; value: number }> = {};
    for (const b of order) acc[b] = { bucket: b, lines: 0, qty: 0, value: 0 };
    for (const r of rows) {
      const b = bucketOf(Number(r.age_days));
      acc[b].lines += 1;
      acc[b].qty = round6(acc[b].qty + Number(r.open_qty));
      acc[b].value = round2(acc[b].value + Number(r.open_value));
    }
    const buckets = order.map((b) => ({ ...acc[b], warning: b === '>90' && acc[b].lines > 0 }));
    const alert = buckets.find((b) => b.bucket === '>90')!.lines > 0;
    return {
      asOf: new Date().toISOString().slice(0, 10),
      alertDays: GRNI_ALERT_DAYS,
      warning: alert,
      warningMessage: alert ? `يوجد بضاعة مستلمة غير مفوترة عمرها أكثر من ${GRNI_ALERT_DAYS} يومًا` : null,
      buckets,
      rows: rows.map((r: any) => ({
        partyId: r.party_id == null ? null : Number(r.party_id),
        branchId: Number(r.branch_id),
        receiptId: Number(r.receipt_id),
        receiptLineId: Number(r.receipt_line_id),
        itemId: Number(r.item_id),
        openQty: round6(r.open_qty),
        openValue: round2(r.open_value),
        receiptDate: r.receipt_date,
        ageDays: Number(r.age_days),
        bucket: bucketOf(Number(r.age_days)),
      })),
    };
  }

  // ------------------------------------------------------------------- //
  //  B3.4 — GRN vs invoiced variance (reads PPV, never posts it)
  // ------------------------------------------------------------------- //
  async grnVariance(params: { branchId: number; from?: string; to?: string }) {
    const rows = await this.db.query<any>(
      `SELECT pr.receipt_id, pr.receipt_no, pr.receipt_date, pr.party_id, pr.branch_id,
              prl.line_id AS receipt_line_id, prl.item_id, it.code AS item_code,
              prl.accepted_qty, prl.unit_cost,
              prl.accepted_qty * prl.unit_cost AS grn_value,
              COALESCE(SUM(pil.invoiced_qty), 0) AS invoiced_qty,
              COALESCE(SUM(pil.invoiced_qty * il.unit_price), 0) AS invoiced_value
         FROM purchase_receipt_lines prl
         JOIN purchase_receipts pr ON pr.receipt_id = prl.receipt_id
         JOIN items it ON it.item_id = prl.item_id
         LEFT JOIN purchase_invoice_links pil
                ON pil.receipt_line_id = prl.line_id AND pil.voided_at IS NULL
         LEFT JOIN invoice_lines il
                ON il.invoice_id = pil.invoice_id AND il.item_id = prl.item_id
        WHERE prl.accepted_qty > 0
          AND ($1::int = 0 OR pr.branch_id = $1::int)
          AND ($2::date IS NULL OR pr.receipt_date >= $2::date)
          AND ($3::date IS NULL OR pr.receipt_date <= $3::date)
        GROUP BY pr.receipt_id, pr.receipt_no, pr.receipt_date, pr.party_id, pr.branch_id,
                 prl.line_id, prl.item_id, it.code, prl.accepted_qty, prl.unit_cost
        ORDER BY pr.receipt_date DESC, pr.receipt_id DESC, prl.line_id`,
      [params.branchId ?? 0, params.from ?? null, params.to ?? null],
    );

    const lines = rows.map((r: any) => {
      const grnValue = round2(r.grn_value);
      const invoiced = round2(r.invoiced_value);
      const invoicedQty = round6(r.invoiced_qty);
      const accepted = round6(r.accepted_qty);
      const status = invoicedQty <= 0 ? 'not_invoiced'
        : invoicedQty + 1e-6 >= accepted ? 'fully_invoiced' : 'partially_invoiced';
      return {
        receiptId: Number(r.receipt_id),
        receiptNo: r.receipt_no,
        receiptDate: r.receipt_date,
        partyId: r.party_id == null ? null : Number(r.party_id),
        branchId: Number(r.branch_id),
        receiptLineId: Number(r.receipt_line_id),
        itemId: Number(r.item_id),
        itemCode: r.item_code,
        acceptedQty: accepted,
        unitCost: round2(r.unit_cost),
        grnValue,
        invoicedQty,
        invoiced,
        ppv: round2(invoiced - grnValue),
        status,
      };
    });
    return {
      lines,
      totals: {
        lines: lines.length,
        grnValue: round2(lines.reduce((s, l) => s + l.grnValue, 0)),
        invoiced: round2(lines.reduce((s, l) => s + l.invoiced, 0)),
        ppv: round2(lines.reduce((s, l) => s + l.ppv, 0)),
        fullyInvoiced: lines.filter((l) => l.status === 'fully_invoiced').length,
        partiallyInvoiced: lines.filter((l) => l.status === 'partially_invoiced').length,
        notInvoiced: lines.filter((l) => l.status === 'not_invoiced').length,
      },
    };
  }
}

// ----------------------------------------------------------------------- //
//  CSV helpers — same {fileName, mimeType, base64} contract as other exports
// ----------------------------------------------------------------------- //
function csvCell(v: any): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvResponse(fileName: string, header: string[], rows: any[][]) {
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return {
    fileName,
    mimeType: 'text/csv; charset=utf-8',
    base64: Buffer.from('\uFEFF' + csv, 'utf-8').toString('base64'),
  };
}

@Controller('purchases')
export class PurchaseMatchController {
  constructor(private readonly service: PurchaseMatchService) {}

  @RequirePermissions('purchases.view')
  @Get('invoices/:id/match')
  match(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.match(id, branchId);
  }

  @RequirePermissions('purchases.approve_exception')
  @HttpCode(200)
  @Post('invoices/:id/exception')
  exception(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
    @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number,
    @Req() req: Request,
  ) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.service.approveException(id, dto, user, branchId, ip);
  }

  @RequirePermissions('purchases.view')
  @Get('reports/grni-aging')
  async grniAging(
    @Query('format') format: string,
    @Query('partyId') partyId: string,
    @CurrentBranch() branchId: number,
  ) {
    const data = await this.service.grniAging({ branchId, partyId: Number(partyId) || 0 });
    if (String(format).toLowerCase() !== 'csv') return data;
    return csvResponse(
      'grni-aging.csv',
      ['bucket', 'lines', 'qty', 'value', 'warning'],
      data.buckets.map((b) => [b.bucket, b.lines, b.qty, b.value, b.warning ? 'نعم' : 'لا']),
    );
  }

  @RequirePermissions('purchases.view')
  @Get('reports/grn-variance')
  async grnVariance(
    @Query('format') format: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentBranch() branchId: number,
  ) {
    const data = await this.service.grnVariance({ branchId, from, to });
    if (String(format).toLowerCase() !== 'csv') return data;
    return csvResponse(
      'grn-variance.csv',
      ['receiptNo', 'itemCode', 'acceptedQty', 'unitCost', 'grnValue', 'invoicedQty', 'invoiced', 'ppv', 'status'],
      data.lines.map((l) => [l.receiptNo, l.itemCode, l.acceptedQty, l.unitCost, l.grnValue, l.invoicedQty, l.invoiced, l.ppv, l.status]),
    );
  }
}

@Module({
  providers: [PurchaseMatchService],
  controllers: [PurchaseMatchController],
  exports: [PurchaseMatchService],
})
export class PurchaseMatchModule {}
