import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TINTS, Tint } from '../types';
import { fmtDur, fmtTimeOfDay, parseClock, parseDur } from '../time';

/* ---------- Icons (eigene, schlichte Linien-Icons) ---------- */
const paths: Record<string, React.ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <g fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4" height="15" rx="1" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" />
    </g>
  ),
  next: (
    <g fill="currentColor" stroke="none">
      <path d="M4 5v14l9-7z" />
      <path d="M12 5v14l9-7z" />
    </g>
  ),
  prev: (
    <g fill="currentColor" stroke="none">
      <path d="M20 5v14l-9-7z" />
      <path d="M12 5v14l-9-7z" />
    </g>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  grip: (
    <g fill="currentColor" stroke="none">
      {[6, 12, 18].map((y) => (
        <React.Fragment key={y}>
          <circle cx="9" cy={y} r="1.5" />
          <circle cx="15" cy={y} r="1.5" />
        </React.Fragment>
      ))}
    </g>
  ),
  dots: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </g>
  ),
  pin: <path d="M12 21v-6M7 4h10l-1.5 5 3 3H5.5l3-3z" />,
  auto: <path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4" />,
  skip: <path d="M5 5l14 14M19 5L5 19" />,
  lock: (
    <g>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </g>
  ),
  unlock: (
    <g>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </g>
  ),
  follow: <path d="M12 4v12M6 10l6 6 6-6M5 20h14" />,
  full: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  mirror: <path d="M12 3v18M8 7l-4 5 4 5zM16 7l4 5-4 5z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  message: <path d="M4 5h16v11H9l-5 4z" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  script: <path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4" />,
  reset: <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />,
  copy: (
    <g>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </g>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  left: <path d="M19 12H5M11 6l-6 6 6 6" />,
  right: <path d="M5 12h14M13 6l6 6-6 6" />,
  keyboard: (
    <g>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
    </g>
  ),
  io: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  window: (
    <g>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
    </g>
  ),
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/* ---------- Popover ---------- */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  className = '',
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor]);

  return createPortal(
    <div ref={ref} className={`pop ${className}`} style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} role="dialog">
      {children}
    </div>,
    document.body,
  );
}

/** Hook für ein Popover, das an einem Button hängt */
export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    anchor,
    open: (e: React.MouseEvent<HTMLElement>) => setAnchor(anchor ? null : e.currentTarget),
    close: () => setAnchor(null),
  };
}

/* ---------- Eingaben mit Entwurf (Enter = übernehmen, Esc = verwerfen) ---------- */
function useDraftInput(display: string, commit: (v: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  return {
    value: draft ?? display,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      cancel.current = false;
      setDraft(display);
      requestAnimationFrame(() => e.target.select());
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (!cancel.current && draft != null && draft !== display) commit(draft);
      setDraft(null);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') {
        cancel.current = true;
        e.currentTarget.blur();
      }
    },
  };
}

export function DurationInput({ value, onChange, readOnly, className = '', label }: { value: number; onChange: (v: number) => void; readOnly?: boolean; className?: string; label: string }) {
  const p = useDraftInput(fmtDur(value), (v) => {
    const ms = parseDur(v);
    if (ms != null) onChange(ms);
  });
  return <input className={`num-input ${className}`} aria-label={label} title="Dauer: 5 = 5 min, 1:30 = 1 min 30 s, 1:02:00 = 1 h 2 min" readOnly={readOnly} {...p} />;
}

export function ClockInput({ value, onChange, readOnly, className = '', label, seconds = true }: { value: number; onChange: (v: number) => void; readOnly?: boolean; className?: string; label: string; seconds?: boolean }) {
  const p = useDraftInput(fmtTimeOfDay(value, seconds), (v) => {
    const ms = parseClock(v);
    if (ms != null) onChange(ms);
  });
  return <input className={`num-input ${className}`} aria-label={label} title="Uhrzeit, z. B. 19:30 oder 1930" readOnly={readOnly} {...p} />;
}

/* ---------- Farbwahl ---------- */
export function Swatches({ value, onPick }: { value: Tint; onPick: (t: Tint) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Farbe">
      {TINTS.map((t) => (
        <button key={t.id || 'none'} type="button" role="radio" aria-checked={value === t.id} title={t.label} className={`swatch tint-${t.id || 'none'} ${value === t.id ? 'on' : ''}`} onClick={() => onPick(t.id)} />
      ))}
    </div>
  );
}

/* ---------- Text-Zelle: Doppelklick zum Bearbeiten, Checklisten mit [ ] / [x] ---------- */
export function TextCell({ value, onChange, readOnly, label }: { value: string; onChange: (v: string) => void; readOnly?: boolean; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && ta.current) {
      ta.current.focus();
      ta.current.style.height = 'auto';
      ta.current.style.height = ta.current.scrollHeight + 'px';
    }
  }, [editing]);

  if (editing) {
    const save = () => {
      setEditing(false);
      if (draft !== value) onChange(draft);
    };
    return (
      <textarea
        ref={ta}
        className="cell-edit"
        aria-label={label}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = e.target.scrollHeight + 'px';
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
      />
    );
  }

  const lines = value ? value.split('\n') : [];
  const toggle = (i: number) => {
    const next = lines.map((l, j) => (j === i ? (/^\s*\[x\]/i.test(l) ? l.replace(/\[x\]/i, '[ ]') : l.replace('[ ]', '[x]')) : l));
    onChange(next.join('\n'));
  };
  return (
    <div
      className={`cell-view ${value ? '' : 'empty'}`}
      tabIndex={0}
      role="button"
      aria-label={`${label} bearbeiten`}
      onDoubleClick={() => {
        if (readOnly) return;
        setDraft(value);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !readOnly && e.target === e.currentTarget) {
          e.preventDefault();
          setDraft(value);
          setEditing(true);
        }
      }}
    >
      {lines.map((l, i) => {
        const m = l.match(/^\s*\[( |x)\]\s?(.*)$/i);
        if (m)
          return (
            <label key={i} className={`task ${m[1].toLowerCase() === 'x' ? 'checked' : ''}`} onDoubleClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={m[1].toLowerCase() === 'x'} onChange={() => toggle(i)} />
              <span>{m[2]}</span>
            </label>
          );
        return <div key={i}>{l || ' '}</div>;
      })}
    </div>
  );
}

export function Toggle({ on, onChange, children, id }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; id: string }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}

/** Kopieren mit Fallback (Text markieren), falls die Zwischenablage verweigert wird */
export async function copyText(text: string, fallbackEl?: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      fallbackEl.focus();
      fallbackEl.select();
    }
    return false;
  }
}
