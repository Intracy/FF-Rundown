import React, { useEffect, useRef, useState } from 'react';
import { LiveState, PrompterSync, Rundown } from '../types';
import { Timeline } from '../timing';
import { fmtCountdown } from '../time';
import { store } from '../store';
import { playable } from '../live';
import { Icon, Toggle, resolveVars, usePopover, Popover } from './common';
import { toggleFullscreen, useWakeLock } from './OutputView';

interface Prefs {
  speed: number;
  size: number;
  margin: number;
  indicator: number;
  mirror: boolean;
  follow: boolean;
  uppercase: boolean;
  invert: boolean;
  details: boolean;
  blackout: boolean;
  sync: boolean;
}

const DEFAULTS: Prefs = { speed: 40, size: 56, margin: 6, indicator: 30, mirror: false, follow: true, uppercase: false, invert: false, details: true, blackout: false, sync: false };

function readPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('taktgeber:prompter') || '{}') };
  } catch {
    return DEFAULTS;
  }
}

/** Teleprompter: zeigt die Skripte (oder eine Textspalte) aller Cues, folgt optional dem laufenden Cue */
export function PrompterView({ r, live, tl, readonly }: { r: Rundown; live: LiveState; tl: Timeline; readonly: boolean }) {
  useWakeLock();
  const [p, setP] = useState<Prefs>(readPrefs);
  const [localPlaying, setLocalPlaying] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const cueList = usePopover();
  const settings = usePopover();
  const lastJump = useRef(0);

  // Mit anderen synchronisieren: gemeinsame Werte kommen aus dem Live-Zustand
  const shared = p.sync ? live.prompter : null;
  const playing = shared ? shared.playing : localPlaying;
  const speed = shared?.speed ?? p.speed;
  const size = shared?.size ?? p.size;
  const margin = shared?.margin ?? p.margin;
  const indicator = shared?.indicator ?? p.indicator;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const setShared = (patch: Partial<PrompterSync>) => {
    if (!p.sync || readonly) return false;
    store.setLive(r.id, (l) => ({ ...l, prompter: { playing, speed, size, margin, indicator, jump: l.prompter?.jump ?? null, ...patch } }));
    return true;
  };
  const update = (patch: Partial<Prefs> & { playing?: boolean }) => {
    const { playing: pl, ...rest } = patch;
    const sharedKeys: Partial<PrompterSync> = {};
    for (const k of ['speed', 'size', 'margin', 'indicator'] as const) if (k in rest) sharedKeys[k] = rest[k] as number;
    if (pl !== undefined) sharedKeys.playing = pl;
    const didShare = Object.keys(sharedKeys).length > 0 && setShared(sharedKeys);
    if (!didShare && pl !== undefined) setLocalPlaying(pl);
    if (Object.keys(rest).length) setP((x) => ({ ...x, ...rest }));
  };
  const jump = (to: string) => {
    if (!setShared({ jump: { to, seq: Date.now() } })) scrollTo(to);
  };

  useEffect(() => {
    try {
      localStorage.setItem('taktgeber:prompter', JSON.stringify(p));
    } catch {
      /* egal */
    }
  }, [p]);

  const scrollTo = (to: string) => {
    const el = scroller.current;
    if (!el) return;
    if (to === 'top') return el.scrollTo({ top: 0, behavior: 'smooth' });
    const sec = el.querySelector<HTMLElement>(`[data-pid="${to}"]`);
    if (sec) el.scrollTo({ top: sec.offsetTop - el.clientHeight * (indicator / 100), behavior: 'smooth' });
  };

  // Gemeinsame Sprünge ausführen
  useEffect(() => {
    const j = live.prompter?.jump;
    if (p.sync && j && j.seq !== lastJump.current) {
      lastJump.current = j.seq;
      scrollTo(j.to);
    }
  }, [live.prompter?.jump?.seq, p.sync]);

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
    if (p.follow && live.currentId) scrollTo(live.currentId);
  }, [live.currentId, p.follow]);

  const state = useRef({ playing, speed, size });
  state.current = { playing, speed, size };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"], .pop')) return;
      const s = state.current;
      if (e.key === ' ') {
        e.preventDefault();
        update({ playing: !s.playing });
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = (e.shiftKey ? 20 : 10) * (e.key === 'ArrowLeft' ? -1 : 1);
        update({ speed: Math.max(0, Math.min(400, s.speed + step)) });
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault();
        jump('top');
      } else if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault();
        if (live.currentId) jump(live.currentId);
      } else if (e.key === '+' || e.key === '=') update({ size: Math.min(140, s.size + 4) });
      else if (e.key === '-') update({ size: Math.max(24, s.size - 4) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cues = playable(r);
  const cur = tl.current;
  const cd = cur ? fmtCountdown(cur.remaining) : null;
  const source = r.prompterSource;
  const textOf = (c: (typeof cues)[number]) => resolveVars(source === 'script' ? c.script : c.cells[source] ?? '', r.variables);
  const textCols = r.columns.filter((c) => c.type === 'text');

  const stepper = (label: string, val: number, on: (v: number) => void, min: number, max: number, step: number) => (
    <span className="p-group">
      <span className="eyebrow">{label}</span>
      <button className="icon-btn" onClick={() => on(Math.max(min, val - step))} aria-label={`${label} verringern`}>
        <Icon name="minus" size={14} />
      </button>
      <span className="num p-val">{val}</span>
      <button className="icon-btn" onClick={() => on(Math.min(max, val + step))} aria-label={`${label} erhöhen`}>
        <Icon name="plus" size={14} />
      </button>
    </span>
  );

  return (
    <div className={`prompter ${p.invert ? 'inverted' : ''}`} ref={root}>
      <div className="p-tools" role="toolbar" aria-label="Prompter">
        <button className={`ctl small ${playing ? 'is-running' : ''}`} onClick={() => update({ playing: !playing })} aria-label={playing ? 'Scrollen anhalten' : 'Scrollen starten'} title="Leertaste">
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        {stepper('Tempo', speed, (v) => update({ speed: v }), 0, 400, 10)}
        {stepper('Schrift', size, (v) => update({ size: v }), 24, 140, 4)}
        {stepper('Rand', margin, (v) => update({ margin: v }), 0, 30, 2)}
        {stepper('Marke', indicator, (v) => update({ indicator: v }), 5, 80, 5)}
        <button className="chip-btn" onClick={() => jump('top')} title="Umschalt + ↑">
          <Icon name="up" size={14} /> Anfang
        </button>
        <button className="chip-btn" disabled={!live.currentId} onClick={() => live.currentId && jump(live.currentId)} title="Umschalt + ↓">
          <Icon name="down" size={14} /> Laufender Cue
        </button>
        <button className="chip-btn" onClick={cueList.open}>
          <Icon name="list" size={14} /> Cues
        </button>
        <button className="chip-btn" onClick={settings.open}>
          <Icon name="settings" size={14} /> Optionen
        </button>
        <button className="chip-btn" onClick={() => toggleFullscreen(root.current)}>
          <Icon name="full" size={14} /> Vollbild
        </button>
        {cd && <span className={`p-timer num ${cd.over ? 'over' : cur && cur.remaining <= r.warnAt ? 'warn' : ''}`}>{cd.text}</span>}
      </div>

      <div className="p-stage">
        <div className="p-scroll" ref={scroller} style={{ fontSize: size, paddingLeft: `${margin}vw`, paddingRight: `${margin}vw` }}>
          <div className={`p-text ${p.mirror ? 'mirror' : ''} ${p.uppercase ? 'upper' : ''} ${p.details ? '' : 'plain'}`}>
            <div className="p-spacer" style={{ height: `${indicator}vh` }} />
            {cues.map((c) => {
              const t = tl.cues[c.id];
              const isCur = t?.status === 'current';
              const text = textOf(c);
              return (
                <section key={c.id} data-pid={c.id} className={`p-sec ${isCur ? 'current' : ''} ${t?.status === 'done' ? 'done' : ''}`}>
                  {p.details && (
                    <div className="p-head">
                      <span className="num">{t?.label}</span> {c.title || 'Ohne Titel'}
                    </div>
                  )}
                  {text ? (
                    text.split(/\n{2,}/).map((para, i) => (
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
                    p.details && <p className="p-empty">Kein Text</p>
                  )}
                </section>
              );
            })}
            <div className="p-spacer end" />
          </div>
        </div>
        {p.blackout && <div className="p-blackout" style={{ height: `${indicator}%` }} aria-hidden="true" />}
        <div className="p-guide" style={{ top: `${indicator}%` }} aria-hidden="true" />
      </div>

      {cueList.anchor && (
        <Popover anchor={cueList.anchor} onClose={cueList.close} className="menu">
          <div className="menu-list p-cue-list">
            {cues.map((c) => (
              <button
                key={c.id}
                className={tl.cues[c.id]?.status === 'current' ? 'on' : ''}
                onClick={() => {
                  jump(c.id);
                  cueList.close();
                }}
              >
                <span className="num">{tl.cues[c.id]?.label}</span> {c.title || 'Ohne Titel'}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {settings.anchor && (
        <Popover anchor={settings.anchor} onClose={settings.close} align="end" className="menu">
          <div className="menu-body">
            <label className="set-field">
              <span className="eyebrow">Text aus</span>
              <select className="text-input" value={source} disabled={readonly} onChange={(e) => store.updateRundown(r.id, (x) => ({ ...x, prompterSource: e.target.value }))}>
                <option value="script">Cue-Skript</option>
                {textCols.map((c) => (
                  <option key={c.id} value={c.id}>
                    Spalte „{c.name}“
                  </option>
                ))}
              </select>
            </label>
            <Toggle id="p-follow" on={p.follow} onChange={(v) => update({ follow: v })}>
              Folgt der Show
            </Toggle>
            <Toggle id="p-mirror" on={p.mirror} onChange={(v) => update({ mirror: v })}>
              Spiegeln
            </Toggle>
            <Toggle id="p-details" on={p.details} onChange={(v) => update({ details: v })}>
              Cue-Titel und Trennlinien
            </Toggle>
            <Toggle id="p-blackout" on={p.blackout} onChange={(v) => update({ blackout: v })}>
              Abdunkeln über der Marke
            </Toggle>
            <Toggle id="p-upper" on={p.uppercase} onChange={(v) => update({ uppercase: v })}>
              Großbuchstaben
            </Toggle>
            <Toggle id="p-invert" on={p.invert} onChange={(v) => update({ invert: v })}>
              Farben umkehren
            </Toggle>
            {!readonly && (
              <Toggle
                id="p-sync"
                on={p.sync}
                onChange={(v) => {
                  setP((x) => ({ ...x, sync: v }));
                  if (v && !live.prompter) store.setLive(r.id, (l) => ({ ...l, prompter: { playing: false, speed: p.speed, size: p.size, margin: p.margin, indicator: p.indicator, jump: null } }));
                }}
              >
                Mit anderen synchronisieren
                <small>Start/Stopp, Tempo, Schrift, Rand, Marke und Sprünge</small>
              </Toggle>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
