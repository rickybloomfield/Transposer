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

export interface RenderResult { pages: string[] }

/** Render MusicXML to one SVG string per US-letter page. */
export async function renderMusicXml(xml: string): Promise<RenderResult> {
  const tk = await getVerovio();
  tk.setOptions({
    pageWidth: 2159,
    pageHeight: 2794,
    pageMarginLeft: 110,
    pageMarginRight: 110,
    pageMarginTop: 90,
    pageMarginBottom: 90,
    scale: 40,
    breaks: 'auto',
    header: 'auto',
    footer: 'none',
    svgViewBox: true,
    adjustPageHeight: false,
    justifyVertically: false,
    lyricSize: 4.2,
    spacingSystem: 7,
    spacingStaff: 9,
    condense: 'none',
    font: 'Leipzig',
  });
  const ok = tk.loadData(xml);
  if (!ok) throw new Error('The music could not be laid out for display.');
  const count = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= count; i++) pages.push(tk.renderToSVG(i));
  return { pages };
}
