export type Tint = '' | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'violet' | 'grey';

export const TINTS: { id: Tint; label: string }[] = [
  { id: '', label: 'Keine' },
  { id: 'red', label: 'Rot' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Gelb' },
  { id: 'green', label: 'Grün' },
  { id: 'teal', label: 'Türkis' },
  { id: 'blue', label: 'Blau' },
  { id: 'violet', label: 'Violett' },
  { id: 'grey', label: 'Grau' },
];

export type ColumnType = 'text' | 'select';

export interface SelectOption {
  id: string;
  label: string;
  color: Tint;
}

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  width: number;
  options: SelectOption[];
}

export interface Cue {
  kind: 'cue';
  id: string;
  title: string;
  subtitle: string;
  /** Dauer in Millisekunden */
  duration: number;
  /** soft = startet nach dem vorherigen Cue, hard = feste Tageszeit */
  startMode: 'soft' | 'hard';
  /** Fixstart als Millisekunden seit Mitternacht des Ablauf-Datums */
  hardStart: number;
  autoStart: boolean;
  skip: boolean;
  color: Tint;
  cells: Record<string, string>;
  script: string;
}

export interface Heading {
  kind: 'heading';
  id: string;
  title: string;
  color: Tint;
}

export type Item = Cue | Heading;

export interface Rundown {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** Geplanter Showbeginn, ms seit Mitternacht */
  start: number;
  /** Geplantes Showende, ms seit Mitternacht (null = berechnet) */
  plannedEnd: number | null;
  /** Ab dieser Restzeit (ms) wird der Timer gelb */
  warnAt: number;
  columns: Column[];
  items: Item[];
  createdAt: number;
  updatedAt: number;
}

export type ShowStatus = 'idle' | 'running' | 'paused' | 'ended';

export interface LiveState {
  status: ShowStatus;
  currentId: string | null;
  /** Manuell vorgemerkter nächster Cue (null = automatisch der folgende) */
  nextId: string | null;
  /** Wanduhrzeit, zu der der aktuelle Cue gestartet ist */
  cueStart: number;
  pausedAt: number | null;
  pausedTotal: number;
  /** Zeitkorrektur des aktuellen Cues (±) */
  adjust: number;
  history: Record<string, { start: number; end: number }>;
  showStart: number | null;
  showEnd: number | null;
  /** Nachricht an die Bühne (Timer-Ansicht) */
  message: string;
  flash: boolean;
  updatedAt: number;
}

export const isCue = (i: Item): i is Cue => i.kind === 'cue';
