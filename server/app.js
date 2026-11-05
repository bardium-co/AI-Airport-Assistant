import http from 'node:http';
import https from 'node:https';
import { Db } from './db.js';
import { Auth, hasRole, csrfEqual, verifyPassword, hashPassword, passwordProblems } from './auth.js';
import { seed } from './seed.js';
import { Router, send, readJson, parseCookies, serveStatic, RateLimiter, clientIp, HttpError } from './http.js';
import { Integrations } from './services/integrations.js';
import { LlmChain, setLocalModel } from './services/llm.js';
import { LocalModel } from './services/localmodel.js';
import { Translator } from './services/translate.js';
import { FlightService } from './services/flights.js';
import { MapService } from './services/maps.js';
import { Assistant } from './services/assistant.js';
import { Analytics } from './services/analytics.js';
import { registerPublic } from './routes/public.js';
import { registerStaff } from './routes/staff.js';
import { registerAdmin } from './routes/admin.js';
import { registerSupport, purgeSupport } from './routes/support.js';
import { str } from './validate.js';

const RATE = {
  chat: { capacity: 30, refillPerMin: 30 },
  lookup: { capacity: 60, refillPerMin: 60 },
  login: { capacity: 8, refillPerMin: 4 },
  verify: { capacity: 10, refillPerMin: 10 },
  translate: { capacity: 60, refillPerMin: 60 },
  support: { capacity: 5, refillPerMin: 1 }, // new help requests per device/IP
};

export async function createApp(cfg, { log = console.log } = {}) {
  const db = new Db(cfg.dbFile);
  await seed(db, cfg, log);
  const integrations = new Integrations(db, cfg.secret);
  integrations.ensureRows();
  const localModel = new LocalModel(cfg.dataDir, { log });
  setLocalModel(localModel);
  const llm = new LlmChain(integrations);
  const translator = new Translator(integrations, llm);
  const flights = new FlightService(db, integrations, { timeZone: cfg.airportTimeZone });
  const maps = new MapService(db);
  const analytics = new Analytics(db);
  const assistant = new Assistant({ db, maps, flights, llm, translator, analytics, cfg });
  const auth = new Auth(db, cfg);
  const limiter = new RateLimiter();
  const scale = Number(cfg.rateScale ?? 1);
  const scaled = r => ({ capacity: r.capacity * scale, refillPerMin: r.refillPerMin * scale });
  const deps = { db, cfg, integrations, llm, translator, flights, maps, analytics, assistant, auth, localModel };
  // Warm up the built-in model in the background so the first passenger does not wait for it to load.
  const builtin = integrations.active('llm_primary');
  if (builtin?.provider === 'builtin' && !cfg.noModelWarmup) localModel.load(builtin.config.model || 'qwen3-4b').catch(e => log(`[ai] Built-in model not loaded: ${e.message}`));

  const router = new Router();
  registerPublic(router, deps);
  registerStaff(router, deps);
  registerAdmin(router, deps);
  registerSupport(router, deps);

  router.post('/api/auth/password', async ({ body, user }) => {
    const current = str(body.current, 'current password', { required: true, trim: false, max: 200 });
    const row = db.get('SELECT * FROM users WHERE id = ?', user.id);
    if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'Current password is incorrect');
    const issues = passwordProblems(body.next);
    if (issues.length) throw new HttpError(400, `New password needs ${issues.join(', ')}`);
    db.run('UPDATE users SET password_hash=?, is_demo=0 WHERE id=?', await hashPassword(body.next), user.id);
    db.audit(user, 'auth.password_change', `user:${user.id}`);
    return { ok: true };
  }, { auth: 'staff' });

  function purge() {
    const now = Date.now();
    db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    db.run('DELETE FROM transcripts WHERE expires_at < ?', now);
    analytics.purge();
    purgeSupport(db, db.getSetting('support_retention_days', 7));
  }
  purge();
  const timer = setInterval(purge, 3600 * 1000);
  timer.unref();

  async function handle(req, res) {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(cfg.publicDir, pathname, req, res);
    }
    const m = router.match(req.method, pathname);
    if (!m) return send(res, 404, { error: 'Not found' });
    if (m.methodNotAllowed) return send(res, 405, { error: 'Method not allowed' });
    const { route, params } = m;
    const ip = clientIp(req, cfg.trustProxy);
    try {
      if (route.opts.rate && !limiter.take(ip, route.opts.rate, scaled(RATE[route.opts.rate]))) {
        throw new HttpError(429, 'Too many requests — please wait a moment and try again');
      }
      const cookies = parseCookies(req.headers.cookie);
      const token = cookies.bd_sess;
      const session = auth.session(token);
      const user = session?.user ?? null;
      if (route.opts.auth) {
        if (!user) throw new HttpError(401, 'Please sign in');
        if (!hasRole(user, route.opts.auth)) throw new HttpError(403, 'You do not have permission for this action');
      }
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating && session && (route.opts.auth || pathname === '/api/auth/logout')) {
        if (!csrfEqual(String(req.headers['x-csrf-token'] ?? ''), session.csrf)) throw new HttpError(403, 'Security token mismatch — please reload the page');
      }
      let body = {};
      const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
      if (mutating && !route.opts.rawBody && (req.method !== 'DELETE' || hasBody)) body = await readJson(req, 256 * 1024);
      const result = await route.handler({ req, res, params, query: u.searchParams, body, user, session, token, ip });
      if (!res.headersSent) send(res, 200, result ?? { ok: true });
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) log(`[error] ${req.method} ${pathname}: ${e.stack ?? e}`);
      if (!res.headersSent) send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong. Please try again.' : e.message, ...(e.extra ?? {}) });
    }
  }

  const server = (cfg.tls ? https.createServer.bind(https, cfg.tls) : http.createServer)((req, res) => {
    handle(req, res).catch(e => { log(`[fatal] ${e.stack ?? e}`); if (!res.headersSent) send(res, 500, { error: 'Internal error' }); });
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 20000;

  return {
    server, db, deps,
    close: () => new Promise(resolve => { clearInterval(timer); server.close(() => { localModel.unload().finally(() => { db.close(); resolve(); }); }); server.closeAllConnections?.(); }),
  };
}
