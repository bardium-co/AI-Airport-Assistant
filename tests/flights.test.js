import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../server/db.js';
import { seed } from '../server/seed.js';
import { FlightService, _internals } from '../server/services/flights.js';
import { startApp, startMock, connectIntegration, DEMO } from './helpers.js';

const pad = n => String(n).padStart(2, '0');
const adbUtc = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
const labsUtc = d => adbUtc(d).replace('Z', '');
const inMin = m => new Date(Math.floor(Date.now() / 60000) * 60000 + m * 60000);

test('provider time formats are parsed exactly (AeroDataBox "…Z", AirLabs UTC without zone)', () => {
  assert.equal(_internals.iso('2026-11-05 10:30Z'), '2026-11-05T10:30:00.000Z');
  assert.equal(_internals.iso('2026-11-05 23:53'), '2026-11-05T23:53:00.000Z');
  assert.equal(_internals.iso('2026-11-05T10:30:00+03:00'), '2026-11-05T07:30:00.000Z');
  assert.equal(_internals.iso('garbage'), null);
  assert.equal(_internals.iso(null), null);
});

function adbMock(state) {
  return startMock({
    'GET /airports/iata/:code': ({ headers, params }) => (headers['x-api-key'] === 'adb-key' ? { iata: params[0], name: 'Hamad International' } : { status: 401, json: {} }),
    'GET /flights/airports/iata/:code': ({ headers, url }) => {
      state.boardCalls++;
      if (headers['x-api-key'] !== 'adb-key') return { status: 401, json: {} };
      if (state.fail) return { status: 503, json: {} };
      assert.equal(url.searchParams.get('direction'), 'Departure');
      return { departures: [
        { number: 'QR 572', status: 'Boarding', airline: { name: 'Qatar Airways', iata: 'QR' },
          departure: { airport: { iata: 'DOH' }, scheduledTime: { utc: adbUtc(inMin(50)) }, revisedTime: { utc: adbUtc(inMin(65)) }, terminal: '1', gate: 'c12' },
          arrival: { airport: { iata: 'DEL', name: 'Delhi Indira Gandhi', municipalityName: 'New Delhi' } } },
        { number: 'EK 848', status: 'Expected', airline: { name: 'Emirates', iata: 'EK' },
          movement: { airport: { iata: 'DXB', municipalityName: 'Dubai' }, scheduledTime: { utc: adbUtc(inMin(20)) }, gate: null } },
        { number: 'QR 1', status: 'Canceled', airline: { name: 'Qatar Airways' },
          departure: { airport: { iata: 'DOH' }, scheduledTime: { utc: adbUtc(inMin(90)) } }, arrival: { airport: { iata: 'LHR', municipalityName: 'London' } } },
        { number: 'QR 2', status: 'Departed', departure: { airport: { iata: 'DOH' }, scheduledTime: { utc: adbUtc(inMin(-120)) } }, arrival: { airport: { iata: 'LHR' } } },
        { number: 'NOT A FLIGHT', departure: { scheduledTime: { utc: adbUtc(inMin(30)) } } },
      ] };
    },
    'GET /flights/number/:no/:date': ({ params }) => {
      state.flightCalls++;
      assert.match(params[1], /^\d{4}-\d{2}-\d{2}$/);
      if (params[0] === 'QR8') return [{ number: 'QR 8', status: 'Delayed', airline: { name: 'Qatar Airways' },
        departure: { airport: { iata: 'DOH' }, scheduledTime: { utc: adbUtc(inMin(200)) }, gate: 'A5' }, arrival: { airport: { iata: 'LHR', municipalityName: 'London' } } }];
      if (params[0] === 'QR9') return [{ number: 'QR 9', departure: { airport: { iata: 'LHR' }, scheduledTime: { utc: adbUtc(inMin(30)) } }, arrival: { airport: { iata: 'DOH' } } }];
      return { status: 404, json: {} };
    },
  });
}

describe('AeroDataBox (licensed API) — live departures and lookups', () => {
  let A, mock;
  const st = { boardCalls: 0, flightCalls: 0, fail: false };
  before(async () => { mock = await adbMock(st); A = await startApp(); });
  after(async () => { await A.close(); await mock.close(); });

  test('needs authorisation + a passing key test before anything is shown as live', async () => {
    const ad = await A.login(...DEMO.admin);
    await ad.put('/api/admin/integrations/flights', { provider: 'aerodatabox', config: { apiKey: 'wrong', baseUrl: mock.url }, enabled: true, authorised: true });
    const bad = (await ad.post('/api/admin/integrations/flights/test')).json;
    assert.equal(bad.status, 'error');
    assert.match(bad.statusDetail ?? bad.status_detail ?? JSON.stringify(bad), /401|rejected/);
    assert.equal((await A.get('/api/flights')).json.source, 'simulated', 'falls back only to the labelled demo table');
    assert.equal((await ad.put('/api/admin/integrations/flights', { provider: 'aerodatabox', config: { gateway: 'carrier-pigeon' } })).status, 400);
    assert.equal((await ad.put('/api/admin/integrations/flights', { provider: 'aerodatabox', config: { airport: 'DOHA' } })).status, 400);
    const ok = await connectIntegration(ad, 'flights', 'aerodatabox', { apiKey: 'adb-key', gateway: 'direct', airport: 'doh', baseUrl: mock.url });
    assert.equal(ok.status, 'connected');
    assert.equal(ok.config.apiKey.startsWith('••••'), true, 'key never returned in clear');
  });

  test('departures board: real fields mapped, codes normalised, past flights hidden, cached', async () => {
    const r = (await A.get('/api/flights?lang=hi')).json;
    assert.equal(r.source, 'live');
    assert.equal(r.provider.label, 'AeroDataBox');
    const qr = r.flights.find(f => f.flightNo === 'QR572');
    assert.equal(qr.gate, 'C12');
    assert.equal(qr.gateLocationId, 'GATE_C12');
    assert.equal(qr.status, 'boarding');
    assert.equal(qr.statusLabel, 'बोर्डिंग जारी');
    assert.equal(qr.destination, 'New Delhi');
    assert.equal(qr.terminal, '1');
    assert.ok(Date.parse(qr.estimatedDeparture) > Date.parse(qr.scheduledDeparture));
    assert.equal(qr.simulated, false);
    const ek = r.flights.find(f => f.flightNo === 'EK848');
    assert.equal(ek.destination, 'Dubai', 'FIDS "movement" shape understood');
    assert.equal(ek.gate, null);
    assert.equal(r.flights.find(f => f.flightNo === 'QR1').status, 'cancelled');
    assert.ok(!r.flights.some(f => f.flightNo === 'QR2'), 'departed 2 h ago → hidden');
    assert.ok(!r.flights.some(f => !f.flightNo));
    assert.deepEqual(r.flights.map(f => f.flightNo), [...r.flights].sort((a, b) => Date.parse(a.estimatedDeparture ?? a.scheduledDeparture) - Date.parse(b.estimatedDeparture ?? b.scheduledDeparture)).map(f => f.flightNo));
    const calls = st.boardCalls;
    await A.get('/api/flights');
    assert.equal(st.boardCalls, calls, 'served from cache — protects the paid quota');
  });

  test('lookups use the cached board first, then the single-flight endpoint; never simulated data', async () => {
    const before = st.flightCalls;
    const qr = (await A.get('/api/flights/QR572')).json;
    assert.equal(qr.status, 'found');
    assert.equal(qr.flight.gate, 'C12');
    assert.equal(st.flightCalls, before, 'answered from the board');
    const qr8 = (await A.get('/api/flights/QR8')).json;
    assert.equal(qr8.flight.gate, 'A5');
    assert.equal(qr8.flight.status, 'delayed');
    assert.equal(st.flightCalls, before + 1);
    await A.get('/api/flights/QR8');
    assert.equal(st.flightCalls, before + 1, 'single-flight answers are cached too');
    assert.equal((await A.get('/api/flights/QR9')).json.status, 'not_found', 'an arrival into DOH is not a departure');
    assert.equal((await A.get('/api/flights/QR600')).json.status, 'not_found', 'simulated QR600 is never mixed in');
    const chat = (await A.post('/api/assistant/chat', { message: 'QR 572 gate?', lang: 'en' })).json;
    assert.match(chat.text, /gate C12/);
    assert.ok(!/SIMULATED/.test(chat.text));
    const card = chat.cards.find(c => c.type === 'flight');
    assert.equal(card.provider, 'AeroDataBox');
    assert.equal(card.route.path.at(-1), 'GATE_C12');
  });
});

describe('AirLabs (licensed API)', () => {
  test('schedules mapped; codeshare duplicates dropped; delays detected; key test via /ping', async () => {
    const mock = await startMock({
      'GET /ping': ({ url }) => (url.searchParams.get('api_key') === 'labs-key' ? { response: { pong: true } } : { error: { code: 'unknown_api_key', message: 'Unknown API key' } }),
      'GET /schedules': ({ url }) => {
        assert.equal(url.searchParams.get('dep_iata'), 'DOH');
        return { response: [
          { flight_iata: 'QR572', airline_iata: 'QR', dep_iata: 'DOH', dep_terminal: '1', dep_gate: 'C12', dep_time_utc: labsUtc(inMin(40)), dep_estimated_utc: labsUtc(inMin(60)), dep_delayed: 20, arr_iata: 'DEL', status: 'scheduled' },
          { flight_iata: 'BA6342', airline_iata: 'BA', cs_flight_iata: 'QR572', dep_iata: 'DOH', dep_gate: 'C12', dep_time_utc: labsUtc(inMin(40)), arr_iata: 'DEL', status: 'scheduled' },
          { flight_iata: 'QR8', airline_iata: 'QR', dep_iata: 'DOH', dep_time_utc: labsUtc(inMin(15)), arr_iata: 'LHR', status: 'active' },
        ] };
      },
      'GET /flight': () => ({ error: { code: 'not_found', message: 'Flight not found' } }),
    });
    const A = await startApp();
    try {
      const ad = await A.login(...DEMO.admin);
      await ad.put('/api/admin/integrations/flights', { provider: 'airlabs', config: { apiKey: 'nope', baseUrl: mock.url }, enabled: true, authorised: true });
      assert.equal((await ad.post('/api/admin/integrations/flights/test')).json.status, 'error');
      assert.equal((await connectIntegration(ad, 'flights', 'airlabs', { apiKey: 'labs-key', baseUrl: mock.url })).status, 'connected');
      const r = (await A.get('/api/flights')).json;
      assert.equal(r.provider.label, 'AirLabs');
      assert.deepEqual(r.flights.map(f => f.flightNo).sort(), ['QR572', 'QR8']);
      const qr = r.flights.find(f => f.flightNo === 'QR572');
      assert.equal(qr.status, 'delayed');
      assert.equal(qr.airline, 'Qatar Airways');
      assert.equal(qr.destination, 'New Delhi', 'city from the built-in airport list (AirLabs gives codes only)');
      assert.equal(r.flights.find(f => f.flightNo === 'QR8').status, 'departed');
      assert.equal((await A.get('/api/flights/QR999')).json.status, 'not_found');
    } finally { await A.close(); await mock.close(); }
  });
});

test('outages: a recent board is shown as stale (with its age), an old one is never shown', async () => {
  const st = { boardCalls: 0, flightCalls: 0, fail: false };
  const mock = await adbMock(st);
  const db = new Db(':memory:');
  await seed(db, { demoMode: true }, () => {});
  const integrations = { active: id => (id === 'flights' ? { provider: 'aerodatabox', config: { apiKey: 'adb-key', baseUrl: mock.url } } : null) };
  const fs = new FlightService(db, integrations);
  try {
    const t0 = Date.now();
    const ok = await fs.departures(t0);
    assert.ok(ok.flights.length && !ok.stale);
    st.fail = true;
    const stale = await fs.departures(t0 + 5 * 60000);
    assert.equal(stale.stale, true);
    assert.match(stale.error, /503/);
    assert.ok(stale.flights.length, 'last good board, clearly marked stale');
    const gone = await fs.departures(t0 + 20 * 60000);
    assert.equal(gone.flights.length, 0, 'older than 15 minutes → not shown');
    assert.ok(gone.error);
    const look = await fs.lookup('QR8', t0 + 20 * 60000);
    assert.equal(look.status, 'found', 'single-flight endpoint still works during a board outage');
  } finally { await mock.close(); }
});

// ---- AirLabs free plan: only flight_iata, airline_iata, flight_number, dep_iata, dep_time (local), arr_iata, arr_time
const qatarLocal = d => { const q = new Date(d.getTime() + 3 * 3600e3); return labsUtc(q); }; // Qatar = UTC+3, no DST

function airlabsFreeMock(state) {
  const page = (from, n) => Array.from({ length: n }, (_, i) => {
    const k = from + i;
    return { flight_iata: `QR${1000 + k}`, airline_iata: 'QR', flight_number: String(1000 + k), dep_iata: 'DOH', dep_time: qatarLocal(inMin(20 + k)), arr_iata: k === 0 ? 'DEL' : k === 1 ? 'XYZ' : 'LHR', arr_time: qatarLocal(inMin(300 + k)) };
  });
  return startMock({
    'GET /ping': () => ({ response: { pong: true } }),
    'GET /schedules': ({ url }) => {
      state.calls++;
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return offset === 0 ? { request: { has_more: true }, response: page(0, 50) } : { request: { has_more: false }, response: page(50, 10) };
    },
    'GET /flight': ({ url }) => { state.calls++; return url.searchParams.get('flight_iata') === 'QR8' ? { response: { flight_iata: 'QR8', airline_iata: 'QR', dep_iata: 'DOH', dep_time: qatarLocal(inMin(90)), arr_iata: 'LHR' } } : { error: { code: 'not_found', message: 'Not found' } }; },
  });
}

test('local airport times are converted with the airport time zone', () => {
  assert.equal(_internals.localToIso('2026-11-05 12:30', 'Asia/Qatar'), '2026-11-05T09:30:00.000Z');
  assert.equal(_internals.localToIso('2026-07-01 12:00', 'Europe/London'), '2026-07-01T11:00:00.000Z', 'DST zones handled');
  assert.equal(_internals.localToIso('nonsense'), null);
});

describe('AirLabs free plan (codes, local times, no gates/status)', () => {
  test('connection test reports exactly what the plan returns; board pages, maps cities, never guesses gate or status', async () => {
    const st = { calls: 0 };
    const mock = await airlabsFreeMock(st);
    const A = await startApp();
    try {
      const ad = await A.login(...DEMO.admin);
      assert.equal((await ad.put('/api/admin/integrations/flights', { provider: 'airlabs', config: { maxPages: 'lots' } })).status, 400);
      const t = await connectIntegration(ad, 'flights', 'airlabs', { apiKey: 'free-key', baseUrl: mock.url, maxPages: '2', dailyBudget: '40' });
      assert.equal(t.status, 'connected');
      assert.match(t.statusDetail ?? t.status_detail ?? JSON.stringify(t), /gates NO, status NO/);
      const r = (await A.get('/api/flights?lang=en')).json;
      assert.equal(r.flights.length, 60, 'two pages of 50 + 10');
      const first = r.flights.find(f => f.flightNo === 'QR1000');
      assert.equal(first.destination, 'New Delhi', 'city from the built-in airport list');
      assert.equal(r.flights.find(f => f.flightNo === 'QR1001').destination, 'XYZ', 'unknown codes are shown as codes');
      assert.equal(first.gate, null);
      assert.equal(first.status, null);
      assert.equal(first.statusLabel, '—', 'unknown status is never shown as "Scheduled"');
      assert.ok(Math.abs(Date.parse(first.scheduledDeparture) - inMin(20).getTime()) < 60e3, 'local DOH time converted to UTC correctly');
      const chat = (await A.post('/api/assistant/chat', { message: 'QR 1000', lang: 'en' })).json;
      assert.match(chat.text, /not been assigned yet/, 'no gate → honest "check the screens" answer');
      assert.ok(!/Status:/.test(chat.text));
    } finally { await A.close(); await mock.close(); }
  });

  test('daily request budget spreads refreshes and is never exceeded', async () => {
    const st = { calls: 0 };
    const mock = await airlabsFreeMock(st);
    const db = new Db(':memory:');
    await seed(db, { demoMode: true }, () => {});
    const live = { provider: 'airlabs', config: { apiKey: 'k', baseUrl: mock.url, maxPages: '2', dailyBudget: '3' } };
    const fs = new FlightService(db, { active: id => (id === 'flights' ? live : null) });
    try {
      assert.equal(fs.ttl(live), Math.ceil(86400 * 2 / (3 * 0.8)) * 1000, 'refresh interval stretched to fit the budget');
      const t0 = Date.now();
      assert.equal((await fs.departures(t0)).flights.length, 60);
      assert.equal(st.calls, 2);
      await fs.departures(t0 + 3600e3);
      assert.equal(st.calls, 2, 'still within the stretched cache window');
      assert.equal((await fs.lookup('QR8', t0)).status, 'found');
      assert.equal(st.calls, 3);
      const over = await fs.lookup('QR9', t0);
      assert.equal(over.status, 'error');
      assert.match(over.detail, /budget reached/);
      assert.equal(st.calls, 3, 'no request sent once the budget is used');
      assert.equal(fs.usage(t0).n, 3);
      assert.equal((await fs.lookup('QR1005', t0)).status, 'found', 'flights on the cached board still answer');
    } finally { await mock.close(); }
  });
});
