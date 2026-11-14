import { BadRequestException } from '@nestjs/common';
import { PoolClient } from 'pg';

/**
 * Double-entry posting engine.
 *
 * Every business document that has a financial impact (invoice, cash
 * movement, salary run…) posts a balanced journal through this module so
 * the general ledger always reconciles with the operational tables.
 *
 * All helpers take a `PoolClient` on purpose: posting must happen inside the
 * same transaction as the document it originates from, so a failed document
 * never leaves a half-posted ledger behind.
 */

export interface JournalLineInput {
  accountId: number;
  debit?: number;
  credit?: number;
  description?: string;
  costCenterId?: number | null;
  partyId?: number | null;
}

export interface JournalInput {
  branchId: number;
  journalDate?: string;
  journalType?: number;
  description?: string;
  sourceType?: string;
  sourceId?: number | bigint | null;
  lines: JournalLineInput[];
  currencyCode?: string;
  exchangeRate?: number;
  userId?: number | null;
  /** Overrides the default `journal:<branch>` numbering sequence. */
  sequenceKey?: string;
  /** Set to false to keep the journal in draft (status 1). */
  post?: boolean;
  /**
   * Allows the engine to absorb a rounding residual of one cent into the
   * largest line. Used by the automatic postings (invoices, vouchers) where
   * the document totals are already rounded; manual journals stay strict.
   */
  autoBalance?: boolean;
}

export interface MappedAccount {
  accountId: number;
  code: string;
  name: string;
  accountType: number;
}

/** Reads a business-concept → GL account mapping. Returns null when unmapped. */
export async function resolveMapping(client: PoolClient, key: string): Promise<MappedAccount | null> {
  const { rows } = await client.query<any>(
    `SELECT a.account_id AS "accountId", a.code, a.name, a.account_type AS "accountType"
       FROM gl_mappings m JOIN gl_accounts a ON a.account_id = m.account_id
      WHERE m.mapping_key = $1`,
    [key],
  );
  return rows.length ? rows[0] : null;
}

/** Same as resolveMapping but throws when the concept is not mapped yet. */
export async function requireMapping(client: PoolClient, key: string, label: string): Promise<MappedAccount> {
  const mapping = await resolveMapping(client, key);
  if (!mapping) {
    throw new BadRequestException(
      `لم يتم ربط الحساب المحاسبي لـ ${label} بعد. أضف الربط من شاشة الإعدادات المحاسبية.`,
    );
  }
  return mapping;
}

/**
 * Finds the accounting period covering `date`.
 * A period with an explicit end date wins over the open-ended catch-all
 * period so that closing a month really locks that month.
 */
export async function resolvePeriod(
  client: PoolClient,
  branchId: number,
  date: string,
): Promise<{ periodId: number | null; isClosed: boolean; name: string | null }> {
  const { rows } = await client.query<any>(
    `SELECT period_id, is_closed, name
       FROM periods
      WHERE branch_id = $1::int
        AND start_date <= $2::date
        AND (end_date IS NULL OR end_date >= $2::date)
      ORDER BY (end_date IS NULL) ASC, start_date DESC
      LIMIT 1`,
    [branchId, date],
  );
  if (!rows.length) return { periodId: null, isClosed: false, name: null };
  return {
    periodId: Number(rows[0].period_id),
    isClosed: !!rows[0].is_closed,
    name: rows[0].name,
  };
}

/** Throws when the target date falls inside a closed accounting period. */
export async function assertPeriodOpen(client: PoolClient, branchId: number, date: string): Promise<number | null> {
  const period = await resolvePeriod(client, branchId, date);
  if (period.isClosed) {
    throw new BadRequestException(`الفترة المحاسبية «${period.name}» مقفلة ولا تقبل ترحيل جديد`);
  }
  return period.periodId;
}

/** Allocates the next journal number for a branch. */
export async function nextJournalNumber(client: PoolClient, branchId: number, sequenceKey?: string): Promise<string> {
  const { rows } = await client.query<{ last_number: string }>(
    `INSERT INTO number_sequences (sequence_key, last_number) VALUES ($1, 1)
     ON CONFLICT (sequence_key) DO UPDATE SET last_number = number_sequences.last_number + 1
     RETURNING last_number`,
    [sequenceKey ?? `journal:${branchId}`],
  );
  const year = new Date().getFullYear();
  return `JV-${year}-${String(rows[0].last_number).padStart(6, '0')}`;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Writes a balanced journal.
 *
 * Rules enforced here (not in the callers):
 *  - at least two lines,
 *  - every line has either a debit or a credit, never both,
 *  - total debits equal total credits,
 *  - the target period is open.
 */
export async function postJournal(client: PoolClient, input: JournalInput): Promise<number> {
  const lines = (input.lines ?? []).filter((line) => line.accountId && Number.isFinite(Number(line.accountId)));
  if (lines.length < 2) throw new BadRequestException('القيد المحاسبي يحتاج سطرين على الأقل');

  let totalDebit = 0;
  let totalCredit = 0;
  const normalised = lines.map((line, index) => {
    const debit = round2(Number(line.debit ?? 0));
    const credit = round2(Number(line.credit ?? 0));
    if (debit < 0 || credit < 0) throw new BadRequestException('قيمة مدين أو دائن سالبة غير مسموحة');
    if (debit === 0 && credit === 0) throw new BadRequestException('سطر بقيمة صفر غير مسموح');
    if (debit > 0 && credit > 0) throw new BadRequestException('السطر لا يكون مدينًا ودائنًا في الوقت نفسه');
    totalDebit += debit;
    totalCredit += credit;
    return { ...line, debit, credit, lineNo: index + 1 };
  });

  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    if (!input.autoBalance || Math.abs(totalDebit - totalCredit) > 0.05) {
      throw new BadRequestException(
        `القيد غير متوازن: المدين ${totalDebit.toFixed(2)} والدائن ${totalCredit.toFixed(2)}`,
      );
    }
    // Absorb the rounding residual into the largest line of the journal.
    const residual = round2(totalDebit - totalCredit);
    let target = normalised[0];
    for (const line of normalised) {
      if (Math.abs(line.debit) + Math.abs(line.credit) > Math.abs(target.debit) + Math.abs(target.credit)) {
        target = line;
      }
    }
    if (target.debit > 0) target.debit = round2(target.debit - residual);
    else target.credit = round2(target.credit + residual);
    totalDebit = normalised.reduce((sum, line) => sum + line.debit, 0);
    totalCredit = normalised.reduce((sum, line) => sum + line.credit, 0);
  }

  const journalDate = input.journalDate ?? new Date().toISOString().slice(0, 10);
  const periodId = await assertPeriodOpen(client, input.branchId, journalDate);
  const journalNo = await nextJournalNumber(client, input.branchId, input.sequenceKey);

  const header = await client.query<{ journal_id: number }>(
    `INSERT INTO gl_journals
       (journal_no, journal_date, journal_type, branch_id, period_id, description, status,
        source_type, source_id, currency_code, exchange_rate, total_debit, total_credit,
        created_by, posted_at)
     VALUES ($1::text, $2::date, $3::int, $4::int, $5::int, $6::text, $7::smallint, $8::text, $9::bigint,
             $10::text, $11::numeric, $12::numeric, $13::numeric, $14::int,
             CASE WHEN $7::smallint = 2 THEN now() ELSE NULL END)
     RETURNING journal_id`,
    [
      journalNo, journalDate, input.journalType ?? 1, input.branchId, periodId,
      input.description ?? null, input.post === false ? 1 : 2,
      input.sourceType ?? null, input.sourceId ?? null,
      input.currencyCode ?? 'EGP', input.exchangeRate ?? 1,
      totalDebit, totalCredit, input.userId ?? null,
    ],
  );
  const journalId = Number(header.rows[0].journal_id);

  for (const line of normalised) {
    await client.query(
      `INSERT INTO gl_entries
         (journal_id, line_no, account_id, debit, credit, description, cost_center_id,
          party_id, branch_id, currency_code, foreign_amount, exchange_rate)
       VALUES ($1::bigint, $2::int, $3::int, $4::numeric, $5::numeric, $6::text, $7::int,
               $8::int, $9::int, $10::text, $11::numeric, $12::numeric)`,
      [
        journalId, line.lineNo, line.accountId, line.debit, line.credit,
        line.description ?? null, line.costCenterId ?? null, line.partyId ?? null,
        input.branchId, input.currencyCode ?? 'EGP', line.debit || line.credit,
        input.exchangeRate ?? 1,
      ],
    );
  }

  return journalId;
}

/**
 * Creates the mirror image of an existing journal (same amounts, swapped
 * sides). Used to reverse a document that was cancelled.
 */
export async function reverseJournal(
  client: PoolClient,
  journalId: number,
  options: { userId?: number | null; date?: string; description?: string; journalType?: number } = {},
): Promise<number | null> {
  const { rows } = await client.query<any>(
    `SELECT j.journal_id, j.branch_id, j.journal_date, j.description,
            e.account_id, e.debit, e.credit, e.description AS line_description,
            e.cost_center_id, e.party_id, e.currency_code, e.exchange_rate
       FROM gl_journals j JOIN gl_entries e ON e.journal_id = j.journal_id
      WHERE j.journal_id = $1::bigint`,
    [journalId],
  );
  if (!rows.length) return null;

  const header = rows[0];
  return postJournal(client, {
    branchId: Number(header.branch_id),
    journalDate: options.date ?? new Date().toISOString().slice(0, 10),
    journalType: options.journalType ?? header.journal_type,
    description: options.description ?? `عكس قيد ${header.description ?? ''}`.trim(),
    sourceType: 'reversal',
    sourceId: journalId,
    userId: options.userId ?? null,
    lines: rows.map((row: any) => ({
      accountId: Number(row.account_id),
      debit: Number(row.credit),
      credit: Number(row.debit),
      description: row.line_description,
      costCenterId: row.cost_center_id,
      partyId: row.party_id,
    })),
  });
}

/** Marks a journal as void without touching the entries (audit friendly). */
export async function voidJournal(client: PoolClient, journalId: number): Promise<void> {
  await client.query(
    `UPDATE gl_journals SET status = 3, posted_at = NULL WHERE journal_id = $1::bigint`,
    [journalId],
  );
}

// --------------------------------------------------------------------- //
//  Document posting
// --------------------------------------------------------------------- //

export interface InvoicePostingInput {
  branchId: number;
  invoiceType: number;          // 1 sale, 2 purchase, 3 sales return, 4 purchase return
  invoiceId: number;
  invoiceNo: string;
  partyId?: number | null;
  cashAccountId?: number | null;
  paidAmount: number;
  remaining: number;
  /** One entry per collected payment (cash, card, bank transfer…). */
  payments?: { glAccountId: number; amount: number }[];
  /** Gross sales value before any discount (quantity × unit price). */
  grossSales: number;
  /** Line discounts + header discount. */
  discountTotal: number;
  /** Discount applied on the invoice header only (used for purchases). */
  headerDiscount?: number;
  /** Tax collected / paid on the document. */
  taxTotal: number;
  /** Delivery fee collected with the order (revenue of its own). */
  deliveryFee?: number;
  /** Restaurant service charge (per guest) — credited to its own account. */
  serviceCharge?: number;
  /** Goods value at cost (used for COGS / inventory). */
  costTotal: number;
  userId?: number | null;
  journalDate?: string;
}

export async function cashAccountGlId(client: PoolClient, cashAccountId?: number | null): Promise<number | null> {
  if (!cashAccountId) return null;
  const { rows } = await client.query<{ gl_account_id: number | null }>(
    'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
    [cashAccountId],
  );
  if (rows.length && rows[0].gl_account_id) return Number(rows[0].gl_account_id);
  const mapping = await resolveMapping(client, 'CASH');
  return mapping?.accountId ?? null;
}

/**
 * Posts the double-entry journal of an invoice.
 *
 * Sale (1)          Dr Cash/AR  ·  Dr Discount allowed ·  Cr Sales ·  Cr VAT output
 *                   Dr Cost of sales · Cr Inventory
 * Purchase (2)      Dr Inventory · Dr VAT input · Cr Cash/AP · Cr Purchase discount
 * Sales return (3)  exact mirror of a sale
 * Purchase ret (4)  exact mirror of a purchase
 *
 * Returns the journal id, or null when general ledger posting is disabled.
 */
export async function postInvoiceJournal(
  client: PoolClient,
  input: InvoicePostingInput,
): Promise<number | null> {
  const enabled = await client.query<{ setting_value: string | null }>(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'EnableGLPosting'`,
  );
  if (enabled.rows.length && enabled.rows[0].setting_value === 'false') return null;

  const isSale = input.invoiceType === 1;
  const isPurchase = input.invoiceType === 2;
  const isSalesReturn = input.invoiceType === 3;
  const isPurchaseReturn = input.invoiceType === 4;
  if (!isSale && !isPurchase && !isSalesReturn && !isPurchaseReturn) return null;

  // Accounts per document type. A return is the exact mirror of its origin.
  const salesKey = isSale ? 'SALES' : 'SALES_RETURNS';
  const vatKey = isSale || isSalesReturn ? 'VAT_OUTPUT' : 'VAT_INPUT';
  const costKey = isSale || isSalesReturn ? 'COGS' : null;
  const receivableKey = isSale || isSalesReturn ? 'AR' : 'AP';
  const discountKey = isSale || isSalesReturn ? 'DISCOUNT' : 'PURCHASE_DISCOUNT';

  const [sales, vat, receivable, discount, stock, cost, cash] = await Promise.all([
    isSale || isSalesReturn
      ? requireMapping(client, salesKey, 'المبيعات')
      : Promise.resolve(null),
    requireMapping(client, vatKey, 'ضريبة القيمة المضافة'),
    requireMapping(client, receivableKey, 'الذمم'),
    requireMapping(client, discountKey, 'الخصم'),
    requireMapping(client, 'INVENTORY', 'المخزون'),
    costKey ? requireMapping(client, costKey, 'تكلفة المبيعات') : Promise.resolve(null),
    cashAccountGlId(client, input.cashAccountId),
  ]);

  const debit: JournalLineInput[] = [];
  const credit: JournalLineInput[] = [];
  const pushDebit = (amount: number, accountId: number, description: string, partyId?: number | null) => {
    if (Math.abs(amount) < 0.005) return;
    debit.push({ accountId, debit: amount, credit: 0, description, partyId: partyId ?? null });
  };
  const pushCredit = (amount: number, accountId: number, description: string, partyId?: number | null) => {
    if (Math.abs(amount) < 0.005) return;
    credit.push({ accountId, debit: 0, credit: amount, description, partyId: partyId ?? null });
  };

  // Revenue side ------------------------------------------------------------
  // Every collected payment has its own account (cash, card settlement…),
  // so the drawer and the ledger always tell the same story.
  const paymentLines = (input.payments ?? []).filter((payment) => payment.amount > 0.004);
  if (!paymentLines.length && input.paidAmount > 0.004 && cash) {
    paymentLines.push({ glAccountId: cash, amount: input.paidAmount });
  }

  if (isSale) {
    for (const payment of paymentLines) {
      pushDebit(payment.amount, payment.glAccountId, 'تحصيل');
    }
    pushDebit(input.remaining, receivable.accountId, 'ذمم عملاء', input.partyId);
    pushDebit(input.discountTotal, discount.accountId, 'خصم مسموح به');
    pushCredit(input.grossSales, sales.accountId, 'إيرادات المبيعات');
    if (Number(input.deliveryFee ?? 0) > 0) {
      const delivery = await resolveMapping(client, 'DELIVERY_FEE');
      pushCredit(
        Number(input.deliveryFee),
        delivery?.accountId ?? sales.accountId,
        'إيرادات التوصيل',
      );
    }
    if (Number(input.serviceCharge ?? 0) > 0) {
      const service = await resolveMapping(client, 'SERVICE_CHARGE');
      if (service) {
        pushCredit(Number(input.serviceCharge), service.accountId, 'إيرادات الخدمة');
      }
    }
    pushCredit(input.taxTotal, vat.accountId, 'ضريبة القيمة المضافة (مخرجات)');
    // Cost of sales
    pushDebit(input.costTotal, cost.accountId, 'تكلفة المبيعات');
    pushCredit(input.costTotal, stock.accountId, 'خروج مخزون');
  } else if (isPurchase) {
    pushDebit(input.costTotal, stock.accountId, 'دخول مخزون');
    pushDebit(input.taxTotal, vat.accountId, 'ضريبة القيمة المضافة (مدخلات)');
    pushCredit(Number(input.headerDiscount ?? 0), discount.accountId, 'خصم الموردين');
    for (const payment of paymentLines) {
      pushCredit(payment.amount, payment.glAccountId, 'سداد');
    }
    pushCredit(input.remaining, receivable.accountId, 'ذمم موردين', input.partyId);
  } else if (isSalesReturn) {
    // Sales return: mirror image of a sale.
    for (const payment of paymentLines) {
      pushCredit(payment.amount, payment.glAccountId, 'سداد مرتجع');
    }
    pushCredit(input.remaining, receivable.accountId, 'ذمم عملاء', input.partyId);
    pushCredit(input.discountTotal, discount.accountId, 'عكس خصم مسموح به');
    pushDebit(input.grossSales, sales.accountId, 'مردودات المبيعات');
    pushDebit(input.taxTotal, vat.accountId, 'عكس ضريبة القيمة المضافة (مخرجات)');
    pushDebit(input.costTotal, stock.accountId, 'دخول مخزون');
    pushCredit(input.costTotal, cost.accountId, 'عكس تكلفة المبيعات');
  } else {
    // Purchase return: mirror image of a purchase.
    for (const payment of paymentLines) {
      pushDebit(payment.amount, payment.glAccountId, 'استرداد');
    }
    pushDebit(input.remaining, receivable.accountId, 'ذمم موردين', input.partyId);
    pushDebit(Number(input.headerDiscount ?? 0), discount.accountId, 'عكس خصم الموردين');
    pushCredit(input.costTotal, stock.accountId, 'خروج مخزون');
    pushCredit(input.taxTotal, vat.accountId, 'عكس ضريبة القيمة المضافة (مدخلات)');
  }

  const lines = [...debit, ...credit];
  if (lines.length < 2) return null;

  return postJournal(client, {
    branchId: input.branchId,
    journalDate: input.journalDate,
    journalType: isSale || input.invoiceType === 3 ? 2 : 3,
    description: `فاتورة ${input.invoiceNo}`,
    sourceType: 'invoice',
    sourceId: input.invoiceId,
    lines,
    userId: input.userId,
  });
}

/**
 * Posts the journal of a treasury movement.
 * `direction` 1 = money in, 2 = money out.
 */
export async function postCashJournal(
  client: PoolClient,
  input: {
    branchId: number;
    direction: number;
    amount: number;
    cashAccountId: number;
    categoryAccountId?: number | null;
    description?: string;
    partyId?: number | null;
    userId?: number | null;
    sourceId?: number | bigint | null;
    sourceType?: string;
    journalDate?: string;
  },
): Promise<number | null> {
  const enabled = await client.query<{ setting_value: string | null }>(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'EnableGLPosting'`,
  );
  if (enabled.rows.length && enabled.rows[0].setting_value === 'false') return null;

  const cash = await cashAccountGlId(client, input.cashAccountId);
  if (!cash) return null;

  const fallbackKey = input.direction === 1 ? 'OTHER_INCOME' : 'OTHER_EXPENSE';
  const counterparty = input.categoryAccountId
    ? { accountId: Number(input.categoryAccountId) }
    : await requireMapping(client, fallbackKey, 'حساب الإيرادات/المصروفات الأخرى');

  const amount = Number(input.amount);
  const lines = input.direction === 1
    ? [
      { accountId: cash, debit: amount, description: input.description ?? 'إيداع' },
      { accountId: counterparty.accountId, credit: amount, partyId: input.partyId ?? null, description: input.description ?? 'إيداع' },
    ]
    : [
      { accountId: counterparty.accountId, debit: amount, partyId: input.partyId ?? null, description: input.description ?? 'سحب' },
      { accountId: cash, credit: amount, description: input.description ?? 'سحب' },
    ];

  return postJournal(client, {
    branchId: input.branchId,
    journalDate: input.journalDate,
    journalType: 4,
    description: input.description ?? (input.direction === 1 ? 'إيداع نقدي' : 'سحب نقدي'),
    sourceType: input.sourceType ?? 'cash',
    sourceId: input.sourceId ?? null,
    lines,
    userId: input.userId,
    autoBalance: true,
  });
}

