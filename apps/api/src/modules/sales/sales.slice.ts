import {
  Body, Controller, ForbiddenException, Get, Injectable, Module, Param, ParseIntPipe, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { applyMovement, getWarehouseCost, toBaseUnits, MoveType } from '../../common/stock';
import { getBooleanSetting } from '../../common/settings';
import { postInvoiceJournal, reverseJournal, resolveMapping } from '../../common/posting';
import { resolvePrices, asRunner } from '../../common/pricing';
import {
  AuthUser, CurrentBranch, CurrentUser, RequireAnyPermission, RequirePermissions,
} from '../../common/security';
import { LiveEventsService } from '../events/live-events.service';
import { EventsModule } from '../events/events.slice';

export interface CartLineInput {
  itemId: number;
  unitId: number;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxPct?: number;
  serialNo?: string;
  expiryDate?: string;
  notes?: string;
  /** A giveaway: the customer pays nothing but the stock still leaves. */
  isGift?: boolean;
  /** Modifier (extra) attached to another line of the same invoice. */
  parentLineIndex?: number;
  /** The modifier this line belongs to (for the maximum quantity check). */
  modifierId?: number;
}

export interface InvoicePaymentInput {
  method?: number;          // 1 cash, 2 card, 3 bank transfer, 4 wallet, 5 cheque
  amount: number;
  cashAccountId?: number;
  referenceNo?: string;
  notes?: string;
}

export interface InvoiceInput {
  invoiceType: number;     // 1 sales, 2 purchase, 3 sales return, 4 purchase return
  branchId?: number;
  warehouseId: number;
  partyId?: number;
  repId?: number;
  invoiceDate?: string;
  paymentType: number;     // 1 cash, 2 credit, 3 mixed
  cashAccountId?: number;
  paidAmount?: number;
  /** Several payments on one invoice (cash + card + wallet…). */
  payments?: InvoicePaymentInput[];
  discountPct?: number;
  discountAmount?: number;
  /** Promotional coupon code — applied on top of the line discounts. */
  couponCode?: string;
  /** 1 counter, 2 delivery, 3 takeaway, 4 room/table. */
  orderType?: number;
  deliveryAddress?: string;
  deliveryFee?: number;
  /** Restaurant service charge (per guest). */
  serviceCharge?: number;
  driverName?: string;
  driverPhone?: string;
  tableRef?: string;
  parentInvoiceId?: number;
  lines: CartLineInput[];
  notes?: string;
  clientRequestId?: string;
}

const TYPE_MOVE: Record<number, MoveType> = {
  1: 'sales', 2: 'purchase', 3: 'salesReturn', 4: 'purchaseReturn',
};

const TYPE_PREFIX: Record<number, string> = { 1: 'S', 2: 'P', 3: 'SR', 4: 'PR' };

/** Money is rounded to two decimals — the ledger has no room for fractions of a piastre. */
const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

@Injectable()
export class SalesService {
  constructor(private readonly db: DatabaseService, private readonly live: LiveEventsService) {}

  /**
   * Company identity + receipt/print presentation settings, readable by any POS/sales user.
   * The raw app_settings table is admin-only; printed output needs the same values.
   * All presentation booleans default to visible; numbers are clamped to sane ranges.
   */
  async printContext() {
    const rows = await this.db.query<{ setting_key: string; setting_value: string | null }>(
      `SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1::text[])`,
      [['CompanyName', 'CompanyPhone', 'CompanyAddress', 'TaxNumber',
        'InvoiceFooter', 'ShowTaxOnReceipt', 'TaxName',
        'ReceiptShowBranchName', 'ReceiptShowPartyName', 'ReceiptShowTotals',
        'ReceiptCopies', 'ReceiptPaperSize', 'KitchenTicketEnabled', 'KitchenTicketCopies']],
    );
    const map = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
    const value = (key: string) => map.get(key) ?? '';
    const bool = (key: string, fallback = true) => {
      const raw = (value(key) || (fallback ? 'true' : 'false')).trim().toLowerCase();
      return raw !== 'false' && raw !== '0';
    };
    const int = (key: string, min: number, max: number, fallback: number) => {
      const n = Number(value(key));
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, Math.trunc(n)));
    };
    const paperSize = ['thermal80', 'thermal58', 'a5', 'a4'].includes(value('ReceiptPaperSize'))
      ? value('ReceiptPaperSize')
      : 'thermal80';
    return {
      companyName: value('CompanyName'),
      companyPhone: value('CompanyPhone'),
      companyAddress: value('CompanyAddress'),
      taxNumber: value('TaxNumber'),
      invoiceFooter: value('InvoiceFooter') || 'شكراً لتعاملكم معنا',
      showTaxOnReceipt: bool('ShowTaxOnReceipt', true),
      taxName: value('TaxName') || 'الضريبة',
      receiptShowBranchName: bool('ReceiptShowBranchName', true),
      receiptShowPartyName: bool('ReceiptShowPartyName', true),
      receiptShowTotals: bool('ReceiptShowTotals', true),
      receiptCopies: int('ReceiptCopies', 1, 5, 1),
      receiptPaperSize: paperSize,
      kitchenTicketEnabled: bool('KitchenTicketEnabled', false),
      kitchenTicketCopies: int('KitchenTicketCopies', 1, 3, 1),
    };
  }

  /** Sales representatives active in the system (used by POS to assign repId). */
  reps() {
    return this.db.query(
      `SELECT user_id AS "userId", full_name AS "fullName", user_name AS "userName", commission_pct AS "commissionPct"
         FROM users
        WHERE is_active = true AND is_sales_rep = true
        ORDER BY full_name`,
    );
  }

  async create(dto: InvoiceInput, user: AuthUser, branchId: number, editOf?: number) {
    if (!dto.lines?.length) throw new BadRequestException('لا توجد أصناف في الفاتورة');

    let invoiceType = Number(dto.invoiceType ?? 1);
    if (![1, 2, 3, 4].includes(invoiceType)) throw new BadRequestException('نوع الفاتورة غير صحيح');
    let isPurchase = invoiceType === 2 || invoiceType === 4;
    let isReturn = invoiceType === 3 || invoiceType === 4;

    // Editing an invoice: the permission follows the invoice that is edited.
    if (editOf) {
      const existing = await this.db.one<any>(
        'SELECT invoice_id, invoice_type FROM invoices WHERE invoice_id = $1::bigint',
        [editOf],
      );
      if (!existing) throw new BadRequestException('الفاتورة غير موجودة');
      invoiceType = Number(existing.invoice_type);
      isPurchase = invoiceType === 2 || invoiceType === 4;
      isReturn = invoiceType === 3 || invoiceType === 4;
    }

    // The route accepts sales and purchases; the document type decides the permission.
    const allowed = isPurchase
      ? user.permissions.includes('purchases.manage')
      : user.permissions.includes('sales.manage') || user.permissions.includes('pos.operate');
    if (!allowed) throw new ForbiddenException('ليس لديك صلاحية لهذا النوع من الفواتير');

    for (const line of dto.lines) {
      if (!line.itemId || !line.unitId) throw new BadRequestException('بيانات الصنف غير كاملة');
      if (!(Number(line.quantity) > 0)) throw new BadRequestException('الكمية يجب أن تكون أكبر من صفر');
    }

    // Server-side discount cap (the POS cap alone can be bypassed by calling the API directly).
    const maxDiscount = Number(user.maxDiscountPct ?? 0);
    if (maxDiscount < 100) {
      if (Number(dto.discountPct ?? 0) > maxDiscount + 0.0001) {
        throw new BadRequestException(`الخصم يتجاوز الحد المسموح لك (${maxDiscount}%)`);
      }
      for (const line of dto.lines) {
        if (Number(line.discountPct ?? 0) > maxDiscount + 0.0001) {
          throw new BadRequestException(`خصم أحد السطور يتجاوز الحد المسموح لك (${maxDiscount}%)`);
        }
      }
    }

    if (dto.clientRequestId) {
      const existing = await this.db.one<{ invoice_id: number }>(
        'SELECT invoice_id FROM invoices WHERE client_request_id = $1',
        [dto.clientRequestId],
      );
      if (existing) return { invoiceId: Number(existing.invoice_id), duplicate: true };
    }

    const effectiveBranch = dto.branchId ?? branchId;

    // A body-level branch must still be one the user is allowed to use.
    if (dto.branchId && user.branchIds.length && !user.branchIds.includes(Number(dto.branchId))) {
      throw new ForbiddenException('هذا الفرع غير مسموح لك');
    }

    return this.db.transaction(async (client) => {
      const warehouse = await client.query<{ branch_id: number }>(
        'SELECT branch_id FROM warehouses WHERE warehouse_id = $1',
        [dto.warehouseId],
      );
      if (!warehouse.rows.length) throw new BadRequestException('المخزن غير موجود');
      if (Number(warehouse.rows[0].branch_id) !== Number(effectiveBranch)) {
        throw new BadRequestException('المخزن لا يتبع الفرع الحالي');
      }

      // Editing an invoice: undo the previous version before writing the new
      // one, so the stock, the ledger and the journal end up consistent.
      const editedInvoice = editOf
        ? await this.reverseForEdit(client, editOf, user)
        : null;
      if (editedInvoice) {
        // The type of an invoice never changes while editing it.
        invoiceType = Number(editedInvoice.invoice_type);
        dto = { ...dto, invoiceType };
      }

      // ---- cashier shift -------------------------------------------------
      const requireShift = await getBooleanSetting(client, 'RequireCashierShift', false);
      const shiftResult = await client.query<{ shift_id: number; cash_account_id: number }>(
        `SELECT shift_id, cash_account_id FROM shifts
          WHERE cashier_id = $1 AND status = 1 ORDER BY opened_at DESC LIMIT 1`,
        [user.userId],
      );
      const openShift = shiftResult.rows[0] ?? null;
      if (requireShift && user.isCashier && !openShift) {
        throw new BadRequestException('يجب فتح وردية قبل تسجيل البيع');
      }
      const shiftId = openShift ? Number(openShift.shift_id) : null;
      const shiftAccountId = openShift ? Number(openShift.cash_account_id) : null;
      if (openShift && dto.cashAccountId && Number(dto.cashAccountId) !== shiftAccountId) {
        throw new BadRequestException('حساب الخزينة لا يطابق وردية الكاشير المفتوحة');
      }
      const cashAccountId = dto.cashAccountId ?? shiftAccountId ?? null;
      if (cashAccountId) {
        const account = await client.query<{ branch_id: number }>(
          'SELECT branch_id FROM cash_accounts WHERE cash_account_id = $1',
          [cashAccountId],
        );
        if (!account.rows.length) throw new BadRequestException('حساب الخزينة غير موجود');
        if (Number(account.rows[0].branch_id) !== Number(effectiveBranch)) {
          throw new BadRequestException('حساب الخزينة لا يتبع الفرع الحالي');
        }
      }

      // ---- payments (an invoice may be settled with several methods) -----
      const paymentRows: {
        method: number; amount: number; cashAccountId: number;
        referenceNo: string | null; notes: string | null;
      }[] = [];
      for (const payment of Array.isArray(dto.payments) ? dto.payments : []) {
        const amount = Number(payment.amount ?? 0);
        if (!(amount > 0)) continue;
        const accountId = payment.cashAccountId ? Number(payment.cashAccountId) : cashAccountId;
        if (!accountId) throw new BadRequestException('حدد حساب الخزينة لكل دفعة');
        const account = await client.query<{ branch_id: number }>(
          'SELECT branch_id FROM cash_accounts WHERE cash_account_id = $1',
          [accountId],
        );
        if (!account.rows.length) throw new BadRequestException('حساب الخزينة غير موجود');
        if (Number(account.rows[0].branch_id) !== Number(effectiveBranch)) {
          throw new BadRequestException('حساب الخزينة لا يتبع الفرع الحالي');
        }
        paymentRows.push({
          method: Number(payment.method ?? 1),
          amount,
          cashAccountId: accountId,
          referenceNo: payment.referenceNo ?? null,
          notes: payment.notes ?? null,
        });
      }

      // ---- original invoice for returns ----------------------------------
      let parent: any = null;
      let partyId = dto.partyId ? Number(dto.partyId) : undefined;
      if (isReturn) {
        if (!dto.parentInvoiceId) throw new BadRequestException('الفاتورة الأصلية مطلوبة للمرتجع');
        const parentResult = await client.query<any>(
          'SELECT * FROM invoices WHERE invoice_id = $1',
          [dto.parentInvoiceId],
        );
        parent = parentResult.rows[0];
        if (!parent) throw new BadRequestException('الفاتورة الأصلية غير موجودة');
        if (Number(parent.status) === 3) throw new BadRequestException('لا يمكن إرجاع فاتورة ملغاة');
        const expectedParentType = invoiceType === 3 ? 1 : 2;
        if (Number(parent.invoice_type) !== expectedParentType) {
          throw new BadRequestException('نوع الفاتورة الأصلية لا يطابق نوع المرتجع');
        }
        if (Number(parent.branch_id) !== Number(effectiveBranch)) {
          throw new BadRequestException('الفاتورة الأصلية تخص فرعًا آخر');
        }
        const parentParty = parent.party_id ? Number(parent.party_id) : undefined;
        if ((partyId ?? 0) !== (parentParty ?? 0)) {
          throw new BadRequestException('طرف المرتجع يجب أن يطابق طرف الفاتورة الأصلية');
        }
        partyId = parentParty;
      }

      // ---- party validation + credit limit -------------------------------
      let creditLimit = 0;
      let partyBalance = 0;
      let repId = dto.repId ? Number(dto.repId) : undefined;
      if (partyId) {
        const party = await client.query<any>(
          `SELECT p.party_type, p.credit_limit, p.sales_rep_id,
                  COALESCE((SELECT SUM(CASE WHEN l.direction = 1 THEN l.amount ELSE -l.amount END)
                              FROM ledger_entries l WHERE l.party_id = p.party_id), p.opening_balance) AS balance
             FROM parties p WHERE p.party_id = $1`,
          [partyId],
        );
        if (!party.rows.length) throw new BadRequestException('العميل/المورد غير موجود');
        const partyType = Number(party.rows[0].party_type);
        const expectedTypes = isPurchase ? [2, 3] : [1, 3];
        if (!expectedTypes.includes(partyType)) {
          throw new BadRequestException('نوع الطرف لا يطابق نوع الفاتورة');
        }
        creditLimit = Number(party.rows[0].credit_limit ?? 0);
        partyBalance = Number(party.rows[0].balance ?? 0);
        if (!repId && party.rows[0].sales_rep_id) repId = Number(party.rows[0].sales_rep_id);
      }
      if (invoiceType !== 1) repId = undefined;

      // ---- period + items ------------------------------------------------
      const period = await client.query<{ period_id: number }>(
        `SELECT period_id FROM periods
          WHERE branch_id = $1 AND is_closed = false
          ORDER BY start_date DESC LIMIT 1`,
        [effectiveBranch],
      );
      const periodId = period.rows.length ? Number(period.rows[0].period_id) : null;

      const itemIds = [...new Set(dto.lines.map((l) => Number(l.itemId)))];
      const items = await client.query<any>(
        `SELECT item_id, code, name, base_unit_id, cost_price, sell_price, vat_pct, discount_pct, track_quantity
           FROM items WHERE item_id = ANY($1::int[])`,
        [itemIds],
      );
      const itemMap = new Map(items.rows.map((r: any) => [Number(r.item_id), r]));

      // ---- return quantity + cost map from the original invoice ----------
      const parentLines = new Map<string, { unitCost: number; remaining: number }>();
      if (isReturn && parent) {
        const rows = await client.query<any>(
          `SELECT l.item_id, l.unit_id, l.quantity, l.unit_cost,
                  COALESCE((SELECT SUM(rl.quantity)
                              FROM invoice_lines rl
                              JOIN invoices ri ON ri.invoice_id = rl.invoice_id
                             WHERE ri.parent_invoice_id = $1 AND ri.status <> 3
                               AND rl.item_id = l.item_id AND rl.unit_id = l.unit_id), 0) AS returned_qty
             FROM invoice_lines l
            WHERE l.invoice_id = $1`,
          [dto.parentInvoiceId],
        );
        for (const row of rows.rows) {
          parentLines.set(`${row.item_id}:${row.unit_id}`, {
            unitCost: Number(row.unit_cost),
            remaining: Number(row.quantity) - Number(row.returned_qty),
          });
        }
      }

      let subTotal = 0, discountTotal = 0, taxTotal = 0, lineTotalSum = 0, costTotal = 0;
      const computed: any[] = [];

      // Prices of the customer's list are used when the line carries no price.
      const listPrices = partyId
        ? await resolvePrices(asRunner(client), {
          itemIds: itemIds.map((id) => Number(id)),
          partyId,
          branchId: effectiveBranch,
        })
        : new Map<number, { price: number; minPrice: number; priceListName: string }>();

      // A modifier may only be used up to its maximum quantity; a zero
      // maximum means the extra is not offered at all.
      if (invoiceType === 1) {
        const modifierTotals = new Map<number, number>();
        for (const line of dto.lines) {
          if (!line.modifierId) continue;
          const id = Number(line.modifierId);
          modifierTotals.set(id, (modifierTotals.get(id) ?? 0) + Number(line.quantity ?? 0));
        }
        for (const [modifierId, quantity] of modifierTotals) {
          const modifierResult = await client.query<any>(
            'SELECT name, max_quantity FROM item_modifiers WHERE modifier_id = $1::int',
            [modifierId],
          );
          const name = modifierResult.rows[0]?.name ?? '';
          const max = Number(modifierResult.rows[0]?.max_quantity ?? 0);
          if (max <= 0) {
            throw new BadRequestException(`لا توجد إضافات مسموح بها — حدّد أقصى كمية للإضافة «${name}»`);
          }
          if (quantity > max + 0.000001) {
            throw new BadRequestException(
              `عفوا الكمية المختار اكبر من الكمية المسموح به — «${name}» (الحد ${max})`,
            );
          }
        }
      }

      for (const [index, line] of dto.lines.entries()) {
        const item = itemMap.get(Number(line.itemId));
        if (!item) throw new BadRequestException(`الصنف رقم ${line.itemId} غير موجود`);

        const quantity = Number(line.quantity);
        const listPrice = listPrices.get(Number(line.itemId));
        const resolvedPrice = listPrice?.price ?? item.sell_price ?? 0;

        // A modifier (extra) hangs under the item it belongs to. Its price is
        // its own, and a zero price means a free extra.
        const isModifier = line.parentLineIndex !== undefined && line.parentLineIndex !== null;
        let modifierRow: any = null;
        if (isModifier && line.modifierId) {
          const modifierResult = await client.query<any>(
            'SELECT modifier_id, name, price, max_quantity FROM item_modifiers WHERE modifier_id = $1::int',
            [Number(line.modifierId)],
          );
          if (!modifierResult.rows.length) {
            throw new BadRequestException('الإضافة الإضافية غير موجودة');
          }
          modifierRow = modifierResult.rows[0];
        }

        // A giveaway is free for the customer but still leaves the stock, so
        // the company carries its cost. Only a manager may hand one out.
        let unitPrice = Number(line.unitPrice ?? 0);
        let isGift = false;
        if (line.isGift) {
          if (!user.permissions.includes('sales.giveaway')) {
            throw new BadRequestException('ليس لديك صلاحية منح أصناف مجانًا');
          }
          isGift = true;
          unitPrice = 0;
        } else if (isModifier) {
          unitPrice = Number(modifierRow.price ?? 0);
          if (unitPrice === 0) isGift = true;
        } else if (line.unitPrice === undefined || line.unitPrice === null) {
          unitPrice = Number(resolvedPrice);
        }
        if (!isGift && !isModifier && listPrice && listPrice.minPrice > 0 && unitPrice > 0 && unitPrice < listPrice.minPrice) {
          throw new BadRequestException(
            `سعر الصنف «${item.name}» أقل من الحد الأدنى المسموح به في قائمة الأسعار`,
          );
        }
        const discountPct = isGift ? 0 : Number(line.discountPct ?? 0);
        const taxPct = isGift ? 0 : Number(line.taxPct ?? item.vat_pct ?? 0);

        const gross = round2(quantity * unitPrice);
        const discountAmount = round2(gross * (discountPct / 100));
        const net = round2(gross - discountAmount);
        const taxAmount = round2(net * (taxPct / 100));
        const lineTotal = round2(net + taxAmount);

        const baseQty = await toBaseUnits(client, Number(item.item_id), Number(line.unitId), quantity);
        const key = `${item.item_id}:${line.unitId}`;

        let baseUnitCost = 0;
        if (invoiceType === 2) {
          // Purchase: the price on the line becomes the new weighted-average cost.
          baseUnitCost = baseQty > 0 ? net / baseQty : 0;
        } else if (invoiceType === 1) {
          // Sale: cost of goods sold comes from the warehouse average, not the item card.
          baseUnitCost = await getWarehouseCost(client, Number(item.item_id), Number(dto.warehouseId));
          if (!(baseUnitCost > 0)) baseUnitCost = Number(item.cost_price ?? 0);
        } else {
          const entry = parentLines.get(key);
          if (!entry) {
            throw new BadRequestException('الصنف أو وحدة القياس غير موجودة في الفاتورة الأصلية');
          }
          if (quantity > entry.remaining + 0.000001) {
            throw new BadRequestException(`الكمية المرتجعة أكبر من المتاح (${entry.remaining})`);
          }
          entry.remaining -= quantity;
          // Parent line cost is per selling unit; convert it to a base-unit cost.
          baseUnitCost = quantity > 0 && baseQty > 0 ? (entry.unitCost * quantity) / baseQty : 0;
          if (!(baseUnitCost > 0)) {
            baseUnitCost = await getWarehouseCost(client, Number(item.item_id), Number(dto.warehouseId));
            if (!(baseUnitCost > 0)) baseUnitCost = Number(item.cost_price ?? 0);
          }
        }

        // The purchase value is the line net; deriving it back from the base
        // unit cost would introduce a float drift that breaks the journal.
        const lineCost = invoiceType === 2 ? net : round2(baseQty * baseUnitCost);
        const unitCostSelling = quantity > 0 ? lineCost / quantity : 0;

        subTotal = round2(subTotal + gross);
        discountTotal = round2(discountTotal + discountAmount);
        taxTotal = round2(taxTotal + taxAmount);
        lineTotalSum = round2(lineTotalSum + lineTotal);
        costTotal = round2(costTotal + lineCost);

        computed.push({
          lineNumber: index + 1,
          itemId: Number(item.item_id),
          unitId: Number(line.unitId),
          baseUnitId: Number(item.base_unit_id),
          quantity,
          unitPrice,
          discountPct,
          discountAmount,
          taxPct,
          taxAmount,
          lineTotal,
          unitCost: unitCostSelling,
          baseUnitCost,
          baseQty,
          serialNo: line.serialNo ?? null,
          expiryDate: line.expiryDate ?? null,
          notes: isModifier
            ? `-- ${line.notes ?? modifierRow?.name ?? ''}`.trim()
            : line.notes ?? null,
          parentLineIndex: isModifier ? Number(line.parentLineIndex) : undefined,
          isModifier,
          trackQuantity: item.track_quantity,
        });
      }

      let headerDiscount = Number(dto.discountAmount ?? 0);
      const userDiscount = headerDiscount;

      // ---- coupon ------------------------------------------------------
      let couponDiscount = 0;
      let couponRow: any = null;
      if (dto.couponCode && invoiceType === 1) {
        couponRow = await this.resolveCoupon(client, String(dto.couponCode), effectiveBranch);
        const netBeforeCoupon = lineTotalSum - taxTotal;
        if (netBeforeCoupon < Number(couponRow.min_invoice_amount)) {
          throw new BadRequestException(
            `الكوبون يتطلب فاتورة لا تقل عن ${Number(couponRow.min_invoice_amount).toFixed(2)}`,
          );
        }
        couponDiscount = couponRow.discount_type === 1
          ? (netBeforeCoupon * Number(couponRow.discount_value)) / 100
          : Number(couponRow.discount_value);
        if (couponRow.max_discount) {
          couponDiscount = Math.min(couponDiscount, Number(couponRow.max_discount));
        }
        couponDiscount = Math.min(couponDiscount, netBeforeCoupon);
        couponDiscount = Math.round(couponDiscount * 100) / 100;
      }
      headerDiscount += couponDiscount;

      // ---- gift offers (buy X get Y free) ------------------------------
      if (invoiceType === 1) {
        const offers = await client.query<any>(
          `SELECT * FROM gift_offers
            WHERE is_active = true
              AND (start_date IS NULL OR start_date <= CURRENT_DATE)
              AND (end_date IS NULL OR end_date >= CURRENT_DATE)
            ORDER BY gift_offer_id`,
        );
        for (const offer of offers.rows) {
          const sourceQty = computed
            .filter((line) => line.itemId === Number(offer.source_item_id))
            .reduce((sum, line) => sum + line.quantity, 0);
          if (sourceQty < Number(offer.source_quantity)) continue;
          const multiples = Math.floor(sourceQty / Number(offer.source_quantity));
          if (multiples < 1) continue;

          const giftItem = await client.query<any>(
            'SELECT item_id, base_unit_id, vat_pct FROM items WHERE item_id = $1::int',
            [offer.gift_item_id],
          );
          if (!giftItem.rows.length) continue;
          const gift = giftItem.rows[0];

          // The gift leaves the stock but brings no revenue.
          const giftQty = Number(offer.gift_quantity) * multiples;
          const giftUnitId = offer.gift_unit_id ?? Number(gift.base_unit_id);
          const giftBaseQty = await toBaseUnits(
            client, Number(gift.item_id), Number(giftUnitId), giftQty,
          );
          const giftCost = await getWarehouseCost(client, Number(gift.item_id), Number(dto.warehouseId));

          computed.push({
            lineNumber: computed.length + 1,
            itemId: Number(gift.item_id),
            unitId: Number(giftUnitId),
            baseUnitId: Number(gift.base_unit_id),
            quantity: giftQty,
            unitPrice: 0,
            discountPct: 0,
            discountAmount: 0,
            taxPct: 0,
            taxAmount: 0,
            lineTotal: 0,
            unitCost: giftQty > 0 ? giftCost : 0,
            baseUnitCost: giftCost,
            baseQty: giftBaseQty,
            serialNo: null,
            expiryDate: null,
            notes: `هدية: ${offer.name}`,
            trackQuantity: true,
          });
          costTotal += giftBaseQty * giftCost;
        }
      }

      if (maxDiscount < 100 && subTotal > 0) {
        // A coupon is a promotion, not a discount the user granted, so it is
        // not part of the cashier's discount cap.
        const effectivePct = ((discountTotal + userDiscount) / subTotal) * 100;
        if (effectivePct > maxDiscount + 0.0001) {
          throw new BadRequestException(`إجمالي الخصم يتجاوز الحد المسموح لك (${maxDiscount}%)`);
        }
      }

      const deliveryFee = invoiceType === 1 ? Math.max(0, round2(Number(dto.deliveryFee ?? 0))) : 0;
      const serviceCharge = invoiceType === 1 ? Math.max(0, round2(Number(dto.serviceCharge ?? 0))) : 0;
      const totalAmount = round2(lineTotalSum - headerDiscount + deliveryFee + serviceCharge);
      const paymentTotal = paymentRows.reduce((sum, payment) => sum + payment.amount, 0);
      let paidAmount = paymentRows.length
        ? round2(paymentTotal)
        : round2(Math.max(0, Math.min(Number(dto.paidAmount ?? 0), totalAmount)));
      if (paymentRows.length && paidAmount > totalAmount + 0.005) {
        throw new BadRequestException('إجمالي المدفوع أكبر من إجمالي الفاتورة');
      }
      const remaining = round2(Math.max(0, totalAmount - paidAmount));
      const profit = round2(totalAmount - taxTotal - costTotal);

      // A collected amount must land in a cash account, otherwise the drawer
      // and the invoice would disagree with no trace of where the money went.
      if (paidAmount > 0 && !paymentRows.length && !cashAccountId) {
        throw new BadRequestException('حدد حساب الخزينة لتحصيل المبلغ');
      }
      // A single cash payment keeps the old behaviour working.
      if (!paymentRows.length && paidAmount > 0) {
        paymentRows.push({
          method: 1, amount: paidAmount, cashAccountId: cashAccountId as number,
          referenceNo: null, notes: null,
        });
      }

      // ---- credit limit (credit sales only) ------------------------------
      if (invoiceType === 1 && partyId && remaining > 0 && creditLimit > 0) {
        if (partyBalance + remaining > creditLimit + 0.005) {
          throw new BadRequestException(
            `تجاوز حد الائتمان للعميل (المتاح ${(creditLimit - partyBalance).toFixed(2)})`,
          );
        }
      }

      const sequenceKey = `invoice:${effectiveBranch}:${invoiceType}`;
      let invoiceNo = '';
      if (editedInvoice) {
        invoiceNo = String(editedInvoice.invoice_no);
      } else {
        const serial = await this.db.nextNumber(client, sequenceKey);
        invoiceNo = `${TYPE_PREFIX[invoiceType] ?? 'X'}-${new Date().getFullYear()}-${String(serial).padStart(6, '0')}`;
      }

      const invoice = editedInvoice
        ? await client.query<{ invoice_id: number }>(
          `UPDATE invoices
              SET invoice_type = $2::smallint, warehouse_id = $3::int, party_id = $4::int,
                  invoice_date = COALESCE($5::timestamptz, invoice_date), period_id = $6::int,
                  payment_type = $7::int, sub_total = $8::numeric, discount_amount = $9::numeric,
                  discount_pct = $10::numeric, tax_amount = $11::numeric, total_amount = $12::numeric,
                  paid_amount = $13::numeric, cost_total = $14::numeric, profit_amount = $15::numeric,
                  cash_account_id = $16::int, notes = $17::text, coupon_code = $18::text,
                  order_type = $19::smallint, delivery_address = $20::text, delivery_fee = $21::numeric,
                  driver_name = $22::text, driver_phone = $23::text, table_ref = $24::text,
                  rep_id = $25::int,
                  gl_journal_id = NULL, is_posted = true, posted_at = now()
            WHERE invoice_id = $1::bigint
            RETURNING invoice_id`,
          [
            Number(editedInvoice.invoice_id), invoiceType, dto.warehouseId, partyId ?? null,
            dto.invoiceDate ?? null, periodId, dto.paymentType ?? 1,
            subTotal, discountTotal + headerDiscount, Number(dto.discountPct ?? 0), taxTotal,
            totalAmount, paidAmount, costTotal, profit, cashAccountId, dto.notes ?? null,
            couponRow?.code ?? null,
            Number(dto.orderType ?? 1), dto.deliveryAddress ?? null, deliveryFee,
            dto.driverName ?? null, dto.driverPhone ?? null, dto.tableRef ?? null,
            repId ?? null,
          ],
        )
        : await client.query<{ invoice_id: number }>(
        `INSERT INTO invoices
           (invoice_no, invoice_type, branch_id, warehouse_id, party_id, invoice_date, period_id, status, payment_type,
            sub_total, discount_amount, discount_pct, tax_amount, total_amount, paid_amount, cost_total, profit_amount,
            cash_account_id, cashier_id, created_by, notes, is_posted, posted_at, client_request_id, parent_invoice_id,
            coupon_code, order_type, delivery_address, delivery_fee, service_charge, driver_name, driver_phone, table_ref, rep_id)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), $7, 2, $8, $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, true, now(), $21, $22, $23,
                 $24::smallint, $25::text, $26::numeric, $27::numeric, $28::text, $29::text, $30::text, $31::int)
         RETURNING invoice_id`,
        [
          invoiceNo, invoiceType, effectiveBranch, dto.warehouseId, partyId ?? null,
          dto.invoiceDate ?? null, periodId, dto.paymentType ?? 1,
          subTotal, discountTotal + headerDiscount, Number(dto.discountPct ?? 0), taxTotal, totalAmount, paidAmount,
          costTotal, profit, cashAccountId, user.userId, user.userId, dto.notes ?? null,
          dto.clientRequestId ?? null, dto.parentInvoiceId ?? null,
          couponRow?.code ?? null,
          Number(dto.orderType ?? 1), dto.deliveryAddress ?? null, deliveryFee, serviceCharge,
          dto.driverName ?? null, dto.driverPhone ?? null, dto.tableRef ?? null, repId ?? null,
        ],
      );
      const invoiceId = Number(invoice.rows[0].invoice_id);

      const insertedLineIds: number[] = [];
      for (const line of computed) {
        const parentLineId = line.parentLineIndex !== undefined
          ? insertedLineIds[line.parentLineIndex] ?? null
          : null;
        const insertedLine = await client.query<{ invoice_line_id: number }>(
          `INSERT INTO invoice_lines
             (invoice_id, line_number, item_id, unit_id, quantity, unit_price, discount_pct, discount_amount,
              tax_pct, tax_amount, line_total, unit_cost, serial_no, expiry_date, notes,
              parent_line_id, is_modifier)
           VALUES ($1::bigint,$2::int,$3::int,$4::int,$5::numeric,$6::numeric,$7::numeric,$8::numeric,
                   $9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::text,$14::date,$15::text,
                   $16::bigint,$17::boolean)
           RETURNING invoice_line_id`,
          [
            invoiceId, line.lineNumber, line.itemId, line.unitId, line.quantity, line.unitPrice, line.discountPct,
            line.discountAmount, line.taxPct, line.taxAmount, line.lineTotal, line.unitCost, line.serialNo,
            line.expiryDate, line.notes, parentLineId, !!line.isModifier,
          ],
        );
        insertedLineIds.push(Number(insertedLine.rows[0].invoice_line_id));

        if (line.trackQuantity) {
          await applyMovement(client, {
            branchId: effectiveBranch,
            warehouseId: dto.warehouseId,
            itemId: line.itemId,
            unitId: line.unitId,
            baseUnitId: line.baseUnitId,
            moveType: TYPE_MOVE[invoiceType] ?? 'sales',
            quantity: line.baseQty,
            unitCost: line.baseUnitCost,
            referenceType: 1,
            referenceId: invoiceId,
            referenceNo: invoiceNo,
            periodId,
            serialNo: line.serialNo,
            expiryDate: line.expiryDate,
            userId: user.userId,
          });
        }
      }

      // customer / supplier ledger
      if (partyId && remaining !== 0) {
        const partyDebit = invoiceType === 1 || invoiceType === 4;
        await client.query(
          `INSERT INTO ledger_entries
             (branch_id, party_id, entry_date, direction, entry_type, amount, invoice_id, cash_account_id,
              reference_no, notes, created_by)
           VALUES ($1,$2, now(), $3, 1, $4, $5, $6, $7, $8, $9)`,
          [
            effectiveBranch, partyId, partyDebit ? 1 : 2, remaining, invoiceId, cashAccountId,
            invoiceNo, dto.notes ?? null, user.userId,
          ],
        );
      }

      // cash movement for every collected payment
      const cashIn = invoiceType === 1 || invoiceType === 4;
      const glPayments: { glAccountId: number; amount: number }[] = [];
      for (const payment of paymentRows) {
        await client.query(
          `INSERT INTO invoice_payments
             (invoice_id, payment_method, amount, cash_account_id, reference_no, notes, created_by)
           VALUES ($1::bigint,$2::int,$3::numeric,$4::int,$5::text,$6::text,$7::int)`,
          [invoiceId, payment.method, payment.amount, payment.cashAccountId,
            payment.referenceNo, payment.notes, user.userId],
        );
        await client.query(
          `INSERT INTO cash_transactions
             (branch_id, cash_account_id, direction, amount, transaction_date, description, party_id, invoice_id,
              period_id, shift_id, created_by)
           VALUES ($1,$2,$3,$4, now(), $5, $6, $7, $8, $9, $10)`,
          [
            effectiveBranch, payment.cashAccountId, cashIn ? 1 : 2, payment.amount,
            `فاتورة ${invoiceNo}`, partyId ?? null, invoiceId, periodId,
            payment.cashAccountId === shiftAccountId ? shiftId : null, user.userId,
          ],
        );
        const glAccount = await client.query<{ gl_account_id: number | null }>(
          'SELECT gl_account_id FROM cash_accounts WHERE cash_account_id = $1::int',
          [payment.cashAccountId],
        );
        const glAccountId = glAccount.rows[0]?.gl_account_id
          ?? (await resolveMapping(client, 'CASH'))?.accountId;
        if (glAccountId) glPayments.push({ glAccountId: Number(glAccountId), amount: payment.amount });
      }

      // ---- general ledger ------------------------------------------------
      // The invoice and its journal are written inside the same transaction,
      // so the ledger can never drift away from the operational tables.
      const journalId = await postInvoiceJournal(client, {
        branchId: effectiveBranch,
        invoiceType,
        invoiceId,
        invoiceNo,
        partyId: partyId ?? null,
        cashAccountId: cashAccountId ?? null,
        paidAmount,
        remaining,
        payments: glPayments,
        grossSales: subTotal,
        discountTotal: discountTotal + headerDiscount,
        headerDiscount,
        taxTotal,
        deliveryFee,
        serviceCharge,
        costTotal,
        userId: user.userId,
      });
      if (journalId) {
        await client.query('UPDATE invoices SET gl_journal_id = $2::bigint WHERE invoice_id = $1::bigint',
          [invoiceId, journalId]);
      }

      // The coupon is consumed by this invoice.
      if (couponRow) {
        await client.query(
          'UPDATE coupons SET used_count = used_count + 1 WHERE coupon_id = $1::int',
          [Number(couponRow.coupon_id)],
        );
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [user.userId, effectiveBranch, 'invoice.post', 'invoice', String(invoiceId), `رقم ${invoiceNo}`],
      );

      this.live.publish({
        type: 'invoice.posted',
        branchId: effectiveBranch,
        warehouseId: dto.warehouseId,
        itemIds: computed.map((line) => line.itemId),
        invoiceId,
      });

      return { invoiceId, invoiceNo, totalAmount, paidAmount, remaining, parentInvoiceId: dto.parentInvoiceId ?? null };
    });
  }

  /** Looks up a coupon and rejects the ones that cannot be used. */
  private async resolveCoupon(client: PoolClient, code: string, branchId: number) {
    const result = await client.query<any>(
      `SELECT * FROM coupons
        WHERE UPPER(code) = UPPER($1::text)
          AND is_active = true
          AND (branch_id IS NULL OR branch_id = $2::int)
        LIMIT 1`,
      [code.trim(), branchId],
    );
    if (!result.rows.length) throw new BadRequestException('كود الكوبون غير صحيح');
    const coupon = result.rows[0];
    if (coupon.start_date && new Date(coupon.start_date) > new Date()) {
      throw new BadRequestException('الكوبون لم يبدأ بعد');
    }
    if (coupon.end_date && new Date(coupon.end_date) < new Date()) {
      throw new BadRequestException('انتهت صلاحية الكوبون');
    }
    if (coupon.usage_limit && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
      throw new BadRequestException('انتهى عدد مرات استخدام الكوبون');
    }
    return coupon;
  }

  /**
   * Reverses every effect of an invoice so that it can be edited.
   * The original movements stay in the ledger as reversals (audit friendly)
   * and the invoice is then written again with the new data.
   */
  private async reverseForEdit(client: PoolClient, invoiceId: number, user: AuthUser) {
    const header = await client.query<any>(
      'SELECT * FROM invoices WHERE invoice_id = $1::bigint FOR UPDATE',
      [invoiceId],
    );
    if (!header.rows.length) throw new BadRequestException('الفاتورة غير موجودة');
    const invoice = header.rows[0];
    if (Number(invoice.status) === 3) throw new BadRequestException('الفاتورة ملغاة بالفعل');

    const invoiceType = Number(invoice.invoice_type);
    if (![1, 2].includes(invoiceType)) {
      throw new BadRequestException('تعديل المرتجعات غير مسموح — ألغِ الفاتورة الأصلية بدلًا من ذلك');
    }

    // A settled invoice must not change underneath its voucher.
    const allocations = await client.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM invoice_allocations WHERE invoice_id = $1::bigint',
      [invoiceId],
    );
    if (Number(allocations.rows[0].c) > 0) {
      throw new BadRequestException('الفاتورة مخصَّصة لسند — ألغِ السند أولاً');
    }
    // Tax documents are immutable once issued.
    const zatca = await client.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM zatca_invoices WHERE invoice_id = $1::bigint',
      [invoiceId],
    );
    const eta = await client.query<{ c: number }>(
      'SELECT count(*)::int AS c FROM eta_invoices WHERE invoice_id = $1::bigint',
      [invoiceId],
    );
    if (Number(zatca.rows[0].c) > 0 || Number(eta.rows[0].c) > 0) {
      throw new BadRequestException('الفاتورة مرتبطة بمستند ضريبي — لا يمكن تعديلها');
    }

    const lines = await client.query<any>(
      'SELECT * FROM invoice_lines WHERE invoice_id = $1::bigint ORDER BY line_number',
      [invoiceId],
    );
    const reverseType: Record<number, MoveType> = { 1: 'salesReturn', 2: 'purchaseReturn', 3: 'sales', 4: 'purchase' };

    for (const line of lines.rows) {
      const quantity = Number(line.quantity);
      const baseQty = await toBaseUnits(client, Number(line.item_id), Number(line.unit_id), quantity);
      const lineCost = Number(line.unit_cost) * quantity;
      const baseUnitCost = baseQty > 0 ? lineCost / baseQty : 0;
      await applyMovement(client, {
        branchId: Number(invoice.branch_id),
        warehouseId: Number(invoice.warehouse_id),
        itemId: Number(line.item_id),
        unitId: Number(line.unit_id),
        moveType: reverseType[invoiceType] ?? 'adjustmentOut',
        quantity: baseQty,
        unitCost: baseUnitCost,
        referenceType: 1,
        referenceId: invoiceId,
        referenceNo: `${invoice.invoice_no}-E`,
        periodId: invoice.period_id,
        userId: user.userId,
        notes: 'تعديل فاتورة',
      });
    }

    // The party ledger and the cash movements are reversed with entries so
    // the history of the invoice stays visible.
    await client.query(
      `INSERT INTO ledger_entries
         (branch_id, party_id, entry_date, direction, entry_type, amount, invoice_id, cash_account_id,
          reference_no, notes, created_by)
       SELECT branch_id, party_id, now(), CASE WHEN direction = 1 THEN 2 ELSE 1 END, 5, amount,
              invoice_id, cash_account_id, COALESCE(reference_no, '') || '-E', $2, $3
         FROM ledger_entries
        WHERE invoice_id = $1 AND entry_type <> 5`,
      [invoiceId, `عكس تعديل فاتورة ${invoice.invoice_no}`, user.userId],
    );

    await client.query(
      `INSERT INTO cash_transactions
         (branch_id, cash_account_id, direction, category_id, amount, transaction_date, description,
          party_id, invoice_id, transfer_group_id, period_id, shift_id, created_by)
       SELECT branch_id, cash_account_id, CASE WHEN direction = 1 THEN 2 ELSE 1 END, category_id, amount,
              now(), $2, party_id, invoice_id, transfer_group_id, period_id, shift_id, $3
         FROM cash_transactions
        WHERE invoice_id = $1 AND COALESCE(description, '') NOT LIKE 'عكس%'`,
      [invoiceId, `عكس تعديل فاتورة ${invoice.invoice_no}`, user.userId],
    );

    // The payments of the previous version are superseded.
    await client.query('DELETE FROM invoice_payments WHERE invoice_id = $1::bigint', [invoiceId]);
    await client.query('DELETE FROM invoice_lines WHERE invoice_id = $1::bigint', [invoiceId]);

    // The coupon that was consumed by the old version is released.
    if (invoice.coupon_code) {
      await client.query(
        'UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE UPPER(code) = UPPER($1::text)',
        [invoice.coupon_code],
      );
    }

    // The accounting journal is reversed with a mirror entry.
    if (invoice.gl_journal_id) {
      await reverseJournal(client, Number(invoice.gl_journal_id), {
        userId: user.userId,
        description: `عكس تعديل فاتورة ${invoice.invoice_no}`,
      });
    }

    await client.query(
      `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
       VALUES ($1,$2,'invoice.edit','invoice',$3,$4)`,
      [user.userId, Number(invoice.branch_id), String(invoiceId), `تعديل فاتورة ${invoice.invoice_no}`],
    );

    return invoice;
  }

  /** Invoice types the current user is allowed to read. */
  private allowedTypes(user: AuthUser): number[] {
    const types: number[] = [];
    if (user.permissions.includes('sales.view') || user.permissions.includes('pos.operate')) {
      types.push(1, 3);
    }
    if (user.permissions.includes('purchases.view') || user.permissions.includes('purchases.manage')) {
      types.push(2, 4);
    }
    if (!types.length) throw new ForbiddenException('ليس لديك صلاحية لعرض الفواتير');
    return types;
  }

  async list(params: {
    type?: number; types?: number[]; branchId?: number; search?: string; from?: string; to?: string;
    page: number; pageSize: number; user: AuthUser;
  }) {
    const offset = (params.page - 1) * params.pageSize;
    const search = params.search?.trim() ?? '';
    const like = `%${search}%`;
    let allowedTypes = this.allowedTypes(params.user);
    if (params.types?.length) {
      allowedTypes = allowedTypes.filter((t) => params.types!.includes(t));
      if (!allowedTypes.length) throw new ForbiddenException('ليس لديك صلاحية لعرض هذا النوع من الفواتير');
    }
    if (params.type && !allowedTypes.includes(params.type)) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذا النوع من الفواتير');
    }

    const from = `
       FROM invoices i
       LEFT JOIN parties p ON p.party_id = i.party_id
       LEFT JOIN branches b ON b.branch_id = i.branch_id
       LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id`;

    const where = `WHERE ($1::int = 0 OR i.invoice_type = $1)
                   AND ($2::int = 0 OR i.branch_id = $2)
                   AND ($3::text = '' OR i.invoice_no ILIKE $4 OR COALESCE(p.name,'') ILIKE $4)
                   AND ($5::date IS NULL OR i.invoice_date >= $5::date)
                   AND ($6::date IS NULL OR i.invoice_date <= $6::date)
                   AND i.status <> 3
                   AND i.invoice_type = ANY($7::int[])`;

    const args = [
      params.type ?? 0, params.branchId ?? 0, search, like, params.from || null, params.to || null, allowedTypes,
    ];

    const items = await this.db.query(
      `SELECT i.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo", i.invoice_type AS "invoiceType",
              i.branch_id AS "branchId", b.name AS "branchName", i.warehouse_id AS "warehouseId",
              w.name AS "warehouseName", i.party_id AS "partyId", p.name AS "partyName", i.invoice_date AS "invoiceDate",
              i.payment_type AS "paymentType", i.sub_total AS "subTotal", i.discount_amount AS "discountAmount",
              i.tax_amount AS "taxAmount", i.total_amount AS "totalAmount", i.paid_amount AS "paidAmount",
              (i.total_amount - i.paid_amount) AS remaining,
              i.profit_amount AS "profitAmount", i.status, i.notes, i.parent_invoice_id AS "parentInvoiceId"
         ${from} ${where}
        ORDER BY i.invoice_date DESC, i.invoice_id DESC
        LIMIT $8 OFFSET $9`,
      [...args, params.pageSize, offset],
    );

    const total = await this.db.count(`SELECT COUNT(*)::int AS count ${from} ${where}`, args);
    const totals = await this.db.one<any>(
      `SELECT COALESCE(SUM(i.total_amount),0) AS total, COALESCE(SUM(i.paid_amount),0) AS paid
         ${from} ${where}`,
      args,
    );

    return { items, total, page: params.page, pageSize: params.pageSize, totals };
  }

  async findOne(id: number, user: AuthUser) {
    const header = await this.db.one<any>(
      `SELECT i.invoice_id AS "invoiceId", i.invoice_no AS "invoiceNo", i.invoice_type AS "invoiceType",
              i.branch_id AS "branchId", b.name AS "branchName", i.warehouse_id AS "warehouseId", w.name AS "warehouseName",
              i.party_id AS "partyId", p.name AS "partyName", i.invoice_date AS "invoiceDate", i.due_date AS "dueDate",
              i.payment_type AS "paymentType", i.sub_total AS "subTotal", i.discount_amount AS "discountAmount",
              i.tax_amount AS "taxAmount", i.total_amount AS "totalAmount", i.paid_amount AS "paidAmount",
              i.cost_total AS "costTotal", i.profit_amount AS "profitAmount", i.status, i.notes,
              i.cash_account_id AS "cashAccountId", i.created_by AS "createdBy", u.full_name AS "createdByName",
              i.coupon_code AS "couponCode",
              i.order_type AS "orderType", i.delivery_address AS "deliveryAddress",
              i.delivery_fee AS "deliveryFee", i.service_charge AS "serviceCharge",
              i.driver_name AS "driverName",
              i.driver_phone AS "driverPhone", i.table_ref AS "tableRef",
              i.gl_journal_id AS "glJournalId",
              i.parent_invoice_id AS "parentInvoiceId", pi.invoice_no AS "parentInvoiceNo"
         FROM invoices i
         LEFT JOIN parties p ON p.party_id = i.party_id
         LEFT JOIN branches b ON b.branch_id = i.branch_id
         LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id
         LEFT JOIN users u ON u.user_id = i.created_by
         LEFT JOIN invoices pi ON pi.invoice_id = i.parent_invoice_id
        WHERE i.invoice_id = $1`,
      [id],
    );
    if (!header) return null;

    if (!this.allowedTypes(user).includes(Number(header.invoiceType))) {
      throw new ForbiddenException('ليس لديك صلاحية لعرض هذه الفاتورة');
    }

    const lines = await this.db.query(
      `SELECT l.invoice_line_id AS "invoiceLineId", l.line_number AS "lineNumber", l.item_id AS "itemId",
              it.code AS "itemCode", it.name AS "itemName", l.unit_id AS "unitId", u.name AS "unitName",
              l.quantity, l.unit_price AS "unitPrice", l.discount_pct AS "discountPct",
              l.discount_amount AS "discountAmount", l.tax_pct AS "taxPct", l.tax_amount AS "taxAmount",
              l.line_total AS "lineTotal", l.unit_cost AS "unitCost", l.serial_no AS "serialNo",
              l.expiry_date AS "expiryDate", l.notes,
              l.parent_line_id AS "parentLineId", l.is_modifier AS "isModifier"
         FROM invoice_lines l
         JOIN items it ON it.item_id = l.item_id
         LEFT JOIN units u ON u.unit_id = l.unit_id
        WHERE l.invoice_id = $1 ORDER BY l.line_number`,
      [id],
    );

    const payments = await this.db.query(
      `SELECT p.invoice_payment_id AS "paymentId", p.payment_method AS "method", p.amount,
              p.cash_account_id AS "cashAccountId", c.name AS "cashAccountName",
              p.reference_no AS "referenceNo", p.notes, p.created_at AS "paidAt"
         FROM invoice_payments p
         LEFT JOIN cash_accounts c ON c.cash_account_id = p.cash_account_id
        WHERE p.invoice_id = $1::bigint ORDER BY p.invoice_payment_id`,
      [id],
    );

    return { header, lines, payments };
  }

  /** Cancels an invoice and reverses its stock, ledger and cash effects with new entries. */
  async cancel(id: number, user: AuthUser, expectedTypes?: number[]) {
    return this.db.transaction(async (client) => {
      const invoice = await client.query<any>('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [id]);
      if (!invoice.rows.length) throw new BadRequestException('الفاتورة غير موجودة');
      const header = invoice.rows[0];
      if (Number(header.status) === 3) throw new BadRequestException('الفاتورة ملغاة بالفعل');

      const invoiceType = Number(header.invoice_type);
      if (expectedTypes && !expectedTypes.includes(invoiceType)) {
        throw new BadRequestException('نوع الفاتورة لا يطابق المسار المطلوب');
      }
      const canCancel = invoiceType === 2 || invoiceType === 4
        ? user.permissions.includes('purchases.manage')
        : user.permissions.includes('sales.manage');
      if (!canCancel) throw new ForbiddenException('ليس لديك صلاحية إلغاء هذه الفاتورة');

      if (header.period_id) {
        const period = await client.query<{ is_closed: boolean }>(
          'SELECT is_closed FROM periods WHERE period_id = $1',
          [header.period_id],
        );
        if (period.rows[0]?.is_closed) throw new BadRequestException('لا يمكن إلغاء فاتورة في فترة مقفلة');
      }

      const lines = await client.query<any>('SELECT * FROM invoice_lines WHERE invoice_id = $1', [id]);
      const reverseType: Record<number, MoveType> = { 1: 'salesReturn', 2: 'purchaseReturn', 3: 'sales', 4: 'purchase' };

      for (const line of lines.rows) {
        const quantity = Number(line.quantity);
        const baseQty = await toBaseUnits(client, Number(line.item_id), Number(line.unit_id), quantity);
        const lineCost = Number(line.unit_cost) * quantity;
        const baseUnitCost = baseQty > 0 ? lineCost / baseQty : 0;

        await applyMovement(client, {
          branchId: Number(header.branch_id),
          warehouseId: Number(header.warehouse_id),
          itemId: Number(line.item_id),
          unitId: Number(line.unit_id),
          moveType: reverseType[invoiceType] ?? 'adjustmentOut',
          quantity: baseQty,
          unitCost: baseUnitCost,
          referenceType: 1,
          referenceId: id,
          referenceNo: `${header.invoice_no}-C`,
          periodId: header.period_id,
          userId: user.userId,
          notes: 'إلغاء فاتورة',
        });
      }

      // Reversal entries keep the original audit trail intact.
      await client.query(
        `INSERT INTO ledger_entries
           (branch_id, party_id, entry_date, direction, entry_type, amount, invoice_id, cash_account_id,
            reference_no, notes, created_by)
         SELECT branch_id, party_id, now(), CASE WHEN direction = 1 THEN 2 ELSE 1 END, 5, amount,
                invoice_id, cash_account_id, COALESCE(reference_no, '') || '-C', $2, $3
           FROM ledger_entries
          WHERE invoice_id = $1 AND entry_type <> 5`,
        [id, `عكس إلغاء فاتورة ${header.invoice_no}`, user.userId],
      );

      await client.query(
        `INSERT INTO cash_transactions
           (branch_id, cash_account_id, direction, category_id, amount, transaction_date, description,
            party_id, invoice_id, transfer_group_id, period_id, shift_id, created_by)
         SELECT branch_id, cash_account_id, CASE WHEN direction = 1 THEN 2 ELSE 1 END, category_id, amount,
                now(), $2, party_id, invoice_id, transfer_group_id, period_id, shift_id, $3
           FROM cash_transactions
          WHERE invoice_id = $1 AND COALESCE(description, '') NOT LIKE 'عكس%'`,
        [id, `عكس إلغاء فاتورة ${header.invoice_no}`, user.userId],
      );

      await client.query(
        `UPDATE invoices SET status = 3, is_posted = false WHERE invoice_id = $1`,
        [id],
      );

      // Reverse the general ledger journal with a mirror entry; the original
      // journal stays untouched for the audit trail.
      if (header.gl_journal_id) {
        const reversal = await reverseJournal(client, Number(header.gl_journal_id), {
          userId: user.userId,
          description: `عكس فاتورة ${header.invoice_no}`,
        });
        if (reversal) {
          await client.query(
            'UPDATE invoices SET gl_journal_id = $2::bigint WHERE invoice_id = $1::bigint',
            [id, reversal],
          );
        }
      }

      await client.query(
        `INSERT INTO activity_log (user_id, branch_id, action, entity, entity_id, details)
         VALUES ($1,$2,'invoice.cancel','invoice',$3,$4)`,
        [user.userId, header.branch_id, String(id), `إلغاء فاتورة ${header.invoice_no}`],
      );
      return { invoiceId: id, cancelled: true };
    });
  }
}

@Controller('sales')
export class SalesController {
  constructor(private readonly service: SalesService) {}

  @RequireAnyPermission('sales.view', 'purchases.view', 'pos.operate')
  @Get('print-context')
  printContext() {
    return this.service.printContext();
  }

  @RequireAnyPermission('sales.view', 'purchases.view', 'pos.operate')
  @Get('reps')
  reps() {
    return this.service.reps();
  }

  @RequireAnyPermission('sales.view', 'purchases.view', 'pos.operate')
  @Get('invoices')
  list(
    @Query('type') type: string,
    @Query('branchId') branchId: string,
    @Query('search') search: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list({
      type: type ? Number(type) : 0,
      branchId: branchId ? Number(branchId) : 0,
      search, from, to,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
      user,
    });
  }

  @RequireAnyPermission('sales.view', 'purchases.view', 'pos.operate')
  @Get('invoices/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @RequireAnyPermission('sales.manage', 'purchases.manage', 'pos.operate')
  @Post('invoices')
  create(@Body() dto: InvoiceInput, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    return this.service.create(dto, user, branchId);
  }

  /** Edits a posted invoice: the old version is reversed and written again. */
  @RequireAnyPermission('sales.manage', 'purchases.manage')
  @Put('invoices/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: InvoiceInput,
    @CurrentUser() user: AuthUser,
    @CurrentBranch() branchId: number,
  ) {
    return this.service.create({ ...dto, invoiceType: dto.invoiceType ?? 1 }, user, branchId, id);
  }

  @RequireAnyPermission('sales.manage', 'purchases.manage')
  @Post('invoices/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user, [1, 3]);
  }
}

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly service: SalesService) {}

  @RequireAnyPermission('purchases.view')
  @Get('invoices')
  list(
    @Query('type') type: string,
    @Query('branchId') branchId: string,
    @Query('search') search: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list({
      type: type ? Number(type) : 0,
      types: [2, 4],
      branchId: branchId ? Number(branchId) : 0,
      search, from, to,
      page: Number(page) || 1,
      pageSize: Math.min(Number(pageSize) || 20, 200),
      user,
    });
  }

  @RequireAnyPermission('purchases.view')
  @Get('invoices/:id')
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    const result = await this.service.findOne(id, user);
    if (result && ![2, 4].includes(Number(result.header.invoiceType))) {
      throw new ForbiddenException('هذه الفاتورة ليست فاتورة مشتريات');
    }
    return result;
  }

  @RequireAnyPermission('purchases.manage')
  @Post('invoices')
  create(@Body() dto: InvoiceInput, @CurrentUser() user: AuthUser, @CurrentBranch() branchId: number) {
    const invoiceType = Number(dto.invoiceType ?? 2);
    if (invoiceType !== 2 && invoiceType !== 4) {
      throw new BadRequestException('فواتير المشتريات تقبل النوع 2 (شراء) أو 4 (مرتجع شراء) فقط');
    }
    return this.service.create({ ...dto, invoiceType }, user, branchId);
  }

  @RequireAnyPermission('purchases.manage')
  @Post('invoices/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user, [2, 4]);
  }
}

@Module({
  imports: [EventsModule],
  controllers: [SalesController, PurchasesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
