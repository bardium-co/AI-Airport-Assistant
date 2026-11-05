// Netlify Function entry point: every /api/* request. See NETLIFY.md.
import { getStore } from '@netlify/blobs';
import { createLiteApp } from '../../server/lite/app.js';

// Netlify Blobs → the small key-value interface the Lite app expects.
function blobStore(name) {
  let store;
  const st = () => (store ??= getStore({ name, consistency: 'strong' }));
  return {
    get: key => st().get(key, { type: 'json' }),
    set: (key, value) => st().setJSON(key, value),
    delete: key => st().delete(key),
    async list(prefix) {
      const out = [];
      for await (const page of st().list({ prefix, paginate: true })) out.push(...page.blobs.map(b => b.key));
      return out.sort();
    },
  };
}

let appPromise;
const getApp = () => (appPromise ??= createLiteApp({ env: process.env, store: blobStore('assistant'), log: console.log }));

// Flight data is shared between function containers, so the provider quota is protected even when
// Netlify starts several containers or restarts one.
const flightStore = () => blobStore('assistant-flights');
async function loadFlightState(app) {
  try {
    const s = await flightStore().get('state');
    if (!s) return;
    const f = app.flights;
    if (s.cache && (!f.cache || s.cache.at > f.cache.at)) f.cache = s.cache;
    if (s.usage) app.db.setSetting('flight_api_usage', s.usage);
  } catch { /* shared cache is an optimisation only */ }
}
async function saveFlightState(app, before) {
  try {
    const f = app.flights;
    const usage = app.db.getSetting('flight_api_usage', null);
    if (f.cache?.at === before.at && JSON.stringify(usage) === before.usage) return;
    await flightStore().set('state', { cache: f.cache, usage });
  } catch { /* ignore */ }
}

export default async (request, context) => {
  const app = await getApp();
  const url = new URL(request.url);
  const usesFlights = process.env.AIRLABS_API_KEY && /^\/api\/(flights|assistant\/chat)/.test(url.pathname);
  if (usesFlights) await loadFlightState(app);
  const before = { at: app.flights.cache?.at, usage: JSON.stringify(app.db.getSetting('flight_api_usage', null)) };

  const rawBody = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text();
  const r = await app.handleApi({
    method: request.method, pathname: url.pathname, query: url.searchParams, headers: Object.fromEntries(request.headers),
    rawBody, ip: context?.ip ?? request.headers.get('x-nf-client-connection-ip') ?? 'unknown',
  });
  if (usesFlights) await saveFlightState(app, before);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
};

export const config = { path: '/api/*' };
