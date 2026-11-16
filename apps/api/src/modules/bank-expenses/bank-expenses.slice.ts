import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, Module,
  Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { postJournal, requireMapping, resolvePeriod, reverseJournal } from '../../common/posting';
import { asIsoDate } from '../../common/dates';

/**
 * E3 — Auto Bank Expenses (الرسوم والعمولات البنكية الآلية).
 *
 * A rule books a fixed recurring bank fee: e.g. «رسوم POS الشهرية» — Dr المصاريف (5107 بالعادة)
 * / Cr البنك (GL للحساب البنكي). Generation is deterministic and idempotent:
 *
 *  - Every occurrence is computed from `start_date` + `day_of_month` + `frequency`.
 *  - Each generated occurrence is registered in `bank_expense_runs` with a
 *    UNIQUE (rule_id, period_key) index — the SAME occurrence can never be
 *    posted twice, no matter how often the run is triggered.
 *  - Posting goes through `posting.ts` inside one transaction per batch.
 *  - A closed period refuses THAT occurrence only; the refusal is logged with
 *    the reason and never aborts the batch.
 *  - Editing the amount / accounts / frequency / day-of-month is refused once
 *    the rule has generated at least one journal (create a new rule instead).
 *  - Suspension requires a reason; resuming clears it. Rules with generated
 *    journals are never deleted — only deactivated.
 *
 * Explicitly out of scope: this module NEVER turns an arbitrary bank movement
 * into an expense. Unknown bank movements remain the job of the E1 suspense
 * account. Only explicitly-created, active, unsuspended rules generate.
 */

const FREQ_LABEL: Record<number, string> = { 1: 'شهري', 2: 'ربع سنوي', 3: 'نصف سنوي', 4: 'سنوي' };
const FREQ_MONTHS: Record<number, number> = { 1: 1, 2: 3, 3: 6, 4: 12 };
const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

function* occurrences(startDate: string, dayOfMonth: number, frequency: number, asOf: string): Generator<string> {
  const start = asIsoDate(startDate);
  const end = asIsoDate(asOf);
  if (!start || !end) return;
  if (start > end) return;
  const step = FREQ_MONTHS[frequency] ?? 1;
  let months = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
  for (let i = 0; i < 1200; i += 1) {
    const occ = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth(), dayOfMonth));
    const occIso = iso(occ);
    if (occIso > end) return;
    if (occIso >= start) yield occIso;
    months = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth() + step, 1));
    if (iso(months) > end) return;
  }
}

/** Next occurrence strictly AFTER `afterIso` (for listing/preview). */
function nextOccurrence(startDate: string, dayOfMonth: number, frequency: number, afterIso: string): string | null {
  const start = asIsoDate(startDate);
  if (!start) return null;
  const end = asIsoDate(afterIso) ?? '2999-12-31';
  const step = FREQ_MONTHS[frequency] ?? 1;
  let months = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
  for (let i = 0; i < 1200; i += 1) {
    const occ = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth(), dayOfMonth));
    const occIso = iso(occ);
    if (occIso >= start && occIso > end) return occIso;
    months = new Date(Date.UTC(months.getUTCFullYear(), months.getUTCMonth() + step, 1));
  }
  return null;
}

function toRule(row: any) {
  return {
    ruleId: Number(row.rule_id),
    branchId: Number(row.branch_id),
    name: row.name,
    description: row.description,
    bankAccountId: Number(row.bank_account_id),
    bankAccountName: row.bank_account_name ?? null,
    expenseAccountId: Number(row.expense_account_id),
    expenseAccountCode: row.expense_account_code ?? null,
    expenseAccountName: row.expense_account_name ?? null,
    amount: num(row.amount),
    frequency: Number(row.frequency),
    frequencyName: FREQ_LABEL[Number(row.frequency)] ?? '?',
    dayOfMonth: Number(row.day_of_month),
    startDate: asIsoDate(row.start_date),
    endDate: asIsoDate(row.end_date),
    counterpartyName: row.counterparty_name,
    isActive: !!row.is_active,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    nextOccurrence: nextOccurrence(asIsoDate(row.start_date) ?? '2999-12-31', Number(row.day_of_month), Number(row.frequency), iso(new Date())),
    postedCount: Number(row.posted_count ?? 0),
    lastGenerated: asIsoDate(row.last_generated) ?? null,
    createdAt: row.created_at,
  };
}

@Injectable()
export class BankExpensesService {
  constructor(private readonly db: DatabaseService) {}

  private async activity(client: any, userId: number, branchId: number, action: string, entityId: number | string, details: string) {
    try {
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,$3::text,'bank_expense',$4::bigint,$5::text)`,
        [userId, branchId, action, entityId, details],
      );
    } catch { /* audit must never break the flow */ }
  }

  private async bankGlId(client: any, cashAccountId: number, branchId: number): Promise<number> {
    const { rows } = await client.query(
      `SELECT cash_account_id, gl_account_id, name FROM cash_accounts
        WHERE cash_account_id = $1::int AND branch_id = $2::int AND type = 2 AND is_active = true`,
      [cashAccountId, branchId],
    );
    if (!rows.length) throw new BadRequestException('الحساب البنكي غير موجود أو غير مفعّل في هذا الفرع');
    if (rows[0].gl_account_id) return Number(rows[0].gl_account_id);
    const mapping = await requireMapping(client, 'BANK', 'النقدية بالبنك');
    return mapping.accountId;
  }

  // ---------------------------------------------------------------- listing
  async list(branchId: number, query: any) {
    const status = String(query?.status ?? '').trim(); // all | active | suspended | inactive
    const rows = await this.db.query<any>(
      `SELECT r.*, c.name AS bank_account_name,
              a.code AS expense_account_code, a.name AS expense_account_name,
              (SELECT COUNT(*)::int FROM bank_expense_runs x WHERE x.rule_id = r.rule_id AND x.status = 1) AS posted_count,
              (SELECT MAX(y.period_key) FROM bank_expense_runs y WHERE y.rule_id = r.rule_id AND y.status = 1) AS last_generated
         FROM bank_expense_rules r
         JOIN cash_accounts c ON c.cash_account_id = r.bank_account_id
         JOIN gl_accounts a ON a.account_id = r.expense_account_id
        WHERE r.branch_id = $1::int
          AND ($2::text = '' OR ($2::text = 'active' AND r.is_active AND r.suspended_at IS NULL)
                          OR ($2::text = 'suspended' AND r.suspended_at IS NOT NULL)
                          OR ($2::text = 'inactive' AND NOT r.is_active))
        ORDER BY r.is_active DESC, r.suspended_at NULLS FIRST, r.rule_id`,
      [branchId, status],
    );
    return rows.map(toRule);
  }

  async preview(id: number, branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT r.* FROM bank_expense_rules r WHERE r.rule_id = $1::int AND r.branch_id = $2::int`,
      [id, branchId],
    );
    if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
    const rule = rows[0];
    const posted = await this.db.one<{ n: string; last: string | null }>(
      `SELECT COUNT(*)::int AS n, MAX(period_key) AS last FROM bank_expense_runs WHERE rule_id = $1::int AND status = 1`,
      [id],
    );
    const upcoming: string[] = [];
    const futureFrom = posted?.last ?? iso(new Date());
    for (const occ of occurrences(asIsoDate(rule.start_date) ?? '2999-12-31', Number(rule.day_of_month), Number(rule.frequency), '2999-12-31')) {
      if (occ > futureFrom && upcoming.length < 6) upcoming.push(occ);
      if (upcoming.length >= 6) break;
    }
    return {
      ruleId: id,
      name: rule.name,
      nextOccurrences: upcoming,
      postedCount: Number(posted?.n ?? 0),
      lastGenerated: asIsoDate(posted?.last) ?? null,
      postingAmount: num(rule.amount),
      frequencyName: FREQ_LABEL[Number(rule.frequency)] ?? '?',
    };
  }

  // ---------------------------------------------------------------- writes
  async create(dto: any, user: AuthUser, branchId: number) {
    const name = String(dto?.name ?? '').trim();
    const description = dto?.description ? String(dto.description).trim() : null;
    const counterparty = dto?.counterpartyName ? String(dto.counterpartyName).trim() : null;
    const bankAccountId = Number(dto?.bankAccountId);
    const expenseAccountId = Number(dto?.expenseAccountId);
    const amount = num(dto?.amount);
    const frequency = Number(dto?.frequency ?? 1);
    const dayOfMonth = Number(dto?.dayOfMonth);
    const startDate = asIsoDate(dto?.startDate);
    const endDate = dto?.endDate ? asIsoDate(dto.endDate) : null;

    if (!name) throw new BadRequestException('اسم القاعدة مطلوب');
    if (!(amount > 0)) throw new BadRequestException('مبلغ القاعدة يجب أن يكون أكبر من صفر');
    if (![1, 2, 3, 4].includes(frequency)) throw new BadRequestException('التكرار: 1 شهري · 2 ربع سنوي · 3 نصف سنوي · 4 سنوي');
    if (!(dayOfMonth >= 1 && dayOfMonth <= 28)) throw new BadRequestException('يوم الشهر يجب أن يكون بين 1 و 28');
    if (!startDate) throw new BadRequestException('تاريخ البداية مطلوب');
    if (endDate && endDate < startDate) throw new BadRequestException('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية');

    return this.db.transaction(async (client) => {
      // Validate the bank account (type 2, active, same branch, GL-linkable).
      await this.bankGlId(client, bankAccountId, branchId);
      // Validate the expense account: exists, active, NOT a group, type = 5.
      const { rows: acctRows } = await client.query(
        `SELECT a.account_id, a.is_group, a.is_active, a.account_type
           FROM gl_accounts a WHERE a.account_id = $1::int`,
        [expenseAccountId],
      );
      if (!acctRows.length || !acctRows[0].is_active) throw new BadRequestException('حساب المصروف غير موجود أو غير مفعّل');
      if (acctRows[0].is_group) throw new BadRequestException('لا يمكن إسناد مصروف على حساب تجميعي');
      if (Number(acctRows[0].account_type) !== 5) throw new BadRequestException('حساب المصروف يجب أن يكون من نوع مصروفات');

      const inserted = await client.query<{ rule_id: number }>(
        `INSERT INTO bank_expense_rules
           (branch_id, name, description, bank_account_id, expense_account_id, amount,
            frequency, day_of_month, start_date, end_date, counterparty_name, is_active, created_by)
         VALUES ($1::int,$2,$3,$4::int,$5::int,$6::numeric,$7::smallint,$8::smallint,$9::date,$10::date,$11,$12,$13::int)
         RETURNING rule_id`,
        [branchId, name, description, bankAccountId, expenseAccountId, amount.toFixed(2),
          frequency, dayOfMonth, startDate, endDate, counterparty,
          dto?.isActive !== false, user.userId],
      );
      const id = Number(inserted.rows[0].rule_id);
      await this.activity(client, user.userId, branchId, 'bank_expense.create', id,
        `إنشاء قاعدة «${name}» — ${amount} ${FREQ_LABEL[frequency]} يوم ${dayOfMonth} من ${startDate}`);
      return { ruleId: id };
    });
  }

  async update(id: number, dto: any, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(`SELECT * FROM bank_expense_rules WHERE rule_id = $1::int AND branch_id = $2::int FOR UPDATE`, [id, branchId]);
      if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
      const rule = rows[0];
      const postedCount = Number((await client.query(
        `SELECT COUNT(*)::int AS n FROM bank_expense_runs WHERE rule_id = $1::int AND status = 1`,
        [id],
      )).rows[0]?.n ?? 0);

      const name = dto?.name !== undefined ? String(dto.name).trim() : rule.name;
      if (!name) throw new BadRequestException('اسم القاعدة لا يمكن أن يكون فارغًا');
      const description = dto?.description !== undefined ? (dto.description ? String(dto.description) : null) : rule.description;
      const counterparty = dto?.counterpartyName !== undefined ? (dto.counterpartyName ? String(dto.counterpartyName) : null) : rule.counterparty_name;
      let endDate = rule.end_date ? asIsoDate(rule.end_date) : null;
      if (dto?.endDate !== undefined) {
        endDate = dto.endDate ? asIsoDate(dto.endDate) : null;
        if (endDate && asIsoDate(rule.start_date) && endDate < asIsoDate(rule.start_date)!) {
          throw new BadRequestException('تاريخ النهاية لا يمكن أن يكون قبل تاريخ البداية');
        }
      }

      if (postedCount > 0) {
        // Financial shape is frozen after the first generated journal.
        const tried = ['amount', 'expenseAccountId', 'bankAccountId', 'frequency', 'dayOfMonth', 'startDate']
          .filter((key) => dto?.[key] !== undefined);
        if (tried.length) {
          throw new BadRequestException(`هذه القاعدة ولّدت ${postedCount} قيدًا — لا يمكن تعديل (${tried.join('، ')}) بعد التوليد. أنشئ قاعدة جديدة بدلًا من ذلك`);
        }
      } else {
        // Free edits allowed (validated) before the first generation.
        const amount = dto?.amount !== undefined ? num(dto.amount) : num(rule.amount);
        const frequency = dto?.frequency !== undefined ? Number(dto.frequency) : Number(rule.frequency);
        const dayOfMonth = dto?.dayOfMonth !== undefined ? Number(dto.dayOfMonth) : Number(rule.day_of_month);
        const startDate = dto?.startDate !== undefined ? asIsoDate(dto.startDate) : asIsoDate(rule.start_date);
        const bankAccountId = dto?.bankAccountId !== undefined ? Number(dto.bankAccountId) : Number(rule.bank_account_id);
        const expenseAccountId = dto?.expenseAccountId !== undefined ? Number(dto.expenseAccountId) : Number(rule.expense_account_id);
        if (!(amount > 0)) throw new BadRequestException('مبلغ القاعدة يجب أن يكون أكبر من صفر');
        if (![1, 2, 3, 4].includes(frequency)) throw new BadRequestException('التكرار غير صحيح');
        if (!(dayOfMonth >= 1 && dayOfMonth <= 28)) throw new BadRequestException('يوم الشهر يجب أن يكون بين 1 و 28');
        if (!startDate) throw new BadRequestException('تاريخ البداية مطلوب');
        if (endDate && endDate < startDate) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
        await this.bankGlId(client, bankAccountId, branchId);
        const { rows: acctRows } = await client.query(
          `SELECT is_group, is_active, account_type FROM gl_accounts WHERE account_id = $1::int`, [expenseAccountId],
        );
        if (!acctRows.length || !acctRows[0].is_active) throw new BadRequestException('حساب المصروف غير مفعّل');
        if (acctRows[0].is_group) throw new BadRequestException('لا يمكن إسناد مصروف على حساب تجميعي');
        if (Number(acctRows[0].account_type) !== 5) throw new BadRequestException('حساب المصروف يجب أن يكون من نوع مصروفات');
        await client.query(
          `UPDATE bank_expense_rules
              SET bank_account_id = $2::int, expense_account_id = $3::int, amount = $4::numeric,
                  frequency = $5::smallint, day_of_month = $6::smallint, start_date = $7::date
            WHERE rule_id = $1::int`,
          [id, bankAccountId, expenseAccountId, amount.toFixed(2), frequency, dayOfMonth, startDate],
        );
      }

      await client.query(
        `UPDATE bank_expense_rules
            SET name = $2, description = $3, end_date = $4::date, counterparty_name = $5, updated_at = now()
          WHERE rule_id = $1::int`,
        [id, name, description, endDate, counterparty],
      );
      await this.activity(client, user.userId, branchId, 'bank_expense.update', id, `تعديل القاعدة #${id} (${name})`);
      return { ruleId: id };
    });
  }

  async setActive(id: number, dto: any, user: AuthUser, branchId: number) {
    const active = !!dto?.isActive;
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE bank_expense_rules SET is_active = $2::boolean, suspended_at = CASE WHEN $2::boolean THEN NULL ELSE suspended_at END,
                suspended_reason = CASE WHEN $2::boolean THEN NULL ELSE suspended_reason END, updated_at = now()
          WHERE rule_id = $1::int AND branch_id = $3::int RETURNING rule_id, is_active`,
        [id, active, branchId],
      );
      if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
      await this.activity(client, user.userId, branchId, active ? 'bank_expense.activate' : 'bank_expense.deactivate', id,
        `${active ? 'تفعيل' : 'إيقاف'} القاعدة #${id}`);
      return { ruleId: id, isActive: rows[0].is_active };
    });
  }

  async suspend(id: number, dto: any, user: AuthUser, branchId: number) {
    const reason = String(dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('سبب الإيقاف مطلوب');
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE bank_expense_rules SET suspended_at = now(), suspended_reason = $2, updated_at = now()
          WHERE rule_id = $1::int AND branch_id = $3::int RETURNING rule_id`,
        [id, reason, branchId],
      );
      if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
      await this.activity(client, user.userId, branchId, 'bank_expense.suspend', id, `إيقاف القاعدة #${id} — ${reason}`);
      return { ruleId: id, suspended: true };
    });
  }

  async resume(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE bank_expense_rules SET suspended_at = NULL, suspended_reason = NULL, updated_at = now()
          WHERE rule_id = $1::int AND branch_id = $2::int RETURNING rule_id`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
      await this.activity(client, user.userId, branchId, 'bank_expense.resume', id, `استئناف القاعدة #${id}`);
      return { ruleId: id, suspended: false };
    });
  }

  async remove(id: number, user: AuthUser, branchId: number) {
    return this.db.transaction(async (client) => {
      const postedCount = Number((await client.query(
        `SELECT COUNT(*)::int AS n FROM bank_expense_runs WHERE rule_id = $1::int AND status = 1`,
        [id],
      )).rows[0]?.n ?? 0);
      if (postedCount > 0) {
        throw new BadRequestException('لا يمكن حذف قاعدة ولّدت قيودًا — استخدم الإيقاف بدلًا من الحذف');
      }
      const { rows } = await client.query(
        `DELETE FROM bank_expense_rules WHERE rule_id = $1::int AND branch_id = $2::int RETURNING rule_id`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('القاعدة غير موجودة');
      await this.activity(client, user.userId, branchId, 'bank_expense.delete', id, `حذف القاعدة #${id}`);
      return { ruleId: id, deleted: true };
    });
  }

  // ------------------------------------------------------------- generation
  async run(dto: any, user: AuthUser, branchId: number) {
    const asOf = asIsoDate(dto?.asOf) ?? iso(new Date());
    return this.db.transaction(async (client) => {
      const { rows: rules } = await client.query(
        `SELECT r.* FROM bank_expense_rules r
          WHERE r.branch_id = $1::int AND r.is_active = true AND r.suspended_at IS NULL
            AND r.start_date <= $2::date AND (r.end_date IS NULL OR r.end_date >= $2::date)
          ORDER BY r.rule_id`,
        [branchId, asOf],
      );
      const posted: any[] = [];
      const refused: any[] = [];
      // Per-occurrence savepoint: one bad occurrence (unique race, missing mapping, posting
      // failure) must not roll back the whole batch — it is logged refused and the run continues.
      for (const rule of rules) {
        const bankGl = await this.bankGlId(client, Number(rule.bank_account_id), branchId);
        const ruleStart = asIsoDate(rule.start_date)!;
        for (const occIso of occurrences(ruleStart, Number(rule.day_of_month), Number(rule.frequency), asOf)) {
          await client.query('SAVEPOINT e3_occurrence');
          try {
            const exists = await client.query(
              `SELECT 1 FROM bank_expense_runs WHERE rule_id = $1::int AND period_key = $2::date`,
              [rule.rule_id, occIso],
            );
            if (exists.rows.length) { await client.query('RELEASE SAVEPOINT e3_occurrence'); continue; } // already generated — idempotent

            let journalId: number | null = null;
            let status = 1;
            let refusalReason: string | null = null;
            const period = await resolvePeriod(client, branchId, occIso);
            if (period.isClosed) {
              status = 2;
              refusalReason = `الفترة المحاسبية «${period.name}» مقفلة`;
            } else {
              journalId = await postJournal(client, {
                branchId, journalType: 6, journalDate: occIso,
                description: `${rule.name} — ${occIso.slice(0, 7)}`,
                sourceType: 'bank_expense', sourceId: rule.rule_id, userId: user.userId, autoBalance: true,
                lines: [
                  { accountId: Number(rule.expense_account_id), debit: num(rule.amount), description: `${rule.name}${rule.counterparty_name ? ' — ' + rule.counterparty_name : ''}` },
                  { accountId: bankGl, credit: num(rule.amount), description: `${rule.name} — البنك` },
                ],
              });
            }
            await client.query(
              `INSERT INTO bank_expense_runs (rule_id, period_key, status, journal_id, refusal_reason, created_by)
               VALUES ($1::int, $2::date, $3::smallint, $4::bigint, $5::text, $6::int)`,
              [rule.rule_id, occIso, status, journalId, refusalReason, user.userId],
            );
            await client.query('RELEASE SAVEPOINT e3_occurrence');
            if (status === 1) {
              posted.push({ ruleId: rule.rule_id, name: rule.name, periodKey: occIso, journalId, amount: round2(num(rule.amount)) });
            } else {
              refused.push({ ruleId: rule.rule_id, name: rule.name, periodKey: occIso, reason: refusalReason });
            }
          } catch (err: any) {
            await client.query('ROLLBACK TO SAVEPOINT e3_occurrence');
            // Log the refusal WITHOUT failing the batch (concurrent runs hit the unique index here).
            await client.query(
              `INSERT INTO bank_expense_runs (rule_id, period_key, status, journal_id, refusal_reason, created_by)
               VALUES ($1::int, $2::date, 2, NULL, $3, $4::int)
               ON CONFLICT (rule_id, period_key) DO NOTHING`,
              [rule.rule_id, occIso, err?.message ?? 'فشل الترحيل', user.userId],
            );
            refused.push({ ruleId: rule.rule_id, name: rule.name, periodKey: occIso, reason: err?.message ?? 'فشل الترحيل' });
          }
        }
      }
      await this.activity(client, user.userId, branchId, 'bank_expense.run', 0,
        `توليد رسوم بنكية: ${posted.length} قيدًا (${refused.length} مرفوض) حتى ${asOf}`);
      return { asOf, posted, refused };
    });
  }

  /** Lists generated runs (history). */
  listRuns(branchId: number, query: any) {
    const ruleId = query?.ruleId ? Number(query.ruleId) : 0;
    const status = query?.status ? Number(query.status) : 0;
    return this.db.query<any>(
      `SELECT x.run_id AS "runId", x.rule_id AS "ruleId", r.name AS "ruleName",
              x.period_key AS "periodKey", x.status, x.journal_id AS "journalId",
              x.refusal_reason AS "refusalReason", x.run_at AS "runAt"
         FROM bank_expense_runs x
         JOIN bank_expense_rules r ON r.rule_id = x.rule_id
        WHERE r.branch_id = $1::int
          AND ($2::int = 0 OR x.rule_id = $2::int)
          AND ($3::int = 0 OR x.status = $3::int)
        ORDER BY x.run_at DESC, x.run_id DESC LIMIT 200`,
      [branchId, ruleId, status],
    ).then((rows) => rows.map((r) => ({ ...r, statusName: r.status === 1 ? 'مرحّل' : r.status === 2 ? 'مرفوض' : 'معكوس' })));
  }

  /** Reverses a generated occurrence: mirror journal + run marked reversed. */
  async reverseRun(id: number, dto: any, user: AuthUser, branchId: number) {
    const reverseDate = asIsoDate(dto?.date) ?? iso(new Date());
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT x.*, r.branch_id, r.name FROM bank_expense_runs x
          JOIN bank_expense_rules r ON r.rule_id = x.rule_id
          WHERE x.run_id = $1::bigint AND r.branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('سجل التوليد غير موجود');
      const run = rows[0];
      if (Number(run.status) !== 1 || !run.journal_id) {
        throw new BadRequestException('لا يمكن عكس توليد مرفوض أو معكوس مسبقًا');
      }
      const period = await resolvePeriod(client, branchId, reverseDate);
      if (period.isClosed) {
        throw new BadRequestException(`الفترة المحاسبية «${period.name}» مقفلة — لا يمكن العكس فيها`);
      }
      const reverseJournalId = await reverseJournal(client, Number(run.journal_id), {
        userId: user.userId, date: reverseDate,
        description: `عكس قيد مصروف بنكي — ${run.name} (${String(run.period_key).slice(0, 10)})`,
        journalType: 6,
      });
      // Any statement line matched to the reversed journal references a journal whose
      // effect no longer exists — the books no longer support the match, so reopen it.
      if (reverseJournalId && run.journal_id) {
        const { rows: matchedLines } = await client.query(
          `SELECT DISTINCT l.line_id AS "lineId"
             FROM bank_statement_lines l
             JOIN gl_entries e ON e.entry_id = l.matched_entry_id
            WHERE e.journal_id = $1::bigint AND l.status IN (2, 3, 6)`,
          [run.journal_id],
        );
        for (const ml of matchedLines) {
          await client.query(
            `UPDATE bank_statement_lines
                SET status = 1, matched_entry_id = NULL, matched_journal_id = NULL, match_difference = 0
              WHERE line_id = $1::bigint`,
            [ml.lineId],
          );
          await this.activity(client, user.userId, branchId, 'bank_expense.unmatch_on_reverse', ml.lineId,
            `إعادة فتح مطابقة السطر ${ml.lineId} — أُلغي قيد القاعدة #${id} (${run.name})`);
        }
      }
      await client.query(
        `UPDATE bank_expense_runs SET status = 3, refusal_reason = NULL WHERE run_id = $1::bigint`,
        [id],
      );
      await this.activity(client, user.userId, branchId, 'bank_expense.reverse_run', id,
        `عكس توليد #${id} (${run.name}) — ${reverseJournalId ? `قيد عكسي #${reverseJournalId}` : 'بلا قيد'}`);
      return { runId: id, status: 3, reverseJournalId };
    });
  }
}

@Controller('accounting/bank-expense-rules')
export class BankExpensesController {
  constructor(private readonly service: BankExpensesService) {}

  @Get()
  @RequirePermissions('accounting.view')
  list(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.list(branchId, query);
  }

  @Get('runs')
  @RequirePermissions('accounting.view')
  listRuns(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.listRuns(branchId, query);
  }

  @Get(':id/preview')
  @RequirePermissions('accounting.view')
  preview(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.preview(id, branchId);
  }

  @Post()
  @RequirePermissions('accounting.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  @Put(':id')
  @RequirePermissions('accounting.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.update(id, dto, user, branchId);
  }

  @Post(':id/activate')
  @RequirePermissions('accounting.manage')
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.setActive(id, { isActive: true }, user, branchId);
  }

  @Post(':id/deactivate')
  @RequirePermissions('accounting.manage')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.setActive(id, { isActive: false }, user, branchId);
  }

  @Post(':id/suspend')
  @RequirePermissions('accounting.manage')
  suspend(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.suspend(id, dto, user, branchId);
  }

  @Post(':id/resume')
  @RequirePermissions('accounting.manage')
  resume(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.resume(id, user, branchId);
  }

  @Delete(':id')
  @RequirePermissions('accounting.manage')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.remove(id, user, branchId);
  }

  @Post('run')
  @RequirePermissions('accounting.manage')
  run(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.run(dto, user, branchId);
  }

  @Post('runs/:id/reverse')
  @RequirePermissions('accounting.manage')
  reverseRun(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.reverseRun(id, dto, user, branchId);
  }
}

@Module({
  controllers: [BankExpensesController],
  providers: [BankExpensesService],
})
export class BankExpensesModule {}
