import React, { useState } from 'react';
import { Rundown, RundownStatus, STATUS_LABEL, isCue } from '../types';
import { fmtDate } from '../time';
import { AppState, store } from '../store';
import { blankRundown, makeSample } from '../sample';
import { cloneRundown, newEvent } from '../model';
import { Icon, Popover, usePopover } from './common';
import { newFromTemplate } from './Dialogs';
import { Brand } from './TopBar';

type Tab = 'rundowns' | 'templates' | 'archive';
type Sort = 'date' | 'name' | 'updated';

/** Übersicht: Events, Abläufe, Vorlagen */
export function Dashboard({ app, open }: { app: AppState; open: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('rundowns');
  const [sort, setSort] = useState<Sort>('date');
  const [q, setQ] = useState('');
  const [eventId, setEventId] = useState<string | null>(null);
  const create = usePopover();
  const ev = eventId ? app.events[eventId] : null;
  const all = Object.values(app.rundowns);

  const match = (r: Rundown) => !q || r.title.toLowerCase().includes(q.toLowerCase());
  const list = all
    .filter((r) => (tab === 'templates' ? r.isTemplate : tab === 'archive' ? r.status === 'archived' && !r.isTemplate : !r.isTemplate && r.status !== 'archived'))
    .filter((r) => (tab === 'rundowns' ? (ev ? r.eventId === ev.id : q ? true : !r.eventId || !app.events[r.eventId]) : true))
    .filter(match)
    .sort((a, b) => (sort === 'name' ? a.title.localeCompare(b.title) : sort === 'updated' ? b.updatedAt - a.updatedAt : a.date.localeCompare(b.date) || a.title.localeCompare(b.title)));

  const events = Object.values(app.events)
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const templates = all.filter((r) => r.isTemplate);

  const openNew = (r: Rundown) => {
    store.addRundown({ ...r, eventId: ev?.id ?? null });
    open(r.id);
  };

  return (
    <div className="dash">
      <header className="dash-top">
        <div className="dash-inner">
          <Brand />
          <div className="dash-search">
            <input className="text-input" type="search" placeholder="Event oder Ablauf suchen" aria-label="Suchen" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="menu-actions">
            <button className="btn" onClick={() => store.saveEvent(newEvent())}>
              <Icon name="folder" size={14} /> Neues Event
            </button>
            <button className="btn primary" onClick={create.open}>
              <Icon name="plus" size={14} /> Neuer Ablauf
            </button>
          </div>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-inner col">
          <nav className="crumbs" aria-label="Pfad">
            <button className="link-btn" onClick={() => setEventId(null)}>
              Übersicht
            </button>
            {ev && (
              <>
                <span aria-hidden="true">/</span>
                <EventHeader app={app} id={ev.id} back={() => setEventId(null)} />
              </>
            )}
          </nav>

          {!ev && tab === 'rundowns' && events.length > 0 && (
            <section aria-label="Events">
              <h2 className="dash-h">Events</h2>
              <div className="event-grid">
                {events.map((e) => {
                  const n = all.filter((r) => r.eventId === e.id && !r.isTemplate).length;
                  return (
                    <button key={e.id} className="event-card" onClick={() => setEventId(e.id)}>
                      {e.logo ? <img src={e.logo} alt="" className="event-logo" /> : <Icon name="folder" size={18} />}
                      <span className="event-name">{e.name}</span>
                      <span className="hint small">
                        {n} {n === 1 ? 'Ablauf' : 'Abläufe'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <div className="dash-bar">
            <div className="seg" role="tablist">
              {(
                [
                  ['rundowns', 'Abläufe'],
                  ['templates', 'Vorlagen'],
                  ['archive', 'Archiv'],
                ] as const
              ).map(([id, l]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  {l}
                </button>
              ))}
            </div>
            <label className="sort">
              <span className="eyebrow">Sortieren</span>
              <select className="text-input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="date">nach Datum</option>
                <option value="name">nach Name</option>
                <option value="updated">zuletzt geändert</option>
              </select>
            </label>
          </div>

          <ul className="rd-rows">
            {list.map((r) => (
              <RundownRow key={r.id} r={r} app={app} open={open} />
            ))}
          </ul>
          {!list.length && (
            <p className="empty-note">
              {tab === 'templates'
                ? 'Noch keine Vorlagen. Markiere einen Ablauf in seinen Einstellungen oder im Menü als Vorlage.'
                : tab === 'archive'
                  ? 'Keine archivierten Abläufe.'
                  : 'Keine Abläufe gefunden. Lege mit „Neuer Ablauf“ einen an.'}
            </p>
          )}
        </div>
      </main>

      {create.anchor && (
        <Popover anchor={create.anchor} onClose={create.close} align="end" className="menu wide">
          <div className="menu-list">
            <button onClick={() => (openNew(blankRundown()), create.close())}>
              <Icon name="plus" size={14} /> Leerer Ablauf
            </button>
            <button onClick={() => (openNew(makeSample()), create.close())}>
              <Icon name="plus" size={14} /> Beispiel: Benefiz-Gala
            </button>
            {templates.length > 0 && <span className="eyebrow fix-head">Aus Vorlage</span>}
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  newFromTemplate(t, ev?.id ?? null);
                  create.close();
                  open(store.get().activeId);
                }}
              >
                <Icon name="copy" size={14} /> {t.title}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

function EventHeader({ app, id, back }: { app: AppState; id: string; back: () => void }) {
  const ev = app.events[id];
  const menu = usePopover();
  const [confirm, setConfirm] = useState(false);
  return (
    <span className="event-head">
      <input className="title-field small" aria-label="Name des Events" value={ev.name} onChange={(e) => store.saveEvent({ ...ev, name: e.target.value })} />
      <button className="icon-btn" onClick={menu.open} aria-label="Event-Optionen">
        <Icon name="dots" />
      </button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={() => (menu.close(), setConfirm(false))} className="menu">
          <div className="menu-list">
            <button
              onClick={() => {
                const copy = { ...ev, id: Math.random().toString(36).slice(2, 10), name: `${ev.name} (Kopie)` };
                store.saveEvent(copy);
                for (const r of Object.values(app.rundowns)) if (r.eventId === ev.id) store.addRundown(cloneRundown(r, { eventId: copy.id }), false);
                menu.close();
              }}
            >
              <Icon name="copy" size={14} /> Event mit Abläufen duplizieren
            </button>
            {!confirm ? (
              <button className="danger" onClick={() => setConfirm(true)}>
                <Icon name="trash" size={14} /> Event auflösen
              </button>
            ) : (
              <div className="confirm">
                <span>Das Event verschwindet, seine Abläufe bleiben in der Übersicht erhalten.</span>
                <button
                  className="btn danger-fill small"
                  onClick={() => {
                    store.deleteEvent(ev.id);
                    back();
                  }}
                >
                  Auflösen
                </button>
                <button className="btn small" onClick={() => setConfirm(false)}>
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        </Popover>
      )}
    </span>
  );
}

function RundownRow({ r, app, open }: { r: Rundown; app: AppState; open: (id: string) => void }) {
  const menu = usePopover();
  const [confirm, setConfirm] = useState(false);
  const st = app.live[r.id]?.status ?? 'idle';
  const cues = r.items.filter((i) => isCue(i) && !i.skip).length;
  const set = (patch: Partial<Rundown>) => store.updateRundown(r.id, (x) => ({ ...x, ...patch }));
  return (
    <li className="rd-row">
      <button className="rd-open" onClick={() => open(r.id)}>
        <span className={`dot st-${st}`} aria-hidden="true" />
        <span className="rd-name">{r.title || 'Ohne Titel'}</span>
        <span className="rd-date num">{fmtDate(r.date)}</span>
        <span className="hint small">{cues} Cues</span>
        {r.eventId && app.events[r.eventId] && <span className="hint small">{app.events[r.eventId].name}</span>}
        <span className={`status-pill s-${r.status}`}>{r.isTemplate ? 'Vorlage' : STATUS_LABEL[r.status]}</span>
      </button>
      <button className="icon-btn" onClick={menu.open} aria-label={`Optionen für ${r.title}`}>
        <Icon name="dots" />
      </button>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={() => (menu.close(), setConfirm(false))} align="end" className="menu wide">
          <div className="menu-body">
            <div className="menu-list">
              {r.isTemplate ? (
                <button onClick={() => (newFromTemplate(r), menu.close(), open(store.get().activeId))}>
                  <Icon name="plus" size={14} /> Neuen Ablauf aus Vorlage
                </button>
              ) : (
                <button onClick={() => (open(r.id), menu.close())}>
                  <Icon name="right" size={14} /> Öffnen
                </button>
              )}
              <button onClick={() => (store.addRundown(cloneRundown(r, { title: `${r.title} (Kopie)` }), false), menu.close())}>
                <Icon name="copy" size={14} /> Duplizieren
              </button>
              <button onClick={() => (set({ isTemplate: !r.isTemplate }), menu.close())}>
                <Icon name="script" size={14} /> {r.isTemplate ? 'Keine Vorlage mehr' : 'Als Vorlage verwenden'}
              </button>
            </div>
            <label className="set-field">
              <span className="eyebrow">Event</span>
              <select className="text-input" value={r.eventId ?? ''} onChange={(e) => set({ eventId: e.target.value || null })}>
                <option value="">Kein Event</option>
                {Object.values(app.events).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="seg" role="radiogroup" aria-label="Status">
              {(Object.keys(STATUS_LABEL) as RundownStatus[]).map((k) => (
                <button key={k} role="radio" aria-checked={r.status === k} className={r.status === k ? 'on' : ''} onClick={() => set({ status: k })}>
                  {STATUS_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="menu-list">
              {!confirm ? (
                <button className="danger" onClick={() => setConfirm(true)}>
                  <Icon name="trash" size={14} /> Löschen
                </button>
              ) : (
                <div className="confirm">
                  <span>„{r.title}“ wird {app.syncStatus === 'online' ? 'auf allen Geräten' : 'in diesem Browser'} gelöscht.</span>
                  <button className="btn danger-fill small" onClick={() => (store.deleteRundown(r.id), menu.close())}>
                    Löschen
                  </button>
                  <button className="btn small" onClick={() => setConfirm(false)}>
                    Abbrechen
                  </button>
                </div>
              )}
            </div>
          </div>
        </Popover>
      )}
    </li>
  );
}
