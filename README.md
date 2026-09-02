# Music Transposer

A small web app that transposes **Personal Composer (.pc)** and **Dorico (.dorico)** sheet music
to any key in the browser — or re-notates a part for a different instrument, picking the right key
signature and clef — shows a preview, and lets you download the result as a **PDF** or as
**MusicXML**. Nothing is uploaded anywhere; all parsing, transposition and engraving happen in
your browser.

## Using it

1. Download the `.pc` (or `.dorico`) version of a song.
2. Open the app, drop the file on the page (or click **Choose a file**).
3. Pick the key you want in **Transpose to**. The preview updates.
4. Click **Download PDF**, **Download MusicXML**, or **Print**.

The MusicXML file can be opened in MuseScore, Dorico, Finale, Sibelius and most other notation
programs if you want to edit the music further.

## Linking to a song

A `?score=` parameter opens a web-hosted file straight away, so a song's download page can link
visitors to it already loaded:

```
https://rickybloomfield.github.io/Transposer/?score=https://defordmusic.com/wp-content/uploads/1b-solo-be-still-my-soul-viola.pdf
```

The parameter takes the URL of the **PDF**, the `.pc` or the `.dorico`. Given a PDF — usually the
link the visitor was already looking at — the app cannot read it (there is no music recognition
here) and instead looks for the `.pc`, then the `.dorico`, published beside it under the same name.
Any query string is kept, so a `?ver=` cache-buster survives the swap. `?url=` and `?file=` are
accepted as aliases.

The address must be `https`, and the file has to be readable across origins:

> **Site owners:** browsers refuse to let one site read another's files unless the response carries
> an `Access-Control-Allow-Origin` header. Serve the score files with `Access-Control-Allow-Origin: *`
> — on Apache, in an `.htaccess` next to them:
>
> ```apache
> <FilesMatch "\.(pc|dorico)$">
>   Header set Access-Control-Allow-Origin "*"
> </FilesMatch>
> ```

Without that header the link still works, just not in one step: the app explains what happened and
offers the file for download, and the visitor drops it on the page. Nothing is proxied through a
third party either way, so a linked score is still parsed only in the visitor's browser.

## Transposing for another instrument

**Written for** and **Transpose for** re-notate a part for a different instrument. Say the file is a
viola part in F major: choose **Trumpet in B♭** and the music comes back in G major on a treble
clef, sounding exactly as it did before. The list covers the orchestra and the concert band —
woodwinds, brass, pitched percussion, keyboards, strings and voices.

- The instrument the file is already written for is guessed from the part name, the subtitle, the
  file name or the title, in that order; **Written for** overrides the guess. "Clarinet in B♭",
  "Bb Clarinet" and "B-flat Clarinet" are all recognized.
- **Transpose to** then shows the key the new part will be *read* in. The status line underneath
  the toolbar also reports what it *sounds* like.
- **Octave** defaults to **Fit range**, which shifts the part by whole octaves when it would
  otherwise sit outside the new instrument's comfortable range (a violin line handed to a tuba, for
  example). Pick an explicit shift to override it.
- With more than one part, **Instrument part** chooses which one is re-notated; the rest keep their
  own key, so a B♭ trumpet part and its concert-pitch piano accompaniment print together correctly.
  Changing **Transpose to** still moves the whole score.
- Up-bow and down-bow marks are dropped when the part moves to something that is not played with a
  bow. Other articulations on the same note are left alone.
- The exported MusicXML carries a `<transpose>` element, so MuseScore, Dorico, Finale and Sibelius
  know the part is a transposing one and can switch it to concert pitch themselves.

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
  the 7-sharps/7-flats range. `instruments.ts` carries the instrument table — each entry's
  transposition, usual clef, playing range and the patterns used to recognize its name.
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
- Re-notating a part replaces its clef throughout, so clef changes that suited the old instrument
  (a cello's tenor-clef passage, say) are dropped. Multi-measure rests are also spelled out once the
  parts of a score end up in different keys, because Verovio otherwise leaves the key signature off
  those systems.
- Dorico import handles notes, rests, ties, lyrics, dynamics, hairpins, clefs, key and time
  signatures, tempo text and fermatas. Slurs, tuplets other than triplets, grace notes and
  chord symbols are not imported yet.

## Test files

`test/fixtures` contains a few small `.pc` part files and one `.dorico` file used only to test the
parsers.
