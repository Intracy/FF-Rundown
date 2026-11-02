// Taktgeber-Server: liefert die gebaute App aus und synchronisiert alle Geräte per WebSocket.
// Start: npm start   (baut zuerst, dann http://<host>:8787)
// Umgebungsvariablen: PORT (8787), DATA_DIR (./data)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(here, '../dist');
const DATA = path.resolve(process.env.DATA_DIR || path.join(here, '../data'));
const FILE = path.join(DATA, 'state.json');

let state = { rundowns: {}, live: {}, deleted: {} };
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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // Lese-API für Grafik-/Overlay-Systeme (z. B. CasparCG, OBS-Browserquelle, Companion)
  if (url.pathname === '/api/rundowns') {
    return json(res, 200, Object.values(state.rundowns).map((r) => ({ id: r.id, title: r.title, date: r.date, status: state.live[r.id]?.status ?? 'idle' })));
  }
  const m = url.pathname.match(/^\/api\/rundowns\/([\w-]+)$/);
  if (m) {
    const r = state.rundowns[m[1]];
    return r ? json(res, 200, { rundown: r, live: state.live[r.id] ?? null, serverNow: Date.now() }) : json(res, 404, { error: 'Ablauf nicht gefunden' });
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
});

const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === 1) c.send(data);
}
const peers = () => broadcast({ t: 'peers', peers: wss.clients.size });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ t: 'init', state, now: Date.now(), peers: wss.clients.size }));
  peers();

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', c: m.c, s: Date.now() }));

    if (m.t === 'rundown' && m.rundown?.id) {
      const id = m.rundown.id;
      if (state.deleted[id]) return;
      const cur = state.rundowns[id];
      if (cur && (m.rundown.updatedAt ?? 0) < (cur.updatedAt ?? 0)) return;
      state.rundowns[id] = m.rundown;
      save();
      return broadcast(m, ws);
    }
    if (m.t === 'live' && m.id && m.live) {
      const cur = state.live[m.id];
      if (cur && (m.live.updatedAt ?? 0) < (cur.updatedAt ?? 0)) return;
      state.live[m.id] = m.live;
      save();
      return broadcast(m, ws);
    }
    if (m.t === 'delete' && m.id) {
      delete state.rundowns[m.id];
      delete state.live[m.id];
      state.deleted[m.id] = m.at ?? Date.now();
      save();
      return broadcast(m, ws);
    }
  });

  ws.on('close', peers);
});

server.listen(PORT, () => {
  console.log(`Taktgeber läuft auf http://localhost:${PORT}  (Timer: /#timer, Prompter: /#prompter)`);
});
