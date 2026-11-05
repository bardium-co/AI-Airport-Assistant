// Run the Lite (Netlify) edition on your own computer to try it:  npm run lite
// State is kept in memory, so help requests are lost when you stop it. On Netlify they are kept in Netlify Blobs.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiteApp } from './app.js';
import { MemoryStore } from './support.js';
import { serveStatic, send } from '../http.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const env = { STAFF_ACCOUNTS: 'staff:Staff-Pass-2026:Demo Staff', ...process.env };
const app = await createLiteApp({ env, store: new MemoryStore(), secureCookies: false, log: console.log });
const port = Number(process.env.PORT ?? 8888);

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/api/')) return serveStatic(publicDir, u.pathname, req, res);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await app.handleApi({ method: req.method, pathname: u.pathname, query: u.searchParams, headers: req.headers, rawBody: Buffer.concat(chunks).toString('utf8'), ip: req.socket.remoteAddress });
    res.writeHead(r.status, r.headers); res.end(JSON.stringify(r.body));
  } catch (e) { console.error(e); send(res, 500, { error: 'Internal error' }); }
}).listen(port, '127.0.0.1', () => console.log(`\n  AI Airport Assistant — LITE edition (as on Netlify)\n  http://localhost:${port}\n  Staff sign-in: ${env.STAFF_ACCOUNTS.split(':').slice(0, 2).join(' / ')}\n`));
