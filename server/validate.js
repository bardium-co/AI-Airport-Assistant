import { HttpError } from './http.js';

export function str(v, name, { max = 200, min = 0, required = false, pattern, trim = true } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (typeof v !== 'string') throw new HttpError(400, `${name} must be text`);
  const s = trim ? v.trim() : v;
  if (required && !s) throw new HttpError(400, `${name} is required`);
  if (s.length > max) throw new HttpError(400, `${name} is too long (max ${max})`);
  if (s.length < min) throw new HttpError(400, `${name} is too short (min ${min})`);
  if (pattern && s && !pattern.test(s)) throw new HttpError(400, `${name} has an invalid format`);
  return s;
}

export function num(v, name, { min = -Infinity, max = Infinity, required = false, int = false } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
}

export function oneOf(v, name, list, { required = false, fallback = null } = {}) {
  if (v == null || v === '') {
    if (required) throw new HttpError(400, `${name} is required`);
    return fallback;
  }
  if (!list.includes(v)) throw new HttpError(400, `${name} must be one of: ${list.join(', ')}`);
  return v;
}

export function bool(v, fallback = false) {
  if (v == null) return fallback;
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function url(v, name) {
  const s = str(v, name, { max: 500 });
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, `${name} must be a valid URL`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new HttpError(400, `${name} must be http(s)`);
  return s;
}

export function arr(v, name, { max = 100 } = {}) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${name} must be a list`);
  if (v.length > max) throw new HttpError(400, `${name} has too many items (max ${max})`);
  return v;
}

export function obj(v, name) {
  if (v == null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `${name} must be an object`);
  return v;
}
