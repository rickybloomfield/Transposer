import { loadFile } from '../loaders';
import { fetchRemoteScore, fileNameOf, RemoteScoreError, scoreUrlCandidates } from '../remote';
import type { Part, Score } from '../model/types';
import { keyName, intervalBetweenKeys, simplifyInterval, transposeKey, type Interval } from '../model/pitch';
import {
  addIntervals,
  CONCERT_PITCH,
  describeInterval,
  detectInstrument,
  FAMILY_ORDER,
  fitOctaveShift,
  INSTRUMENTS,
  instrumentById,
  instrumentInterval,
  matchInstrument,
  normalizeInstrumentText,
  octaveInterval,
  type Instrument,
  type InstrumentDetection,
} from '../model/instruments';
import { applyInstrument, expandMultiRests, initialPartKey, partsShareKey, transposedPitches, transposeScore, type InstrumentChange } from '../model/transpose';
import { writeMusicXml } from '../musicxml/writeMusicXml';
import {
  DEFAULT_MUSIC_SIZE,
  DEFAULT_MUSIC_SPACING,
  MAX_MUSIC_SIZE,
  MAX_MUSIC_SPACING,
  MIN_MUSIC_SIZE,
  MIN_MUSIC_SPACING,
  renderMusicXml,
} from '../render/verovio';
import { downloadBlob, svgPagesToPdf } from '../render/pdf';

const MAJOR_KEYS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
const MUSIC_SIZE_STEP = 5;
const MUSIC_SPACING_STEP = 5;
const CLEF_NAMES: Record<string, string> = {
  G2: 'treble clef', 'G2-1': 'treble clef (8vb)', F4: 'bass clef', F3: 'baritone clef',
  C3: 'alto clef', C4: 'tenor clef', percussion2: 'percussion clef',
};

export class App {
  private score?: Score;
  private fileName = '';
  private pages: string[] = [];
  private currentXml = '';
  private el: Record<string, HTMLElement> = {};
  private renderToken = 0;
  private musicSpacing = DEFAULT_MUSIC_SPACING;
  private musicSize = DEFAULT_MUSIC_SIZE;
  private partIndex = 0;
  private detection?: InstrumentDetection;
  private sourceId = CONCERT_PITCH.id;
  private targetId = CONCERT_PITCH.id;
  private change?: InstrumentChange;

  constructor(private root: HTMLElement) {
    this.render();
    const params = new URLSearchParams(location.search);
    const linked = params.get('score') ?? params.get('url') ?? params.get('file');
    const sample = params.get('sample');
    if (linked) void this.openUrl(linked);
    else if (sample) void this.openExample(sample);
  }

  private render(): void {
    this.root.innerHTML = `
      <header class="site">
        <h1>Music Transposer</h1>
        <p>Transpose Personal Composer (.pc) and Dorico sheet music to any key — or re-notate it for
           another instrument, with the right key signature and clef — then preview it and download a
           PDF or MusicXML. Everything happens in your browser: your files are never uploaded.</p>
      </header>
      <main>
        <div class="dropzone" id="drop">
          <p class="primary">Drop a <strong>.pc</strong> or <strong>.dorico</strong> file here, or</p>
          <p><label class="button">Choose a file<input type="file" id="file" accept=".pc,.dorico" hidden></label></p>
          <p><button class="button secondary" id="example" type="button">Try an example file</button></p>
          <div class="remote-error hidden" id="remote-error"></div>
        </div>
        <div class="toolbar hidden" id="toolbar">
          <div class="fileinfo" id="fileinfo"></div>
          <div class="controls">
            <label class="field-part hidden" id="part-field">Instrument part
              <select id="part"></select>
            </label>
            <label class="field-instrument">Written for
              <select id="instrument-from"></select>
            </label>
            <label class="field-instrument">Transpose for
              <select id="instrument-to"></select>
            </label>
            <label class="field-key">Transpose to
              <select id="key"></select>
            </label>
            <label class="field-small">Direction
              <select id="direction">
                <option value="auto">Closest</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
            <label class="field-small">Octave
              <select id="octave">
                <option value="auto">Fit range</option>
                <option value="2">+2</option>
                <option value="1">+1</option>
                <option value="0">As written</option>
                <option value="-1">−1</option>
                <option value="-2">−2</option>
              </select>
            </label>
            <div class="layout-controls">
              <label>Music spacing
                <div class="stepper" role="group" aria-label="Music spacing">
                  <button class="icon-button" id="spacing-down" type="button" aria-label="Decrease music spacing">-</button>
                  <output id="spacing-value" aria-live="polite">${DEFAULT_MUSIC_SPACING}%</output>
                  <button class="icon-button" id="spacing-up" type="button" aria-label="Increase music spacing">+</button>
                </div>
              </label>
              <label>Music size
                <div class="stepper" role="group" aria-label="Music size">
                  <button class="icon-button" id="size-down" type="button" aria-label="Make notes and staves smaller">-</button>
                  <output id="size-value" aria-live="polite">${DEFAULT_MUSIC_SIZE}%</output>
                  <button class="icon-button" id="size-up" type="button" aria-label="Make notes and staves larger">+</button>
                </div>
              </label>
            </div>
          </div>
          <p class="instrument-hint hidden" id="instrument-hint"></p>
          <div class="actions">
            <button class="button" id="pdf">Download PDF</button>
            <button class="button secondary" id="xml">Download MusicXML</button>
            <button class="button secondary" id="print">Print</button>
            <button class="button secondary" id="clear" type="button">Clear</button>
          </div>
        </div>
        <div class="status" id="status"></div>
        <details class="warnings hidden" id="warnings"><summary></summary><ul></ul></details>
        <div class="pages" id="pages"></div>
      </main>
      <footer class="site">
        Engraving by <a href="https://www.verovio.org/" target="_blank" rel="noopener">Verovio</a>.
        <a href="https://github.com/rickybloomfield/Transposer" target="_blank" rel="noopener">Source on GitHub</a>.
      </footer>`;
    const ids = ['drop', 'file', 'toolbar', 'fileinfo', 'part-field', 'part', 'instrument-from', 'instrument-to',
      'key', 'direction', 'octave', 'instrument-hint', 'spacing-down', 'spacing-value', 'spacing-up',
      'size-down', 'size-value', 'size-up', 'pdf', 'xml', 'print', 'clear', 'status', 'warnings', 'pages', 'example',
      'remote-error'];
    for (const id of ids) this.el[id] = this.root.querySelector(`#${id}`) as HTMLElement;
    fillInstrumentSelect(this.el['instrument-from'] as HTMLSelectElement);
    fillInstrumentSelect(this.el['instrument-to'] as HTMLSelectElement);
    const drop = this.el.drop;
    const fileInput = this.el.file as HTMLInputElement;
    fileInput.addEventListener('change', () => { if (fileInput.files?.[0]) void this.open(fileInput.files[0]); });
    for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('active'); });
    for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('active'); });
    drop.addEventListener('drop', (e) => {
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) void this.open(f);
    });
    this.el.example.addEventListener('click', () => void this.openExample());
    this.el.part.addEventListener('change', () => this.selectPart(Number((this.el.part as HTMLSelectElement).value)));
    this.el['instrument-from'].addEventListener('change', () => {
      this.sourceId = (this.el['instrument-from'] as HTMLSelectElement).value;
      this.afterInstrumentChange();
    });
    this.el['instrument-to'].addEventListener('change', () => {
      this.targetId = (this.el['instrument-to'] as HTMLSelectElement).value;
      this.afterInstrumentChange();
    });
    this.el.key.addEventListener('change', () => void this.update());
    this.el.direction.addEventListener('change', () => { this.populateKeys(true); void this.update(); });
    this.el.octave.addEventListener('change', () => void this.update());
    this.el['spacing-down'].addEventListener('click', () => this.setMusicSpacing(this.musicSpacing - MUSIC_SPACING_STEP));
    this.el['spacing-up'].addEventListener('click', () => this.setMusicSpacing(this.musicSpacing + MUSIC_SPACING_STEP));
    this.el['size-down'].addEventListener('click', () => this.setMusicSize(this.musicSize - MUSIC_SIZE_STEP));
    this.el['size-up'].addEventListener('click', () => this.setMusicSize(this.musicSize + MUSIC_SIZE_STEP));
    this.el.pdf.addEventListener('click', () => void this.downloadPdf());
    this.el.xml.addEventListener('click', () => this.downloadXml());
    this.el.print.addEventListener('click', () => this.print());
    this.el.clear.addEventListener('click', () => this.clear());
  }

  /**
   * Open the score named by `?score=`. The value is usually the PDF a visitor was reading, so
   * `scoreUrlCandidates` looks for the `.pc` or `.dorico` published beside it.
   */
  private async openUrl(input: string): Promise<void> {
    this.hideRemoteError();
    let candidates: string[];
    try {
      candidates = scoreUrlCandidates(input);
    } catch (e) {
      this.showRemoteError(e, input);
      return;
    }
    this.setStatus(`Loading ${fileNameOf(candidates[0])}…`);
    try {
      const { file } = await fetchRemoteScore(candidates);
      await this.open(file);
    } catch (e) {
      console.error(e);
      this.showRemoteError(e, input);
    }
  }

  /** Explain a failed `?score=` load and, when we know which file to look for, offer it directly. */
  private showRemoteError(error: unknown, input: string): void {
    const remote = error instanceof RemoteScoreError ? error : undefined;
    const kind = remote?.kind ?? 'blocked';
    const candidates = remote?.candidates ?? [];
    const host = hostOf(candidates[0] ?? input);
    const heading = kind === 'invalid'
      ? 'That link is not a score address.'
      : `Could not load the linked score${host ? ` from ${host}` : ''}.`;
    const panel = this.el['remote-error'];
    panel.innerHTML = `<p class="remote-error-heading">${escapeHtml(heading)}</p><p>${escapeHtml((error as Error).message)}</p>`;
    if (kind === 'blocked' && candidates.length) {
      const link = document.createElement('a');
      link.className = 'button secondary';
      link.href = candidates[0];              // Validated as http(s) by scoreUrlCandidates.
      link.rel = 'noopener';
      link.textContent = `Download ${fileNameOf(candidates[0])}`;
      const p = document.createElement('p');
      p.append(link, document.createTextNode(' then drop it on this page.'));
      panel.appendChild(p);
      console.info(
        `Transposer: ${host} did not send an Access-Control-Allow-Origin header, so the browser ` +
        'blocked the request. The site owner can allow it by serving score files with ' +
        '`Access-Control-Allow-Origin: *`.',
      );
    }
    panel.classList.remove('hidden');
    this.setStatus('');
  }

  private hideRemoteError(): void {
    this.el['remote-error'].classList.add('hidden');
    this.el['remote-error'].innerHTML = '';
  }

  private async openExample(name = 'be-still-my-soul-viola.pc'): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await this.open(new File([blob], name));
    } catch (e) {
      this.setStatus(`Could not load the example: ${(e as Error).message}`, true);
    }
  }

  private setStatus(text: string, error = false): void {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('error', error);
  }

  private clear(): void {
    this.renderToken++;
    this.score = undefined;
    this.fileName = '';
    this.pages = [];
    this.currentXml = '';
    this.musicSpacing = DEFAULT_MUSIC_SPACING;
    this.musicSize = DEFAULT_MUSIC_SIZE;
    this.partIndex = 0;
    this.detection = undefined;
    this.sourceId = CONCERT_PITCH.id;
    this.targetId = CONCERT_PITCH.id;
    this.el.drop.classList.remove('active');
    this.hideRemoteError();
    (this.el.file as HTMLInputElement).value = '';
    this.el.toolbar.classList.add('hidden');
    this.el.fileinfo.textContent = '';
    this.el.key.innerHTML = '';
    this.el.part.innerHTML = '';
    this.el['part-field'].classList.add('hidden');
    this.el['instrument-hint'].classList.add('hidden');
    (this.el.direction as HTMLSelectElement).value = 'auto';
    (this.el.octave as HTMLSelectElement).value = 'auto';
    (this.el['instrument-from'] as HTMLSelectElement).value = CONCERT_PITCH.id;
    (this.el['instrument-to'] as HTMLSelectElement).value = CONCERT_PITCH.id;
    this.syncMusicSpacingControls();
    this.syncMusicSizeControls();
    const warnings = this.el.warnings as HTMLDetailsElement;
    warnings.classList.add('hidden');
    warnings.open = false;
    warnings.querySelector('summary')!.textContent = '';
    warnings.querySelector('ul')!.innerHTML = '';
    this.el.pages.innerHTML = '';
    this.setStatus('');
  }

  private async open(file: File): Promise<void> {
    this.hideRemoteError();
    this.setStatus(`Reading ${file.name}…`);
    try {
      const { score } = await loadFile(file);
      this.score = score;
      this.fileName = file.name.replace(/\.[^.]+$/, '');
      this.partIndex = defaultPartIndex(score);
      this.populateParts();
      this.detectForPart();
      this.populateKeys();
      this.syncMusicSpacingControls();
      this.syncMusicSizeControls();
      this.showWarnings(score.warnings);
      this.showFileInfo(file.name);
      this.el.toolbar.classList.remove('hidden');
      await this.update();
    } catch (e) {
      console.error(e);
      this.setStatus(`Could not open ${file.name}: ${(e as Error).message}`, true);
    }
  }

  private showFileInfo(fallbackName: string): void {
    const score = this.score!;
    const parts = score.parts.map((p) => p.name).join(', ');
    const detail = `${escapeHtml(parts)} · ${score.parts[0]?.measures.length ?? 0} measures · original key ${keyName(initialPartKey(this.instrumentPart()))}`;
    this.el.fileinfo.innerHTML = `<strong>${escapeHtml(score.title ?? fallbackName)}</strong>${score.subtitle ? ` — ${escapeHtml(score.subtitle)}` : ''}<br><span>${detail}</span>`;
  }

  private instrumentPart(): Part {
    return this.score!.parts[this.partIndex] ?? this.score!.parts[0];
  }

  private source(): Instrument { return instrumentById(this.sourceId); }
  private target(): Instrument { return instrumentById(this.targetId); }

  private populateParts(): void {
    const score = this.score!;
    const select = this.el.part as HTMLSelectElement;
    select.innerHTML = '';
    score.parts.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = p.name || `Part ${i + 1}`;
      if (i === this.partIndex) opt.selected = true;
      select.appendChild(opt);
    });
    this.el['part-field'].classList.toggle('hidden', score.parts.length < 2);
  }

  /** Guess the instrument the chosen part is written for and preselect it on both menus. */
  private detectForPart(): void {
    const score = this.score!;
    const part = this.instrumentPart();
    this.detection = detectInstrument({
      partName: part.name,
      abbreviation: part.abbreviation,
      subtitle: score.subtitle,
      fileName: this.fileName,
      title: score.title,
    });
    this.sourceId = this.detection?.instrument.id ?? CONCERT_PITCH.id;
    this.targetId = this.sourceId;
    (this.el['instrument-from'] as HTMLSelectElement).value = this.sourceId;
    (this.el['instrument-to'] as HTMLSelectElement).value = this.targetId;
  }

  private selectPart(index: number): void {
    this.partIndex = index;
    this.detectForPart();
    this.populateKeys();
    void this.update();
  }

  private afterInstrumentChange(): void {
    (this.el.octave as HTMLSelectElement).value = 'auto';
    this.populateKeys();
    void this.update();
  }

  /** Instrument transposition alone, respelled so the key signature stays inside 7 accidentals. */
  private instrumentIv(): Interval {
    const raw = instrumentInterval(this.source(), this.target());
    return simplifyInterval(initialPartKey(this.instrumentPart()), raw);
  }

  /** Written key the instrument change lands on, before any further transposition. */
  private baseKey(): number {
    return transposeKey(initialPartKey(this.instrumentPart()), this.instrumentIv());
  }

  private direction(): 'up' | 'down' | undefined {
    const dir = (this.el.direction as HTMLSelectElement).value;
    return dir === 'auto' ? undefined : (dir as 'up' | 'down');
  }

  /** Extra transposition the user asked for on top of the instrument change. */
  private keyShift(): Interval {
    const base = this.baseKey();
    const value = (this.el.key as HTMLSelectElement).value;
    if (!value) return { diatonic: 0, chromatic: 0 };
    return simplifyInterval(base, intervalBetweenKeys(base, Number(value), this.direction()));
  }

  private fittingOctave(): boolean {
    return (this.el.octave as HTMLSelectElement).value === 'auto';
  }

  /** Octaves the instrument part moves, either chosen or fitted to the target's range. */
  private octaveShift(): number {
    const value = (this.el.octave as HTMLSelectElement).value;
    if (value !== 'auto') return Number(value) || 0;
    const target = this.target();
    if (!this.score || this.targetId === this.sourceId || !target.range) return 0;
    const without = addIntervals(this.instrumentIv(), this.keyShift());
    return fitOctaveShift(transposedPitches(this.instrumentPart(), without), target.range);
  }

  private populateKeys(preserve = false): void {
    if (!this.score) return;
    const select = this.el.key as HTMLSelectElement;
    const previous = preserve ? Number(select.value) : undefined;
    const base = this.baseKey();
    const keys = MAJOR_KEYS.includes(base) ? MAJOR_KEYS : [...MAJOR_KEYS, base].sort((a, b) => a - b);
    const changed = this.targetId !== this.sourceId;
    select.innerHTML = '';
    for (const k of keys) {
      const opt = document.createElement('option');
      opt.value = String(k);
      opt.textContent = k === base
        ? `${keyName(k)} (${changed ? 'for this instrument' : 'original'})`
        : `${keyName(k)} (${describeInterval(intervalBetweenKeys(base, k, this.direction()))})`;
      select.appendChild(opt);
    }
    select.value = String(previous !== undefined && keys.includes(previous) ? previous : base);
  }

  private showWarnings(warnings: string[]): void {
    const box = this.el.warnings as HTMLDetailsElement;
    if (!warnings.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.querySelector('summary')!.textContent = `${warnings.length} note${warnings.length === 1 ? '' : 's'} about this file`;
    box.querySelector('ul')!.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  }

  /** Total interval for the instrument part, including the octave shift. */
  private partIv(): Interval {
    return addIntervals(addIntervals(this.instrumentIv(), this.keyShift()), octaveInterval(this.octaveShift()));
  }

  /** The score as it will be printed: pitches moved, clef and part name swapped. */
  private arranged(): Score {
    const shift = this.keyShift();
    const partIv = this.partIv();
    const out = transposeScore(this.score!, (_part, index) => (index === this.partIndex ? partIv : shift));
    const target = this.target();
    this.change = undefined;
    if (this.targetId !== this.sourceId) {
      this.change = applyInstrument(out.parts[this.partIndex], target);
      out.subtitle = renameInSubtitle(out.subtitle, this.source(), target);
    }
    if (!partsShareKey(out)) expandMultiRests(out);
    return out;
  }

  private setMusicSpacing(next: number): void {
    const clamped = Math.min(MAX_MUSIC_SPACING, Math.max(MIN_MUSIC_SPACING, next));
    if (clamped === this.musicSpacing) return;
    this.musicSpacing = clamped;
    this.syncMusicSpacingControls();
    if (this.score) void this.update();
  }

  private syncMusicSpacingControls(): void {
    this.el['spacing-value'].textContent = `${this.musicSpacing}%`;
    (this.el['spacing-down'] as HTMLButtonElement).disabled = this.musicSpacing <= MIN_MUSIC_SPACING;
    (this.el['spacing-up'] as HTMLButtonElement).disabled = this.musicSpacing >= MAX_MUSIC_SPACING;
  }

  private setMusicSize(next: number): void {
    const clamped = Math.min(MAX_MUSIC_SIZE, Math.max(MIN_MUSIC_SIZE, next));
    if (clamped === this.musicSize) return;
    this.musicSize = clamped;
    this.syncMusicSizeControls();
    if (this.score) void this.update();
  }

  private syncMusicSizeControls(): void {
    this.el['size-value'].textContent = `${this.musicSize}%`;
    (this.el['size-down'] as HTMLButtonElement).disabled = this.musicSize <= MIN_MUSIC_SIZE;
    (this.el['size-up'] as HTMLButtonElement).disabled = this.musicSize >= MAX_MUSIC_SIZE;
  }

  /** One line explaining what the instrument swap did to the part. */
  private showInstrumentHint(): void {
    const hint = this.el['instrument-hint'];
    const source = this.source();
    const target = this.target();
    const octaves = this.octaveShift();
    if (this.targetId === this.sourceId) {
      const detected = this.detection
        ? `Detected <strong>${escapeHtml(source.name)}</strong> from the ${sourceLabel(this.detection.source)}. Pick a different instrument under “Transpose for” to re-notate the part.`
        : 'Set “Written for” if this part is for a transposing instrument, then pick a new one under “Transpose for”.';
      hint.innerHTML = octaves ? `${detected} Moved ${describeOctaves(octaves, false)}.` : detected;
      hint.classList.remove('hidden');
      return;
    }
    const written = transposeKey(initialPartKey(this.instrumentPart()), this.partIv());
    const bits = [
      `<strong>${escapeHtml(source.name)}</strong> → <strong>${escapeHtml(target.name)}</strong>`,
      `${clefName(target)}`,
      `key ${keyName(initialPartKey(this.instrumentPart()))} → ${keyName(written)}`,
    ];
    if (octaves) bits.push(describeOctaves(octaves, this.fittingOctave()));
    const bowings = this.change?.droppedBowings ?? 0;
    if (bowings) bits.push(`${bowings} bow marking${bowings === 1 ? '' : 's'} removed`);
    if (target.transpose.chromatic !== 0) bits.push(`sounds ${describeInterval(target.transpose)}`);
    hint.innerHTML = bits.join(' · ');
    hint.classList.remove('hidden');
  }

  private async update(): Promise<void> {
    if (!this.score) return;
    const token = ++this.renderToken;
    const written = transposeKey(initialPartKey(this.instrumentPart()), this.partIv());
    this.setStatus('Rendering…');
    try {
      const score = this.arranged();
      this.showInstrumentHint();
      const xml = writeMusicXml(score);
      const { pages } = await renderMusicXml(xml, { musicSpacing: this.musicSpacing, musicSize: this.musicSize });
      if (token !== this.renderToken) return;
      this.currentXml = xml;
      this.pages = pages;
      this.el.pages.innerHTML = pages.map((svg) => `<div class="page">${svg}</div>`).join('');
      const sounding = transposeKey(written, this.target().transpose);
      const sounds = sounding === written ? '' : ` · sounds ${keyName(clampKey(sounding))}`;
      this.setStatus(`${pages.length} page${pages.length === 1 ? '' : 's'} · reads ${keyName(written)}${sounds}`);
    } catch (e) {
      console.error(e);
      this.setStatus(`Rendering failed: ${(e as Error).message}`, true);
    }
  }

  private suffix(): string {
    const written = transposeKey(initialPartKey(this.instrumentPart()), this.partIv());
    const key = keyName(written).replace(' major', '').replace('♭', 'b').replace('♯', '#');
    if (this.targetId === this.sourceId) return key;
    return `${this.target().name.replace('♭', 'b').replace('♯', '#')} - ${key}`;
  }

  private async downloadPdf(): Promise<void> {
    if (!this.pages.length) return;
    this.setStatus('Building PDF…');
    try {
      const blob = await svgPagesToPdf(this.pages, this.score?.title);
      downloadBlob(blob, `${this.fileName} - ${this.suffix()}.pdf`);
      this.setStatus('PDF downloaded.');
    } catch (e) {
      console.error(e);
      this.setStatus(`PDF export failed: ${(e as Error).message}`, true);
    }
  }

  private downloadXml(): void {
    if (!this.currentXml) return;
    downloadBlob(new Blob([this.currentXml], { type: 'application/vnd.recordare.musicxml+xml' }), `${this.fileName} - ${this.suffix()}.musicxml`);
  }

  private print(): void {
    if (!this.pages.length) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><title>${escapeHtml(this.score?.title ?? 'Score')}</title><style>@page{size:letter;margin:0}body{margin:0}svg{width:8.5in;height:11in;display:block;page-break-after:always}</style>${this.pages.join('')}`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }
}

function fillInstrumentSelect(select: HTMLSelectElement): void {
  for (const family of FAMILY_ORDER) {
    const members = INSTRUMENTS.filter((i) => i.family === family);
    if (!members.length) continue;
    const parent = family === 'Concert pitch' ? select : document.createElement('optgroup');
    if (parent !== select) (parent as HTMLOptGroupElement).label = family;
    for (const instrument of members) {
      const opt = document.createElement('option');
      opt.value = instrument.id;
      opt.textContent = instrument.name;
      parent.appendChild(opt);
    }
    if (parent !== select) select.appendChild(parent);
  }
}

/** Prefer a single-staff part: a grand staff is almost always the accompaniment. */
function defaultPartIndex(score: Score): number {
  const i = score.parts.findIndex((p) => p.staffCount === 1 && !p.grandStaff);
  return i >= 0 ? i : 0;
}

function clefName(instrument: Instrument): string {
  if (instrument.keepClef) return 'clef unchanged';
  const { sign, line, octaveChange } = instrument.clef;
  return CLEF_NAMES[`${sign}${line}${octaveChange ? octaveChange : ''}`] ?? `${sign} clef on line ${line}`;
}

function describeOctaves(octaves: number, fitted: boolean): string {
  const n = Math.abs(octaves);
  return `${n} octave${n === 1 ? '' : 's'} ${octaves > 0 ? 'up' : 'down'}${fitted ? ' to fit the range' : ''}`;
}

function sourceLabel(source: InstrumentDetection['source']): string {
  return source === 'part' ? 'part name' : source === 'file' ? 'file name' : source;
}

function clampKey(fifths: number): number {
  while (fifths > 7) fifths -= 12;
  while (fifths < -7) fifths += 12;
  return fifths;
}

/** A subtitle like "Viola (use with Solo)" should say "Clarinet in B♭ (use with Solo)". */
function renameInSubtitle(subtitle: string | undefined, source: Instrument, target: Instrument): string | undefined {
  if (!subtitle || target.keepClef) return subtitle;
  const found = matchInstrument(subtitle);
  if (found?.instrument.id !== source.id) return subtitle;
  if (normalizeInstrumentText(subtitle) === found.matched) return target.name;
  // The match came from normalized text, so it may not appear verbatim in the original.
  const re = new RegExp(found.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+'), 'i');
  return re.test(subtitle) ? subtitle.replace(re, target.name) : subtitle;
}

/** The host a failed link pointed at, for the error heading. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
