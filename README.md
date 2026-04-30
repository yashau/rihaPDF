# Dhivehi PDF Editor

Browser-based PDF editor focused on Dhivehi / Thaana documents. Click any
text run on a page, type a replacement, save. The saved PDF contains
**real, selectable, searchable** text — original glyphs are surgically
removed from the content stream, not just covered with a whiteout.

## Stack

- **Vite + React + TypeScript** — UI shell
- **pdf.js** — page rendering + text extraction
- **pdf-lib** — page operations + font embedding + saving
- **harfbuzzjs** — Thaana shaping (used to compute layout widths)
- **bidi-js** — kept for future BiDi-aware reordering work
- **HeroUI v3 + Tailwind v4** — component library / styling
- **38 bundled Dhivehi fonts + Noto Sans Thaana** — every common Thaana
  font is shipped via `@font-face`, with `local()` first so a user's
  OS-installed copy wins.

## Quick start

```bash
pnpm install
pnpm dev
```

Open the local URL Vite prints, click **Open PDF**, click any text fragment
to edit, hit **Save** to download.

Test fixture: `../hn41badsfTXSpmf0opxlFBWgTLAJX5rWubbshJYC.pdf`.

## Architecture

```
load PDF
  → pdf.js renders each page to a canvas
  → getTextContent() returns positioned text items
  → buildTextRuns() merges adjacent items into editable runs
                    (RTL-aware sort, phantom-space cleanup)

edit
  → click on a transparent overlay span
  → input + floating toolbar (font picker, size, B/I/U)

save
  → for each edited run:
      1. parse the page's content stream into operations (contentStream.ts)
      2. find Tj / TJ ops whose text matrix lies inside the run's bbox
      3. delete those ops, re-serialise, replace page Contents
      4. embed the chosen font (subset:false)
      5. append a fresh content stream drawing the replacement via
         pdf-lib drawText (real text, encoded by pdf-lib)
  → Underline = a separate drawLine; bold = double-pass with x-offset for
    fonts without a bold variant; italic = CSS preview, doesn't carry to
    the saved PDF (deferred — needs raw operators with Tm shear).

The actual content-stream surgery is a small custom tokenizer / serializer
in [src/lib/contentStream.ts](src/lib/contentStream.ts) — pdf-lib doesn't
expose its parser publicly, so we read the raw bytes via
[src/lib/pageContent.ts](src/lib/pageContent.ts) and rewrite them.

## Adding a new Dhivehi font

1. Drop the `.ttf` into `public/fonts/dhivehi/` (slugified filename, e.g.
   `myfont.ttf`).
2. Append one row to the `FONTS` list in
   [src/lib/fonts.ts](src/lib/fonts.ts):
   ```ts
   { family: "MV MyFont", label: "MV MyFont", localAliases: ["MV MyFont"],
     url: "/fonts/dhivehi/myfont.ttf" },
   ```
3. That's it — the @font-face rule, the editor font picker, and the save
   pipeline all read from this list.

## Known limitations

- **Thaana shaping in saved PDFs is approximate.** pdf-lib's drawText
  encodes Unicode → CID via the font's cmap but doesn't apply GPOS mark
  positioning. Most bundled Dhivehi fonts have zero-advance combining
  marks in `hmtx`, so fili stack acceptably — but precise positioning
  (used by HarfBuzz) isn't applied. The full fix is to bypass pdf-lib's
  drawText and emit raw Tj operators with HarfBuzz-shaped glyph IDs;
  blocked on pdf-lib remapping glyph IDs even with `subset: false`.
- **Italic carries to editor preview only** — saved PDF italic needs raw
  operator emission (Tm with shear matrix); deferred.

## Test scripts

```bash
node scripts/probe.mjs load            # multi-spot extraction sanity check
node scripts/probe.mjs edit            # click → editor → text match
node scripts/probe.mjs save            # full save round-trip
node scripts/diff.mjs                  # visual diff: render / overlay / edit
node scripts/verifyMoveEdit.mjs        # move-only / edit-only / move+edit
node scripts/verifySaved.mjs           # render the saved PDF + dump runs
node scripts/probeOverlayCoverage.mjs  # whole-PDF overlay + click audit
node scripts/filiCoverage.mjs          # count every long-fili type per page
node scripts/dumpItems.mjs N           # raw pdf.js item dump for page N
node scripts/dumpRuns.mjs              # all built TextRuns
node scripts/dumpToUnicode.mjs         # raw + parsed /ToUnicode CMaps
node scripts/dumpFontGlyphs.mjs        # font binary cmap + glyph names
```

All scripts assume Vite dev server at localhost:5173.

## TODO

### Editing

- [ ] **Multi-line paragraph editing.** A paragraph that wraps across
      N visual lines is currently N separate runs — each clickable
      independently. The user can edit each line but not the paragraph
      as a single unit. Needs cross-line run merging keyed on indent +
      line-spacing, plus a multi-line input in `EditField`.
- [ ] **Better word/segment selection.** The editor opens with the run
      pre-selected (already wired via `inputRef.current.select()`), but
      a long line forces a full replace. Would be nice to land the
      caret at the click position and let the user partial-edit.
- [ ] **Marquee select / multi-move (Phase C).** Drag-rectangle to
      select multiple runs, then move them as a group.

### Save pipeline

- [ ] **HarfBuzz-shaped output.** Replace pdf-lib's `drawText` for the
      Thaana path with a custom Type 0 / Identity-H emitter that takes
      pre-shaped glyph IDs from harfbuzzjs and writes raw Tj operators.
      Unblocks correct GPOS mark positioning.
- [ ] **Italic in saved PDFs.** Emit raw `Tm` with a shear matrix
      `(1, 0, tan(θ), 1, x, y)` for italic runs.
- [ ] **Underline + strikethrough as text decorations** carried in the
      saved PDF (currently the underline path is a separate drawLine —
      works, but breaks if the run gets re-edited).

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma
      lays out slightly wider than the embedded subset on the canvas,
      so `range.getBoundingClientRect` reports text overflowing the
      `[data-run-id]` box. Pointer-events still hit (the inner span
      catches them), but `probeOverlayCoverage.mjs` flags 37 runs on
      the test PDF. Options: cap inner-span overflow with a CSS
      `clip-path`, or measure rendered text and grow the overlay to
      match.
- [ ] **Image / non-text glyph clusters in the coverage probe.** The
      bismillah calligraphy at the top of page 1 and the Maldives
      crest are detected as dark clusters and currently filtered by a
      height heuristic. Replace with an actual `<image>` op inspector.

### Save format / fonts

- [ ] **Image move (Phase B).** Extract image positions, drag, save
      with new `cm` operator.
- [ ] **Page reorder UI** (drag thumbnails to reorder, drop to merge).
- [ ] **Annotations** — rect, highlight, freehand.
- [ ] **Smarter source-font matching.** Today the replacement run
      picks one of the bundled families based on `BaseFont` keyword
      hints; weight + width matching could be tighter.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.**
      They're purely ligature glyph fonts (no Unicode coverage) and
      shouldn't be selectable for replacement text.

### Source-PDF support

- [x] ~~Long-vowel fili recovery (aabaafili U+07A7) for Office's
      broken `bfrange [<07A6> <0020>]`.~~ Done — see
      [glyphMap.ts](src/lib/glyphMap.ts) + show-driven decode in
      [pdf.ts](src/lib/pdf.ts).
- [ ] **PDFs without `/ToUnicode`.** Fall through to the font's
      binary cmap (already wired) but those fonts often have a
      stripped cmap too. Need a glyph-name → codepoint table covering
      the common Maldivian Adobe glyph names beyond fili.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true`
      but loses encryption on save; revisit if we ever target them.

### Long shots

- [ ] **Form fields** (text + checkbox).
- [ ] **Tables** detected and re-flowed (probably out of scope until
      we have a real model of the document).
- [ ] **Standalone desktop build** (Tauri / Electron wrapper) so the
      app can target offline workflows.
