// Internal score model. Deliberately close to MusicXML's structure so that
// export is a straightforward serialization, but simple enough to transpose.

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface Pitch {
  step: Step;
  /** Chromatic alteration in semitones: -2..2 */
  alter: number;
  /** Scientific octave (middle C = C4) */
  octave: number;
}

export type ClefSign = 'G' | 'F' | 'C' | 'percussion';

export interface Clef {
  sign: ClefSign;
  line: number;
  /** Octave change (e.g. -1 for treble 8vb) */
  octaveChange?: number;
}

export interface TimeSignature {
  beats: number;
  beatType: number;
}

/** Note durations are expressed in "divisions" per quarter note. */
export const DIVISIONS = 768; // divisible by 2^8 and 3 for tuplets

export type NoteType =
  | 'breve' | 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th' | '128th';

export interface Tuplet {
  actual: number;
  normal: number;
  /** 'start' on the first note of the group, 'stop' on the last */
  start?: boolean;
  stop?: boolean;
}

export interface Lyric {
  /** 1-based verse number */
  verse: number;
  text: string;
  syllabic: 'single' | 'begin' | 'middle' | 'end';
  /**
   * Melisma extender line. Parsers mark every note the extender covers with 'start';
   * `finalizeLyrics` resolves that into the syllable the line begins under ('start') and the
   * last note it reaches ('stop'), which carries no syllable of its own.
   */
  extend?: 'start' | 'stop';
}

export type Articulation =
  | 'accent' | 'staccato' | 'tenuto' | 'staccatissimo' | 'marcato' | 'fermata'
  | 'up-bow' | 'down-bow' | 'breath-mark' | 'trill' | 'turn' | 'mordent' | 'inverted-mordent';

export interface NoteEvent {
  kind: 'note';
  /** Start position in divisions from the beginning of the measure */
  start: number;
  duration: number;
  type: NoteType;
  dots: number;
  pitch: Pitch;
  /** Explicit accidental shown in the source (independent of alter) */
  accidental?: 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'flat-flat';
  /** True for chord members after the first note at the same start */
  chord?: boolean;
  tieStart?: boolean;
  tieStop?: boolean;
  slurStarts?: number[];
  slurStops?: number[];
  tuplet?: Tuplet;
  timeModification?: { actual: number; normal: number };
  beam?: 'begin' | 'continue' | 'end';
  stem?: 'up' | 'down';
  lyrics?: Lyric[];
  articulations?: Articulation[];
  grace?: boolean;
  /** MusicXML staff number within the part (1-based) */
  staff?: number;
  voice: number;
}

export interface RestEvent {
  kind: 'rest';
  start: number;
  duration: number;
  type?: NoteType;
  dots: number;
  /** Whole-measure rest */
  measure?: boolean;
  tuplet?: Tuplet;
  timeModification?: { actual: number; normal: number };
  voice: number;
  staff?: number;
}

export type Event = NoteEvent | RestEvent;

export type DynamicMark = 'pppp' | 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'ffff' | 'sfz' | 'fp';

export interface Direction {
  /** Position in divisions from the beginning of the measure */
  start: number;
  placement?: 'above' | 'below';
  dynamic?: DynamicMark;
  words?: string;
  /** Style hint for words */
  style?: 'italic' | 'bold' | 'bold-italic' | 'normal';
  wedge?: { type: 'crescendo' | 'diminuendo' | 'stop'; number: number };
  tempo?: { bpm: number; beatUnit: NoteType; dotted?: boolean; text?: string };
  /** Segno or coda sign shown with (or instead of) the words */
  sign?: 'segno' | 'coda';
  staff?: number;
}

export type BarlineStyle = 'regular' | 'light-light' | 'light-heavy' | 'heavy-light' | 'dotted';

export interface Barline {
  style?: BarlineStyle;
  repeat?: 'forward' | 'backward';
  ending?: { number: number; type: 'start' | 'stop' | 'discontinue' };
}

export interface StaffMeasure {
  /** Clef shown at the start of this measure (only when it changes) */
  clef?: Clef;
  events: Event[];
  directions: Direction[];
}

export interface Measure {
  /** Displayed measure number */
  number: number;
  /** Key signature in fifths, set when it (initially) appears or changes */
  key?: number;
  time?: TimeSignature;
  /** Number of measures collapsed into a multi-measure rest starting here */
  multiRest?: number;
  leftBarline?: Barline;
  rightBarline?: Barline;
  /** One entry per staff of the part */
  staves: StaffMeasure[];
  /** Total length of the measure in divisions (for validation) */
  length: number;
}

export interface Part {
  id: string;
  name: string;
  abbreviation?: string;
  staffCount: number;
  measures: Measure[];
  /** MIDI program (0-based) if known */
  midiProgram?: number;
  /**
   * Added to a written pitch to get the sounding pitch, for transposing instruments.
   * Serialized as the MusicXML `<transpose>` element.
   */
  transpose?: { diatonic: number; chromatic: number };
  /** Whether to render as a piano-style bracketed grand staff */
  grandStaff?: boolean;
}

export interface Score {
  title?: string;
  subtitle?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  copyright?: string;
  parts: Part[];
  /** Warnings collected while parsing the source file */
  warnings: string[];
  source: { format: 'pc' | 'dorico' | 'musicxml'; fileName?: string };
}
