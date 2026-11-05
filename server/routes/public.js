import { HttpError, readBody, cookie } from '../http.js';
import { str, oneOf, bool } from '../validate.js';
import { faqView, loungeView } from '../services/assistant.js';
import { rankLounges, isOpenNow, CABINS, CARRIERS, TIERS } from '../services/eligibility.js';
import { joinUrl } from '../services/integrations.js';
import { PLACE_TO_LOCATION_TYPE, PLACES, statusText } from '../services/phrases.js';
import { hasKeyword } from '../services/nlu.js';
import { MAP_W, MAP_H } from '../seed.js';

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const LOC_RE = /^[A-Z0-9_]{1,40}$/;

export function registerPublic(router, d) {
  const { db, cfg, assistant, flights, maps, integrations, translator, analytics, auth, llm } = d;

  router.get('/api/health', () => ({ ok: true, time: new Date().toISOString() }));

  router.get('/api/meta', () => {
    const languages = db.all('SELECT code,name,native_name,speech_code,rtl,builtin FROM languages WHERE enabled = 1 ORDER BY sort, name')
      .map(l => ({ code: l.code, name: l.name, native: l.native_name, speech: l.speech_code, rtl: !!l.rtl, builtin: !!l.builtin }));
    return {
      app: 'AI Airport Assistant', airport: { name: 'Hamad International Airport', code: 'DOH', city: 'Doha, Qatar', timeZone: cfg.airportTimeZone },
      demoMode: cfg.demoMode, languages, integrations: integrations.publicSummary(), flightSource: flights.source(),
      translation: translator.status(), ai: llm.available(), mapSimulated: !!db.getSetting('map_is_simulated', true),
      defaultLocation: db.getSetting('default_location', 'PLAZA'),
      places: Object.fromEntries(Object.entries(PLACES).map(([type, byLang]) => [type, Object.fromEntries(Object.entries(byLang).map(([l, list]) => [l, list[0]]))])),
      demoAccounts: cfg.demoMode ? [{ username: 'staff', password: 'Staff#2026demo', role: 'staff' }, { username: 'supervisor', password: 'Super#2026demo', role: 'supervisor' }, { username: 'admin', password: 'Admin#2026demo', role: 'admin' }] : [],
    };
  });

  router.post('/api/assistant/chat', async ({ body }) => {
    const message = str(body.message, 'message', { required: true, max: 500 });
    const lang = str(body.lang, 'lang', { pattern: LANG_RE }) ?? 'en';
    const from = str(body.from, 'from', { pattern: LOC_RE });
    const alternatives = Array.isArray(body.alternatives) ? body.alternatives.slice(0, 5).filter(a => typeof a === 'string').map(a => a.slice(0, 500)) : [];
    return assistant.answer({ message, alternatives, lang, from, stepFree: bool(body.stepFree), mode: body.mode === 'kiosk' ? 'kiosk' : 'passenger' });
  }, { rate: 'chat' });

  router.get('/api/flights', async ({ query }) => {
    const lang = str(query.get('lang'), 'lang', { pattern: LANG_RE }) ?? 'en';
    const b = await flights.departures();
    analytics.record('passenger', 'departures_board', lang);
    return {
      ...b,
      flights: b.flights.slice(0, 300).map(f => ({ ...f, statusLabel: statusText(lang, f.status), gateLocationId: f.gate ? maps.gateLocation(f.gate)?.id ?? null : null })),
    };
  }, { rate: 'lookup' });

  router.get('/api/flights/:no', async ({ params, query }) => {
    const lang = str(query.get('lang'), 'lang', { pattern: LANG_RE }) ?? 'en';
    const r = await flights.lookup(params.no);
    analytics.record('passenger', 'flight_lookup', lang);
    if (r.status === 'found') {
      r.flight.statusLabel = statusText(lang, r.flight.status);
      if (r.flight.gate) r.gateLocationId = maps.gateLocation(r.flight.gate)?.id ?? null;
    }
    return r;
  }, { rate: 'lookup' });

  router.get('/api/map', () => {
    const locations = db.all('SELECT id,type,name,concourse,level,x,y,status,simulated,accessible FROM locations')
      .map(l => ({ ...l, simulated: !!l.simulated, accessible: !!l.accessible }));
    const edges = db.all('SELECT a,b,kind,step_free,distance_m FROM edges').map(e => ({ ...e, step_free: !!e.step_free }));
    const lounges = db.all('SELECT id,location_id,name,status FROM lounges');
    return { simulated: !!db.getSetting('map_is_simulated', true), width: MAP_W, height: MAP_H, locations, edges, lounges, indoorMap: integrations.publicSummary().indoor_map };
  });

  router.get('/api/route', ({ query }) => {
    const from = str(query.get('from'), 'from', { required: true, pattern: LOC_RE });
    const to = str(query.get('to'), 'to', { required: true, pattern: LOC_RE });
    const r = maps.route(from, to, { stepFree: bool(query.get('stepFree')) });
    if (!r) throw new HttpError(404, 'No route found between these locations');
    return r;
  }, { rate: 'lookup' });

  router.get('/api/nearest', ({ query }) => {
    const from = str(query.get('from'), 'from', { required: true, pattern: LOC_RE });
    const type = oneOf(query.get('type'), 'type', Object.values(PLACE_TO_LOCATION_TYPE).concat(['lounge', 'gate']), { required: true });
    const r = maps.nearest(from, type, { stepFree: bool(query.get('stepFree')) });
    if (!r) throw new HttpError(404, 'Nothing of that type is reachable');
    return r;
  }, { rate: 'lookup' });

  router.post('/api/lounges/recommend', ({ body }) => {
    const from = str(body.from, 'from', { pattern: LOC_RE }) ?? db.getSetting('default_location', 'PLAZA');
    const profile = {
      carrier: oneOf(body.carrier, 'carrier', CARRIERS), cabin: oneOf(body.cabin, 'cabin', CABINS), tier: oneOf(body.tier, 'tier', TIERS, { fallback: 'NONE' }),
    };
    const stepFree = bool(body.stepFree);
    const sp = maps.speeds();
    const lounges = db.all('SELECT * FROM lounges').map(loungeView);
    const ranked = rankLounges(lounges, profile, maps.distancesFrom(from, { stepFree }), stepFree ? sp.stepFree : sp.normal)
      .map(l => ({ ...l, openNow: isOpenNow(l.hours, Date.now(), cfg.airportTimeZone) }));
    analytics.record('passenger', 'lounge_recommend', 'xx');
    return { from, profile, lounges: ranked, verified: false, notice: 'Provisional only — entry is always verified by staff at the lounge reception. Lounge data is simulated configuration.' };
  }, { rate: 'lookup' });

  router.get('/api/lounges/verification/:code', ({ params }) => {
    const code = str(params.code, 'code', { required: true, max: 20 }).toUpperCase();
    const c = db.get(`SELECT c.*, l.name AS lounge_name FROM eligibility_cases c LEFT JOIN lounges l ON l.id = json_extract(c.inputs,'$.loungeId') WHERE c.ref_code = ?`, code);
    if (!c) throw new HttpError(404, 'Verification code not found');
    const valid = c.status === 'approved' && c.ref_expires > Date.now();
    return { code, valid, status: c.status, lounge: c.lounge_name, approvedAt: c.decided_at, expiresAt: c.ref_expires };
  }, { rate: 'verify' });

  router.get('/api/faqs', async ({ query }) => {
    const lang = str(query.get('lang'), 'lang', { pattern: LANG_RE }) ?? 'en';
    const q = (str(query.get('q'), 'q', { max: 200 }) ?? '').toLowerCase();
    let rows = db.all('SELECT * FROM faqs WHERE published = 1 ORDER BY category, id');
    if (q) rows = rows.filter(r => r.keywords.split(',').some(k => k.trim() && hasKeyword(q, k.trim())) || r.translations.toLowerCase().includes(q));
    const items = rows.map(r => faqView(r, lang));
    return { lang, items };
  }, { rate: 'lookup' });

  router.post('/api/faqs/translate', async ({ body }) => {
    const lang = str(body.lang, 'lang', { required: true, pattern: LANG_RE });
    const id = Number(body.id);
    const row = db.get('SELECT * FROM faqs WHERE id = ? AND published = 1', id);
    if (!row) throw new HttpError(404, 'FAQ not found');
    const v = faqView(row, 'en');
    const [q, a] = await Promise.all([translator.translate(v.q, 'en', lang), translator.translate(v.a, 'en', lang)]);
    if (!q.text || !a.text) throw new HttpError(503, 'Translation provider not configured');
    return { id, q: q.text, a: a.text, machine: true, engine: a.engine };
  }, { rate: 'chat' });

  // Optional server-side speech recognition via a Whisper-compatible server.
  router.post('/api/speech/transcribe', async ({ req, query }) => {
    const stt = integrations.active('stt');
    if (!stt) throw new HttpError(503, 'Server speech recognition is not connected — use device speech recognition');
    const lang = str(query.get('lang'), 'lang', { pattern: LANG_RE }) ?? 'en';
    const type = String(req.headers['content-type'] ?? '');
    if (!/^audio\/(webm|ogg|wav|mp4|mpeg|x-wav)/.test(type)) throw new HttpError(415, 'Unsupported audio type');
    const audio = await readBody(req, 10 * 1024 * 1024);
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), 'speech.' + (type.split('/')[1].split(';')[0] || 'webm'));
    form.append('model', stt.config.model || 'whisper-1');
    form.append('language', lang);
    const headers = stt.config.apiKey ? { Authorization: `Bearer ${stt.config.apiKey}` } : {};
    const res = await fetch(joinUrl(stt.config.baseUrl, 'audio/transcriptions'), { method: 'POST', body: form, headers, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new HttpError(502, `Speech service error (${res.status})`);
    const data = await res.json();
    return { text: String(data.text ?? '').trim() };
  }, { rate: 'chat', rawBody: true });

  // ---- Authentication ----
  router.post('/api/auth/login', async ({ body, res }) => {
    const username = str(body.username, 'username', { required: true, max: 60 });
    const password = str(body.password, 'password', { required: true, max: 200, trim: false });
    const r = await auth.login(username, password);
    if (!r.ok) throw new HttpError(r.reason === 'locked' ? 423 : 401, r.reason === 'locked' ? 'Account temporarily locked after repeated failed sign-ins. Try again in 15 minutes.' : 'Incorrect username or password');
    res.setHeader('Set-Cookie', cookie('bd_sess', r.token, { maxAge: cfg.sessionHours * 3600, secure: cfg.secureCookies }));
    return { user: r.user, csrf: r.csrf, expires: r.expires };
  }, { rate: 'login' });

  router.post('/api/auth/logout', ({ token, res, user }) => {
    if (user) db.audit(user, 'auth.logout', `user:${user.id}`);
    auth.logout(token);
    res.setHeader('Set-Cookie', cookie('bd_sess', '', { maxAge: 0, secure: cfg.secureCookies }));
    return { ok: true };
  });

  router.get('/api/auth/me', ({ session }) => (session ? { user: session.user, csrf: session.csrf, expires: session.expires } : { user: null }));
}
