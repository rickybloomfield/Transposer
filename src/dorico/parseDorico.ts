import JSZip from 'jszip';
import type {
  Articulation, Clef, Direction, DynamicMark, Event, Lyric, Measure, NoteEvent, NoteType, Part, Pitch,
  RestEvent, Score, StaffMeasure, Step, TimeSignature,
} from '../model/types';
import { DIVISIONS } from '../model/types';
import { STEPS, fromDiatonicIndex, keyAlterations, midiNumber } from '../model/pitch';
import { decodeDtn, list, obj, rational, str, type DtnObject, type DtnValue } from './dtn';

/** Parse a .dorico project (ZIP) into the score model. */
export async function parseDorico(bytes: Uint8Array, fileName?: string): Promise<Score> {
  const zip = await JSZip.loadAsync(bytes);
  let rootfile = 'score.dtn';
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const m = container?.match(/full-path="([^"]+)"/);
  if (m) rootfile = m[1];
  const entry = zip.file(rootfile) ?? zip.file('score.dtn');
  if (!entry) throw new Error('This does not look like a Dorico project (no score.dtn inside).');
  const data = await entry.async('uint8array');
  const { root } = decodeDtn(data);
  const score = buildScore(root);
  score.source = { format: 'dorico', fileName };
  return score;
}

// ---------------------------------------------------------------------------------------------

interface DNote { start: number; dur: number; midi: number; letter?: string; stemDir?: 'up' | 'down'; arts: Articulation[]; staveOverride?: string; id: string }
interface DLyricEvent { start: number; elementId: string }
interface DVoiceStream { id: string; staveId: string; direction: 'up' | 'down'; notes: DNote[]; lyrics: DLyricEvent[]; texts: { start: number; text: string; above: boolean }[] }
interface DStave { streamId: string; staveId: string; index: number; clefs: { pos: number; clef: Clef }[]; dynamics: DDynamic[]; texts: { start: number; text: string; above: boolean }[] }
interface DDynamic { pos: number; mark?: DynamicMark; wedge?: { type: 'crescendo' | 'diminuendo'; length: number } }
interface DBar { start: number; length: number; time: TimeSignature }

const DUR_TYPES: { d: number; type: NoteType; dots: number }[] = [
  { d: DIVISIONS * 8, type: 'breve', dots: 0 },
  { d: DIVISIONS * 6, type: 'whole', dots: 1 },
  { d: DIVISIONS * 4, type: 'whole', dots: 0 },
  { d: DIVISIONS * 3, type: 'half', dots: 1 },
  { d: DIVISIONS * 2, type: 'half', dots: 0 },
  { d: DIVISIONS * 1.5, type: 'quarter', dots: 1 },
  { d: DIVISIONS, type: 'quarter', dots: 0 },
  { d: DIVISIONS * 0.75, type: 'eighth', dots: 1 },
  { d: DIVISIONS / 2, type: 'eighth', dots: 0 },
  { d: DIVISIONS * 0.375, type: '16th', dots: 1 },
  { d: DIVISIONS / 4, type: '16th', dots: 0 },
  { d: DIVISIONS / 8, type: '32nd', dots: 0 },
  { d: DIVISIONS / 16, type: '64th', dots: 0 },
];
const TRIPLET_TYPES: { d: number; type: NoteType }[] = [
  { d: (DIVISIONS * 2 * 2) / 3, type: 'half' },
  { d: (DIVISIONS * 2) / 3, type: 'quarter' },
  { d: DIVISIONS / 3, type: 'eighth' },
  { d: DIVISIONS / 6, type: '16th' },
];

function buildScore(root: DtnObject): Score {
  const warnings: string[] = [];
  const info = obj(root.info) ?? {};
  const flows = list(root.flows);
  if (flows.length === 0) throw new Error('The Dorico project contains no music (no flows).');
  if (flows.length > 1) warnings.push(`The project has ${flows.length} flows; only the first one is used.`);
  const flow = obj(flows[0][1])!;
  const flowInfo = obj(flow.flowInfo) ?? {};
  const score: Score = {
    title: str(info.title) || str(flowInfo.title) || undefined,
    subtitle: str(info.subtitle) || str(flowInfo.subtitle) || undefined,
    composer: str(info.composer) || str(flowInfo.composer) || undefined,
    lyricist: str(info.lyricist) || str(flowInfo.lyricist) || undefined,
    arranger: str(info.arranger) || undefined,
    copyright: str(info.copyright) || undefined,
    parts: [], warnings, source: { format: 'dorico' },
  };

  // Element tables
  const tables = new Map<string, DtnObject[]>();
  for (const [name, tbl] of list(flow.elementTables)) tables.set(name, list(tbl).map(([, e]) => obj(e)!).filter(Boolean));
  const byId = (name: string): Map<string, DtnObject> => {
    const m = new Map<string, DtnObject>();
    for (const e of tables.get(name) ?? []) m.set(str(e.elementID), e);
    return m;
  };
  const barDivs = byId('BarDivisionElementTableDefinition');
  const tonalities = byId('TonalityDivisionElementTableDefinition');
  const lyricElems = byId('LyricElementTableDefinition');
  const dynElems = byId('DynamicGroupElementTableDefinition');

  // Blocks & streams
  const blocks = new Map<string, DtnObject>();
  for (const [, b] of list(flow.blocks)) { const o = obj(b); if (o) blocks.set(str(o.blockID), o); }
  const streamBlocks = new Map<string, DtnObject[]>();
  for (const [, bi] of list(flow.blockInstances)) {
    const o = obj(bi); if (!o) continue;
    const blk = blocks.get(str(o.blockID)); if (!blk) continue;
    const sid = str(o.streamID);
    if (!streamBlocks.has(sid)) streamBlocks.set(sid, []);
    streamBlocks.get(sid)!.push(blk);
  }
  const eventsOf = (streamId: string): [string, DtnObject][] => {
    const out: [string, DtnObject][] = [];
    for (const blk of streamBlocks.get(streamId) ?? []) for (const [kind, e] of list(blk.events)) { const o = obj(e); if (o) out.push([kind, o]); }
    return out;
  };
  const streamTypes = new Map<string, string>();
  for (const [, s] of list(flow.eventStreams)) { const o = obj(s); if (o) streamTypes.set(str(o.streamID), str(o.eventStreamType)); }
  const globalStream = [...streamTypes.entries()].find(([, t]) => t === 'kGlobalTimebaseStream')?.[0];

  // Global events: bars, keys, tempo, pauses
  const barEvents: { pos: number; elementId: string }[] = [];
  const keyEvents: { pos: number; fifths: number }[] = [];
  const tempoEvents: { pos: number; text?: string; bpm?: number; beatUnit?: NoteType }[] = [];
  const pauses: number[] = [];
  if (globalStream) {
    for (const [kind, e] of eventsOf(globalStream)) {
      const pos = rational(e.position);
      if (kind === 'BarDivisionEventDefinition') barEvents.push({ pos, elementId: str(e.barDivisionElementID) });
      else if (kind === 'TonalityDivisionEventDefinition') keyEvents.push({ pos, fifths: tonalityFifths(tonalities.get(str(e.tonalityDivisionElementID))) });
      else if (kind === 'GradualTempoChangeEventDefinition' || kind === 'ImmediateTempoChangeEventDefinition') {
        const data = obj(e.data) ?? {};
        const text = str(data.text) || undefined;
        const bpm = Number(str(data.beatsPerMinute) || str(data.bpm) || str(data.tempoValue)) || undefined;
        tempoEvents.push({ pos, text, bpm, beatUnit: 'quarter' });
      } else if (kind === 'PauseEventDefinition') pauses.push(pos);
    }
  }
  barEvents.sort((a, b) => a.pos - b.pos);
  keyEvents.sort((a, b) => a.pos - b.pos);

  // Players -> staves & voices
  const scorePlayers = new Map<string, DtnObject>();
  for (const [, p] of list(root.scorePlayers)) { const o = obj(p); if (o) scorePlayers.set(str(o.playerID), o); }
  const layout = list(root.layouts).map(([, l]) => obj(l)!).find((l) => str(l.layoutType) === 'kFullScoreLayout') ?? list(root.layouts).map(([, l]) => obj(l)!)[0];
  const orderStr = str(obj(layout?.layoutOptions)?.customPlayerOrder);
  const playerOrder = orderStr ? orderStr.split(',').map((s) => s.trim()) : [...scorePlayers.keys()];

  interface PlayerInfo { id: string; name: string; instrumentId: string; staves: DStave[]; voices: DVoiceStream[]; numStaves: number }
  const players: PlayerInfo[] = [];
  for (const [, fpV] of list(flow.flowPlayers)) {
    const fp = obj(fpV); if (!fp) continue;
    const pid = str(fp.playerID);
    const sp = scorePlayers.get(pid);
    const instruments = list(fp.flowPlayerInstruments).map(([, i]) => obj(i)!);
    for (const inst of instruments) {
      const spInst = list(sp?.instruments).map(([, i]) => obj(i)!).find((i) => str(i.instrumentID) === str(inst.instrumentID));
      const entity = str(spInst?.entityID);
      const staves: DStave[] = list(inst.staveStreamInfos).map(([, s], idx) => {
        const so = obj(s)!;
        return { streamId: str(so.staveStreamID), staveId: str(so.staveID), index: Number(str(so.nthStaveInInstrument)) || idx, clefs: [], dynamics: [], texts: [] };
      });
      staves.sort((a, b) => a.index - b.index);
      const voices: DVoiceStream[] = list(inst.voiceStreamInfos).map(([, v]) => {
        const vo = obj(v)!;
        return { id: str(vo.voiceStreamID), staveId: str(vo.defaultLogicalStaveID), direction: str(vo.voiceDirection) === 'kPreferStemsDown' ? 'down' : 'up', notes: [], lyrics: [], texts: [] };
      });
      players.push({ id: pid, name: str(sp?.displayName) || str(sp?.baseName) || 'Part', instrumentId: entity, staves, voices, numStaves: Math.max(staves.length, Number(str(spInst?.numStaves)) || 1) });
    }
  }
  players.sort((a, b) => {
    const ia = playerOrder.indexOf(a.id), ib = playerOrder.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  // Fill stave & voice events
  let maxEnd = 0;
  for (const p of players) {
    for (const st of p.staves) {
      for (const [kind, e] of eventsOf(st.streamId)) {
        const pos = rational(e.position);
        if (kind === 'ClefEventDefinition') {
          const id = str(obj(e.entityIDs)?.idForTransposingLayouts) || str(obj(e.entityIDs)?.idForConcertLayouts);
          st.clefs.push({ pos, clef: clefFromId(id) });
        } else if (kind === 'DynamicGroupEventDefinition') {
          st.dynamics.push(...dynamicsFromGroup(pos, dynElems.get(str(e.dynamicGroupID))));
        } else if (kind === 'TextEventDefinition') {
          const t = textOf(e); if (t) st.texts.push({ start: pos, text: t, above: str(e.aboveOrBelow) !== 'kBelow' });
        }
      }
    }
    for (const v of p.voices) {
      for (const [kind, e] of eventsOf(v.id)) {
        const pos = rational(e.position);
        if (kind === 'NoteEventDefinition') {
          const props = propsOf(e);
          const arts: Articulation[] = [];
          const artDur = props.get('kArticulationDuration');
          if (artDur?.includes('Tenuto')) arts.push('tenuto');
          if (artDur?.includes('Staccato')) arts.push('staccato');
          const artForce = props.get('kArticulationForce');
          if (artForce?.includes('Accent')) arts.push('accent');
          if (artForce?.includes('Marcato')) arts.push('marcato');
          const dir = props.get('kNoteForcedVoiceDirection');
          const dur = rational(e.duration);
          const note: DNote = {
            start: pos, dur, midi: Number(str(e.pitch)), letter: props.get('kNoteSpelling')?.match(/[A-G]/)?.[0], arts,
            stemDir: dir?.includes('Up') ? 'up' : dir?.includes('Down') ? 'down' : undefined,
            staveOverride: str(e.logicalStaveIDOverride) !== '-1' && str(e.logicalStaveIDOverride) ? str(e.logicalStaveIDOverride) : undefined,
            id: str(e.eventID),
          };
          v.notes.push(note);
          maxEnd = Math.max(maxEnd, pos + dur);
        } else if (kind === 'LyricEventDefinition') {
          v.lyrics.push({ start: pos, elementId: str(e.lyricElementID) });
        } else if (kind === 'TextEventDefinition') {
          const t = textOf(e); if (t) v.texts.push({ start: pos, text: t, above: str(e.aboveOrBelow) !== 'kBelow' });
        }
      }
      v.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    }
  }
  for (const b of barEvents) maxEnd = Math.max(maxEnd, b.pos);

  // Measures (positions in quarter notes)
  const bars: DBar[] = [];
  {
    let pos = 0;
    let time: TimeSignature = { beats: 4, beatType: 4 };
    let i = 0;
    if (barEvents.length && barEvents[0].pos === 0) { time = timeOf(barDivs.get(barEvents[0].elementId)) ?? time; i = 1; }
    const barLen = (t: TimeSignature): number => t.beats * (4 / t.beatType);
    while (pos < maxEnd - 1e-9 || bars.length === 0) {
      const next = barEvents[i];
      let len = barLen(time);
      if (next && next.pos - pos < len - 1e-9 && next.pos > pos) len = next.pos - pos; // short (pickup / irregular) bar
      bars.push({ start: pos, length: len, time });
      pos += len;
      if (next && Math.abs(next.pos - pos) < 1e-9) { time = timeOf(barDivs.get(next.elementId)) ?? time; i++; }
      if (bars.length > 5000) break;
    }
  }
  const barIndexAt = (pos: number): number => {
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].start <= pos + 1e-9) lo = mid; else hi = mid - 1; }
    return lo;
  };
  const q = (quarters: number): number => Math.round(quarters * DIVISIONS);

  // Build parts
  let partNo = 0;
  for (const p of players) {
    const hasNotes = p.voices.some((v) => v.notes.length > 0);
    if (!hasNotes) continue;
    partNo++;
    const staffCount = Math.max(1, p.numStaves);
    const hasLyrics = p.voices.some((v) => v.lyrics.length > 0);
    const name = hasLyrics && !/voice|sopran|alto|tenor|bass|choir|singer/i.test(p.name) ? 'Voice' : p.name;
    const part: Part = { id: `P${partNo}`, name, staffCount, measures: [], grandStaff: staffCount > 1 };
    const staveIndexById = new Map<string, number>();
    p.staves.forEach((s, i) => staveIndexById.set(s.staveId, i));
    // Per-measure containers
    const measures: Measure[] = bars.map((b, bi) => ({
      number: bi + 1, staves: Array.from({ length: staffCount }, () => ({ events: [], directions: [] })), length: q(b.length),
    }));
    // Time / key signatures
    let lastTime = '';
    let keyIdx = 0;
    let lastKey: number | undefined;
    bars.forEach((b, bi) => {
      const tk = `${b.time.beats}/${b.time.beatType}`;
      if (tk !== lastTime) { measures[bi].time = b.time; lastTime = tk; }
      while (keyIdx < keyEvents.length && keyEvents[keyIdx].pos <= b.start + 1e-9) { lastKey = keyEvents[keyIdx].fifths; keyIdx++; }
      if (lastKey !== undefined && (bi === 0 || (measures[bi - 1] as Measure & { _key?: number })._key !== lastKey)) measures[bi].key = lastKey;
      (measures[bi] as Measure & { _key?: number })._key = lastKey ?? 0;
    });
    // Clefs
    p.staves.forEach((st, si) => {
      if (si >= staffCount) return;
      const clefs = st.clefs.slice().sort((a, b) => a.pos - b.pos);
      if (!clefs.length || clefs[0].pos > 0) clefs.unshift({ pos: 0, clef: defaultClef(p.instrumentId, si, staffCount) });
      let last = '';
      for (const c of clefs) {
        const bi = barIndexAt(c.pos);
        const key = `${c.clef.sign}${c.clef.line}${c.clef.octaveChange ?? 0}`;
        if (key === last) continue;
        last = key;
        if (Math.abs(c.pos - bars[bi].start) > 1e-9) warnings.push(`A mid-measure clef change in measure ${bi + 1} was moved to the start of the measure.`);
        measures[bi].staves[si].clef = c.clef;
      }
      for (const d of st.dynamics) {
        const bi = barIndexAt(d.pos);
        const startDiv = q(d.pos - bars[bi].start);
        if (d.mark) measures[bi].staves[si].directions.push({ start: startDiv, placement: 'below', dynamic: d.mark, staff: si + 1 });
        if (d.wedge) {
          const number = 1 + (measures[bi].staves[si].directions.length % 6);
          measures[bi].staves[si].directions.push({ start: startDiv, placement: 'below', wedge: { type: d.wedge.type, number }, staff: si + 1 });
          const endPos = d.pos + d.wedge.length;
          const ebi = Math.min(barIndexAt(endPos), measures.length - 1);
          measures[ebi].staves[si].directions.push({ start: q(endPos - bars[ebi].start), placement: 'below', wedge: { type: 'stop', number }, staff: si + 1 });
        }
      }
      for (const t of st.texts) {
        const bi = barIndexAt(t.start);
        measures[bi].staves[si].directions.push({ start: q(t.start - bars[bi].start), placement: t.above ? 'above' : 'below', words: t.text, style: 'italic', staff: si + 1 });
      }
    });
    // Voices
    p.voices.forEach((v, vi) => {
      const si = Math.min(staveIndexById.get(v.staveId) ?? 0, staffCount - 1);
      const voiceNo = si * 4 + (vi % 4) + 1;
      const key = keyForVoice(measures);
      const chunksByStart = new Map<number, NoteEvent[]>();
      // group into chords
      const groups = new Map<number, DNote[]>();
      for (const n of v.notes) { const k = Math.round(n.start * 10000); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(n); }
      const occupied: { bi: number; start: number; end: number }[] = [];
      for (const [, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        group.sort((a, b) => a.midi - b.midi);
        const dur = Math.max(...group.map((n) => n.dur));
        const segs = segmentsFor(group[0].start, dur, bars, barIndexAt);
        segs.forEach((seg, sgi) => {
          const chunks = splitNotatable(q(seg.start - bars[seg.bi].start), q(seg.dur), measures[seg.bi].length, q(beatLength(bars[seg.bi].time)));
          chunks.forEach((ch, ci) => {
            const first = sgi === 0 && ci === 0;
            const last = sgi === segs.length - 1 && ci === chunks.length - 1;
            group.forEach((n, gi) => {
              const targetSi = n.staveOverride && staveIndexById.has(n.staveOverride) ? Math.min(staveIndexById.get(n.staveOverride)!, staffCount - 1) : si;
              const fifths = key(seg.bi);
              const pitch = spell(n.midi, n.letter, fifths);
              const ev: NoteEvent = {
                kind: 'note', start: ch.start, duration: ch.duration, type: ch.type, dots: ch.dots, pitch, voice: voiceNo, staff: targetSi + 1,
                chord: gi > 0 || undefined, tieStart: !last || undefined, tieStop: !first || undefined,
                stem: n.stemDir ?? v.direction,
              };
              if (ch.timeModification) { ev.timeModification = ch.timeModification; ev.tuplet = ch.tuplet; }
              if (first && n.arts.length) ev.articulations = [...n.arts];
              if (first && pauses.some((pp) => Math.abs(pp - n.start) < 1e-9)) ev.articulations = [...(ev.articulations ?? []), 'fermata'];
              measures[seg.bi].staves[targetSi].events.push(ev);
              if (first && gi === 0) chunksByStart.set(Math.round(n.start * 10000), [ev]);
            });
            occupied.push({ bi: seg.bi, start: ch.start, end: ch.start + ch.duration });
          });
        });
      }
      // lyrics
      for (const ly of v.lyrics) {
        const target = chunksByStart.get(Math.round(ly.start * 10000))?.[0];
        const el = lyricElems.get(ly.elementId);
        if (!target || !el) continue;
        const text = str(el.text);
        const syl = str(el.syllableType);
        const lyric: Lyric = {
          verse: (Number(str(el.lineNumber)) || 0) + 1, text,
          syllabic: syl === 'kStart' ? 'begin' : syl === 'kMiddle' ? 'middle' : syl === 'kEnd' ? 'end' : 'single',
        };
        target.lyrics = [...(target.lyrics ?? []), lyric];
      }
      // texts attached to the voice stream
      for (const t of v.texts) {
        const bi = barIndexAt(t.start);
        measures[bi].staves[si].directions.push({ start: q(t.start - bars[bi].start), placement: t.above ? 'above' : 'below', words: t.text, style: 'italic', staff: si + 1 });
      }
      // rests between the chunks, per measure
      const byBar = new Map<number, { start: number; end: number }[]>();
      for (const o of occupied) { if (!byBar.has(o.bi)) byBar.set(o.bi, []); byBar.get(o.bi)!.push(o); }
      const firstBar = Math.min(...[...byBar.keys()], Infinity);
      const lastBar = Math.max(...[...byBar.keys()], -Infinity);
      for (let bi = firstBar; bi <= lastBar; bi++) {
        const occ = (byBar.get(bi) ?? []).sort((a, b) => a.start - b.start);
        const mlen = measures[bi].length;
        if (!occ.length) continue; // empty bar in a secondary voice: leave to the primary voice
        let pos = 0;
        const gaps: { start: number; end: number }[] = [];
        for (const o of occ) { if (o.start > pos) gaps.push({ start: pos, end: o.start }); pos = Math.max(pos, o.end); }
        if (pos < mlen) gaps.push({ start: pos, end: mlen });
        for (const g of gaps) {
          for (const ch of splitNotatable(g.start, g.end - g.start, mlen, q(beatLength(bars[bi].time)))) {
            const rest: RestEvent = { kind: 'rest', start: ch.start, duration: ch.duration, type: ch.type, dots: ch.dots, voice: voiceNo, staff: si + 1 };
            if (ch.timeModification) { rest.timeModification = ch.timeModification; rest.tuplet = ch.tuplet; }
            measures[bi].staves[si].events.push(rest);
          }
        }
      }
    });
    // Whole-measure rests for empty staves, tempo texts, stems cleanup, sorting
    measures.forEach((m, bi) => {
      m.staves.forEach((st, si) => {
        st.events.sort((a, b) => a.start - b.start || a.voice - b.voice || ((a.kind === 'note' && a.chord) ? 1 : 0) - ((b.kind === 'note' && b.chord) ? 1 : 0));
        const voices = new Set(st.events.map((e) => e.voice));
        if (voices.size === 0) st.events.push({ kind: 'rest', start: 0, duration: m.length, dots: 0, measure: true, voice: si * 4 + 1, staff: si + 1 });
        if (voices.size <= 1) for (const e of st.events) if (e.kind === 'note') delete e.stem;
      });
      delete (m as Measure & { _key?: number })._key;
      if (partNo === 1) {
        for (const t of tempoEvents) {
          if (barIndexAt(t.pos) !== bi) continue;
          const start = q(t.pos - bars[bi].start);
          if (t.bpm) m.staves[0].directions.push({ start, placement: 'above', tempo: { bpm: t.bpm, beatUnit: t.beatUnit ?? 'quarter', text: t.text }, staff: 1 });
          else if (t.text) m.staves[0].directions.push({ start, placement: 'above', words: t.text, style: 'bold-italic', staff: 1 });
        }
      }
    });
    part.measures = measures;
    score.parts.push(part);
  }
  if (!score.parts.length) throw new Error('No notes were found in this Dorico project.');
  return score;
}

// ---------------------------------------------------------------------------------------------

function keyForVoice(measures: Measure[]): (bi: number) => number {
  return (bi) => (measures[bi] as Measure & { _key?: number })._key ?? 0;
}

function propsOf(e: DtnObject): Map<string, string> {
  const m = new Map<string, string>();
  for (const [, en] of list(obj(e.propertyTable)?.entries)) {
    const o = obj(en); if (!o) continue;
    m.set(str(o.propertyType), str(o.value));
  }
  return m;
}

function textOf(e: DtnObject): string {
  const direct = str(e.text);
  if (direct) return direct;
  const parts: string[] = [];
  const rich = obj(e.richText) ?? obj(obj(e.data)?.richText);
  for (const [, para] of list(rich?.paragraphs)) {
    for (const [, frag] of list(obj(para)?.fragments)) { const c = str(obj(frag)?.content); if (c) parts.push(c); }
    const c = str(obj(para)?.content); if (c) parts.push(c);
  }
  return parts.join('').trim();
}

function tonalityFifths(el?: DtnObject): number {
  const ks = obj(obj(el?.tonalityDivisionData)?.keySignature);
  let fifths = 0;
  for (const [, acc] of list(ks?.accidentals)) {
    const id = str(obj(obj(acc)?.noteNameAndAccidental)?.accidentalID);
    if (/sharp/.test(id)) fifths++;
    else if (/flat/.test(id)) fifths--;
  }
  return fifths;
}

function timeOf(el?: DtnObject): TimeSignature | undefined {
  const tsd = list(obj(obj(el?.barDivisionData)?.timeSignature)?.timeSignaturesAndDivisions);
  const ts = obj(obj(tsd[0]?.[1])?.timeSignature);
  if (!ts) return undefined;
  const beats = Number(str(ts.numerator)), beatType = Number(str(ts.denominator));
  if (!beats || !beatType) return undefined;
  return { beats, beatType };
}

function beatLength(t: TimeSignature): number {
  // quarter-note units
  if (t.beatType === 8 && t.beats % 3 === 0) return 1.5;
  return 4 / t.beatType;
}

function clefFromId(id: string): Clef {
  const s = id.toLowerCase();
  if (s.includes('bass')) return { sign: 'F', line: 4 };
  if (s.includes('alto')) return { sign: 'C', line: 3 };
  if (s.includes('tenor')) return { sign: 'C', line: 4 };
  if (s.includes('percussion') || s.includes('unpitched')) return { sign: 'percussion', line: 2 };
  if (s.includes('8vb') || s.includes('octavedown')) return { sign: 'G', line: 2, octaveChange: -1 };
  return { sign: 'G', line: 2 };
}

function defaultClef(instrumentId: string, staffIndex: number, staffCount: number): Clef {
  if (staffCount > 1 && staffIndex === staffCount - 1) return { sign: 'F', line: 4 };
  const s = instrumentId.toLowerCase();
  if (/bass|cello|bassoon|trombone|tuba|baritone|timpani/.test(s)) return { sign: 'F', line: 4 };
  if (/viola/.test(s)) return { sign: 'C', line: 3 };
  if (/tenor/.test(s) && /singer|voice/.test(s)) return { sign: 'G', line: 2, octaveChange: -1 };
  return { sign: 'G', line: 2 };
}

function dynamicsFromGroup(pos: number, el?: DtnObject): DDynamic[] {
  const out: DDynamic[] = [];
  for (const [kind, subV] of list(el?.subElements)) {
    const sub = obj(subV); if (!sub) continue;
    const at = pos + rational(sub.position);
    if (kind === 'ImmediateChangeDynamicDefinition') {
      const mark = intensityToMark(str(sub.intensity));
      if (mark) out.push({ pos: at, mark });
    } else if (kind === 'GradualChangeDynamicDefinition') {
      const dir = str(sub.direction);
      out.push({ pos: at, wedge: { type: dir.includes('Down') ? 'diminuendo' : 'crescendo', length: rational(sub.duration) } });
    }
  }
  return out;
}

/** Dorico intensity variant list: {int: side}, {}, {bool: mezzo}, {int: count}. side 1 = piano, 0 = forte. */
function intensityToMark(s: string): DynamicMark | undefined {
  const ints = [...s.matchAll(/int:\s*(-?\d+)/g)].map((m) => Number(m[1]));
  const mezzo = /bool:\s*true/.test(s);
  if (!ints.length) return undefined;
  const soft = ints[0] === 1;
  if (mezzo) return soft ? 'mp' : 'mf';
  const count = ints[1] ?? 1;
  if (soft) return count >= 4 ? 'pppp' : count === 3 ? 'ppp' : count === 2 ? 'pp' : 'p';
  return count >= 4 ? 'ffff' : count === 3 ? 'fff' : count === 2 ? 'ff' : 'f';
}

/** Spell a MIDI pitch using Dorico's letter when known, otherwise by key. */
function spell(midi: number, letter: string | undefined, fifths: number): Pitch {
  const pc = ((midi % 12) + 12) % 12;
  let step: Step | undefined = letter && STEPS.includes(letter as Step) ? (letter as Step) : undefined;
  if (!step) {
    const alts = keyAlterations(fifths);
    // diatonic spelling in the key if possible
    for (const s of STEPS) {
      const natural = midiNumber({ step: s, alter: 0, octave: 4 }) % 12;
      if ((natural + alts[s] + 12) % 12 === pc) { step = s; break; }
    }
    if (!step) {
      const preferSharps = fifths >= 0;
      const sharpNames: Step[] = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
      const flatNames: Step[] = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'];
      step = (preferSharps ? sharpNames : flatNames)[pc];
    }
  }
  // octave: choose so that the natural note is within a major second of the midi pitch
  let octave = Math.floor(midi / 12) - 1;
  let alter = midi - midiNumber({ step, alter: 0, octave });
  if (alter > 6) { octave++; alter -= 12; }
  if (alter < -6) { octave--; alter += 12; }
  if (Math.abs(alter) > 2) {
    // give up on the requested letter
    const idx = fromDiatonicIndex(octave * 7 + STEPS.indexOf(step));
    void idx;
    return spell(midi, undefined, fifths);
  }
  return { step, alter, octave };
}

interface Segment { bi: number; start: number; dur: number }

/** Split a note spanning bar lines into per-bar segments (positions in quarter notes). */
function segmentsFor(start: number, dur: number, bars: DBar[], barIndexAt: (p: number) => number): Segment[] {
  const out: Segment[] = [];
  let pos = start;
  let remaining = dur;
  while (remaining > 1e-9) {
    const bi = barIndexAt(pos);
    const bar = bars[bi];
    const end = bar.start + bar.length;
    const take = Math.min(remaining, end - pos);
    if (take <= 1e-9) break;
    out.push({ bi, start: pos, dur: take });
    pos += take;
    remaining -= take;
    if (bi === bars.length - 1 && pos >= end - 1e-9) break;
  }
  return out;
}

interface Chunk { start: number; duration: number; type: NoteType; dots: number; timeModification?: { actual: number; normal: number }; tuplet?: { actual: number; normal: number; start?: boolean; stop?: boolean } }

/** Split a duration (in divisions, within one measure) into standard note values. */
function splitNotatable(start: number, duration: number, measureLength: number, beat: number): Chunk[] {
  const out: Chunk[] = [];
  let pos = start;
  let rem = duration;
  let guard = 0;
  while (rem > 0 && guard++ < 64) {
    const onBeat = pos % beat === 0;
    const toNextBeat = beat - (pos % beat);
    let chosen: { d: number; type: NoteType; dots: number } | undefined;
    for (const c of DUR_TYPES) {
      if (c.d > rem) continue;
      if (c.d >= beat) { if (!onBeat) continue; }
      else if (c.d > toNextBeat) continue;
      chosen = c; break;
    }
    if (chosen) { out.push({ start: pos, duration: chosen.d, type: chosen.type, dots: chosen.dots }); pos += chosen.d; rem -= chosen.d; continue; }
    // Triplet values
    const t = TRIPLET_TYPES.find((c) => c.d <= rem + 0.5 && Math.abs(rem / c.d - Math.round(rem / c.d)) < 1e-6);
    if (t) {
      const n = Math.round(rem / t.d);
      for (let i = 0; i < n; i++) {
        out.push({ start: pos, duration: t.d, type: t.type, dots: 0, timeModification: { actual: 3, normal: 2 }, tuplet: { actual: 3, normal: 2, start: i === 0 || undefined, stop: i === n - 1 || undefined } });
        pos += t.d;
      }
      rem = 0;
      continue;
    }
    // Fallback: smallest value
    const small = DUR_TYPES[DUR_TYPES.length - 1];
    out.push({ start: pos, duration: Math.min(rem, small.d), type: small.type, dots: 0 });
    pos += small.d; rem -= small.d;
  }
  void measureLength;
  return out;
}

export const _test = { splitNotatable, spell, intensityToMark };
export type { DtnValue };
export type { Direction, Event, StaffMeasure };
