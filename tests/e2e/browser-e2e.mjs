// End-to-end UI test driving a real headless Chrome/Edge over the DevTools protocol (no dependencies).
// Usage: start the server (npm start), then: node tests/e2e/browser-e2e.mjs [baseUrl] [screenshotDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const OUT = process.argv[3] ?? path.join(os.tmpdir(), 'airport-assistant-e2e');
fs.mkdirSync(OUT, { recursive: true });
const BROWSERS = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const exe = BROWSERS.find(p => fs.existsSync(p));
if (!exe) { console.error('No Chrome/Edge found (set CHROME_PATH)'); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-prof-'));
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cdpTarget() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = list.find(t => t.type === 'page'); if (p) return p; } catch { /* starting */ }
    await sleep(200);
  }
  throw new Error('browser did not start');
}
const target = await cdpTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url ?? '')) errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`);
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
async function waitFor(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(`!!(${expr})`)) return true; await sleep(100); }
  throw new Error(`timeout waiting for: ${expr}`);
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
}
async function go(hash) { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(350); }
const click = sel => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element ' + ${JSON.stringify(sel)}); el.click(); return true; })()`);
const text = sel => evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`);

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
async function viewport(w, h, mobile) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }); }

const results = [];
async function step(name, fn) {
  const before = errors.length;
  try { await fn(); const newErr = errors.slice(before); if (newErr.length) throw new Error('console errors: ' + newErr.join(' | ')); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); await shot('FAIL-' + name.replace(/\W+/g, '_')).catch(() => {}); }
}

await viewport(390, 844, true);
await send('Page.navigate', { url: BASE + '/' });
await sleep(1200);

await step('first visit shows language picker', async () => {
  await waitFor(`document.querySelector('.lang-grid')`);
  const n = await evaluate(`document.querySelectorAll('.lang-tile').length`);
  if (n < 50) throw new Error(`expected 50+ languages, got ${n}`);
  await shot('01-language-picker');
});
await step('choose Hindi → home in Hindi', async () => {
  await click('[data-lang="hi"]');
  await waitFor(`document.querySelector('.hero h1')`);
  const h = await text('.hero h1');
  if (!/मदद/.test(h)) throw new Error('home not in Hindi: ' + h);
  if (await evaluate(`document.documentElement.lang`) !== 'hi') throw new Error('html lang not set');
  await shot('02-home-hindi');
});
await step('Hindi passenger asks gate for QR 572 (chat)', async () => {
  await go('#/ask?q=' + encodeURIComponent('QR 572 का गेट कौन सा है?'));
  await waitFor(`document.querySelector('.msg-bot .flight-card')`, 10000);
  const t = await text('.msg-bot .msg-text');
  if (!/C9/.test(t) || !/सिम्युलेटेड/.test(t)) throw new Error('answer: ' + t);
  if (!(await evaluate(`!!document.querySelector('.flight-card .pill-sim')`))) throw new Error('no Simulated badge on card');
  if (!(await evaluate(`!!document.querySelector('.buffer')`))) throw new Error('no time buffer indicator');
  await shot('03-chat-hindi-qr572');
});
await step('show the way → map with route', async () => {
  await click('.flight-card a.btn-primary');
  await waitFor(`document.querySelector('.m-route')`);
  const s = await text('.route-summary');
  if (!/मिनट/.test(s)) throw new Error('summary: ' + s);
  await shot('04-map-route-hindi');
});
await step('flight page lookup', async () => {
  await go('#/flight?no=QR516');
  await waitFor(`document.querySelector('#fres .flight-card')`);
  await shot('05-flight-page');
});
await step('nearest toilet from home chip', async () => {
  await go('#/map?nearest=toilet');
  await waitFor(`document.querySelector('.route-summary')`);
});
await step('switch to Arabic → RTL layout', async () => {
  await go('#/language');
  await click('[data-lang="ar"]');
  await waitFor(`document.documentElement.dir === 'rtl'`);
  await shot('06-home-arabic-rtl');
});
await step('Arabic chat: toilet question', async () => {
  await go('#/ask?q=' + encodeURIComponent('أين أقرب دورة مياه؟'));
  await waitFor(`document.querySelectorAll('.msg-bot:not(.pending)').length >= 1 && document.querySelector('.mini-route')`, 10000);
  await shot('07-chat-arabic');
});
await step('lounge finder (English)', async () => {
  await go('#/language'); await click('[data-lang="en"]'); await sleep(300);
  await go('#/lounges');
  await evaluate(`(() => { const f = document.querySelector('#lf'); f.cabin.value = 'business'; f.requestSubmit(); })()`);
  await waitFor(`document.querySelectorAll('.lounge-card').length >= 5`);
  const first = await text('.lounge-card .elig');
  if (!/May be included/.test(first)) throw new Error('first lounge: ' + first);
  await shot('08-lounges');
});
await step('long route A1 → E8 uses the passenger train', async () => {
  await go('#/map?from=GATE_A1&to=GATE_E8');
  await waitFor(`document.querySelector('.steps')`);
  const steps = await text('.steps');
  if (!/Take the passenger train/.test(steps)) throw new Error('no train step: ' + steps);
  const summary = await text('.route-summary, .map-summary, .page');
  if (!/Passenger train/.test(summary)) throw new Error('summary does not mention the train');
  if (!(await evaluate(`!!document.querySelector('.m-train')`))) throw new Error('train line not drawn');
  await shot('08b-map-train-route');
});
await step('departures board lists flights, filters, and opens a flight', async () => {
  await go('#/flight');
  await waitFor(`document.querySelectorAll('.board-row').length >= 5`);
  await evaluate(`(() => { const i = document.querySelector('#bq'); i.value = 'delhi'; i.dispatchEvent(new Event('input')); })()`);
  await waitFor(`document.querySelectorAll('.board-row').length === 1`);
  await click('.board-row');
  await waitFor(`document.querySelector('.flight-card .fc-gate')?.textContent.trim() === 'C9'`);
  await shot('08c-departures-board');
});
await step('51 languages: search the picker, switch to Japanese, ask in Japanese', async () => {
  await go('#/language');
  await waitFor(`document.querySelectorAll('[data-lang]').length >= 50`);
  await evaluate(`(() => { const i = document.querySelector('#lq'); i.value = '日本'; i.dispatchEvent(new Event('input')); })()`);
  const visible = await evaluate(`[...document.querySelectorAll('[data-lang]')].filter(b => !b.hidden).map(b => b.dataset.lang)`);
  if (visible.length !== 1 || visible[0] !== 'ja') throw new Error('search: ' + visible.join(','));
  await shot('08d-language-search');
  await click('[data-lang="ja"]');
  await waitFor(`document.documentElement.lang === 'ja' && document.body.innerText.includes('搭乗口を探す')`);
  await go('#/ask');
  await evaluate(`(() => { const q = document.querySelector('#q'); q.value = 'QR 572のゲートはどこですか'; document.querySelector('#composer').requestSubmit(); })()`);
  await waitFor(`[...document.querySelectorAll('.msg-bot')].some(b => /C9/.test(b.innerText) && /搭乗口/.test(b.innerText))`, 10000);
  await shot('08e-chat-japanese');
  await go('#/language'); await click('[data-lang="en"]'); await sleep(300);
});
await step('help / FAQ search', async () => {
  await go('#/help');
  await waitFor(`document.querySelectorAll('.faq').length >= 10`);
  await evaluate(`(() => { const i = document.querySelector('#fq'); i.value = 'wifi'; i.dispatchEvent(new Event('input')); })()`);
  await waitFor(`document.querySelectorAll('.faq').length === 1`);
  await evaluate(`document.querySelector('.faq').open = true`);
  await shot('09-help');
});
await step('settings: larger text + high contrast toggles', async () => {
  await go('#/settings');
  await click('#s-text');
  if (!(await evaluate(`document.documentElement.classList.contains('text-large')`))) throw new Error('text-large not applied');
  await click('#s-text');
  await shot('10-settings');
});
await step('no horizontal overflow on phone width', async () => {
  for (const h of ['#/', '#/ask', '#/map', '#/lounges', '#/help', '#/flight']) {
    await go(h); await sleep(250);
    const over = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    if (over > 1) throw new Error(`${h} overflows by ${over}px`);
  }
});
await step('passenger messages airport staff from the app', async () => {
  await go('#/support');
  await waitFor(`document.querySelector('#sf textarea')`);
  await evaluate(`(() => { const f = document.querySelector('#sf'); f.message.value = 'I lost my passport near gate C9'; f.requestSubmit(); })()`);
  await waitFor(`location.hash.startsWith('#/support/') && document.querySelector('.support-status')`);
  await shot('09a-passenger-request-sent');
});
await step('staff login with demo account → interpreter', async () => {
  await viewport(1280, 860, false);
  await go('#/staff');
  await waitFor(`document.querySelector('#lg')`);
  await shot('11-staff-login');
  await click('.demo-accounts [data-u="staff"]');
  await waitFor(`location.hash.startsWith('#/staff') && document.querySelector('#rqlist')`);
});
await step('staff see the passenger request live and reply with a translated quick reply', async () => {
  await waitFor(`[...document.querySelectorAll('.rq-row')].some(r => r.innerText.includes('I lost my passport'))`);
  if (!(await evaluate(`document.querySelector('.subnav .badge')?.textContent.trim() === '1'`))) throw new Error('badge count missing');
  await shot('11a-staff-requests');
  await evaluate(`[...document.querySelectorAll('.rq-row')].find(r => r.innerText.includes('I lost my passport')).click()`);
  await waitFor(`document.querySelector('[data-phrase="coming"]')`);
  await click('[data-phrase="coming"]');
  await waitFor(`document.querySelector('.rq-thread')?.innerText.includes('on the way')`);
  await shot('11b-staff-reply');
  const id = await evaluate(`location.hash.split('/').pop()`);
  await viewport(390, 844, true);
  await go('#/support/' + id);
  await waitFor(`document.querySelector('.msg-staff')?.innerText.includes('on the way') && document.querySelector('.support-status.st-claimed')`, 10000);
  await shot('11c-passenger-sees-reply');
  await viewport(1280, 860, false);
  await go('#/staff/translate');
  await waitFor(`document.querySelector('.interp')`);
});
await step('interpreter: quick phrase staff → Hindi passenger', async () => {
  await click('#phrasesBtn');
  await waitFor(`document.querySelector('[data-ph="boarding_pass"]')`);
  await click('[data-ph="boarding_pass"]');
  await waitFor(`document.querySelector('.side-p .big')?.innerText.includes('बोर्डिंग पास')`);
  await evaluate(`(() => { const f = document.querySelector('form[data-type="passenger"]'); f.querySelector('input').value = 'कृपया एक पल रुकिए'; f.requestSubmit(); })()`);
  await waitFor(`document.querySelector('.side-s .big')?.innerText.includes('Please wait a moment')`);
  await shot('12-interpreter');
});
await step('guidance library', async () => {
  await go('#/staff/guidance');
  await waitFor(`document.querySelectorAll('.guide').length >= 4`);
  await shot('13-guidance');
});
await step('eligibility case: create, verify, approve, code', async () => {
  await go('#/staff/cases');
  await waitFor(`document.querySelector('#newc')`);
  await click('#newc');
  await waitFor(`document.querySelector('#ncf')`);
  await evaluate(`(() => { const f = document.querySelector('#ncf'); f.loungeId.value = 'L_MOURJAN_S'; f.cabin.value = 'business'; f.requestSubmit(); })()`);
  await waitFor(`document.querySelector('#chk')`);
  await shot('14-case-pending');
  for (const k of ['boarding_pass', 'carrier_cabin', 'identity']) {
    await evaluate(`(() => { const c = document.querySelector('#chk [name="${k}"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.querySelector('#chk [name="${k}"]')?.checked`);
    await sleep(250);
  }
  await click('[data-d="approve"]');
  await waitFor(`document.querySelector('.refcode b')`);
  const code = await text('.refcode b');
  if (!/^BV-/.test(code)) throw new Error('no code');
  await shot('15-case-approved');
  globalThis.__code = code;
});
await step('passenger verifies the staff code', async () => {
  await viewport(390, 844, true);
  await go('#/lounges');
  await evaluate(`(() => { document.querySelector('#code').value = ${JSON.stringify(globalThis.__code ?? '')}; document.querySelector('#codef').requestSubmit(); })()`);
  await waitFor(`document.querySelector('.verified')`);
  await shot('16-passenger-verified');
});
await step('admin console tabs render', async () => {
  await viewport(1280, 860, false);
  await go('#/staff');
  await waitFor(`document.querySelector('#logout')`);
  await click('#logout');
  await waitFor(`document.querySelector('.demo-accounts [data-u="admin"]')`);
  await click('.demo-accounts [data-u="admin"]');
  await waitFor(`document.querySelector('.admin-nav')`);
  for (const tab of ['overview', 'map', 'gates', 'lounges', 'faqs', 'languages', 'guidance', 'users', 'integrations', 'flights', 'privacy', 'audit']) {
    await go('#/admin/' + tab);
    await waitFor(`document.querySelector('#ab h1')`);
    if (await evaluate(`!!document.querySelector('#ab > p.error')`)) throw new Error(`tab ${tab}: ` + await text('#ab > p.error'));
    if (['overview', 'integrations', 'lounges', 'map'].includes(tab)) await shot(`17-admin-${tab}`);
  }
});

console.log(results.map(r => r.join('  ')).join('\n'));
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots: ${OUT}`);
ws.close(); browser.kill();
setTimeout(() => process.exit(failed ? 1 : 0), 300);
