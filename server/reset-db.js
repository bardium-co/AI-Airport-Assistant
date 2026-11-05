import fs from 'node:fs';
import { loadConfig } from './config.js';

const cfg = loadConfig();
for (const f of [cfg.dbFile, cfg.dbFile + '-wal', cfg.dbFile + '-shm', cfg.dbFile + '-journal']) {
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('Deleted', f); }
}
console.log('Database reset. It will be re-seeded on next start.');
