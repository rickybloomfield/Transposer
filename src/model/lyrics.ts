import type { Lyric, NoteEvent, Part } from './types';

/**
 * Fix up syllabic types across a part: a syllable that follows a hyphenated one becomes
 * 'middle' or 'end' depending on whether it is hyphenated itself.
 */
export function finalizeLyrics(part: Part): void {
  const prevHyphen = new Map<number, boolean>();
  for (const measure of part.measures) {
    const notes: NoteEvent[] = [];
    for (const st of measure.staves) for (const ev of st.events) if (ev.kind === 'note' && ev.lyrics) notes.push(ev);
    notes.sort((a, b) => a.start - b.start);
    for (const n of notes) {
      for (const ly of n.lyrics!) {
        const hy = (ly as Lyric & { hyphenAfter?: boolean }).hyphenAfter === true;
        const prev = prevHyphen.get(ly.verse) === true;
        if (prev && hy) ly.syllabic = 'middle';
        else if (prev && !hy) ly.syllabic = 'end';
        else if (!prev && hy) ly.syllabic = 'begin';
        else ly.syllabic = 'single';
        prevHyphen.set(ly.verse, hy);
        delete (ly as Lyric & { hyphenAfter?: boolean }).hyphenAfter;
      }
    }
  }
}
