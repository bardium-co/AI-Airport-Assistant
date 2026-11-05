import { esc } from './lib.js';

const FLOOR_TYPES = new Set(['plaza', 'transfer', 'junction']);
const FAC_GLYPH = { prayer: '☪', quiet: '☾', toilet: 'WC', info: 'i', transfer: '⇄', smoking: '🚬', family: '👪', hotel: 'H', food: '☕', assistance: '♿', lift: '⇅', sleep: 'Zz', wellness: '♨' };
const glyph = n => (/^TRAIN_/.test(n.id) ? '🚆' : /^SHUTTLE_/.test(n.id) ? '🛺' : FAC_GLYPH[n.type] ?? '•');

/**
 * Render the terminal schematic into `container`.
 * opts: { route, from, to, onSelect(node), filter(type) , label }
 */
export function renderMap(container, data, opts = {}) {
  const W = data.width, H = data.height;
  const byId = new Map(data.locations.map(l => [l.id, l]));
  const floor = data.edges.filter(e => FLOOR_TYPES.has(byId.get(e.a)?.type) && FLOOR_TYPES.has(byId.get(e.b)?.type));
  const routeSet = new Set(opts.route?.path ?? []);
  const parts = [];

  parts.push(`<defs>
    <filter id="mshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-opacity=".25"/></filter>
  </defs>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" class="m-bg"/>`);
  parts.push(`<text x="${W / 2}" y="${H - 14}" class="m-watermark" text-anchor="middle">APPROXIMATE MAP FROM PUBLIC INFORMATION · NOT TO SCALE · FOLLOW AIRPORT SIGNS</text>`);
  // Floor plates
  for (const e of floor) {
    const a = byId.get(e.a), b = byId.get(e.b);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="m-floor"/>`);
  }
  for (const n of data.locations.filter(l => l.type === 'plaza')) parts.push(`<circle cx="${n.x}" cy="${n.y}" r="34" class="m-plaza"/>`);
  // Connectors to POIs
  for (const e of data.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    if (e.kind === 'train') {
      parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="m-train"/><text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 10}" text-anchor="middle" class="m-train-lbl">${esc(opts.trainLabel ?? 'Passenger train')}</text>`);
      continue;
    }
    if (FLOOR_TYPES.has(a.type) && FLOOR_TYPES.has(b.type)) continue;
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="m-link${e.step_free ? '' : ' m-link-steps'}"/>`);
  }
  // Concourse labels
  const ends = {};
  for (const l of data.locations) if (l.type === 'gate' && l.concourse) {
    const n = Number(l.id.replace(/\D/g, ''));
    if (!ends[l.concourse] || n > ends[l.concourse].n) ends[l.concourse] = { n, l };
  }
  for (const [c, { l }] of Object.entries(ends)) parts.push(`<g class="m-conc"><circle cx="${l.x}" cy="${l.y}" r="0"/><text x="${l.x + (l.x < W / 2 ? -34 : 34)}" y="${l.y + 6}" text-anchor="middle">${esc(c)}</text></g>`);

  // Route
  if (opts.route?.path?.length > 1) {
    const pts = opts.route.path.map(id => byId.get(id)).filter(Boolean).map(n => `${n.x},${n.y}`).join(' ');
    parts.push(`<polyline points="${pts}" class="m-route-casing"/><polyline points="${pts}" class="m-route"/>`);
  }
  // POIs
  for (const n of data.locations) {
    if (n.type === 'junction') continue;
    const on = routeSet.has(n.id);
    const filtered = opts.filter && !opts.filter(n.type) && !on && n.id !== opts.from && n.id !== opts.to;
    const cls = `m-node m-${n.type}${on ? ' m-on' : ''}${n.status === 'closed' ? ' m-closed' : ''}${filtered ? ' m-dim' : ''}`;
    const a11y = `data-id="${esc(n.id)}" tabindex="-1" role="button" aria-label="${esc(n.name)}"`;
    if (n.type === 'gate') {
      const label = n.id.replace('GATE_', '');
      parts.push(`<g class="${cls}" ${a11y}><rect x="${n.x - 15}" y="${n.y - 9}" width="30" height="18" rx="5"/><text x="${n.x}" y="${n.y + 4}" text-anchor="middle">${esc(label)}</text></g>`);
    } else if (n.type === 'lounge') {
      parts.push(`<g class="${cls}" ${a11y}><rect x="${n.x - 9}" y="${n.y - 9}" width="18" height="18" rx="3" transform="rotate(45 ${n.x} ${n.y})" filter="url(#mshadow)"/><text x="${n.x}" y="${n.y - 15}" text-anchor="middle" class="m-lbl">${esc(shortName(n.name))}</text></g>`);
    } else if (n.type === 'plaza' || n.type === 'transfer') {
      parts.push(`<g class="${cls}" ${a11y}><circle cx="${n.x}" cy="${n.y}" r="${n.type === 'plaza' ? 7 : 9}"/>${n.type === 'transfer' ? `<text x="${n.x}" y="${n.y + 3.5}" text-anchor="middle" class="m-glyph">⇄</text>` : ''}<text x="${n.x}" y="${n.y + (n.type === 'plaza' ? 22 : 24)}" text-anchor="middle" class="m-lbl">${esc(shortName(n.name))}</text></g>`);
    } else {
      parts.push(`<g class="${cls}" ${a11y}><circle cx="${n.x}" cy="${n.y}" r="8.5"/><text x="${n.x}" y="${n.y + 3.2}" text-anchor="middle" class="m-glyph">${esc(glyph(n))}</text></g>`);
    }
  }
  // Markers
  if (opts.from && byId.has(opts.from)) {
    const n = byId.get(opts.from);
    parts.push(`<g class="m-you" aria-hidden="true"><circle cx="${n.x}" cy="${n.y}" r="16" class="m-you-pulse"/><circle cx="${n.x}" cy="${n.y}" r="7" class="m-you-dot"/></g>`);
  }
  if (opts.to && byId.has(opts.to)) {
    const n = byId.get(opts.to);
    parts.push(`<g class="m-dest" aria-hidden="true" transform="translate(${n.x} ${n.y - 12})"><path d="M0 12 C-9 0 -9 -12 0 -12 C9 -12 9 0 0 12Z"/><circle cx="0" cy="-3" r="3.4" class="m-dest-hole"/></g>`);
  }

  container.innerHTML = `<div class="map-wrap">
    <svg class="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(opts.label ?? 'Terminal map')}">${parts.join('')}</svg>
    <div class="map-ctrls"><button type="button" class="map-btn" data-z="in" aria-label="Zoom in">+</button><button type="button" class="map-btn" data-z="out" aria-label="Zoom out">−</button><button type="button" class="map-btn" data-z="fit" aria-label="Reset view">⤢</button></div>
  </div>`;
  const svg = container.querySelector('svg');
  const view = { x: 0, y: 0, w: W, h: H };
  const apply = () => svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const aspect = () => { const r = svg.getBoundingClientRect(); return r.width && r.height ? r.width / r.height : W / H; };
  const fit = () => {
    const ids = opts.route?.path?.length ? opts.route.path : [opts.from, opts.to].filter(Boolean);
    const pts = ids.map(id => byId.get(id)).filter(Boolean);
    if (pts.length >= 2) {
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const pad = 70;
      let x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
      const ar = aspect();
      let w = x1 - x0, h = y1 - y0;
      if (w / h > ar) { const nh = w / ar; y0 -= (nh - h) / 2; h = nh; } else { const nw = h * ar; x0 -= (nw - w) / 2; w = nw; }
      Object.assign(view, { x: x0, y: y0, w, h });
    } else {
      const ar = aspect();
      let w = W, h = H;
      if (w / h > ar) h = w / ar; else w = h * ar;
      Object.assign(view, { x: (W - w) / 2, y: (H - h) / 2, w, h });
    }
    apply();
  };
  const zoom = (f, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const nw = Math.min(W * 2.2, Math.max(120, view.w * f));
    const nh = nw / (view.w / view.h);
    view.x = cx - (cx - view.x) * (nw / view.w);
    view.y = cy - (cy - view.y) * (nh / view.h);
    view.w = nw; view.h = nh;
    apply();
  };
  container.querySelector('.map-ctrls').addEventListener('click', e => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'in') zoom(0.7); else if (z === 'out') zoom(1.4); else if (z === 'fit') fit();
  });
  const toSvg = (clientX, clientY) => {
    const r = svg.getBoundingClientRect();
    const scale = Math.max(view.w / r.width, view.h / r.height);
    const offX = (r.width * scale - view.w) / 2, offY = (r.height * scale - view.h) / 2;
    return { x: view.x + (clientX - r.left) * scale - offX, y: view.y + (clientY - r.top) * scale - offY, scale };
  };
  svg.addEventListener('wheel', e => { e.preventDefault(); const p = toSvg(e.clientX, e.clientY); zoom(e.deltaY > 0 ? 1.15 : 0.87, p.x, p.y); }, { passive: false });
  const pointers = new Map();
  let drag = null, pinch = null, moved = false;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w };
      drag = null;
    }
  });
  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoom((pinch.w * (pinch.d / d)) / view.w, mid.x, mid.y);
      moved = true;
    } else if (drag) {
      const { scale } = toSvg(e.clientX, e.clientY);
      const dx = (e.clientX - drag.x) * scale, dy = (e.clientY - drag.y) * scale;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      view.x = drag.vx - dx; view.y = drag.vy - dy;
      apply();
    }
  });
  const end = e => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
  svg.addEventListener('pointerup', e => {
    const wasMoved = moved;
    end(e);
    if (wasMoved || !opts.onSelect) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]');
    if (el) opts.onSelect(byId.get(el.dataset.id));
  });
  svg.addEventListener('pointercancel', end);
  fit();
  return { fit, zoom };
}

function shortName(name) {
  return String(name).replace(/^Al Mourjan Business Lounge/, 'Al Mourjan').replace(/^Privilege Club /, 'PC ').replace(/ Lounge(?= –|$)/, '')
    .replace(/ – Central Concourse$/, '').replace(/^Transfer Hall /, 'Transfer ').replace(/ – (South|North)( (ORCHARD))?$/, '');
}
