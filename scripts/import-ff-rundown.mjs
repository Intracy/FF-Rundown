#!/usr/bin/env node
// Übernimmt Daten aus FF Rundown (v1.x, SQLite) in Taktgeber:
// Benutzer (Passwörter bleiben gültig), Abläufe, Spalten, Programmpunkte, Blöcke,
// öffentliche Links (als Gast-Links „Nur ansehen“) und Companion-Tokens (bestehende
// Companion-Knöpfe funktionieren weiter, nur Host und Port ändern sich).
//
// Aufruf:  node scripts/import-ff-rundown.mjs <pfad/zu/rundown.db> [DATA_DIR]
// Den Taktgeber-Server vorher stoppen. Vorhandene Taktgeber-Daten bleiben erhalten.
// Benötigt Node.js 22.13 oder neuer (eingebautes SQLite).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dbPath, dataArg] = process.argv.slice(2);
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('Aufruf: node scripts/import-ff-rundown.mjs <pfad/zu/rundown.db> [DATA_DIR]');
  process.exit(1);
}
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('Für den Import wird Node.js 22.13 oder neuer benötigt (node:sqlite).');
  process.exit(1);
}

const DATA = path.resolve(dataArg || process.env.DATA_DIR || 'data');
const FILE = path.join(DATA, 'state.json');
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql, ...a) => db.prepare(sql).all(...a);
const has = (table, col) => all(`PRAGMA table_info(${table})`).some((c) => c.name === col);

let state = { rundowns: {}, events: {}, live: {}, deleted: {}, shares: {}, users: {}, apiTokens: {} };
if (fs.existsSync(FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
const uid = () => crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').toLowerCase().slice(0, 8);
const ts = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + 'Z') || Date.now() : Date.now());

/* Benutzer */
let users = 0;
const ROLES = new Set(['viewer', 'operator', 'editor', 'admin']);
for (const u of all('SELECT * FROM users')) {
  if (Object.values(state.users).some((x) => x.email.toLowerCase() === String(u.email).toLowerCase())) continue;
  const id = uid();
  state.users[id] = { id, email: u.email, name: u.name || '', hash: u.password_hash, role: ROLES.has(u.role) ? u.role : 'viewer', tokenVersion: 0, createdAt: ts(u.created_at), lastLogin: u.last_login ? ts(u.last_login) : null };
  users++;
}

/* Abläufe */
const toMs = (hhmm) => {
  const [h, m, s] = String(hhmm || '10:00').split(':').map((x) => parseInt(x, 10) || 0);
  return ((h * 60 + m) * 60 + (s || 0)) * 1000;
};
let rundowns = 0;
let items = 0;
const rotatedCols = has('rundowns', 'companion_rotated_at');
for (const r of all('SELECT * FROM rundowns ORDER BY id')) {
  const id = uid();
  const colMap = new Map();
  const cols = all('SELECT * FROM columns WHERE rundown_id=? ORDER BY position, id', r.id).map((c) => {
    const cid = uid();
    colMap.set(String(c.id), cid);
    return { id: cid, name: c.name, type: 'text', width: 180, options: [], _public: !!c.is_public };
  });
  const list = [];
  for (const it of all('SELECT * FROM items WHERE rundown_id=? ORDER BY position, id', r.id)) {
    const color = /^#[0-9a-f]{6}$/i.test(it.color || '') ? it.color : undefined;
    if (it.type === 'block' || it.type === 'block_end') {
      list.push({ kind: 'heading', id: uid(), title: it.title || (it.type === 'block_end' ? 'Ende' : 'Block'), color: '', customColor: color, end: it.type === 'block_end' || undefined });
      continue;
    }
    let cells = {};
    try {
      cells = JSON.parse(it.cells || '{}');
    } catch {
      /* leer */
    }
    const mapped = {};
    for (const [k, v] of Object.entries(cells)) if (colMap.has(String(k)) && v != null && v !== '') mapped[colMap.get(String(k))] = String(v);
    list.push({
      kind: 'cue', id: uid(), title: it.title || '', subtitle: it.description || '', duration: Math.max(0, Number(it.duration) || 0) * 1000,
      startMode: 'soft', hardStart: 0, autoStart: false, skip: false, color: '', customColor: color, cells: mapped, script: '', subTimers: [],
    });
    items++;
  }
  const now = Date.now();
  state.rundowns[id] = {
    id, title: r.title, date: r.event_date || new Date().toISOString().slice(0, 10), start: toMs(r.start_time), plannedEnd: null, warnAt: 60_000,
    columns: cols.map(({ _public, ...c }) => c), items: list, settings: { timezone: process.env.TZ || 'Europe/Berlin', clock: '24', highlight: 'red', numPrefix: '', numStart: 1, numDigits: 1, logo: '' },
    prompterSource: 'script', palette: {}, variables: {}, mentions: {}, trash: [], cellLog: [], eventId: null, isTemplate: false, status: 'draft',
    createdAt: ts(r.created_at), updatedAt: now,
  };
  if (r.public_enabled && r.public_token) state.shares[r.public_token] = { rundownId: id, mode: 'view', columns: cols.filter((c) => c._public).map((c) => c.id), createdAt: now };
  if (r.companion_token) state.apiTokens[r.companion_token] = { rundownId: id, createdAt: now, rotatedAt: rotatedCols && r.companion_rotated_at ? ts(r.companion_rotated_at) : null, rotatedBy: (rotatedCols && r.companion_rotated_by) || null };
  rundowns++;
}

fs.mkdirSync(DATA, { recursive: true });
if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.vor-import');
fs.writeFileSync(FILE, JSON.stringify(state));
console.log(`Importiert: ${users} Benutzer, ${rundowns} Abläufe mit ${items} Cues → ${FILE}`);
console.log('Companion: Base-URL von http://<server>:3000/api/v1/<TOKEN> auf http://<server>:8787/api/v1/<TOKEN> ändern (Token bleibt gleich).');
console.log('Öffentliche Links: alte /public/…-Adressen gibt es nicht mehr, die Gast-Links stehen im Ablauf unter „Gäste einladen“.');
