import React, { useEffect, useState } from 'react';
import { LiveState, Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtClock, fmtCountdown, fmtDur } from '../time';
import { Icon } from './common';

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

/** Bühnen-Timer für Moderation, Regie oder einen zweiten Bildschirm */
export function OutputView({ r, live, tl, now }: { r: Rundown; live: LiveState; tl: Timeline; now: number }) {
  useWakeLock();
  const [showNext, setShowNext] = useState(true);
  const root = React.useRef<HTMLDivElement>(null);
  const cur = tl.current;

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
    if (live.status === 'paused') state += ' paused';
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

  return (
    <div className={`output s-${state.split(' ')[0]}`} ref={root}>
      <div className="out-top">
        <span className="out-show">{r.title}</span>
        <span className="num out-clock">{fmtClock(now)}</span>
      </div>

      <div className="out-main">
        <div className="out-title">{title}</div>
        {label && <div className="out-label">{label}</div>}
        <div className={`out-timer num ${state}`} role="timer" aria-live="off">
          {big}
        </div>
        {cur && (
          <div className="out-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${cur.progress})` }} />
          </div>
        )}
        {live.status === 'paused' && <div className="out-paused">Pausiert</div>}
      </div>

      {live.message && <div className={`out-msg ${live.flash ? 'flash' : ''}`}>{live.message}</div>}

      <div className="out-bottom">
        {showNext && tl.next && cur && (
          <div className="out-next">
            <span className="eyebrow">Als Nächstes</span>
            <span className="out-next-title">{tl.next.title || 'Ohne Titel'}</span>
            <span className="num">{fmtDur(tl.next.duration)}</span>
          </div>
        )}
        {live.status !== 'idle' && live.status !== 'ended' && (
          <div className={`out-ou num ${tl.overUnder >= 1000 ? 'late' : tl.overUnder <= -1000 ? 'early' : ''}`}>
            Show {Math.abs(tl.overUnder) < 1000 ? 'pünktlich' : tl.overUnder > 0 ? `+${fmtDur(tl.overUnder)}` : `−${fmtDur(-tl.overUnder)}`}
          </div>
        )}
      </div>

      <div className="out-tools">
        <button className="chip-btn" aria-pressed={showNext} onClick={() => setShowNext((s) => !s)}>
          {showNext ? 'Nächsten ausblenden' : 'Nächsten zeigen'}
        </button>
        <button className="chip-btn" onClick={() => toggleFullscreen(root.current)}>
          <Icon name="full" size={14} /> Vollbild
        </button>
      </div>
    </div>
  );
}
