import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { buildXlsx, type XlsxSheet } from '../../common/xlsx';
import { AuthUser, CurrentBranch, CurrentUser, RequirePermissions } from '../../common/security';

type DatasetKey =
  | 'sales_invoices'
  | 'purchase_invoices'
  | 'invoice_lines'
  | 'items'
  | 'parties'
  | 'cash'
  | 'stock'
  | 'crm_leads'
  | 'crm_tickets';

interface DatasetDef {
  title: string;
  from: string;
  branchColumn?: string;
  columns: Record<string, { label: string; expr: string; type?: 'number' | 'date' | 'text' }>;
  dateColumn?: string;
}

const DATASETS: Record<DatasetKey, DatasetDef> = {
  sales_invoices: {
    title: 'فواتير المبيعات',
    from: `FROM invoices i
           LEFT JOIN parties p ON p.party_id = i.party_id
           LEFT JOIN branches b ON b.branch_id = i.branch_id
           LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id`,
    branchColumn: 'i.branch_id',
    dateColumn: 'i.invoice_date',
    columns: {
      invoiceNo: { label: 'رقم الفاتورة', expr: 'i.invoice_no', type: 'text' },
      invoiceDate: { label: 'التاريخ', expr: 'i.invoice_date::date', type: 'date' },
      partyName: { label: 'العميل', expr: "COALESCE(p.name,'')", type: 'text' },
      branchName: { label: 'الفرع', expr: "COALESCE(b.name,'')", type: 'text' },
      warehouseName: { label: 'المخزن', expr: "COALESCE(w.name,'')", type: 'text' },
      subTotal: { label: 'الإجمالي قبل الخصم', expr: 'i.sub_total', type: 'number' },
      discountAmount: { label: 'الخصم', expr: 'i.discount_amount', type: 'number' },
      taxAmount: { label: 'الضريبة', expr: 'i.tax_amount', type: 'number' },
      totalAmount: { label: 'الإجمالي', expr: 'i.total_amount', type: 'number' },
      paidAmount: { label: 'المدفوع', expr: 'i.paid_amount', type: 'number' },
      remaining: { label: 'المتبقي', expr: '(i.total_amount - i.paid_amount)', type: 'number' },
      profitAmount: { label: 'الربح', expr: 'i.profit_amount', type: 'number' },
      status: { label: 'الحالة', expr: 'i.status', type: 'number' },
    },
  },
  purchase_invoices: {
    title: 'فواتير المشتريات',
    from: `FROM invoices i
           LEFT JOIN parties p ON p.party_id = i.party_id
           LEFT JOIN branches b ON b.branch_id = i.branch_id
           LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id`,
    branchColumn: 'i.branch_id',
    dateColumn: 'i.invoice_date',
    columns: {
      invoiceNo: { label: 'رقم الفاتورة', expr: 'i.invoice_no', type: 'text' },
      invoiceDate: { label: 'التاريخ', expr: 'i.invoice_date::date', type: 'date' },
      partyName: { label: 'المورد', expr: "COALESCE(p.name,'')", type: 'text' },
      branchName: { label: 'الفرع', expr: "COALESCE(b.name,'')", type: 'text' },
      warehouseName: { label: 'المخزن', expr: "COALESCE(w.name,'')", type: 'text' },
      subTotal: { label: 'الإجمالي قبل الخصم', expr: 'i.sub_total', type: 'number' },
      discountAmount: { label: 'الخصم', expr: 'i.discount_amount', type: 'number' },
      taxAmount: { label: 'الضريبة', expr: 'i.tax_amount', type: 'number' },
      totalAmount: { label: 'الإجمالي', expr: 'i.total_amount', type: 'number' },
      paidAmount: { label: 'المدفوع', expr: 'i.paid_amount', type: 'number' },
      remaining: { label: 'المتبقي', expr: '(i.total_amount - i.paid_amount)', type: 'number' },
      status: { label: 'الحالة', expr: 'i.status', type: 'number' },
    },
  },
  invoice_lines: {
    title: 'بنود الفواتير',
    from: `FROM invoice_lines l
           JOIN invoices i ON i.invoice_id = l.invoice_id
           LEFT JOIN items it ON it.item_id = l.item_id
           LEFT JOIN units u ON u.unit_id = l.unit_id
           LEFT JOIN parties p ON p.party_id = i.party_id
           LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id`,
    branchColumn: 'i.branch_id',
    dateColumn: 'i.invoice_date',
    columns: {
      invoiceNo: { label: 'رقم الفاتورة', expr: 'i.invoice_no', type: 'text' },
      invoiceType: { label: 'نوع الفاتورة', expr: 'i.invoice_type', type: 'number' },
      invoiceDate: { label: 'التاريخ', expr: 'i.invoice_date::date', type: 'date' },
      partyName: { label: 'الطرف', expr: "COALESCE(p.name,'')", type: 'text' },
      itemCode: { label: 'كود الصنف', expr: "COALESCE(it.code,'')", type: 'text' },
      itemName: { label: 'الصنف', expr: "COALESCE(it.name,'')", type: 'text' },
      unitName: { label: 'الوحدة', expr: "COALESCE(u.name,'')", type: 'text' },
      quantity: { label: 'الكمية', expr: 'l.quantity', type: 'number' },
      unitPrice: { label: 'السعر', expr: 'l.unit_price', type: 'number' },
      discountAmount: { label: 'خصم السطر', expr: 'l.discount_amount', type: 'number' },
      taxAmount: { label: 'ضريبة السطر', expr: 'l.tax_amount', type: 'number' },
      lineTotal: { label: 'إجمالي السطر', expr: 'l.line_total', type: 'number' },
      unitCost: { label: 'تكلفة الوحدة', expr: 'l.unit_cost', type: 'number' },
      warehouseName: { label: 'المخزن', expr: "COALESCE(w.name,'')", type: 'text' },
    },
  },
  items: {
    title: 'الأصناف',
    from: `FROM items i
           LEFT JOIN categories c ON c.category_id = i.category_id
           LEFT JOIN units u ON u.unit_id = i.base_unit_id`,
    columns: {
      code: { label: 'الكود', expr: 'i.code', type: 'text' },
      name: { label: 'الاسم', expr: 'i.name', type: 'text' },
      categoryName: { label: 'الفئة', expr: "COALESCE(c.name,'')", type: 'text' },
      unitName: { label: 'الوحدة', expr: "COALESCE(u.name,'')", type: 'text' },
      costPrice: { label: 'سعر التكلفة', expr: 'i.cost_price', type: 'number' },
      sellPrice: { label: 'سعر البيع', expr: 'i.sell_price', type: 'number' },
      vatPct: { label: 'ضريبة %', expr: 'i.vat_pct', type: 'number' },
      reorderPoint: { label: 'حد الطلب', expr: 'i.reorder_point', type: 'number' },
      isActive: { label: 'نشط', expr: 'CASE WHEN i.is_active THEN 1 ELSE 0 END', type: 'number' },
    },
  },
  parties: {
    title: 'العملاء والموردون',
    from: `FROM parties p
           LEFT JOIN branches b ON b.branch_id = p.branch_id`,
    branchColumn: 'p.branch_id',
    columns: {
      code: { label: 'الكود', expr: "COALESCE(p.code,'')", type: 'text' },
      name: { label: 'الاسم', expr: 'p.name', type: 'text' },
      partyType: { label: 'النوع', expr: 'p.party_type', type: 'number' },
      phone: { label: 'الهاتف', expr: "COALESCE(p.phone,'')", type: 'text' },
      mobile: { label: 'الجوال', expr: "COALESCE(p.mobile,'')", type: 'text' },
      branchName: { label: 'الفرع', expr: "COALESCE(b.name,'')", type: 'text' },
      creditLimit: { label: 'حد الائتمان', expr: 'p.credit_limit', type: 'number' },
      openingBalance: { label: 'الرصيد الافتتاحي', expr: 'p.opening_balance', type: 'number' },
      isActive: { label: 'نشط', expr: 'CASE WHEN p.is_active THEN 1 ELSE 0 END', type: 'number' },
    },
  },
  cash: {
    title: 'حركات الخزينة',
    from: `FROM cash_transactions t
           LEFT JOIN cash_accounts a ON a.cash_account_id = t.cash_account_id
           LEFT JOIN cash_categories c ON c.cash_category_id = t.category_id
           LEFT JOIN parties p ON p.party_id = t.party_id`,
    branchColumn: 't.branch_id',
    dateColumn: 't.transaction_date',
    columns: {
      transactionDate: { label: 'التاريخ', expr: 't.transaction_date::date', type: 'date' },
      accountName: { label: 'الحساب', expr: "COALESCE(a.name,'')", type: 'text' },
      direction: { label: 'الاتجاه', expr: 't.direction', type: 'number' },
      amount: { label: 'المبلغ', expr: 't.amount', type: 'number' },
      categoryName: { label: 'التصنيف', expr: "COALESCE(c.name,'')", type: 'text' },
      partyName: { label: 'الطرف', expr: "COALESCE(p.name,'')", type: 'text' },
      description: { label: 'الوصف', expr: "COALESCE(t.description,'')", type: 'text' },
    },
  },
  stock: {
    title: 'أرصدة المخزون',
    from: `FROM item_warehouse_qty q
           JOIN items i ON i.item_id = q.item_id
           JOIN warehouses w ON w.warehouse_id = q.warehouse_id
           LEFT JOIN categories c ON c.category_id = i.category_id
           LEFT JOIN units u ON u.unit_id = q.unit_id`,
    branchColumn: 'w.branch_id',
    columns: {
      itemCode: { label: 'كود الصنف', expr: 'i.code', type: 'text' },
      itemName: { label: 'الصنف', expr: 'i.name', type: 'text' },
      categoryName: { label: 'الفئة', expr: "COALESCE(c.name,'')", type: 'text' },
      warehouseName: { label: 'المخزن', expr: 'w.name', type: 'text' },
      unitName: { label: 'الوحدة', expr: "COALESCE(u.name,'')", type: 'text' },
      onHandQty: { label: 'الرصيد', expr: 'q.on_hand_qty', type: 'number' },
      avgCost: { label: 'متوسط التكلفة', expr: 'q.avg_cost', type: 'number' },
      stockValue: { label: 'قيمة المخزون', expr: '(q.on_hand_qty * q.avg_cost)', type: 'number' },
    },
  },
  crm_leads: {
    title: 'عملاء CRM المحتملون',
    from: `FROM crm_leads l
           LEFT JOIN crm_sources s ON s.source_id = l.source_id
           LEFT JOIN users u ON u.user_id = l.assigned_to
           LEFT JOIN parties p ON p.party_id = l.party_id`,
    branchColumn: 'l.branch_id',
    dateColumn: 'l.created_at',
    columns: {
      leadId: { label: 'المعرف', expr: 'l.lead_id', type: 'number' },
      name: { label: 'الاسم', expr: 'l.name', type: 'text' },
      company: { label: 'الشركة', expr: "COALESCE(l.company,'')", type: 'text' },
      phone: { label: 'الهاتف', expr: "COALESCE(l.phone,'')", type: 'text' },
      email: { label: 'البريد', expr: "COALESCE(l.email,'')", type: 'text' },
      sourceName: { label: 'المصدر', expr: "COALESCE(s.name,'')", type: 'text' },
      stage: { label: 'المرحلة', expr: 'l.stage', type: 'number' },
      expectedValue: { label: 'القيمة المتوقعة', expr: 'l.expected_value', type: 'number' },
      assignedName: { label: 'المسؤول', expr: "COALESCE(u.full_name,'')", type: 'text' },
      partyName: { label: 'العميل المحوّل', expr: "COALESCE(p.name,'')", type: 'text' },
      createdAt: { label: 'تاريخ الإنشاء', expr: 'l.created_at::date', type: 'date' },
      convertedAt: { label: 'تاريخ التحويل', expr: 'l.converted_at::date', type: 'date' },
    },
  },
  crm_tickets: {
    title: 'تذاكر CRM',
    from: `FROM crm_tickets t
           LEFT JOIN crm_leads l ON l.lead_id = t.lead_id
           LEFT JOIN parties p ON p.party_id = t.party_id
           LEFT JOIN users u ON u.user_id = t.assigned_to`,
    branchColumn: 't.branch_id',
    dateColumn: 't.created_at',
    columns: {
      ticketId: { label: 'المعرف', expr: 't.ticket_id', type: 'number' },
      subject: { label: 'الموضوع', expr: 't.subject', type: 'text' },
      status: { label: 'الحالة', expr: 't.status', type: 'number' },
      priority: { label: 'الأولوية', expr: 't.priority', type: 'number' },
      leadName: { label: 'عميل محتمل', expr: "COALESCE(l.name,'')", type: 'text' },
      partyName: { label: 'عميل', expr: "COALESCE(p.name,'')", type: 'text' },
      assignedName: { label: 'المسؤول', expr: "COALESCE(u.full_name,'')", type: 'text' },
      createdAt: { label: 'تاريخ الإنشاء', expr: 't.created_at::date', type: 'date' },
      closedAt: { label: 'تاريخ الإغلاق', expr: 't.closed_at::date', type: 'date' },
    },
  },
};

function defaultColumnsFor(dataset: DatasetKey): string[] {
  return Object.keys(DATASETS[dataset].columns).slice(0, 8);
}

@Injectable()
export class ReportBuilderService {
  constructor(private readonly db: DatabaseService) {}

  datasets() {
    return (Object.keys(DATASETS) as DatasetKey[]).map((key) => {
      const def = DATASETS[key];
      return {
        key,
        title: def.title,
        columns: Object.entries(def.columns).map(([id, c]) => ({ id, label: c.label, type: c.type ?? 'text' })),
        supportsDate: !!def.dateColumn,
      };
    });
  }

  async listDefinitions() {
    return this.db.query<any>(
      `SELECT d.definition_id AS "definitionId", d.name, d.dataset, d.config,
              d.created_at AS "createdAt", d.updated_at AS "updatedAt",
              u.full_name AS "createdBy"
         FROM report_definitions d
         LEFT JOIN users u ON u.user_id = d.created_by
        ORDER BY d.updated_at DESC, d.definition_id DESC`,
    );
  }

  async createDefinition(dto: any, user: AuthUser) {
    const dataset = this.validateDataset(dto.dataset);
    const config = this.normalizeConfig(dto, dataset);
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم التقرير مطلوب');
    const row = await this.db.one<any>(
      `INSERT INTO report_definitions (name, dataset, config, created_by)
       VALUES ($1::text, $2::text, $3::jsonb, $4::int)
       RETURNING definition_id AS "definitionId", name, dataset, config`,
      [name, dataset, JSON.stringify(config), user.userId],
    );
    return row;
  }

  async updateDefinition(id: number, dto: any) {
    const dataset = this.validateDataset(dto.dataset);
    const config = this.normalizeConfig(dto, dataset);
    const name = String(dto.name ?? '').trim();
    if (!name) throw new BadRequestException('اسم التقرير مطلوب');
    const row = await this.db.one<any>(
      `UPDATE report_definitions
          SET name = $2::text, dataset = $3::text, config = $4::jsonb, updated_at = now()
        WHERE definition_id = $1::int
      RETURNING definition_id AS "definitionId", name, dataset, config`,
      [id, name, dataset, JSON.stringify(config)],
    );
    if (!row) throw new BadRequestException('التعريف غير موجود');
    return row;
  }

  async removeDefinition(id: number) {
    await this.db.query('DELETE FROM report_definitions WHERE definition_id = $1::int', [id]);
    return { ok: true };
  }

  async run(
    params: { dataset: string; columns?: string[]; from?: string; to?: string; limit?: number; groupBy?: string; aggregates?: Record<string, string> },
    branchId: number,
  ) {
    const datasetKey = this.validateDataset(params.dataset);
    const def = DATASETS[datasetKey];
    const requested = Array.isArray(params.columns) && params.columns.length ? params.columns : defaultColumnsFor(datasetKey);
    const cols = requested.filter((c) => def.columns[c]);
    if (!cols.length) throw new BadRequestException('اختر عمودًا واحدًا على الأقل');

    const where: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (datasetKey === 'sales_invoices') { where.push(`i.invoice_type = 1 AND i.status <> 3`); }
    if (datasetKey === 'purchase_invoices') { where.push(`i.invoice_type = 2 AND i.status <> 3`); }
    if (datasetKey === 'invoice_lines') { where.push(`i.status <> 3`); }
    if (def.branchColumn) { where.push(`${def.branchColumn} = $${idx++}::int`); values.push(branchId); }
    if (def.dateColumn && params.from) { where.push(`${def.dateColumn} >= $${idx++}::date`); values.push(params.from); }
    if (def.dateColumn && params.to) { where.push(`${def.dateColumn} <= ($${idx++}::date + interval '1 day' - interval '1 second')`); values.push(params.to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const groupBy = params.groupBy && def.columns[params.groupBy] ? params.groupBy : '';
    if (groupBy) {
      const allowedFns: Record<string, string> = { sum: 'SUM', count: 'COUNT', avg: 'AVG', min: 'MIN', max: 'MAX' };
      const aggs = params.aggregates && typeof params.aggregates === 'object' ? params.aggregates : {};
      const metricCols = cols.filter((c) => c !== groupBy);
      const selectParts: string[] = [`${def.columns[groupBy].expr} AS "${groupBy}"`];
      const outColumns: { key: string; label: string; type: string }[] = [
        { key: groupBy, label: def.columns[groupBy].label, type: def.columns[groupBy].type ?? 'text' },
      ];
      for (const c of metricCols) {
        const colDef = def.columns[c];
        const numeric = colDef.type === 'number';
        const fnKey = String(aggs[c] ?? (numeric ? 'sum' : 'count')).toLowerCase();
        const fn = allowedFns[fnKey] ?? (numeric ? 'SUM' : 'COUNT');
        const expr = `${fn}(${colDef.expr})`;
        selectParts.push(`${expr} AS "${c}"`);
        outColumns.push({ key: c, label: `${colDef.label} (${fnKey})`, type: 'number' });
      }
      if (metricCols.length === 0) {
        selectParts.push(`COUNT(*)::int AS "count"`);
        outColumns.push({ key: 'count', label: 'العدد', type: 'number' });
      }
      const limit = Math.min(Math.max(Number(params.limit ?? 500), 1), 2000);
      values.push(limit);
      const groupExpr = def.columns[groupBy].expr;
      const sql = `SELECT ${selectParts.join(', ')} ${def.from} ${whereSql} GROUP BY ${groupExpr} ORDER BY ${metricCols.length ? `"${metricCols[0]}"` : '"count"'} DESC LIMIT $${idx}::int`;
      const rows = await this.db.query<any>(sql, values);
      return { dataset: datasetKey, title: def.title, columns: outColumns, rows, grouped: true };
    }

    const select = cols.map((c) => `${def.columns[c].expr} AS "${c}"`).join(', ');
    const limit = Math.min(Math.max(Number(params.limit ?? 500), 1), 2000);
    values.push(limit);
    const order = def.dateColumn ? `ORDER BY ${def.dateColumn} DESC` : '';
    const sql = `SELECT ${select} ${def.from} ${whereSql} ${order} LIMIT $${idx}::int`;
    const rows = await this.db.query<any>(sql, values);
    const columns = cols.map((c) => ({ key: c, label: def.columns[c].label, type: def.columns[c].type ?? 'text' }));
    return { dataset: datasetKey, title: def.title, columns, rows };
  }

  async exportXlsx(params: { dataset: string; columns?: string[]; from?: string; to?: string; groupBy?: string; aggregates?: Record<string, string> }, branchId: number) {
    const result = await this.run({ ...params, limit: 5000 }, branchId);
    const header = result.columns.map((c) => c.label);
    const body = result.rows.map((row) => result.columns.map((c) => row[c.key] ?? ''));
    const sheet: XlsxSheet = { name: result.title.slice(0, 31), rows: [header, ...body] };
    const buffer = buildXlsx([sheet]);
    const base64 = buffer.toString('base64');
    return {
      base64,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `report-${result.dataset}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private validateDataset(dataset: string): DatasetKey {
    const key = String(dataset ?? '') as DatasetKey;
    if (!DATASETS[key]) throw new BadRequestException('مصدر بيانات غير مدعوم');
    return key;
  }

  private normalizeConfig(dto: any, dataset: DatasetKey) {
    const cols = Array.isArray(dto.columns) ? dto.columns.filter((c: any) => DATASETS[dataset].columns[String(c)]) : defaultColumnsFor(dataset);
    const groupBy = dto.groupBy && DATASETS[dataset].columns[String(dto.groupBy)] ? String(dto.groupBy) : undefined;
    return { columns: cols.length ? cols : defaultColumnsFor(dataset), ...(groupBy ? { groupBy } : {}) };
  }
}

@Controller('reports/builder')
export class ReportBuilderController {
  constructor(private readonly svc: ReportBuilderService) {}

  @RequirePermissions('reports.view')
  @Get('datasets')
  datasets() {
    return this.svc.datasets();
  }

  @RequirePermissions('reports.view')
  @Get('definitions')
  definitions() {
    return this.svc.listDefinitions();
  }

  @RequirePermissions('reports.view')
  @Post('definitions')
  create(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.svc.createDefinition(body, user);
  }

  @RequirePermissions('reports.view')
  @Put('definitions/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.updateDefinition(id, body);
  }

  @RequirePermissions('reports.view')
  @Delete('definitions/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.removeDefinition(id);
  }

  @RequirePermissions('reports.view')
  @Post('run')
  run(@Body() body: any, @CurrentBranch() branchId: number) {
    return this.svc.run(body ?? {}, branchId);
  }

  @RequirePermissions('reports.view')
  @Get('export-xlsx')
  exportXlsx(
    @CurrentBranch() branchId: number,
    @Query('dataset') dataset: string,
    @Query('columns') columns?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    const cols = columns ? columns.split(',').map((c) => c.trim()).filter(Boolean) : undefined;
    return this.svc.exportXlsx({ dataset, columns: cols, from, to, groupBy }, branchId);
  }
}

@Module({
  controllers: [ReportBuilderController],
  providers: [ReportBuilderService],
})
export class ReportBuilderModule {}
