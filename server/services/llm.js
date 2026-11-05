import { joinUrl } from './integrations.js';

/** Strip reasoning traces emitted by some open models (e.g. Qwen3 / DeepSeek-R1 "<think>…</think>"). */
export function stripThinking(text) {
  return String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^\s*<think>[\s\S]*$/i, '').trim();
}

let localModel = null;
/** The server registers its built-in model engine here (see app.js). */
export function setLocalModel(lm) { localModel = lm; }
export function getLocalModel() { return localModel; }

export async function chatCompletion(cfg, messages, { temperature = 0.2, maxTokens = 600, timeoutMs = 20000, json = false } = {}) {
  if (cfg.provider === 'builtin') {
    if (!localModel) throw new Error('Built-in model engine is not available');
    // A laptop CPU is slower than a hosted API: allow twice the usual time.
    return stripThinking(await localModel.chat(cfg.config.model || 'qwen3-4b', messages, { temperature, maxTokens, json, timeoutMs: timeoutMs * 2 }));
  }
  const url = joinUrl(cfg.config.baseUrl, 'chat/completions');
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.config.apiKey) headers.Authorization = `Bearer ${cfg.config.apiKey}`;
  const body = { model: cfg.config.model, messages, temperature, max_tokens: maxTokens, stream: false };
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM returned no content');
  return stripThinking(content);
}

export class LlmChain {
  constructor(integrations) { this.integrations = integrations; }
  providers() {
    return ['llm_primary', 'llm_fallback'].map(id => this.integrations.active(id)).filter(Boolean);
  }
  available() { return this.providers().length > 0; }
  /** Try primary then fallback. Returns {text, model} or null when nothing is available / all fail. */
  async complete(messages, opts) {
    for (const p of this.providers()) {
      try {
        const text = await chatCompletion(p, messages, opts);
        return { text, model: `${p.provider}:${p.config.model}` };
      } catch (e) {
        this.lastError = e.message;
      }
    }
    return null;
  }
  async completeJson(messages, opts) {
    const r = await this.complete(messages, { ...opts, json: true });
    if (!r) return null;
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return { data: JSON.parse(m[0]), model: r.model }; } catch { return null; }
  }
}

export async function testLlm(cfg) {
  if (cfg.provider === 'builtin') {
    const id = cfg.config.model || 'qwen3-4b';
    if (!localModel?.installed(id)) throw new Error('The built-in model is not downloaded yet — use "Download" first');
    const t0 = Date.now();
    const text = await chatCompletion(cfg, [
      { role: 'system', content: 'Reply with the single word OK.' },
      { role: 'user', content: 'Connection test' },
    ], { maxTokens: 10, timeoutMs: 90000 });
    return `Built-in ${id} replied "${text.slice(0, 20)}" in ${((Date.now() - t0) / 1000).toFixed(1)} s (${localModel.loaded?.gpu ? 'GPU ' + localModel.loaded.gpu : 'CPU'})`;
  }
  const text = await chatCompletion(cfg, [
    { role: 'system', content: 'Reply with the single word OK.' },
    { role: 'user', content: 'Connection test' },
  ], { maxTokens: 20, timeoutMs: 30000 });
  return `Model replied: ${text.slice(0, 60)}`;
}
