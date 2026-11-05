import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../server/db.js';
import { seed, buildMap } from '../server/seed.js';
import { MapService } from '../server/services/maps.js';
import { evaluateLounge, rankLounges, isOpenNow, validateProfile } from '../server/services/eligibility.js';
import { loungeView } from '../server/services/assistant.js';

async function fresh() {
  const db = new Db(':memory:');
  await seed(db, { demoMode: true }, () => {});
  return { db, maps: new MapService(db) };
}

test('seeded map is a single connected graph — every location reachable from the central plaza', async () => {
  const { db, maps } = await fresh();
  const dist = maps.distancesFrom('PLAZA');
  const all = db.all('SELECT id FROM locations');
  assert.ok(all.length > 100);
  for (const { id } of all) assert.ok(dist.has(id), `${id} unreachable`);
});

test('every location and lounge is marked simulated in the seed', async () => {
  const { db } = await fresh();
  assert.equal(db.get('SELECT COUNT(*) n FROM locations WHERE simulated = 0').n, 0);
  assert.equal(db.get('SELECT COUNT(*) n FROM lounges WHERE simulated = 0').n, 0);
});

test('gate counts per concourse (approximate layout from public information)', () => {
  const { locs } = buildMap();
  const count = c => locs.filter(l => l.type === 'gate' && l.concourse === c).length;
  // D = 9 and E = 8 contact gates (press reports, March 2025); C31 is referenced on official HIA pages.
  assert.deepEqual(['A', 'B', 'C', 'D', 'E'].map(count), [10, 10, 31, 9, 8]);
  for (const l of locs) assert.ok(l.notes && /approximate/i.test(l.notes) || l.type === 'junction', `${l.id} must say it is approximate`);
});

test('approximate map stays inside the drawing area and every place is reachable', async () => {
  const { MAP_W, MAP_H } = await import('../server/seed.js');
  const { locs } = buildMap();
  for (const l of locs) assert.ok(l.x >= 0 && l.x <= MAP_W && l.y >= 0 && l.y <= MAP_H, l.id);
  const { maps } = await fresh();
  const reach = maps.distancesFrom('PLAZA');
  for (const l of locs) assert.ok(reach.has(l.id), `${l.id} unreachable`);
  const stepFree = maps.distancesFrom('PLAZA', { stepFree: true });
  for (const l of locs.filter(x => x.type === 'gate' || x.type === 'lounge')) assert.ok(stepFree.has(l.id), `${l.id} not reachable step-free`);
});

test('official landmarks are where the airport website says', async () => {
  const { maps } = await fresh();
  const near = (a, b, max) => assert.ok(maps.route(a, b).meters <= max, `${a} → ${b}`);
  near('LOUNGE_GOLD_S', 'GATE_A1', 250);   // "entrance near Gate A1"
  near('LOUNGE_SILVER', 'GATE_B1', 250);   // "near Gate B1"
  near('FAMILY_MUZN', 'GATE_C8', 200);     // "between gates C7 and C9"
  near('SLEEP_N', 'GATE_C31', 250);        // "opposite Gates C30/C31"
  near('SHUTTLE_E', 'GATE_E1', 200);       // "near Gate E1"
  assert.equal(maps.location('WELLNESS_S').level, '4'); // 4th floor of the Oryx Airport Hotel
});

test('the passenger train is used for long trips and reported in the route', async () => {
  const { maps } = await fresh();
  const far = maps.route('GATE_A1', 'GATE_E8');
  assert.ok(far.path.includes('TRAIN_S') && far.path.includes('TRAIN_N'));
  assert.equal(far.train, true);
  assert.ok(far.steps.some(s => s.via === 'train'));
  const near = maps.route('PLAZA', 'GATE_C3');
  assert.equal(near.train, false, 'short trips walk');
  assert.ok(far.minutes < 30, `A1→E8 ${far.minutes} min`);
});

test('shortest route is optimal and symmetric', async () => {
  const { maps } = await fresh();
  const ab = maps.route('GATE_A1', 'GATE_E8');
  const ba = maps.route('GATE_E8', 'GATE_A1');
  assert.equal(ab.meters, ba.meters);
  assert.equal(ab.path[0], 'GATE_A1');
  assert.equal(ab.path.at(-1), 'GATE_E8');
  // Triangle inequality (on routing cost) via the plaza.
  const viaPlaza = maps.route('GATE_A1', 'PLAZA').cost + maps.route('PLAZA', 'GATE_E8').cost;
  assert.ok(ab.cost <= viaPlaza);
  assert.equal(maps.route('PLAZA', 'PLAZA').meters, 0);
});

test('step-free routing avoids escalators and is never shorter than the normal route', async () => {
  const { maps, db } = await fresh();
  const normal = maps.route('PLAZA', 'LOUNGE_MOURJAN_S');
  const sf = maps.route('PLAZA', 'LOUNGE_MOURJAN_S', { stepFree: true });
  assert.ok(normal.steps.some(s => s.via === 'escalator'));
  assert.ok(!sf.steps.some(s => s.via === 'escalator'));
  assert.ok(sf.steps.some(s => s.via === 'lift'));
  assert.ok(sf.meters >= normal.meters);
  assert.ok(sf.minutes >= normal.minutes, 'slower walking speed applied');
  const edges = db.all('SELECT * FROM edges WHERE step_free = 0');
  for (const e of edges) assert.ok(!sf.path.join('>').includes(`${e.a}>${e.b}`) && !sf.path.join('>').includes(`${e.b}>${e.a}`));
});

test('closed locations are not used as pass-through points but remain reachable', async () => {
  const { maps, db } = await fresh();
  const before = maps.route('PLAZA', 'GATE_C14');
  assert.ok(before.path.includes('S_C5'));
  db.run(`UPDATE locations SET status='closed' WHERE id='S_C5'`);
  maps.invalidate();
  const detour = maps.route('PLAZA', 'GATE_C14');
  assert.ok(detour && !detour.path.includes('S_C5'), 'routes around the closure (via the train)');
  assert.ok(detour.train);
  assert.ok(maps.route('PLAZA', 'S_C5'), 'closed node itself is reachable as a destination');
  db.run(`UPDATE locations SET status='closed' WHERE id='S_A3'`);
  maps.invalidate();
  assert.equal(maps.route('PLAZA', 'GATE_A9'), null, 'only path along the pier is blocked');
});

test('nearest facility picks the closest by walking distance', async () => {
  const { maps } = await fresh();
  const r = maps.nearest('GATE_A9', 'toilet');
  assert.equal(r.path.at(-1), 'TOILET_A8');
  const p = maps.nearest('GATE_E7', 'prayer');
  assert.equal(p.path.at(-1), 'PRAYER_E');
});

test('unknown endpoints return null rather than throwing', async () => {
  const { maps } = await fresh();
  assert.equal(maps.route('NOPE', 'PLAZA'), null);
  assert.equal(maps.nearest('NOPE', 'toilet'), null);
});

const L = async () => { const { db } = await fresh(); return Object.fromEntries(db.all('SELECT * FROM lounges').map(r => [r.id, loungeView(r)])); };

test('lounge eligibility matrix (provisional, always unverified)', async () => {
  const lg = await L();
  const ev = (id, p) => evaluateLounge(lg[id], p);
  // Business lounges: Business Class on QR / oneworld (official lounge pages); others may pre-book (ancillary).
  assert.equal(ev('L_MOURJAN_S', { carrier: 'QR', cabin: 'business' }).result, 'likely');
  assert.equal(ev('L_GARDEN', { carrier: 'ONEWORLD', cabin: 'business' }).result, 'likely');
  assert.equal(ev('L_MOURJAN_S', { carrier: 'QR', cabin: 'economy' }).result, 'paid_option');
  assert.equal(ev('L_MOURJAN_S', { carrier: 'OTHER', cabin: 'business' }).result, 'paid_option');
  // First lounge: First Class, or Platinum on a (full-fare) premium QR ticket.
  assert.equal(ev('L_SAFWA', { carrier: 'QR', cabin: 'first' }).result, 'likely');
  assert.equal(ev('L_SAFWA', { carrier: 'QR', cabin: 'business' }).result, 'paid_option');
  assert.equal(ev('L_SAFWA', { carrier: 'QR', cabin: 'business', tier: 'PC_PLATINUM' }).rule.reason, 'pc_platinum_full_fare');
  // Status lounges.
  assert.equal(ev('L_PC_PLAT', { carrier: 'QR', cabin: 'economy', tier: 'PC_PLATINUM' }).result, 'likely');
  assert.notEqual(ev('L_PC_PLAT', { carrier: 'QR', cabin: 'economy', tier: 'PC_GOLD' }).result, 'likely');
  assert.equal(ev('L_PC_GOLD', { carrier: 'QR', cabin: 'economy', tier: 'PC_GOLD' }).result, 'likely');
  assert.equal(ev('L_PG_NORTH', { carrier: 'ONEWORLD', cabin: 'economy', tier: 'OW_SAPPHIRE' }).result, 'likely');
  assert.notEqual(ev('L_PG_NORTH', { carrier: 'OTHER', cabin: 'economy', tier: 'OW_EMERALD' }).result, 'likely', 'status only counts on QR / oneworld flights');
  assert.equal(ev('L_PC_SILVER', { carrier: 'QR', cabin: 'economy', tier: 'PC_SILVER' }).result, 'likely');
  assert.notEqual(ev('L_PC_SILVER', { carrier: 'ONEWORLD', cabin: 'economy', tier: 'PC_SILVER' }).result, 'likely', 'Silver lounge: QR-operated only');
  // Al Maha: premium cabins on other airlines; walk-in purchase possible.
  assert.equal(ev('L_MAHA_S', { carrier: 'OTHER', cabin: 'business' }).result, 'likely');
  assert.equal(ev('L_MAHA_N', { carrier: 'OTHER', cabin: 'economy' }).result, 'paid_option');
  assert.equal(ev('L_MARINER', { carrier: 'QR', cabin: 'business' }).result, 'unlikely', 'seafarers only — staff decide');
  assert.equal(ev('L_MOURJAN_S', {}).result, 'unknown');
  for (const id of Object.keys(lg)) {
    const r = ev(id, { carrier: 'QR', cabin: 'first', tier: 'PC_PLATINUM' });
    assert.equal(r.verified, false);
    assert.equal(r.requiresVerification, true);
  }
});

test('lounge opening hours are never invented: unpublished hours are marked unconfirmed', async () => {
  const lg = await L();
  for (const l of Object.values(lg)) {
    assert.equal(l.hours.unknown, true, l.id);
    assert.equal(isOpenNow(l.hours), null, `${l.id} must not claim "open now"`);
    assert.ok(l.source_url.startsWith("https://dohahamadairport.com/lounge/"), `${l.id} cites its official page`);
  }
});

test('closed lounge is never recommended as eligible', async () => {
  const lg = await L();
  assert.equal(evaluateLounge({ ...lg.L_MOURJAN_S, status: 'closed' }, { carrier: 'QR', cabin: 'business' }).result, 'closed');
});

test('ranking puts likely-eligible first, then by walking distance', async () => {
  const { maps } = await fresh();
  const lg = Object.values(await L());
  const ranked = rankLounges(lg, { carrier: 'QR', cabin: 'business' }, maps.distancesFrom('GATE_C1'), 75);
  const firstNon = ranked.findIndex(l => l.eligibility.result !== 'likely');
  assert.ok(ranked.slice(0, firstNon).every(l => l.eligibility.result === 'likely'));
  const likely = ranked.slice(0, firstNon);
  for (let i = 1; i < likely.length; i++) assert.ok(likely[i - 1].meters <= likely[i].meters);
  assert.equal(likely[0].id, 'L_GARDEN', 'nearest eligible lounge to concourse C');
});

test('profile validation ignores unknown values', () => {
  assert.deepEqual(validateProfile({ carrier: 'EVIL', cabin: "'; DROP TABLE", tier: 'X' }), { carrier: null, cabin: null, tier: 'NONE' });
});

test('opening hours (including overnight windows) in Doha time', () => {
  const at = hhmm => Date.parse(`2026-11-05T${hhmm}:00+03:00`);
  assert.equal(isOpenNow({ always: true }, at('03:00')), true);
  assert.equal(isOpenNow({ open: '05:00', close: '23:00' }, at('04:59')), false);
  assert.equal(isOpenNow({ open: '05:00', close: '23:00' }, at('12:00')), true);
  assert.equal(isOpenNow({ open: '22:00', close: '06:00' }, at('01:00')), true);
  assert.equal(isOpenNow({ open: '22:00', close: '06:00' }, at('12:00')), false);
  assert.equal(isOpenNow({}, at('12:00')), null);
});

test('an untouched v1 database is upgraded to the v2 map; an admin-edited one is left alone', async () => {
  const { db } = await fresh();
  db.setSetting('map_seed_version', 1);
  db.run('DELETE FROM lounges'); db.run('DELETE FROM edges'); db.run('DELETE FROM locations');
  db.run("INSERT INTO locations(id,type,name,concourse,level,x,y,simulated,accessible,status,notes) VALUES('OLD','plaza','Old map',NULL,'1',1,1,1,1,'open',NULL)");
  const logs = [];
  await seed(db, { demoMode: true }, m => logs.push(m));
  assert.equal(db.get("SELECT COUNT(*) n FROM locations WHERE id = 'OLD'").n, 0);
  assert.ok(db.get("SELECT 1 FROM locations WHERE id = 'TRAIN_S'"));
  assert.ok(db.get("SELECT 1 FROM lounges WHERE id = 'L_PG_NORTH'"));
  assert.ok(logs.some(l => /upgraded to v2/.test(l)));

  db.setSetting('map_seed_version', 1);
  db.audit({ id: 1, username: 'admin' }, 'location.update', 'GATE_A1', {});
  db.run("UPDATE locations SET name = 'Admin edited' WHERE id = 'GATE_A1'");
  const logs2 = [];
  await seed(db, { demoMode: true }, m => logs2.push(m));
  assert.equal(db.get("SELECT name FROM locations WHERE id = 'GATE_A1'").name, 'Admin edited', 'admin edits are never overwritten');
  assert.ok(logs2.some(l => /not replaced/.test(l)));
  assert.equal(Number(db.getSetting('map_seed_version')), 2);
});

test('new help topics are added once to an existing database', async () => {
  const { db } = await fresh();
  const count = () => db.get('SELECT COUNT(*) n FROM faqs').n;
  const n = count();
  db.run("DELETE FROM faqs WHERE category = 'medical'");
  db.setSetting('faq_seed_version', 1);
  await seed(db, { demoMode: true }, () => {});
  assert.equal(count(), n, 're-added the missing v2 topic only');
  await seed(db, { demoMode: true }, () => {});
  assert.equal(count(), n, 'idempotent');
});
