import React, { useRef, useState } from 'react';
import { LiveState, Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtClock, fmtCountdown, fmtDate, fmtDur, parseDur } from '../time';
import { AppState, now as clockNow, store } from '../store';
import * as L from '../live';
import { sync } from '../sync';
import { ClockInput, DurationInput, Icon, Popover, Toggle, usePopover } from './common';
import { ROLE_LABEL, UserMenu, initials } from './Account';
import { RundownSwitcher } from './Dialogs';

export type View = 'uebersicht' | 'ablauf' | 'timer' | 'prompter' | 'code';
export type DialogId = 'io' | 'help' | 'settings' | 'variables' | 'mentions' | 'trash' | 'share' | 'api' | 'users' | 'password';

export const VIEWS: { id: View; label: string }[] = [
  { id: 'ablauf', label: 'Ablauf' },
  { id: 'timer', label: 'Timer' },
  { id: 'prompter', label: 'Prompter' },
];

export function Brand() {
  return (
    <span className="brand" aria-label="Taktgeber">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 13V7.5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M9.5 2.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="brand-name" translate="no">Taktgeber</span>
    </span>
  );
}

export function TopBar({
  r,
  live,
  tl,
  now,
  view,
  setView,
  app,
  openDialog,
}: {
  r: Rundown;
  live: LiveState;
  tl: Timeline;
  now: number;
  view: View;
  setView: (v: View) => void;
  app: AppState;
  openDialog: (d: DialogId) => void;
}) {
  const sw = usePopover();
  const more = usePopover();
  const view_ = usePopover();
  const um = usePopover();
  const [confirmReset, setConfirmReset] = useState(false);
  const locked = app.ui.locked;
  const readonly = app.share?.mode === 'view';
  const guest = !!app.share;
  const ou = tl.overUnder;
  const syncLabel =
    app.syncStatus === 'online'
      ? `Verbunden · ${app.peers} ${app.peers === 1 ? 'Gerät' : 'Geräte'}`
      : app.syncStatus === 'offline'
        ? 'Verbindung getrennt'
        : app.syncStatus === 'connecting'
          ? 'Verbinde …'
          : 'Lokal';
  const ev = r.eventId ? app.events[r.eventId] : null;
  const logo = r.settings.logo || ev?.logo;

  return (
    <>
      <header className="top">
        <div className="top-inner">
          {guest ? <Brand /> : (
            <button className="brand-btn" onClick={() => setView('uebersicht')} title="Übersicht (0)">
              <Brand />
            </button>
          )}
          {logo && <img src={logo} alt="" className="top-logo" width={120} height={28} />}
          <div className="rd-title">
            {!guest && (
              <button className="icon-btn" onClick={sw.open} aria-label="Abläufe anzeigen" title="Abläufe">
                <Icon name="list" />
              </button>
            )}
            <div className="title-col">
              {ev && <span className="crumb">{ev.name}</span>}
              <input autoComplete="off" className="title-field" value={r.title} readOnly={locked} aria-label="Name des Ablaufs" onChange={(e) => store.updateRundown(r.id, (x) => ({ ...x, title: e.target.value }), `rt:${r.id}`)} />
            </div>
            {readonly && <span className="status-pill s-view">Nur ansehen</span>}
          </div>
          <div className="rd-meta">
            <label className="meta-field">
              <span className="eyebrow">Datum</span>
              {locked ? (
                <span className="num">{fmtDate(r.date)}</span>
              ) : (
                <input autoComplete="off" type="date" className="date-input" value={r.date} onChange={(e) => e.target.value && store.updateRundown(r.id, (x) => ({ ...x, date: e.target.value }))} />
              )}
            </label>
            <div className="meta-field">
              <span className="eyebrow">Showbeginn</span>
              <ClockInput value={r.start} readOnly={locked} onChange={(v) => store.updateRundown(r.id, (x) => ({ ...x, start: v }))} label="Showbeginn" />
            </div>
            <div className="meta-field">
              <span className="eyebrow">Ende</span>
              <span className={`num ${ou >= 1000 ? 'late' : ou <= -1000 ? 'early' : ''}`} title="Voraussichtliches Ende und Abweichung vom geplanten Ende">
                {fmtClock(tl.calcEnd, false)}{' '}
                {Math.abs(ou) >= 1000 && (
                  <small>
                    {ou > 0 ? '+' : '−'}
                    {fmtDur(Math.abs(ou))}
                  </small>
                )}
              </span>
            </div>
            <div className="meta-field">
              <span className="eyebrow">Tageszeit{r.settings.timezone ? ` (${r.settings.timezone.split('/').pop()?.replace(/_/g, ' ')})` : ''}</span>
              <span className="num clock">{fmtClock(now)}</span>
            </div>
          </div>

          <nav className="views seg" aria-label="Ansicht">
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? 'on' : ''} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </nav>

          <span className={`sync-chip s-${app.syncStatus}`} title={app.syncStatus === 'local' ? 'Daten liegen nur in diesem Browser. Mit dem Taktgeber-Server laufen alle Geräte synchron.' : syncLabel}>
            <span className="dot" aria-hidden="true" />
            {syncLabel}
          </span>

          <button className="icon-btn" onClick={view_.open} aria-label="Ansicht" title="Ansicht">
            <Icon name="eye" />
          </button>
          <button className="icon-btn" onClick={more.open} aria-label="Weitere Funktionen" title="Mehr">
            <Icon name="dots" />
          </button>
          {!guest && (
            <button className="user-btn" onClick={um.open} aria-label="Konto" title={`${app.user?.name || app.user?.email || 'Admin'} · ${ROLE_LABEL[app.role]}`}>
              <span className="avatar small" aria-hidden="true">
                {initials(app.user?.name || app.user?.email || 'A')}
              </span>
              <span className="user-role">{ROLE_LABEL[app.role]}</span>
            </button>
          )}
        </div>

        {view_.anchor && (
          <Popover anchor={view_.anchor} onClose={view_.close} align="end" className="menu">
            <ViewMenu app={app} />
          </Popover>
        )}
        {um.anchor && (
          <Popover anchor={um.anchor} onClose={um.close} align="end" className="menu">
            <UserMenu app={app} close={um.close} openUsers={() => openDialog('users')} openPassword={() => openDialog('password')} />
          </Popover>
        )}

        {sw.anchor && (
          <Popover anchor={sw.anchor} onClose={sw.close} className="menu wide">
            <RundownSwitcher app={app} close={sw.close} openOverview={() => setView('uebersicht')} />
          </Popover>
        )}

        {more.anchor && (
          <Popover anchor={more.anchor} onClose={() => (more.close(), setConfirmReset(false))} align="end" className="menu">
            <div className="menu-list">
              {!guest && (
                <button onClick={() => (setView('uebersicht'), more.close())}>
                  <Icon name="home" size={14} /> Übersicht
                </button>
              )}
              {!readonly && (
                <>
                  <button onClick={() => (openDialog('settings'), more.close())}>
                    <Icon name="settings" size={14} /> Einstellungen
                  </button>
                  <button onClick={() => (openDialog('variables'), more.close())}>
                    <Icon name="variable" size={14} /> Text-Variablen
                  </button>
                  <button onClick={() => (openDialog('mentions'), more.close())}>
                    <Icon name="at" size={14} /> Erwähnungen
                  </button>
                </>
              )}
              {!guest && (app.role === 'editor' || app.role === 'admin') && (
                <>
                  <button onClick={() => (openDialog('share'), more.close())}>
                    <Icon name="share" size={14} /> Gäste einladen
                  </button>
                  <button onClick={() => (openDialog('api'), more.close())}>
                    <Icon name="keyboard" size={14} /> API & Integrationen
                  </button>
                </>
              )}
              <button onClick={() => (openDialog('io'), more.close())}>
                <Icon name="io" size={14} /> Import & Export
              </button>
              {!readonly && (
                <button onClick={() => (openDialog('trash'), more.close())}>
                  <Icon name="trash" size={14} /> Papierkorb {r.trash.length > 0 && <span className="count">{r.trash.length}</span>}
                </button>
              )}
              <button onClick={() => (openDialog('help'), more.close())}>
                <Icon name="keyboard" size={14} /> Tastenkürzel
              </button>
              {!__ARTIFACT__ && (
                <>
                  <a href={`${location.search}#timer`} target="_blank" rel="noopener" onClick={more.close}>
                    <Icon name="window" size={14} /> Timer in neuem Fenster
                  </a>
                  <a href={`${location.search}#prompter`} target="_blank" rel="noopener" onClick={more.close}>
                    <Icon name="window" size={14} /> Prompter in neuem Fenster
                  </a>
                  <button onClick={() => (more.close(), setTimeout(() => window.print(), 50))}>
                    <Icon name="script" size={14} /> Drucken / PDF
                  </button>
                </>
              )}
              {!readonly &&
                (!confirmReset ? (
                  <button className="danger" onClick={() => setConfirmReset(true)}>
                    <Icon name="reset" size={14} /> Show-Timing zurücksetzen
                  </button>
                ) : (
                  <div className="confirm">
                    <span>Gelaufene Zeiten und Unter-Timer werden gelöscht, der erste Cue steht wieder bereit.</span>
                    <button
                      className="btn danger-fill small"
                      onClick={() => {
                        store.setLive(r.id, L.reset);
                        more.close();
                        setConfirmReset(false);
                      }}
                    >
                      Zurücksetzen
                    </button>
                    <button className="btn small" onClick={() => setConfirmReset(false)}>
                      Abbrechen
                    </button>
                  </div>
                ))}
            </div>
          </Popover>
        )}
      </header>
      {view === 'ablauf' && <Transport r={r} live={live} tl={tl} app={app} now={now} readonly={readonly} />}
    </>
  );
}

/* ---------- Fortschritts-Leiste über alle Cues ---------- */
function ShowStrip({ r, tl, now }: { r: Rundown; tl: Timeline; now: number }) {
  const list = L.playable(r);
  const total = list.reduce((s, c) => s + Math.max(c.duration, 1000), 0) || 1;
  return (
    <div className="strip" aria-hidden="true">
      {list.map((c) => {
        const t = tl.cues[c.id];
        const w = (Math.max(c.duration, 1000) / total) * 100;
        const prog = t.status === 'done' || t.status === 'missed' ? 1 : t.status === 'current' && tl.current ? tl.current.progress : 0;
        return (
          <span key={c.id} className={`seg-cue st-${t.status} tint-${c.color || 'none'}`} style={{ flex: `${w} 1 0` }} title={`${t.label} ${c.title}`}>
            {prog > 0 && <span className="seg-fill" style={{ transform: `scaleX(${prog})` }} />}
          </span>
        );
      })}
      {tl.current && tl.current.remaining < 0 && <span className="strip-over" title={`Überzeit ${fmtDur(-tl.current.remaining)}`} />}
      <span className="sr-only">{fmtClock(now)}</span>
    </div>
  );
}

/* ---------- Transportleiste ---------- */
function Transport({ r, live, tl, app, now, readonly }: { r: Rundown; live: LiveState; tl: Timeline; app: AppState; now: number; readonly: boolean }) {
  const adj = usePopover();
  const msg = usePopover();
  const cur = tl.current;
  const cd = cur ? fmtCountdown(cur.remaining) : null;
  const running = live.status === 'running';
  const set = (fn: (l: LiveState) => LiveState) => store.setLive(r.id, fn);
  const statusLabel = { idle: 'Bereit', running: 'Live', paused: 'Pause', ended: 'Beendet' }[live.status];
  const timerState = cd?.over ? 'over' : cur && cur.remaining <= r.warnAt ? 'warn' : '';

  return (
    <div className="transport">
      <div className="transport-inner">
        <span className={`status-chip st-${live.status}`}>{statusLabel}</span>

        <div className="now-block" aria-live="polite">
          {cur ? (
            <>
              <div className="now-line">
                <span className="num muted">{tl.cues[cur.cue.id]?.label}</span>
                <span className="now-title">{cur.cue.title || 'Ohne Titel'}</span>
              </div>
              <div className="now-bar" aria-hidden="true">
                <span className={timerState} style={{ transform: `scaleX(${cur.progress})` }} />
              </div>
            </>
          ) : (
            <div className="now-line">
              <span className="now-title muted">{live.status === 'ended' ? 'Show beendet' : tl.next ? `Startbereit: ${tl.next.title || 'Ohne Titel'}` : 'Keine Cues'}</span>
            </div>
          )}
          {tl.next && cur && (
            <div className="next-line">
              Als Nächstes: <b>{tl.next.title || 'Ohne Titel'}</b> <span className="num">{fmtDur(tl.next.duration)}</span>
              {live.nextId && <span className="tag">vorgemerkt</span>}
            </div>
          )}
        </div>

        {live.showStart && live.status !== 'idle' && (
          <span className="live-since" title="Seit Showbeginn">
            <span className="eyebrow">{live.status === 'ended' ? 'Dauer' : 'Live seit'}</span>
            <span className="num">{fmtDur((live.status === 'ended' ? live.showEnd ?? now : now) - live.showStart)}</span>
          </span>
        )}
        <span className={`big-timer num ${timerState} ${live.status === 'paused' ? 'paused' : ''}`}>{cd ? cd.text : tl.next ? fmtDur(tl.next.duration) : '--:--'}</span>

        {!readonly && (
          <div className="controls" role="group" aria-label="Show-Steuerung">
            <button className="ctl" onClick={() => set((l) => L.prev(r, l, clockNow()))} disabled={!cur} title="Vorheriger Cue (B)" aria-label="Vorheriger Cue">
              <Icon name="prev" size={18} />
            </button>
            <button className={`ctl play ${running ? 'is-running' : ''}`} onClick={() => set((l) => L.togglePlay(r, l, clockNow()))} disabled={!cur && !tl.next} title={running ? 'Pause (P)' : 'Start / Fortsetzen (P)'} aria-label={running ? 'Pause' : 'Start'}>
              <Icon name={running ? 'pause' : 'play'} size={20} />
            </button>
            {tl.next || !cur ? (
              <button className="ctl go" onClick={() => set((l) => L.next(r, l, clockNow()))} disabled={!tl.next} title="Nächster Cue (Leertaste)">
                <Icon name="next" size={18} /> <span>Nächster</span>
              </button>
            ) : (
              <button className="ctl end" onClick={() => set((l) => L.end(l, clockNow(), r))} title="Show beenden (Umschalt+E)">
                <Icon name="stop" size={16} /> <span>Ende</span>
              </button>
            )}
            <div className="adj">
              <button className="ctl small" disabled={!cur} onClick={() => set((l) => L.adjust(l, -app.ui.step))} title={`Aktuellen Cue um ${stepLabel(app.ui.step)} kürzen (−)`}>
                −{stepLabel(app.ui.step)}
              </button>
              <button className="ctl small" disabled={!cur} onClick={() => set((l) => L.adjust(l, app.ui.step))} title={`Aktuellen Cue um ${stepLabel(app.ui.step)} verlängern (+)`}>
                +{stepLabel(app.ui.step)}
              </button>
              <button className="ctl small chev" disabled={!cur} onClick={adj.open} aria-label="Zeit genau anpassen" title="Zeit genau anpassen">
                <Icon name="chevron" size={14} />
              </button>
            </div>
            <button className={`ctl small ${live.message && live.messageVisible ? 'has-msg' : ''}`} onClick={msg.open} title="Nachricht an die Bühne" aria-label="Nachricht an die Bühne">
              <Icon name="message" size={16} />
            </button>
          </div>
        )}

        <div className="toggles">
          <button className={`chip-btn ${app.ui.follow ? 'on' : ''}`} aria-pressed={app.ui.follow} onClick={() => store.setUi({ follow: !app.ui.follow })} title="Zum laufenden Cue mitscrollen (F)">
            <Icon name="follow" size={14} /> Mitlaufen
          </button>
          {!readonly && (
            <>
              <button className={`chip-btn ${app.ui.locked ? 'on warn' : ''}`} aria-pressed={app.ui.locked} onClick={() => store.setUi({ locked: !app.ui.locked })} title="Ablauf gegen versehentliche Änderungen sperren (L)">
                <Icon name={app.ui.locked ? 'lock' : 'unlock'} size={14} /> {app.ui.locked ? 'Gesperrt' : 'Sperren'}
              </button>
              <button className="chip-btn" disabled={!app.undoDepth || app.ui.locked} onClick={() => store.undo(r.id)} title="Rückgängig (Strg/Cmd+Z)">
                Rückgängig
              </button>
            </>
          )}
        </div>
      </div>
      <ShowStrip r={r} tl={tl} now={now} />

      {adj.anchor && (
        <Popover anchor={adj.anchor} onClose={adj.close} align="end" className="menu">
          <AdjustPanel
            apply={(d) => set((l) => L.adjust(l, d))}
            adjustNow={live.adjust}
            remaining={cur ? Math.max(0, cur.remaining) : 0}
            duration={cur ? cur.duration : 0}
            setRemaining={(ms) => set((l) => L.setRemaining(r, l, ms, clockNow()))}
            setDuration={(ms) => set((l) => L.setDuration(r, l, ms))}
            step={app.ui.step}
          />
        </Popover>
      )}
      {msg.anchor && (
        <Popover anchor={msg.anchor} onClose={msg.close} align="end" className="menu wide">
          <MessagePanel live={live} set={set} close={msg.close} />
        </Popover>
      )}
      {sync.isShareLink && null}
    </div>
  );
}

export const stepLabel = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`);
const STEPS = [10_000, 30_000, 60_000, 300_000, 600_000];

function AdjustPanel({
  apply,
  adjustNow,
  remaining,
  duration,
  setRemaining,
  setDuration,
  step,
}: {
  apply: (delta: number) => void;
  adjustNow: number;
  remaining: number;
  duration: number;
  setRemaining: (ms: number) => void;
  setDuration: (ms: number) => void;
  step: number;
}) {
  const [custom, setCustom] = useState('');
  const steps: [number, string][] = [
    [10_000, '10 s'],
    [30_000, '30 s'],
    [60_000, '1 min'],
    [300_000, '5 min'],
    [600_000, '10 min'],
  ];
  const v = parseDur(custom);
  return (
    <div className="menu-body adjust">
      <span className="eyebrow">
        Aktuellen Cue anpassen{' '}
        {adjustNow !== 0 && (
          <span className="num">
            ({adjustNow > 0 ? '+' : '−'}
            {fmtDur(Math.abs(adjustNow))})
          </span>
        )}
      </span>
      <div className="adj-grid">
        {steps.map(([ms, l]) => (
          <React.Fragment key={ms}>
            <button className="btn small" onClick={() => apply(-ms)}>
              −{l}
            </button>
            <button className="btn small" onClick={() => apply(ms)}>
              +{l}
            </button>
          </React.Fragment>
        ))}
      </div>
      <div className="field-row">
        <input autoComplete="off" className="text-input num" placeholder="z. B. 1:30…" aria-label="Eigener Wert" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn small" disabled={v == null} onClick={() => v != null && apply(-v)}>
          −
        </button>
        <button className="btn small" disabled={v == null} onClick={() => v != null && apply(v)}>
          +
        </button>
      </div>
      <div className="adj-set">
        <label className="set-field">
          <span className="eyebrow">Restzeit setzen</span>
          <DurationInput value={Math.round(remaining / 1000) * 1000} onChange={setRemaining} label="Restzeit setzen" className="wide" />
        </label>
        <label className="set-field">
          <span className="eyebrow">Dauer (nur live)</span>
          <DurationInput value={duration} onChange={setDuration} label="Dauer für diesen Durchlauf" className="wide" />
        </label>
      </div>
      <div className="set-field">
        <span className="eyebrow">Schrittweite der ±-Knöpfe</span>
        <div className="seg" role="radiogroup" aria-label="Schrittweite">
          {STEPS.map((ms) => (
            <button key={ms} role="radio" aria-checked={step === ms} className={step === ms ? 'on' : ''} onClick={() => store.setUi({ step: ms })}>
              {stepLabel(ms)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Ansicht ---------- */
function ViewMenu({ app }: { app: AppState }) {
  const ui = app.ui;
  return (
    <div className="menu-body">
      <div className="set-field">
        <span className="eyebrow">Darstellung</span>
        <div className="seg" role="radiogroup" aria-label="Darstellung">
          {(
            [
              ['system', 'Wie System'],
              ['light', 'Hell'],
              ['dark', 'Dunkel'],
            ] as const
          ).map(([id, l]) => (
            <button key={id} role="radio" aria-checked={ui.theme === id} className={ui.theme === id ? 'on' : ''} onClick={() => store.setUi({ theme: id })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Toggle id="v-compact" on={ui.compact} onChange={(v) => store.setUi({ compact: v })}>
        Kompakte Zeilen
      </Toggle>
      <Toggle id="v-hidedone" on={ui.hideDone} onChange={(v) => store.setUi({ hideDone: v })}>
        Erledigte Cues ausblenden
      </Toggle>
      <Toggle id="v-follow" on={ui.follow} onChange={(v) => store.setUi({ follow: v })}>
        Mitlaufen
        <small>scrollt beim Weiterschalten zum laufenden Cue</small>
      </Toggle>
      <div className="seg" role="radiogroup" aria-label="Position beim Mitlaufen">
        <button role="radio" aria-checked={ui.followPos === 'top'} className={ui.followPos === 'top' ? 'on' : ''} onClick={() => store.setUi({ followPos: 'top' })}>
          Laufender Cue oben
        </button>
        <button role="radio" aria-checked={ui.followPos === 'center'} className={ui.followPos === 'center' ? 'on' : ''} onClick={() => store.setUi({ followPos: 'center' })}>
          in der Mitte
        </button>
      </div>
    </div>
  );
}

function MessagePanel({ live, set, close }: { live: LiveState; set: (fn: (l: LiveState) => LiveState) => void; close: () => void }) {
  const [text, setText] = useState(live.message);
  const [flash, setFlash] = useState(live.flash);
  const [bold, setBold] = useState(live.msgBold);
  const [underline, setUnderline] = useState(live.msgUnderline);
  const [color, setColor] = useState(live.msgColor);
  const ref = useRef<HTMLTextAreaElement>(null);
  const presets = ['Bitte zum Ende kommen', 'Noch 1 Minute', 'Lauter sprechen', 'Fragen aus dem Publikum'];
  const apply = (visible: boolean) => set((l) => ({ ...l, message: text.trim(), messageVisible: visible && !!text.trim(), flash, msgBold: bold, msgUnderline: underline, msgColor: color }));
  return (
    <div className="menu-body">
      <span className="eyebrow">Nachricht im Timer anzeigen</span>
      <div className="fmt-row" role="toolbar" aria-label="Formatierung">
        <button className={`chip-btn ${bold ? 'on' : ''}`} aria-pressed={bold} onClick={() => setBold(!bold)}>
          <b>F</b>ett
        </button>
        <button className={`chip-btn ${underline ? 'on' : ''}`} aria-pressed={underline} onClick={() => setUnderline(!underline)}>
          <u>Unterstrichen</u>
        </button>
        <div className="seg" role="radiogroup" aria-label="Textfarbe">
          <button role="radio" aria-checked={color === 'white'} className={color === 'white' ? 'on' : ''} onClick={() => setColor('white')}>
            Weiß
          </button>
          <button role="radio" aria-checked={color === 'red'} className={color === 'red' ? 'on' : ''} onClick={() => setColor('red')}>
            Rot
          </button>
        </div>
      </div>
      <textarea autoComplete="off" ref={ref} id="stage-message" className="text-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text für die Bühne…" />
      <div className="preset-row">
        {presets.map((p) => (
          <button key={p} className="chip-btn" onClick={() => setText(p)}>
            {p}
          </button>
        ))}
      </div>
      <Toggle id="msg-flash" on={flash} onChange={setFlash}>
        Blinken
      </Toggle>
      <div className="menu-actions">
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            apply(true);
            close();
          }}
        >
          Anzeigen
        </button>
        <button
          className="btn"
          disabled={!live.messageVisible}
          onClick={() => {
            apply(false);
            close();
          }}
        >
          Ausblenden
        </button>
      </div>
    </div>
  );
}
