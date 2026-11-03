import React, { useEffect, useState } from 'react';
import { LiveState, OutputConfig, Rundown, isCue } from '../types';
import { Timeline } from '../timing';
import { fmtClock, fmtCountdown, fmtDur } from '../time';
import { store } from '../store';
import * as L from '../live';
import { defaultOutput } from '../model';
import { Icon, RichText, Toggle } from './common';

export function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const req = () =>
      nav.wakeLock
        ?.request('screen')
        .then((l) => (lock = l))
        .catch(() => {});
    req();
    const vis = () => document.visibilityState === 'visible' && req();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lock?.release().catch(() => {});
    };
  }, []);
}

export function toggleFullscreen(el: HTMLElement | null) {
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el?.requestFullscreen?.().catch(() => {});
  } catch {
    /* Vollbild nicht verfügbar */
  }
}

/** Countdown-Schriftgröße passend zur Zeichenzahl */
const timerSize = (text: string) => `min(${Math.round(110 / Math.max(5, text.length))}vw, 38vh)`;

/** Bühnen-Timer für Moderation, Regie oder einen zweiten Bildschirm */
export function OutputView({ r, live, tl, now, readonly }: { r: Rundown; live: LiveState; tl: Timeline; now: number; readonly: boolean }) {
  useWakeLock();
  const [config, setConfig] = useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const o = r.output;
  const cur = tl.current;
  const logo = r.settings.logo || (r.eventId ? store.get().events[r.eventId]?.logo : '');

  let big = '--:--';
  let state = 'idle';
  let label = '';
  let title = '';
  if (cur) {
    const cd = fmtCountdown(cur.remaining);
    big = cd.text;
    state = cd.over ? 'over' : cur.remaining <= r.warnAt ? 'warn' : 'ok';
    title = cur.cue.title || 'Ohne Titel';
    label = cur.cue.subtitle;
  } else if (live.status === 'ended') {
    big = fmtClock(tl.calcEnd, false);
    title = 'Show beendet';
    label = Math.abs(tl.overUnder) >= 1000 ? (tl.overUnder > 0 ? `${fmtDur(tl.overUnder)} später als geplant` : `${fmtDur(-tl.overUnder)} früher als geplant`) : 'Pünktlich';
    state = 'ended';
  } else {
    const toStart = tl.showStart - now;
    big = toStart > 0 ? fmtCountdown(toStart).text : tl.next ? fmtDur(tl.next.duration) : '--:--';
    title = toStart > 0 ? `Showbeginn ${fmtClock(tl.showStart, false)}` : 'Bereit';
    label = tl.next ? `Erster Cue: ${tl.next.title}` : '';
  }

  // Unter-Timer, die im Timer erscheinen sollen und gerade laufen bzw. pausiert sind
  const subs = cur
    ? cur.cue.subTimers
        .filter((t) => t.showOnOutput)
        .map((t) => ({ t, v: L.subElapsed(t, cur.cue, live, now) }))
        .filter((x) => x.v.running || x.v.elapsed > 0)
    : [];

  const lastFive = cur && o.showLastFive && cur.remaining > 0 && cur.remaining <= 5000 ? Math.ceil(cur.remaining / 1000) : 0;
  const ou = tl.overUnder;
  const transform = [o.mirrorH ? 'scaleX(-1)' : '', o.mirrorV ? 'scaleY(-1)' : ''].join(' ').trim();

  const header = (
    <div className="out-top">
      <span className="out-head-left">
        {o.showLogo && logo && <img src={logo} alt="" className="out-logo" width={200} height={48} />}
        {o.showTitle && <span className="out-show">{r.title}</span>}
      </span>
      {o.layout === 'list' && o.showCueTimer && cur && <span className={`num out-head-timer ${state}`}>{big}</span>}
      {o.showOverUnder && live.status !== 'idle' && (
        <span className={`out-ou num ${ou >= 1000 ? 'late' : ou <= -1000 ? 'early' : ''}`}>Show {Math.abs(ou) < 1000 ? 'pünktlich' : ou > 0 ? `+${fmtDur(ou)}` : `−${fmtDur(-ou)}`}</span>
      )}
      {o.showClock && <span className="num out-clock">{fmtClock(now)}</span>}
    </div>
  );

  const message = live.message && live.messageVisible && (
    <div className={`out-msg c-${live.msgColor} ${live.flash ? 'flash' : ''}`} style={{ fontWeight: live.msgBold ? 800 : 500, textDecoration: live.msgUnderline ? 'underline' : 'none' }}>
      {live.message}
    </div>
  );

  return (
    <div className={`output s-${state} pos-${o.headerPos} ${o.transparent ? 'keying' : ''}`} ref={root} style={{ background: o.transparent ? 'transparent' : o.background }}>
      <div className="out-frame" style={{ transform: transform || undefined }}>
        {o.headerPos === 'top' && header}

        {o.layout === 'single' ? (
          <div className="out-main">
            {o.bigClock && <div className="out-bigclock num">{fmtClock(now)}</div>}
            {o.cueTitles && <div className="out-title">{title}</div>}
            {o.cueSubtitles && label && <div className="out-label">{label}</div>}
            {(o.cueStart || o.cueEnd) && cur && (
              <div className="out-times num">
                {o.cueStart && <span>Start {fmtClock(tl.cues[cur.cue.id].start, false)}</span>}
                {o.cueEnd && <span>Ende {fmtClock(tl.cues[cur.cue.id].end, false)}</span>}
              </div>
            )}
            {subs.length > 0 ? (
              <div className="out-subs">
                {subs.map(({ t, v }) => {
                  const d = L.subDisplay(t, v.elapsed);
                  return (
                    <div key={t.id} className={`out-sub s-${d.state} ${v.running ? '' : 'paused'}`}>
                      <span className="out-sub-name">{t.name || 'Timer'}</span>
                      <span className="num" style={{ fontSize: timerSize('00:00') }}>
                        {d.state === 'over' ? fmtCountdown(d.value).text : fmtDur(d.value)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              o.showCueTimer && (
                <div className={`out-timer num ${state} ${live.status === 'paused' ? 'paused' : ''}`} role="timer" aria-live="off" style={{ fontSize: timerSize(big) }}>
                  {big}
                </div>
              )
            )}
            {o.showProgress && cur && (
              <div className="out-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${cur.progress})` }} />
              </div>
            )}
            {lastFive > 0 && (
              <div className="last-five" aria-label={`Noch ${lastFive} Sekunden`}>
                {[5, 4, 3, 2, 1].map((n) => (
                  <span key={n} className={n <= lastFive ? 'on' : ''} />
                ))}
              </div>
            )}
            {live.status === 'paused' && <div className="out-paused">Pausiert</div>}
            {o.nextCue && tl.next && cur && (
              <div className="out-next">
                <span className="eyebrow">Als Nächstes</span>
                <span className="out-next-title">{tl.next.title || 'Ohne Titel'}</span>
                <span className="num">{fmtDur(tl.next.duration)}</span>
              </div>
            )}
          </div>
        ) : (
          <OutputList r={r} tl={tl} o={o} />
        )}

        {message}
        {o.headerPos === 'bottom' && header}
        {o.layout === 'list' && o.showProgress && cur && (
          <div className="out-progress wide" aria-hidden="true">
            <span style={{ transform: `scaleX(${cur.progress})` }} />
          </div>
        )}
      </div>

      <div className="out-tools">
        {!readonly && (
          <button className="chip-btn" onClick={() => setConfig((c) => !c)} aria-expanded={config}>
            <Icon name="settings" size={14} /> Anzeige
          </button>
        )}
        <button className="chip-btn" onClick={() => toggleFullscreen(root.current)}>
          <Icon name="full" size={14} /> Vollbild
        </button>
      </div>
      {config && <OutputConfigPanel r={r} close={() => setConfig(false)} />}
    </div>
  );
}

function OutputList({ r, tl, o }: { r: Rundown; tl: Timeline; o: OutputConfig }) {
  const cues = L.playable(r);
  const curIdx = tl.current ? cues.findIndex((c) => c.id === tl.current!.cue.id) : -1;
  const shown = cues.slice(Math.max(0, curIdx), Math.max(0, curIdx) + 12);
  const cols = r.columns.filter((c) => o.columns.includes(c.id));
  return (
    <ol className="out-list">
      {shown.map((c) => {
        const t = tl.cues[c.id];
        const isCur = t.status === 'current';
        return (
          <li key={c.id} className={`out-row ${isCur ? 'current' : ''} ${o.cueColors && c.color ? `tint-${c.color}` : ''}`}>
            {o.cueNumbers && <span className="num out-num">{t.label}</span>}
            <span className="out-row-main">
              {o.cueTitles && <span className="out-row-title">{c.title || 'Ohne Titel'}</span>}
              {o.cueSubtitles && c.subtitle && <span className="out-row-sub">{c.subtitle}</span>}
              {cols.map((col) => {
                const v = c.cells[col.id];
                if (!v) return null;
                return (
                  <span key={col.id} className="out-row-cell">
                    <b>{col.name}:</b> {col.type === 'select' ? col.options.find((x) => x.id === v)?.label : <RichText text={v.replace(/\n/g, ' · ')} />}
                  </span>
                );
              })}
            </span>
            <span className="out-row-times num">
              {o.cueStart && <span>{fmtClock(t.start, false)}</span>}
              {o.cueEnd && <span>–{fmtClock(t.end, false)}</span>}
              {o.cueDurations && <span className="out-row-dur">{isCur && tl.current ? fmtCountdown(tl.current.remaining).text : fmtDur(c.duration)}</span>}
            </span>
          </li>
        );
      })}
      {!shown.length && <li className="out-row empty">Keine Cues</li>}
    </ol>
  );
}

function OutputConfigPanel({ r, close }: { r: Rundown; close: () => void }) {
  const o = r.output;
  const set = (patch: Partial<OutputConfig>) => store.updateRundown(r.id, (x) => ({ ...x, output: { ...x.output, ...patch } }));
  const tog = (key: keyof OutputConfig, label: string, disabled = false) => (
    <Toggle id={`oc-${key}`} on={!!o[key]} onChange={(v) => !disabled && set({ [key]: v } as Partial<OutputConfig>)}>
      <span className={disabled ? 'muted' : ''}>{label}</span>
    </Toggle>
  );
  const single = o.layout === 'single';
  return (
    <aside className="out-config" aria-label="Anzeige einstellen">
      <div className="modal-head">
        <h2>Timer-Anzeige</h2>
        <button className="icon-btn" onClick={close} aria-label="Schließen">
          <Icon name="close" />
        </button>
      </div>
      <p className="hint small">Gilt für alle Geräte, die diesen Timer zeigen.</p>
      <div className="seg" role="radiogroup" aria-label="Layout">
        <button role="radio" aria-checked={single} className={single ? 'on' : ''} onClick={() => set({ layout: 'single' })}>
          Einzel-Cue
        </button>
        <button role="radio" aria-checked={!single} className={!single ? 'on' : ''} onClick={() => set({ layout: 'list' })}>
          Liste
        </button>
      </div>
      <h3>Bild</h3>
      <div className="field-row">
        <label htmlFor="oc-bg">Hintergrund</label>
        <input id="oc-bg" type="color" value={o.background} disabled={o.transparent} onChange={(e) => set({ background: e.target.value })} />
        {tog('transparent', 'Transparent (Keying)')}
      </div>
      {tog('mirrorH', 'Horizontal spiegeln')}
      {tog('mirrorV', 'Vertikal spiegeln')}
      <h3>Kopfzeile</h3>
      <div className="seg" role="radiogroup" aria-label="Position der Kopfzeile">
        <button role="radio" aria-checked={o.headerPos === 'top'} className={o.headerPos === 'top' ? 'on' : ''} onClick={() => set({ headerPos: 'top' })}>
          Oben
        </button>
        <button role="radio" aria-checked={o.headerPos === 'bottom'} className={o.headerPos === 'bottom' ? 'on' : ''} onClick={() => set({ headerPos: 'bottom' })}>
          Unten
        </button>
      </div>
      {tog('showTitle', 'Titel des Ablaufs')}
      {tog('showLogo', 'Logo')}
      {tog('showClock', 'Tageszeit')}
      {tog('showCueTimer', 'Cue-Timer')}
      {tog('showOverUnder', 'Über / Unter')}
      {tog('showProgress', 'Fortschrittsbalken')}
      {tog('showLastFive', 'Letzte 5 Sekunden', !single)}
      <h3>Cues</h3>
      {tog('cueNumbers', 'Nummern', single)}
      {tog('cueTitles', 'Titel')}
      {tog('cueSubtitles', 'Untertitel')}
      {tog('cueColors', 'Farben', single)}
      {tog('cueDurations', 'Dauern', single)}
      {tog('cueStart', 'Startzeiten')}
      {tog('cueEnd', 'Endzeiten')}
      {tog('nextCue', 'Nächster Cue', !single)}
      {tog('bigClock', 'Große Tageszeit', !single)}
      {!single && (
        <>
          <h3>Spalten in der Liste</h3>
          <div className="check-list">
            {r.columns.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={o.columns.includes(c.id)} onChange={(e) => set({ columns: e.target.checked ? [...o.columns, c.id] : o.columns.filter((x) => x !== c.id) })} />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <button className="btn small" onClick={() => set(defaultOutput())}>
        Auf Standard zurücksetzen
      </button>
      {r.items.some((i) => isCue(i) && i.subTimers.some((t) => t.showOnOutput)) && <p className="hint small">Unter-Timer mit „Im Timer anzeigen“ ersetzen den Haupt-Timer, solange sie laufen.</p>}
    </aside>
  );
}
