import { Cue, LiveState, Rundown, SubTimer, SubTimerState, isCue } from './types';
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
  messageVisible: false,
  flash: false,
  msgBold: true,
  msgUnderline: false,
  msgColor: 'white',
  subTimers: {},
  prompter: null,
  updatedAt: 0,
});

/** Ergänzt fehlende Felder älterer Live-Zustände */
export function normalizeLive(l: Partial<LiveState> | undefined | null): LiveState {
  const base = emptyLive();
  if (!l) return base;
  const merged = { ...base, ...l } as LiveState;
  if (l.message && l.messageVisible === undefined) merged.messageVisible = true;
  return merged;
}

/** Alle Cues, die gespielt werden (ohne Überschriften und übersprungene) */
export function playable(r: Rundown): Cue[] {
  return r.items.filter((i): i is Cue => isCue(i) && !i.skip);
}

/** Fixstart als Epoch. Liegt er mehr als 12 h vor Showbeginn, gilt der Folgetag. */
export function hardEpoch(r: Rundown, c: Cue): number {
  const extra = c.hardStart < r.start - DAY / 2 ? DAY : 0;
  return epochAt(r.date, c.hardStart + extra, r.settings?.timezone ?? '');
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
    const pos = r.items.findIndex((x) => x.id === l.currentId);
    return list.find((c) => r.items.indexOf(c) > pos) ?? null;
  }
  return list[i + 1] ?? null;
}

/* ---------- Unter-Timer ---------- */

function cueOf(r: Rundown | null, id: string | null): Cue | null {
  if (!r || !id) return null;
  const c = r.items.find((x) => x.id === id);
  return c && isCue(c) ? c : null;
}

/** Abgelaufene Zeit eines Unter-Timers */
export function subElapsed(t: SubTimer, cue: Cue, l: LiveState, now: number): { elapsed: number; running: boolean; linked: boolean } {
  const st = l.subTimers[t.id];
  const linked = t.withCue && !st?.detached;
  if (linked && l.currentId === cue.id && (l.status === 'running' || l.status === 'paused')) {
    return { elapsed: Math.max(0, elapsedOf(l, now)), running: l.status === 'running', linked };
  }
  if (!st) return { elapsed: 0, running: false, linked };
  return { elapsed: st.acc + (st.running ? now - st.since : 0), running: st.running, linked };
}

/** Anzeigewert: Countdown bzw. Stoppuhr, inkl. Zustand bei 0 */
export function subDisplay(t: SubTimer, elapsed: number): { value: number; state: 'ok' | 'stopped' | 'over' } {
  if (t.mode === 'up') return { value: elapsed, state: 'ok' };
  const rest = t.duration - elapsed;
  if (rest > 0) return { value: rest, state: 'ok' };
  return t.atZero === 'stop' ? { value: 0, state: 'stopped' } : { value: rest, state: 'over' };
}

/** Beim Verlassen eines Cues: verknüpfte Timer an der aktuellen Stelle einfrieren */
function freezeLinked(r: Rundown | null, l: LiveState, at: number, subTimers: Record<string, SubTimerState>) {
  const cue = cueOf(r, l.currentId);
  if (!cue) return;
  for (const t of cue.subTimers ?? []) {
    const st = subTimers[t.id];
    if (t.withCue && !st?.detached) subTimers[t.id] = { running: false, since: at, acc: Math.max(0, elapsedOf(l, at)), detached: false };
  }
}

/** Beim Betreten eines Cues: verknüpfte Timer zurücksetzen */
function resetLinked(r: Rundown | null, id: string, subTimers: Record<string, SubTimerState>) {
  const cue = cueOf(r, id);
  for (const t of cue?.subTimers ?? []) if (t.withCue) delete subTimers[t.id];
}

export function subControl(r: Rundown, l: LiveState, cueId: string, timerId: string, action: 'start' | 'pause' | 'reset', now: number): LiveState {
  if (l.status === 'idle') return l;
  const cue = cueOf(r, cueId);
  const t = cue?.subTimers.find((x) => x.id === timerId);
  if (!cue || !t) return l;
  const cur = subElapsed(t, cue, l, now);
  let st: SubTimerState;
  if (action === 'reset') st = { running: false, since: now, acc: 0, detached: true };
  else if (action === 'pause') st = { running: false, since: now, acc: cur.elapsed, detached: true };
  else st = { running: true, since: now, acc: cur.elapsed, detached: true };
  return { ...l, subTimers: { ...l.subTimers, [timerId]: st } };
}

/* ---------- Show-Steuerung ---------- */

export function goLive(l: LiveState, id: string, at: number, recordCurrent = true, r: Rundown | null = null): LiveState {
  const history = { ...l.history };
  const subTimers = { ...l.subTimers };
  if (l.currentId && (l.status === 'running' || l.status === 'paused')) {
    if (recordCurrent) history[l.currentId] = { start: l.cueStart, end: at };
    freezeLinked(r, l, at, subTimers);
  }
  delete history[id];
  resetLinked(r, id, subTimers);
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
    subTimers,
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
  return n ? goLive(l, n.id, now, true, r) : l;
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
  return n ? goLive(l, n.id, now, true, r) : end(l, now, r);
}

export function prev(r: Rundown, l: LiveState, now: number): LiveState {
  if (l.status === 'idle' || !l.currentId) return l;
  const list = playable(r);
  const i = list.findIndex((c) => c.id === l.currentId);
  if (i <= 0) return goLive(l, l.currentId, now, false, r);
  return goLive(l, list[i - 1].id, now, false, r);
}

export function end(l: LiveState, now: number, r: Rundown | null = null): LiveState {
  const history = { ...l.history };
  const subTimers = { ...l.subTimers };
  if (l.currentId && (l.status === 'running' || l.status === 'paused')) {
    history[l.currentId] = { start: l.cueStart, end: now };
    freezeLinked(r, l, now, subTimers);
  }
  return { ...l, status: 'ended', currentId: null, nextId: null, pausedAt: null, history, subTimers, showEnd: now };
}

export function reset(l: LiveState): LiveState {
  const e = emptyLive();
  return { ...e, message: l.message, messageVisible: l.messageVisible, flash: l.flash, msgBold: l.msgBold, msgUnderline: l.msgUnderline, msgColor: l.msgColor, prompter: l.prompter };
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
    const cur = cueOf(r, l.currentId);
    if (cur) {
      const boundary = l.cueStart + l.pausedTotal + cur.duration + l.adjust;
      if (now >= boundary) {
        const n = resolveNext(r, l);
        if (n && n.autoStart && n.startMode === 'soft') return goLive(l, n.id, boundary, true, r);
      }
    }
  }
  if (l.status === 'paused') return null;
  for (const c of playable(r)) {
    if (c.startMode !== 'hard' || !c.autoStart) continue;
    const at = hardEpoch(r, c);
    if (now >= at && now - at < 4000 && l.currentId !== c.id) {
      const h = l.history[c.id];
      if (!h || h.start < at - 30_000) return goLive(l, c.id, at, true, r);
    }
  }
  return null;
}

/** Aktionen für API und Tastatur an einer Stelle */
export type LiveAction = 'start' | 'pause' | 'toggle' | 'next' | 'previous' | 'end' | 'reset';
export function applyAction(r: Rundown, l: LiveState, action: LiveAction, now: number): LiveState {
  switch (action) {
    case 'start':
      return startOrResume(r, l, now);
    case 'pause':
      return pause(l, now);
    case 'toggle':
      return togglePlay(r, l, now);
    case 'next':
      return next(r, l, now);
    case 'previous':
      return prev(r, l, now);
    case 'end':
      return end(l, now, r);
    case 'reset':
      return reset(l);
  }
}
