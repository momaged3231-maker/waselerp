/* Engine vs ERP inventory breakdown (engine side) */
const { Scenario } = require('./month2-calc');
const scenario = require('./month2-scenario');

const s = new Scenario();
for (const item of scenario.items) s.addItem(item.code, item.name, item.sellPrice, item.vatPct, item.openingQty, item.openingCost);
for (const c of scenario.customers) s.addParty(1, c.name, 0);
for (const sup of scenario.suppliers) s.addParty(2, sup.name, 0);
s.setOpening({ ...scenario.opening, arParty: 'شركة النيل للأنظمة', apParty: 'شركة سبيد تك للتوزيع' });

for (const op of scenario.days.slice(1)) {
  switch (op.type) {
    case 'purchase': s.purchase(op); break;
    case 'sale': s.sale(op); break;
    case 'sale_return': s.saleReturn({ lines: op.lines, paymentType: op.paymentType, party: op.party }); break;
    case 'count_shortage': s.countSurplus(op); break;
    case 'damage': s.damage(op); break;
    case 'expense': s.expense(op); break;
    case 'deposit': s.deposit(op); break;
    case 'collection': s.collection(op); break;
    case 'payroll': s.payroll(op); break;
    case 'quotation_order_invoice': s.sale(op); break;
    case 'transfer': case 'opening': case 'create_then_cancel': break;
  }
}

let total = 0;
for (const [code, item] of s.items) {
  const v = item.stockValue();
  total += v;
  if (item.onHandQty > 0) console.log(`${code}: qty=${item.onHandQty} avg=${item.avgCost.toFixed(4)} value=${v.toFixed(2)}`);
}
console.log('engine inventory total:', total.toFixed(2));
console.log('engine cosgs:', s.cogs.toFixed(2));
console.log('engine cash gl:', s.gl.get('1101'), 'ar:', s.gl.get('1103'), 'ap:', s.gl.get('2101'));
console.log('summary:', JSON.stringify(s.summary(), null, 1));
