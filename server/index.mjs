// Taktgeber-Server: liefert die gebaute App aus, synchronisiert alle Geräte per WebSocket,
// verwaltet Gast-Links und bietet eine HTTP-API zur Steuerung (Stream Deck / Companion / Grafik).
//
// Start: npm start   (baut zuerst, dann http://<host>:8787)
// Umgebungsvariablen:
//   PORT            (8787)
//   DATA_DIR        (./data)
//   ADMIN_PASSWORD  optional: schützt Regie-Zugang und API. Gast-Links funktionieren ohne Passwort.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as core from './core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(here, '../dist');
const DATA = path.resolve(process.env.DATA_DIR || path.join(here, '../data'));
const FILE = path.join(DATA, 'state.json');
const PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ---------- Zustand ---------- */
let state = { rundowns: {}, events: {}, live: {}, deleted: {}, shares: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  console.log(`Geladen: ${Object.keys(state.rundowns).length} Abläufe aus ${FILE}`);
} catch {
  console.log(`Neuer Datenspeicher: ${FILE}`);
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(state));
    fs.renameSync(FILE + '.tmp', FILE);
  }, 300);
}

/** Schnellzugriffscodes (nur im Speicher, 10 Minuten gültig) */
const codes = new Map();
const CODE_TTL = 10 * 60_000;

const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

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

function applyWrite(m, client) {
  if (client.share?.mode === 'view') return false;
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
    state.deleted[m.id] = m.at ?? Date.now();
    return true;
  }
  return false;
}

wss.on('connection', (ws) => {
  const client = { ws, ready: false, share: null };
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
      if (m.share && !sh) return send(ws, { t: 'auth-required', error: 'Dieser Gast-Link ist nicht mehr gültig.' });
      if (sh) client.share = { token: m.share, ...sh };
      else if (PASSWORD && !safeEq(m.auth || '', PASSWORD)) return send(ws, { t: 'auth-required', error: m.auth ? 'Falsches Passwort.' : '' });
      client.ready = true;
      send(ws, {
        t: 'init',
        state: initFor(client),
        now: Date.now(),
        peers: [...clients].filter((c) => c.ready).length,
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
    if (l.status === 'idle' && !core.playable(core.normalizeRundown(r)).some((c) => c.startMode === 'hard' && c.autoStart)) continue;
    const nxt = core.autoTick(core.normalizeRundown(r), l, now);
    if (nxt) setLive(id, nxt);
  }
}, 250);

/* ---------- Kompakter Live-Status für Overlays ---------- */
function nowSummary(id) {
  const r = core.normalizeRundown(state.rundowns[id]);
  const l = core.normalizeLive(state.live[id]);
  const now = Date.now();
  const tl = core.computeTimeline(r, l, now);
  const cueInfo = (c) => (c ? { id: c.id, label: tl.cues[c.id]?.label, title: c.title, subtitle: c.subtitle, duration: c.duration } : null);
  return {
    rundown: { id: r.id, title: r.title },
    status: l.status,
    serverNow: now,
    current: tl.current ? { ...cueInfo(tl.current.cue), elapsed: tl.current.elapsed, remaining: tl.current.remaining, over: tl.current.remaining < 0, progress: tl.current.progress } : null,
    next: cueInfo(tl.next),
    calculatedEnd: tl.calcEnd,
    plannedEnd: tl.targetEnd,
    overUnder: tl.overUnder,
    message: l.messageVisible ? l.message : '',
    subTimers: tl.current
      ? tl.current.cue.subTimers.map((t) => {
          const v = core.subElapsed(t, tl.current.cue, l, now);
          const d = core.subDisplay(t, v.elapsed);
          return { id: t.id, name: t.name, running: v.running, value: d.value, state: d.state };
        })
      : [],
  };
}

const sse = new Map();
function pushSse(id) {
  const set = sse.get(id);
  if (!set?.size || !state.rundowns[id]) return;
  const data = `data: ${JSON.stringify(nowSummary(id))}\n\n`;
  for (const res of set) res.write(data);
}
setInterval(() => {
  for (const id of sse.keys()) pushSse(id);
}, 1000);

/* ---------- HTTP ---------- */
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

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' });
  res.end(JSON.stringify(body));
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

function authed(req, url) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  return safeEq(token, PASSWORD) || safeEq(url.searchParams.get('key') || '', PASSWORD);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // nach "api"
  const method = req.method;
  if (method === 'OPTIONS') return json(res, 204, {});

  // Code einlösen ist öffentlich
  if (parts[0] === 'codes' && parts[1] && method === 'GET') {
    const c = codes.get(parts[1]);
    if (!c || c.expires < Date.now() || !state.shares[c.token]) return json(res, 404, { error: 'Code ungültig oder abgelaufen' });
    return json(res, 200, { token: c.token });
  }

  if (!authed(req, url)) return json(res, 401, { error: 'Passwort erforderlich (Authorization: Bearer …)' });

  if (parts[0] === 'codes' && method === 'POST') {
    const { token } = await readBody(req);
    if (!state.shares[token]) return json(res, 404, { error: 'Link nicht gefunden' });
    let code;
    do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    while (codes.has(code) && codes.get(code).expires > Date.now());
    const expires = Date.now() + CODE_TTL;
    codes.set(code, { token, expires });
    return json(res, 200, { code, expires });
  }

  if (parts[0] === 'shares') {
    if (method === 'GET') {
      const rid = url.searchParams.get('rundownId');
      return json(res, 200, Object.entries(state.shares).filter(([, s]) => !rid || s.rundownId === rid).map(([token, s]) => ({ token, ...s })));
    }
    if (method === 'POST') {
      const { rundownId, mode, columns } = await readBody(req);
      if (!state.rundowns[rundownId]) return json(res, 404, { error: 'Ablauf nicht gefunden' });
      const token = crypto.randomBytes(18).toString('base64url');
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
    const raw = state.rundowns[id];
    if (!raw) return json(res, 404, { error: 'Ablauf nicht gefunden' });
    const r = core.normalizeRundown(raw);
    const l = core.normalizeLive(state.live[id]);
    const now = Date.now();
    const action = parts[2];

    if (!action && method === 'GET') return json(res, 200, { rundown: raw, live: state.live[id] ?? null, serverNow: now });
    if (action === 'now' && method === 'GET') return json(res, 200, nowSummary(id));
    if (action === 'events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      if (!sse.has(id)) sse.set(id, new Set());
      sse.get(id).add(res);
      res.write(`data: ${JSON.stringify(nowSummary(id))}\n\n`);
      req.on('close', () => sse.get(id)?.delete(res));
      return;
    }
    if (action === 'variables') {
      if (method === 'GET') return json(res, 200, raw.variables ?? {});
      if (method === 'PUT' || method === 'POST') {
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
    if (method !== 'POST') return json(res, 405, { error: 'Bitte POST verwenden' });

    const body = await readBody(req);
    let nxt = null;
    if (['start', 'pause', 'toggle', 'next', 'previous', 'end', 'reset'].includes(action)) nxt = core.applyAction(r, l, action, now);
    else if (action === 'adjust') {
      const ms = Number(body.ms ?? url.searchParams.get('ms') ?? 60000);
      nxt = core.adjust(l, ms);
    } else if (action === 'cue' && parts[3]) {
      const cue = r.items.find((x) => x.id === parts[3] || (x.kind === 'cue' && core.computeTimeline(r, l, now).cues[x.id]?.label === parts[3]));
      if (!cue || cue.kind !== 'cue') return json(res, 404, { error: 'Cue nicht gefunden' });
      nxt = parts[4] === 'next' ? core.cueNext(l, cue.id) : core.goLive(l, cue.id, now, true, r);
    } else if (action === 'message') {
      nxt = {
        ...l,
        message: body.text ?? l.message,
        messageVisible: body.visible ?? !!(body.text ?? l.message),
        msgBold: body.bold ?? l.msgBold,
        msgUnderline: body.underline ?? l.msgUnderline,
        msgColor: body.color === 'red' ? 'red' : body.color === 'white' ? 'white' : l.msgColor,
        flash: body.flash ?? l.flash,
      };
    } else if (action === 'subtimers' && parts[3] && ['start', 'pause', 'reset'].includes(parts[4])) {
      const cue = r.items.find((x) => x.kind === 'cue' && x.subTimers.some((t) => t.id === parts[3]));
      if (!cue) return json(res, 404, { error: 'Unter-Timer nicht gefunden' });
      nxt = core.subControl(r, l, cue.id, parts[3], parts[4], now);
    } else return json(res, 404, { error: 'Unbekannte Aktion' });

    const saved = setLive(id, nxt);
    return json(res, 200, { ok: true, live: saved, now: nowSummary(id) });
  }

  return json(res, 404, { error: 'Unbekannter Pfad' });
}

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => json(res, 500, { error: String(e?.message || e) }));
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(buf);
  });
}

server.listen(PORT, () => {
  console.log(`Taktgeber läuft auf http://localhost:${PORT}  (Timer: /#timer, Prompter: /#prompter, Code: /#code)`);
  if (PASSWORD) console.log('Regie-Zugang und API sind mit ADMIN_PASSWORD geschützt.');
});
