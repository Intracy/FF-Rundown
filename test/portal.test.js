// Ende-zu-Ende-Tests: FF Rundown allein und mit dem Portal „FrankenFinals Broadcast“ (Single Sign-on)
// Start: npm test
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
const PW = 'Sehr-sicheres-Passwort-1';
const procs = [];
after(() => { for (const p of procs) p.kill(); });

async function startServer(env = {}) {
  const port = 5600 + Math.floor(Math.random() * 3000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ffr-test-'));
  const p = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, PORTAL_URL: '', PORTAL_SSO_SECRET: '', ...env }, stdio: 'ignore' });
  procs.push(p);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return base; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
}

function client(base) {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: r.status, data, text, location: r.headers.get('location'), cookie: sc };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), patch: (u, b = {}) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
}

/** Eintrittskarte wie das Portal sie ausstellt (server/sso.js im Portal-Repo) */
function ticket(over = {}, secret = SECRET) {
  const iat = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, iss: 'ff-broadcast-portal', aud: 'rundown', sub: '42', email: 'lena@example.de', name: 'Lena Kamera', role: 'editor', kind: 'member', iat, exp: iat + 60, jti: crypto.randomBytes(8).toString('hex'), ...over })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

test('Allein betrieben: alles wie bisher, keine Portal-Anmeldung', async () => {
  const base = await startServer();
  const a = client(base);
  assert.equal((await a.get('/api/auth/status')).data.portal, null);
  assert.equal((await a.post('/api/auth/setup', { email: 'chef@example.de', name: 'Chef', password: PW })).status, 200);
  assert.equal((await a.post('/api/users', { email: 'max@example.de', role: 'editor', password: PW })).status, 200);
  const m = client(base);
  assert.equal((await m.post('/api/auth/login', { email: 'max@example.de', password: PW })).status, 200);
  const r = await client(base).get('/auth/portal?ticket=' + ticket());
  assert.equal(r.status, 503);
});

test('Mit Portal: Konto wird angelegt bzw. verknüpft, Rolle und „extern“ kommen aus dem Portal', async () => {
  const base = await startServer({ PORTAL_URL: 'broadcast.example.de/', PORTAL_SSO_SECRET: SECRET });
  const owner = client(base);
  const st = (await owner.get('/api/auth/status')).data;
  assert.deepEqual(st.portal, { url: 'https://broadcast.example.de', login: 'https://broadcast.example.de/sso/rundown' });
  // Lokaler Super-Admin (Notfall-Zugang) – vor der Verbindung angelegt, ebenso ein bestehender Benutzer
  await owner.post('/api/auth/setup', { email: 'chef@example.de', name: 'Chef', password: PW });
  assert.equal((await owner.post('/api/users', { email: 'x@example.de', role: 'viewer', password: PW })).status, 400); // Benutzer nur im Portal

  // Erste Anmeldung über die Kachel → Konto entsteht
  const lena = client(base);
  const t1 = ticket();
  const r1 = await lena.get('/auth/portal?ticket=' + t1);
  assert.equal(r1.status, 302);
  assert.equal(r1.location, '/#/rundowns');
  assert.match(r1.cookie, /Max-Age=43200/); // 12 Stunden
  let me = (await lena.get('/api/auth/status')).data.user;
  assert.equal(me.email, 'lena@example.de');
  assert.equal(me.role, 'editor');
  assert.equal(me.portal, true);
  assert.equal((await lena.post('/api/rundowns', { title: 'Show' })).status, 200);

  // Dieselbe Karte nochmal → abgelehnt; falsche/abgelaufene/fremde Karten → abgelehnt
  assert.equal((await client(base).get('/auth/portal?ticket=' + t1)).status, 401);
  const past = Math.floor(Date.now() / 1000) - 120;
  for (const bad of [ticket({}, 'z'.repeat(48)), ticket({ iat: past, exp: past + 60 }), ticket({ aud: 'overlay' }), 'kaputt']) {
    assert.equal((await client(base).get('/auth/portal?ticket=' + encodeURIComponent(bad))).status, 401);
  }
  assert.equal((await client(base).get('/auth/portal?ticket=' + ticket({ role: 'chef' }))).status, 403);

  // Rolle im Portal geändert → beim nächsten Öffnen übernommen, alte Sitzung abgemeldet
  const lena2 = client(base);
  await lena2.get('/auth/portal?ticket=' + ticket({ role: 'viewer', name: 'Lena K.' }));
  me = (await lena2.get('/api/auth/status')).data.user;
  assert.equal(me.role, 'viewer');
  assert.equal(me.name, 'Lena K.');
  assert.equal((await lena.get('/api/rundowns')).status, 401);
  assert.equal((await lena2.post('/api/rundowns', { title: 'Nein' })).status, 403);

  // Gast aus dem Portal → „extern“: sieht nur, was ein Rundown-Admin freigibt
  const gast = client(base);
  await gast.get('/auth/portal?ticket=' + ticket({ sub: '77', email: 'gast@extern.de', name: 'Gast', role: 'viewer', kind: 'guest' }));
  const g = (await gast.get('/api/auth/status')).data.user;
  assert.equal(g.restricted, true);
  assert.deepEqual((await gast.get('/api/rundowns')).data.rundowns ?? (await gast.get('/api/rundowns')).data, []);
  const rid = (await owner.get('/api/rundowns')).data.rundowns?.[0]?.id ?? (await owner.get('/api/rundowns')).data[0].id;
  assert.equal((await owner.put(`/api/rundowns/${rid}/access/${g.id}`, { role: 'viewer' })).status, 200);
  const list = (await gast.get('/api/rundowns')).data;
  assert.equal((list.rundowns ?? list).length, 1);

  // Benutzer werden im Portal verwaltet: Rolle/Reset hier gesperrt, Löschen geht
  assert.equal((await owner.patch(`/api/users/${g.id}`, { role: 'admin' })).status, 400);
  assert.equal((await owner.post(`/api/users/${g.id}/reset-link`, {})).status, 400);

  // Passwort-Login: nur noch der Super-Admin (Notfall-Zugang)
  assert.equal((await client(base).post('/api/auth/login', { email: 'chef@example.de', password: PW })).status, 200);
});

test('Bestehendes Konto wird beim Wechsel auf das Portal über die E-Mail verknüpft (Freigaben bleiben)', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ffr-test-'));
  // 1) allein: Konto „max“ mit Freigabe anlegen
  let base = await startServer({ DATA_DIR: data });
  const owner = client(base);
  await owner.post('/api/auth/setup', { email: 'chef@example.de', password: PW });
  const max = (await owner.post('/api/users', { email: 'Max@Example.de', name: 'Max', role: 'viewer', password: PW, restricted: true })).data;
  const rid = (await owner.post('/api/rundowns', { title: 'Finale' })).data.id ?? (await owner.get('/api/rundowns')).data[0]?.id;
  await owner.put(`/api/rundowns/${rid}/access/${max.id}`, { role: 'operator' });
  const old = client(base);
  await old.post('/api/auth/login', { email: 'max@example.de', password: PW });
  assert.equal((await old.get('/api/auth/status')).data.user.email, 'Max@Example.de');
  procs.pop().kill();
  await new Promise((r) => setTimeout(r, 300));

  // 2) mit Portal: alte Passwort-Sitzung gilt nicht mehr, Anmeldung über die Kachel verknüpft dasselbe Konto
  base = await startServer({ DATA_DIR: data, PORTAL_URL: 'https://portal.example.de', PORTAL_SSO_SECRET: SECRET });
  const oldAgain = client(base);
  assert.equal((await oldAgain.post('/api/auth/login', { email: 'max@example.de', password: PW })).status, 403);
  const viaPortal = client(base);
  await viaPortal.get('/auth/portal?ticket=' + ticket({ sub: '9', email: 'max@example.de', name: 'Max', role: 'viewer', kind: 'guest' }));
  const me = (await viaPortal.get('/api/auth/status')).data.user;
  assert.equal(me.id, max.id);
  const list = (await viaPortal.get('/api/rundowns')).data;
  assert.equal((list.rundowns ?? list).length, 1);
});
