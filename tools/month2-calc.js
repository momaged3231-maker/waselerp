/*
 * Phase 4 — Independent Expected Results engine (first-principles, zero ERP dependency).
 *
 * Computes what the books MUST look like after a given scenario,WITHOUT asking the ERP.
 * The ERP is only queried afterwards to check equality. Every expected number is derived
 * from the scenario data alone.
 *
 * All figures are whole integers (no fractions anywhere).
 */

const VAT = 14; // percent — fixed for this scenario

/** Weighted average cost tracker for a single item. */
class InventoryItem {
  constructor(code, name, sellPrice, vatPct, onHand = 0, avgCost = 0) {
    this.code = code;
    this.name = name;
    this.sellPrice = sellPrice;
    this.vatPct = vatPct;
    this.onHandQty = onHand;
    this.avgCost = avgCost;
  }
  /** Record a purchase at `qty` × `unitPrice` cost. */
  purchase(qty, unitPrice) {
    const priorValue = this.onHandQty * this.avgCost;
    const added = qty * unitPrice;
    this.onHandQty += qty;
    this.avgCost = this.onHandQty > 0 ? (priorValue + added) / this.onHandQty : 0;
  }
  /** Record a sale of `qty` — returns the COGS portion and updates stock. */
  sell(qty) {
    const cost = qty * this.avgCost;
    this.onHandQty -= qty;
    return cost;
  }
  stockValue() { return this.onHandQty * this.avgCost; }
}

/** Party balance tracker (AR / AP). */
class Party {
  constructor(type, name) { this.type = type; this.name = name; this.balance = 0; }
}

/** GL account tracker (for accounts 1101/1102/1103/1104/2101/5101/4101 etc.). */
class GL {
  constructor() { this.accounts = new Map(); }
  ensure(code) { if (!this.accounts.has(code)) this.accounts.set(code, 0); }
  add(code, debit = 0, credit = 0) { this.ensure(code); this.accounts.set(code, this.accounts.get(code) + debit - credit); }
  get(code) { return this.accounts.get(code) ?? 0; }
}

class Scenario {
  constructor() {
    this.items = new Map();
    this.parties = new Map();
    this.gl = new GL();
    this.journals = []; // list of { journalNo, source, lines, totalDebit, totalCredit }
    this.opening = null; // { assets, liabilities, equity }
    this.inventoryValue = 0;
    this.cogs = 0;
    this.salesGross = 0;
    this.salesDiscount = 0;
    this.salesVAT = 0;
    this.purchaseInputVAT = 0;
    this.salesCount = 0;
    this.operatingExpenses = 0; // rent + utilities
    this.damageExpense = 0;
    this.salaryExpense = 0;
    this.countVariance = 0;      // positive = shortage (expense), negative = surplus (credit to 5111)
  }

  addItem(code, name, sellPrice, vatPct, openingQty = 0, openingCost = 0) {
    this.items.set(code, new InventoryItem(code, name, sellPrice, vatPct, openingQty, openingCost));
    return this;
  }
  item(code) { return this.items.get(code); }
  addParty(type, name, opening = 0) { const p = new Party(type, name); p.balance = opening; this.parties.set(name, p); return p; }
  party(name) { return this.parties.get(name); }

  // ---- journal bookkeeping (one entry per source document) ----
  addJournal(source, lines) {
    const debit = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    // Journal must capture BOTH debit and credit sides — caller books via helper
    this.journals.push({ source, lines, totalDebit: debit, totalCredit: credit });
    return this.journals.length - 1;
  }

  // ---- opening balance ----
  setOpening({ cash, bank, ar, ap, arParty, apParty }) {
    // Inventory value is computed from items, so opening assets = items value + cash + bank + AR
    const inv = [...this.items.values()].reduce((s, i) => s + i.stockValue(), 0);
    const assets = inv + Number(cash ?? 0) + Number(bank ?? 0) + Number(ar ?? 0);
    const liab = Number(ap ?? 0);
    const equity = assets - liab;
    this.opening = { assets, liabilities: liab, equity, inv, cash, bank, ar };
    this.gl.add('1101', Number(cash ?? 0));   // Dr cash
    this.gl.add('1102', Number(bank ?? 0));    // Dr bank
    this.gl.add('1103', Number(ar ?? 0));      // Dr AR
    this.gl.add('2101', 0, Number(ap ?? 0));  // Cr AP
    // Track the opening side per-party as well so the AR/AP balances match the books.
    if (arParty) { const p = this.party(arParty); if (p) p.balance = Number(ar ?? 0); }
    if (apParty) { const p = this.party(apParty); if (p) p.balance = Number(ap ?? 0); }
    // Equity booked as credits into 3101 (retained earnings via opening)
    this.gl.add('3101', 0, equity);
    this.gl.add('3103', 0, inv);              // opening stock voucher books Dr inventory / Cr retained EPS
    return this;
  }

  // ---- operations ----
  /** Purchase (from supplier). `party` accepted for call-site convenience. */
  purchase({ supplier, party, lines, paymentType, paidAmount }) {
    const name = supplier ?? party; // accept both
    let sub = 0, vat = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      // Weighted-average cost uses the effective (discount-adjusted) unit cost.
      const effectiveCost = Number(line.unitPrice) * (1 - Number(line.discountPct ?? 0) / 100);
      item.purchase(Number(line.qty), effectiveCost);
      const lineTotal = Number(line.qty) * Number(line.unitPrice) * (1 - Number(line.discountPct ?? 0) / 100);
      const lineVat = lineTotal * (Number(line.vatPct ?? item.vatPct) / 100);
      sub += lineTotal;
      vat += lineVat;
    }
    this.purchaseInputVAT += vat;
    this.addJournal('purchase', [
      { a: 'INVENTORY', d: Math.round(sub) },
      { a: 'VAT_INPUT', d: Math.round(vat) },
      { a: paymentType === 1 ? 'CASH' : 'AP', c: Math.round(sub + vat) },
    ]);
    if (paymentType === 2) {
      const p = this.party(name);
      if (name && p) p.balance += Math.round(sub + vat);
      this.gl.add('2101', 0, Math.round(sub + vat));   // Cr AP
    } else {
      this.gl.add('1101', 0, Math.round(sub + vat));  // Cr cash
    }
    return { sub: Math.round(sub), vat: Math.round(vat), total: Math.round(sub + vat) };
  }

  /** Sales invoice. `party` accepted for call-site convenience. */
  sale({ customer, party, lines, paymentType }) {
    const buyer = customer ?? party;
    let sub = 0, vat = 0, cogs = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      const cost = item.sell(Number(line.qty));
      cogs += cost;
      const lineTotal = Number(line.qty) * Number(item.sellPrice) * (1 - Number(line.discountPct ?? 0) / 100);
      const lineVat = lineTotal * (Number(line.vatPct ?? item.vatPct) / 100);
      sub += lineTotal;
      vat += lineVat;
    }
    this.cogs += cogs;
    this.salesGross += sub;
    this.salesDiscount += lines.reduce((s, l) =>
      s + Number(l.qty) * Number(this.item(l.item).sellPrice) * (Number(l.discountPct ?? 0) / 100), 0);
    this.salesVAT += vat;
    this.salesCount += 1;
    const paymentLines = paymentType === 1 ? [{ a: 'CASH', d: Math.round(sub + vat) }] : [{ a: 'AR', d: Math.round(sub + vat) }];
    this.addJournal('sale', [
      ...paymentLines,
      { a: 'SALES', c: Math.round(sub) },
      { a: 'VAT_OUTPUT', c: Math.round(vat) },
      { a: 'COGS', d: Math.round(cogs) },
      { a: 'INVENTORY', c: Math.round(cogs) },
    ]);
    if (paymentType === 2) {
      const p = this.party(buyer);
      if (buyer && p) p.balance += Math.round(sub + vat);
      this.gl.add('1103', Math.round(sub + vat));      // Dr AR
    } else if (paymentType === 1) {
      this.gl.add('1101', Math.round(sub + vat));      // Dr cash
    } else if (paymentType === 3) {
      const p = this.party(buyer);
      const half = Math.round((sub + vat) / 2);
      if (buyer && p) p.balance += half;
      this.gl.add('1103', half);                        // Dr AR (half)
      this.gl.add('1101', Math.round(sub + vat) - half); // Dr cash (half)
    }
    return { sub: Math.round(sub), vat: Math.round(vat), cogs: Math.round(cogs), total: Math.round(sub + vat) };
  }

  /** Sales return — reverses the matching sale. */
  saleReturn({ lines, paymentType, party, customer }) {
    const buyer = party ?? customer ?? null;
    let sub = 0, vat = 0, cogs = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      item.purchase(Number(line.qty), item.avgCost); // back into stock at avg cost
      const cost = Number(line.qty) * item.avgCost;
      cogs += cost;
      const lineTotal = Number(line.qty) * Number(item.sellPrice) * (1 - Number(line.discountPct ?? 0) / 100);
      const lineVat = lineTotal * (Number(line.vatPct ?? item.vatPct) / 100);
      sub += lineTotal;
      vat += lineVat;
    }
    this.salesGross -= sub;
    this.salesVAT -= vat;
    this.cogs -= cogs;
    this.salesCount -= 1;
    const total = Math.round(sub + vat);
    this.addJournal('sale-return', [
      { a: 'SALES', d: Math.round(sub) },
      { a: 'VAT_OUTPUT', d: Math.round(vat) },
      { a: paymentType === 2 ? 'AR' : 'CASH', c: total },
      { a: 'INVENTORY', d: Math.round(cogs) },
      { a: 'COGS', c: Math.round(cogs) },
    ]);
    if (paymentType === 2) {
      // آجل return reduces the customer's receivable balance
      const p = buyer ? this.party(buyer) : null;
      if (p) p.balance -= total;
      this.gl.add('1103', 0, total);               // Cr AR
    } else {
      this.gl.add('1101', 0, total);               // Cr cash
    }
    return { sub: Math.round(sub), vat: Math.round(vat), total };
  }

  /** Stock transfer between warehouses — no GL effect. */
  transfer() { /* intentionally zero GL impact */ }

  /** Damage voucher — cost expense. */
  damage({ lines }) {
    let total = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      const cost = Number(line.qty) * item.avgCost;
      total += cost;
      // Stock reduces
      item.onHandQty -= Number(line.qty);
    }
    this.gl.add('5112', Math.round(total)); // Dr damage expense
    this.gl.add('1104', 0, Math.round(total));   // Cr inventory
    this.damageExpense += Math.round(total);
    this.addJournal('damage', [
      { a: 'DAMAGE_EXPENSE', d: Math.round(total) },
      { a: 'INVENTORY', c: Math.round(total) },
    ]);
    return { total: Math.round(total) };
  }

  /** Shortage found in count — variance, not damage. */
  shortage({ lines }) {
    let total = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      const cost = Number(line.qty) * item.avgCost;
      total += cost;
      item.onHandQty -= Number(line.qty);
    }
    this.gl.add('5111', Math.round(total)); // Dr inventory variance
    this.gl.add('1104', 0, Math.round(total));  // Cr inventory
    this.countVariance += Math.round(total);
    this.addJournal('count-shortage', [
      { a: 'INVENTORY_VARIANCE', d: Math.round(total) },
      { a: 'INVENTORY', c: Math.round(total) },
    ]);
    return { total: Math.round(total) };
  }

  /** Surplus found in count (counted > expected) — inventory up, 5111 credited (net expense reduction). */
  countSurplus({ lines }) {
    let total = 0;
    for (const line of lines) {
      const item = this.item(line.item);
      const cost = Number(line.qty) * item.avgCost;
      total += cost;
      item.onHandQty += Number(line.qty);
    }
    this.gl.add('1104', Math.round(total));  // Dr inventory
    this.gl.add('5111', 0, Math.round(total)); // Cr inventory variance (net credit)
    this.countVariance -= Math.round(total);
    this.addJournal('count-surplus', [
      { a: 'INVENTORY', d: Math.round(total) },
      { a: 'INVENTORY_VARIANCE', c: Math.round(total) },
    ]);
    return { total: Math.round(total) };
  }

  /** Simple rent/utilities expense (Dr expense / Cr cash). */
  expense({ accountCode, amount }) {
    this.gl.add(accountCode, Math.round(amount));
    this.gl.add('1101', 0, Math.round(amount));
    this.operatingExpenses += Math.round(amount);
    this.addJournal('expense', [
      { a: accountCode === '5104' ? 'RENT' : accountCode === '5105' ? 'UTILITIES' : 'OTHER_EXPENSE', d: Math.round(amount) },
      { a: 'CASH', c: Math.round(amount) },
    ]);
    return { amount: Math.round(amount) };
  }

  /** Deposit from drawer to bank — neutral transfer, journal has an entry but net zero on company total. */
  deposit({ amount }) {
    this.gl.add('1102', Math.round(amount));
    this.gl.add('1101', 0, Math.round(amount));
    this.addJournal('deposit', [
      { a: 'BANK', d: Math.round(amount) },
      { a: 'CASH', c: Math.round(amount) },
    ]);
    return { amount: Math.round(amount) };
  }

  /** Customer collection (سند قبض) — cash in, AR down. */
  collection({ customer, party, amount }) {
    const name = party ?? customer;
    this.gl.add('1101', Math.round(amount));
    this.gl.add('1103', 0, Math.round(amount));
    const p = this.party(name);
    if (p) p.balance -= Math.round(amount);
    this.addJournal('collection', [
      { a: 'CASH', d: Math.round(amount) },
      { a: 'AR', c: Math.round(amount) },
    ]);
    return { amount: Math.round(amount) };
  }

  /** Supplier payment (سند صرف) — cash out, AP down. */
  supplierPayment({ supplier, amount }) {
    this.gl.add('2101', Math.round(amount));       // Dr AP reduction
    this.gl.add('1101', 0, Math.round(amount));    // Cr cash
    const p = this.party(supplier);
    if (p) p.balance -= Math.round(amount);
    this.addJournal('supplier-payment', [
      { a: 'AP', d: Math.round(amount) },
      { a: 'CASH', c: Math.round(amount) },
    ]);
    return { amount: Math.round(amount) };
  }

  /** Payroll: generates two journals (accrual + pay). */
  payroll({ employees }) {
    let gross = 0, ins = 0;
    for (const emp of employees) {
      const basic = Number(emp.basic);
      gross += basic + Number(emp.allowance ?? 0);
      ins += Math.round(basic * 0.11);
    }
    const net = gross; // simplified — net = gross (deductions/insurance go elsewhere but we report here)
    this.gl.add('5103', Math.round(gross));
    this.gl.add('2103', 0, Math.round(gross));
    this.salaryExpense += Math.round(gross);
    this.addJournal('payroll', [
      { a: 'SALARY_EXPENSE', d: Math.round(gross) },
      { a: 'SALARY_PAYABLE', c: Math.round(gross) },
    ]);
    // Pay payroll — Dr AP / Cr Cash
    this.gl.add('2103', Math.round(gross));
    this.gl.add('1101', 0, Math.round(gross));
    this.addJournal('payroll-paid', [
      { a: 'SALARY_PAYABLE', d: Math.round(gross) },
      { a: 'CASH', c: Math.round(gross) },
    ]);
    return { gross: Math.round(gross), ins: Math.round(ins), net: Math.round(net) };
  }

  /** Trial balance / summary at end of period. */
  summary() {
    const invValue = [...this.items.values()].reduce((s, i) => s + i.stockValue(), 0);
    const arBal = [...this.parties.values()].filter((p) => p.type === 1).reduce((s, p) => s + p.balance, 0);
    const apBal = [...this.parties.values()].filter((p) => p.type === 2).reduce((s, p) => s + p.balance, 0);
    const netIncome = this.salesGross - this.cogs - this.operatingExpenses - this.salaryExpense
      - this.damageExpense - this.countVariance;
    const grossMargin = this.salesGross - this.cogs;
    return {
      inventoryValue: Math.round(invValue),
      salesGross: Math.round(this.salesGross),
      salesDiscount: Math.round(this.salesDiscount),
      salesVAT: Math.round(this.salesVAT),
      cogs: Math.round(this.cogs),
      grossMargin: Math.round(grossMargin),
      operatingExpenses: Math.round(this.operatingExpenses),
      salaryExpense: Math.round(this.salaryExpense),
      damageExpense: Math.round(this.damageExpense),
      countVariance: Math.round(this.countVariance),
      netIncome: Math.round(netIncome),
      arBalance: Math.round(arBal),
      apBalance: Math.round(apBal),
      cash: this.gl.get('1101'),
      bank: this.gl.get('1102'),
      vatOutput: Math.round(this.salesVAT),
      vatInput: Math.round(this.purchaseInputVAT),
    };
  }
}

module.exports = { Scenario, InventoryItem };
