import crypto from 'node:crypto';
import { LANGUAGE_META } from './services/phrases.js';
import { hashPassword } from './auth.js';

// ---------------------------------------------------------------------------------------------
// Approximate terminal map (seed v2).
// Built ONLY from facts stated in public text on dohahamadairport.com (checked 2026-11-05):
//  • Lamp Bear is in the South Plaza; Oryx Airport Hotel (with the Vitality Wellbeing & Fitness Centre on
//    its 4th floor) is next to it; Concourses A and B are "near Lamp Bear" (lounges near Gates A1 / B1).
//  • The ORCHARD is in the Central Concourse; Concourse C runs to the North Node (Oryx Garden Hotel,
//    C-gates food court, Sleepover opposite Gates C30/C31).
//  • A passenger train connects the South Plaza and the North Plaza; an information desk is on the
//    walkway leading to Concourses D & E; complimentary shuttle-buggy stops are in Concourse B (near
//    Lamp Bear) and Concourse E (near Gate E1).
//  • Transfer halls are at Concourses A, B, C and D; activity nodes (play areas): one each in A and B,
//    three in C; sensory room (Muzn) between Gates C7 and C9.
//  • Concourses D and E opened in 2025 with 9 and 8 contact gates (press reports, March 2025).
// Exact geometry, distances and most facility positions are NOT public: every position below is an
// approximation and is labelled as such. Replace with authorised indoor-map data before go-live.
// ---------------------------------------------------------------------------------------------
export const MAP_W = 1200;
export const MAP_H = 800;
export const MAP_SEED_VERSION = 2;
const SCALE_M = 1.9; // metres per map unit (approximate)
const HIA = 'https://dohahamadairport.com';
const HIA_TRANSFERS = 'https://www.dohahamadairport.com/airport-guide/at-the-airport/transfers';
const HIA_LOUNGES = `${HIA}/relax/lounges`;
const HIA_PRAYER = `${HIA}/airport-guide/facilities-services/prayer-rooms`;
const QR_TIERS = 'https://www.qatarairways.com/en/Privilege-Club/membership-tiers.html';
const QCREDITS_SRC = 'https://www.pointhacks.com.au/privilege-club/qcredits-free-upgrades/';
const VERIFIED_ON = '2026-11-05';
const APPROX = 'Approximate position based on public airport information — not an official map.';

const EXTRA_LANGS = [
  ['ne', 'Nepali', 'नेपाली', 'ne-NP', 0], ['ta', 'Tamil', 'தமிழ்', 'ta-IN', 0], ['si', 'Sinhala', 'සිංහල', 'si-LK', 0],
  ['fa', 'Persian', 'فارسی', 'fa-IR', 1], ['tr', 'Turkish', 'Türkçe', 'tr-TR', 0], ['id', 'Indonesian', 'Bahasa Indonesia', 'id-ID', 0],
  ['sw', 'Swahili', 'Kiswahili', 'sw-KE', 0], ['ja', 'Japanese', '日本語', 'ja-JP', 0], ['ko', 'Korean', '한국어', 'ko-KR', 0],
  ['it', 'Italian', 'Italiano', 'it-IT', 0], ['pt', 'Portuguese', 'Português', 'pt-PT', 0],
];

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) * SCALE_M; }

export function buildMap() {
  const locs = [];
  const edges = [];
  const index = new Map();
  const L = (id, type, name, x, y, extra = {}) => {
    const n = { id, type, name, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, concourse: null, level: '1', simulated: 1, accessible: 1, status: 'open', notes: APPROX, ...extra };
    locs.push(n); index.set(id, n); return n;
  };
  const byId = id => { const n = index.get(id); if (!n) throw new Error(`map seed: unknown ${id}`); return n; };
  const E = (a, b, kind = 'walk', stepFree = 1, extra = 0, fixed = null) =>
    edges.push({ a, b, kind, step_free: stepFree, distance_m: fixed ?? Math.round(dist(byId(a), byId(b)) + extra) });

  // Hubs
  L('PLAZA_S', 'plaza', 'South Plaza – Lamp Bear', 230, 400, { notes: 'Lamp Bear sculpture, duty free, Oryx Airport Hotel (official HIA pages). ' + APPROX });
  L('PLAZA', 'plaza', 'ORCHARD – Central Concourse', 370, 400, { notes: 'Indoor tropical garden in the Central Concourse (official HIA page). ' + APPROX });
  L('PLAZA_N', 'plaza', 'North Node', 970, 400, { notes: 'End of Concourse C: Oryx Garden Hotel, C-gates food court (official HIA pages). ' + APPROX });
  L('JUNCTION_A', 'junction', 'Concourse A entrance', 195, 365, { concourse: 'A' });
  L('JUNCTION_B', 'junction', 'Concourse B entrance', 195, 435, { concourse: 'B' });
  L('JUNCTION_DE', 'junction', 'Walkway to Concourses D & E', 1030, 400);
  E('PLAZA_S', 'PLAZA'); E('PLAZA_S', 'JUNCTION_A'); E('PLAZA_S', 'JUNCTION_B'); E('PLAZA_N', 'JUNCTION_DE');

  // Concourses: gates alternate sides of the walkway; `side` picks the side of odd-numbered gates.
  const conc = {};
  const pier = (c, root, [x1, y1], [x2, y2], n, side, gateOff = 26) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const px = -uy, py = ux;
    conc[c] = { px, py, side, n };
    let prev = root;
    for (let i = 1; i <= n; i++) {
      const f = (i - 0.5) / n;
      const sx = x1 + (x2 - x1) * f, sy = y1 + (y2 - y1) * f;
      const sid = `S_${c}${i}`;
      L(sid, 'junction', `Concourse ${c} walkway (near ${c}${i})`, sx, sy, { concourse: c });
      E(prev, sid);
      prev = sid;
      const s = (i % 2 ? 1 : -1) * side;
      L(`GATE_${c}${i}`, 'gate', `Gate ${c}${i}`, sx + px * gateOff * s, sy + py * gateOff * s, { concourse: c });
      E(sid, `GATE_${c}${i}`);
    }
    return prev;
  };
  pier('A', 'JUNCTION_A', [175, 340], [55, 62], 10, 1);
  pier('B', 'JUNCTION_B', [175, 460], [55, 738], 10, -1);
  const lastC = pier('C', 'PLAZA', [400, 400], [930, 400], 31, -1, 30);
  E(lastC, 'PLAZA_N');
  pier('D', 'JUNCTION_DE', [1055, 372], [1160, 70], 9, 1);
  pier('E', 'JUNCTION_DE', [1055, 428], [1160, 730], 8, -1);

  // Facility on the side of the walkway opposite the gate it is attached to.
  const fac = (id, type, name, attach, { off = 58, level = '1', kind = 'walk', extra = 0, notes } = {}) => {
    const a = byId(attach);
    const m = conc[a.concourse];
    const i = Number(attach.replace(/^S_[A-Z]/, ''));
    const s = -((i % 2 ? 1 : -1) * m.side);
    L(id, type, name, a.x + m.px * off * s, a.y + m.py * off * s, { concourse: a.concourse, level, ...(notes ? { notes } : {}) });
    E(attach, id, kind, kind === 'escalator' || kind === 'stairs' ? 0 : 1, extra);
  };
  // Facility at an explicit position, linked to a hub.
  const at = (id, type, name, x, y, attach, { level = '1', kind = 'walk', extra = 0, concourse = null, notes } = {}) => {
    L(id, type, name, x, y, { level, concourse, ...(notes ? { notes } : {}) });
    E(attach, id, kind, kind === 'escalator' || kind === 'stairs' ? 0 : 1, extra);
  };

  // ---- South Plaza (Lamp Bear) ----
  at('LIFT_S', 'lift', 'Lifts – South Plaza', 282, 400, 'PLAZA_S');
  at('TRANSFER_A', 'transfer', 'Transfer Hall A', 230, 328, 'PLAZA_S', { concourse: 'A', notes: 'Transfer halls are at Concourses A, B, C and D (official HIA page). ' + APPROX });
  at('TRANSFER_B', 'transfer', 'Transfer Hall B', 230, 472, 'PLAZA_S', { concourse: 'B', notes: 'Transfer halls are at Concourses A, B, C and D (official HIA page). ' + APPROX });
  at('INFO_S', 'info', 'Information desk – Lamp Bear (South Plaza)', 258, 255, 'PLAZA_S');
  at('TOILET_S', 'toilet', 'Toilets – South Plaza', 278, 292, 'PLAZA_S');
  at('PRAYER_S', 'prayer', 'Prayer room – South Plaza', 318, 318, 'PLAZA_S');
  at('FOOD_S', 'food', 'Cafés & restaurants – South Plaza', 318, 488, 'PLAZA_S');
  at('HOTEL_S', 'hotel', 'Oryx Airport Hotel (transit, South Plaza)', 112, 400, 'PLAZA_S',
    { notes: 'Official HIA page: inside the transit area at the South Plaza, next to Lamp Bear. ' + APPROX });
  at('WELLNESS_S', 'wellness', 'Vitality Wellbeing & Fitness Centre – gym, 25 m pool, spa, squash, showers', 66, 400, 'HOTEL_S',
    { level: '4', kind: 'lift', extra: 20, notes: 'Official HIA page: 4th floor of the Oryx Airport Hotel, open daily 06:00–02:00. ' + APPROX });
  at('SLEEP_S', 'sleep', 'Sleepover sleep pods – South Plaza (paid)', 160, 400, 'PLAZA_S',
    { notes: 'Official HIA page: about 2 minutes from Lamp Bear towards A and B gates, in the corridor between Fendi and Loro Piana. ' + APPROX });
  at('SHUTTLE_B', 'other', 'Complimentary shuttle buggy stop – Concourse B', 262, 540, 'JUNCTION_B',
    { concourse: 'B', notes: 'Official HIA page: shuttle buggies run about every 15 minutes between Concourse B (near Lamp Bear) and Concourse E (near Gate E1). ' + APPROX });
  // Passenger train (South Plaza ↔ North Plaza, official HIA page). Ride + typical wait is set in settings.
  at('TRAIN_S', 'other', 'Passenger train – South Plaza station', 230, 600, 'PLAZA_S', { notes: 'Official HIA page: train connects the South Plaza and North Plaza; carts and strollers are not permitted on the train. ' + APPROX });
  at('TRAIN_N', 'other', 'Passenger train – North Node station', 970, 600, 'PLAZA_N', { notes: 'Official HIA page: train connects the South Plaza and North Plaza; carts and strollers are not permitted on the train. ' + APPROX });
  edges.find(e => e.a === 'PLAZA_S' && e.b === 'TRAIN_S').distance_m = 120;
  edges.find(e => e.a === 'PLAZA_N' && e.b === 'TRAIN_N').distance_m = 120;
  E('TRAIN_S', 'TRAIN_N', 'train', 1, 0, 1100);

  // ---- ORCHARD (Central Concourse) ----
  at('LIFT_C', 'lift', 'Lifts – ORCHARD', 372, 340, 'PLAZA');
  at('TRANSFER_C', 'transfer', 'Transfer Hall C', 330, 350, 'PLAZA', { concourse: 'C', notes: 'Transfer halls are at Concourses A, B, C and D (official HIA page). ' + APPROX });
  at('INFO_PLAZA', 'info', 'Information desk – ORCHARD', 362, 458, 'PLAZA');
  at('TOILET_PLAZA', 'toilet', 'Toilets – ORCHARD', 318, 440, 'PLAZA');
  at('ASSIST_PLAZA', 'assistance', 'Special assistance lounge / desk – Central Concourse', 395, 490, 'PLAZA');
  at('FOOD_PLAZA', 'food', 'Restaurants & cafés – ORCHARD', 440, 492, 'PLAZA');

  // ---- North Node ----
  at('LIFT_N', 'lift', 'Lifts – North Node', 1000, 352, 'PLAZA_N');
  at('HOTEL_N', 'hotel', 'Oryx Garden Hotel (North Node)', 966, 330, 'PLAZA_N', { notes: 'Official HIA page: at the North Node, at the end of Concourse C. ' + APPROX });
  at('FOOD_N', 'food', 'C-gates food court – North Node', 1000, 532, 'PLAZA_N');
  at('TOILET_N', 'toilet', 'Toilets – North Node', 962, 472, 'PLAZA_N');
  at('INFO_DE', 'info', 'Information desk – walkway to Concourses D & E', 1080, 400, 'JUNCTION_DE');
  at('TRANSFER_D', 'transfer', 'Transfer Hall D', 1130, 400, 'JUNCTION_DE', { concourse: 'D', notes: 'Transfer halls are at Concourses A, B, C and D (official HIA page). ' + APPROX });

  // ---- Concourse facilities ----
  const C = (c, list) => list.forEach(([i, type, name, o]) => fac(`${type.toUpperCase()}_${c}${i}`, type, name.replace('{c}', c).replace('{i}', `${c}${i}`), `S_${c}${i}`, o));
  // A
  fac('INFO_A', 'info', 'Information desk – Concourse A', 'S_A7');
  fac('PRAYER_A', 'prayer', 'Prayer room – Concourse A', 'S_A4');
  fac('QUIET_A', 'quiet', 'Quiet room – Concourse A', 'S_A6');
  fac('SMOKING_A', 'smoking', 'Smoking room – Concourse A', 'S_A5');
  fac('FAMILY_A', 'family', 'Activity node (children’s play area) – Concourse A', 'S_A3');
  fac('FOOD_A', 'food', 'Café – Concourse A', 'S_A9');
  C('A', [[2, 'toilet', 'Toilets – Concourse {c} (near {i})'], [8, 'toilet', 'Toilets – Concourse {c} (near {i})']]);
  // B
  fac('INFO_B', 'info', 'Information desk – Concourse B', 'S_B7');
  fac('PRAYER_B', 'prayer', 'Prayer room – Concourse B', 'S_B4');
  fac('QUIET_B', 'quiet', 'Quiet room – Concourse B', 'S_B6');
  fac('SMOKING_B', 'smoking', 'Smoking room – Concourse B', 'S_B5');
  fac('FAMILY_B', 'family', 'Activity node (children’s play area) – Concourse B', 'S_B3');
  fac('FOOD_B', 'food', 'Café – Concourse B', 'S_B9');
  C('B', [[2, 'toilet', 'Toilets – Concourse {c} (near {i})'], [8, 'toilet', 'Toilets – Concourse {c} (near {i})']]);
  // C (three activity nodes per official page; sensory room between C7 and C9)
  fac('FAMILY_C1', 'family', 'Activity node (children’s play area) – Concourse C (south)', 'S_C4');
  fac('FAMILY_C2', 'family', 'Activity node (children’s play area) – Concourse C (middle)', 'S_C16');
  fac('FAMILY_C3', 'family', 'Activity node (children’s play area) – Concourse C (north)', 'S_C26');
  fac('FAMILY_MUZN', 'family', 'Sensory Room (Muzn Lounge) – children 2–12, free, 24 h', 'S_C8',
    { notes: 'Official HIA page: between Gates C7 and C9; free for ages 2–12, open 24 hours. ' + APPROX });
  fac('PRAYER_C', 'prayer', 'Prayer room – Concourse C (south)', 'S_C6');
  fac('PRAYER_C2', 'prayer', 'Prayer room – Concourse C (north)', 'S_C19');
  fac('QUIET_C', 'quiet', 'Quiet room – Concourse C (south)', 'S_C11');
  fac('QUIET_C2', 'quiet', 'Quiet room – Concourse C (north)', 'S_C22');
  fac('SMOKING_C', 'smoking', 'Smoking room – Concourse C (south)', 'S_C14');
  fac('SMOKING_C2', 'smoking', 'Smoking room – Concourse C (north)', 'S_C27');
  fac('INFO_C', 'info', 'Information desk – Concourse C', 'S_C13');
  fac('FOOD_C', 'food', 'Café – Concourse C (south)', 'S_C9');
  fac('FOOD_C2', 'food', 'Café – Concourse C (middle)', 'S_C21');
  C('C', [[5, 'toilet', 'Toilets – Concourse {c} (near {i})'], [10, 'toilet', 'Toilets – Concourse {c} (near {i})'], [17, 'toilet', 'Toilets – Concourse {c} (near {i})'],
    [24, 'toilet', 'Toilets – Concourse {c} (near {i})'], [29, 'toilet', 'Toilets – Concourse {c} (near {i})']]);
  fac('SLEEP_N', 'sleep', 'Sleepover sleep pods & showers – near Gate C31 (paid)', 'S_C30',
    { level: 'LL', kind: 'lift', extra: 15, notes: 'Official HIA page: lower level at the C-gates, opposite Gates C30/C31, about 100 m from the C-gates food court; showers available. ' + APPROX });
  // D
  fac('PRAYER_D', 'prayer', 'Prayer room – Concourse D', 'S_D4');
  fac('QUIET_D', 'quiet', 'Quiet room – Concourse D', 'S_D6');
  fac('SMOKING_D', 'smoking', 'Smoking room – Concourse D', 'S_D3');
  fac('FOOD_D', 'food', 'Café – Concourse D', 'S_D5');
  C('D', [[2, 'toilet', 'Toilets – Concourse {c} (near {i})'], [7, 'toilet', 'Toilets – Concourse {c} (near {i})']]);
  // E
  fac('PRAYER_E', 'prayer', 'Prayer room – Concourse E', 'S_E5');
  fac('QUIET_E', 'quiet', 'Quiet room – Concourse E', 'S_E4');
  fac('SMOKING_E', 'smoking', 'Smoking room – Concourse E', 'S_E3');
  fac('FOOD_E', 'food', 'Café – Concourse E', 'S_E7');
  fac('SHUTTLE_E', 'other', 'Complimentary shuttle buggy stop – Concourse E (near E1)', 'S_E1',
    { notes: 'Official HIA page: shuttle stop near Gate E1 and the information desk. ' + APPROX });
  C('E', [[2, 'toilet', 'Toilets – Concourse {c} (near {i})'], [6, 'toilet', 'Toilets – Concourse {c} (near {i})']]);

  // ---- Lounges (official HIA lounge pages give concourse, level and landmark; positions approximate) ----
  const up = (id, name, x, y, from, lift, level, concourse, note, { escalator = true } = {}) => {
    L(id, 'lounge', name, x, y, { level, concourse, notes: `${note} ${APPROX}` });
    if (escalator) E(from, id, 'escalator', 0, 12);
    if (lift) E(lift, id, 'lift', 1, 15);
  };
  up('LOUNGE_MOURJAN_S', 'Al Mourjan Business Lounge', 285, 345, 'PLAZA_S', 'LIFT_S', '1', 'A', 'Official: Concourse A near Lamp Bear, Level 1 — escalator or elevator after the Harrods Tea Room.');
  up('LOUNGE_SAFWA', 'Al Safwa First Lounge', 285, 455, 'PLAZA_S', 'LIFT_S', '3', 'B', 'Official: Concourse B near Lamp Bear, Level 3 — elevator/escalator behind the Hermès boutique.');
  up('LOUNGE_MAHA_S', 'Al Maha Lounge – South', 168, 352, 'PLAZA_S', 'LIFT_S', '1', null, 'Official: near Lamp Bear — escalator to Level 1 near Harrods, or elevator to Level 2 near Hermès.');
  up('LOUNGE_MARINER_S', 'Mariner Lounge', 168, 448, 'PLAZA_S', 'LIFT_S', '1', null, 'Official: Lamp Bear, Level 1 — reception on the right after the Hermès boutique; use the elevator.', { escalator: false });
  up('LOUNGE_GARDEN', 'Al Mourjan Business Lounge – The Garden', 412, 288, 'PLAZA', 'LIFT_C', '2', null, 'Official: ORCHARD (Concourse C), Level 2 — elevators behind the Louis Vuitton store.', { escalator: false });
  up('LOUNGE_MAHA_C', 'Al Maha Lounge – North (ORCHARD)', 330, 262, 'PLAZA', 'LIFT_C', '2', null, 'Official: ORCHARD (Concourse C), Level 2 — escalators between the duty free shops, before The Garden lounge.');
  up('LOUNGE_PG_N', 'Platinum and Gold Lounge – North', 922, 300, 'PLAZA_N', 'LIFT_N', '2', null, 'Official: Concourse C, Level 2 — follow signs to the Oryx Garden Hotel; escalator and elevator near the hotel reception.');
  fac('LOUNGE_GOLD_S', 'lounge', 'Gold Lounge – South', 'S_A1', { off: 56, notes: `Official: Concourse A near Lamp Bear, Level 1 — entrance near Gate A1. ${APPROX}` });
  fac('LOUNGE_PLAT_S', 'lounge', 'Platinum Lounge – South', 'S_A1', { off: 102, level: '2', notes: `Official: Concourse A near Lamp Bear, Level 2 — entrance near Gate A1. ${APPROX}` });
  fac('LOUNGE_SILVER', 'lounge', 'Silver Lounge', 'S_B1', { off: 56, notes: `Official: Concourse B (Gate B1), Level 1 — entrance near Gate B1. ${APPROX}` });
  return { locs, edges };
}

// Lounge access rules summarise the eligibility text on each official HIA lounge page (checked 2026-11-05).
// They only produce a PROVISIONAL indication; staff always verify documents and record the decision.
const QR_ANCILLARY = 'Lounge access can be pre-booked as a paid add-on ("ancillary service") with Qatar Airways, subject to availability. Prices are shown by Qatar Airways only.';
const HOURS_UNCONFIRMED = { unknown: true, label: 'Opening hours are not published on the official lounge page — confirm with the lounge' };
const lp = slug => `${HIA}/lounge/${slug}`;

export const LOUNGES = [
  { id: 'L_SAFWA', location_id: 'LOUNGE_SAFWA', name: 'Al Safwa First Lounge', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [
      { carriers: ['ONEWORLD'], cabins: ['first'], reason: 'first_class' },
      { carriers: ['QR'], cabins: ['business', 'first'], tiers: ['PC_PLATINUM'], reason: 'pc_platinum_full_fare' },
    ], paid: true },
    amenities: ['dining', 'showers', 'quiet_rooms', 'prayer_room', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('al-safwa-first-lounge'),
    notes: 'First Class on Qatar Airways / oneworld; Platinum members only on full-fare First or Business tickets on Qatar Airways-operated flights.' },
  { id: 'L_MOURJAN_S', location_id: 'LOUNGE_MOURJAN_S', name: 'Al Mourjan Business Lounge', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['ONEWORLD'], cabins: ['business'], reason: 'business_class' }], paid: true },
    amenities: ['dining', 'showers', 'quiet_rooms', 'prayer_room', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('al-mourjan-business-lounge-south'),
    notes: 'Business Class on Qatar Airways or oneworld-operated flights (and Qatar Airways-operated codeshares).' },
  { id: 'L_GARDEN', location_id: 'LOUNGE_GARDEN', name: 'Al Mourjan Business Lounge – The Garden', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['ONEWORLD'], cabins: ['business'], reason: 'business_class' }], paid: true },
    amenities: ['dining', 'showers', 'garden_views', 'spa', 'gym', 'prayer_room', 'family_rooms', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('al-mourjan-business-lounge-garden'),
    notes: 'Business Class on Qatar Airways or oneworld-operated flights.' },
  { id: 'L_PG_NORTH', location_id: 'LOUNGE_PG_N', name: 'Platinum and Gold Lounge – North', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['ONEWORLD'], tiers: ['OW_SAPPHIRE', 'OW_EMERALD'], reason: 'status_gold_platinum' }], paid: true },
    amenities: ['dining', 'runway_views', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('platinum-and-gold-lounge-north'),
    notes: 'Privilege Club Platinum/Gold or oneworld Emerald/Sapphire travelling on Qatar Airways or oneworld-operated flights; eligible guests with the member.' },
  { id: 'L_PC_PLAT', location_id: 'LOUNGE_PLAT_S', name: 'Platinum Lounge – South', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['ONEWORLD'], tiers: ['OW_EMERALD'], reason: 'status_platinum' }], paid: true },
    amenities: ['dining', 'showers', 'quiet_rooms', 'prayer_room', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('platinum-lounge-south'),
    notes: 'Privilege Club Platinum or oneworld Emerald travelling on Qatar Airways or oneworld-operated flights; eligible guests with the member.' },
  { id: 'L_PC_GOLD', location_id: 'LOUNGE_GOLD_S', name: 'Gold Lounge – South', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['ONEWORLD'], tiers: ['OW_SAPPHIRE'], reason: 'status_gold' }], paid: true },
    amenities: ['dining', 'showers', 'family_area', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('gold-lounge-south'),
    notes: 'Privilege Club Gold or oneworld Sapphire travelling on Qatar Airways or oneworld-operated flights; eligible guests with the member.' },
  { id: 'L_PC_SILVER', location_id: 'LOUNGE_SILVER', name: 'Silver Lounge', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['QR'], tiers: ['PC_SILVER'], reason: 'pc_silver' }], paid: true },
    amenities: ['dining', 'showers', 'family_area', 'quiet_area', 'wifi'], paid_access: QR_ANCILLARY, source_url: lp('silver-lounge-north'),
    notes: 'Privilege Club Silver travelling on Qatar Airways-operated flights; eligible guests with the member.' },
  { id: 'L_MAHA_S', location_id: 'LOUNGE_MAHA_S', name: 'Al Maha Lounge – South', operator: 'Al Maha Services', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['OTHER'], cabins: ['business', 'first'], reason: 'premium_cabin_other_airline' }], paid: true },
    amenities: ['showers', 'dining', 'business_centre', 'smoking_room', 'wifi'], source_url: lp('al-maha-lounge-south'),
    paid_access: 'Walk-in access can be purchased at the lounge reception or booked on the Al Maha website. Some credit-card lounge programmes (e.g. Priority Pass, LoungeKey, DragonPass) may include access — the lounge confirms.',
    notes: 'First and Business Class passengers of other airlines (not Qatar Airways).' },
  { id: 'L_MAHA_N', location_id: 'LOUNGE_MAHA_C', name: 'Al Maha Lounge – North (ORCHARD)', operator: 'Al Maha Services', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [{ carriers: ['OTHER'], cabins: ['business', 'first'], reason: 'premium_cabin_other_airline' }], paid: true },
    amenities: ['showers', 'dining', 'business_centre', 'smoking_room', 'wifi'], source_url: lp('al-maha-lounge-north'),
    paid_access: 'Walk-in access can be purchased at the lounge reception or booked on the Al Maha website. Some credit-card lounge programmes (e.g. Priority Pass, LoungeKey, DragonPass) may include access — the lounge confirms.',
    notes: 'First and Business Class passengers of other airlines (not Qatar Airways).' },
  { id: 'L_MARINER', location_id: 'LOUNGE_MARINER_S', name: 'Mariner Lounge', operator: 'Qatar Airways', hours: HOURS_UNCONFIRMED, status: 'open',
    rules: { rules: [], paid: false }, amenities: ['workstations', 'dining', 'wifi'], paid_access: null, source_url: lp('mariner-lounge'),
    notes: 'Only for eligible seafarers and offshore workers — eligibility is confirmed by Qatar Airways / lounge staff.' },
];

export const SIM_FLIGHTS = [
  ['QR572', 'Qatar Airways', 'New Delhi', 'DEL', 95, 'C9', 'scheduled'],
  ['QR516', 'Qatar Airways', 'Kochi', 'COK', 35, 'D4', 'boarding'],
  ['QR600', 'Qatar Airways', 'Dhaka', 'DAC', 70, 'B6', 'scheduled'],
  ['QR930', 'Qatar Airways', 'Manila', 'MNL', 120, 'A7', 'scheduled'],
  ['QR8', 'Qatar Airways', 'London Heathrow', 'LHR', 55, 'A3', 'delayed'],
  ['QR41', 'Qatar Airways', 'Paris Charles de Gaulle', 'CDG', 150, 'B2', 'scheduled'],
  ['QR858', 'Qatar Airways', 'Beijing', 'PEK', 180, null, 'scheduled'],
  ['QR234', 'Qatar Airways', 'Moscow', 'SVO', 25, 'E2', 'final_call'],
  ['QR611', 'Qatar Airways', 'Karachi', 'KHI', 65, 'D7', 'scheduled'],
  ['QR67', 'Qatar Airways', 'Frankfurt', 'FRA', 200, null, 'scheduled'],
];

const f = (category, keywords, source, tr) => ({ category, keywords, source, tr, since: 1 });
const f2 = (...args) => ({ ...f(...args), since: 2 }); // added with seed v2
export const FAQS = [
  f('connectivity', 'wifi, wi-fi, internet, wlan, वाईफाई, वाई-फ़ाई, वाई-फाई, इंटरनेट, واي فاي, واي-فاي, الإنترنت, انترنت, إنترنت, وائی فائی, انٹرنیٹ, ওয়াই-ফাই, ওয়াইফাই, ইন্টারনেট, വൈ-ഫൈ, വൈഫൈ, ഇന്റർനെറ്റ്, 无线网络, 网络, 上网, интернет, вайфай, вай-фай', HIA_TRANSFERS, {
    en: ['Is there free Wi-Fi?', 'Yes. Complimentary wireless internet is available throughout the passenger terminal. Internet kiosks and desks with computers are also available.'],
    hi: ['क्या मुफ़्त वाई-फ़ाई है?', 'हाँ। पूरे यात्री टर्मिनल में मुफ़्त वायरलेस इंटरनेट उपलब्ध है। इंटरनेट कियोस्क और कंप्यूटर डेस्क भी उपलब्ध हैं।'],
    ar: ['هل يتوفر واي فاي مجاني؟', 'نعم. يتوفر الإنترنت اللاسلكي المجاني في جميع أنحاء مبنى الركاب، كما تتوفر أكشاك ومكاتب إنترنت مزودة بأجهزة كمبيوتر.'],
  }),
  f('boarding', 'gate close, gate closes, closing, boarding close, बंद, कब बंद, تغلق, إغلاق, يغلق, بند, বন্ধ, അടയ്ക്ക, 关闭, 截止, ferme, fermeture, cierra, cierre, закрыва, schließt, schließen', HIA_TRANSFERS, {
    en: ['When does my boarding gate close?', 'Boarding gates close 20 minutes before the flight departure time. Please be at your gate well before then.'],
    hi: ['मेरा बोर्डिंग गेट कब बंद होता है?', 'बोर्डिंग गेट फ़्लाइट के प्रस्थान समय से 20 मिनट पहले बंद हो जाते हैं। कृपया उससे काफ़ी पहले अपने गेट पर पहुँचें।'],
    ar: ['متى تُغلق بوابة الصعود؟', 'تُغلق بوابات الصعود قبل 20 دقيقة من موعد إقلاع الرحلة. يرجى التواجد عند بوابتك قبل ذلك بوقت كافٍ.'],
  }),
  f('transfers', 'transfer, connecting, connection, transit, layover, ट्रांसफ़र, ट्रांसफर, कनेक्टिंग, ट्रांजिट, عبور, ترانزيت, رحلة متصلة, ٹرانسفر, ٹرانزٹ, ট্রান্সফার, ট্রানজিট, ട്രാൻസ്ഫർ, ട്രാൻസിറ്റ്, 中转, 转机, correspondance, conexión, пересадк, трансфер, umsteigen', HIA_TRANSFERS, {
    en: ['I have a connecting flight. Where do I go?', 'After leaving your aircraft, go directly to the Transfer halls located at Concourses A, B, C and D. Do not follow "Arrivals" signs unless you are leaving the airport. Transfer desks can help with boarding passes, rebooking and general questions.'],
    hi: ['मेरी कनेक्टिंग फ़्लाइट है। मुझे कहाँ जाना है?', 'विमान से उतरने के बाद सीधे ट्रांसफ़र हॉल जाएँ, जो कॉनकोर्स A, B, C और D में हैं। जब तक आप हवाई अड्डे से बाहर नहीं जा रहे, "Arrivals" के संकेतों का पालन न करें। ट्रांसफ़र डेस्क बोर्डिंग पास, री-बुकिंग और सामान्य सवालों में मदद कर सकते हैं।'],
    ar: ['لدي رحلة متصلة. إلى أين أذهب؟', 'بعد مغادرة الطائرة، توجّه مباشرة إلى صالات العبور الموجودة في الممرات A وB وC وD. لا تتبع لافتات "الوصول" إلا إذا كنت ستغادر المطار. تساعدك مكاتب العبور في بطاقات الصعود وإعادة الحجز والاستفسارات العامة.'],
  }),
  f('facilities', 'prayer, pray, mosque, ablution, wudu, नमाज़, नमाज, प्रार्थना, वज़ू, صلاة, مصلى, وضوء, نماز, وضو, নামাজ, অজু, നിസ്കാര, പ്രാർത്ഥന, 祈祷, prière, oración, молитв, gebet', HIA_PRAYER, {
    en: ['Are there prayer rooms?', 'Yes. Prayer rooms are located throughout the passenger terminal, with separate areas for men and women and dedicated ablution facilities.'],
    hi: ['क्या यहाँ प्रार्थना कक्ष हैं?', 'हाँ। पूरे यात्री टर्मिनल में प्रार्थना कक्ष हैं, जिनमें पुरुषों और महिलाओं के लिए अलग-अलग स्थान और वज़ू की सुविधा है।'],
    ar: ['هل توجد غرف للصلاة؟', 'نعم. تتوزع غرف الصلاة في جميع أنحاء مبنى الركاب، مع أماكن منفصلة للرجال والنساء ومرافق مخصصة للوضوء.'],
  }),
  f('facilities', 'quiet room, rest, sleep, nap, relax, sleep pod, आराम, सोना, नींद, शांत, استراحة, نوم, هدوء, آرام, نیند, বিশ্রাম, ঘুম, വിശ്രമ, ഉറങ്ങ, 休息, 睡觉, repos, dormir, descansar, отдых, поспать, schlafen, ruhe', `${HIA}/relax/quiet-rooms`, {
    en: ['Where can I rest or sleep?', 'Free quiet rooms with reclining seats are located across the terminal, with separate rooms for men, women and families. Paid options are the Oryx Airport Hotel (South Plaza, next to Lamp Bear), the Oryx Garden Hotel (North Node) and Sleepover sleep pods (South Plaza and near Gate C31).'],
    hi: ['मैं कहाँ आराम कर सकता/सकती हूँ या सो सकता/सकती हूँ?', 'पूरे टर्मिनल में रिक्लाइनिंग सीटों वाले मुफ़्त शांत कक्ष हैं, जिनमें पुरुषों, महिलाओं और परिवारों के लिए अलग कमरे हैं। सशुल्क विकल्प हैं: ओरिक्स एयरपोर्ट होटल (साउथ प्लाज़ा, लैम्प बेयर के पास), ओरिक्स गार्डन होटल (नॉर्थ नोड) और स्लीपओवर स्लीप पॉड (साउथ प्लाज़ा और गेट C31 के पास)।'],
    ar: ['أين يمكنني الراحة أو النوم؟', 'تتوفر غرف هادئة مجانية بمقاعد قابلة للإمالة في أنحاء المبنى، مع غرف منفصلة للرجال والنساء والعائلات. أما الخيارات المدفوعة فهي فندق مطار أوريكس (الساحة الجنوبية بجوار تمثال الدب والمصباح) وفندق أوريكس جاردن (العقدة الشمالية) وكبسولات النوم من Sleepover (الساحة الجنوبية وبالقرب من البوابة C31).'],
  }),
  f('services', 'hotel, stay, room, होटल, फ़्लाइट के बीच रुकना, فندق, ہوٹل, হোটেল, ഹോട്ടൽ, 酒店, hôtel, отель, гостиниц', `${HIA}/relax/oryx-airport-hotel`, {
    en: ['Can I stay at a hotel during my layover?', 'Yes. The Oryx Airport Hotel is inside the transit area at the South Plaza, next to Lamp Bear, and the Oryx Garden Hotel is at the North Node at the end of Concourse C. Short stays are possible (the airport website mentions stays as short as five hours). Rates and availability vary — please check with the hotel.'],
    hi: ['क्या मैं लेओवर के दौरान होटल में रुक सकता/सकती हूँ?', 'हाँ। ओरिक्स एयरपोर्ट होटल ट्रांज़िट क्षेत्र में साउथ प्लाज़ा पर लैम्प बेयर के पास है, और ओरिक्स गार्डन होटल कॉनकोर्स C के अंत में नॉर्थ नोड पर है। कम अवधि के लिए भी ठहरा जा सकता है (हवाई अड्डे की वेबसाइट के अनुसार पाँच घंटे जितने कम समय के लिए भी)। दरें और उपलब्धता बदलती रहती हैं — कृपया होटल से पूछें।'],
    ar: ['هل يمكنني الإقامة في فندق أثناء التوقف؟', 'نعم. يقع فندق مطار أوريكس داخل منطقة العبور في الساحة الجنوبية بجوار تمثال الدب والمصباح، ويقع فندق أوريكس جاردن في العقدة الشمالية عند نهاية الردهة C. تتوفر إقامات قصيرة (يذكر موقع المطار إقامات تبدأ من خمس ساعات). تختلف الأسعار والتوفر — يرجى الاستفسار من الفندق.'],
  }),
  f('services', 'tour, city tour, leave the airport, go outside, visit doha, visa, टूर, शहर घूमना, बाहर जाना, वीज़ा, جولة, مغادرة المطار, تأشيرة, ٹور, ویزا, ট্যুর, ভিসা, ടൂർ, വിസ, 观光, 出机场, 签证, visite, excursion, visado, экскурс, виза, stadtrundfahrt', HIA_TRANSFERS, {
    en: ['Can I leave the airport during my layover?', 'Transit tours run by Discover Qatar are available for transit times of 4 hours or more, with the full list of tours for 6 hours or more. Entry and visa rules depend on your nationality — please check before booking.'],
    hi: ['क्या मैं लेओवर के दौरान हवाई अड्डे से बाहर जा सकता/सकती हूँ?', '4 घंटे या उससे अधिक के ट्रांज़िट के लिए Discover Qatar के ट्रांज़िट टूर उपलब्ध हैं, और 6 घंटे या उससे अधिक के लिए सभी टूर। प्रवेश और वीज़ा नियम आपकी राष्ट्रीयता पर निर्भर करते हैं — कृपया बुकिंग से पहले जाँच लें।'],
    ar: ['هل يمكنني مغادرة المطار أثناء التوقف؟', 'تتوفر جولات العبور التي تنظمها "اكتشف قطر" لفترات العبور التي تبلغ 4 ساعات أو أكثر، والقائمة الكاملة للجولات لفترات 6 ساعات أو أكثر. تعتمد قواعد الدخول والتأشيرة على جنسيتك — يرجى التحقق قبل الحجز.'],
  }),
  f('security', 'security, screening, liquids, prohibited, hand baggage, सुरक्षा, जाँच, तरल, أمن, تفتيش, سوائل, سیکیورٹی, নিরাপত্তা, സുരക്ഷ, 安检, 液体, sécurité, seguridad, досмотр, sicherheit', HIA_TRANSFERS, {
    en: ['What happens at transfer security?', 'Hand baggage is screened before you enter the passenger terminal. Prohibited items found during screening are confiscated and cannot be returned. Please follow the instructions of security staff.'],
    hi: ['ट्रांसफ़र सुरक्षा जाँच में क्या होता है?', 'यात्री टर्मिनल में प्रवेश से पहले हैंड बैगेज की जाँच की जाती है। जाँच में मिली प्रतिबंधित वस्तुएँ ज़ब्त कर ली जाती हैं और वापस नहीं की जातीं। कृपया सुरक्षा कर्मचारियों के निर्देशों का पालन करें।'],
    ar: ['ماذا يحدث في تفتيش العبور الأمني؟', 'يتم فحص حقائب اليد قبل دخول مبنى الركاب. تُصادر المواد المحظورة التي يُعثر عليها أثناء الفحص ولا يمكن استردادها. يرجى اتباع تعليمات موظفي الأمن.'],
  }),
  f('connectivity', 'charge, charging, charger, battery, phone, laptop, चार्ज, चार्जिंग, बैटरी, شحن, شاحن, بطارية, چارج, চার্জ, ചാർജ്, 充电, recharger, cargar, заряд, aufladen, laden', HIA_TRANSFERS, {
    en: ['Where can I charge my phone?', 'Phone and laptop charging stations are located throughout the terminal.'],
    hi: ['मैं अपना फ़ोन कहाँ चार्ज कर सकता/सकती हूँ?', 'पूरे टर्मिनल में फ़ोन और लैपटॉप चार्जिंग स्टेशन उपलब्ध हैं।'],
    ar: ['أين يمكنني شحن هاتفي؟', 'تتوفر محطات شحن الهواتف وأجهزة الكمبيوتر المحمولة في جميع أنحاء المبنى.'],
  }),
  f('facilities', 'smoking, smoke, cigarette, धूम्रपान, सिगरेट, تدخين, سجائر, سگریٹ, ধূমপান, പുകവലി, 吸烟, fumer, fumar, кури, rauchen', HIA_TRANSFERS, {
    en: ['Is there a smoking area?', 'Yes. Designated smoking rooms are located throughout the terminal. Smoking is not permitted anywhere else.'],
    hi: ['क्या धूम्रपान क्षेत्र है?', 'हाँ। पूरे टर्मिनल में निर्धारित धूम्रपान कक्ष हैं। अन्य किसी भी जगह धूम्रपान की अनुमति नहीं है।'],
    ar: ['هل توجد منطقة للتدخين؟', 'نعم. توجد غرف تدخين مخصصة في أنحاء المبنى، ولا يُسمح بالتدخين في أي مكان آخر.'],
  }),
  f('facilities', 'children, kids, family, play area, baby, parents room, stroller, pram, autism, sensory, बच्चे, बच्चों, परिवार, स्ट्रोलर, أطفال, عائلة, عربة أطفال, بچے, শিশু, കുട്ടി, 儿童, 孩子, 婴儿车, enfants, poussette, niños, carrito, дети, коляска для, kinder, kinderwagen', `${HIA}/relax/play-area`, {
    en: ['Are there facilities for children?', 'Yes. There are five activity nodes with play areas (one each in Concourses A and B, three in Concourse C), baby changing rooms and family toilets. Child strollers are free at the Stroller Nests (they are not allowed on the train). The Sensory Room (Muzn Lounge) between Gates C7 and C9 is free for children aged 2 to 12 and open 24 hours.'],
    hi: ['क्या बच्चों के लिए सुविधाएँ हैं?', 'हाँ। खेलने के क्षेत्र वाले पाँच एक्टिविटी नोड हैं (कॉनकोर्स A और B में एक-एक, कॉनकोर्स C में तीन), बच्चों के डायपर बदलने के कमरे और फ़ैमिली टॉयलेट भी हैं। स्ट्रोलर नेस्ट पर बच्चों के स्ट्रोलर मुफ़्त मिलते हैं (ट्रेन में इनकी अनुमति नहीं है)। गेट C7 और C9 के बीच सेंसरी रूम (मुज़्न लाउंज) 2 से 12 साल के बच्चों के लिए मुफ़्त है और 24 घंटे खुला रहता है।'],
    ar: ['هل توجد مرافق للأطفال؟', 'نعم. توجد خمس مناطق أنشطة بها أماكن لعب (واحدة في كل من الردهتين A وB وثلاث في الردهة C)، إضافة إلى غرف لتغيير الحفاضات ودورات مياه عائلية. تتوفر عربات الأطفال مجاناً في نقاط "Stroller Nest" (غير مسموح بها في القطار). وغرفة الحواس (صالة مزن) بين البوابتين C7 وC9 مجانية للأطفال من عمر 2 إلى 12 سنة ومفتوحة على مدار 24 ساعة.'],
  }),
  f('accessibility', 'wheelchair, special assistance, disabled, reduced mobility, व्हीलचेयर, विशेष सहायता, كرسي متحرك, مساعدة خاصة, وہیل چیئر, হুইলচেয়ার, വീൽചെയർ, 轮椅, fauteuil, silla de ruedas, коляск, rollstuhl', HIA_TRANSFERS, {
    en: ['I need wheelchair or special assistance.', 'Passengers with special assistance booked through their airline are met at the aircraft and receive priority processing. If you need help now, ask any staff member or go to the nearest information desk or special assistance desk.'],
    hi: ['मुझे व्हीलचेयर या विशेष सहायता चाहिए।', 'जिन यात्रियों ने अपनी एयरलाइन से विशेष सहायता बुक की है, उनसे विमान पर ही मिला जाता है और उन्हें प्राथमिकता दी जाती है। अगर आपको अभी मदद चाहिए, तो किसी भी स्टाफ़ सदस्य से कहें या नज़दीकी सूचना डेस्क या विशेष सहायता डेस्क पर जाएँ।'],
    ar: ['أحتاج إلى كرسي متحرك أو مساعدة خاصة.', 'يتم استقبال المسافرين الذين حجزوا مساعدة خاصة عبر شركة الطيران عند الطائرة ويحصلون على أولوية في الإجراءات. إذا كنت بحاجة إلى المساعدة الآن، فاطلبها من أي موظف أو توجّه إلى أقرب مكتب استعلامات أو مكتب مساعدة خاصة.'],
  }),
  f('services', 'shop, shopping, duty free, restaurant, food, eat, खरीदारी, ड्यूटी फ्री, दुकान, تسوق, السوق الحرة, متاجر, شاپنگ, কেনাকাটা, ഷോപ്പിംഗ്, 购物, 免税, boutique, tiendas, магазин, duty-free, einkaufen', HIA_TRANSFERS, {
    en: ['What shops and restaurants are there?', 'The terminal has more than 70 retail outlets and around 30 cafés and restaurants.'],
    hi: ['यहाँ कौन-सी दुकानें और रेस्टोरेंट हैं?', 'टर्मिनल में 70 से अधिक दुकानें और लगभग 30 कैफ़े और रेस्टोरेंट हैं।'],
    ar: ['ما المتاجر والمطاعم المتوفرة؟', 'يضم المبنى أكثر من 70 متجراً ونحو 30 مقهى ومطعماً.'],
  }),
  f('services', 'lost, lost and found, missing, forgot, खो गया, खोया, गुम, فقدت, مفقودات, ضائع, گم, হারিয়ে, നഷ്ട, 丢失, 失物, perdu, perdido, потерял, verloren', null, {
    en: ['I lost something. What should I do?', 'Please report the lost item to the nearest information desk or any airport staff member as soon as possible. If you have already left the airport, use the lost & found contact on the official airport website.'],
    hi: ['मेरा कुछ सामान खो गया है। मैं क्या करूँ?', 'कृपया जल्द से जल्द नज़दीकी सूचना डेस्क या किसी भी हवाई अड्डा कर्मचारी को खोए सामान की जानकारी दें। अगर आप हवाई अड्डे से निकल चुके हैं, तो आधिकारिक वेबसाइट पर लॉस्ट एंड फ़ाउंड संपर्क का उपयोग करें।'],
    ar: ['فقدت شيئاً. ماذا أفعل؟', 'يرجى الإبلاغ عن الغرض المفقود في أقرب مكتب استعلامات أو لأي موظف في المطار في أسرع وقت. إذا كنت قد غادرت المطار، فاستخدم وسيلة التواصل الخاصة بالمفقودات على الموقع الرسمي للمطار.'],
  }),
  f('lounges', 'lounge access, lounge entry, which lounge, can i use lounge, लाउंज में प्रवेश, कौन सा लाउंज, دخول الصالة, أي صالة, لاؤنج, লাউঞ্জ, ലൗഞ്ച്, 休息室, salon, sala vip, бизнес-зал', HIA_LOUNGES, {
    en: ['How do I get lounge access?', 'Lounge access depends on your ticket class, the operating airline and your frequent-flyer status; some lounges also offer paid entry. Use the Lounges section to see which lounges may suit you. Entry is always verified at the lounge reception.'],
    hi: ['मुझे लाउंज में प्रवेश कैसे मिलेगा?', 'लाउंज में प्रवेश आपके टिकट की श्रेणी, संचालक एयरलाइन और फ़्रीक्वेंट-फ़्लायर स्टेटस पर निर्भर करता है; कुछ लाउंज में सशुल्क प्रवेश भी मिलता है। कौन-से लाउंज आपके लिए उपयुक्त हो सकते हैं, यह देखने के लिए लाउंज सेक्शन देखें। प्रवेश की पुष्टि हमेशा लाउंज रिसेप्शन पर होती है।'],
    ar: ['كيف أحصل على دخول الصالة؟', 'يعتمد دخول الصالة على درجة تذكرتك وشركة الطيران المشغلة وفئة عضويتك في برنامج المسافر الدائم، وتوفر بعض الصالات دخولاً مدفوعاً. استخدم قسم الصالات لمعرفة الصالات التي قد تناسبك. يتم التحقق من الدخول دائماً في استقبال الصالة.'],
  }),
  // ---- Added with map v2 (official HIA pages, checked 2026-11-05) ----
  f2('medical', 'doctor, medical, clinic, emergency, sick, ill, ambulance, first aid, injured, डॉक्टर, चिकित्सा, आपातकाल, बीमार, एम्बुलेंस, طبيب, طبي, عيادة, طوارئ, مريض, إسعاف, ڈاکٹر, ایمرجنسی, بیمار, ডাক্তার, জরুরি, অসুস্থ, ഡോക്ടർ, അടിയന്തര, അസുഖ, 医生, 急救, 医疗, 生病, médecin, urgence, malade, médico, urgencia, enfermo, врач, скорая, болен, arzt, notfall, krank', `${HIA}/airport-guide/facilities-services/medical-emergencies`, {
    en: ['I need a doctor or medical help.', 'In an emergency, tell any airport staff member immediately or call the airport medical team on +974 4010 9222. Two medical centres operate 24 hours a day: one in the Arrivals hall just before passport control and one in the Departures hall near check-in.'],
    hi: ['मुझे डॉक्टर या चिकित्सा सहायता चाहिए।', 'आपातकाल में तुरंत किसी भी हवाई अड्डा कर्मचारी को बताएँ या हवाई अड्डे की मेडिकल टीम को +974 4010 9222 पर कॉल करें। दो मेडिकल सेंटर 24 घंटे खुले रहते हैं: एक अराइवल हॉल में पासपोर्ट कंट्रोल से ठीक पहले और एक डिपार्चर हॉल में चेक-इन के पास।'],
    ar: ['أحتاج إلى طبيب أو مساعدة طبية.', 'في حالة الطوارئ، أبلغ أي موظف في المطار فوراً أو اتصل بالفريق الطبي للمطار على الرقم +974 4010 9222. يعمل مركزان طبيان على مدار 24 ساعة: أحدهما في صالة الوصول قبل الجوازات مباشرة، والآخر في صالة المغادرة بالقرب من منطقة تسجيل الوصول.'],
  }),
  f2('getting_around', 'train, shuttle, buggy, golf cart, far gate, distant gate, concourse d, concourse e, ट्रेन, शटल, बग्गी, قطار, عربة نقل, الحافلة الداخلية, ٹرین, شٹل, ট্রেন, শাটল, ട്രെയിൻ, ഷട്ടിൽ, 列车, 火车, 摆渡车, navette, tren, lanzadera, поезд, шаттл, zug, shuttle-buggy', `${HIA}/facilities/complimentary-shuttle-service`, {
    en: ['How do I get to distant gates? Is there a train or shuttle?', 'A passenger train connects the South Plaza (Lamp Bear) and the North Plaza. Carts and strollers are not permitted on the train. A complimentary shuttle buggy also runs about every 15 minutes between Concourse B (near Lamp Bear) and Concourse E (near Gate E1) — no booking is needed.'],
    hi: ['दूर के गेट तक कैसे जाएँ? क्या ट्रेन या शटल है?', 'एक पैसेंजर ट्रेन साउथ प्लाज़ा (लैम्प बेयर) और नॉर्थ प्लाज़ा को जोड़ती है। ट्रेन में ट्रॉली और स्ट्रोलर ले जाने की अनुमति नहीं है। इसके अलावा कॉनकोर्स B (लैम्प बेयर के पास) और कॉनकोर्स E (गेट E1 के पास) के बीच लगभग हर 15 मिनट में मुफ़्त शटल बग्गी चलती है — बुकिंग की ज़रूरत नहीं है।'],
    ar: ['كيف أصل إلى البوابات البعيدة؟ هل يوجد قطار أو عربة نقل؟', 'يربط قطار الركاب بين الساحة الجنوبية (تمثال الدب والمصباح) والساحة الشمالية. لا يُسمح بعربات الأمتعة وعربات الأطفال في القطار. كما تعمل عربة نقل مجانية كل 15 دقيقة تقريباً بين الردهة B (قرب تمثال الدب والمصباح) والردهة E (قرب البوابة E1) — دون حجز.'],
  }),
  f2('facilities', 'gym, pool, swimming, spa, massage, shower, fitness, squash, golf, vitality, जिम, स्विमिंग, स्पा, शावर, मालिश, مسبح, سباحة, نادي رياضي, صالة رياضية, استحمام, مساج, تدليك, جم, سوئمنگ, شاور, জিম, সাঁতার, শাওয়ার, ജിം, നീന്ത, ഷവർ, 游泳, 健身, 淋浴, 水疗, piscine, douche, salle de sport, piscina, ducha, gimnasio, бассейн, душ, спортзал, schwimmbad, dusche, fitness', `${HIA}/relax/vitality-wellbeing-fitness-centre`, {
    en: ['Is there a gym, swimming pool, spa or shower?', 'Yes. The Vitality Wellbeing & Fitness Centre on the 4th floor of the Oryx Airport Hotel (South Plaza, next to Lamp Bear) has a gym, a 25-metre swimming pool, spa treatments, a squash court, a golf simulator and shower rooms. It is open daily from 06:00 to 02:00 for all passengers; hotel guests get complimentary access to the pool, gym and showers, and other passengers pay a fee. Children under 5 cannot use the pool or fitness facilities.'],
    hi: ['क्या यहाँ जिम, स्विमिंग पूल, स्पा या शावर है?', 'हाँ। ओरिक्स एयरपोर्ट होटल (साउथ प्लाज़ा, लैम्प बेयर के पास) की चौथी मंज़िल पर वाइटैलिटी वेलबीइंग एंड फ़िटनेस सेंटर में जिम, 25 मीटर का स्विमिंग पूल, स्पा, स्क्वैश कोर्ट, गोल्फ़ सिम्युलेटर और शावर रूम हैं। यह सभी यात्रियों के लिए रोज़ 06:00 से 02:00 तक खुला रहता है; होटल मेहमानों को पूल, जिम और शावर मुफ़्त मिलते हैं, अन्य यात्रियों को शुल्क देना होता है। 5 साल से कम उम्र के बच्चे पूल या फ़िटनेस सुविधाओं का उपयोग नहीं कर सकते।'],
    ar: ['هل يوجد نادٍ رياضي أو مسبح أو سبا أو أماكن للاستحمام؟', 'نعم. يضم مركز فيتاليتي للعافية واللياقة في الطابق الرابع من فندق مطار أوريكس (الساحة الجنوبية بجوار تمثال الدب والمصباح) صالة رياضية ومسبحاً بطول 25 متراً وعلاجات سبا وملعب اسكواش وجهاز محاكاة للغولف وغرف استحمام. يفتح يومياً من 06:00 إلى 02:00 لجميع المسافرين؛ ويحصل نزلاء الفندق على دخول مجاني إلى المسبح والصالة الرياضية والاستحمام، بينما يدفع المسافرون الآخرون رسوماً. لا يُسمح للأطفال دون 5 سنوات باستخدام المسبح أو مرافق اللياقة.'],
  }),
  f2('services', 'atm, cash, money, currency, exchange money, currency exchange, bureau de change, travelex, एटीएम, पैसे, नकद, मुद्रा, صراف, صرافة, عملة, نقود, تحويل العملات, اے ٹی ایم, کرنسی, এটিএম, টাকা, എടിഎം, 取款, 换汇, 货币, 外币, distributeur, cajero, cambio de moneda, банкомат, обмен валют, geldautomat, geldwechsel', `${HIA}/facilities/travelex`, {
    en: ['Where can I exchange money or find an ATM?', 'There are multiple ATMs around the airport and four Travelex branches across the passenger terminal offering currency exchange and money transfer. Ask at any information desk for the nearest one.'],
    hi: ['मैं पैसे कहाँ बदल सकता/सकती हूँ या एटीएम कहाँ है?', 'हवाई अड्डे में कई एटीएम हैं और यात्री टर्मिनल में ट्रैवलेक्स की चार शाखाएँ मुद्रा विनिमय और मनी ट्रांसफ़र की सुविधा देती हैं। नज़दीकी शाखा के लिए किसी भी सूचना डेस्क पर पूछें।'],
    ar: ['أين يمكنني صرف العملات أو العثور على صراف آلي؟', 'تتوفر أجهزة صراف آلي متعددة في أنحاء المطار، وأربعة فروع لشركة ترافيلكس في مبنى الركاب تقدم صرف العملات وتحويل الأموال. اسأل في أي مكتب استعلامات عن أقرب فرع.'],
  }),
  f2('accessibility', 'sunflower, hidden disability, invisible disability, lanyard, autism, सनफ्लावर, छिपी विकलांगता, دوار الشمس, الإعاقات الخفية, سورج مکھی, সানফ্লাওয়ার, സൺഫ്ലവർ, 向日葵, tournesol, girasol, подсолнух, sonnenblume', `${HIA}/airport-guide/traveler-guide/special-assistance`, {
    en: ['Do you support the Hidden Disabilities Sunflower?', 'Yes. Hamad International Airport is a member of the Hidden Disabilities Sunflower programme. Transfer passengers can collect a Sunflower lanyard at the information desks in the Lamp Bear area and the ORCHARD; departing passengers can collect one at the information desks in the check-in area.'],
    hi: ['क्या यहाँ हिडन डिसएबिलिटीज़ सनफ़्लावर कार्यक्रम है?', 'हाँ। हमद इंटरनेशनल एयरपोर्ट हिडन डिसएबिलिटीज़ सनफ़्लावर कार्यक्रम का सदस्य है। ट्रांसफ़र यात्री लैम्प बेयर क्षेत्र और ऑर्चर्ड की सूचना डेस्क से सनफ़्लावर लैनयार्ड ले सकते हैं; प्रस्थान करने वाले यात्री चेक-इन क्षेत्र की सूचना डेस्क से ले सकते हैं।'],
    ar: ['هل تدعمون برنامج "دوار الشمس" للإعاقات الخفية؟', 'نعم. مطار حمد الدولي عضو في برنامج "دوار الشمس" للإعاقات الخفية. يمكن لمسافري العبور الحصول على شريط دوار الشمس من مكاتب الاستعلامات في منطقة تمثال الدب والمصباح والأوركارد، ويمكن للمسافرين المغادرين الحصول عليه من مكاتب الاستعلامات في منطقة تسجيل الوصول.'],
  }),
];

export const GUIDANCE = [
  { topic: 'ffp', title: 'Privilege Club membership tiers — overview', source_url: QR_TIERS,
    body: 'Qatar Airways Privilege Club has four tiers: Burgundy, Silver, Gold and Platinum.\n• Tier status is earned with Qpoints over a 12-month period. Avios are the separate, spendable points currency.\n• Silver, Gold and Platinum broadly align with oneworld Ruby, Sapphire and Emerald.\n• For account-specific questions (balances, tier review, missing points) refer the passenger to the Privilege Club app/website or a Qatar Airways desk.\n✗ Do not quote tier thresholds or balances from memory.\n✗ Do not access a passenger account without authorisation.',
    passenger: { en: 'For questions about your Privilege Club account, please use the Privilege Club app or visit a Qatar Airways desk.', hi: 'अपने प्रिविलेज क्लब खाते से जुड़े सवालों के लिए कृपया प्रिविलेज क्लब ऐप का उपयोग करें या क़तर एयरवेज़ डेस्क पर जाएँ।', ar: 'للاستفسارات المتعلقة بحسابك في نادي الامتياز، يرجى استخدام تطبيق نادي الامتياز أو زيارة مكتب الخطوط الجوية القطرية.', ur: 'اپنے پریولیج کلب اکاؤنٹ سے متعلق سوالات کے لیے براہ کرم پریولیج کلب ایپ استعمال کریں یا قطر ایئرویز ڈیسک پر جائیں۔' } },
  { topic: 'qcredits', title: 'Qcredits — what staff can say', source_url: QCREDITS_SRC,
    body: 'Qcredits are issued to Gold and Platinum members on qualification or renewal (publicly reported as 40 for Gold and 60 for Platinum) and are typically valid for 24 months.\n• They can be used for items such as upgrades, extra baggage or lounge access, subject to Privilege Club terms.\n• A balance can only be confirmed in the member\'s own app/account or by an authorised airline system. The loyalty integration in this app is NOT connected unless shown as "Connected" in Admin → Integrations.\n✗ Never promise a Qcredits redemption — refer the request to Qatar Airways.',
    passenger: { en: 'Your Qcredits balance and how you can use it are shown in your Privilege Club app. Qatar Airways staff can confirm options for you.', hi: 'आपका Qcredits बैलेंस और उसका उपयोग आपके प्रिविलेज क्लब ऐप में दिखता है। क़तर एयरवेज़ का स्टाफ़ आपके विकल्पों की पुष्टि कर सकता है।', ar: 'يظهر رصيد Qcredits وطرق استخدامه في تطبيق نادي الامتياز. يمكن لموظفي الخطوط الجوية القطرية تأكيد الخيارات المتاحة لك.', ur: 'آپ کا Qcredits بیلنس اور اس کا استعمال آپ کی پریولیج کلب ایپ میں دکھایا جاتا ہے۔ قطر ایئرویز کا عملہ آپ کے اختیارات کی تصدیق کر سکتا ہے۔' } },
  { topic: 'upgrade', title: 'Ticket upgrades (Avios, Qcredits or paid)', source_url: QCREDITS_SRC,
    body: 'Upgrades are subject to seat availability and fare rules. Award upgrades are only available on Qatar Airways-operated flights.\n• An upgraded ticket does not automatically include lounge access — lounge entry follows the airline lounge policy.\n• Staff role: listen, explain options, and open an "Upgrade request" case in this app. A SUPERVISOR must approve before any commitment is made.\n• Final processing happens in the airline reservation system (not connected to this app).\n✗ Never confirm an upgrade to a passenger until the airline system confirms it.',
    passenger: { en: 'Upgrades depend on availability and fare rules. A supervisor must review your request, and it is only confirmed once the airline system confirms it.', hi: 'अपग्रेड सीटों की उपलब्धता और किराया नियमों पर निर्भर करता है। आपके अनुरोध की समीक्षा सुपरवाइज़र करेंगे, और एयरलाइन सिस्टम में पुष्टि होने पर ही यह पक्का होगा।', ar: 'تعتمد الترقية على توفر المقاعد وقواعد الأجرة. يجب أن يراجع المشرف طلبك، ولا يتم تأكيده إلا بعد تأكيد نظام شركة الطيران.', ur: 'اپ گریڈ سیٹوں کی دستیابی اور کرایے کے قواعد پر منحصر ہے۔ سپروائزر آپ کی درخواست کا جائزہ لیں گے، اور ایئرلائن سسٹم کی تصدیق کے بعد ہی یہ پکا ہوگا۔' } },
  { topic: 'lounge', title: 'Lounge access — verification procedure', source_url: HIA_LOUNGES,
    body: '1. View the boarding pass: departure from DOH today, operating carrier, cabin class.\n2. If access is based on status, view the membership card or app (tier and validity).\n3. Open an "Eligibility check" case in this app and complete every checklist item.\n4. Record the decision. On approval, give the passenger the verification code shown.\n• These rules are guidance only; the lounge reception makes the final entry decision.\n• Paid access: quote only the price displayed by the lounge operator.',
    passenger: { en: 'Lounge entry depends on your ticket and membership. I will check your documents now — this only takes a moment.', hi: 'लाउंज में प्रवेश आपके टिकट और सदस्यता पर निर्भर करता है। अभी आपके दस्तावेज़ देखे जा रहे हैं — इसमें बस एक पल लगेगा।', ar: 'يعتمد دخول الصالة على تذكرتك وعضويتك. سأتحقق من مستنداتك الآن — لن يستغرق ذلك سوى لحظة.', ur: 'لاؤنج میں داخلہ آپ کے ٹکٹ اور رکنیت پر منحصر ہے۔ ابھی آپ کے دستاویزات دیکھے جا رہے ہیں — اس میں بس ایک لمحہ لگے گا۔' } },
  { topic: 'privacy', title: 'Handling membership and personal data', source_url: null,
    body: '• Never ask for passwords, PINs or one-time codes.\n• The app stores only the last 4 digits of a membership number in case records — do not write full numbers in notes.\n• Conversation transcripts are only saved when the passenger consents and the feature is enabled by an administrator; they are deleted automatically after the retention period.',
    passenger: { en: 'We never ask for your password or PIN.', hi: 'हम कभी भी आपका पासवर्ड या पिन नहीं माँगते।', ar: 'لن نطلب منك أبداً كلمة المرور أو الرقم السري.', ur: 'ہم کبھی بھی آپ کا پاس ورڈ یا پن نہیں مانگتے۔' } },
];

export async function seed(db, cfg, log = console.log) {
  const now = Date.now();
  const hasUsers = db.get('SELECT COUNT(*) n FROM users').n > 0;
  // Languages: every built-in language and language pack is enabled the first time it is seen. After that the
  // administrator's choice (enabled/disabled) is kept; a language that gains a full pack is upgraded to "built-in".
  const metaCodes = new Set(LANGUAGE_META.map(l => l.code));
  const seen = new Set(JSON.parse(db.getSetting('lang_packs_seen', null) ?? '[]'));
  const freshLangs = !db.get('SELECT 1 FROM languages LIMIT 1');
  LANGUAGE_META.forEach((l, i) => {
    const cur = db.get('SELECT builtin FROM languages WHERE code = ?', l.code);
    if (!cur) db.run('INSERT INTO languages(code,name,native_name,speech_code,rtl,enabled,builtin,sort) VALUES(?,?,?,?,?,1,1,?)', l.code, l.name, l.native, l.speech, l.rtl, i);
    else if (!cur.builtin && !seen.has(l.code)) db.run('UPDATE languages SET name=?, native_name=?, speech_code=?, rtl=?, builtin=1, enabled=1, sort=? WHERE code=?', l.name, l.native, l.speech, l.rtl, i, l.code);
    seen.add(l.code);
  });
  if (freshLangs) EXTRA_LANGS.filter(([code]) => !metaCodes.has(code)).forEach(([code, name, native, speech, rtl], i) => db.run('INSERT INTO languages(code,name,native_name,speech_code,rtl,enabled,builtin,sort) VALUES(?,?,?,?,?,0,0,?)', code, name, native, speech, rtl, 500 + i));
  db.setSetting('lang_packs_seen', JSON.stringify([...seen]));
  const insertMap = () => {
    const { locs, edges } = buildMap();
    for (const n of locs) db.run('INSERT INTO locations(id,type,name,concourse,level,x,y,simulated,accessible,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      n.id, n.type, n.name, n.concourse, n.level, n.x, n.y, n.simulated, n.accessible, n.status, n.notes);
    for (const e of edges) db.run('INSERT INTO edges(a,b,distance_m,kind,step_free) VALUES(?,?,?,?,?)', e.a, e.b, e.distance_m, e.kind, e.step_free);
    for (const l of LOUNGES) db.run('INSERT INTO lounges(id,location_id,name,operator,hours,rules,amenities,paid_access,status,simulated,source_url,notes) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)',
      l.id, l.location_id, l.name, l.operator, JSON.stringify(l.hours), JSON.stringify(l.rules), JSON.stringify(l.amenities), l.paid_access, l.status, l.source_url, l.notes);
  };
  const freshDb = !db.get('SELECT 1 FROM locations LIMIT 1');
  if (freshDb) {
    db.tx(insertMap);
  } else if (Number(db.getSetting('map_seed_version', 1)) < MAP_SEED_VERSION) {
    // Upgrade an untouched seed map in place; never overwrite an administrator's own map or lounge edits.
    const edited = db.get(`SELECT 1 FROM audit_log WHERE action LIKE 'location.%' OR action LIKE 'edge.%' OR action = 'map.import' OR action LIKE 'lounge.%' LIMIT 1`);
    if (edited) {
      log('[seed] A newer approximate map (v2, built from public HIA information) is available, but this database has administrator map/lounge edits, so it was not replaced. Run `npm run reset-db` to start fresh.');
    } else {
      db.tx(() => { db.run('DELETE FROM lounges'); db.run('DELETE FROM edges'); db.run('DELETE FROM locations'); insertMap(); });
      log('[seed] Map upgraded to v2 (approximate, built from public HIA information).');
    }
  }
  db.setSetting('map_seed_version', MAP_SEED_VERSION);
  if (!db.get('SELECT 1 FROM flights_sim LIMIT 1')) {
    for (const r of SIM_FLIGHTS) db.run('INSERT INTO flights_sim(flight_no,airline,destination,destination_code,dep_offset_min,gate,status) VALUES(?,?,?,?,?,?,?)', ...r.slice(0, 4), r[4], r[5], r[6]);
  }
  const insertFaq = q => {
    const tr = Object.fromEntries(Object.entries(q.tr).map(([k, [qq, a]]) => [k, { q: qq, a }]));
    db.run('INSERT INTO faqs(category,translations,keywords,source_url,verified_on,published,updated_at) VALUES(?,?,?,?,?,1,?)', q.category, JSON.stringify(tr), q.keywords, q.source, q.source ? VERIFIED_ON : null, now);
  };
  if (!db.get('SELECT 1 FROM faqs LIMIT 1')) {
    for (const q of FAQS) insertFaq(q);
  } else if (Number(db.getSetting('faq_seed_version', 1)) < 2) {
    // Add help topics introduced with seed v2 (matched by English question); existing ones are left untouched.
    const have = new Set(db.all('SELECT translations FROM faqs').map(r => { try { return JSON.parse(r.translations)?.en?.q; } catch { return null; } }));
    for (const q of FAQS) if (q.since === 2 && !have.has(q.tr.en[0])) insertFaq(q);
  }
  db.setSetting('faq_seed_version', 2);
  if (!db.get('SELECT 1 FROM guidance LIMIT 1')) {
    for (const g of GUIDANCE) db.run(`INSERT INTO guidance(topic,title,body,passenger_text,status,version,approved_by,approved_at,source_url,updated_at) VALUES(?,?,?,?,'approved',1,?,?,?,?)`,
      g.topic, g.title, g.body, JSON.stringify(g.passenger), 'Seed content — SIMULATED approval (replace with your authorised text)', now, g.source_url, now);
  }
  const defaults = {
    demo_flights: !!cfg.demoMode, walk_speed_m_per_min: 75, step_free_speed_m_per_min: 50, default_location: 'PLAZA',
    store_transcripts: false, transcript_retention_days: 7, analytics_enabled: true, analytics_min_count: 5, analytics_retention_days: 400,
    assistant_use_llm: true, map_is_simulated: true, train_minutes: 4, flight_cache_seconds: 120, support_retention_days: 7,
  };
  for (const [k, v] of Object.entries(defaults)) if (db.getSetting(k) === undefined) db.setSetting(k, v);

  if (!hasUsers) {
    if (cfg.demoMode) {
      const demo = [['staff', 'Staff (Information Desk)', 'staff', 'Staff#2026demo'], ['supervisor', 'Supervisor', 'supervisor', 'Super#2026demo'], ['admin', 'Administrator', 'admin', 'Admin#2026demo']];
      for (const [u, n, r, p] of demo) db.run('INSERT INTO users(username,display_name,password_hash,role,is_demo,created_at) VALUES(?,?,?,?,1,?)', u, n, await hashPassword(p), r, now);
      log('[seed] Demo accounts created (DEMO MODE): staff / supervisor / admin — see README.');
    } else {
      const username = process.env.ADMIN_USERNAME || 'admin';
      const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
      db.run('INSERT INTO users(username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?)', username, 'Administrator', await hashPassword(password), 'admin', now);
      if (!process.env.ADMIN_PASSWORD) log(`[seed] Initial administrator created. Username: ${username}  Password: ${password}  (shown once — change it immediately)`);
    }
  }
}
