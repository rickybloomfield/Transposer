import { jsPDF } from 'jspdf';

const LETTER = { width: 612, height: 792 }; // points
const EXPORT_DPI = 300;
const RASTER_PAGE = { width: Math.round(8.5 * EXPORT_DPI), height: Math.round(11 * EXPORT_DPI) };

/** Convert rendered SVG pages into a US-letter PDF and return it as a Blob. */
export async function svgPagesToPdf(pages: string[], title?: string): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
  if (title) pdf.setProperties({ title });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    const png = await svgPageToPngDataUrl(pages[i]);
    pdf.addImage(png, 'PNG', 0, 0, LETTER.width, LETTER.height, undefined, 'FAST');
  }
  return pdf.output('blob');
}

function svgPageToPngDataUrl(svg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = RASTER_PAGE.width;
        canvas.height = RASTER_PAGE.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create a canvas for PDF export.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not render the score page for PDF export.'));
    };
    img.src = url;
  });
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
