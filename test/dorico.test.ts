import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDorico } from '../src/dorico/parseDorico';
import { writeMusicXml } from '../src/musicxml/writeMusicXml';

const fixtures = join(__dirname, 'fixtures');
const outDir = process.env.TRANSPOSER_OUT ?? join(__dirname, '..', 'dist-test');
const extra = process.env.TRANSPOSER_EXTRA_DORICO ? readdirSync(process.env.TRANSPOSER_EXTRA_DORICO).filter((f) => f.endsWith('.dorico')).map((f) => join(process.env.TRANSPOSER_EXTRA_DORICO!, f)) : [];
const files = [...readdirSync(fixtures).filter((f) => f.endsWith('.dorico')).map((f) => join(fixtures, f)), ...extra];

describe('Dorico parser', () => {
  for (const file of files) {
    it(`parses ${file.split('/').pop()}`, async () => {
      const score = await parseDorico(new Uint8Array(readFileSync(file)), file);
      expect(score.parts.length).toBeGreaterThan(0);
      const notes = score.parts.reduce((n, p) => n + p.measures.reduce((m, ms) => m + ms.staves.reduce((s, st) => s + st.events.filter((e) => e.kind === 'note').length, 0), 0), 0);
      expect(notes).toBeGreaterThan(10);
      const xml = writeMusicXml(score);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, file.split('/').pop()!.replace(/\.dorico$/, '.musicxml')), xml);
      console.log(`${file.split('/').pop()}: parts=${score.parts.map((p) => `${p.name}(${p.staffCount})`).join(', ')} measures=${score.parts[0].measures.length} notes=${notes} title=${score.title} warnings=${score.warnings.slice(0, 3).join(' | ')}`);
    });
  }
});
