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
