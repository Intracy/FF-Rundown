import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Column, Cue, Heading, Item, LiveState, Rundown, SelectOption, isCue } from '../types';
import { CueTime, GroupTime, Timeline } from '../timing';
import { fmtClock, fmtCountdown, fmtDur, fmtTimeOfDay, msOfDay, uid } from '../time';
import { now as clockNow, store } from '../store';
import * as L from '../live';
import { newColumn, newCue, newHeading } from '../sample';
import { ClockInput, DurationInput, Icon, Popover, Swatches, TextCell, Toggle, usePopover } from './common';

/* ---------- Mutationshelfer ---------- */
const edit = (rid: string, fn: (r: Rundown) => Rundown, key?: string) => store.updateRundown(rid, fn, key);

function patchItem(rid: string, id: string, patch: Partial<Cue> | Partial<Heading>, key?: string) {
  edit(rid, (r) => ({ ...r, items: r.items.map((it) => (it.id === id ? ({ ...it, ...patch } as Item) : it)) }), key);
}

function insertAfter(rid: string, afterId: string | null, items: Item[]) {
  edit(rid, (r) => {
    const list = [...r.items];
    const i = afterId ? list.findIndex((x) => x.id === afterId) : list.length - 1;
    list.splice(i + 1, 0, ...items);
    return { ...r, items: list };
  });
}

function removeItems(rid: string, ids: Set<string>) {
  edit(rid, (r) => ({ ...r, items: r.items.filter((x) => !ids.has(x.id)) }));
}

function moveItems(rid: string, ids: string[], targetId: string, pos: 'before' | 'after') {
  if (ids.includes(targetId)) return;
  edit(rid, (r) => {
    const moving = r.items.filter((x) => ids.includes(x.id));
    const rest = r.items.filter((x) => !ids.includes(x.id));
    const i = rest.findIndex((x) => x.id === targetId);
    rest.splice(pos === 'before' ? i : i + 1, 0, ...moving);
    return { ...r, items: rest };
  });
}

function cloneItem(it: Item): Item {
  return isCue(it) ? { ...it, id: uid(), cells: { ...it.cells } } : { ...it, id: uid() };
}

/* ---------- Haupttabelle ---------- */
export function RundownView({ rundown: r, live, tl, now, locked, follow }: { rundown: Rundown; live: LiveState; tl: Timeline; now: number; locked: boolean; follow: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const dragIds = useRef<string[]>([]);
  const sheet = useRef<HTMLDivElement>(null);

  const cols = `var(--c-grip) var(--c-num) var(--c-start) var(--c-dur) minmax(260px, 1fr) ${r.columns.map((c) => c.width + 'px').join(' ')} var(--c-end)`;

  // Ausgewählte IDs bereinigen, wenn Items verschwinden
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(r.items.map((i) => i.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [r.items]);

  // Mitlaufen: aktuellen Cue in den Blick holen
  useEffect(() => {
    if (!follow || !live.currentId) return;
    const el = sheet.current?.querySelector<HTMLElement>(`[data-id="${live.currentId}"]`);
    el?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [live.currentId, follow]);

  const select = (id: string, e: React.MouseEvent) => {
    setSelected((s) => {
      const next = new Set(s);
      if (e.shiftKey && anchorId) {
        const ids = r.items.map((i) => i.id);
        const [a, b] = [ids.indexOf(anchorId), ids.indexOf(id)].sort((x, y) => x - y);
        ids.slice(a, b + 1).forEach((x) => next.add(x));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!e.shiftKey) setAnchorId(id);
  };

  const dnd = locked
    ? null
    : {
        start: (id: string, e: React.DragEvent) => {
          dragIds.current = selected.has(id) ? r.items.filter((i) => selected.has(i.id)).map((i) => i.id) : [id];
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
          const row = (e.currentTarget as HTMLElement).closest('.row');
          if (row) e.dataTransfer.setDragImage(row, 20, 20);
        },
        over: (id: string, e: React.DragEvent) => {
          if (!dragIds.current.length) return;
          e.preventDefault();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
          setDrop((d) => (d?.id === id && d.pos === pos ? d : { id, pos }));
        },
        drop: (e: React.DragEvent) => {
          e.preventDefault();
          if (drop && dragIds.current.length) moveItems(r.id, dragIds.current, drop.id, drop.pos);
          dragIds.current = [];
          setDrop(null);
        },
        end: () => {
          dragIds.current = [];
          setDrop(null);
        },
      };

  const firstPlayableId = useMemo(() => L.playable(r)[0]?.id, [r]);
  let prevPlayable: Cue | null = null;

  return (
    <>
      {selected.size > 0 && <BatchBar r={r} selected={selected} clear={() => setSelected(new Set())} selectAll={() => setSelected(new Set(r.items.map((i) => i.id)))} locked={locked} />}
      <div className="sheet" ref={sheet}>
        <div className="grid" style={{ ['--cols' as string]: cols }} role="table" aria-label="Ablauf">
          <div className="row head" role="row">
            <div className="c" role="columnheader" aria-label="Auswahl" />
            <div className="c" role="columnheader">#</div>
            <div className="c" role="columnheader">Start</div>
            <div className="c" role="columnheader">Dauer</div>
            <div className="c" role="columnheader">Titel</div>
            {r.columns.map((c, i) => (
              <ColumnHeader key={c.id} r={r} col={c} index={i} locked={locked} />
            ))}
            <div className="c c-end" role="columnheader">
              {!locked && (
                <button
                  className="icon-btn"
                  title="Spalte hinzufügen"
                  aria-label="Spalte hinzufügen"
                  onClick={() => edit(r.id, (rr) => ({ ...rr, columns: [...rr.columns, newColumn()] }))}
                >
                  <Icon name="plus" />
                </button>
              )}
            </div>
          </div>

          {r.items.map((it) => {
            const dropCls = drop?.id === it.id ? `drop-${drop.pos}` : '';
            if (!isCue(it)) {
              return (
                <HeadingRow
                  key={it.id}
                  r={r}
                  h={it}
                  g={tl.groups[it.id]}
                  selected={selected.has(it.id)}
                  onSelect={select}
                  locked={locked}
                  dnd={dnd}
                  dropCls={dropCls}
                />
              );
            }
            const t = tl.cues[it.id];
            const prev = prevPlayable;
            if (!it.skip) prevPlayable = it;
            return (
              <React.Fragment key={it.id}>
                {t.gap != null && Math.abs(t.gap) >= 1000 && t.status !== 'done' && <GapRow r={r} cue={it} gap={t.gap} prev={prev} tl={tl} locked={locked} />}
                <CueRow
                  r={r}
                  cue={it}
                  t={t}
                  live={live}
                  isFirst={it.id === firstPlayableId}
                  remaining={t.status === 'current' && tl.current ? Math.round(tl.current.remaining / 250) * 250 : null}
                  progress={t.status === 'current' && tl.current ? Math.round(tl.current.progress * 400) / 400 : 0}
                  selected={selected.has(it.id)}
                  onSelect={select}
                  locked={locked}
                  dnd={dnd}
                  dropCls={dropCls}
                />
              </React.Fragment>
            );
          })}
        </div>

        {!locked && (
          <div className="add-bar">
            <button className="btn ghost" onClick={() => insertAfter(r.id, null, [newCue()])}>
              <Icon name="plus" /> Cue
            </button>
            <button className="btn ghost" onClick={() => insertAfter(r.id, null, [newHeading()])}>
              <Icon name="plus" /> Überschrift
            </button>
          </div>
        )}
        {r.items.length === 0 && <p className="empty-note">Noch leer. Lege mit „+ Cue“ den ersten Programmpunkt an oder importiere eine CSV.</p>}
      </div>
      <Footer r={r} tl={tl} now={now} live={live} locked={locked} sheet={sheet} />
    </>
  );
}

type Dnd = null | {
  start: (id: string, e: React.DragEvent) => void;
  over: (id: string, e: React.DragEvent) => void;
  drop: (e: React.DragEvent) => void;
  end: () => void;
};

function Grip({ id, selected, onSelect, dnd, label }: { id: string; selected: boolean; onSelect: (id: string, e: React.MouseEvent) => void; dnd: Dnd; label: string }) {
  return (
    <div className="c c-grip">
      <button
        className={`grip ${selected ? 'on' : ''}`}
        draggable={!!dnd}
        onDragStart={(e) => dnd?.start(id, e)}
        onDragEnd={() => dnd?.end()}
        onClick={(e) => onSelect(id, e)}
        aria-pressed={selected}
        aria-label={`${label} auswählen (Umschalt für Bereich, ziehen zum Verschieben)`}
        title="Klicken: auswählen · Umschalt: Bereich · Ziehen: verschieben"
      >
        <Icon name="grip" size={14} />
      </button>
    </div>
  );
}

/* ---------- Cue-Zeile ---------- */
const CueRow = memo(function CueRow({
  r,
  cue,
  t,
  live,
  isFirst,
  remaining,
  progress,
  selected,
  onSelect,
  locked,
  dnd,
  dropCls,
}: {
  r: Rundown;
  cue: Cue;
  t: CueTime;
  live: LiveState;
  isFirst: boolean;
  remaining: number | null;
  progress: number;
  selected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  locked: boolean;
  dnd: Dnd;
  dropCls: string;
}) {
  const [showScript, setShowScript] = useState(false);
  const menu = usePopover();
  const set = (patch: Partial<Cue>, key?: string) => patchItem(r.id, cue.id, patch, key);
  const status = t.status;
  const isHard = cue.startMode === 'hard';
  const cd = remaining != null ? fmtCountdown(remaining) : null;

  const numLabel =
    status === 'current' ? 'Läuft' : status === 'next' ? 'Als Nächstes' : status === 'done' ? 'Gelaufen' : status === 'missed' ? 'Ausgelassen' : status === 'skipped' ? 'Übersprungen' : '';

  return (
    <>
      <div
        className={`row cue st-${status} ${selected ? 'sel' : ''} ${dropCls}`}
        data-id={cue.id}
        data-tint={cue.color || undefined}
        role="row"
        onDragOver={(e) => dnd?.over(cue.id, e)}
        onDrop={(e) => dnd?.drop(e)}
      >
        <Grip id={cue.id} selected={selected} onSelect={onSelect} dnd={dnd} label={cue.title || 'Cue'} />

        <div className="c c-num">
          <button
            className="num-btn"
            disabled={status === 'skipped' || status === 'current'}
            onClick={() => store.setLive(r.id, (l) => L.cueNext(l, cue.id))}
            title={status === 'next' && live.nextId === cue.id ? 'Vormerkung aufheben' : 'Als nächsten Cue vormerken'}
            aria-label={`Cue ${t.num ?? ''} ${numLabel || 'als nächsten vormerken'}`}
          >
            {t.num ?? '–'}
          </button>
          {(status === 'current' || status === 'next') && <span className={`tally ${status}`}>{status === 'current' ? 'PGM' : 'PVW'}</span>}
        </div>

        <div className="c c-start">
          {status === 'skipped' ? (
            <span className="muted">—</span>
          ) : (
            <>
              <span className={`time ${isHard ? 'hard' : ''}`} title={isHard ? 'Fester Start' : 'Startet nach dem vorherigen Cue'}>
                {isHard && <Icon name="pin" size={12} />}
                {fmtClock(status === 'done' ? t.start : isHard ? t.plannedStart : t.start)}
              </span>
              {status !== 'done' && !isHard && Math.abs(t.start - t.plannedStart) >= 1000 && <span className="sub">gepl. {fmtClock(t.plannedStart)}</span>}
              {status === 'done' && t.actualDur != null && <span className="sub">bis {fmtClock(t.end)}</span>}
            </>
          )}
          {cue.autoStart && (
            <span className="auto-flag" title={isHard ? 'Startet automatisch zur festen Uhrzeit' : 'Startet automatisch nach dem vorherigen Cue'}>
              <Icon name="auto" size={11} /> Auto
            </span>
          )}
        </div>

        <div className="c c-dur">
          <DurationInput value={cue.duration} onChange={(v) => set({ duration: v })} readOnly={locked} label="Dauer" />
          {cd && <span className={`remain ${cd.over ? 'over' : remaining! <= r.warnAt ? 'warn' : ''}`}>{cd.text}</span>}
          {status === 'done' && t.actualDur != null && (
            <span className={`sub ${t.actualDur - cue.duration > 999 ? 'late' : cue.duration - t.actualDur > 999 ? 'early' : ''}`}>
              ist {fmtDur(t.actualDur)}
            </span>
          )}
        </div>

        <div className="c c-title">
          <div className="title-stack">
            <input className="title-input" value={cue.title} placeholder="Titel" readOnly={locked} aria-label="Titel" onChange={(e) => set({ title: e.target.value }, `title:${cue.id}`)} />
            <input
              className="subtitle-input"
              value={cue.subtitle}
              placeholder={locked ? '' : 'Untertitel / Person'}
              readOnly={locked}
              aria-label="Untertitel"
              onChange={(e) => set({ subtitle: e.target.value }, `sub:${cue.id}`)}
            />
          </div>
          <div className="row-tools">
            <button className={`icon-btn ${cue.script ? 'has' : ''} ${showScript ? 'on' : ''}`} title="Skript / Prompter-Text" aria-label="Skript ein- oder ausblenden" aria-expanded={showScript} onClick={() => setShowScript((s) => !s)}>
              <Icon name="script" size={15} />
            </button>
            <button className="icon-btn" title="Cue-Optionen" aria-label="Cue-Optionen" onClick={menu.open}>
              <Icon name="dots" size={15} />
            </button>
          </div>
        </div>

        {r.columns.map((col) => (
          <div className="c c-cell" key={col.id}>
            {col.type === 'select' ? (
              <SelectCell col={col} value={cue.cells[col.id] ?? ''} readOnly={locked} onChange={(v) => set({ cells: { ...cue.cells, [col.id]: v } })} />
            ) : (
              <TextCell value={cue.cells[col.id] ?? ''} label={col.name} readOnly={locked} onChange={(v) => set({ cells: { ...cue.cells, [col.id]: v } })} />
            )}
          </div>
        ))}
        <div className="c c-end" />
        {status === 'current' && <div className={`row-progress ${remaining != null && remaining <= 0 ? 'over' : ''}`} style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />}
      </div>

      {showScript && (
        <div className="row script-row" role="row">
          <div className="script-wrap">
            <label className="eyebrow" htmlFor={`script-${cue.id}`}>
              Skript für den Prompter
            </label>
            <textarea
              id={`script-${cue.id}`}
              value={cue.script}
              readOnly={locked}
              placeholder="Moderationstext, Fragen, Einsätze …"
              onChange={(e) => set({ script: e.target.value }, `script:${cue.id}`)}
              rows={Math.min(12, Math.max(3, cue.script.split('\n').length + 1))}
            />
          </div>
        </div>
      )}

      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end" className="menu">
          <CueMenu r={r} cue={cue} status={status} isFirst={isFirst} locked={locked} close={menu.close} />
        </Popover>
      )}
    </>
  );
});

function CueMenu({ r, cue, status, isFirst, locked, close }: { r: Rundown; cue: Cue; status: CueTime['status']; isFirst: boolean; locked: boolean; close: () => void }) {
  const set = (patch: Partial<Cue>) => patchItem(r.id, cue.id, patch);
  const isHard = cue.startMode === 'hard';
  return (
    <div className="menu-body">
      <div className="menu-actions">
        <button
          className="btn pgm"
          disabled={status === 'skipped' || status === 'current'}
          onClick={() => {
            store.setLive(r.id, (l) => L.goLive(l, cue.id, clockNow()));
            close();
          }}
        >
          <Icon name="play" size={14} /> Jetzt live
        </button>
        <button
          className="btn"
          disabled={status === 'skipped' || status === 'current'}
          onClick={() => {
            store.setLive(r.id, (l) => L.cueNext(l, cue.id));
            close();
          }}
        >
          Als Nächstes
        </button>
      </div>

      {!locked && (
        <>
          <div className="menu-sec">
            <span className="eyebrow">Start</span>
            <div className="seg" role="radiogroup" aria-label="Startart">
              <button role="radio" aria-checked={!isHard} className={!isHard ? 'on' : ''} onClick={() => set({ startMode: 'soft' })}>
                Nach Vorgänger
              </button>
              <button
                role="radio"
                aria-checked={isHard}
                className={isHard ? 'on' : ''}
                onClick={() => set({ startMode: 'hard', hardStart: cue.hardStart || r.start })}
              >
                Feste Uhrzeit
              </button>
            </div>
            {isHard && (
              <div className="field-row">
                <label htmlFor={`hard-${cue.id}`}>Fixstart</label>
                <ClockInput value={cue.hardStart} onChange={(v) => set({ hardStart: v })} label="Fixstart" className="wide" />
              </div>
            )}
          </div>

          <div className="menu-sec">
            <Toggle id={`auto-${cue.id}`} on={cue.autoStart} onChange={(v) => set({ autoStart: v })}>
              Auto-Start
              <small>
                {isHard
                  ? `startet von selbst um ${fmtTimeOfDay(cue.hardStart)}`
                  : isFirst
                    ? 'erster Cue: nur mit fester Uhrzeit sinnvoll'
                    : 'startet, sobald der vorherige Cue abgelaufen ist'}
              </small>
            </Toggle>
            <Toggle id={`skip-${cue.id}`} on={cue.skip} onChange={(v) => set({ skip: v })}>
              Überspringen
              <small>bleibt im Ablauf, zählt aber nicht mit</small>
            </Toggle>
          </div>

          <div className="menu-sec">
            <span className="eyebrow">Farbe</span>
            <Swatches value={cue.color} onPick={(c) => set({ color: c })} />
          </div>

          <div className="menu-list">
            <button onClick={() => (insertAfter(r.id, cue.id, [newCue()]), close())}>
              <Icon name="plus" size={14} /> Cue darunter
            </button>
            <button onClick={() => (insertAfter(r.id, cue.id, [newHeading()]), close())}>
              <Icon name="plus" size={14} /> Überschrift darunter
            </button>
            <button onClick={() => (insertAfter(r.id, cue.id, [cloneItem(cue)]), close())}>
              <Icon name="copy" size={14} /> Duplizieren
            </button>
            <button className="danger" onClick={() => (removeItems(r.id, new Set([cue.id])), close())}>
              <Icon name="trash" size={14} /> Löschen
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Auswahl-Zelle ---------- */
function SelectCell({ col, value, onChange, readOnly }: { col: Column; value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const opt = col.options.find((o) => o.id === value);
  return (
    <select className={`chip-select tint-${opt?.color || 'none'} ${opt ? '' : 'empty'}`} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} aria-label={col.name}>
      <option value="">—</option>
      {col.options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ---------- Überschrift ---------- */
const HeadingRow = memo(function HeadingRow({
  r,
  h,
  g,
  selected,
  onSelect,
  locked,
  dnd,
  dropCls,
}: {
  r: Rundown;
  h: Heading;
  g: GroupTime;
  selected: boolean;
  onSelect: (id: string, e: React.MouseEvent) => void;
  locked: boolean;
  dnd: Dnd;
  dropCls: string;
}) {
  const menu = usePopover();
  return (
    <div className={`row heading ${selected ? 'sel' : ''} ${g?.elapsed != null ? 'live' : ''} ${dropCls}`} data-id={h.id} data-tint={h.color || undefined} role="row" onDragOver={(e) => dnd?.over(h.id, e)} onDrop={(e) => dnd?.drop(e)}>
      <Grip id={h.id} selected={selected} onSelect={onSelect} dnd={dnd} label={h.title || 'Überschrift'} />
      <div className="heading-body">
        <input className="heading-input" value={h.title} readOnly={locked} aria-label="Überschrift" onChange={(e) => patchItem(r.id, h.id, { title: e.target.value }, `h:${h.id}`)} />
        {g && g.count > 0 && (
          <span className="heading-meta">
            <span>{g.count} {g.count === 1 ? 'Cue' : 'Cues'}</span>
            <span className="num">{fmtDur(g.total)}</span>
            {g.start != null && g.end != null && (
              <span className="num">
                {fmtClock(g.start, false)}–{fmtClock(g.end, false)}
              </span>
            )}
            {g.plannedEnd != null && g.end != null && Math.abs(g.end - g.plannedEnd) >= 1000 && (
              <span className={`num ${g.end > g.plannedEnd ? 'late' : 'early'}`}>{g.end > g.plannedEnd ? '+' : '−'}{fmtDur(Math.abs(g.end - g.plannedEnd))}</span>
            )}
            {g.elapsed != null && <span className="num live-pill">läuft {fmtDur(g.elapsed)}</span>}
          </span>
        )}
        {!locked && (
          <button className="icon-btn" aria-label="Optionen der Überschrift" title="Optionen" onClick={menu.open}>
            <Icon name="dots" size={15} />
          </button>
        )}
      </div>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} align="end" className="menu">
          <div className="menu-body">
            <div className="menu-sec">
              <span className="eyebrow">Farbe</span>
              <Swatches value={h.color} onPick={(c) => patchItem(r.id, h.id, { color: c })} />
            </div>
            <div className="menu-list">
              <button onClick={() => (insertAfter(r.id, h.id, [newCue()]), menu.close())}>
                <Icon name="plus" size={14} /> Cue darunter
              </button>
              <button onClick={() => (insertAfter(r.id, h.id, [cloneItem(h)]), menu.close())}>
                <Icon name="copy" size={14} /> Duplizieren
              </button>
              <button className="danger" onClick={() => (removeItems(r.id, new Set([h.id])), menu.close())}>
                <Icon name="trash" size={14} /> Überschrift löschen
              </button>
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
});

/* ---------- Lücke / Überschneidung vor einem Fixstart ---------- */
function GapRow({ r, cue, gap, prev, tl, locked }: { r: Rundown; cue: Cue; gap: number; prev: Cue | null; tl: Timeline; locked: boolean }) {
  const menu = usePopover();
  const isGap = gap > 0;
  const prevEnd = prev ? tl.cues[prev.id]?.end : null;
  const newPrevDur = prev ? prev.duration + gap : null;
  return (
    <div className={`row gap ${isGap ? 'is-gap' : 'is-overlap'}`} role="row">
      <div className="gap-body">
        <span className="gap-label">
          {isGap ? 'Lücke' : 'Überschneidung'} <b className="num">{fmtDur(Math.abs(gap))}</b> vor dem Fixstart um {fmtTimeOfDay(cue.hardStart)}
        </span>
        {!locked && (
          <button className="btn small" onClick={menu.open} aria-label="Lücke oder Überschneidung beheben">
            Beheben <Icon name="chevron" size={12} />
          </button>
        )}
      </div>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} className="menu">
          <div className="menu-list fix-list">
            {prev && newPrevDur != null && (
              <button disabled={newPrevDur < 0} title={newPrevDur < 0 ? 'Der vorherige Cue ist zu kurz' : ''} onClick={() => (patchItem(r.id, prev.id, { duration: newPrevDur }), menu.close())}>
                Dauer von „{prev.title || 'vorherigem Cue'}“ auf <b className="num">{fmtDur(Math.max(0, newPrevDur))}</b> setzen
              </button>
            )}
            {prevEnd != null && (
              <button onClick={() => (patchItem(r.id, cue.id, { hardStart: msOfDay(prevEnd) }), menu.close())}>
                Fixstart auf <b className="num">{fmtClock(prevEnd)}</b> verschieben
              </button>
            )}
            <button onClick={() => (patchItem(r.id, cue.id, { startMode: 'soft' }), menu.close())}>Fixstart aufheben (startet nach Vorgänger)</button>
            {isGap && (
              <button
                onClick={() => {
                  edit(r.id, (rr) => {
                    const items = [...rr.items];
                    items.splice(items.findIndex((x) => x.id === cue.id), 0, newCue({ title: 'Puffer', duration: gap, color: 'grey' }));
                    return { ...rr, items };
                  });
                  menu.close();
                }}
              >
                Puffer-Cue mit <b className="num">{fmtDur(gap)}</b> einfügen
              </button>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ---------- Spaltenkopf ---------- */
function ColumnHeader({ r, col, index, locked }: { r: Rundown; col: Column; index: number; locked: boolean }) {
  const menu = usePopover();
  const [confirm, setConfirm] = useState(false);
  const setCol = (patch: Partial<Column>, key?: string) => edit(r.id, (rr) => ({ ...rr, columns: rr.columns.map((c) => (c.id === col.id ? { ...c, ...patch } : c)) }), key);
  const setOpt = (id: string, patch: Partial<SelectOption>, key?: string) => setCol({ options: col.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) }, key);
  const move = (dir: -1 | 1) =>
    edit(r.id, (rr) => {
      const cols = [...rr.columns];
      const [c] = cols.splice(index, 1);
      cols.splice(Math.max(0, Math.min(cols.length, index + dir)), 0, c);
      return { ...rr, columns: cols };
    });

  return (
    <div className="c col-head" role="columnheader">
      {locked ? (
        <span className="col-name">{col.name}</span>
      ) : (
        <button className="col-name" onClick={menu.open} title="Spalte bearbeiten">
          {col.name || 'Ohne Namen'} <Icon name="chevron" size={12} />
        </button>
      )}
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={() => (menu.close(), setConfirm(false))} className="menu wide">
          <div className="menu-body">
            <div className="field-row">
              <label htmlFor={`colname-${col.id}`}>Name</label>
              <input id={`colname-${col.id}`} className="text-input" value={col.name} onChange={(e) => setCol({ name: e.target.value }, `col:${col.id}`)} />
            </div>
            <div className="menu-sec">
              <span className="eyebrow">Typ</span>
              <div className="seg" role="radiogroup" aria-label="Spaltentyp">
                <button role="radio" aria-checked={col.type === 'text'} className={col.type === 'text' ? 'on' : ''} onClick={() => setCol({ type: 'text' })}>
                  Text
                </button>
                <button
                  role="radio"
                  aria-checked={col.type === 'select'}
                  className={col.type === 'select' ? 'on' : ''}
                  onClick={() => setCol({ type: 'select', options: col.options.length ? col.options : [{ id: uid(), label: 'Option 1', color: 'blue' }] })}
                >
                  Auswahl
                </button>
              </div>
            </div>
            {col.type === 'select' && (
              <div className="menu-sec">
                <span className="eyebrow">Optionen</span>
                <div className="opt-list">
                  {col.options.map((o) => (
                    <div className="opt-row" key={o.id}>
                      <input className="text-input" aria-label="Optionsname" value={o.label} onChange={(e) => setOpt(o.id, { label: e.target.value }, `opt:${o.id}`)} />
                      <select className={`chip-select tint-${o.color || 'none'}`} aria-label="Optionsfarbe" value={o.color} onChange={(e) => setOpt(o.id, { color: e.target.value as SelectOption['color'] })}>
                        {['', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'grey'].map((t) => (
                          <option key={t} value={t}>
                            {({ '': 'Keine', red: 'Rot', orange: 'Orange', yellow: 'Gelb', green: 'Grün', teal: 'Türkis', blue: 'Blau', violet: 'Violett', grey: 'Grau' } as Record<string, string>)[t]}
                          </option>
                        ))}
                      </select>
                      <button className="icon-btn" aria-label="Option entfernen" onClick={() => setCol({ options: col.options.filter((x) => x.id !== o.id) })}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                  <button className="btn small ghost" onClick={() => setCol({ options: [...col.options, { id: uid(), label: `Option ${col.options.length + 1}`, color: '' }] })}>
                    <Icon name="plus" size={13} /> Option
                  </button>
                </div>
              </div>
            )}
            <div className="menu-sec">
              <span className="eyebrow">Breite</span>
              <div className="seg" role="radiogroup" aria-label="Spaltenbreite">
                {[
                  [120, 'S'],
                  [180, 'M'],
                  [260, 'L'],
                  [360, 'XL'],
                ].map(([w, l]) => (
                  <button key={l} role="radio" aria-checked={col.width === w} className={col.width === w ? 'on' : ''} onClick={() => setCol({ width: w as number })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="menu-list">
              <button disabled={index === 0} onClick={() => move(-1)}>
                <Icon name="left" size={14} /> Nach links
              </button>
              <button disabled={index === r.columns.length - 1} onClick={() => move(1)}>
                <Icon name="right" size={14} /> Nach rechts
              </button>
              {!confirm ? (
                <button className="danger" onClick={() => setConfirm(true)}>
                  <Icon name="trash" size={14} /> Spalte löschen
                </button>
              ) : (
                <div className="confirm">
                  <span>Inhalte der Spalte gehen verloren.</span>
                  <button
                    className="btn danger-fill small"
                    onClick={() => {
                      edit(r.id, (rr) => ({ ...rr, columns: rr.columns.filter((c) => c.id !== col.id) }));
                      menu.close();
                    }}
                  >
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
    </div>
  );
}

/* ---------- Mehrfachauswahl ---------- */
function BatchBar({ r, selected, clear, selectAll, locked }: { r: Rundown; selected: Set<string>; clear: () => void; selectAll: () => void; locked: boolean }) {
  const color = usePopover();
  const ordered = r.items.filter((i) => selected.has(i.id));
  const cues = ordered.filter(isCue);
  const allSkipped = cues.length > 0 && cues.every((c) => c.skip);
  const total = cues.filter((c) => !c.skip).reduce((s, c) => s + c.duration, 0);
  return (
    <div className="batch" role="toolbar" aria-label="Auswahl bearbeiten">
      <span className="batch-count">
        <b>{selected.size}</b> ausgewählt{cues.length > 0 && <span className="num"> · {fmtDur(total)}</span>}
      </span>
      <button className="btn small ghost" onClick={selectAll}>
        Alle
      </button>
      {!locked && (
        <>
          <button
            className="btn small ghost"
            onClick={() =>
              edit(r.id, (rr) => {
                const last = rr.items.map((i) => i.id).lastIndexOf(ordered[ordered.length - 1].id);
                const items = [...rr.items];
                items.splice(last + 1, 0, ...ordered.map(cloneItem));
                return { ...rr, items };
              })
            }
          >
            Duplizieren
          </button>
          <button
            className="btn small ghost"
            disabled={!cues.length}
            onClick={() => edit(r.id, (rr) => ({ ...rr, items: rr.items.map((i) => (selected.has(i.id) && isCue(i) ? { ...i, skip: !allSkipped } : i)) }))}
          >
            {allSkipped ? 'Nicht überspringen' : 'Überspringen'}
          </button>
          <button
            className="btn small ghost"
            onClick={() =>
              edit(r.id, (rr) => {
                const items = [...rr.items];
                items.splice(items.findIndex((i) => i.id === ordered[0].id), 0, newHeading('Neue Gruppe'));
                return { ...rr, items };
              })
            }
          >
            Gruppieren
          </button>
          <button className="btn small ghost" onClick={color.open}>
            Farbe <Icon name="chevron" size={12} />
          </button>
          <button
            className="btn small ghost danger"
            onClick={() => {
              removeItems(r.id, selected);
              clear();
            }}
          >
            Löschen
          </button>
        </>
      )}
      <button className="icon-btn" onClick={clear} aria-label="Auswahl aufheben" title="Auswahl aufheben">
        <Icon name="close" size={15} />
      </button>
      {color.anchor && (
        <Popover anchor={color.anchor} onClose={color.close} className="menu">
          <div className="menu-body">
            <Swatches value={''} onPick={(c) => (edit(r.id, (rr) => ({ ...rr, items: rr.items.map((i) => (selected.has(i.id) ? { ...i, color: c } : i)) })), color.close())} />
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ---------- Fußzeile: nächster Fixstart + Showende ---------- */
function Footer({ r, tl, now, live, locked, sheet }: { r: Rundown; tl: Timeline; now: number; live: LiveState; locked: boolean; sheet: React.RefObject<HTMLDivElement> }) {
  const ou = tl.overUnder;
  const late = ou >= 1000;
  const early = ou <= -1000;
  const nh = tl.nextHard;
  return (
    <footer className="foot">
      {nh && (
        <button
          className="hard-bar"
          onClick={() => sheet.current?.querySelector<HTMLElement>(`[data-id="${nh.cue.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          title="Zum Fixstart springen"
        >
          <span className="eyebrow">
            <Icon name="pin" size={12} /> Nächster Fixstart
          </span>
          <span className="num strong">{fmtClock(nh.at)}</span>
          <span className="num">in {fmtCountdown(nh.at - now).text}</span>
          {nh.gap != null && Math.abs(nh.gap) >= 1000 && (
            <span className={`num ${nh.gap > 0 ? 'gap-txt' : 'late'}`}>
              {nh.gap > 0 ? 'Lücke' : 'Überschneidung'} {fmtDur(Math.abs(nh.gap))}
            </span>
          )}
          <span className="hard-title">{nh.cue.title}</span>
        </button>
      )}
      <div className="summary">
        <div className="sum-item">
          <span className="eyebrow">Programm</span>
          <span className="num">
            {tl.cueCount} Cues · {fmtDur(tl.totalDuration)}
          </span>
        </div>
        <div className="sum-item">
          <span className="eyebrow">Geplantes Ende</span>
          {locked ? (
            <span className="num">{fmtClock(tl.targetEnd)}</span>
          ) : (
            <span className="planned-end">
              <ClockInput value={r.plannedEnd ?? msOfDay(tl.plannedEnd)} onChange={(v) => edit(r.id, (rr) => ({ ...rr, plannedEnd: v }))} label="Geplantes Ende" />
              {r.plannedEnd != null && (
                <button className="link-btn" onClick={() => edit(r.id, (rr) => ({ ...rr, plannedEnd: null }))} title="Ende wieder aus den Cues berechnen">
                  aus Cues
                </button>
              )}
            </span>
          )}
        </div>
        <div className="sum-item">
          <span className="eyebrow">{live.status === 'ended' ? 'Tatsächliches Ende' : live.status === 'idle' ? 'Berechnetes Ende' : 'Voraussichtliches Ende'}</span>
          <span className="num strong">{fmtClock(tl.calcEnd)}</span>
        </div>
        <div className={`sum-item ou ${late ? 'late' : early ? 'early' : 'ontime'}`}>
          <span className="eyebrow">Über / Unter</span>
          <span className="num strong">{late ? `+${fmtDur(ou)} zu spät` : early ? `${fmtDur(-ou)} zu früh` : 'Pünktlich'}</span>
        </div>
      </div>
    </footer>
  );
}
