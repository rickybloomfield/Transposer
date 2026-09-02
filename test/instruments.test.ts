import { describe, expect, it } from 'vitest';
import {
  addIntervals,
  describeInterval,
  detectInstrument,
  fitOctaveShift,
  instrumentById,
  instrumentInterval,
  matchInstrument,
} from '../src/model/instruments';
import { intervalBetweenKeys, midiNumber, simplifyInterval, transposeKey, transposePitch } from '../src/model/pitch';
import { applyInstrument, expandMultiRests, initialPartKey, partsShareKey, transposeScore } from '../src/model/transpose';
import type { Part, Pitch, Score } from '../src/model/types';
import { DIVISIONS } from '../src/model/types';

const concert = instrumentById('concert');

/** Written key a `from` part in `fifths` lands on when re-notated for `to`. */
function writtenKey(fromId: string, toId: string, fifths: number): number {
  const iv = simplifyInterval(fifths, instrumentInterval(instrumentById(fromId), instrumentById(toId)));
  return transposeKey(fifths, iv);
}

/** Written pitch a concert-pitch note becomes for `toId`. */
function writtenPitch(toId: string, pitch: Pitch): Pitch {
  return transposePitch(pitch, instrumentInterval(concert, instrumentById(toId)));
}

describe('instrument transposition', () => {
  it('reads a whole step up for a B♭ instrument', () => {
    expect(writtenKey('concert', 'trumpet-bb', 0)).toBe(2); // C major -> D major
    expect(writtenPitch('trumpet-bb', { step: 'C', alter: 0, octave: 4 })).toEqual({ step: 'D', alter: 0, octave: 4 });
  });

  it('reads a major sixth up for an E♭ alto saxophone', () => {
    expect(writtenKey('concert', 'alto-sax', 0)).toBe(3); // C major -> A major
    expect(writtenPitch('alto-sax', { step: 'C', alter: 0, octave: 4 })).toEqual({ step: 'A', alter: 0, octave: 4 });
  });

  it('reads a perfect fifth up for a horn in F', () => {
    expect(writtenKey('concert', 'horn-f', -1)).toBe(0); // F major -> C major
    expect(writtenPitch('horn-f', { step: 'F', alter: 0, octave: 4 })).toEqual({ step: 'C', alter: 0, octave: 5 });
  });

  it('keeps tenor saxophone a ninth above concert pitch', () => {
    expect(writtenPitch('tenor-sax', { step: 'C', alter: 0, octave: 4 })).toEqual({ step: 'D', alter: 0, octave: 5 });
  });

  it('writes piccolo an octave below the sounding pitch', () => {
    expect(writtenPitch('piccolo', { step: 'D', alter: 0, octave: 6 })).toEqual({ step: 'D', alter: 0, octave: 5 });
    expect(writtenKey('concert', 'piccolo', 3)).toBe(3);
  });

  it('is the identity between two instruments with the same transposition', () => {
    expect(instrumentInterval(instrumentById('trumpet-bb'), instrumentById('clarinet-bb'))).toEqual({ diatonic: 0, chromatic: 0 });
    expect(instrumentInterval(instrumentById('violin'), instrumentById('violin'))).toEqual({ diatonic: 0, chromatic: 0 });
  });

  it('converts between two transposing instruments', () => {
    // A B♭ clarinet part read by an E♭ alto saxophone moves up a perfect fifth.
    expect(instrumentInterval(instrumentById('clarinet-bb'), instrumentById('alto-sax'))).toEqual({ diatonic: 4, chromatic: 7 });
  });

  it('respells a key signature that would need more than seven accidentals', () => {
    // B major (5 sharps) for an E♭ instrument would be G♯ major (8 sharps); use A♭ major instead.
    expect(writtenKey('concert', 'alto-sax', 5)).toBe(-4);
  });
});

describe('instrument detection', () => {
  it('finds the instrument in a part name', () => {
    expect(detectInstrument({ partName: 'Viola' })?.instrument.id).toBe('viola');
  });

  it('prefers the most specific name', () => {
    expect(matchInstrument('Bass Clarinet')?.instrument.id).toBe('bass-clarinet');
    expect(matchInstrument('Baritone Saxophone')?.instrument.id).toBe('baritone-sax');
    expect(matchInstrument('English Horn')?.instrument.id).toBe('english-horn');
    expect(matchInstrument('Double Bass')?.instrument.id).toBe('double-bass');
    expect(matchInstrument('Alto Sax')?.instrument.id).toBe('alto-sax');
    expect(matchInstrument('Piccolo Trumpet')?.instrument.id).toBe('piccolo-trumpet');
  });

  it('understands the ways a key can be spelled', () => {
    for (const text of ['Clarinet in B♭', 'Bb Clarinet', 'B-flat Clarinet', 'Clarinet']) {
      expect(matchInstrument(text)?.instrument.id, text).toBe('clarinet-bb');
    }
    expect(matchInstrument('Clarinet in A')?.instrument.id).toBe('clarinet-a');
    expect(matchInstrument('Trumpet in C')?.instrument.id).toBe('trumpet-c');
    expect(matchInstrument('Horn in F')?.instrument.id).toBe('horn-f');
  });

  it('reads a hyphenated file name', () => {
    expect(detectInstrument({ fileName: 'be-still-my-soul-viola' })?.instrument.id).toBe('viola');
    expect(detectInstrument({ fileName: 'be-still-my-soul-viola' })?.source).toBe('file');
  });

  it('checks the part name before the subtitle and the title last', () => {
    const d = detectInstrument({ partName: 'Flute', subtitle: 'Violin', title: 'Trumpet Voluntary' });
    expect(d?.instrument.id).toBe('flute');
    expect(d?.source).toBe('part');
    expect(detectInstrument({ subtitle: 'Violin', title: 'Trumpet Voluntary' })?.instrument.id).toBe('violin');
  });

  it('returns nothing when no instrument is named', () => {
    expect(detectInstrument({ partName: 'Voice', title: 'Be Still My Soul' })).toBeUndefined();
  });
});

describe('octave fitting', () => {
  const midis = (...names: [string, number][]) => names.map(([step, octave]) => midiNumber({ step: step as Pitch['step'], alter: 0, octave }));

  it('leaves music alone when it already fits', () => {
    const viola = instrumentById('viola');
    expect(fitOctaveShift(midis(['C', 4], ['G', 4], ['E', 5]), viola.range)).toBe(0);
  });

  it('drops a melody into a tuba\'s range', () => {
    const tuba = instrumentById('tuba');
    expect(fitOctaveShift(midis(['G', 4], ['C', 5], ['A', 5]), tuba.range)).toBe(-2);
  });

  it('lifts a bass line into a flute\'s range', () => {
    const flute = instrumentById('flute');
    expect(fitOctaveShift(midis(['E', 2], ['G', 2], ['C', 3]), flute.range)).toBe(2);
  });

  it('does nothing without a range', () => {
    expect(fitOctaveShift(midis(['C', 4]), undefined)).toBe(0);
  });
});

describe('interval names', () => {
  it('names the intervals used by transposing instruments', () => {
    expect(describeInterval({ diatonic: 0, chromatic: 0 })).toBe('same pitch');
    expect(describeInterval({ diatonic: 1, chromatic: 2 })).toBe('up a major 2nd');
    expect(describeInterval({ diatonic: -1, chromatic: -2 })).toBe('down a major 2nd');
    expect(describeInterval({ diatonic: 2, chromatic: 3 })).toBe('up a minor 3rd');
    expect(describeInterval({ diatonic: 4, chromatic: 7 })).toBe('up a perfect 5th');
    expect(describeInterval({ diatonic: 7, chromatic: 12 })).toBe('up an octave');
    expect(describeInterval({ diatonic: -8, chromatic: -14 })).toBe('down a major 9th');
    expect(describeInterval({ diatonic: 3, chromatic: 6 })).toBe('up an augmented 4th');
    expect(describeInterval({ diatonic: 0, chromatic: -1 })).toBe('down a semitone');
  });
});

function melody(): Score {
  const part: Part = {
    id: 'P1',
    name: 'Viola',
    staffCount: 1,
    measures: [
      {
        number: 1, key: -1, time: { beats: 4, beatType: 4 }, length: DIVISIONS * 4,
        staves: [{
          clef: { sign: 'C', line: 3 },
          events: [{ kind: 'note', start: 0, duration: DIVISIONS * 4, type: 'whole', dots: 0, pitch: { step: 'F', alter: 0, octave: 4 }, voice: 1 }],
          directions: [],
        }],
      },
      {
        number: 2, length: DIVISIONS * 4,
        staves: [{
          clef: { sign: 'G', line: 2 },
          events: [{ kind: 'note', start: 0, duration: DIVISIONS * 4, type: 'whole', dots: 0, pitch: { step: 'A', alter: 0, octave: 5 }, voice: 1 }],
          directions: [],
        }],
      },
    ],
  };
  return { title: 'Test', subtitle: 'Viola', parts: [part, { ...part, id: 'P2', name: 'Piano', staffCount: 2 }], warnings: [], source: { format: 'pc' } };
}

describe('applying an instrument to one part', () => {
  it('moves only the chosen part and leaves the accompaniment alone', () => {
    const score = melody();
    const iv = instrumentInterval(instrumentById('viola'), instrumentById('clarinet-bb'));
    const out = transposeScore(score, (_p, i) => (i === 0 ? iv : { diatonic: 0, chromatic: 0 }));
    expect(initialPartKey(out.parts[0])).toBe(1); // F major -> G major
    expect(initialPartKey(out.parts[1])).toBe(-1);
  });

  it('swaps the clef, renames the part and records the transposition', () => {
    const score = melody();
    const change = applyInstrument(score.parts[0], instrumentById('clarinet-bb'));
    expect(score.parts[0].measures[0].staves[0].clef).toEqual({ sign: 'G', line: 2 });
    expect(score.parts[0].measures[1].staves[0].clef).toBeUndefined();
    expect(change.droppedClefChanges).toBe(1);
    expect(score.parts[0].name).toBe('Clarinet in B♭');
    expect(score.parts[0].transpose).toEqual({ diatonic: -1, chromatic: -2 });
  });

  it('leaves the clef and name alone for the concert-pitch entry', () => {
    const score = melody();
    applyInstrument(score.parts[0], concert);
    expect(score.parts[0].measures[0].staves[0].clef).toEqual({ sign: 'C', line: 3 });
    expect(score.parts[0].name).toBe('Viola');
    expect(score.parts[0].transpose).toBeUndefined();
  });

  it('does not touch the clefs of a grand staff', () => {
    const score = melody();
    applyInstrument(score.parts[1], instrumentById('flute'));
    expect(score.parts[1].measures[1].staves[0].clef).toEqual({ sign: 'G', line: 2 });
  });

  it('adds a key change and an octave shift together', () => {
    const score = melody();
    const iv = addIntervals(
      instrumentInterval(instrumentById('viola'), instrumentById('tuba')),
      { diatonic: -7, chromatic: -12 },
    );
    const out = transposeScore(score, (_p, i) => (i === 0 ? iv : { diatonic: 0, chromatic: 0 }));
    const note = out.parts[0].measures[0].staves[0].events[0];
    expect(note.kind === 'note' && note.pitch).toEqual({ step: 'F', alter: 0, octave: 3 });
  });
});

describe('key intervals', () => {
  it('spells a semitone between keys that share a letter', () => {
    // G major to G♭ major is a semitone, not a unison spanning eleven of them.
    expect(intervalBetweenKeys(1, -6, 'down')).toEqual({ diatonic: 0, chromatic: -1 });
    expect(intervalBetweenKeys(1, -6, 'up')).toEqual({ diatonic: 7, chromatic: 11 });
    expect(transposeKey(1, intervalBetweenKeys(1, -6, 'down'))).toBe(-6);
    expect(transposeKey(1, intervalBetweenKeys(1, -6, 'up'))).toBe(-6);
  });

  it('still spells ordinary transpositions the usual way', () => {
    expect(intervalBetweenKeys(0, 2, 'up')).toEqual({ diatonic: 1, chromatic: 2 }); // C -> D
    expect(intervalBetweenKeys(0, -1, 'up')).toEqual({ diatonic: 3, chromatic: 5 }); // C -> F
    expect(intervalBetweenKeys(0, -1, 'down')).toEqual({ diatonic: -4, chromatic: -7 });
  });
});

describe('multi-measure rests', () => {
  it('are expanded once the parts no longer share a key', () => {
    const score = melody();
    score.parts[0].measures[0].multiRest = 4;
    score.parts[1].measures[0].multiRest = 4;
    const iv = instrumentInterval(instrumentById('viola'), instrumentById('trumpet-bb'));
    const out = transposeScore(score, (_p, i) => (i === 0 ? iv : { diatonic: 0, chromatic: 0 }));
    expect(partsShareKey(out)).toBe(false);
    expect(expandMultiRests(out)).toBe(2);
    expect(out.parts[0].measures[0].multiRest).toBeUndefined();
  });

  it('are kept when every part stays in the same key', () => {
    const score = melody();
    score.parts[0].measures[0].multiRest = 4;
    expect(partsShareKey(score)).toBe(true);
  });
});
