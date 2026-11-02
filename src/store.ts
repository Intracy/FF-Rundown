import { useSyncExternalStore } from 'react';
import { LiveState, Rundown } from './types';
import { emptyLive } from './live';
import { makeSample } from './sample';
import { ServerState, SyncMsg, SyncStatus, sync } from './sync';

const KEY = 'taktgeber:v1';
const UI_KEY = 'taktgeber:ui';

export interface UiPrefs {
  follow: boolean;
  locked: boolean;
}

export interface AppState {
  rundowns: Record<string, Rundown>;
  live: Record<string, LiveState>;
  deleted: Record<string, number>;
  activeId: string;
  syncStatus: SyncStatus;
  peers: number;
  ui: UiPrefs;
  undoDepth: number;
  redoDepth: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar – App läuft trotzdem */
  }
}

/** ID des automatisch angelegten Beispiels, solange es unverändert ist (wird bei Server-Daten verworfen) */
let pristineId: string | null = null;

function initial(): AppState {
  const saved = read<{ rundowns: Record<string, Rundown>; live: Record<string, LiveState>; deleted?: Record<string, number>; activeId: string }>(KEY);
  const ui = { follow: true, locked: false, ...(read<UiPrefs>(UI_KEY) ?? {}) };
  if (saved && saved.rundowns && Object.keys(saved.rundowns).length) {
    const ids = Object.keys(saved.rundowns);
    return {
      rundowns: saved.rundowns,
      live: saved.live ?? {},
      deleted: saved.deleted ?? {},
      activeId: ids.includes(saved.activeId) ? saved.activeId : ids[0],
      syncStatus: 'local',
      peers: 1,
      ui,
      undoDepth: 0,
      redoDepth: 0,
    };
  }
  const r = makeSample();
  pristineId = r.id;
  return { rundowns: { [r.id]: r }, live: {}, deleted: {}, activeId: r.id, syncStatus: 'local', peers: 1, ui, undoDepth: 0, redoDepth: 0 };
}

let state: AppState = initial();
const listeners = new Set<() => void>();
let saveTimer = 0;

const undo = new Map<string, Rundown[]>();
const redo = new Map<string, Rundown[]>();
let lastKey = '';
let lastKeyAt = 0;

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  const u = undo.get(state.activeId)?.length ?? 0;
  const r = redo.get(state.activeId)?.length ?? 0;
  if (u !== state.undoDepth || r !== state.redoDepth) state = { ...state, undoDepth: u, redoDepth: r };
  listeners.forEach((l) => l());
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    write(KEY, { rundowns: state.rundowns, live: state.live, deleted: state.deleted, activeId: state.activeId });
    write(UI_KEY, state.ui);
  }, 250);
}

export const now = () => sync.now();

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  setActive(id: string) {
    if (state.rundowns[id]) set({ activeId: id });
  },

  setUi(patch: Partial<UiPrefs>) {
    set({ ui: { ...state.ui, ...patch } });
  },

  /**
   * Ablauf ändern. coalesce bündelt schnelle Folgeänderungen (z. B. Tippen) zu einem Undo-Schritt.
   */
  updateRundown(id: string, fn: (r: Rundown) => Rundown, coalesce?: string) {
    const prev = state.rundowns[id];
    if (!prev) return;
    if (id === pristineId) pristineId = null;
    const next = { ...fn(prev), updatedAt: now() };
    const t = Date.now();
    if (!coalesce || coalesce !== lastKey || t - lastKeyAt > 1500) {
      const stack = undo.get(id) ?? [];
      stack.push(prev);
      if (stack.length > 100) stack.shift();
      undo.set(id, stack);
    }
    lastKey = coalesce ?? '';
    lastKeyAt = t;
    redo.delete(id);
    set({ rundowns: { ...state.rundowns, [id]: next } });
    sync.send({ t: 'rundown', rundown: next });
  },

  undo(id: string) {
    const stack = undo.get(id);
    const prev = stack?.pop();
    if (!prev) return;
    const cur = state.rundowns[id];
    redo.set(id, [...(redo.get(id) ?? []), cur]);
    lastKey = '';
    const restored = { ...prev, updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [id]: restored } });
    sync.send({ t: 'rundown', rundown: restored });
  },

  redo(id: string) {
    const stack = redo.get(id);
    const nxt = stack?.pop();
    if (!nxt) return;
    undo.set(id, [...(undo.get(id) ?? []), state.rundowns[id]]);
    lastKey = '';
    const restored = { ...nxt, updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [id]: restored } });
    sync.send({ t: 'rundown', rundown: restored });
  },

  addRundown(r: Rundown) {
    const rr = { ...r, updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [rr.id]: rr }, activeId: rr.id });
    sync.send({ t: 'rundown', rundown: rr });
  },

  deleteRundown(id: string) {
    const rundowns = { ...state.rundowns };
    delete rundowns[id];
    const live = { ...state.live };
    delete live[id];
    const at = now();
    let activeId = state.activeId;
    if (!Object.keys(rundowns).length) {
      const s = makeSample();
      rundowns[s.id] = s;
      sync.send({ t: 'rundown', rundown: s });
    }
    if (activeId === id) activeId = Object.values(rundowns).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    set({ rundowns, live, activeId, deleted: { ...state.deleted, [id]: at } });
    sync.send({ t: 'delete', id, at });
  },

  live(id: string): LiveState {
    return state.live[id] ?? emptyLive();
  },

  setLive(id: string, fn: (l: LiveState) => LiveState) {
    if (id === pristineId) pristineId = null;
    const cur = state.live[id] ?? emptyLive();
    const nxt = fn(cur);
    if (nxt === cur) return;
    const stamped = { ...nxt, updatedAt: now() };
    set({ live: { ...state.live, [id]: stamped } });
    sync.send({ t: 'live', id, live: stamped });
  },
};

function applyMsg(m: SyncMsg) {
  if (m.t === 'rundown') {
    const cur = state.rundowns[m.rundown.id];
    if (state.deleted[m.rundown.id]) return;
    if (!cur || m.rundown.updatedAt >= cur.updatedAt) set({ rundowns: { ...state.rundowns, [m.rundown.id]: m.rundown } });
  } else if (m.t === 'live') {
    const cur = state.live[m.id];
    if (!cur || m.live.updatedAt >= cur.updatedAt) set({ live: { ...state.live, [m.id]: m.live } });
  } else if (m.t === 'delete') {
    if (!state.rundowns[m.id]) return;
    const rundowns = { ...state.rundowns };
    delete rundowns[m.id];
    if (!Object.keys(rundowns).length) return;
    const activeId = state.activeId === m.id ? Object.keys(rundowns)[0] : state.activeId;
    set({ rundowns, activeId, deleted: { ...state.deleted, [m.id]: m.at } });
  }
}

function applyInit(s: ServerState) {
  const serverHasData = Object.keys(s.rundowns ?? {}).length > 0;
  let localActive = state.activeId;
  if (pristineId && serverHasData) {
    // Neues Gerät: unverändertes Beispiel verwerfen und die Abläufe des Servers übernehmen
    const rundowns = { ...state.rundowns };
    delete rundowns[pristineId];
    const live = { ...state.live };
    delete live[pristineId];
    state = { ...state, rundowns, live };
    if (localActive === pristineId) localActive = '';
    pristineId = null;
  }
  const deleted = { ...state.deleted, ...(s.deleted ?? {}) };
  const rundowns: Record<string, Rundown> = {};
  const live: Record<string, LiveState> = {};
  const ids = new Set([...Object.keys(state.rundowns), ...Object.keys(s.rundowns ?? {})]);
  for (const id of ids) {
    if (deleted[id]) continue;
    const local = state.rundowns[id];
    const remote = s.rundowns?.[id];
    const pick = !remote || (local && local.updatedAt > remote.updatedAt) ? local : remote;
    rundowns[id] = pick;
    if (pick === local && local) sync.send({ t: 'rundown', rundown: local });
    const ll = state.live[id];
    const rl = s.live?.[id];
    const lp = !rl || (ll && ll.updatedAt > rl.updatedAt) ? ll : rl;
    if (lp) {
      live[id] = lp;
      if (lp === ll && rl !== ll) sync.send({ t: 'live', id, live: ll });
    }
  }
  if (!Object.keys(rundowns).length) return;
  const onAir = Object.keys(rundowns).find((id) => live[id]?.status === 'running' || live[id]?.status === 'paused');
  const newest = Object.values(rundowns).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  const activeId = rundowns[localActive] ? localActive : onAir ?? newest;
  set({ rundowns, live, deleted, activeId });
}

sync.start({
  onInit: applyInit,
  onMsg: applyMsg,
  onStatus: (syncStatus, peers) => set({ syncStatus, peers }),
});

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.get);
}
