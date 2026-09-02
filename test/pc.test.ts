import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parsePc } from '../src/pc/parsePc';
import { writeMusicXml } from '../src/musicxml/writeMusicXml';
import { finalizeLyrics } from '../src/model/lyrics';

const fixtures = join(__dirname, 'fixtures');
const outDir = process.env.TRANSPOSER_OUT ?? join(__dirname, '..', 'dist-test');
const extra = process.env.TRANSPOSER_EXTRA_PC ? readdirSync(process.env.TRANSPOSER_EXTRA_PC).filter((f) => f.endsWith('.pc')).map((f) => join(process.env.TRANSPOSER_EXTRA_PC!, f)) : [];
const files = [...readdirSync(fixtures).filter((f) => f.endsWith('.pc')).map((f) => join(fixtures, f)), ...extra];

describe('Personal Composer parser', () => {
  for (const file of files) {
    it(`parses ${file.split('/').pop()}`, () => {
      const data = readFileSync(file);
      const score = parsePc(new Uint8Array(data), file);
      for (const part of score.parts) finalizeLyrics(part);
      expect(score.parts.length).toBeGreaterThan(0);
      const notes = score.parts.reduce((n, p) => n + p.measures.reduce((m, ms) => m + ms.staves.reduce((s, st) => s + st.events.filter((e) => e.kind === 'note').length, 0), 0), 0);
      expect(notes).toBeGreaterThan(10);
      const xml = writeMusicXml(score);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, file.split('/').pop()!.replace(/\.pc$/, '.musicxml')), xml);
      const bad = score.warnings.filter((w) => /Failed|stopped|misaligned/i.test(w));
      expect(bad, bad.join('\n')).toEqual([]);
      console.log(`${file.split('/').pop()}: parts=${score.parts.map((p) => `${p.name}(${p.staffCount})`).join(', ')} measures=${score.parts[0].measures.length} notes=${notes} title=${score.title} warnings=${score.warnings.length}`);
    });
  }
});

/** Reads a fixture through the same path the app uses. */
function load(name: string) {
  const score = parsePc(new Uint8Array(readFileSync(join(fixtures, name))), name);
  for (const part of score.parts) finalizeLyrics(part);
  return { score, xml: writeMusicXml(score) };
}

describe('headings kept in the music', () => {
  // This file has no text in its PAGE block: the title and subtitle sit on the first system
  // instead, well above the staff, alongside directions that belong to the staff itself.
  const satb = '3b-satb-be-still-my-soul-vocal-parts.pc';

  it('takes the title and subtitle from the first system when the page block has none', () => {
    const { score } = load(satb);
    expect(score.title).toBe('Be Still, My Soul');
    expect(score.subtitle).toBe('SATB (voice parts only)');
  });

  it('does not also print a heading as a staff direction', () => {
    const { xml } = load(satb);
    const directions = [...xml.matchAll(/<words[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(directions).not.toContain('SATB (voice parts only)');
    expect(directions).not.toContain('Be Still, My Soul');
  });

  it('keeps directions that really do belong to a staff', () => {
    const { xml } = load(satb);
    const directions = [...xml.matchAll(/<words[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(directions).toContain('Tenor/Bass unis.');
    expect(directions).toContain('Soprano/Alto unis.');
  });

  it('still prefers the page block where a file has one', () => {
    const { score } = load('1b-solo-be-still-my-soul-viola.pc');
    expect(score.title).toBe('Be Still, My Soul');
    expect(score.subtitle).toBe('Viola (use with Solo)');
  });
});

describe('melisma extenders', () => {
  const satb = '3b-satb-be-still-my-soul-vocal-parts.pc';

  it('ends the extender on the last note it reaches instead of starting a second one', () => {
    const { xml } = load(satb);
    expect((xml.match(/<extend type="start"\/>/g) ?? []).length).toBeGreaterThan(0);
    expect((xml.match(/<extend type="stop"\/>/g) ?? []).length).toBeGreaterThan(0);
  });

  it('gives every extender an end, so no line runs on across the page', () => {
    const { xml } = load(satb);
    const starts = (xml.match(/<extend type="start"\/>/g) ?? []).length;
    const stops = (xml.match(/<extend type="stop"\/>/g) ?? []).length;
    expect(starts).toBeGreaterThan(0);
    expect(stops).toBe(starts);
  });

  it('ends a melisma on the last note it covers, before the part rests', () => {
    // The syllable in m71 is followed by a note with no syllable and then a rest. Left open, the
    // extender ran on until the next syllable two systems later, drawing a line across the page.
    const { score } = load(satb);
    const events = score.parts[0].measures[70].staves
      .flatMap((st) => st.events).sort((a, b) => a.start - b.start);
    const start = events.findIndex((e) => e.kind === 'note' && e.lyrics?.some((l) => l.extend === 'start'));
    expect(start, 'expected an extender to start in m71').toBeGreaterThanOrEqual(0);
    const stop = events.findIndex((e) => e.kind === 'note' && e.lyrics?.some((l) => l.extend === 'stop'));
    expect(stop, 'it should end in the same bar, before the rest').toBeGreaterThan(start);
  });

  it('never writes a syllable with no text', () => {
    const { xml } = load(satb);
    expect(xml).not.toContain('<text></text>');
  });

  it('gives a continuation note the extender end and nothing else', () => {
    const { xml } = load(satb);
    for (const lyric of xml.match(/<lyric[^>]*>.*?<\/lyric>/g) ?? []) {
      if (!lyric.includes('<extend type="stop"/>')) continue;
      expect(lyric).not.toContain('<text>');
      expect(lyric).not.toContain('<syllabic>');
    }
  });

  it('leaves a note carrying a real syllable alone', () => {
    const { score } = load(satb);
    const lyrics = score.parts.flatMap((p) =>
      p.measures.flatMap((m) => m.staves.flatMap((st) =>
        st.events.flatMap((e) => (e.kind === 'note' && e.lyrics ? e.lyrics : [])))));
    expect(lyrics.length).toBeGreaterThan(50);
    for (const ly of lyrics) {
      if (ly.extend === 'stop') expect(ly.text).toBe('');
      else expect(ly.text).not.toBe('');
    }
  });
});
