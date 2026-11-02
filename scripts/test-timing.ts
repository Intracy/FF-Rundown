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
