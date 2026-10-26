// Kleiner Webserver zum lokalen Testen: node tools/serve.mjs  →  http://localhost:8080
// (ES-Module funktionieren nicht, wenn man index.html direkt per Doppelklick öffnet.)
// Mit --local wird Supabase ausgeblendet, damit Tests keine Profile in der echten Datenbank anlegen.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const local = process.argv.includes('--local');
const port = Number(process.env.PORT) || (local ? 8081 : 8080);
const LOCAL_CONFIG = "export const SUPABASE_URL = '';\nexport const SUPABASE_KEY = '';\n";
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = local && pathname === '/js/config.js' ? LOCAL_CONFIG : await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}).listen(port, () =>
  console.log(`Wordle läuft auf http://localhost:${port}${local ? ' (nur lokal, ohne Supabase)' : ''}`),
);
