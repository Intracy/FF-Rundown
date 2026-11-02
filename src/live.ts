import { Cue, LiveState, Rundown, isCue } from './types';
import { DAY, epochAt } from './time';

export const emptyLive = (): LiveState => ({
  status: 'idle',
  currentId: null,
  nextId: null,
  cueStart: 0,
  pausedAt: null,
  pausedTotal: 0,
  adjust: 0,
  history: {},
  showStart: null,
  showEnd: null,
  message: '',
  flash: false,
  updatedAt: 0,
});

/** Alle Cues, die gespielt werden (ohne Überschriften und übersprungene) */
export function playable(r: Rundown): Cue[] {
  return r.items.filter((i): i is Cue => isCue(i) && !i.skip);
}

/** Fixstart als Epoch. Liegt er mehr als 12 h vor Showbeginn, gilt der Folgetag. */
export function hardEpoch(r: Rundown, c: Cue): number {
  const extra = c.hardStart < r.start - DAY / 2 ? DAY : 0;
  return epochAt(r.date, c.hardStart + extra);
}

export function elapsedOf(l: LiveState, now: number): number {
  return (l.pausedAt ?? now) - l.cueStart - l.pausedTotal;
}

export function resolveNext(r: Rundown, l: LiveState): Cue | null {
  const list = playable(r);
  if (l.nextId) {
    const c = list.find((x) => x.id === l.nextId);
    if (c) return c;
  }
  if (l.status === 'idle') return list[0] ?? null;
  if (!l.currentId) return null;
  const i = list.findIndex((c) => c.id === l.currentId);
  if (i < 0) {
    // Aktueller Cue wurde übersprungen oder gelöscht: nächster in Item-Reihenfolge
    const pos = r.items.findIndex((x) => x.id === l.currentId);
    return list.find((c) => r.items.indexOf(c) > pos) ?? null;
  }
  return list[i + 1] ?? null;
}

export function goLive(l: LiveState, id: string, at: number, recordCurrent = true): LiveState {
  const history = { ...l.history };
  if (recordCurrent && l.currentId && (l.status === 'running' || l.status === 'paused')) {
    history[l.currentId] = { start: l.cueStart, end: at };
  }
  delete history[id];
  return {
    ...l,
    status: 'running',
    currentId: id,
    nextId: null,
    cueStart: at,
    pausedAt: null,
    pausedTotal: 0,
    adjust: 0,
    history,
    showStart: l.status === 'idle' || l.showStart == null ? at : l.showStart,
    showEnd: null,
  };
}

export function startOrResume(r: Rundown, l: LiveState, now: number): LiveState {
  if (l.status === 'paused') {
    return { ...l, status: 'running', pausedTotal: l.pausedTotal + (now - (l.pausedAt ?? now)), pausedAt: null };
  }
  if (l.status === 'running') return l;
  const n = resolveNext(r, l);
  return n ? goLive(l, n.id, now) : l;
}

export function pause(l: LiveState, now: number): LiveState {
  return l.status === 'running' ? { ...l, status: 'paused', pausedAt: now } : l;
}

export function togglePlay(r: Rundown, l: LiveState, now: number): LiveState {
  return l.status === 'running' ? pause(l, now) : startOrResume(r, l, now);
}

export function next(r: Rundown, l: LiveState, now: number): LiveState {
  if (l.status === 'idle' || l.status === 'ended') return startOrResume(r, l, now);
  const n = resolveNext(r, l);
  return n ? goLive(l, n.id, now) : end(l, now);
}

export function prev(r: Rundown, l: LiveState, now: number): LiveState {
  if (l.status === 'idle' || !l.currentId) return l;
  const list = playable(r);
  const i = list.findIndex((c) => c.id === l.currentId);
  if (i <= 0) return goLive(l, l.currentId, now, false);
  return goLive(l, list[i - 1].id, now, false);
}

export function end(l: LiveState, now: number): LiveState {
  const history = { ...l.history };
  if (l.currentId && (l.status === 'running' || l.status === 'paused')) history[l.currentId] = { start: l.cueStart, end: now };
  return { ...l, status: 'ended', currentId: null, nextId: null, pausedAt: null, history, showEnd: now };
}

export function reset(l: LiveState): LiveState {
  return { ...emptyLive(), message: l.message, flash: l.flash };
}

export function adjust(l: LiveState, delta: number): LiveState {
  if (l.status !== 'running' && l.status !== 'paused') return l;
  return { ...l, adjust: l.adjust + delta };
}

export function cueNext(l: LiveState, id: string): LiveState {
  return { ...l, nextId: l.nextId === id ? null : id };
}

/**
 * Automatisches Weiterschalten. Liefert einen neuen Zustand oder null.
 * - Soft-Cue mit Auto-Start: startet, sobald der laufende Cue abgelaufen ist (exakt an der Grenze, ohne Drift)
 * - Fix-Cue mit Auto-Start: startet zur Tageszeit (nur innerhalb von 4 s, damit beim Laden nichts Altes feuert)
 */
export function autoTick(r: Rundown, l: LiveState, now: number): LiveState | null {
  if (l.status === 'running' && l.currentId) {
    const cur = r.items.find((x) => x.id === l.currentId);
    if (cur && isCue(cur)) {
      const boundary = l.cueStart + l.pausedTotal + cur.duration + l.adjust;
      if (now >= boundary) {
        const n = resolveNext(r, l);
        if (n && n.autoStart && n.startMode === 'soft') return goLive(l, n.id, boundary);
      }
    }
  }
  if (l.status === 'paused') return null;
  for (const c of playable(r)) {
    if (c.startMode !== 'hard' || !c.autoStart) continue;
    const at = hardEpoch(r, c);
    if (now >= at && now - at < 4000 && l.currentId !== c.id) {
      const h = l.history[c.id];
      if (!h || h.start < at - 30_000) return goLive(l, c.id, at);
    }
  }
  return null;
}
