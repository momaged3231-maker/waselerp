import {
  BadRequestException, Body, Controller, Get, Injectable, Module,
  Param, ParseIntPipe, Post, Put, Query,
} from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';
import { postJournal, requireMapping, resolvePeriod, reverseJournal } from '../../common/posting';
import { asIsoDate } from '../../common/dates';
import { depreciationForMonth, monthBounds, monthsBetween } from '../../common/depreciation';

/**
 * E5 — Fixed Assets & Depreciation.
 *
 * Depreciation policy (documented decision — the reference spec didn't define one):
 *  - Straight-line (method 1): monthly = (cost − residual) / useful_life_months,
 *    calculated with full precision and rounded to 2dp at posting. The FIRST month
 *    is pro-rated by days in service (daysInService / daysInMonth). The final month
 *    posts only the remaining balance so accumulated never exceeds cost − residual.
 *  - Diminishing balance (method 2): monthly = book_value × (annualRate / 100 / 12).
 *    Never depreciates below residual_value. Same first-month pro-rating applies.
 *  - One journal per asset per month (Dr DEPRECIATION_EXPENSE / Cr ACCUMULATED_DEP),
 *    source_type = 'asset_depreciation', sourceId = asset_id. Run inside ONE
 *    transaction — all assets post or none do.
 *  - asset_depreciation_lines carries a UNIQUE (asset_id, period_month) index —
 *    a duplicated run can never double-post.
 *  - A closed accounting period rejects the whole run with an Arabic message.
 *  - Disposals (sale / write-off) post ONE balanced journal through posting.ts and
 *    never delete history: the disposal row stays linked to both journals.
 */

const round2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const STATUS: Record<number, string> = { 1: 'قيد الاستخدام', 2: 'متوقف', 3: 'مُباع', 4: 'مستبعد', 5: 'منعدم/هالك' };
const METHOD: Record<number, string> = { 1: 'خط مستقيم', 2: 'رصيد متناقص' };
const DISPOSAL: Record<number, string> = { 1: 'بيع', 4: 'هلاك/تفريخ' };

@Injectable()
export class FixedAssetsService {
  constructor(private readonly db: DatabaseService) {}

  private async activity(client: any, userId: number, branchId: number, action: string, entityId: number | string, details: string) {
    try {
      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1::int,$2::int,$3::text,'fixed_asset',$4::bigint,$5::text)`,
        [userId, branchId, action, entityId, details],
      );
    } catch { /* audit must never break the flow */ }
  }

  private async requirePeriodOpen(client: any, branchId: number, date: string) {
    const period = await resolvePeriod(client, branchId, date);
    if (period.isClosed) {
      throw new BadRequestException(`الفترة المحاسبية «${period.name ?? date}» مقفلة — لا يمكن الترحيل فيها`);
    }
    if (period.manualLock) {
      throw new BadRequestException(`الفترة «${period.name ?? date}» مقفولة إداريًا — أزل القفلة الإدارية قبل الترحيل`);
    }
    return period.periodId;
  }

  private async bankGlAccountId(client: any, cashAccountId: number): Promise<{ accountId: number } | null> {
    const { rows } = await client.query(`SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int`, [cashAccountId]);
    if (!rows.length || !rows[0].gl_account_id) return null;
    return { accountId: Number(rows[0].gl_account_id) };
  }

  // ---------------------------------------------------------------- creation
  async create(dto: any, user: AuthUser, branchId: number) {
    const name = String(dto?.name ?? '').trim();
    const category = String(dto?.category ?? '').trim();
    const cost = num(dto?.cost);
    const residual = num(dto?.residualValue ?? dto?.residual_value ?? 0);
    const life = Number(dto?.usefulLifeMonths ?? dto?.useful_life_months);
    const acquisitionDate = asIsoDate(dto?.acquisitionDate);
    const inServiceDate = asIsoDate(dto?.inServiceDate) ?? acquisitionDate;
    const method = Number(dto?.depreciationMethod ?? 1);
    const rate = dto?.depreciationRatePct != null ? Number(dto.depreciationRatePct) : null;
    const paymentType = Number(dto?.paymentType ?? 1);

    if (!name) throw new BadRequestException('اسم الأصل مطلوب');
    if (!category) throw new BadRequestException('فئة الأصل مطلوبة');
    if (!(cost > 0)) throw new BadRequestException('تكلفة الأصل يجب أن تكون أكبر من صفر');
    if (!(residual >= 0)) throw new BadRequestException('القيمة التخريدية لا يمكن أن تكون سالبة');
    if (residual > cost) throw new BadRequestException('القيمة التخريدية لا يمكن أن تتجاوز تكلفة الأصل');
    if (!(life > 0)) throw new BadRequestException('العمر الإنتاجي يجب أن يكون أكبر من صفر شهر');
    if (!acquisitionDate) throw new BadRequestException('تاريخ الاقتناء مطلوب');
    const today = new Date().toISOString().slice(0, 10);
    if (acquisitionDate > today) throw new BadRequestException('لا يمكن تسجيل أصل بتاريخ اقتناء مستقبلي');
    if (inServiceDate < acquisitionDate) throw new BadRequestException('تاريخ بدء الاستخدام لا يمكن أن يسبق تاريخ الاقتناء');
    if (method === 2 && (!rate || !(rate > 0 && rate <= 100))) throw new BadRequestException('طريقة الرصيد المتناقص تتطلب معدل إهلاك سنوي أكبر من صفر وحتى 100%');
    if (paymentType !== 1 && paymentType !== 2) throw new BadRequestException('نوع الدفع: 1 نقدًا أو 2 آجل');
    if (paymentType === 2 && !Number(dto?.supplierId)) throw new BadRequestException('الشراء الآجل يتطلب موردًا');

    return this.db.transaction(async (client) => {
      const assetMapping = await requireMapping(client, 'FIXED_ASSET', 'الأصول الثابتة');
      const accumMapping = await requireMapping(client, 'ACCUMULATED_DEP', 'مجمع إهلاك الأصول');
      const serial = await this.db.nextNumber(client, `asset:${branchId}`);
      const assetCode = `AF-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      const expectedEnd = inServiceDate ? (() => {
        const d = new Date(inServiceDate);
        d.setMonth(d.getMonth() + life);
        return d.toISOString().slice(0, 10);
      })() : null;

      const inserted = await client.query<{ asset_id: number }>(
        `INSERT INTO fixed_assets
           (asset_code, name, category, branch_id, gl_asset_account_id, gl_accumulated_account_id,
            cost, residual_value, useful_life_months, acquisition_date, in_service_date,
            depreciation_method, depreciation_rate_pct, expected_end_date, tag_number,
            responsible_person, supplier_id, supplier_invoice_id, status, notes, created_by)
         VALUES ($1,$2,$3,$4::int,$5::int,$6::int,$7::numeric,$8::numeric,$9::int,$10::date,$11::date,$12::smallint,$13::numeric,$14::date,$15,$16,$17::int,$18::bigint,1,$19,$20::int)
         RETURNING asset_id`,
        [assetCode, name, category, branchId, assetMapping.accountId, accumMapping.accountId,
          cost.toFixed(2), residual.toFixed(2), life, acquisitionDate, inServiceDate,
          method, rate, expectedEnd, dto?.tagNumber ?? null, dto?.responsiblePerson ?? null,
          dto?.supplierId ? Number(dto.supplierId) : null,
          dto?.supplierInvoiceId ? Number(dto.supplierInvoiceId) : null,
          dto?.notes ?? null, user.userId],
      );
      const assetId = Number(inserted.rows[0].asset_id);

      // Acquisition journal — cash or AP.
      const lines: any[] = [
        { accountId: assetMapping.accountId, debit: cost, description: `اقتناء أصل ${assetCode} — ${name}` },
      ];
      if (paymentType === 1) {
        const cashId = Number(dto?.cashAccountId);
        if (!cashId) throw new BadRequestException('الشراء النقدي يتطلب حساب الخزينة');
        const gl = await this.bankGlAccountId(client, cashId);
        if (!gl) throw new BadRequestException('حساب الخزينة غير مربوط بحساب أستاذ');
        lines.push({ accountId: gl.accountId, credit: cost, description: 'اقتناء أصل — نقدًا' });
      } else {
        const apMapping = await requireMapping(client, 'AP', 'ذمم الموردين');
        lines.push({ accountId: apMapping.accountId, credit: cost, partyId: Number(dto.supplierId), description: 'اقتناء أصل — آجل' });
      }
      const journalId = await postJournal(client, {
        branchId, journalType: 6, journalDate: acquisitionDate,
        description: `اقتناء أصل ثابت ${assetCode} — ${name}`,
        sourceType: 'fixed_asset', sourceId: assetId, userId: user.userId, autoBalance: true,
        lines,
      });
      await client.query(`UPDATE fixed_assets SET gl_asset_journal_id = $2::bigint WHERE asset_id = $1::int`, [assetId, journalId]);

      await this.activity(client, user.userId, branchId, 'asset.create', assetId,
        `تسجيل أصل ${assetCode} «${name}» بقيمة ${cost} — قيد الاستحواذ #${journalId}`);
      return { assetId, assetCode, journalId };
    });
  }

  // ---------------------------------------------------------------- queries
  async list(branchId: number, query: any) {
    const category = String(query?.category ?? '').trim();
    const status = query?.status ? Number(query.status) : 0;
    const search = String(query?.search ?? '').trim();
    const like = `%${search}%`;
    const rows = await this.db.query<any>(
      `SELECT a.asset_id AS "assetId", a.asset_code AS "assetCode", a.name, a.category, a.branch_id AS "branchId",
              a.cost, a.residual_value AS "residualValue", a.useful_life_months AS "usefulLifeMonths",
              a.acquisition_date AS "acquisitionDate", a.in_service_date AS "inServiceDate",
              a.depreciation_method AS "depreciationMethod", a.depreciation_rate_pct AS "depreciationRatePct",
              a.expected_end_date AS "expectedEndDate", a.tag_number AS "tagNumber",
              a.responsible_person AS "responsiblePerson", a.status,
              COALESCE((SELECT SUM(d.depreciation_amount) FROM asset_depreciation_lines d WHERE d.asset_id = a.asset_id), 0) AS "accumulatedDepreciation",
              COALESCE((SELECT COUNT(*) FROM asset_depreciation_lines d WHERE d.asset_id = a.asset_id), 0) AS "depreciationMonths"
         FROM fixed_assets a
        WHERE a.branch_id = $1::int
          AND ($2::text = '' OR a.category = $2::text)
          AND ($3::int = 0 OR a.status = $3::int)
          AND ($4::text = '' OR a.name ILIKE $5::text OR a.asset_code ILIKE $5::text OR COALESCE(a.tag_number,'') ILIKE $5::text)
        ORDER BY a.asset_id DESC`,
      [branchId, category, status, search, like],
    );
    return rows.map((r) => this.withComputed(r));
  }

  private withComputed(r: any) {
    const cost = num(r.cost);
    const accumulated = num(r.accumulatedDepreciation);
    const bookValue = round2(cost - accumulated);
    return {
      ...r,
      cost,
      residualValue: num(r.residualValue),
      accumulatedDepreciation: accumulated,
      bookValue,
      statusName: STATUS[Number(r.status)] ?? '?',
      depreciationMethodName: METHOD[Number(r.depreciationMethod)] ?? '?',
      depreciationMonths: Number(r.depreciationMonths ?? 0),
      monthlyDepreciation: num(r.monthlyDepreciation),
    };
  }

  async detail(id: number, branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT a.asset_id AS "assetId", a.asset_code AS "assetCode", a.name, a.category, a.branch_id AS "branchId",
              a.cost, a.residual_value AS "residualValue", a.useful_life_months AS "usefulLifeMonths",
              a.acquisition_date AS "acquisitionDate", a.in_service_date AS "inServiceDate",
              a.depreciation_method AS "depreciationMethod", a.depreciation_rate_pct AS "depreciationRatePct",
              a.expected_end_date AS "expectedEndDate", a.tag_number AS "tagNumber",
              a.responsible_person AS "responsiblePerson", a.status, a.notes,
              a.gl_asset_journal_id AS "glAssetJournalId", a.supplier_id AS "supplierId",              COALESCE((SELECT SUM(d.depreciation_amount) FROM asset_depreciation_lines d WHERE d.asset_id = a.asset_id), 0) AS "accumulatedDepreciation"
         FROM fixed_assets a WHERE a.asset_id = $1::int AND a.branch_id = $2::int`,
      [id, branchId],
    );
    if (!rows.length) throw new BadRequestException('الأصل غير موجود');
    const asset = this.withComputed(rows[0]);
    const lines = await this.db.query<any>(
      `SELECT d.line_id AS "lineId", to_char(d.period_month, 'YYYY-MM') AS "periodMonth",
              d.depreciation_amount AS "depreciationAmount", d.accumulated, d.book_value AS "bookValue",
              d.journal_id AS "journalId"
         FROM asset_depreciation_lines d WHERE d.asset_id = $1::int ORDER BY d.period_month ASC`,
      [id],
    );
    const disposals = await this.db.query<any>(
      `SELECT disposal_id AS "disposalId", disposal_date AS "disposalDate", disposal_type AS "disposalType",
              disposal_amount AS "disposalAmount", cost_basis AS "costBasis", accumulated_basis AS "accumulatedBasis",
              book_value_basis AS "bookValueBasis", gain_loss AS "gainLoss",
              gl_journal_id AS "glJournalId", reverse_journal_id AS "reverseJournalId", reason
         FROM asset_disposals WHERE asset_id = $1::int ORDER BY disposal_id DESC`,
      [id],
    );
    return { asset, lines: lines.map((l) => ({ ...l, periodMonthName: l.periodMonth })), disposals };
  }

  async update(id: number, dto: any, user: AuthUser, branchId: number) {
    const rows = await this.db.query<any>(`SELECT * FROM fixed_assets WHERE asset_id = $1::int AND branch_id = $2::int`, [id, branchId]);
    if (!rows.length) throw new BadRequestException('الأصل غير موجود');
    const asset = rows[0];
    if (Number(asset.status) !== 1) throw new BadRequestException('لا يمكن تعديل أصل مستبعد/مُباع');
    // Only descriptive fields — cost, life, residual, dates and method are frozen after registration.
    if (dto?.cost != null || dto?.usefulLifeMonths != null || dto?.residualValue != null || dto?.acquisitionDate != null || dto?.depreciationMethod != null) {
      throw new BadRequestException('لا يمكن تعديل التكلفة أو العمر أو القيمة التخريدية أو التواريخ بعد التسجيل');
    }
    const tag = dto?.tagNumber !== undefined ? String(dto.tagNumber).trim() || null : asset.tag_number;
    const person = dto?.responsiblePerson !== undefined ? String(dto.responsiblePerson).trim() || null : asset.responsible_person;
    const notes = dto?.notes !== undefined ? String(dto.notes) : asset.notes;
    const category = dto?.category !== undefined ? String(dto.category).trim() : asset.category;
    if (!category) throw new BadRequestException('الفئة مطلوبة');
    await this.db.query(
      `UPDATE fixed_assets SET tag_number = $2, responsible_person = $3, notes = $4, category = $5, updated_at = now() WHERE asset_id = $1::int`,
      [id, tag, person, notes, category],
    );
    await this.db.query(
      `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
       VALUES ($1::int,$2::int,'asset.update','fixed_asset',$3::bigint,$4)`,
      [user.userId, branchId, id, 'تعديل بيانات الأصل التشغيلية'],
    );
    return { assetId: id };
  }

  // ------------------------------------------------------------ depreciation
  async previewDepreciation(branchId: number, query: any) {
    const { monthDate } = monthBounds(String(query?.month ?? ''));
    const assets = await this.db.query<any>(
      `SELECT a.* FROM fixed_assets a
        WHERE a.branch_id = $1::int AND a.status = 1 AND a.in_service_date <= $2::date
          AND NOT EXISTS (SELECT 1 FROM asset_depreciation_lines d WHERE d.asset_id = a.asset_id AND d.period_month = $3::date)
        ORDER BY a.asset_id`,
      [branchId, monthDate, monthDate],
    );
    const rows = [];
    for (const asset of assets) {
      const priorRow = await this.db.one<{ acc: string | null }>(
        `SELECT COALESCE(SUM(depreciation_amount), 0)::numeric acc FROM asset_depreciation_lines WHERE asset_id = $1::int`,
        [asset.asset_id],
      );
      const amount = this.depreciationForMonth(asset, monthDate, num(priorRow?.acc));
      if (amount > 0) rows.push({ assetId: asset.asset_id, assetCode: asset.asset_code, name: asset.name, amount, monthly: amount });
    }
    return { month: monthDate.slice(0, 7), assets: rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)) };
  }

  async runDepreciation(dto: any, user: AuthUser, branchId: number) {
    const { first, last, monthDate, days } = monthBounds(String(dto?.periodMonth ?? ''));
    return this.db.transaction(async (client) => {
      await this.requirePeriodOpen(client, branchId, last);
      const assets = await client.query<any>(
        `SELECT a.* FROM fixed_assets a
          WHERE a.branch_id = $1::int AND a.status = 1 AND a.in_service_date <= $2::date
          ORDER BY a.asset_id`,
        [branchId, last],
      );
      const accumMapping = await requireMapping(client, 'ACCUMULATED_DEP', 'مجمع إهلاك الأصول');
      const depMapping = await requireMapping(client, 'DEPRECIATION_EXPENSE', 'مصروف الإهلاك');
      const posted: any[] = [];
      const skipped: any[] = [];
      let total = 0;
      for (const asset of assets.rows) {
        const exists = await client.query(
          `SELECT 1 FROM asset_depreciation_lines WHERE asset_id = $1::int AND period_month = $2::date`,
          [asset.asset_id, monthDate],
        );
        if (exists.rows.length) { skipped.push({ assetId: asset.asset_id, reason: 'مُقيّد مسبقًا' }); continue; }
        const priorRow = await client.query<{ acc: string | null }>(
          `SELECT COALESCE(SUM(depreciation_amount), 0)::numeric acc FROM asset_depreciation_lines WHERE asset_id = $1::int`,
          [asset.asset_id],
        );
        const priorAccum = num(priorRow.rows[0].acc);
        const amount = this.depreciationForMonth(asset, monthDate, priorAccum);
        if (!(amount > 0)) { skipped.push({ assetId: asset.asset_id, reason: 'مستهلَك بالكامل أو غير مستحق' }); continue; }
        const journalId = await postJournal(client, {
          branchId, journalType: 6, journalDate: last,
          description: `إهلاك ${String(asset.asset_code)} — ${String(asset.name)} — ${monthDate.slice(0, 7)}`,
          sourceType: 'asset_depreciation', sourceId: asset.asset_id, userId: user.userId, autoBalance: true,
          lines: [
            { accountId: depMapping.accountId, debit: amount, description: `إهلاك أصل ${asset.asset_code}` },
            { accountId: accumMapping.accountId, credit: amount, description: `مجمع إهلاك ${asset.asset_code}` },
          ],
        });
        const accumulated = round2(priorAccum + amount);
        const bookValue = round2(num(asset.cost) - accumulated);
        await client.query(
          `INSERT INTO asset_depreciation_lines (asset_id, period_month, depreciation_amount, accumulated, book_value, journal_id)
           VALUES ($1::int, $2::date, $3::numeric, $4::numeric, $5::numeric, $6::bigint)`,
          [asset.asset_id, monthDate, amount.toFixed(2), accumulated.toFixed(2), bookValue.toFixed(2), journalId],
        );
        total = round2(total + amount);
        posted.push({ assetId: asset.asset_id, assetCode: asset.asset_code, amount, journalId });
      }
      await this.activity(client, user.userId, branchId, 'asset.run_depreciation', 0,
        `إهلاك ${monthDate.slice(0, 7)}: ${posted.length} أصلًا بقيمة ${total} — ${skipped.length} متخطى`);
      return { month: monthDate.slice(0, 7), posted, skipped, total };
    });
  }

  /** Delegates to the shared deterministic calculator in common/depreciation.ts
   *  (same math the E6 pre-close gate uses to decide what is due). */
  depreciationForMonth(asset: any, monthDate: string, priorAccumulated: number): number {
    return depreciationForMonth(asset, monthDate, priorAccumulated);
  }

  // --------------------------------------------------------------- disposal
  async dispose(id: number, dto: any, user: AuthUser, branchId: number) {
    const disposalType = Number(dto?.disposalType ?? 1);
    if (disposalType !== 1 && disposalType !== 4) throw new BadRequestException('نوع الاستبعاد: 1 بيع أو 4 هلاك/تفريخ');
    const disposalDate = asIsoDate(dto?.disposalDate) ?? new Date().toISOString().slice(0, 10);
    const proceeds = disposalType === 1 ? num(dto?.disposalAmount) : 0;
    if (disposalType === 1 && !(proceeds >= 0)) throw new BadRequestException('قيمة البيع لا يمكن أن تكون سالبة');
    if (disposalType === 1 && dto?.cashAccountId == null && dto?.partyId == null) {
      throw new BadRequestException('البيع يتطلب حساب الخزينة أو العميل (آجل)');
    }

    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM fixed_assets WHERE asset_id = $1::int AND branch_id = $2::int FOR UPDATE`,
        [id, branchId],
      );
      if (!rows.length) throw new BadRequestException('الأصل غير موجود');
      const asset = rows[0];
      if (Number(asset.status) !== 1 && Number(asset.status) !== 2) {
        throw new BadRequestException('لا يمكن استبعاد أصل مُباع أو مستبعد بالفعل');
      }
      await this.requirePeriodOpen(client, branchId, disposalDate);

      const prior = await client.query<{ acc: string | null }>(
        `SELECT COALESCE(SUM(depreciation_amount), 0)::numeric acc FROM asset_depreciation_lines WHERE asset_id = $1::int`,
        [id],
      );
      const accumulated = round2(num(prior.rows[0].acc));
      const cost = num(asset.cost);
      const bookValue = round2(cost - accumulated);
      const gainLoss = round2(proceeds - bookValue);

      const accumMapping = await requireMapping(client, 'ACCUMULATED_DEP', 'مجمع إهلاك الأصول');
      const assetMapping = await requireMapping(client, 'FIXED_ASSET', 'الأصول الثابتة');
      const otherIncome = await requireMapping(client, 'OTHER_INCOME', 'إيرادات أخرى');
      const otherExpense = await requireMapping(client, 'OTHER_EXPENSE', 'مصروفات إدارية');

      const lines: any[] = [];
      if (accumulated > 0) lines.push({ accountId: accumMapping.accountId, debit: accumulated, description: 'إهلاك متراكم — استبعاد أصل' });
      if (proceeds > 0) {
        if (dto?.cashAccountId) {
          const gl = await this.bankGlAccountId(client, Number(dto.cashAccountId));
          if (!gl) throw new BadRequestException('حساب الخزينة غير مربوط بحساب أستاذ');
          lines.push({ accountId: gl.accountId, debit: proceeds, description: 'حصيلة بيع أصل' });
        } else {
          const ar = await requireMapping(client, 'AR', 'ذمم العملاء');
          lines.push({ accountId: ar.accountId, debit: proceeds, partyId: Number(dto.partyId), description: 'حصيلة بيع أصل — آجل' });
        }
      }
      if (bookValue > proceeds) lines.push({ accountId: otherExpense.accountId, debit: round2(bookValue - proceeds), description: 'خسارة استبعاد أصل' });
      lines.push({ accountId: assetMapping.accountId, credit: cost, description: 'استبعاد أصل — تكلفة' });
      if (proceeds > bookValue) lines.push({ accountId: otherIncome.accountId, credit: round2(proceeds - bookValue), description: 'ربح استبعاد أصل' });

      const journalId = await postJournal(client, {
        branchId, journalType: 6, journalDate: disposalDate,
        description: `${disposalType === 1 ? 'بيع' : 'هلاك/تفريخ'} أصل ${asset.asset_code} — ${asset.name}`,
        sourceType: 'asset_disposal', sourceId: id, userId: user.userId, autoBalance: true,
        lines,
      });

      await client.query(
        `INSERT INTO asset_disposals (asset_id, disposal_date, disposal_type, disposal_amount, cost_basis, accumulated_basis, book_value_basis, gain_loss, gl_journal_id, reason, created_by)
         VALUES ($1::int,$2::date,$3::smallint,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::numeric,$9::bigint,$10,$11::int)`,
        [id, disposalDate, disposalType, proceeds.toFixed(2), cost.toFixed(2), accumulated.toFixed(2),
          bookValue.toFixed(2), gainLoss.toFixed(2), journalId, dto?.reason ?? null, user.userId],
      );
      await client.query(
        `UPDATE fixed_assets SET status = $2::smallint, updated_at = now() WHERE asset_id = $1::int`,
        [id, disposalType === 1 ? 3 : 5],
      );
      await this.activity(client, user.userId, branchId, 'asset.dispose', id,
        `${disposalType === 1 ? 'بيع' : 'هلاك/تفريخ'} أصل ${asset.asset_code} بمبلغ ${proceeds} (دفترك ${bookValue}) — قيد #${journalId}`);
      return { disposalId: id, journalId, bookValue, accumulated, proceeds, gainLoss };
    });
  }

  async reverseDisposal(id: number, dto: any, user: AuthUser, branchId: number) {
    const reverseDate = asIsoDate(dto?.date) ?? new Date().toISOString().slice(0, 10);
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT d.* FROM asset_disposals d WHERE d.asset_id = $1::int AND d.reverse_journal_id IS NULL ORDER BY d.disposal_id DESC LIMIT 1`,
        [id],
      );
      if (!rows.length) throw new BadRequestException('لا توجد عملية استبعاد لعكسه');
      const disposal = rows[0];
      await this.requirePeriodOpen(client, branchId, reverseDate);
      const reverseJournalId = disposal.gl_journal_id
        ? await reverseJournal(client, Number(disposal.gl_journal_id), {
            userId: user.userId, date: reverseDate,
            description: `عكس استبعاد أصل #${id}`,
            journalType: 6,
          })
        : null;
      await client.query(
        `UPDATE asset_disposals SET reverse_journal_id = $2::bigint WHERE disposal_id = $1::bigint`,
        [disposal.disposal_id, reverseJournalId],
      );
      await client.query(
        `UPDATE fixed_assets SET status = 1, updated_at = now() WHERE asset_id = $1::int`,
        [id],
      );
      await this.activity(client, user.userId, branchId, 'asset.reverse_disposal', id,
        `عكس استبعاد الأصل — ${reverseJournalId ? `قيد عكسي #${reverseJournalId}` : 'بلا قيد'}`);
      return { assetId: id, reverseJournalId };
    });
  }

  // --------------------------------------------------------------- reports
  async schedule(branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT a.asset_id AS "assetId", a.asset_code AS "assetCode", a.name, a.category,
              a.cost, a.residual_value AS "residualValue", a.useful_life_months AS "usefulLifeMonths",
              a.in_service_date AS "inServiceDate", a.depreciation_method AS "depreciationMethod",
              a.expected_end_date AS "expectedEndDate", a.status,
              COALESCE((SELECT SUM(d.depreciation_amount) FROM asset_depreciation_lines d WHERE d.asset_id = a.asset_id), 0) AS "accumulatedDepreciation"
         FROM fixed_assets a WHERE a.branch_id = $1::int ORDER BY a.category, a.asset_code`,
      [branchId],
    );
    return rows.map((r) => {
      const cost = num(r.cost);
      const accumulated = num(r.accumulatedDepreciation);
      const bookValue = round2(cost - accumulated);
      const monthsUsed = Math.floor(monthsBetween((asIsoDate(r.inServiceDate) ?? '').slice(0, 7), new Date().toISOString().slice(0, 7)));
      return {
        ...r, cost, accumulatedDepreciation: accumulated, bookValue,
        remainingMonths: Math.max(0, Number(r.usefulLifeMonths) - Math.max(0, monthsUsed)),
        statusName: STATUS[Number(r.status)] ?? '?',
        depreciationMethodName: METHOD[Number(r.depreciationMethod)] ?? '?',
      };
    });
  }

  async summary(branchId: number) {
    const totals = await this.db.query<any>(
      `SELECT COALESCE(SUM(a.cost), 0)::numeric "totalCost",
              COALESCE((SELECT SUM(d.depreciation_amount) FROM asset_depreciation_lines d
                         JOIN fixed_assets a2 ON a2.asset_id = d.asset_id
                        WHERE a2.branch_id = $1::int AND a2.status = 1), 0)::numeric "totalAccumulated",
              COUNT(*)::int "assetCount",
              COUNT(*)::int "inServiceCount"
         FROM fixed_assets a WHERE a.branch_id = $1::int AND a.status = 1`,
      [branchId],
    );
    const gl = await this.db.query<any>(
      `SELECT a.code,
              COALESCE(SUM(e.debit), 0)::numeric "debit",
              COALESCE(SUM(e.credit), 0)::numeric "credit"
         FROM gl_accounts a
         LEFT JOIN gl_entries e ON e.account_id = a.account_id
         JOIN gl_journals j ON j.journal_id = e.journal_id AND j.status = 2
        WHERE a.code IN ('1201', '1202', '5108')
        GROUP BY a.code ORDER BY a.code`,
    );
    const glMap = new Map(gl.map((g) => [g.code, g]));
    const t = totals[0] ?? { totalCost: 0, totalAccumulated: 0, assetCount: 0, inServiceCount: 0 };
    const glAsset = num(glMap.get('1201')?.debit) - num(glMap.get('1201')?.credit);
    const glAccum = num(glMap.get('1202')?.credit) - num(glMap.get('1202')?.debit);
    const glDepreciation = num(glMap.get('5108')?.debit) - num(glMap.get('5108')?.credit);
    const totalCost = num(t.totalCost);
    const totalAccumulated = num(t.totalAccumulated);
    return {
      assetCount: Number(t.assetCount),
      inServiceCount: Number(t.inServiceCount),
      totalCost,
      totalAccumulated,
      bookValue: round2(totalCost - totalAccumulated),
      gl: { fixedAsset: round2(glAsset), accumulatedDep: round2(glAccum), depreciationExpense: round2(glDepreciation) },
      // Reconciliation: SUM(book_value) per the register == GL 1201 − GL 1202 (asset and contra-asset)
      registerMatchesGl: Math.abs((totalCost - totalAccumulated) - (glAsset - glAccum)) < 0.01,
    };
  }
}

@Controller('accounting/assets')
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get()
  @RequirePermissions('assets.view')
  list(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.list(branchId, query);
  }

  @Get('report/schedule')
  @RequirePermissions('assets.view')
  schedule(@CurrentBranch() branchId: number) {
    return this.service.schedule(branchId);
  }

  @Get('report/summary')
  @RequirePermissions('assets.view')
  summary(@CurrentBranch() branchId: number) {
    return this.service.summary(branchId);
  }

  @Get('depreciation/preview')
  @RequirePermissions('assets.manage')
  previewDepreciation(@Query() query: any, @CurrentBranch() branchId: number) {
    return this.service.previewDepreciation(branchId, query);
  }

  @Get(':id')
  @RequirePermissions('assets.view')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentBranch() branchId: number) {
    return this.service.detail(id, branchId);
  }

  @Post()
  @RequirePermissions('assets.manage')
  create(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  @Put(':id')
  @RequirePermissions('assets.manage')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.update(id, dto, user, branchId);
  }

  @Post('run-depreciation')
  @RequirePermissions('assets.manage')
  runDepreciation(@Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.runDepreciation(dto, user, branchId);
  }

  @Post(':id/dispose')
  @RequirePermissions('assets.manage')
  dispose(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.dispose(id, dto, user, branchId);
  }

  @Post(':id/reverse-disposal')
  @RequirePermissions('assets.manage')
  reverseDisposal(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.reverseDisposal(id, dto, user, branchId);
  }
}

@Module({
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
})
export class FixedAssetsModule {}
