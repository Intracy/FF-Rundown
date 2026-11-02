import { Column, Cue, EventFolder, Heading, Item, OutputConfig, Rundown, RundownSettings, SubTimer, isCue } from './types';
import { DAY, deviceTimeZone, uid } from './time';

export const defaultSettings = (): RundownSettings => ({
  timezone: deviceTimeZone,
  clock: '24',
  highlight: 'red',
  numPrefix: '',
  numStart: 1,
  numDigits: 1,
  logo: '',
});

export const defaultOutput = (): OutputConfig => ({
  layout: 'single',
  background: '#07090b',
  transparent: false,
  mirrorH: false,
  mirrorV: false,
  headerPos: 'top',
  showTitle: true,
  showLogo: true,
  showClock: true,
  showCueTimer: true,
  showOverUnder: true,
  showProgress: true,
  showLastFive: true,
  cueNumbers: true,
  cueTitles: true,
  cueSubtitles: true,
  cueColors: true,
  cueDurations: true,
  cueStart: false,
  cueEnd: false,
  nextCue: true,
  bigClock: false,
  columns: [],
});

export function newSubTimer(p: Partial<SubTimer> = {}): SubTimer {
  return { id: uid(), name: '', mode: 'down', duration: 60_000, atZero: 'continue', withCue: true, showOnOutput: false, ...p };
}

export function normalizeCue(c: Partial<Cue> & { id: string }): Cue {
  return {
    kind: 'cue',
    title: '',
    subtitle: '',
    duration: 0,
    startMode: 'soft',
    hardStart: 0,
    autoStart: false,
    skip: false,
    color: '',
    cells: {},
    script: '',
    ...c,
    subTimers: (c.subTimers ?? []).map((t) => ({ ...newSubTimer(), ...t })),
  };
}

/** Ergänzt fehlende Felder (ältere Stände, Importe, Server-Daten) */
export function normalizeRundown(r: Partial<Rundown> & { id: string }): Rundown {
  const t = Date.now();
  const items: Item[] = (r.items ?? []).map((it) => (isCue(it as Item) ? normalizeCue(it as Cue) : ({ ...it, color: (it as Heading).color ?? '' } as Heading)));
  const cutoff = t - 30 * DAY;
  return {
    title: 'Ohne Titel',
    date: new Date().toISOString().slice(0, 10),
    start: 19 * 3_600_000,
    plannedEnd: null,
    warnAt: 60_000,
    columns: [],
    prompterSource: 'script',
    palette: {},
    variables: {},
    mentions: {},
    eventId: null,
    isTemplate: false,
    status: 'draft',
    createdAt: t,
    updatedAt: t,
    ...r,
    items,
    settings: { ...defaultSettings(), ...(r.settings ?? {}) },
    output: { ...defaultOutput(), ...(r.output ?? {}) },
    trash: (r.trash ?? []).filter((e) => e.at > cutoff),
    cellLog: (r.cellLog ?? []).filter((e) => e.at > cutoff).slice(-1000),
  } as Rundown;
}

export function newEvent(name = 'Neues Event'): EventFolder {
  const t = Date.now();
  return { id: uid(), name, logo: '', createdAt: t, updatedAt: t };
}

/** Kopie mit neuen IDs (Cues, Spalten, Optionen, Unter-Timer) */
export function cloneRundown(r: Rundown, patch: Partial<Rundown> = {}): Rundown {
  const colMap = new Map<string, string>();
  const optMap = new Map<string, string>();
  const columns: Column[] = r.columns.map((c) => {
    const id = uid();
    colMap.set(c.id, id);
    return {
      ...c,
      id,
      options: c.options.map((o) => {
        const oid = uid();
        optMap.set(o.id, oid);
        return { ...o, id: oid };
      }),
    };
  });
  const items: Item[] = r.items.map((it) => {
    if (!isCue(it)) return { ...it, id: uid() };
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(it.cells)) if (colMap.has(k)) cells[colMap.get(k)!] = optMap.get(v) ?? v;
    return { ...it, id: uid(), cells, subTimers: it.subTimers.map((s) => ({ ...s, id: uid() })) };
  });
  const t = Date.now();
  return normalizeRundown({
    ...r,
    id: uid(),
    columns,
    items,
    output: { ...r.output, columns: r.output.columns.map((c) => colMap.get(c) ?? c) },
    prompterSource: colMap.get(r.prompterSource) ?? r.prompterSource,
    trash: [],
    cellLog: [],
    createdAt: t,
    updatedAt: t,
    ...patch,
  });
}

/** Ziffern-Formatierung der Cue-Nummer laut Einstellungen */
export function cueLabel(r: Rundown, n: number): string {
  const s = r.settings;
  return s.numPrefix + String(s.numStart + n - 1).padStart(Math.max(1, s.numDigits), '0');
}
