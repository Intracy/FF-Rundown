import React, { useEffect, useRef, useState } from 'react';
import { LiveState, Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtCountdown } from '../time';
import { Icon } from './common';
import { playable } from '../live';
import { toggleFullscreen, useWakeLock } from './OutputView';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem('taktgeber:prompter') || '{}');
  } catch {
    return {};
  }
}

/** Teleprompter: zeigt die Skripte aller Cues, folgt optional dem laufenden Cue */
export function PrompterView({ r, live, tl }: { r: Rundown; live: LiveState; tl: Timeline }) {
  useWakeLock();
  const saved = readPrefs();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(saved.speed ?? 40);
  const [size, setSize] = useState<number>(saved.size ?? 56);
  const [mirror, setMirror] = useState<boolean>(saved.mirror ?? false);
  const [follow, setFollow] = useState<boolean>(saved.follow ?? true);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    try {
      localStorage.setItem('taktgeber:prompter', JSON.stringify({ speed, size, mirror, follow }));
    } catch {
      /* egal */
    }
  }, [speed, size, mirror, follow]);

  // Gleichmäßiges Scrollen
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const step = (t: number) => {
      const el = scroller.current;
      if (el) {
        carry += (speedRef.current * (t - last)) / 1000;
        const whole = Math.trunc(carry);
        if (whole !== 0) {
          el.scrollTop += whole;
          carry -= whole;
        }
      }
      last = t;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Dem laufenden Cue folgen
  useEffect(() => {
    if (!follow || !live.currentId) return;
    const el = scroller.current;
    const sec = el?.querySelector<HTMLElement>(`[data-pid="${live.currentId}"]`);
    if (el && sec) el.scrollTo({ top: sec.offsetTop - el.clientHeight * 0.3, behavior: 'smooth' });
  }, [live.currentId, follow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSpeed((s) => Math.max(0, s - 10));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSpeed((s) => Math.min(400, s + 10));
      } else if (e.key === 'ArrowLeft') setSize((s) => Math.max(24, s - 4));
      else if (e.key === 'ArrowRight') setSize((s) => Math.min(140, s + 4));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cues = playable(r);
  const cur = tl.current;
  const cd = cur ? fmtCountdown(cur.remaining) : null;

  return (
    <div className="prompter" ref={root}>
      <div className="p-tools" role="toolbar" aria-label="Prompter">
        <button className={`ctl small ${playing ? 'is-running' : ''}`} onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Scrollen anhalten' : 'Scrollen starten'} title="Leertaste">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <span className="p-group">
          <span className="eyebrow">Tempo</span>
          <button className="icon-btn" onClick={() => setSpeed((s) => Math.max(0, s - 10))} aria-label="Langsamer">
            <Icon name="minus" size={14} />
          </button>
          <span className="num p-val">{speed}</span>
          <button className="icon-btn" onClick={() => setSpeed((s) => Math.min(400, s + 10))} aria-label="Schneller">
            <Icon name="plus" size={14} />
          </button>
        </span>
        <span className="p-group">
          <span className="eyebrow">Schrift</span>
          <button className="icon-btn" onClick={() => setSize((s) => Math.max(24, s - 4))} aria-label="Kleiner">
            <Icon name="minus" size={14} />
          </button>
          <span className="num p-val">{size}</span>
          <button className="icon-btn" onClick={() => setSize((s) => Math.min(140, s + 4))} aria-label="Größer">
            <Icon name="plus" size={14} />
          </button>
        </span>
        <button className={`chip-btn ${mirror ? 'on' : ''}`} aria-pressed={mirror} onClick={() => setMirror((m) => !m)}>
          <Icon name="mirror" size={14} /> Spiegeln
        </button>
        <button className={`chip-btn ${follow ? 'on' : ''}`} aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
          <Icon name="follow" size={14} /> Folgt der Show
        </button>
        <button className="chip-btn" onClick={() => toggleFullscreen(root.current)}>
          <Icon name="full" size={14} /> Vollbild
        </button>
        {cd && <span className={`p-timer num ${cd.over ? 'over' : cur && cur.remaining <= r.warnAt ? 'warn' : ''}`}>{cd.text}</span>}
      </div>

      <div className="p-stage">
      <div className="p-scroll" ref={scroller} style={{ fontSize: size }}>
        <div className={`p-text ${mirror ? 'mirror' : ''}`}>
          <div className="p-spacer" />
          {cues.map((c) => {
            const t = tl.cues[c.id];
            const isCur = t?.status === 'current';
            return (
              <section key={c.id} data-pid={c.id} className={`p-sec ${isCur ? 'current' : ''} ${t?.status === 'done' ? 'done' : ''}`}>
                <div className="p-head">
                  <span className="num">{t?.num}</span> {c.title || 'Ohne Titel'}
                </div>
                {c.script ? (
                  c.script.split(/\n{2,}/).map((para, i) => (
                    <p key={i}>
                      {para.split('\n').map((line, j, arr) => (
                        <React.Fragment key={j}>
                          {line}
                          {j < arr.length - 1 && <br />}
                        </React.Fragment>
                      ))}
                    </p>
                  ))
                ) : (
                  <p className="p-empty">Kein Skript</p>
                )}
              </section>
            );
          })}
          <div className="p-spacer end" />
        </div>
      </div>
      <div className="p-guide" aria-hidden="true" />
      </div>
    </div>
  );
}
