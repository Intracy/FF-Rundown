import { makeSample } from '../src/sample';
import { computeTimeline } from '../src/timing';
import * as L from '../src/live';
import { fmtClock, fmtDur, parseDur, parseClock, epochAt } from '../src/time';
import { isCue } from '../src/types';

const assert = (c: unknown, m: string) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const r = makeSample();
const t0 = epochAt(r.date, parseClock('18:00')!);
let l = L.emptyLive();
let tl = computeTimeline(r, l, t0);
const cues = r.items.filter(isCue);
const byTitle = (s: string) => cues.find((c) => c.title.startsWith(s))!;

assert(fmtClock(tl.cues[byTitle('Einlass').id].start) === '18:30:00', 'Show beginnt 18:30');
assert(fmtClock(tl.cues[byTitle('Opener').id].start) === '18:45:00', 'Opener 18:45');
assert(fmtDur(tl.cues[byTitle('Begrüßung').id].gap!) === '13:30', 'Lücke vor Fixstart 19:00 = 13:30');
assert(fmtDur(tl.cues[byTitle('Pause').id].gap!) === '03:30', 'Lücke vor Pause = 03:30');
assert(fmtClock(tl.plannedEnd) === '20:03:00', 'Geplantes Ende berechnet 20:03');
assert(fmtDur(tl.overUnder) === '03:00', 'Über/Unter +3:00');
assert(tl.cues[byTitle('Verlosung').id].status === 'skipped', 'Verlosung übersprungen');
assert(tl.next?.title.startsWith('Einlass'), 'Nächster = Einlass');

// Start um 18:30:00, Einlass läuft 15:00, Opener Auto-Start
const s = epochAt(r.date, parseClock('18:30')!);
l = L.startOrResume(r, l, s);
assert(l.currentId === byTitle('Einlass').id, 'Start → Einlass live');
let auto = L.autoTick(r, l, s + 15 * 60000 + 200);
assert(auto?.currentId === byTitle('Opener').id && auto.cueStart === s + 15 * 60000, 'Auto-Start Opener exakt an der Grenze');
l = auto!;
// Opener endet 18:46:30, nächster (Begrüßung) ist Fix ohne Auto → kein Auto-Weiter
assert(L.autoTick(r, l, s + 16.5 * 60000 + 500) === null, 'Kein Auto-Weiter vor Fix-Cue ohne Auto-Start');
// Overtime: Opener 30 s drüber
tl = computeTimeline(r, l, s + 17 * 60000);
assert(tl.current!.remaining === -30000, 'Opener 30 s Überzeit');
// +1 min
l = L.adjust(l, 60000);
tl = computeTimeline(r, l, s + 17 * 60000);
assert(tl.current!.remaining === 30000, '+1m → 30 s Rest');
// Pause 10 s
l = L.pause(l, s + 17 * 60000);
tl = computeTimeline(r, l, s + 17 * 60000 + 10000);
assert(tl.current!.remaining === 30000, 'Pause hält Zeit an');
l = L.startOrResume(r, l, s + 17 * 60000 + 10000);
tl = computeTimeline(r, l, s + 17 * 60000 + 20000);
assert(tl.current!.remaining === 20000, 'Fortsetzen zählt weiter');
// Next → Begrüßung, history Opener
l = L.next(r, l, s + 18 * 60000);
assert(l.currentId === byTitle('Begrüßung').id && l.history[byTitle('Opener').id], 'Next → Begrüßung, Opener in Historie');
tl = computeTimeline(r, l, s + 18 * 60000);
assert(tl.cues[byTitle('Opener').id].status === 'done', 'Opener done');
assert(fmtDur(tl.cues[byTitle('Pause').id].gap!) === '15:30', 'Live-Lücke vor Pause wird neu berechnet (15:30)');
// Pause hard auto-start at 19:30
const p = epochAt(r.date, parseClock('19:30')!);
auto = L.autoTick(r, l, p + 1000);
assert(auto?.currentId === byTitle('Pause').id && auto.cueStart === p, 'Fixstart Auto-Start 19:30');
assert(L.autoTick(r, l, p + 10000) === null, 'Kein veralteter Fixstart-Auto-Start');
// cue next manuell + end
l = L.cueNext(auto!, byTitle('Abspann').id);
l = L.next(r, l, p + 60000);
assert(l.currentId === byTitle('Abspann').id, 'Manuell vorgemerkter Cue');
l = L.next(r, l, p + 120000);
assert(l.status === 'ended' && l.showEnd === p + 120000, 'Ende nach letztem Cue');
tl = computeTimeline(r, l, p + 200000);
assert(tl.calcEnd === p + 120000 && tl.cues[byTitle('Musikbeitrag 2').id].status === 'missed', 'Endzeit eingefroren, ausgelassene Cues markiert');

assert(parseDur('5') === 300000 && parseDur('1:30') === 90000 && parseDur('1h30m') === 5400000 && parseDur('90s') === 90000 && parseDur('1:02:03') === 3723000, 'parseDur');
assert(parseClock('1930') === parseClock('19:30') && parseClock('25:00') === null, 'parseClock');

/* ---------- Referenztest: Zeiten wie im Demo-Ablauf der Referenz-App (nur Zahlen, neutrale Titel) ---------- */
import { newCue as nc, newHeading as nh } from '../src/sample';
import { normalizeRundown, newSubTimer, cueLabel } from '../src/model';
import { msOfDay, fmtTimeInput } from '../src/time';
{
  const H = 3_600_000, M = 60_000;
  const durs = [H, 30 * M, 30 * M, 30 * M, 30 * M, 30 * M, 30 * M, 30 * M, 30 * M, 15 * M, 15 * M, 15 * M, 15 * M, H, 15 * M, 30 * M, 15 * M, 30 * M, 30 * M, 30 * M, 30 * M, 30 * M];
  const groupsBefore = new Set([0, 3, 6, 9, 13, 14, 16, 19]);
  const items = [] as any[];
  durs.forEach((d, i) => {
    if (groupsBefore.has(i)) items.push(nh(`Gruppe ${items.length}`));
    items.push(nc({ title: `Cue ${i + 1}`, duration: d, ...(i === 0 ? { startMode: 'hard', hardStart: 10 * H } : {}) }));
  });
  const ref = normalizeRundown({ id: 'ref', title: 'Referenz', date: '2025-08-13', start: 10 * H, plannedEnd: 11 * H, items, settings: { timezone: 'Europe/Stockholm' } as any });
  const tl2 = computeTimeline(ref, L.emptyLive(), Date.now());
  const tz = 'Europe/Stockholm';
  const starts = ref.items.filter(isCue).map((c) => fmtTimeInput(msOfDay(tl2.cues[c.id].start, tz), false));
  const expected = ['10:00', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:15', '15:30', '15:45', '16:00', '17:00', '17:15', '17:45', '18:00', '18:30', '19:00', '19:30', '20:00'];
  assert(JSON.stringify(starts) === JSON.stringify(expected), 'Referenz: alle 22 Startzeiten identisch');
  assert(fmtTimeInput(msOfDay(tl2.calcEnd, tz), false) === '20:30', 'Referenz: berechnetes Ende 20:30');
  assert(fmtDur(tl2.overUnder) === '9:30:00', 'Referenz: Über/Unter +9:30:00 gegenüber geplantem Ende 11:00');
  assert(tl2.cues[ref.items.find(isCue)!.id].gap === 0, 'Referenz: keine Lücke vor dem ersten Fixstart');
  const g = Object.values(tl2.groups);
  assert(g.length === 8 && fmtDur(g[0].total) === '2:00:00', 'Referenz: Gruppensumme der ersten Gruppe 2 h');

  // Cue-Nummerierung
  const r2 = normalizeRundown({ ...ref, settings: { ...ref.settings, numPrefix: 'A', numStart: 10, numDigits: 3 } });
  assert(cueLabel(r2, 1) === 'A010' && cueLabel(r2, 3) === 'A012', 'Nummerierung mit Präfix, Start und Stellen');

  // Zeitzone: dieselbe Wandzeit ergibt unterschiedliche Epoch-Zeiten
  const ny = epochAt('2026-11-02', 19 * H, 'America/New_York');
  const be = epochAt('2026-11-02', 19 * H, 'Europe/Berlin');
  assert(ny - be === 6 * H, 'Zeitzonen: 19:00 New York liegt 6 h nach 19:00 Berlin');
  assert(fmtTimeInput(msOfDay(be, 'Europe/Berlin')) === '19:00:00', 'Zeitzonen: Rückrechnung Wandzeit');
  const dst = epochAt('2026-03-29', 3 * H, 'Europe/Berlin');
  assert(fmtTimeInput(msOfDay(dst, 'Europe/Berlin')) === '03:00:00', 'Zeitzonen: Tag der Zeitumstellung');

  // Unter-Timer
  const linked = newSubTimer({ name: 'mit Cue', duration: 60_000, withCue: true });
  const manual = newSubTimer({ name: 'manuell', duration: 30_000, withCue: false, atZero: 'stop' });
  const r3 = normalizeRundown({ id: 'st', date: '2026-11-02', start: 19 * H, items: [nc({ id: 'c1', duration: 5 * M, subTimers: [linked, manual] } as any), nc({ id: 'c2', duration: 5 * M } as any)] });
  const t0 = epochAt('2026-11-02', 19 * H, '');
  let s3 = L.startOrResume(r3, L.emptyLive(), t0);
  const c1 = r3.items[0] as any;
  assert(L.subElapsed(linked, c1, s3, t0 + 30_000).elapsed === 30_000, 'Unter-Timer läuft mit dem Cue');
  s3 = L.subControl(r3, s3, 'c1', manual.id, 'start', t0 + 10_000);
  s3 = L.pause(s3, t0 + 40_000);
  assert(L.subElapsed(linked, c1, s3, t0 + 50_000).elapsed === 40_000, 'Verknüpfter Unter-Timer pausiert mit der Show');
  assert(L.subElapsed(manual, c1, s3, t0 + 50_000).elapsed === 40_000, 'Manueller Unter-Timer läuft trotz Show-Pause weiter');
  assert(L.subDisplay(manual, 40_000).state === 'stopped' && L.subDisplay(manual, 40_000).value === 0, 'Countdown mit „Stoppen“ hält bei 00:00');
  assert(L.subDisplay(linked, 90_000).state === 'over' && L.subDisplay(linked, 90_000).value === -30_000, 'Countdown mit „Weiterzählen“ zeigt Überzeit');
  s3 = L.startOrResume(r3, s3, t0 + 60_000);
  s3 = L.next(r3, s3, t0 + 80_000);
  assert(L.subElapsed(linked, c1, s3, t0 + 200_000).elapsed === 60_000, 'Verknüpfter Unter-Timer stoppt, wenn die Show weitergeht');
  assert(L.subElapsed(manual, c1, s3, t0 + 200_000).running, 'Manueller Unter-Timer läuft nach dem Weiterschalten weiter');
  s3 = L.reset(s3);
  assert(Object.keys(s3.subTimers).length === 0, 'Reset setzt alle Unter-Timer zurück');
}
