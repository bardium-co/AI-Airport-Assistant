import { api, html, raw, mount, $, $$, toast, icon, fmtDateTime, setCsrf } from '../lib.js';
import { speech } from '../speech.js';
import { state, langInfo, go } from '../app.js';

const interp = { pLang: 'hi', sLang: 'en', entries: [], flipped: false, autoSpeak: true, consent: false };
let staffCfg = null;

const REASONS = {
  premium_cabin_oneworld: 'Business/First cabin on Qatar Airways or a oneworld carrier', oneworld_status: 'oneworld Sapphire/Emerald (or equivalent Privilege Club tier)',
  business_class: 'Business Class on Qatar Airways or a oneworld-operated flight', pc_platinum_full_fare: 'Privilege Club Platinum on a full-fare First/Business ticket (check fare basis)',
  status_gold_platinum: 'Privilege Club Gold/Platinum or oneworld Sapphire/Emerald', status_platinum: 'Privilege Club Platinum or oneworld Emerald', status_gold: 'Privilege Club Gold or oneworld Sapphire',
  premium_cabin_other_airline: 'First/Business Class on another airline (not Qatar Airways)',
  first_class: 'First Class ticket', pc_platinum: 'Privilege Club Platinum', pc_gold: 'Privilege Club Gold', pc_silver: 'Privilege Club Silver',
  need_ticket_details: 'Ticket details missing', no_rule_match: 'No configured access rule matches', paid_access_may_be_available: 'Paid entry may be available',
  lounge_closed: 'Lounge is closed', airline_reservation_system_not_connected: 'Airline reservation system is not connected — process in the airline system',
  supervisor_approval_required: 'Supervisor approval required', account_specific_questions_referred: 'Account-specific questions must be referred to the airline', rule_match: 'Matches a configured rule',
};
const RESULT_LABEL = { likely: 'Rules indicate likely eligible', paid_option: 'Paid entry option', unlikely: 'Rules indicate not eligible', unknown: 'Insufficient details', closed: 'Lounge closed', requires_airline_system: 'Requires airline system check', information_only: 'Information only' };
const TIER_LABEL = { NONE: 'None', PC_BURGUNDY: 'PC Burgundy', PC_SILVER: 'PC Silver', PC_GOLD: 'PC Gold', PC_PLATINUM: 'PC Platinum', OW_RUBY: 'oneworld Ruby', OW_SAPPHIRE: 'oneworld Sapphire', OW_EMERALD: 'oneworld Emerald', OTHER: 'Other programme' };
const CABIN_LABEL = { economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First' };
const CARRIER_LABEL = { QR: 'Qatar Airways', ONEWORLD: 'Other oneworld airline', OTHER: 'Other airline' };

export async function route(v, parts, query) {
  if (!state.user) return login(v);
  staffCfg ??= await api('/api/staff/config').catch(() => ({}));
  const tab = parts[0] ?? 'requests';
  const counts = await api('/api/staff/support?status=active').then(r => r.counts).catch(() => null);
  mount(v, html`<nav class="subnav" aria-label="Staff">
      <a href="#/staff/requests" class="${tab === 'requests' ? 'active' : ''}">${icon('chat')}<span>Requests</span>${counts?.open ? html`<em class="badge">${counts.open}</em>` : ''}</a>
      ${[['translate', 'swap', 'Interpreter'], ['guidance', 'book', 'Guidance'], ['cases', 'clipboard', 'Eligibility cases'], ['tools', 'plane', 'Flights & map']].filter(([k]) => !(staffCfg?.lite && k === 'cases')).map(([k, ic, label]) =>
        html`<a href="#/staff/${k}" class="${tab === k ? 'active' : ''}">${icon(ic)}<span>${label}</span></a>`)}
      ${state.user.role === 'admin' ? html`<a href="#/admin">${icon('settings')}<span>Admin</span></a>` : ''}
    </nav><div id="sv" class="staff-body"></div>`);
  const sv = $('#sv', v);
  if (state.user.isDemo) sv.insertAdjacentHTML('beforebegin', String(html`<p class="banner banner-warn">${icon('alert')} Built-in test account. Change the password or create real accounts in Admin → Users.</p>`));
  if (tab === 'requests') return parts[1] ? requestDetail(sv, Number(parts[1])) : requests(sv, query);
  if (tab === 'translate') return translator(sv);
  if (tab === 'guidance') return guidance(sv);
  if (tab === 'cases' && !staffCfg?.lite) return parts[1] ? caseDetail(sv, Number(parts[1])) : cases(sv);
  if (tab === 'tools') return tools(sv);
  return requests(sv, query);
}

// ---------- Passenger help requests (live) ----------
const ago = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
let lastSeenRequestId = Number(sessionStorage.getItem('aa.lastReq') ?? 0);
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.17);
    });
  } catch { /* audio not allowed until the page is clicked */ }
}

async function requests(sv, query) {
  const view = query.get('view') === 'closed' ? 'closed' : 'active';
  mount(sv, html`<div class="row-between"><h1>Passenger requests</h1>
      <div class="seg"><a href="#/staff/requests" class="${view === 'active' ? 'active' : ''}">Active</a><a href="#/staff/requests?view=closed" class="${view === 'closed' ? 'active' : ''}">Closed</a></div></div>
    <p class="muted">Passengers who could not find an answer in the app message you here — in their own language. Requests refresh automatically; a sound plays when a new one arrives.</p>
    <div id="rqlist" class="case-list" aria-live="polite"><div class="skeleton"></div></div>`);
  const draw = data => {
    const list = $('#rqlist', sv);
    if (!list) return false;
    document.title = data.counts.open ? `(${data.counts.open}) Requests · Staff` : 'Requests · Staff';
    const newest = Math.max(0, ...data.items.map(r => r.id));
    if (newest > lastSeenRequestId && data.items.some(r => r.status === 'open')) { if (lastSeenRequestId) chime(); }
    lastSeenRequestId = Math.max(lastSeenRequestId, newest);
    sessionStorage.setItem('aa.lastReq', String(lastSeenRequestId));
    if (!data.items.length) { mount(list, html`<p class="empty">${view === 'active' ? 'No open requests right now.' : 'No closed requests.'}</p>`); return true; }
    mount(list, html`${data.items.map(r => html`<a class="card case-row rq-row rq-${r.status}${r.waitingSince ? ' rq-waiting' : ''}" href="#/staff/requests/${r.id}">
      <div class="rq-top"><b>${r.code}</b><span class="pill pill-${r.status === 'open' ? 'warn' : r.status === 'claimed' ? 'live' : 'sim'}">${r.status === 'open' ? 'New' : r.status === 'claimed' ? `Handling: ${r.claimedBy ?? '—'}` : 'Closed'}</span>
        <span class="rq-lang">${icon('globe')} ${r.langName}</span>${r.waitingSince ? html`<span class="rq-wait">${icon('clock')} waiting ${ago(data.now - r.waitingSince)}</span>` : ''}</div>
      <p class="rq-preview">${r.preview ? (r.preview.sender === 'passenger' ? '' : 'You: ') + r.preview.text : ''}</p>
      <small class="muted">${icon('pin')} ${r.locationName ?? 'Location not given'}${r.flightNo ? ` · ${r.flightNo}` : ''} · ${fmtDateTime(r.createdAt)}</small>
    </a>`)}`);
    return true;
  };
  const load = async () => { try { return draw(await api(`/api/staff/support?status=${view}`)); } catch { return true; } };
  await load();
  // Stop as soon as the list is no longer on screen (navigated away or signed out) — before fetching again.
  const timer = setInterval(async () => { if (!$('#rqlist', sv)?.isConnected) return clearInterval(timer); if (document.hidden) return; if (!(await load())) clearInterval(timer); }, staffCfg?.lite ? 15000 : 5000);
}

async function requestDetail(sv, id) {
  mount(sv, html`<a href="#/staff/requests" class="back">← All requests</a><div id="rqd"><div class="skeleton"></div></div>`);
  let data = null, lastMsg = 0;
  const box = () => { const b = $('#rqd', sv); return b?.isConnected ? b : null; };
  const draw = () => {
    if (!box()) return false;
    const r = data;
    const mine = r.claimedById === state.user.id;
    const machine = r.translation !== 'phrasebook';
    mount(box(), html`<div class="card">
        <div class="row-between"><h1>${r.code} <small class="muted">${r.langName}</small></h1>
          <span class="pill pill-${r.status === 'open' ? 'warn' : r.status === 'claimed' ? 'live' : 'sim'}">${r.status === 'open' ? 'New — nobody is handling it yet' : r.status === 'claimed' ? `Handling: ${r.claimedBy}` : 'Closed'}</span></div>
        <p>${icon('pin')} <b>${r.locationName ?? 'Location not given'}</b>${r.location ? html` · <a href="#/map?to=${r.location}" target="_blank" rel="noopener">Show on map</a>` : ''}${r.flightNo ? html` · ${icon('plane')} <a href="#/flight?no=${r.flightNo}" target="_blank" rel="noopener">${r.flightNo}</a>` : ''}</p>
        ${r.context ? html`<p class="muted small">Last question in the app: “${r.context}”</p>` : ''}
        ${r.status !== 'closed' ? html`<div class="row-end">
          ${!mine ? html`<button class="btn btn-primary" id="claim">${icon('user')} I'm handling this</button>` : ''}
          <button class="btn" id="close">${icon('check')} Close request</button></div>` : ''}
      </div>
      <div class="card rq-thread">${r.messages.map(m => (m.sender === 'system'
        ? html`<p class="support-event">${m.event === 'claimed' ? `${m.by ?? 'Staff'} is handling this request` : m.event === 'closed' ? `Closed by ${m.by ?? 'staff'}` : 'Closed by the passenger'} · ${fmtDateTime(m.at)}</p>`
        : html`<div class="msg ${m.sender === 'passenger' ? 'msg-bot' : 'msg-user'}">
            <small class="who">${m.sender === 'passenger' ? `Passenger (${r.langName})` : (m.by ?? 'Staff')} · ${fmtDateTime(m.at)}</small>
            ${m.sender === 'passenger'
              ? html`<p dir="auto" lang="${m.lang}">${m.text}</p>${m.translated ? html`<p class="rq-trans">${icon('swap')} ${m.translated} <small class="muted">(${m.engine === 'phrasebook' ? 'reviewed' : 'machine'} translation)</small></p>` : (m.lang !== 'en' ? html`<p class="rq-trans muted small">${r.translation !== 'phrasebook' && Date.now() - m.at < 120000 ? 'Translating…' : 'No translation available — use the Interpreter tab or the quick replies below.'}</p>` : '')}`
              : html`<p>${m.text}</p>${m.translated ? html`<p class="rq-trans" dir="auto">${icon('swap')} ${m.translated} <small class="muted">(${m.engine === 'phrasebook' ? 'reviewed phrase' : 'machine translation'})</small></p>` : (m.engine === 'pending' ? html`<p class="rq-trans muted small">Translating for the passenger… they will see it in ${r.langName} shortly.</p>` : r.lang !== 'en' ? html`<p class="rq-trans muted small">Sent in English (no translation for this text).</p>` : '')}`}
          </div>`))}</div>
      ${r.status !== 'closed' ? html`<div class="card">
        <h2>Reply</h2>
        <p class="muted small">Quick replies are pre-translated into ${r.langName}${machine ? '. Free text is machine-translated.' : '. Free text is sent in English (no machine translation connected — use quick replies where possible).'}</p>
        <div class="phrase-grid">${r.phrases.filter(p => p.local).map(p => html`<button class="chip" data-phrase="${p.id}" title="${p.local}">${p.en}</button>`)}</div>
        <form id="rqreply" class="row"><input name="message" maxlength="600" placeholder="Type a reply (simple English works best)" required><button class="btn btn-primary">${icon('send')} Send</button></form>
      </div>` : ''}`);
    $('#claim', sv)?.addEventListener('click', async () => { await api(`/api/staff/support/${id}/claim`, { method: 'POST' }); load(); });
    $('#close', sv)?.addEventListener('click', async () => { if (confirm('Close this request? The passenger will see that it is closed.')) { await api(`/api/staff/support/${id}/close`, { method: 'POST' }); load(); } });
    $$('[data-phrase]', sv).forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api(`/api/staff/support/${id}/messages`, { method: 'POST', body: { phrase: b.dataset.phrase } }); await load(); } catch (e) { toast(e.message, 'warn'); b.disabled = false; }
    }));
    $('#rqreply', sv)?.addEventListener('submit', async e => {
      e.preventDefault();
      const inp = e.target.message;
      try { await api(`/api/staff/support/${id}/messages`, { method: 'POST', body: { message: inp.value } }); inp.value = ''; await load(); } catch (err) { toast(err.message, 'warn'); }
    });
    const last = r.messages.at(-1)?.id ?? 0;
    if (lastMsg && last > lastMsg && r.messages.at(-1).sender === 'passenger') chime();
    lastMsg = last;
    return true;
  };
  const load = async () => {
    try { data = await api(`/api/staff/support/${id}`); } catch (e) { if (box()) mount(box(), html`<p class="error">${e.message}</p>`); return false; }
    const typing = document.activeElement?.name === 'message' && document.activeElement.value;
    if (typing) return true; // do not redraw while staff are typing a reply
    return draw();
  };
  await load();
  const timer = setInterval(async () => { if (!box()) return clearInterval(timer); if (document.hidden) return; if (!(await load())) clearInterval(timer); }, staffCfg?.lite ? 8000 : 5000);
}


// ---------- Login ----------
function login(v) {
  const demo = state.meta.demoAccounts ?? [];
  mount(v, html`<section class="page login">
    <div class="card login-card">
      <span class="brand-mark lg" aria-hidden="true">${icon('shield')}</span>
      <h1>Staff sign-in</h1>
      <p class="muted">For airport, lounge and airline staff. Passengers do not need to sign in.</p>
      <form id="lg">
        <label class="field"><span>Username</span><input name="username" autocomplete="username" required maxlength="60"></label>
        <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
        <p class="error" id="lerr" role="alert" hidden></p>
        <button class="btn btn-primary btn-block btn-lg">Sign in</button>
      </form>
      ${demo.length ? html`<div class="demo-accounts"><p><b>Quick sign-in</b> (test mode only)</p>${demo.map(d => html`<button class="chip" data-u="${d.username}" data-p="${d.password}">${icon('user')} ${d.username} <em>${d.role}</em></button>`)}</div>` : ''}
      <a class="btn btn-ghost btn-block" href="#/">← Passenger assistant</a>
    </div>
  </section>`);
  const f = $('#lg', v);
  v.addEventListener('click', e => {
    const b = e.target.closest('[data-u]');
    if (b) { f.username.value = b.dataset.u; f.password.value = b.dataset.p; f.requestSubmit(); }
  });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#lerr', v);
    err.hidden = true;
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      state.user = r.user; setCsrf(r.csrf); staffCfg = null;
      go(r.user.role === 'admin' ? '#/admin' : '#/staff');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
}

// ---------- Interpreter ----------
function langSelect(id, cur) {
  return html`<select id="${id}" class="lang-select">${state.meta.languages.map(l => html`<option value="${l.code}" ${l.code === cur ? raw('selected') : ''}>${l.native} — ${l.name}</option>`)}</select>`;
}

function translator(sv) {
  const pl = langInfo(interp.pLang), sl = langInfo(interp.sLang);
  const lastFor = side => [...interp.entries].reverse().find(e => e.side !== side);
  const pView = lastFor('passenger'); // last thing staff said → shown to passenger
  const sView = lastFor('staff'); // last thing passenger said → shown to staff
  mount(sv, html`<div class="interp ${interp.flipped ? 'flipped' : ''}">
    <section class="side side-p" lang="${pl.code}" dir="${pl.rtl ? 'rtl' : 'ltr'}" aria-label="Passenger side">
      <header>${icon('user')}<b>Passenger</b>${langSelect('pl', interp.pLang)}</header>
      <div class="side-text">${pView ? html`<p class="big" dir="auto">${pView.translated ?? '…'}</p>` : html`<p class="big muted">${pl.native}</p>`}</div>
      <div class="side-ctrl"><button class="mic-btn mic-lg" data-mic="passenger" aria-label="Passenger speaks">${icon('mic')}</button>
        <form data-type="passenger" class="type-form"><input placeholder="${pl.native}…" dir="auto" maxlength="1000"><button class="btn btn-sm">${icon('send', 'flip-rtl')}</button></form></div>
    </section>
    <div class="interp-bar">
      <button class="chip" id="flip" title="Rotate the passenger half to face them across the counter">${icon('rotate')} Face-to-face</button>
      <button class="chip" id="swapl">${icon('swap')} Swap</button>
      <label class="switch"><input type="checkbox" id="autos" ${interp.autoSpeak ? raw('checked') : ''}><span class="switch-ui"></span>Speak translations</label>
      <span class="engine-pill">${icon('globe')} ${staffCfg.translation === 'phrasebook' ? 'Phrasebook only (no translation provider connected)' : 'Translation: ' + staffCfg.translation}</span>
    </div>
    <section class="side side-s" aria-label="Staff side">
      <header>${icon('shield')}<b>Staff</b>${langSelect('sl', interp.sLang)}</header>
      <div class="side-text">${sView ? html`<p class="big" dir="auto">${sView.translated ?? '— translation unavailable —'}</p><p class="orig" dir="auto">${sView.original}</p>` : html`<p class="big muted">Tap the passenger microphone and ask them to speak.</p>`}</div>
      <div class="side-ctrl"><button class="mic-btn mic-lg" data-mic="staff" aria-label="Staff speaks">${icon('mic')}</button>
        <form data-type="staff" class="type-form"><input placeholder="${sl.native}…" dir="auto" maxlength="1000"><button class="btn btn-sm">${icon('send', 'flip-rtl')}</button></form>
        <button class="btn btn-sm" id="phrasesBtn">${icon('book')} Quick phrases</button></div>
    </section>
  </div>
  <div id="phrases" class="phrases" hidden></div>
  <section class="card transcript">
    <header><h2>${icon('log')} Transcript <small>original + translation</small></h2>
      <div class="row-end">${staffCfg.storeTranscripts ? html`<label class="check"><input type="checkbox" id="consent" ${interp.consent ? raw('checked') : ''}> Passenger consents to saving (kept ${staffCfg.retentionDays} days)</label><button class="btn btn-sm" id="save">Save</button>` : html`<span class="muted small">Transcripts are not stored (disabled by administrator).</span>`}
      <button class="btn btn-sm btn-ghost" id="clear">${icon('trash')} Clear</button></div></header>
    <ol class="tlist">${interp.entries.map((e, i) => html`<li class="t-${e.side}">
      <div class="t-head"><b>${e.side === 'passenger' ? 'Passenger' : 'Staff'}</b> <span class="muted">${langInfo(e.from).name} → ${langInfo(e.to).name} · ${e.engine ?? ''}${e.machine ? ' (machine)' : ''}</span><time>${new Date(e.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit' })}</time></div>
      <p class="t-orig" dir="auto" lang="${e.from}">${e.original}</p>
      <p class="t-tr" dir="auto" lang="${e.to}">${e.translated ?? html`<em class="error">Not translated — ${e.error === 'not_configured' ? 'no translation provider connected; use Quick phrases' : 'translation service error'}</em>`}</p>
      ${e.translated ? html`<button class="speak-btn" data-replay="${i}">${icon('speaker')} Replay</button>` : ''}
    </li>`)}</ol>
    ${!interp.entries.length ? html`<p class="muted">No conversation yet.</p>` : ''}
  </section>`);

  const rerender = () => translator(sv);
  $('#pl', sv).addEventListener('change', e => { interp.pLang = e.target.value; rerender(); });
  $('#sl', sv).addEventListener('change', e => { interp.sLang = e.target.value; rerender(); });
  $('#flip', sv).addEventListener('click', () => { interp.flipped = !interp.flipped; rerender(); });
  $('#swapl', sv).addEventListener('click', () => { [interp.pLang, interp.sLang] = [interp.sLang, interp.pLang]; rerender(); });
  $('#autos', sv).addEventListener('change', e => { interp.autoSpeak = e.target.checked; });
  $('#clear', sv).addEventListener('click', () => { interp.entries = []; interp.consent = false; rerender(); });
  $('#consent', sv)?.addEventListener('change', e => { interp.consent = e.target.checked; });
  $('#save', sv)?.addEventListener('click', async () => {
    if (!interp.consent) return toast('Tick the consent box after asking the passenger.', 'warn');
    try {
      const r = await api('/api/staff/transcripts', { method: 'POST', body: { consent: true, passengerLang: interp.pLang, staffLang: interp.sLang, entries: interp.entries } });
      toast(`Transcript saved — auto-deletes ${fmtDateTime(r.expiresAt)}`, 'ok');
    } catch (e) { toast(e.message, 'warn'); }
  });
  sv.onclick = e => {
    const r = e.target.closest('[data-replay]');
    if (r) { const en = interp.entries[Number(r.dataset.replay)]; speech.speak(en.translated, langInfo(en.to).speech); }
  };

  async function addEntry(side, text) {
    const from = side === 'passenger' ? interp.pLang : interp.sLang;
    const to = side === 'passenger' ? interp.sLang : interp.pLang;
    const entry = { side, original: text, translated: null, from, to, at: Date.now(), engine: '…' };
    interp.entries.push(entry);
    rerender();
    try {
      const r = await api('/api/staff/translate', { method: 'POST', body: { text, from, to } });
      Object.assign(entry, { translated: r.text, engine: r.engine, machine: r.machine, error: r.error });
    } catch (ex) { Object.assign(entry, { engine: 'error', error: ex.message }); }
    rerender();
    if (entry.translated && interp.autoSpeak) speech.speak(entry.translated, langInfo(to).speech);
  }

  $$('.type-form', sv).forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    const inp = f.querySelector('input');
    const t = inp.value.trim();
    if (t) addEntry(f.dataset.type, t);
  }));

  let listening = null;
  $$('[data-mic]', sv).forEach(b => b.addEventListener('click', () => {
    if (listening) { listening.stop(); listening = null; return; }
    if (!speech.sttSupported()) return toast('Speech recognition is not available in this browser (try Chrome or Edge), or connect a Whisper server in Admin → Integrations.', 'warn', 7000);
    const side = b.dataset.mic;
    const lang = side === 'passenger' ? interp.pLang : interp.sLang;
    speech.cancel();
    b.classList.add('listening');
    const inp = b.closest('.side').querySelector('input');
    listening = speech.listen({
      lang, speechCode: langInfo(lang).speech,
      onInterim: t => { inp.value = t; },
      onFinal: t => { addEntry(side, t); },
      onError: c => { if (c === 'denied') toast('Microphone permission is blocked.', 'warn'); },
      onEnd: () => { listening = null; b.classList.remove('listening'); },
    });
  }));

  $('#phrasesBtn', sv).addEventListener('click', async () => {
    const box = $('#phrases', sv);
    if (!box.hidden) { box.hidden = true; return; }
    const { phrases } = await api('/api/staff/phrases');
    mount(box, html`<header><b>${icon('book')} Quick phrases</b><small>Exact, pre-translated phrases — always accurate</small></header>
      <div class="phrase-grid">${Object.entries(phrases).map(([id, p]) => html`<button class="phrase" data-ph="${id}"><b dir="auto">${p[interp.sLang] ?? p.en}</b><small dir="auto" lang="${interp.pLang}">${p[interp.pLang] ?? '— not available in this language —'}</small></button>`)}</div>`);
    box.hidden = false;
    box.onclick = e => {
      const b = e.target.closest('[data-ph]');
      if (!b) return;
      const p = phrases[b.dataset.ph];
      if (!p[interp.pLang]) return toast('This phrase has no reviewed translation for the passenger language.', 'warn');
      interp.entries.push({ side: 'staff', original: p[interp.sLang] ?? p.en, translated: p[interp.pLang], from: interp.sLang, to: interp.pLang, at: Date.now(), engine: 'phrasebook', machine: false });
      box.hidden = true;
      rerender();
      if (interp.autoSpeak) speech.speak(p[interp.pLang], langInfo(interp.pLang).speech);
    };
  });
}

// ---------- Guidance ----------
async function guidance(sv) {
  const sup = ['supervisor', 'admin'].includes(state.user.role);
  const { items } = await api(`/api/staff/guidance${sup ? '?drafts=1' : ''}`);
  const topics = { ffp: 'Frequent flyer', lounge: 'Lounge access', qcredits: 'Qcredits', upgrade: 'Upgrades', privacy: 'Privacy', other: 'Other' };
  mount(sv, html`<section class="page-wide">
    <h1>${icon('book')} Approved guidance</h1>
    <p class="muted">Use only approved wording with passengers. Eligibility decisions always require document verification and a recorded staff approval.</p>
    <div class="chips" id="topicf"><button class="chip active" data-t="">All</button>${Object.entries(topics).map(([k, l]) => html`<button class="chip" data-t="${k}">${l}</button>`)}</div>
    <div class="guide-list">${items.map(g => html`<article class="card guide" data-topic="${g.topic}">
      <header><span class="pill">${topics[g.topic] ?? g.topic}</span><h2>${g.title}</h2>
        ${g.status === 'approved' ? html`<span class="pill pill-ok">${icon('check')} Approved v${g.version}</span>` : html`<span class="pill pill-warn">Draft v${g.version} — not for use</span>`}</header>
      <div class="guide-body">${g.body}</div>
      <footer><small class="muted">${g.approved_by ? `Approved by ${g.approved_by} · ${fmtDateTime(g.approved_at)}` : 'Awaiting approval'}</small>
        ${g.source_url ? html`<a class="src" href="${g.source_url}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ''}
        <div class="row-end">${g.status === 'approved' && Object.keys(g.passenger_text).length ? html`<button class="btn btn-sm btn-primary" data-show="${g.id}">${icon('users')} Show to passenger</button>` : ''}
        ${g.status === 'draft' && sup ? html`<button class="btn btn-sm" data-approve="${g.id}">${icon('check')} Approve</button>` : ''}</div></footer>
    </article>`)}</div>
  </section>`);
  $('#topicf', sv).addEventListener('click', e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    $$('#topicf .chip', sv).forEach(c => c.classList.toggle('active', c === b));
    $$('.guide', sv).forEach(g => { g.hidden = !!b.dataset.t && g.dataset.topic !== b.dataset.t; });
  });
  sv.onclick = async e => {
    const ap = e.target.closest('[data-approve]');
    if (ap) { try { await api(`/api/staff/guidance/${ap.dataset.approve}/approve`, { method: 'POST', body: {} }); toast('Approved', 'ok'); guidance(sv); } catch (ex) { toast(ex.message, 'warn'); } return; }
    const sh = e.target.closest('[data-show]');
    if (!sh) return;
    const g = items.find(x => String(x.id) === sh.dataset.show);
    showToPassenger(g);
  };
}

async function showToPassenger(g) {
  const lang = interp.pLang;
  let text = g.passenger_text[lang], machine = false;
  if (!text) {
    try {
      const r = await api('/api/staff/translate', { method: 'POST', body: { text: g.passenger_text.en, from: 'en', to: lang } });
      text = r.text; machine = r.machine;
    } catch { text = null; }
  }
  const l = langInfo(lang);
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet present';
  mount(dlg, html`<form method="dialog" class="sheet-body">
    <p class="muted">Showing in ${l.name} · change the passenger language on the Interpreter tab</p>
    <p class="present-text" lang="${lang}" dir="${l.rtl ? 'rtl' : 'ltr'}">${text ?? g.passenger_text.en}</p>
    ${!text ? html`<p class="notice">No reviewed text in ${l.name} and no translation provider — shown in English.</p>` : machine ? html`<p class="notice">Machine translated</p>` : html`<p class="notice notice-ok">Reviewed translation</p>`}
    <div class="row-end"><button type="button" class="btn" id="spk">${icon('speaker')} Speak</button><button class="btn btn-primary">Close</button></div>
  </form>`);
  document.body.append(dlg);
  dlg.querySelector('#spk').addEventListener('click', () => speech.speak(text ?? g.passenger_text.en, text ? l.speech : 'en-GB'));
  dlg.addEventListener('close', () => { speech.cancel(); dlg.remove(); });
  dlg.showModal();
}

// ---------- Cases ----------
const STATUS_PILL = { pending: 'pill-warn', escalated: 'pill-info', approved: 'pill-ok', denied: 'pill-bad' };
function summary(c) {
  const i = c.inputs;
  if (c.kind === 'lounge') return `${c.loungeName ?? i.loungeId} · ${CARRIER_LABEL[i.carrier]} · ${CABIN_LABEL[i.cabin]} · ${TIER_LABEL[i.tier]}`;
  if (c.kind === 'upgrade') return `${i.flightNo ?? ''} ${CABIN_LABEL[i.fromCabin]} → ${CABIN_LABEL[i.toCabin]} via ${i.method}`;
  return `${TIER_LABEL[i.tier]} · ${i.topic}`;
}

async function cases(sv) {
  const filter = sessionStorage.getItem('bd.caseFilter') ?? 'open';
  const { items } = await api(`/api/staff/cases${filter === 'all' ? '' : `?status=${filter}`}`);
  mount(sv, html`<section class="page-wide">
    <div class="row-between"><h1>${icon('clipboard')} Eligibility cases</h1><button class="btn btn-primary" id="newc">${icon('plus')} New check</button></div>
    <p class="muted">This app only gives a provisional, rules-based indication. You must verify documents, complete the checklist and record a decision. Upgrades require supervisor approval by a second person.</p>
    <div class="chips" id="cf">${['open', 'approved', 'denied', 'all'].map(f => html`<button class="chip ${f === filter ? 'active' : ''}" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`)}</div>
    <div class="case-list">${items.length ? items.map(c => html`<a class="card case-row" href="#/staff/cases/${c.id}">
      <span class="case-id">#${c.id}</span><span class="pill">${c.kind}</span><span class="pill ${STATUS_PILL[c.status]}">${c.status}</span>
      <span class="case-sum">${summary(c)}</span><small class="muted">${fmtDateTime(c.createdAt)} · ${c.createdBy}</small></a>`) : html`<p class="muted">No cases.</p>`}</div>
  </section>`);
  $('#cf', sv).addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { sessionStorage.setItem('bd.caseFilter', b.dataset.f); cases(sv); } });
  $('#newc', sv).addEventListener('click', () => newCase());
}

async function newCase() {
  const { lounges } = await api('/api/map');
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => html`<option value="${k}" ${k === cur ? raw('selected') : ''}>${v}</option>`);
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  mount(dlg, html`<form class="sheet-body" id="ncf">
    <h2>New eligibility check</h2>
    <label class="field"><span>Type</span><select name="kind"><option value="lounge">Lounge access</option><option value="upgrade">Ticket upgrade (Avios / Qcredits / paid)</option><option value="membership">Membership / Qcredits question</option></select></label>
    <label class="field"><span>Flight number (optional)</span><input name="flightNo" maxlength="8" placeholder="QR 572" autocapitalize="characters"></label>
    <div data-k="lounge">
      <label class="field"><span>Lounge</span><select name="loungeId">${lounges.map(l => html`<option value="${l.id}">${l.name}</option>`)}</select></label>
      <label class="field"><span>Operating carrier</span><select name="carrier">${opts(CARRIER_LABEL, 'QR')}</select></label>
      <label class="field"><span>Cabin (from boarding pass)</span><select name="cabin">${opts(CABIN_LABEL, 'business')}</select></label>
    </div>
    <div data-k="upgrade" hidden>
      <label class="field"><span>From cabin</span><select name="fromCabin">${opts(CABIN_LABEL, 'economy')}</select></label>
      <label class="field"><span>To cabin</span><select name="toCabin">${opts(CABIN_LABEL, 'business')}</select></label>
      <label class="field"><span>Method</span><select name="method"><option value="avios">Avios</option><option value="qcredits">Qcredits</option><option value="paid">Paid</option></select></label>
    </div>
    <div data-k="membership" hidden>
      <label class="field"><span>Topic</span><select name="topic"><option value="tier">Tier status</option><option value="qcredits">Qcredits</option><option value="avios">Avios</option><option value="other">Other</option></select></label>
    </div>
    <label class="field"><span>Stated membership tier</span><select name="tier">${opts(TIER_LABEL, 'NONE')}</select></label>
    <label class="field"><span>Membership number — last 4 digits only (optional)</span><input name="memberLast4" inputmode="numeric" pattern="\\d{4}" maxlength="4"></label>
    <p class="error" id="ncerr" hidden></p>
    <div class="row-end"><button type="button" class="btn" value="cancel" id="ncx">Cancel</button><button class="btn btn-primary">Create case</button></div>
  </form>`);
  document.body.append(dlg);
  const f = dlg.querySelector('form');
  const sync = () => $$('[data-k]', f).forEach(d => { d.hidden = d.dataset.k !== f.kind.value; });
  f.kind.addEventListener('change', sync);
  dlg.querySelector('#ncx').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f));
    const inputs = { flightNo: fd.flightNo || undefined, tier: fd.tier, memberLast4: fd.memberLast4 || undefined };
    if (fd.kind === 'lounge') Object.assign(inputs, { loungeId: fd.loungeId, carrier: fd.carrier, cabin: fd.cabin });
    if (fd.kind === 'upgrade') Object.assign(inputs, { fromCabin: fd.fromCabin, toCabin: fd.toCabin, method: fd.method });
    if (fd.kind === 'membership') Object.assign(inputs, { topic: fd.topic });
    try {
      const c = await api('/api/staff/cases', { method: 'POST', body: { kind: fd.kind, inputs } });
      dlg.close();
      go(`#/staff/cases/${c.id}`);
    } catch (ex) { const er = dlg.querySelector('#ncerr'); er.textContent = ex.message; er.hidden = false; }
  });
  dlg.showModal();
}

async function caseDetail(sv, id) {
  let c;
  try { c = await api(`/api/staff/cases/${id}`); } catch { return mount(sv, html`<p class="error">Case not found.</p>`); }
  const open = ['pending', 'escalated'].includes(c.status);
  const canApprove = c.requiresRole === 'staff' || ['supervisor', 'admin'].includes(state.user.role);
  const fourEyes = c.kind === 'upgrade' && c.createdById === state.user.id;
  const loyalty = staffCfg.loyalty?.status === 'connected';
  const p = c.provisional;
  mount(sv, html`<section class="page-wide case">
    <a href="#/staff/cases" class="back">← All cases</a>
    <div class="row-between"><h1>Case #${c.id} <span class="pill">${c.kind}</span> <span class="pill ${STATUS_PILL[c.status]}">${c.status}</span></h1></div>
    <div class="case-grid">
      <div class="card">
        <h2>Details</h2>
        <dl class="kv">${Object.entries(c.inputs).filter(([k, val]) => val != null && k !== 'loyaltyCheck').map(([k, val]) => html`<dt>${k}</dt><dd>${k === 'loungeId' ? c.loungeName : (TIER_LABEL[val] ?? CABIN_LABEL[val] ?? CARRIER_LABEL[val] ?? val)}</dd>`)}</dl>
        <p class="muted small">Opened ${fmtDateTime(c.createdAt)} by ${c.createdBy}${c.recommendedBy ? ` · escalated by ${c.recommendedBy}` : ''}</p>
        <div class="prov prov-${p.result}"><b>${icon('info')} Provisional (unverified): ${RESULT_LABEL[p.result] ?? p.result}</b>
          <ul>${(p.reasons ?? []).map(r => html`<li>${REASONS[r] ?? r}</li>`)}</ul></div>
        ${c.inputs.loyaltyCheck ? html`<p class="${c.inputs.loyaltyCheck.verified ? 'ok' : 'error'}">${icon('shield')} Loyalty service: ${c.inputs.loyaltyCheck.verified ? 'verified' : 'NOT verified'} ${c.inputs.loyaltyCheck.tier ?? ''} (…${c.inputs.loyaltyCheck.memberLast4})</p>` : ''}
      </div>
      <div class="card">
        <h2>Verification checklist</h2>
        <form id="chk">${c.checklistDef.map(i => html`<label class="check check-lg"><input type="checkbox" name="${i.key}" ${c.checklist[i.key]?.checked ? raw('checked') : ''} ${open ? '' : raw('disabled')}><span>${i.label}${i.required ? html` <b class="req">*</b>` : ''}${c.checklist[i.key]?.checked ? html`<small class="muted"> — ${c.checklist[i.key].by}</small>` : ''}</span></label>`)}</form>
        ${open && c.kind !== 'upgrade' ? html`<div class="loyalty">${loyalty ? html`<form id="loy" class="row"><input name="memberNumber" placeholder="Membership number" inputmode="numeric" maxlength="15"><input name="lastName" placeholder="Last name" maxlength="60"><button class="btn btn-sm">Verify via loyalty service</button></form><small class="muted">The number is sent to the authorised service and never stored.</small>`
          : html`<p class="muted small">${icon('plug')} Loyalty verification service not connected — check the membership card or app manually.</p>`}</div>` : ''}
      </div>
    </div>
    ${open ? html`<div class="card decision">
      <h2>Decision</h2>
      <label class="field"><span>Reason / notes ${c.kind === 'lounge' && p.result !== 'likely' ? '(required to approve — rules did not indicate eligibility)' : ''}</span><textarea id="reason" rows="2" maxlength="500"></textarea></label>
      <p class="error" id="derr" role="alert" hidden></p>
      <div class="row-end">
        <button class="btn btn-bad" data-d="deny">${icon('x')} Deny</button>
        ${c.status !== 'escalated' && (c.requiresRole !== 'staff' || !canApprove) ? html`<button class="btn" data-d="escalate">Escalate to supervisor</button>` : ''}
        ${canApprove && !fourEyes ? html`<button class="btn btn-ok" data-d="approve">${icon('check')} Approve</button>` : html`<span class="muted small">${fourEyes ? 'Four-eyes rule: another supervisor must approve this upgrade.' : 'Approval requires a supervisor.'}</span>`}
      </div></div>`
    : html`<div class="card decision decided">
      <h2>${c.status === 'approved' ? 'Approved' : c.status === 'denied' ? 'Denied' : c.status}</h2>
      <p>${c.decidedBy ? `By ${c.decidedBy} · ${fmtDateTime(c.decidedAt)}` : ''}</p>${c.decisionReason ? html`<p>“${c.decisionReason}”</p>` : ''}
      ${c.refCode ? html`<div class="refcode"><small>Passenger verification code (valid until ${fmtDateTime(c.refExpires)})</small><b>${c.refCode}</b><small>The passenger can enter this in the app → Lounges to see the verified status.</small></div>` : ''}
      ${c.kind === 'upgrade' && c.status === 'approved' ? html`<p class="notice">${icon('alert')} Approval recorded in this app only — process and confirm the upgrade in the airline reservation system before telling the passenger it is confirmed.</p>` : ''}
    </div>`}
  </section>`);
  $('#chk', sv)?.addEventListener('change', async e => {
    try { await api(`/api/staff/cases/${id}/checklist`, { method: 'POST', body: { items: { [e.target.name]: e.target.checked } } }); }
    catch (ex) { toast(ex.message, 'warn'); }
    caseDetail(sv, id);
  });
  $('#loy', sv)?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try { await api(`/api/staff/cases/${id}/verify-loyalty`, { method: 'POST', body: fd }); caseDetail(sv, id); } catch (ex) { toast(ex.message, 'warn'); }
  });
  $$('[data-d]', sv).forEach(b => b.addEventListener('click', async () => {
    const err = $('#derr', sv);
    err.hidden = true;
    try {
      await api(`/api/staff/cases/${id}/decision`, { method: 'POST', body: { decision: b.dataset.d, reason: $('#reason', sv).value } });
      toast('Decision recorded', 'ok');
      caseDetail(sv, id);
    } catch (ex) { err.textContent = ex.message + (ex.data?.missing ? ` (${ex.data.missing.join(', ')})` : ''); err.hidden = false; }
  }));
}

function tools(sv) {
  mount(sv, html`<section class="page-wide">
    <h1>${icon('plane')} Flights & map</h1>
    <p class="muted">Use the passenger tools for flight lookup, gate navigation and lounge suggestions. ${state.meta.flightSource === 'live' ? 'Flight data: authorised live feed.' : html`<b>No authorised flight feed is connected</b> — flight results are simulated or unavailable.`}</p>
    <div class="tiles">
      <a class="tile tile-gate" href="#/flight">${icon('plane')}<b>Flight lookup</b></a>
      <a class="tile tile-map" href="#/map">${icon('map')}<b>Map & directions</b></a>
      <a class="tile tile-lounge" href="#/lounges">${icon('sofa')}<b>Lounge finder</b></a>
      <a class="tile tile-help" href="#/help">${icon('help')}<b>FAQs</b></a>
    </div>
  </section>`);
}
