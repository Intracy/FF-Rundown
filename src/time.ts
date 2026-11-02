const pad = (n: number) => String(n).padStart(2, '0');
export const DAY = 86_400_000;

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
  return ms > 0
    ? { text: `${fmtDur(ms)} zu spät`, state: 'late' }
    : { text: `${fmtDur(-ms)} zu früh`, state: 'early' };
}

export function fmtClock(epoch: number, seconds = true): string {
  const d = new Date(epoch);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}` + (seconds ? `:${pad(d.getSeconds())}` : '');
}

export function fmtTimeOfDay(msOfDay: number, seconds = true): string {
  const t = ((Math.round(msOfDay / 1000) % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${pad(h)}:${pad(m)}` + (seconds ? `:${pad(t % 60)}` : '');
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

/** Uhrzeit-Eingabe: "19:30", "1930", "19.30", "19:30:15" → ms seit Mitternacht */
export function parseClock(input: string): number | null {
  const s = input.trim().replace(/[.h]/g, ':');
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const d = s.match(/^(\d{1,2})(\d{2})$/);
    if (d) m = [s, d[1], d[2], ''] as unknown as RegExpMatchArray;
    else if (/^\d{1,2}$/.test(s)) m = [s, s, '00', ''] as unknown as RegExpMatchArray;
  }
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  const se = m[3] ? +m[3] : 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  return ((h * 60 + mi) * 60 + se) * 1000;
}

/** Epoch-Zeit für Datum (YYYY-MM-DD) + ms seit Mitternacht in lokaler Zeit */
export function epochAt(date: string, msOfDay: number): number {
  const [y, mo, d] = date.split('-').map(Number);
  const secs = Math.round(msOfDay / 1000);
  return new Date(y || 1970, (mo || 1) - 1, d || 1, Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60).getTime();
}

/** ms seit Mitternacht (0..24h) einer Epoch-Zeit */
export function msOfDay(epoch: number): number {
  const d = new Date(epoch);
  return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y) return date;
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const uid = () => Math.random().toString(36).slice(2, 10);
