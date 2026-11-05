import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startMock, connectIntegration, DEMO } from './helpers.js';
import { purgeSupport } from '../server/routes/support.js';
import { PHRASEBOOK } from '../server/services/translate.js';

describe('passenger → staff help requests', () => {
  let A, s, req;
  const P = (path, body, token) => A.req(body === undefined ? 'GET' : 'POST', path, body, { headers: token ? { 'X-Support-Token': token } : {} });
  before(async () => { A = await startApp(); s = await A.login(...DEMO.staff); });
  after(async () => { await A.close(); });

  test('a passenger can send a request anonymously and only they can read it', async () => {
    const r = await A.post('/api/support', { message: 'मेरा बैग नहीं मिल रहा, मदद चाहिए', lang: 'hi', from: 'GATE_C9', flightNo: 'qr 572', context: 'where is my bag' });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.code, /^H-[A-Z2-9]{4}$/);
    assert.ok(r.json.token.length >= 30);
    req = r.json;
    assert.equal((await P(`/api/support/${req.id}`)).status, 404, 'no token → not found');
    assert.equal((await P(`/api/support/${req.id}`, undefined, 'wrong-token')).status, 404);
    const v = (await P(`/api/support/${req.id}`, undefined, req.token)).json;
    assert.equal(v.status, 'open');
    assert.equal(v.messages[0].sender, 'passenger');
    assert.equal(v.messages[0].text, 'मेरा बैग नहीं मिल रहा, मदद चाहिए');
    assert.equal((await A.post('/api/support', { message: '', lang: 'en' })).status, 400);
    assert.equal((await A.post('/api/support', { message: 'x'.repeat(601), lang: 'en' })).status, 400);
  });

  test('staff must sign in; signed-in staff see the request with language, location and waiting time', async () => {
    assert.equal((await A.get('/api/staff/support')).status, 401);
    const list = (await s.get('/api/staff/support')).json;
    const item = list.items.find(i => i.id === req.id);
    assert.equal(item.status, 'open');
    assert.equal(item.langName, 'Hindi');
    assert.equal(item.location, 'GATE_C9');
    assert.equal(item.locationName, 'Gate C9');
    assert.equal(item.flightNo, 'QR572');
    assert.ok(item.waitingSince);
    assert.ok(list.counts.open >= 1);
    const d = (await s.get(`/api/staff/support/${req.id}`)).json;
    assert.equal(d.context, 'where is my bag');
    assert.ok(d.phrases.some(p => p.id === 'coming' && p.local === PHRASEBOOK.coming.hi), 'quick replies with the passenger-language preview');
  });

  test('staff actions need the CSRF token', async () => {
    const r = await A.req('POST', `/api/staff/support/${req.id}/claim`, {}, { cookie: s.cookie });
    assert.equal(r.status, 403);
  });

  test('claim → the passenger sees that someone is helping; quick replies arrive in the passenger language', async () => {
    assert.equal((await s.post(`/api/staff/support/${req.id}/claim`)).json.status, 'claimed');
    const sent = (await s.post(`/api/staff/support/${req.id}/messages`, { phrase: 'coming' })).json;
    assert.equal(sent.localized, true);
    const v = (await P(`/api/support/${req.id}`, undefined, req.token)).json;
    assert.equal(v.status, 'claimed');
    assert.ok(v.messages.some(m => m.sender === 'system' && m.event === 'claimed'));
    const staffMsg = v.messages.find(m => m.sender === 'staff');
    assert.equal(staffMsg.text, PHRASEBOOK.coming.hi, 'reviewed Hindi phrase, not English');
    assert.equal(staffMsg.english, false);
    assert.equal((await s.get('/api/staff/support')).json.items.find(i => i.id === req.id).waitingSince, null, 'replying clears the waiting timer');
    assert.equal((await s.post(`/api/staff/support/${req.id}/messages`, { phrase: 'nonsense' })).status, 400);
  });

  test('free text without a translation service is delivered in English and labelled', async () => {
    await s.post(`/api/staff/support/${req.id}/messages`, { message: 'Your bag is at belt 7' });
    const v = (await P(`/api/support/${req.id}`, undefined, req.token)).json;
    const m = v.messages.filter(x => x.sender === 'staff').at(-1);
    assert.equal(m.text, 'Your bag is at belt 7');
    assert.equal(m.english, true);
  });

  test('the passenger replies; staff see it waiting again; closing ends the conversation for both', async () => {
    const after = (await P(`/api/support/${req.id}/messages`, { message: 'धन्यवाद, मैं इंतज़ार कर रहा हूँ' }, req.token)).json;
    assert.equal(after.messages.at(-1).sender, 'passenger');
    assert.ok((await s.get('/api/staff/support')).json.items.find(i => i.id === req.id).waitingSince);
    assert.equal((await P(`/api/support/${req.id}/messages`, { message: 'hi' }, 'bad')).status, 404);
    assert.equal((await s.post(`/api/staff/support/${req.id}/close`)).json.status, 'closed');
    const v = (await P(`/api/support/${req.id}`, undefined, req.token)).json;
    assert.equal(v.status, 'closed');
    assert.equal((await P(`/api/support/${req.id}/messages`, { message: 'hello?' }, req.token)).status, 409);
    assert.ok(!(await s.get('/api/staff/support')).json.items.some(i => i.id === req.id), 'closed requests leave the active list');
    assert.ok((await s.get('/api/staff/support?status=closed')).json.items.some(i => i.id === req.id));
    const audit = (await (await A.login(...DEMO.admin)).get('/api/admin/audit')).json.items;
    assert.ok(audit.some(a => a.action === 'support.claim') && audit.some(a => a.action === 'support.close'));
  });

  test('a passenger can close their own request', async () => {
    const r = (await A.post('/api/support', { message: 'Where can I pray?', lang: 'en' })).json;
    assert.equal((await P(`/api/support/${r.id}/close`, {}, r.token)).json.status, 'closed');
  });

  test('old requests are deleted automatically', async () => {
    const r = (await A.post('/api/support', { message: 'old one', lang: 'en' })).json;
    A.app.db.run('UPDATE support_requests SET updated_at = ? WHERE id = ?', Date.now() - 10 * 86400e3, r.id);
    assert.ok(purgeSupport(A.app.db, 7) >= 1);
    assert.equal((await P(`/api/support/${r.id}`, undefined, r.token)).status, 404);
    assert.equal(A.app.db.get('SELECT COUNT(*) n FROM support_messages WHERE request_id = ?', r.id).n, 0);
  });
});

test('with a translation service connected, messages are translated both ways', async () => {
  const lt = await startMock({
    'GET /languages': () => [{ code: 'en' }, { code: 'ar' }],
    'POST /translate': ({ body }) => ({ translatedText: `[${body.target}] ${body.q}` }),
  });
  const A = await startApp();
  try {
    const ad = await A.login(...DEMO.admin);
    assert.equal((await connectIntegration(ad, 'translation', 'libretranslate', { baseUrl: lt.url })).status, 'connected');
    const r = (await A.post('/api/support', { message: 'أين حقيبتي؟', lang: 'ar' })).json;
    const s = await A.login(...DEMO.staff);
    let d;
    for (let i = 0; i < 40; i++) { d = (await s.get(`/api/staff/support/${r.id}`)).json; if (d.messages[0].translated) break; await new Promise(res => setTimeout(res, 50)); } // translated in the background
    assert.equal(d.messages[0].translated, '[en] أين حقيبتي؟', 'staff read the passenger in English');
    await s.post(`/api/staff/support/${r.id}/messages`, { message: 'Belt 7' });
    const v = (await A.req('GET', `/api/support/${r.id}`, undefined, { headers: { 'X-Support-Token': r.token } })).json;
    const m = v.messages.find(x => x.sender === 'staff');
    assert.equal(m.text, '[ar] Belt 7', 'passenger reads staff in Arabic');
    assert.equal(m.machine, true);
  } finally { await A.close(); await lt.close(); }
});

test('new help requests are rate-limited per device', async () => {
  const A = await startApp({ rateScale: 1 });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await A.post('/api/support', { message: `help ${i}`, lang: 'en' })).status, 200);
    assert.equal((await A.post('/api/support', { message: 'help 6', lang: 'en' })).status, 429);
  } finally { await A.close(); }
});
