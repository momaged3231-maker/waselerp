import {
  BadRequestException, Controller, Get, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, Query,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { CurrentBranch, RequirePermissions } from '../../common/security';

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Phase-2 B4 — Supplier statement (كشف حساب مورد).
 *
 * READ-ONLY report. Sources:
 *  - ap_items / ap_aging: v_invoice_overdue (invoice_type = 2)
 *  - grni_memo: v_open_purchase_lines (goods received not invoiced)
 *  - advances: supplier_advances (status 1 open / 2 partial)
 *
 * No journal posting, no stock movement, no document mutation (per B4 brief).
 *  net_position = ap_aging.total - advances.available (may be negative —
 *  shown, never hidden).
 */
@Injectable()
export class SupplierStatementService {
  constructor(private readonly db: DatabaseService) {}

  async statement(
    supplierId: number,
    params: { from?: string; to?: string; branchId: number },
  ) {
    // Verify party exists and is a supplier (2) or both (3).
    const partyRows = await this.db.query<any>(
      `SELECT party_id, code, name, tax_number FROM parties WHERE party_id = $1::int`,
      [supplierId],
    );
    if (!partyRows.length) throw new NotFoundException('المورد غير موجود');

    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const from = params.from || firstOfMonth;
    const to = params.to || today;
    if (String(from) > String(to)) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');

    // AP items from the single source of truth (v_invoice_overdue, type 2).
    const apRows = await this.db.query<any>(
      `SELECT invoice_no, invoice_date, due_date, days_past_due,
              total_amount, paid_amount, remaining
         FROM v_invoice_overdue
        WHERE invoice_type = 2 AND party_id = $1::int
          AND invoice_date::date >= $2::date AND invoice_date::date <= $3::date
          AND ($4::int = 0 OR branch_id = $4::int)
        ORDER BY invoice_date, invoice_no`,
      [supplierId, from, to, params.branchId ?? 0],
    );
    const apItems = apRows.map((r) => ({
      invoice_no: r.invoice_no,
      date: r.invoice_date,
      date_has_time: true,
      due_date: r.due_date,
      amount: round2(r.total_amount),
      paid: round2(r.paid_amount),
      remaining: round2(r.remaining),
      days_past_due: Number(r.days_past_due),
    }));

    const aging = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, total: 0 };
    for (const it of apItems) {
      const d = it.days_past_due;
      if (d <= 0) aging.current = round2(aging.current + it.remaining);
      else if (d <= 30) aging.days_1_30 = round2(aging.days_1_30 + it.remaining);
      else if (d <= 60) aging.days_31_60 = round2(aging.days_31_60 + it.remaining);
      else if (d <= 90) aging.days_61_90 = round2(aging.days_61_90 + it.remaining);
      else aging.days_90_plus = round2(aging.days_90_plus + it.remaining);
      aging.total = round2(aging.total + it.remaining);
    }

    // GRNI memo — group open purchase lines by receipt.
    const grniRows = await this.db.query<any>(
      `SELECT v.receipt_id, pr.receipt_no, MIN(v.receipt_date) AS receipt_date,
              SUM(v.open_qty * v.unit_cost) AS open_value,
              (CURRENT_DATE - MIN(v.receipt_date))::int AS days_open
         FROM v_open_purchase_lines v
         JOIN purchase_receipts pr ON pr.receipt_id = v.receipt_id
        WHERE v.party_id = $1::int
          AND ($2::int = 0 OR v.branch_id = $2::int)
        GROUP BY v.receipt_id, pr.receipt_no
        ORDER BY receipt_date DESC`,
      [supplierId, params.branchId ?? 0],
    );
    const grniItems = grniRows.map((r) => ({
      receipt_no: r.receipt_no,
      date: r.receipt_date,
      date_has_time: false,
      amount: round2(r.open_value),
      days_open: Number(r.days_open),
    }));
    const grniTotal = round2(grniItems.reduce((s, x) => s + x.amount, 0));

    // Advances — open (1) and partial (2). available = still_open.
    const advRows = await this.db.query<any>(
      `SELECT advance_no, created_at, amount, still_open
         FROM supplier_advances
        WHERE party_id = $1::int AND status IN (1, 2)
          AND ($2::int = 0 OR branch_id = $2::int)
        ORDER BY created_at DESC`,
      [supplierId, params.branchId ?? 0],
    );
    const advItems = advRows.map((r) => ({
      advance_no: r.advance_no,
      date: r.created_at,
      date_has_time: true,
      amount: round2(r.amount),
      still_open: round2(r.still_open),
    }));
    const advAvailable = round2(advItems.reduce((s, x) => s + x.still_open, 0));
    const advApplied = round2(advItems.reduce((s, x) => s + (x.amount - x.still_open), 0));

    return {
      supplier: {
        party_id: Number(partyRows[0].party_id),
        code: partyRows[0].code,
        name: partyRows[0].name,
        tax_id: partyRows[0].tax_number,
      },
      period: { from, to },
      ap_aging: aging,
      ap_items: apItems,
      grni_memo: { total: grniTotal, items: grniItems },
      advances: { available: advAvailable, applied: advApplied, total: round2(advAvailable + advApplied), items: advItems },
      net_position: round2(aging.total - advAvailable),
    };
  }
}

function csvCell(v: any): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function statementCsv(d: any): string {
  const lines: string[][] = [];
  lines.push(['كشف حساب مورد', d.supplier.name, `من ${d.period.from} إلى ${d.period.to}`]);
  lines.push([]);
  lines.push(['AP — الفواتير المفتوحة']);
  lines.push(['رقم الفاتورة', 'التاريخ', 'الاستحقاق', 'المبلغ', 'المدفوع', 'المتبقي', 'أيام التأخير']);
  for (const it of d.ap_items) lines.push([it.invoice_no, String(it.date).slice(0, 10), String(it.due_date ?? '').slice(0, 10), it.amount, it.paid, it.remaining, it.days_past_due]);
  lines.push([]);
  lines.push(['أعمار الذمم', 'الحالي', '1-30', '31-60', '61-90', 'أكثر من 90', 'الإجمالي']);
  lines.push(['', d.ap_aging.current, d.ap_aging.days_1_30, d.ap_aging.days_31_60, d.ap_aging.days_61_90, d.ap_aging.days_90_plus, d.ap_aging.total]);
  lines.push([]);
  lines.push(['مذكرة GRNI — بضاعة مستلمة غير مفوترة']);
  lines.push(['رقم المحضر', 'التاريخ', 'المبلغ', 'أيام الفتح']);
  for (const it of d.grni_memo.items) lines.push([it.receipt_no, String(it.date).slice(0, 10), it.amount, it.days_open]);
  lines.push(['الإجمالي', '', d.grni_memo.total, '']);
  lines.push([]);
  lines.push(['السلف المقدمة']);
  lines.push(['رقم السلفة', 'التاريخ', 'المبلغ', 'المتبقي']);
  for (const it of d.advances.items) lines.push([it.advance_no, String(it.date).slice(0, 10), it.amount, it.still_open]);
  lines.push(['الإجمالي المتاح', '', d.advances.available, '']);
  lines.push([]);
  lines.push(['المركز الصافي', d.net_position]);
  return lines.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

@Controller('purchases')
export class SupplierStatementController {
  constructor(private readonly service: SupplierStatementService) {}

  @RequirePermissions('purchases.view')
  @Get('suppliers/:id/statement')
  async statement(
    @Param('id', ParseIntPipe) id: number,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: string,
    @CurrentBranch() branchId: number,
  ) {
    const data = await this.service.statement(id, { from, to, branchId });
    if (String(format).toLowerCase() === 'csv') {
      return {
        fileName: `supplier-statement-${id}.csv`,
        mimeType: 'text/csv; charset=utf-8',
        base64: Buffer.from('\uFEFF' + statementCsv(data), 'utf-8').toString('base64'),
      };
    }
    return data;
  }
}

@Module({
  providers: [SupplierStatementService],
  controllers: [SupplierStatementController],
  exports: [SupplierStatementService],
})
export class SupplierStatementModule {}
