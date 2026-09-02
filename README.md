# Music Transposer

A small web app that transposes **Personal Composer (.pc)** and **Dorico (.dorico)** sheet music
to any key in the browser, shows a preview, and lets you download the result as a **PDF** or as
**MusicXML**. Nothing is uploaded anywhere; all parsing, transposition and engraving happen in
your browser.

## Using it

1. Download the `.pc` (or `.dorico`) version of a song.
2. Open the app, drop the file on the page (or click **Choose a file**).
3. Pick the key you want in **Transpose to**. The preview updates.
4. Click **Download PDF**, **Download MusicXML**, or **Print**.

The MusicXML file can be opened in MuseScore, Dorico, Finale, Sibelius and most other notation
programs if you want to edit the music further.

## Developing

```bash
npm install
npm run dev      # local dev server
npm test         # parser tests against the sample files in test/fixtures
npm run build    # production build in dist/
```

`node tools/render-check.mjs dist-test` renders generated MusicXML with Verovio in Node to catch
layout errors.

## Publishing on GitHub Pages

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds the
site and publishes it to GitHub Pages on every push to `main`.

1. Create a GitHub repository and push this code to its `main` branch.
2. In the repository settings open **Pages** and set **Source** to **GitHub Actions**.
3. Push (or re-run the workflow). The site appears at `https://<user>.github.io/<repo>/`.

The build sets the base path from the repository name automatically.

## How it works

- `src/pc/parsePc.ts` reads the undocumented Personal Composer binary format. The layout was
  reverse engineered from sample files; the findings are written up in
  [docs/pc-format.md](docs/pc-format.md).
- `src/dorico/parseDorico.ts` unzips a `.dorico` project and decodes the `score.dtn` property tree
  (`src/dorico/dtn.ts`), then re-notates the note events (Dorico stores notes as start/duration
  pairs, not as notated values). This importer is newer and less tested than the `.pc` one.
- `src/model/` holds a small MusicXML-like score model and the transposition logic
  (`pitch.ts`, `transpose.ts`), including enharmonic simplification when a key change would leave
  the 7-sharps/7-flats range.
- `src/musicxml/writeMusicXml.ts` serializes the model as MusicXML 3.1, which is what you download
  and also what is handed to [Verovio](https://www.verovio.org/) for engraving.
- `src/render/` renders pages with Verovio (WebAssembly) and turns the SVG pages into a PDF with
  jsPDF and svg2pdf.js.

## Known limitations

- Slurs that cross measures are matched heuristically; hairpins always span the measure they
  start in. Layout (system breaks, spacing) is Verovio's, not the original file's.
- Repeats, endings, segno/coda signs and a few music-font symbols are mapped from what was found
  in the sample files; unusual markings may be dropped (the app lists what it skipped).
- Only Personal Composer version 3 files (format byte 0x29) are fully supported. Older files load
  with a warning and may be incomplete.
- Dorico import handles notes, rests, ties, lyrics, dynamics, hairpins, clefs, key and time
  signatures, tempo text and fermatas. Slurs, tuplets other than triplets, grace notes and
  chord symbols are not imported yet.

## Test files

`test/fixtures` contains a few small `.pc` part files and one `.dorico` file used only to test the
parsers.
