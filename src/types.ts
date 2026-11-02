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

export interface SubTimer {
  id: string;
  name: string;
  /** down = Countdown, up = Stoppuhr */
  mode: 'down' | 'up';
  duration: number;
  /** Verhalten bei 0 (nur Countdown) */
  atZero: 'stop' | 'continue';
  /** Startet/pausiert/stoppt automatisch mit dem Cue */
  withCue: boolean;
  showOnOutput: boolean;
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
  subTimers: SubTimer[];
}

export interface Heading {
  kind: 'heading';
  id: string;
  title: string;
  color: Tint;
}

export type Item = Cue | Heading;

export type ClockMode = 'auto' | '24' | '12' | '12n';
export type RundownStatus = 'draft' | 'approved' | 'archived';

export const STATUS_LABEL: Record<RundownStatus, string> = { draft: 'Entwurf', approved: 'Freigegeben', archived: 'Archiviert' };

export interface RundownSettings {
  /** IANA-Zeitzone, z. B. Europe/Berlin. Leer = Zeitzone des Geräts */
  timezone: string;
  clock: ClockMode;
  /** Laufender Cue: eigene Farbe behalten oder komplett rot */
  highlight: 'color' | 'red';
  numPrefix: string;
  numStart: number;
  numDigits: number;
  /** Logo als data:-URL */
  logo: string;
}

export interface OutputConfig {
  layout: 'single' | 'list';
  background: string;
  transparent: boolean;
  mirrorH: boolean;
  mirrorV: boolean;
  headerPos: 'top' | 'bottom';
  showTitle: boolean;
  showLogo: boolean;
  showClock: boolean;
  showCueTimer: boolean;
  showOverUnder: boolean;
  showProgress: boolean;
  showLastFive: boolean;
  cueNumbers: boolean;
  cueTitles: boolean;
  cueSubtitles: boolean;
  cueColors: boolean;
  cueDurations: boolean;
  cueStart: boolean;
  cueEnd: boolean;
  nextCue: boolean;
  bigClock: boolean;
  /** Spalten in der Listenansicht */
  columns: string[];
}

export interface Mention {
  key: string;
  name: string;
  description: string;
}

export interface TrashEntry {
  id: string;
  at: number;
  /** Position im Ablauf bzw. in der Spaltenliste beim Löschen */
  index: number;
  item?: Item;
  column?: Column;
  /** Zellinhalte der gelöschten Spalte je Cue */
  cells?: Record<string, string>;
}

export interface CellChange {
  cueId: string;
  colId: string;
  /** Wert vor der Änderung */
  prev: string;
  at: number;
}

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
  settings: RundownSettings;
  output: OutputConfig;
  /** Quelle des Prompters: 'script' oder eine Spalten-ID */
  prompterSource: string;
  variables: Record<string, string>;
  mentions: Record<string, Mention>;
  trash: TrashEntry[];
  cellLog: CellChange[];
  eventId: string | null;
  isTemplate: boolean;
  status: RundownStatus;
  createdAt: number;
  updatedAt: number;
}

export interface EventFolder {
  id: string;
  name: string;
  logo: string;
  createdAt: number;
  updatedAt: number;
}

export type ShowStatus = 'idle' | 'running' | 'paused' | 'ended';

export interface SubTimerState {
  running: boolean;
  /** Startzeit des laufenden Abschnitts */
  since: number;
  /** Bereits abgelaufene Zeit vor dem laufenden Abschnitt */
  acc: number;
  /** Vom Cue gelöst, läuft nur noch manuell */
  detached: boolean;
}

export interface PrompterSync {
  playing: boolean;
  speed: number;
  size: number;
  margin: number;
  indicator: number;
  /** Sprungziel ('top' oder Cue-ID) mit Zähler, damit wiederholte Sprünge ankommen */
  jump: { to: string; seq: number } | null;
}

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
  /** Nachricht an die Bühne */
  message: string;
  messageVisible: boolean;
  flash: boolean;
  msgBold: boolean;
  msgUnderline: boolean;
  msgColor: 'white' | 'red';
  subTimers: Record<string, SubTimerState>;
  prompter: PrompterSync | null;
  updatedAt: number;
}

export const isCue = (i: Item): i is Cue => i.kind === 'cue';
