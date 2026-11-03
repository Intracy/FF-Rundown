// Passwörter (scrypt) und signierte Sitzungstokens – gleiches Format wie FF Rundown v1.x,
// damit Benutzerkonten beim Import unverändert weiter funktionieren.
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`)));
  });
}

export function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const [algo, saltB64, keyB64] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !saltB64 || !keyB64) return resolve(false);
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT, (err, key) => resolve(!err && crypto.timingSafeEqual(key, expected)));
  });
}

export function signToken(payload, secret, ttlSec = 30 * 24 * 3600) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp && p.exp < Date.now() / 1000 ? null : p;
  } catch {
    return null;
  }
}

export const ROLES = ['viewer', 'operator', 'editor', 'admin'];
export const rank = (role) => ROLES.indexOf(role);
export const can = (user, role) => !!user && rank(user.role) >= rank(role);
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
