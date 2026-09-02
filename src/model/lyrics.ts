import type { Event, Lyric, NoteEvent, Part } from './types';

/** A note the extender from an earlier syllable reaches. */
interface Continuation { event: NoteEvent; lyric?: Lyric }

/** The end of an extender line, on an event that carries no syllable of its own. */
function stopLyric(verse: number): Lyric {
  return { verse, text: '', syllabic: 'single', extend: 'stop' };
}

/**
 * Fix up a part's lyrics once all of its measures are known: a syllable that follows a hyphenated
 * one becomes 'middle' or 'end' depending on whether it is hyphenated itself, and melisma
 * extenders are resolved. Both need the events of a verse in playing order.
 *
 * Every extender is given an explicit end. Left open, an engraver runs the line on until the next
 * syllable turns up, which for a part that rests for a few bars means a line straight across the
 * page — so a melisma stopped by a rest ends on that rest.
 */
export function finalizeLyrics(part: Part): void {
  const prevHyphen = new Map<number, boolean>();
  /** Per verse: the syllable an extender began under, and the last event it has reached. */
  const open = new Map<number, { start: Lyric; covered?: Continuation }>();
  const drop: { event: NoteEvent; lyric: Lyric }[] = [];

  /** Extend a melisma to `event`; a continuation it passes is redundant once it does. */
  const cover = (cur: { covered?: Continuation }, event: NoteEvent, lyric?: Lyric): void => {
    const old = cur.covered;
    if (old?.lyric && old.lyric !== lyric) drop.push({ event: old.event, lyric: old.lyric });
    cur.covered = { event, lyric };
  };

  /** End the extender open on `verse`, on the last note it reached. */
  const close = (verse: number): void => {
    const cur = open.get(verse);
    if (!cur) return;
    open.delete(verse);
    cur.start.extend = 'start';
    // Having reached nothing means the next syllable follows straight away, which already bounds
    // the line without an end of its own.
    if (!cur.covered) return;
    if (cur.covered.lyric) { cur.covered.lyric.extend = 'stop'; return; }
    cur.covered.event.lyrics = [...(cur.covered.event.lyrics ?? []), stopLyric(verse)];
  };

  for (const measure of part.measures) {
    const events: Event[] = [];
    for (const st of measure.staves) for (const ev of st.events) events.push(ev);
    events.sort((a, b) => a.start - b.start);
    for (const ev of events) {
      if (ev.kind === 'rest') {
        // A rest ends any melisma running through it.
        for (const verse of [...open.keys()]) close(verse);
        continue;
      }
      if (!ev.lyrics?.length) {
        // A note with no syllable belongs to whatever melisma is running over it.
        for (const cur of open.values()) cover(cur, ev);
        continue;
      }
      for (const ly of ev.lyrics) {
        // A continuation carries no syllable, so it must not disturb the hyphen run either. It
        // only says how far the extender reaches.
        if (!ly.text) {
          const cur = open.get(ly.verse);
          if (!cur) { drop.push({ event: ev, lyric: ly }); continue; }
          cover(cur, ev, ly);
          continue;
        }
        const hy = (ly as Lyric & { hyphenAfter?: boolean }).hyphenAfter === true;
        const prev = prevHyphen.get(ly.verse) === true;
        if (prev && hy) ly.syllabic = 'middle';
        else if (prev && !hy) ly.syllabic = 'end';
        else if (!prev && hy) ly.syllabic = 'begin';
        else ly.syllabic = 'single';
        prevHyphen.set(ly.verse, hy);
        delete (ly as Lyric & { hyphenAfter?: boolean }).hyphenAfter;
        // A syllable of its own ends whatever extender was still running.
        close(ly.verse);
        if (ly.extend) open.set(ly.verse, { start: ly });
      }
    }
  }
  for (const verse of [...open.keys()]) close(verse);
  for (const { event, lyric } of drop) {
    event.lyrics = event.lyrics!.filter((l) => l !== lyric);
    if (!event.lyrics.length) delete event.lyrics;
  }
}
