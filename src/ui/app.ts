import { loadFile } from '../loaders';
import type { Score } from '../model/types';
import { keyName, intervalBetweenKeys, simplifyInterval, transposeKey, type Interval } from '../model/pitch';
import { initialKey, transposeScore } from '../model/transpose';
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

export class App {
  private score?: Score;
  private fileName = '';
  private pages: string[] = [];
  private currentXml = '';
  private el: Record<string, HTMLElement> = {};
  private renderToken = 0;
  private musicSpacing = DEFAULT_MUSIC_SPACING;
  private musicSize = DEFAULT_MUSIC_SIZE;

  constructor(private root: HTMLElement) {
    this.render();
    const sample = new URLSearchParams(location.search).get('sample');
    if (sample) void this.openExample(sample);
  }

  private render(): void {
    this.root.innerHTML = `
      <header class="site">
        <h1>Music Transposer</h1>
        <p>Transpose Personal Composer (.pc) and Dorico sheet music to any key, preview it, and download a PDF or MusicXML.
           Everything happens in your browser: your files are never uploaded.</p>
      </header>
      <main>
        <div class="dropzone" id="drop">
          <p class="primary">Drop a <strong>.pc</strong> or <strong>.dorico</strong> file here, or</p>
          <p><label class="button">Choose a file<input type="file" id="file" accept=".pc,.dorico" hidden></label></p>
          <p><button class="button secondary" id="example" type="button">Try an example file</button></p>
        </div>
        <div class="toolbar hidden" id="toolbar">
          <div class="fileinfo" id="fileinfo"></div>
          <label>Transpose to
            <select id="key"></select>
          </label>
          <label>Direction
            <select id="direction">
              <option value="auto">Closest</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
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
          <div class="spacer"></div>
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
    for (const id of ['drop', 'file', 'toolbar', 'fileinfo', 'key', 'direction', 'spacing-down', 'spacing-value', 'spacing-up', 'size-down', 'size-value', 'size-up', 'pdf', 'xml', 'print', 'clear', 'status', 'warnings', 'pages', 'example']) {
      this.el[id] = this.root.querySelector(`#${id}`) as HTMLElement;
    }
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
    this.el.key.addEventListener('change', () => void this.update());
    this.el.direction.addEventListener('change', () => void this.update());
    this.el['spacing-down'].addEventListener('click', () => this.setMusicSpacing(this.musicSpacing - MUSIC_SPACING_STEP));
    this.el['spacing-up'].addEventListener('click', () => this.setMusicSpacing(this.musicSpacing + MUSIC_SPACING_STEP));
    this.el['size-down'].addEventListener('click', () => this.setMusicSize(this.musicSize - MUSIC_SIZE_STEP));
    this.el['size-up'].addEventListener('click', () => this.setMusicSize(this.musicSize + MUSIC_SIZE_STEP));
    this.el.pdf.addEventListener('click', () => void this.downloadPdf());
    this.el.xml.addEventListener('click', () => this.downloadXml());
    this.el.print.addEventListener('click', () => this.print());
    this.el.clear.addEventListener('click', () => this.clear());
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
    this.el.drop.classList.remove('active');
    (this.el.file as HTMLInputElement).value = '';
    this.el.toolbar.classList.add('hidden');
    this.el.fileinfo.textContent = '';
    this.el.key.innerHTML = '';
    (this.el.direction as HTMLSelectElement).value = 'auto';
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
    this.setStatus(`Reading ${file.name}…`);
    try {
      const { score } = await loadFile(file);
      this.score = score;
      this.fileName = file.name.replace(/\.[^.]+$/, '');
      this.populateKeys();
      this.syncMusicSpacingControls();
      this.syncMusicSizeControls();
      this.showWarnings(score.warnings);
      const parts = score.parts.map((p) => p.name).join(', ');
      this.el.fileinfo.innerHTML = `<strong>${escapeHtml(score.title ?? file.name)}</strong>${score.subtitle ? ` — ${escapeHtml(score.subtitle)}` : ''}<br><span>${escapeHtml(parts)} · ${score.parts[0]?.measures.length ?? 0} measures · original key ${keyName(initialKey(score))}</span>`;
      this.el.toolbar.classList.remove('hidden');
      await this.update();
    } catch (e) {
      console.error(e);
      this.setStatus(`Could not open ${file.name}: ${(e as Error).message}`, true);
    }
  }

  private populateKeys(): void {
    if (!this.score) return;
    const from = initialKey(this.score);
    const select = this.el.key as HTMLSelectElement;
    select.innerHTML = '';
    for (const k of MAJOR_KEYS) {
      const iv = intervalBetweenKeys(from, k);
      const label = k === from ? `${keyName(k)} (original)` : `${keyName(k)} (${describeInterval(iv)})`;
      const opt = document.createElement('option');
      opt.value = String(k);
      opt.textContent = label;
      if (k === from) opt.selected = true;
      select.appendChild(opt);
    }
  }

  private showWarnings(warnings: string[]): void {
    const box = this.el.warnings as HTMLDetailsElement;
    if (!warnings.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.querySelector('summary')!.textContent = `${warnings.length} note${warnings.length === 1 ? '' : 's'} about this file`;
    box.querySelector('ul')!.innerHTML = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('');
  }

  private currentInterval(): Interval {
    if (!this.score) return { diatonic: 0, chromatic: 0 };
    const from = initialKey(this.score);
    const to = Number((this.el.key as HTMLSelectElement).value);
    const dir = (this.el.direction as HTMLSelectElement).value;
    const iv = intervalBetweenKeys(from, to, dir === 'auto' ? undefined : (dir as 'up' | 'down'));
    return simplifyInterval(from, iv);
  }

  private transposed(): Score {
    return transposeScore(this.score!, this.currentInterval());
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

  private async update(): Promise<void> {
    if (!this.score) return;
    const token = ++this.renderToken;
    const iv = this.currentInterval();
    const target = transposeKey(initialKey(this.score), iv);
    this.setStatus(iv.chromatic === 0 && iv.diatonic === 0 ? 'Rendering…' : `Transposing to ${keyName(target)} (${describeInterval(iv)}) and rendering…`);
    try {
      const score = this.transposed();
      const xml = writeMusicXml(score);
      const { pages } = await renderMusicXml(xml, { musicSpacing: this.musicSpacing, musicSize: this.musicSize });
      if (token !== this.renderToken) return;
      this.currentXml = xml;
      this.pages = pages;
      this.el.pages.innerHTML = pages.map((svg) => `<div class="page">${svg}</div>`).join('');
      this.setStatus(`${pages.length} page${pages.length === 1 ? '' : 's'} · ${keyName(target)}`);
    } catch (e) {
      console.error(e);
      this.setStatus(`Rendering failed: ${(e as Error).message}`, true);
    }
  }

  private suffix(): string {
    const target = transposeKey(initialKey(this.score!), this.currentInterval());
    return keyName(target).replace(' major', '').replace('♭', 'b').replace('♯', '#');
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

function describeInterval(iv: Interval): string {
  const n = iv.chromatic;
  if (n === 0) return 'same pitch';
  const abs = Math.abs(n);
  return `${n > 0 ? 'up' : 'down'} ${abs} semitone${abs === 1 ? '' : 's'}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
