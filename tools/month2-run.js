const { Scenario } = require('./month2-calc');
const scenario = require('./month2-scenario');

const s = new Scenario();

for (const item of scenario.items) {
  s.addItem(item.code, item.name, item.sellPrice, item.vatPct, item.openingQty, item.openingCost);
}

for (const c of scenario.customers) s.addParty(1, c.name, 0);
for (const sup of scenario.suppliers) s.addParty(2, sup.name, 0);

// set opening balance sheet (against scenario's opening balances)
// open balance sheet from the scenario's items + opening cash/bank/AR/AP.
s.setOpening({ ...scenario.opening, arParty: 'شركة النيل للأنظمة', apParty: 'شركة سبيد تك للتوزيع' });

console.log('=== OPENING BALANCE SHEET ===');
console.log(JSON.stringify(s.opening, null, 2));

const salesCreated = new Map(); // map sale → created party/note for reference  
for (const op of scenario.days) {
  switch (op.type) {
    case 'opening': break;
    case 'purchase': {
      const res = s.purchase(op);
      console.log(`purchase: sub=${res.sub} vat=${res.vat} total=${res.total}`);
      break;
    }
    case 'sale': {
      const res = s.sale(op);
      console.log(`sale:     sub=${res.sub} vat=${res.vat} cogs=${res.cogs} total=${res.total}`);
      break;
    }
    case 'sale_return': {
      const res = s.saleReturn({ lines: op.lines, paymentType: op.paymentType, party: op.party });
      console.log(`return:   sub=${res.sub} vat=${res.vat} total=${res.total}`);
      break;
    }
    case 'transfer':
      console.log('transfer: no GL effect');
      break;
    case 'damage': {
      const res = s.damage(op);
      console.log(`damage:   value=${res.total}`);
      break;
    }
    case 'count_shortage': {
      const res = s.countSurplus(op); // counted (14) > system (13) → surplus
      console.log(`count surplus: value=${res.total}`);
      break;
    }
    case 'expense': {
      const res = s.expense(op);
      console.log(`expense:  ${op.accountCode} amount=${res.amount}`);
      break;
    }
    case 'deposit': {
      const res = s.deposit(op);
      console.log(`deposit:  ${res.amount}`);
      break;
    }
    case 'collection': {
      const res = s.collection(op);
      console.log(`collect:  ${res.amount}`);
      break;
    }
    case 'supplier_payment': {
      const res = s.supplierPayment(op);
      console.log(`supplier pay: ${res.amount}`);
      break;
    }
    case 'payroll': {
      const res = s.payroll(op);
      console.log(`payroll:  gross=${res.gross} net=${res.net}`);
      break;
    }
    case 'create_then_cancel':
      console.log('cancel:   (order created and cancelled — net effect zero)');
      break;
    case 'quotation_order_invoice': {
      const res = s.sale(op);
      console.log(`quotation→invoice: sub=${res.sub} vat=${res.vat} cogs=${res.cogs} total=${res.total}`);
      break;
    }
  }
}

console.log('\n=== EXPECTED RESULTS (computed independently) ===');
console.log(JSON.stringify(s.summary(), null, 2));
