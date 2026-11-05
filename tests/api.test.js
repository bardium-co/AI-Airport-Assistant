import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startMock, connectIntegration, llmReply, DEMO } from './helpers.js';

let A;
before(async () => { A = await startApp(); });
after(async () => { await A.close(); });

describe('public API', () => {
  test('health and meta (no secrets, honest integration status)', async () => {
    assert.equal((await A.get('/api/health')).json.ok, true);
    const m = (await A.get('/api/meta')).json;
    assert.equal(m.airport.code, 'DOH');
    assert.ok(m.languages.length >= 50, `${m.languages.length} languages`);
    for (const code of ['ja', 'ko', 'th', 'id', 'ms', 'tr', 'it', 'pl', 'es-MX', 'zh-TW']) assert.ok(m.languages.find(l => l.code === code && l.builtin && l.enabled !== false), code);
    assert.ok(m.languages.find(l => l.code === 'he').rtl && m.languages.find(l => l.code === 'fa').rtl);
    assert.ok(m.languages.find(l => l.code === 'ar').rtl);
    for (const [id, s] of Object.entries(m.integrations)) {
      assert.notEqual(s.status, 'connected', `${id} must not claim to be connected by default`);
      assert.equal(JSON.stringify(s).includes('apiKey'), false);
    }
    assert.equal(m.flightSource, 'simulated');
    assert.equal(m.places.prayer.hi, 'प्रार्थना कक्ष');
  });

  test('flight lookup returns simulated, labelled data with localized status', async () => {
    const r = (await A.get('/api/flights/qr%20572?lang=hi')).json;
    assert.equal(r.status, 'found');
    assert.equal(r.source, 'simulated');
    assert.equal(r.flight.simulated, true);
    assert.equal(r.flight.gate, 'C9');
    assert.equal(r.gateLocationId, 'GATE_C9');
    assert.equal(r.flight.statusLabel, 'समय पर निर्धारित');
    assert.ok(Date.parse(r.flight.scheduledDeparture) > Date.now());
    assert.equal((await A.get('/api/flights/!!!')).json.status, 'invalid');
  });

  test('map, routes and nearest', async () => {
    const m = (await A.get('/api/map')).json;
    assert.equal(m.simulated, true);
    assert.ok(m.locations.length > 100 && m.edges.length > 100);
    const r = (await A.get('/api/route?from=PLAZA&to=GATE_C9')).json;
    assert.equal(r.path[0], 'PLAZA');
    assert.equal(r.path.at(-1), 'GATE_C9');
    assert.equal((await A.get('/api/route?from=PLAZA&to=NOWHERE')).status, 404);
    assert.equal((await A.get('/api/route?from=PLAZA')).status, 400);
    assert.equal((await A.get("/api/route?from=PLAZA&to=x'%20OR%201=1--")).status, 400, 'invalid id format rejected');
    const n = (await A.get('/api/nearest?from=GATE_A9&type=toilet')).json;
    assert.equal(n.path.at(-1), 'TOILET_A8');
    assert.equal((await A.get('/api/nearest?from=PLAZA&type=spaceship')).status, 400);
  });

  test('lounge recommendations are provisional and sorted', async () => {
    const r = (await A.post('/api/lounges/recommend', { carrier: 'QR', cabin: 'business', tier: 'NONE', from: 'GATE_C1' })).json;
    assert.equal(r.verified, false);
    assert.match(r.notice, /verified by staff/);
    assert.equal(r.lounges[0].eligibility.result, 'likely');
    assert.ok(r.lounges.every(l => l.eligibility.verified === false));
    assert.equal((await A.post('/api/lounges/recommend', { carrier: 'HACK' })).status, 400);
  });

  test('FAQs: localized, searchable, with sources', async () => {
    const all = (await A.get('/api/faqs?lang=ar')).json.items;
    assert.ok(all.length >= 15);
    assert.ok(all.some(f => f.lang === 'ar' && /واي فاي/.test(f.q)));
    const s = (await A.get('/api/faqs?lang=en&q=wifi')).json.items;
    assert.equal(s.length, 1);
    assert.match(s[0].sourceUrl, /dohahamadairport\.com/);
    assert.equal((await A.post('/api/faqs/translate', { id: 1, lang: 'fr' })).status, 503, 'no translation provider → honest 503');
  });

  test('server speech recognition reports not connected', async () => {
    const r = await A.req('POST', '/api/speech/transcribe?lang=en', undefined, { raw: Buffer.from('abc'), headers: { 'Content-Type': 'audio/webm' } });
    assert.equal(r.status, 503);
  });
});

describe('HTTP hardening', () => {
  test('security headers and CSP on API and static responses', async () => {
    for (const p of ['/api/health', '/', '/js/app.js']) {
      const r = await fetch(A.base + p);
      assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
    }
  });
  test('static files, SPA fallback and path traversal protection', async () => {
    const index = await fetch(A.base + '/');
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Airport Assistant/);
    assert.equal((await fetch(A.base + '/staff')).status, 200, 'SPA fallback');
    for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/server/config.js', '/../data/.app-secret']) {
      const r = await fetch(A.base + p);
      assert.ok([403, 404].includes(r.status) || !(await r.text()).includes('APP_SECRET'), p);
    }
    assert.equal((await fetch(A.base + '/nope.js')).status, 404);
  });
  test('rejects wrong content type, bad JSON and oversized bodies', async () => {
    const t = await A.req('POST', '/api/assistant/chat', undefined, { raw: 'message=hi', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(t.status, 415);
    const j = await A.req('POST', '/api/assistant/chat', undefined, { raw: '{bad', headers: { 'Content-Type': 'application/json' } });
    assert.equal(j.status, 400);
    const big = await A.req('POST', '/api/assistant/chat', undefined, { raw: JSON.stringify({ message: 'x'.repeat(300000) }), headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 413);
  });
  test('unknown routes and methods', async () => {
    assert.equal((await A.get('/api/nothing')).status, 404);
    assert.equal((await A.req('DELETE', '/api/health')).status, 405);
  });
  test('rate limiting protects chat (production limits)', async () => {
    const B = await startApp({ rateScale: 1 });
    try {
      const codes = [];
      for (let i = 0; i < 34; i++) codes.push((await B.post('/api/assistant/chat', { message: 'hello', lang: 'en' })).status);
      assert.ok(codes.slice(0, 30).every(c => c === 200));
      assert.ok(codes.slice(30).includes(429));
    } finally { await B.close(); }
  });
});

describe('authentication & role-based access', () => {
  test('login success sets HttpOnly SameSite cookie; wrong password fails generically', async () => {
    const r = await A.post('/api/auth/login', { username: 'staff', password: 'Staff#2026demo' });
    assert.equal(r.status, 200);
    const c = r.headers.get('set-cookie');
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    assert.ok(r.json.csrf);
    assert.equal(r.json.user.role, 'staff');
    const bad = await A.post('/api/auth/login', { username: 'staff', password: 'wrong' });
    assert.equal(bad.status, 401);
    const nouser = await A.post('/api/auth/login', { username: 'ghost', password: 'wrong' });
    assert.equal(nouser.status, 401);
    assert.equal(bad.json.error, nouser.json.error, 'no username enumeration');
  });
  test('account locks after repeated failures', async () => {
    const B = await startApp();
    try {
      for (let i = 0; i < 5; i++) await B.post('/api/auth/login', { username: 'supervisor', password: 'nope' });
      const r = await B.post('/api/auth/login', { username: 'supervisor', password: 'Super#2026demo' });
      assert.equal(r.status, 423);
    } finally { await B.close(); }
  });
  test('staff/admin endpoints require sign-in and the right role', async () => {
    assert.equal((await A.get('/api/staff/phrases')).status, 401);
    assert.equal((await A.get('/api/admin/users')).status, 401);
    const s = await A.login(...DEMO.staff);
    assert.equal((await s.get('/api/staff/phrases')).status, 200);
    assert.equal((await s.get('/api/admin/users')).status, 403);
    assert.equal((await s.put('/api/admin/settings', { demo_flights: false })).status, 403);
    const sup = await A.login(...DEMO.supervisor);
    assert.equal((await sup.get('/api/admin/integrations')).status, 403);
    const ad = await A.login(...DEMO.admin);
    assert.equal((await ad.get('/api/admin/users')).status, 200);
  });
  test('CSRF token required for state-changing staff requests', async () => {
    const s = await A.login(...DEMO.staff);
    const noToken = await A.req('POST', '/api/staff/translate', { text: 'Thank you. Have a pleasant journey.', from: 'en', to: 'hi' }, { cookie: s.cookie });
    assert.equal(noToken.status, 403);
    const wrong = await A.req('POST', '/api/staff/translate', { text: 'x', from: 'en', to: 'hi' }, { cookie: s.cookie, csrf: 'x'.repeat(s.csrf.length) });
    assert.equal(wrong.status, 403);
    const ok = await s.post('/api/staff/translate', { text: 'Thank you. Have a pleasant journey.', from: 'en', to: 'hi' });
    assert.equal(ok.status, 200);
  });
  test('logout revokes the session server-side', async () => {
    const s = await A.login(...DEMO.staff);
    assert.equal((await s.post('/api/auth/logout')).status, 200);
    assert.equal((await s.get('/api/staff/phrases')).status, 401);
  });
  test('me endpoint', async () => {
    assert.equal((await A.get('/api/auth/me')).json.user, null);
    const s = await A.login(...DEMO.staff);
    assert.equal((await s.get('/api/auth/me')).json.user.username, 'staff');
  });
});

describe('staff: interpreter and guidance', () => {
  test('phrasebook translation is exact and labelled non-machine; free text without provider is honest', async () => {
    const s = await A.login(...DEMO.staff);
    const p = (await s.post('/api/staff/translate', { text: 'May I see your boarding pass, please?', from: 'en', to: 'ar' })).json;
    assert.equal(p.engine, 'phrasebook');
    assert.equal(p.machine, false);
    assert.equal(p.text, 'هل يمكنني رؤية بطاقة الصعود من فضلك؟');
    const free = (await s.post('/api/staff/translate', { text: 'Your bag is at belt 7', from: 'en', to: 'hi' })).json;
    assert.equal(free.text, null);
    assert.equal(free.error, 'not_configured');
  });
  test('approved guidance covers frequent flyer, lounge, Qcredits and upgrades', async () => {
    const s = await A.login(...DEMO.staff);
    const g = (await s.get('/api/staff/guidance')).json.items;
    for (const topic of ['ffp', 'lounge', 'qcredits', 'upgrade']) assert.ok(g.some(x => x.topic === topic && x.status === 'approved'), topic);
    assert.ok(g.every(x => /SIMULATED approval/.test(x.approved_by)), 'seed approvals are labelled simulated');
  });
  test('editing guidance returns it to draft; only supervisors can approve', async () => {
    const ad = await A.login(...DEMO.admin);
    const id = (await ad.get('/api/admin/guidance')).json.items.find(x => x.topic === 'privacy').id;
    assert.equal((await ad.put(`/api/admin/guidance/${id}`, { body: 'Updated privacy guidance text.' })).json.status, 'draft');
    const s = await A.login(...DEMO.staff);
    assert.ok(!(await s.get('/api/staff/guidance')).json.items.some(x => x.id === id), 'drafts hidden from staff');
    assert.equal((await s.post(`/api/staff/guidance/${id}/approve`)).status, 403);
    const sup = await A.login(...DEMO.supervisor);
    assert.equal((await sup.post(`/api/staff/guidance/${id}/approve`)).status, 200);
    assert.ok((await s.get('/api/staff/guidance')).json.items.some(x => x.id === id && x.version === 2));
  });
  test('transcripts are off by default; saving needs admin enablement and passenger consent', async () => {
    const s = await A.login(...DEMO.staff);
    const entries = [{ side: 'passenger', original: 'नमस्ते', translated: 'Hello', from: 'hi', to: 'en', at: Date.now() }];
    assert.equal((await s.post('/api/staff/transcripts', { consent: true, passengerLang: 'hi', staffLang: 'en', entries })).status, 403);
    const ad = await A.login(...DEMO.admin);
    await ad.put('/api/admin/settings', { store_transcripts: true, transcript_retention_days: 3 });
    assert.equal((await s.post('/api/staff/transcripts', { consent: false, passengerLang: 'hi', staffLang: 'en', entries })).status, 400);
    const ok = await s.post('/api/staff/transcripts', { consent: true, passengerLang: 'hi', staffLang: 'en', entries });
    assert.equal(ok.status, 200);
    assert.ok(Math.abs(ok.json.expiresAt - (Date.now() + 3 * 86400000)) < 60000);
    const list = (await ad.get('/api/admin/transcripts')).json.items;
    assert.equal(list.length, 1);
    await ad.get(`/api/admin/transcripts/${list[0].id}`);
    assert.ok((await ad.get('/api/admin/audit')).json.items.some(a => a.action === 'transcript.view'), 'access is audited');
    assert.equal((await ad.del('/api/admin/transcripts')).json.deleted, 1);
    await ad.put('/api/admin/settings', { store_transcripts: false });
  });
});

describe('eligibility decisions require verification and staff approval', () => {
  test('lounge case: cannot approve until required checks are done; passenger code verifies', async () => {
    const s = await A.login(...DEMO.staff);
    const c = (await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'L_MOURJAN_S', carrier: 'QR', cabin: 'business', flightNo: 'QR 572', memberLast4: '1234' } })).json;
    assert.equal(c.status, 'pending');
    assert.equal(c.provisional.result, 'likely');
    assert.equal(c.provisional.verified, false);
    assert.equal(c.inputs.flightNo, 'QR572');
    const early = await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve' });
    assert.equal(early.status, 400);
    assert.deepEqual(early.json.missing.sort(), ['boarding_pass', 'carrier_cabin', 'identity']);
    await s.post(`/api/staff/cases/${c.id}/checklist`, { items: { boarding_pass: true, carrier_cabin: true, identity: true } });
    const ok = (await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve' })).json;
    assert.equal(ok.status, 'approved');
    assert.match(ok.refCode, /^BV-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const pub = (await A.get(`/api/lounges/verification/${ok.refCode}`)).json;
    assert.equal(pub.valid, true);
    assert.equal(pub.lounge, 'Al Mourjan Business Lounge');
    assert.equal(JSON.stringify(pub).includes('1234'), false, 'no member data exposed');
    assert.equal((await A.get('/api/lounges/verification/BV-FAKE-CODE')).status, 404);
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'deny', reason: 'changed mind' })).status, 409, 'decided cases are immutable');
  });
  test('status-based lounge access also requires the membership check', async () => {
    const s = await A.login(...DEMO.staff);
    const c = (await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'L_PC_GOLD', carrier: 'QR', cabin: 'economy', tier: 'PC_GOLD' } })).json;
    await s.post(`/api/staff/cases/${c.id}/checklist`, { items: { boarding_pass: true, carrier_cabin: true, identity: true } });
    const r = await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.missing, ['membership']);
  });
  test('approving against the rules needs a written justification; denial needs a reason', async () => {
    const s = await A.login(...DEMO.staff);
    const c = (await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'L_MARINER', carrier: 'QR', cabin: 'economy' } })).json;
    assert.equal(c.provisional.result, 'unlikely');
    await s.post(`/api/staff/cases/${c.id}/checklist`, { items: { boarding_pass: true, carrier_cabin: true, identity: true } });
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve' })).status, 400);
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'deny' })).status, 400);
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'deny', reason: 'Economy ticket — not eligible' })).json.status, 'denied');
  });
  test('upgrade: staff cannot approve; supervisor approval with four-eyes rule', async () => {
    const s = await A.login(...DEMO.staff);
    const c = (await s.post('/api/staff/cases', { kind: 'upgrade', inputs: { fromCabin: 'economy', toCabin: 'business', method: 'qcredits', flightNo: 'QR572' } })).json;
    assert.equal(c.requiresRole, 'supervisor');
    await s.post(`/api/staff/cases/${c.id}/checklist`, { items: { boarding_pass: true, fare_rules: true, availability: true, payment_method: true, passenger_informed: true } });
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve' })).status, 403);
    assert.equal((await s.post(`/api/staff/cases/${c.id}/decision`, { decision: 'escalate' })).json.status, 'escalated');
    const sup = await A.login(...DEMO.supervisor);
    const ok = (await sup.post(`/api/staff/cases/${c.id}/decision`, { decision: 'approve', reason: 'Confirmed in airline system' })).json;
    assert.equal(ok.status, 'approved');
    assert.equal(ok.refCode, null, 'no lounge code for upgrades');
    // Supervisor opening their own upgrade cannot approve it.
    const own = (await sup.post('/api/staff/cases', { kind: 'upgrade', inputs: { fromCabin: 'business', toCabin: 'first', method: 'avios' } })).json;
    await sup.post(`/api/staff/cases/${own.id}/checklist`, { items: { boarding_pass: true, fare_rules: true, availability: true, payment_method: true, passenger_informed: true } });
    assert.equal((await sup.post(`/api/staff/cases/${own.id}/decision`, { decision: 'approve' })).status, 403);
    assert.equal((await s.post('/api/staff/cases', { kind: 'upgrade', inputs: { fromCabin: 'business', toCabin: 'economy', method: 'avios' } })).status, 400, 'downgrade rejected');
  });
  test('input validation on cases', async () => {
    const s = await A.login(...DEMO.staff);
    assert.equal((await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'L_MOURJAN_S', carrier: 'QR', cabin: 'business', memberLast4: '12345678' } })).status, 400, 'full member numbers refused');
    assert.equal((await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'NOPE', carrier: 'QR', cabin: 'business' } })).status, 400);
    assert.equal((await s.post('/api/staff/cases', { kind: 'magic', inputs: {} })).status, 400);
    assert.equal((await s.post('/api/staff/cases/1/checklist', { items: { hacked: true } })).status, 409);
  });
  test('loyalty verification is unavailable until an authorised service is connected', async () => {
    const s = await A.login(...DEMO.staff);
    const c = (await s.post('/api/staff/cases', { kind: 'membership', inputs: { topic: 'qcredits', tier: 'PC_GOLD' } })).json;
    const r = await s.post(`/api/staff/cases/${c.id}/verify-loyalty`, { memberNumber: '123456789', lastName: 'Sharma' });
    assert.equal(r.status, 503);
  });
});

describe('integrations: never connected without authorisation and a passing test', () => {
  test('authorised flight feed replaces simulated data; failures never fall back to simulation', async () => {
    let healthy = true;
    const feed = await startMock({
      'GET /health': () => (healthy ? { ok: true } : { status: 500, json: {} }),
      'GET /flights/:no': ({ params, headers }) => {
        if (headers.authorization !== 'Bearer feed-key') return { status: 401, json: {} };
        if (!healthy) return { status: 500, json: {} };
        if (params[0] === 'QR572') return { flightNo: 'QR572', airline: 'Qatar Airways', destination: 'New Delhi', destinationCode: 'DEL', scheduledDeparture: new Date(Date.now() + 3600e3).toISOString(), gate: 'D3', status: 'boarding' };
        return { status: 404, json: {} };
      },
    });
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      // Configured + enabled but NOT authorised → not used.
      await ad.put('/api/admin/integrations/flights', { provider: 'authorised_feed', config: { baseUrl: feed.url, apiKey: 'feed-key' }, enabled: true, authorised: false });
      await ad.post('/api/admin/integrations/flights/test');
      assert.equal((await B.get('/api/meta')).json.integrations.flights.status, 'awaiting_authorisation');
      assert.equal((await B.get('/api/flights/QR572')).json.source, 'simulated');
      // Authorised + tested → live.
      const t = await connectIntegration(ad, 'flights', 'authorised_feed', { baseUrl: feed.url });
      assert.equal(t.status, 'connected');
      assert.equal(t.config.apiKey, '••••••••-key', 'secret is masked and kept');
      const live = (await B.get('/api/flights/QR572')).json;
      assert.equal(live.source, 'live');
      assert.equal(live.flight.gate, 'D3');
      assert.equal(live.flight.simulated, false);
      const chat = (await B.post('/api/assistant/chat', { message: 'QR 572 gate?', lang: 'en' })).json;
      assert.match(chat.text, /gate D3/);
      assert.ok(!/SIMULATED/.test(chat.text));
      assert.equal((await B.get('/api/flights/QR600')).json.status, 'not_found', 'simulated QR600 is not used when live is connected');
      healthy = false;
      const err = (await B.get('/api/flights/QR572')).json;
      assert.equal(err.status, 'error');
      const c2 = (await B.post('/api/assistant/chat', { message: 'QR 572 gate?', lang: 'en' })).json;
      assert.equal(c2.intent, 'flight_unavailable');
      assert.ok(!/C9|D3/.test(c2.text), 'no stale or simulated gate on feed failure');
      // A failing test flips the status to error and disables use.
      await ad.post('/api/admin/integrations/flights/test');
      assert.equal((await B.get('/api/meta')).json.integrations.flights.status, 'error');
    } finally { await B.close(); await feed.close(); }
  });

  test('when demo flights are disabled and no feed is connected, the assistant says so', async () => {
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      await ad.put('/api/admin/settings', { demo_flights: false });
      const r = (await B.post('/api/assistant/chat', { message: 'QR 572 का गेट कौन सा है?', lang: 'hi' })).json;
      assert.equal(r.intent, 'flight_unavailable');
      assert.match(r.text, /अधिकृत फ़्लाइट डेटा फ़ीड/);
      assert.ok(!/C9/.test(r.text));
      assert.equal((await B.get('/api/meta')).json.flightSource, 'none');
    } finally { await B.close(); }
  });

  test('LibreTranslate provider enables free-text interpreter translation', async () => {
    const lt = await startMock({
      'GET /languages': () => [{ code: 'en' }, { code: 'hi' }],
      'POST /translate': ({ body }) => ({ translatedText: `[${body.target}] ${body.q}` }),
    });
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      assert.equal((await connectIntegration(ad, 'translation', 'libretranslate', { baseUrl: lt.url })).status, 'connected');
      const s = await B.login(...DEMO.staff);
      const r = (await s.post('/api/staff/translate', { text: 'Your bag is at belt 7', from: 'en', to: 'hi' })).json;
      assert.equal(r.text, '[hi] Your bag is at belt 7');
      assert.equal(r.machine, true);
      const faq = (await B.post('/api/faqs/translate', { id: 1, lang: 'fr' })).json;
      assert.equal(faq.machine, true);
      // Non-built-in language gets machine-translated assistant answers, labelled as such.
      await ad.put('/api/admin/languages/ne', { enabled: true });
      const ne = (await B.post('/api/assistant/chat', { message: 'Is there free wifi?', lang: 'ne' })).json;
      assert.equal(ne.lang, 'ne');
      assert.match(ne.text, /^\[ne\]/);
      assert.ok(ne.notices.some(n => n.kind === 'machine_translation'));
    } finally { await B.close(); await lt.close(); }
  });

  test('LLM integration with primary → fallback chain', async () => {
    const bad = await startMock({ 'POST /v1/chat/completions': () => ({ status: 500, json: { error: 'down' } }) });
    const good = await startMock({ 'POST /v1/chat/completions': ({ body }) => (/single word OK/.test(body.messages[0].content) ? llmReply('OK') : /interpreter/.test(body.messages[0].content) ? llmReply('नमस्ते') : llmReply('{"intent":"other"}')) });
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      assert.equal((await connectIntegration(ad, 'llm_fallback', 'deepseek', { baseUrl: good.url + '/v1', model: 'deepseek-chat', apiKey: 'sk-test' })).status, 'connected');
      const primary = await connectIntegration(ad, 'llm_primary', 'vllm', { baseUrl: bad.url + '/v1', model: 'Qwen/Qwen3-8B' });
      assert.equal(primary.status, 'error', 'failing model is not marked connected');
      await ad.put('/api/admin/integrations/translation', { provider: 'llm', enabled: true, authorised: true });
      await ad.post('/api/admin/integrations/translation/test');
      const s = await B.login(...DEMO.staff);
      const r = (await s.post('/api/staff/translate', { text: 'Hello friend', from: 'en', to: 'hi' })).json;
      assert.equal(r.text, 'नमस्ते');
      assert.match(r.engine, /deepseek:deepseek-chat/);
      assert.equal(good.calls.find(c => c.path === '/v1/chat/completions').headers.authorization, 'Bearer sk-test');
    } finally { await B.close(); await bad.close(); await good.close(); }
  });

  test('loyalty service: verifies membership without storing the number', async () => {
    const loy = await startMock({ 'GET /health': () => ({ ok: true }), 'POST /members/verify': ({ body }) => ({ verified: body.memberNumber === '123456789', tier: 'PC_GOLD' }) });
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      await connectIntegration(ad, 'loyalty', 'authorised_api', { baseUrl: loy.url });
      const s = await B.login(...DEMO.staff);
      const c = (await s.post('/api/staff/cases', { kind: 'lounge', inputs: { loungeId: 'L_PC_GOLD', carrier: 'QR', cabin: 'economy', tier: 'PC_GOLD' } })).json;
      const v = (await s.post(`/api/staff/cases/${c.id}/verify-loyalty`, { memberNumber: '123456789', lastName: 'Khan' })).json;
      assert.equal(v.verified, true);
      const stored = B.app.db.get('SELECT inputs FROM eligibility_cases WHERE id = ?', c.id).inputs;
      assert.ok(!stored.includes('123456789'), 'full member number never stored');
      assert.ok(stored.includes('6789'));
    } finally { await B.close(); await loy.close(); }
  });

  test('integration config validation and secrets encrypted at rest', async () => {
    const B = await startApp();
    try {
      const ad = await B.login(...DEMO.admin);
      assert.equal((await ad.put('/api/admin/integrations/flights', { provider: 'authorised_feed', config: { baseUrl: 'ftp://x' } })).status, 400);
      assert.equal((await ad.put('/api/admin/integrations/flights', { provider: 'made_up' })).status, 400);
      assert.equal((await ad.put('/api/admin/integrations/nope', { provider: 'none' })).status, 404);
      await ad.put('/api/admin/integrations/llm_primary', { provider: 'openrouter', config: { baseUrl: 'https://openrouter.ai/api/v1', model: 'qwen/qwen3-32b', apiKey: 'sk-super-secret-value' } });
      const rawRow = B.app.db.get(`SELECT config_enc FROM integrations WHERE id='llm_primary'`).config_enc;
      assert.ok(!rawRow.includes('sk-super-secret-value'));
      const listed = JSON.stringify((await ad.get('/api/admin/integrations')).json);
      assert.ok(!listed.includes('sk-super-secret-value'));
      assert.equal((await ad.post('/api/admin/integrations/stt/test')).status, 400, 'browser provider has nothing to test');
    } finally { await B.close(); }
  });
});

describe('admin management', () => {
  test('locations, edges, gates: CRUD with validation and routing updates', async () => {
    const ad = await A.login(...DEMO.admin);
    assert.equal((await ad.post('/api/admin/locations', { id: 'bad id!', type: 'gate', name: 'x', x: 1, y: 1 })).status, 400);
    assert.equal((await ad.post('/api/admin/locations', { id: 'GATE_C40', type: 'gate', name: 'Gate C40', concourse: 'C', x: 2000, y: 1 })).status, 400);
    assert.equal((await ad.post('/api/admin/locations', { id: 'GATE_C15', type: 'gate', name: 'Gate C15', concourse: 'C', x: 10, y: 10 })).status, 409, 'existing id');
    const g = await ad.post('/api/admin/locations', { id: 'GATE_C40', type: 'gate', name: 'Gate C40', concourse: 'C', x: 935, y: 330, connectTo: ['S_C31'] });
    assert.equal(g.status, 200);
    assert.equal((await A.get('/api/route?from=PLAZA&to=GATE_C40')).status, 200);
    const chat = (await A.post('/api/assistant/chat', { message: 'gate C40', lang: 'en' })).json;
    assert.equal(chat.intent, 'gate_route');
    await ad.put('/api/admin/locations/GATE_C40', { status: 'closed' });
    assert.equal((await A.get('/api/map')).json.locations.find(l => l.id === 'GATE_C40').status, 'closed');
    assert.equal((await ad.del('/api/admin/locations/GATE_C40')).status, 200);
    assert.equal((await A.get('/api/route?from=PLAZA&to=GATE_C40')).status, 404);
    assert.equal((await ad.del('/api/admin/locations/LOUNGE_SAFWA')).status, 409, 'lounge location protected');
    assert.equal((await ad.post('/api/admin/edges', { a: 'PLAZA', b: 'PLAZA' })).status, 400);
    assert.equal((await ad.post('/api/admin/edges', { a: 'PLAZA', b: 'PLAZA_S' })).status, 409);
  });
  test('map export → import round-trip', async () => {
    const ad = await A.login(...DEMO.admin);
    const exp = (await ad.get('/api/admin/map/export')).json;
    const r = await ad.post('/api/admin/map/import', exp);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.locations, exp.locations.length);
    assert.equal((await A.get('/api/route?from=PLAZA&to=GATE_C9')).status, 200);
    assert.equal((await ad.post('/api/admin/map/import', { locations: [{ id: 'ONLY', type: 'plaza', name: 'x', x: 1, y: 1 }], edges: [] })).status, 400, 'cannot drop lounge locations');
  });
  test('lounges & opening hours', async () => {
    const ad = await A.login(...DEMO.admin);
    const r = await ad.put('/api/admin/lounges/L_MAHA_S', { hours: { open: '06:00', close: '22:00' }, status: 'open' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.hours.open, '06:00');
    assert.equal((await ad.put('/api/admin/lounges/L_MAHA_S', { hours: { open: '25:00', close: '22:00' } })).status, 400);
    assert.equal((await ad.put('/api/admin/lounges/L_MAHA_S', { rules: { rules: [{ reason: 'x' }] } })).status, 400, 'rule must restrict something');
    assert.equal((await ad.put('/api/admin/lounges/L_MAHA_S', { rules: { rules: [{ cabins: ['spaceship'] }] } })).status, 400);
    await ad.put('/api/admin/lounges/L_MAHA_S', { hours: { always: true, label: '24 hours' } });
    const u = await ad.put('/api/admin/lounges/L_MAHA_S', { hours: { unknown: true } });
    assert.equal(u.json.hours.unknown, true);
  });
  test('FAQs require English; languages can be enabled; English cannot be disabled', async () => {
    const ad = await A.login(...DEMO.admin);
    assert.equal((await ad.post('/api/admin/faqs', { category: 'general', translations: { hi: { q: 'क', a: 'ख' } } })).status, 400);
    const f = await ad.post('/api/admin/faqs', { category: 'general', keywords: 'baggage claim, belts', translations: { en: { q: 'Where is baggage claim?', a: 'Follow the Arrivals signs to baggage reclaim.' } } });
    assert.equal(f.status, 200);
    assert.equal((await A.post('/api/assistant/chat', { message: 'where is baggage claim', lang: 'en' })).json.intent, 'faq');
    assert.equal((await ad.put('/api/admin/languages/en', { enabled: false })).status, 400);
    assert.equal((await ad.put('/api/admin/languages/ta', { enabled: true })).status, 200);
    assert.ok((await A.get('/api/meta')).json.languages.some(l => l.code === 'ta'));
    await ad.put('/api/admin/languages/ta', { enabled: false });
  });
  test('users: password policy, role changes revoke sessions, last admin protected', async () => {
    const ad = await A.login(...DEMO.admin);
    assert.equal((await ad.post('/api/admin/users', { username: 'weak', displayName: 'W', role: 'staff', password: 'short' })).status, 400);
    const u = await ad.post('/api/admin/users', { username: 'agent.one', displayName: 'Agent One', role: 'staff', password: 'Str0ngPassword!' });
    assert.equal(u.status, 200);
    const sess = await A.login('agent.one', 'Str0ngPassword!');
    assert.equal((await sess.get('/api/staff/phrases')).status, 200);
    await ad.put(`/api/admin/users/${u.json.id}`, { role: 'supervisor' });
    assert.equal((await sess.get('/api/staff/phrases')).status, 401, 'role change signs the user out');
    await ad.put(`/api/admin/users/${u.json.id}`, { active: false });
    assert.equal((await A.post('/api/auth/login', { username: 'agent.one', password: 'Str0ngPassword!' })).status, 401);
    assert.equal((await ad.put(`/api/admin/users/${ad.user.id}`, { role: 'staff' })).status, 400, 'cannot demote yourself');
  });
  test('settings whitelist and simulated flight management', async () => {
    const ad = await A.login(...DEMO.admin);
    assert.equal((await ad.put('/api/admin/settings', { evil: 1 })).status, 400);
    assert.equal((await ad.put('/api/admin/settings', { walk_speed_m_per_min: 5 })).status, 400);
    assert.equal((await ad.post('/api/admin/sim-flights', { flight_no: 'QR 1', airline: 'Qatar Airways', destination: 'Test', destination_code: 'TST', dep_offset_min: 30, gate: 'Z9' })).status, 400);
    assert.equal((await ad.post('/api/admin/sim-flights', { flight_no: 'QR 1', airline: 'Qatar Airways', destination: 'Test City', destination_code: 'TST', dep_offset_min: 30, gate: 'A1' })).status, 200);
    assert.equal((await A.get('/api/flights/QR1')).json.flight.gate, 'A1');
    assert.equal((await ad.del('/api/admin/sim-flights/QR1')).status, 200);
  });
  test('analytics are aggregate-only and small counts are suppressed', async () => {
    const B = await startApp();
    try {
      for (let i = 0; i < 6; i++) await B.post('/api/assistant/chat', { message: 'is there wifi', lang: 'en' });
      await B.post('/api/assistant/chat', { message: 'hello', lang: 'de' });
      const ad = await B.login(...DEMO.admin);
      const a = (await ad.get('/api/admin/analytics?days=7')).json;
      const faq = a.byIntent.find(x => x.name === 'faq');
      assert.equal(faq.count, 6);
      const greet = a.byIntent.find(x => x.name === 'greeting');
      assert.equal(greet.count, null);
      assert.equal(greet.suppressed, true);
      const rows = B.app.db.all('SELECT * FROM analytics_daily');
      assert.ok(rows.every(r => Object.keys(r).sort().join() === 'count,day,intent,lang,mode'), 'no other columns');
      assert.ok(!JSON.stringify(rows).includes('wifi'), 'no question text stored');
    } finally { await B.close(); }
  });
  test('audit log records administrative actions', async () => {
    const ad = await A.login(...DEMO.admin);
    const items = (await ad.get('/api/admin/audit')).json.items;
    for (const action of ['auth.login', 'location.create', 'case.approve', 'user.create']) assert.ok(items.some(i => i.action === action), action);
  });
});

describe('production mode', () => {
  test('no demo accounts, no simulated flights, random admin password', async () => {
    const logs = [];
    const { loadConfig } = await import('../server/config.js');
    const { createApp } = await import('../server/app.js');
    const cfg = loadConfig({ dbFile: ':memory:', secret: 's'.repeat(48), production: true, demoMode: false });
    const app = await createApp(cfg, { log: m => logs.push(m) });
    try {
      assert.equal(app.db.get('SELECT COUNT(*) n FROM users WHERE is_demo = 1').n, 0);
      assert.equal(app.db.getSetting('demo_flights'), false);
      assert.ok(logs.some(l => /Initial administrator created/.test(l)));
      assert.equal(cfg.secureCookies, true);
    } finally { await app.close(); }
  });
});
