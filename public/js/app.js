import { api, html, raw, mount, $, prefs, savePrefs, toast, icon, setCsrf, esc } from './lib.js';
import { setLang, tr, hasUi, ensureLang } from './i18n.js';
import { speech } from './speech.js';
import * as passenger from './views/passenger.js';
import * as staff from './views/staff.js';
import * as admin from './views/admin.js';

export const state = { meta: null, user: null, map: null, lang: 'en', chat: [] };

export function langInfo(code = state.lang) {
  return state.meta?.languages.find(l => l.code === code) ?? { code: 'en', native: 'English', speech: 'en-GB', rtl: false, builtin: true };
}

export async function applyLang(code) {
  const l = langInfo(code);
  if (l.code !== 'en' && l.builtin) await ensureLang(l.code);
  state.lang = l.code;
  setLang(hasUi(l.code) ? l.code : 'en');
  document.documentElement.lang = l.code;
  document.documentElement.dir = l.rtl ? 'rtl' : 'ltr';
  savePrefs({ lang: l.code });
}

export function applyPrefs() {
  const root = document.documentElement;
  root.classList.toggle('text-large', !!prefs.textLarge);
  root.classList.toggle('contrast', !!prefs.contrast);
}

export async function loadMap() {
  if (!state.map) state.map = await api('/api/map');
  return state.map;
}

export function placeLabel(type) {
  const names = state.meta?.places?.[type];
  return names?.[state.lang] ?? names?.en ?? type;
}

export function currentFrom() {
  const id = prefs.from;
  return id && state.map?.locations.some(l => l.id === id) ? id : state.meta.defaultLocation;
}

export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs ?? '') };
}

export async function refreshSession() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    setCsrf(me.csrf ?? null);
  } catch { state.user = null; }
}

const app = () => $('#app');

function shell(kind, content) {
  const l = langInfo();
  const header = kind === 'passenger'
    ? html`<header class="topbar">
        <a class="brand" href="#/" aria-label="${tr('home')}">
          <span class="brand-mark" aria-hidden="true">${icon('sparkle')}</span>
          <span class="brand-text"><b>Airport Assistant</b><small>Hamad International Airport · DOH</small></span>
        </a>
        <div class="topbar-actions">
          <a class="chip-btn" href="#/language" aria-label="${tr('language')}">${icon('globe')}<span>${l.native}</span></a>
          <a class="icon-btn" href="#/settings" aria-label="${tr('settings')}">${icon('settings')}</a>
        </div>
      </header>`
    : html`<header class="topbar topbar-staff">
        <a class="brand" href="${kind === 'admin' ? '#/admin' : '#/staff'}"><span class="brand-mark" aria-hidden="true">${icon('shield')}</span>
          <span class="brand-text"><b>${kind === 'admin' ? 'Admin console' : 'Staff console'}</b><small>Hamad International Airport · DOH</small></span></a>
        <div class="topbar-actions">
          ${state.user ? html`<span class="who">${icon('user')}<span>${state.user.displayName}</span><em>${state.user.role}</em></span>
          <button class="icon-btn" id="logout" aria-label="Sign out" title="Sign out">${icon('logout')}</button>` : ''}
        </div>
      </header>`;
  const nav = kind === 'passenger' ? passengerNav() : '';
  mount(app(), html`${header}<main id="view" class="view view-${kind}" tabindex="-1">${content ?? ''}</main>${nav}`);
  document.body.className = `mode-${kind}`;
  $('#logout')?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
    state.user = null; setCsrf(null); go('#/staff');
  });
  return $('#view');
}

function passengerNav() {
  const { path } = parseHash();
  const items = [['/', 'home', 'home'], ['/ask', 'chat', 'ask'], ['/map', 'map', 'map'], ['/lounges', 'sofa', 'lounges'], ['/help', 'help', 'help']];
  return html`<nav class="tabbar" aria-label="Main">${items.map(([p, ic, key]) => {
    const active = p === '/' ? path === '/' : path.startsWith(p);
    const label = key === 'ask' ? askLabel() : tr(key);
    return html`<a href="#${p}" class="${active ? 'active' : ''}" ${active ? raw('aria-current="page"') : ''}>${icon(ic)}<span>${label}</span></a>`;
  })}</nav>`;
}
function askLabel() {
  const m = { en: 'Ask', hi: 'पूछें', ar: 'اسأل', ur: 'پوچھیں', bn: 'জিজ্ঞাসা', ml: 'ചോദിക്കുക', tl: 'Magtanong', zh: '提问', fr: 'Demander', es: 'Preguntar', ru: 'Спросить', de: 'Fragen',
    ja: '質問', ko: '질문', 'zh-TW': '提問', th: 'ถาม', vi: 'Hỏi', id: 'Tanya', ms: 'Tanya', tr: 'Sor', it: 'Chiedi', pl: 'Zapytaj', pt: 'Perguntar',
    nl: 'Vraag', el: 'Ρωτήστε', uk: 'Запитати', ro: 'Întreabă', cs: 'Zeptat se', hu: 'Kérdezz', sv: 'Fråga', da: 'Spørg', nb: 'Spør', fi: 'Kysy',
    fa: 'بپرسید', he: 'שאלו', ps: 'وپوښتئ', ne: 'सोध्नुहोस्', si: 'අහන්න', ta: 'கேளுங்கள்', te: 'అడగండి', kn: 'ಕೇಳಿ', mr: 'विचारा', gu: 'પૂછો',
    pa: 'ਪੁੱਛੋ', sw: 'Uliza', am: 'ይጠይቁ', so: 'Weydii', uz: 'So‘rash', kk: 'Сұрау', az: 'Soruş' };
  return m[state.lang] ?? m[state.lang.split('-')[0]] ?? m.en;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  speech.cancel();
  const { parts, query } = parseHash();
  const at = query.get('at');
  if (at) savePrefs({ from: at.toUpperCase() });
  try {
    if (parts[0] === 'staff') {
      await refreshSession();
      if (seq !== renderSeq) return;
      const v = shell('staff');
      return staff.route(v, parts.slice(1), query);
    }
    if (parts[0] === 'admin') {
      await refreshSession();
      if (seq !== renderSeq) return;
      if (!state.user) return go('#/staff');
      const v = shell('admin');
      return admin.route(v, parts.slice(1), query);
    }
    if (!prefs.lang && parts[0] !== 'language') return go('#/language?first=1');
    const v = shell('passenger');
    await passenger.route(v, parts, query);
    if (seq === renderSeq) v.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    mount($('#view') ?? app(), html`<div class="empty">${icon('alert')}<p>${tr('error_generic')}</p><button class="btn" onclick="location.reload()">↻</button></div>`);
  }
}

async function boot() {
  applyPrefs();
  try {
    state.meta = await api('/api/meta');
  } catch {
    mount(app(), html`<div class="empty boot-error">${icon('wifi')}<p>${tr('offline')}</p><button class="btn btn-primary" onclick="location.reload()">↻</button></div>`);
    return;
  }
  speech.setServerStt(state.meta.integrations?.stt?.status === 'connected');
  const preferred = prefs.lang ?? null;
  await applyLang(preferred && state.meta.languages.some(l => l.code === preferred) ? preferred : 'en');
  if (!preferred) savePrefs({ lang: null });
  window.addEventListener('hashchange', render);
  window.addEventListener('offline', () => toast(tr('offline'), 'warn', 6000));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* optional */ });
  }
  await render();
}

boot();
export { esc };
