import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff','supervisor','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  native_name TEXT NOT NULL,
  speech_code TEXT NOT NULL,
  rtl INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  concourse TEXT,
  level TEXT,
  x REAL NOT NULL,
  y REAL NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 1,
  accessible INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT
);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  b TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  distance_m REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'walk',
  step_free INTEGER NOT NULL DEFAULT 1,
  UNIQUE(a,b)
);
CREATE TABLE IF NOT EXISTS lounges (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  operator TEXT,
  hours TEXT NOT NULL,
  rules TEXT NOT NULL,
  amenities TEXT NOT NULL DEFAULT '[]',
  paid_access TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  simulated INTEGER NOT NULL DEFAULT 1,
  source_url TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS faqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  translations TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  verified_on TEXT,
  published INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guidance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  passenger_text TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  version INTEGER NOT NULL DEFAULT 1,
  approved_by TEXT,
  approved_at INTEGER,
  source_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS flights_sim (
  flight_no TEXT PRIMARY KEY,
  airline TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  dep_offset_min INTEGER NOT NULL,
  gate TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
);
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'none',
  config_enc TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  authorised INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_configured',
  status_detail TEXT,
  last_test_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eligibility_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('lounge','upgrade','membership')),
  inputs TEXT NOT NULL,
  provisional TEXT NOT NULL,
  checklist TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','escalated')),
  requires_role TEXT NOT NULL DEFAULT 'staff',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER,
  decision_reason TEXT,
  recommended_by INTEGER REFERENCES users(id),
  ref_code TEXT UNIQUE,
  ref_expires INTEGER
);
CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  passenger_lang TEXT NOT NULL,
  staff_lang TEXT NOT NULL,
  entries TEXT NOT NULL,
  consent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  lang TEXT NOT NULL,
  location_id TEXT,
  flight_no TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at INTEGER,
  closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  closed_at INTEGER,
  waiting_since INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests(status, updated_at);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  lang TEXT,
  translated_text TEXT,
  translated_lang TEXT,
  engine TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_msg ON support_messages(request_id, id);
CREATE TABLE IF NOT EXISTS analytics_daily (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  intent TEXT NOT NULL,
  lang TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, mode, intent, lang)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_edges_a ON edges(a);
CREATE INDEX IF NOT EXISTS idx_edges_b ON edges(b);
CREATE INDEX IF NOT EXISTS idx_cases_status ON eligibility_cases(status);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`;

export class Db {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.raw.exec(SCHEMA);
    this.cache = new Map();
  }
  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all(sql, ...params) { return this.stmt(sql).all(...params).map(plain); }
  get(sql, ...params) { const r = this.stmt(sql).get(...params); return r ? plain(r) : undefined; }
  run(sql, ...params) { return this.stmt(sql).run(...params); }
  tx(fn) {
    this.raw.exec('BEGIN');
    try { const r = fn(); this.raw.exec('COMMIT'); return r; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
  getSetting(key, fallback) {
    const r = this.get('SELECT value FROM settings WHERE key = ?', key);
    return r ? JSON.parse(r.value) : fallback;
  }
  setSetting(key, value) {
    this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  }
  audit(user, action, target, detail) {
    this.run('INSERT INTO audit_log(at,user_id,username,action,target,detail) VALUES(?,?,?,?,?,?)',
      Date.now(), user?.id ?? null, user?.username ?? null, action, target ?? null, detail ? JSON.stringify(detail) : null);
  }
  close() { this.raw.close(); }
}

function plain(row) { return { ...row }; }

export function parseJson(v, fallback) {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
