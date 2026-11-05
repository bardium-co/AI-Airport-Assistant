// Download the built-in AI model in advance (so the airport machine does not need to download it on first use).
// Usage: npm run ai-setup [-- qwen3-4b | qwen3-1.7b | qwen3-8b]
import { loadConfig } from './config.js';
import { LocalModel, LOCAL_MODELS, DEFAULT_LOCAL_MODEL } from './services/localmodel.js';

const id = process.argv[2] ?? DEFAULT_LOCAL_MODEL;
if (!LOCAL_MODELS[id]) { console.error(`Unknown model "${id}". Choose: ${Object.keys(LOCAL_MODELS).join(', ')}`); process.exit(2); }
const cfg = loadConfig();
const lm = new LocalModel(cfg.dataDir, { log: m => console.log(m) });
if (lm.installed(id)) { console.log(`${id} is already downloaded: ${lm.filePath(id)}`); process.exit(0); }
console.log(`Downloading ${LOCAL_MODELS[id].label} …`);
let last = -1;
const timer = setInterval(() => {
  const d = lm.downloads[id];
  if (!d) return;
  const pct = d.total ? Math.floor((d.done / d.total) * 100) : 0;
  if (pct !== last) { last = pct; console.log(`  ${pct}%  (${(d.done / 1e9).toFixed(2)} / ${(d.total / 1e9).toFixed(2)} GB)`); }
}, 2000);
try {
  await lm.download(id);
  console.log(`Done. Now open Admin → Integrations → "AI language model (primary)" → Built-in, or restart the app.`);
} catch (e) {
  console.error('Download failed:', e.message);
  process.exitCode = 1;
} finally { clearInterval(timer); }
