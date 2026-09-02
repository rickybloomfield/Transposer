import JSZip from 'jszip';
import type { Score } from './model/types';
import { parsePc } from './pc/parsePc';
import { finalizeLyrics } from './model/lyrics';

export type LoadedScore = { score: Score; musicXml?: string };

/** Detect the file type and produce a score model (or raw MusicXML for MusicXML inputs). */
export async function loadFile(file: File): Promise<LoadedScore> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = String.fromCharCode(...bytes.subarray(0, 16));
  if (name.endsWith('.pc') || magic.startsWith('PersonalComposer')) {
    const score = parsePc(bytes, file.name);
    for (const p of score.parts) finalizeLyrics(p);
    return { score };
  }
  if (name.endsWith('.dorico') || (bytes[0] === 0x50 && bytes[1] === 0x4b && name.endsWith('.dorico'))) {
    const { parseDorico } = await import('./dorico/parseDorico');
    const score = await parseDorico(bytes, file.name);
    for (const p of score.parts) finalizeLyrics(p);
    return { score };
  }
  void JSZip;
  throw new Error('Unsupported file type. Please choose a Personal Composer (.pc) or Dorico (.dorico) file.');
}
