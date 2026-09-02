# Personal Composer (.pc) file format notes

Everything below was reverse engineered from Personal Composer 3 files (format byte 0x29 at
offset 0x1b). All integers are little-endian. Offsets in note records are zero-based.

## Overall layout

| Section | Content |
| --- | --- |
| Header | `PersonalComposerForWindows\0`, format byte at 0x1b, default settings, font names, one 40-byte record per staff (MIDI channel at +6, program at +7, transposition in semitones at +4). |
| `STIK` | u32 count (unreliable), then one record per displayed measure. |
| `MUSE` | One block per (staff, measure) in staff-major order: all measures of staff 1, then staff 2, ... |
| `PAGE` | Page setup and, in most files, the free page texts (title, subtitle, credits, running header with `%page`). Some files leave this empty and keep the headings in the music instead — see [Headings](#headings). |
| `QFEX`, `UCHD`, `UIDS`, `VLOC`, `DYNA` | Trailing tables (dynamics table maps glyphs to velocity offsets). Bitmaps, if any, are embedded here. |

## STIK measure records (28 bytes + 8 × extras)

| Offset | Meaning |
| --- | --- |
| 2 | u16 measure width |
| 4 | u8 number of 8-byte layout extras following the record |
| 12 | u8 extra measures folded into a multi-measure rest (22-bar rest = 21) |
| 22 | u16 displayed measure number |
| 20..27 and each extra | a chain of layout entries; byte 6 of the **last** entry is the barline code: 1 double bar, 3 final bar, 5 forward repeat before the next measure, 6 backward repeat |

## MUSE measure blocks

Header (8 bytes): u32 whose low byte packs `(keySignature + 7) << 4 | clef` (clef 0 treble,
1 tenor, 2 alto, 3 bass, 15 percussion; key in fifths, so F major = 6, G major = 8); then u8 flags,
u8 time-signature numerator, u8 denominator code (0x0c whole, 0x0b half, 0x0a quarter, 0x09
eighth, 0x08 16th), u8 zero.

Then `u16 nItems` followed by the items, then two voices, each with four lists:
`u16 n` notes (28 bytes each), `u16 n` rests (10 bytes each), `u16 n` second-layer notes,
`u16 n` second-layer rests.

### Headings

Not every file puts its title in the `PAGE` block. `3b-satb-be-still-my-soul-vocal-parts.pc` has
no page texts at all and carries the title, subtitle and credits as ordinary 0x12 text items in
the first system's measures, mixed in with directions that really do belong to a staff.

The `y` of the text header separates them: a heading floats far above the system, a direction sits
next to its staff. Measured across the sample files:

| Text | Size | y | Kind |
| --- | --- | --- | --- |
| `Be Still, My Soul` | 0x320 | -2207 | title |
| `SATB (voice parts only)` | 0x14a | -1845 | subtitle |
| `Arrangement: Sally DeFord` | 0x140 | -1126 | credit (also matched by its `Label:` prefix) |
| `(sop. div.)` | 0x14a | -959 | direction |
| `Soprano/Alto unis.` | 0x14a | -939 | direction |
| `a tempo` | 0x168 | -737 | direction |
| `Tenor/Bass unis.` | 0x14a | +318 | direction |

Size alone will not do it: a subtitle and a direction can both be 0x14a. The parser treats text as
a heading when its size is at least 0x200 (title-sized) or its `y` is -1200 or less, which is
further above the staff than any direction in the samples. Where the page block left them empty,
the largest heading becomes the title and the next size down the subtitle.

### Items and note sub-records

Items start with a type byte, a sub byte (0 for measure items, 3 when attached to a note) and two
zero bytes. "Text-like" items share a 26-byte header (x at +6, y at +8, font at +10, size at +12,
style word at +14 whose high byte 0x02 marks the music font, glyph code at +24).

| Type | Size | Meaning |
| --- | --- | --- |
| 0x04 | 40 | slur (36 bytes of geometry; both ends carry identical geometry, which is how the ends are paired) |
| 0x05 | 12 | tie geometry |
| 0x07 | 40 | hairpin (first i16 positive = crescendo, negative = diminuendo) |
| 0x08 | 18 | line |
| 0x0e | 26 | unknown (piano parts) |
| 0x12 | 26 + string | text; if the style word marks the music font there is no string and the glyph code is a symbol (0xd8 fermata, 0x85 segno, 0xe2/0xe3 coda) |
| 0x15 | 36 | dynamic: glyph 0x9e pppp … 0xa2 mp, 0xac mf, 0xab f … 0xa8 ffff, 0xb8 sfz |
| 0x16 | 36 | symbol (unused) |
| 0x18 | 36 | tempo: glyph 0xf0 = metronome mark with the bpm as the u16 after the header; 0xb0 = "rit."; 0xd8/0xd9 = fermata |
| 0x1a | 36 | note symbol: 0x9d down-bow, 0x9c up-bow |
| 0x30 | variable | volta ending: string with the number, geometry terminated by `0b 00 01 00 <n> 00 00 00 00 00` |
| 0x31 | 26 + string + 20 | line with glyph |
| 0x32 | 26 + string | lyric syllable (trailing `-` continues the word, trailing `_` draws an extender) |
| 0x33 | 66 | tuplet bracket (the number is the glyph code) |

### Note record (28 bytes)

| Offset | Meaning |
| --- | --- |
| 0 | flags: 0x40 always set; 0x01 unbeamed; 0x02 an accidental follows the record (2 bytes: 0x98 sharp, 0xe8 natural, 0xa0 flat); a value of 0x00 marks a hidden note |
| 2 | 0x01 dotted, 0x10 tie end, 0x20 tie start, 0x80 tenuto |
| 5 | i8 staff position: diatonic steps below the bottom staff line (negative = above) |
| 12 | i16 stem/beam height in 1/64 steps (sign = stem direction) |
| 16 | u8 fractional start (1/256 of a 16th note; used for tuplets) |
| 17 | u8 start in 16th notes from the beginning of the measure |
| 18 | duration code: 0x0d breve, 0x0c whole, 0x0b half, 0x0a quarter, 0x09 eighth, 0x08 16th, 0x07 32nd |
| 24, 26 | u16 1-based indices of the previous/next note in the same beam group |

Chords are consecutive notes with the same start time. Pitch is derived from the staff position
and the block's clef; alteration from the key signature and the explicit accidental bytes,
applying the usual within-measure rule.

### Rest record (10 bytes)

`00 | start (16ths) | flags (bit 0 = dot) | duration code | 00 | i8 staff position | 00 00 00 | layer flag`.
A measure whose voices are all empty is a whole-measure rest.
