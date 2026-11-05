import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadSecret(dataDir) {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) return process.env.APP_SECRET;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, '.app-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** HTTPS: data/tls.pfx (+ data/tls.pass) created by "npm run make-cert", or HTTPS_PFX / HTTPS_CERT + HTTPS_KEY. */
function loadTls(env, dataDir) {
  try {
    const pfx = env.HTTPS_PFX ?? path.join(dataDir, 'tls.pfx');
    if (fs.existsSync(pfx)) {
      const passFile = path.join(dataDir, 'tls.pass');
      const passphrase = env.HTTPS_PFX_PASSWORD ?? (fs.existsSync(passFile) ? fs.readFileSync(passFile, 'utf8').trim() : undefined);
      return { pfx: fs.readFileSync(pfx), passphrase };
    }
    if (env.HTTPS_CERT && env.HTTPS_KEY) return { cert: fs.readFileSync(env.HTTPS_CERT), key: fs.readFileSync(env.HTTPS_KEY) };
  } catch (e) { console.error('[https] could not load certificate:', e.message); }
  return null;
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const production = (overrides.production ?? env.NODE_ENV === 'production');
  const dataDir = overrides.dataDir ?? env.DATA_DIR ?? path.join(ROOT, 'data');
  const cfg = {
    root: ROOT,
    publicDir: path.join(ROOT, 'public'),
    port: Number(env.PORT ?? 3000),
    // --lan (npm run start:airport): reachable from tablets, kiosks and phones on the same network.
    host: env.HOST ?? (process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1'),
    production,
    // Demo mode seeds clearly-labelled simulated flights and demo staff accounts.
    demoMode: env.DEMO_MODE ? env.DEMO_MODE !== 'false' : !production,
    dataDir,
    dbFile: env.DB_FILE ?? path.join(dataDir, 'airport-assistant.db'),
    sessionHours: Number(env.SESSION_HOURS ?? 10),
    trustProxy: env.TRUST_PROXY === 'true',
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : production,
    airportTimeZone: 'Asia/Qatar',
    ...overrides,
  };
  cfg.secret = overrides.secret ?? loadSecret(dataDir);
  cfg.tls = overrides.tls !== undefined ? overrides.tls : loadTls(env, dataDir);
  if (cfg.tls && !env.SECURE_COOKIES && overrides.secureCookies === undefined) cfg.secureCookies = true;
  return cfg;
}
