import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, DEMO } from './helpers.js';
import { chatCompletion, setLocalModel, getLocalModel, testLlm } from '../server/services/llm.js';
import { LocalModel, LOCAL_MODELS } from '../server/services/localmodel.js';
import { getDef } from '../server/services/integrations.js';
import { loadConfig } from '../server/config.js';

test('built-in model option exists, offers only commercially usable (Apache-2.0) Qwen3 models', () => {
  const p = getDef('llm_primary').providers.builtin;
  assert.ok(p, 'builtin provider');
  assert.deepEqual(p.fields[0].options, ['qwen3-4b', 'qwen3-1.7b', 'qwen3-8b']);
  for (const m of Object.values(LOCAL_MODELS)) assert.match(m.uri, /^hf:Qwen\/Qwen3-/, 'official Qwen3 repos only');
});

test('chat requests for the built-in provider go to the in-process engine, not over the network', async () => {
  const prev = getLocalModel();
  const calls = [];
  setLocalModel({ chat: async (id, messages, opts) => { calls.push({ id, messages, opts }); return '<think>hidden</think>Bonjour'; }, installed: () => true, loaded: null });
  try {
    const text = await chatCompletion({ provider: 'builtin', config: { model: 'qwen3-1.7b' } }, [{ role: 'user', content: 'Hello' }], { timeoutMs: 1000 });
    assert.equal(text, 'Bonjour', 'reasoning traces stripped');
    assert.equal(calls[0].id, 'qwen3-1.7b');
    assert.equal(calls[0].opts.timeoutMs, 2000, 'laptop CPUs get extra time');
  } finally { setLocalModel(prev); }
});

test('the connection test refuses a model that is not downloaded', async () => {
  const prev = getLocalModel();
  setLocalModel({ installed: () => false });
  try { await assert.rejects(testLlm({ provider: 'builtin', config: { model: 'qwen3-8b' } }), /not downloaded/); }
  finally { setLocalModel(prev); }
});

test('admin: model list, download guard, one-click enable requires a downloaded model', async () => {
  const A = await startApp();
  try {
    assert.equal((await A.get('/api/admin/ai/models')).status, 401);
    const ad = await A.login(...DEMO.admin);
    const s = await A.login(...DEMO.staff);
    assert.equal((await s.get('/api/admin/ai/models')).status, 403, 'staff cannot manage the AI');
    const m = (await ad.get('/api/admin/ai/models')).json.models;
    assert.deepEqual(Object.keys(m).sort(), ['qwen3-1.7b', 'qwen3-4b', 'qwen3-8b']);
    assert.equal((await ad.post('/api/admin/ai/models/gpt-9/download')).status, 404);
    const notInstalled = Object.keys(m).find(id => !m[id].installed);
    if (notInstalled) assert.equal((await ad.post('/api/admin/ai/enable-builtin', { model: notInstalled })).status, 409);
    assert.equal((await ad.post('/api/admin/ai/enable-builtin', { model: 'llama-70b' })).status, 400);
  } finally { await A.close(); }
});

// Real model: runs only when the model has been downloaded (npm run ai-setup) and RUN_AI_TESTS=1.
const cfg = loadConfig();
const lm = new LocalModel(cfg.dataDir);
const realReady = lm.installed('qwen3-4b') && process.env.RUN_AI_TESTS === '1';
test('real built-in Qwen3 model: understands and translates (slow; opt-in)', { skip: !realReady && 'set RUN_AI_TESTS=1 after npm run ai-setup' }, async () => {
  setLocalModel(lm);
  try {
    const ok = await chatCompletion({ provider: 'builtin', config: { model: 'qwen3-4b' } }, [
      { role: 'system', content: 'Translate the user message from Hindi to English. Output only the translation.' },
      { role: 'user', content: 'मेरा बैग नहीं मिल रहा' },
    ], { maxTokens: 40, timeoutMs: 60000 });
    assert.match(ok.toLowerCase(), /bag|luggage/);
    const json = await chatCompletion({ provider: 'builtin', config: { model: 'qwen3-4b' } }, [
      { role: 'system', content: 'Return JSON {"intent": "lounge"|"gate"|"other"} for the passenger message.' },
      { role: 'user', content: 'where can i relax before my flight, i have business class' },
    ], { maxTokens: 30, json: true, timeoutMs: 60000 });
    assert.doesNotThrow(() => JSON.parse(json));
  } finally { await lm.unload(); }
});
