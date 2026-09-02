/**
 * Parser for Personal Composer for Windows (.pc) files, version 3 (format byte 0x29).
 *
 * The format was reverse engineered from sample files; see docs/pc-format.md for the
 * layout notes.  In short: a fixed header (fonts, staff records), a STIK section with one
 * record per displayed measure (widths, numbering, multi-rest counts, barlines), a MUSE
 * section with one block per (staff, measure) in staff-major order, and a PAGE section
 * with page setup and title texts.
 */
import { Reader, hex } from './binary';
import type {
  Articulation, Clef, DynamicMark, Event, Lyric, Measure, NoteEvent, NoteType, Part,
  Score, StaffMeasure, Step, TimeSignature,
} from '../model/types';
import { DIVISIONS } from '../model/types';
import { STEPS, dottedDuration, fromDiatonicIndex, keyAlterations, diatonicIndex } from '../model/pitch';

const MAGIC = 'PersonalComposerForWindows';

const DUR_CODES: Record<number, NoteType> = {
  0x0d: 'breve', 0x0c: 'whole', 0x0b: 'half', 0x0a: 'quarter', 0x09: 'eighth',
  0x08: '16th', 0x07: '32nd', 0x06: '64th', 0x05: '128th',
};
const DEN_CODES: Record<number, number> = { 0x0c: 1, 0x0b: 2, 0x0a: 4, 0x09: 8, 0x08: 16, 0x07: 32 };

/** Clef code (low nibble of the block header) -> clef and the diatonic index of the bottom staff line. */
const CLEFS: Record<number, { clef: Clef; bottom: number }> = {
  0x0: { clef: { sign: 'G', line: 2 }, bottom: diatonicIndex('E', 4) },
  0x1: { clef: { sign: 'C', line: 4 }, bottom: diatonicIndex('D', 3) },
  0x2: { clef: { sign: 'C', line: 3 }, bottom: diatonicIndex('F', 3) },
  0x3: { clef: { sign: 'F', line: 4 }, bottom: diatonicIndex('G', 2) },
  0xf: { clef: { sign: 'percussion', line: 2 }, bottom: diatonicIndex('E', 4) },
};

const DYNAMIC_GLYPHS: Record<number, DynamicMark> = {
  0x9e: 'pppp', 0x9f: 'ppp', 0xa0: 'pp', 0xa1: 'p', 0xa2: 'mp',
  0xac: 'mf', 0xab: 'f', 0xaa: 'ff', 0xa9: 'fff', 0xa8: 'ffff', 0xb8: 'sfz', 0xa5: 'fp',
};

const SYMBOL_GLYPHS: Record<number, Articulation> = {
  0x9d: 'down-bow', 0x9c: 'up-bow', 0xd8: 'fermata', 0xd9: 'fermata',
};
/** Music-font glyphs that map to MusicXML direction signs. */
const SIGN_GLYPHS: Record<number, 'segno' | 'coda'> = { 0x85: 'segno', 0xe2: 'coda', 0xe3: 'coda' };

// Item / sub-record types
const T_SLUR = 0x04, T_TIE = 0x05, T_HAIRPIN = 0x07, T_LINE = 0x08, T_ITEM0E = 0x0e, T_TEXT = 0x12, T_DYNAMIC = 0x15,
  T_SYMBOL16 = 0x16, T_TEMPO = 0x18, T_SYMBOL = 0x1a, T_ENDING = 0x30, T_LINE31 = 0x31, T_LYRIC = 0x32, T_TUPLET = 0x33;

/** Size of the payload following the 4-byte item header, for fixed-size items. */
const FIXED_ITEM_TAIL: Record<number, number> = { [T_SLUR]: 36, [T_TIE]: 8, [T_HAIRPIN]: 36, [T_LINE]: 14, [T_ITEM0E]: 22 };
/** Size of the payload following the 26-byte "text-like" header. */
const TEXTLIKE_TAIL: Record<number, number> = { [T_DYNAMIC]: 10, [T_SYMBOL16]: 10, [T_TEMPO]: 10, [T_SYMBOL]: 10, [T_TUPLET]: 40 };
/** Text-like items that carry a string followed by a fixed geometry block. */
const TEXT_GEOMETRY_TAIL: Record<number, number> = { [T_ENDING]: 28, [T_LINE31]: 20 };

interface RawItem {
  type: number;
  sub: number;
  x: number;
  y: number;
  font: number;
  charcode: number;
  text?: string;
  /** For fixed items: the payload; for text-like: the tail after the 26-byte header */
  payload: Uint8Array;
  /** Hex key used to pair slurs at both ends */
  key: string;
}

interface RawNote {
  flag: number;
  b1: number;
  b2: number;
  pos: number;
  y: number;
  /** start in 16th notes (may be fractional for tuplets) */
  t: number;
  dur: number;
  beamPrev: number;
  beamNext: number;
  accidental?: 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'flat-flat';
  hidden: boolean;
  subs: RawItem[];
}

interface RawRest {
  t: number;
  dur: number;
  dots: number;
  pos: number;
}

interface RawLayer { notes: RawNote[]; rests: RawRest[] }

interface RawBlock {
  offset: number;
  x: number;
  keyFifths: number;
  clefCode: number;
  flags: number;
  timeNum: number;
  timeDenCode: number;
  items: RawItem[];
  /** [voice][layer] */
  layers: RawLayer[][];
}

interface StikRecord {
  width: number;
  flags: number;
  multiRest: number;
  number: number;
  barline: number;
}

interface PageText { text: string; size: number; font: number; y: number; x: number }

export class PcFormatError extends Error {}

export function parsePc(input: ArrayBuffer | Uint8Array, fileName?: string): Score {
  const r = new Reader(input);
  const warnings: string[] = [];
  if (r.length < 0x200 || r.latin1(0, MAGIC.length) !== MAGIC) {
    throw new PcFormatError('Not a Personal Composer file (missing PersonalComposerForWindows signature).');
  }
  const version = r.u8(0x1b);
  if (version !== 0x29) {
    warnings.push(`File format version 0x${version.toString(16)} differs from the tested version 0x29; results may be incomplete.`);
  }
  const stikAt = r.find('STIK', 0x180);
  const museAt = stikAt >= 0 ? r.find('MUSE', stikAt) : -1;
  if (stikAt < 0 || museAt < 0) throw new PcFormatError('Could not find the STIK/MUSE sections in this file.');

  const stik = parseStik(r, stikAt, museAt);
  const blocks: RawBlock[] = [];
  let p = museAt + 4;
  while (p + 8 <= r.length) {
    if (r.latin1(p, 4) === 'PAGE') break;
    const den = r.u8(p + 6);
    const num = r.u8(p + 5);
    if (!(den in DEN_CODES) || num === 0 || num > 32) {
      warnings.push(`Unexpected data at offset 0x${p.toString(16)} after ${blocks.length} measure blocks; stopped reading music.`);
      break;
    }
    try {
      const blk = parseBlock(r, p, version, warnings);
      blocks.push(blk.block);
      p = blk.end;
    } catch (e) {
      warnings.push(`Failed to read measure block ${blocks.length} at 0x${p.toString(16)}: ${(e as Error).message}`);
      break;
    }
  }
  const pageAt = r.find('PAGE', p);
  const pageTexts = pageAt >= 0 ? parsePageTexts(r, pageAt) : [];

  const measureCount = stik.length;
  if (measureCount === 0) throw new PcFormatError('No measures found in this file.');
  let staffCount = Math.floor(blocks.length / measureCount);
  if (staffCount < 1) staffCount = 1;
  if (blocks.length % measureCount !== 0) {
    warnings.push(`Measure blocks (${blocks.length}) are not a multiple of the measure count (${measureCount}); some music may be missing.`);
  }

  const score = buildScore(blocks, stik, staffCount, measureCount, pageTexts, warnings);
  score.source = { format: 'pc', fileName };
  return score;
}

// ---------------------------------------------------------------------------------------------
// Low-level section parsers

function parseStik(r: Reader, stikAt: number, museAt: number): StikRecord[] {
  const recs: StikRecord[] = [];
  let p = stikAt + 8; // tag + u32 count (unreliable)
  while (p + 28 <= museAt) {
    if (r.u8(p) !== 0) break;
    const width = r.u16(p + 2);
    const nExtra = r.u8(p + 4);
    const flags = r.u16(p + 10);
    const multiRest = r.u8(p + 12);
    const number = r.u16(p + 22);
    // Layout entries form a chain (the record's last 8 bytes plus each 8-byte extra); the
    // barline code lives in byte 6 of the final entry.
    const lastEntry = nExtra > 0 ? p + 28 + 8 * (nExtra - 1) : p + 20;
    const barline = r.u8(lastEntry + 6);
    recs.push({ width, flags, multiRest, number, barline });
    p += 28 + 8 * nExtra;
    if (width === 0 && nExtra === 0 && recs.length > 1) { recs.pop(); break; }
  }
  return recs;
}

function readTextLike(r: Reader, p: number, type: number, version: number): { item: RawItem; end: number } {
  const sub = r.u8(p + 1);
  const x = r.i16(p + 6);
  const y = r.i16(p + 8);
  const font = r.u16(p + 10);
  const charcode = r.u16(p + 24);
  let q = p + 26;
  let text: string | undefined;
  let payload: Uint8Array;
  if (type === T_TEXT || type === T_LYRIC || type in TEXT_GEOMETRY_TAIL) {
    // Symbol-only text items (a music-font glyph such as a fermata or segno) carry no string.
    // They are recognised by the music-font marker in the style word at offset 14.
    const musicFont = (r.u16(p + 14) & 0xff00) === 0x0200;
    const hasString = type !== T_TEXT || !musicFont || version < 0x29;
    void font;
    if (hasString) {
      const len = r.u16(q);
      if (len > 1000) throw new Error(`implausible text length ${len} at 0x${q.toString(16)}`);
      text = r.latin1(q + 2, len);
      q += 2 + len;
    }
    payload = r.slice(p + 4, p + 26);
    if (type === T_ENDING) {
      // Variable geometry terminated by 0b 00 01 00 <n> 00 00 00 00 00.
      let end = -1;
      for (let i = q; i + 12 <= r.length && i < q + 48; i++) {
        if (r.u8(i) === 0x0b && r.u8(i + 1) === 0 && r.u8(i + 2) === 1 && r.u8(i + 3) === 0 && r.u8(i + 4) >= 1 && r.u8(i + 4) <= 9 && r.u8(i + 5) === 0 && r.u32(i + 6) === 0) { end = i + 10; break; }
      }
      if (end < 0) throw new Error(`could not find the end of an ending bracket at 0x${q.toString(16)}`);
      payload = r.slice(q, end);
      q = end;
    } else if (type in TEXT_GEOMETRY_TAIL) {
      payload = r.slice(q, q + TEXT_GEOMETRY_TAIL[type]);
      q += TEXT_GEOMETRY_TAIL[type];
    }
  } else {
    const tail = TEXTLIKE_TAIL[type];
    payload = r.slice(q, q + tail);
    q += tail;
  }
  return { item: { type, sub, x, y, font, charcode, text, payload, key: hex(payload) }, end: q };
}

function readItem(r: Reader, p: number, version: number): { item: RawItem; end: number } | null {
  const type = r.u8(p);
  if (type in FIXED_ITEM_TAIL) {
    const tail = FIXED_ITEM_TAIL[type];
    const payload = r.slice(p + 4, p + 4 + tail);
    return {
      item: { type, sub: r.u8(p + 1), x: r.i16(p + 4), y: r.i16(p + 6), font: 0, charcode: 0, payload, key: hex(payload) },
      end: p + 4 + tail,
    };
  }
  if (type in TEXTLIKE_TAIL || type in TEXT_GEOMETRY_TAIL || type === T_TEXT || type === T_LYRIC) return readTextLike(r, p, type, version);
  return null;
}

function isItemType(t: number): boolean {
  return t in FIXED_ITEM_TAIL || t in TEXTLIKE_TAIL || t in TEXT_GEOMETRY_TAIL || t === T_TEXT || t === T_LYRIC;
}

function parseBlock(r: Reader, start: number, version: number, warnings: string[]): { block: RawBlock; end: number } {
  let p = start;
  const x = r.u32(p);
  const flags = r.u8(p + 4);
  const timeNum = r.u8(p + 5);
  const timeDenCode = r.u8(p + 6);
  p += 8;
  const nItems = r.u16(p); p += 2;
  const items: RawItem[] = [];
  for (let i = 0; i < nItems; i++) {
    const it = readItem(r, p, version);
    if (!it) throw new Error(`unknown item type 0x${r.u8(p).toString(16)} at 0x${p.toString(16)}`);
    items.push(it.item);
    p = it.end;
  }
  const layers: RawLayer[][] = [];
  for (let voice = 0; voice < 2; voice++) {
    const vl: RawLayer[] = [];
    for (let layer = 0; layer < 2; layer++) {
      const notes: RawNote[] = [];
      const nNotes = r.u16(p); p += 2;
      if (nNotes > 500) throw new Error(`implausible note count ${nNotes} at 0x${p.toString(16)}`);
      for (let i = 0; i < nNotes; i++) {
        const flag = r.u8(p);
        if ((flag & 0x40) === 0 && !(flag === 0 && (r.u8(p + 1) & 0x40))) {
          throw new Error(`misaligned note record at 0x${p.toString(16)}: ${hex(r.slice(p, p + 16))}`);
        }
        const note: RawNote = {
          flag, b1: r.u8(p + 1), b2: r.u8(p + 2), pos: r.i8(p + 5), y: r.i16(p + 12),
          t: r.u8(p + 17) + r.u8(p + 16) / 256, dur: r.u8(p + 18),
          beamPrev: r.u16(p + 24), beamNext: r.u16(p + 26), hidden: flag === 0, subs: [],
        };
        p += 28;
        if (flag & 0x02) {
          const a = r.u8(p);
          const b = r.u8(p + 1);
          note.accidental = decodeAccidental(a, b);
          if (!note.accidental) warnings.push(`Unknown accidental code ${a.toString(16)} ${b.toString(16)} at 0x${p.toString(16)}`);
          p += 2;
        }
        while (p + 2 <= r.length && isItemType(r.u8(p)) && r.u8(p + 1) === 0x03) {
          const it = readItem(r, p, version)!;
          note.subs.push(it.item);
          p = it.end;
        }
        notes.push(note);
      }
      const rests: RawRest[] = [];
      const nRests = r.u16(p); p += 2;
      if (nRests > 200) throw new Error(`implausible rest count ${nRests} at 0x${p.toString(16)}`);
      for (let i = 0; i < nRests; i++) {
        rests.push({ t: r.u8(p + 1), dots: r.u8(p + 2) & 1, dur: r.u8(p + 3), pos: r.i8(p + 5) });
        p += 10;
      }
      vl.push({ notes, rests });
    }
    layers.push(vl);
  }
  const block: RawBlock = {
    offset: start, x, keyFifths: ((x >> 4) & 0xf) - 7, clefCode: x & 0xf, flags, timeNum, timeDenCode, items, layers,
  };
  return { block, end: p };
}

function decodeAccidental(a: number, b: number): RawNote['accidental'] {
  switch (a) {
    case 0x98: return 'sharp';
    case 0xa0: return 'flat';
    case 0xe8: return 'natural';
  }
  // Fall back on the second byte, which follows the same ordering in older files
  switch (b) {
    case 0x01: return 'flat';
    case 0x02: return 'natural';
    case 0x03: return 'sharp';
    case 0x04: return 'double-sharp';
    case 0x05: return 'flat-flat';
  }
  return undefined;
}

function parsePageTexts(r: Reader, pageAt: number): PageText[] {
  const texts: PageText[] = [];
  const end = Math.min(r.length, r.find('QFEX', pageAt) >= 0 ? r.find('QFEX', pageAt) : r.length);
  for (let p = pageAt + 4; p + 28 < end; p++) {
    if (r.u8(p) !== T_TEXT || r.u8(p + 1) > 3 || r.u8(p + 2) > 0x7f) continue;
    const len = r.u16(p + 26);
    if (len === 0 || len > 200 || p + 28 + len > end) continue;
    const s = r.latin1(p + 28, len);
    if (!/^[\x20-\x7e\xa0-\xff]+$/.test(s)) continue;
    texts.push({ text: s, size: r.u16(p + 12), font: r.u16(p + 10), y: r.i16(p + 8), x: r.i16(p + 6) });
    p += 27 + len;
  }
  return texts;
}

// ---------------------------------------------------------------------------------------------
// Model construction

interface StaffInfo {
  index: number;
  clefCode: number;
  hasLyrics: boolean;
  noteCount: number;
}

function buildScore(blocks: RawBlock[], stik: StikRecord[], staffCount: number, measureCount: number,
  pageTexts: PageText[], warnings: string[]): Score {
  const staffInfos: StaffInfo[] = [];
  for (let s = 0; s < staffCount; s++) {
    let hasLyrics = false, noteCount = 0;
    for (let m = 0; m < measureCount; m++) {
      const b = blocks[s * measureCount + m];
      if (!b) continue;
      for (const v of b.layers) for (const l of v) for (const n of l.notes) {
        noteCount++;
        if (n.subs.some((it) => it.type === T_LYRIC)) hasLyrics = true;
      }
    }
    staffInfos.push({ index: s, clefCode: blocks[s * measureCount]?.clefCode ?? 0, hasLyrics, noteCount });
  }

  const meta = extractMetadata(pageTexts);
  const groups = groupStaves(staffInfos, meta.subtitle);
  const score: Score = {
    title: meta.title, subtitle: meta.subtitle, composer: meta.composer, lyricist: meta.lyricist,
    arranger: meta.arranger, parts: [], warnings, source: { format: 'pc' },
  };

  for (let g = 0; g < groups.length; g++) {
    const grp = groups[g];
    const part: Part = { id: `P${g + 1}`, name: grp.name, staffCount: grp.staves.length, measures: [], grandStaff: grp.staves.length > 1 };
    const ctx = new PartContext(grp.staves.length);
    for (const t of [meta.title, meta.subtitle]) if (t) ctx.titleTexts.add(t.toLowerCase());
    let displayNumber = firstMeasureNumber(stik);
    for (let m = 0; m < measureCount; m++) {
      const rec = stik[m];
      const staffBlocks = grp.staves.map((s) => blocks[s * measureCount + m]);
      const measure = buildMeasure(staffBlocks, rec, m, displayNumber, ctx, warnings);
      part.measures.push(measure);
      displayNumber++;
      // Expand multi-measure rests into real measures so numbering stays aligned with the score.
      if (rec.multiRest > 0) {
        measure.multiRest = rec.multiRest + 1;
        for (let k = 0; k < rec.multiRest; k++) {
          part.measures.push(emptyMeasure(measure, displayNumber));
          displayNumber++;
        }
      }
    }
    ctx.finish(part, warnings);
    score.parts.push(part);
    applyCredits(score, ctx.credits);
  }
  return score;
}

function firstMeasureNumber(stik: StikRecord[]): number {
  const n = stik[0]?.number ?? 1;
  return n === 0 ? 0 : 1;
}

interface StaffGroup { name: string; staves: number[] }

function groupStaves(infos: StaffInfo[], subtitle?: string): StaffGroup[] {
  const groups: StaffGroup[] = [];
  const n = infos.length;
  let pianoStart = -1;
  if (n >= 2) {
    const a = infos[n - 2], b = infos[n - 1];
    const trebleish = (c: number) => c === 0 || c === 2 || c === 1;
    if (trebleish(a.clefCode) && b.clefCode === 3 && !a.hasLyrics && !b.hasLyrics) pianoStart = n - 2;
  }
  const instrumentHint = (subtitle ?? '').match(/\b(Viola|Violin|Flute|Cello|Oboe|Clarinet|Trumpet|Horn|Harp|Guitar|Organ|Piano|Bassoon|Saxophone|Recorder)\b/i)?.[1];
  let vocalCount = 0, instCount = 0;
  for (let s = 0; s < n; s++) {
    if (s === pianoStart) { groups.push({ name: 'Piano', staves: [s, s + 1] }); s++; continue; }
    const info = infos[s];
    let name: string;
    if (info.hasLyrics) { vocalCount++; name = n > 1 ? `Voice${vocalCount > 1 ? ' ' + vocalCount : ''}` : 'Voice'; }
    else if (info.clefCode === 2) name = 'Viola';
    else if (info.clefCode === 3 && n === 1) name = instrumentHint ?? 'Cello';
    else if (info.clefCode === 0xf) name = 'Percussion';
    else { instCount++; name = instrumentHint && instCount === 1 ? capitalize(instrumentHint) : (n === 1 ? 'Instrument' : `Instrument ${instCount}`); }
    groups.push({ name, staves: [s] });
  }
  return groups;
}

function applyCredits(score: Score, credits: string[]): void {
  for (const text of credits) {
    const m = text.match(/^([A-Za-z .©]+?)\s*:\s*(.+?);?\s*$/);
    if (!m) continue;
    const label = m[1].toLowerCase(), value = m[2].trim();
    if (/^(words|lyrics|text)/.test(label)) { if (!score.lyricist) score.lyricist = value; if (/music/.test(label) && !score.composer) score.composer = value; }
    else if (/^(music|composer|melody|tune)/.test(label)) { if (!score.composer) score.composer = value; }
    else if (/^(arr|arrangement)/.test(label)) { if (!score.arranger) score.arranger = value; }
    else if (/^(translation|translated)/.test(label)) { score.lyricist = score.lyricist ? `${score.lyricist}; trans. ${value}` : `trans. ${value}`; }
  }
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

function extractMetadata(texts: PageText[]): { title?: string; subtitle?: string; composer?: string; lyricist?: string; arranger?: string } {
  const out: { title?: string; subtitle?: string; composer?: string; lyricist?: string; arranger?: string } = {};
  const seen = new Set<string>();
  const uniq = texts.filter((t) => { const k = t.text; if (seen.has(k)) return false; seen.add(k); return true; });
  const credits = uniq.filter((t) => /%page/i.test(t.text) === false);
  for (const t of credits) {
    const m = t.text.match(/^(Words|Lyrics|Text)\s*(?:&|and)?\s*(?:Music)?\s*:\s*(.+?);?$/i);
    if (m) { if (/music/i.test(m[0])) out.composer = m[2].trim(); out.lyricist = m[2].trim(); continue; }
    const c = t.text.match(/^(Music|Composer|Melody)\s*:\s*(.+?);?$/i);
    if (c) { out.composer = c[2].trim(); continue; }
    const a = t.text.match(/^(Arrangement|Arranged by|Arr\.?)\s*:?\s*(.+?);?$/i);
    if (a) { out.arranger = a[2].trim(); continue; }
  }
  const candidates = credits.filter((t) => !/^(Words|Lyrics|Text|Music|Composer|Melody|Arrangement|Arranged|Arr\.|Translation|Copyright|©)/i.test(t.text));
  candidates.sort((a, b) => b.size - a.size);
  if (candidates.length) {
    out.title = candidates[0].text.trim();
    const sub = candidates.find((t) => t !== candidates[0] && t.size < candidates[0].size);
    if (sub) out.subtitle = sub.text.trim();
  }
  return out;
}

/** State carried across measures while building one part. */
class PartContext {
  /** Pending cross-measure slurs keyed by geometry, per staff */
  pendingSlurs: Map<string, { measureIndex: number; staff: number; event: NoteEvent; number: number }>[] = [];
  slurCounter = 0;
  wedgeCounter = 0;
  /** Alteration of the note that started a tie into the next measure, per staff, keyed by step+octave */
  tiedAlter: Map<string, number>[] = [];
  lastClef: (number | undefined)[] = [];
  endings: { number: number; startMeasure: number; endMeasure: number }[] = [];
  /** Free texts that look like credits (Words:, Music:, ...) */
  credits: string[] = [];
  /** Title/subtitle strings, so duplicates placed in the music are not shown twice */
  titleTexts = new Set<string>();
  lastKey: number | undefined;
  lastTime: string | undefined;
  pendingForwardRepeat = false;
  constructor(staves: number) {
    for (let i = 0; i < staves; i++) { this.pendingSlurs.push(new Map()); this.tiedAlter.push(new Map()); this.lastClef.push(undefined); }
  }
  finish(part: Part, warnings: string[]): void {
    for (const e of this.endings) {
      const startM = part.measures[e.startMeasure];
      const endM = part.measures[Math.min(e.endMeasure, part.measures.length - 1)];
      if (!startM || !endM) continue;
      startM.leftBarline = { ...(startM.leftBarline ?? {}), ending: { number: e.number, type: 'start' } };
      endM.rightBarline = { ...(endM.rightBarline ?? {}), ending: { number: e.number, type: e.number === 1 ? 'stop' : 'discontinue' } };
    }
    let dangling = 0;
    for (const m of this.pendingSlurs) dangling += m.size;
    if (dangling) warnings.push(`${dangling} slur(s) in ${part.name} had no matching end and were dropped.`);
    for (const m of this.pendingSlurs) {
      for (const p of m.values()) {
        p.event.slurStarts = p.event.slurStarts?.filter((n) => n !== p.number);
      }
    }
  }
}

function emptyMeasure(template: Measure, number: number): Measure {
  const staves: StaffMeasure[] = template.staves.map(() => ({ events: [], directions: [] }));
  for (const st of staves) st.events.push({ kind: 'rest', start: 0, duration: template.length, dots: 0, measure: true, voice: 1, staff: 1 });
  staves.forEach((st, i) => { for (const ev of st.events) ev.staff = i + 1; });
  return { number, staves, length: template.length };
}

function buildMeasure(staffBlocks: (RawBlock | undefined)[], rec: StikRecord, measureIndex: number, displayNumber: number,
  ctx: PartContext, warnings: string[]): Measure {
  const first = staffBlocks.find((b) => b) ;
  const timeNum = first?.timeNum ?? 4;
  const timeDen = DEN_CODES[first?.timeDenCode ?? 0x0a] ?? 4;
  const time: TimeSignature = { beats: timeNum, beatType: timeDen };
  const length = Math.round(timeNum * (4 / timeDen) * DIVISIONS);
  const measure: Measure = { number: displayNumber, staves: [], length };
  const timeKey = `${timeNum}/${timeDen}`;
  if (ctx.lastTime !== timeKey) { measure.time = time; ctx.lastTime = timeKey; }
  const key = first?.keyFifths ?? 0;
  if (ctx.lastKey !== key) { measure.key = key; ctx.lastKey = key; }
  // Barline codes: 1 double bar, 3 final, 5 forward repeat before the next measure, 6 backward repeat.
  if (rec.barline === 3) measure.rightBarline = { style: 'light-heavy' };
  else if (rec.barline === 1) measure.rightBarline = { style: 'light-light' };
  else if (rec.barline === 6) measure.rightBarline = { style: 'light-heavy', repeat: 'backward' };
  if (ctx.pendingForwardRepeat) { measure.leftBarline = { style: 'heavy-light', repeat: 'forward' }; ctx.pendingForwardRepeat = false; }
  if (rec.barline === 5) ctx.pendingForwardRepeat = true;

  for (let si = 0; si < staffBlocks.length; si++) {
    const blk = staffBlocks[si];
    const sm: StaffMeasure = { events: [], directions: [] };
    measure.staves.push(sm);
    if (!blk) {
      sm.events.push({ kind: 'rest', start: 0, duration: length, dots: 0, measure: true, voice: si * 4 + 1, staff: si + 1 });
      continue;
    }
    if (ctx.lastClef[si] !== blk.clefCode) {
      sm.clef = (CLEFS[blk.clefCode] ?? CLEFS[0]).clef;
      if (!(blk.clefCode in CLEFS)) warnings.push(`Unknown clef code ${blk.clefCode} in measure ${displayNumber}; using treble.`);
      ctx.lastClef[si] = blk.clefCode;
    }
    const bottom = (CLEFS[blk.clefCode] ?? CLEFS[0]).bottom;
    const keyAlt = keyAlterations(key);
    const accState = new Map<string, number>();
    const tied = ctx.tiedAlter[si];
    const newTied = new Map<string, number>();

    const layerEvents: Event[][] = [];
    let layerNo = 0;
    for (let v = 0; v < blk.layers.length; v++) {
      for (let l = 0; l < blk.layers[v].length; l++) {
        const layer = blk.layers[v][l];
        const voice = si * 4 + layerNo + 1;
        const events = convertLayer(layer, voice, si + 1, bottom, keyAlt, accState, tied, newTied, length, ctx, measureIndex, si, warnings);
        if (events.length) layerEvents.push(events);
        layerNo++;
      }
    }
    if (layerEvents.length === 0) {
      sm.events.push({ kind: 'rest', start: 0, duration: length, dots: 0, measure: true, voice: si * 4 + 1, staff: si + 1 });
    } else {
      const multiVoice = layerEvents.length > 1;
      for (const evs of layerEvents) {
        for (const ev of evs) {
          if (ev.kind === 'note' && !multiVoice) delete ev.stem;
          sm.events.push(ev);
        }
      }
    }
    ctx.tiedAlter[si] = newTied;

    // Measure-level items -> directions / slurs
    for (const item of blk.items) {
      applyMeasureItem(item, sm, si, length, ctx, measureIndex, warnings);
    }
  }
  return measure;
}

function convertLayer(layer: RawLayer, voice: number, staff: number, bottom: number, keyAlt: Record<Step, number>,
  accState: Map<string, number>, tied: Map<string, number>, newTied: Map<string, number>, measureLength: number,
  ctx: PartContext, measureIndex: number, staffIndex: number, warnings: string[]): Event[] {
  const events: Event[] = [];
  const notes = layer.notes.filter((n) => !n.hidden);
  // Chord grouping: notes at the same start time
  const byStart = new Map<number, RawNote[]>();
  for (const n of notes) {
    const k = Math.round(n.t * 256);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k)!.push(n);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const noteEvents: NoteEvent[] = [];
  const rawToEvent = new Map<RawNote, NoteEvent>();
  for (const k of starts) {
    const group = byStart.get(k)!;
    // Sort chord members bottom-up for MusicXML
    group.sort((a, b) => b.pos - a.pos);
    const start = Math.round((k / 256) * (DIVISIONS / 4));
    group.forEach((raw, gi) => {
      const type = DUR_CODES[raw.dur] ?? 'quarter';
      if (!(raw.dur in DUR_CODES)) warnings.push(`Unknown duration code 0x${raw.dur.toString(16)}; using a quarter note.`);
      const dots = raw.b2 & 0x01 ? 1 : 0;
      const idx = bottom - raw.pos;
      const { step, octave } = fromDiatonicIndex(idx);
      const pk = `${step}${octave}`;
      let alter: number;
      const tieStop = (raw.b2 & 0x10) !== 0;
      if (raw.accidental) {
        alter = accidentalAlter(raw.accidental);
        accState.set(pk, alter);
      } else if (tieStop && tied.has(pk)) {
        alter = tied.get(pk)!;
      } else if (accState.has(pk)) {
        alter = accState.get(pk)!;
      } else {
        alter = keyAlt[step];
      }
      const ev: NoteEvent = {
        kind: 'note', start, duration: dottedDuration(type, dots), type, dots,
        pitch: { step, alter, octave }, voice, staff,
        chord: gi > 0 || undefined,
        tieStart: (raw.b2 & 0x20) !== 0 || undefined,
        tieStop: tieStop || undefined,
        stem: raw.y < 0 ? 'up' : 'down',
      };
      if (raw.accidental) ev.accidental = raw.accidental;
      if (ev.tieStart) newTied.set(pk, alter);
      const arts: Articulation[] = [];
      if (raw.b2 & 0x80) arts.push('tenuto');
      for (const sub of raw.subs) {
        switch (sub.type) {
          case T_LYRIC: addLyric(ev, sub.text ?? ''); break;
          case T_SYMBOL: case T_TEMPO: case T_SYMBOL16: {
            const a = SYMBOL_GLYPHS[sub.charcode];
            if (a) arts.push(a);
            else if (sub.type === T_TEMPO && sub.charcode === 0xb0) noteWords(ev, 'rit.');
            break;
          }
          case T_TEXT: if (sub.text) noteWords(ev, sub.text); else if (SYMBOL_GLYPHS[sub.charcode]) arts.push(SYMBOL_GLYPHS[sub.charcode]); break;
          case T_SLUR: attachSlur(ev, sub, ctx, measureIndex, staffIndex, noteEvents); break;
          case T_TIE: case T_TUPLET: case T_HAIRPIN: case T_DYNAMIC: case T_LINE: break;
        }
      }
      if (arts.length) ev.articulations = arts;
      // Beams (only meaningful on the first chord note)
      if (gi === 0 && raw.dur <= 0x09) {
        if (!raw.beamPrev && raw.beamNext) ev.beam = 'begin';
        else if (raw.beamPrev && raw.beamNext) ev.beam = 'continue';
        else if (raw.beamPrev && !raw.beamNext) ev.beam = 'end';
      }
      noteEvents.push(ev);
      rawToEvent.set(raw, ev);
      events.push(ev);
    });
  }
  for (const rest of layer.rests) {
    const type = DUR_CODES[rest.dur] ?? 'quarter';
    const start = Math.round(rest.t * (DIVISIONS / 4));
    events.push({ kind: 'rest', start, duration: dottedDuration(type, rest.dots), type, dots: rest.dots, voice, staff });
  }
  events.sort((a, b) => a.start - b.start || ((a.kind === 'note' && a.chord) ? 1 : 0) - ((b.kind === 'note' && b.chord) ? 1 : 0));
  detectTuplets(events, measureLength);
  fixOverlaps(events, measureLength, warnings);
  return events;
}

function accidentalAlter(a: NonNullable<RawNote['accidental']>): number {
  switch (a) {
    case 'sharp': return 1;
    case 'flat': return -1;
    case 'double-sharp': return 2;
    case 'flat-flat': return -2;
    default: return 0;
  }
}

function noteWords(ev: NoteEvent, text: string): void {
  (ev as NoteEvent & { words?: string[] }).words = [...((ev as NoteEvent & { words?: string[] }).words ?? []), text];
}

function addLyric(ev: NoteEvent, raw: string): void {
  let text = raw;
  let extend = false;
  let hyphen = false;
  while (text.endsWith('_')) { text = text.slice(0, -1); extend = true; }
  if (text.endsWith('-')) { text = text.slice(0, -1); hyphen = true; }
  text = text.trim();
  ev.lyrics = ev.lyrics ?? [];
  const verse = ev.lyrics.length + 1;
  const lyric: Lyric = { verse, text, syllabic: hyphen ? 'begin' : 'single', extend: extend || undefined };
  (lyric as Lyric & { hyphenAfter?: boolean }).hyphenAfter = hyphen;
  ev.lyrics.push(lyric);
}

function attachSlur(ev: NoteEvent, sub: RawItem, ctx: PartContext, measureIndex: number, staffIndex: number, prior: NoteEvent[]): void {
  const pending = ctx.pendingSlurs[staffIndex];
  const existing = pending.get(sub.key);
  if (existing && existing.event !== ev) {
    ev.slurStops = [...(ev.slurStops ?? []), existing.number];
    pending.delete(sub.key);
    return;
  }
  void prior;
  const number = (ctx.slurCounter++ % 6) + 1;
  ev.slurStarts = [...(ev.slurStarts ?? []), number];
  pending.set(sub.key, { measureIndex, staff: staffIndex, event: ev, number });
}

function applyMeasureItem(item: RawItem, sm: StaffMeasure, staffIndex: number, length: number, ctx: PartContext,
  measureIndex: number, warnings: string[]): void {
  const notes = sm.events.filter((e): e is NoteEvent => e.kind === 'note');
  const firstNote = notes[0];
  const lastNote = notes[notes.length - 1];
  const place = item.y < 0 ? 'above' : 'below';
  switch (item.type) {
    case T_DYNAMIC: {
      const dyn = DYNAMIC_GLYPHS[item.charcode];
      if (dyn) sm.directions.push({ start: 0, placement: 'below', dynamic: dyn, staff: staffIndex + 1 });
      else warnings.push(`Unknown dynamic glyph 0x${item.charcode.toString(16)} in measure ${measureIndex + 1}.`);
      break;
    }
    case T_TEMPO: {
      if (item.charcode === 0xf0 || item.charcode === 0xf1 || item.charcode === 0xef) {
        const bpm = new DataView(item.payload.buffer, item.payload.byteOffset).getUint16(0, true);
        if (bpm > 0 && bpm < 400) sm.directions.push({ start: 0, placement: 'above', tempo: { bpm, beatUnit: item.charcode === 0xf1 ? 'eighth' : 'quarter' }, staff: staffIndex + 1 });
      } else if (item.charcode === 0xb0) {
        sm.directions.push({ start: 0, placement: 'above', words: 'rit.', style: 'bold-italic', staff: staffIndex + 1 });
      } else if (SYMBOL_GLYPHS[item.charcode] && firstNote) {
        firstNote.articulations = [...(firstNote.articulations ?? []), SYMBOL_GLYPHS[item.charcode]];
      }
      break;
    }
    case T_TEXT: {
      const sign = SIGN_GLYPHS[item.charcode];
      if (item.text && item.text.trim()) {
        const text = item.text.trim();
        const credit = text.match(/^(Words|Lyrics|Text|Music|Composer|Melody|Tune|Arrangement|Arranged by|Arr\.?|Translation|Translated by|Copyright|©)\b/i);
        if (credit) { ctx.credits.push(text); break; }
        const size = new DataView(item.payload.buffer, item.payload.byteOffset).getUint16(8, true);
        if (size >= 0x200 || ctx.titleTexts.has(text.toLowerCase())) { ctx.titleTexts.add(text.toLowerCase()); break; }
        const style = item.font === 0x1d ? 'bold-italic' : 'italic';
        sm.directions.push({ start: 0, placement: place, words: text, style, staff: staffIndex + 1, sign });
      } else if (sign) {
        sm.directions.push({ start: 0, placement: 'above', sign, staff: staffIndex + 1 });
      } else if (SYMBOL_GLYPHS[item.charcode] && lastNote) {
        lastNote.articulations = [...(lastNote.articulations ?? []), SYMBOL_GLYPHS[item.charcode]];
      } else if (item.charcode) {
        warnings.push(`Unknown music symbol 0x${item.charcode.toString(16)} in measure ${measureIndex + 1} was skipped.`);
      }
      break;
    }
    case T_HAIRPIN: {
      const dir = new DataView(item.payload.buffer, item.payload.byteOffset).getInt16(0, true) >= 0 ? 'crescendo' : 'diminuendo';
      const number = (ctx.wedgeCounter++ % 6) + 1;
      sm.directions.push({ start: 0, placement: 'below', wedge: { type: dir, number }, staff: staffIndex + 1 });
      sm.directions.push({ start: length, placement: 'below', wedge: { type: 'stop', number }, staff: staffIndex + 1 });
      break;
    }
    case T_SLUR: {
      // Cross-measure slur: matched by geometry with a later measure's item.
      const pending = ctx.pendingSlurs[staffIndex];
      const existing = pending.get(item.key);
      if (existing) {
        if (lastNote) lastNote.slurStops = [...(lastNote.slurStops ?? []), existing.number];
        pending.delete(item.key);
      } else if (firstNote) {
        const number = (ctx.slurCounter++ % 6) + 1;
        firstNote.slurStarts = [...(firstNote.slurStarts ?? []), number];
        pending.set(item.key, { measureIndex, staff: staffIndex, event: firstNote, number });
      }
      break;
    }
    case T_SYMBOL: case T_SYMBOL16: {
      const a = SYMBOL_GLYPHS[item.charcode];
      if (a && firstNote) firstNote.articulations = [...(firstNote.articulations ?? []), a];
      break;
    }
    case T_ENDING: {
      const fromText = parseInt((item.text ?? '').trim(), 10);
      const num = Number.isFinite(fromText) && fromText > 0 ? fromText : (item.charcode & 0xff) - 0x30;
      if (num >= 1 && num <= 9) {
        // The measure span is the small word that precedes the wide x coordinate in the geometry.
        const dv = new DataView(item.payload.buffer, item.payload.byteOffset);
        let span = 0;
        for (let i = 0; i + 4 <= item.payload.length - 12; i += 2) {
          const v = dv.getUint16(i, true), nx = dv.getUint16(i + 2, true);
          if (v >= 1 && v <= 16 && nx > 1024) { span = v; break; }
        }
        ctx.endings.push({ number: num, startMeasure: measureIndex, endMeasure: measureIndex + Math.min(span, 8) });
      }
      break;
    }
    default: break;
  }
}

/** Detect tuplet groups from fractional start positions and assign time modifications. */
function detectTuplets(events: Event[], measureLength: number): void {
  const grid = DIVISIONS / 4; // 16th note
  let i = 0;
  const heads = events.filter((e) => !(e.kind === 'note' && e.chord));
  while (i < heads.length) {
    const ev = heads[i];
    const next = heads[i + 1];
    const gap = (next ? next.start : measureLength) - ev.start;
    const nominal = ev.duration;
    if (ev.start % grid === 0 && gap > 0 && gap < nominal) {
      // candidate start of a tuplet group
      let j = i;
      let nominalSum = 0;
      let endReached = false;
      while (j < heads.length) {
        nominalSum += heads[j].duration;
        const after = heads[j + 1] ? heads[j + 1].start : measureLength;
        const span = after - ev.start;
        if (after % grid === 0 && span > 0 && nominalSum > span) {
          const g = gcd(nominalSum, span);
          const actual = nominalSum / g, normal = span / g;
          if (actual <= 15 && normal <= 15) {
            const unit = Math.min(...heads.slice(i, j + 1).map((h) => h.duration));
            const scale = unit / g;
            void scale;
            for (let k = i; k <= j; k++) {
              const h = heads[k];
              h.timeModification = { actual, normal };
              h.duration = Math.round(h.duration * normal / actual);
              if (k === i) h.tuplet = { actual, normal, start: true };
              if (k === j) h.tuplet = { ...(h.tuplet ?? { actual, normal }), stop: true };
              // chord members share the modification
              for (const c of events) if (c.kind === 'note' && c.chord && c.start === h.start) { c.timeModification = h.timeModification; c.duration = h.duration; }
            }
            endReached = true;
            i = j + 1;
          }
          break;
        }
        j++;
      }
      if (!endReached) i++;
    } else {
      i++;
    }
  }
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/** Make sure events in a voice do not overlap or exceed the measure; shorten where needed. */
function fixOverlaps(events: Event[], measureLength: number, warnings: string[]): void {
  const heads = events.filter((e) => !(e.kind === 'note' && e.chord));
  for (let i = 0; i < heads.length; i++) {
    const ev = heads[i];
    const limit = i + 1 < heads.length ? heads[i + 1].start : measureLength;
    if (ev.start + ev.duration > limit + 1) {
      const nd = limit - ev.start;
      if (nd > 0) {
        warnings.push(`Shortened an overlapping ${ev.kind} at measure position ${ev.start / DIVISIONS}.`);
        ev.duration = nd;
        for (const c of events) if (c.kind === 'note' && c.chord && c.start === ev.start) c.duration = nd;
      }
    }
  }
}

export const _internal = { STEPS, DUR_CODES };
