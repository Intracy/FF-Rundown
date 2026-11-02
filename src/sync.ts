import { EventFolder, LiveState, Rundown } from './types';
import { uid } from './time';

export type SyncStatus = 'local' | 'connecting' | 'online' | 'offline';

export interface ServerState {
  rundowns: Record<string, Rundown>;
  events: Record<string, EventFolder>;
  live: Record<string, LiveState>;
  deleted: Record<string, number>;
}

export interface ShareInfo {
  token: string;
  mode: 'view' | 'edit';
  rundownId: string;
}

export type SyncMsg =
  | { t: 'rundown'; rundown: Rundown; from?: string }
  | { t: 'live'; id: string; live: LiveState; from?: string }
  | { t: 'event'; event: EventFolder; from?: string }
  | { t: 'delete'; id: string; at: number; from?: string };

interface Handlers {
  onInit(state: ServerState, share: ShareInfo | null): void;
  onMsg(m: SyncMsg): void;
  onStatus(s: SyncStatus, peers: number): void;
  onAuthRequired(error: string): void;
}

const AUTH_KEY = 'taktgeber:auth';

function readAuth(): string {
  try {
    return localStorage.getItem(AUTH_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Synchronisation:
 * - Tabs im selben Browser über BroadcastChannel (immer)
 * - Geräte im Netz über WebSocket, wenn die App vom Taktgeber-Server ausgeliefert wird
 * Die Uhren werden über Ping/Pong an die Serverzeit angeglichen.
 */
class Sync {
  offset = 0;
  status: SyncStatus = 'local';
  peers = 1;
  /** Gast-Link-Token aus der Adresse (?share=…) */
  readonly shareToken: string = (() => {
    try {
      return new URLSearchParams(location.search).get('share') ?? '';
    } catch {
      return '';
    }
  })();
  readonly isShareLink = !!this.shareToken;
  readonly serverCapable = !__ARTIFACT__ && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private h: Handlers | null = null;
  private retry = 1000;
  private everOnline = false;
  private bestRtt = Infinity;
  private pingTimer = 0;
  private auth = readAuth();
  readonly clientId = uid();

  start(h: Handlers) {
    this.h = h;
    if (!this.isShareLink) {
      try {
        this.bc = new BroadcastChannel('taktgeber');
        this.bc.onmessage = (e) => {
          const m = e.data as SyncMsg;
          if (m && m.from !== this.clientId) h.onMsg(m);
        };
      } catch {
        this.bc = null;
      }
    }
    if (this.serverCapable) this.connect();
  }

  now() {
    return Date.now() + this.offset;
  }

  login(password: string) {
    this.auth = password;
    try {
      localStorage.setItem(AUTH_KEY, password);
    } catch {
      /* egal */
    }
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'hello', auth: this.auth, share: this.shareToken }));
    else this.connect();
  }

  /** Header für HTTP-Aufrufe an den eigenen Server */
  headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.auth) h.Authorization = `Bearer ${this.auth}`;
    return h;
  }

  private setStatus(s: SyncStatus, peers = this.peers) {
    this.status = s;
    this.peers = peers;
    this.h?.onStatus(s, peers);
  }

  private connect() {
    if (this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    } catch {
      return;
    }
    if (this.everOnline) this.setStatus('connecting');
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 1000;
      this.bestRtt = Infinity;
      ws.send(JSON.stringify({ t: 'hello', auth: this.auth, share: this.shareToken }));
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 20_000);
    };
    ws.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'init') {
        if (this.bestRtt === Infinity) this.offset = m.now - Date.now();
        this.everOnline = true;
        this.setStatus('online', m.peers ?? 1);
        this.h?.onInit(m.state, m.share ?? null);
      } else if (m.t === 'auth-required') {
        this.h?.onAuthRequired(m.error ?? '');
      } else if (m.t === 'pong') {
        const rtt = Date.now() - m.c;
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.offset = m.s + rtt / 2 - Date.now();
        }
      } else if (m.t === 'peers') {
        this.setStatus('online', m.peers);
      } else if (m.from !== this.clientId) {
        this.h?.onMsg(m);
      }
    };
    ws.onclose = () => {
      this.ws = null;
      clearInterval(this.pingTimer);
      this.setStatus(this.everOnline ? 'offline' : 'local', 1);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    };
  }

  private ping() {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
  }

  send(m: SyncMsg) {
    const msg = { ...m, from: this.clientId };
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
    try {
      this.bc?.postMessage(msg);
    } catch {
      /* ignorieren */
    }
  }
}

export const sync = new Sync();
