import { Cue, LiveState, Rundown, isCue } from './types';
import { DAY, epochAt } from './time';
import { elapsedOf, hardEpoch, playable, resolveNext } from './live';

export type CueStatus = 'done' | 'missed' | 'current' | 'next' | 'upcoming' | 'skipped';

export interface CueTime {
  num: number | null;
  plannedStart: number;
  plannedEnd: number;
  /** Live-Projektion (vor der Show = Planung) */
  start: number;
  end: number;
  /** Nur bei Fix-Cues: positiv = Lücke, negativ = Überschneidung */
  gap: number | null;
  status: CueStatus;
  actualDur: number | null;
}

export interface GroupTime {
  total: number;
  count: number;
  start: number | null;
  end: number | null;
  plannedStart: number | null;
  plannedEnd: number | null;
  elapsed: number | null;
}

export interface Timeline {
  cues: Record<string, CueTime>;
  groups: Record<string, GroupTime>;
  showStart: number;
  plannedEnd: number;
  targetEnd: number;
  calcEnd: number;
  overUnder: number;
  totalDuration: number;
  cueCount: number;
  current: null | { cue: Cue; elapsed: number; remaining: number; duration: number; progress: number };
  next: Cue | null;
  nextHard: null | { cue: Cue; at: number; gap: number | null };
}

export function computeTimeline(r: Rundown, l: LiveState, now: number): Timeline {
  const showStart = epochAt(r.date, r.start);
  const list = playable(r);
  const cues: Record<string, CueTime> = {};

  // 1) Planung
  let t = showStart;
  const planned: Record<string, { s: number; e: number; gap: number | null }> = {};
  let totalDuration = 0;
  for (const c of list) {
    const hard = c.startMode === 'hard' ? hardEpoch(r, c) : null;
    const s = hard ?? t;
    planned[c.id] = { s, e: s + c.duration, gap: hard != null ? hard - t : null };
    t = s + c.duration;
    totalDuration += c.duration;
  }
  const plannedEnd = list.length ? t : showStart;

  // 2) Live-Projektion
  const live: Record<string, { s: number; e: number; gap: number | null; status: CueStatus; actual: number | null }> = {};
  let current: Timeline['current'] = null;
  const idx = l.currentId ? list.findIndex((c) => c.id === l.currentId) : -1;

  const past = (c: Cue) => {
    const h = l.history[c.id];
    live[c.id] = h
      ? { s: h.start, e: h.end, gap: null, status: 'done', actual: h.end - h.start }
      : { ...planned[c.id], status: 'missed', actual: null };
  };

  if (l.status === 'idle') {
    for (const c of list) live[c.id] = { ...planned[c.id], status: 'upcoming', actual: null };
  } else if (idx < 0) {
    for (const c of list) past(c);
  } else {
    t = 0;
    list.forEach((c, i) => {
      if (i < idx) return past(c);
      if (i === idx) {
        const duration = c.duration + l.adjust;
        const elapsed = elapsedOf(l, now);
        const remaining = duration - elapsed;
        const e = now + Math.max(0, remaining);
        live[c.id] = { s: l.cueStart, e, gap: null, status: 'current', actual: null };
        current = { cue: c, elapsed, remaining, duration, progress: duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 1 };
        t = e;
        return;
      }
      const hard = c.startMode === 'hard' ? hardEpoch(r, c) : null;
      // Bei Überschneidung startet der Fix-Cue realistisch erst nach dem Vorgänger
      const s = hard != null ? Math.max(hard, t) : t;
      live[c.id] = { s, e: s + c.duration, gap: hard != null ? hard - t : null, status: 'upcoming', actual: null };
      t = s + c.duration;
    });
  }

  const nextCue = l.status === 'ended' && !l.nextId ? null : resolveNext(r, l);
  if (nextCue && live[nextCue.id] && live[nextCue.id].status !== 'current') live[nextCue.id].status = 'next';

  // 3) Nummerierung + Ergebnis je Cue
  let n = 0;
  for (const item of r.items) {
    if (!isCue(item)) continue;
    if (item.skip) {
      cues[item.id] = { num: null, plannedStart: 0, plannedEnd: 0, start: 0, end: 0, gap: null, status: 'skipped', actualDur: null };
      continue;
    }
    const p = planned[item.id];
    const v = live[item.id];
    cues[item.id] = { num: ++n, plannedStart: p.s, plannedEnd: p.e, start: v.s, end: v.e, gap: v.gap, status: v.status, actualDur: v.actual };
  }

  // 4) Gruppen (Überschrift bis zur nächsten Überschrift)
  const groups: Record<string, GroupTime> = {};
  let g: GroupTime | null = null;
  let groupLive = false;
  const closeGroup = () => {
    if (g && groupLive && g.start != null) g.elapsed = now - g.start;
  };
  for (const item of r.items) {
    if (!isCue(item)) {
      closeGroup();
      g = groups[item.id] = { total: 0, count: 0, start: null, end: null, plannedStart: null, plannedEnd: null, elapsed: null };
      groupLive = false;
      continue;
    }
    if (!g || item.skip) continue;
    const ct = cues[item.id];
    g.total += item.duration;
    g.count++;
    g.start ??= ct.start;
    g.end = ct.end;
    g.plannedStart ??= ct.plannedStart;
    g.plannedEnd = ct.plannedEnd;
    if (ct.status === 'current') groupLive = true;
  }
  closeGroup();

  // 5) Gesamtende, Über/Unter
  const calcEnd = l.status === 'ended' ? l.showEnd ?? now : list.length ? live[list[list.length - 1].id].e : showStart;
  let targetEnd = plannedEnd;
  if (r.plannedEnd != null) targetEnd = epochAt(r.date, r.plannedEnd + (r.plannedEnd < r.start - DAY / 2 ? DAY : 0));

  // 6) Nächster Fixstart
  let nextHard: Timeline['nextHard'] = null;
  if (l.status !== 'ended') {
    for (let i = idx >= 0 ? idx + 1 : 0; i < list.length; i++) {
      const c = list[i];
      if (c.startMode !== 'hard') continue;
      const at = hardEpoch(r, c);
      if (at > now - 1000) {
        nextHard = { cue: c, at, gap: live[c.id].gap };
        break;
      }
    }
  }

  return {
    cues,
    groups,
    showStart,
    plannedEnd,
    targetEnd,
    calcEnd,
    overUnder: calcEnd - targetEnd,
    totalDuration,
    cueCount: list.length,
    current,
    next: nextCue,
    nextHard,
  };
}
