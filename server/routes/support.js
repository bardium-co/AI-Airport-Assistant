import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { str, oneOf } from '../validate.js';
import { normalizeFlightNo } from '../services/flights.js';
import { PHRASEBOOK, langName, phrasebookLookup } from '../services/translate.js';

// Passenger → staff help requests ("message airport staff").
// Passengers stay anonymous: a request is reachable only with the random token returned when it is created
// (stored hashed). Staff see open requests live, claim them, reply (quick phrases are pre-translated;
// free text is machine-translated when a translation provider is connected) and close them.

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const LOC_RE = /^[A-Z0-9_]{1,40}$/;
const MAX_TEXT = 600;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function newCode(db) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (;;) {
    const b = crypto.randomBytes(4);
    const code = 'H-' + [...b].map(x => alphabet[x % alphabet.length]).join('');
    if (!db.get('SELECT 1 FROM support_requests WHERE code = ?', code)) return code;
  }
}

export function registerSupport(router, d) {
  const { db, translator, maps, analytics } = d;

  const locName = id => (id ? maps.location(id)?.name ?? null : null);
  const getReq = id => {
    const r = db.get('SELECT * FROM support_requests WHERE id = ?', Number(id));
    if (!r) throw new HttpError(404, 'Request not found');
    return r;
  };
  const passengerAuth = (req, id) => {
    const r = getReq(id);
    const token = String(req.headers['x-support-token'] ?? '');
    const a = Buffer.from(sha(token)), b = Buffer.from(r.token_hash);
    if (!token || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(404, 'Request not found');
    return r;
  };
  const messages = id => db.all('SELECT * FROM support_messages WHERE request_id = ? ORDER BY id', id);
  const touch = (id, now = Date.now()) => db.run('UPDATE support_requests SET updated_at = ? WHERE id = ?', now, id);

  const pendingTranslations = new Set();
  function addPassengerMessage(r, text) {
    const now = Date.now();
    const msgId = db.run(`INSERT INTO support_messages(request_id,sender,user_id,text,lang,created_at) VALUES(?,?,?,?,?,?)`, r.id, 'passenger', null, text, r.lang, now).lastInsertRowid;
    db.run('UPDATE support_requests SET updated_at = ?, waiting_since = COALESCE(waiting_since, ?) WHERE id = ?', now, now, r.id);
    if (r.lang === 'en') return;
    // Translate for staff in the background (the built-in model can take a few seconds on a laptop).
    const job = translator.translate(text, r.lang, 'en').then(t => {
      if (t.text) db.run('UPDATE support_messages SET translated_text = ?, translated_lang = ?, engine = ? WHERE id = ?', t.text, 'en', t.engine, msgId);
    }).catch(() => {}).finally(() => pendingTranslations.delete(job));
    pendingTranslations.add(job);
  }
  router.translationsSettled = () => Promise.all([...pendingTranslations]);

  const passengerView = r => ({
    id: r.id, code: r.code, status: r.status, lang: r.lang, createdAt: r.created_at, updatedAt: r.updated_at,
    // A staff reply still being translated is held back (up to 90 s) so the passenger sees it in their own language.
    messages: messages(r.id).filter(m => !(m.engine === 'pending' && Date.now() - m.created_at < 90e3)).map(m => {
      if (m.sender === 'passenger') return { id: m.id, sender: 'passenger', text: m.text, at: m.created_at };
      if (m.sender === 'system') return { id: m.id, sender: 'system', event: m.text, at: m.created_at };
      // Staff message: reviewed phrase or machine translation in the passenger's language when available.
      const localized = m.translated_lang === r.lang && m.translated_text;
      return { id: m.id, sender: 'staff', text: localized ? m.translated_text : m.text, english: !localized && r.lang !== 'en', machine: !!(localized && m.engine && m.engine !== 'phrasebook'), at: m.created_at };
    }),
  });

  const staffSummary = r => {
    const last = db.get('SELECT * FROM support_messages WHERE request_id = ? AND sender != ? ORDER BY id DESC LIMIT 1', r.id, 'system');
    const claimer = r.claimed_by ? db.get('SELECT display_name FROM users WHERE id = ?', r.claimed_by)?.display_name : null;
    return {
      id: r.id, code: r.code, status: r.status, lang: r.lang, langName: langName(r.lang), location: r.location_id, locationName: locName(r.location_id),
      flightNo: r.flight_no, createdAt: r.created_at, updatedAt: r.updated_at, waitingSince: r.waiting_since, claimedBy: claimer, claimedById: r.claimed_by,
      preview: last ? { sender: last.sender, text: last.sender === 'passenger' ? (last.translated_text ?? last.text) : last.text, original: last.text } : null,
    };
  };

  // ---------------------------------------------------------------- passenger
  router.post('/api/support', async ({ body }) => {
    const text = str(body.message, 'message', { required: true, max: MAX_TEXT });
    const lang = str(body.lang, 'lang', { pattern: LANG_RE }) ?? 'en';
    const location = str(body.from, 'from', { pattern: LOC_RE });
    const flightNo = body.flightNo ? normalizeFlightNo(body.flightNo) : null;
    const context = str(body.context, 'context', { max: 500 });
    const token = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    const code = newCode(db);
    const id = db.run(`INSERT INTO support_requests(code,token_hash,lang,location_id,flight_no,context,status,created_at,updated_at,waiting_since) VALUES(?,?,?,?,?,?,'open',?,?,?)`,
      code, sha(token), lang, location && maps.location(location) ? location : null, flightNo, context ?? null, now, now, now).lastInsertRowid;
    const r = getReq(id);
    addPassengerMessage(r, text);
    analytics?.record('passenger', 'staff_request', lang);
    return { id: Number(id), code, token };
  }, { rate: 'support' });

  router.get('/api/support/:id', ({ req, params }) => passengerView(passengerAuth(req, params.id)), { rate: 'lookup' });

  router.post('/api/support/:id/messages', async ({ req, params, body }) => {
    const r = passengerAuth(req, params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    addPassengerMessage(r, str(body.message, 'message', { required: true, max: MAX_TEXT }));
    return passengerView(getReq(r.id));
  }, { rate: 'chat' });

  router.post('/api/support/:id/close', ({ req, params }) => {
    const r = passengerAuth(req, params.id);
    if (r.status !== 'closed') {
      const now = Date.now();
      db.run(`UPDATE support_requests SET status='closed', closed_at=?, updated_at=?, waiting_since=NULL WHERE id=?`, now, now, r.id);
      db.run(`INSERT INTO support_messages(request_id,sender,text,lang,created_at) VALUES(?,?,?,?,?)`, r.id, 'system', 'closed_by_passenger', r.lang, now);
    }
    return passengerView(getReq(r.id));
  }, { rate: 'chat' });

  // ---------------------------------------------------------------- staff
  const staff = { auth: 'staff' };

  router.get('/api/staff/support', ({ query }) => {
    const view = oneOf(query.get('status') ?? 'active', 'status', ['active', 'closed', 'all']);
    const where = view === 'active' ? "status != 'closed'" : view === 'closed' ? "status = 'closed'" : '1=1';
    const rows = db.all(`SELECT * FROM support_requests WHERE ${where} ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END, COALESCE(waiting_since, updated_at) ASC LIMIT 200`);
    const counts = db.get(`SELECT SUM(status='open') open, SUM(status='claimed') claimed, SUM(status!='closed' AND waiting_since IS NOT NULL) waiting FROM support_requests`);
    return { items: rows.map(staffSummary), counts: { open: counts.open ?? 0, claimed: counts.claimed ?? 0, waiting: counts.waiting ?? 0 }, translation: translator.status(), now: Date.now() };
  }, staff);

  router.get('/api/staff/support/:id', ({ params }) => {
    const r = getReq(params.id);
    return {
      ...staffSummary(r), context: r.context,
      messages: messages(r.id).map(m => ({
        id: m.id, sender: m.sender, at: m.created_at,
        ...(m.sender === 'system' ? { event: m.text } : { text: m.text, lang: m.lang, translated: m.translated_text, translatedLang: m.translated_lang, engine: m.engine }),
        by: m.user_id ? db.get('SELECT display_name FROM users WHERE id = ?', m.user_id)?.display_name : null,
      })),
      phrases: Object.entries(PHRASEBOOK).map(([id, row]) => ({ id, en: row.en, local: row[r.lang] ?? null })),
      translation: translator.status(),
    };
  }, staff);

  router.post('/api/staff/support/:id/claim', ({ params, user }) => {
    const r = getReq(params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    const now = Date.now();
    db.run(`UPDATE support_requests SET status='claimed', claimed_by=?, claimed_at=?, updated_at=? WHERE id=?`, user.id, now, now, r.id);
    if (r.claimed_by !== user.id) db.run(`INSERT INTO support_messages(request_id,sender,user_id,text,lang,created_at) VALUES(?,?,?,?,?,?)`, r.id, 'system', user.id, 'claimed', r.lang, now);
    db.audit(user, 'support.claim', `support:${r.code}`);
    return staffSummary(getReq(r.id));
  }, staff);

  router.post('/api/staff/support/:id/messages', async ({ params, body, user }) => {
    const r = getReq(params.id);
    if (r.status === 'closed') throw new HttpError(409, 'This request is closed');
    let text, translated = null, tlang = null, engine = null;
    if (body.phrase) {
      const row = PHRASEBOOK[str(body.phrase, 'phrase', { max: 40 })];
      if (!row) throw new HttpError(400, 'Unknown quick reply');
      text = row.en;
      if (r.lang !== 'en' && row[r.lang]) { translated = row[r.lang]; tlang = r.lang; engine = 'phrasebook'; }
    } else {
      text = str(body.message, 'message', { required: true, max: MAX_TEXT });
      // Reviewed phrasebook match → instant; otherwise translate in the background (the built-in model may take
      // several seconds on a laptop) so staff are never kept waiting.
      if (r.lang !== 'en') {
        const pb = phrasebookLookup(text, 'en', r.lang);
        if (pb) { translated = pb.text; tlang = r.lang; engine = 'phrasebook'; }
        else if (translator.status() !== 'phrasebook') engine = 'pending';
      }
    }
    const now = Date.now();
    const msgId = db.run(`INSERT INTO support_messages(request_id,sender,user_id,text,lang,translated_text,translated_lang,engine,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      r.id, 'staff', user.id, text, 'en', translated, tlang, engine, now).lastInsertRowid;
    if (engine === 'pending') {
      const job = translator.translate(text, 'en', r.lang)
        .then(t => db.run('UPDATE support_messages SET translated_text = ?, translated_lang = ?, engine = ? WHERE id = ?', t.text ?? null, t.text ? r.lang : null, t.text ? t.engine : null, msgId))
        .catch(() => db.run('UPDATE support_messages SET engine = NULL WHERE id = ?', msgId))
        .finally(() => pendingTranslations.delete(job));
      pendingTranslations.add(job);
    }
    // Replying claims an open request and clears the "waiting" timer.
    db.run(`UPDATE support_requests SET status=CASE WHEN status='open' THEN 'claimed' ELSE status END, claimed_by=COALESCE(claimed_by, ?), claimed_at=COALESCE(claimed_at, ?), updated_at=?, waiting_since=NULL WHERE id=?`, user.id, now, now, r.id);
    return { ok: true, localized: !!translated };
  }, staff);

  router.post('/api/staff/support/:id/close', ({ params, user }) => {
    const r = getReq(params.id);
    if (r.status !== 'closed') {
      const now = Date.now();
      db.run(`UPDATE support_requests SET status='closed', closed_at=?, closed_by=?, updated_at=?, waiting_since=NULL WHERE id=?`, now, user.id, now, r.id);
      db.run(`INSERT INTO support_messages(request_id,sender,user_id,text,lang,created_at) VALUES(?,?,?,?,?,?)`, r.id, 'system', user.id, 'closed', r.lang, now);
      db.audit(user, 'support.close', `support:${r.code}`);
    }
    return staffSummary(getReq(r.id));
  }, staff);
}

/** Delete help requests (and their messages) not updated for `days` days. */
export function purgeSupport(db, days) {
  const cutoff = Date.now() - Math.max(1, Number(days) || 7) * 86400e3;
  const old = db.all('SELECT id FROM support_requests WHERE updated_at < ?', cutoff);
  for (const { id } of old) { db.run('DELETE FROM support_messages WHERE request_id = ?', id); db.run('DELETE FROM support_requests WHERE id = ?', id); }
  return old.length;
}
