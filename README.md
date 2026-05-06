<br />
<br />

<p align="center">
  <img src="public/riha-logo.png" alt="rihaPDF" height="120" />
</p>

# rihaPDF

[![CI](https://github.com/yashau/rihaPDF/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yashau/rihaPDF/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-105%20e2e-2ea44f)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=111111)
![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4-6e9f18?logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-e2e-2ead33?logo=playwright&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11-f69220?logo=pnpm&logoColor=white)

Browser-based PDF editor for Dhivehi / Thaana documents. Click any text run, edit in place, save. Saved PDFs contain **real, selectable, searchable** text — original glyphs are removed from the content stream, not whited out.

**100% client-side.** Your PDF is parsed, edited, and saved entirely in your browser. Nothing is uploaded; no server ever sees your file.

**Free forever. Apache-2.0 ([LICENSE](LICENSE)). No accounts, no tracking, no paywall.**

**Live demo:** <https://rihapdf.yashau.com>

## Features

- **Edit text runs.** Click → caret-positioned input + floating toolbar (font, size, B/I/U/S, RTL/LTR). Style overrides survive close/reopen.
- **Drag to move.** Any run, image, inserted item, or comment — within a page or across pages. Cross-page arrivals are re-draggable.
- **Insert text and images.** Click-to-place tools that share the edit toolbar.
- **Visual signatures.** Draw a signature with signing colour presets or import one from an image. Imported signatures are trimmed and background-cleaned, and saved signatures stay local in the browser for reuse. These are visual PDF image inserts only, not cryptographic PDF signatures.
- **Resize images.** 4 corner handles on source and inserted images, anchored opposite corner.
- **Delete anything.** `Del`/`Backspace` on selected images; trash button on the text toolbar.
- **Undo / redo.** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Coalesces typing and drags into single steps.
- **Page sidebar.** Thumbnail per page; reorder, delete, insert blank, or insert pages from another PDF. External pages are first-class — every editing affordance works on them.
- **230 bundled Thaana fonts.** Shipped via `@font-face` with `local()` first; saved PDFs embed the chosen family with `subset: false`. Sources, attributions, and per-file credits in [NOTICE](NOTICE) and [public/fonts/dhivehi/README.md](public/fonts/dhivehi/README.md).
- **Annotations.** Highlight, comment (FreeText), and freehand draw — saved as native `/Annot` objects so other tools recognise them.
- **Redact.** Click a text run to drop an opaque black rectangle; drag corners to resize. On save the rect paints into the content stream AND the underlying content is destroyed: glyphs are stripped per-bbox, supported raster image XObjects are rewritten with covered pixels blacked out, fully covered / unsupported image or Form XObject draws are removed, vector paint ops under the rect are stripped, native annotations are clipped or removed on overlap, and overlapped AcroForm widgets are removed with their field values and appearances. The saved file has no recoverable text, page-level image/vector draw data, annotation content, or form-widget value data under the rect for supported layers.
- **Fill AcroForm fields.** Open a form PDF — Maldivian gov applications, etc. — and the existing widgets become interactive overlays: text inputs (single-line, multiline, password), checkboxes, radio groups, combo / list boxes. Type Thaana via the same DV/EN phonetic keyboard the rest of the editor uses; saved PDFs write `/V` (UTF-16BE for Thaana, ASCII otherwise) and rebuild `/Root /AcroForm /Fields` after copyPages so the output stays interactive in Acrobat / Preview / Chrome / pdf.js. Reopening in rihaPDF re-extracts the same values. XFA, JS actions, `/AA`, and digital-signature creation are out of scope.
- **Phonetic Latin → Thaana keyboard.** `DV`/`EN` toggle on the edit toolbar maps Latin keystrokes to Thaana via the Mahaa keymap.
- **Dark theme.** System / light / dark toggle that tracks `prefers-color-scheme` and persists.
- **Installable app.** Chrome / Edge can install rihaPDF as a standalone PWA when served from HTTPS; supporting browsers expose the native install affordance and rihaPDF shows a compact install button when the browser permits it.
- **Mobile layout.** Fit-to-width pages, app-owned two-finger document zoom, 400ms touch hold before drag, edge-band auto-scroll, drawer sidebar, visual-viewport-anchored chrome for keyboard-aware controls.
- **Multi-page docs** with per-page preview canvases that strip-and-re-render on every edit.

## Stack

- **Vite + React + TypeScript** — UI
- **pdf.js** — page rendering + text extraction
- **pdf-lib** — page operations + font embedding + saving
- **HeroUI v3 + Tailwind v4 + lucide-react** — components / styling / icons
- **@dnd-kit** — sortable thumbnails

`harfbuzzjs` does the Thaana shaping at save time — replacement runs are shaped via HarfBuzz and emitted as raw `Tj` operators against a `subset: false` Type 0 font, so GPOS mark anchoring is correct ([shapedDraw.ts](src/lib/shapedDraw.ts)). `bidi-js` segments mixed-script runs by direction so each level-run shapes with its own font and direction ([shapedBidi.ts](src/lib/shapedBidi.ts)).

## Quick start

```bash
pnpm install
pnpm dev
```

Open the URL Vite prints, click **Open PDF**, click a text fragment, hit **Save**.

Test fixtures in [test/fixtures/](test/fixtures/):

- `maldivian.pdf` — real Maldivian doc with broken-aabaafili ToUnicode (canonical Thaana-recovery test bed).
- `with-images.pdf` / `with-images-multipage.pdf` — synthetic image fixtures (`node test/fixtures/build.mjs`).
- `external-source.pdf` — two-page fixture used by the `+ From PDF` tests.

## Architecture

```
load → pdf.js renders + getTextContent() → buildTextRuns() merges items into editable runs
edit → click an overlay span → input + floating toolbar
save → for each edited run:
       1. parse page content stream (contentStream.ts)
       2. find Tj/TJ ops inside the run's bbox, delete them
       3. embed chosen font (subset:false → CIDToGIDMap=Identity)
       4. shape replacement via HarfBuzz, emit raw Tj operators in
          logical order (shapedDraw.ts); mixed-script runs go through
          bidi-js segmentation first (shapedBidi.ts)
```

Underline / strikethrough are paired to runs at load time ([runDecorations.ts](src/lib/runDecorations.ts)) so toggling them off on re-edit strips the original line. Italic for fonts without an oblique variant is a shear-about-baseline `cm`. Bold without a bold variant is a double-pass with x-offset.

Content-stream surgery is a small custom tokenizer in [contentStream.ts](src/lib/contentStream.ts) — pdf-lib doesn't expose its parser publicly, so [pageContent.ts](src/lib/pageContent.ts) reads raw bytes and rewrites them.

The page renderer is split per concern under [src/components/PdfPage/](src/components/PdfPage/): `index.tsx` (page chrome + gesture wiring), `EditField.tsx`, `EditTextToolbar.tsx`, `overlays.tsx`, `helpers.ts`, `types.ts`.

`App.tsx` is a composition root over [AppHeader](src/components/AppHeader.tsx), [PageList](src/components/PageList.tsx), [PageWithToolbar](src/components/PageWithToolbar.tsx), and [AboutModal](src/components/AboutModal.tsx). State hooks live alongside lib code: [useUndoRedo](src/lib/useUndoRedo.ts), [usePreviewCanvases](src/lib/usePreviewCanvases.ts), [useSelection](src/lib/useSelection.ts), [useMobileChrome](src/lib/useMobileChrome.ts), [useDragGesture](src/lib/useDragGesture.ts). [buildSavePayload.ts](src/lib/buildSavePayload.ts) is the pure translator from slot list → `SourceSavePayload[]`.

## Adding a new Dhivehi font

1. Drop the `.ttf` into [public/fonts/dhivehi/](public/fonts/dhivehi/) (slugified filename).
2. Append a row to `FONTS` in [src/lib/fonts.ts](src/lib/fonts.ts):
   ```ts
   { family: "MV MyFont", label: "MV MyFont", localAliases: ["MV MyFont"],
     url: "/fonts/dhivehi/myfont.ttf" },
   ```

The `@font-face` rule, picker, and save pipeline all read from this list.

The bundled MV-prefix fonts are included as a fallback — `@font-face` lists `local()` first, so an OS-installed copy always wins. Font origins, attributions, and a contact path for rights-holder removal requests are documented in [public/fonts/dhivehi/README.md](public/fonts/dhivehi/README.md).

## Known limitations

- **Mixed-script text extraction is order-imperfect in some viewers.** When a single run mixes Thaana with Latin (e.g. `Hello ދިވެހި 42` typed into a `+ Text` insert), the saved PDF renders correctly visually — Latin segments via Helvetica, Thaana segments via HarfBuzz-shaped Faruma, segment ordering via `bidi-js` UAX #9 — but pdf.js's `getTextContent` and similar extractors that group adjacent Tj operators into compound items can swap base+mark order within RTL clusters when Latin items are in the same line. The visual output is correct; copy-paste / search may recover the same Unicode codepoints in slightly reordered positions. Pure-RTL or pure-LTR runs are unaffected. Fix path documented in [test/e2e/mixed-script.test.ts](test/e2e/mixed-script.test.ts) (one-Tj-per-cluster TJ-array emission, or post-extraction cluster repair).
- **Redaction non-text fallbacks are conservative.** Partial raster redaction is pixel-accurate for decoded 8-bit `/DeviceGray`, `/DeviceRGB`, and `/DeviceCMYK` image XObjects without masks: the saved PDF points at a new sanitized image stream and prunes the original XObject when it is no longer used. For masked images, unsupported image encodings / colour spaces, and Form XObjects, rihaPDF removes the whole draw if it overlaps the redaction. Vector paths are stripped at paint-op / detected q…Q block granularity, so a redaction over part of a complex path can remove more vector content than the visible rectangle covers. This is intentional: over-stripping is the safe failure mode.
- **Redaction fallback for unsupported fonts.** Non-Identity-H `/Type0` (vertical writing or custom CMap), `/Type3`, and Standard 14 fonts without an embedded `/Widths` table fall back to _whole-op stripping_ rather than per-glyph. The redaction stays correct (over-stripping is the safe failure mode) but a tightened rect over such an op may remove neighbouring glyphs that were outside the visual rect. In practice this only matters on very old / unusual PDFs — the maldivian2 fixture, Office output, and every browser-generated PDF we've tested take the per-glyph fast path.
- **Annotation and form redaction is geometry-first.** Text markup quads and ink strokes are clipped/split so portions outside the redaction survive. Text-bearing, unsupported annotation types, and overlapped AcroForm widgets are removed on overlap because their dictionaries can carry recoverable `/Contents`, `/V`, `/DV`, or appearance data. Partial form-field value redaction is not attempted; overlapping a widget removes the whole field.
- **Form widgets need a touched-field save path today.** Filled fields save with `/V` and rebuild `/Root /AcroForm /Fields`, but a form PDF saved after unrelated edits with no form-field changes may keep copied widget annotations without a rebuilt AcroForm field tree. Until the save path rebuilds AcroForm whenever copied widgets exist, make at least one form-field change before saving a fillable document that must remain interactive.

## Scripts

```bash
pnpm dev            # vite dev server (localhost:5173)
pnpm build          # tsc + vite build → dist/
pnpm check          # tsc -b && prettier --check && eslint  (CI gate)
pnpm lint           # eslint .
pnpm format         # prettier --write .
pnpm test           # vitest E2E suite (needs dev server up)
pnpm test:fixtures  # rebuild test/fixtures/with-images*.pdf
pnpm cf:dev         # wrangler dev — local Workers preview of dist/
pnpm cf:deploy      # build + wrangler deploy → Cloudflare Workers
```

## Deploy (Cloudflare Workers)

Ships as a Worker via Workers Static Assets with SPA fallback. The real [wrangler.jsonc](wrangler.jsonc) is gitignored (per-developer `account_id`); bootstrap from the template:

```bash
cp wrangler.jsonc.template wrangler.jsonc
# edit account_id, or rely on `wrangler login`
pnpm exec wrangler login   # first time only
pnpm cf:deploy
```

## Debugging on devices without devtools

Append `?debug=1` to any URL to install a fixed-position error overlay that surfaces uncaught errors, promise rejections, worker errors, and `console.error` output. Implemented in [errorOverlay.ts](src/lib/errorOverlay.ts); zero overhead when absent.

The About modal (`?` in the header) has a **Show browser diagnostics** toggle that lists feature-detection results plus whether `ReadableStream`'s async-iterator was native or polyfilled by [polyfills.ts](src/lib/polyfills.ts).

## Tests

E2E vitest suite under [test/e2e/](test/e2e/) drives the dev server through Playwright:

```bash
pnpm dev          # one terminal
pnpm test         # another
```

The suite includes visual-signature coverage for the local saved-signature library, draw/import cleanup, click-to-place insertion, and PDF image persistence.

| File                                          | What it covers                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `annotations.test.ts`                         | annotation save/move/delete; same-session ink redaction                       |
| `caret-at-click.test.ts`                      | click opens a collapsed caret inside a source run for partial edits           |
| `cross-page-move.test.ts`                     | drag text run / source image / inserted text / inserted image across pages    |
| `decoration-roundtrip.test.ts`                | underline + strikethrough save → reopen → toggle off → no orphan line         |
| `delete-objects.test.ts`                      | source image, inserted image, source text, inserted text — all deletable      |
| `delete-shape.test.ts`                        | click-select a vector rect, Del flags it, save drops it                       |
| `delete-source-text-maldivian2.test.ts`       | source-text trash button strips the run                                       |
| `drag-autoscroll.test.ts`                     | edge auto-scroll uses the visual viewport during drags                        |
| `edit-format-duplicate.test.ts`               | font-swap on Form-XObject text: outside-click commits, no duplicates          |
| `edit-format.test.ts`                         | bold OFF override persists across editor close/reopen                         |
| `edit-text-includes-punct-maldivian2.test.ts` | punctuation-clustering against maldivian2                                     |
| `edit-text-includes-punct.test.ts`            | parens / slash / digits land in the edit box                                  |
| `external-first-class.test.ts`                | external pages: edit run, insert text/image, cross-source drag round-trip     |
| `form-fill.test.ts`                           | AcroForm `/V` values round-trip and reopen with the same fills                |
| `image-move.test.ts`                          | drag image → cm rewrite, neighbours untouched                                 |
| `image-resize.test.ts`                        | corner-drag resize anchors the opposite corner across save+reload             |
| `insert-format.test.ts`                       | font / size / bold round-trip from the inserted-text toolbar                  |
| `insert.test.ts`                              | drop text + image → both persist after save                                   |
| `italic-save.test.ts`                         | italic toggle emits the shear `cm`; OFF run has none                          |
| `mixed-script.test.ts`                        | bidi-segmented insert (Latin + Thaana) round-trips every codepoint            |
| `mobile-edit.test.ts`                         | tap-to-edit, fixed-bottom toolbar, synthetic touch drag                       |
| `mobile-layout.test.ts`                       | 390×844 viewport: no horizontal overflow, drawer closed, app-owned pinch zoom |
| `mobile-positioning.test.ts`                  | mobile insert/drag positions persist in PDF coordinates                       |
| `move-edit-maldivian2.test.ts`                | move/edit flow against the second Maldivian fixture                           |
| `move-edit.test.ts`                           | move-only / edit-only / move+edit on the Maldivian PDF                        |
| `preview-strip-paragraph-maldivian2.test.ts`  | paragraph-strip coverage on maldivian2                                        |
| `preview-strip-paragraph.test.ts`             | every line under agenda item 6 strips cleanly                                 |
| `preview-strip.test.ts`                       | original glyphs removed from canvas during edits                              |
| `redact-maldivian2.test.ts`                   | partial rect preserves outside glyphs; full redaction → no recoverable bytes  |
| `save-redactions.test.ts`                     | image/vector/annotation/form content under redactions is sanitized            |
| `signature.test.ts`                           | visual signature draw/import → local library, cleanup, insert, save           |
| `source-font-detection.test.ts`               | source BaseFont selection keeps Thaana edit fields on the source font         |
| `theme.test.ts`                               | system default + override, OS-flip tracking, persistence                      |
| `undo.test.ts`                                | every recordable mutation undoes + redoes; coalescing                         |

One-off diagnostic scripts (not part of CI) live in [scripts/](scripts/).

## TODO

### Editing

- [ ] **Multi-line paragraph editing.** A wrapped paragraph is N separate runs today; needs cross-line merging keyed on indent + line-spacing plus a multi-line `EditField`.
- [x] **Caret-at-click instead of full select.** Land the caret at the click position so long lines can be partial-edited.
- [ ] **Marquee select / multi-move.** Drag-rectangle multi-select.

### Save pipeline

- [ ] **Logical-order text extraction for mixed-script saves.** HarfBuzz-shaped output ships in [shapedDraw.ts](src/lib/shapedDraw.ts) / [shapedBidi.ts](src/lib/shapedBidi.ts), but pdf.js's getTextContent reorders base+mark within RTL clusters when adjacent Latin items share the line — visual is correct, extraction is not. Either emit one Tj per cluster (TJ-array form for inter-glyph adjustments) so each cluster lands as a single TextItem, or repair after extraction by re-clustering on the recovered codepoints. See [test/e2e/mixed-script.test.ts](test/e2e/mixed-script.test.ts).
- [ ] **Partial form-widget redaction.** Redaction removes an overlapped AcroForm field as the safe default. A future version could split visual widget appearances or preserve non-overlapped widgets from the same field when that can be done without leaving `/V`/`/DV` recoverable.
- [ ] **Rebuild AcroForm on any saved output containing widgets.** `rebuildOutputAcroForm` currently runs when form fills are present. It should also run for unrelated saves of fillable PDFs so `copyPages` output keeps widgets reachable through `/Root /AcroForm /Fields`.

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma lays out wider than the embedded subset — `probeOverlayCoverage.mjs` flags 37 runs.
- [ ] **Image / non-text glyph clusters in the coverage probe.** Replace the height heuristic with an actual `<image>` op inspector.

### Document-level

- [ ] **Annotation extras** — `/Square` / `/Circle`, multi-line highlight quads, `/FreeTextCallout`, colour pickers.
- [ ] **Round-trip existing `/Annots`.** Source annotations pass through `copyPages` but aren't surfaced as editable. Parse `/Annots` in [loadSource.ts](src/lib/loadSource.ts).

### Testing / CI

- [ ] **Assert fixture determinism in CI.** CI regenerates synthetic PDFs with `pnpm test:fixtures`; add a follow-up `git diff --exit-code test/fixtures` so fixture drift is caught instead of silently tested.

### Source-PDF support

- [ ] **PDFs without `/ToUnicode`.** Need a glyph-name → codepoint table for Adobe Thaana glyph names. Survey of ~140 gazette.gov.mv PDFs (via [sweepGazette.mjs](scripts/sweepGazette.mjs)) found no real cases in the wild — deprioritised until a fixture shows up.
- [ ] **Smarter source-font matching.** Tighter weight + width matching when picking a bundled family for replacement text.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.** Pure ligature fonts with no Unicode coverage.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true` but loses encryption on save.

### Long shots

- [ ] **Table detection + reflow.**
- [ ] **Standalone desktop build** (Tauri / Electron) for offline use.
