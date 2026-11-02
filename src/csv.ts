import { Column, Cue, Item, Rundown, isCue } from './types';
import { Timeline } from './timing';
import { fmtClock, fmtDur, fmtTimeInput, parseClock, parseDur } from './time';
import { cloneRundown, normalizeRundown } from './model';
import { blankRundown, newColumn, newCue, newHeading } from './sample';

function esc(v: string, sep: string) {
  return /["\n\r]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v;
}

function cellText(col: Column, value: string | undefined) {
  if (!value) return '';
  return col.type === 'select' ? col.options.find((o) => o.id === value)?.label ?? '' : value;
}

export function toCsv(r: Rundown, tl: Timeline, sep = ';'): string {
  const head = ['Nr', 'Typ', 'Start', 'Ende', 'Dauer', 'Titel', 'Untertitel', 'Fixstart', 'Auto-Start', 'Überspringen', ...r.columns.map((c) => c.name), 'Skript'];
  const rows = r.items.map((it) => {
    if (!isCue(it)) return ['', 'Überschrift', '', '', '', it.title, '', '', '', '', ...r.columns.map(() => ''), ''];
    const t = tl.cues[it.id];
    return [
      t?.num != null ? t.label : '',
      'Cue',
      t && !it.skip ? fmtClock(t.plannedStart) : '',
      t && !it.skip ? fmtClock(t.plannedEnd) : '',
      fmtDur(it.duration, true),
      it.title,
      it.subtitle,
      it.startMode === 'hard' ? fmtTimeInput(it.hardStart) : '',
      it.autoStart ? 'ja' : '',
      it.skip ? 'ja' : '',
      ...r.columns.map((c) => cellText(c, it.cells[c.id])),
      it.script,
    ];
  });
  return [head, ...rows].map((row) => row.map((v) => esc(v, sep)).join(sep)).join('\r\n');
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/)[0] ?? '';
  const sep = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const truthy = (v: string) => /^(ja|j|yes|y|x|true|1|wahr)$/i.test(v.trim());

/** CSV aus Tabellenkalkulation (Excel, Google Sheets) in einen neuen Ablauf umwandeln */
export function fromCsv(text: string, title = 'Importierter Ablauf'): Rundown {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Die CSV braucht eine Kopfzeile und mindestens eine Zeile.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iTitle = find('titel', 'title', 'name', 'cue', 'programmpunkt');
  const iDur = find('dauer', 'duration', 'länge', 'laenge', 'length');
  if (iTitle < 0) throw new Error('Keine Spalte „Titel“ gefunden.');
  const iSub = find('untertitel', 'subtitle', 'beschreibung');
  const iType = find('typ', 'type');
  const iHard = find('fixstart', 'hard start', 'hardstart', 'fix');
  const iAuto = find('auto-start', 'autostart', 'auto');
  const iSkip = find('überspringen', 'ueberspringen', 'skip');
  const iScript = find('skript', 'script', 'text', 'prompter');
  const ignored = new Set([iTitle, iDur, iSub, iType, iHard, iAuto, iSkip, iScript, find('nr', '#', 'nummer'), find('start'), find('ende', 'end')]);

  const columns: { idx: number; col: Column }[] = rows[0]
    .map((name, idx) => ({ idx, name: name.trim() }))
    .filter((c) => !ignored.has(c.idx) && c.name)
    .map(({ idx, name }) => ({ idx, col: newColumn({ name, width: 180 }) }));

  const items: Item[] = [];
  for (const row of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const type = get(iType).toLowerCase();
    if (type.startsWith('überschrift') || type.startsWith('heading') || type.startsWith('abschnitt')) {
      items.push(newHeading(get(iTitle) || 'Abschnitt'));
      continue;
    }
    const hard = iHard >= 0 ? parseClock(get(iHard)) : null;
    const cue: Cue = newCue({
      title: get(iTitle),
      subtitle: get(iSub),
      duration: parseDur(get(iDur)) ?? 0,
      startMode: hard != null ? 'hard' : 'soft',
      hardStart: hard ?? 0,
      autoStart: truthy(get(iAuto)),
      skip: truthy(get(iSkip)),
      script: get(iScript),
    });
    for (const { idx, col } of columns) {
      const v = get(idx);
      if (v) cue.cells[col.id] = v;
    }
    items.push(cue);
  }
  const base = blankRundown();
  return { ...base, title, columns: columns.map((c) => c.col), items };
}

/** JSON-Sicherung importieren (neue IDs, damit nichts überschrieben wird) */
export function fromJson(text: string): Rundown {
  const r = JSON.parse(text) as Rundown;
  if (!r || !Array.isArray(r.items) || !Array.isArray(r.columns)) throw new Error('Das ist keine Taktgeber-Sicherung.');
  return cloneRundown(normalizeRundown({ ...r, id: r.id || 'import' }), { isTemplate: false, eventId: null });
}
