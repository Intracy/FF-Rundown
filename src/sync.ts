import { LiveState, Rundown } from './types';
import { uid } from './time';

export type SyncStatus = 'local' | 'connecting' | 'online' | 'offline';

export interface ServerState {
  rundowns: Record<string, Rundown>;
  live: Record<string, LiveState>;
  deleted: Record<string, number>;
}

export type SyncMsg =
  | { t: 'rundown'; rundown: Rundown; from?: string }
  | { t: 'live'; id: string; live: LiveState; from?: string }
  | { t: 'delete'; id: string; at: number; from?: string };

interface Handlers {
  onInit(state: ServerState): void;
  onMsg(m: SyncMsg): void;
  onStatus(s: SyncStatus, peers: number): void;
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
  private ws: WebSocket | null = null;
  private bc: BroadcastChannel | null = null;
  private h: Handlers | null = null;
  private retry = 1000;
  private everOnline = false;
  private bestRtt = Infinity;
  private pingTimer = 0;
  readonly clientId = uid();

  start(h: Handlers) {
    this.h = h;
    try {
      this.bc = new BroadcastChannel('taktgeber');
      this.bc.onmessage = (e) => {
        const m = e.data as SyncMsg;
        if (m && m.from !== this.clientId) h.onMsg(m);
      };
    } catch {
      this.bc = null;
    }
    if (!__ARTIFACT__ && /^https?:$/.test(location.protocol)) this.connect();
  }

  now() {
    return Date.now() + this.offset;
  }

  private setStatus(s: SyncStatus, peers = this.peers) {
    this.status = s;
    this.peers = peers;
    this.h?.onStatus(s, peers);
  }

  private connect() {
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
        this.h?.onInit(m.state);
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
