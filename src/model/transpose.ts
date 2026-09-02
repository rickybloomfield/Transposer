import type { Part, Score } from './types';
import { intervalBetweenKeys, midiNumber, simplifyInterval, transposeKey, transposePitch, type Interval } from './pitch';
import type { Instrument } from './instruments';

/** Deep-copy a score (plain data). */
export function cloneScore(score: Score): Score {
  return JSON.parse(JSON.stringify(score)) as Score;
}

/** The key signature (in fifths) in effect at the start of the score. */
export function initialKey(score: Score): number {
  for (const part of score.parts) for (const m of part.measures) if (m.key !== undefined) return m.key;
  return 0;
}

/** The key signature (in fifths) in effect at the start of a single part. */
export function initialPartKey(part: Part): number {
  for (const m of part.measures) if (m.key !== undefined) return m.key;
  return 0;
}

/** All distinct key signatures in the score, in order of appearance. */
export function keysInScore(score: Score): number[] {
  const keys: number[] = [];
  for (const part of score.parts) for (const m of part.measures) if (m.key !== undefined && !keys.includes(m.key)) keys.push(m.key);
  return keys;
}

export type PartInterval = Interval | ((part: Part, index: number) => Interval);

/** Transpose every pitch and key signature by `interval`; returns a new score.
 *  `interval` may be a function so that a single part can move further than the rest. */
export function transposeScore(score: Score, interval: PartInterval): Score {
  const out = cloneScore(score);
  const intervalFor = typeof interval === 'function' ? interval : () => interval;
  out.parts.forEach((part, index) => {
    const base = intervalFor(part, index);
    if (base.diatonic === 0 && base.chromatic === 0) return;
    let iv = base;
    for (const m of part.measures) {
      if (m.key !== undefined) {
        // Respell enharmonically when a key would leave the -7..7 range.
        iv = simplifyInterval(m.key, base);
        m.key = transposeKey(m.key, iv);
      }
      for (const st of m.staves) {
        for (const ev of st.events) {
          if (ev.kind === 'note') {
            ev.pitch = transposePitch(ev.pitch, iv);
            delete ev.accidental;
          }
        }
      }
    }
  });
  return out;
}

/** Every written pitch of a part after `iv`, as MIDI numbers, for range checks. */
export function transposedPitches(part: Part, iv: Interval): number[] {
  const out: number[] = [];
  for (const m of part.measures) for (const st of m.staves) for (const ev of st.events) {
    if (ev.kind === 'note') out.push(midiNumber(transposePitch(ev.pitch, iv)));
  }
  return out;
}

/** True when every part carries the same key signature. */
export function partsShareKey(score: Score): boolean {
  if (score.parts.length < 2) return true;
  const first = initialPartKey(score.parts[0]);
  return score.parts.every((p) => initialPartKey(p) === first);
}

/**
 * Print multi-measure rests as separate measures. Verovio leaves the key
 * signature off a system when one part collapses measures into a multi-rest and
 * the parts are in different keys, which is exactly what re-notating a single
 * part for a transposing instrument produces.
 */
export function expandMultiRests(score: Score): number {
  let expanded = 0;
  for (const part of score.parts) for (const m of part.measures) {
    if (m.multiRest) { delete m.multiRest; expanded++; }
  }
  return expanded;
}

export interface InstrumentChange {
  /** Clef changes inside the piece that were dropped because they suited the old instrument. */
  droppedClefChanges: number;
}

/**
 * Re-label a part for `to`: put its usual clef at the start, drop clef changes that
 * belonged to the old instrument, and record the new transposition for MusicXML export.
 * Pitches are moved separately by `transposeScore`.
 */
export function applyInstrument(part: Part, to: Instrument): InstrumentChange {
  part.transpose = to.transpose.diatonic === 0 && to.transpose.chromatic === 0 ? undefined : { ...to.transpose };
  if (to.keepClef) return { droppedClefChanges: 0 };
  part.name = to.name;
  part.abbreviation = to.short;
  if (part.staffCount !== 1 || !part.measures.length) return { droppedClefChanges: 0 };
  let dropped = 0;
  part.measures.forEach((m, i) => {
    const staff = m.staves[0];
    if (!staff) return;
    if (i === 0) staff.clef = { ...to.clef };
    else if (staff.clef) { delete staff.clef; dropped++; }
  });
  return { droppedClefChanges: dropped };
}

/** Interval taking the score's initial key to `targetFifths`. */
export function intervalToKey(score: Score, targetFifths: number, direction?: 'up' | 'down'): Interval {
  return intervalBetweenKeys(initialKey(score), targetFifths, direction);
}
