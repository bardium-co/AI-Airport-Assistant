// "Lite" edition for serverless hosting (Netlify Functions, free plan).
//
// The passenger side (assistant, map, routes, lounges, FAQs, 51 languages, flights) is the SAME code as the full
// server, running on a small in-memory database that is rebuilt from the built-in data whenever a function container
// starts. Everything that must survive between requests lives in a key-value `store` (Netlify Blobs in production):
// passenger help requests and messages. Staff accounts come from environment variables; sessions are signed cookies.
//
// Not included in Lite: the admin console, eligibility cases, the built-in AI model (no server to run it on).
import crypto from 'node:crypto';
import { Db } from '../db.js';
import { seed } from '../seed.js';
import { Router, SECURITY_HEADERS, HttpError, RateLimiter, parseCookies, cookie } from '../http.js';
import { Integrations } from '../services/integrations.js';
import { LlmChain } from '../services/llm.js';
import { Translator } from '../services/translate.js';
import { FlightService } from '../services/flights.js';
import { MapService } from '../services/maps.js';
import { Assistant } from '../services/assistant.js';
import { Analytics } from '../services/analytics.js';
import { registerPublic } from '../routes/public.js';
import { registerStaff } from '../routes/staff.js';
import { registerLiteSupport } from './support.js';
import { str } from '../validate.js';

const RATE = {
  chat: { capacity: 30, refillPerMin: 30 }, lookup: { capacity: 60, refillPerMin: 60 }, login: { capacity: 8, refillPerMin: 4 },
  verify: { capacity: 10, refillPerMin: 10 }, translate: { capacity: 60, refillPerMin: 60 }, support: { capacity: 5, refillPerMin: 1 },
};
const SESSION_HOURS = 12;
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const b64 = b => Buffer.from(b).toString('base64url');
const sameSecret = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/** STAFF_ACCOUNTS: JSON `[{"u":"anna","p":"…","n":"Anna K.","r":"staff"}]` or lines/`;`-separated `username:password:Display name`. */
export function parseAccounts(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  let list;
  if (text.startsWith('[')) {
    try { list = JSON.parse(text).map(a => ({ username: a.u ?? a.username, password: a.p ?? a.password, name: a.n ?? a.name, role: a.r ?? a.role })); }
    catch { return []; }
  } else {
    list = text.split(/[;\n]+/).map(l => l.trim()).filter(Boolean).map(l => {
      const i = l.indexOf(':'), j = l.indexOf(':', i + 1);
      return i < 0 ? {} : { username: l.slice(0, i), password: l.slice(i + 1, j < 0 ? undefined : j), name: j < 0 ? l.slice(0, i) : l.slice(j + 1) };
    });
  }
  return list.filter(a => a.username && a.password && String(a.password).length >= 8)
    .map((a, i) => ({ id: i + 1, username: String(a.username).trim().toLowerCase(), password: String(a.password), displayName: String(a.name || a.username).trim(), role: a.role === 'supervisor' ? 'supervisor' : 'staff' }));
}

// Staff-only routes that make sense without a database that persists. Everything else is not registered.
const STAFF_ROUTES = new Set(['GET /api/staff/phrases', 'GET /api/staff/config', 'POST /api/staff/translate', 'GET /api/staff/guidance']);

/**
 * @param {object} o
 * @param {object} o.env       environment (process.env)
 * @param {object} o.store     key-value store: get(key)→obj|null, set(key,obj), delete(key), list(prefix)→string[]
 */
export async function createLiteApp({ env = process.env, store, log = () => {}, secureCookies = true } = {}) {
  const accounts = parseAccounts(env.STAFF_ACCOUNTS);
  const secret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : 'lite:' + sha(env.STAFF_ACCOUNTS ?? 'none').toString('hex');
  const hmac = s => crypto.createHmac('sha256', secret).update(s).digest('base64url');

  const cfg = { demoMode: false, airportTimeZone: 'Asia/Qatar', sessionHours: SESSION_HOURS, secureCookies, rateScale: 1 };
  const db = new Db(':memory:');
  await seed(db, { ...cfg, demoMode: false }, () => {}); // the throw-away admin row it creates is never used
  const integrations = new Integrations(db, secret);
  integrations.ensureRows();

  // Live flights: the AirLabs key lives in the host's environment variables, never in the code or the browser.
  const key = String(env.AIRLABS_API_KEY ?? '').trim();
  if (key) {
    integrations.update('flights', {
      provider: 'airlabs', enabled: true, authorised: true,
      config: { apiKey: key, airport: env.AIRLABS_AIRPORT || 'DOH', maxPages: env.AIRLABS_MAX_PAGES || '1', dailyBudget: env.AIRLABS_DAILY_BUDGET || '30' },
    });
    integrations.setStatus('flights', 'connected', 'Key set in the host environment');
  }
  db.setSetting('demo_flights', !key); // no key → clearly-labelled simulated flights only
  db.setSetting('flight_cache_seconds', 300);
  if (env.LIBRETRANSLATE_URL) {
    integrations.update('translation', { provider: 'libretranslate', enabled: true, authorised: true, config: { baseUrl: env.LIBRETRANSLATE_URL, apiKey: env.LIBRETRANSLATE_KEY || '' } });
    integrations.setStatus('translation', 'connected', 'Set in the host environment');
  }

  const llm = new LlmChain(integrations);
  const translator = new Translator(integrations, llm);
  const flights = new FlightService(db, integrations, { timeZone: cfg.airportTimeZone });
  const maps = new MapService(db);
  const analytics = new Analytics(db);
  const assistant = new Assistant({ db, maps, flights, llm, translator, analytics, cfg });
  const deps = { db, cfg, integrations, llm, translator, flights, maps, analytics, assistant, auth: null };

  const router = new Router();
  registerPublic(router, deps);
  const staffOnly = new Router();
  registerStaff(staffOnly, deps);
  for (const r of staffOnly.routes) if (STAFF_ROUTES.has(`${r.method} ${r.pattern}`)) router.routes.push(r);
  // Authentication is replaced below; the speech-to-text relay needs a server integration that Lite does not have.
  router.routes = router.routes.filter(r => !/^\/api\/(auth|speech)\//.test(r.pattern));

  const meta = router.routes.find(r => r.method === 'GET' && r.re.test('/api/meta'));
  const baseMeta = meta.handler;
  meta.handler = (ctx) => ({ ...baseMeta(ctx), demoAccounts: [], lite: true, demoMode: !key });
  const staffConfig = router.routes.find(r => r.method === 'GET' && r.re.test('/api/staff/config'));
  const baseConfig = staffConfig.handler;
  staffConfig.handler = (ctx) => ({ ...baseConfig(ctx), lite: true, retentionDays: Number(env.SUPPORT_RETENTION_DAYS) || 7 });

  const limiter = new RateLimiter();
  const issue = (u) => {
    const payload = b64(JSON.stringify({ id: u.id, u: u.username, n: u.displayName, r: u.role, exp: Date.now() + SESSION_HOURS * 3600e3 }));
    return { token: `${payload}.${hmac(payload)}`, csrf: hmac('csrf:' + payload), expires: Date.now() + SESSION_HOURS * 3600e3 };
  };
  const readSession = (token) => {
    const [payload, sig] = String(token ?? '').split('.');
    if (!payload || !sig || !sameSecret(sig, hmac(payload))) return null;
    let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
    if (!(p.exp > Date.now())) return null;
    const acct = accounts.find(a => a.id === p.id && a.username === p.u);
    if (!acct) return null; // account removed from the environment → session ends
    return { user: { id: acct.id, username: acct.username, displayName: acct.displayName, role: acct.role, isDemo: false }, csrf: hmac('csrf:' + payload), expires: p.exp };
  };
  const ROLE = { staff: 1, supervisor: 2, admin: 3 };

  router.post('/api/auth/login', ({ body }) => {
    if (!accounts.length) throw new HttpError(503, 'Staff accounts are not set up yet. The site owner must set STAFF_ACCOUNTS in the host settings.');
    const username = str(body.username, 'username', { required: true, max: 60 }).toLowerCase();
    const password = str(body.password, 'password', { required: true, max: 200, trim: false });
    const a = accounts.find(x => x.username === username);
    const ok = sameSecret(password, a ? a.password : 'x'.repeat(40) + Math.random()) && !!a; // compare even for unknown users (constant time)
    if (!ok) throw new HttpError(401, 'Incorrect username or password');
    const s = issue(a);
    return { user: { id: a.id, username: a.username, displayName: a.displayName, role: a.role, isDemo: false }, csrf: s.csrf, expires: s.expires, __cookie: s.token };
  }, { rate: 'login' });
  router.post('/api/auth/logout', () => ({ ok: true, __cookie: '' }));
  router.get('/api/auth/me', ({ session }) => (session ? { user: session.user, csrf: session.csrf, expires: session.expires } : { user: null }));

  registerLiteSupport(router, { store, maps, analytics, translator, retentionDays: Number(env.SUPPORT_RETENTION_DAYS) || 7 });

  /** Handle one API call. Returns { status, headers, body } (body is an object). */
  async function handleApi({ method, pathname, query, headers, rawBody, ip }) {
    const send = (status, body, extra = {}) => ({ status, body, headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
    const m = router.match(method, pathname);
    if (!m) return send(404, { error: 'Not found in this edition' });
    if (m.methodNotAllowed) return send(405, { error: 'Method not allowed' });
    const { route, params } = m;
    try {
      if (route.opts.rate && !limiter.take(ip, route.opts.rate, RATE[route.opts.rate])) throw new HttpError(429, 'Too many requests — please wait a moment and try again');
      const token = parseCookies(headers.cookie).bd_sess;
      const session = readSession(token);
      const user = session?.user ?? null;
      if (route.opts.auth) {
        if (!user) throw new HttpError(401, 'Please sign in');
        if ((ROLE[user.role] ?? 0) < ROLE[route.opts.auth]) throw new HttpError(403, 'You do not have permission for this action');
      }
      const mutating = method !== 'GET' && method !== 'HEAD';
      if (mutating && session && route.opts.auth) {
        const sent = String(headers['x-csrf-token'] ?? '');
        if (!sent || !sameSecret(sent, session.csrf)) throw new HttpError(403, 'Security token mismatch — please reload the page');
      }
      let body = {};
      if (mutating && rawBody && rawBody.length) {
        if (!String(headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json');
        if (rawBody.length > 256 * 1024) throw new HttpError(413, 'Request body too large');
        try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, 'Invalid JSON body'); }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid JSON body');
      }
      const result = (await route.handler({ req: { headers }, params, query, body, user, session, token, ip })) ?? { ok: true };
      const extra = {};
      if (typeof result === 'object' && '__cookie' in result) {
        extra['Set-Cookie'] = result.__cookie ? cookie('bd_sess', result.__cookie, { maxAge: SESSION_HOURS * 3600, secure: secureCookies }) : cookie('bd_sess', '', { maxAge: 0, secure: secureCookies });
        delete result.__cookie;
      }
      return send(200, result, extra);
    } catch (e) {
      const status = e.status ?? 500;
      if (status >= 500) log(`[error] ${method} ${pathname}: ${e.stack ?? e}`);
      return send(status, { error: status >= 500 && !e.status ? 'Something went wrong. Please try again.' : e.message, ...(e.extra ?? {}) });
    }
  }

  return { handleApi, router, db, flights, accounts, close: () => db.close() };
}
