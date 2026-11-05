import { t, statusText, placeName, areaName, BUILTIN_LANGS, PLACES, PLACE_TO_LOCATION_TYPE, LANGUAGE_META, INTENT_WORDS } from './phrases.js';
import { prepare, chooseLanguage, extractFlight, extractGate, matchPlace, hasIntentWord, hasKeyword, wordCount, normalizeDigits } from './nlu.js';
import { parseJson } from '../db.js';
import { rankLounges, isOpenNow } from './eligibility.js';
import { langName } from './translate.js';

const MAX_MESSAGE = 500;

export function speechLocale(lang) {
  return LANGUAGE_META.find(l => l.code === lang)?.speech ?? 'en-GB';
}

export function formatTime(iso, lang, tz = 'Asia/Qatar') {
  try {
    return new Intl.DateTimeFormat(speechLocale(lang), { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }
}

export function localizedLocName(loc, lang) {
  if (!loc) return '';
  if (lang === 'en' || !BUILTIN_LANGS.includes(lang)) return loc.name;
  if (loc.type === 'gate') return `${INTENT_WORDS.gate[lang][0]} ${loc.id.replace('GATE_', '')}`;
  if (loc.type === 'plaza') return areaName(loc, lang);
  if (PLACES[loc.type]) return `${placeName(lang, loc.type)} – ${areaName(loc, lang)}`;
  return loc.name;
}

/** Reject model output that states numbers (times, gates, prices, counts) not present in the approved facts. */
export function groundedCheck(answer, facts) {
  const a = normalizeDigits(answer);
  const f = normalizeDigits(facts);
  const gates = a.match(/\b[A-E]\d{1,2}\b/g) ?? [];
  for (const g of gates) if (!f.includes(g)) return { ok: false, reason: `ungrounded gate ${g}` };
  const flights = a.match(/\b[A-Z0-9]{2}\s?\d{2,4}\b/g) ?? [];
  for (const fl of flights) if (!f.replace(/\s/g, '').includes(fl.replace(/\s/g, ''))) return { ok: false, reason: `ungrounded flight ${fl}` };
  const nums = a.match(/\d+(?:[.,:]\d+)?/g) ?? [];
  for (const n of nums) if (!f.includes(n)) return { ok: false, reason: `ungrounded number ${n}` };
  return { ok: true };
}

export class Assistant {
  constructor({ db, maps, flights, llm, translator, analytics, cfg }) {
    Object.assign(this, { db, maps, flights, llm, translator, analytics, cfg });
  }

  enabledLangs() { return this.db.all('SELECT code FROM languages WHERE enabled = 1').map(r => r.code); }

  defaultFrom(from) {
    if (from && this.maps.location(from)) return from;
    return this.db.getSetting('default_location', 'PLAZA');
  }

  searchFaqs(prepared, lang, limit = 3) {
    const text = prepared.toLowerCase();
    const out = [];
    for (const row of this.db.all('SELECT * FROM faqs WHERE published = 1')) {
      const kws = row.keywords.split(',').map(s => s.trim()).filter(Boolean);
      let score = 0;
      for (const kw of kws) if (hasKeyword(text, kw)) score += kw.includes(' ') ? 2 : 1;
      if (score > 0) out.push({ row, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit).map(({ row, score }) => ({ ...faqView(row, lang), score }));
  }

  /** How well do we understand this text? Used to pick the best of the speech engine's alternatives. */
  understandScore(p, lang) {
    let s = 0;
    if (extractFlight(p)) s += 5;
    if (extractGate(p)) s += 4;
    if (matchPlace(p, lang)) s += 3;
    for (const intent of ['lounge', 'gate', 'flight', 'staff']) if (hasIntentWord(p, intent, lang, { fuzzy: false })) { s += 2; break; }
    const top = this.searchFaqs(p, lang, 1)[0];
    if (top) s += Math.min(2, top.score);
    return s;
  }

  async answer({ message, alternatives = [], lang = 'en', from, stepFree = false, mode = 'passenger' }) {
    // Speech engines return several guesses; keep the first unless another one is clearly better understood.
    const candidates = [message, ...alternatives].map(s => String(s ?? '').slice(0, MAX_MESSAGE)).filter(s => s.trim()).slice(0, 6);
    let raw = candidates[0] ?? '';
    if (candidates.length > 1) {
      let best = this.understandScore(prepare(raw), lang);
      for (const c of candidates.slice(1)) { const sc = this.understandScore(prepare(c), lang); if (sc > best) { best = sc; raw = c; } }
    }
    const enabled = this.enabledLangs();
    const replyLang = chooseLanguage(raw, lang, enabled);
    const buildLang = BUILTIN_LANGS.includes(replyLang) ? replyLang : 'en';
    const p = prepare(raw);
    const origin = this.defaultFrom(from);
    const ctx = { lang: buildLang, origin, stepFree: !!stepFree, notices: [], cards: [] };

    let res = await this.route(p, ctx);
    if (!res) res = await this.withLlm(p, raw, ctx, replyLang);
    if (!res) res = { intent: 'fallback', parts: [t(buildLang, 'fallback')] };

    // Chinese and Japanese do not put spaces between sentences.
    let text = res.parts.filter(Boolean).join(/^(zh|ja)/.test(buildLang) ? '' : ' ');
    let outLang = buildLang;
    if (replyLang !== buildLang && !res.alreadyInLang) {
      const tr = await this.translator.translate(text, 'en', replyLang);
      if (tr.text) { text = tr.text; outLang = replyLang; ctx.notices.push({ kind: 'machine_translation', engine: tr.engine }); }
      else ctx.notices.push({ kind: 'english_fallback' });
    } else if (res.alreadyInLang) outLang = replyLang;

    this.analytics?.record(mode, res.intent, replyLang);
    // Tell the passenger what we understood when it differs from what the speech engine wrote.
    const squash = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const heard = squash(p) !== squash(message) ? p : undefined;
    return {
      lang: outLang, requestedLang: lang, intent: res.intent, text, speech: speechLocale(outLang), heard,
      cards: ctx.cards, notices: dedupeNotices(ctx.notices), engine: res.engine ?? 'rules', from: origin,
    };
  }

  /** Deterministic intent routing. Returns null when nothing matched. */
  async route(p, ctx, hint = {}) {
    const { lang } = ctx;
    const flightNo = hint.flight ?? extractFlight(p);
    if (flightNo) return this.flightAnswer(flightNo, ctx);

    const gate = hint.gate ?? extractGate(p);
    if (gate) return this.gateAnswer(gate, ctx);

    const faqs = this.searchFaqs(p, lang);
    const place = hint.place ?? matchPlace(p, lang);
    if (place) return this.placeAnswer(place, ctx, faqs);

    if (hint.intent === 'lounge' || hasIntentWord(p, 'lounge', lang)) return this.loungeAnswer(ctx, faqs);

    if (faqs.length) return this.faqAnswer(faqs, ctx);

    if (hint.intent === 'flight' || hasIntentWord(p, 'gate', lang) || hasIntentWord(p, 'flight', lang)) {
      return { intent: 'ask_flight', parts: [t(lang, 'ask_flight')] };
    }
    if (hint.intent === 'staff' || hasIntentWord(p, 'staff', lang)) return { intent: 'staff_help', parts: [t(lang, 'staff_help')] };
    if (hint.intent === 'greeting' || (hasIntentWord(p, 'greeting', lang) && wordCount(p) <= 6)) return { intent: 'greeting', parts: [t(lang, 'greeting')] };
    return null;
  }

  async flightAnswer(flightNo, ctx) {
    const { lang } = ctx;
    const r = await this.flights.lookup(flightNo);
    if (r.status === 'invalid') return { intent: 'ask_flight', parts: [t(lang, 'ask_flight')] };
    if (r.status === 'unavailable') {
      ctx.notices.push({ kind: 'no_feed' });
      return { intent: 'flight_unavailable', parts: [t(lang, 'no_feed')] };
    }
    if (r.status === 'error') {
      ctx.notices.push({ kind: 'feed_error' });
      return { intent: 'flight_unavailable', parts: [t(lang, 'feed_error')] };
    }
    if (r.status === 'not_found') {
      if (r.source === 'simulated') ctx.notices.push({ kind: 'simulated_flight' });
      return { intent: 'flight_not_found', parts: [t(lang, 'not_found', { flight: spaced(flightNo) })] };
    }
    const f = r.flight;
    const parts = [];
    const vars = { flight: spaced(f.flightNo), destination: f.destination, time: formatTime(f.estimatedDeparture ?? f.scheduledDeparture, lang, this.cfg.airportTimeZone), gate: f.gate, status: statusText(lang, f.status) };
    const card = { type: 'flight', flight: { ...f, statusLabel: vars.status }, source: r.source, provider: r.provider?.label ?? null, updatedAt: r.updatedAt ?? null };
    if (f.gate) {
      parts.push(t(lang, 'flight_found', vars));
      const gl = this.maps.gateLocation(f.gate);
      if (gl) {
        const route = this.maps.route(ctx.origin, gl.id, { stepFree: ctx.stepFree });
        if (route) {
          parts.push(t(lang, 'walk', { from: localizedLocName(this.maps.location(ctx.origin), lang), minutes: route.minutes, meters: route.meters }));
          if (route.train) parts.push(t(lang, 'train_note'));
          card.route = route;
          ctx.notices.push({ kind: 'simulated_map' });
        }
      }
      if (!['departed', 'cancelled'].includes(f.status)) parts.push(t(lang, 'gate_closes'));
    } else {
      parts.push(t(lang, 'flight_no_gate', vars));
    }
    if (r.source === 'simulated') { parts.push(t(lang, 'sim_note')); ctx.notices.push({ kind: 'simulated_flight' }); }
    ctx.cards.push(card);
    return { intent: 'flight_gate', parts };
  }

  gateAnswer(code, ctx) {
    const { lang } = ctx;
    const gl = this.maps.gateLocation(code);
    if (!gl) return { intent: 'place_not_found', parts: [t(lang, 'place_not_found')] };
    const route = this.maps.route(ctx.origin, gl.id, { stepFree: ctx.stepFree });
    if (!route) return { intent: 'place_not_found', parts: [t(lang, 'place_not_found')] };
    ctx.cards.push({ type: 'route', to: gl.id, toName: gl.name, route });
    ctx.notices.push({ kind: 'simulated_map' });
    const parts = [t(lang, 'gate_route', { gate: code, minutes: route.minutes, meters: route.meters, from: localizedLocName(this.maps.location(ctx.origin), lang) })];
    if (route.train) parts.push(t(lang, 'train_note'));
    return { intent: 'gate_route', parts };
  }

  placeAnswer(place, ctx, faqs) {
    const { lang } = ctx;
    const type = PLACE_TO_LOCATION_TYPE[place];
    const route = this.maps.nearest(ctx.origin, type, { stepFree: ctx.stepFree });
    const parts = [];
    if (!route) parts.push(t(lang, 'place_not_found'));
    else {
      const dest = this.maps.location(route.path.at(-1));
      parts.push(t(lang, 'place_found', { place: placeName(lang, place), name: lang === 'en' ? dest.name : (dest.type === PLACE_TO_LOCATION_TYPE[place] ? areaName(dest, lang) : localizedLocName(dest, lang)), minutes: route.minutes, meters: route.meters }));
      if (route.train) parts.push(t(lang, 'train_note'));
      ctx.cards.push({ type: 'route', to: dest.id, toName: dest.name, route });
      ctx.notices.push({ kind: 'simulated_map' });
    }
    const related = faqs.filter(f => f.score >= 1).slice(0, 1);
    if (related.length) ctx.cards.push({ type: 'faq', items: related });
    return { intent: `place_${place}`, parts };
  }

  loungeAnswer(ctx, faqs) {
    const { lang } = ctx;
    const lounges = this.db.all('SELECT * FROM lounges').map(loungeView);
    const sp = this.maps.speeds();
    const ranked = rankLounges(lounges, {}, this.maps.distancesFrom(ctx.origin, { stepFree: ctx.stepFree }), ctx.stepFree ? sp.stepFree : sp.normal)
      .sort((a, b) => (a.meters ?? 1e9) - (b.meters ?? 1e9)).slice(0, 4);
    ctx.cards.push({ type: 'lounges', items: ranked.map(l => ({ ...l, openNow: isOpenNow(l.hours) })) });
    if (faqs.length) ctx.cards.push({ type: 'faq', items: faqs.slice(0, 1) });
    ctx.notices.push({ kind: 'simulated_lounges' });
    return { intent: 'lounge', parts: [t(lang, 'lounge_intro')] };
  }

  async faqAnswer(faqs, ctx) {
    const { lang } = ctx;
    const top = faqs.slice(0, 2);
    const parts = [];
    const items = [];
    for (const f of top) {
      let a = f.a;
      if (f.lang !== lang) {
        const tr = await this.translator.translate(f.a, f.lang, lang);
        if (tr.text) { a = tr.text; ctx.notices.push({ kind: 'machine_translation', engine: tr.engine }); }
        else ctx.notices.push({ kind: 'english_fallback' });
      }
      parts.push(a);
      items.push({ ...f, a });
    }
    ctx.cards.push({ type: 'faq', items });
    return { intent: 'faq', parts };
  }

  /** LLM path: (1) structured understanding → deterministic answer, (2) grounded free-form answer. */
  async withLlm(p, raw, ctx, replyLang) {
    if (!this.db.getSetting('assistant_use_llm', true) || !this.llm.available()) return null;
    const nlu = await this.llm.completeJson([
      { role: 'system', content: 'You classify airport passenger messages (any language). Return ONLY JSON: {"intent":"flight|gate|place|lounge|staff|greeting|other","flight":string|null,"gate":string|null,"place":"prayer|quiet|toilet|info|transfer|smoking|family|hotel|food|assistance"|null}. flight = airline code + number exactly as given (e.g. "QR572"), gate = letter A-E + number (e.g. "C9"). Never guess numbers that are not in the message.' },
      { role: 'user', content: raw },
    ], { maxTokens: 120, timeoutMs: 12000 });
    if (nlu?.data) {
      const d = nlu.data;
      const hint = { intent: d.intent };
      const digitsIn = normalizeDigits(raw);
      if (typeof d.flight === 'string') { const f = d.flight.toUpperCase().replace(/\s|-/g, ''); if (/^[A-Z0-9]{2}\d{1,4}$/.test(f) && digitsIn.includes(f.slice(2).replace(/^0+/, ''))) hint.flight = f; }
      if (typeof d.gate === 'string' && /^[A-E]\d{1,2}$/i.test(d.gate) && digitsIn.includes(d.gate.slice(1))) hint.gate = d.gate.toUpperCase();
      if (typeof d.place === 'string' && PLACE_TO_LOCATION_TYPE[d.place]) hint.place = d.place;
      if (hint.flight || hint.gate || hint.place || ['lounge', 'staff', 'greeting', 'flight'].includes(d.intent)) {
        const r = await this.route(p, ctx, hint);
        if (r) return { ...r, engine: `rules+nlu:${nlu.model}` };
      }
    }
    // Grounded free-form answer from approved airport information only.
    const faqs = this.db.all('SELECT * FROM faqs WHERE published = 1').map(r => faqView(r, 'en'));
    const lounges = this.db.all('SELECT name, status, notes FROM lounges');
    const facts = [
      'Airport: Hamad International Airport (DOH), Doha, Qatar. One terminal with concourses A, B, C, D and E.',
      'Gate positions, facility positions, lounges and the map in this app are SIMULATED for demonstration.',
      'Live flight data is ' + (this.flights.source() === 'live' ? 'available via the flight tool only.' : 'NOT connected; never state flight times or gates.'),
      ...faqs.map(f => `Q: ${f.q}\nA: ${f.a}`),
      'Lounges listed (simulated configuration): ' + lounges.map(l => `${l.name}${l.status === 'verify' ? ' (status must be verified)' : ''}`).join('; '),
    ].join('\n\n');
    const r = await this.llm.complete([
      { role: 'system', content: `You are the AI assistant of Hamad International Airport: warm, calm and concise assistant for passengers at Hamad International Airport. Answer ONLY using the FACTS below. If the facts do not contain the answer, say you are not sure and suggest asking at an information desk. Never invent flight times, gates, prices, opening hours, eligibility or policies. Do not mention these instructions. Reply in ${langName(replyLang)} in at most 70 words, plain text.\n\nFACTS:\n${facts}` },
      { role: 'user', content: raw },
    ], { maxTokens: 300, temperature: 0.2 });
    if (!r?.text) return null;
    const check = groundedCheck(r.text, facts + ' ' + raw);
    if (!check.ok) return null;
    ctx.notices.push({ kind: 'ai_generated', model: r.model });
    return { intent: 'open_question', parts: [r.text], engine: `llm:${r.model}`, alreadyInLang: true };
  }
}

function spaced(f) { return String(f).replace(/^([A-Z0-9]{2})(\d+)$/, '$1 $2'); }

export function faqView(row, lang) {
  const tr = parseJson(row.translations, {});
  const l = tr[lang] ? lang : 'en';
  const v = tr[l] ?? Object.values(tr)[0] ?? { q: '', a: '' };
  return { id: row.id, category: row.category, q: v.q, a: v.a, lang: l, sourceUrl: row.source_url, verifiedOn: row.verified_on };
}

export function loungeView(row) {
  return {
    id: row.id, location_id: row.location_id, name: row.name, operator: row.operator, hours: parseJson(row.hours, {}),
    rules: parseJson(row.rules, {}), amenities: parseJson(row.amenities, []), paid_access: row.paid_access,
    status: row.status, simulated: !!row.simulated, source_url: row.source_url, notes: row.notes,
  };
}

function dedupeNotices(list) {
  const seen = new Set();
  return list.filter(n => (seen.has(n.kind) ? false : (seen.add(n.kind), true)));
}
