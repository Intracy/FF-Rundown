// Ende-zu-Ende-Tests: Schnittstelle für die Terminplanung (FF-Planner) und Ziel nach der Portal-Anmeldung
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'k'.repeat(48);
const API = 'p'.repeat(40);
const PW = 'Sehr-sicheres-Passwort-1';
const procs = [];
after(() => { for (const p of procs) p.kill(); });

async function startServer(env = {}) {
  const port = 5600 + Math.floor(Math.random() * 3000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ffr-test-'));
  const p = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, PORTAL_URL: 'https://portal.example.de', PORTAL_SSO_SECRET: SECRET, PLANNER_API_SECRET: '', ...env }, stdio: 'ignore' });
  procs.push(p);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return base; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
}

function ticket(over = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, iss: 'ff-broadcast-portal', aud: 'rundown', sub: '42', email: 'lena@example.de', name: 'Lena', role: 'editor', kind: 'member', iat, exp: iat + 60, jti: crypto.randomBytes(8).toString('hex'), ...over })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
const sig = (secret = API, ts = Math.floor(Date.now() / 1000)) => `Planner ${ts}.${crypto.createHmac('sha256', secret).update(`rundown-api:${ts}`).digest('base64url')}`;
async function ext(base, method, url, body, auth = sig()) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function portalLogin(base, over, next) {
  const r = await fetch(base + '/auth/portal?ticket=' + encodeURIComponent(ticket(over)) + (next ? '&next=' + encodeURIComponent(next) : ''), { redirect: 'manual' });
  return { location: r.headers.get('location'), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('Ohne PLANNER_API_SECRET ist die Schnittstelle aus', async () => {
  const base = await startServer();
  assert.equal((await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de')).status, 404);
});

test('Nach der Portal-Anmeldung geht es zum gewünschten Rundown, fremde Ziele werden verworfen', async () => {
  const base = await startServer();
  assert.equal((await portalLogin(base, {}, '/#/rundown/7')).location, '/#/rundown/7');
  assert.equal((await portalLogin(base, {}, '//boese.de')).location, '/#/rundowns');
  assert.equal((await portalLogin(base, {}, 'https://boese.de')).location, '/#/rundowns');
  assert.equal((await portalLogin(base)).location, '/#/rundowns');
});

test('Terminplanung: Rundowns auflisten und anlegen – nur mit Unterschrift und mit den Rechten der Person', async () => {
  const base = await startServer({ PLANNER_API_SECRET: API });
  // ohne/falsche/alte Unterschrift
  assert.equal((await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de', null, null)).status, 401);
  assert.equal((await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de', null, sig('f'.repeat(40)))).status, 401);
  assert.equal((await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de', null, sig(API, Math.floor(Date.now() / 1000) - 600))).status, 401);

  // Person kennt FF Rundown noch nicht
  let r = await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { user: { found: false, can_create: false }, rundowns: [] });
  assert.equal((await ext(base, 'POST', '/api/ext/rundowns', { email: 'lena@example.de', title: 'X' })).status, 404);

  // Editor öffnet einmal über das Portal → darf anlegen
  await portalLogin(base);
  r = await ext(base, 'GET', '/api/ext/rundowns?email=LENA@example.de');
  assert.equal(r.data.user.can_create, true);
  assert.equal((await ext(base, 'POST', '/api/ext/rundowns', { email: 'lena@example.de', title: '' })).status, 400);
  const c = await ext(base, 'POST', '/api/ext/rundowns', { email: 'lena@example.de', title: 'Finale 2026', event_date: '2026-12-05', start_time: '18:00' });
  assert.equal(c.status, 200);
  assert.equal(c.data.title, 'Finale 2026');
  assert.equal(c.data.path, `/#/rundown/${c.data.id}`);
  assert.equal(c.data.my_role, 'editor');
  r = await ext(base, 'GET', '/api/ext/rundowns?email=lena@example.de');
  assert.deepEqual(r.data.rundowns.map((x) => x.title), ['Finale 2026']);

  // Gast (extern) sieht ihn nicht und darf nicht anlegen
  await portalLogin(base, { sub: '77', email: 'gast@extern.de', role: 'viewer', kind: 'guest' });
  r = await ext(base, 'GET', '/api/ext/rundowns?email=gast@extern.de');
  assert.equal(r.data.user.can_create, false);
  assert.deepEqual(r.data.rundowns, []);
  assert.equal((await ext(base, 'POST', '/api/ext/rundowns', { email: 'gast@extern.de', title: 'Nein' })).status, 403);
  const one = await ext(base, 'GET', `/api/ext/rundowns/${c.data.id}?email=gast@extern.de`);
  assert.deepEqual(one.data, { exists: true, id: c.data.id, my_role: null });
  assert.equal((await ext(base, 'GET', `/api/ext/rundowns/${c.data.id}?email=lena@example.de`)).data.title, 'Finale 2026');
  assert.equal((await ext(base, 'GET', '/api/ext/rundowns/9999?email=lena@example.de')).status, 404);
});
