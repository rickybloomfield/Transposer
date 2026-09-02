// Renders MusicXML files with Verovio in Node and reports problems. Usage: node tools/render-check.mjs dir-or-files...
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

const args = process.argv.slice(2);
const files = [];
for (const a of args) {
  if (statSync(a).isDirectory()) for (const f of readdirSync(a)) if (f.endsWith('.musicxml')) files.push(join(a, f));
  else files.push(a);
}
const VerovioModule = await createVerovioModule();
const tk = new VerovioToolkit(VerovioModule);
tk.setOptions({ pageWidth: 2159, pageHeight: 2794, scale: 40, breaks: 'auto', header: 'auto', footer: 'auto', svgViewBox: true, adjustPageHeight: false });
for (const f of files) {
  const xml = readFileSync(f, 'utf8');
  const logs = [];
  const origLog = console.log, origWarn = console.warn, origErr = console.error;
  console.log = console.warn = console.error = (...m) => logs.push(m.join(' '));
  let ok = tk.loadData(xml);
  console.log = origLog; console.warn = origWarn; console.error = origErr;
  const pages = ok ? tk.getPageCount() : 0;
  const problems = logs.filter((l) => /warning|error/i.test(l));
  console.log(`${f.split('/').pop()}: loaded=${ok} pages=${pages} log lines=${logs.length} problems=${problems.length}`);
  for (const p of problems.slice(0, 8)) console.log('   ', p.slice(0, 200));
  if (ok && process.env.SVG_OUT) {
    for (let p = 1; p <= pages; p++) writeFileSync(join(process.env.SVG_OUT, `${f.split('/').pop().replace('.musicxml', '')}-p${p}.svg`), tk.renderToSVG(p));
  }
}
