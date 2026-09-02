import type { NoteType, Pitch, Step } from './types';
import { DIVISIONS } from './types';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMITONES: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Diatonic index of a pitch (C0 = 0, D0 = 1, ... C4 = 28). */
export function diatonicIndex(step: Step, octave: number): number {
  return octave * 7 + STEPS.indexOf(step);
}

export function fromDiatonicIndex(index: number): { step: Step; octave: number } {
  const octave = Math.floor(index / 7);
  const step = STEPS[((index % 7) + 7) % 7];
  return { step, octave };
}

/** MIDI note number of a pitch (C4 = 60). */
export function midiNumber(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

/** Fifths value of a key signature -> alteration applied to each step. */
export function keyAlterations(fifths: number): Record<Step, number> {
  const order: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const result: Record<Step, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < Math.min(fifths, 7); i++) result[order[i]] = 1;
  if (fifths < 0) for (let i = 0; i < Math.min(-fifths, 7); i++) result[order[6 - i]] = -1;
  return result;
}

/** Tonic step/alter for a major key given in fifths (-7..7). */
export function majorTonic(fifths: number): { step: Step; alter: number } {
  // Circle of fifths from C
  const cycle: { step: Step; alter: number }[] = [
    { step: 'C', alter: -1 }, { step: 'G', alter: -1 }, { step: 'D', alter: -1 }, { step: 'A', alter: -1 },
    { step: 'E', alter: -1 }, { step: 'B', alter: -1 }, { step: 'F', alter: 0 }, { step: 'C', alter: 0 },
    { step: 'G', alter: 0 }, { step: 'D', alter: 0 }, { step: 'A', alter: 0 }, { step: 'E', alter: 0 },
    { step: 'B', alter: 0 }, { step: 'F', alter: 1 }, { step: 'C', alter: 1 },
  ];
  return cycle[fifths + 7];
}

export function keyName(fifths: number, mode: 'major' | 'minor' = 'major'): string {
  const majorNames = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const minorNames = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
  const i = Math.max(-7, Math.min(7, fifths)) + 7;
  return mode === 'major' ? `${majorNames[i]} major` : `${minorNames[i]} minor`;
}

/**
 * A transposition interval expressed as diatonic steps plus chromatic semitones.
 * e.g. up a major second = { diatonic: 1, chromatic: 2 }.
 */
export interface Interval {
  diatonic: number;
  chromatic: number;
}

/** Interval that takes the major key `fromFifths` to `toFifths`, choosing the smaller direction. */
export function intervalBetweenKeys(fromFifths: number, toFifths: number, preferDirection?: 'up' | 'down'): Interval {
  const a = majorTonic(fromFifths);
  const b = majorTonic(toFifths);
  const semis = ((STEP_SEMITONES[b.step] + b.alter) - (STEP_SEMITONES[a.step] + a.alter) + 12) % 12; // 0..11 upward
  const steps = ((STEPS.indexOf(b.step) - STEPS.indexOf(a.step)) + 7) % 7; // 0..6 upward
  let up: Interval = { diatonic: steps, chromatic: semis };
  let down: Interval = { diatonic: steps - 7, chromatic: semis - 12 };
  if (semis === 0 && steps === 0) return { diatonic: 0, chromatic: 0 };
  if (preferDirection === 'up') return up;
  if (preferDirection === 'down') return down;
  return semis <= 6 ? up : down;
}

/** Transpose a pitch by an interval, keeping correct spelling. */
export function transposePitch(p: Pitch, iv: Interval): Pitch {
  const oldIndex = diatonicIndex(p.step, p.octave);
  const newIndex = oldIndex + iv.diatonic;
  const { step, octave } = fromDiatonicIndex(newIndex);
  const oldMidi = midiNumber(p);
  const targetMidi = oldMidi + iv.chromatic;
  const naturalMidi = midiNumber({ step, octave, alter: 0 });
  return { step, octave, alter: targetMidi - naturalMidi };
}

/** Transpose a key signature by an interval. */
export function transposeKey(fifths: number, iv: Interval): number {
  // Each diatonic step up adds -12 fifths... derived: fifths change = 7*chromatic - 12*diatonic
  return fifths + 7 * iv.chromatic - 12 * iv.diatonic;
}

/** Bring a key signature into -7..7 by enharmonic respelling; returns the adjusted interval. */
export function simplifyInterval(fromFifths: number, iv: Interval): Interval {
  let result = { ...iv };
  let target = transposeKey(fromFifths, result);
  // Respelling by one diatonic step changes fifths by ∓12.
  while (target > 7) { result = { diatonic: result.diatonic + 1, chromatic: result.chromatic }; target -= 12; }
  while (target < -7) { result = { diatonic: result.diatonic - 1, chromatic: result.chromatic }; target += 12; }
  // Prefer at most 6 accidentals when both spellings are within range
  if (target === 7 && fromFifths <= 0) { result = { diatonic: result.diatonic + 1, chromatic: result.chromatic }; }
  else if (target === -7 && fromFifths >= 0) { result = { diatonic: result.diatonic - 1, chromatic: result.chromatic }; }
  return result;
}

export const NOTE_TYPE_DIVISIONS: Record<NoteType, number> = {
  breve: DIVISIONS * 8,
  whole: DIVISIONS * 4,
  half: DIVISIONS * 2,
  quarter: DIVISIONS,
  eighth: DIVISIONS / 2,
  '16th': DIVISIONS / 4,
  '32nd': DIVISIONS / 8,
  '64th': DIVISIONS / 16,
  '128th': DIVISIONS / 32,
};

export function dottedDuration(type: NoteType, dots: number): number {
  let base = NOTE_TYPE_DIVISIONS[type];
  let total = base;
  for (let i = 0; i < dots; i++) { base /= 2; total += base; }
  return total;
}

export function pitchToString(p: Pitch): string {
  const acc = p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : p.alter === 2 ? '𝄪' : p.alter === -2 ? '𝄫' : '';
  return `${p.step}${acc}${p.octave}`;
}
