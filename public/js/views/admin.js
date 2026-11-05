import { api, html, raw, mount, $, $$, toast, icon, fmtDateTime, debounce } from '../lib.js';
import { state, go } from '../app.js';
import { renderMap } from '../map.js';

const TABS = [
  ['overview', 'chart', 'Overview'], ['map', 'map', 'Map & locations'], ['gates', 'plane', 'Gates'], ['lounges', 'sofa', 'Lounges & hours'],
  ['faqs', 'help', 'FAQs'], ['languages', 'globe', 'Languages'], ['guidance', 'book', 'Guidance'], ['users', 'users', 'Users & roles'],
  ['integrations', 'plug', 'Integrations'], ['flights', 'ticket', 'Simulated flights'], ['privacy', 'shield', 'Privacy & settings'], ['audit', 'log', 'Audit log'],
];
const LOC_TYPES = ['gate', 'lounge', 'plaza', 'transfer', 'junction', 'lift', 'prayer', 'quiet', 'toilet', 'info', 'smoking', 'family', 'hotel', 'food', 'assistance', 'sleep', 'wellness', 'other'];
const STATUS_TEXT = { not_configured: 'Not connected', disabled: 'Disabled', awaiting_authorisation: 'Awaiting authorisation', configured_untested: 'Not tested', connected: 'Connected', error: 'Error', device: 'Device built-in' };
const STATUS_CLS = { connected: 'pill-ok', error: 'pill-bad', awaiting_authorisation: 'pill-warn', configured_untested: 'pill-warn', device: 'pill-info' };

export async function route(v, parts) {
  if (state.user.role !== 'admin') {
    mount(v, html`<section class="page"><div class="empty">${icon('shield')}<p>Administrator access is required.</p><a class="btn" href="#/staff">Back to staff console</a></div></section>`);
    return;
  }
  const tab = parts[0] ?? 'overview';
  mount(v, html`<div class="admin">
    <nav class="admin-nav" aria-label="Admin">${TABS.map(([k, ic, l]) => html`<a href="#/admin/${k}" class="${k === tab ? 'active' : ''}">${icon(ic)}<span>${l}</span></a>`)}
      <a href="#/staff">${icon('swap')}<span>Staff console</span></a><a href="#/">${icon('home')}<span>Passenger app</span></a></nav>
    <div class="admin-body" id="ab"></div></div>`);
  const ab = $('#ab', v);
  const fn = { overview, map: mapTab, gates, lounges, faqs, languages, guidance, users, integrations, flights, privacy, audit }[tab] ?? overview;
  try { await fn(ab); } catch (e) { mount(ab, html`<p class="error">${e.message}</p>`); }
}

// ---------- helpers ----------
function dialog(title, body, onSubmit, { wide = false, submitLabel = 'Save' } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `sheet ${wide ? 'sheet-wide' : ''}`;
  mount(dlg, html`<form class="sheet-body" novalidate><h2>${title}</h2>${body}<p class="error" data-err role="alert" hidden></p>
    <div class="row-end"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">${submitLabel}</button></div></form>`);
  document.body.append(dlg);
  const f = dlg.querySelector('form');
  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = f.querySelector('[data-err]');
    err.hidden = true;
    try { await onSubmit(f, dlg); dlg.close(); } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  dlg.showModal();
  return { dlg, f };
}
const field = (label, input, hint) => html`<label class="field"><span>${label}</span>${input}${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
const opt = (val, label, cur) => html`<option value="${val}" ${String(val) === String(cur) ? raw('selected') : ''}>${label}</option>`;
const chk = (name, label, on) => html`<label class="check"><input type="checkbox" name="${name}" ${on ? raw('checked') : ''}> ${label}</label>`;
const pill = (s) => html`<span class="pill ${STATUS_CLS[s] ?? ''}">${STATUS_TEXT[s] ?? s}</span>`;
const invalidateMap = () => { state.map = null; };

// ---------- Overview & analytics ----------
async function overview(ab) {
  const [ints, a, locs, lounges, faqsR, usersR] = await Promise.all([
    api('/api/admin/integrations'), api('/api/admin/analytics?days=30'), api('/api/admin/locations'), api('/api/admin/lounges'), api('/api/admin/faqs'), api('/api/admin/users'),
  ]);
  const gatesN = locs.items.filter(l => l.type === 'gate').length;
  const max = Math.max(1, ...a.daily.map(d => d.count ?? 0));
  const bars = list => html`<ul class="bars">${list.slice(0, 10).map(r => html`<li><span>${r.name}</span><i style="width:${r.suppressed ? 0 : Math.round((r.count / Math.max(1, list[0].count ?? 1)) * 100)}%"></i><b>${r.suppressed ? `<${a.minCount}` : r.count}</b></li>`)}</ul>`;
  mount(ab, html`<h1>Overview</h1>
    ${state.meta.demoMode ? html`<p class="banner banner-warn">${icon('alert')} <span><b>Demo mode.</b> Simulated flights and demo accounts are enabled. Before go-live: set <code>NODE_ENV=production</code>, create real accounts, connect only authorised integrations and replace simulated map/lounge data.</span></p>` : ''}
    <div class="stat-row">
      <div class="stat"><small>Questions (30 days)</small><b>${a.total ?? (a.totalSuppressed ? `<${a.minCount}` : 0)}</b></div>
      <div class="stat"><small>Gates</small><b>${gatesN}</b></div>
      <div class="stat"><small>Lounges</small><b>${lounges.items.length}</b></div>
      <div class="stat"><small>FAQs</small><b>${faqsR.items.length}</b></div>
      <div class="stat"><small>Staff accounts</small><b>${usersR.items.length}</b></div>
    </div>
    <h2>Integrations</h2>
    <div class="int-grid">${ints.items.map(i => html`<a class="card int-mini" href="#/admin/integrations">${icon('plug')}<div><b>${i.label}</b><small>${i.provider === 'none' ? '—' : i.provider}</small></div>${pill(i.status)}</a>`)}</div>
    <h2>Usage (privacy-protected)</h2>
    <p class="muted small">Aggregated daily counts only — no question text, IP addresses or identifiers are stored. Counts below ${a.minCount} are suppressed.</p>
    <div class="card"><div class="spark" aria-label="Daily questions, last 30 days">${a.daily.map(d => html`<i title="${d.day}: ${d.suppressed ? '<' + a.minCount : d.count}" style="height:${d.suppressed ? 4 : Math.max(2, Math.round(((d.count ?? 0) / max) * 100))}%" class="${d.suppressed ? 'sup' : ''}"></i>`)}</div></div>
    <div class="two-col"><div class="card"><h3>By topic</h3>${bars(a.byIntent)}</div><div class="card"><h3>By language</h3>${bars(a.byLang)}</div></div>`);
}

// ---------- Map ----------
async function mapTab(ab) {
  const [{ items }, mapData] = await Promise.all([api('/api/admin/locations'), api('/api/map')]);
  mount(ab, html`<div class="row-between"><h1>Map & locations</h1><div class="row-end">
      <button class="btn" id="exp">${icon('log')} Export JSON</button><button class="btn" id="imp">Import JSON</button><button class="btn btn-primary" id="addLoc">${icon('plus')} Add location</button></div></div>
    <p class="muted">The map is an <b>approximation built from public airport information</b> (official HIA pages: lounge levels and nearby gates, Lamp Bear, ORCHARD, North Node, passenger train). Replace it with authorised indoor-map data before go-live (import JSON, or connect an indoor-map provider in Integrations). Coordinates: x 0–${mapData.width}, y 0–${mapData.height} (1 unit ≈ 1.9 m).</p>
    <div class="card"><div id="amap" class="mapbox"></div></div>
    <label class="search-field">${icon('search')}<input id="ls" type="search" placeholder="Filter by id, name or type"></label>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Type</th><th>Name</th><th>Conc.</th><th>Level</th><th>Status</th><th>Sim.</th><th></th></tr></thead><tbody id="lt"></tbody></table></div>`);
  renderMap($('#amap', ab), mapData, { onSelect: n => n && editLocation(n.id, items, ab) });
  const draw = () => {
    const q = $('#ls', ab).value.toLowerCase();
    mount($('#lt', ab), html`${items.filter(l => !q || `${l.id} ${l.name} ${l.type}`.toLowerCase().includes(q)).slice(0, 400).map(l => html`<tr>
      <td><code>${l.id}</code></td><td>${l.type}</td><td>${l.name}</td><td>${l.concourse ?? ''}</td><td>${l.level ?? ''}</td><td>${l.status}</td><td>${l.simulated ? 'yes' : 'no'}</td>
      <td><button class="icon-btn" data-edit="${l.id}" aria-label="Edit">${icon('edit')}</button></td></tr>`)}`);
  };
  $('#ls', ab).addEventListener('input', debounce(draw, 150));
  draw();
  $('#lt', ab).addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) editLocation(b.dataset.edit, items, ab); });
  $('#addLoc', ab).addEventListener('click', () => editLocation(null, items, ab));
  $('#exp', ab).addEventListener('click', async () => {
    const data = await api('/api/admin/map/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'airport-map.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  $('#imp', ab).addEventListener('click', () => dialog('Import map JSON', html`<p class="muted">Replaces all locations and edges (lounge locations must be kept). Format: <code>{"locations":[{id,type,name,x,y,…}],"edges":[{a,b,distance_m,kind,step_free}]}</code></p>
    ${field('JSON file', html`<input type="file" name="file" accept="application/json,.json" required>`)}`, async f => {
    const file = f.file.files[0];
    if (!file) throw new Error('Choose a file');
    const data = JSON.parse(await file.text());
    const r = await api('/api/admin/map/import', { method: 'POST', body: data });
    toast(`Imported ${r.locations} locations, ${r.edges} edges`, 'ok'); invalidateMap(); mapTab(ab);
  }, { submitLabel: 'Import' }));
}

async function editLocation(id, items, ab, after = () => mapTab(ab)) {
  const l = id ? items.find(x => x.id === id) : { type: 'other', status: 'open', simulated: 1, accessible: 1, level: '1', x: 500, y: 380 };
  const { items: edges } = await api('/api/admin/edges');
  const mine = id ? edges.filter(e => e.a === id || e.b === id) : [];
  const { f } = dialog(id ? `Edit ${id}` : 'Add location', html`
    ${id ? '' : field('ID (A–Z, 0–9, _)', html`<input name="id" required pattern="[A-Z0-9_]{2,40}" placeholder="PRAYER_E2">`)}
    <div class="grid2">${field('Type', html`<select name="type">${LOC_TYPES.map(t => opt(t, t, l.type))}</select>`)}${field('Status', html`<select name="status">${['open', 'closed', 'verify'].map(s => opt(s, s, l.status))}</select>`)}</div>
    ${field('Name', html`<input name="name" required maxlength="120" value="${l.name ?? ''}">`)}
    <div class="grid3">${field('Concourse', html`<input name="concourse" maxlength="2" value="${l.concourse ?? ''}">`)}${field('x', html`<input name="x" type="number" min="0" max="1000" step="0.1" value="${l.x}">`)}${field('y', html`<input name="y" type="number" min="0" max="760" step="0.1" value="${l.y}">`)}</div>
    <div class="grid2">${field('Level', html`<input name="level" maxlength="10" value="${l.level ?? ''}">`)}${field('Notes', html`<input name="notes" maxlength="500" value="${l.notes ?? ''}">`)}</div>
    ${chk('simulated', 'Simulated position (shown to users as simulated)', l.simulated)} ${chk('accessible', 'Step-free accessible', l.accessible)}
    ${id ? html`<h3>Connections</h3><ul class="edge-list">${mine.map(e => html`<li><code>${e.a === id ? e.b : e.a}</code> · ${e.kind} · ${e.distance_m} m ${e.step_free ? '♿' : ''}<button type="button" class="icon-btn" data-del-edge="${e.id}" aria-label="Remove">${icon('trash')}</button></li>`)}</ul>
      <div class="grid3">${field('Connect to ID', html`<input name="edgeTo" placeholder="S_C3">`)}${field('Kind', html`<select name="edgeKind">${['walk', 'escalator', 'lift', 'stairs', 'travelator', 'train'].map(k => opt(k, k, 'walk'))}</select>`)}${field('Distance m (blank = auto)', html`<input name="edgeDist" type="number" min="1" max="5000">`)}</div>
      <button type="button" class="btn btn-danger" data-del-loc>${icon('trash')} Delete location</button>`
    : field('Connect to (comma-separated IDs)', html`<input name="connectTo" placeholder="S_C3">`, 'Walking distance is calculated from coordinates.')}`, async form => {
    const body = { type: form.type.value, status: form.status.value, name: form.name.value, concourse: form.concourse.value || null, x: Number(form.x.value), y: Number(form.y.value), level: form.level.value, notes: form.notes.value || null, simulated: form.simulated.checked, accessible: form.accessible.checked };
    if (id) {
      await api(`/api/admin/locations/${id}`, { method: 'PUT', body });
      if (form.edgeTo.value.trim()) await api('/api/admin/edges', { method: 'POST', body: { a: id, b: form.edgeTo.value.trim().toUpperCase(), kind: form.edgeKind.value, distance_m: form.edgeDist.value || null } });
    } else {
      await api('/api/admin/locations', { method: 'POST', body: { ...body, id: form.id.value.trim().toUpperCase(), connectTo: form.connectTo.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) } });
    }
    toast('Saved', 'ok'); invalidateMap(); after();
  }, { wide: true });
  f.addEventListener('click', async e => {
    const de = e.target.closest('[data-del-edge]');
    if (de) { await api(`/api/admin/edges/${de.dataset.delEdge}`, { method: 'DELETE' }).catch(x => toast(x.message, 'warn')); de.closest('li').remove(); invalidateMap(); }
    if (e.target.closest('[data-del-loc]') && confirm(`Delete ${id} and its connections?`)) {
      try { await api(`/api/admin/locations/${id}`, { method: 'DELETE' }); f.closest('dialog').close(); toast('Deleted', 'ok'); invalidateMap(); after(); } catch (x) { toast(x.message, 'warn'); }
    }
  });
}

// ---------- Gates ----------
async function gates(ab) {
  const { items } = await api('/api/admin/locations');
  const gs = items.filter(l => l.type === 'gate').sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  mount(ab, html`<div class="row-between"><h1>Gates</h1><button class="btn btn-primary" id="addG">${icon('plus')} Add gate</button></div>
    <p class="muted">All seeded gates and positions are <b>simulated</b>. Closing a gate removes it from routing as a pass-through point and marks it on the map.</p>
    <div class="gate-grid">${gs.map(g => html`<div class="card gate-cell ${g.status}"><b>${g.id.replace('GATE_', '')}</b>
      <select data-gate="${g.id}" aria-label="Status of ${g.id}">${['open', 'closed', 'verify'].map(s => opt(s, s, g.status))}</select>
      <button class="icon-btn" data-edit="${g.id}" aria-label="Edit">${icon('edit')}</button>${g.simulated ? html`<small class="muted">sim</small>` : ''}</div>`)}</div>`);
  ab.onchange = async e => {
    const s = e.target.closest('[data-gate]');
    if (!s) return;
    try { await api(`/api/admin/locations/${s.dataset.gate}`, { method: 'PUT', body: { status: s.value } }); toast(`${s.dataset.gate} → ${s.value}`, 'ok'); invalidateMap(); gates(ab); } catch (x) { toast(x.message, 'warn'); }
  };
  ab.onclick = e => { const b = e.target.closest('[data-edit]'); if (b) editLocation(b.dataset.edit, items, ab, () => gates(ab)); };
  $('#addG', ab).addEventListener('click', () => dialog('Add gate', html`
    <div class="grid2">${field('Concourse', html`<select name="c">${['A', 'B', 'C', 'D', 'E'].map(c => opt(c, c, 'C'))}</select>`)}${field('Number', html`<input name="n" type="number" min="1" max="99" required>`)}</div>
    ${field('Attach to walkway / location ID', html`<input name="attach" required placeholder="S_C14">`, 'The new gate is placed next to this location and connected to it.')}`, async f => {
    const attach = items.find(l => l.id === f.attach.value.trim().toUpperCase());
    if (!attach) throw new Error('Unknown attach location');
    const code = f.c.value + Number(f.n.value);
    await api('/api/admin/locations', { method: 'POST', body: { id: `GATE_${code}`, type: 'gate', name: `Gate ${code}`, concourse: f.c.value, x: Math.min(1000, attach.x + 20), y: Math.min(760, attach.y + 20), simulated: true, connectTo: [attach.id] } });
    toast(`Gate ${code} added`, 'ok'); invalidateMap(); gates(ab);
  }));
}

// ---------- Lounges ----------
const CARRIERS = { QR: 'Qatar Airways', ONEWORLD: 'Any oneworld (incl. QR)', OTHER: 'Other airline', ANY: 'Any airline' };
const CABINS = { economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First' };
const TIERS = { PC_BURGUNDY: 'PC Burgundy', PC_SILVER: 'PC Silver', PC_GOLD: 'PC Gold', PC_PLATINUM: 'PC Platinum', OW_RUBY: 'oneworld Ruby', OW_SAPPHIRE: 'oneworld Sapphire', OW_EMERALD: 'oneworld Emerald', OTHER: 'Other programme' };

function ruleEditor(rules) {
  const group = (i, name, dict, sel) => html`<fieldset class="ck-group"><legend>${name}</legend>${Object.entries(dict).map(([k, l]) => html`<label class="check"><input type="checkbox" data-r="${i}" data-g="${name.toLowerCase()}" value="${k}" ${sel?.includes(k) ? raw('checked') : ''}> ${l}</label>`)}</fieldset>`;
  return html`<div class="rules">${rules.map((r, i) => html`<div class="rule card" data-rule="${i}"><header><b>Rule ${i + 1}</b> <small class="muted">all ticked groups must match</small><button type="button" class="icon-btn" data-delrule="${i}" aria-label="Remove rule">${icon('trash')}</button></header>
    ${group(i, 'Carriers', CARRIERS, r.carriers)}${group(i, 'Cabins', CABINS, r.cabins)}${group(i, 'Tiers', TIERS, r.tiers)}
    <label class="field"><span>Reason code</span><input data-reason="${i}" value="${r.reason ?? 'rule_match'}" pattern="[a-z0-9_]+"></label></div>`)}
    <button type="button" class="btn btn-sm" data-addrule>${icon('plus')} Add rule</button></div>`;
}
function readRules(f, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const pick = g => $$(`[data-r="${i}"][data-g="${g}"]:checked`, f).map(x => x.value);
    const r = { reason: $(`[data-reason="${i}"]`, f)?.value || 'rule_match' };
    const c = pick('carriers'), cb = pick('cabins'), t = pick('tiers');
    if (c.length) r.carriers = c; if (cb.length) r.cabins = cb; if (t.length) r.tiers = t;
    out.push(r);
  }
  return out;
}

async function lounges(ab) {
  const [{ items }, { items: locs }] = await Promise.all([api('/api/admin/lounges'), api('/api/admin/locations')]);
  mount(ab, html`<div class="row-between"><h1>Lounges & opening hours</h1><button class="btn btn-primary" id="addL">${icon('plus')} Add lounge</button></div>
    <p class="muted">Eligibility rules give passengers a <b>provisional</b> indication only. Seeded lounges, levels and access rules follow the official HIA lounge pages (checked 2026-11-05); map positions are approximate and opening hours are not published there, so they are marked "not confirmed". Replace with authorised information before go-live.</p>
    <div class="lounge-admin">${items.map(l => html`<article class="card"><header><h3>${l.name}</h3>${l.simulated ? html`<span class="pill pill-sim">Simulated</span>` : ''}<span class="pill">${l.status}</span></header>
      <p class="small">${icon('clock')} ${l.hours.label ?? (l.hours.always ? '24 hours' : l.hours.unknown ? 'Hours not confirmed' : `${l.hours.open}–${l.hours.close}`)} · ${icon('pin')} <code>${l.location_id}</code> · ${l.rules.rules.length} rule(s)${l.rules.paid ? ' · paid entry' : ''}</p>
      ${l.notes ? html`<p class="small muted">${l.notes}</p>` : ''}
      <div class="row-end">${l.source_url ? html`<a class="src" href="${l.source_url}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ''}<button class="btn btn-sm" data-edit="${l.id}">${icon('edit')} Edit</button></div></article>`)}</div>`);
  const edit = id => {
    const l = id ? structuredClone(items.find(x => x.id === id)) : { hours: { always: true }, rules: { rules: [], paid: false }, amenities: [], status: 'open', simulated: true, location_id: '' };
    let rules = l.rules.rules;
    const { f } = dialog(id ? `Edit ${l.name}` : 'Add lounge', html`
      ${id ? '' : field('ID', html`<input name="id" required pattern="[A-Z0-9_]{2,40}" placeholder="L_NEW">`)}
      ${field('Name', html`<input name="name" required value="${l.name ?? ''}">`)}
      <div class="grid2">${field('Map location', html`<select name="location_id">${locs.filter(x => x.type === 'lounge').map(x => opt(x.id, `${x.id} — ${x.name}`, l.location_id))}</select>`, 'Create a location of type "lounge" first.')}${field('Operator', html`<input name="operator" value="${l.operator ?? ''}">`)}</div>
      <div class="grid3">${field('Status', html`<select name="status">${['open', 'closed', 'verify'].map(s => opt(s, s, l.status))}</select>`)}${field('Opens', html`<input name="open" type="time" value="${l.hours.open ?? '05:00'}">`)}${field('Closes', html`<input name="close" type="time" value="${l.hours.close ?? '23:00'}">`)}</div>
      ${chk('always', 'Open 24 hours', l.hours.always)} ${chk('unknown', 'Hours not confirmed (passengers are told to check)', l.hours.unknown)} ${chk('paid', 'Paid entry available', l.rules.paid)} ${chk('simulated', 'Simulated data', l.simulated)}
      ${field('Hours label shown to passengers', html`<input name="hlabel" value="${l.hours.label ?? ''}" maxlength="120">`)}
      ${field('Paid access note', html`<input name="paid_access" value="${l.paid_access ?? ''}" maxlength="300">`)}
      ${field('Amenities (comma-separated codes)', html`<input name="amenities" value="${l.amenities.join(', ')}">`)}
      <div class="grid2">${field('Source URL', html`<input name="source_url" type="url" value="${l.source_url ?? ''}">`)}${field('Notes', html`<input name="notes" value="${l.notes ?? ''}" maxlength="500">`)}</div>
      <h3>Access rules</h3><div id="rulebox">${ruleEditor(rules)}</div>
      ${id ? html`<button type="button" class="btn btn-danger" data-dell>${icon('trash')} Delete lounge</button>` : ''}`, async form => {
      const body = {
        name: form.name.value, location_id: form.location_id.value, operator: form.operator.value || null, status: form.status.value,
        hours: form.always.checked ? { always: true, label: form.hlabel.value || '24 hours' } : form.unknown.checked ? { unknown: true, label: form.hlabel.value || undefined } : { open: form.open.value, close: form.close.value, label: form.hlabel.value || undefined },
        rules: { rules: readRules(form, rules.length), paid: form.paid.checked }, simulated: form.simulated.checked,
        paid_access: form.paid_access.value || null, amenities: form.amenities.value.split(',').map(s => s.trim()).filter(Boolean),
        source_url: form.source_url.value || null, notes: form.notes.value || null,
      };
      if (id) await api(`/api/admin/lounges/${id}`, { method: 'PUT', body }); else await api('/api/admin/lounges', { method: 'POST', body: { ...body, id: form.id.value.trim().toUpperCase() } });
      toast('Saved', 'ok'); invalidateMap(); lounges(ab);
    }, { wide: true });
    f.addEventListener('click', async e => {
      if (e.target.closest('[data-addrule]')) { rules = [...readRules(f, rules.length), { carriers: ['QR'], reason: 'rule_match' }]; mount($('#rulebox', f), ruleEditor(rules)); }
      const d = e.target.closest('[data-delrule]');
      if (d) { rules = readRules(f, rules.length).filter((_, i) => i !== Number(d.dataset.delrule)); mount($('#rulebox', f), ruleEditor(rules)); }
      if (e.target.closest('[data-dell]') && confirm('Delete this lounge?')) { await api(`/api/admin/lounges/${id}`, { method: 'DELETE' }); f.closest('dialog').close(); invalidateMap(); lounges(ab); }
    });
  };
  ab.onclick = e => { const b = e.target.closest('[data-edit]'); if (b) edit(b.dataset.edit); };
  $('#addL', ab).addEventListener('click', () => edit(null));
}

// ---------- FAQs ----------
async function faqs(ab) {
  const [{ items }, { items: langs }] = await Promise.all([api('/api/admin/faqs'), api('/api/admin/languages')]);
  mount(ab, html`<div class="row-between"><h1>FAQs</h1><button class="btn btn-primary" id="addF">${icon('plus')} Add FAQ</button></div>
    <p class="muted">Answers are shown verbatim and also used as the only facts the AI model may use for open questions. Keep a source URL and verification date for each.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Category</th><th>Question (EN)</th><th>Languages</th><th>Verified</th><th>Published</th><th></th></tr></thead>
    <tbody>${items.map(q => html`<tr><td>${q.id}</td><td>${q.category}</td><td>${q.translations.en?.q}</td><td>${Object.keys(q.translations).join(', ')}</td><td>${q.verified_on ?? '—'}</td><td>${q.published ? '✓' : '—'}</td><td><button class="icon-btn" data-edit="${q.id}" aria-label="Edit">${icon('edit')}</button></td></tr>`)}</tbody></table></div>`);
  const edit = id => {
    const q = id ? items.find(x => x.id === id) : { category: 'general', translations: {}, keywords: '', published: true };
    const { f } = dialog(id ? `Edit FAQ #${id}` : 'Add FAQ', html`
      <div class="grid2">${field('Category', html`<input name="category" required pattern="[a-z_]+" value="${q.category}">`)}${field('Verified on', html`<input name="verified_on" type="date" value="${q.verified_on ?? ''}">`)}</div>
      ${field('Source URL', html`<input name="source_url" type="url" value="${q.source_url ?? ''}">`)}
      ${field('Recognition keywords (comma-separated, any language)', html`<textarea name="keywords" rows="2">${q.keywords}</textarea>`)}
      ${chk('published', 'Published', q.published)}
      ${langs.map(l => html`<details ${l.code === 'en' || q.translations[l.code] ? raw('open') : ''}><summary>${l.name} ${l.code === 'en' ? '(required)' : ''}</summary>
        ${field('Question', html`<input name="q_${l.code}" dir="${l.rtl ? 'rtl' : 'ltr'}" value="${q.translations[l.code]?.q ?? ''}">`)}${field('Answer', html`<textarea name="a_${l.code}" rows="3" dir="${l.rtl ? 'rtl' : 'ltr'}">${q.translations[l.code]?.a ?? ''}</textarea>`)}</details>`)}
      ${id ? html`<button type="button" class="btn btn-danger" data-delf>${icon('trash')} Delete FAQ</button>` : ''}`, async form => {
      const translations = {};
      for (const l of langs) { const qq = form[`q_${l.code}`].value.trim(), aa = form[`a_${l.code}`].value.trim(); if (qq || aa) translations[l.code] = { q: qq, a: aa }; }
      const body = { category: form.category.value, verified_on: form.verified_on.value || null, source_url: form.source_url.value || null, keywords: form.keywords.value, published: form.published.checked, translations };
      if (id) await api(`/api/admin/faqs/${id}`, { method: 'PUT', body }); else await api('/api/admin/faqs', { method: 'POST', body });
      toast('Saved', 'ok'); faqs(ab);
    }, { wide: true });
    f.addEventListener('click', async e => { if (e.target.closest('[data-delf]') && confirm('Delete FAQ?')) { await api(`/api/admin/faqs/${id}`, { method: 'DELETE' }); f.closest('dialog').close(); faqs(ab); } });
  };
  ab.onclick = e => { const b = e.target.closest('[data-edit]'); if (b) edit(Number(b.dataset.edit)); };
  $('#addF', ab).addEventListener('click', () => edit(null));
}

// ---------- Languages ----------
async function languages(ab) {
  const { items } = await api('/api/admin/languages');
  mount(ab, html`<div class="row-between"><h1>Languages</h1><button class="btn btn-primary" id="addLang">${icon('plus')} Add language</button></div>
    <p class="muted"><b>Built-in</b> languages have reviewed interface text and answer templates. Other languages use English templates plus machine translation — enable them only when a translation provider (or AI model) is connected.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Language</th><th>Native</th><th>Speech code</th><th>RTL</th><th>Built-in</th><th>Enabled</th></tr></thead>
    <tbody>${items.map(l => html`<tr><td><code>${l.code}</code></td><td>${l.name}</td><td>${l.native_name}</td><td><input class="inline" data-speech="${l.code}" value="${l.speech_code}" size="8"></td><td>${l.rtl ? 'yes' : ''}</td><td>${l.builtin ? '✓' : '—'}</td>
      <td><label class="switch"><input type="checkbox" data-en="${l.code}" ${l.enabled ? raw('checked') : ''} ${l.code === 'en' ? raw('disabled') : ''}><span class="switch-ui"></span></label></td></tr>`)}</tbody></table></div>`);
  ab.onchange = async e => {
    const t = e.target;
    try {
      if (t.dataset.en) await api(`/api/admin/languages/${t.dataset.en}`, { method: 'PUT', body: { enabled: t.checked } });
      if (t.dataset.speech) await api(`/api/admin/languages/${t.dataset.speech}`, { method: 'PUT', body: { speech_code: t.value } });
      toast('Saved', 'ok');
    } catch (x) { toast(x.message, 'warn'); languages(ab); }
  };
  $('#addLang', ab).addEventListener('click', () => dialog('Add language', html`<div class="grid2">${field('ISO code', html`<input name="code" required pattern="[a-z]{2,3}(-[A-Z]{2})?" placeholder="ne">`)}${field('Speech code (BCP-47)', html`<input name="speech_code" required placeholder="ne-NP">`)}</div>
    <div class="grid2">${field('English name', html`<input name="name" required>`)}${field('Native name', html`<input name="native_name" required>`)}</div>${chk('rtl', 'Right-to-left script', false)} ${chk('enabled', 'Enable now', false)}`, async f => {
    await api('/api/admin/languages', { method: 'POST', body: { code: f.code.value.trim(), speech_code: f.speech_code.value.trim(), name: f.name.value, native_name: f.native_name.value, rtl: f.rtl.checked, enabled: f.enabled.checked } });
    toast('Language added', 'ok'); languages(ab);
  }));
}

// ---------- Guidance ----------
async function guidance(ab) {
  const { items } = await api('/api/admin/guidance');
  mount(ab, html`<div class="row-between"><h1>Approved guidance</h1><button class="btn btn-primary" id="addG">${icon('plus')} New guidance</button></div>
    <p class="muted">Edits return an item to <b>draft</b>; a supervisor must approve it in Staff → Guidance before staff can use it. Seed content carries a simulated approval and must be replaced with your authorised airline wording.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Topic</th><th>Title</th><th>Status</th><th>Version</th><th>Approved by</th><th></th></tr></thead>
    <tbody>${items.map(g => html`<tr><td>${g.topic}</td><td>${g.title}</td><td><span class="pill ${g.status === 'approved' ? 'pill-ok' : g.status === 'draft' ? 'pill-warn' : ''}">${g.status}</span></td><td>${g.version}</td><td class="small">${g.approved_by ?? '—'}</td><td><button class="icon-btn" data-edit="${g.id}" aria-label="Edit">${icon('edit')}</button></td></tr>`)}</tbody></table></div>`);
  const edit = id => {
    const g = id ? items.find(x => x.id === id) : { topic: 'other', title: '', body: '', passenger_text: {} };
    const langs = state.meta.languages;
    const { f } = dialog(id ? 'Edit guidance' : 'New guidance', html`
      <div class="grid2">${field('Topic', html`<select name="topic">${['ffp', 'lounge', 'qcredits', 'upgrade', 'privacy', 'other'].map(t => opt(t, t, g.topic))}</select>`)}${field('Source URL', html`<input name="source_url" type="url" value="${g.source_url ?? ''}">`)}</div>
      ${field('Title', html`<input name="title" required maxlength="160" value="${g.title}">`)}
      ${field('Staff guidance', html`<textarea name="body" rows="8" required>${g.body}</textarea>`)}
      <h3>Passenger-facing text</h3>${langs.map(l => html`<details ${g.passenger_text[l.code] || l.code === 'en' ? raw('open') : ''}><summary>${l.name}</summary><textarea name="p_${l.code}" rows="2" dir="${l.rtl ? 'rtl' : 'ltr'}">${g.passenger_text[l.code] ?? ''}</textarea></details>`)}
      ${id && g.status !== 'retired' ? html`<button type="button" class="btn btn-danger" data-retire>Retire</button>` : ''}`, async form => {
      const passenger_text = {};
      for (const l of langs) { const v = form[`p_${l.code}`].value.trim(); if (v) passenger_text[l.code] = v; }
      const body = { topic: form.topic.value, title: form.title.value, body: form.body.value, source_url: form.source_url.value || null, passenger_text };
      if (id) await api(`/api/admin/guidance/${id}`, { method: 'PUT', body }); else await api('/api/admin/guidance', { method: 'POST', body });
      toast('Saved as draft — awaiting supervisor approval', 'ok'); guidance(ab);
    }, { wide: true });
    f.addEventListener('click', async e => { if (e.target.closest('[data-retire]') && confirm('Retire this guidance?')) { await api(`/api/admin/guidance/${id}`, { method: 'PUT', body: { status: 'retired' } }); f.closest('dialog').close(); guidance(ab); } });
  };
  ab.onclick = e => { const b = e.target.closest('[data-edit]'); if (b) edit(Number(b.dataset.edit)); };
  $('#addG', ab).addEventListener('click', () => edit(null));
}

// ---------- Users ----------
async function users(ab) {
  const { items } = await api('/api/admin/users');
  mount(ab, html`<div class="row-between"><h1>Users & roles</h1><button class="btn btn-primary" id="addU">${icon('plus')} Add user</button></div>
    <p class="muted"><b>staff</b>: interpreter, guidance, lounge/membership cases · <b>supervisor</b>: + approve upgrades and guidance · <b>admin</b>: + full configuration. Passwords need 12+ characters with upper/lower case and a number. Accounts lock for 15 minutes after 5 failed sign-ins.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
    <tbody>${items.map(u => html`<tr><td>${u.username} ${u.isDemo ? html`<span class="pill pill-warn">demo</span>` : ''}</td><td>${u.displayName}</td><td>${u.role}</td><td>${u.active ? (u.locked ? 'locked' : 'active') : 'disabled'}</td><td class="small">${fmtDateTime(u.lastLoginAt)}</td>
      <td><button class="icon-btn" data-edit="${u.id}" aria-label="Edit">${icon('edit')}</button></td></tr>`)}</tbody></table></div>`);
  const pw = html`${field('Password', html`<input name="password" type="password" autocomplete="new-password" minlength="12" required>`, '12+ characters, upper & lower case, a number')}`;
  $('#addU', ab).addEventListener('click', () => dialog('Add user', html`<div class="grid2">${field('Username', html`<input name="username" required pattern="[A-Za-z0-9._-]{3,40}">`)}${field('Display name', html`<input name="displayName" required>`)}</div>
    ${field('Role', html`<select name="role">${opt('staff', 'staff', 'staff')}${opt('supervisor', 'supervisor')}${opt('admin', 'admin')}</select>`)}${pw}`, async f => {
    await api('/api/admin/users', { method: 'POST', body: { username: f.username.value, displayName: f.displayName.value, role: f.role.value, password: f.password.value } });
    toast('User created', 'ok'); users(ab);
  }));
  ab.onclick = e => {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const u = items.find(x => String(x.id) === b.dataset.edit);
    dialog(`Edit ${u.username}`, html`${field('Display name', html`<input name="displayName" value="${u.displayName}" required>`)}
      ${field('Role', html`<select name="role">${['staff', 'supervisor', 'admin'].map(r => opt(r, r, u.role))}</select>`)}
      ${chk('active', 'Active', u.active)} ${u.locked ? chk('unlock', 'Unlock now', true) : ''}
      <h3>Reset password (optional)</h3>${field('New password', html`<input name="password" type="password" autocomplete="new-password">`, 'Leave blank to keep. Resetting signs the user out everywhere.')}`, async f => {
      await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { displayName: f.displayName.value, role: f.role.value, active: f.active.checked, unlock: f.unlock?.checked } });
      if (f.password.value) await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: { password: f.password.value } });
      toast('Saved', 'ok'); users(ab);
    });
  };
}

// ---------- Integrations ----------

// ---- Built-in AI (runs inside this server) ----
async function builtinAiCard(ab, items) {
  const box = $('#builtinAi', ab);
  if (!box) return;
  let models;
  try { ({ models } = await api('/api/admin/ai/models')); } catch { return; }
  const primary = items.find(i => i.id === 'llm_primary');
  const activeId = primary?.provider === 'builtin' && primary.status === 'connected' ? (primary.config?.model || 'qwen3-4b') : null;
  const busy = Object.values(models).some(m => m.downloading);
  mount(box, html`<div class="card ai-card">
    <div class="row-between"><h2>${icon('sparkle')} Built-in AI — Qwen3, runs inside this app</h2>
      ${activeId ? html`<span class="pill pill-live">On · ${activeId}</span>` : html`<span class="pill pill-sim">Off</span>`}</div>
    <p class="muted">Understands messy questions in any language and translates passenger ↔ staff messages. It runs on <b>this server</b> — tablets, kiosks and phones need nothing installed, and passenger text never leaves this machine. Facts (gates, times, rules) still come only from the app's own data. Free and open-source (Apache-2.0).</p>
    <div class="ai-models">${Object.entries(models).map(([id, m]) => html`<div class="ai-model${activeId === id ? ' active' : ''}">
      <div><b>${m.label}</b>
        ${m.downloading ? html`<div class="progress"><i style="width:${Math.min(100, (m.downloading.done / m.downloading.total) * 100).toFixed(0)}%"></i></div><small>Downloading ${(m.downloading.done / 1e9).toFixed(2)} of ${(m.downloading.total / 1e9).toFixed(2)} GB…</small>`
          : m.error ? html`<small class="error">Download failed: ${m.error}</small>`
          : html`<small class="muted">${m.installed ? 'Downloaded' : 'Not downloaded'}${m.loaded ? ' · loaded in memory' : ''}</small>`}</div>
      <div class="row-end">
        ${!m.installed && !m.downloading ? html`<button class="btn btn-sm" data-ai-dl="${id}">Download (${m.sizeGb} GB)</button>` : ''}
        ${m.installed && activeId !== id ? html`<button class="btn btn-primary btn-sm" data-ai-on="${id}">Turn on</button>` : ''}
      </div></div>`)}</div>
  </div>`);
  box.onclick = async e => {
    const dl = e.target.closest('[data-ai-dl]'), on = e.target.closest('[data-ai-on]');
    if (dl) { dl.disabled = true; await api(`/api/admin/ai/models/${dl.dataset.aiDl}/download`, { method: 'POST' }).catch(x => toast(x.message, 'warn')); builtinAiCard(ab, items); }
    if (on) {
      on.disabled = true; on.textContent = 'Loading model and testing…';
      try { const r = await api('/api/admin/ai/enable-builtin', { method: 'POST', body: { model: on.dataset.aiOn } }); toast(r.detail, 'ok', 6000); integrations(ab); }
      catch (x) { toast(x.message, 'warn', 8000); builtinAiCard(ab, items); }
    }
  };
  if (busy) setTimeout(() => { if (document.body.contains(box)) builtinAiCard(ab, items); }, 2000);
}

async function integrations(ab) {
  const { items } = await api('/api/admin/integrations');
  mount(ab, html`<h1>Integrations</h1>
    <p class="banner banner-info">${icon('shield')} <span>No external system is used until you (1) choose a provider and enter its details, (2) confirm it is <b>authorised</b> by the data owner, (3) enable it and (4) pass a live connection test. Passengers never see an integration as connected unless all four are true. Secrets are encrypted at rest (AES-256-GCM).</span></p>
    <div id="builtinAi"></div>
    <div class="int-list">${items.map(i => intCard(i))}</div>`);
  builtinAiCard(ab, items);
  ab.onchange = e => {
    const sel = e.target.closest('[data-prov]');
    if (!sel) return;
    const card = sel.closest('[data-int]');
    const i = items.find(x => x.id === card.dataset.int);
    card.outerHTML = String(intCard({ ...i, provider: sel.value, config: sel.value === i.provider ? i.config : {} }));
  };
  ab.onclick = async e => {
    const card = e.target.closest('[data-int]');
    if (!card) return;
    const id = card.dataset.int;
    const save = e.target.closest('[data-save]'), test = e.target.closest('[data-test]');
    if (!save && !test) return;
    const btn = save ?? test;
    btn.disabled = true;
    try {
      if (save) {
        const config = {};
        $$('[data-cfg]', card).forEach(inp => { config[inp.dataset.cfg] = inp.value; });
        await api(`/api/admin/integrations/${id}`, { method: 'PUT', body: { provider: $('[data-prov]', card).value, config, enabled: $('[data-enabled]', card).checked, authorised: $('[data-auth]', card).checked } });
        toast('Saved — run a connection test', 'ok');
      } else {
        const r = await api(`/api/admin/integrations/${id}/test`, { method: 'POST', body: {} });
        toast(r.status === 'connected' ? 'Connection test passed' : `Test failed: ${r.statusDetail ?? r.status}`, r.status === 'connected' ? 'ok' : 'warn', 6000);
      }
      const meta = await api('/api/meta'); state.meta = meta;
      integrations(ab);
    } catch (x) { toast(x.message, 'warn', 6000); btn.disabled = false; }
  };
}
function intCard(i) {
  const p = i.providers[i.provider] ?? { fields: [] };
  return html`<article class="card int-card" data-int="${i.id}">
    <header><div><h3>${i.label}</h3><small class="muted">${i.id}</small></div>${pill(i.status)}</header>
    ${field('Provider', html`<select data-prov>${Object.entries(i.providers).map(([k, d]) => opt(k, d.label, i.provider))}</select>`)}
    ${p.fields.map(fl => field(fl.label, fl.type === 'select'
      ? html`<select data-cfg="${fl.key}">${fl.options.map(o => html`<option value="${o}" ${(i.config?.[fl.key] ?? fl.placeholder) === o ? raw('selected') : ''}>${o}</option>`)}</select>`
      : html`<input data-cfg="${fl.key}" type="${fl.type === 'secret' ? 'password' : fl.type === 'url' ? 'url' : fl.type === 'number' ? 'number' : 'text'}" value="${i.config?.[fl.key] ?? ''}" placeholder="${fl.placeholder ?? ''}" autocomplete="off">`))}
    ${p.help ? html`<p class="small muted">${p.help}</p>` : ''}
    ${!['none', 'browser'].includes(i.provider) ? html`<label class="check"><input type="checkbox" data-auth ${i.authorised ? raw('checked') : ''}> I confirm this connection is authorised by the data owner / airport and covered by an agreement.</label>
      <label class="check"><input type="checkbox" data-enabled ${i.enabled ? raw('checked') : ''}> Enabled</label>` : html`<input type="checkbox" data-auth hidden><input type="checkbox" data-enabled hidden>`}
    ${i.statusDetail ? html`<p class="small ${i.status === 'error' ? 'error' : 'muted'}">${i.statusDetail}${i.lastTestAt ? ` · tested ${fmtDateTime(i.lastTestAt)}` : ''}</p>` : ''}
    <div class="row-end"><button class="btn btn-primary btn-sm" data-save>Save</button>${!['none', 'browser'].includes(i.provider) ? html`<button class="btn btn-sm" data-test>${icon('plug')} Test connection</button>` : ''}</div>
  </article>`;
}

// ---------- Simulated flights ----------
async function flights(ab) {
  const [{ items }, settings] = await Promise.all([api('/api/admin/sim-flights'), api('/api/admin/settings')]);
  mount(ab, html`<div class="row-between"><h1>Simulated flights</h1><button class="btn btn-primary" id="addSF">${icon('plus')} Add simulated flight</button></div>
    <p class="banner banner-warn">${icon('alert')} <span>These records are <b>demonstration data</b>, always labelled "Simulated" to passengers. Departure times are relative to the current time. When an authorised flight feed is connected, simulated data is never used.</span></p>
    <label class="switch switch-row"><span>Show simulated flights to passengers</span><input type="checkbox" id="demoF" ${settings.demo_flights ? raw('checked') : ''}><span class="switch-ui"></span></label>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Flight</th><th>Airline</th><th>Destination</th><th>Departs in</th><th>Gate</th><th>Status</th><th></th></tr></thead>
    <tbody>${items.map(fl => html`<tr><td><b>${fl.flight_no}</b></td><td>${fl.airline}</td><td>${fl.destination} (${fl.destination_code})</td><td>${fl.dep_offset_min} min</td><td>${fl.gate ?? '—'}</td><td>${fl.status}</td>
      <td><button class="icon-btn" data-edit="${fl.flight_no}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del="${fl.flight_no}" aria-label="Delete">${icon('trash')}</button></td></tr>`)}</tbody></table></div>`);
  $('#demoF', ab).addEventListener('change', async e => { await api('/api/admin/settings', { method: 'PUT', body: { demo_flights: e.target.checked } }); toast('Saved', 'ok'); });
  const edit = fl => dialog(fl ? `Edit ${fl.flight_no}` : 'Add simulated flight', html`
    <div class="grid2">${field('Flight number', html`<input name="flight_no" required value="${fl?.flight_no ?? ''}" ${fl ? raw('readonly') : ''}>`)}${field('Airline', html`<input name="airline" required value="${fl?.airline ?? 'Qatar Airways'}">`)}</div>
    <div class="grid2">${field('Destination', html`<input name="destination" required value="${fl?.destination ?? ''}">`)}${field('IATA code', html`<input name="destination_code" required pattern="[A-Z]{3}" value="${fl?.destination_code ?? ''}">`)}</div>
    <div class="grid3">${field('Departs in (min)', html`<input name="dep_offset_min" type="number" required value="${fl?.dep_offset_min ?? 90}">`)}${field('Gate', html`<input name="gate" pattern="[A-E][0-9]{1,2}" value="${fl?.gate ?? ''}">`)}${field('Status', html`<select name="status">${['scheduled', 'boarding', 'delayed', 'final_call', 'gate_closed', 'departed', 'cancelled'].map(s => opt(s, s, fl?.status ?? 'scheduled'))}</select>`)}</div>`, async f => {
    await api('/api/admin/sim-flights', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
    toast('Saved', 'ok'); flights(ab);
  });
  ab.onclick = async e => {
    const ed = e.target.closest('[data-edit]'); if (ed) edit(items.find(x => x.flight_no === ed.dataset.edit));
    const de = e.target.closest('[data-del]'); if (de && confirm(`Delete ${de.dataset.del}?`)) { await api(`/api/admin/sim-flights/${de.dataset.del}`, { method: 'DELETE' }); flights(ab); }
  };
  $('#addSF', ab).addEventListener('click', () => edit(null));
}

// ---------- Privacy & settings ----------
async function privacy(ab) {
  const [s, t, { items: locs }] = await Promise.all([api('/api/admin/settings'), api('/api/admin/transcripts'), api('/api/admin/locations')]);
  mount(ab, html`<h1>Privacy & settings</h1>
    <form id="sf" class="card settings-form">
      <h2>Privacy</h2>
      ${chk('analytics_enabled', 'Collect anonymous aggregate usage counts (topic + language per day)', s.analytics_enabled)}
      <div class="grid2">${field('Suppress counts below', html`<input name="analytics_min_count" type="number" min="3" max="100" value="${s.analytics_min_count}">`)}${field('Keep analytics (days)', html`<input name="analytics_retention_days" type="number" min="30" max="1100" value="${s.analytics_retention_days}">`)}</div>
      ${chk('store_transcripts', 'Allow staff to save interpreter transcripts (only with passenger consent)', s.store_transcripts)}
      ${field('Delete transcripts after (days)', html`<input name="transcript_retention_days" type="number" min="1" max="90" value="${s.transcript_retention_days}">`)}
      <h2>Assistant & wayfinding</h2>
      ${chk('assistant_use_llm', 'Use the connected AI model for understanding and grounded answers (facts always come from approved data)', s.assistant_use_llm)}
      ${chk('demo_flights', 'Show simulated demo flights (only when no live feed is connected)', s.demo_flights)}
      ${chk('map_is_simulated', 'Label the map as approximate (not authorised indoor-map data)', s.map_is_simulated)}
      <div class="grid3">${field('Walking speed (m/min)', html`<input name="walk_speed_m_per_min" type="number" min="30" max="120" value="${s.walk_speed_m_per_min}">`)}${field('Step-free speed (m/min)', html`<input name="step_free_speed_m_per_min" type="number" min="20" max="100" value="${s.step_free_speed_m_per_min}">`)}
        ${field('Default passenger location', html`<select name="default_location">${locs.filter(l => ['plaza', 'transfer'].includes(l.type)).map(l => opt(l.id, l.name, s.default_location))}</select>`)}</div>
      <div class="grid3">${field('Passenger train: ride + typical wait (min)', html`<input name="train_minutes" type="number" min="1" max="20" value="${s.train_minutes ?? 4}">`)}${field('Delete passenger help requests after (days)', html`<input name="support_retention_days" type="number" min="1" max="90" value="${s.support_retention_days ?? 7}">`)}${field('Live flight data cache (seconds)', html`<input name="flight_cache_seconds" type="number" min="30" max="900" value="${s.flight_cache_seconds ?? 120}">`, 'Longer = fewer paid API calls; shorter = fresher gates.')}</div>
      <div class="row-end"><button class="btn btn-primary">Save settings</button></div>
    </form>
    <div class="card"><div class="row-between"><h2>Saved transcripts (${t.items.length})</h2>${t.items.length ? html`<button class="btn btn-danger btn-sm" id="purge">${icon('trash')} Delete all now</button>` : ''}</div>
      <p class="muted small">Viewing a transcript is recorded in the audit log. Transcripts auto-delete at expiry.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Staff</th><th>Languages</th><th>Entries</th><th>Created</th><th>Expires</th></tr></thead>
      <tbody>${t.items.map(x => html`<tr><td>${x.id}</td><td>${x.staff}</td><td>${x.passenger_lang} ↔ ${x.staff_lang}</td><td>${x.entries}</td><td>${fmtDateTime(x.created_at)}</td><td>${fmtDateTime(x.expires_at)}</td></tr>`)}</tbody></table></div></div>`);
  $('#sf', ab).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const body = {};
    for (const el of f.elements) { if (!el.name) continue; body[el.name] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value); }
    try { await api('/api/admin/settings', { method: 'PUT', body }); toast('Settings saved', 'ok'); } catch (x) { toast(x.message, 'warn'); }
  });
  $('#purge', ab)?.addEventListener('click', async () => { if (confirm('Permanently delete all saved transcripts?')) { const r = await api('/api/admin/transcripts', { method: 'DELETE' }); toast(`Deleted ${r.deleted}`, 'ok'); privacy(ab); } });
}

// ---------- Audit ----------
async function audit(ab) {
  const { items } = await api('/api/admin/audit?limit=300');
  mount(ab, html`<h1>Audit log</h1><p class="muted">Sign-ins, approvals, configuration changes and transcript access (latest 300).</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
    <tbody>${items.map(a => html`<tr><td class="small">${fmtDateTime(a.at)}</td><td>${a.username ?? '—'}</td><td><code>${a.action}</code></td><td>${a.target ?? ''}</td><td class="small"><code>${a.detail ?? ''}</code></td></tr>`)}</tbody></table></div>`);
}

export { go };
