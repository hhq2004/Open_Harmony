import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.P07_DEMO_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid P07_DEMO_PORT.');
const files = new Map([
  ['/', 'demo/index.html'],
  ['/app.js', 'demo/app.js'],
  ['/style.css', 'demo/style.css'],
  ['/config/prediction.json', 'config/prediction.json'],
]);

const server = createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  let relative = files.get(pathname);
  if (!relative && /^\/dist\/(application|prediction|preload)\/[a-z0-9-]+\.js$/.test(pathname)) {
    relative = pathname.slice(1);
  }
  if (!relative) {
    response.writeHead(404).end();
    return;
  }
  const absolute = resolve(root, relative);
  if (!absolute.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(absolute);
    const contentType = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }[extname(absolute)];
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`P07 A/B/C host demo: http://127.0.0.1:${port}/`);
});
