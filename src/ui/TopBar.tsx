import React, { useRef, useState } from 'react';
import { LiveState, Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtClock, fmtCountdown, fmtDate, fmtDur, parseDur } from '../time';
import { AppState, now as clockNow, store } from '../store';
import * as L from '../live';
import { ClockInput, Icon, Popover, Toggle, usePopover } from './common';
import { RundownSwitcher } from './Dialogs';

export type View = 'ablauf' | 'timer' | 'prompter';

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
      <span className="brand-name">Taktgeber</span>
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
  openDialog: (d: 'io' | 'help') => void;
}) {
  const sw = usePopover();
  const more = usePopover();
  const [confirmReset, setConfirmReset] = useState(false);
  const locked = app.ui.locked;
  const ou = tl.overUnder;
  const syncLabel =
    app.syncStatus === 'online'
      ? `Verbunden · ${app.peers} ${app.peers === 1 ? 'Gerät' : 'Geräte'}`
      : app.syncStatus === 'offline'
        ? 'Verbindung getrennt'
        : app.syncStatus === 'connecting'
          ? 'Verbinde …'
          : 'Lokal';

  return (
    <>
    <header className="top">
      <div className="top-inner">
        <Brand />
        <div className="rd-title">
          <button className="icon-btn" onClick={sw.open} aria-label="Abläufe anzeigen" title="Abläufe">
            <Icon name="list" />
          </button>
          <input className="title-field" value={r.title} readOnly={locked} aria-label="Name des Ablaufs" onChange={(e) => store.updateRundown(r.id, (x) => ({ ...x, title: e.target.value }), `rt:${r.id}`)} />
        </div>
        <div className="rd-meta">
          <label className="meta-field">
            <span className="eyebrow">Datum</span>
            {locked ? (
              <span className="num">{fmtDate(r.date)}</span>
            ) : (
              <input type="date" className="date-input" value={r.date} onChange={(e) => e.target.value && store.updateRundown(r.id, (x) => ({ ...x, date: e.target.value }))} />
            )}
          </label>
          <div className="meta-field">
            <span className="eyebrow">Showbeginn</span>
            <ClockInput value={r.start} readOnly={locked} onChange={(v) => store.updateRundown(r.id, (x) => ({ ...x, start: v }))} label="Showbeginn" />
          </div>
          <div className="meta-field">
            <span className="eyebrow">Ende</span>
            <span className={`num ${ou >= 1000 ? 'late' : ou <= -1000 ? 'early' : ''}`} title="Voraussichtliches Ende und Abweichung vom geplanten Ende">
              {fmtClock(tl.calcEnd, false)} {Math.abs(ou) >= 1000 && <small>{ou > 0 ? '+' : '−'}{fmtDur(Math.abs(ou))}</small>}
            </span>
          </div>
          <div className="meta-field">
            <span className="eyebrow">Tageszeit</span>
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

        <button className="icon-btn" onClick={more.open} aria-label="Weitere Funktionen" title="Mehr">
          <Icon name="dots" />
        </button>
      </div>

      {sw.anchor && (
        <Popover anchor={sw.anchor} onClose={sw.close} className="menu wide">
          <RundownSwitcher app={app} close={sw.close} />
        </Popover>
      )}

      {more.anchor && (
        <Popover anchor={more.anchor} onClose={() => (more.close(), setConfirmReset(false))} align="end" className="menu">
          <div className="menu-list">
            <button onClick={() => (openDialog('io'), more.close())}>
              <Icon name="io" size={14} /> Import & Export
            </button>
            <button onClick={() => (openDialog('help'), more.close())}>
              <Icon name="keyboard" size={14} /> Tastenkürzel
            </button>
            {!__ARTIFACT__ && (
              <>
                <a href="#timer" target="_blank" rel="noopener" onClick={more.close}>
                  <Icon name="window" size={14} /> Timer in neuem Fenster
                </a>
                <a href="#prompter" target="_blank" rel="noopener" onClick={more.close}>
                  <Icon name="window" size={14} /> Prompter in neuem Fenster
                </a>
                <button onClick={() => (more.close(), setTimeout(() => window.print(), 50))}>
                  <Icon name="script" size={14} /> Drucken / PDF
                </button>
              </>
            )}
            {!confirmReset ? (
              <button className="danger" onClick={() => setConfirmReset(true)}>
                <Icon name="reset" size={14} /> Show-Timing zurücksetzen
              </button>
            ) : (
              <div className="confirm">
                <span>Gelaufene Zeiten werden gelöscht, der erste Cue steht wieder bereit.</span>
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
            )}
          </div>
        </Popover>
      )}
    </header>
    {view === 'ablauf' && <Transport r={r} live={live} tl={tl} app={app} />}
    </>
  );
}

/* ---------- Transportleiste ---------- */
function Transport({ r, live, tl, app }: { r: Rundown; live: LiveState; tl: Timeline; app: AppState }) {
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
                <span className="num muted">#{tl.cues[cur.cue.id]?.num}</span>
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

        <span className={`big-timer num ${timerState} ${live.status === 'paused' ? 'paused' : ''}`}>{cd ? cd.text : tl.next ? fmtDur(tl.next.duration) : '--:--'}</span>

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
            <button className="ctl end" onClick={() => set((l) => L.end(l, clockNow()))} title="Show beenden (Umschalt+E)">
              <Icon name="stop" size={16} /> <span>Ende</span>
            </button>
          )}
          <div className="adj">
            <button className="ctl small" disabled={!cur} onClick={() => set((l) => L.adjust(l, -60_000))} title="Aktuellen Cue um 1 Minute kürzen (−)">
              −1m
            </button>
            <button className="ctl small" disabled={!cur} onClick={() => set((l) => L.adjust(l, 60_000))} title="Aktuellen Cue um 1 Minute verlängern (+)">
              +1m
            </button>
            <button className="ctl small chev" disabled={!cur} onClick={adj.open} aria-label="Zeit genau anpassen" title="Zeit genau anpassen">
              <Icon name="chevron" size={14} />
            </button>
          </div>
          <button className={`ctl small ${live.message ? 'has-msg' : ''}`} onClick={msg.open} title="Nachricht an die Bühne" aria-label="Nachricht an die Bühne">
            <Icon name="message" size={16} />
          </button>
        </div>

        <div className="toggles">
          <button className={`chip-btn ${app.ui.follow ? 'on' : ''}`} aria-pressed={app.ui.follow} onClick={() => store.setUi({ follow: !app.ui.follow })} title="Zum laufenden Cue mitscrollen (F)">
            <Icon name="follow" size={14} /> Mitlaufen
          </button>
          <button className={`chip-btn ${app.ui.locked ? 'on warn' : ''}`} aria-pressed={app.ui.locked} onClick={() => store.setUi({ locked: !app.ui.locked })} title="Ablauf gegen versehentliche Änderungen sperren (L)">
            <Icon name={app.ui.locked ? 'lock' : 'unlock'} size={14} /> {app.ui.locked ? 'Gesperrt' : 'Sperren'}
          </button>
          <button className="chip-btn" disabled={!app.undoDepth || app.ui.locked} onClick={() => store.undo(r.id)} title="Rückgängig (Strg/Cmd+Z)">
            Rückgängig
          </button>
        </div>
      </div>

      {adj.anchor && (
        <Popover anchor={adj.anchor} onClose={adj.close} align="end" className="menu">
          <AdjustPanel apply={(d) => set((l) => L.adjust(l, d))} adjustNow={live.adjust} />
        </Popover>
      )}
      {msg.anchor && (
        <Popover anchor={msg.anchor} onClose={msg.close} align="end" className="menu wide">
          <MessagePanel live={live} set={set} close={msg.close} />
        </Popover>
      )}
    </div>
  );
}

function AdjustPanel({ apply, adjustNow }: { apply: (delta: number) => void; adjustNow: number }) {
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
      <span className="eyebrow">Aktuellen Cue anpassen {adjustNow !== 0 && <span className="num">({adjustNow > 0 ? '+' : '−'}{fmtDur(Math.abs(adjustNow))})</span>}</span>
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
        <input className="text-input num" placeholder="z. B. 1:30" aria-label="Eigener Wert" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button className="btn small" disabled={v == null} onClick={() => v != null && apply(-v)}>
          −
        </button>
        <button className="btn small" disabled={v == null} onClick={() => v != null && apply(v)}>
          +
        </button>
      </div>
    </div>
  );
}

function MessagePanel({ live, set, close }: { live: LiveState; set: (fn: (l: LiveState) => LiveState) => void; close: () => void }) {
  const [text, setText] = useState(live.message);
  const [flash, setFlash] = useState(live.flash);
  const ref = useRef<HTMLTextAreaElement>(null);
  const presets = ['Bitte zum Ende kommen', 'Noch 1 Minute', 'Lauter sprechen', 'Fragen aus dem Publikum'];
  return (
    <div className="menu-body">
      <span className="eyebrow">Nachricht im Timer anzeigen</span>
      <textarea ref={ref} id="stage-message" className="text-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text für die Bühne" />
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
            set((l) => ({ ...l, message: text.trim(), flash }));
            close();
          }}
        >
          Anzeigen
        </button>
        <button
          className="btn"
          disabled={!live.message}
          onClick={() => {
            set((l) => ({ ...l, message: '', flash: false }));
            setText('');
            close();
          }}
        >
          Ausblenden
        </button>
      </div>
    </div>
  );
}
