import { jsPDF } from 'jspdf';
import 'svg2pdf.js';

const LETTER = { width: 612, height: 792 }; // points

/** Convert rendered SVG pages into a US-letter PDF and return it as a Blob. */
export async function svgPagesToPdf(pages: string[], title?: string): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  if (title) pdf.setProperties({ title });
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      host.innerHTML = pages[i];
      const svg = host.querySelector('svg');
      if (!svg) continue;
      prepareSvgForPdf(svg);
      await pdf.svg(svg, { x: 0, y: 0, width: LETTER.width, height: LETTER.height });
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}

/** Normalise a Verovio SVG so svg2pdf can handle it (explicit size, resolved <use> symbols). */
function prepareSvgForPdf(svg: SVGSVGElement): void {
  svg.setAttribute('width', `${LETTER.width}`);
  svg.setAttribute('height', `${LETTER.height}`);
  const symbols = new Map<string, Element>();
  svg.querySelectorAll('symbol').forEach((s) => symbols.set(s.id, s));
  svg.querySelectorAll('use').forEach((use) => {
    const href = use.getAttribute('xlink:href') ?? use.getAttribute('href');
    if (!href?.startsWith('#')) return;
    const sym = symbols.get(href.slice(1));
    if (!sym) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const x = parseFloat(use.getAttribute('x') ?? '0');
    const y = parseFloat(use.getAttribute('y') ?? '0');
    const w = parseFloat(use.getAttribute('width') ?? '0');
    const h = parseFloat(use.getAttribute('height') ?? '0');
    const viewBox = sym.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? [0, 0, 1000, 1000];
    const sx = w ? w / viewBox[2] : 1;
    const sy = h ? h / viewBox[3] : 1;
    g.setAttribute('transform', `translate(${x},${y}) scale(${sx},${sy}) translate(${-viewBox[0]},${-viewBox[1]})`);
    for (const child of Array.from(sym.children)) g.appendChild(child.cloneNode(true));
    use.replaceWith(g);
  });
  svg.querySelectorAll('symbol').forEach((s) => s.remove());
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
