import type { VerovioToolkit } from 'verovio/esm';

let toolkitPromise: Promise<VerovioToolkit> | undefined;

/** Lazily load the Verovio WebAssembly toolkit (about 7 MB; cached by the browser). */
export function getVerovio(): Promise<VerovioToolkit> {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const [{ default: createVerovioModule }, { VerovioToolkit }] = await Promise.all([
        import('verovio/wasm'),
        import('verovio/esm'),
      ]);
      const module = await createVerovioModule();
      return new VerovioToolkit(module);
    })();
  }
  return toolkitPromise;
}

export interface RenderOptions {
  /** 100 is the default horizontal density. Lower fits more measures, higher fits fewer. */
  musicSpacing?: number;
  /** 100 is the default staff and note size. */
  musicSize?: number;
}

export interface RenderResult { pages: string[] }

export const DEFAULT_MUSIC_SIZE = 100;
export const DEFAULT_MUSIC_SPACING = 100;
export const MIN_MUSIC_SIZE = 70;
export const MAX_MUSIC_SIZE = 130;
export const MIN_MUSIC_SPACING = 70;
export const MAX_MUSIC_SPACING = 130;
const DEFAULT_SPACING_LINEAR = 0.24;
const DEFAULT_UNIT = 9;

export function musicSpacingToSpacingLinear(musicSpacing = DEFAULT_MUSIC_SPACING): number {
  const clamped = Math.min(MAX_MUSIC_SPACING, Math.max(MIN_MUSIC_SPACING, musicSpacing));
  return Number((DEFAULT_SPACING_LINEAR * (clamped / DEFAULT_MUSIC_SPACING)).toFixed(3));
}

export function musicSizeToUnit(musicSize = DEFAULT_MUSIC_SIZE): number {
  const clamped = Math.min(MAX_MUSIC_SIZE, Math.max(MIN_MUSIC_SIZE, musicSize));
  return Number((DEFAULT_UNIT * (clamped / DEFAULT_MUSIC_SIZE)).toFixed(2));
}

/** Render MusicXML to one SVG string per US-letter page. */
export async function renderMusicXml(xml: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const tk = await getVerovio();
  tk.setOptions({
    pageWidth: 2159,
    pageHeight: 2794,
    pageMarginLeft: 110,
    pageMarginRight: 110,
    pageMarginTop: 220,
    pageMarginBottom: 90,
    scale: 40,
    unit: musicSizeToUnit(opts.musicSize),
    breaks: 'auto',
    header: 'auto',
    footer: 'none',
    svgViewBox: true,
    adjustPageHeight: false,
    justifyVertically: false,
    lyricSize: 4.2,
    spacingLinear: musicSpacingToSpacingLinear(opts.musicSpacing),
    spacingSystem: 2,
    spacingStaff: 9,
    condense: 'none',
    font: 'Leipzig',
  });
  const ok = tk.loadData(xml);
  if (!ok) throw new Error('The music could not be laid out for display.');
  const count = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= count; i++) pages.push(polishRenderedSvg(tk.renderToSVG(i)));
  return { pages };
}

function polishRenderedSvg(svg: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return svg;
  emphasizePageHeader(doc);
  return new XMLSerializer().serializeToString(doc);
}

function emphasizePageHeader(doc: XMLDocument): void {
  const header = doc.querySelector('g.pgHead');
  if (!header) return;

  const texts = Array.from(header.children).filter((el): el is Element => el.tagName.toLowerCase() === 'text');
  styleHeaderLine(texts[0], '1100px', '250', true);
  styleHeaderLine(texts[1], '480px', '900', false);
}

function styleHeaderLine(text: Element | undefined, fontSize: string, y: string, title: boolean): void {
  if (!text) return;
  const rend = text.querySelector('tspan.rend');
  if (rend) {
    rend.setAttribute('y', y);
    rend.setAttribute('font-style', 'italic');
    if (title) rend.setAttribute('font-weight', 'bold');
  }
  for (const leaf of Array.from(text.querySelectorAll('tspan.text > tspan'))) leaf.setAttribute('font-size', fontSize);
}
