import { useSyncExternalStore } from 'react';
import { EventFolder, LiveState, Rundown } from './types';
import { normalizeLive } from './live';
import { normalizeRundown } from './model';
import { makeSample } from './sample';
import { AuthMode, Role, ServerState, ShareInfo, SyncMsg, SyncStatus, UserInfo, sync } from './sync';

const KEY = 'taktgeber:v1';
const UI_KEY = 'taktgeber:ui';

export interface UiPrefs {
  follow: boolean;
  locked: boolean;
  /** Je Ablauf: für dieses Gerät ausgeblendete Spalten */
  hiddenCols: Record<string, string[]>;
  /** Je Ablauf: private Notizspalte anzeigen */
  showPrivate: Record<string, boolean>;
  /** Je Ablauf und Cue: private Notizen (nur auf diesem Gerät) */
  privateNotes: Record<string, Record<string, string>>;
  /** Hell / Dunkel / wie System */
  theme: 'system' | 'light' | 'dark';
  compact: boolean;
  hideDone: boolean;
  /** Laufender Cue beim Mitlaufen oben oder in der Mitte */
  followPos: 'top' | 'center';
  /** Schrittweite der ±-Knöpfe in ms */
  step: number;
}

export interface AppState {
  rundowns: Record<string, Rundown>;
  events: Record<string, EventFolder>;
  live: Record<string, LiveState>;
  deleted: Record<string, number>;
  activeId: string;
  syncStatus: SyncStatus;
  peers: number;
  ui: UiPrefs;
  /** Zugriff über Gast-Link: nur dieser Ablauf, ggf. nur lesen */
  share: ShareInfo | null;
  authRequired: boolean;
  authMode: AuthMode;
  authError: string;
  user: UserInfo | null;
  /** Rechte dieser Sitzung (ohne Server: admin) */
  role: Role;
  /** Neuere Server-Version gefunden: Hinweis zum Neuladen */
  newVersion: string;
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

const normAll = (rs: Record<string, Rundown>) => Object.fromEntries(Object.entries(rs).map(([k, v]) => [k, normalizeRundown(v)]));
const normLive = (ls: Record<string, LiveState>) => Object.fromEntries(Object.entries(ls ?? {}).map(([k, v]) => [k, normalizeLive(v)]));

function initial(): AppState {
  const saved = read<{ rundowns: Record<string, Rundown>; events?: Record<string, EventFolder>; live: Record<string, LiveState>; deleted?: Record<string, number>; activeId: string }>(KEY);
  const ui: UiPrefs = { follow: true, locked: false, hiddenCols: {}, showPrivate: {}, privateNotes: {}, theme: 'system', compact: false, hideDone: false, followPos: 'center', step: 60_000, ...(read<UiPrefs>(UI_KEY) ?? {}) };
  const base = { syncStatus: 'local' as SyncStatus, peers: 1, ui, share: null, authRequired: false, authMode: 'password' as AuthMode, authError: '', user: null, role: 'admin' as Role, newVersion: '', undoDepth: 0, redoDepth: 0 };
  if (!sync.isShareLink && saved && saved.rundowns && Object.keys(saved.rundowns).length) {
    const ids = Object.keys(saved.rundowns);
    return {
      ...base,
      rundowns: normAll(saved.rundowns),
      events: saved.events ?? {},
      live: normLive(saved.live),
      deleted: saved.deleted ?? {},
      activeId: ids.includes(saved.activeId) ? saved.activeId : ids[0],
    };
  }
  const r = makeSample();
  pristineId = r.id;
  return { ...base, rundowns: { [r.id]: r }, events: {}, live: {}, deleted: {}, activeId: r.id };
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
    // Gast-Links speichern nichts dauerhaft in fremde Browser
    if (!state.share) write(KEY, { rundowns: state.rundowns, events: state.events, live: state.live, deleted: state.deleted, activeId: state.activeId });
    write(UI_KEY, state.ui);
  }, 250);
}

export const now = () => sync.now();

export const isReadOnly = () => state.role === 'viewer';
/** Darf den Ablauf bearbeiten (Editor/Admin) */
export const canEdit = () => state.role === 'editor' || state.role === 'admin';

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

  /** Ablauf ändern. coalesce bündelt schnelle Folgeänderungen (z. B. Tippen) zu einem Undo-Schritt. */
  updateRundown(id: string, fn: (r: Rundown) => Rundown, coalesce?: string) {
    if (!canEdit()) return;
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
    if (!canEdit()) return;
    const prev = undo.get(id)?.pop();
    if (!prev) return;
    redo.set(id, [...(redo.get(id) ?? []), state.rundowns[id]]);
    lastKey = '';
    const restored = { ...prev, updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [id]: restored } });
    sync.send({ t: 'rundown', rundown: restored });
  },

  redo(id: string) {
    if (!canEdit()) return;
    const nxt = redo.get(id)?.pop();
    if (!nxt) return;
    undo.set(id, [...(undo.get(id) ?? []), state.rundowns[id]]);
    lastKey = '';
    const restored = { ...nxt, updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [id]: restored } });
    sync.send({ t: 'rundown', rundown: restored });
  },

  addRundown(r: Rundown, activate = true) {
    if (state.share || !canEdit()) return;
    const rr = { ...normalizeRundown(r), updatedAt: now() };
    set({ rundowns: { ...state.rundowns, [rr.id]: rr }, ...(activate ? { activeId: rr.id } : {}) });
    sync.send({ t: 'rundown', rundown: rr });
  },

  deleteRundown(id: string) {
    if (state.share || !canEdit()) return;
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

  saveEvent(e: EventFolder) {
    if (state.share || !canEdit()) return;
    const ev = { ...e, updatedAt: now() };
    set({ events: { ...state.events, [ev.id]: ev } });
    sync.send({ t: 'event', event: ev });
  },

  deleteEvent(id: string) {
    if (state.share || !canEdit()) return;
    const events = { ...state.events };
    delete events[id];
    const at = now();
    set({ events, deleted: { ...state.deleted, [id]: at } });
    sync.send({ t: 'delete', id, at });
    // Abläufe bleiben erhalten und wandern zurück in die Übersicht
    for (const r of Object.values(state.rundowns)) if (r.eventId === id) store.updateRundown(r.id, (x) => ({ ...x, eventId: null }));
  },

  live(id: string): LiveState {
    return state.live[id] ?? normalizeLive(null);
  },

  setLive(id: string, fn: (l: LiveState) => LiveState) {
    if (isReadOnly()) return;
    if (id === pristineId) pristineId = null;
    const cur = state.live[id] ?? normalizeLive(null);
    const nxt = fn(cur);
    if (nxt === cur) return;
    const stamped = { ...nxt, updatedAt: now() };
    set({ live: { ...state.live, [id]: stamped } });
    sync.send({ t: 'live', id, live: stamped });
  },

  login(password: string) {
    set({ authError: '' });
    sync.login(password);
  },

  async signIn(kind: 'login' | 'setup', body: { email: string; password: string; name?: string }) {
    set({ authError: '' });
    try {
      await sync.signIn(kind, body);
    } catch (e) {
      set({ authError: e instanceof Error ? e.message : String(e) });
    }
  },

  signOut() {
    sync.signOut();
    set({ authRequired: true, authMode: 'login', user: null, authError: '' });
  },
};

function applyMsg(m: SyncMsg) {
  if (m.t === 'rundown') {
    const r = normalizeRundown(m.rundown);
    const cur = state.rundowns[r.id];
    if (state.deleted[r.id]) return;
    if (!cur || r.updatedAt >= cur.updatedAt) set({ rundowns: { ...state.rundowns, [r.id]: r } });
  } else if (m.t === 'live') {
    const cur = state.live[m.id];
    if (!cur || m.live.updatedAt >= cur.updatedAt) set({ live: { ...state.live, [m.id]: normalizeLive(m.live) } });
  } else if (m.t === 'event') {
    const cur = state.events[m.event.id];
    if (!cur || m.event.updatedAt >= cur.updatedAt) set({ events: { ...state.events, [m.event.id]: m.event } });
  } else if (m.t === 'delete') {
    if (state.events[m.id]) {
      const events = { ...state.events };
      delete events[m.id];
      set({ events, deleted: { ...state.deleted, [m.id]: m.at } });
      return;
    }
    if (!state.rundowns[m.id]) return;
    const rundowns = { ...state.rundowns };
    delete rundowns[m.id];
    if (!Object.keys(rundowns).length) return;
    const activeId = state.activeId === m.id ? Object.keys(rundowns)[0] : state.activeId;
    set({ rundowns, activeId, deleted: { ...state.deleted, [m.id]: m.at } });
  }
}

function applyInit(s: ServerState, share: ShareInfo | null, user: UserInfo | null, role: Role, version: string) {
  if (sync.version && version && version !== sync.version) set({ newVersion: version });
  if (share) {
    // Gast: ausschließlich den freigegebenen Ablauf übernehmen
    const r = s.rundowns?.[share.rundownId];
    if (!r) return;
    pristineId = null;
    set({
      rundowns: { [r.id]: normalizeRundown(r) },
      live: s.live?.[r.id] ? { [r.id]: normalizeLive(s.live[r.id]) } : {},
      events: {},
      activeId: r.id,
      share,
      role,
      user: null,
      authRequired: false,
      ui: share.mode === 'view' ? { ...state.ui, locked: true } : state.ui,
    });
    return;
  }
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
    const remote = s.rundowns?.[id] ? normalizeRundown(s.rundowns[id]) : undefined;
    const pick = !remote || (local && local.updatedAt > remote.updatedAt) ? local : remote;
    rundowns[id] = pick;
    if (pick === local && local) sync.send({ t: 'rundown', rundown: local });
    const ll = state.live[id];
    const rl = s.live?.[id] ? normalizeLive(s.live[id]) : undefined;
    const lp = !rl || (ll && ll.updatedAt > rl.updatedAt) ? ll : rl;
    if (lp) {
      live[id] = lp;
      if (lp === ll && rl !== ll) sync.send({ t: 'live', id, live: ll });
    }
  }
  const events: Record<string, EventFolder> = {};
  for (const id of new Set([...Object.keys(state.events), ...Object.keys(s.events ?? {})])) {
    if (deleted[id]) continue;
    const a = state.events[id];
    const b = s.events?.[id];
    const pick = !b || (a && a.updatedAt > b.updatedAt) ? a : b;
    events[id] = pick;
    if (pick === a && a) sync.send({ t: 'event', event: a });
  }
  if (!Object.keys(rundowns).length) return;
  const onAir = Object.keys(rundowns).find((id) => live[id]?.status === 'running' || live[id]?.status === 'paused');
  const newest = Object.values(rundowns).sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
  const activeId = rundowns[localActive] ? localActive : onAir ?? newest;
  set({ rundowns, live, events, deleted, activeId, authRequired: false, share: null, user, role, ui: role === 'operator' || role === 'viewer' ? { ...state.ui, locked: true } : state.ui });
}

sync.start({
  onInit: applyInit,
  onMsg: applyMsg,
  onStatus: (syncStatus, peers) => set({ syncStatus, peers }),
  onAuthRequired: (mode, error) => set({ authRequired: true, authMode: mode, authError: error }),
});

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.get);
}
