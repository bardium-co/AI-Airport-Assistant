import http from 'node:http';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

export async function startApp(overrides = {}) {
  const cfg = loadConfig({ dbFile: ':memory:', secret: 'test-secret-'.padEnd(48, 'x'), demoMode: true, production: false, secureCookies: false, rateScale: 100, tls: null, noModelWarmup: true, ...overrides });
  const app = await createApp(cfg, { log: () => {} });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const client = makeClient(base);
  return { app, base, cfg, ...client, close: () => app.close() };
}

export function makeClient(base) {
  async function req(method, path, body, { cookie, csrf, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    if (cookie) h.Cookie = cookie;
    if (csrf) h['X-CSRF-Token'] = csrf;
    const res = await fetch(base + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  async function login(username, password) {
    const r = await req('POST', '/api/auth/login', { username, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${r.text}`);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const s = { cookie, csrf: r.json.csrf, user: r.json.user };
    s.get = p => req('GET', p, undefined, s);
    s.post = (p, b = {}) => req('POST', p, b, s);
    s.put = (p, b = {}) => req('PUT', p, b, s);
    s.del = p => req('DELETE', p, undefined, s);
    return s;
  }
  return { req, login, get: p => req('GET', p), post: (p, b) => req('POST', p, b) };
}

export const DEMO = { staff: ['staff', 'Staff#2026demo'], supervisor: ['supervisor', 'Super#2026demo'], admin: ['admin', 'Admin#2026demo'] };

/** A configurable mock of external systems: OpenAI-compatible LLM, LibreTranslate, flight feed, loyalty API. */
export async function startMock(handlers = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = JSON.parse(bodyText); } catch { /* ignore */ }
    const url = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: url.pathname, body, headers: req.headers });
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    for (const [pattern, fn] of Object.entries(handlers)) {
      const [m, p] = pattern.split(' ');
      const re = new RegExp('^' + p.replace(/:(\w+)/g, '([^/]+)') + '$');
      const mm = url.pathname.match(re);
      if (req.method === m && mm) {
        const out = await fn({ body, params: mm.slice(1), headers: req.headers, url });
        const isEnvelope = out && typeof out.status === 'number' && 'json' in out;
        return send(isEnvelope ? out.status : 200, isEnvelope ? out.json : out);
      }
    }
    send(404, { error: 'not found' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(r => server.close(r)) };
}

export function llmReply(content) {
  return { choices: [{ message: { role: 'assistant', content } }] };
}

/** Configure + authorise + enable + test an integration via the admin API. */
export async function connectIntegration(admin, id, provider, config) {
  const u = await admin.put(`/api/admin/integrations/${id}`, { provider, config, enabled: true, authorised: true });
  if (u.status !== 200) throw new Error(`integration update failed: ${u.text}`);
  const t = await admin.post(`/api/admin/integrations/${id}/test`);
  if (t.status !== 200) throw new Error(`integration test failed: ${t.text}`);
  return t.json;
}
