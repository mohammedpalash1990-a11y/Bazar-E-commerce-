// Tiny static server that applies public/_headers and _redirects, so CSP problems show up before deploying.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = new URL('../public/', import.meta.url).pathname;
const port = Number(process.argv[2]) || 8788;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const rules = [];
let cur = null;
for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  if (!/^\s/.test(line)) { cur = { path: line.trim(), h: {} }; rules.push(cur); } else { const [k, ...v] = line.trim().split(':'); cur.h[k.trim()] = v.join(':').trim(); }
}
const match = (p, pat) => (pat.endsWith('*') ? p.startsWith(pat.slice(0, -1)) : p === pat);

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.startsWith('/s/')) p = '/index.html';
  let f = normalize(join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404).end('not found'); return; }
  const h = { 'content-type': types[extname(f)] || 'application/octet-stream' };
  for (const r of rules) if (match(p, r.path)) Object.assign(h, r.h);
  res.writeHead(200, h).end(readFileSync(f));
}).listen(port, () => console.log(`http://localhost:${port}`));
