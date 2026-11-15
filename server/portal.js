// Optionale Anbindung an das Portal „FrankenFinals Broadcast“ (Single Sign-on).
//
// Ohne PORTAL_SSO_SECRET läuft FF Rundown wie bisher allein mit eigenen Konten.
// Mit PORTAL_URL + PORTAL_SSO_SECRET (mind. 32 Zeichen, im Portal identisch als RUNDOWN_SSO_SECRET):
//   • Die Kachel im Portal öffnet <diese Adresse>/auth/portal?ticket=… mit einer signierten Eintrittskarte
//     (HMAC-SHA256, 60 s gültig, nur einmal nutzbar) mit Name, E-Mail, Rolle und Art (Mitglied/Gast).
//   • Das Konto wird hier automatisch angelegt bzw. verknüpft (zuerst über die Portal-ID, sonst über die E-Mail –
//     so behalten bestehende Benutzer ihre Freigaben und ihren Verlauf). Rolle und „extern“ kommen aus dem Portal.
//   • Benutzer werden im Portal verwaltet; hier bleibt nur der lokale Super-Admin mit Passwort als Notfall-Zugang.
import crypto from 'node:crypto';
import { db, Q, randomToken } from './db.js';
import { ROLES } from './auth.js';

/** Adresse vereinheitlichen: ohne http(s):// wird https:// ergänzt, Pfad und Slash am Ende fallen weg */
export function normalizeBaseUrl(raw) {
  let v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  try { return new URL(v).origin; } catch { return ''; }
}

export const PORTAL = {
  url: normalizeBaseUrl(process.env.PORTAL_URL),
  secret: String(process.env.PORTAL_SSO_SECRET || '').trim(),
  moduleId: String(process.env.PORTAL_MODULE_ID || 'rundown').trim(),
  hours: Math.max(1, Math.min(Number(process.env.PORTAL_SESSION_HOURS) || 12, 24 * 7)),
};

/** Ist die Anbindung eingerichtet? */
export const portalEnabled = () => PORTAL.secret.length >= 32;

/** Infos für die Oberfläche (Anmelde-Knopf, „Zum Portal“) */
export const portalInfo = () => (portalEnabled() ? { url: PORTAL.url || null, login: PORTAL.url ? `${PORTAL.url}/sso/${PORTAL.moduleId}` : null } : null);

/** Eintrittskarte prüfen – Gegenstück zu server/sso.js im Portal */
export function verifyTicket(ticket, secret = PORTAL.secret, aud = PORTAL.moduleId, now = Date.now()) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p.v !== 1 || p.aud !== aud || typeof p.exp !== 'number' || p.exp * 1000 < now || !p.jti || !p.sub || !p.email) return null;
  return p;
}

/** Jede Eintrittskarte gilt nur einmal (bis zu ihrem Ablauf gemerkt) */
const used = new Map();
export function firstUse(jti, expMs) {
  const now = Date.now();
  for (const [k, until] of used) if (until < now) used.delete(k);
  if (used.has(jti)) return false;
  used.set(jti, expMs);
  return true;
}

/**
 * Konto zur Eintrittskarte anlegen oder aktualisieren. Liefert { user, changed } –
 * changed = Rolle oder „extern“ haben sich geändert (andere Sitzungen müssen neu laden).
 */
export function upsertPortalUser(t) {
  if (!ROLES.includes(t.role)) throw new Error('Unbekannte Rolle aus dem Portal');
  const sub = String(t.sub);
  const email = String(t.email).trim();
  const name = String(t.name || '').trim();
  const restricted = t.kind === 'guest' && t.role !== 'admin' ? 1 : 0;
  let u = db.prepare('SELECT * FROM users WHERE portal_sub=?').get(sub)
    || db.prepare('SELECT * FROM users WHERE lower(email)=lower(?)').get(email); // auch nach Neuanlage im Portal (neue ID, gleiche E-Mail)

  if (!u) {
    const { lastInsertRowid } = Q.insertUserFull.run(email, name, 'none$' + randomToken(16), t.role, 0);
    db.prepare('UPDATE users SET portal_sub=?, restricted=? WHERE id=?').run(sub, restricted, lastInsertRowid);
    return { user: Q.userById.get(lastInsertRowid), created: true, changed: false };
  }

  // Der lokale Super-Admin bleibt immer Admin (Notfall-Zugang), alle anderen bekommen Rolle und „extern“ aus dem Portal
  const role = u.is_owner ? 'admin' : t.role;
  const restr = u.is_owner ? 0 : restricted;
  const changed = role !== u.role || restr !== u.restricted;
  const emailTaken = email.toLowerCase() !== u.email.toLowerCase() && db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(email, u.id);
  db.prepare(`UPDATE users SET portal_sub=?, role=?, restricted=?, name=?, email=?, must_change=0${changed ? ', token_version=token_version+1' : ''} WHERE id=?`)
    .run(sub, role, restr, name || u.name, emailTaken ? u.email : email, u.id);
  return { user: Q.userById.get(u.id), created: false, changed };
}

/** Ziel nach der Portal-Anmeldung (…/auth/portal?ticket=…&next=/#/rundown/5): nur Seiten dieser App */
export function safeNext(raw) {
  const v = String(raw || '');
  return v.length <= 300 && /^\/(?![/\\])[^\s]*$/.test(v) ? v : '';
}

// Schnittstelle für die Terminplanung (FF-Planner): Rundowns einer Person auflisten und anlegen.
// PLANNER_API_SECRET (mind. 32 Zeichen), in der Terminplanung identisch als RUNDOWN_API_SECRET.
// Header „Authorization: Planner <ts>.<sig>“, sig = base64url(HMAC-SHA256(Schlüssel, "rundown-api:<ts>")), ±120 s gültig.
export const PLANNER_SECRET = String(process.env.PLANNER_API_SECRET || '').trim();
export const plannerEnabled = () => PLANNER_SECRET.length >= 32;
export function verifyPlannerAuth(header, secret = PLANNER_SECRET, now = Date.now()) {
  if (secret.length < 32) return false;
  const [ts, sig] = String(header || '').replace(/^Planner\s+/i, '').split('.');
  if (!/^\d+$/.test(ts || '') || !sig || Math.abs(now / 1000 - Number(ts)) > 120) return false;
  const want = crypto.createHmac('sha256', secret).update(`rundown-api:${ts}`).digest();
  const got = Buffer.from(sig, 'base64url');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
