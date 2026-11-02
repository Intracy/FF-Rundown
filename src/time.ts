import type { ClockMode } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const DAY = 86_400_000;

/* ---------- Anzeige-Kontext (Zeitzone + Uhrformat des aktiven Ablaufs) ---------- */
let displayTz = '';
let clockMode: ClockMode = '24';

export function setDisplay(tz: string, mode: ClockMode) {
  displayTz = tz;
  clockMode = mode;
}

export const deviceTimeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
})();

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Versatz der Zeitzone in ms (Wandzeit − UTC) zum Zeitpunkt epoch */
export function tzOffset(epoch: number, tz: string): number {
  if (!tz) return -new Date(epoch).getTimezoneOffset() * 60_000;
  try {
    const p: Record<string, number> = {};
    for (const part of dtf(tz).formatToParts(new Date(epoch))) if (part.type !== 'literal') p[part.type] = +part.value;
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - (epoch - (((epoch % 1000) + 1000) % 1000));
  } catch {
    return -new Date(epoch).getTimezoneOffset() * 60_000;
  }
}

/** Wanduhr-Bestandteile einer Epoch-Zeit in der Zeitzone */
export function wall(epoch: number, tz = displayTz) {
  const d = new Date(epoch + tzOffset(epoch, tz));
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** Epoch-Zeit für Datum (YYYY-MM-DD) + ms seit Mitternacht in der Zeitzone */
export function epochAt(date: string, msOfDayValue: number, tz = ''): number {
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y || 1970, (mo || 1) - 1, d || 1) + Math.round(msOfDayValue / 1000) * 1000;
  const off = tzOffset(guess, tz);
  let t = guess - off;
  const off2 = tzOffset(t, tz);
  if (off2 !== off) t = guess - off2;
  return t;
}

/** ms seit Mitternacht (0..24h) einer Epoch-Zeit in der Zeitzone */
export function msOfDay(epoch: number, tz = displayTz): number {
  const w = wall(epoch, tz);
  return ((w.h * 60 + w.m) * 60 + w.s) * 1000;
}

function hms(totalSeconds: number, forceHours = false): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Dauer als mm:ss bzw. h:mm:ss */
export function fmtDur(ms: number, forceHours = false): string {
  const neg = ms < 0;
  const s = Math.round(Math.abs(ms) / 1000);
  return (neg ? '−' : '') + hms(s, forceHours);
}

/** Countdown: aufrunden bis 0, danach Überzeit mit „+“ */
export function fmtCountdown(ms: number): { text: string; over: boolean } {
  if (ms > 0) return { text: hms(Math.ceil(ms / 1000)), over: false };
  return { text: '+' + hms(Math.floor(-ms / 1000)), over: true };
}

/** Abweichung: positiv = zu spät */
export function fmtOffset(ms: number): { text: string; state: 'late' | 'early' | 'ontime' } {
  if (Math.abs(ms) < 1000) return { text: 'Pünktlich', state: 'ontime' };
  return ms > 0 ? { text: `${fmtDur(ms)} zu spät`, state: 'late' } : { text: `${fmtDur(-ms)} zu früh`, state: 'early' };
}

function fmtHM(h: number, m: number, s: number, seconds: boolean, mode = clockMode): string {
  const sec = seconds ? `:${pad(s)}` : '';
  let m12 = mode;
  if (m12 === 'auto') {
    try {
      m12 = (new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string }).hourCycle?.startsWith('h1') ? '12' : '24';
    } catch {
      m12 = '24';
    }
  }
  if (m12 === '24') return `${pad(h)}:${pad(m)}${sec}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)}${sec}${m12 === '12' ? (h < 12 ? ' AM' : ' PM') : ''}`;
}

/** Uhrzeit einer Epoch-Zeit in Zeitzone und Format des aktiven Ablaufs */
export function fmtClock(epoch: number, seconds = true): string {
  const w = wall(epoch);
  return fmtHM(w.h, w.m, w.s, seconds);
}

export function fmtTimeOfDay(msOfDayValue: number, seconds = true): string {
  const t = ((Math.round(msOfDayValue / 1000) % 86400) + 86400) % 86400;
  return fmtHM(Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60, seconds);
}

/** Uhrzeit in 24 h für Eingabefelder (unabhängig vom Anzeigeformat) */
export function fmtTimeInput(msOfDayValue: number, seconds = true): string {
  const t = ((Math.round(msOfDayValue / 1000) % 86400) + 86400) % 86400;
  return fmtHM(Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60, seconds, '24');
}

/**
 * Dauer-Eingabe: "5" = 5 Minuten, "1:30" = 1 min 30 s, "1:02:03" = h:mm:ss,
 * "90s", "2m", "1h30m", "1,5" = 1 min 30 s.
 */
export function parseDur(input: string): number | null {
  const s = input.trim().toLowerCase().replace(',', '.').replace(/^[+−-]/, '');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60_000);
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    const p = s.split(':').map(Number);
    if (p.some((v, i) => i > 0 && v > 59)) return null;
    return (p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]) * 1000;
  }
  const re = /(\d+(?:\.\d+)?)\s*(stunden|stunde|std|h|minuten|minute|min|m|sekunden|sekunde|sek|sec|s)/g;
  let total = 0;
  let consumed = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = parseFloat(m[1]);
    const u = m[2][0];
    total += u === 'h' || m[2].startsWith('st') ? v * 3_600_000 : u === 'm' ? v * 60_000 : v * 1000;
    consumed += m[0];
  }
  if (!consumed || consumed.replace(/\s/g, '') !== s.replace(/\s/g, '')) return null;
  return Math.round(total);
}

/** Uhrzeit-Eingabe: "19:30", "1930", "19.30", "19:30:15", "7:30 pm" → ms seit Mitternacht */
export function parseClock(input: string): number | null {
  let s = input.trim().toLowerCase();
  let ampm: 'am' | 'pm' | null = null;
  const ap = s.match(/\s*([ap])\.?\s*m\.?$/);
  if (ap) {
    ampm = ap[1] === 'a' ? 'am' : 'pm';
    s = s.slice(0, ap.index).trim();
  }
  s = s.replace(/[.h]/g, ':');
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = s.match(/^(\d{1,2})(\d{2})$/);
    if (d) m = [s, d[1], d[2], ''] as unknown as RegExpMatchArray;
    else if (/^\d{1,2}$/.test(s)) m = [s, s, '00', ''] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  let h = +m[1];
  const mi = +m[2];
  const se = m[3] ? +m[3] : 0;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'pm' ? 12 : 0);
  }
  if (h > 23 || mi > 59 || se > 59) return null;
  return ((h * 60 + mi) * 60 + se) * 1000;
}

export function todayISO(tz = deviceTimeZone): string {
  const w = wall(Date.now(), tz);
  return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y) return date;
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Häufige Zeitzonen für die Auswahl (vollständige Liste, wenn der Browser sie liefert) */
export function timeZones(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    if (all && all.length) return all;
  } catch {
    /* ältere Browser */
  }
  return ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'Europe/Stockholm', 'UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
}

export const uid = () => Math.random().toString(36).slice(2, 10);
