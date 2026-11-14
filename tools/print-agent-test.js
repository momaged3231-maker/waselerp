/* Tests the local print agent by writing the ESC/POS stream to a file. */
const fs = require('node:fs');
const path = require('node:path');
const iconv = require(path.join(__dirname, '..', 'apps', 'print-agent', 'node_modules', 'iconv-lite'));

const BASE = process.env.AGENT_BASE ?? 'http://127.0.0.1:4100';
const TOKEN = process.env.AGENT_TOKEN ?? 'wasel-local-agent';

(async () => {
  const receipt = {
    store: { name: 'وصل ERP', phone: '0100000000', taxNumber: '300000000000003' },
    header: {
      invoiceNo: 'S-2026-000123', invoiceDate: new Date().toISOString(), partyName: 'عميل اختبار',
      branchName: 'الفرع الرئيسي', subTotal: 250, discountAmount: 10, taxAmount: 34,
      totalAmount: 274, paidAmount: 274,
    },
    lines: [{ itemName: 'منتج تجريبي', quantity: 2, unitPrice: 125, lineTotal: 250 }],
    footer: 'شكراً لتعاملكم معنا',
  };

  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('health:', JSON.stringify(health));

  const response = await fetch(`${BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-token': TOKEN },
    body: JSON.stringify({ printer: { type: 'file', path: 'receipt-test.bin' }, receipt }),
  });
  const result = await response.json().catch(() => ({}));
  console.log('print:', response.status, JSON.stringify(result));

  if (!response.ok) process.exit(1);

  // Receipt with totals hidden — the print agent must omit the discount/subtotal lines
  const hiddenResponse = await fetch(`${BASE}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-token': TOKEN },
    body: JSON.stringify({ printer: { type: 'file', path: 'receipt-test-hidden.bin' }, receipt: { ...receipt, showTotals: false, showParty: false } }),
  });
  if (!hiddenResponse.ok) { console.log('hidden receipt FAILED:', hiddenResponse.status); process.exit(1); }
  const hiddenBytes = fs.readFileSync(path.join(__dirname, '..', 'apps', 'print-agent', 'receipt-test-hidden.bin'));
  const hiddenText = iconv.decode(hiddenBytes, 'win1256');
  const totalsHidden = !hiddenText.includes('الإجمالي') && !hiddenText.includes('الخصم') && !hiddenText.includes('عميل اختبار');
  console.log('hidden receipt omits totals + party:', totalsHidden);
  if (!totalsHidden) process.exit(1);

  // Kitchen ticket — goes to /kitchen-ticket
  const kitchen = {
    branch: 'وصل ERP',
    table: 'طاولة ٢',
    orderId: 'T-0001',
    guests: 4,
    note: 'بدون شطة في السلطة',
    lines: [
      { quantity: 2, name: 'فول مدمس', note: 'بدون حار' },
      { quantity: 1, name: 'طاجن عكاوي' },
    ],
  };
  const kitchenResponse = await fetch(`${BASE}/kitchen-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agent-token': TOKEN },
    body: JSON.stringify({ printer: { type: 'file', path: 'kitchen-ticket-test.bin' }, order: kitchen, copies: 1 }),
  });
  const kitchenResult = await kitchenResponse.json().catch(() => ({}));
  console.log('kitchen-ticket:', kitchenResponse.status, JSON.stringify(kitchenResult));
  if (!kitchenResponse.ok) process.exit(1);
  const kitchenBytes = fs.readFileSync(path.join(__dirname, '..', 'apps', 'print-agent', 'kitchen-ticket-test.bin'));
  const kitchenText = iconv.decode(kitchenBytes, 'win1256');
  const hasKitchenBody = kitchenText.includes('تذكرة') && kitchenText.includes('فول مدمس') && !kitchenText.includes('250.00');
  console.log('kitchen ticket built (no prices):', hasKitchenBody);
  if (!hasKitchenBody) process.exit(1);

  const file = path.join(__dirname, '..', 'apps', 'print-agent', 'receipt-test.bin');
  const bytes = fs.readFileSync(file);
  console.log('bytes:', bytes.length);
  console.log('header hex:', bytes.subarray(0, 12).toString('hex'));
  console.log('has ESC @ (init):', bytes.subarray(0, 2).toString('hex') === '1b40');
  console.log('has GS v 0 (cut):', bytes.includes(Buffer.from([0x1d, 0x56, 0x00])));
  console.log('--- decoded (windows-1256) ---');
  console.log(iconv.decode(bytes, 'win1256').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '.'));
})().catch((error) => {
  console.error('ERROR:', error.message);
  process.exit(1);
});
