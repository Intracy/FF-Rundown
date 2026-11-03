// Taktgeber-Server: liefert die gebaute App aus, synchronisiert alle Geräte per WebSocket,
// verwaltet Benutzer, Gast-Links, API-Tokens und bietet eine HTTP-API zur Steuerung
// (Stream Deck / Bitfocus Companion / Grafik-Overlays).
//
// Start: npm start   (baut zuerst, dann http://<host>:8787)
// Umgebungsvariablen (siehe .env.example):
//   PORT, HOST, DATA_DIR, TRUST_PROXY, SESSION_SECRET
//   ADMIN_PASSWORD  optional: Notfall-/Alt-Zugang mit Admin-Rechten (Passwort statt Benutzerkonto)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as core from './core.mjs';
import { EMAIL_RE, ROLES, can, hashPassword, signToken, verifyPassword, verifyToken } from './auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '../package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const DIST = path.resolve(here, '../dist');
const DATA = path.resolve(process.env.DATA_DIR || path.join(here, '../data'));
const FILE = path.join(DATA, 'state.json');
const PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ---------- Zustand ---------- */
let state = { rundowns: {}, events: {}, live: {}, deleted: {}, shares: {}, users: {}, apiTokens: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  console.log(`Geladen: ${Object.keys(state.rundowns).length} Abläufe, ${Object.keys(state.users).length} Benutzer aus ${FILE}`);
} catch {
  console.log(`Neuer Datenspeicher: ${FILE}`);
}
fs.mkdirSync(DATA, { recursive: true });

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(state));
    fs.renameSync(FILE + '.tmp', FILE);
  }, 300);
}

/** Schlüssel für Sitzungstokens – wird beim ersten Start im Datenordner erzeugt */
const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
})();

/** Schnellzugriffscodes (nur im Speicher, 10 Minuten gültig) */
const codes = new Map();
const CODE_TTL = 10 * 60_000;

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
const userCount = () => Object.keys(state.users).length;
const needsSetup = () => userCount() === 0 && !PASSWORD;
const userOut = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin ?? null, legacy: !!u.legacy } : null);
const LEGACY_ADMIN = { id: 'admin-password', email: '', name: 'Admin (Passwort)', role: 'admin', legacy: true };

/** Anmeldung prüfen: Sitzungstoken oder (Alt-)Admin-Passwort */
function userFromCredential(cred) {
  if (!cred) return null;
  if (PASSWORD && safeEq(cred, PASSWORD)) return LEGACY_ADMIN;
  const p = verifyToken(cred, SECRET);
  if (!p) return null;
  const u = state.users[p.uid];
  return u && (u.tokenVersion ?? 0) === p.tv ? u : null;
}
const sessionFor = (u) => signToken({ uid: u.id, tv: u.tokenVersion ?? 0 }, SECRET);

/* ---------- Login-Drosselung ---------- */
const attempts = new Map();
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket.remoteAddress || '';
}
function checkRate(ip) {
  const a = attempts.get(ip);
  if (a && a.count >= 8 && Date.now() - a.first < 15 * 60_000) throw httpError(429, 'Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.');
}
function noteFail(ip) {
  const a = attempts.get(ip);
  if (!a || Date.now() - a.first > 15 * 60_000) attempts.set(ip, { count: 1, first: Date.now() });
  else a.count++;
}

/* ---------- Gast-Filter ---------- */
function filterRundown(r, share) {
  if (!share || share.mode !== 'view' || !share.columns) return r;
  const keep = new Set(share.columns);
  return {
    ...r,
    columns: r.columns.filter((c) => keep.has(c.id)),
    items: r.items.map((it) => (it.kind === 'cue' ? { ...it, cells: Object.fromEntries(Object.entries(it.cells || {}).filter(([k]) => keep.has(k))) } : it)),
    output: { ...r.output, columns: (r.output?.columns || []).filter((c) => keep.has(c)) },
    trash: [],
    cellLog: [],
  };
}

function initFor(client) {
  if (client.share) {
    const r = state.rundowns[client.share.rundownId];
    return {
      rundowns: r ? { [r.id]: filterRundown(r, client.share) } : {},
      events: {},
      live: r && state.live[r.id] ? { [r.id]: state.live[r.id] } : {},
      deleted: {},
    };
  }
  return { rundowns: state.rundowns, events: state.events, live: state.live, deleted: state.deleted };
}

/* ---------- WebSocket ---------- */
const server = http.createServer(handle);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

function broadcast(msg, except) {
  for (const c of clients) {
    if (c.ws === except || !c.ready) continue;
    if (c.share) {
      const rid = msg.t === 'rundown' ? msg.rundown.id : msg.id;
      if (msg.t === 'event' || rid !== c.share.rundownId) continue;
      if (msg.t === 'rundown') {
        send(c.ws, { ...msg, rundown: filterRundown(msg.rundown, c.share) });
        continue;
      }
    }
    send(c.ws, msg);
  }
}
const peers = () => {
  const n = [...clients].filter((c) => c.ready).length;
  for (const c of clients) if (c.ready) send(c.ws, { t: 'peers', peers: n });
};

/** Rolle einer Verbindung: Gast-Links wie Viewer bzw. Editor (nur ihr Ablauf) */
const roleOf = (client) => (client.share ? (client.share.mode === 'edit' ? 'editor' : 'viewer') : client.user?.role ?? 'viewer');

function applyWrite(m, client) {
  const role = roleOf(client);
  if (role === 'viewer') return false;
  if (role === 'operator' && m.t !== 'live') return false;
  if (client.share && (m.t === 'event' || m.t === 'delete')) return false;
  if (m.t === 'rundown' && m.rundown?.id) {
    const id = m.rundown.id;
    if (client.share && id !== client.share.rundownId) return false;
    if (state.deleted[id]) return false;
    const cur = state.rundowns[id];
    if (cur && (m.rundown.updatedAt ?? 0) < (cur.updatedAt ?? 0)) return false;
    state.rundowns[id] = m.rundown;
    return true;
  }
  if (m.t === 'live' && m.id && m.live) {
    if (client.share && m.id !== client.share.rundownId) return false;
    const cur = state.live[m.id];
    if (cur && (m.live.updatedAt ?? 0) < (cur.updatedAt ?? 0)) return false;
    state.live[m.id] = m.live;
    return true;
  }
  if (m.t === 'event' && m.event?.id) {
    const cur = state.events[m.event.id];
    if (cur && (m.event.updatedAt ?? 0) < (cur.updatedAt ?? 0)) return false;
    state.events[m.event.id] = m.event;
    return true;
  }
  if (m.t === 'delete' && m.id) {
    delete state.rundowns[m.id];
    delete state.live[m.id];
    delete state.events[m.id];
    for (const [t, s] of Object.entries(state.shares)) if (s.rundownId === m.id) delete state.shares[t];
    for (const [t, s] of Object.entries(state.apiTokens)) if (s.rundownId === m.id) delete state.apiTokens[t];
    state.deleted[m.id] = m.at ?? Date.now();
    return true;
  }
  return false;
}

wss.on('connection', (ws) => {
  const client = { ws, ready: false, share: null, user: null };
  clients.add(client);

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: Date.now() });

    if (m.t === 'hello') {
      const sh = m.share ? state.shares[m.share] : null;
      if (m.share && !sh) return send(ws, { t: 'auth-required', mode: 'share', error: 'Dieser Gast-Link ist nicht mehr gültig.' });
      if (sh) client.share = { token: m.share, ...sh };
      else {
        if (needsSetup()) return send(ws, { t: 'auth-required', mode: 'setup', error: '' });
        const u = userFromCredential(m.auth);
        if (!u) {
          const mode = userCount() ? 'login' : 'password';
          return send(ws, { t: 'auth-required', mode, error: m.auth ? (mode === 'password' ? 'Falsches Passwort.' : 'Anmeldung abgelaufen oder ungültig.') : '' });
        }
        client.user = u;
      }
      client.ready = true;
      send(ws, {
        t: 'init',
        state: initFor(client),
        now: Date.now(),
        version: VERSION,
        peers: [...clients].filter((c) => c.ready).length,
        user: userOut(client.user),
        role: roleOf(client),
        share: client.share ? { token: client.share.token, mode: client.share.mode, rundownId: client.share.rundownId } : null,
      });
      return peers();
    }

    if (!client.ready) return;
    if (applyWrite(m, client)) {
      save();
      broadcast(m, ws);
    }
  });

  ws.on('close', () => {
    clients.delete(client);
    peers();
  });
});

/** Verbindungen eines Benutzers trennen (Rolle geändert, gelöscht, Passwort zurückgesetzt) */
function kickUser(id) {
  for (const c of clients) if (c.user?.id === id) c.ws.close();
}

/** Live-Zustand serverseitig setzen (API, Auto-Start) und an alle verteilen */
function setLive(id, live) {
  const stamped = { ...live, updatedAt: Date.now() };
  state.live[id] = stamped;
  save();
  broadcast({ t: 'live', id, live: stamped });
  pushSse(id);
  return stamped;
}

// Auto-Start läuft auch dann weiter, wenn gerade kein Browser offen ist
setInterval(() => {
  const now = Date.now();
  for (const [id, raw] of Object.entries(state.live)) {
    const r = state.rundowns[id];
    if (!r) continue;
    const l = core.normalizeLive(raw);
    const rr = core.normalizeRundown(r);
    if (l.status === 'idle' && !core.playable(rr).some((c) => c.startMode === 'hard' && c.autoStart)) continue;
    const nxt = core.autoTick(rr, l, now);
    if (nxt) setLive(id, nxt);
  }
}, 250);

const loadRd = (id) => {
  const raw = state.rundowns[id];
  return raw ? { raw, r: core.normalizeRundown(raw), l: core.normalizeLive(state.live[id]) } : null;
};
const summary = (id) => {
  const x = loadRd(id);
  return core.nowSummary(x.r, x.l, Date.now());
};

const sse = new Map();
function pushSse(id) {
  const set = sse.get(id);
  if (!set?.size || !state.rundowns[id]) return;
  const data = `data: ${JSON.stringify(summary(id))}\n\n`;
  for (const res of set) res.write(data);
}
setInterval(() => {
  for (const id of sse.keys()) pushSse(id);
}, 1000);

/* ---------- HTTP-Hilfen ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS' };
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
  res.end(JSON.stringify(body));
}
function text(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...CORS });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function currentUser(req, url) {
  const h = req.headers.authorization || '';
  const cred = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('key') || '';
  return userFromCredential(cred);
}
function need(user, role) {
  if (!user) throw httpError(401, needsSetup() ? 'Einrichtung erforderlich' : 'Anmeldung erforderlich (Authorization: Bearer …)');
  if (!can(user, role)) throw httpError(403, 'Dafür fehlen die Rechte');
}

/** Zeitangabe aus seconds=…, minutes=… oder time=mm:ss (bzw. einem anderen Feld) in Millisekunden */
function readMs(q, field = 'seconds') {
  if (q[field] !== undefined && q[field] !== '') {
    const v = Number(q[field]);
    if (Number.isFinite(v)) return Math.round(v * 1000);
  }
  if (q.ms !== undefined && Number.isFinite(Number(q.ms))) return Math.round(Number(q.ms));
  if (q.minutes !== undefined && Number.isFinite(Number(q.minutes))) return Math.round(Number(q.minutes) * 60_000);
  const t = q.time ?? q[field];
  if (t !== undefined) {
    const neg = String(t).trim().startsWith('-');
    const ms = core.parseDur(String(t));
    if (ms != null) return neg ? -ms : ms;
  }
  return null;
}
const needMs = (v) => {
  if (v == null) throw httpError(400, 'Zeitangabe fehlt: seconds=…, minutes=… oder time=mm:ss');
  return v;
};

function findCue(r, l, ref) {
  if (!ref) return null;
  const tl = core.computeTimeline(r, l, Date.now());
  return r.items.find((x) => x.kind === 'cue' && (x.id === ref || tl.cues[x.id]?.label === ref || String(tl.cues[x.id]?.num) === String(ref))) ?? null;
}

/**
 * Steueraktionen, gemeinsam für die Benutzer-API und die Token-API (Companion).
 * Liefert den neuen Live-Zustand oder wirft einen Fehler.
 */
function liveAction(r, l, action, q) {
  const now = Date.now();
  const running = l.status === 'running' || l.status === 'paused';
  const needRunning = () => {
    if (!running) throw httpError(409, 'Kein laufender Cue – Zeit kann nur während der Show geändert werden');
  };
  switch (action) {
    case 'start': {
      const c = findCue(r, l, q.item ?? q.itemId ?? q.cue);
      if (c) return core.goLive(l, c.id, now, true, r);
      return core.startOrResume(r, l, now);
    }
    case 'pause':
    case 'toggle':
    case 'next':
    case 'reset':
      return core.applyAction(r, l, action, now);
    case 'prev':
    case 'previous':
    case 'back':
      return core.applyAction(r, l, 'previous', now);
    case 'stop':
    case 'end':
      return core.applyAction(r, l, 'end', now);
    case 'goto': {
      const c = findCue(r, l, q.item ?? q.itemId ?? q.cue);
      if (!c) throw httpError(404, 'Cue nicht gefunden (item=<ID oder Nummer>)');
      return core.goLive(l, c.id, now, true, r);
    }
    case 'plus':
      needRunning();
      return core.adjust(l, Math.abs(readMs(q) ?? 60_000));
    case 'minus':
      needRunning();
      return core.adjust(l, -Math.abs(readMs(q) ?? 60_000));
    case 'add':
    case 'adjust':
      needRunning();
      return core.adjust(l, needMs(readMs(q)));
    case 'set':
    case 'setremaining':
    case 'setRemaining':
      needRunning();
      return core.setRemaining(r, l, needMs(readMs(q, q.remaining !== undefined ? 'remaining' : 'seconds')), now);
    case 'setduration':
    case 'setDuration':
      needRunning();
      return core.setDuration(r, l, needMs(readMs(q, q.duration !== undefined ? 'duration' : 'seconds')));
    case 'message':
      return {
        ...l,
        message: q.text ?? l.message,
        messageVisible: q.visible !== undefined ? q.visible === true || q.visible === 'true' || q.visible === '1' : !!(q.text ?? l.message),
        msgBold: q.bold !== undefined ? q.bold === true || q.bold === 'true' : l.msgBold,
        msgUnderline: q.underline !== undefined ? q.underline === true || q.underline === 'true' : l.msgUnderline,
        msgColor: q.color === 'red' ? 'red' : q.color === 'white' ? 'white' : l.msgColor,
        flash: q.flash !== undefined ? q.flash === true || q.flash === 'true' : l.flash,
      };
    default:
      return null;
  }
}

const ACTIONS = 'start, pause, toggle, next, prev, goto, stop, reset, plus, minus, add, set, setduration, message';

/* ---------- Token-API (Companion / Stream Deck / Overlays), kompatibel zu FF Rundown ---------- */
async function handleTokenApi(req, res, url, token, rest) {
  const entry = state.apiTokens[token];
  const rd = entry && loadRd(entry.rundownId);
  if (!rd) return json(res, 404, { error: 'Unbekannter oder gesperrter API-Token' });
  const { r, l } = rd;
  const q = { ...Object.fromEntries(url.searchParams), ...(req.method === 'POST' ? await readBody(req) : {}) };
  const action = rest[0] || 'status';
  const now = Date.now();
  if (action === 'status') return json(res, 200, core.flatStatus(r, l, now));
  if (action === 'cue' || action === 'now') return json(res, 200, core.nowSummary(r, l, now));
  if (action === 'rundown') return json(res, 200, core.rundownExport(r, l, now));
  if (action === 'text') {
    const s = core.flatStatus(r, l, now);
    if (!(rest[1] in s)) return json(res, 404, { error: 'Unbekanntes Feld. Verfügbar: ' + Object.keys(s).join(', ') });
    return text(res, 200, String(s[rest[1]] ?? ''));
  }
  if (action === 'events') return openSse(req, res, r.id);
  const nxt = liveAction(r, l, action, q);
  if (!nxt) return json(res, 404, { error: `Unbekannte Aktion. Erlaubt: ${ACTIONS} (lesen: status, cue, rundown, text/<feld>, events)` });
  setLive(r.id, nxt);
  return json(res, 200, summary(r.id));
}

function openSse(req, res, id) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...CORS });
  if (!sse.has(id)) sse.set(id, new Set());
  sse.get(id).add(res);
  res.write(`data: ${JSON.stringify(summary(id))}\n\n`);
  req.on('close', () => sse.get(id)?.delete(res));
}

/* ---------- Benutzer-API ---------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // nach "api"
  const method = req.method;
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (parts[0] === 'health') return json(res, 200, { ok: true, version: VERSION });
  if (parts[0] === 'v1' || parts[0] === 'companion') return handleTokenApi(req, res, url, parts[1], parts.slice(2));

  // Code einlösen ist öffentlich
  if (parts[0] === 'codes' && parts[1] && method === 'GET') {
    const c = codes.get(parts[1]);
    if (!c || c.expires < Date.now() || !state.shares[c.token]) return json(res, 404, { error: 'Code ungültig oder abgelaufen' });
    return json(res, 200, { token: c.token });
  }

  const user = currentUser(req, url);

  /* Anmeldung */
  if (parts[0] === 'auth') {
    if (parts[1] === 'status') return json(res, 200, { needsSetup: needsSetup(), user: userOut(user), version: VERSION, mode: userCount() ? 'login' : PASSWORD ? 'password' : 'setup' });
    if (parts[1] === 'setup' && method === 'POST') {
      if (!needsSetup()) throw httpError(400, 'Einrichtung bereits abgeschlossen');
      const { email, password, name } = await readBody(req);
      if (!EMAIL_RE.test(email || '')) throw httpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
      if (String(password || '').length < 8) throw httpError(400, 'Das Passwort braucht mindestens 8 Zeichen');
      const u = { id: randomToken(8), email: email.trim(), name: (name || '').trim(), hash: await hashPassword(password), role: 'admin', tokenVersion: 0, createdAt: Date.now(), lastLogin: Date.now() };
      state.users[u.id] = u;
      save();
      return json(res, 200, { token: sessionFor(u), user: userOut(u) });
    }
    if (parts[1] === 'login' && method === 'POST') {
      const ip = clientIp(req);
      checkRate(ip);
      const { email, password } = await readBody(req);
      const u = Object.values(state.users).find((x) => x.email.toLowerCase() === String(email || '').trim().toLowerCase());
      if (!u || !(await verifyPassword(String(password || ''), u.hash))) {
        noteFail(ip);
        throw httpError(401, 'E-Mail oder Passwort falsch');
      }
      attempts.delete(ip);
      u.lastLogin = Date.now();
      save();
      return json(res, 200, { token: sessionFor(u), user: userOut(u) });
    }
    if (parts[1] === 'password' && method === 'POST') {
      need(user, 'viewer');
      if (user.legacy) throw httpError(400, 'Der Admin-Passwort-Zugang hat kein eigenes Konto');
      const { current, next } = await readBody(req);
      if (!(await verifyPassword(String(current || ''), user.hash))) throw httpError(400, 'Das aktuelle Passwort stimmt nicht');
      if (String(next || '').length < 8) throw httpError(400, 'Das neue Passwort braucht mindestens 8 Zeichen');
      user.hash = await hashPassword(next);
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      save();
      kickUser(user.id);
      return json(res, 200, { token: sessionFor(user), user: userOut(user) });
    }
    throw httpError(404, 'Unbekannter Pfad');
  }

  /* Benutzerverwaltung (Admin) */
  if (parts[0] === 'users') {
    need(user, 'admin');
    const admins = () => Object.values(state.users).filter((u) => u.role === 'admin').length;
    if (!parts[1] && method === 'GET') return json(res, 200, Object.values(state.users).map(userOut).sort((a, b) => a.email.localeCompare(b.email)));
    if (!parts[1] && method === 'POST') {
      const { email, name, password, role } = await readBody(req);
      if (!EMAIL_RE.test(email || '')) throw httpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
      if (Object.values(state.users).some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) throw httpError(409, 'Diese E-Mail-Adresse ist schon vergeben');
      if (String(password || '').length < 8) throw httpError(400, 'Das Passwort braucht mindestens 8 Zeichen');
      const u = { id: randomToken(8), email: email.trim(), name: (name || '').trim(), hash: await hashPassword(password), role: ROLES.includes(role) ? role : 'viewer', tokenVersion: 0, createdAt: Date.now(), lastLogin: null };
      state.users[u.id] = u;
      save();
      return json(res, 201, userOut(u));
    }
    const u = state.users[parts[1]];
    if (!u) throw httpError(404, 'Benutzer nicht gefunden');
    if (method === 'PATCH') {
      const { name, role, password, email } = await readBody(req);
      if (role !== undefined) {
        if (!ROLES.includes(role)) throw httpError(400, 'Unbekannte Rolle');
        if (u.role === 'admin' && role !== 'admin' && admins() <= 1) throw httpError(400, 'Der letzte Admin kann nicht herabgestuft werden');
        if (u.role !== role) {
          u.role = role;
          u.tokenVersion = (u.tokenVersion ?? 0) + 1;
        }
      }
      if (name !== undefined) u.name = String(name).trim();
      if (email !== undefined) {
        if (!EMAIL_RE.test(email)) throw httpError(400, 'Bitte eine gültige E-Mail-Adresse angeben');
        u.email = email.trim();
      }
      if (password !== undefined) {
        if (String(password).length < 8) throw httpError(400, 'Das Passwort braucht mindestens 8 Zeichen');
        u.hash = await hashPassword(password);
        u.tokenVersion = (u.tokenVersion ?? 0) + 1;
      }
      save();
      kickUser(u.id);
      return json(res, 200, userOut(u));
    }
    if (method === 'DELETE') {
      if (u.role === 'admin' && admins() <= 1) throw httpError(400, 'Der letzte Admin kann nicht gelöscht werden');
      delete state.users[u.id];
      save();
      kickUser(u.id);
      return json(res, 200, { ok: true });
    }
  }

  need(user, 'viewer');

  if (parts[0] === 'codes' && method === 'POST') {
    need(user, 'editor');
    const { token } = await readBody(req);
    if (!state.shares[token]) throw httpError(404, 'Link nicht gefunden');
    let code;
    do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    while (codes.has(code) && codes.get(code).expires > Date.now());
    const expires = Date.now() + CODE_TTL;
    codes.set(code, { token, expires });
    return json(res, 200, { code, expires });
  }

  if (parts[0] === 'shares') {
    need(user, 'editor');
    if (method === 'GET') {
      const rid = url.searchParams.get('rundownId');
      return json(res, 200, Object.entries(state.shares).filter(([, s]) => !rid || s.rundownId === rid).map(([token, s]) => ({ token, ...s })));
    }
    if (method === 'POST') {
      const { rundownId, mode, columns } = await readBody(req);
      if (!state.rundowns[rundownId]) throw httpError(404, 'Ablauf nicht gefunden');
      const token = randomToken();
      state.shares[token] = { rundownId, mode: mode === 'edit' ? 'edit' : 'view', columns: mode === 'edit' ? null : Array.isArray(columns) ? columns : null, createdAt: Date.now() };
      save();
      return json(res, 201, { token, ...state.shares[token] });
    }
    if (method === 'DELETE' && parts[1]) {
      delete state.shares[parts[1]];
      for (const [k, v] of codes) if (v.token === parts[1]) codes.delete(k);
      for (const c of clients) if (c.share?.token === parts[1]) c.ws.close();
      save();
      return json(res, 200, { ok: true });
    }
  }

  if (parts[0] === 'rundowns') {
    if (!parts[1]) {
      return json(res, 200, Object.values(state.rundowns).map((r) => ({ id: r.id, title: r.title, date: r.date, status: state.live[r.id]?.status ?? 'idle', eventId: r.eventId ?? null, isTemplate: !!r.isTemplate })));
    }
    const id = parts[1];
    const rd = loadRd(id);
    if (!rd) throw httpError(404, 'Ablauf nicht gefunden');
    const { raw, r, l } = rd;
    const now = Date.now();
    const action = parts[2];

    if (!action && method === 'GET') return json(res, 200, { rundown: raw, live: state.live[id] ?? null, serverNow: now });
    if ((action === 'now' || action === 'cue') && method === 'GET') return json(res, 200, core.nowSummary(r, l, now));
    if (action === 'status' && method === 'GET') return json(res, 200, core.flatStatus(r, l, now));
    if (action === 'export' && method === 'GET') return json(res, 200, core.rundownExport(r, l, now));
    if (action === 'events' && method === 'GET') return openSse(req, res, id);

    if (action === 'apitoken') {
      need(user, 'editor');
      let token = Object.keys(state.apiTokens).find((t) => state.apiTokens[t].rundownId === id);
      if (method === 'POST' && parts[3] === 'regenerate') {
        const { confirm } = await readBody(req);
        if (confirm !== 'NEU') throw httpError(400, 'Zum Bestätigen „NEU“ eingeben');
        if (token) delete state.apiTokens[token];
        token = randomToken();
        state.apiTokens[token] = { rundownId: id, createdAt: now, rotatedAt: now, rotatedBy: user.name || user.email || 'Admin' };
        console.log(`[API] Token für „${r.title}“ neu erzeugt von ${user.email || user.name}`);
        save();
      } else if (!token) {
        token = randomToken();
        state.apiTokens[token] = { rundownId: id, createdAt: now, rotatedAt: null, rotatedBy: null };
        save();
      }
      return json(res, 200, { token, ...state.apiTokens[token] });
    }

    if (action === 'variables') {
      if (method === 'GET') return json(res, 200, raw.variables ?? {});
      if (method === 'PUT' || method === 'POST') {
        need(user, 'editor');
        const body = await readBody(req);
        const vars = { ...(raw.variables ?? {}) };
        for (const [k, v] of Object.entries(body)) if (/^[a-z0-9-]+$/.test(k)) v === null ? delete vars[k] : (vars[k] = String(v));
        const next = { ...raw, variables: vars, updatedAt: Date.now() };
        state.rundowns[id] = next;
        save();
        broadcast({ t: 'rundown', rundown: next });
        return json(res, 200, vars);
      }
    }
    if (method !== 'POST') throw httpError(405, 'Bitte POST verwenden');

    need(user, 'operator');
    const body = await readBody(req);
    const q = { ...Object.fromEntries(url.searchParams), ...body };
    let nxt = null;
    if (action === 'cue' && parts[3]) {
      const cue = findCue(r, l, parts[3]);
      if (!cue) throw httpError(404, 'Cue nicht gefunden');
      nxt = parts[4] === 'next' ? core.cueNext(l, cue.id) : core.goLive(l, cue.id, now, true, r);
    } else if (action === 'adjust' && body.ms !== undefined) {
      nxt = core.adjust(l, Number(body.ms) || 0);
    } else if (action === 'subtimers' && parts[3] && ['start', 'pause', 'reset'].includes(parts[4])) {
      const cue = r.items.find((x) => x.kind === 'cue' && x.subTimers.some((t) => t.id === parts[3]));
      if (!cue) throw httpError(404, 'Unter-Timer nicht gefunden');
      nxt = core.subControl(r, l, cue.id, parts[3], parts[4], now);
    } else nxt = liveAction(r, l, action, q);
    if (!nxt) throw httpError(404, 'Unbekannte Aktion');

    const saved = setLive(id, nxt);
    return json(res, 200, { ok: true, live: saved, now: summary(id) });
  }

  throw httpError(404, 'Unbekannter Pfad');
}

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => json(res, e.status || 500, { error: String(e?.message || e) }));
    return;
  }

  // Statische Dateien aus dist/ (SPA)
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('dist/ fehlt – bitte zuerst „npm run build“ ausführen.');
    }
    const name = path.basename(file);
    const noCache = name === 'index.html' || name === 'sw.js' || name.endsWith('.webmanifest');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(buf);
  });
}

const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

server.listen(PORT, HOST, () => {
  console.log(`\n  Taktgeber v${VERSION} läuft`);
  console.log(`  Lokal:     http://localhost:${PORT}`);
  for (const a of lanAddresses()) console.log(`  Netzwerk:  http://${a}:${PORT}`);
  console.log(`  Daten:     ${DATA}`);
  console.log('  Timer: /#timer · Prompter: /#prompter · Code: /#code');
  if (needsSetup()) console.log('\n  → Erster Start: Im Browser öffnen und Admin-Konto anlegen.');
  if (PASSWORD) console.log('  ADMIN_PASSWORD ist gesetzt: zusätzlicher Admin-Zugang per Passwort.');
  console.log('');
});
