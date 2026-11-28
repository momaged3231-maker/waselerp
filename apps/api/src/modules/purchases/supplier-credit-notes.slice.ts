import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module,
  Param, ParseIntPipe, Post, Query, Req, Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { assertPeriodOpen, postJournal, requireMapping, reverseJournal } from '../../common/posting';
import { logActivity } from '../../common/audit';
import { asIsoDate } from '../../common/dates';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

@Injectable()
export class SupplierCreditNotesService {
  constructor(private readonly db: DatabaseService) {}

  async list(branchId: number, q: any) {
    const w = ['1=1'];
    const p: any[] = [];
    const add = (sql: string, v: any) => { p.push(v); w.push(sql.replace('?', `$${p.length}`)); };
    if (branchId && String(q?.all) !== '1') add('branch_id = ?', branchId);
    if (q?.partyId) add('party_id = ?', Number(q.partyId));
    if (q?.invoiceId) add('original_invoice_id = ?', Number(q.invoiceId));
    if (q?.from) add('cn_date >= ?', q.from);
    if (q?.to) add('cn_date <= ?', q.to);
    if (q?.status) add('status = ?', Number(q.status));
    return this.db.query<any>(
      `SELECT c.*, i.invoice_no AS "originalInvoiceNo", p.name AS "partyName"
         FROM supplier_credit_notes c
         LEFT JOIN invoices i ON i.invoice_id = c.original_invoice_id
         LEFT JOIN parties p ON p.party_id = c.party_id
        WHERE ${w.join(' AND ')} ORDER BY c.created_at DESC LIMIT 200`, p);
  }

  async detail(id: number) {
    const row = await this.db.one<any>(
      `SELECT c.*, i.invoice_no AS "originalInvoiceNo", p.name AS "partyName"
         FROM supplier_credit_notes c
         LEFT JOIN invoices i ON i.invoice_id = c.original_invoice_id
         LEFT JOIN parties p ON p.party_id = c.party_id
        WHERE c.credit_note_id = $1::bigint`, [id]);
    if (!row) throw new BadRequestException('إشعار الدائن غير موجود');
    return row;
  }

  /** P2-02..P2-08 — create + post in one transaction. */
  async create(dto: any, user: AuthUser, branchId: number, ip: string) {
    const clientRequestId = dto?.clientRequestId ? String(dto.clientRequestId).trim() : null;
    if (clientRequestId) {
      const existing = await this.db.one<any>(
        `SELECT credit_note_id AS "creditNoteId", credit_note_no AS "creditNoteNo"
           FROM supplier_credit_notes WHERE client_request_id = $1`, [clientRequestId]);
      if (existing) return { ...existing, duplicate: true };
    }
    const subtotal = round2(dto?.subtotal ?? 0);
    const tax = round2(dto?.taxAmount ?? 0);
    const reason = String(dto?.reason ?? '').trim();
    const cnDate = String(dto?.cnDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!(subtotal > 0)) throw new BadRequestException('المبلغ الأساسي لإشعار الدائن يجب أن يكون أكبر من صفر');
    if (tax < 0) throw new BadRequestException('ضريبة سالبة غير مسموحة');
    if (!reason) throw new BadRequestException('سبب إشعار الدائن إلزامي');

    return this.db.transaction(async (client) => {
      try {
        const inv = await client.query<any>(
          `SELECT * FROM invoices WHERE invoice_id = $1::bigint FOR UPDATE`, [Number(dto.originalInvoiceId)]);
        const invoice = inv.rows[0];
        if (!invoice) throw new BadRequestException('الفاتورة الأصلية غير موجودة');
        if (Number(invoice.invoice_type) !== 2) throw new BadRequestException('الفاتورة الأصلية يجب أن تكون فاتورة شراء');
        if (Number(invoice.branch_id) !== Number(branchId)) throw new BadRequestException('الفاتورة الأصلية تخص فرعًا آخر');
        if (Number(invoice.party_id) !== Number(dto.partyId)) throw new BadRequestException('طرف الإشعار يجب أن يطابق طرف الفاتورة');
        if (Number(invoice.status) === 3) throw new BadRequestException('لا يمكن إصدار إشعار دائن لفاتورة ملغاة');
        const invoiceDate = asIsoDate(invoice.invoice_date) ?? cnDate;
        if (cnDate < invoiceDate) throw new BadRequestException('تاريخ الإشعار قبل تاريخ الفاتورة');
        // P2-05 — no over-credit
        const prior = await client.query<{ used: string }>(
          `SELECT COALESCE(SUM(total_amount),0) AS used FROM supplier_credit_notes
            WHERE original_invoice_id=$1::bigint AND status=2`, [invoice.invoice_id]);
        const returns = await client.query<{ used: string }>(
          `SELECT COALESCE(SUM(total_amount),0) AS used FROM invoices
            WHERE parent_invoice_id=$1::bigint AND invoice_type=4 AND status=2`, [invoice.invoice_id]);
        const available = round2(Number(invoice.total_amount) - Number(prior.rows[0].used) - Number(returns.rows[0].used));
        if (round2(subtotal + tax) > available + 0.005) {
          throw new BadRequestException(`القيمة تتجاوز الرصيد المتاح للإشعار (المتبقي ${available})`);
        }
        await assertPeriodOpen(client, branchId, cnDate);

        const seq = await this.db.nextNumber(client, `scn:${branchId}`);
        const creditNoteNo = `SCN-${branchId}-${cnDate.slice(0, 4)}-${String(seq).padStart(6, '0')}`;
        const inserted = await client.query<{ credit_note_id: number }>(
          `INSERT INTO supplier_credit_notes
             (branch_id, party_id, original_invoice_id, credit_note_no, cn_date, subtotal, tax_amount,
              status, reason, created_by, client_request_id, claim_id)
           VALUES ($1::int,$2::int,$3::bigint,$4,$5::date,$6,$7,2,$8,$9,$10,NULL)
          RETURNING credit_note_id`,
          [branchId, Number(dto.partyId), invoice.invoice_id, creditNoteNo, cnDate, subtotal, tax,
            reason, user.userId, clientRequestId]);
        const id = Number(inserted.rows[0].credit_note_id);

        // P2-06 — Dr AP / Cr PPV / Cr VAT Input
        const ap = await requireMapping(client, 'AP', 'ذمم الموردين');
        const ppv = await requireMapping(client, 'PPV', 'فروق أسعار الشراء');
        const vatInput = await requireMapping(client, 'VAT_INPUT', 'ضريبة القيمة المضافة (مدخلات)');
        const lines: any[] = [
          { accountId: ap.accountId, debit: round2(subtotal + tax), credit: 0, partyId: Number(dto.partyId), description: reason },
          { accountId: ppv.accountId, debit: 0, credit: subtotal, description: reason },
        ];
        if (tax > 0) lines.push({ accountId: vatInput.accountId, debit: 0, credit: tax, description: reason });
        const journalId = await postJournal(client, {
          branchId, journalDate: cnDate, journalType: 2, description: `إشعار دائن مورد ${creditNoteNo}`,
          sourceType: 'supplier_credit_note', sourceId: id, lines, userId: user.userId,
        });
        await client.query('UPDATE supplier_credit_notes SET gl_journal_id=$2::bigint WHERE credit_note_id=$1::bigint', [id, journalId]);
        // P2-07 — audit with ip
        await logActivity(client, { userId: user.userId, branchId, action: 'purchase.credit_note.post',
          entity: 'supplier_credit_note', entityId: String(id), details: `${creditNoteNo} — ${reason}`, ip });
        return { creditNoteId: id, creditNoteNo, journalId, totalAmount: round2(subtotal + tax) };
      } catch (err: any) {
        if (clientRequestId && err?.code === '23505' && String(err?.constraint ?? '') === 'ux_scn_client_request') {
          const existing = await client.query<any>(
            `SELECT credit_note_id AS "creditNoteId", credit_note_no AS "creditNoteNo" FROM supplier_credit_notes WHERE client_request_id=$1`, [clientRequestId]);
          if (existing.rows[0]) return { ...existing.rows[0], duplicate: true };
        }
        throw err;
      }
    });
  }

  /** P2-09/P2-10 — cancel with mirror journal. */
  async cancel(id: number, dto: any, user: AuthUser, branchId: number, ip: string) {
    const reason = String(dto?.cancelReason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب إلغاء إشعار الدائن إلزامي');
    return this.db.transaction(async (client) => {
      const row = await client.query<any>(
        `SELECT * FROM supplier_credit_notes WHERE credit_note_id=$1::bigint FOR UPDATE`, [id]);
      const cn = row.rows[0];
      if (!cn) throw new BadRequestException('إشعار الدائن غير موجود');
      if (Number(cn.branch_id) !== Number(branchId)) throw new BadRequestException('الإشعار يخص فرعًا آخر');
      if (Number(cn.status) === 3) throw new BadRequestException('الإشعار ملغى بالفعل');
      const cancelDate = String(dto?.cancelDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      await assertPeriodOpen(client, branchId, cancelDate);
      const reverseJournalId = cn.gl_journal_id
        ? await reverseJournal(client, Number(cn.gl_journal_id), { userId: user.userId, description: `عكس إشعار دائن ${cn.credit_note_no} — ${reason}` })
        : null;
      await client.query(
        `UPDATE supplier_credit_notes SET status=3, cancelled_at=now(), cancel_reason=$2, cancel_journal_id=$3::bigint
          WHERE credit_note_id=$1::bigint`, [id, reason, reverseJournalId]);
      await logActivity(client, { userId: user.userId, branchId, action: 'purchase.credit_note.cancel',
        entity: 'supplier_credit_note', entityId: String(id), details: `${cn.credit_note_no} — ${reason}`, ip });
      return { creditNoteId: id, status: 3, reverseJournalId };
    });
  }
}

@Controller('purchases/credit-notes')
export class SupplierCreditNotesController {
  constructor(private readonly svc: SupplierCreditNotesService) {}

  @RequirePermissions('purchases.approve_payment')
  @Get()
  list(@CurrentBranch() b: number, @Query() q: any) { return this.svc.list(b, q); }

  @RequirePermissions('purchases.approve_payment')
  @Get(':id')
  detail(@Param('id', ParseIntPipe) id: number) { return this.svc.detail(id); }

  @RequirePermissions('purchases.approve_payment')
  @Post()
  async create(@Body() dto: any, @CurrentUser() u: AuthUser, @CurrentBranch() b: number,
    @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const result = await this.svc.create(dto, u, b, ip);
    if (result?.duplicate) res.status(200);
    return result;
  }

  @RequirePermissions('purchases.approve_payment')
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() u: AuthUser,
    @CurrentBranch() b: number, @Req() req: Request) {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    return this.svc.cancel(id, dto, u, b, ip);
  }
}

@Module({ controllers: [SupplierCreditNotesController], providers: [SupplierCreditNotesService] })
export class SupplierCreditNotesModule {}
