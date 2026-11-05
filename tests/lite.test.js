import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiteApp, parseAccounts } from '../server/lite/app.js';
import { MemoryStore } from '../server/lite/support.js';

const ENV = { STAFF_ACCOUNTS: 'anna:Correct-Horse-9:Anna K;omar:Another-Pass-77:Omar S', SESSION_SECRET: 'x'.repeat(32) };

async function boot(env = ENV, store = new MemoryStore()) {
  const app = await createLiteApp({ env, store, secureCookies: false });
  const call = async (method, path, { body, cookie, csrf, headers = {} } = {}) => {
    const u = new URL(path, 'http://x');
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    const r = await app.handleApi({ method, pathname: u.pathname, query: u.searchParams, headers: h, rawBody: body === undefined ? '' : JSON.stringify(body), ip: '1.2.3.4' });
    return { status: r.status, json: r.body, headers: r.headers };
  };
  const login = async (user, pass) => {
    const r = await call('POST', '/api/auth/login', { body: { username: user, password: pass } });
    if (r.status !== 200) throw new Error(`login ${r.status} ${JSON.stringify(r.json)}`);
    const s = { cookie: r.headers['Set-Cookie'].split(';')[0], csrf: r.json.csrf };
    return { get: p => call('GET', p, s), post: (p, b) => call('POST', p, { ...s, body: b ?? {} }), user: r.json.user };
  };
  return { app, call, login, store };
}

test('accounts: JSON and simple formats; short passwords are rejected', () => {
  assert.equal(parseAccounts(ENV.STAFF_ACCOUNTS).length, 2);
  assert.equal(parseAccounts('[{"u":"Bo","p":"longenough1","n":"Bo B"}]')[0].username, 'bo');
  assert.equal(parseAccounts('bad:short:X').length, 0);
  assert.equal(parseAccounts(undefined).length, 0);
});

test('passenger features work with no server database: meta, chat in Hindi, map, route, flights are labelled simulated', async () => {
  const { call, app } = await boot();
  try {
    const meta = (await call('GET', '/api/meta')).json;
    assert.equal(meta.lite, true);
    assert.deepEqual(meta.demoAccounts, [], 'no public demo passwords');
    assert.ok(meta.languages.length >= 50);
    const chat = await call('POST', '/api/assistant/chat', { body: { message: 'मुझे नमाज़ पढ़नी है, कहाँ जाऊँ?', lang: 'hi' } });
    assert.equal(chat.json.intent, 'place_prayer');
    assert.equal((await call('POST', '/api/assistant/chat', { body: { message: 'where is the lounge', lang: 'en', from: 'PLAZA' } })).status, 200);
    assert.ok((await call('GET', '/api/map')).json.locations.length > 50);
    const board = (await call('GET', '/api/flights')).json;
    assert.equal(board.source, 'simulated');
    assert.ok(board.flights.every(f => f.simulated));
    assert.equal((await call('GET', '/api/faqs?lang=ar')).status, 200);
  } finally { app.close(); }
});

test('admin and case routes are not part of the Lite edition', async () => {
  const { call, app } = await boot();
  try {
    for (const p of ['/api/admin/users', '/api/staff/cases', '/api/speech/transcribe']) assert.equal((await call('GET', p)).status, 404, p);
  } finally { app.close(); }
});

test('staff sign-in: wrong password rejected, signed cookie works, CSRF is enforced, tampering is detected', async () => {
  const { call, login, app } = await boot();
  try {
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'anna', password: 'nope-nope-nope' } })).status, 401);
    assert.equal((await call('GET', '/api/staff/support')).status, 401, 'needs sign-in');
    const s = await login('ANNA', 'Correct-Horse-9'); // user names are case-insensitive
    assert.equal(s.user.displayName, 'Anna K');
    assert.equal((await s.get('/api/staff/support')).status, 200);
    const cookie = (await call('POST', '/api/auth/login', { body: { username: 'anna', password: 'Correct-Horse-9' } })).headers['Set-Cookie'].split(';')[0];
    assert.equal((await call('POST', '/api/staff/translate', { cookie, body: { text: 'x', from: 'en', to: 'ar' } })).status, 403, 'CSRF token required');
    const forged = cookie.replace(/\.[^.]+$/, '.AAAA');
    assert.equal((await call('GET', '/api/staff/support', { cookie: forged })).status, 401, 'forged signature');
    const me = await call('GET', '/api/auth/me', { cookie });
    assert.equal(me.json.user.username, 'anna');
  } finally { app.close(); }
});

test('without STAFF_ACCOUNTS nobody can sign in, and the message says why', async () => {
  const { call, app } = await boot({});
  try {
    const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'Admin#2026demo' } });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /STAFF_ACCOUNTS/);
  } finally { app.close(); }
});

test('passenger → staff messages survive across separate function containers (state is in the store)', async () => {
  const store = new MemoryStore();
  const A = await boot(ENV, store);
  const B = await boot(ENV, store); // a second, cold container sharing the same store
  try {
    const r = (await A.call('POST', '/api/support', { body: { message: 'मेरा बैग नहीं मिल रहा', lang: 'hi', from: 'PLAZA', flightNo: 'qr 572' } })).json;
    assert.match(r.code, /^H-/);
    const anna = await B.login('anna', 'Correct-Horse-9');
    const list = (await anna.get('/api/staff/support')).json;
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].langName, 'Hindi');
    assert.equal(list.items[0].flightNo, 'QR572');
    assert.equal(list.counts.open, 1);
    // only the passenger's token opens the passenger view
    assert.equal((await A.call('GET', `/api/support/${r.id}`, { headers: { 'x-support-token': 'wrong' } })).status, 404);
    // staff replies with a reviewed quick reply, translated
    const detail = (await anna.get(`/api/staff/support/${r.id}`)).json;
    const phrase = detail.phrases.find(p => p.local);
    assert.equal((await anna.post(`/api/staff/support/${r.id}/messages`, { phrase: phrase.id })).json.localized, true);
    const v = (await A.call('GET', `/api/support/${r.id}`, { headers: { 'x-support-token': r.token } })).json;
    const staffMsg = v.messages.find(m => m.sender === 'staff');
    assert.equal(staffMsg.text, phrase.local, 'passenger reads it in Hindi');
    assert.equal(staffMsg.english, false);
    assert.equal(v.status, 'claimed');
    // another staff member sees who is handling it; passenger writes again → waiting again
    await A.call('POST', `/api/support/${r.id}/messages`, { headers: { 'x-support-token': r.token }, body: { message: 'धन्यवाद' } });
    const omar = await B.login('omar', 'Another-Pass-77');
    const d2 = (await omar.get(`/api/staff/support/${r.id}`)).json;
    assert.equal(d2.claimedBy, 'Anna K');
    assert.ok(d2.waitingSince);
    assert.deepEqual(d2.messages.map(m => m.sender), ['passenger', 'staff', 'passenger']);
    // closing ends it for both
    await omar.post(`/api/staff/support/${r.id}/close`);
    assert.equal((await A.call('POST', `/api/support/${r.id}/messages`, { headers: { 'x-support-token': r.token }, body: { message: 'hi' } })).status, 409);
    assert.equal((await anna.get('/api/staff/support?status=closed')).json.items.length, 1);
    assert.equal((await anna.get('/api/staff/support')).json.items.length, 0);
  } finally { A.app.close(); B.app.close(); }
});

test('old requests are deleted automatically', async () => {
  const store = new MemoryStore();
  const A = await boot(ENV, store);
  try {
    const r = (await A.call('POST', '/api/support', { body: { message: 'help', lang: 'en' } })).json;
    const rec = await store.get(`r/${r.id}`);
    rec.updatedAt = Date.now() - 9 * 86400e3;
    await store.set(`r/${r.id}`, rec);
    const anna = await A.login('anna', 'Correct-Horse-9');
    await anna.get('/api/staff/support'); // triggers the hourly clean-up
    await new Promise(res => setTimeout(res, 100));
    assert.equal((await store.list('r/')).length, 0);
    assert.equal((await store.list('m/')).length, 0);
  } finally { A.app.close(); }
});

test('new help requests are rate-limited per device', async () => {
  const { call, app } = await boot();
  try {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call('POST', '/api/support', { body: { message: 'help ' + i } })).status);
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(codes[6], 429);
  } finally { app.close(); }
});
