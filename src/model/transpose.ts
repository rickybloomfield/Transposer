import type { Score } from './types';
import { intervalBetweenKeys, simplifyInterval, transposeKey, transposePitch, type Interval } from './pitch';

/** Deep-copy a score (plain data). */
export function cloneScore(score: Score): Score {
  return JSON.parse(JSON.stringify(score)) as Score;
}

/** The key signature (in fifths) in effect at the start of the score. */
export function initialKey(score: Score): number {
  for (const part of score.parts) for (const m of part.measures) if (m.key !== undefined) return m.key;
  return 0;
}

/** All distinct key signatures in the score, in order of appearance. */
export function keysInScore(score: Score): number[] {
  const keys: number[] = [];
  for (const part of score.parts) for (const m of part.measures) if (m.key !== undefined && !keys.includes(m.key)) keys.push(m.key);
  return keys;
}

/** Transpose every pitch and key signature by `interval`; returns a new score. */
export function transposeScore(score: Score, interval: Interval): Score {
  const out = cloneScore(score);
  if (interval.diatonic === 0 && interval.chromatic === 0) return out;
  for (const part of out.parts) {
    let iv = interval;
    let currentKey = 0;
    for (const m of part.measures) {
      if (m.key !== undefined) {
        // Respell enharmonically when a key would leave the -7..7 range.
        iv = simplifyInterval(m.key, interval);
        currentKey = m.key;
        m.key = transposeKey(m.key, iv);
      }
      void currentKey;
      for (const st of m.staves) {
        for (const ev of st.events) {
          if (ev.kind === 'note') {
            ev.pitch = transposePitch(ev.pitch, iv);
            delete ev.accidental;
          }
        }
      }
    }
  }
  return out;
}

/** Interval taking the score's initial key to `targetFifths`. */
export function intervalToKey(score: Score, targetFifths: number, direction?: 'up' | 'down'): Interval {
  return intervalBetweenKeys(initialKey(score), targetFifths, direction);
}
