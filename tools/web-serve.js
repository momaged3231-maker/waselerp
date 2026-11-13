/* Minimal static server for the Next.js SPA export (with history fallback). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'apps', 'web', 'out');
const PORT = Number(process.env.PORT ?? 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

http.createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? '/').split('?')[0]);
  let filePath = path.join(ROOT, url);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT, 'index.html'); // SPA fallback
  }

  const ext = path.extname(filePath);
  response.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}).listen(PORT, () => {
  console.log(`[web] serving ${ROOT} on http://localhost:${PORT}`);
});
