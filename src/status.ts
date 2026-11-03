// Live-Status für API, Companion und Overlays (vom Server genutzt, rein funktional)
import { LiveState, Rundown, isCue } from './types';
import { computeTimeline } from './timing';
import { playable, subDisplay, subElapsed } from './live';
import { fmtCountdown, fmtDur, msOfDay, fmtTimeInput } from './time';

const clock = (epoch: number, tz: string, seconds = true) => fmtTimeInput(msOfDay(epoch, tz), seconds);
const sec = (ms: number) => Math.round(ms / 1000);

/** Ausführlicher Status (JSON für Overlays und eigene Skripte) */
export function nowSummary(r: Rundown, l: LiveState, now: number) {
  const tl = computeTimeline(r, l, now);
  const cueInfo = (c: ReturnType<typeof playable>[number] | null | undefined) =>
    c ? { id: c.id, label: tl.cues[c.id]?.label, title: c.title, subtitle: c.subtitle, duration: c.duration, cells: c.cells } : null;
  const list = playable(r);
  const idx = tl.current ? list.findIndex((c) => c.id === tl.current!.cue.id) : -1;
  return {
    rundown: { id: r.id, title: r.title },
    status: l.status,
    serverNow: now,
    current: tl.current
      ? { ...cueInfo(tl.current.cue), elapsed: tl.current.elapsed, remaining: tl.current.remaining, over: tl.current.remaining < 0, progress: tl.current.progress, adjust: l.adjust }
      : null,
    previous: idx > 0 ? cueInfo(list[idx - 1]) : null,
    next: cueInfo(tl.next),
    position: idx >= 0 ? idx + 1 : 0,
    count: list.length,
    showStart: l.showStart,
    calculatedEnd: tl.calcEnd,
    plannedEnd: tl.targetEnd,
    overUnder: tl.overUnder,
    message: l.messageVisible ? l.message : '',
    subTimers: tl.current
      ? tl.current.cue.subTimers.map((t) => {
          const v = subElapsed(t, tl.current!.cue, l, now);
          const d = subDisplay(t, v.elapsed);
          return { id: t.id, name: t.name, running: v.running, value: d.value, state: d.state };
        })
      : [],
  };
}

/** Flache Werte für Companion-Variablen (Feldnamen wie in FF Rundown) */
export function flatStatus(r: Rundown, l: LiveState, now: number) {
  const tz = r.settings.timezone;
  const tl = computeTimeline(r, l, now);
  const cur = tl.current;
  const list = playable(r);
  const idx = cur ? list.findIndex((c) => c.id === cur.cue.id) : -1;
  const running = !!cur;
  const state = !cur ? 'stopped' : l.status === 'paused' ? 'paused' : cur.remaining < 0 ? 'overtime' : cur.remaining <= r.warnAt ? 'warning' : 'running';
  return {
    rundown: r.title,
    running,
    state,
    cue_id: cur?.cue.id ?? null,
    cue_label: cur ? tl.cues[cur.cue.id]?.label ?? '' : '',
    title: cur?.cue.title ?? '',
    description: cur?.cue.subtitle ?? '',
    next: tl.next?.title ?? '',
    next_id: tl.next?.id ?? null,
    remaining: cur ? fmtCountdown(cur.remaining).text : '--:--',
    remaining_sec: cur ? sec(cur.remaining) : 0,
    elapsed: cur ? fmtDur(cur.elapsed) : '--:--',
    elapsed_sec: cur ? sec(cur.elapsed) : 0,
    duration: cur ? fmtDur(cur.duration) : '--:--',
    duration_sec: cur ? sec(cur.duration) : 0,
    adjust_sec: cur ? sec(l.adjust) : 0,
    delta: (tl.overUnder >= 0 ? '+' : '-') + fmtDur(Math.abs(tl.overUnder)),
    delta_sec: sec(tl.overUnder),
    live_since: l.showStart && l.status !== 'idle' ? clock(l.showStart, tz, false) : '',
    projected_end: clock(tl.calcEnd, tz),
    planned_end: clock(tl.targetEnd, tz),
    item_number: idx >= 0 ? idx + 1 : 0,
    item_count: list.length,
    progress: cur ? Math.round(cur.progress * 100) : 0,
    message: l.messageVisible ? l.message : '',
    clock: clock(now, tz),
  };
}

/** Kompletter Ablauf mit berechneten Zeiten (für /rundown) */
export function rundownExport(r: Rundown, l: LiveState, now: number) {
  const tl = computeTimeline(r, l, now);
  return {
    id: r.id,
    title: r.title,
    date: r.date,
    timezone: r.settings.timezone,
    columns: r.columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    items: r.items.map((it) => {
      if (!isCue(it)) return { id: it.id, type: it.end ? 'block_end' : 'block', title: it.title, ...(tl.groups[it.id] ? { count: tl.groups[it.id].count, total: tl.groups[it.id].total } : {}) };
      const t = tl.cues[it.id];
      return {
        id: it.id,
        type: 'cue',
        label: t.label,
        title: it.title,
        subtitle: it.subtitle,
        duration: it.duration,
        skip: it.skip,
        plannedStart: t.plannedStart,
        plannedEnd: t.plannedEnd,
        start: t.start,
        end: t.end,
        status: t.status,
        actualDuration: t.actualDur,
        cells: Object.fromEntries(
          r.columns.map((c) => [c.name, c.type === 'select' ? c.options.find((o) => o.id === it.cells[c.id])?.label ?? '' : it.cells[c.id] ?? '']),
        ),
      };
    }),
    calculatedEnd: tl.calcEnd,
    plannedEnd: tl.targetEnd,
    overUnder: tl.overUnder,
  };
}
