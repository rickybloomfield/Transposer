// Instrument definitions used to re-notate a part for a different instrument:
// each entry knows how far its written pitch sits from concert pitch, which clef
// it is normally read from, and roughly how high and low it can comfortably go.

import type { Clef, Pitch, Step } from './types';
import type { Interval } from './pitch';
import { DEGREE_SEMITONES, midiNumber } from './pitch';

export type InstrumentFamily =
  | 'Concert pitch' | 'Woodwinds' | 'Brass' | 'Percussion' | 'Keyboards' | 'Strings' | 'Voices';

export interface InstrumentRange {
  /** Lowest comfortable written pitch */
  low: Pitch;
  /** Highest comfortable written pitch */
  high: Pitch;
}

export interface Instrument {
  id: string;
  name: string;
  family: InstrumentFamily;
  /**
   * Added to a written pitch to get the sounding pitch — the same convention as the
   * MusicXML `<transpose>` element. A B♭ clarinet reads C and sounds B♭, so its
   * transposition is a major second down.
   */
  transpose: Interval;
  /** Clef the part is normally written on. */
  clef: Clef;
  /** Short name for the MusicXML part abbreviation. */
  short: string;
  /** Comfortable written range, used to pick an octave when swapping instruments. */
  range?: InstrumentRange;
  /** Leave the source clef and part name untouched (the generic concert-pitch entry). */
  keepClef?: boolean;
  /** Patterns matched against a normalized part name, subtitle, file name or title. */
  detect?: RegExp[];
}

const T = (diatonic: number, chromatic: number): Interval => ({ diatonic, chromatic });
const TREBLE: Clef = { sign: 'G', line: 2 };
const TREBLE_8VB: Clef = { sign: 'G', line: 2, octaveChange: -1 };
const BASS: Clef = { sign: 'F', line: 4 };
const ALTO: Clef = { sign: 'C', line: 3 };

/** "Bb3", "F#4", "C4" -> pitch. */
function p(text: string): Pitch {
  const m = /^([A-G])(bb|##|b|#)?(-?\d+)$/.exec(text);
  if (!m) throw new Error(`Bad pitch ${text}`);
  const alter = m[2] === 'b' ? -1 : m[2] === 'bb' ? -2 : m[2] === '#' ? 1 : m[2] === '##' ? 2 : 0;
  return { step: m[1] as Step, alter, octave: Number(m[3]) };
}

const r = (low: string, high: string): InstrumentRange => ({ low: p(low), high: p(high) });

export const INSTRUMENTS: Instrument[] = [
  { id: 'concert', name: 'Concert pitch (C)', family: 'Concert pitch', short: 'C', transpose: T(0, 0), clef: TREBLE, keepClef: true },

  // Woodwinds
  { id: 'piccolo', name: 'Piccolo', family: 'Woodwinds', short: 'Picc.', transpose: T(7, 12), clef: TREBLE, range: r('D4', 'C7'), detect: [/\bpiccolos?\b/, /\bpicc\b/] },
  { id: 'flute', name: 'Flute', family: 'Woodwinds', short: 'Fl.', transpose: T(0, 0), clef: TREBLE, range: r('C4', 'D7'), detect: [/\bflutes?\b/, /\bconcert flute\b/] },
  { id: 'alto-flute', name: 'Alto Flute in G', family: 'Woodwinds', short: 'A. Fl.', transpose: T(-3, -5), clef: TREBLE, range: r('C4', 'G6'), detect: [/\balto flutes?\b/] },
  { id: 'bass-flute', name: 'Bass Flute', family: 'Woodwinds', short: 'B. Fl.', transpose: T(-7, -12), clef: TREBLE, range: r('C4', 'C7'), detect: [/\bbass flutes?\b/] },
  { id: 'oboe', name: 'Oboe', family: 'Woodwinds', short: 'Ob.', transpose: T(0, 0), clef: TREBLE, range: r('Bb3', 'A6'), detect: [/\boboes?\b/] },
  { id: 'oboe-damore', name: "Oboe d'amore in A", family: 'Woodwinds', short: 'Ob. d’am.', transpose: T(-2, -3), clef: TREBLE, range: r('B3', 'E6'), detect: [/\boboe d ?amore\b/] },
  { id: 'english-horn', name: 'English Horn in F', family: 'Woodwinds', short: 'E. Hn.', transpose: T(-4, -7), clef: TREBLE, range: r('B3', 'G6'), detect: [/\benglish horns?\b/, /\bcor anglais\b/] },
  { id: 'clarinet-eb', name: 'Clarinet in E♭', family: 'Woodwinds', short: 'E♭ Cl.', transpose: T(2, 3), clef: TREBLE, range: r('E3', 'G6'), detect: [/\beb clarinets?\b/, /\bclarinets? in eb\b/, /\bsopranino clarinets?\b/] },
  { id: 'clarinet-bb', name: 'Clarinet in B♭', family: 'Woodwinds', short: 'B♭ Cl.', transpose: T(-1, -2), clef: TREBLE, range: r('E3', 'G6'), detect: [/\bclarinets?\b/, /\bbb clarinets?\b/, /\bclarinets? in bb\b/, /\bsoprano clarinets?\b/] },
  { id: 'clarinet-a', name: 'Clarinet in A', family: 'Woodwinds', short: 'A Cl.', transpose: T(-2, -3), clef: TREBLE, range: r('E3', 'G6'), detect: [/\ba clarinets?\b/, /\bclarinets? in a\b/] },
  { id: 'alto-clarinet', name: 'Alto Clarinet in E♭', family: 'Woodwinds', short: 'A. Cl.', transpose: T(-5, -9), clef: TREBLE, range: r('E3', 'G6'), detect: [/\balto clarinets?\b/] },
  { id: 'basset-horn', name: 'Basset Horn in F', family: 'Woodwinds', short: 'Bas. Hn.', transpose: T(-4, -7), clef: TREBLE, range: r('C3', 'G6'), detect: [/\bbasset horns?\b/] },
  { id: 'bass-clarinet', name: 'Bass Clarinet in B♭', family: 'Woodwinds', short: 'B. Cl.', transpose: T(-8, -14), clef: TREBLE, range: r('E3', 'G6'), detect: [/\bbass clarinets?\b/] },
  { id: 'contrabass-clarinet', name: 'Contrabass Clarinet in B♭', family: 'Woodwinds', short: 'Cb. Cl.', transpose: T(-15, -26), clef: TREBLE, range: r('E3', 'C6'), detect: [/\bcontra ?bass clarinets?\b/] },
  { id: 'bassoon', name: 'Bassoon', family: 'Woodwinds', short: 'Bsn.', transpose: T(0, 0), clef: BASS, range: r('Bb1', 'Eb5'), detect: [/\bbassoons?\b/, /\bfagott\w*\b/] },
  { id: 'contrabassoon', name: 'Contrabassoon', family: 'Woodwinds', short: 'Cbsn.', transpose: T(-7, -12), clef: BASS, range: r('Bb1', 'Eb5'), detect: [/\bcontra ?bassoons?\b/, /\bdouble bassoons?\b/] },
  { id: 'soprano-sax', name: 'Soprano Saxophone in B♭', family: 'Woodwinds', short: 'S. Sax.', transpose: T(-1, -2), clef: TREBLE, range: r('Bb3', 'F6'), detect: [/\bsoprano sax(ophone)?s?\b/] },
  { id: 'alto-sax', name: 'Alto Saxophone in E♭', family: 'Woodwinds', short: 'A. Sax.', transpose: T(-5, -9), clef: TREBLE, range: r('Bb3', 'F6'), detect: [/\balto sax(ophone)?s?\b/, /\bsax(ophone)?s?\b/] },
  { id: 'tenor-sax', name: 'Tenor Saxophone in B♭', family: 'Woodwinds', short: 'T. Sax.', transpose: T(-8, -14), clef: TREBLE, range: r('Bb3', 'F6'), detect: [/\btenor sax(ophone)?s?\b/] },
  { id: 'baritone-sax', name: 'Baritone Saxophone in E♭', family: 'Woodwinds', short: 'Bar. Sax.', transpose: T(-12, -21), clef: TREBLE, range: r('Bb3', 'F6'), detect: [/\bbari(tone)? sax(ophone)?s?\b/] },
  { id: 'bass-sax', name: 'Bass Saxophone in B♭', family: 'Woodwinds', short: 'B. Sax.', transpose: T(-15, -26), clef: TREBLE, range: r('Bb3', 'F6'), detect: [/\bbass sax(ophone)?s?\b/] },
  { id: 'recorder-soprano', name: 'Soprano Recorder', family: 'Woodwinds', short: 'S. Rec.', transpose: T(7, 12), clef: TREBLE, range: r('C4', 'D6'), detect: [/\brecorders?\b/, /\b(soprano|descant) recorders?\b/] },
  { id: 'recorder-alto', name: 'Alto Recorder in F', family: 'Woodwinds', short: 'A. Rec.', transpose: T(0, 0), clef: TREBLE, range: r('F3', 'G5'), detect: [/\b(alto|treble) recorders?\b/] },

  // Brass
  { id: 'trumpet-bb', name: 'Trumpet in B♭', family: 'Brass', short: 'B♭ Tpt.', transpose: T(-1, -2), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\btrumpets?\b/, /\btpt\b/, /\bbb trumpets?\b/, /\btrumpets? in bb\b/] },
  { id: 'trumpet-c', name: 'Trumpet in C', family: 'Brass', short: 'C Tpt.', transpose: T(0, 0), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bc trumpets?\b/, /\btrumpets? in c\b/] },
  { id: 'trumpet-d', name: 'Trumpet in D', family: 'Brass', short: 'D Tpt.', transpose: T(1, 2), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bd trumpets?\b/, /\btrumpets? in d\b/] },
  { id: 'trumpet-eb', name: 'Trumpet in E♭', family: 'Brass', short: 'E♭ Tpt.', transpose: T(2, 3), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\beb trumpets?\b/, /\btrumpets? in eb\b/] },
  { id: 'piccolo-trumpet', name: 'Piccolo Trumpet in B♭', family: 'Brass', short: 'Picc. Tpt.', transpose: T(6, 10), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bpiccolo trumpets?\b/] },
  { id: 'cornet', name: 'Cornet in B♭', family: 'Brass', short: 'Cnt.', transpose: T(-1, -2), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bcornets?\b/] },
  { id: 'flugelhorn', name: 'Flugelhorn in B♭', family: 'Brass', short: 'Flghn.', transpose: T(-1, -2), clef: TREBLE, range: r('F#3', 'Bb5'), detect: [/\bflu?e?gelhorns?\b/] },
  { id: 'horn-f', name: 'Horn in F', family: 'Brass', short: 'Hn.', transpose: T(-4, -7), clef: TREBLE, range: r('C3', 'C6'), detect: [/\b(french )?horns?\b/, /\bhorns? in f\b/, /\bf horns?\b/] },
  { id: 'horn-eb', name: 'Horn in E♭', family: 'Brass', short: 'E♭ Hn.', transpose: T(-5, -9), clef: TREBLE, range: r('C3', 'C6'), detect: [/\bhorns? in eb\b/, /\beb horns?\b/] },
  { id: 'mellophone', name: 'Mellophone in F', family: 'Brass', short: 'Mel.', transpose: T(-4, -7), clef: TREBLE, range: r('C3', 'C6'), detect: [/\bmellophones?\b/] },
  { id: 'alto-horn', name: 'Alto Horn in E♭', family: 'Brass', short: 'A. Hn.', transpose: T(-5, -9), clef: TREBLE, range: r('C3', 'C6'), detect: [/\b(alto|tenor) horns?\b/] },
  { id: 'trombone', name: 'Trombone', family: 'Brass', short: 'Tbn.', transpose: T(0, 0), clef: BASS, range: r('E2', 'Bb4'), detect: [/\btrombones?\b/, /\btbn\b/] },
  { id: 'bass-trombone', name: 'Bass Trombone', family: 'Brass', short: 'B. Tbn.', transpose: T(0, 0), clef: BASS, range: r('Bb1', 'Bb4'), detect: [/\bbass trombones?\b/] },
  { id: 'trombone-bb', name: 'Trombone in B♭ (treble)', family: 'Brass', short: 'B♭ Tbn.', transpose: T(-8, -14), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bbb trombones?\b/, /\btrombones? in bb\b/, /\btreble trombones?\b/] },
  { id: 'euphonium', name: 'Euphonium', family: 'Brass', short: 'Euph.', transpose: T(0, 0), clef: BASS, range: r('E2', 'Bb4'), detect: [/\beuphoniums?\b/] },
  { id: 'euphonium-bb', name: 'Euphonium in B♭ (treble)', family: 'Brass', short: 'B♭ Euph.', transpose: T(-8, -14), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bbb euphoniums?\b/, /\beuphoniums? in bb\b/, /\btreble euphoniums?\b/] },
  { id: 'baritone-horn', name: 'Baritone Horn in B♭', family: 'Brass', short: 'Bar.', transpose: T(-8, -14), clef: TREBLE, range: r('F#3', 'C6'), detect: [/\bbaritone horns?\b/, /\bbaritones? in bb\b/] },
  { id: 'tuba', name: 'Tuba', family: 'Brass', short: 'Tba.', transpose: T(0, 0), clef: BASS, range: r('D1', 'F4'), detect: [/\btubas?\b/, /\bsousaphones?\b/, /\bcontra ?bass tubas?\b/] },

  // Percussion
  { id: 'timpani', name: 'Timpani', family: 'Percussion', short: 'Timp.', transpose: T(0, 0), clef: BASS, range: r('D2', 'C4'), detect: [/\btimpani\b/, /\bkettle ?drums?\b/] },
  { id: 'glockenspiel', name: 'Glockenspiel', family: 'Percussion', short: 'Glk.', transpose: T(14, 24), clef: TREBLE, range: r('G3', 'C6'), detect: [/\bglockenspiels?\b/, /\borchestra bells\b/] },
  { id: 'xylophone', name: 'Xylophone', family: 'Percussion', short: 'Xyl.', transpose: T(7, 12), clef: TREBLE, range: r('F4', 'C7'), detect: [/\bxylophones?\b/] },
  { id: 'marimba', name: 'Marimba', family: 'Percussion', short: 'Mar.', transpose: T(0, 0), clef: TREBLE, range: r('C3', 'C7'), detect: [/\bmarimbas?\b/] },
  { id: 'vibraphone', name: 'Vibraphone', family: 'Percussion', short: 'Vib.', transpose: T(0, 0), clef: TREBLE, range: r('F3', 'F6'), detect: [/\bvibraphones?\b/, /\bvibes\b/] },
  { id: 'tubular-bells', name: 'Tubular Bells', family: 'Percussion', short: 'Chimes', transpose: T(0, 0), clef: TREBLE, range: r('F4', 'F5'), detect: [/\btubular bells\b/, /\bchimes\b/] },

  // Keyboards
  { id: 'piano', name: 'Piano', family: 'Keyboards', short: 'Pno.', transpose: T(0, 0), clef: TREBLE, range: r('A0', 'C8'), detect: [/\bpianos?\b/, /\bpno\b/, /\bkeyboards?\b/] },
  { id: 'organ', name: 'Organ', family: 'Keyboards', short: 'Org.', transpose: T(0, 0), clef: TREBLE, range: r('C2', 'C7'), detect: [/\borgans?\b/] },
  { id: 'harpsichord', name: 'Harpsichord', family: 'Keyboards', short: 'Hpsd.', transpose: T(0, 0), clef: TREBLE, range: r('F1', 'F6'), detect: [/\bharpsichords?\b/] },
  { id: 'celesta', name: 'Celesta', family: 'Keyboards', short: 'Cel.', transpose: T(7, 12), clef: TREBLE, range: r('C3', 'C7'), detect: [/\bcelesta\b/, /\bceleste\b/] },
  { id: 'accordion', name: 'Accordion', family: 'Keyboards', short: 'Acc.', transpose: T(0, 0), clef: TREBLE, range: r('F2', 'A6'), detect: [/\baccordions?\b/] },

  // Strings
  { id: 'violin', name: 'Violin', family: 'Strings', short: 'Vln.', transpose: T(0, 0), clef: TREBLE, range: r('G3', 'E7'), detect: [/\bviolins?\b/, /\bvln\b/, /\bfiddle\b/] },
  { id: 'viola', name: 'Viola', family: 'Strings', short: 'Vla.', transpose: T(0, 0), clef: ALTO, range: r('C3', 'E6'), detect: [/\bviolas?\b/, /\bvla\b/] },
  { id: 'cello', name: 'Cello', family: 'Strings', short: 'Vc.', transpose: T(0, 0), clef: BASS, range: r('C2', 'A5'), detect: [/\bcellos?\b/, /\bvioloncellos?\b/, /\bvlc\b/] },
  { id: 'double-bass', name: 'Double Bass', family: 'Strings', short: 'Cb.', transpose: T(-7, -12), clef: BASS, range: r('E2', 'C5'), detect: [/\bdouble bass\b/, /\bcontrabass\b/, /\bstring bass\b/, /\bupright bass\b/] },
  { id: 'harp', name: 'Harp', family: 'Strings', short: 'Hp.', transpose: T(0, 0), clef: TREBLE, range: r('C1', 'G7'), detect: [/\bharps?\b/] },
  { id: 'guitar', name: 'Guitar', family: 'Strings', short: 'Gtr.', transpose: T(-7, -12), clef: TREBLE_8VB, range: r('E3', 'E6'), detect: [/\bguitars?\b/, /\bgtr\b/] },
  { id: 'bass-guitar', name: 'Bass Guitar', family: 'Strings', short: 'B. Gtr.', transpose: T(-7, -12), clef: BASS, range: r('E2', 'G4'), detect: [/\bbass guitars?\b/, /\belectric bass\b/] },

  // Voices
  { id: 'soprano', name: 'Soprano', family: 'Voices', short: 'S.', transpose: T(0, 0), clef: TREBLE, range: r('C4', 'C6'), detect: [/\bsopranos?\b/] },
  { id: 'mezzo-soprano', name: 'Mezzo-soprano', family: 'Voices', short: 'Mez.', transpose: T(0, 0), clef: TREBLE, range: r('A3', 'A5'), detect: [/\bmezzo( ?soprano)?s?\b/] },
  { id: 'alto-voice', name: 'Alto', family: 'Voices', short: 'A.', transpose: T(0, 0), clef: TREBLE, range: r('F3', 'F5'), detect: [/\baltos?\b/, /\bcontraltos?\b/] },
  { id: 'tenor-voice', name: 'Tenor', family: 'Voices', short: 'T.', transpose: T(-7, -12), clef: TREBLE_8VB, range: r('C4', 'C6'), detect: [/\btenors?\b/] },
  { id: 'baritone-voice', name: 'Baritone', family: 'Voices', short: 'Bar.', transpose: T(0, 0), clef: BASS, range: r('A2', 'A4'), detect: [/\bbaritones?\b/] },
  { id: 'bass-voice', name: 'Bass', family: 'Voices', short: 'B.', transpose: T(0, 0), clef: BASS, range: r('E2', 'E4'), detect: [/\bbass\b/, /\bbasso\b/] },
];

export const CONCERT_PITCH = INSTRUMENTS[0];

export const FAMILY_ORDER: InstrumentFamily[] =
  ['Concert pitch', 'Woodwinds', 'Brass', 'Percussion', 'Keyboards', 'Strings', 'Voices'];

const BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

export function instrumentById(id: string | undefined): Instrument {
  return (id && BY_ID.get(id)) || CONCERT_PITCH;
}

/**
 * Lower-case text with flat/sharp words and signs folded into "b"/"#" so that
 * "B-flat Clarinet", "Bb Clarinet" and "Clarinet in B♭" all look the same.
 */
export function normalizeInstrumentText(text: string): string {
  return text
    .toLowerCase()
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/\b([a-g])[-\s]?flat\b/g, '$1b')
    .replace(/\b([a-g])[-\s]?sharp\b/g, '$1#')
    .replace(/[^a-z0-9#\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface InstrumentMatch {
  instrument: Instrument;
  /** The exact text that matched, so callers can rewrite it with the new name. */
  matched: string;
}

/** Best instrument named anywhere in `text`; the longest match wins so that
 * "bass clarinet" beats "clarinet" and "alto saxophone" beats "alto". */
export function matchInstrument(text: string): InstrumentMatch | undefined {
  const hay = normalizeInstrumentText(text);
  if (!hay) return undefined;
  let best: InstrumentMatch | undefined;
  for (const instrument of INSTRUMENTS) {
    for (const re of instrument.detect ?? []) {
      const m = re.exec(hay);
      if (m && (!best || m[0].length > best.matched.length)) best = { instrument, matched: m[0] };
    }
  }
  return best;
}

export interface InstrumentDetection extends InstrumentMatch {
  /** Which piece of metadata the name was found in. */
  source: 'part' | 'subtitle' | 'file' | 'title';
}

/** Look for an instrument name in the part name first, then the subtitle, file name and title. */
export function detectInstrument(fields: {
  partName?: string;
  abbreviation?: string;
  subtitle?: string;
  fileName?: string;
  title?: string;
}): InstrumentDetection | undefined {
  const candidates: { source: InstrumentDetection['source']; text?: string }[] = [
    { source: 'part', text: fields.partName },
    { source: 'part', text: fields.abbreviation },
    { source: 'subtitle', text: fields.subtitle },
    { source: 'file', text: fields.fileName },
    { source: 'title', text: fields.title },
  ];
  for (const c of candidates) {
    if (!c.text) continue;
    const m = matchInstrument(c.text);
    if (m) return { ...m, source: c.source };
  }
  return undefined;
}

/** Interval to add to every written pitch when re-notating a `from` part for `to`. */
export function instrumentInterval(from: Instrument, to: Instrument): Interval {
  return {
    diatonic: from.transpose.diatonic - to.transpose.diatonic,
    chromatic: from.transpose.chromatic - to.transpose.chromatic,
  };
}

export function addIntervals(a: Interval, b: Interval): Interval {
  return { diatonic: a.diatonic + b.diatonic, chromatic: a.chromatic + b.chromatic };
}

export function octaveInterval(octaves: number): Interval {
  return { diatonic: 7 * octaves, chromatic: 12 * octaves };
}

/** How far outside `range` a set of written pitches falls, in semitones (0 = all inside). */
function rangeMiss(midis: number[], range: InstrumentRange, shift: number): number {
  const low = midiNumber(range.low);
  const high = midiNumber(range.high);
  let miss = 0;
  for (const m of midis) {
    const v = m + shift * 12;
    if (v < low) miss += low - v;
    else if (v > high) miss += v - high;
  }
  return miss;
}

/**
 * Octave shift (in octaves) that best fits `midis` into the instrument's range.
 * Returns 0 when the music already fits, or when either instrument has no range.
 */
export function fitOctaveShift(midis: number[], range: InstrumentRange | undefined, max = 3): number {
  if (!range || !midis.length) return 0;
  let best = 0;
  let bestMiss = rangeMiss(midis, range, 0);
  for (let shift = -max; shift <= max; shift++) {
    if (shift === 0) continue;
    const miss = rangeMiss(midis, range, shift);
    if (miss < bestMiss || (miss === bestMiss && Math.abs(shift) < Math.abs(best))) {
      best = shift;
      bestMiss = miss;
    }
  }
  return best;
}

const PERFECT = new Set([0, 3, 4]);
const ORDINALS = ['unison', '2nd', '3rd', '4th', '5th', '6th', '7th', 'octave', '9th', '10th', '11th', '12th', '13th', '14th', 'two octaves'];

/** "up a major 2nd", "down an octave", "up a perfect 5th". */
export function describeInterval(iv: Interval): string {
  if (iv.diatonic === 0 && iv.chromatic === 0) return 'same pitch';
  const up = iv.chromatic > 0 || (iv.chromatic === 0 && iv.diatonic > 0);
  // "up an augmented unison" is how theory names it and how nobody says it.
  if (iv.diatonic === 0 && Math.abs(iv.chromatic) === 1) return `${up ? 'up' : 'down'} a semitone`;
  const diatonic = Math.abs(iv.diatonic);
  const chromatic = Math.abs(iv.chromatic);
  const octaves = Math.floor(diatonic / 7);
  const degree = diatonic % 7;
  const diff = chromatic - (12 * octaves + DEGREE_SEMITONES[degree]);
  const quality = PERFECT.has(degree)
    ? (diff === 0 ? 'perfect' : diff > 0 ? 'augmented' : 'diminished')
    : (diff === 0 ? 'major' : diff === -1 ? 'minor' : diff > 0 ? 'augmented' : 'diminished');
  const name = ORDINALS[diatonic] ?? `${diatonic + 1}th`;
  const bare = name === 'unison' || name === 'octave' || name === 'two octaves';
  const label = bare && diff === 0 ? name : `${quality} ${name}`;
  const article = label === 'two octaves' ? '' : /^[aeiou]/.test(label) ? 'an ' : 'a ';
  return `${up ? 'up' : 'down'} ${article}${label}`;
}
