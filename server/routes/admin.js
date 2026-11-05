import { HttpError } from '../http.js';
import { str, num, oneOf, bool, url, arr, obj } from '../validate.js';
import { hashPassword, passwordProblems } from '../auth.js';
import { parseJson } from '../db.js';
import { getDef, joinUrl, authHeaders } from '../services/integrations.js';
import { testLlm } from '../services/llm.js';
import { testLibreTranslate } from '../services/translate.js';
import { testFlightFeed, normalizeFlightNo } from '../services/flights.js';
import { CABINS, CARRIERS, TIERS } from '../services/eligibility.js';
import { STATUS_KEYS } from '../services/phrases.js';
import { MAP_W, MAP_H } from '../seed.js';

const LOC_TYPES = ['gate', 'lounge', 'plaza', 'transfer', 'junction', 'lift', 'prayer', 'quiet', 'toilet', 'info', 'smoking', 'family', 'hotel', 'food', 'assistance', 'sleep', 'wellness', 'other'];
const EDGE_KINDS = ['walk', 'escalator', 'lift', 'stairs', 'train', 'travelator'];
const LOC_ID = /^[A-Z0-9_]{2,40}$/;
const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const SCALE_M = 1.3;

function validateHours(h) {
  const o = obj(h, 'hours');
  if (bool(o.always)) return { always: true, label: str(o.label, 'hours label', { max: 120 }) ?? '24 hours' };
  if (bool(o.unknown)) return { unknown: true, label: str(o.label, 'hours label', { max: 120 }) ?? 'Hours not confirmed — check with the lounge' };
  const open = str(o.open, 'opening time', { required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
  const close = str(o.close, 'closing time', { required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
  return { open, close, label: str(o.label, 'hours label', { max: 120 }) ?? `${open}–${close}` };
}

function validateRules(r) {
  const o = obj(r, 'rules');
  const rules = arr(o.rules, 'rules', { max: 20 }).map((x, i) => {
    const rule = {};
    if (x.carriers != null) rule.carriers = arr(x.carriers, `rule ${i + 1} carriers`).map(c => oneOf(c, 'carrier', [...CARRIERS, 'ANY'], { required: true }));
    if (x.cabins != null) rule.cabins = arr(x.cabins, `rule ${i + 1} cabins`).map(c => oneOf(c, 'cabin', CABINS, { required: true }));
    if (x.tiers != null) rule.tiers = arr(x.tiers, `rule ${i + 1} tiers`).map(c => oneOf(c, 'tier', TIERS, { required: true }));
    rule.reason = str(x.reason, 'reason', { max: 60, pattern: /^[a-z0-9_]+$/ }) ?? 'rule_match';
    if (!rule.carriers && !rule.cabins && !rule.tiers) throw new HttpError(400, `Rule ${i + 1} must restrict carriers, cabins or tiers`);
    return rule;
  });
  return { rules, paid: bool(o.paid) };
}

function validateLocation(b, partial = false) {
  return {
    type: oneOf(b.type, 'type', LOC_TYPES, { required: !partial }),
    name: str(b.name, 'name', { required: !partial, max: 120 }),
    concourse: str(b.concourse, 'concourse', { max: 2, pattern: /^[A-Z]{1,2}$/ }),
    level: str(b.level, 'level', { max: 10 }) ?? '1',
    x: num(b.x, 'x', { min: 0, max: MAP_W, required: !partial }),
    y: num(b.y, 'y', { min: 0, max: MAP_H, required: !partial }),
    status: oneOf(b.status, 'status', ['open', 'closed', 'verify'], { fallback: 'open' }),
    simulated: bool(b.simulated, true) ? 1 : 0,
    accessible: bool(b.accessible, true) ? 1 : 0,
    notes: str(b.notes, 'notes', { max: 500 }),
  };
}

export function registerAdmin(router, d) {
  const { db, maps, integrations, analytics, auth, llm, translator, flights, localModel } = d;
  const admin = { auth: 'admin' };
  const changed = (user, action, target, detail) => { db.audit(user, action, target, detail); maps.invalidate(); };

  // ---- Map: locations & edges ----
  router.get('/api/admin/locations', () => ({ items: db.all('SELECT * FROM locations ORDER BY type, id') }), admin);
  router.post('/api/admin/locations', ({ body, user }) => {
    const id = str(body.id, 'id', { required: true, pattern: LOC_ID }).toUpperCase();
    if (db.get('SELECT 1 FROM locations WHERE id = ?', id)) throw new HttpError(409, 'A location with this ID already exists');
    const v = validateLocation(body);
    const connect = arr(body.connectTo, 'connectTo', { max: 6 }).map(x => str(x, 'connectTo', { pattern: LOC_ID }));
    db.tx(() => {
      db.run('INSERT INTO locations(id,type,name,concourse,level,x,y,simulated,accessible,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, v.type, v.name, v.concourse, v.level, v.x, v.y, v.simulated, v.accessible, v.status, v.notes);
      for (const other of connect) {
        const o = db.get('SELECT * FROM locations WHERE id = ?', other);
        if (!o) throw new HttpError(400, `connectTo: unknown location ${other}`);
        db.run('INSERT INTO edges(a,b,distance_m,kind,step_free) VALUES(?,?,?,?,1)', id, other, Math.round(Math.hypot(o.x - v.x, o.y - v.y) * SCALE_M), 'walk');
      }
    });
    changed(user, 'location.create', `location:${id}`);
    return db.get('SELECT * FROM locations WHERE id = ?', id);
  }, admin);
  router.put('/api/admin/locations/:id', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM locations WHERE id = ?', params.id);
    if (!cur) throw new HttpError(404, 'Location not found');
    const v = validateLocation({ ...cur, ...body });
    db.run('UPDATE locations SET type=?,name=?,concourse=?,level=?,x=?,y=?,simulated=?,accessible=?,status=?,notes=? WHERE id=?', v.type, v.name, v.concourse, v.level, v.x, v.y, v.simulated, v.accessible, v.status, v.notes, cur.id);
    changed(user, 'location.update', `location:${cur.id}`);
    return db.get('SELECT * FROM locations WHERE id = ?', cur.id);
  }, admin);
  router.delete('/api/admin/locations/:id', ({ params, user }) => {
    if (db.get('SELECT 1 FROM lounges WHERE location_id = ?', params.id)) throw new HttpError(409, 'A lounge uses this location — delete or move the lounge first');
    const r = db.run('DELETE FROM locations WHERE id = ?', params.id);
    if (!r.changes) throw new HttpError(404, 'Location not found');
    changed(user, 'location.delete', `location:${params.id}`);
    return { ok: true };
  }, admin);

  router.get('/api/admin/edges', () => ({ items: db.all('SELECT * FROM edges ORDER BY a, b') }), admin);
  router.post('/api/admin/edges', ({ body, user }) => {
    const a = str(body.a, 'a', { required: true, pattern: LOC_ID }), b = str(body.b, 'b', { required: true, pattern: LOC_ID });
    if (a === b) throw new HttpError(400, 'An edge must connect two different locations');
    const la = db.get('SELECT * FROM locations WHERE id = ?', a), lb = db.get('SELECT * FROM locations WHERE id = ?', b);
    if (!la || !lb) throw new HttpError(400, 'Unknown location');
    if (db.get('SELECT 1 FROM edges WHERE (a=? AND b=?) OR (a=? AND b=?)', a, b, b, a)) throw new HttpError(409, 'These locations are already connected');
    const kind = oneOf(body.kind, 'kind', EDGE_KINDS, { fallback: 'walk' });
    const distance = num(body.distance_m, 'distance_m', { min: 1, max: 5000 }) ?? Math.max(1, Math.round(Math.hypot(la.x - lb.x, la.y - lb.y) * SCALE_M));
    const stepFree = body.step_free == null ? !['escalator', 'stairs'].includes(kind) : bool(body.step_free);
    const r = db.run('INSERT INTO edges(a,b,distance_m,kind,step_free) VALUES(?,?,?,?,?)', a, b, distance, kind, stepFree ? 1 : 0);
    changed(user, 'edge.create', `edge:${r.lastInsertRowid}`);
    return db.get('SELECT * FROM edges WHERE id = ?', Number(r.lastInsertRowid));
  }, admin);
  router.delete('/api/admin/edges/:id', ({ params, user }) => {
    const r = db.run('DELETE FROM edges WHERE id = ?', Number(params.id));
    if (!r.changes) throw new HttpError(404, 'Edge not found');
    changed(user, 'edge.delete', `edge:${params.id}`);
    return { ok: true };
  }, admin);

  router.post('/api/admin/map/import', ({ body, user }) => {
    const locations = arr(body.locations, 'locations', { max: 5000 });
    const edges = arr(body.edges, 'edges', { max: 20000 });
    if (!locations.length) throw new HttpError(400, 'No locations to import');
    const loungeLocs = new Set(db.all('SELECT location_id FROM lounges').map(r => r.location_id));
    const ids = new Set();
    const locs = locations.map((l, i) => {
      const id = str(l.id, `locations[${i}].id`, { required: true, pattern: LOC_ID });
      if (ids.has(id)) throw new HttpError(400, `Duplicate location id ${id}`);
      ids.add(id);
      return { id, ...validateLocation(l) };
    });
    for (const lid of loungeLocs) if (!ids.has(lid)) throw new HttpError(400, `Import must keep lounge location ${lid}`);
    const es = edges.map((e, i) => {
      const a = str(e.a, `edges[${i}].a`, { required: true, pattern: LOC_ID }), b = str(e.b, `edges[${i}].b`, { required: true, pattern: LOC_ID });
      if (!ids.has(a) || !ids.has(b)) throw new HttpError(400, `edges[${i}] references an unknown location`);
      const kind = oneOf(e.kind, 'kind', EDGE_KINDS, { fallback: 'walk' });
      return { a, b, kind, distance_m: num(e.distance_m, 'distance_m', { min: 1, max: 5000, required: true }), step_free: e.step_free == null ? !['escalator', 'stairs'].includes(kind) : bool(e.step_free) };
    });
    db.tx(() => {
      db.raw.exec('PRAGMA defer_foreign_keys = ON');
      db.run('DELETE FROM edges');
      db.run('DELETE FROM locations WHERE id NOT IN (SELECT location_id FROM lounges)');
      for (const l of locs) db.run(`INSERT INTO locations(id,type,name,concourse,level,x,y,simulated,accessible,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET type=excluded.type,name=excluded.name,concourse=excluded.concourse,level=excluded.level,x=excluded.x,y=excluded.y,simulated=excluded.simulated,accessible=excluded.accessible,status=excluded.status,notes=excluded.notes`,
        l.id, l.type, l.name, l.concourse, l.level, l.x, l.y, l.simulated, l.accessible, l.status, l.notes);
      for (const e of es) db.run('INSERT OR IGNORE INTO edges(a,b,distance_m,kind,step_free) VALUES(?,?,?,?,?)', e.a, e.b, e.distance_m, e.kind, e.step_free ? 1 : 0);
    });
    changed(user, 'map.import', 'map', { locations: locs.length, edges: es.length });
    return { ok: true, locations: locs.length, edges: es.length };
  }, admin);

  router.get('/api/admin/map/export', () => ({
    locations: db.all('SELECT * FROM locations ORDER BY id'), edges: db.all('SELECT a,b,distance_m,kind,step_free FROM edges'),
  }), admin);

  // ---- Lounges ----
  const loungeOut = l => ({ ...l, hours: parseJson(l.hours, {}), rules: parseJson(l.rules, {}), amenities: parseJson(l.amenities, []), simulated: !!l.simulated });
  const validateLounge = (b) => {
    const location_id = str(b.location_id, 'location_id', { required: true, pattern: LOC_ID });
    if (!db.get('SELECT 1 FROM locations WHERE id = ?', location_id)) throw new HttpError(400, 'Unknown map location');
    return {
      location_id, name: str(b.name, 'name', { required: true, max: 120 }), operator: str(b.operator, 'operator', { max: 120 }),
      hours: validateHours(b.hours), rules: validateRules(b.rules),
      amenities: arr(b.amenities, 'amenities', { max: 20 }).map(a => str(a, 'amenity', { max: 40, pattern: /^[a-z_]+$/ })),
      paid_access: str(b.paid_access, 'paid_access', { max: 300 }), status: oneOf(b.status, 'status', ['open', 'closed', 'verify'], { fallback: 'open' }),
      simulated: bool(b.simulated, true) ? 1 : 0, source_url: url(b.source_url, 'source_url'), notes: str(b.notes, 'notes', { max: 500 }),
    };
  };
  router.get('/api/admin/lounges', () => ({ items: db.all('SELECT * FROM lounges ORDER BY name').map(loungeOut) }), admin);
  router.post('/api/admin/lounges', ({ body, user }) => {
    const id = str(body.id, 'id', { required: true, pattern: LOC_ID });
    if (db.get('SELECT 1 FROM lounges WHERE id = ?', id)) throw new HttpError(409, 'Lounge ID already exists');
    const v = validateLounge(body);
    db.run('INSERT INTO lounges(id,location_id,name,operator,hours,rules,amenities,paid_access,status,simulated,source_url,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, v.location_id, v.name, v.operator, JSON.stringify(v.hours), JSON.stringify(v.rules), JSON.stringify(v.amenities), v.paid_access, v.status, v.simulated, v.source_url, v.notes);
    changed(user, 'lounge.create', `lounge:${id}`);
    return loungeOut(db.get('SELECT * FROM lounges WHERE id = ?', id));
  }, admin);
  router.put('/api/admin/lounges/:id', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM lounges WHERE id = ?', params.id);
    if (!cur) throw new HttpError(404, 'Lounge not found');
    const v = validateLounge({ ...loungeOut(cur), ...body });
    db.run('UPDATE lounges SET location_id=?,name=?,operator=?,hours=?,rules=?,amenities=?,paid_access=?,status=?,simulated=?,source_url=?,notes=? WHERE id=?',
      v.location_id, v.name, v.operator, JSON.stringify(v.hours), JSON.stringify(v.rules), JSON.stringify(v.amenities), v.paid_access, v.status, v.simulated, v.source_url, v.notes, cur.id);
    changed(user, 'lounge.update', `lounge:${cur.id}`);
    return loungeOut(db.get('SELECT * FROM lounges WHERE id = ?', cur.id));
  }, admin);
  router.delete('/api/admin/lounges/:id', ({ params, user }) => {
    const r = db.run('DELETE FROM lounges WHERE id = ?', params.id);
    if (!r.changes) throw new HttpError(404, 'Lounge not found');
    changed(user, 'lounge.delete', `lounge:${params.id}`);
    return { ok: true };
  }, admin);

  // ---- Simulated flights (demo only) ----
  const validateSim = b => ({
    airline: str(b.airline, 'airline', { required: true, max: 60 }), destination: str(b.destination, 'destination', { required: true, max: 80 }),
    destination_code: str(b.destination_code, 'destination_code', { required: true, pattern: /^[A-Z]{3}$/ }),
    dep_offset_min: num(b.dep_offset_min, 'dep_offset_min', { min: -600, max: 2880, int: true, required: true }),
    gate: str(b.gate, 'gate', { pattern: /^[A-E]\d{1,2}$/ }), status: oneOf(b.status, 'status', STATUS_KEYS, { fallback: 'scheduled' }),
  });
  router.get('/api/admin/sim-flights', () => ({ items: db.all('SELECT * FROM flights_sim ORDER BY dep_offset_min') }), admin);
  router.post('/api/admin/sim-flights', ({ body, user }) => {
    const flight_no = normalizeFlightNo(body.flight_no);
    if (!flight_no) throw new HttpError(400, 'Invalid flight number');
    const v = validateSim(body);
    db.run(`INSERT INTO flights_sim(flight_no,airline,destination,destination_code,dep_offset_min,gate,status) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(flight_no) DO UPDATE SET airline=excluded.airline,destination=excluded.destination,destination_code=excluded.destination_code,dep_offset_min=excluded.dep_offset_min,gate=excluded.gate,status=excluded.status`,
    flight_no, v.airline, v.destination, v.destination_code, v.dep_offset_min, v.gate, v.status);
    db.audit(user, 'simflight.upsert', `flight:${flight_no}`);
    return db.get('SELECT * FROM flights_sim WHERE flight_no = ?', flight_no);
  }, admin);
  router.delete('/api/admin/sim-flights/:no', ({ params, user }) => {
    const r = db.run('DELETE FROM flights_sim WHERE flight_no = ?', normalizeFlightNo(params.no) ?? '');
    if (!r.changes) throw new HttpError(404, 'Flight not found');
    db.audit(user, 'simflight.delete', `flight:${params.no}`);
    return { ok: true };
  }, admin);

  // ---- FAQs ----
  const faqOut = f => ({ ...f, translations: parseJson(f.translations, {}), published: !!f.published });
  const validateFaq = b => {
    const tr = obj(b.translations, 'translations');
    const translations = {};
    for (const [lang, v] of Object.entries(tr)) {
      if (!LANG_RE.test(lang)) throw new HttpError(400, `Invalid language code ${lang}`);
      const q = str(v?.q, `${lang} question`, { max: 300 }), a = str(v?.a, `${lang} answer`, { max: 2000 });
      if (q && a) translations[lang] = { q, a };
      else if (q || a) throw new HttpError(400, `${lang}: both question and answer are needed`);
    }
    if (!translations.en) throw new HttpError(400, 'An English question and answer are required');
    return {
      category: str(b.category, 'category', { required: true, max: 40, pattern: /^[a-z_]+$/ }), translations,
      keywords: str(b.keywords, 'keywords', { max: 2000 }) ?? '', source_url: url(b.source_url, 'source_url'),
      verified_on: str(b.verified_on, 'verified_on', { pattern: /^\d{4}-\d{2}-\d{2}$/ }), published: bool(b.published, true) ? 1 : 0,
    };
  };
  router.get('/api/admin/faqs', () => ({ items: db.all('SELECT * FROM faqs ORDER BY category, id').map(faqOut) }), admin);
  router.post('/api/admin/faqs', ({ body, user }) => {
    const v = validateFaq(body);
    const r = db.run('INSERT INTO faqs(category,translations,keywords,source_url,verified_on,published,updated_at) VALUES(?,?,?,?,?,?,?)', v.category, JSON.stringify(v.translations), v.keywords, v.source_url, v.verified_on, v.published, Date.now());
    db.audit(user, 'faq.create', `faq:${r.lastInsertRowid}`);
    return faqOut(db.get('SELECT * FROM faqs WHERE id = ?', Number(r.lastInsertRowid)));
  }, admin);
  router.put('/api/admin/faqs/:id', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM faqs WHERE id = ?', Number(params.id));
    if (!cur) throw new HttpError(404, 'FAQ not found');
    const v = validateFaq({ ...faqOut(cur), ...body });
    db.run('UPDATE faqs SET category=?,translations=?,keywords=?,source_url=?,verified_on=?,published=?,updated_at=? WHERE id=?', v.category, JSON.stringify(v.translations), v.keywords, v.source_url, v.verified_on, v.published, Date.now(), cur.id);
    db.audit(user, 'faq.update', `faq:${cur.id}`);
    return faqOut(db.get('SELECT * FROM faqs WHERE id = ?', cur.id));
  }, admin);
  router.delete('/api/admin/faqs/:id', ({ params, user }) => {
    const r = db.run('DELETE FROM faqs WHERE id = ?', Number(params.id));
    if (!r.changes) throw new HttpError(404, 'FAQ not found');
    db.audit(user, 'faq.delete', `faq:${params.id}`);
    return { ok: true };
  }, admin);

  // ---- Languages ----
  router.get('/api/admin/languages', () => ({ items: db.all('SELECT * FROM languages ORDER BY sort, name').map(l => ({ ...l, enabled: !!l.enabled, rtl: !!l.rtl, builtin: !!l.builtin })) }), admin);
  router.post('/api/admin/languages', ({ body, user }) => {
    const code = str(body.code, 'code', { required: true, pattern: LANG_RE });
    if (db.get('SELECT 1 FROM languages WHERE code = ?', code)) throw new HttpError(409, 'Language already exists');
    db.run('INSERT INTO languages(code,name,native_name,speech_code,rtl,enabled,builtin,sort) VALUES(?,?,?,?,?,?,0,90)', code,
      str(body.name, 'name', { required: true, max: 60 }), str(body.native_name, 'native_name', { required: true, max: 60 }),
      str(body.speech_code, 'speech_code', { required: true, pattern: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/ }), bool(body.rtl) ? 1 : 0, bool(body.enabled) ? 1 : 0);
    db.audit(user, 'language.create', `language:${code}`);
    return { ok: true };
  }, admin);
  router.put('/api/admin/languages/:code', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM languages WHERE code = ?', params.code);
    if (!cur) throw new HttpError(404, 'Language not found');
    const enabled = body.enabled == null ? !!cur.enabled : bool(body.enabled);
    if (cur.code === 'en' && !enabled) throw new HttpError(400, 'English is the fallback language and cannot be disabled');
    db.run('UPDATE languages SET name=?, native_name=?, speech_code=?, rtl=?, enabled=?, sort=? WHERE code=?',
      str(body.name ?? cur.name, 'name', { required: true, max: 60 }), str(body.native_name ?? cur.native_name, 'native_name', { required: true, max: 60 }),
      str(body.speech_code ?? cur.speech_code, 'speech_code', { required: true, pattern: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/ }),
      (body.rtl == null ? !!cur.rtl : bool(body.rtl)) ? 1 : 0, enabled ? 1 : 0, num(body.sort ?? cur.sort, 'sort', { min: 0, max: 1000, int: true }), cur.code);
    db.audit(user, 'language.update', `language:${cur.code}`, { enabled });
    return { ok: true };
  }, admin);

  // ---- Guidance ----
  router.get('/api/admin/guidance', () => ({ items: db.all('SELECT * FROM guidance ORDER BY topic, id').map(g => ({ ...g, passenger_text: parseJson(g.passenger_text, {}) })) }), admin);
  const validateGuidance = b => {
    const pt = obj(b.passenger_text, 'passenger_text');
    const passenger = {};
    for (const [k, v] of Object.entries(pt)) { if (!LANG_RE.test(k)) throw new HttpError(400, 'Invalid language code'); const s = str(v, `passenger text (${k})`, { max: 600 }); if (s) passenger[k] = s; }
    return {
      topic: oneOf(b.topic, 'topic', ['ffp', 'lounge', 'qcredits', 'upgrade', 'privacy', 'other'], { required: true }),
      title: str(b.title, 'title', { required: true, max: 160 }), body: str(b.body, 'body', { required: true, max: 6000 }),
      passenger, source_url: url(b.source_url, 'source_url'),
    };
  };
  router.post('/api/admin/guidance', ({ body, user }) => {
    const v = validateGuidance(body);
    const r = db.run(`INSERT INTO guidance(topic,title,body,passenger_text,status,version,source_url,updated_at) VALUES(?,?,?,?,'draft',1,?,?)`, v.topic, v.title, v.body, JSON.stringify(v.passenger), v.source_url, Date.now());
    db.audit(user, 'guidance.create', `guidance:${r.lastInsertRowid}`);
    return { id: Number(r.lastInsertRowid), status: 'draft' };
  }, admin);
  router.put('/api/admin/guidance/:id', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM guidance WHERE id = ?', Number(params.id));
    if (!cur) throw new HttpError(404, 'Guidance not found');
    if (body.status === 'retired') {
      db.run(`UPDATE guidance SET status='retired', updated_at=? WHERE id=?`, Date.now(), cur.id);
      db.audit(user, 'guidance.retire', `guidance:${cur.id}`);
      return { ok: true, status: 'retired' };
    }
    const v = validateGuidance({ ...cur, passenger_text: parseJson(cur.passenger_text, {}), ...body });
    // Any content change returns the item to draft: it must be re-approved by a supervisor.
    db.run(`UPDATE guidance SET topic=?,title=?,body=?,passenger_text=?,source_url=?,status='draft',version=version+1,approved_by=NULL,approved_at=NULL,updated_at=? WHERE id=?`,
      v.topic, v.title, v.body, JSON.stringify(v.passenger), v.source_url, Date.now(), cur.id);
    db.audit(user, 'guidance.update', `guidance:${cur.id}`);
    return { ok: true, status: 'draft' };
  }, admin);

  // ---- Users & roles ----
  const userOut = u => ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, active: !!u.active, isDemo: !!u.is_demo, lastLoginAt: u.last_login_at, createdAt: u.created_at, locked: !!(u.locked_until && u.locked_until > Date.now()) });
  router.get('/api/admin/users', () => ({ items: db.all('SELECT * FROM users ORDER BY role DESC, username').map(userOut) }), admin);
  router.post('/api/admin/users', async ({ body, user }) => {
    const username = str(body.username, 'username', { required: true, min: 3, max: 40, pattern: /^[a-zA-Z0-9._-]+$/ });
    if (db.get('SELECT 1 FROM users WHERE username = ?', username)) throw new HttpError(409, 'Username already exists');
    const issues = passwordProblems(body.password);
    if (issues.length) throw new HttpError(400, `Password needs ${issues.join(', ')}`);
    const r = db.run('INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)', username,
      str(body.displayName, 'displayName', { required: true, max: 80 }), await hashPassword(body.password), oneOf(body.role, 'role', ['staff', 'supervisor', 'admin'], { required: true }), Date.now());
    db.audit(user, 'user.create', `user:${r.lastInsertRowid}`, { role: body.role });
    return userOut(db.get('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid)));
  }, admin);
  router.put('/api/admin/users/:id', ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM users WHERE id = ?', Number(params.id));
    if (!cur) throw new HttpError(404, 'User not found');
    const role = oneOf(body.role, 'role', ['staff', 'supervisor', 'admin'], { fallback: cur.role });
    const active = body.active == null ? !!cur.active : bool(body.active);
    if (cur.id === user.id && (role !== 'admin' || !active)) throw new HttpError(400, 'You cannot remove your own administrator access');
    if (cur.role === 'admin' && (role !== 'admin' || !active)) {
      const admins = db.get(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1`).n;
      if (admins <= 1) throw new HttpError(400, 'At least one active administrator is required');
    }
    db.run('UPDATE users SET display_name=?, role=?, active=?, locked_until=? WHERE id=?', str(body.displayName ?? cur.display_name, 'displayName', { required: true, max: 80 }), role, active ? 1 : 0, bool(body.unlock) ? null : cur.locked_until, cur.id);
    if (!active || role !== cur.role) auth.revokeUser(cur.id);
    db.audit(user, 'user.update', `user:${cur.id}`, { role, active });
    return userOut(db.get('SELECT * FROM users WHERE id = ?', cur.id));
  }, admin);
  router.post('/api/admin/users/:id/password', async ({ params, body, user }) => {
    const cur = db.get('SELECT * FROM users WHERE id = ?', Number(params.id));
    if (!cur) throw new HttpError(404, 'User not found');
    const issues = passwordProblems(body.password);
    if (issues.length) throw new HttpError(400, `Password needs ${issues.join(', ')}`);
    db.run('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL, is_demo=0 WHERE id=?', await hashPassword(body.password), cur.id);
    auth.revokeUser(cur.id);
    db.audit(user, 'user.password_reset', `user:${cur.id}`);
    return { ok: true };
  }, admin);

  // ---- Integrations ----
  router.get('/api/admin/integrations', () => ({ items: integrations.list() }), admin);

  // ---- Built-in AI model (runs inside this server)
  router.get('/api/admin/ai/models', () => ({ models: localModel.status() }), admin);
  router.post('/api/admin/ai/models/:id/download', ({ params, user }) => {
    if (!localModel.info(params.id)) throw new HttpError(404, 'Unknown model');
    localModel.download(params.id).catch(() => {});
    db.audit(user, 'ai.model_download', `model:${params.id}`);
    return { models: localModel.status() };
  }, admin);
  /** One step: use the downloaded built-in model for understanding AND translation, then test both. */
  router.post('/api/admin/ai/enable-builtin', async ({ body, user }) => {
    const id = oneOf(body.model, 'model', ['qwen3-4b', 'qwen3-1.7b', 'qwen3-8b'], { fallback: 'qwen3-4b' });
    if (!localModel.installed(id)) throw new HttpError(409, 'Download the model first');
    integrations.update('llm_primary', { provider: 'builtin', config: { model: id }, enabled: true, authorised: true });
    let detail;
    try { detail = await testLlm(integrations.config('llm_primary')); integrations.setStatus('llm_primary', 'connected', detail); }
    catch (e) { integrations.setStatus('llm_primary', 'error', String(e.message).slice(0, 300)); throw new HttpError(502, `Model test failed: ${e.message}`); }
    integrations.update('translation', { provider: 'llm', enabled: true, authorised: true });
    integrations.setStatus('translation', 'connected', 'Uses the built-in AI model');
    db.audit(user, 'ai.enable_builtin', `model:${id}`);
    return { detail, items: integrations.list() };
  }, admin);
  router.put('/api/admin/integrations/:id', ({ params, body, user }) => {
    const out = integrations.update(params.id, { provider: body.provider, config: body.config, enabled: body.enabled == null ? undefined : bool(body.enabled), authorised: body.authorised == null ? undefined : bool(body.authorised) });
    db.audit(user, 'integration.update', `integration:${params.id}`, { provider: out.provider, enabled: out.enabled, authorised: out.authorised });
    if (params.id === 'flights') flights?.invalidate();
    return out;
  }, admin);
  router.post('/api/admin/integrations/:id/test', async ({ params, user }) => {
    const c = integrations.config(params.id);
    if (!c) throw new HttpError(404, 'Unknown integration');
    if (c.provider === 'none' || c.provider === 'browser') throw new HttpError(400, 'Choose a provider first');
    const def = getDef(c.id);
    for (const f of def.providers[c.provider].fields) if (f.required && !c.config[f.key]) throw new HttpError(400, `${f.label} is required`);
    let detail;
    try {
      if (c.kind === 'llm') detail = await testLlm(c);
      else if (c.kind === 'flights') detail = await testFlightFeed(c);
      else if (c.kind === 'translation' && c.provider === 'libretranslate') detail = await testLibreTranslate(c);
      else if (c.kind === 'translation' && c.provider === 'llm') {
        if (!llm.available()) throw new Error('No AI language model is connected');
        detail = 'Uses the connected AI language model';
      } else if (c.kind === 'indoor_map') {
        const res = await fetch(joinUrl(c.config.baseUrl, `venues/${encodeURIComponent(c.config.venueId)}`), { headers: authHeaders(c.config), signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        detail = 'Venue reachable';
      } else if (c.kind === 'loyalty') {
        const res = await fetch(joinUrl(c.config.baseUrl, 'health'), { headers: authHeaders(c.config), signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        detail = 'Health check passed';
      } else if (c.kind === 'stt') {
        const res = await fetch(joinUrl(c.config.baseUrl, 'models'), { headers: authHeaders(c.config), signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        detail = 'Speech server reachable';
      } else throw new Error('No test available');
      integrations.setStatus(c.id, 'connected', detail);
    } catch (e) {
      integrations.setStatus(c.id, 'error', String(e.message ?? e).slice(0, 300));
    }
    db.audit(user, 'integration.test', `integration:${c.id}`);
    if (c.id === 'flights') flights?.invalidate();
    return integrations.list().find(i => i.id === c.id);
  }, admin);

  // ---- Settings ----
  const SETTINGS = {
    demo_flights: v => bool(v), flight_cache_seconds: v => num(v, 'flight cache seconds', { min: 30, max: 900, required: true }), support_retention_days: v => num(v, 'help request retention', { min: 1, max: 90, required: true }), walk_speed_m_per_min: v => num(v, 'walking speed', { min: 30, max: 120, required: true }),
    step_free_speed_m_per_min: v => num(v, 'step-free speed', { min: 20, max: 100, required: true }),
    default_location: v => { const s = str(v, 'default location', { required: true, pattern: LOC_ID }); if (!db.get('SELECT 1 FROM locations WHERE id = ?', s)) throw new HttpError(400, 'Unknown location'); return s; },
    store_transcripts: v => bool(v), transcript_retention_days: v => num(v, 'retention days', { min: 1, max: 90, int: true, required: true }),
    analytics_enabled: v => bool(v), analytics_min_count: v => num(v, 'minimum count', { min: 3, max: 100, int: true, required: true }),
    analytics_retention_days: v => num(v, 'analytics retention', { min: 30, max: 1100, int: true, required: true }),
    assistant_use_llm: v => bool(v), map_is_simulated: v => bool(v), train_minutes: v => num(v, 'train minutes', { min: 1, max: 20, required: true }),
  };
  router.get('/api/admin/settings', () => Object.fromEntries(Object.keys(SETTINGS).map(k => [k, db.getSetting(k)])), admin);
  router.put('/api/admin/settings', ({ body, user }) => {
    const updates = {};
    for (const [k, v] of Object.entries(body)) {
      if (!SETTINGS[k]) throw new HttpError(400, `Unknown setting ${k}`);
      updates[k] = SETTINGS[k](v);
    }
    for (const [k, v] of Object.entries(updates)) db.setSetting(k, v);
    maps.invalidate();
    db.audit(user, 'settings.update', 'settings', updates);
    return Object.fromEntries(Object.keys(SETTINGS).map(k => [k, db.getSetting(k)]));
  }, admin);

  // ---- Analytics, audit, privacy ----
  router.get('/api/admin/analytics', ({ query }) => analytics.report(num(query.get('days'), 'days', { min: 1, max: 365, int: true }) ?? 30), admin);
  router.get('/api/admin/audit', ({ query }) => ({ items: db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', num(query.get('limit'), 'limit', { min: 1, max: 1000, int: true }) ?? 200) }), admin);
  router.get('/api/admin/transcripts', () => ({
    items: db.all('SELECT t.id, t.passenger_lang, t.staff_lang, t.created_at, t.expires_at, u.display_name AS staff, json_array_length(t.entries) AS entries FROM transcripts t JOIN users u ON u.id = t.staff_user_id ORDER BY t.id DESC LIMIT 500'),
  }), admin);
  router.get('/api/admin/transcripts/:id', ({ params, user }) => {
    const t = db.get('SELECT * FROM transcripts WHERE id = ?', Number(params.id));
    if (!t) throw new HttpError(404, 'Transcript not found');
    db.audit(user, 'transcript.view', `transcript:${t.id}`);
    return { ...t, entries: parseJson(t.entries, []) };
  }, admin);
  router.delete('/api/admin/transcripts', ({ user }) => {
    const r = db.run('DELETE FROM transcripts');
    db.audit(user, 'transcript.purge_all', 'transcripts', { deleted: r.changes });
    return { deleted: r.changes };
  }, admin);
  router.get('/api/admin/translation-status', () => ({ mode: translator.status() }), admin);
}
