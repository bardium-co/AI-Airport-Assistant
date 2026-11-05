import { authHeaders, joinUrl } from './integrations.js';
import { STATUS_KEYS } from './phrases.js';
import { cityForIata } from './airports.js';

// Flight data. Never invents data:
//  • a live provider is connected (authorised + enabled + tested) → only that provider is used; errors are reported,
//    never replaced by simulated data (a recent cached board may be shown, clearly marked with its age)
//  • otherwise, if demo flights are enabled → the clearly-labelled simulated table
//  • otherwise → "unavailable"
//
// Live providers:
//  • authorised_feed — the airport's own AODB/FIDS JSON feed (contract below)
//  • aerodatabox    — AeroDataBox (api.aerodatabox.com, X-Api-Key; or RapidAPI, X-RapidAPI-Key)
//  • airlabs        — AirLabs v9 (airlabs.co/api/v9, api_key query parameter)

const FLIGHT_RE = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})$/;

export function normalizeFlightNo(input) {
  const s = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  const m = s.match(FLIGHT_RE);
  if (!m) return null;
  return m[1] + String(Number(m[2]));
}

const ADB_STATUS = {
  unknown: 'scheduled', expected: 'scheduled', checkin: 'scheduled', boarding: 'boarding', gateclosed: 'gate_closed',
  departed: 'departed', enroute: 'departed', approaching: 'departed', arrived: 'departed', diverted: 'departed',
  delayed: 'delayed', canceled: 'cancelled', cancelled: 'cancelled', canceleduncertain: 'cancelled',
};
const AIRLABS_STATUS = { scheduled: 'scheduled', active: 'departed', 'en-route': 'departed', landed: 'departed', cancelled: 'cancelled', canceled: 'cancelled' };
const AIRLINE_NAMES = {
  QR: 'Qatar Airways', EK: 'Emirates', EY: 'Etihad Airways', FZ: 'flydubai', G9: 'Air Arabia', WY: 'Oman Air', GF: 'Gulf Air', SV: 'Saudia', KU: 'Kuwait Airways',
  AI: 'Air India', IX: 'Air India Express', '6E': 'IndiGo', UK: 'Vistara', SG: 'SpiceJet', PK: 'PIA', BG: 'Biman Bangladesh', UL: 'SriLankan Airlines', RA: 'Nepal Airlines',
  BA: 'British Airways', LH: 'Lufthansa', AF: 'Air France', KL: 'KLM', TK: 'Turkish Airlines', SQ: 'Singapore Airlines', CX: 'Cathay Pacific', PR: 'Philippine Airlines',
  '5J': 'Cebu Pacific', MH: 'Malaysia Airlines', GA: 'Garuda Indonesia', TG: 'Thai Airways', ET: 'Ethiopian Airlines', KQ: 'Kenya Airways', MS: 'EgyptAir', RJ: 'Royal Jordanian',
  ME: 'Middle East Airlines', IR: 'Iran Air', AA: 'American Airlines', UA: 'United Airlines', DL: 'Delta Air Lines', QF: 'Qantas', JL: 'Japan Airlines', NH: 'ANA', KE: 'Korean Air',
  OZ: 'Asiana Airlines', CA: 'Air China', MU: 'China Eastern', CZ: 'China Southern', AZ: 'ITA Airways', IB: 'Iberia', LX: 'SWISS', OS: 'Austrian',
  VS: 'Virgin Atlantic', PC: 'Pegasus', J9: 'Jazeera Airways', XY: 'flynas', F3: 'flyadeal', OV: 'SalamAir', S2: 'Sky Express', BS: 'US-Bangla',
};

const iso = s => {
  if (!s) return null;
  let v = String(s).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) v += ':00Z';           // AirLabs "*_utc": "2021-07-14 23:53" (UTC)
  if (/T\d{2}:\d{2}Z$/.test(v)) v = v.replace(/Z$/, ':00Z');            // AeroDataBox "2024-05-01 10:30Z"
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const clean = v => (v == null || v === '' ? null : String(v).trim());

function qatarDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

// ---------------------------------------------------------------- provider adapters
function adbBase(cfg) {
  if (cfg.baseUrl) return cfg.baseUrl;
  return cfg.gateway === 'rapidapi' ? 'https://aerodatabox.p.rapidapi.com' : 'https://api.aerodatabox.com';
}
function adbHeaders(cfg) {
  if (cfg.gateway === 'rapidapi') return { Accept: 'application/json', 'X-RapidAPI-Key': cfg.apiKey, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' };
  return { Accept: 'application/json', 'X-Api-Key': cfg.apiKey };
}
function adbFlight(item, airport) {
  // FIDS items carry `departure` (this airport) + `arrival` (destination) when withLeg=true, or `movement`
  // (times at this airport, `airport` = the other end) when legs are not requested.
  const dep = item.departure ?? item.movement ?? {};
  const destAirport = item.arrival?.airport ?? item.movement?.airport ?? {};
  const depAirport = item.departure?.airport;
  if (depAirport?.iata && depAirport.iata !== airport) return null;
  const scheduled = iso(dep.scheduledTime?.utc ?? dep.scheduledTimeUtc);
  if (!scheduled) return null;
  const revised = iso(dep.revisedTime?.utc ?? dep.predictedTime?.utc);
  const flightNo = normalizeFlightNo(item.number);
  if (!flightNo) return null;
  return {
    flightNo, airline: clean(item.airline?.name) ?? AIRLINE_NAMES[flightNo.slice(0, 2)] ?? '',
    destination: clean(destAirport.municipalityName) ?? clean(destAirport.shortName) ?? clean(destAirport.name) ?? clean(destAirport.iata) ?? '',
    destinationCode: clean(destAirport.iata) ?? '',
    scheduledDeparture: scheduled, estimatedDeparture: revised && revised !== scheduled ? revised : undefined,
    terminal: clean(dep.terminal), gate: clean(dep.gate)?.toUpperCase() ?? null,
    status: ADB_STATUS[String(item.status ?? '').toLowerCase()] ?? 'scheduled', simulated: false,
  };
}
const ADB = {
  async board(cfg, now) {
    const airport = (cfg.airport || 'DOH').toUpperCase();
    const url = joinUrl(adbBase(cfg), `flights/airports/iata/${airport}?offsetMinutes=-60&durationMinutes=720&direction=Departure&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false`);
    const data = await getJson(url, adbHeaders(cfg));
    if (!data || !Array.isArray(data.departures)) throw new Error('Unexpected AeroDataBox response (no "departures")');
    return data.departures.map(d => adbFlight(d, airport)).filter(Boolean);
  },
  async flight(cfg, flightNo, now) {
    const airport = (cfg.airport || 'DOH').toUpperCase();
    const url = joinUrl(adbBase(cfg), `flights/number/${encodeURIComponent(flightNo)}/${qatarDate(now)}?withAircraftImage=false&withLocation=false`);
    const data = await getJson(url, adbHeaders(cfg), { allow404: true });
    if (!data) return null;
    const legs = Array.isArray(data) ? data : [data];
    for (const leg of legs) {
      if (leg?.departure?.airport?.iata !== airport) continue;
      const f = adbFlight(leg, airport);
      if (f) return f;
    }
    return null;
  },
  async test(cfg) {
    const airport = (cfg.airport || 'DOH').toUpperCase();
    const data = await getJson(joinUrl(adbBase(cfg), `airports/iata/${airport}`), adbHeaders(cfg));
    return `AeroDataBox reachable — airport ${data?.iata ?? airport}${data?.name ? ` (${data.name})` : ''}`;
  },
};

function airlabsUrl(cfg, path, params) {
  const u = new URL(joinUrl(cfg.baseUrl || 'https://airlabs.co/api/v9', path));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('api_key', cfg.apiKey);
  return u.toString();
}
/** "2026-11-05 19:53" in the airport's local time → ISO (UTC), using the IANA zone of the airport. */
export function localToIso(s, timeZone = 'Asia/Qatar') {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // Offset of the zone at that moment (handles DST zones too; Qatar has none).
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(asUtc)).map(p => [p.type, p.value]));
  const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(asUtc - (zoned - asUtc)).toISOString();
}

// AirLabs: the free plan documents only flight_iata, airline_iata, flight_number, dep_iata, dep_time (local),
// arr_iata and arr_time; gate, terminal, status and UTC times may be missing. Missing data stays missing:
// no gate → "not assigned yet", no status → unknown (null), never assumed.
function airlabsFlight(it, airport, tz) {
  if (it.dep_iata && it.dep_iata !== airport) return null;
  const flightNo = normalizeFlightNo(it.flight_iata);
  const scheduled = iso(it.dep_time_utc) ?? localToIso(it.dep_time, tz);
  if (!flightNo || !scheduled) return null;
  const est = iso(it.dep_estimated_utc) ?? localToIso(it.dep_estimated, tz);
  let status = it.status == null ? null : (AIRLABS_STATUS[String(it.status).toLowerCase()] ?? null);
  if (status === 'scheduled' && Number(it.dep_delayed) >= 15) status = 'delayed';
  const code = clean(it.arr_iata);
  return {
    flightNo, airline: AIRLINE_NAMES[clean(it.airline_iata) ?? ''] ?? clean(it.airline_iata) ?? '',
    destination: clean(it.arr_city) ?? cityForIata(code) ?? code ?? '', destinationCode: code ?? '',
    scheduledDeparture: scheduled, estimatedDeparture: est && est !== scheduled ? est : undefined,
    terminal: clean(it.dep_terminal), gate: clean(it.dep_gate)?.toUpperCase() ?? null, status, simulated: false,
    codeshare: !!(it.cs_flight_iata || it.cs_flight_number),
  };
}
const AIRLABS = {
  countsOwnRequests: true,
  async board(cfg, now, { tz, spend } = {}) {
    const airport = (cfg.airport || 'DOH').toUpperCase();
    const pages = Math.min(10, Math.max(1, Number(cfg.maxPages) || 1)); // free keys: 50 rows per request
    const rows = [];
    for (let page = 0, offset = 0; page < pages; page++) {
      await spend?.();
      const data = await getJson(airlabsUrl(cfg, 'schedules', { dep_iata: airport, ...(offset ? { offset } : {}) }), { Accept: 'application/json' });
      if (data?.error) throw new Error(`AirLabs: ${data.error.message ?? data.error.code ?? 'error'}`);
      if (!Array.isArray(data?.response)) throw new Error('Unexpected AirLabs response (no "response")');
      rows.push(...data.response);
      if (!data.request?.has_more || !data.response.length) break;
      offset += data.response.length;
    }
    // Drop marketing codeshare duplicates (they carry cs_* fields pointing at the operating flight).
    const seen = new Set();
    return rows.map(it => airlabsFlight(it, airport, tz)).filter(f => f && !f.codeshare && !seen.has(f.flightNo) && seen.add(f.flightNo)).map(({ codeshare, ...f }) => f);
  },
  async flight(cfg, flightNo, now, { tz, spend } = {}) {
    const airport = (cfg.airport || 'DOH').toUpperCase();
    await spend?.();
    const data = await getJson(airlabsUrl(cfg, 'flight', { flight_iata: flightNo }), { Accept: 'application/json' }, { allow404: true });
    if (data?.error) { if (/not.?found/i.test(data.error.code ?? data.error.message ?? '')) return null; throw new Error(`AirLabs: ${data.error.message ?? data.error.code}`); }
    const it = data?.response;
    if (!it || Array.isArray(it)) return null;
    const f = airlabsFlight(it, airport, tz);
    if (!f) return null;
    const { codeshare, ...out } = f;
    return out;
  },
  /** Key check plus a one-page sample, so the admin sees what this plan actually returns. */
  async test(cfg) {
    const ping = await getJson(airlabsUrl(cfg, 'ping', {}), { Accept: 'application/json' });
    if (ping?.error) throw new Error(`AirLabs: ${ping.error.message ?? ping.error.code}`);
    const airport = (cfg.airport || 'DOH').toUpperCase();
    const data = await getJson(airlabsUrl(cfg, 'schedules', { dep_iata: airport }), { Accept: 'application/json' });
    if (data?.error) throw new Error(`AirLabs schedules: ${data.error.message ?? data.error.code}`);
    const rows = Array.isArray(data?.response) ? data.response : [];
    const has = k => rows.some(r => r[k] != null && r[k] !== '');
    const yes = b => (b ? 'yes' : 'NO');
    return `AirLabs connected — ${rows.length} departures from ${airport} in one request${data?.request?.has_more ? ' (more pages available)' : ''}. ` +
      `Your plan returns: gates ${yes(has('dep_gate'))}, status ${yes(has('status'))}, terminals ${yes(has('dep_terminal'))}, delays ${yes(has('dep_delayed') || has('dep_estimated'))}.`;
  },
};

function authorisedFlight(d, flightNo) {
  if (!d || typeof d !== 'object') throw new Error('Malformed feed response');
  const dep = new Date(d.estimatedDeparture || d.scheduledDeparture);
  if (Number.isNaN(dep.getTime())) throw new Error('Feed response missing departure time');
  const status = STATUS_KEYS.includes(d.status) ? d.status : 'scheduled';
  return {
    flightNo: normalizeFlightNo(d.flightNo) || flightNo,
    airline: String(d.airline ?? ''), destination: String(d.destination ?? ''), destinationCode: String(d.destinationCode ?? ''),
    scheduledDeparture: new Date(d.scheduledDeparture ?? dep).toISOString(),
    estimatedDeparture: d.estimatedDeparture ? dep.toISOString() : undefined,
    terminal: d.terminal ? String(d.terminal) : null,
    gate: d.gate ? String(d.gate).toUpperCase() : null, status, simulated: false,
  };
}
const AUTHORISED = {
  async board(cfg) {
    const data = await getJson(joinUrl(cfg.baseUrl, 'departures'), { Accept: 'application/json', ...authHeaders(cfg) }, { allow404: true });
    if (data == null) return null; // feed has no departures endpoint → board unavailable, lookups still work
    const list = Array.isArray(data) ? data : data.departures;
    if (!Array.isArray(list)) throw new Error('Unexpected feed response (expected an array of departures)');
    return list.map(d => { try { return authorisedFlight(d, normalizeFlightNo(d.flightNo)); } catch { return null; } }).filter(f => f?.flightNo);
  },
  async flight(cfg, flightNo) {
    const data = await getJson(joinUrl(cfg.baseUrl, `flights/${encodeURIComponent(flightNo)}`), { Accept: 'application/json', ...authHeaders(cfg) }, { allow404: true });
    return data ? authorisedFlight(data, flightNo) : null;
  },
  async test(cfg) {
    const res = await fetch(joinUrl(cfg.baseUrl, 'health'), { headers: authHeaders(cfg), signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Health check HTTP ${res.status}`);
    return 'Feed health check passed';
  },
};

const PROVIDERS = { authorised_feed: AUTHORISED, aerodatabox: ADB, airlabs: AIRLABS };
export const PROVIDER_LABELS = { authorised_feed: 'Airport flight feed', aerodatabox: 'AeroDataBox', airlabs: 'AirLabs' };

async function getJson(url, headers, { allow404 = false } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (allow404 && (res.status === 404 || res.status === 204)) return null;
  if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} — API key rejected or plan does not include this endpoint`);
  if (res.status === 429) throw new Error('HTTP 429 — provider quota or rate limit reached');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { throw new Error('Provider returned non-JSON data'); }
}

// ---------------------------------------------------------------- service
export class FlightService {
  constructor(db, integrations, { timeZone = 'Asia/Qatar' } = {}) {
    this.db = db; this.integrations = integrations; this.timeZone = timeZone;
    this.cache = null;        // { key, at, flights, error }
    this.inflight = null;
    this.flightCache = new Map(); // flightNo → { at, result }
  }

  simulatedEnabled() { return !!this.db.getSetting('demo_flights', false); }
  /** Cache lifetime. With a daily request budget, refreshes are spread over the day (80% for the board, 20% kept for single lookups). */
  ttl(live = this.live()) {
    const base = Math.max(30, Number(this.db.getSetting('flight_cache_seconds', 120)));
    const budget = this.budget(live);
    if (!budget) return base * 1000;
    const perRefresh = live.provider === 'airlabs' ? Math.min(10, Math.max(1, Number(live.config.maxPages) || 1)) : 1;
    return Math.max(base, Math.ceil((86400 * perRefresh) / (budget * 0.8))) * 1000;
  }

  budget(live = this.live()) { const b = Math.floor(Number(live?.config?.dailyBudget)); return b > 0 ? b : 0; }

  /** Today's provider request count (persisted, Qatar calendar day). */
  usage(now = Date.now()) {
    const day = qatarDate(now);
    const u = this.db.getSetting('flight_api_usage', null);
    return u && u.day === day ? u : { day, n: 0 };
  }

  /** Count one provider request; refuse once the daily budget is used up. */
  spender(live, now) {
    return async () => {
      const budget = this.budget(live);
      const u = this.usage(now);
      if (budget && u.n >= budget) throw new Error(`Daily request budget reached (${budget}) — the last update is shown until tomorrow (Qatar time)`);
      this.db.setSetting('flight_api_usage', { day: u.day, n: u.n + 1 });
    };
  }

  live() {
    const c = this.integrations.active('flights');
    return c && PROVIDERS[c.provider] ? c : null;
  }

  source() {
    if (this.live()) return 'live';
    if (this.simulatedEnabled()) return 'simulated';
    return 'none';
  }

  provider() { const c = this.live(); return c ? { id: c.provider, label: PROVIDER_LABELS[c.provider] } : null; }

  invalidate() { this.cache = null; this.flightCache.clear(); }

  /** Departures board (cached). Returns { source, provider, updatedAt, stale, flights, error? }. */
  async departures(now = Date.now()) {
    const live = this.live();
    if (!live) {
      if (!this.simulatedEnabled()) return { source: 'none', flights: [] };
      const flights = this.db.all('SELECT * FROM flights_sim').map(r => simulatedToFlight(r, now)).sort(byTime);
      return { source: 'simulated', updatedAt: new Date(now).toISOString(), flights };
    }
    const key = `${live.provider}:${live.config.airport ?? ''}:${live.config.baseUrl ?? ''}`;
    const fresh = this.cache && this.cache.key === key && now - this.cache.at < this.ttl(live);
    if (!fresh) {
      this.inflight ??= (async () => {
        try {
          const p = PROVIDERS[live.provider];
          const spend = this.spender(live, now);
          if (!p.countsOwnRequests) await spend();
          const flights = await p.board(live.config, now, { tz: this.timeZone, spend });
          this.cache = { key, at: Date.now(), flights: flights ?? null, error: null };
        } catch (e) {
          const prev = this.cache?.key === key ? this.cache : null;
          this.cache = { key, at: prev?.at ?? 0, flights: prev?.flights ?? null, error: String(e.message ?? e), failedAt: Date.now() };
        } finally { this.inflight = null; }
      })();
      await this.inflight;
    }
    const c = this.cache;
    const provider = this.provider();
    const maxStale = Math.max(15 * 60 * 1000, this.ttl(live)); // never older than one planned refresh interval
    if (c.flights && (!c.error || now - c.at < maxStale)) {
      const window = c.flights.filter(f => Date.parse(f.estimatedDeparture ?? f.scheduledDeparture) > now - 30 * 60000).sort(byTime);
      return { source: 'live', provider, updatedAt: new Date(c.at).toISOString(), stale: !!c.error, flights: window, ...(c.error ? { error: c.error } : {}) };
    }
    if (c.flights === null && !c.error) return { source: 'live', provider, flights: [], boardUnavailable: true };
    return { source: 'live', provider, flights: [], error: c.error ?? 'unavailable' };
  }

  /** Look up a single flight departing from the configured airport. */
  async lookup(input, now = Date.now()) {
    const flightNo = normalizeFlightNo(input);
    if (!flightNo) return { status: 'invalid', source: this.source() };
    const live = this.live();
    if (live) {
      // Paid APIs: cache single-flight answers to protect quota. The airport's own feed is always asked directly.
      const useCache = live.provider !== 'authorised_feed';
      const cached = useCache && this.flightCache.get(flightNo);
      if (cached && now - cached.at < this.ttl(live)) return cached.result;
      try {
        // The cached departures board answers most lookups without spending provider quota.
        const board = await this.departures(now);
        let flight = !board.error || board.stale ? board.flights.find(f => f.flightNo === flightNo) : null;
        if (!flight) {
          const p = PROVIDERS[live.provider];
          const spend = this.spender(live, now);
          if (!p.countsOwnRequests && live.provider !== 'authorised_feed') await spend();
          flight = await p.flight(live.config, flightNo, now, { tz: this.timeZone, spend });
        }
        const result = flight
          ? { status: 'found', source: 'live', provider: this.provider(), flightNo, flight, updatedAt: board.updatedAt }
          : { status: 'not_found', source: 'live', provider: this.provider(), flightNo };
        if (useCache) this.flightCache.set(flightNo, { at: now, result });
        if (this.flightCache.size > 500) this.flightCache.delete(this.flightCache.keys().next().value);
        return result;
      } catch (e) {
        return { status: 'error', source: 'live', provider: this.provider(), flightNo, detail: String(e.message ?? e) };
      }
    }
    if (!this.simulatedEnabled()) return { status: 'unavailable', source: 'none', flightNo };
    const row = this.db.get('SELECT * FROM flights_sim WHERE flight_no = ?', flightNo);
    if (!row) return { status: 'not_found', source: 'simulated', flightNo };
    return { status: 'found', source: 'simulated', flightNo, flight: simulatedToFlight(row, now) };
  }
}

const byTime = (a, b) => Date.parse(a.estimatedDeparture ?? a.scheduledDeparture) - Date.parse(b.estimatedDeparture ?? b.scheduledDeparture);

export function simulatedToFlight(row, now) {
  // Simulated departures are anchored relative to "now" (rounded to 5 min) so the demo stays coherent.
  const base = Math.ceil(now / 300000) * 300000;
  const dep = new Date(base + row.dep_offset_min * 60000);
  return {
    flightNo: row.flight_no, airline: row.airline, destination: row.destination, destinationCode: row.destination_code,
    scheduledDeparture: dep.toISOString(), gate: row.gate || null, status: row.status, simulated: true,
  };
}

export async function testFlightFeed(cfg) {
  const p = PROVIDERS[cfg.provider];
  if (!p) throw new Error('Unknown flight data provider');
  return p.test(cfg.config);
}

/** Exposed for tests. */
export const _internals = { adbFlight, airlabsFlight, iso, localToIso };
