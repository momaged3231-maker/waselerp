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
