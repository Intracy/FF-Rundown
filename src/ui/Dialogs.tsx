import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClockMode, Rundown, RundownStatus, STATUS_LABEL, isCue } from '../types';
import { Timeline } from '../timing';
import { fmtClock, fmtDate, msOfDay, timeZones, uid } from '../time';
import { AppState, now as clockNow, store } from '../store';
import { blankRundown, makeSample } from '../sample';
import { cloneRundown, cueLabel } from '../model';
import { fromCsv, fromJson, toCsv } from '../csv';
import { sync } from '../sync';
import { ClockInput, DurationInput, Icon, Toggle, copyText, resolveVars } from './common';

const edit = (rid: string, fn: (r: Rundown) => Rundown, key?: string) => store.updateRundown(rid, fn, key);

/* ---------- Abläufe wechseln / anlegen ---------- */
export function RundownSwitcher({ app, close, openOverview }: { app: AppState; close: () => void; openOverview: () => void }) {
  const list = Object.values(app.rundowns)
    .filter((r) => !r.isTemplate && r.status !== 'archived')
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return (
    <div className="menu-body">
      <span className="eyebrow">Abläufe</span>
      <ul className="rd-list">
        {list.map((r) => {
          const st = app.live[r.id]?.status ?? 'idle';
          return (
            <li key={r.id}>
              <button
                className={r.id === app.activeId ? 'on' : ''}
                onClick={() => {
                  store.setActive(r.id);
                  close();
                }}
              >
                <span className={`dot st-${st}`} aria-hidden="true" />
                <span className="rd-name">{r.title || 'Ohne Titel'}</span>
                <span className="rd-date num">{fmtDate(r.date)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="menu-list">
        <button onClick={() => (openOverview(), close())}>
          <Icon name="home" size={14} /> Übersicht mit Events und Vorlagen
        </button>
        <button onClick={() => (store.addRundown(blankRundown()), close())}>
          <Icon name="plus" size={14} /> Neuer Ablauf
        </button>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('.suggest-wrap') && close.current();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  return createPortal(
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Einstellungen ---------- */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 480 / img.width, 160 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SettingsDialog({ r, app, tl, onClose }: { r: Rundown; app: AppState; tl: Timeline; onClose: () => void }) {
  const s = r.settings;
  const set = (patch: Partial<Rundown['settings']>, key?: string) => edit(r.id, (x) => ({ ...x, settings: { ...x.settings, ...patch } }), key);
  const [logoErr, setLogoErr] = useState('');
  const zones = timeZones();
  const clocks: [ClockMode, string][] = [
    ['24', '24 h'],
    ['12', '12 h AM/PM'],
    ['12n', '12 h'],
    ['auto', 'wie Gerät'],
  ];
  return (
    <Modal title="Einstellungen des Ablaufs" onClose={onClose} wide>
      <div className="modal-body settings">
        <section className="set-sec">
          <h3>Zeit</h3>
          <div className="set-grid">
            <label className="set-field">
              <span className="eyebrow">Datum</span>
              <input type="date" className="text-input" value={r.date} onChange={(e) => e.target.value && edit(r.id, (x) => ({ ...x, date: e.target.value }))} />
            </label>
            <label className="set-field wide">
              <span className="eyebrow">Zeitzone</span>
              <select className="text-input" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                <option value="">Zeitzone des jeweiligen Geräts</option>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <div className="set-field">
              <span className="eyebrow">Showbeginn</span>
              <ClockInput value={r.start} onChange={(v) => edit(r.id, (x) => ({ ...x, start: v }))} label="Showbeginn" className="wide" />
            </div>
            <div className="set-field">
              <span className="eyebrow">Geplantes Ende</span>
              <ClockInput value={r.plannedEnd ?? msOfDay(tl.plannedEnd)} onChange={(v) => edit(r.id, (x) => ({ ...x, plannedEnd: v }))} label="Geplantes Ende" className="wide" />
            </div>
            <div className="set-field">
              <span className="eyebrow">Timer gelb ab</span>
              <DurationInput value={r.warnAt} onChange={(v) => edit(r.id, (x) => ({ ...x, warnAt: v }))} label="Warnschwelle" className="wide" />
            </div>
          </div>
          <div className="set-field">
            <span className="eyebrow">Uhrzeitformat</span>
            <div className="seg" role="radiogroup" aria-label="Uhrzeitformat">
              {clocks.map(([id, l]) => (
                <button key={id} role="radio" aria-checked={s.clock === id} className={s.clock === id ? 'on' : ''} onClick={() => set({ clock: id })}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="set-sec">
          <h3>Darstellung</h3>
          <div className="set-field">
            <span className="eyebrow">Laufender Cue</span>
            <div className="seg" role="radiogroup" aria-label="Hervorhebung des laufenden Cues">
              <button role="radio" aria-checked={s.highlight === 'red'} className={s.highlight === 'red' ? 'on' : ''} onClick={() => set({ highlight: 'red' })}>
                Rot hervorheben
              </button>
              <button role="radio" aria-checked={s.highlight === 'color'} className={s.highlight === 'color' ? 'on' : ''} onClick={() => set({ highlight: 'color' })}>
                Eigene Farbe behalten
              </button>
            </div>
          </div>
          <div className="set-grid">
            <label className="set-field">
              <span className="eyebrow">Nummer: Präfix</span>
              <input className="text-input" value={s.numPrefix} maxLength={12} placeholder="z. B. A" onChange={(e) => set({ numPrefix: e.target.value }, `np:${r.id}`)} />
            </label>
            <label className="set-field">
              <span className="eyebrow">Beginnt bei</span>
              <input className="text-input num" type="number" min={0} value={s.numStart} onChange={(e) => set({ numStart: Math.max(0, +e.target.value || 0) })} />
            </label>
            <label className="set-field">
              <span className="eyebrow">Stellen</span>
              <input className="text-input num" type="number" min={1} max={6} value={s.numDigits} onChange={(e) => set({ numDigits: Math.min(6, Math.max(1, +e.target.value || 1)) })} />
            </label>
            <div className="set-field">
              <span className="eyebrow">Vorschau</span>
              <span className="num preview-num">
                {cueLabel(r, 1)}, {cueLabel(r, 2)}, {cueLabel(r, 3)}
              </span>
            </div>
          </div>
          <div className="set-field">
            <span className="eyebrow">Logo für Ablauf und Timer</span>
            <div className="logo-row">
              {s.logo ? <img src={s.logo} alt="Logo" className="logo-preview" /> : <span className="hint">Kein Logo</span>}
              <label className="btn small" htmlFor="logo-file">
                Bild wählen
              </label>
              <input
                id="logo-file"
                type="file"
                accept="image/*"
                className="visually-hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    set({ logo: await shrinkImage(f) });
                    setLogoErr('');
                  } catch {
                    setLogoErr('Das Bild konnte nicht gelesen werden.');
                  }
                }}
              />
              {s.logo && (
                <button className="btn small ghost" onClick={() => set({ logo: '' })}>
                  Entfernen
                </button>
              )}
              {logoErr && <span className="error">{logoErr}</span>}
            </div>
          </div>
        </section>

        <section className="set-sec">
          <h3>Organisation</h3>
          <div className="set-field">
            <span className="eyebrow">Status</span>
            <div className="seg" role="radiogroup" aria-label="Status">
              {(Object.keys(STATUS_LABEL) as RundownStatus[]).map((k) => (
                <button key={k} role="radio" aria-checked={r.status === k} className={r.status === k ? 'on' : ''} onClick={() => edit(r.id, (x) => ({ ...x, status: k }))}>
                  {STATUS_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
          <label className="set-field">
            <span className="eyebrow">Event</span>
            <select className="text-input" value={r.eventId ?? ''} onChange={(e) => edit(r.id, (x) => ({ ...x, eventId: e.target.value || null }))}>
              <option value="">Kein Event</option>
              {Object.values(app.events).map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
          <Toggle id="is-template" on={r.isTemplate} onChange={(v) => edit(r.id, (x) => ({ ...x, isTemplate: v }))}>
            Als Vorlage verwenden
            <small>erscheint in der Übersicht unter „Vorlagen“ und beim Anlegen neuer Abläufe</small>
          </Toggle>
        </section>
      </div>
    </Modal>
  );
}

/* ---------- Text-Variablen ---------- */
const keyOk = (k: string) => /^[a-z0-9-]+$/.test(k);
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ä]/g, 'ae')
    .replace(/[ö]/g, 'oe')
    .replace(/[ü]/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function VariablesDialog({ r, onClose }: { r: Rundown; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const used = (k: string) =>
    r.items.reduce((n, it) => n + (isCue(it) ? [it.subtitle, it.script, ...Object.values(it.cells)].filter((t) => t.includes('$' + k)).length : 0), 0);
  const valid = keyOk(key) && !(key in r.variables);
  return (
    <Modal title="Text-Variablen" onClose={onClose}>
      <div className="modal-body">
        <p className="hint">
          Tippe in einer Zelle oder im Skript <kbd>$</kbd> und wähle eine Variable. Ändert sich der Wert hier, ändert er sich überall im Ablauf, im Timer und im Prompter.
        </p>
        <div className="kv-list">
          {Object.entries(r.variables).map(([k, v]) => (
            <div className="kv-row" key={k}>
              <code className="num">${k}</code>
              <input className="text-input" aria-label={`Wert von ${k}`} value={v} onChange={(e) => edit(r.id, (x) => ({ ...x, variables: { ...x.variables, [k]: e.target.value } }), `var:${k}`)} />
              <span className="hint small">{used(k)}×</span>
              <button
                className="icon-btn"
                aria-label={`Variable ${k} löschen`}
                onClick={() =>
                  edit(r.id, (x) => {
                    const vars = { ...x.variables };
                    delete vars[k];
                    return { ...x, variables: vars };
                  })
                }
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          {!Object.keys(r.variables).length && <p className="hint">Noch keine Variablen.</p>}
        </div>
        <form
          className="kv-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            edit(r.id, (x) => ({ ...x, variables: { ...x.variables, [key]: val } }));
            setKey('');
            setVal('');
          }}
        >
          <input id="var-key" className="text-input num" placeholder="schluessel-name" value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} aria-label="Schlüssel" />
          <input id="var-val" className="text-input" placeholder="Wert" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Wert" />
          <button className="btn primary" disabled={!valid}>
            Anlegen
          </button>
        </form>
        {key && !valid && <span className="error">{key in r.variables ? 'Diesen Schlüssel gibt es schon.' : 'Nur Kleinbuchstaben, Ziffern und Bindestriche.'}</span>}
      </div>
    </Modal>
  );
}

/* ---------- Erwähnungen ---------- */
export function MentionsDialog({ r, onClose }: { r: Rundown; onClose: () => void }) {
  const [name, setName] = useState('');
  const key = slug(name);
  const valid = !!key && !(key in r.mentions);
  const setM = (k: string, patch: Partial<Rundown['mentions'][string]>, ck?: string) => edit(r.id, (x) => ({ ...x, mentions: { ...x.mentions, [k]: { ...x.mentions[k], ...patch } } }), ck);
  return (
    <Modal title="Erwähnungen" onClose={onClose}>
      <div className="modal-body">
        <p className="hint">
          Personen, Positionen oder Infos, die im Ablauf öfter vorkommen. Tippe <kbd>@</kbd> in einer Zelle. Beim Darüberfahren erscheint die Beschreibung.
        </p>
        <div className="mention-list">
          {Object.values(r.mentions).map((m) => (
            <div className="mention-edit" key={m.key}>
              <div className="field-row">
                <input className="text-input" aria-label="Name" value={m.name} onChange={(e) => setM(m.key, { name: e.target.value }, `mn:${m.key}`)} />
                <code className="num">@{m.key}</code>
                <button
                  className="icon-btn"
                  aria-label={`Erwähnung ${m.name} löschen`}
                  onClick={() =>
                    edit(r.id, (x) => {
                      const ms = { ...x.mentions };
                      delete ms[m.key];
                      return { ...x, mentions: ms };
                    })
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <textarea className="text-input" rows={2} aria-label="Beschreibung" placeholder="Beschreibung, Kontakt, Position …" value={m.description} onChange={(e) => setM(m.key, { description: e.target.value }, `md:${m.key}`)} />
            </div>
          ))}
          {!Object.keys(r.mentions).length && <p className="hint">Noch keine Erwähnungen.</p>}
        </div>
        <form
          className="kv-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            edit(r.id, (x) => ({ ...x, mentions: { ...x.mentions, [key]: { key, name: name.trim(), description: '' } } }));
            setName('');
          }}
        >
          <input id="mention-name" className="text-input" placeholder="Name, z. B. Kamera 2" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name der Erwähnung" />
          <button className="btn primary" disabled={!valid}>
            Anlegen
          </button>
        </form>
        {name && key && !valid && <span className="error">Diese Erwähnung gibt es schon.</span>}
      </div>
    </Modal>
  );
}

/* ---------- Papierkorb ---------- */
export function TrashDialog({ r, onClose }: { r: Rundown; onClose: () => void }) {
  const entries = [...r.trash].sort((a, b) => b.at - a.at);
  const restore = (id: string) =>
    edit(r.id, (x) => {
      const e = x.trash.find((t) => t.id === id);
      if (!e) return x;
      const trash = x.trash.filter((t) => t.id !== id);
      if (e.item) {
        const items = [...x.items];
        items.splice(Math.min(e.index, items.length), 0, e.item);
        return { ...x, items, trash };
      }
      if (e.column) {
        const columns = [...x.columns];
        columns.splice(Math.min(e.index, columns.length), 0, e.column);
        const items = x.items.map((it) => (isCue(it) && e.cells?.[it.id] != null ? { ...it, cells: { ...it.cells, [e.column!.id]: e.cells[it.id] } } : it));
        return { ...x, columns, items, trash };
      }
      return { ...x, trash };
    });
  return (
    <Modal title="Papierkorb" onClose={onClose}>
      <div className="modal-body">
        <p className="hint">Gelöschte Cues, Überschriften und Spalten bleiben 30 Tage hier und lassen sich an ihre alte Stelle zurückholen.</p>
        {entries.length ? (
          <ul className="trash-list">
            {entries.map((e) => (
              <li key={e.id}>
                <span className="trash-kind">{e.column ? 'Spalte' : e.item && isCue(e.item) ? 'Cue' : 'Überschrift'}</span>
                <span className="trash-name">{e.column?.name || e.item?.title || 'Ohne Titel'}</span>
                <span className="num hint small">
                  {new Date(e.at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {fmtClock(e.at, false)}
                </span>
                <button className="btn small" onClick={() => restore(e.id)}>
                  Wiederherstellen
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Der Papierkorb ist leer.</p>
        )}
      </div>
    </Modal>
  );
}

/* ---------- Gäste einladen (nur mit Server) ---------- */
interface ShareRow {
  token: string;
  mode: 'view' | 'edit';
  columns: string[] | null;
  createdAt: number;
}

export function ShareDialog({ r, onClose }: { r: Rundown; onClose: () => void }) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [cols, setCols] = useState<string[]>(r.columns.map((c) => c.id));
  const [code, setCode] = useState<{ token: string; code: string; expires: number } | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [, tick] = useState(0);
  const linkFor = (t: string) => `${location.origin}/?share=${t}#ablauf`;

  const load = () =>
    fetch(`/api/shares?rundownId=${encodeURIComponent(r.id)}`, { headers: sync.headers() })
      .then((x) => (x.ok ? x.json() : Promise.reject(x.status)))
      .then(setShares)
      .catch(() => setErr('Der Server ist nicht erreichbar.'));

  useEffect(() => {
    load();
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const create = async () => {
    setErr('');
    const res = await fetch('/api/shares', { method: 'POST', headers: sync.headers(), body: JSON.stringify({ rundownId: r.id, mode, columns: mode === 'view' ? cols : null }) });
    if (!res.ok) return setErr('Der Link konnte nicht erstellt werden.');
    load();
  };
  const revoke = async (token: string) => {
    await fetch(`/api/shares/${token}`, { method: 'DELETE', headers: sync.headers() });
    if (code?.token === token) setCode(null);
    load();
  };
  const makeCode = async (token: string) => {
    const res = await fetch('/api/codes', { method: 'POST', headers: sync.headers(), body: JSON.stringify({ token }) });
    if (res.ok) setCode({ token, ...(await res.json()) });
  };

  if (!sync.serverCapable)
    return (
      <Modal title="Gäste einladen" onClose={onClose}>
        <div className="modal-body">
          <p className="hint">Gast-Links brauchen den Taktgeber-Server (z. B. auf deiner NAS). In dieser Einzelseiten-Version liegen die Daten nur in deinem Browser.</p>
        </div>
      </Modal>
    );

  const left = code ? Math.max(0, code.expires - Date.now()) : 0;
  return (
    <Modal title="Gäste einladen" onClose={onClose} wide>
      <div className="modal-body">
        <p className="hint">Gäste brauchen kein Konto. Ein Link gilt nur für diesen Ablauf und lässt sich jederzeit deaktivieren.</p>
        <div className="share-new">
          <div className="seg" role="radiogroup" aria-label="Zugriff">
            <button role="radio" aria-checked={mode === 'view'} className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>
              Nur ansehen
            </button>
            <button role="radio" aria-checked={mode === 'edit'} className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
              Bearbeiten
            </button>
          </div>
          {mode === 'view' && (
            <div className="check-list inline">
              {r.columns.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={cols.includes(c.id)} onChange={(e) => setCols(e.target.checked ? [...cols, c.id] : cols.filter((x) => x !== c.id))} />
                  <span>{c.name}</span>
                </label>
              ))}
            </div>
          )}
          <button className="btn primary" onClick={create}>
            Link erstellen
          </button>
        </div>
        {err && <span className="error">{err}</span>}
        <ul className="share-list">
          {shares.map((s) => (
            <li key={s.token}>
              <div className="share-info">
                <b>{s.mode === 'view' ? 'Nur ansehen' : 'Bearbeiten'}</b>
                {s.columns && <span className="hint small">{s.columns.length ? r.columns.filter((c) => s.columns!.includes(c.id)).map((c) => c.name).join(', ') : 'ohne Zusatzspalten'}</span>}
                <code className="share-link">{linkFor(s.token)}</code>
              </div>
              <div className="menu-actions">
                <button className="btn small" onClick={async () => setNote((await copyText(linkFor(s.token))) ? 'Link kopiert.' : 'Bitte Link markieren und kopieren.')}>
                  <Icon name="copy" size={13} /> Kopieren
                </button>
                <button className="btn small" onClick={() => makeCode(s.token)}>
                  Schnellzugriffscode
                </button>
                <button className="btn small ghost danger" onClick={() => revoke(s.token)}>
                  Deaktivieren
                </button>
              </div>
              {code?.token === s.token && (
                <div className="quick-code">
                  {left > 0 ? (
                    <>
                      <span className="num code-digits">
                        {code.code.slice(0, 3)} {code.code.slice(3)}
                      </span>
                      <span className="hint">
                        Eingeben unter <b>{location.host}/#code</b> · gültig noch {Math.ceil(left / 60000)} min
                      </span>
                      <span className="code-bar">
                        <span style={{ transform: `scaleX(${left / 600_000})` }} />
                      </span>
                    </>
                  ) : (
                    <span className="hint">Code abgelaufen.</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {note && <span className="hint">{note}</span>}
      </div>
    </Modal>
  );
}

/* ---------- Anmeldung (wenn der Server ein Passwort verlangt) ---------- */
export function LoginScreen({ error }: { error: string }) {
  const [pw, setPw] = useState('');
  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          store.login(pw);
        }}
      >
        <h1>Taktgeber</h1>
        <p className="hint">Dieser Server ist geschützt. Bitte das Passwort eingeben, das beim Start als ADMIN_PASSWORD gesetzt wurde.</p>
        <label className="eyebrow" htmlFor="login-pw">
          Passwort
        </label>
        <input id="login-pw" type="password" className="text-input" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        {error && <span className="error">{error}</span>}
        <button className="btn primary">Anmelden</button>
        <a className="link-btn" href="#code">
          Ich habe einen Zugangscode
        </a>
      </form>
    </div>
  );
}

/* ---------- Schnellzugriffscode einlösen ---------- */
export function CodeEntry() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    const res = await fetch(`/api/codes/${code}`).catch(() => null);
    if (!res || !res.ok) return setErr('Der Code ist ungültig oder abgelaufen.');
    const { token } = await res.json();
    location.href = `/?share=${encodeURIComponent(token)}#ablauf`;
  };
  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <h1>Zugangscode</h1>
        <p className="hint">Den sechsstelligen Code bekommst du von der Regie.</p>
        <input
          id="access-code"
          className="text-input num code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="000 000"
          value={code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-label="Zugangscode"
        />
        {err && <span className="error">{err}</span>}
        <button className="btn primary" disabled={code.length !== 6 || !sync.serverCapable}>
          Öffnen
        </button>
        {!sync.serverCapable && <span className="hint">Codes funktionieren nur mit dem Taktgeber-Server.</span>}
      </form>
    </div>
  );
}

/* ---------- Import / Export ---------- */
export function ImportExport({ r, tl, onClose }: { r: Rundown; tl: Timeline; onClose: () => void }) {
  const [tab, setTab] = useState<'csv' | 'json' | 'import'>('csv');
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  const out = useRef<HTMLTextAreaElement>(null);
  const content = tab === 'csv' ? resolveVars(toCsv(r, tl), r.variables) : tab === 'json' ? JSON.stringify({ ...r, trash: [], cellLog: [] }, null, 2) : '';
  const fileBase = (r.title || 'ablauf').replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 60);

  const doImport = (text: string, name: string) => {
    try {
      const trimmed = text.trim();
      const rd = trimmed.startsWith('{') ? fromJson(trimmed) : fromCsv(trimmed, name.replace(/\.(csv|txt|json)$/i, '') || 'Importierter Ablauf');
      store.addRundown(rd);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.');
    }
  };

  return (
    <Modal title="Import & Export" onClose={onClose}>
      <div className="seg tabs" role="tablist">
        {(
          [
            ['csv', 'CSV exportieren'],
            ['json', 'Sicherung (JSON)'],
            ['import', 'Importieren'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => (setTab(id), setNote(''), setError(''))}>
            {label}
          </button>
        ))}
      </div>

      {tab !== 'import' ? (
        <div className="modal-body">
          <p className="hint">
            {tab === 'csv'
              ? 'Semikolon-getrennt, öffnet direkt in Excel, Numbers oder Google Sheets. Mit geplanten Start- und Endzeiten, Variablen sind eingesetzt.'
              : 'Vollständige Sicherung inklusive Spalten, Farben, Skripten, Unter-Timern, Variablen und Einstellungen.'}
          </p>
          <textarea ref={out} className="export-box" readOnly value={content} aria-label="Exportinhalt" />
          <div className="menu-actions">
            <button
              className="btn primary"
              onClick={async () => {
                const ok = await copyText(content, out.current);
                setNote(ok ? 'In die Zwischenablage kopiert.' : 'Text ist markiert, bitte mit Strg/Cmd+C kopieren.');
              }}
            >
              <Icon name="copy" size={14} /> Kopieren
            </button>
            {!__ARTIFACT__ && (
              <button
                className="btn"
                onClick={() => {
                  const blob = new Blob([tab === 'csv' ? '﻿' + content : content], { type: tab === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `${fileBase}.${tab}`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                }}
              >
                <Icon name="io" size={14} /> Herunterladen
              </button>
            )}
            {note && <span className="hint">{note}</span>}
          </div>
        </div>
      ) : (
        <div className="modal-body">
          <p className="hint">
            CSV aus Excel oder Google Sheets mit einer Spalte „Titel“ (optional „Dauer“, „Untertitel“, „Fixstart“, „Typ“, „Skript“; weitere Spalten werden übernommen) oder eine Taktgeber-Sicherung. Es entsteht ein neuer Ablauf.
          </p>
          <label className="file-drop" htmlFor="import-file">
            <Icon name="io" />
            <span>Datei wählen (.csv, .json)</span>
            <input
              id="import-file"
              type="file"
              accept=".csv,.json,.txt,text/csv,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => doImport(String(rd.result), f.name);
                rd.readAsText(f);
              }}
            />
          </label>
          <label className="eyebrow" htmlFor="import-paste">
            Oder Inhalt einfügen
          </label>
          <textarea id="import-paste" className="export-box small" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Titel;Dauer;Kamera\nBegrüßung;3:00;Totale'} />
          <div className="menu-actions">
            <button className="btn primary" disabled={!paste.trim()} onClick={() => doImport(paste, 'Importierter Ablauf')}>
              Importieren
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Tastenkürzel ---------- */
export function Help({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Leertaste', 'Nächster Cue (startet die Show, wenn sie noch nicht läuft)'],
    ['P', 'Pause / Fortsetzen'],
    ['B', 'Zurück zum vorherigen Cue'],
    ['+ / −', 'Aktuellen Cue um 1 Minute verlängern / kürzen'],
    ['Umschalt + E', 'Show beenden'],
    ['F', 'Mitlaufen an / aus'],
    ['L', 'Ablauf sperren / entsperren'],
    ['0 · 1 · 2 · 3', 'Übersicht · Ablauf · Timer · Prompter'],
    ['Strg/Cmd + Z', 'Rückgängig (Umschalt für Wiederholen)'],
    ['Doppelklick', 'Zelle bearbeiten, Strg/Cmd + Enter speichert, Esc verwirft'],
    ['$ · @', 'In Zellen: Variable · Erwähnung einfügen'],
    ['Klick auf die Nummer', 'Cue als Nächstes vormerken'],
    ['Prompter: Leertaste', 'Scrollen starten / stoppen'],
    ['Prompter: ← →', 'Langsamer / schneller (mit Umschalt doppelt)'],
    ['Prompter: Umschalt + ↑ / ↓', 'Zum Anfang / zum laufenden Cue'],
  ];
  return (
    <Modal title="Tastenkürzel" onClose={onClose}>
      <div className="modal-body">
        <dl className="keys">
          {rows.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </Modal>
  );
}

/** Neuer Ablauf aus Vorlage oder Beispiel */
export function newFromTemplate(t: Rundown, eventId: string | null = null) {
  store.addRundown(cloneRundown(t, { title: t.title.replace(/\s*\(Vorlage\)$/, ''), isTemplate: false, status: 'draft', eventId, date: new Date(clockNow()).toISOString().slice(0, 10) }));
}

export const sampleRundown = makeSample;
export const newId = uid;
