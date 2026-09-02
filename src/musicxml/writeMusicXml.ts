import type { Direction, Event, Lyric, Measure, NoteEvent, Part, Score, Step } from '../model/types';
import { DIVISIONS } from '../model/types';
import { keyAlterations } from '../model/pitch';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ACC_NAMES: Record<number, string> = { [-2]: 'flat-flat', [-1]: 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };

export interface WriteOptions {
  /** Software name for the encoding element */
  software?: string;
}

/** Serialize the score model as MusicXML 3.1 (partwise). */
export function writeMusicXml(score: Score, opts: WriteOptions = {}): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="3.1">');
  if (score.title) out.push(`  <work><work-title>${esc(score.title)}</work-title></work>`);
  if (score.subtitle) out.push(`  <movement-title>${esc(score.subtitle)}</movement-title>`);
  out.push('  <identification>');
  if (score.composer) out.push(`    <creator type="composer">${esc(score.composer)}</creator>`);
  if (score.lyricist) out.push(`    <creator type="lyricist">${esc(score.lyricist)}</creator>`);
  if (score.arranger) out.push(`    <creator type="arranger">${esc(score.arranger)}</creator>`);
  if (score.copyright) out.push(`    <rights>${esc(score.copyright)}</rights>`);
  out.push(`    <encoding><software>${esc(opts.software ?? 'Transposer')}</software><encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date></encoding>`);
  out.push('  </identification>');
  out.push('  <defaults><scaling><millimeters>7.2</millimeters><tenths>40</tenths></scaling>');
  out.push('    <page-layout><page-height>1553</page-height><page-width>1200</page-width>');
  out.push('      <page-margins type="both"><left-margin>70</left-margin><right-margin>70</right-margin><top-margin>70</top-margin><bottom-margin>70</bottom-margin></page-margins></page-layout>');
  out.push('  </defaults>');
  if (score.title) out.push(`  <credit page="1"><credit-type>title</credit-type><credit-words default-x="600" default-y="1480" justify="center" valign="top" font-size="22">${esc(score.title)}</credit-words></credit>`);
  if (score.subtitle) out.push(`  <credit page="1"><credit-type>subtitle</credit-type><credit-words default-x="600" default-y="1440" justify="center" valign="top" font-size="14">${esc(score.subtitle)}</credit-words></credit>`);
  if (score.composer) out.push(`  <credit page="1"><credit-type>composer</credit-type><credit-words default-x="1130" default-y="1400" justify="right" valign="bottom" font-size="10">${esc(score.composer)}</credit-words></credit>`);
  if (score.lyricist) out.push(`  <credit page="1"><credit-type>lyricist</credit-type><credit-words default-x="70" default-y="1400" justify="left" valign="bottom" font-size="10">${esc(score.lyricist)}</credit-words></credit>`);
  out.push('  <part-list>');
  for (const part of score.parts) {
    out.push(`    <score-part id="${part.id}"><part-name print-object="no">${esc(part.name)}</part-name>${part.abbreviation ? `<part-abbreviation print-object="no">${esc(part.abbreviation)}</part-abbreviation>` : ''}</score-part>`);
  }
  out.push('  </part-list>');
  for (const part of score.parts) writePart(out, part);
  out.push('</score-partwise>');
  return out.join('\n');
}

function writePart(out: string[], part: Part): void {
  out.push(`  <part id="${part.id}">`);
  let firstMeasure = true;
  let multiRestRemaining = 0;
  for (const measure of part.measures) {
    const attrs: string[] = [];
    if (firstMeasure) attrs.push(`      <divisions>${DIVISIONS}</divisions>`);
    if (measure.key !== undefined) attrs.push(`      <key><fifths>${measure.key}</fifths><mode>major</mode></key>`);
    if (measure.time) attrs.push(`      <time><beats>${measure.time.beats}</beats><beat-type>${measure.time.beatType}</beat-type></time>`);
    if (firstMeasure && part.staffCount > 1) attrs.push(`      <staves>${part.staffCount}</staves>`);
    measure.staves.forEach((st, i) => {
      if (st.clef) {
        const num = part.staffCount > 1 ? ` number="${i + 1}"` : '';
        const sign = st.clef.sign === 'percussion' ? 'percussion' : st.clef.sign;
        attrs.push(`      <clef${num}><sign>${sign}</sign><line>${st.clef.line}</line>${st.clef.octaveChange ? `<clef-octave-change>${st.clef.octaveChange}</clef-octave-change>` : ''}</clef>`);
      }
    });
    if (measure.multiRest) {
      attrs.push(`      <measure-style><multiple-rest>${measure.multiRest}</multiple-rest></measure-style>`);
      multiRestRemaining = measure.multiRest;
    }
    out.push(`    <measure number="${measure.number}">`);
    if (measure.leftBarline) {
      const b = measure.leftBarline;
      out.push(`      <barline location="left">${b.style ? `<bar-style>${b.style}</bar-style>` : ''}${b.ending ? `<ending number="${b.ending.number}" type="${b.ending.type}"/>` : ''}${b.repeat ? `<repeat direction="${b.repeat}"/>` : ''}</barline>`);
    }
    if (attrs.length) { out.push('      <attributes>'); out.push(...attrs); out.push('      </attributes>'); }
    writeMeasureContent(out, measure, part);
    if (measure.rightBarline) {
      const b = measure.rightBarline;
      out.push(`      <barline location="right">${b.style ? `<bar-style>${b.style}</bar-style>` : ''}${b.ending ? `<ending number="${b.ending.number}" type="${b.ending.type}"/>` : ''}${b.repeat ? `<repeat direction="${b.repeat}"/>` : ''}</barline>`);
    }
    out.push('    </measure>');
    firstMeasure = false;
    if (multiRestRemaining > 0) multiRestRemaining--;
  }
  out.push('  </part>');
}

interface AccidentalDecision { show?: string; }

/** Decide which accidentals to display, applying the standard measure rule per staff. */
function decideAccidentals(measure: Measure): Map<NoteEvent, AccidentalDecision> {
  const result = new Map<NoteEvent, AccidentalDecision>();
  const key = measure.key;
  for (const st of measure.staves) {
    const notes = st.events.filter((e): e is NoteEvent => e.kind === 'note').slice().sort((a, b) => a.start - b.start);
    const state = new Map<string, number>();
    for (const n of notes) {
      const pk = `${n.pitch.step}${n.pitch.octave}`;
      const keyAlt = (measure as Measure & { _keyAlt?: Record<Step, number> })._keyAlt ?? keyAlterations(key ?? 0);
      const expected = state.has(pk) ? state.get(pk)! : keyAlt[n.pitch.step];
      const d: AccidentalDecision = {};
      if (n.pitch.alter !== expected) {
        if (!(n.tieStop && !n.tieStart && state.get(pk) === undefined && n.pitch.alter !== keyAlt[n.pitch.step] && tiedFromPrevious(n))) {
          d.show = ACC_NAMES[n.pitch.alter] ?? 'natural';
        }
        state.set(pk, n.pitch.alter);
      }
      result.set(n, d);
    }
  }
  return result;
}

function tiedFromPrevious(n: NoteEvent): boolean { return !!n.tieStop && n.start === 0; }

function writeMeasureContent(out: string[], measure: Measure, part: Part): void {
  // Attach the key alterations for accidental decisions
  const keyAlt = keyAlterations(currentKey(measure, part));
  (measure as Measure & { _keyAlt?: Record<Step, number> })._keyAlt = keyAlt;
  const acc = decideAccidentals(measure);
  // Collect voices in order: staff by staff, voice by voice
  let cursor = 0;
  const allDirections: { dir: Direction; staff: number }[] = [];
  measure.staves.forEach((st, si) => { for (const d of st.directions) allDirections.push({ dir: d, staff: si + 1 }); });
  const startDirections = allDirections.filter((d) => d.dir.start === 0);
  const endDirections = allDirections.filter((d) => d.dir.start > 0);
  // "about ♩ = 86": merge a words direction into a tempo direction in the same measure
  const tempoDir = startDirections.find((d) => d.dir.tempo);
  if (tempoDir) {
    const wordsIdx = startDirections.findIndex((d) => d.dir.words && !d.dir.tempo && d.dir.placement === 'above' && /^(about|ca\.?|circa|approx\.?|slowly|freely|with|brightly|gently|tenderly|reverently|expressively|warmly|moderately|lively|quietly|joyfully)/i.test(d.dir.words));
    if (wordsIdx >= 0) { tempoDir.dir.tempo!.text = startDirections[wordsIdx].dir.words; startDirections.splice(wordsIdx, 1); }
  }
  for (const d of startDirections) writeDirection(out, d.dir, d.staff, part);

  let first = true;
  measure.staves.forEach((st, si) => {
    const voices = new Map<number, Event[]>();
    for (const ev of st.events) {
      if (!voices.has(ev.voice)) voices.set(ev.voice, []);
      voices.get(ev.voice)!.push(ev);
    }
    for (const [, events] of [...voices.entries()].sort((a, b) => a[0] - b[0])) {
      if (!first || cursor > 0) {
        if (cursor > 0) { out.push(`      <backup><duration>${cursor}</duration></backup>`); cursor = 0; }
      }
      first = false;
      let pos = 0;
      for (const ev of events) {
        const isChord = ev.kind === 'note' && ev.chord;
        if (!isChord && ev.start > pos) {
          out.push(`      <forward><duration>${ev.start - pos}</duration></forward>`);
          pos = ev.start;
        }
        writeEvent(out, ev, si + 1, part, acc.get(ev as NoteEvent));
        if (!isChord) pos = ev.start + ev.duration;
      }
      cursor = pos;
    }
  });
  if (cursor < measure.length) { out.push(`      <forward><duration>${measure.length - cursor}</duration></forward>`); cursor = measure.length; }
  for (const d of endDirections) writeDirection(out, d.dir, d.staff, part);
}

function currentKey(measure: Measure, part: Part): number {
  if (measure.key !== undefined) return measure.key;
  const idx = part.measures.indexOf(measure);
  for (let i = idx - 1; i >= 0; i--) if (part.measures[i].key !== undefined) return part.measures[i].key!;
  return 0;
}

function writeDirection(out: string[], d: Direction, staff: number, part: Part): void {
  const place = d.placement ? ` placement="${d.placement}"` : '';
  const staffEl = part.staffCount > 1 ? `<staff>${staff}</staff>` : '';
  if (d.dynamic) {
    out.push(`      <direction${place}><direction-type><dynamics><${d.dynamic}/></dynamics></direction-type>${staffEl}<sound dynamics="${dynamicVelocity(d.dynamic)}"/></direction>`);
  }
  if (d.wedge) {
    out.push(`      <direction${place}><direction-type><wedge type="${d.wedge.type}" number="${d.wedge.number}"/></direction-type>${staffEl}</direction>`);
  }
  if (d.sign) {
    out.push(`      <direction placement="above"><direction-type><${d.sign}/></direction-type>${staffEl}</direction>`);
  }
  if (d.words) {
    const style = d.style === 'bold-italic' ? ' font-weight="bold" font-style="italic"' : d.style === 'bold' ? ' font-weight="bold"' : d.style === 'normal' ? '' : ' font-style="italic"';
    out.push(`      <direction${place}><direction-type><words${style}>${esc(d.words)}</words></direction-type>${staffEl}</direction>`);
  }
  if (d.tempo) {
    const unit = d.tempo.beatUnit;
    const words = d.tempo.text ? `<direction-type><words font-style="italic">${esc(d.tempo.text)} </words></direction-type>` : '';
    out.push(`      <direction placement="above">${words}<direction-type><metronome parentheses="no"><beat-unit>${unit}</beat-unit>${d.tempo.dotted ? '<beat-unit-dot/>' : ''}<per-minute>${d.tempo.bpm}</per-minute></metronome></direction-type>${staffEl}<sound tempo="${d.tempo.bpm}"/></direction>`);
  }
}

function dynamicVelocity(m: string): number {
  const table: Record<string, number> = { pppp: 20, ppp: 30, pp: 40, p: 55, mp: 65, mf: 78, f: 90, ff: 105, fff: 115, ffff: 125, sfz: 100, fp: 85 };
  return table[m] ?? 80;
}

function writeEvent(out: string[], ev: Event, staff: number, part: Part, acc?: AccidentalDecision): void {
  const staffEl = part.staffCount > 1 ? `<staff>${staff}</staff>` : '';
  if (ev.kind === 'rest') {
    const restEl = ev.measure ? '<rest measure="yes"/>' : '<rest/>';
    const type = ev.measure ? '' : `<type>${ev.type ?? 'quarter'}</type>${'<dot/>'.repeat(ev.dots)}`;
    const tm = ev.timeModification ? `<time-modification><actual-notes>${ev.timeModification.actual}</actual-notes><normal-notes>${ev.timeModification.normal}</normal-notes></time-modification>` : '';
    out.push(`      <note>${restEl}<duration>${ev.duration}</duration><voice>${ev.voice}</voice>${type}${tm}${staffEl}${tupletNotation(ev)}</note>`);
    return;
  }
  const n = ev;
  const parts: string[] = ['      <note>'];
  if (n.grace) parts.push('<grace/>');
  if (n.chord) parts.push('<chord/>');
  parts.push(`<pitch><step>${n.pitch.step}</step>${n.pitch.alter ? `<alter>${n.pitch.alter}</alter>` : ''}<octave>${n.pitch.octave}</octave></pitch>`);
  if (!n.grace) parts.push(`<duration>${n.duration}</duration>`);
  if (n.tieStop) parts.push('<tie type="stop"/>');
  if (n.tieStart) parts.push('<tie type="start"/>');
  parts.push(`<voice>${n.voice}</voice><type>${n.type}</type>${'<dot/>'.repeat(n.dots)}`);
  if (acc?.show) parts.push(`<accidental>${acc.show}</accidental>`);
  if (n.timeModification) parts.push(`<time-modification><actual-notes>${n.timeModification.actual}</actual-notes><normal-notes>${n.timeModification.normal}</normal-notes></time-modification>`);
  if (n.stem) parts.push(`<stem>${n.stem}</stem>`);
  if (staffEl) parts.push(staffEl);
  if (n.beam && !n.chord) {
    const levels = n.type === 'eighth' ? 1 : n.type === '16th' ? 2 : n.type === '32nd' ? 3 : n.type === '64th' ? 4 : 1;
    for (let l = 1; l <= levels; l++) parts.push(`<beam number="${l}">${n.beam}</beam>`);
  }
  const notations: string[] = [];
  if (n.tieStop) notations.push('<tied type="stop"/>');
  if (n.tieStart) notations.push('<tied type="start"/>');
  for (const s of n.slurStops ?? []) notations.push(`<slur type="stop" number="${s}"/>`);
  for (const s of n.slurStarts ?? []) notations.push(`<slur type="start" number="${s}"/>`);
  notations.push(tupletNotation(n, true));
  const arts = n.articulations ?? [];
  const artEls = arts.filter((a) => a !== 'fermata' && a !== 'up-bow' && a !== 'down-bow' && a !== 'trill' && a !== 'turn' && a !== 'mordent' && a !== 'inverted-mordent');
  if (artEls.length) notations.push(`<articulations>${artEls.map((a) => `<${a}/>`).join('')}</articulations>`);
  const techEls = arts.filter((a) => a === 'up-bow' || a === 'down-bow');
  if (techEls.length) notations.push(`<technical>${techEls.map((a) => `<${a}/>`).join('')}</technical>`);
  const ornEls = arts.filter((a) => a === 'trill' || a === 'turn' || a === 'mordent' || a === 'inverted-mordent');
  if (ornEls.length) notations.push(`<ornaments>${ornEls.map((a) => `<${a === 'trill' ? 'trill-mark' : a}/>`).join('')}</ornaments>`);
  if (arts.includes('fermata')) notations.push('<fermata/>');
  const notationStr = notations.filter(Boolean).join('');
  if (notationStr) parts.push(`<notations>${notationStr}</notations>`);
  for (const ly of n.lyrics ?? []) parts.push(lyricXml(ly));
  parts.push('</note>');
  out.push(parts.join(''));
}

function tupletNotation(ev: Event, inner = false): string {
  if (!ev.tuplet) return '';
  const els: string[] = [];
  if (ev.tuplet.start) els.push('<tuplet type="start" bracket="yes"/>');
  if (ev.tuplet.stop) els.push('<tuplet type="stop"/>');
  if (!els.length) return '';
  return inner ? els.join('') : `<notations>${els.join('')}</notations>`;
}

function lyricXml(ly: Lyric): string {
  return `<lyric number="${ly.verse}"><syllabic>${ly.syllabic}</syllabic><text>${esc(ly.text)}</text>${ly.extend ? '<extend type="start"/>' : ''}</lyric>`;
}
