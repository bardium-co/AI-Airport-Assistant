import fs from 'node:fs';
import path from 'node:path';

// Built-in AI model: an open-source Qwen3 model running INSIDE this server process (llama.cpp via node-llama-cpp).
// No separate program (Ollama etc.) is needed on the machine that runs the app, and passenger text never
// leaves it. Tablets, kiosks and phones only talk to this server.
// All models below are Apache-2.0 licensed (commercial use allowed). Qwen3 supports 119 languages.
export const LOCAL_MODELS = {
  'qwen3-4b': { label: 'Qwen3 4B — recommended (2.5 GB, 8 GB RAM)', uri: 'hf:Qwen/Qwen3-4B-GGUF/Qwen3-4B-Q4_K_M.gguf', file: 'Qwen3-4B-Q4_K_M.gguf', sizeGb: 2.5 },
  'qwen3-1.7b': { label: 'Qwen3 1.7B — for older laptops (1.8 GB, 4 GB RAM)', uri: 'hf:Qwen/Qwen3-1.7B-GGUF/Qwen3-1.7B-Q8_0.gguf', file: 'Qwen3-1.7B-Q8_0.gguf', sizeGb: 1.8 },
  'qwen3-8b': { label: 'Qwen3 8B — best quality, needs a strong PC (5 GB, 16 GB RAM)', uri: 'hf:Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf', file: 'Qwen3-8B-Q4_K_M.gguf', sizeGb: 5.0 },
};
export const DEFAULT_LOCAL_MODEL = 'qwen3-4b';

export class LocalModel {
  constructor(dataDir, { log = () => {} } = {}) {
    this.dir = path.join(dataDir, 'models');
    this.log = log;
    this.loaded = null;       // { id, llama, model, context, wrapper, grammar }
    this.loading = null;      // Promise while a model loads
    this.downloads = {};      // id → { done, total, error, promise }
    this.queue = Promise.resolve();
    this.pending = 0;
  }

  info(id) { return LOCAL_MODELS[id] ?? null; }
  filePath(id) { return path.join(this.dir, LOCAL_MODELS[id].file); }
  installed(id) { try { return fs.statSync(this.filePath(id)).size > 100e6; } catch { return false; } }

  status() {
    return Object.fromEntries(Object.entries(LOCAL_MODELS).map(([id, m]) => {
      const d = this.downloads[id];
      return [id, {
        label: m.label, sizeGb: m.sizeGb, installed: this.installed(id), loaded: this.loaded?.id === id,
        downloading: d && !d.finished ? { done: d.done, total: d.total } : null, error: d?.error ?? null,
      }];
    }));
  }

  /** Download a model once into <data>/models (resumable). Returns immediately if already present. */
  download(id) {
    if (!LOCAL_MODELS[id]) throw new Error('Unknown model');
    if (this.installed(id)) return Promise.resolve(this.filePath(id));
    if (this.downloads[id]?.promise && !this.downloads[id].finished) return this.downloads[id].promise;
    const state = { done: 0, total: LOCAL_MODELS[id].sizeGb * 1e9, error: null, finished: false };
    this.downloads[id] = state;
    state.promise = (async () => {
      try {
        const { createModelDownloader } = await import('node-llama-cpp');
        fs.mkdirSync(this.dir, { recursive: true });
        const dl = await createModelDownloader({
          modelUri: LOCAL_MODELS[id].uri, dirPath: this.dir, fileName: LOCAL_MODELS[id].file, showCliProgress: false,
          onProgress: s => { state.done = s.downloadedSize; state.total = s.totalSize || state.total; },
        });
        const file = await dl.download();
        this.log(`[ai] Downloaded ${id} → ${file}`);
        return file;
      } catch (e) {
        state.error = String(e.message ?? e).slice(0, 300);
        throw e;
      } finally { state.finished = true; }
    })();
    state.promise.catch(() => {});
    return state.promise;
  }

  async load(id) {
    if (this.loaded?.id === id) return this.loaded;
    if (this.loading) { await this.loading.catch(() => {}); if (this.loaded?.id === id) return this.loaded; }
    if (!this.installed(id)) throw new Error('The built-in model is not downloaded yet (Admin → Integrations → Download)');
    this.loading = (async () => {
      await this.unload();
      const { getLlama, QwenChatWrapper } = await import('node-llama-cpp');
      const llama = await getLlama({ gpu: 'auto', logLevel: 'error' });
      const model = await llama.loadModel({ modelPath: this.filePath(id) });
      const context = await model.createContext({ contextSize: 4096 });
      const grammar = await llama.getGrammarFor('json');
      // "discourage" turns off Qwen3's slow step-by-step thinking: passengers need quick answers.
      const wrapper = new QwenChatWrapper({ thoughts: 'discourage' });
      this.loaded = { id, llama, model, context, grammar, wrapper, gpu: llama.gpu };
      this.log(`[ai] Built-in model ${id} loaded (${llama.gpu ? `GPU: ${llama.gpu}` : 'CPU'})`);
      return this.loaded;
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }

  async unload() {
    const l = this.loaded;
    this.loaded = null;
    if (l) { try { await l.context.dispose(); await l.model.dispose(); } catch { /* ignore */ } }
  }

  /**
   * Chat completion. Requests run one at a time (a laptop CPU cannot run several at once efficiently).
   * messages: [{role:'system'|'user'|'assistant', content}]
   */
  chat(id, messages, { temperature = 0.2, maxTokens = 400, json = false, timeoutMs = 60000 } = {}) {
    if (this.pending >= 6) return Promise.reject(new Error('Built-in model is busy'));
    this.pending++;
    const run = async () => {
      const l = await this.load(id);
      const { LlamaChatSession } = await import('node-llama-cpp');
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const turns = messages.filter(m => m.role !== 'system');
      const last = turns.at(-1)?.content ?? '';
      const sequence = l.context.getSequence();
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system || undefined, chatWrapper: l.wrapper });
      try {
        if (turns.length > 1) {
          session.setChatHistory([
            ...(system ? [{ type: 'system', text: system }] : []),
            ...turns.slice(0, -1).map(m => (m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content] })),
          ]);
        }
        const signal = AbortSignal.timeout(timeoutMs);
        const text = await session.prompt(last, {
          temperature, maxTokens, signal, stopOnAbortSignal: true, ...(json ? { grammar: l.grammar } : {}),
        });
        return String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      } finally {
        session.dispose?.();
        sequence.dispose?.();
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p.finally(() => { this.pending--; });
  }
}
