/*
 * WaselERP Print Agent — runs on the cashier PC.
 *
 *   node server.js
 *
 * Endpoints (all on http://127.0.0.1:4100):
 *   GET  /health        → agent status
 *   GET  /printers      → Windows printers + configured network printers
 *   POST /print         → prints a receipt (ESC/POS)
 *   POST /open-drawer   → pulses the cash drawer
 *   GET  /config        → saved settings
 *   POST /config        → save settings
 *
 * Security: bound to localhost and protected by a shared token (WASEL_AGENT_TOKEN)
 * that the web client sends in the x-agent-token header.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { execFile } = require('node:child_process');
const iconv = require('iconv-lite');

const PORT = Number(process.env.AGENT_PORT ?? 4100);
const HOST = process.env.AGENT_HOST ?? '127.0.0.1';
const TOKEN = process.env.WASEL_AGENT_TOKEN ?? 'wasel-local-agent';
const CONFIG_PATH = path.join(__dirname, 'agent-config.json');
const PS_SCRIPT = path.join(__dirname, 'printer.ps1');

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { defaultPrinter: '', networkPrinters: [], autoOpenDrawer: false, paperWidth: 42 };
  }
};

const saveConfig = (config) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
};

// ------------------------------------------------------------------ //
// ESC/POS helpers
// ------------------------------------------------------------------ //
const ESC = 0x1b;
const GS = 0x1d;

const cmd = {
  init: () => Buffer.from([ESC, 0x40]),
  center: () => Buffer.from([ESC, 0x61, 0x01]),
  left: () => Buffer.from([ESC, 0x61, 0x00]),
  right: () => Buffer.from([ESC, 0x61, 0x02]),
  doubleOn: () => Buffer.from([ESC, 0x21, 0x30]),
  doubleOff: () => Buffer.from([ESC, 0x21, 0x00]),
  boldOn: () => Buffer.from([ESC, 0x45, 0x01]),
  boldOff: () => Buffer.from([ESC, 0x45, 0x00]),
  spacing: (n) => Buffer.from([ESC, 0x33, n]),
  feed: (n) => Buffer.from([ESC, 0x64, n]),
  cut: () => Buffer.from([GS, 0x56, 0x00]),
  drawer: () => Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]),
};

/** Arabic-capable thermal printers usually speak Windows-1256 / CP864. */
function encodeText(text) {
  return iconv.encode(String(text ?? ''), 'win1256');
}

function line(text, { align = 'left', width = 42, bold = false, double = false } = {}) {
  const parts = [];
  if (bold) parts.push(cmd.boldOn());
  if (double) parts.push(cmd.doubleOn());
  parts.push(align === 'center' ? cmd.center() : align === 'right' ? cmd.right() : cmd.left());
  const clean = String(text ?? '');
  const pad = Math.max(0, width - clean.length);
  parts.push(encodeText(align === 'left' ? clean + ' '.repeat(pad) : ' '.repeat(pad) + clean));
  if (double) parts.push(cmd.doubleOff());
  if (bold) parts.push(cmd.boldOff());
  parts.push(Buffer.from('\r\n'));
  return Buffer.concat(parts);
}

function buildReceiptBytes(receipt, width = 42) {
  const chunks = [cmd.init(), cmd.spacing(24)];
  const store = receipt.store ?? {};

  chunks.push(line(store.name ?? 'WaselERP', { align: 'center', width, bold: true, double: true }));
  if (store.address) chunks.push(line(store.address, { align: 'center', width }));
  if (store.phone) chunks.push(line(`هاتف: ${store.phone}`, { align: 'center', width }));
  if (store.taxNumber) chunks.push(line(`الرقم الضريبي: ${store.taxNumber}`, { align: 'center', width }));
  chunks.push(line('-'.repeat(width), { width }));

  const header = receipt.header ?? {};
  chunks.push(line(`فاتورة: ${header.invoiceNo ?? ''}`, { width }));
  chunks.push(line(`التاريخ: ${new Date(header.invoiceDate ?? Date.now()).toLocaleString('ar-EG')}`, { width }));
  if (header.partyName) chunks.push(line(`العميل: ${header.partyName}`, { width }));
  if (header.branchName) chunks.push(line(`الفرع: ${header.branchName}`, { width }));
  chunks.push(line('-'.repeat(width), { width }));
  chunks.push(line('الصنف', { width, bold: true }));
  chunks.push(line('كمية        سعر        إجمالي', { width, bold: true }));

  for (const item of receipt.lines ?? []) {
    const name = String(item.itemName ?? '').slice(0, width);
    chunks.push(line(name, { width }));
    chunks.push(
      line(
        `${Number(item.quantity).toFixed(2).padStart(6)}  ${Number(item.unitPrice).toFixed(2).padStart(9)}  ${Number(item.lineTotal).toFixed(2).padStart(10)}`,
        { width },
      ),
    );
  }

  chunks.push(line('-'.repeat(width), { width }));
  chunks.push(line(`الإجمالي: ${Number(header.subTotal ?? 0).toFixed(2)}`, { align: 'right', width }));
  if (Number(header.discountAmount ?? 0) !== 0) {
    chunks.push(line(`الخصم: ${Number(header.discountAmount).toFixed(2)}`, { align: 'right', width }));
  }
  if (Number(header.taxAmount ?? 0) !== 0) {
    chunks.push(line(`الضريبة: ${Number(header.taxAmount).toFixed(2)}`, { align: 'right', width }));
  }
  chunks.push(line(`المطلوب: ${Number(header.totalAmount ?? 0).toFixed(2)}`, { align: 'right', width, bold: true, double: true }));
  chunks.push(line(`المدفوع: ${Number(header.paidAmount ?? 0).toFixed(2)}`, { align: 'right', width }));
  if (receipt.footer) chunks.push(line(receipt.footer, { align: 'center', width }));
  chunks.push(cmd.feed(3), cmd.cut());

  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------ //
// Transports
// ------------------------------------------------------------------ //
function sendToNetworkPrinter(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 9100 }, () => {
      socket.write(bytes, () => socket.end());
    });
    socket.on('close', () => resolve(bytes.length));
    socket.on('error', reject);
    socket.setTimeout(8000, () => {
      socket.destroy(new Error('printer timeout'));
    });
  });
}

function sendToWindowsPrinter(printerName, bytes) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT,
        '-Action', 'raw', '-Printer', printerName, '-Base64', bytes.toString('base64')],
      { timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr?.trim() || error.message));
        else resolve(Number(stdout.trim()) || bytes.length);
      },
    );
  });
}

/** Writes the raw ESC/POS stream to a file — used for testing without a printer. */
function writeToFile(filePath, bytes) {
  const target = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
  fs.writeFileSync(target, bytes);
  return bytes.length;
}

function listWindowsPrinters() {  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-Action', 'list'],
      { timeout: 20_000 },
      (error, stdout) => {
        if (error) return resolve([]);
        try {
          const parsed = JSON.parse(stdout.trim() || '[]');
          return resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          return resolve([]);
        }
      },
    );
  });
}

// ------------------------------------------------------------------ //
// HTTP API
// ------------------------------------------------------------------ //
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  const token = request.headers['x-agent-token'];
  const allowed = url.pathname === '/health' || token === TOKEN;

  const send = (status, payload) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-agent-token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    response.end(JSON.stringify(payload));
  };

  if (request.method === 'OPTIONS') return send(204, {});
  if (!allowed) return send(401, { ok: false, error: 'unauthorized' });

  try {
    if (url.pathname === '/health') {
      return send(200, { ok: true, agent: 'wasel-print-agent', version: '1.0.0', port: PORT });
    }

    if (url.pathname === '/config' && request.method === 'GET') {
      return send(200, { ok: true, config: loadConfig() });
    }

    if (url.pathname === '/config' && request.method === 'POST') {
      const body = await readBody(request);
      const config = { ...loadConfig(), ...body };
      saveConfig(config);
      return send(200, { ok: true, config });
    }

    if (url.pathname === '/printers') {
      const [windows, config] = [await listWindowsPrinters(), loadConfig()];
      return send(200, {
        ok: true,
        printers: [
          ...windows.map((printer) => ({ type: 'windows', name: printer.Name, driver: printer.DriverName, port: printer.PortName })),
          ...(config.networkPrinters ?? []).map((printer) => ({ type: 'network', ...printer })),
        ],
      });
    }

    if (url.pathname === '/print' && request.method === 'POST') {
      const body = await readBody(request);
      const config = loadConfig();
      const width = Number(body.width ?? config.paperWidth ?? 42);
      const bytes = buildReceiptBytes(body.receipt ?? body, width);

      const target = body.printer ?? (config.defaultPrinter ? { type: 'windows', name: config.defaultPrinter } : null);
      if (!target) return send(400, { ok: false, error: 'no printer configured' });

      const written = target.type === 'network'
        ? await sendToNetworkPrinter(target.host, target.port, bytes)
        : target.type === 'file'
          ? await writeToFile(target.path ?? 'receipt.bin', bytes)
          : await sendToWindowsPrinter(target.name, bytes);

      if (config.autoOpenDrawer) {
        await sendToWindowsPrinter(target.name, cmd.drawer()).catch(() => {});
      }
      return send(200, { ok: true, bytes: written });
    }

    if (url.pathname === '/open-drawer' && request.method === 'POST') {
      const body = await readBody(request);
      const config = loadConfig();
      const target = body.printer ?? (config.defaultPrinter ? { type: 'windows', name: config.defaultPrinter } : null);
      if (!target) return send(400, { ok: false, error: 'no printer configured' });
      if (target.type === 'network') {
        await sendToNetworkPrinter(target.host, target.port, cmd.drawer());
      } else {
        await sendToWindowsPrinter(target.name, cmd.drawer());
      }
      return send(200, { ok: true });
    }

    return send(404, { ok: false, error: 'not found' });
  } catch (error) {
    return send(500, { ok: false, error: error?.message ?? 'unknown error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[print-agent] listening on http://${HOST}:${PORT}`);
  console.log(`[print-agent] token: ${TOKEN === 'wasel-local-agent' ? 'DEFAULT (change it!)' : 'custom'}`);
});
