import crypto from 'node:crypto';
import { parseJson } from '../db.js';

// Integration registry. Every external system is OFF and "not connected" until an administrator
// configures it, confirms it is authorised by the data owner, and a live connection test passes.
export const INTEGRATION_DEFS = [
  {
    id: 'flights', kind: 'flights', label: 'Live flight data (airport feed or licensed flight-data API)',
    providers: {
      none: { label: 'Not connected', fields: [] },
      aerodatabox: {
        label: 'AeroDataBox — licensed flight-data API',
        fields: [
          { key: 'apiKey', label: 'API key', type: 'secret', required: true },
          { key: 'gateway', label: 'Gateway', type: 'select', options: ['direct', 'rapidapi'], placeholder: 'direct' },
          { key: 'airport', label: 'Airport (IATA)', type: 'text', placeholder: 'DOH' },
          { key: 'dailyBudget', label: 'Daily request budget (blank = no limit)', type: 'number', min: 1, max: 100000, placeholder: 'e.g. 300' },
          { key: 'baseUrl', label: 'Base URL override (optional)', type: 'url', placeholder: 'https://api.aerodatabox.com' },
        ],
        help: 'Get a key at aerodatabox.com (Direct gateway, header X-Api-Key) or RapidAPI (X-RapidAPI-Key). Departures board: GET /flights/airports/iata/{airport} (12-hour window); single flights: GET /flights/number/{flight}/{date}. Free/basic plans have small monthly quotas and are for non-commercial use — airport operations need a commercial plan. The app caches the board (Privacy & settings → flight cache) and answers most lookups from it to save quota.',
      },
      airlabs: {
        label: 'AirLabs — licensed flight-data API',
        fields: [
          { key: 'apiKey', label: 'API key', type: 'secret', required: true },
          { key: 'airport', label: 'Airport (IATA)', type: 'text', placeholder: 'DOH' },
          { key: 'maxPages', label: 'Pages per refresh (50 flights each on free keys)', type: 'number', min: 1, max: 10, placeholder: '1' },
          { key: 'dailyBudget', label: 'Daily request budget (blank = no limit)', type: 'number', min: 1, max: 100000, placeholder: 'e.g. 30 for a small free quota' },
          { key: 'baseUrl', label: 'Base URL override (optional)', type: 'url', placeholder: 'https://airlabs.co/api/v9' },
        ],
        help: 'Get a key at airlabs.co (free plan available — check its monthly request quota and terms in your AirLabs account). Departures board: GET /schedules?dep_iata={airport} (up to 10 hours ahead; free keys return 50 flights per request, more pages cost more requests); single flights: GET /flight; test: GET /ping plus one sample page. The free plan may not include gates, status or terminals — the connection test tells you exactly what your key returns. Destination cities come from the built-in airport list. Set a daily request budget so a small quota lasts the whole month: refreshes are spread across the day automatically.',
      },
      authorised_feed: {
        label: 'Authorised JSON flight feed',
        fields: [
          { key: 'baseUrl', label: 'Base URL (HTTPS)', type: 'url', required: true },
          { key: 'apiKey', label: 'API key', type: 'secret' },
          { key: 'authHeader', label: 'Auth header name', type: 'text', placeholder: 'Authorization' },
        ],
        help: 'GET {baseUrl}/flights/{flightNo} must return {flightNo, airline, destination, destinationCode, scheduledDeparture (ISO), estimatedDeparture?, terminal?, gate?, status}. Optional GET {baseUrl}/departures returns an array of the same objects for the departures board. GET {baseUrl}/health is used for the connection test.',
      },
    },
  },
  {
    id: 'indoor_map', kind: 'indoor_map', label: 'Indoor maps & wayfinding provider',
    providers: {
      none: { label: 'Not connected — using simulated schematic', fields: [] },
      authorised_vendor: {
        label: 'Authorised indoor-map vendor API',
        fields: [
          { key: 'baseUrl', label: 'Base URL (HTTPS)', type: 'url', required: true },
          { key: 'venueId', label: 'Venue ID', type: 'text', required: true },
          { key: 'apiKey', label: 'API key', type: 'secret' },
        ],
        help: 'GET {baseUrl}/venues/{venueId} is used for the connection test. Map geometry can be imported in Admin → Map as JSON nodes/edges.',
      },
    },
  },
  {
    id: 'loyalty', kind: 'loyalty', label: 'Airline loyalty / membership verification service',
    providers: {
      none: { label: 'Not connected — manual card/app verification only', fields: [] },
      authorised_api: {
        label: 'Authorised loyalty verification API',
        fields: [
          { key: 'baseUrl', label: 'Base URL (HTTPS)', type: 'url', required: true },
          { key: 'apiKey', label: 'API key', type: 'secret' },
        ],
        help: 'POST {baseUrl}/members/verify {memberNumber, lastName} → {verified:boolean, tier}. GET {baseUrl}/health for tests. Member numbers are never stored.',
      },
    },
  },
  {
    id: 'llm_primary', kind: 'llm', label: 'AI language model (primary)',
    providers: llmProviders(),
  },
  {
    id: 'llm_fallback', kind: 'llm', label: 'AI language model (fallback)',
    providers: llmProviders(),
  },
  {
    id: 'translation', kind: 'translation', label: 'Machine translation',
    providers: {
      none: { label: 'Built-in phrasebook only', fields: [] },
      llm: { label: 'Use the configured AI language model', fields: [] },
      libretranslate: {
        label: 'LibreTranslate (open source, self-hostable)',
        fields: [
          { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'http://127.0.0.1:5000' },
          { key: 'apiKey', label: 'API key (optional)', type: 'secret' },
        ],
      },
    },
  },
  {
    id: 'stt', kind: 'stt', label: 'Speech recognition',
    providers: {
      browser: { label: 'Browser / device speech recognition', fields: [] },
      whisper_compatible: {
        label: 'Whisper-compatible server (e.g. faster-whisper, whisper.cpp server)',
        fields: [
          { key: 'baseUrl', label: 'Base URL (…/v1)', type: 'url', required: true, placeholder: 'http://127.0.0.1:8000/v1' },
          { key: 'model', label: 'Model', type: 'text', placeholder: 'Systran/faster-whisper-small' },
          { key: 'apiKey', label: 'API key (optional)', type: 'secret' },
        ],
      },
    },
  },
];

function llmProviders() {
  const common = (url, model) => ([
    { key: 'baseUrl', label: 'Base URL (OpenAI-compatible …/v1)', type: 'url', required: true, placeholder: url },
    { key: 'model', label: 'Model', type: 'text', required: true, placeholder: model },
    { key: 'apiKey', label: 'API key', type: 'secret' },
  ]);
  return {
    none: { label: 'Disabled — rules-based assistant only', fields: [] },
    builtin: {
      label: 'Built-in model — runs inside this app (Qwen3, free, private, no extra software)',
      fields: [{ key: 'model', label: 'Model', type: 'select', options: ['qwen3-4b', 'qwen3-1.7b', 'qwen3-8b'], placeholder: 'qwen3-4b' }],
      help: 'The model runs inside this server. Tablets, kiosks and phones need nothing installed. Download it once (Admin → Integrations → Built-in AI) or run "npm run ai-setup" on the server. Qwen3 is Apache-2.0 licensed and supports 119 languages. On a laptop without a graphics card, expect a few seconds per answer.',
    },
    ollama: { label: 'Ollama (local, open-source: Qwen, DeepSeek, Llama, Gemma…)', fields: common('http://127.0.0.1:11434/v1', 'qwen3:8b') },
    vllm: { label: 'vLLM / LM Studio / llama.cpp server (self-hosted)', fields: common('http://127.0.0.1:8000/v1', 'Qwen/Qwen3-8B') },
    deepseek: { label: 'DeepSeek API', fields: common('https://api.deepseek.com/v1', 'deepseek-chat') },
    dashscope: { label: 'Alibaba Qwen (DashScope, OpenAI-compatible)', fields: common('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen-plus') },
    zhipu: { label: 'Zhipu GLM (OpenAI-compatible)', fields: common('https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash') },
    openrouter: { label: 'OpenRouter (many open models)', fields: common('https://openrouter.ai/api/v1', 'qwen/qwen3-32b') },
    custom: { label: 'Other OpenAI-compatible endpoint', fields: common('https://…/v1', 'model-name') },
  };
}

export function getDef(id) { return INTEGRATION_DEFS.find(d => d.id === id); }

export class SecretBox {
  constructor(secret) { this.key = crypto.createHash('sha256').update('airport-assistant-integrations:' + secret).digest(); }
  seal(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
  }
  open(str) {
    if (!str) return {};
    try {
      const [iv, tag, enc] = str.split('.').map(s => Buffer.from(s, 'base64'));
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
    } catch { return {}; }
  }
}

export class Integrations {
  constructor(db, secret) {
    this.db = db;
    this.box = new SecretBox(secret);
  }
  ensureRows() {
    const now = Date.now();
    for (const d of INTEGRATION_DEFS) {
      const defaultProvider = d.kind === 'stt' ? 'browser' : 'none';
      this.db.run(`INSERT OR IGNORE INTO integrations(id,kind,label,provider,enabled,status,updated_at) VALUES(?,?,?,?,0,'not_configured',?)`,
        d.id, d.kind, d.label, defaultProvider, now);
    }
  }
  row(id) { return this.db.get('SELECT * FROM integrations WHERE id = ?', id); }
  /** Full config with decrypted secrets — server-side use only. */
  config(id) {
    const r = this.row(id);
    if (!r) return null;
    return { ...r, config: this.box.open(r.config_enc) };
  }
  /** Is the integration usable right now? Requires enabled + authorised + a non-"none" provider. */
  active(id) {
    const c = this.config(id);
    if (!c || !c.enabled || !c.authorised) return null;
    if (c.provider === 'none' || c.provider === 'browser') return null;
    if (c.status !== 'connected') return null; // only after a successful live connection test
    return c;
  }
  /** Admin view: secrets masked. */
  list() {
    return this.db.all('SELECT * FROM integrations ORDER BY rowid').map(r => this.publicRow(r, true));
  }
  publicRow(r, forAdmin = false) {
    const def = getDef(r.id);
    const out = {
      id: r.id, kind: r.kind, label: r.label, provider: r.provider, enabled: !!r.enabled, authorised: !!r.authorised,
      status: this.effectiveStatus(r), statusDetail: r.status_detail, lastTestAt: r.last_test_at,
    };
    if (forAdmin) {
      const cfg = this.box.open(r.config_enc);
      const masked = {};
      const fields = def?.providers[r.provider]?.fields ?? [];
      for (const f of fields) {
        if (f.type === 'secret') masked[f.key] = cfg[f.key] ? '••••••••' + String(cfg[f.key]).slice(-4) : '';
        else masked[f.key] = cfg[f.key] ?? '';
      }
      out.config = masked;
      out.providers = def?.providers ?? {};
    }
    return out;
  }
  effectiveStatus(r) {
    if (r.provider === 'none') return 'not_configured';
    if (r.provider === 'browser') return 'device';
    if (!r.enabled) return 'disabled';
    if (!r.authorised) return 'awaiting_authorisation';
    return r.status; // configured_untested | connected | error
  }
  update(id, { provider, config, enabled, authorised }) {
    const r = this.row(id);
    const def = getDef(id);
    if (!r || !def) throw httpError(404, 'Unknown integration');
    const prov = provider ?? r.provider;
    const pdef = def.providers[prov];
    if (!pdef) throw httpError(400, 'Unknown provider');
    const old = this.box.open(r.config_enc);
    const next = prov === r.provider ? { ...old } : {};
    for (const f of pdef.fields) {
      if (!config || !(f.key in config)) continue;
      let v = config[f.key];
      if (f.type === 'secret' && typeof v === 'string' && v.startsWith('••••')) continue; // unchanged mask
      v = typeof v === 'string' ? v.trim() : v;
      if (f.type === 'select' && v && !f.options.includes(v)) throw httpError(400, `${f.label}: choose one of ${f.options.join(', ')}`);
      if (f.key === 'airport' && v && !/^[A-Za-z]{3}$/.test(v)) throw httpError(400, 'Airport must be a 3-letter IATA code');
      if (f.type === 'number' && v !== '' && v != null) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (f.min ?? 0) || n > (f.max ?? 1e9)) throw httpError(400, `${f.label}: whole number ${f.min ?? 0}–${f.max ?? 1e9}`);
        v = String(n);
      }
      if (f.type === 'url' && v) {
        let u;
        try { u = new URL(v); } catch { throw httpError(400, `${f.label}: invalid URL`); }
        if (!['http:', 'https:'].includes(u.protocol)) throw httpError(400, `${f.label}: must be http(s)`);
      }
      next[f.key] = v;
    }
    for (const f of pdef.fields) if (f.required && !next[f.key]) {
      if (enabled) throw httpError(400, `${f.label} is required`);
    }
    const changed = prov !== r.provider || JSON.stringify(next) !== JSON.stringify(old);
    const status = prov === 'none' || prov === 'browser' ? 'not_configured' : (changed ? 'configured_untested' : r.status);
    this.db.run(`UPDATE integrations SET provider=?, config_enc=?, enabled=?, authorised=?, status=?, status_detail=?, updated_at=? WHERE id=?`,
      prov, this.box.seal(next), (enabled ?? !!r.enabled) ? 1 : 0, (authorised ?? !!r.authorised) ? 1 : 0, status,
      changed ? null : r.status_detail, Date.now(), id);
    return this.publicRow(this.row(id), true);
  }
  setStatus(id, status, detail) {
    this.db.run('UPDATE integrations SET status=?, status_detail=?, last_test_at=? WHERE id=?', status, detail ?? null, Date.now(), id);
  }
  /** Public (passenger-facing) summary — never includes configuration. */
  publicSummary() {
    const out = {};
    for (const r of this.db.all('SELECT * FROM integrations')) {
      out[r.id] = { status: this.effectiveStatus(r), provider: r.provider === 'none' ? null : r.provider };
    }
    return out;
  }
}

export function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

export function authHeaders(cfg) {
  const h = {};
  if (cfg.apiKey) {
    const name = cfg.authHeader || 'Authorization';
    h[name] = name.toLowerCase() === 'authorization' ? `Bearer ${cfg.apiKey}` : cfg.apiKey;
  }
  return h;
}

export function joinUrl(base, p) {
  return String(base).replace(/\/+$/, '') + '/' + String(p).replace(/^\/+/, '');
}

export { parseJson };
