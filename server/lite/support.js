import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { str, oneOf } from '../validate.js';
import { normalizeFlightNo } from '../services/flights.js';
import { PHRASEBOOK, langName, phrasebookLookup } from '../services/translate.js';

// Passenger ↔ staff help requests for the serverless edition. Same API as server/routes/support.js, but state lives in
// a key-value store. Messages are separate append-only records so a passenger and a staff member writing at the same
// moment never overwrite each other.
//   r/<id>            request (status, language, who is handling it, …)
//   m/<id>/<time>-<n> one message

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const LOC_RE = /^[A-Z0-9_]{1,40}$/;
const MAX_TEXT = 600;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => 'H-' + [...crypto.randomBytes(4)].map(x => ALPHABET[x % ALPHABET.length]).join('');

/** In-memory store with the same interface as the Netlify Blobs adapter (used by tests and local runs). */
export class MemoryStore {
  constructor() { this.m = new Map(); }
  async get(k) { const v = this.m.get(k); return v === undefined ? null : structuredClone(v); }
  async set(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { this.m.delete(k); }
  async list(prefix) { return [...this.m.keys()].filter(k => k.startsWith(prefix)).sort(); }
}

export function registerLiteSupport(router, { store, maps, analytics, translator, retentionDays = 7 }) {
  const reqKey = id => `r/${id}`;
  const getReq = async id => {
    const r = /^\d{1,16}$/.test(String(id)) ? await store.get(reqKey(id)) : null;
    if (!r) throw new HttpError(404, 'Request not found');
    return r;
  };
  const saveReq = r => store.set(reqKey(r.id), r);
  const passengerAuth = async (req, id) => {
    const r = await getReq(id);
    const token = String(req.headers['x-support-token'] ?? '');
    const a = Buffer.from(sha(token)), b = Buffer.from(r.tokenHash);
    if (!token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(404, 'Request not found');
    return r;
  };
  const msgKey = (id, at) => `m/${id}/${String(at).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`;
  const addMsg = (id, m) => store.set(msgKey(id, m.at), m);
  const messages = async id => {
    const keys = await store.list(`m/${id}/`);
    const rows = await Promise.all(keys.map(async (k, i) => ({ ...(await store.get(k)), id: i + 1, _k: k })));
    return rows.filter(r => r.sender).sort((a, b) => a.at - b.at || a._k.localeCompare(b._k)).map((r, i) => ({ ...r, id: i + 1 }));
  };
  const locName = id => (id ? maps.location(id)?.name ?? null : null);

  async function purge() {
    const cutoff = Date.now() - retentionDays * 86400e3;
    for (const k of await store.list('r/')) {
      const r = await store.get(k);
      if (r && r.updatedAt < cutoff) {
        for (const mk of await store.list(`m/${r.id}/`)) await store.delete(mk);
        await store.delete(k);
      }
    }
  }
  let lastPurge = 0;
  const maybePurge = () => { if (Date.now() - lastPurge > 3600e3) { lastPurge = Date.now(); purge().catch(() => {}); } };

  const passengerView = async r => ({
    id: r.id, code: r.code, status: r.status, lang: r.lang, createdAt: r.createdAt, updatedAt: r.updatedAt,
    messages: (await messages(r.id)).map(m => {
      if (m.sender === 'passenger') return { id: m.id, sender: 'passenger', text: m.text, at: m.at };
      if (m.sender === 'system') return { id: m.id, sender: 'system', event: m.text, at: m.at };
      const localized = m.translatedLang === r.lang && m.translated;
      return { id: m.id, sender: 'staff', text: localized ? m.translated : m.text, english: !localized && r.lang !== 'en', machine: !!(localized && m.engine && m.engine !== 'phrasebook'), at: m.at };
    }),
  });

  const staffSummary = (r, last) => ({
    id: r.id, code: r.code, status: r.status, lang: r.lang, langName: langName(r.lang), location: r.locationId, locationName: locName(r.locationId),
    flightNo: r.flightNo, createdAt: r.createdAt, updatedAt: r.updatedAt, waitingSince: r.waitingSince, claimedBy: r.claimedBy ?? null, claimedById: r.claimedById ?? null,
    preview: last ? { sender: last.sender, text: last.sender === 'passenger' ? (last.translated ?? last.text) : last.text, original: last.text } : null,
  });

  async function addPassengerMessage(r, text) {
    const now = Date.now();
    const m = { sender: 'passenger', text, lang: r.lang, at: now };
    if (r.lang !== 'en' && translator.status() !== 'phrasebook') {
      const t = await translator.translate(text, r.lang, 'en').catch(() => null);
      if (t?.text) Object.assign(m, { translated: t.text, translatedLang: 'en', engine: t.engine });
    } else if (r.lang !== 'en') {
      const pb = phrasebookLookup(text, r.lang, 'en');
      if (pb) Object.assign(m, { translated: pb.text, translatedLang: 'en', engine: 'phrasebook' });
    }
    await addMsg(r.id, m);
    r.updatedAt = now; r.waitingSince ??= now; r.lastPreview = { sender: 'passenger', text: m.text, translated: m.translated ?? null };
    await saveReq(r);
  }

  // ---------------------------------------------------------------- passenger
  router.post('/api/support', async ({ body }) => {
    const text = str(body.message, 'message', { required: true, max: MAX_TEXT });
    const lang = str(body.lang, 'lang', { pattern: LANG_RE }) ?? 'en';
    const location = str(body.from, 'from', { pattern: LOC_RE });
    const flightNo = body.flightNo ? normalizeFlightNo(body.flightNo) : null;
    const context = str(body.context, 'context', { max: 500 });
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    let id = now;
    while (await store.get(reqKey(id))) id += 1;
    const r = { id, code: newCode(), tokenHash: sha(token), lang, locationId: location && maps.location(location) ? location : null, flightNo, context: context ?? null,
      status: 'open', createdAt: now, updatedAt: now, waitingSince: now, claimedBy: null, claimedById: null };
    await saveReq(r);
    await addPassengerMessage(r, text);
    analytics?.record('passenger', 'staff_request', lang);
    return { id: r.id, code: r.code, token };
  }, { rate: 'support' });

  router.get('/api/support/:id', async ({ req, params }) => passengerView(await passengerAuth(req, params.id)), { rate: 'lookup' });

  router.post('/api/support/:id/messages', async ({ req, params, body }) => {
    const r = await passengerAuth(req, params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    await addPassengerMessage(r, str(body.message, 'message', { required: true, max: MAX_TEXT }));
    return passengerView(await getReq(r.id));
  }, { rate: 'chat' });

  router.post('/api/support/:id/close', async ({ req, params }) => {
    const r = await passengerAuth(req, params.id);
    if (r.status !== 'closed') {
      const now = Date.now();
      await addMsg(r.id, { sender: 'system', text: 'closed_by_passenger', lang: r.lang, at: now });
      Object.assign(r, { status: 'closed', closedAt: now, updatedAt: now, waitingSince: null });
      await saveReq(r);
    }
    return passengerView(await getReq(r.id));
  }, { rate: 'chat' });

  // ---------------------------------------------------------------- staff
  const staff = { auth: 'staff' };

  router.get('/api/staff/support', async ({ query }) => {
    const view = oneOf(query.get('status') ?? 'active', 'status', ['active', 'closed', 'all']);
    maybePurge();
    const all = (await Promise.all((await store.list('r/')).map(k => store.get(k)))).filter(Boolean);
    const rows = all.filter(r => view === 'all' || (view === 'active' ? r.status !== 'closed' : r.status === 'closed'))
      .sort((a, b) => ({ open: 0, claimed: 1, closed: 2 }[a.status] - { open: 0, claimed: 1, closed: 2 }[b.status]) || (a.waitingSince ?? a.updatedAt) - (b.waitingSince ?? b.updatedAt)).slice(0, 100);
    const counts = { open: all.filter(r => r.status === 'open').length, claimed: all.filter(r => r.status === 'claimed').length, waiting: all.filter(r => r.status !== 'closed' && r.waitingSince).length };
    return { items: rows.map(r => staffSummary(r, r.lastPreview)), counts, translation: translator.status(), now: Date.now() };
  }, staff);

  router.get('/api/staff/support/:id', async ({ params }) => {
    const r = await getReq(params.id);
    const msgs = await messages(r.id);
    const last = [...msgs].reverse().find(m => m.sender !== 'system');
    return {
      ...staffSummary(r, last ? { sender: last.sender, text: last.text, translated: last.translated } : null), context: r.context,
      messages: msgs.map(m => ({
        id: m.id, sender: m.sender, at: m.at,
        ...(m.sender === 'system' ? { event: m.text } : { text: m.text, lang: m.lang, translated: m.translated ?? null, translatedLang: m.translatedLang ?? null, engine: m.engine ?? null }),
        by: m.by ?? null,
      })),
      phrases: Object.entries(PHRASEBOOK).map(([id, row]) => ({ id, en: row.en, local: row[r.lang] ?? null })),
      translation: translator.status(),
    };
  }, staff);

  router.post('/api/staff/support/:id/claim', async ({ params, user }) => {
    const r = await getReq(params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    const now = Date.now();
    if (r.claimedById !== user.id) await addMsg(r.id, { sender: 'system', text: 'claimed', lang: r.lang, at: now, by: user.displayName });
    Object.assign(r, { status: 'claimed', claimedById: user.id, claimedBy: user.displayName, updatedAt: now });
    await saveReq(r);
    return staffSummary(r, r.lastPreview);
  }, staff);

  router.post('/api/staff/support/:id/messages', async ({ params, body, user }) => {
    const r = await getReq(params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    const m = { sender: 'staff', lang: 'en', by: user.displayName };
    if (body.phrase) {
      const row = PHRASEBOOK[str(body.phrase, 'phrase', { max: 40 })];
      if (!row) throw new HttpError(400, 'Unknown quick reply');
      m.text = row.en;
      if (r.lang !== 'en' && row[r.lang]) Object.assign(m, { translated: row[r.lang], translatedLang: r.lang, engine: 'phrasebook' });
    } else {
      m.text = str(body.message, 'message', { required: true, max: MAX_TEXT });
      if (r.lang !== 'en') {
        const t = await translator.translate(m.text, 'en', r.lang).catch(() => null); // reviewed phrase, or the connected translation service
        if (t?.text) Object.assign(m, { translated: t.text, translatedLang: r.lang, engine: t.engine });
      }
    }
    const now = Date.now();
    m.at = now;
    await addMsg(r.id, m);
    Object.assign(r, { status: r.status === 'open' ? 'claimed' : r.status, claimedById: r.claimedById ?? user.id, claimedBy: r.claimedBy ?? user.displayName, updatedAt: now, waitingSince: null, lastPreview: { sender: 'staff', text: m.text } });
    await saveReq(r);
    return { ok: true, localized: !!m.translated };
  }, staff);

  router.post('/api/staff/support/:id/close', async ({ params, user }) => {
    const r = await getReq(params.id);
    if (r.status !== 'closed') {
      const now = Date.now();
      await addMsg(r.id, { sender: 'system', text: 'closed', lang: r.lang, at: now, by: user.displayName });
      Object.assign(r, { status: 'closed', closedAt: now, updatedAt: now, waitingSince: null });
      await saveReq(r);
    }
    return staffSummary(r, r.lastPreview);
  }, staff);

  return { purge };
}
