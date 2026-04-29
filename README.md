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
- **Some long-vowel fili (esp. aabaafili U+07A7) are missing in
  extraction** for source PDFs whose ToUnicode CMap omits them. pdf.js
  fills the gap with a phantom space; we strip those before fili.
- **Italic carries to editor preview only** — saved PDF italic needs raw
  operator emission (Tm with shear matrix); deferred.

## Test scripts

```bash
node scripts/probe.mjs load     # multi-spot extraction sanity check
node scripts/probe.mjs edit     # click → editor → text match
node scripts/probe.mjs save     # full save round-trip
node scripts/diff.mjs           # visual diff: render / overlay / edit
node scripts/verifySaved.mjs    # render the saved PDF + dump runs
node scripts/dumpItems.mjs N    # raw pdf.js item dump for page N
```

All scripts assume Vite dev server at localhost:5173.

## Roadmap

- True HarfBuzz-shaped output (via custom Type 0 / Identity-H font writer
  that bypasses pdf-lib's glyph remapping)
- Italic in saved PDFs (Tm shear)
- Annotations (rect / highlight / freehand)
- Page reorder UI
- Better source-font detection so replacement runs match the surrounding
  text's font automatically
