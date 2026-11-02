import { Column, Cue, Heading, Rundown, Tint } from './types';
import { parseClock, todayISO, uid } from './time';
import { newSubTimer, normalizeRundown } from './model';

const MIN = 60_000;

export function newCue(p: Partial<Cue> = {}): Cue {
  return {
    kind: 'cue',
    id: uid(),
    title: '',
    subtitle: '',
    duration: 5 * MIN,
    startMode: 'soft',
    hardStart: 0,
    autoStart: false,
    skip: false,
    color: '',
    cells: {},
    script: '',
    subTimers: [],
    ...p,
  };
}

export function newHeading(title = 'Neuer Abschnitt', color: Tint = ''): Heading {
  return { kind: 'heading', id: uid(), title, color };
}

export function newColumn(p: Partial<Column> = {}): Column {
  return { id: uid(), name: 'Neue Spalte', type: 'text', width: 180, options: [], ...p };
}

export function blankRundown(): Rundown {
  const notes = newColumn({ name: 'Notizen', width: 260 });
  const now = Date.now();
  return normalizeRundown({
    id: uid(),
    title: 'Neuer Ablauf',
    date: todayISO(),
    start: parseClock('19:00')!,
    plannedEnd: null,
    warnAt: MIN,
    columns: [notes],
    items: [newHeading('Teil 1'), newCue({ title: 'Opener' }), newCue({ title: 'Begrüßung' }), newCue({ title: 'Abmoderation', duration: 2 * MIN })],
    createdAt: now,
    updatedAt: now,
  });
}

/** Beispielablauf, damit die App mit einem realistischen Arbeitsstand öffnet */
export function makeSample(): Rundown {
  const opt = (label: string, color: Tint) => ({ id: uid(), label, color });
  const status = newColumn({ name: 'Status', type: 'select', width: 120, options: [opt('Offen', 'red'), opt('In Arbeit', 'yellow'), opt('Bereit', 'green')] });
  const cam = newColumn({
    name: 'Kamera',
    type: 'select',
    width: 140,
    options: [opt('Totale', 'blue'), opt('Halbnah', 'teal'), opt('Nah', 'violet'), opt('Publikum', 'orange'), opt('Handkamera', 'grey')],
  });
  const audio = newColumn({ name: 'Ton', width: 190 });
  const gfx = newColumn({ name: 'Grafik / Zuspieler', width: 210 });
  const notes = newColumn({ name: 'Notizen', width: 260 });
  const o = (col: typeof status, label: string) => col.options.find((x) => x.label === label)!.id;
  const t = (s: string) => parseClock(s)!;

  const cells = (st: string, c: string, a: string, g: string, n = '') => ({
    [status.id]: o(status, st),
    [cam.id]: o(cam, c),
    [audio.id]: a,
    [gfx.id]: g,
    [notes.id]: n,
  });

  const now = Date.now();
  return normalizeRundown({
    id: uid(),
    title: 'Beispiel: Benefiz-Gala (Livestream)',
    date: todayISO(),
    start: t('18:30'),
    plannedEnd: t('20:00'),
    warnAt: MIN,
    columns: [status, cam, audio, gfx, notes],
    items: [
      newHeading('Vorlauf', 'grey'),
      newCue({
        title: 'Einlass & Pausenmusik',
        subtitle: 'Stream läuft mit Warteschleife',
        duration: 15 * MIN,
        cells: cells('Bereit', 'Publikum', 'Playlist Einlass, −12 dB', 'Warteschleife mit Countdown', '[x] Backup-Recorder läuft\n[ ] Stream-Key geprüft'),
      }),
      newCue({
        title: 'Opener-Trailer',
        duration: 90_000,
        autoStart: true,
        color: 'violet',
        cells: cells('Bereit', 'Totale', 'Zuspieler-Ton auf Summe', 'Trailer (VT 1)', 'Startet automatisch nach dem Einlass'),
      }),
      newHeading('Teil 1', 'blue'),
      newCue({
        title: 'Begrüßung',
        subtitle: 'Moderation',
        duration: 4 * MIN,
        startMode: 'hard',
        hardStart: t('19:00'),
        cells: cells('Bereit', 'Halbnah', 'Funk 1 (Moderation)', 'Bauchbinde Moderation', 'Spendenstand: $spendenstand'),
        script:
          'Guten Abend und herzlich willkommen – hier im Saal und an den Bildschirmen zu Hause!\n\nSchön, dass Sie heute dabei sind. Der ganze Abend steht im Zeichen eines guten Zwecks, und jede Spende hilft direkt vor Ort.\n\nBevor es losgeht, ein kurzer Blick auf das Programm …',
      }),
      newCue({
        title: 'Grußwort',
        subtitle: 'Gast am Pult',
        duration: 5 * MIN,
        cells: cells('In Arbeit', 'Nah', 'Pultmikro', 'Bauchbinde Gast', 'Name und Funktion vorab bestätigen'),
        script: 'Ich bitte nun unseren Gast ans Pult – herzlich willkommen!',
      }),
      newCue({
        title: 'Musikbeitrag 1',
        duration: 6 * MIN + 30_000,
        color: 'green',
        cells: cells('Bereit', 'Totale', 'Band: 8 Kanäle, Monitor-Mix 2', '—', 'Licht: warmer Look'),
      }),
      newCue({
        title: 'Interview Projektpartner',
        subtitle: 'Zwei Gäste auf dem Sofa',
        duration: 8 * MIN,
        cells: cells('In Arbeit', 'Handkamera', 'Funk 2 + 3', 'Bauchbinden Gäste', 'Gäste kommen über @buehne-links'),
        subTimers: [newSubTimer({ name: 'Publikumsfragen', duration: 3 * MIN, withCue: false, showOnOutput: true })],
        script:
          'Wie ist das Projekt entstanden?\n\nWas hat sich seit dem letzten Jahr verändert?\n\nWofür wird das Geld aus dem heutigen Abend konkret eingesetzt?',
      }),
      newCue({
        title: 'Spendenaufruf mit Einspieler',
        duration: 3 * MIN,
        subTimers: [newSubTimer({ name: 'Einspieler', duration: 90_000, atZero: 'stop' })],
        color: 'orange',
        cells: cells('Offen', 'Totale', 'Zuspieler-Ton', 'Spendengrafik + QR-Code', 'Spendenstand vorher aktualisieren'),
      }),
      newHeading('Pause', 'grey'),
      newCue({
        title: 'Pause mit Spendenticker',
        duration: 20 * MIN,
        startMode: 'hard',
        hardStart: t('19:30'),
        autoStart: true,
        cells: cells('Bereit', 'Publikum', 'Playlist Pause', 'Spendenticker im Stream', '[ ] Bühnenumbau Band 2'),
      }),
      newHeading('Teil 2', 'teal'),
      newCue({ title: 'Musikbeitrag 2', duration: 7 * MIN, color: 'green', cells: cells('Bereit', 'Totale', 'Band: 8 Kanäle', '—') }),
      newCue({
        title: 'Verlosung',
        duration: 6 * MIN,
        skip: true,
        cells: cells('Offen', 'Halbnah', 'Funk 1', 'Gewinnergrafik', 'Entfällt bei Zeitverzug'),
      }),
      newCue({ title: 'Dank & Abmoderation', duration: 4 * MIN, cells: cells('Bereit', 'Halbnah', 'Funk 1', 'Danke-Grafik') }),
      newCue({
        title: 'Abspann & Stream-Ende',
        duration: 2 * MIN,
        autoStart: true,
        cells: cells('Bereit', 'Totale', 'Musik Abspann', 'Abspann', 'Danach Stream stoppen'),
      }),
    ],
    variables: { spendenstand: '12.480 €', 'regie-funk': 'Kanal 3' },
    mentions: { 'buehne-links': { key: 'buehne-links', name: 'Bühne links', description: 'Auftritt über die Seitenbühne links, Stufen beleuchtet. Inspizienz gibt Zeichen.' } },
    createdAt: now,
    updatedAt: now,
  });
}
