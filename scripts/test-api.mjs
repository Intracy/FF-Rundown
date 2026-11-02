// Integrationstest für Server, WebSocket-Sync, Gast-Links, Codes und Steuer-API.
// Startet einen eigenen Server auf Port 8799 mit temporärem Datenordner.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;
const PW = 'test-passwort';
const base = `http://localhost:${PORT}`;
const data = mkdtempSync(path.join(tmpdir(), 'taktgeber-'));
let failed = 0;
const ok = (c, m) => {
  if (c) console.log('ok  ', m);
  else {
    failed++;
    console.error('FAIL', m);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: data, ADMIN_PASSWORD: PW }, stdio: 'pipe' });
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('läuft') && res()));

function client(hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d)));
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', ...hello }));
      setTimeout(() => resolve({ ws, msgs, send: (m) => ws.send(JSON.stringify(m)) }), 300);
    });
  });
}
const auth = { Authorization: `Bearer ${PW}`, 'Content-Type': 'application/json' };
const api = async (method, p, body, headers = auth) => {
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  // Anmeldung
  const anon = await client({});
  ok(anon.msgs.some((m) => m.t === 'auth-required'), 'WebSocket ohne Passwort wird abgewiesen');
  const wrong = await client({ auth: 'falsch' });
  ok(wrong.msgs.find((m) => m.t === 'auth-required')?.error === 'Falsches Passwort.', 'Falsches Passwort wird gemeldet');
  const a = await client({ auth: PW });
  ok(a.msgs.some((m) => m.t === 'init'), 'Regie mit Passwort bekommt init');
  ok((await api('GET', '/api/rundowns', null, {})).status === 401, 'API ohne Passwort: 401');

  // Ablauf anlegen
  const now = Date.now();
  const rundown = {
    id: 'rd1',
    title: 'API-Test',
    date: new Date().toISOString().slice(0, 10),
    start: 0,
    plannedEnd: null,
    warnAt: 60000,
    columns: [
      { id: 'pub', name: 'Öffentlich', type: 'text', width: 180, options: [] },
      { id: 'sec', name: 'Intern', type: 'text', width: 180, options: [] },
    ],
    items: [
      { kind: 'cue', id: 'c1', title: 'Eins', subtitle: '', duration: 1200, startMode: 'soft', hardStart: 0, autoStart: false, skip: false, color: '', cells: { pub: 'sichtbar', sec: 'geheim' }, script: '', subTimers: [{ id: 'st1', name: 'Q&A', mode: 'down', duration: 60000, atZero: 'stop', withCue: false, showOnOutput: true }] },
      { kind: 'cue', id: 'c2', title: 'Zwei', subtitle: '', duration: 600000, startMode: 'soft', hardStart: 0, autoStart: true, skip: false, color: '', cells: {}, script: '', subTimers: [] },
      { kind: 'cue', id: 'c3', title: 'Drei', subtitle: '', duration: 600000, startMode: 'soft', hardStart: 0, autoStart: false, skip: false, color: '', cells: {}, script: '', subTimers: [] },
    ],
    variables: { ort: 'Saal A' },
    createdAt: now,
    updatedAt: now,
  };
  const b = await client({ auth: PW });
  a.send({ t: 'rundown', rundown });
  await sleep(300);
  ok(b.msgs.some((m) => m.t === 'rundown' && m.rundown.id === 'rd1'), 'Änderung erreicht zweites Gerät');
  ok((await api('GET', '/api/rundowns')).body?.some((r) => r.id === 'rd1'), 'Ablauf über API gelistet');

  // Steuerung
  let res = await api('POST', '/api/rundowns/rd1/start');
  ok(res.body?.now?.status === 'running' && res.body.now.current?.id === 'c1', 'API start: Cue 1 läuft');
  await sleep(300);
  ok(b.msgs.some((m) => m.t === 'live' && m.live.currentId === 'c1'), 'Live-Zustand der API erreicht die Geräte');
  res = await api('POST', '/api/rundowns/rd1/subtimers/st1/start');
  ok(res.status === 200 && res.body.now.subTimers[0]?.running, 'Unter-Timer per API gestartet');
  await sleep(1500);
  res = await api('GET', '/api/rundowns/rd1/now');
  ok(res.body?.current?.id === 'c2', 'Server schaltet per Auto-Start auf Cue 2, auch ohne offenen Browser');
  res = await api('POST', '/api/rundowns/rd1/adjust', { ms: 60000 });
  ok(res.body.live.adjust === 60000, 'Zeitkorrektur +1 min');
  res = await api('POST', '/api/rundowns/rd1/pause');
  ok(res.body.now.status === 'paused', 'Pause');
  res = await api('POST', '/api/rundowns/rd1/toggle');
  ok(res.body.now.status === 'running', 'Fortsetzen über toggle');
  res = await api('POST', '/api/rundowns/rd1/cue/c3/next');
  ok(res.body.live.nextId === 'c3', 'Cue vormerken');
  res = await api('POST', '/api/rundowns/rd1/next');
  ok(res.body.now.current?.id === 'c3', 'Weiter zum vorgemerkten Cue');
  res = await api('POST', '/api/rundowns/rd1/cue/1/live');
  ok(res.body.now.current?.id === 'c1', 'Cue über die Nummer live schalten');
  res = await api('POST', '/api/rundowns/rd1/message', { text: 'Noch 1 Minute', color: 'red', bold: true });
  ok(res.body.now.message === 'Noch 1 Minute' && res.body.live.msgColor === 'red', 'Bühnennachricht gesetzt');
  res = await api('PUT', '/api/rundowns/rd1/variables', { ort: 'Saal B', neu: 'x', 'UNGÜLTIG': 'y' });
  ok(res.body.ort === 'Saal B' && res.body.neu === 'x' && !('UNGÜLTIG' in res.body), 'Variablen per API ändern');
  res = await api('POST', '/api/rundowns/rd1/end');
  ok(res.body.now.status === 'ended', 'Show beenden');
  res = await api('POST', '/api/rundowns/rd1/reset');
  ok(res.body.now.status === 'idle' && !Object.keys(res.body.live.subTimers).length, 'Reset');

  // SSE
  const ctl = new AbortController();
  const sseRes = await fetch(`${base}/api/rundowns/rd1/events`, { headers: auth, signal: ctl.signal });
  const reader = sseRes.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  ok(first.startsWith('data: ') && JSON.parse(first.slice(6)).rundown.id === 'rd1', 'Server-Sent Events liefern den Live-Status');
  ctl.abort();

  // Gast-Link „Nur ansehen“ mit Spaltenauswahl
  res = await api('POST', '/api/shares', { rundownId: 'rd1', mode: 'view', columns: ['pub'] });
  const token = res.body.token;
  ok(res.status === 201 && token, 'Gast-Link erstellt');
  const g = await client({ share: token });
  const init = g.msgs.find((m) => m.t === 'init');
  const gr = init?.state.rundowns.rd1;
  ok(init?.share?.mode === 'view' && Object.keys(init.state.rundowns).length === 1, 'Gast sieht nur den freigegebenen Ablauf');
  ok(gr.columns.length === 1 && gr.items[0].cells.sec === undefined && gr.items[0].cells.pub === 'sichtbar', 'Ausgeblendete Spalte erreicht den Gast nicht');
  g.send({ t: 'rundown', rundown: { ...rundown, title: 'gehackt', updatedAt: Date.now() + 1e6 } });
  await sleep(300);
  ok((await api('GET', '/api/rundowns/rd1')).body.rundown.title === 'API-Test', 'Gast „Nur ansehen“ kann nichts ändern');
  a.send({ t: 'rundown', rundown: { ...rundown, title: 'Neu', updatedAt: Date.now() + 5 } });
  await sleep(300);
  const gm = g.msgs.filter((m) => m.t === 'rundown').pop();
  ok(gm?.rundown.title === 'Neu' && gm.rundown.columns.length === 1, 'Gast erhält Änderungen, weiterhin gefiltert');

  // Bearbeiten-Link
  res = await api('POST', '/api/shares', { rundownId: 'rd1', mode: 'edit' });
  const e = await client({ share: res.body.token });
  e.send({ t: 'rundown', rundown: { ...rundown, title: 'Vom Gast', updatedAt: Date.now() + 10 } });
  await sleep(300);
  ok((await api('GET', '/api/rundowns/rd1')).body.rundown.title === 'Vom Gast', 'Gast mit Bearbeiten-Link darf ändern');
  e.send({ t: 'delete', id: 'rd1', at: Date.now() });
  await sleep(200);
  ok((await api('GET', '/api/rundowns/rd1')).status === 200, 'Gast darf den Ablauf nicht löschen');

  // Schnellzugriffscode
  res = await api('POST', '/api/codes', { token });
  ok(/^\d{6}$/.test(res.body.code), 'Sechsstelliger Code erzeugt');
  const red = await api('GET', `/api/codes/${res.body.code}`, null, {});
  ok(red.body?.token === token, 'Code ohne Passwort einlösbar');
  ok((await api('GET', '/api/codes/000000', null, {})).status === 404 || res.body.code === '000000', 'Falscher Code: 404');

  // Link deaktivieren
  await api('DELETE', `/api/shares/${token}`);
  const g2 = await client({ share: token });
  ok(g2.msgs.some((m) => m.t === 'auth-required'), 'Deaktivierter Link funktioniert nicht mehr');
  ok((await api('GET', `/api/codes/${res.body.code}`, null, {})).status === 404, 'Code eines deaktivierten Links ist ungültig');

  for (const c of [anon, wrong, a, b, g, e, g2]) c.ws.close();
} catch (err) {
  failed++;
  console.error(err);
} finally {
  srv.kill();
  rmSync(data, { recursive: true, force: true });
  console.log(failed ? `${failed} Test(s) fehlgeschlagen` : 'Alle API-Tests bestanden');
  process.exit(failed ? 1 : 0);
}
