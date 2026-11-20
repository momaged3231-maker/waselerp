import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  Param, ParseIntPipe, Post, Query,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/security';
import { postJournal, requireMapping, resolvePeriod, reverseJournal } from '../../common/posting';
import { asIsoDate } from '../../common/dates';

/**
 * E1 — Bank Reconciliation.
 *
 * Bank statement lines (imported or typed) are reconciled against the GL
 * movements on the bank account, then a «run» summarises the differences:
 *
 *   book_balance  = GL (net Dr−Cr) of the bank's gl_account as of run_date
 *   statement_balance = balance_after of the last statement line (or an explicit input)
 *   variance      = statement − book
 *
 * Posting a run writes ONE balanced journal (source_type = 'bank_recon') that
 * adjusts the books for everything found on the real statement but missing
 * from ours: bank fees, interest, bounced checks, unknown deposits/withdrawals
 * and match-difference residuals. Pending deposits and outstanding checks are
 * timing differences — they are reported, never posted.
 *
 * No posted journal is ever edited or deleted. Reversing a run creates a
 * mirror journal and resets the covered lines to unreconciled.
 */

const LINE_STATUS: Record<number, string> = {
  1: 'غير مطابقة', 2: 'مطابقة تلقائية', 3: 'مطابقة يدوية', 4: 'توقيت (لا تُرحل)', 5: 'متنازع عليها', 6: 'مطابقة بفروق',
};
const MOVEMENT_TYPES: Record<number, string> = {
  1: 'إيداع', 2: 'سحب', 3: 'رسوم بنكية', 4: 'فائدة بنكية', 5: 'شيك وارد', 6: 'شيك مرتد (للعميل)',
  7: 'شيك مرتد (صادر منا)', 8: 'تحويل وارد', 9: 'تحويل صادر', 10: 'إيداع معلق', 11: 'شيك غير مصروف',
};
/** Movement-type aliases accepted in the CSV column «movement_type» (Arabic + English). */
const MOVEMENT_ALIASES: Record<string, number> = {
  deposit: 1, 'إيداع': 1, withdrawal: 2, 'سحب': 2, fee: 3, 'fees': 3, 'رسوم': 3, 'مصروفات بنكية': 3, 'رسوم بنكية': 3,
  interest: 4, 'فائدة': 4, 'فوائد بنكية': 4, check_deposit: 5, 'شيك وارد': 5,
  bounced_in: 6, 'شيك مرتد': 6, 'شيك مرتد وارد': 6, bounced_out: 7, 'شيك مرتد صادر': 7,
  transfer_in: 8, 'تحويل وارد': 8, transfer_out: 9, 'تحويل صادر': 9,
  pending_deposit: 10, 'إيداع معلق': 10, outstanding_check: 11, 'شيك غير مصروف': 11,
};
/** Timing movement types — never adjusted in the GL, listed in the report only. */
const TIMING_TYPES = new Set([10, 11]);

function parseCsv(text: string): Record<string, string>[] {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const split = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else current += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(current); current = ''; }
      else current += ch;
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
  };
  const headers = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ''; });
    return row;
  });
}

function parseAmount(raw: string): number | null {
  const cleaned = String(raw ?? '').replace(/[٬,]/g, '').replace(/[^\d.\-()]/g, '');
  if (!cleaned) return null;
  const negative = /^\(.*\)$/.test(String(raw).trim());
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function toNumber(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Current GL net (Dr−Cr) of an account as of a date, inside a transaction. */
async function glNetAsOf(client: any, accountId: number, branchId: number, asOf: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(e.debit - e.credit), 0)::numeric net
       FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id
      WHERE e.account_id = $1::int AND j.branch_id = $2::int AND j.status = 2
        AND j.journal_date <= $3::date`,
    [accountId, branchId, asOf],
  );
  return Number(rows[0]?.net ?? 0);
}

async function assertPeriodOpen(client: any, branchId: number, date: string, what: string) {
  const period = await resolvePeriod(client, branchId, date);
  if (period.isClosed) {
    throw new BadRequestException(`الفترة المحاسبية «${period.name ?? date}» مقفلة — ${what}`);
  }
  if (period.manualLock) {
    throw new BadRequestException(`الفترة «${period.name ?? date}» مقفولة إداريًا — ${what}`);
  }
  return period.periodId;
}

async function activity(client: any, userId: number, branchId: number, action: string, entity: string, entityId: number | string, details: string) {
  await client.query(
    `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
     VALUES ($1::int,$2::int,$3::text,$4::text,$5::bigint,$6::text)`,
    [userId, branchId, action, entity, entityId, details],
  );
}

@Injectable()
export class BankReconService {
  constructor(private readonly db: DatabaseService) {}

  private async bankAccounts(branchId: number) {
    return this.db.query<any>(
      `SELECT c.cash_account_id AS "bankAccountId", c.name, c.bank_name AS "bankName", c.account_no AS "accountNo",
              c.opening_balance AS "openingBalance", c.gl_account_id AS "glAccountId",
              c.reconciled_balance AS "reconciledBalance", c.last_reconciled_at AS "lastReconciledAt",
              a.code AS "glCode"
         FROM cash_accounts c
         LEFT JOIN gl_accounts a ON a.account_id = c.gl_account_id
        WHERE c.branch_id = $1::int AND c.type = 2 AND c.is_active = true
        ORDER BY c.cash_account_id`,
      [branchId],
    );
  }

  private async bankAccountRow(client: any, branchId: number, accountId: number) {
    const { rows } = await client.query(
      `SELECT * FROM cash_accounts WHERE cash_account_id = $1::int AND branch_id = $2::int AND type = 2 LIMIT 1`,
      [accountId, branchId],
    );
    if (!rows.length) throw new BadRequestException('الحساب البنكي غير موجود أو غير مفعّل');
    return rows[0];
  }

  private async bankGlAccountId(client: any, account: any): Promise<number> {
    if (account.gl_account_id) return Number(account.gl_account_id);
    const mapping = await requireMapping(client, 'BANK', 'النقدية بالبنك');
    return mapping.accountId;
  }

  private async auditNote(branchId: number, user: AuthUser, action: string, details: string, entityId: number | string = 0) {
    try {
      await this.db.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,$3::text,'bank_recon',$4::bigint,$5::text)`,
        [user.userId, branchId, action, entityId, details],
      );
    } catch { /* audit must never break the flow */ }
  }

  // ---------------------------------------------------------------- accounts
  listAccounts(branchId: number) {
    return this.bankAccounts(branchId);
  }

  /** Settings used by the matching engine (tolerances, thresholds).
   *  Pass an active transaction client to avoid consuming a second pool connection. */
  async settings(client?: any) {
    let rows: { setting_key: string; setting_value: string }[];
    if (client) {
      const result = await client.query(
        `SELECT setting_key, setting_value FROM app_settings
          WHERE setting_key IN ('BankReconToleranceDays', 'BankReconToleranceAmount', 'BankReconPartialThreshold')`,
      );
      rows = result.rows as { setting_key: string; setting_value: string }[];
    } else {
      rows = await this.db.query<{ setting_key: string; setting_value: string }>(
        `SELECT setting_key, setting_value FROM app_settings
          WHERE setting_key IN ('BankReconToleranceDays', 'BankReconToleranceAmount', 'BankReconPartialThreshold')`,
      );
    }
    const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      toleranceDays: toNumber(map.get('BankReconToleranceDays') ?? 3),
      toleranceAmount: toNumber(map.get('BankReconToleranceAmount') ?? 0),
      partialThreshold: toNumber(map.get('BankReconPartialThreshold') ?? 100),
    };
  }

  // ------------------------------------------------------------- statement
  async importStatement(dto: any, user: AuthUser, branchId: number) {
    const accountId = Number(dto?.accountId);
    const records: Array<Record<string, any>> = Array.isArray(dto?.records) && dto.records.length
      ? dto.records
      : parseCsv(String(dto?.csv ?? ''));
    if (!accountId) throw new BadRequestException('اختر الحساب البنكي');
    if (!records.length) throw new BadRequestException('لا توجد سطور في الكشف — أرفق CSV بعناوين: date, description, reference, amount, (balance_after?), (movement_type?)');

    return this.db.transaction(async (client) => {
      await this.bankAccountRow(client, branchId, accountId);
      const cfg = await this.settings(client);
      const batch = randomUUID();
      let created = 0;
      const duplicates: any[] = [];
      const skipped: any[] = [];
      const errors: any[] = [];

      for (const [index, rec] of records.entries()) {
        const rowNo = index + 2; // header is row 1
        const date = asIsoDate(rec.date ?? rec['التاريخ']);
        const description = String(rec.description ?? rec['البيان'] ?? '').trim();
        const reference = String(rec.reference ?? rec['المرجع'] ?? rec['رقم مرجعي'] ?? '').trim() || null;
        const rawAmount = rec.amount ?? rec['المبلغ'];
        const amount = parseAmount(rawAmount);
        const balanceAfter = rec.balance_after != null && String(rec.balance_after).trim() !== ''
          ? parseAmount(rec.balance_after) : null;
        const movementRaw = String(rec.movement_type ?? rec['نوع الحركة'] ?? '').trim().toLowerCase();
        let movementType = MOVEMENT_ALIASES[movementRaw] ?? 0;
        if (!movementType) movementType = (amount ?? 0) >= 0 ? 1 : 2;

        if (!date) { errors.push({ row: rowNo, reason: 'تاريخ غير صالح' }); continue; }
        if (!description) { errors.push({ row: rowNo, reason: 'البيان إلزامي' }); continue; }
        if (amount == null || !Number.isFinite(amount)) { errors.push({ row: rowNo, reason: 'المبلغ غير صالح' }); continue; }
        if (amount === 0) { skipped.push({ row: rowNo, reason: 'مبلغ صفري' }); continue; }

        const hash = sha256(`${accountId}|${date}|${amount.toFixed(2)}|${reference ?? ''}|${description}`);
        const dupe = await client.query(`SELECT line_id FROM bank_statement_lines WHERE bank_account_id = $1::int AND dedupe_hash = $2::text LIMIT 1`, [accountId, hash]);
        if (dupe.rows.length) {
          duplicates.push({ row: rowNo, lineId: dupe.rows[0].line_id, reference, amount });
          continue;
        }
        await client.query(
          `INSERT INTO bank_statement_lines
             (bank_account_id, branch_id, statement_date, value_date, description, reference, movement_type,
              amount, balance_after, status, import_batch_id, dedupe_hash, created_by)
           VALUES ($1::int,$2::int,$3::date,$4::date,$5::text,$6::text,$7::smallint,
                   $8::numeric,$9::numeric,1,$10::uuid,$11::text,$12::int)`,
          [accountId, branchId, date, asIsoDate(rec.value_date ?? rec['تاريخ القيمة']) ?? null,
            description, reference, movementType, amount.toFixed(2),
            balanceAfter == null ? null : balanceAfter.toFixed(2), batch, hash, user.userId],
        );
        created += 1;
      }

      await activity(client, user.userId, branchId, 'bank_recon.import', 'bank_recon', 0,
        `استيراد كشف حساب ${accountId}: أُضيف ${created} سطرًا، ${duplicates.length} مكرر، ${errors.length} خطأ`);

      return { batchId: batch, created, duplicates, skipped, errors,
        toleranceDays: cfg.toleranceDays, toleranceAmount: cfg.toleranceAmount };
    });
  }

  async statement(branchId: number, query: any) {
    const accountId = Number(query?.accountId);
    if (!accountId) throw new BadRequestException('اختر الحساب البنكي');
    const from = asIsoDate(query?.from) ?? '1900-01-01';
    const to = asIsoDate(query?.to) ?? '2999-12-31';
    const status = query?.status ? Number(query.status) : 0;
    return this.db.query<any>(
      `SELECT l.line_id AS "lineId", l.statement_date AS "statementDate", l.value_date AS "valueDate",
              l.description, l.reference, l.movement_type AS "movementType", l.amount,
              l.balance_after AS "balanceAfter", l.status, l.match_difference AS "matchDifference",
              l.matched_journal_id AS "matchedJournalId", l.matched_entry_id AS "matchedEntryId"
         FROM bank_statement_lines l
        WHERE l.bank_account_id = $1::int AND l.branch_id = $2::int
          AND l.statement_date BETWEEN $3::date AND $4::date
          AND ($5::int = 0 OR l.status = $5::int)
        ORDER BY l.statement_date, l.line_id`,
      [accountId, branchId, from, to, status],
    ).then((rows) => rows.map((r) => ({ ...r, movementTypeName: MOVEMENT_TYPES[Number(r.movementType)] ?? 'أخرى', statusName: LINE_STATUS[Number(r.status)] ?? '?' })));
  }

  // -------------------------------------------------------------- matching
  async autoMatch(dto: any, user: AuthUser, branchId: number) {
    const accountId = Number(dto?.accountId);
    if (!accountId) throw new BadRequestException('اختر الحساب البنكي');
    const from = asIsoDate(dto?.from) ?? '1900-01-01';
    const to = asIsoDate(dto?.to) ?? '2999-12-31';

    return this.db.transaction(async (client) => {
      const cfg = await this.settings(client);
      const toleranceDays = toNumber(dto?.toleranceDays ?? cfg.toleranceDays);
      const toleranceAmount = toNumber(dto?.toleranceAmount ?? cfg.toleranceAmount);
      const partialThreshold = toNumber(dto?.partialThreshold ?? cfg.partialThreshold);

      const account = await this.bankAccountRow(client, branchId, accountId);
      const glId = await this.bankGlAccountId(client, account);
      const lines = await client.query<any>(
        `SELECT * FROM bank_statement_lines
          WHERE bank_account_id = $1::int AND branch_id = $2::int AND status = 1
            AND statement_date BETWEEN $3::date AND $4::date
          ORDER BY statement_date, line_id`,
        [accountId, branchId, from, to],
      );
      let matched = 0;
      let partial = 0;
      let skipped = 0;
      const ambiguous: any[] = [];

      for (const line of lines.rows) {
        const signed = Number(line.amount);
        const magnitude = Math.abs(signed);
        const isDeposit = signed > 0;
        // Candidate GL entries on the bank account, amount within tolerance, date within tolerance.
        const { rows: candidates } = await client.query<any>(
          `SELECT e.entry_id, e.journal_id, e.debit, e.credit, e.description,
                  j.journal_date, j.journal_no, j.description AS journal_description
             FROM gl_entries e
             JOIN gl_journals j ON j.journal_id = e.journal_id
            WHERE e.account_id = $1::int AND j.branch_id = $2::int AND j.status = 2
              AND ($3::boolean OR e.credit > 0) AND ($4::boolean OR e.debit > 0)
              AND ABS((CASE WHEN $3::boolean THEN e.debit WHEN e.credit > 0 THEN e.credit ELSE e.debit END) - $5::numeric) <= $6::numeric
              AND ABS(j.journal_date - $7::date) <= $8::int
              AND NOT EXISTS (SELECT 1 FROM bank_statement_lines bs WHERE bs.matched_entry_id = e.entry_id)
            ORDER BY j.journal_date`,
          [glId, branchId, isDeposit, !isDeposit, magnitude, Math.max(toleranceAmount, partialThreshold), line.statement_date, toleranceDays],
        );
        // Score each candidate.
        const scored = candidates.map((c) => {
          const entryAmt = isDeposit ? Number(c.debit) : Number(c.credit);
          const amountDiff = Math.abs(entryAmt - magnitude);
          const dayDiff = Math.abs((new Date(c.journal_date).getTime() - new Date(line.statement_date).getTime()) / 86400000);
          let score = 100 - dayDiff * 5 - amountDiff; // exact amount + same day wins
          if (line.reference && String(c.journal_description ?? '').includes(String(line.reference))) score += 40;
          return { c, amountDiff, score };
        });
        if (!scored.length) { skipped += 1; continue; }
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const tied = scored.filter((s) => Math.abs(s.score - best.score) < 0.5);
        if (tied.length > 1) { ambiguous.push({ lineId: line.line_id, reference: line.reference, amount: signed }); skipped += 1; continue; }
        const entryAmt = isDeposit ? Number(best.c.debit) : Number(best.c.credit);
        const difference = round2(signed - (isDeposit ? entryAmt : -entryAmt));
        const isPartial = Math.abs(difference) > Math.max(0.005, toleranceAmount);
        const newStatus = isPartial ? 6 : 2;
        await client.query(
          `UPDATE bank_statement_lines
              SET status = $2::smallint, matched_entry_id = $3::bigint, matched_journal_id = $4::bigint, match_difference = $5::numeric
            WHERE line_id = $1::bigint`,
          [line.line_id, newStatus, best.c.entry_id, best.c.journal_id, difference],
        );
        if (isPartial) partial += 1; else matched += 1;
      }

      await activity(client, user.userId, branchId, 'bank_recon.auto_match', 'bank_recon', accountId,
        `مطابقة تلقائية لحساب ${accountId}: مطابقة ${matched}، بفروق ${partial}، متخطي ${skipped} (${ambiguous.length} ملتبس)`);

      return { matched, partial, skipped, ambiguous };
    });
  }

  async manualMatch(id: number, dto: any, user: AuthUser, branchId: number) {
    const entryId = Number(dto?.entryId);
    if (!entryId) throw new BadRequestException('اختر القيد الطرفي المراد ربطه');
    return this.db.transaction(async (client) => {
      const { rows: lines } = await client.query(
        `SELECT * FROM bank_statement_lines WHERE line_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!lines.length) throw new BadRequestException('سطر الكشف غير موجود');
      const line = lines[0];
      const { rows: entries } = await client.query(
        `SELECT e.entry_id, e.journal_id, e.account_id, e.debit, e.credit, j.branch_id
           FROM gl_entries e JOIN gl_journals j ON j.journal_id = e.journal_id
          WHERE e.entry_id = $1::bigint`,
        [entryId],
      );
      if (!entries.length) throw new BadRequestException('الطرف المختار غير موجود');
      const entry = entries[0];
      if (Number(entry.branch_id) !== branchId) throw new BadRequestException('الطرف ينتمي لفرع آخر');
      const { rows: acctRows } = await client.query(
        `SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int`,
        [line.bank_account_id],
      );
      const bankGl = acctRows.length && acctRows[0].gl_account_id
        ? Number(acctRows[0].gl_account_id)
        : (await requireMapping(client, 'BANK', 'النقدية بالبنك')).accountId;
      if (Number(entry.account_id) !== bankGl) throw new BadRequestException('الطرف ليس على حساب البنك');
      const dupe = await client.query(`SELECT line_id FROM bank_statement_lines WHERE matched_entry_id = $1::bigint AND line_id <> $2::bigint LIMIT 1`, [entryId, id]);
      if (dupe.rows.length) throw new BadRequestException('هذا الطرف مرتبط بسطر آخر بالفعل');

      const signed = Number(line.amount);
      const isDeposit = signed > 0;
      const entrySigned = isDeposit ? Number(entry.debit) : -Number(entry.credit);
      const difference = round2(signed - entrySigned);
      const status = Math.abs(difference) > 0.005 ? 6 : 3;
      await client.query(
        `UPDATE bank_statement_lines
            SET status = $2::smallint, matched_entry_id = $3::bigint, matched_journal_id = $4::bigint, match_difference = $5::numeric
          WHERE line_id = $1::bigint`,
        [id, status, entryId, entry.journal_id, difference],
      );
      await activity(client, user.userId, branchId, 'bank_recon.manual_match', 'bank_recon', id,
        `مطابقة يدوية للسطر ${id} مع الطرف ${entryId} (فرق ${difference})`);
      return { lineId: id, status, matchDifference: difference, journalId: entry.journal_id };
    });
  }

  async unmatch(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT line_id, status FROM bank_statement_lines WHERE line_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('سطر الكشف غير موجود');
      if (Number(rows[0].status) === 4) throw new BadRequestException('السطور التوقيتية تُدار كإيداع معلق/شيك غير مصروف وليست مطابقة');
      await client.query(
        `UPDATE bank_statement_lines SET status = 1, matched_entry_id = NULL, matched_journal_id = NULL, match_difference = 0 WHERE line_id = $1::bigint`,
        [id],
      );
      await activity(client, user.userId, branchId, 'bank_recon.unmatch', 'bank_recon', id, `فك مطابقة السطر ${id}`);
      return { lineId: id, status: 1 };
    });
  }

  /** Mark a line as a timing difference (pending deposit / outstanding check) — no GL effect. */
  async markTiming(id: number, dto: any, user: AuthUser, branchId: number) {
    const kind = String(dto?.kind ?? '').trim();
    const movementType = kind === 'pending_deposit' ? 10 : kind === 'outstanding_check' ? 11 : 0;
    if (!movementType) throw new BadRequestException('نوع التوقيت: pending_deposit أو outstanding_check');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT line_id, status FROM bank_statement_lines WHERE line_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('سطر الكشف غير موجود');
      if (![1, 3, 6].includes(Number(rows[0].status))) throw new BadRequestException('لا يمكن وسم هذا السطر كتوقيت');
      await client.query(
        `UPDATE bank_statement_lines SET status = 4, movement_type = $2::smallint WHERE line_id = $1::bigint`,
        [id, movementType],
      );
      await activity(client, user.userId, branchId, 'bank_recon.mark_timing', 'bank_recon', id,
        `السطر ${id}: توقيت (${movementType === 10 ? 'إيداع معلق' : 'شيك غير مصروف'}) — بلا أثر محاسبي`);
      return { lineId: id, status: 4 };
    });
  }

  // ------------------------------------------------------------------- runs
  async createRun(dto: any, user: AuthUser, branchId: number) {
    const accountId = Number(dto?.accountId);
    const runDate = asIsoDate(dto?.runDate) ?? new Date().toISOString().slice(0, 10);
    if (!accountId) throw new BadRequestException('اختر الحساب البنكي');
    return this.db.transaction(async (client) => {
      const account = await this.bankAccountRow(client, branchId, accountId);
      const periodId = await assertPeriodOpen(client, branchId, runDate, 'لا يمكن إنشاء مسيرة مطابقة في فترة مقفولة');
      const glId = await this.bankGlAccountId(client, account);
      const bookBalance = await glNetAsOf(client, glId, branchId, runDate);

      // Statement balance: explicit input wins, else last line's balance_after, else sum of movements is NOT a balance.
      let statementBalance: number | null = null;
      if (dto?.statementBalance != null && Number.isFinite(Number(dto.statementBalance))) {
        statementBalance = Number(dto.statementBalance);
      } else {
        const { rows } = await client.query(
          `SELECT balance_after FROM bank_statement_lines
            WHERE bank_account_id = $1::int AND branch_id = $2::int AND balance_after IS NOT NULL
            ORDER BY statement_date DESC, line_id DESC LIMIT 1`,
          [accountId, branchId],
        );
        if (rows.length) statementBalance = Number(rows[0].balance_after);
      }
      if (statementBalance == null) {
        throw new BadRequestException('لا يوجد رصيد كشف بنكي — أدخل statementBalance أو استورد كشفًا يحتوي عمود الرصيد');
      }

      const counts = await client.query<{ matched: string; unmatched: string; timing: string }>(
        `SELECT COUNT(*) FILTER (WHERE status IN (2,3,6))::text matched,
                COUNT(*) FILTER (WHERE status IN (1))::text unmatched,
                COUNT(*) FILTER (WHERE status = 4)::text timing
           FROM bank_statement_lines
          WHERE bank_account_id = $1::int AND branch_id = $2::int AND statement_date <= $3::date`,
        [accountId, branchId, runDate],
      );
      const variance = round2(statementBalance - bookBalance);
      const runSerial = await this.db.nextNumber(client, `bankrecon:${branchId}`);
      const runNo = `BR-${new Date().getFullYear()}-${String(runSerial).padStart(6, '0')}`;
      const inserted = await client.query<{ run_id: number }>(
        `INSERT INTO bank_reconciliation_runs
           (run_no, bank_account_id, branch_id, period_id, run_date, book_balance, statement_balance,
            variance, matched_count, unmatched_count, status, notes, created_by)
         VALUES ($1,$2::int,$3::int,$4::int,$5::date,$6::numeric,$7::numeric,$8::numeric,$9::int,$10::int,1,$11::text,$12::int)
         RETURNING run_id`,
        [runNo, accountId, branchId, periodId, runDate, bookBalance.toFixed(2), statementBalance.toFixed(2),
          variance.toFixed(2), Number(counts.rows[0].matched), Number(counts.rows[0].unmatched),
          dto?.notes ?? null, user.userId],
      );
      await activity(client, user.userId, branchId, 'bank_recon.create_run', 'bank_recon', inserted.rows[0].run_id,
        `إنشاء مسيرة ${runNo}: دفتر ${bookBalance.toFixed(2)} مقابل كشف ${statementBalance.toFixed(2)} (فرق ${variance.toFixed(2)})`);
      return {
        runId: inserted.rows[0].run_id, runNo,
        bookBalance: round2(bookBalance), statementBalance: round2(statementBalance), variance,
        matchedCount: Number(counts.rows[0].matched), unmatchedCount: Number(counts.rows[0].unmatched),
        timingCount: Number(counts.rows[0].timing),
      };
    });
  }

  /** Posts the adjustment journal (one balanced journal, source_type = 'bank_recon') and marks the run posted. */
  async postRun(id: number, dto: any, user: AuthUser, branchId: number) {
    const runDate = asIsoDate(dto?.date) ?? new Date().toISOString().slice(0, 10);
    return this.db.transaction(async (client) => {
      const { rows: runs } = await client.query(
        `SELECT * FROM bank_reconciliation_runs WHERE run_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!runs.length) throw new BadRequestException('المسيرة غير موجودة');
      const run = runs[0];
      if (Number(run.status) !== 1) throw new BadRequestException('لا يمكن ترحيل مسيرة غير مسودة — المسيرات المرحّلة لا تُعدّل، استخدم العكس');
      await assertPeriodOpen(client, branchId, runDate, 'لا يمكن ترحيل مسيرة في فترة مقفولة');

      const account = await this.bankAccountRow(client, branchId, Number(run.bank_account_id));
      const glId = await this.bankGlAccountId(client, account);

      const { rows: lines } = await client.query(
        `SELECT * FROM bank_statement_lines
          WHERE bank_account_id = $1::int AND branch_id = $2::int
            AND (status = 1 OR (status IN (3,6) AND ABS(match_difference) > 0.005))
            AND statement_date <= $3::date
          ORDER BY statement_date, line_id`,
        [run.bank_account_id, branchId, run.run_date],
      );

      const { rows: suspenseRows } = await client.query(`SELECT a.account_id AS "id" FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'BANK_SUSPENSE' LIMIT 1`);
      const suspenseId = Number(suspenseRows[0]?.id) || (await requireMapping(client, 'OTHER_EXPENSE', 'مصروفات إدارية')).accountId;
      const { rows: bFee } = await client.query(`SELECT a.account_id AS "id" FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'BANK_FEE' LIMIT 1`);
      const { rows: otherIncome } = await client.query(`SELECT a.account_id AS "id" FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'OTHER_INCOME' LIMIT 1`);
      const { rows: arRow } = await client.query(`SELECT a.account_id AS "id" FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'AR' LIMIT 1`);
      const { rows: apRow } = await client.query(`SELECT a.account_id AS "id" FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'AP' LIMIT 1`);
      const bankFeeId = Number(bFee[0]?.id) || (await requireMapping(client, 'OTHER_EXPENSE', 'مصروفات إدارية')).accountId;
      const otherIncomeId = Number(otherIncome[0]?.id) || (await requireMapping(client, 'OTHER_INCOME', 'إيرادات أخرى')).accountId;
      const arId = Number(arRow[0]?.id) || (await requireMapping(client, 'AR', 'ذمم العملاء')).accountId;
      const apId = Number(apRow[0]?.id) || (await requireMapping(client, 'AP', 'ذمم الموردين')).accountId;

      // Bucket the adjustments per movement class; each bucket is balanced against the bank.
      // UNKNOWN movements (and partial-match differences) NEVER hit P&L: they are booked to the
      // BANK_SUSPENSE clearing account and classified explicitly later (auditable, per line).
      let fees = 0, interestIn = 0, unknownIn = 0, unknownOut = 0, bouncedIn = 0, bouncedOut = 0, diffNet = 0;
      const included: number[] = [];
      const suspenseDrafts: { lineId: number; direction: number; amount: number; tag: string; kind: string }[] = [];
      for (const line of lines) {
        const amount = Number(line.amount);
        const type = Number(line.movement_type);
        if (TIMING_TYPES.has(type) || Number(line.status) === 5) continue;
        if (Number(line.status) !== 1) {
          // Matched line with a difference — the residual is unclassified until reviewed.
          const diff = round2(toNumber(line.match_difference));
          if (Math.abs(diff) > 0.005) {
            diffNet = round2(diffNet + diff);
            included.push(line.line_id);
            suspenseDrafts.push({
              lineId: line.line_id, direction: diff > 0 ? 1 : 2, amount: Math.abs(diff),
              tag: `#L${line.line_id}`, kind: 'فرق مطابقة',
            });
          }
          continue;
        }
        included.push(line.line_id);
        switch (type) {
          case 3: fees += Math.abs(amount); break;
          case 4: interestIn += Math.abs(amount); break;
          case 6: bouncedIn += Math.abs(amount); break;
          case 7: bouncedOut += Math.abs(amount); break;
          case 1: case 5: case 8:
            unknownIn += amount;
            suspenseDrafts.push({ lineId: line.line_id, direction: 1, amount: round2(amount), tag: `#L${line.line_id}`, kind: 'إيداع مجهول' });
            break;
          default:
            unknownOut += Math.abs(amount);
            suspenseDrafts.push({ lineId: line.line_id, direction: 2, amount: round2(Math.abs(amount)), tag: `#L${line.line_id}`, kind: 'سحب مجهول' });
            break;
        }
      }

      const journalLines: any[] = [];
      const push = (accountId: number, debit: number, credit: number, description: string) => {
        if (debit > 0) journalLines.push({ accountId, debit: round2(debit), description });
        else if (credit > 0) journalLines.push({ accountId, credit: round2(credit), description });
      };
      if (fees > 0) { push(bankFeeId, fees, 0, 'رسوم بنكية غير مقيدة بالدفتر'); push(glId, 0, fees, 'تسوية بنكية — رسوم'); }
      if (interestIn > 0) { push(glId, interestIn, 0, 'تسوية بنكية — فائدة'); push(otherIncomeId, 0, interestIn, 'فوائد بنكية غير مقيدة'); }
      if (bouncedIn > 0) { push(arId, bouncedIn, 0, 'شيك مرتد (وارد) — عكس التحصيل'); push(glId, 0, bouncedIn, 'تسوية بنكية — شيك مرتد'); }
      if (bouncedOut > 0) { push(glId, bouncedOut, 0, 'تسوية بنكية — شيك صادر مرتد'); push(apId, 0, bouncedOut, 'شيك مرتد (صادر) — إحياء الالتزام'); }
      // Unclassified movements go through the suspense account, one line pair per statement line.
      for (const draft of suspenseDrafts) {
        const desc = `${draft.kind} ${draft.tag}`;
        if (draft.direction === 1) {
          push(glId, draft.amount, 0, desc);
          push(suspenseId, 0, draft.amount, desc);
        } else {
          push(suspenseId, draft.amount, 0, desc);
          push(glId, 0, draft.amount, desc);
        }
      }

      let journalId: number | null = null;
      if (journalLines.length >= 2) {
        journalId = await postJournal(client, {
          branchId, journalType: 6, journalDate: runDate,
          description: `تسوية بنكية ${run.run_no} — ${account.name}`,
          sourceType: 'bank_recon', sourceId: id, userId: user.userId, autoBalance: true,
          lines: journalLines,
        });
      }
      // Register each suspense leg as a traceable entry linked to its statement line
      // (description carries a deterministic #L<lineId> tag).
      if (journalId && suspenseDrafts.length) {
        const { rows: suspEntries } = await client.query(
          `SELECT entry_id, description FROM gl_entries WHERE journal_id = $1::bigint AND account_id = $2::int`,
          [journalId, suspenseId],
        );
        for (const entry of suspEntries) {
          const match = /#L(\d+)/.exec(entry.description ?? '');
          if (!match) continue;
          const lineId = Number(match[1]);
          const draft = suspenseDrafts.find((d) => d.lineId === lineId);
          if (!draft) continue;
          await client.query(
            `INSERT INTO bank_suspense_entries
               (adjustment_journal_id, suspense_gl_entry_id, bank_statement_line_id, direction, amount)
             VALUES ($1::bigint, $2::bigint, $3::bigint, $4::smallint, $5::numeric)`,
            [journalId, entry.entry_id, lineId, draft.direction, draft.amount.toFixed(2)],
          );
        }
      }
      for (const lineId of included) {
        await client.query(
          `INSERT INTO bank_reconciliation_run_lines (run_id, line_id, adjustment_journal_id)
           VALUES ($1::bigint, $2::bigint, $3::bigint) ON CONFLICT DO NOTHING`,
          [id, lineId, journalId],
        );
      }
      await client.query(
        `UPDATE bank_reconciliation_runs
            SET status = 2, journal_id = $2::bigint, posted_by = $3::int, posted_at = now()
          WHERE run_id = $1::bigint`,
        [id, journalId, user.userId],
      );
      await client.query(
        `UPDATE cash_accounts SET reconciled_balance = $2::numeric, last_reconciled_at = now() WHERE cash_account_id = $1::int`,
        [Number(run.bank_account_id), Number(run.statement_balance).toFixed(2)],
      );
      await activity(client, user.userId, branchId, 'bank_recon.post_run', 'bank_recon', id,
        `ترحيل مسيرة ${run.run_no} — ${journalId ? `قيد تسوية #${journalId}` : 'بلا قيد (صفر فروقات قيدية)'} — ${included.length} سطور مشمولة`);

      return { runId: id, status: 2, journalId, adjustedLines: included.length,
        suspenseEntries: suspenseDrafts.length,
        adjustments: { fees, interestIn, unknownIn, unknownOut, bouncedIn, bouncedOut, matchDifferenceNet: round2(diffNet) } };
    });
  }

  /** Reverses a posted run: mirror journal + lines back to unreconciled. */
  async reverseRun(id: number, dto: any, user: AuthUser, branchId: number) {
    const reversalDate = asIsoDate(dto?.date) ?? new Date().toISOString().slice(0, 10);
    return this.db.transaction(async (client) => {
      const { rows: runs } = await client.query(
        `SELECT * FROM bank_reconciliation_runs WHERE run_id = $1::bigint AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!runs.length) throw new BadRequestException('المسيرة غير موجودة');
      const run = runs[0];
      if (Number(run.status) !== 2) throw new BadRequestException('لا يمكن عكس مسيرة غير مرحّلة');
      await assertPeriodOpen(client, branchId, reversalDate, 'لا يمكن العكس في فترة مقفولة');

      let reverseJournalId: number | null = null;
      if (run.journal_id) {
        reverseJournalId = await reverseJournal(client, Number(run.journal_id), {
          userId: user.userId, date: reversalDate,
          description: `عكس تسوية بنكية ${run.run_no}`,
          journalType: 6,
        });
      }
      const linked = await client.query<{ line_id: number }>(
        `SELECT line_id FROM bank_reconciliation_run_lines WHERE run_id = $1::bigint`,
        [id],
      );
      for (const row of linked.rows) {
        await client.query(
          `UPDATE bank_statement_lines SET status = 1, matched_entry_id = NULL, matched_journal_id = NULL, match_difference = 0 WHERE line_id = $1::bigint`,
          [row.line_id],
        );
      }
      // Keep bank_reconciliation_run_lines as the permanent record of which lines
      // were part of the reversed run — never delete audit trail.
      if (run.journal_id) {
        await client.query(
          `UPDATE bank_suspense_entries SET status = 3 WHERE adjustment_journal_id = $1::bigint AND status IN (1,2)`,
          [run.journal_id],
        );
      }
      await client.query(
        `UPDATE bank_reconciliation_runs SET status = 3, reverse_journal_id = $2::bigint WHERE run_id = $1::bigint`,
        [id, reverseJournalId],
      );
      await client.query(
        `UPDATE cash_accounts SET reconciled_balance = NULL WHERE cash_account_id = $1::int`,
        [Number(run.bank_account_id)],
      );
      await activity(client, user.userId, branchId, 'bank_recon.reverse_run', 'bank_recon', id,
        `عكس مسيرة ${run.run_no} — ${reverseJournalId ? `قيد عكسي #${reverseJournalId}` : 'بلا قيد'} — السطور عادت غير مطابقة`);
      return { runId: id, status: 3, reverseJournalId };
    });
  }

  listRuns(branchId: number, query: any) {
    const accountId = query?.accountId ? Number(query.accountId) : 0;
    return this.db.query<any>(
      `SELECT r.run_id AS "runId", r.run_no AS "runNo", r.bank_account_id AS "bankAccountId",
              a.name AS "bankAccountName", r.run_date AS "runDate", r.created_at AS "createdAt",
              r.book_balance AS "bookBalance",
              r.statement_balance AS "statementBalance", r.variance,
              r.matched_count AS "matchedCount", r.unmatched_count AS "unmatchedCount",
              r.status, r.journal_id AS "journalId", r.reverse_journal_id AS "reverseJournalId",
              r.notes, r.posted_at AS "postedAt"
         FROM bank_reconciliation_runs r
         JOIN cash_accounts a ON a.cash_account_id = r.bank_account_id
        WHERE r.branch_id = $1::int AND ($2::int = 0 OR r.bank_account_id = $2::int)
        ORDER BY r.run_id DESC LIMIT 100`,
      [branchId, accountId],
    ).then((rows) => rows.map((r) => ({ ...r, statusName: r.status === 1 ? 'مسودة' : r.status === 2 ? 'مرحّلة' : 'معكوسة' })));
  }

  /** Full reconciliation report for a run: statement vs GL, line classification, adjustments. */
  async runReport(id: number, branchId: number) {
    const run = (await this.db.query<any>(
      `SELECT r.*, a.name AS "bankAccountName", a.gl_account_id AS "glAccountId"
         FROM bank_reconciliation_runs r JOIN cash_accounts a ON a.cash_account_id = r.bank_account_id
        WHERE r.run_id = $1::bigint AND r.branch_id = $2::int`,
      [id, branchId],
    ))[0];
    if (!run) throw new BadRequestException('المسيرة غير موجودة');
    const lines = await this.db.query<any>(
      `SELECT l.line_id AS "lineId", l.statement_date AS "statementDate", l.description, l.reference,
              l.movement_type AS "movementType", l.amount, l.balance_after AS "balanceAfter",
              l.status, l.match_difference AS "matchDifference", l.matched_journal_id AS "matchedJournalId"
         FROM bank_statement_lines l
        WHERE l.bank_account_id = $1::int AND l.branch_id = $2::int AND l.statement_date <= $3::date
        ORDER BY l.statement_date, l.line_id`,
      [run.bank_account_id, branchId, run.run_date],
    );
    const withNames = lines.map((l) => ({
      ...l,
      movementTypeName: MOVEMENT_TYPES[Number(l.movementType)] ?? 'أخرى',
      statusName: LINE_STATUS[Number(l.status)] ?? '?',
    }));
    const sums = lines.reduce((acc, l) => {
      acc.total += Number(l.amount);
      if (Number(l.status) === 1) acc.unmatchedIn += Number(l.amount) > 0 ? Number(l.amount) : 0, acc.unmatchedOut += Number(l.amount) < 0 ? -Number(l.amount) : 0;
      return acc;
    }, { total: 0, unmatchedIn: 0, unmatchedOut: 0 });
    return {
      run: { ...run, statusName: run.status === 1 ? 'مسودة' : run.status === 2 ? 'مرحّلة' : 'معكوسة' },
      lines: withNames,
      summary: {
        statementBalance: Number(run.statement_balance),
        bookBalance: Number(run.book_balance),
        variance: Number(run.variance),
        movementsTotal: round2(sums.total),
        unmatchedDeposits: round2(sums.unmatchedIn),
        unmatchedWithdrawals: round2(sums.unmatchedOut),
        timingDeposits: round2(lines.filter((l) => Number(l.movement_type) === 10).reduce((s, l) => s + Math.abs(Number(l.amount)), 0)),
        outstandingChecks: round2(lines.filter((l) => Number(l.movement_type) === 11).reduce((s, l) => s + Math.abs(Number(l.amount)), 0)),
      },
    };
  }

  // ------------------------------------------------------------- suspense
  /** Open (and classified) suspense entries for the branch — unclassified bank movements. */
  async listSuspense(branchId: number, query: any) {
    const status = query?.status != null && query.status !== '' ? Number(query.status) : 0;
    const entries = await this.db.query<any>(
      `SELECT s.suspense_entry_id AS "suspenseEntryId", s.bank_statement_line_id AS "lineId",
              s.direction, s.amount, s.status, s.adjustment_journal_id AS "adjustmentJournalId",
              s.classification_journal_id AS "classificationJournalId",
              s.classified_account_id AS "classifiedAccountId", s.classified_at AS "classifiedAt",
              s.notes, l.statement_date AS "statementDate", l.description, l.reference,
              a.code AS "suspenseCode", ca.code AS "classifiedCode", ca.name AS "classifiedName"
         FROM bank_suspense_entries s
         JOIN bank_statement_lines l ON l.line_id = s.bank_statement_line_id
         JOIN gl_accounts a ON a.account_id = (
           SELECT e.account_id FROM gl_entries e WHERE e.entry_id = s.suspense_gl_entry_id
         )
         LEFT JOIN gl_accounts ca ON ca.account_id = s.classified_account_id
        WHERE l.branch_id = $1::int AND ($2::int = 0 OR s.status = $2::int)
        ORDER BY s.suspense_entry_id DESC LIMIT 200`,
      [branchId, status],
    );
    const openTotals = await this.db.query<{ net: string | null; count: string }>(
      `SELECT COALESCE(SUM(CASE WHEN s.direction = 1 THEN s.amount ELSE -s.amount END), 0)::numeric net,
              COUNT(*)::int count
         FROM bank_suspense_entries s JOIN bank_statement_lines l ON l.line_id = s.bank_statement_line_id
        WHERE l.branch_id = $1::int AND s.status = 1`,
      [branchId],
    );
    return {
      entries: entries.map((e) => ({ ...e, statusName: e.status === 1 ? 'مفتوحة' : e.status === 2 ? 'مصنّفة' : 'ملغاة بالعكس' })),
      openCount: Number(openTotals[0]?.count ?? 0),
      // Net CREDIT-positive balance of the suspense account (deposit side deposits money in suspense).
      netOpen: Number(openTotals[0]?.net ?? 0),
    };
  }

  /**
   * Classifies one suspense entry into a REAL account: Dr/Cr suspense ↔ chosen account
   * through posting.ts, with the entry locked and audited. Reversible via reverse-classification.
   */
  async classifySuspense(id: number, dto: any, user: AuthUser, branchId: number) {
    const accountId = Number(dto?.accountId);
    if (!accountId) throw new BadRequestException('اختر الحساب المراد التصنيف إليه');
    const notes = String(dto?.notes ?? '').trim() || null;
    const classifyDate = asIsoDate(dto?.date) ?? new Date().toISOString().slice(0, 10);
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT s.*, l.description AS line_description
           FROM bank_suspense_entries s JOIN bank_statement_lines l ON l.line_id = s.bank_statement_line_id
          WHERE s.suspense_entry_id = $1::bigint AND l.branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('قيد الوسيط غير موجود');
      const entry = rows[0];
      if (Number(entry.status) !== 1) throw new BadRequestException('هذه الحركة مصنّفة أو ملغاة بالفعل');
      await assertPeriodOpen(client, branchId, classifyDate, 'لا يمكن التصنيف في فترة مقفولة');

      const { rows: acctRows } = await client.query(
        `SELECT a.account_id, a.code, a.name, a.is_group, a.is_active
           FROM gl_accounts a WHERE a.account_id = $1::int`,
        [accountId],
      );
      if (!acctRows.length || !acctRows[0].is_active) throw new BadRequestException('الحساب المختار غير موجود أو غير مفعّل');
      if (acctRows[0].is_group) throw new BadRequestException('لا يمكن التصنيف إلى حساب تجميعي');
      const suspenseId = Number((await client.query(
        `SELECT a.account_id FROM gl_accounts a JOIN gl_mappings m ON m.account_id = a.account_id WHERE m.mapping_key = 'BANK_SUSPENSE' LIMIT 1`,
      )).rows[0]?.account_id);
      if (accountId === suspenseId) throw new BadRequestException('لا يمكن التصنيف إلى الحساب الوسيط نفسه');

      const amount = Number(entry.amount);
      const lines = entry.direction === 1
        ? [
            { accountId: suspenseId, debit: amount, description: `تصنيف حركة بنكية — ${entry.line_description ?? ''}` },
            { accountId, credit: amount, description: `تصنيف حركة بنكية — ${entry.line_description ?? ''}` },
          ]
        : [
            { accountId, debit: amount, description: `تصنيف حركة بنكية — ${entry.line_description ?? ''}` },
            { accountId: suspenseId, credit: amount, description: `تصنيف حركة بنكية — ${entry.line_description ?? ''}` },
          ];
      const journalId = await postJournal(client, {
        branchId, journalType: 6, journalDate: classifyDate,
        description: `تصنيف حركة بنكية سطر #${entry.bank_statement_line_id}`,
        sourceType: 'bank_recon_classification', sourceId: id, userId: user.userId, autoBalance: true,
        lines,
      });
      await client.query(
        `UPDATE bank_suspense_entries
            SET status = 2, classification_journal_id = $2::bigint, classified_account_id = $3::int,
                classified_by = $4::int, classified_at = now(), notes = $5::text
          WHERE suspense_entry_id = $1::bigint`,
        [id, journalId, accountId, user.userId, notes],
      );
      await activity(client, user.userId, branchId, 'bank_recon.suspense_classify', 'bank_recon', id,
        `تصنيف حركة سطر ${entry.bank_statement_line_id} إلى حساب ${acctRows[0].code} — قيد #${journalId}`);
      return { suspenseEntryId: id, classificationJournalId: journalId, classifiedAccountId: accountId, amount };
    });
  }

  /** Reverses a classification: mirror journal + the suspense entry becomes open again. */
  async reverseClassification(id: number, dto: any, user: AuthUser, branchId: number) {
    const reverseDate = asIsoDate(dto?.date) ?? new Date().toISOString().slice(0, 10);
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT s.*, l.description AS line_description
           FROM bank_suspense_entries s JOIN bank_statement_lines l ON l.line_id = s.bank_statement_line_id
          WHERE s.suspense_entry_id = $1::bigint AND l.branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('قيد الوسيط غير موجود');
      const entry = rows[0];
      if (Number(entry.status) !== 2) throw new BadRequestException('لا يمكن عكس تصنيف غير مصنّف');
      await assertPeriodOpen(client, branchId, reverseDate, 'لا يمكن العكس في فترة مقفولة');

      const reverseJournalId = entry.classification_journal_id
        ? await reverseJournal(client, Number(entry.classification_journal_id), {
            userId: user.userId, date: reverseDate,
            description: `عكس تصنيف حركة بنكية سطر #${entry.bank_statement_line_id}`,
            journalType: 6,
          })
        : null;
      await client.query(
        `UPDATE bank_suspense_entries
            SET status = 1, classification_journal_id = NULL, classified_account_id = NULL,
                classified_by = NULL, classified_at = NULL, notes = NULL
          WHERE suspense_entry_id = $1::bigint`,
        [id],
      );
      await activity(client, user.userId, branchId, 'bank_recon.suspense_reverse', 'bank_recon', id,
        `عكس تصنيف حركة سطر ${entry.bank_statement_line_id} — ${reverseJournalId ? `قيد عكسي #${reverseJournalId}` : 'بلا قيد'}`);
      return { suspenseEntryId: id, status: 1, reverseJournalId };
    });
  }
}

function round2(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

@Controller('treasury/bank-recon')
export class BankReconController {
  constructor(private readonly service: BankReconService) {}

  @Get('accounts')
  @RequirePermissions('bank.view')
  listAccounts(@CurrentBranch() branchId: number) {
    return this.service.listAccounts(branchId);
  }

  @Get('settings')
  @RequirePermissions('bank.view')
  getSettings() {
    return this.service.settings();
  }

  @Post('statements/import')
  @RequirePermissions('bank.manage')
  importStatement(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.importStatement(dto, user, branchId);
  }

  @Get('statements')
  @RequirePermissions('bank.view')
  statement(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.statement(branchId, query);
  }

  @Post('auto-match')
  @RequirePermissions('bank.manage')
  autoMatch(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.autoMatch(dto, user, branchId);
  }

  @Post('statements/lines/:id/match')
  @RequirePermissions('bank.manage')
  manualMatch(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.manualMatch(id, dto, user, branchId);
  }

  @Post('statements/lines/:id/unmatch')
  @RequirePermissions('bank.manage')
  unmatch(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.unmatch(id, user, branchId);
  }

  @Post('statements/lines/:id/mark-timing')
  @RequirePermissions('bank.manage')
  markTiming(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.markTiming(id, dto, user, branchId);
  }

  @Post('runs')
  @RequirePermissions('bank.manage')
  createRun(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.createRun(dto, user, branchId);
  }

  @Post('runs/:id/post')
  @RequirePermissions('bank.manage')
  postRun(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.postRun(id, dto, user, branchId);
  }

  @Post('runs/:id/reverse')
  @RequirePermissions('bank.manage')
  reverseRun(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.reverseRun(id, dto, user, branchId);
  }

  @Get('runs')
  @RequirePermissions('bank.view')
  listRuns(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.listRuns(branchId, query);
  }

  @Get('runs/:id/report')
  @RequirePermissions('bank.view')
  runReport(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.runReport(id, branchId);
  }

  @Get('suspense')
  @RequirePermissions('bank.view')
  listSuspense(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.listSuspense(branchId, query);
  }

  @Post('suspense/:id/classify')
  @RequirePermissions('bank.manage')
  classifySuspense(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.classifySuspense(id, dto, user, branchId);
  }

  @Post('suspense/:id/reverse-classification')
  @RequirePermissions('bank.manage')
  reverseClassification(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.reverseClassification(id, dto, user, branchId);
  }
}

@Module({
  controllers: [BankReconController],
  providers: [BankReconService],
})
export class BankReconModule {}
