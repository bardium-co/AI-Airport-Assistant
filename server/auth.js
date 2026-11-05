import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const ROLE_RANK = { staff: 1, supervisor: 2, admin: 3 };
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(key, expected);
}

export function passwordProblems(pw) {
  const p = String(pw ?? '');
  const issues = [];
  if (p.length < 12) issues.push('at least 12 characters');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) issues.push('upper- and lower-case letters');
  if (!/\d/.test(p)) issues.push('a number');
  return issues;
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
// Pre-computed hash used to equalise timing when the username does not exist.
let DUMMY_HASH = null;

export class Auth {
  constructor(db, cfg) { this.db = db; this.cfg = cfg; }

  async login(username, password) {
    const u = this.db.get('SELECT * FROM users WHERE username = ?', String(username ?? '').trim());
    const now = Date.now();
    if (!u || !u.active) {
      DUMMY_HASH ??= await hashPassword('timing-equaliser');
      await verifyPassword(String(password ?? ''), DUMMY_HASH);
      return { ok: false, reason: 'invalid' };
    }
    if (u.locked_until && u.locked_until > now) return { ok: false, reason: 'locked', until: u.locked_until };
    const ok = await verifyPassword(String(password ?? ''), u.password_hash);
    if (!ok) {
      const failed = u.failed_attempts + 1;
      const lock = failed >= MAX_FAILED ? now + LOCK_MS : null;
      this.db.run('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?', lock ? 0 : failed, lock, u.id);
      this.db.audit(u, lock ? 'auth.locked' : 'auth.failed', `user:${u.id}`);
      return { ok: false, reason: lock ? 'locked' : 'invalid' };
    }
    this.db.run('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=? WHERE id=?', now, u.id);
    const token = crypto.randomBytes(32).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const expires = now + this.cfg.sessionHours * 3600 * 1000;
    this.db.run('INSERT INTO sessions(token_hash,user_id,csrf,created_at,expires_at) VALUES(?,?,?,?,?)', sha256(token), u.id, csrf, now, expires);
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', now);
    this.db.audit(u, 'auth.login', `user:${u.id}`);
    return { ok: true, token, csrf, expires, user: publicUser(u) };
  }

  session(token) {
    if (!token) return null;
    const s = this.db.get(`SELECT s.csrf, s.expires_at, s.token_hash, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
    if (!s || s.expires_at < Date.now() || !s.active) return null;
    return { user: publicUser(s), csrf: s.csrf, tokenHash: s.token_hash, expires: s.expires_at };
  }

  logout(token) { if (token) this.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); }
  revokeUser(userId) { this.db.run('DELETE FROM sessions WHERE user_id = ?', userId); }
}

export function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.display_name, role: u.role, isDemo: !!u.is_demo };
}

export function hasRole(user, role) {
  return !!user && (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK[role];
}

export function csrfEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
