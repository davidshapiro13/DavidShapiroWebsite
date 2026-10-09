// Development-only static server. Never exposes commerce/, dotfiles, or credentials.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const remoteCatalog = process.argv.includes('--remote-catalog');
const backend = remoteCatalog ? 'https://david-shirt-shop.david-shirt-shop.workers.dev' : 'http://localhost:8787';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/shop-config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end("window.SHOP_CONFIG = { apiBase: '' };"); return;
  }
  if (path.startsWith('/api/')) {
    if (remoteCatalog && (req.method !== 'GET' || !['/api/product', '/api/health'].includes(path))) {
      res.writeHead(403); res.end(); return;
    }
    // Optional local backend; no proxy target can be supplied by the browser.
    try {
      const upstream = await fetch(`${backend}${req.url}`, {
        method: req.method, headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req, duplex: 'half',
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ available: false, message: 'The shop is getting ready. Please check back soon.' })); }
    return;
  }
  const requested = path === '/' ? 'index.html' : path.slice(1);
  if (requested.split('/').some(part => part.startsWith('.')) ||
      !(requested.startsWith('assets/') || (!requested.includes('/') && /\.(html|css|js)$/.test(requested)))) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const file = resolve(root, requested);
    if (!file.startsWith(root)) throw new Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(8080, '127.0.0.1', () => console.log('Shop preview: http://localhost:8080/shop.html'));
