import { api, html, raw, mount, $, $$, prefs, savePrefs, toast, icon, fmtTime, debounce, PLACE_ICONS } from '../lib.js';
import { tr, hasUi } from '../i18n.js';
import { speech } from '../speech.js';
import { state, langInfo, applyLang, applyPrefs, loadMap, placeLabel, currentFrom, go } from '../app.js';
import { renderMap } from '../map.js';

const NEARBY = ['toilet', 'prayer', 'food', 'info', 'quiet', 'family', 'assistance', 'transfer', 'smoking'];
const TIERS = [['NONE', null], ['PC_BURGUNDY', 'Privilege Club Burgundy'], ['PC_SILVER', 'Privilege Club Silver'], ['PC_GOLD', 'Privilege Club Gold'], ['PC_PLATINUM', 'Privilege Club Platinum'],
  ['OW_RUBY', 'oneworld Ruby'], ['OW_SAPPHIRE', 'oneworld Sapphire'], ['OW_EMERALD', 'oneworld Emerald'], ['OTHER', null]];

export async function route(v, parts, query) {
  switch (parts[0]) {
    case undefined: return home(v);
    case 'ask': return ask(v, query);
    case 'flight': return flight(v, query);
    case 'map': return mapView(v, query);
    case 'lounges': return lounges(v);
    case 'help': return help(v, query);
    case 'language': return language(v, query);
    case 'settings': return settings(v);
    case 'support': return support(v, parts, query);
    default: return home(v);
  }
}

// ---------- shared helpers ----------
function dohaHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}
function greeting() { const h = dohaHour(); return tr(h < 12 ? 'good_morning' : h < 17 ? 'good_afternoon' : 'good_evening'); }

function area(loc) {
  if (loc.concourse) return tr('area_conc', { c: loc.concourse });
  if (/_S$/.test(loc.id) || /south plaza|lamp bear/i.test(loc.name)) return tr('area_south');
  if (/_N$/.test(loc.id) || /north node|north plaza/i.test(loc.name)) return tr('area_north');
  return tr('area_central');
}
function locName(loc) {
  if (!loc) return '';
  if (loc.type === 'gate') return `${tr('gate')} ${loc.id.replace('GATE_', '')}`;
  if (state.lang === 'en' || !hasUi(state.lang)) return loc.name;
  if (loc.type === 'plaza') return area(loc);
  if (state.meta.places?.[loc.type]) return `${placeLabel(loc.type)} – ${area(loc)}`;
  return loc.name;
}

function simBadge(on = true) {
  return on ? html`<span class="pill pill-sim" title="${tr('n_simulated_flight')}">${icon('info')} ${tr('simulated')}</span>` : html`<span class="pill pill-live">${tr('live')}</span>`;
}

function notices(list = []) {
  if (!list.length) return '';
  return html`<div class="notices">${list.map(n => html`<span class="notice notice-${n.kind}">${icon(n.kind === 'ai_generated' ? 'sparkle' : 'info')}${tr('n_' + n.kind.replace('simulated_flight', 'simulated_flight'))}</span>`)}</div>`;
}

function locationOptions(map, selected, { includeJunctions = false } = {}) {
  const groups = [
    ['Plaza', l => ['plaza', 'transfer'].includes(l.type)],
    [tr('gate'), l => l.type === 'gate'],
    [tr('lounges'), l => l.type === 'lounge'],
    ['•', l => !['plaza', 'transfer', 'gate', 'lounge', 'junction', 'lift'].includes(l.type) || (includeJunctions && l.type === 'junction')],
  ];
  const sortGate = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
  return groups.map(([label, fn]) => html`<optgroup label="${label}">${map.locations.filter(fn).sort(sortGate).map(l => html`<option value="${l.id}" ${l.id === selected ? raw('selected') : ''}>${locName(l)}</option>`)}</optgroup>`);
}

async function pickLocation() {
  const map = await loadMap();
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sheet';
    const quick = map.locations.filter(l => ['plaza', 'transfer'].includes(l.type));
    mount(dlg, html`<form method="dialog" class="sheet-body">
      <h2>${tr('where_are_you')}</h2>
      <div class="quick-locs">${quick.map(l => html`<button class="loc-btn" value="${l.id}">${icon(l.type === 'transfer' ? 'transfer' : 'pin')}<span>${locName(l)}</span></button>`)}</div>
      <label class="field"><span>${tr('gate')} / ${tr('lounges')} / …</span><select name="loc">${locationOptions(map, currentFrom())}</select></label>
      <div class="row-end"><button class="btn" value="">${tr('back')}</button><button class="btn btn-primary" value="__select">${tr('continue')}</button></div>
    </form>`);
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      const val = dlg.returnValue === '__select' ? dlg.querySelector('select').value : dlg.returnValue;
      dlg.remove();
      if (val) { savePrefs({ from: val }); resolve(val); } else resolve(null);
    });
    dlg.showModal();
  });
}

function speakBtn(text, speechCode) {
  if (!speech.ttsSupported()) return '';
  return html`<button type="button" class="speak-btn" data-speak="${text}" data-code="${speechCode}" aria-label="${tr('listen')}">${icon('speaker')}<span>${tr('listen')}</span></button>`;
}
function wireSpeak(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-speak]');
    if (!b) return;
    if (b.classList.contains('speaking')) { speech.cancel(); b.classList.remove('speaking'); return; }
    $$('.speaking', root).forEach(x => x.classList.remove('speaking'));
    b.classList.add('speaking');
    const ok = speech.speak(b.dataset.speak, b.dataset.code, { onEnd: () => b.classList.remove('speaking') });
    if (!ok && !speech.hasVoice(b.dataset.code)) toast('No voice for this language is installed on this device.', 'warn');
  });
}

// ---------- Home ----------
async function home(v) {
  const map = await loadMap().catch(() => null);
  const from = map?.locations.find(l => l.id === currentFrom());
  mount(v, html`<section class="hero">
      <p class="hero-hello">${greeting()} 👋</p>
      <h1>${tr('how_help')}</h1>
      <div class="askbar" role="search">
        <a class="askbar-input" href="#/ask">${icon('search')}<span>${tr('ask_placeholder')}</span></a>
        <a class="mic-btn mic-lg" href="#/ask?voice=1" aria-label="${tr('tap_to_speak')}">${icon('mic')}</a>
      </div>
      <div class="suggest">${['s1', 's2', 's3', 's4'].map(k => html`<a class="chip" href="#/ask?q=${encodeURIComponent(tr(k))}">${tr(k)}</a>`)}</div>
    </section>
    <section class="tiles" aria-label="Quick actions">
      <a class="tile tile-gate" href="#/flight">${icon('plane')}<b>${tr('find_gate')}</b></a>
      <a class="tile tile-map" href="#/map">${icon('map')}<b>${tr('map')}</b></a>
      <a class="tile tile-lounge" href="#/lounges">${icon('sofa')}<b>${tr('lounges')}</b></a>
      <a class="tile tile-help" href="#/help">${icon('help')}<b>${tr('help')}</b></a>
    </section>
    <section class="card where">
      <div class="where-main">${icon('pin')}<div><small>${tr('you_are_at')}</small><b>${from ? locName(from) : '—'}</b></div></div>
      <button class="btn btn-ghost" id="changeLoc">${tr('change')}</button>
    </section>
    <section>
      <h2 class="section-title">${tr('nearby')}</h2>
      <div class="nearby">${NEARBY.slice(0, 6).map(t => html`<a class="near" href="#/map?nearest=${t}">${icon(PLACE_ICONS[t])}<span>${placeLabel(t)}</span></a>`)}</div>
    </section>
    <a class="card staff-card staff-card-strong" href="#/support">${icon('users')}<div><b>${tr('msg_staff')}</b><small>${tr('msg_staff_hint')}</small></div>${icon('chevron', 'flip-rtl')}</a>
    <p class="disclaimer">${tr('disclaimer')}</p>`);
  $('#changeLoc', v).addEventListener('click', async () => { if (await pickLocation()) home(v); });
}

// ---------- Ask (chat) ----------
// When the assistant cannot answer, offer to message staff right inside the answer.
const STAFF_INTENTS = new Set(['fallback', 'staff_help', 'place_not_found', 'flight_not_found', 'flight_unavailable', 'ask_flight']);
function bubble(m) {
  if (m.role === 'user') return html`<div class="msg msg-user" dir="auto"><p>${m.heard ?? m.text}</p>${m.heard ? html`<small class="heard" title="${m.text}">${icon('mic')} “${m.text}”</small>` : ''}</div>`;
  if (m.pending) return html`<div class="msg msg-bot pending" aria-live="polite"><span class="dots"><i></i><i></i><i></i></span><span class="sr-only">${tr('thinking')}</span></div>`;
  if (m.error) return html`<div class="msg msg-bot msg-error"><p>${m.text}</p></div>`;
  const r = m.res;
  const switchLang = r.lang !== state.lang && state.meta.languages.some(l => l.code === r.lang && l.builtin);
  return html`<div class="msg msg-bot" lang="${r.lang}" dir="auto">
    <p class="msg-text">${r.text}</p>
    ${r.cards.map(c => cardView(c))}
    ${STAFF_INTENTS.has(r.intent) ? html`<a class="btn btn-block staff-cta" href="#/support?q=${encodeURIComponent(m.question ?? '')}">${icon('users')} ${tr('msg_staff')}</a>` : ''}
    ${notices(r.notices)}
    <div class="msg-actions">${speakBtn(r.text, r.speech)}
      ${switchLang ? html`<button class="chip chip-switch" data-switch="${r.lang}">${icon('globe')} ${langInfo(r.lang).native}</button>` : ''}</div>
  </div>`;
}

function cardView(c) {
  if (c.type === 'flight') return flightCard(c);
  if (c.type === 'route') return html`<a class="mini-route" href="#/map?to=${c.to}">${icon('walk')}<div><b>${locName(state.map?.locations.find(l => l.id === c.to)) || c.toName}</b><small>${tr('min_walk', { m: c.route.minutes })} · ${c.route.meters} m${c.route.train ? ` · ${tr('train_line')}` : ''}</small></div><span class="btn btn-sm">${icon('map')} ${tr('show_way')}</span></a>`;
  if (c.type === 'lounges') return html`<div class="mini-list">${c.items.map(l => html`<a class="mini-route" href="#/map?to=${l.location_id}">${icon('sofa')}<div><b>${l.name}</b><small>${l.minutes != null ? tr('min_walk', { m: l.minutes }) : ''}${l.openNow ? ` · ${tr('open_now')}` : ''}</small></div>${simBadge(l.simulated)}</a>`)}
    <a class="btn btn-block" href="#/lounges">${icon('sofa')} ${tr('find_lounge')}</a></div>`;
  if (c.type === 'faq') return html`<div class="mini-faq">${c.items.map(f => html`<details><summary>${f.q}</summary><p>${f.a}</p>${f.sourceUrl ? html`<a class="src" href="${f.sourceUrl}" target="_blank" rel="noopener noreferrer">${tr('source')} ↗</a>` : ''}</details>`)}</div>`;
  return '';
}

export function flightCard(c) {
  const f = c.flight;
  const route = c.route;
  const depIso = f.estimatedDeparture ?? f.scheduledDeparture;
  const dep = new Date(depIso);
  const locale = langInfo().speech;
  const closes = new Date(dep.getTime() - 20 * 60000);
  let buffer = '';
  if (f.gate && !['departed', 'cancelled', 'gate_closed'].includes(f.status)) {
    const left = (closes - Date.now()) / 60000 - (route?.minutes ?? 0);
    const level = left > 30 ? 'plenty' : left > 10 ? 'soon' : 'now';
    const pct = Math.max(4, Math.min(100, (left / 90) * 100));
    buffer = html`<div class="buffer buffer-${level}" role="status"><div class="buffer-bar"><i style="width:${pct.toFixed(0)}%"></i></div><b>${tr('time_' + level)}</b><small>${tr('gate_closes_at', { time: fmtTime(closes.toISOString(), locale) })}</small></div>`;
  }
  return html`<article class="flight-card">
    <header><span class="fc-no">${icon('plane')} ${f.flightNo.replace(/^([A-Z0-9]{2})/, '$1 ')}</span>${f.simulated ? simBadge(true) : html`<span class="pill pill-live">${c.provider ? tr('live_from', { source: c.provider }) : tr('live')}</span>`}</header>
    <p class="fc-dest">→ <b>${f.destination}</b> <small>${f.destinationCode}</small></p>
    <div class="fc-grid">
      <div><small>${tr('departs')}</small><b class="fc-time">${fmtTime(depIso, locale)}</b></div>
      <div><small>${tr('gate')}</small><b class="fc-gate">${f.gate ?? '—'}</b>${f.terminal ? html`<small>T${f.terminal}</small>` : ''}</div>
      <div><small>${tr('status')}</small><b class="fc-status st-${f.status}">${f.statusLabel ?? f.status}</b></div>
    </div>
    ${buffer}
    ${c.updatedAt && !f.simulated ? html`<p class="fc-updated">${icon('clock')} ${tr('updated_at', { time: fmtTime(c.updatedAt, locale) })}</p>` : ''}
    ${route ? html`<p class="fc-walk">${icon('walk')} ${tr('min_walk', { m: route.minutes })} · ${route.meters} m${route.train ? ` · ${tr('train_line')}` : ''}</p>
      <a class="btn btn-primary btn-block" href="#/map?to=GATE_${f.gate}">${icon('map')} ${tr('show_way')}</a>` : ''}
  </article>`;
}

let activeListen = null;
async function ask(v, query) {
  await loadMap().catch(() => null);
  mount(v, html`<section class="chat">
    <div class="chat-log" id="log" aria-live="polite"></div>
    <form class="composer" id="composer" autocomplete="off">
      <div class="composer-box">
        <textarea id="q" rows="1" maxlength="500" placeholder="${tr('ask_placeholder')}" aria-label="${tr('ask_placeholder')}" dir="auto"></textarea>
        <button type="submit" class="send-btn" aria-label="${tr('send')}">${icon('send', 'flip-rtl')}</button>
      </div>
      <button type="button" class="mic-btn" id="mic" aria-label="${tr('tap_to_speak')}" aria-pressed="false">${icon('mic')}</button>
    </form>
    <p class="listen-hint" id="hint" hidden>${tr('listening')}</p>
  </section>`);
  const log = $('#log', v), q = $('#q', v), mic = $('#mic', v), hint = $('#hint', v);
  const draw = () => {
    if (!state.chat.length) {
      mount(log, html`<div class="chat-empty"><span class="bot-avatar">${icon('sparkle')}</span><h2>${tr('how_help')}</h2>
        <div class="suggest">${['s1', 's2', 's3', 's4'].map(k => html`<button type="button" class="chip" data-q="${tr(k)}">${tr(k)}</button>`)}</div></div>`);
    } else mount(log, html`${state.chat.map(bubble)}`);
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => log.lastElementChild?.scrollIntoView({ block: 'end', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  };
  wireSpeak(log);
  log.addEventListener('click', e => {
    const s = e.target.closest('[data-q]');
    if (s) send(s.dataset.q);
    const sw = e.target.closest('[data-switch]');
    if (sw) applyLang(sw.dataset.switch).then(() => go('#/ask'));
  });
  q.addEventListener('input', () => { q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; });
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer', v).requestSubmit(); } });
  $('#composer', v).addEventListener('submit', e => { e.preventDefault(); send(q.value); });

  async function send(text, viaVoice = false, alternatives = []) {
    const message = String(text ?? '').trim();
    if (!message) return;
    q.value = ''; q.style.height = 'auto';
    const userMsg = { role: 'user', text: message };
    state.chat.push(userMsg);
    const pending = { role: 'bot', pending: true };
    state.chat.push(pending);
    draw();
    try {
      const res = await api('/api/assistant/chat', { method: 'POST', body: { message, alternatives, lang: state.lang, from: currentFrom(), stepFree: !!prefs.stepFree } });
      if (res.heard) userMsg.heard = res.heard;
      Object.assign(pending, { pending: false, res, question: message });
      draw();
      if (viaVoice || prefs.autoSpeak) speech.speak(res.text, res.speech);
    } catch (err) {
      Object.assign(pending, { pending: false, error: true, text: err.message === 'offline' ? tr('offline') : (err.status === 429 ? err.message : tr('error_generic')) });
      draw();
    }
    if (state.chat.length > 60) state.chat.splice(0, state.chat.length - 60);
  }

  function stopListening() {
    activeListen?.stop(); activeListen = null;
    mic.classList.remove('listening'); mic.setAttribute('aria-pressed', 'false'); hint.hidden = true;
  }
  mic.addEventListener('click', () => {
    if (activeListen) return stopListening();
    if (!speech.sttSupported()) return toast(tr('mic_unsupported'), 'warn', 6000);
    speech.cancel();
    mic.classList.add('listening'); mic.setAttribute('aria-pressed', 'true'); hint.hidden = false;
    activeListen = speech.listen({
      lang: state.lang, speechCode: langInfo().speech,
      onInterim: t => { q.value = t; },
      onFinal: (t, alts) => { q.value = ''; send(t, true, alts); },
      onError: code => { if (code === 'denied') toast(tr('mic_denied'), 'warn', 7000); else if (code === 'unsupported') toast(tr('mic_unsupported'), 'warn'); },
      onEnd: () => { activeListen = null; mic.classList.remove('listening'); mic.setAttribute('aria-pressed', 'false'); hint.hidden = true; },
    });
  });

  draw();
  const initial = query.get('q');
  if (initial || query.get('voice')) history.replaceState(null, '', '#/ask');
  if (initial) send(initial);
  else if (query.get('voice')) mic.click();
  else if (matchMedia('(min-width: 720px)').matches) q.focus();
}

// ---------- Flight ----------
async function flight(v, query) {
  await loadMap().catch(() => null);
  mount(v, html`<section class="page">
    <h1>${icon('plane')} ${tr('find_gate')}</h1>
    <form id="ff" class="flight-form">
      <label class="field field-xl"><span>${tr('flight_number')}</span>
        <input id="fno" name="fno" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="8" placeholder="QR 572" value="${query.get('no') ?? ''}" required></label>
      <button class="btn btn-primary btn-lg">${icon('search')} ${tr('search')}</button>
    </form>
    <div id="fres" aria-live="polite"></div>
    <section class="board" aria-labelledby="bh">
      <div class="board-head"><h2 id="bh">${icon('plane')} ${tr('departures')}</h2><span id="bsrc"></span></div>
      <label class="search-field">${icon('search')}<input id="bq" type="search" placeholder="${tr('filter_flights')}" aria-label="${tr('filter_flights')}" dir="auto"></label>
      <p id="bnote" class="board-note" hidden></p>
      <ul id="blist" class="board-list" aria-live="polite"><li class="skeleton"></li></ul>
    </section>
  </section>`);
  const out = $('#fres', v);
  wireSpeak(out);
  const locale = langInfo().speech;
  let board = null;
  const drawBoard = () => {
    const list = $('#blist', v);
    if (!list) return;
    const note = $('#bnote', v), src = $('#bsrc', v);
    if (!board || board.source === 'none') {
      note.hidden = false; note.textContent = tr('n_no_feed'); mount(list, html``); src.textContent = ''; return;
    }
    mount(src, board.source === 'simulated' ? simBadge(true) : html`<span class="pill pill-live">${tr('live_from', { source: board.provider?.label ?? '' })}</span>`);
    note.hidden = !(board.error || board.updatedAt);
    note.className = 'board-note' + (board.error ? ' warn' : '');
    note.textContent = board.error ? (board.flights.length ? tr('board_stale') : tr('n_feed_error'))
      : board.updatedAt ? tr('updated_at', { time: fmtTime(board.updatedAt, locale) }) : '';
    const qv = $('#bq', v).value.trim().toLowerCase().replace(/\s+/g, '');
    const rows = board.flights.filter(f => !qv || [f.flightNo, f.destination, f.destinationCode, f.gate ?? '', f.airline].join(' ').toLowerCase().replace(/\s+/g, '').includes(qv)).slice(0, 120);
    if (!rows.length) { mount(list, html`<li class="board-empty">${tr('no_flights')}</li>`); return; }
    mount(list, html`${rows.map(f => {
      const est = f.estimatedDeparture && f.estimatedDeparture !== f.scheduledDeparture;
      return html`<li><button type="button" class="board-row st-${f.status}" data-no="${f.flightNo}">
        <span class="br-time">${est ? html`<s>${fmtTime(f.scheduledDeparture, locale)}</s>` : ''}<b>${fmtTime(f.estimatedDeparture ?? f.scheduledDeparture, locale)}</b></span>
        <span class="br-main"><b>${f.destination || f.destinationCode}</b><small>${f.flightNo.replace(/^([A-Z0-9]{2})/, '$1 ')}${f.airline ? ` · ${f.airline}` : ''}</small></span>
        <span class="br-gate"><small>${tr('gate')}</small><b>${f.gate ?? '—'}</b></span>
        <span class="br-status">${f.statusLabel}</span>
      </button></li>`;
    })}`);
  };
  const loadBoard = async () => {
    try { board = await api(`/api/flights?lang=${state.lang}`); } catch { board = board ?? { source: 'live', flights: [], error: 'network' }; }
    drawBoard();
  };
  $('#bq', v).addEventListener('input', debounce(drawBoard, 120));
  $('#blist', v).addEventListener('click', e => {
    const b = e.target.closest('[data-no]');
    if (!b) return;
    $('#fno', v).value = b.dataset.no;
    history.replaceState(null, '', `#/flight?no=${encodeURIComponent(b.dataset.no)}`);
    run(b.dataset.no);
    v.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  });
  loadBoard();
  const timer = setInterval(() => { if (!document.body.contains($('#blist', v) ?? document.createElement('i'))) { clearInterval(timer); return; } if (!document.hidden) loadBoard(); }, 60000);
  const run = async no => {
    mount(out, html`<div class="skeleton"></div>`);
    try {
      const res = await api('/api/assistant/chat', { method: 'POST', body: { message: no, lang: state.lang, from: currentFrom(), stepFree: !!prefs.stepFree } });
      const card = res.cards.find(c => c.type === 'flight');
      mount(out, html`${card ? flightCard(card) : ''}<div class="answer" dir="auto"><p>${res.text}</p>${speakBtn(res.text, res.speech)}</div>${notices(res.notices)}`);
    } catch (e) { mount(out, html`<p class="error">${tr('error_generic')}</p>`); }
  };
  $('#ff', v).addEventListener('submit', e => {
    e.preventDefault();
    const no = $('#fno', v).value.trim().toUpperCase();
    if (no) { history.replaceState(null, '', `#/flight?no=${encodeURIComponent(no)}`); run(no); }
  });
  if (query.get('no')) run(query.get('no'));
}


// ---------- Message airport staff ----------
// Requests are anonymous; the private token is kept only on this device.
const SUPPORT_KEY = 'airport-assistant.support.v1';
function myRequests() { try { return JSON.parse(localStorage.getItem(SUPPORT_KEY) ?? '[]'); } catch { return []; } }
function saveRequests(list) { try { localStorage.setItem(SUPPORT_KEY, JSON.stringify(list.slice(-10))); } catch { /* private mode */ } }
function requestToken(id) { return myRequests().find(r => r.id === Number(id))?.token; }

async function support(v, parts, query) {
  if (parts[1]) return supportThread(v, Number(parts[1]));
  const map = await loadMap().catch(() => null);
  const open = myRequests().filter(r => !r.closed).at(-1);
  mount(v, html`<section class="page support-page">
    <h1>${icon('users')} ${tr('msg_staff')}</h1>
    <p class="muted">${tr('msg_staff_hint')}</p>
    ${open ? html`<a class="card staff-card" href="#/support/${open.id}">${icon('chat')}<div><b>${tr('msg_staff')}</b><small>${open.code}</small></div>${icon('chevron', 'flip-rtl')}</a>` : ''}
    <form id="sf" class="card support-form">
      <label class="field"><span>${tr('msg_staff')}</span>
        <textarea name="message" rows="4" maxlength="600" required placeholder="${tr('msg_placeholder')}" dir="auto">${query.get('q') ?? ''}</textarea></label>
      ${map ? html`<label class="field"><span>${tr('where_are_you')}</span><select name="from">${locationOptions(map, currentFrom())}</select></label>` : ''}
      <label class="field"><span>${tr('flight_number')}</span><input name="flightNo" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="QR 572"></label>
      <button class="btn btn-primary btn-lg btn-block">${icon('send', 'flip-rtl')} ${tr('msg_send')}</button>
      <p class="hint">${icon('shield')} ${tr('disclaimer')}</p>
    </form>
  </section>`);
  $('#sf', v).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/api/support', { method: 'POST', body: { message: f.message.value, lang: state.lang, from: f.from?.value || currentFrom(), flightNo: f.flightNo.value || undefined, context: query.get('q') || undefined } });
      saveRequests([...myRequests(), { id: r.id, code: r.code, token: r.token, at: Date.now() }]);
      if (f.from?.value) savePrefs({ from: f.from.value });
      go('#/support/' + r.id);
    } catch (err) {
      btn.disabled = false;
      toast(err.status === 429 ? err.message : tr('error_generic'), 'warn', 6000);
    }
  });
}

async function supportThread(v, id) {
  const token = requestToken(id);
  if (!token) return go('#/support');
  const headers = { 'X-Support-Token': token };
  mount(v, html`<section class="page support-thread">
    <div id="sthead"></div>
    <div id="stlog" class="chat-log support-log" aria-live="polite"></div>
    <form id="streply" class="composer">
      <div class="composer-box"><textarea id="stq" rows="1" maxlength="600" placeholder="${tr('msg_placeholder')}" aria-label="${tr('msg_placeholder')}" dir="auto"></textarea>
      <button class="send-btn" aria-label="${tr('send')}">${icon('send', 'flip-rtl')}</button></div>
    </form>
  </section>`);
  let seen = -1, data = null;
  const markClosed = () => saveRequests(myRequests().map(r => (r.id === id ? { ...r, closed: true } : r)));
  const draw = () => {
    if (!data) return;
    const status = data.status === 'closed' ? 'req_closed' : data.status === 'claimed' ? 'req_claimed' : 'req_sent';
    mount($('#sthead', v), html`<div class="support-head">
      <h1>${icon('users')} ${tr('msg_staff')} <small>${data.code}</small></h1>
      <p class="support-status st-${data.status}">${icon(data.status === 'closed' ? 'check' : data.status === 'claimed' ? 'user' : 'clock')} ${tr(status)}</p>
      ${data.status !== 'closed' ? html`<button class="btn btn-ghost btn-sm" id="stclose">${tr('req_close')}</button>` : ''}
    </div>`);
    const locale = langInfo().speech;
    mount($('#stlog', v), html`${data.messages.map(m => (m.sender === 'system'
      ? html`<p class="support-event">${tr(m.event === 'claimed' ? 'req_claimed' : 'req_closed')}</p>`
      : html`<div class="msg ${m.sender === 'passenger' ? 'msg-user' : 'msg-bot msg-staff'}" dir="auto">
          <small class="who">${m.sender === 'passenger' ? tr('you_label') : tr('staff_label')} · ${fmtTime(new Date(m.at).toISOString(), locale)}</small>
          <p>${m.text}</p>
          ${m.english ? html`<small class="notice">${tr('n_english')}</small>` : m.machine ? html`<small class="notice">${tr('n_machine')}</small>` : ''}
          ${m.sender === 'staff' ? speakBtn(m.text, locale) : ''}
        </div>`))}`);
    $('#streply', v).hidden = data.status === 'closed';
    $('#stclose', v)?.addEventListener('click', async () => {
      try { data = await api(`/api/support/${id}/close`, { method: 'POST', headers }); markClosed(); draw(); } catch { toast(tr('error_generic'), 'warn'); }
    });
    $('#stlog', v).lastElementChild?.scrollIntoView({ block: 'end' });
  };
  wireSpeak($('#stlog', v));
  const load = async () => {
    try {
      data = await api(`/api/support/${id}`, { headers });
    } catch (e) {
      if (e.status === 404) { saveRequests(myRequests().filter(r => r.id !== id)); go('#/support'); }
      return;
    }
    const last = data.messages.filter(m => m.sender === 'staff').at(-1);
    if (seen >= 0 && last && last.id > seen) {
      navigator.vibrate?.(200);
      if (prefs.autoSpeak) speech.speak(last.text, langInfo().speech);
    }
    seen = last?.id ?? 0;
    if (data.status === 'closed') markClosed();
    draw();
  };
  await load();
  const timer = setInterval(() => {
    if (!document.body.contains($('#stlog', v) ?? document.createElement('i'))) { clearInterval(timer); return; }
    if (!document.hidden && data?.status !== 'closed') load();
  }, state.meta.lite ? 6000 : 4000); // slower on the free serverless host, which meters every request
  $('#streply', v).addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#stq', v);
    const text = q.value.trim();
    if (!text) return;
    q.value = '';
    try { data = await api(`/api/support/${id}/messages`, { method: 'POST', headers, body: { message: text } }); draw(); }
    catch { q.value = text; toast(tr('error_generic'), 'warn'); }
  });
}

// ---------- Map ----------
async function mapView(v, query) {
  const map = await loadMap();
  const from = query.get('from') ?? currentFrom();
  let to = query.get('to');
  const nearest = query.get('nearest');
  let routeRes = null;
  try {
    const sf = prefs.stepFree ? '&stepFree=1' : '';
    if (nearest) { routeRes = await api(`/api/nearest?from=${from}&type=${nearest}${sf}`); to = routeRes.path.at(-1); }
    else if (to && to !== from) routeRes = await api(`/api/route?from=${from}&to=${to}${sf}`);
  } catch { routeRes = null; }
  const toLoc = map.locations.find(l => l.id === to);
  mount(v, html`<section class="page page-map">
    <div class="map-controls">
      <label class="field"><span>${tr('from')}</span><select id="mfrom">${locationOptions(map, from)}</select></label>
      <label class="field"><span>${tr('to')}</span><select id="mto"><option value="">—</option>${locationOptions(map, to)}</select></label>
      <label class="switch"><input type="checkbox" id="sf" ${prefs.stepFree ? raw('checked') : ''}><span class="switch-ui"></span>${icon('accessible')} ${tr('step_free')}</label>
    </div>
    ${routeRes ? html`<div class="route-summary" role="status">
        <div>${icon('walk')}<b>${tr('min_walk', { m: routeRes.minutes })}</b><small>${routeRes.meters} m${routeRes.train ? ` · ${tr('train_line')}` : ''}${routeRes.stepFree ? ' · ♿' : ''}</small></div>
        <div class="route-to">${icon('pin')}<b>${locName(toLoc)}</b></div>
      </div>` : (to && to !== from ? html`<p class="error">${tr('no_results')}</p>` : '')}
    <div class="nearby nearby-row">${NEARBY.map(t => html`<a class="near ${nearest === t ? 'active' : ''}" href="#/map?nearest=${t}&from=${from}">${icon(PLACE_ICONS[t])}<span>${placeLabel(t)}</span></a>`)}</div>
    <div id="mapbox" class="mapbox"></div>
    <p class="map-note">${icon('info')} ${tr('n_simulated_map')}</p>
    ${routeRes ? html`<ol class="steps">${steps(routeRes, map).map(s => html`<li>${icon(s.icon)}<span>${s.text}</span></li>`)}</ol>` : ''}
  </section>`);
  renderMap($('#mapbox', v), map, {
    route: routeRes, from, to, label: tr('map'), trainLabel: tr('train_line'),
    onSelect: n => { if (n && n.type !== 'junction') go(`#/map?from=${from}&to=${n.id}`); },
  });
  $('#mfrom', v).addEventListener('change', e => { savePrefs({ from: e.target.value }); go(`#/map?from=${e.target.value}${to ? `&to=${to}` : ''}`); });
  $('#mto', v).addEventListener('change', e => go(`#/map?from=${from}${e.target.value ? `&to=${e.target.value}` : ''}`));
  $('#sf', v).addEventListener('change', e => { savePrefs({ stepFree: e.target.checked }); mapView(v, query); });
}

function steps(r, map) {
  const out = [];
  let lastConc = null;
  r.steps.forEach((s, i) => {
    const loc = map.locations.find(l => l.id === s.id);
    if (s.via === 'train') { out.push({ icon: 'train', text: tr('take_train') }); return; }
    if (s.via === 'lift') out.push({ icon: 'lift', text: `⇅ ${loc ? locName(loc) : s.name}` });
    else if (s.via === 'escalator') out.push({ icon: 'layers', text: `↗ ${loc ? locName(loc) : s.name}` });
    if (s.type === 'junction') {
      if (s.concourse && s.concourse !== lastConc) { out.push({ icon: 'walk', text: tr('area_conc', { c: s.concourse }) }); lastConc = s.concourse; }
      return;
    }
    if (s.via === 'lift' || s.via === 'escalator') return;
    out.push({ icon: i === 0 ? 'pin' : (i === r.steps.length - 1 ? 'check' : (PLACE_ICONS[s.type] ?? 'walk')), text: loc ? locName(loc) : s.name });
  });
  return out;
}

// ---------- Lounges ----------
const loungeState = { carrier: 'QR', cabin: 'economy', tier: 'NONE' };
async function lounges(v) {
  await loadMap().catch(() => null);
  const opt = (val, label, cur) => html`<option value="${val}" ${val === cur ? raw('selected') : ''}>${label}</option>`;
  mount(v, html`<section class="page">
    <h1>${icon('sofa')} ${tr('find_lounge')}</h1>
    <form id="lf" class="lounge-form card">
      <label class="field"><span>${tr('airline')}</span><select name="carrier">${['QR', 'ONEWORLD', 'OTHER'].map(c => opt(c, tr('carrier_' + c), loungeState.carrier))}</select></label>
      <label class="field"><span>${tr('cabin')}</span><select name="cabin">${['economy', 'premium_economy', 'business', 'first'].map(c => opt(c, tr('cabin_' + c), loungeState.cabin))}</select></label>
      <label class="field"><span>${tr('tier')}</span><select name="tier">${TIERS.map(([k, label]) => opt(k, label ?? (k === 'NONE' ? tr('tier_NONE') : tr('carrier_OTHER')), loungeState.tier))}</select></label>
      <button class="btn btn-primary btn-block">${tr('show_lounges')}</button>
      <p class="hint">${icon('shield')} ${tr('verified_at_desk')}</p>
    </form>
    <div id="lres" aria-live="polite"></div>
    <form id="codef" class="card code-form">
      <label class="field"><span>${tr('have_code')}</span><input id="code" placeholder="BV-XXXX-XXXX" autocapitalize="characters" autocomplete="off" maxlength="14" spellcheck="false"></label>
      <button class="btn">${tr('check')}</button>
      <div id="cres" aria-live="polite"></div>
    </form>
  </section>`);
  const res = $('#lres', v);
  const run = async () => {
    mount(res, html`<div class="skeleton"></div>`);
    try {
      const r = await api('/api/lounges/recommend', { method: 'POST', body: { ...loungeState, from: currentFrom(), stepFree: !!prefs.stepFree } });
      mount(res, html`<p class="notice notice-simulated_lounges">${icon('info')} ${tr('n_simulated_lounges')}</p>${r.lounges.map(l => loungeCard(l))}`);
    } catch { mount(res, html`<p class="error">${tr('error_generic')}</p>`); }
  };
  $('#lf', v).addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Object.assign(loungeState, { carrier: fd.get('carrier'), cabin: fd.get('cabin'), tier: fd.get('tier') });
    run();
  });
  $('#codef', v).addEventListener('submit', async e => {
    e.preventDefault();
    const code = $('#code', v).value.trim().toUpperCase();
    if (!code) return;
    const out = $('#cres', v);
    try {
      const r = await api(`/api/lounges/verification/${encodeURIComponent(code)}`);
      mount(out, r.valid
        ? html`<div class="verified">${icon('check')}<div><b>${tr('code_valid')}</b><span>${r.lounge}</span><small>→ ${fmtTime(new Date(r.expiresAt).toISOString(), langInfo().speech)}</small></div></div>`
        : html`<p class="error">${tr('code_invalid')}</p>`);
    } catch { mount(out, html`<p class="error">${tr('code_invalid')}</p>`); }
  });
}

function loungeCard(l) {
  const r = l.eligibility.result;
  return html`<article class="lounge-card elig-${r}">
    <header><h3>${l.name}</h3>${l.simulated ? html`<span class="pill pill-sim" title="${tr('n_simulated_lounges')}">${icon('info')} ${tr('approx_location')}</span>` : simBadge(false)}</header>
    <p class="elig">${icon(r === 'likely' ? 'check' : r === 'paid_option' ? 'ticket' : r === 'closed' ? 'x' : 'info')} <b>${tr('elig_' + r)}</b></p>
    <div class="lounge-meta">
      ${l.minutes != null ? html`<span>${icon('walk')} ${tr('min_walk', { m: l.minutes })}</span>` : ''}
      <span>${icon('clock')} ${l.hours?.always ? '24h' : l.hours?.open ? `${l.hours.open}–${l.hours.close}` : tr('hours_check')}${l.openNow ? html` · <em class="ok">${tr('open_now')}</em>` : ''}</span>
      ${state.map?.locations.find(x => x.id === l.location_id)?.level ? html`<span>${icon('layers')} L${state.map.locations.find(x => x.id === l.location_id).level}</span>` : ''}
    </div>
    ${l.notes ? html`<p class="lounge-note">${icon(l.status === 'verify' ? 'alert' : 'info')} ${l.notes}</p>` : ''}
    ${l.paid_access && r === 'paid_option' ? html`<p class="lounge-note">${l.paid_access}</p>` : ''}
    <a class="btn btn-block" href="#/map?to=${l.location_id}">${icon('map')} ${tr('show_way')}</a>
  </article>`;
}

// ---------- Help / FAQ ----------
async function help(v, query) {
  mount(v, html`<section class="page">
    <h1>${icon('help')} ${tr('help')}</h1>
    <label class="search-field">${icon('search')}<input id="fq" type="search" placeholder="${tr('search_help')}" aria-label="${tr('search_help')}" value="${query.get('q') ?? ''}" dir="auto"></label>
    <div id="faqs" class="faq-list" aria-live="polite"></div>
    <a class="card staff-card" href="#/ask">${icon('chat')}<div><b>${tr('ask_placeholder')}</b></div>${icon('chevron', 'flip-rtl')}</a>
    <a class="card staff-card staff-card-strong" href="#/support">${icon('users')}<div><b>${tr('msg_staff')}</b><small>${tr('msg_staff_hint')}</small></div>${icon('chevron', 'flip-rtl')}</a>
  </section>`);
  const list = $('#faqs', v);
  wireSpeak(list);
  const canTranslate = state.meta.translation !== 'phrasebook';
  const load = async () => {
    const q = $('#fq', v).value.trim();
    try {
      const r = await api(`/api/faqs?lang=${state.lang}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      if (!r.items.length) return mount(list, html`<p class="empty-sm">${tr('no_results')}</p>`);
      mount(list, html`${r.items.map(f => html`<details class="faq" data-id="${f.id}">
        <summary dir="auto">${f.q}</summary>
        <div class="faq-a" dir="auto"><p>${f.a}</p>
          <div class="faq-foot">${speakBtn(f.a, f.lang === state.lang ? langInfo().speech : 'en-GB')}
            ${f.lang !== state.lang ? (canTranslate ? html`<button class="chip" data-tr="${f.id}">${icon('globe')} ${langInfo().native}</button>` : html`<span class="notice">${tr('n_english')}</span>`) : ''}
            ${f.sourceUrl ? html`<a class="src" href="${f.sourceUrl}" target="_blank" rel="noopener noreferrer">${tr('source')} ↗</a>` : ''}
            ${f.verifiedOn ? html`<small class="muted">✓ ${f.verifiedOn}</small>` : ''}</div></div></details>`)}`);
    } catch { mount(list, html`<p class="error">${tr('error_generic')}</p>`); }
  };
  list.addEventListener('click', async e => {
    const b = e.target.closest('[data-tr]');
    if (!b) return;
    b.disabled = true;
    try {
      const r = await api('/api/faqs/translate', { method: 'POST', body: { id: Number(b.dataset.tr), lang: state.lang } });
      const d = b.closest('details');
      d.querySelector('summary').textContent = r.q;
      d.querySelector('.faq-a p').textContent = r.a;
      b.replaceWith(Object.assign(document.createElement('span'), { className: 'notice', textContent: tr('n_machine') }));
    } catch { toast(tr('error_generic'), 'warn'); b.disabled = false; }
  });
  $('#fq', v).addEventListener('input', debounce(load, 250));
  load();
}

// ---------- Language ----------
function language(v, query) {
  const first = query.get('first');
  const nav = navigator.language?.slice(0, 2);
  mount(v, html`<section class="page lang-page">
    <h1>${icon('globe')} ${tr('choose_language', {}, hasUi(nav) ? nav : 'en')}</h1>
    ${nav !== 'en' ? html`<p class="muted">Choose your language</p>` : ''}
    ${state.meta.languages.length > 14 ? html`<label class="search-field lang-search">${icon('search')}<input id="lq" type="search" placeholder="${tr('search_language')}${state.lang === 'en' ? '' : ' · Search'}" aria-label="${tr('search_language')}" autocomplete="off" dir="auto"></label>` : ''}
    <div class="lang-grid">${state.meta.languages.map(l => html`<button class="lang-tile ${l.code === state.lang && !first ? 'active' : ''} ${l.code === nav && first ? 'suggested' : ''}" data-lang="${l.code}" lang="${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}">
      <b>${l.native}</b><small>${l.name}</small>${!l.builtin ? html`<em>${icon('globe')}</em>` : ''}</button>`)}</div>
  </section>`);
  $('#lq', v)?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    for (const b of v.querySelectorAll('[data-lang]')) b.hidden = !!q && !b.textContent.toLowerCase().includes(q) && !b.dataset.lang.toLowerCase().startsWith(q);
  });
  v.addEventListener('click', async e => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    b.classList.add('loading');
    await applyLang(b.dataset.lang);
    state.chat = [];
    go('#/');
  });
}

// ---------- Settings ----------
function settings(v) {
  const sw = (id, label, on) => html`<label class="switch switch-row"><span>${label}</span><input type="checkbox" id="${id}" ${on ? raw('checked') : ''}><span class="switch-ui"></span></label>`;
  mount(v, html`<section class="page">
    <h1>${icon('settings')} ${tr('settings')}</h1>
    <div class="card settings">
      <a class="settings-row" href="#/language">${icon('globe')}<span>${tr('language')}</span><b>${langInfo().native}</b>${icon('chevron', 'flip-rtl')}</a>
      ${sw('s-text', tr('text_size'), prefs.textLarge)}
      ${sw('s-contrast', tr('high_contrast'), prefs.contrast)}
      ${sw('s-speak', tr('read_aloud'), prefs.autoSpeak)}
      ${sw('s-sf', tr('step_free'), prefs.stepFree)}
    </div>
    <div class="card about">
      <h2>Privacy</h2>
      <p>This assistant does not ask for your name, passport or booking reference. Questions are answered and then discarded; only anonymous daily counts (topic and language) are kept to improve the service. Voice input uses your device's speech service.</p>
      <h2>About the data</h2>
      <p>Items marked <span class="pill pill-sim">${tr('simulated')}</span> are simulated. ${state.meta.flightSource === 'live' ? 'Flight information comes from the authorised airport feed.' : 'No live flight feed is connected, so flight details shown are simulated or unavailable.'} Lounge eligibility is a guide only — entry is always verified by staff.</p>
      <p class="muted">${tr('disclaimer')}</p>
    </div>
    <a class="card staff-card" href="#/staff">${icon('shield')}<div><b>${tr('staff_login')}</b></div>${icon('chevron', 'flip-rtl')}</a>
  </section>`);
  $('#s-text', v).addEventListener('change', e => { savePrefs({ textLarge: e.target.checked }); applyPrefs(); });
  $('#s-contrast', v).addEventListener('change', e => { savePrefs({ contrast: e.target.checked }); applyPrefs(); });
  $('#s-speak', v).addEventListener('change', e => savePrefs({ autoSpeak: e.target.checked }));
  $('#s-sf', v).addEventListener('change', e => savePrefs({ stepFree: e.target.checked }));
}
