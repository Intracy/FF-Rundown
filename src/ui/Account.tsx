import React, { useEffect, useMemo, useState } from 'react';
import { Rundown, isCue } from '../types';
import { AppState, store } from '../store';
import { Role, sync } from '../sync';
import { playable } from '../live';
import { Timeline } from '../timing';
import { qrPng, qrSvg } from '../qr.js';
import { Icon, copyText } from './common';
import { Modal } from './Dialogs';

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Editor', operator: 'Operator', viewer: 'Viewer' };
const ROLE_HINT: Record<Role, string> = {
  admin: 'alles, inkl. Benutzerverwaltung',
  editor: 'Abläufe anlegen und bearbeiten, Gäste einladen, API',
  operator: 'ansehen und Show steuern',
  viewer: 'nur ansehen',
};

/* ---------- Anmeldung / Einrichtung ---------- */
export function AuthScreen({ app }: { app: AppState }) {
  const mode = app.authMode;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';
  const legacy = mode === 'password';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (legacy) store.login(pw);
    else await store.signIn(setup ? 'setup' : 'login', { email, password: pw, name });
    setBusy(false);
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>{setup ? 'Taktgeber einrichten' : 'Anmelden'}</h1>
        <p className="hint">
          {setup
            ? 'Lege das erste Konto an. Es bekommt Admin-Rechte und kann danach weitere Personen einladen.'
            : legacy
              ? 'Dieser Server ist mit einem Admin-Passwort geschützt (ADMIN_PASSWORD).'
              : 'Melde dich mit deiner E-Mail-Adresse an.'}
        </p>
        {setup && (
          <>
            <label className="eyebrow" htmlFor="login-name">
              Name
            </label>
            <input id="login-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </>
        )}
        {!legacy && (
          <>
            <label className="eyebrow" htmlFor="login-email">
              E-Mail
            </label>
            <input spellCheck={false} id="login-email" type="email" className="text-input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </>
        )}
        <label className="eyebrow" htmlFor="login-pw">
          Passwort{setup ? ' (mind. 8 Zeichen)' : ''}
        </label>
        <input id="login-pw" type="password" className="text-input" autoFocus={legacy} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={setup ? 'new-password' : 'current-password'} />
        {app.authError && <span className="error">{app.authError}</span>}
        <button className="btn primary" disabled={busy || !pw || (!legacy && !email)}>
          {setup ? 'Admin-Konto anlegen' : 'Anmelden'}
        </button>
        {!setup && (
          <a className="link-btn" href="#code">
            Ich habe einen Zugangscode
          </a>
        )}
      </form>
    </div>
  );
}

/* ---------- Benutzermenü ---------- */
export function UserMenu({ app, close, openUsers, openPassword }: { app: AppState; close: () => void; openUsers: () => void; openPassword: () => void }) {
  const u = app.user;
  return (
    <div className="menu-body">
      <div className="user-head">
        <span className="avatar" aria-hidden="true">
          {initials(u?.name || u?.email || 'A')}
        </span>
        <span className="user-id">
          <b>{u?.name || u?.email || 'Admin'}</b>
          <span className="hint small">
            {ROLE_LABEL[app.role]}
            {sync.version ? ` · v${sync.version}` : ''}
          </span>
        </span>
      </div>
      <div className="menu-list">
        {app.role === 'admin' && !u?.legacy && sync.serverCapable && (
          <button onClick={() => (openUsers(), close())}>
            <Icon name="list" size={14} /> Benutzer verwalten
          </button>
        )}
        {u && !u.legacy && (
          <button onClick={() => (openPassword(), close())}>
            <Icon name="lock" size={14} /> Passwort ändern
          </button>
        )}
        {sync.serverCapable && (
          <button onClick={() => (store.signOut(), close())}>
            <Icon name="left" size={14} /> Abmelden
          </button>
        )}
      </div>
    </div>
  );
}

export const initials = (s: string) =>
  s
    .replace(/\(.*?\)/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]!.toUpperCase())
    .join('');

/** Zufälliges, gut lesbares Passwort */
export function genPassword(len = 14) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => chars[x % chars.length]).join('');
}

/* ---------- Passwort ändern ---------- */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [rep, setRep] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next !== rep) return setErr('Die beiden neuen Passwörter stimmen nicht überein.');
    try {
      const r = await sync.api<{ token: string }>('POST', '/api/auth/password', { current: cur, next });
      sync.setAuth(r.token);
      setMsg('Passwort geändert. Andere Geräte müssen sich neu anmelden.');
      setCur('');
      setNext('');
      setRep('');
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <Modal title="Passwort ändern" onClose={onClose}>
      <form className="modal-body" onSubmit={save}>
        <label className="set-field">
          <span className="eyebrow">Aktuelles Passwort</span>
          <input id="pw-cur" type="password" className="text-input" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="set-field">
          <span className="eyebrow">Neues Passwort (mind. 8 Zeichen)</span>
          <input id="pw-new" type="password" className="text-input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="set-field">
          <span className="eyebrow">Neues Passwort wiederholen</span>
          <input id="pw-rep" type="password" className="text-input" value={rep} onChange={(e) => setRep(e.target.value)} autoComplete="new-password" />
        </label>
        {err && <span className="error">{err}</span>}
        {msg && <span className="hint">{msg}</span>}
        <div className="menu-actions">
          <button className="btn primary" disabled={!cur || next.length < 8}>
            Passwort ändern
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Benutzerverwaltung ---------- */
interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number;
  lastLogin: number | null;
}

export function UsersDialog({ app, onClose }: { app: AppState; onClose: () => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ email: '', name: '', role: 'operator' as Role, password: genPassword() });
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const load = () =>
    sync
      .api<UserRow[]>('GET', '/api/users')
      .then(setUsers)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr('');
    setNote('');
    try {
      await fn();
      if (ok) setNote(ok);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const list = users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'noch nie');

  return (
    <Modal title="Benutzer" onClose={onClose} wide>
      <div className="modal-body">
        <dl className="roles">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <React.Fragment key={r}>
              <dt>{ROLE_LABEL[r]}</dt>
              <dd>{ROLE_HINT[r]}</dd>
            </React.Fragment>
          ))}
        </dl>
        <form
          className="user-new"
          onSubmit={(e) => {
            e.preventDefault();
            const pw = form.password;
            run(() => sync.api('POST', '/api/users', form), `Konto für ${form.email} angelegt. Passwort: ${pw}`).then(() => setForm({ email: '', name: '', role: form.role, password: genPassword() }));
          }}
        >
          <input autoComplete="off" id="nu-name" className="text-input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Name" />
          <input spellCheck={false} autoComplete="off" id="nu-email" className="text-input" type="email" placeholder="E-Mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="E-Mail" />
          <select id="nu-role" className="text-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} aria-label="Rolle">
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <span className="pw-gen">
            <input autoComplete="off" id="nu-pw" className="text-input num" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Startpasswort" />
            <button type="button" className="icon-btn" title="Neues Passwort erzeugen" aria-label="Neues Passwort erzeugen" onClick={() => setForm({ ...form, password: genPassword() })}>
              <Icon name="reset" size={14} />
            </button>
          </span>
          <button className="btn primary" disabled={!form.email || form.password.length < 8}>
            Anlegen
          </button>
        </form>
        {err && <span className="error">{err}</span>}
        {note && (
          <span className="hint note-box">
            {note}{' '}
            <button className="link-btn" onClick={() => copyText(note.split('Passwort: ')[1] ?? note)}>
              kopieren
            </button>
          </span>
        )}
        <input autoComplete="off" className="text-input" type="search" placeholder="Name oder E-Mail suchen…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Benutzer suchen" />
        <ul className="user-list">
          {list.map((u) => {
            const me = u.id === app.user?.id;
            return (
              <li key={u.id}>
                <span className="avatar small" aria-hidden="true">
                  {initials(u.name || u.email)}
                </span>
                <span className="user-id">
                  <b>
                    {u.name || u.email} {me && <span className="hint small">(du)</span>}
                  </b>
                  <span className="hint small">
                    {u.email} · zuletzt {fmt(u.lastLogin)}
                  </span>
                </span>
                <select className="text-input role-select" value={u.role} aria-label={`Rolle von ${u.email}`} onChange={(e) => run(() => sync.api('PATCH', `/api/users/${u.id}`, { role: e.target.value }), me ? 'Deine Rolle wurde geändert. Bitte neu anmelden.' : undefined)}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <button
                  className="btn small"
                  onClick={() => {
                    const pw = genPassword();
                    run(() => sync.api('PATCH', `/api/users/${u.id}`, { password: pw }), `Neues Passwort für ${u.email}: ${pw}`);
                  }}
                >
                  Passwort zurücksetzen
                </button>
                {confirmDel === u.id ? (
                  <span className="confirm inline">
                    <button className="btn danger-fill small" onClick={() => (run(() => sync.api('DELETE', `/api/users/${u.id}`)), setConfirmDel(null))}>
                      Löschen
                    </button>
                    <button className="btn small" onClick={() => setConfirmDel(null)}>
                      Abbrechen
                    </button>
                  </span>
                ) : (
                  <button className="icon-btn" aria-label={`${u.email} löschen`} disabled={me} onClick={() => setConfirmDel(u.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

/* ---------- QR-Code ---------- */
export function QrCode({ text, label }: { text: string; label: string }) {
  const [full, setFull] = useState(false);
  const svg = useMemo(() => qrSvg(text, { border: 2 }), [text]);
  const download = (kind: 'png' | 'svg') => {
    const a = document.createElement('a');
    a.href = kind === 'png' ? (qrPng(text) as string) : URL.createObjectURL(new Blob([qrSvg(text)], { type: 'image/svg+xml' }));
    a.download = `${label.replace(/[^\wäöüÄÖÜß-]+/g, '_')}-qr.${kind}`;
    a.click();
  };
  return (
    <div className="qr">
      <button className="qr-img" onClick={() => setFull(true)} title="Vollbild" aria-label="QR-Code im Vollbild" dangerouslySetInnerHTML={{ __html: svg }} />
      {!__ARTIFACT__ && (
        <div className="menu-actions">
          <button className="btn small" onClick={() => download('png')}>
            PNG
          </button>
          <button className="btn small" onClick={() => download('svg')}>
            SVG
          </button>
        </div>
      )}
      {full && (
        <button type="button" className="qr-full" onClick={() => setFull(false)} onKeyDown={(e) => e.key === 'Escape' && setFull(false)} aria-label="QR-Code groß, zum Schließen tippen" autoFocus>
          <span dangerouslySetInnerHTML={{ __html: svg }} />
          <span>{label}</span>
        </button>
      )}
    </div>
  );
}

/* ---------- API & Integrationen ---------- */
type Ep = { method: 'GET' | 'POST'; path: string; title: string; hint: string };
const CONTROL: Ep[] = [
  { method: 'POST', path: '/start', title: 'Start', hint: 'Startet beim ersten Cue (optional ?item=Nummer oder ID)' },
  { method: 'POST', path: '/next', title: 'Weiter', hint: 'Nächster Cue, startet die Show, falls sie noch nicht läuft' },
  { method: 'POST', path: '/prev', title: 'Zurück', hint: 'Vorheriger Cue' },
  { method: 'POST', path: '/goto?item=1', title: 'Springen', hint: 'Cue sofort live schalten (Nummer oder ID)' },
  { method: 'POST', path: '/toggle', title: 'Pause / Fortsetzen', hint: 'Hält alle Timer an bzw. setzt fort' },
  { method: 'POST', path: '/stop', title: 'Beenden', hint: 'Show beenden, gemessene Zeiten bleiben' },
  { method: 'POST', path: '/reset', title: 'Zurücksetzen', hint: 'Live-Zustand und Messwerte löschen' },
];
const TIME: Ep[] = [
  { method: 'POST', path: '/plus?seconds=60', title: 'Zeit hinzufügen', hint: 'Laufenden Cue verlängern' },
  { method: 'POST', path: '/minus?seconds=60', title: 'Zeit abziehen', hint: 'Laufenden Cue kürzen' },
  { method: 'POST', path: '/add?seconds=-30', title: 'Zeit addieren', hint: 'Mit Vorzeichen, z. B. −30 s' },
  { method: 'POST', path: '/set?time=05:00', title: 'Restzeit setzen', hint: 'Countdown steht danach exakt auf 05:00' },
  { method: 'POST', path: '/setduration?time=10:00', title: 'Dauer setzen', hint: 'Gesamtdauer des laufenden Cues für diesen Durchlauf' },
  { method: 'POST', path: '/message?text=Noch%201%20Minute&color=red', title: 'Bühnennachricht', hint: 'text, visible, color=white|red, bold, flash' },
];
const READ: Ep[] = [
  { method: 'GET', path: '/status', title: 'Status', hint: 'Flache Werte für Companion-Variablen' },
  { method: 'GET', path: '/cue', title: 'Aktueller Cue', hint: 'Aktueller, vorheriger und nächster Cue mit allen Spalten' },
  { method: 'GET', path: '/rundown', title: 'Kompletter Ablauf', hint: 'Alle Einträge mit Plan- und Ist-Zeiten' },
  { method: 'GET', path: '/text/remaining', title: 'Restzeit als Text', hint: 'Auch: title, next, delta, state, projected_end, clock …' },
  { method: 'GET', path: '/events', title: 'Live-Stream', hint: 'Server-Sent Events, jede Sekunde und bei jeder Änderung' },
];

export function ApiDialog({ r, tl, onClose }: { r: Rundown; tl: Timeline; onClose: () => void }) {
  const [tab, setTab] = useState<'control' | 'read' | 'cues' | 'integrations' | 'security'>('control');
  const [info, setInfo] = useState<{ token: string; rotatedAt: number | null; rotatedBy: string | null } | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [resp, setResp] = useState<{ path: string; body: string } | null>(null);
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (sync.serverCapable)
      sync
        .api('GET', `/api/rundowns/${r.id}/apitoken`)
        .then(setInfo)
        .catch((e) => setErr(e.message));
  }, [r.id]);

  if (!sync.serverCapable)
    return (
      <Modal title="API & Integrationen" onClose={onClose}>
        <div className="modal-body">
          <p className="hint">Die Steuer-API braucht den Taktgeber-Server (z. B. auf deiner NAS). In dieser Einzelseiten-Version läuft alles nur im Browser.</p>
        </div>
      </Modal>
    );

  const base = info ? `${location.origin}/api/v1/${info.token}` : '';
  const shown = info ? (show ? base : `${location.origin}/api/v1/${info.token.slice(0, 4)}••••••••••••`) : 'wird geladen …';
  const copy = async (t: string) => setNote((await copyText(t)) ? 'Kopiert.' : 'Bitte markieren und kopieren.');
  const test = async (ep: Ep) => {
    if (ep.path === '/events') return setResp({ path: ep.path, body: 'Server-Sent Events: im Browser oder mit „curl -N“ öffnen.' });
    const res = await fetch(base + ep.path, { method: ep.method }).catch(() => null);
    const body = res ? await res.text() : 'Server nicht erreichbar';
    let pretty = body;
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* Text */
    }
    setResp({ path: ep.path, body: `${res?.status ?? '—'}\n${pretty}` });
  };
  const list = (eps: Ep[], heading: string) => (
    <>
      <span className="eyebrow">{heading}</span>
      <ul className="ep-list">
        {eps.map((ep) => (
          <li key={ep.path}>
            <span className={`method m-${ep.method.toLowerCase()}`}>{ep.method}</span>
            <span className="ep-main">
              <b>{ep.title}</b>
              <code>{ep.path}</code>
              <span className="hint small">{ep.hint}</span>
            </span>
            <button className="icon-btn" title="URL kopieren" aria-label={`URL für ${ep.title} kopieren`} onClick={() => copy(base + ep.path)}>
              <Icon name="copy" size={14} />
            </button>
            <button className="btn small" onClick={() => test(ep)} title={ep.method === 'POST' ? 'Führt die Aktion wirklich aus' : 'Antwort anzeigen'}>
              {ep.method === 'POST' ? 'Ausführen' : 'Abrufen'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <Modal title="API & Integrationen" onClose={onClose} wide>
      <div className="modal-body">
        <div className="api-base">
          <span className="eyebrow">Basis-URL</span>
          <div className="api-url">
            <code>{shown}</code>
            <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Token verbergen' : 'Token anzeigen'}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={15} />
            </button>
            <button className="btn primary small" disabled={!info} onClick={() => copy(base)}>
              <Icon name="copy" size={13} /> Kopieren
            </button>
          </div>
          <span className="hint small">GET und POST, Parameter als Query oder JSON-Body. Der Token wirkt wie ein Passwort für die Steuerung dieses Ablaufs. Alte FF-Rundown-Adressen /api/companion/… funktionieren ebenfalls.</span>
        </div>
        {err && <span className="error">{err}</span>}
        {note && <span className="hint">{note}</span>}
        <div className="seg tabs" role="tablist">
          {(
            [
              ['control', 'Steuern'],
              ['read', 'Auslesen'],
              ['cues', 'Cues'],
              ['integrations', 'Integrationen'],
              ['security', 'Sicherheit'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => (setTab(id), setResp(null))}>
              {l}
            </button>
          ))}
        </div>
        {tab === 'control' && (
          <>
            {list(CONTROL, 'Ablauf')}
            {list(TIME, 'Zeit am laufenden Cue')}
          </>
        )}
        {tab === 'read' && list(READ, 'Lesen')}
        {tab === 'cues' && (
          <ul className="ep-list">
            {playable(r).map((c) => (
              <li key={c.id}>
                <span className="num cue-ref">{tl.cues[c.id]?.label}</span>
                <span className="ep-main">
                  <b>{c.title || 'Ohne Titel'}</b>
                  <code>/goto?item={c.id}</code>
                </span>
                <button className="icon-btn" aria-label="URL kopieren" onClick={() => copy(`${base}/goto?item=${c.id}`)}>
                  <Icon name="copy" size={14} />
                </button>
              </li>
            ))}
            {!r.items.some(isCue) && <li className="hint">Noch keine Cues.</li>}
          </ul>
        )}
        {tab === 'integrations' && (
          <div className="integrations">
            <h3>Bitfocus Companion / Stream Deck</h3>
            <ol>
              <li>
                Modul <b>Generic: HTTP Requests</b> hinzufügen, Base-URL: die Basis-URL oben.
              </li>
              <li>
                Knöpfe mit POST auf <code>/next</code>, <code>/prev</code>, <code>/plus?seconds=60</code> usw. belegen.
              </li>
              <li>
                Für Anzeigen einen Trigger jede Sekunde auf <code>/text/remaining</code> (oder <code>title</code>, <code>next</code>, <code>delta</code>, <code>state</code>) legen und in eine Variable schreiben.
              </li>
            </ol>
            <h3>OBS / vMix / CasparCG</h3>
            <p className="hint">
              Overlays lesen <code>/cue</code> als JSON oder hören auf <code>/events</code> (Server-Sent Events). Für den Bühnen-Timer als Browserquelle eignet sich <code>{location.origin}/#timer</code> mit transparentem Hintergrund.
            </p>
          </div>
        )}
        {tab === 'security' && (
          <div className="security">
            <p className="hint">
              Wurde der Token weitergegeben oder ist ein Gerät verloren gegangen, kannst du ihn sperren. Die neue Adresse muss danach in Companion & Co. eingetragen werden.
              {info?.rotatedAt && ` Zuletzt neu erzeugt am ${new Date(info.rotatedAt).toLocaleString('de-DE')} von ${info.rotatedBy}.`}
            </p>
            <label className="set-field">
              <span className="eyebrow">Zum Bestätigen NEU eingeben</span>
              <input autoComplete="off" id="api-confirm" className="text-input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button
              className="btn danger-fill"
              disabled={confirm !== 'NEU'}
              onClick={async () => {
                try {
                  setInfo(await sync.api('POST', `/api/rundowns/${r.id}/apitoken/regenerate`, { confirm }));
                  setConfirm('');
                  setNote('Neuer Token aktiv, der alte ist gesperrt.');
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              Token sperren & neu erzeugen
            </button>
          </div>
        )}
        {resp && (
          <div className="api-resp">
            <span className="eyebrow">Antwort von {resp.path}</span>
            <pre>{resp.body}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Hinweis auf neue Version ---------- */
export function UpdateBanner({ version }: { version: string }) {
  return (
    <div className="update-banner" role="status">
      Neue Version {version} verfügbar.
      <button className="btn small primary" onClick={() => location.reload()}>
        Jetzt neu laden
      </button>
    </div>
  );
}
