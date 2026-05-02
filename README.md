<br />
<br />

<p align="center">
  <img src="public/riha-logo.png" alt="rihaPDF" height="120" />
</p>

# rihaPDF

Browser-based PDF editor focused on Dhivehi / Thaana documents. Click any
text run on a page, type a replacement, save. The saved PDF contains
**real, selectable, searchable** text — original glyphs are surgically
removed from the content stream, not just covered with a whiteout.

## What works today

- **Edit any text run.** Click → input opens with a floating toolbar
  (font, size, B/I/U, RTL/LTR direction). Bold and italic overrides
  survive close/reopen. Source-detected style (Office's `Tr 2`
  fake-bold included) is the starting point; user toggles are tracked
  separately so an explicit _un_-bold sticks even if the run was
  source-bold. The direction button cycles auto → RTL → LTR → auto so
  the user can override the codepoint-based auto-detection on mixed
  / all-digit runs that misclassify (e.g. a numeric run inside a
  Dhivehi paragraph that should stay RTL). Toolbar auto-flips below
  the editor when sitting above would overlap a neighbouring run.
- **Move runs by dragging.** Drag any run; on release the saved PDF
  emits a fresh `Tm` placing the same glyphs at the new origin. The
  live preview canvas has the original Tj's stripped during the
  gesture so there's no double-render.
- **Cross-page move.** Drag a text run, source image, inserted text, or
  inserted image across the page boundary onto another page. Save
  strips the content from its origin page and re-draws it on the
  target — for source images this includes replicating the XObject
  reference into the target page's resources before emitting a fresh
  `q cm /Name Do Q`.
- **Insert text and images.** "+ Text" / "+ Image" toolbar tools drop
  a placement cursor; click anywhere on a page to land the new item.
  Inserted text gets the same formatting toolbar as edits.
- **Move + resize images.** Source-PDF images and inserted images both
  expose 4 corner handles; drag to resize (anchored opposite corner)
  or drag the body to translate. For source images the gesture is
  saved as a single outermost `cm [sx 0 0 sy ex ey]` injected after
  the image's `q`, so original transforms (rotation, etc.) are
  preserved verbatim.
- **Multi-page docs.** Per-page preview canvas rebuild on every edit;
  the strip-and-re-render path runs through pdf-lib + pdf.js so the
  HTML overlays never need to mask anything.
- **Delete any object.** Click a source image or inserted image →
  press `Del` / `Backspace` to remove it. Source text runs and
  inserted text get a trash button on the floating edit toolbar that
  does the same. Save strips deleted source text runs from the
  content stream and removes deleted images' `q…Q` blocks; deleted
  inserted items just don't reach save. The keyboard handler bails
  out when an `<input>` is focused so it never hijacks text editing.
- **Undo / redo.** Header buttons (and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y)
  step through every document mutation: text edits / moves / deletes,
  image moves / resizes / deletes, inserted text and image add / edit /
  delete, shape deletes, page reorder / insert / remove, and external
  PDF additions. Continuous gestures coalesce — typing in one field is
  one undo step, dragging an image is one undo step — but each new
  field, each new drag, each click-to-place is its own step. While a
  text input is focused, Ctrl+Z falls through to the browser's native
  per-character undo so the inside of one edit field still steps
  keystroke-by-keystroke. History clears on opening a new file.
- **Page sidebar with reorder, delete, insert blank, insert from PDF.**
  Left rail shows a thumbnail per page. Drag thumbs to reorder
  (`@dnd-kit`), hover to delete, click `+ Blank` to insert a fresh
  page anywhere, click `+ From PDF` to merge pages from any other PDF.
  External pages are first-class: every editing affordance (text edit,
  text/image insert, drag-move, cross-page and cross-source moves)
  works on them too, since they share the same load + save pipeline as
  the primary file. Save walks the slot list and rebuilds the output
  via `PDFDocument.copyPages` so reorder + insert + delete all compose
  cleanly with edits applied to whichever source the slot points at.
- **Live full-pixel font fallback.** 38 bundled Dhivehi families plus
  Noto Sans Thaana ship as `@font-face` (`local()` first → user's
  installed copy wins). The save path embeds whichever family the
  user selected with `subset: false` so glyph IDs round-trip.
- **Dark theme.** Top-bar segmented toggle (system / light / dark) —
  defaults to system and tracks `prefers-color-scheme` live; light/dark
  pin the result and persist across reloads. Implemented as a `.dark`
  class on `<html>` driven by [src/lib/theme.ts](src/lib/theme.ts), so a
  single class flip wires both Tailwind v4's `dark:` variant and
  HeroUI's `.dark, [data-theme=dark]` rules without conflict.
- **Mobile / phone layout.** Each page fits the viewport width via a
  CSS-transform on the inner natural-size container, so a US-Letter
  page on a 390px-wide phone shrinks to fit instead of horizontally
  scrolling. Pointer events convert screen-pixel deltas through the
  fit-to-width scale so drag distances stay visually 1:1. One-finger
  drags on overlays use `touch-action: pinch-zoom` so two-finger pinch
  still passes through to the browser's native zoom. Page sidebar
  collapses behind a hamburger button on small viewports. Header and
  edit-toolbar are anchored to the visual viewport (not the layout
  viewport) via [src/lib/useVisualViewport.ts](src/lib/useVisualViewport.ts),
  so they stay above the soft keyboard and at constant visual size
  during pinch-zoom across both iOS Safari and Chromium-based mobile
  browsers.
- **Phonetic Latin → Thaana keyboard.** Mobile devices rarely have a
  system Dhivehi keyboard, so the edit input rewrites each Latin
  keystroke to the corresponding Thaana codepoint using the well-known
  Mahaa keymap (mihaaru.com / vaguthu.mv). A `DV` / `EN` toggle on the
  edit toolbar flips between transliterated input (Faruma editing) and
  raw passthrough (digits, Latin words). Implemented in
  [src/lib/thaanaKeyboard.ts](src/lib/thaanaKeyboard.ts).

## Stack

- **Vite + React + TypeScript** — UI shell
- **pdf.js** — page rendering + text extraction
- **pdf-lib** — page operations + font embedding + saving (also handles
  the Thaana save path via `drawText`; see _Thaana shaping_ below)
- **HeroUI v3 + Tailwind v4 + lucide-react** — component library / styling / icons
- **@dnd-kit** — sortable thumbnails in the page sidebar
- **38 bundled Dhivehi fonts + Noto Sans Thaana** — every common Thaana
  font is shipped via `@font-face`, with `local()` first so a user's
  OS-installed copy wins.

`harfbuzzjs` and `bidi-js` are listed in `package.json` as scaffolding
for the future raw-operator save path (see TODO → _HarfBuzz-shaped
output_). Neither is imported by the live code today —
[src/lib/shape.ts](src/lib/shape.ts) wraps harfbuzzjs but has no
callers. Saved PDFs use pdf-lib's `drawText`, which means no GPOS mark
positioning and no BiDi reordering at save time. See _Thaana shaping_
under Known limitations for what this means in practice.

## Quick start

```bash
pnpm install
pnpm dev
```

Open the local URL Vite prints, click **Open PDF**, click any text fragment
to edit, hit **Save** to download.

Test fixtures live in [test/fixtures/](test/fixtures/):

- `maldivian.pdf` — real Maldivian doc with the broken-aabaafili
  ToUnicode CMap (the canonical Thaana-recovery + edit/move test bed).
- `with-images.pdf` — synthetic A4 page with two PNG images,
  generated by `node test/fixtures/build.mjs`. Used by the
  image-move + preview-strip + insert tests.
- `with-images-multipage.pdf` — two-page synthetic fixture with one
  identifiable image and label per page; same builder. Used by the
  cross-page move tests.
- `external-source.pdf` — two-page fixture with distinct labels, an
  editable Helvetica run, and a green image. Used by the
  external-first-class tests as the file dropped into `+ From PDF` so
  edits / inserts / cross-source drags can be verified end-to-end.

## Architecture

````
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

The page renderer is split into per-concern modules under
[src/components/PdfPage/](src/components/PdfPage/) — `index.tsx` owns
the page chrome and the run/image gesture wiring; `EditField.tsx` is
the click-to-edit input; `EditTextToolbar.tsx` is the floating
formatting toolbar shared between source-run edits and inserted-text
overlays; `overlays.tsx` is the source-image, inserted-text, and
inserted-image overlays plus the corner resize handles; `helpers.ts`
holds the cross-page hit-test, the toolbar smart-flip, and a couple of
focus-tracking helpers; `types.ts` is the EditValue / ImageMoveValue
shape that App.tsx persists per slot.

## Adding a new Dhivehi font

1. Drop the `.ttf` into `public/fonts/dhivehi/` (slugified filename, e.g.
   `myfont.ttf`).
2. Append one row to the `FONTS` list in
   [src/lib/fonts.ts](src/lib/fonts.ts):
   ```ts
   { family: "MV MyFont", label: "MV MyFont", localAliases: ["MV MyFont"],
     url: "/fonts/dhivehi/myfont.ttf" },
````

3. That's it — the @font-face rule, the editor font picker, and the save
   pipeline all read from this list.

## Known limitations

- **Thaana shaping in saved PDFs is approximate.** pdf-lib's `drawText`
  encodes Unicode → CID via the font's cmap but doesn't apply GPOS
  mark-to-base positioning, GSUB substitutions, or BiDi reordering.
  Most bundled Dhivehi fonts ship zero-advance combining marks in
  `hmtx`, so fili stack on the preceding base and saved output looks
  correct on typical text — but fili can sit at a fixed offset from the
  cursor instead of being anchored to the base consonant's GPOS anchor,
  which is visible on wider consonants and stacked-fili clusters. The
  fix is the raw-operator emit path described in the TODO; it is
  blocked on pdf-lib renumbering glyph IDs during embed even with
  `subset: false`, so HarfBuzz-shaped CIDs cannot be written through
  `drawText`.
- **Italic carries to editor preview only** — saved PDF italic needs
  raw-operator emission (a `Tm` with a shear matrix); same code path as
  the HarfBuzz work above, deferred together.

## Scripts

```bash
pnpm dev            # vite dev server (localhost:5173)
pnpm build          # tsc + vite build → dist/
pnpm check          # tsc -b && prettier --check && eslint  (CI gate)
pnpm lint           # eslint .
pnpm format         # prettier --write .
pnpm format:check   # prettier --check . (no writes)
pnpm test           # vitest E2E suite (needs dev server up)
pnpm test:fixtures  # rebuild test/fixtures/with-images*.pdf
pnpm cf:dev         # wrangler dev — local Workers preview of dist/
pnpm cf:deploy      # build + wrangler deploy → Cloudflare Workers
```

## Deploy (Cloudflare Workers)

Ships as a Cloudflare Worker via Workers Static Assets — `dist/` is
uploaded and served with SPA fallback (`not_found_handling:
"single-page-application"`), so client-side routes resolve to
`index.html` instead of 404.

The real [wrangler.jsonc](wrangler.jsonc) is **gitignored** because it
carries a per-developer `account_id` (and optional custom-domain
`routes`). Bootstrap your own from the committed template:

```bash
cp wrangler.jsonc.template wrangler.jsonc
# edit account_id (find it with `pnpm exec wrangler whoami`),
# or omit it and rely on `wrangler login` to pick the right account.
pnpm exec wrangler login   # first time only
pnpm cf:deploy             # pnpm build && wrangler deploy
```

## Tests

End-to-end vitest suite under [test/e2e/](test/e2e/) drives the running
dev server through Playwright. Start the dev server in one terminal,
run the suite in another:

```bash
pnpm dev          # in one terminal
pnpm test         # in another — runs every spec
```

| File                               | What it covers                                                              |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `move-edit.test.ts`                | move-only / edit-only / move+edit on the Maldivian PDF                      |
| `image-move.test.ts`               | drag image → cm rewrite, neighbours untouched                               |
| `image-resize.test.ts`             | corner-drag resize anchors the opposite corner across save+reload           |
| `preview-strip.test.ts`            | original glyphs removed from canvas during edits (no whiteout cover)        |
| `preview-strip-paragraph.test.ts`  | every line under agenda item 6 strips cleanly when dragged                  |
| `edit-text-includes-punct.test.ts` | parens / slash / digits land in the edit box for the 14/2019 line           |
| `edit-format.test.ts`              | bold OFF override persists across editor close/reopen (existing + inserted) |
| `insert.test.ts`                   | drop text + image → both persist after save                                 |
| `insert-format.test.ts`            | font / size / bold round-trip from the inserted-text toolbar                |
| `cross-page-move.test.ts`          | drag text run / source image / inserted text / inserted image across pages  |
| `delete-objects.test.ts`           | source image, inserted image, source text, inserted text — all deletable    |
| `external-first-class.test.ts`     | external pages: edit run, insert text/image, cross-source drag round-trip   |
| `theme.test.ts`                    | system default + override, OS-flip tracking, persistence across reload      |
| `undo.test.ts`                     | every recordable mutation undoes + redoes; coalescing, redo-clear-on-branch |

Diagnostic scripts (kept around for one-off inspection, not part of CI)
live in [scripts/](scripts/): `dumpItems.mjs`, `dumpRuns.mjs`,
`dumpToUnicode.mjs`, `dumpFontGlyphs.mjs`, `probeOverlayCoverage.mjs`,
`filiCoverage.mjs`, `dumpPage2Runs.mjs`, etc. Same
dev-server-on-localhost:5173 assumption.

## Recently shipped

- [x] **Undo / redo with debounce-and-replace coalescing.** Snapshot
      stack covering all seven document-state slices (edits,
      imageMoves, insertedTexts, insertedImages, shapeDeletes, slots,
      sources). Each mutating callback in `App.tsx` calls
      `recordHistory(coalesceKey)` before its setter; same-key calls
      within 500ms reuse the original pre-change snapshot, so a typing
      session or a drag is one undo step. Ctrl/Cmd+Z and
      Ctrl/Cmd+Shift+Z are wired at the window level but bail when an
      input is focused, leaving native per-character undo intact
      inside an edit field. Selection / tool / pendingImage are
      excluded from snapshots — UI state, not document state.
- [x] **PdfPage refactor.** The 2358-line `PdfPage.tsx` got split into
      six per-concern files under
      [src/components/PdfPage/](src/components/PdfPage/) — types,
      helpers, EditTextToolbar, EditField, overlays, and a thinner
      index that now owns only the page chrome and gesture wiring.
      Public surface (`PdfPage`, `EditValue`, `ImageMoveValue`) is
      preserved via folder-index re-exports, so `App.tsx` is unchanged.
- [x] **Mobile view.** Pages fit-to-width on phones via a CSS-transform
      on the inner natural-size container, with pointer-event deltas
      converted through the fit scale so drag distances stay 1:1.
      Overlays use `touch-action: pinch-zoom` so two-finger pinch zooms
      the document while one-finger drag still fires `pointermove`. The
      page sidebar collapses behind a hamburger on small viewports.
- [x] **Toolbar smart-flip.** The floating formatting toolbar
      defaults above the editor but flips below when sitting above
      would overlap a neighbouring run/insertion on the same page.
- [x] **Explicit RTL/LTR override on the edit toolbar.** A direction
      button cycles auto → RTL → LTR → auto so the user can pin
      direction on runs that the codepoint-based auto-detector
      misclassifies (e.g. all-digit runs inside a Dhivehi paragraph
      that should stay RTL).
- [x] **Cloudflare Workers deploy.** `pnpm cf:deploy` ships the built
      bundle as a Worker via Workers Static Assets with SPA fallback;
      live at <https://rihapdf.ibrahim-yashau.workers.dev>.
- [x] **First-class external pages.** "+ From PDF" now goes through the
      same `loadSource` extraction (fonts, glyph maps, images, runs) as
      the primary file. The slot model collapsed `original` + `external`
      into a single `kind: "page"` carrying `(sourceKey, sourcePageIndex)`,
      and `Edit / ImageMove / TextInsert / ImageInsert` all carry a
      `sourceKey`. Save loads each source's `PDFDocument` once, runs the
      content-stream surgery per source, then `output.copyPages` from
      every source in slot order. Cross-source text drags round-trip
      via `drawText` on the target source's doc; cross-source image
      drags re-embed the origin's pixel bytes on the target.
- [x] **Dark theme with system override.** Three-way toolbar toggle
      (system / light / dark) that defaults to system and tracks
      `prefers-color-scheme` live via `matchMedia`. The user's pick
      persists in localStorage and pins the result regardless of OS
      theme. Implemented as a Tailwind v4 `@custom-variant` keyed off a
      `.dark` class on `<html>` — the same class that activates HeroUI's
      built-in dark rules, so chrome and components flip together.
- [x] **Delete any object.** Source images and inserted images select
      on click and delete on `Del` / `Backspace`. Source text runs and
      inserted text get a trash button on the floating toolbar.
      Internally a `deleted: boolean` flag rides on `EditValue` /
      `ImageMoveValue`; save's existing strip path runs without the
      replacement-draw half. The keyboard handler `return`s when an
      `<input>` / `<textarea>` is focused so it doesn't hijack text
      editing.
- [x] **Page sidebar.** Slot model ([src/lib/slots.ts](src/lib/slots.ts))
      replaces the old append-only `pageOps`: every displayed page is
      a slot whose stable id keys all per-page state (edits, image
      moves, insertions). Reorder / delete / insert-blank /
      insert-from-PDF all mutate the slot list directly and the main
      view rerenders live. The save pipeline walks `slots[]` and
      rebuilds output via `PDFDocument.copyPages` from the original
      doc plus any external "insert from PDF" docs, so reorder
      composes cleanly with text/image edits applied to the source
      pages.
- [x] **Cross-page move.** Drag any movable thing — source text run,
      source image, inserted text box, inserted image — across the
      page boundary. Save strips on the origin page (q…Q removal for
      images, op-index strip for text) and re-emits on the target
      page; XObject refs are replicated into the target's resources
      via `page.node.newXObject` before the fresh `q cm /Name Do Q`.
- [x] **Image move + resize.** Both source-PDF images and inserted
      images. Resize uses a single outermost `cm` injected after `q`
      (subsumes the move-only translate as the `sx=sy=1` special
      case).
- [x] **Insert text and images.** Click-to-place tools with the same
      formatting toolbar used for source-run edits.
- [x] **Bold / italic overrides survive close+reopen** — `hasStyle`
      now uses `!== undefined` so explicit `false` doesn't get stripped
      on commit.
- [x] **Tj op-index threading.** `FontShow → TextItem → TextRun`
      carries content-stream op indices, so the strip pipeline knows
      exactly which Tj's to drop. Section-heading digits and
      paragraph punctuation now strip cleanly even when pdf.js
      buckets them into a different run.
- [x] **Long-vowel fili recovery (aabaafili U+07A7)** for Office's
      broken `bfrange [<07A6> <0020>]`. See
      [glyphMap.ts](src/lib/glyphMap.ts) +
      [pdf.ts](src/lib/pdf.ts).

## TODO

### Editing

- [ ] **Multi-line paragraph editing.** A paragraph that wraps across
      N visual lines is currently N separate runs — each clickable
      independently. Needs cross-line run merging keyed on indent +
      line-spacing, plus a multi-line input in `EditField`.
- [ ] **Caret-at-click instead of full select.** Editor pre-selects
      the whole run; a long line forces a full replace. Land the
      caret at the click position so the user can partial-edit.
- [ ] **Marquee select / multi-move (Phase C).** Drag-rectangle to
      select multiple runs, then move them as a group.

### Save pipeline

- [ ] **HarfBuzz-shaped output.** Replace pdf-lib's `drawText` for the
      Thaana path with a custom Type 0 / Identity-H emitter that takes
      pre-shaped glyph IDs from harfbuzzjs and writes raw Tj
      operators. Unblocks correct GPOS mark positioning.
- [ ] **Italic in saved PDFs.** Emit raw `Tm` with a shear matrix
      `(1, 0, tan(θ), 1, x, y)` for italic runs (currently italic is
      preview-only — visible in the editor, not in the saved file).
- [ ] **Underline / strikethrough as a re-editable property** carried
      on the run rather than a separate `drawLine` (today's path
      works but breaks if the run gets re-edited and the line stays).

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma
      lays out slightly wider than the embedded subset on the canvas,
      so `range.getBoundingClientRect` reports text overflowing the
      `[data-run-id]` box. Pointer-events still hit, but
      `probeOverlayCoverage.mjs` flags 37 runs on the test PDF.
- [ ] **Image / non-text glyph clusters in the coverage probe.** The
      bismillah calligraphy at the top of page 1 and the Maldives
      crest are detected as dark clusters and currently filtered by a
      height heuristic. Replace with an actual `<image>` op
      inspector.

### Document-level

- [ ] **Annotations** — rect, highlight, freehand.
- [ ] **Form fields** (text + checkbox).

### Source-PDF support

- [ ] **PDFs without `/ToUnicode`.** Fall through to the font's
      binary cmap (already wired) but those fonts often have a
      stripped cmap too. Need a glyph-name → codepoint table covering
      the common Maldivian Adobe glyph names beyond fili.
- [ ] **Smarter source-font matching.** Today the replacement run
      picks one of the bundled families based on `BaseFont` keyword
      hints; weight + width matching could be tighter.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.**
      They're purely ligature glyph fonts (no Unicode coverage) and
      shouldn't be selectable for replacement text.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true`
      but loses encryption on save; revisit if we ever target them.

### Long shots

- [ ] **Tables** detected and re-flowed (probably out of scope until
      we have a real model of the document).
- [ ] **Standalone desktop build** (Tauri / Electron wrapper) for
      offline workflows.
