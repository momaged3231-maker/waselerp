import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';
import { CurrentBranch, RequireAnyPermission, RequirePermissions } from '../../common/security';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DatabaseService) {}

  async dashboard(branchId: number) {
    const sales = await this.db.one<any>(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COALESCE(SUM(profit_amount),0) AS profit,
              COUNT(*)::int AS count
         FROM invoices
        WHERE invoice_type = 1 AND status = 2 AND invoice_date::date = CURRENT_DATE
          AND ($1::int = 0 OR branch_id = $1)`,
      [branchId],
    );
    const purchases = await this.db.one<any>(
      `SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*)::int AS count
         FROM invoices
        WHERE invoice_type = 2 AND status = 2 AND invoice_date::date = CURRENT_DATE
          AND ($1::int = 0 OR branch_id = $1)`,
      [branchId],
    );
    const cash = await this.db.one<any>(
      `SELECT COALESCE(SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE -t.amount END),0) AS balance
         FROM cash_transactions t JOIN cash_accounts c ON c.cash_account_id = t.cash_account_id
        WHERE ($1::int = 0 OR c.branch_id = $1)`,
      [branchId],
    );
    const receivables = await this.db.one<any>(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), 0) AS total
         FROM ledger_entries l
         JOIN parties p ON p.party_id = l.party_id
        WHERE p.party_type IN (1, 3)
          AND ($1::int = 0 OR l.branch_id = $1)`,
      [branchId],
    );
    const payables = await this.db.one<any>(
      `SELECT COALESCE(SUM(CASE WHEN l.direction = 2 THEN l.amount ELSE -l.amount END), 0) AS total
         FROM ledger_entries l
         JOIN parties p ON p.party_id = l.party_id
        WHERE p.party_type IN (2, 3)
          AND ($1::int = 0 OR l.branch_id = $1)`,
      [branchId],
    );
    const lowStock = await this.db.one<any>(
      `SELECT COUNT(*)::int AS count
         FROM items i
        WHERE i.is_active = true AND i.track_quantity = true
          AND i.reorder_point > 0
          AND COALESCE((SELECT SUM(q.on_hand_qty) FROM item_warehouse_qty q
                         WHERE q.item_id = i.item_id AND q.unit_id = i.base_unit_id
                           AND ($1::int = 0 OR q.warehouse_id IN (SELECT warehouse_id FROM warehouses WHERE branch_id = $1))), 0) <= i.reorder_point`,
      [branchId],
    );
    const inventory = await this.db.one<any>(
      `SELECT COALESCE(SUM(q.on_hand_qty * q.avg_cost), 0) AS total
         FROM item_warehouse_qty q
         JOIN items i ON i.item_id = q.item_id AND q.unit_id = i.base_unit_id
         JOIN warehouses w ON w.warehouse_id = q.warehouse_id
        WHERE ($1::int = 0 OR w.branch_id = $1)`,
      [branchId],
    );

    return {
      todaySales: Number(sales?.total ?? 0),
      todayPurchases: Number(purchases?.total ?? 0),
      todayProfit: Number(sales?.profit ?? 0),
      todayInvoices: Number(sales?.count ?? 0),
      cashBalance: Number(cash?.balance ?? 0),
      receivables: Number(receivables?.total ?? 0),
      payables: Number(payables?.total ?? 0),
      lowStockItems: Number(lowStock?.count ?? 0),
      inventoryValue: Number(inventory?.total ?? 0),
    };
  }

  /** Sales summary per day / branch / user. */
  async salesSummary(params: { from: string; to: string; branchId: number; groupBy: string }) {
    const group = params.groupBy === 'branch' ? 'b.name' : params.groupBy === 'user' ? 'u.full_name' : 'i.invoice_date::date';
    const label = params.groupBy === 'branch' ? 'b.name' : params.groupBy === 'user' ? 'u.full_name' : 'i.invoice_date::date';
    return this.db.query(
      `SELECT ${label} AS label,
              COUNT(*)::int AS "invoiceCount",
              COALESCE(SUM(i.sub_total),0) AS "subTotal",
              COALESCE(SUM(i.discount_amount),0) AS "discount",
              COALESCE(SUM(i.tax_amount),0) AS "tax",
              COALESCE(SUM(i.total_amount),0) AS "total",
              COALESCE(SUM(i.paid_amount),0) AS "paid",
              COALESCE(SUM(i.profit_amount),0) AS "profit"
         FROM invoices i
         LEFT JOIN branches b ON b.branch_id = i.branch_id
         LEFT JOIN users u ON u.user_id = i.created_by
        WHERE i.invoice_type = 1 AND i.status = 2
          AND ($1::date IS NULL OR i.invoice_date >= $1::date)
          AND ($2::date IS NULL OR i.invoice_date <= $2::date)
          AND ($3::int = 0 OR i.branch_id = $3)
        GROUP BY ${group}
        ORDER BY label`,
      [params.from || null, params.to || null, params.branchId],
    );
  }

  async topItems(params: { from: string; to: string; branchId: number; limit: number }) {
    return this.db.query(
      `SELECT it.item_id AS "itemId", it.code AS "itemCode", it.name AS "itemName",
              SUM(l.quantity) AS quantity, SUM(l.line_total) AS total, SUM(l.unit_cost * l.quantity) AS cost,
              SUM(l.line_total - l.tax_amount - (l.unit_cost * l.quantity)) AS profit
         FROM invoice_lines l
         JOIN invoices i ON i.invoice_id = l.invoice_id
         JOIN items it ON it.item_id = l.item_id
        WHERE i.invoice_type = 1 AND i.status = 2
          AND ($1::date IS NULL OR i.invoice_date >= $1::date)
          AND ($2::date IS NULL OR i.invoice_date <= $2::date)
          AND ($3::int = 0 OR i.branch_id = $3)
        GROUP BY it.item_id, it.code, it.name
        ORDER BY total DESC LIMIT $4`,
      [params.from || null, params.to || null, params.branchId, params.limit],
    );
  }

  async stockValue(branchId: number) {
    return this.db.query(
      `SELECT i.category_id AS "categoryId", COALESCE(c.name, 'بدون فئة') AS "categoryName",
              COUNT(DISTINCT i.item_id)::int AS "itemCount",
              COALESCE(SUM(q.on_hand_qty),0) AS quantity,
              COALESCE(SUM(q.on_hand_qty * q.avg_cost),0) AS "costValue",
              COALESCE(SUM(q.on_hand_qty * i.sell_price),0) AS "sellValue"
         FROM item_warehouse_qty q
         JOIN items i ON i.item_id = q.item_id AND q.unit_id = i.base_unit_id
         LEFT JOIN categories c ON c.category_id = i.category_id
         JOIN warehouses w ON w.warehouse_id = q.warehouse_id
        WHERE ($1::int = 0 OR w.branch_id = $1)
        GROUP BY i.category_id, c.name
        ORDER BY "costValue" DESC`,
      [branchId],
    );
  }

  async partyBalances(branchId: number, type: number) {
    return this.db.query(
      `SELECT p.party_id AS "partyId", p.name, p.phone, p.credit_limit AS "creditLimit",
              COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), p.opening_balance) AS balance,
              MAX(l.entry_date) AS "lastMovement"
         FROM parties p
         LEFT JOIN ledger_entries l ON l.party_id = p.party_id
        WHERE ($1::int = 0 OR p.party_type = $1 OR p.party_type = 3)
          AND ($2::int = 0 OR p.branch_id = $2 OR p.branch_id IS NULL)
        GROUP BY p.party_id, p.name, p.phone, p.credit_limit, p.opening_balance
        HAVING COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), 0) <> 0
        ORDER BY balance DESC`,
      [type, branchId],
    );
  }

  async cashSummary(branchId: number, from: string, to: string) {
    return this.db.query(
      `SELECT c.cash_account_id AS "cashAccountId", c.name AS "cashAccountName", c.type,
              COALESCE(SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE 0 END),0) AS "totalIn",
              COALESCE(SUM(CASE WHEN t.direction = 2 THEN t.amount ELSE 0 END),0) AS "totalOut",
              COALESCE(SUM(CASE WHEN t.direction = 1 THEN t.amount ELSE -t.amount END),0) AS balance
         FROM cash_accounts c
         LEFT JOIN cash_transactions t ON t.cash_account_id = c.cash_account_id
              AND ($2::date IS NULL OR t.transaction_date >= $2::date)
              AND ($3::date IS NULL OR t.transaction_date <= $3::date)
        WHERE ($1::int = 0 OR c.branch_id = $1)
        GROUP BY c.cash_account_id, c.name, c.type
        ORDER BY c.cash_account_id`,
      [branchId, from || null, to || null],
    );
  }

  /** Items at or below their reorder point. */
  async reorderReport(branchId: number) {
    return this.db.query(
      `SELECT i.item_id AS "itemId", i.code AS "itemCode", i.name AS "itemName",
              i.reorder_point AS "reorderPoint",
              COALESCE(SUM(q.on_hand_qty), 0) AS "onHand",
              i.base_unit_id AS "unitId", u.name AS "unitName",
              COALESCE((SELECT AVG(i2.cost_price) FROM items i2 WHERE i2.item_id = i.item_id), 0) AS "estCost"
         FROM items i
         LEFT JOIN units u ON u.unit_id = i.base_unit_id
         LEFT JOIN item_warehouse_qty q ON q.item_id = i.item_id AND q.unit_id = i.base_unit_id
         LEFT JOIN warehouses w ON w.warehouse_id = q.warehouse_id
        WHERE i.is_active = true AND i.reorder_point > 0
          AND ($1::int = 0 OR w.branch_id = $1 OR w.warehouse_id IS NULL)
        GROUP BY i.item_id, i.code, i.name, i.reorder_point, i.base_unit_id, u.name
       HAVING COALESCE(SUM(q.on_hand_qty), 0) <= i.reorder_point
        ORDER BY i.name`,
      [branchId],
    );
  }

  /** Debt aging for customers: balances grouped by age buckets. */
  async debtAging(branchId: number) {
    return this.db.query(
      `SELECT p.party_id AS "partyId", p.name, p.phone, p.credit_limit AS "creditLimit",
              COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), 0) AS balance,
              COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_date >= CURRENT_DATE - 30 THEN l.amount
                                WHEN l.direction = 2 AND l.entry_date >= CURRENT_DATE - 30 THEN -l.amount ELSE 0 END), 0) AS "bucket0_30",
              COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_date < CURRENT_DATE - 30 AND l.entry_date >= CURRENT_DATE - 60 THEN l.amount
                                WHEN l.direction = 2 AND l.entry_date < CURRENT_DATE - 30 AND l.entry_date >= CURRENT_DATE - 60 THEN -l.amount ELSE 0 END), 0) AS "bucket31_60",
              COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_date < CURRENT_DATE - 60 AND l.entry_date >= CURRENT_DATE - 90 THEN l.amount
                                WHEN l.direction = 2 AND l.entry_date < CURRENT_DATE - 60 AND l.entry_date >= CURRENT_DATE - 90 THEN -l.amount ELSE 0 END), 0) AS "bucket61_90",
              COALESCE(SUM(CASE WHEN l.direction = 1 AND l.entry_date < CURRENT_DATE - 90 THEN l.amount
                                WHEN l.direction = 2 AND l.entry_date < CURRENT_DATE - 90 THEN -l.amount ELSE 0 END), 0) AS "bucket90plus",
              MAX(l.entry_date) AS "lastMovement"
         FROM parties p
         LEFT JOIN ledger_entries l ON l.party_id = p.party_id
        WHERE p.party_type IN (1, 3)
          AND ($1::int = 0 OR p.branch_id = $1 OR p.branch_id IS NULL)
        GROUP BY p.party_id, p.name, p.phone, p.credit_limit
       HAVING COALESCE(SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END), 0) > 0
        ORDER BY balance DESC`,
      [branchId],
    );
  }

  /** Sales rep commissions: per-rep sales totals and commission amounts. */
  async commissions(branchId: number, from: string, to: string) {
    return this.db.query(
      `SELECT u.user_id AS "repId", u.full_name AS "repName",
              COUNT(i.invoice_id)::int AS "invoiceCount",
              COALESCE(SUM(i.total_amount), 0) AS "totalSales",
              COALESCE(SUM(i.profit_amount), 0) AS "totalProfit",
              COALESCE(u.commission_pct, 0) AS "commissionPct",
              COALESCE(SUM(i.total_amount) * COALESCE(u.commission_pct, 0) / 100, 0) AS "commissionAmount"
         FROM invoices i
         JOIN users u ON u.user_id = i.rep_id
        WHERE i.invoice_type = 1 AND i.status = 2
          AND ($1::int = 0 OR i.branch_id = $1)
          AND ($2::date IS NULL OR i.invoice_date >= $2::date)
          AND ($3::date IS NULL OR i.invoice_date <= $3::date)
        GROUP BY u.user_id, u.full_name, u.commission_pct
        ORDER BY "totalSales" DESC`,
      [branchId, from || null, to || null],
    );
  }

  /** Hourly distribution used by the POS dashboard. */
  async salesByHour(branchId: number, from: string, to: string) {
    return this.db.query(
      `SELECT EXTRACT(HOUR FROM i.invoice_date)::int AS hour, COUNT(*)::int AS "invoiceCount",
              COALESCE(SUM(i.total_amount),0) AS total
         FROM invoices i
        WHERE i.invoice_type = 1 AND i.status = 2
          AND ($1::date IS NULL OR i.invoice_date >= $1::date)
          AND ($2::date IS NULL OR i.invoice_date <= $2::date)
          AND ($3::int = 0 OR i.branch_id = $3)
        GROUP BY hour ORDER BY hour`,
      [from || null, to || null, branchId],
    );
  }
  /** Pivot: sales by item x month. */
  async salesPivotByItemMonth(branchId: number, from: string, to: string) {
    const rows = await this.db.query<any>(
      `SELECT it.item_id AS "itemId", it.name AS "itemName",
              to_char(i.invoice_date, 'YYYY-MM') AS "month",
              COALESCE(SUM(l.line_total), 0) AS "amount"
         FROM invoice_lines l
         JOIN invoices i ON i.invoice_id = l.invoice_id
         JOIN items it ON it.item_id = l.item_id
        WHERE i.invoice_type = 1 AND i.status = 2
          AND ($1::int = 0 OR i.branch_id = $1)
          AND ($2::date IS NULL OR i.invoice_date >= $2::date)
          AND ($3::date IS NULL OR i.invoice_date <= $3::date)
        GROUP BY it.item_id, it.name, to_char(i.invoice_date, 'YYYY-MM')
        ORDER BY it.name, "month"`,
      [branchId, from || null, to || null],
    );
    const items = new Map<number, { itemId: number; itemName: string; months: Record<string, number> }>();
    const months = new Set<string>();
    for (const row of rows) {
      const id = Number(row.itemId);
      if (!items.has(id)) items.set(id, { itemId: id, itemName: row.itemName, months: {} });
      const month = String(row.month);
      months.add(month);
      items.get(id)!.months[month] = Number(row.amount ?? 0);
    }
    return { months: [...months].sort(), items: [...items.values()] };
  }

  /** Pivot: stock value by category x warehouse. */
  async stockPivotByCategoryWarehouse(branchId: number) {
    const rows = await this.db.query<any>(
      `SELECT COALESCE(c.name, 'بدون فئة') AS "categoryName",
              w.name AS "warehouseName",
              COALESCE(SUM(q.on_hand_qty * q.avg_cost), 0) AS "value"
         FROM item_warehouse_qty q
         JOIN items i ON i.item_id = q.item_id AND q.unit_id = i.base_unit_id
         JOIN warehouses w ON w.warehouse_id = q.warehouse_id
         LEFT JOIN categories c ON c.category_id = i.category_id
        WHERE ($1::int = 0 OR w.branch_id = $1)
        GROUP BY c.name, w.name
        ORDER BY c.name, w.name`,
      [branchId],
    );
    const categories = new Map<string, Record<string, number>>();
    const warehouses = new Set<string>();
    for (const row of rows) {
      const cat = String(row.categoryName);
      const wh = String(row.warehouseName);
      warehouses.add(wh);
      if (!categories.has(cat)) categories.set(cat, {});
      categories.get(cat)![wh] = Number(row.value ?? 0);
    }
    return { warehouses: [...warehouses].sort(), categories: [...categories.entries()].map(([categoryName, values]) => ({ categoryName, values })) };
  }
}



@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @RequireAnyPermission('reports.view', 'dashboard.view')
  @Get('dashboard')
  dashboard(@CurrentBranch() branchId: number) {
    return this.service.dashboard(branchId);
  }

  @RequirePermissions('reports.view')
  @Get('sales-summary')
  salesSummary(@Query('from') from: string, @Query('to') to: string, @Query('groupBy') groupBy: string, @CurrentBranch() branchId: number) {
    return this.service.salesSummary({ from, to, branchId, groupBy: groupBy || 'day' });
  }

  @RequirePermissions('reports.view')
  @Get('top-items')
  topItems(@Query('from') from: string, @Query('to') to: string, @CurrentBranch() branchId: number) {
    return this.service.topItems({ from, to, branchId, limit: 20 });
  }

  @RequirePermissions('reports.view')
  @Get('stock-value')
  stockValue(@CurrentBranch() branchId: number) {
    return this.service.stockValue(branchId);
  }

  @RequireAnyPermission('reports.view', 'parties.ledger')
  @Get('party-balances')
  partyBalances(@CurrentBranch() branchId: number, @Query('type') type: string) {
    return this.service.partyBalances(branchId, type ? Number(type) : 0);
  }

  @RequireAnyPermission('reports.view', 'cash.view')
  @Get('cash-summary')
  cashSummary(@CurrentBranch() branchId: number, @Query('from') from: string, @Query('to') to: string) {
    return this.service.cashSummary(branchId, from, to);
  }

  @RequirePermissions('reports.view')
  @Get('sales-by-hour')
  salesByHour(@CurrentBranch() branchId: number, @Query('from') from: string, @Query('to') to: string) {
    return this.service.salesByHour(branchId, from, to);
  }

  @RequirePermissions('reports.view')
  @Get('reorder')
  reorder(@CurrentBranch() branchId: number) {
    return this.service.reorderReport(branchId);
  }

  @RequireAnyPermission('reports.view', 'parties.ledger')
  @Get('debt-aging')
  debtAging(@CurrentBranch() branchId: number) {
    return this.service.debtAging(branchId);
  }

  @RequirePermissions('reports.view')
  @Get('commissions')
  commissions(@CurrentBranch() branchId: number, @Query('from') from: string, @Query('to') to: string) {
    return this.service.commissions(branchId, from, to);
  }

  @RequirePermissions('reports.view')
  @Get('pivot/sales')
  salesPivot(@CurrentBranch() branchId: number, @Query('from') from: string, @Query('to') to: string) {
    return this.service.salesPivotByItemMonth(branchId, from, to);
  }

  @RequirePermissions('reports.view')
  @Get('pivot/stock')
  stockPivot(@CurrentBranch() branchId: number) {
    return this.service.stockPivotByCategoryWarehouse(branchId);
  }
}

@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
