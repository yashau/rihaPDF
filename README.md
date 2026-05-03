<br />
<br />

<p align="center">
  <img src="public/riha-logo.png" alt="rihaPDF" height="120" />
</p>

# rihaPDF

Browser-based PDF editor for Dhivehi / Thaana documents. Click any text run, type a replacement, save. Saved PDFs contain **real, selectable, searchable** text — original glyphs are removed from the content stream, not whited out.

**Free forever. Apache-2.0 ([LICENSE](LICENSE)). No accounts, no tracking, no paywall.**

**Live demo:** <https://rihapdf.yashau.com>

## Features

- **Edit text runs.** Click → input + floating toolbar (font, size, B/I/U/S, RTL/LTR). Style overrides survive close/reopen.
- **Drag to move.** Any run, image, inserted item, or comment — within a page or across pages. Cross-page arrivals are re-draggable.
- **Insert text and images.** Click-to-place tools that share the edit toolbar.
- **Resize images.** 4 corner handles on source and inserted images, anchored opposite corner.
- **Delete anything.** `Del`/`Backspace` on selected images; trash button on the text toolbar.
- **Undo / redo.** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Coalesces typing and drags into single steps.
- **Page sidebar.** Thumbnail per page; reorder, delete, insert blank, or insert pages from another PDF. External pages are first-class — every editing affordance works on them.
- **38 bundled Dhivehi fonts + Noto Sans Thaana.** Shipped via `@font-face` with `local()` first; saved PDFs embed the chosen family with `subset: false`.
- **Annotations.** Highlight, comment (FreeText), and freehand draw — saved as native `/Annot` objects so other tools recognise them.
- **Phonetic Latin → Thaana keyboard.** `DV`/`EN` toggle on the edit toolbar maps Latin keystrokes to Thaana via the Mahaa keymap.
- **Dark theme.** System / light / dark toggle that tracks `prefers-color-scheme` and persists.
- **Mobile layout.** Fit-to-width pages, 400ms touch hold before drag, edge-band auto-scroll, drawer sidebar, visual-viewport-anchored chrome.
- **Multi-page docs** with per-page preview canvases that strip-and-re-render on every edit.

## Stack

- **Vite + React + TypeScript** — UI
- **pdf.js** — page rendering + text extraction
- **pdf-lib** — page operations + font embedding + saving
- **HeroUI v3 + Tailwind v4 + lucide-react** — components / styling / icons
- **@dnd-kit** — sortable thumbnails

`harfbuzzjs` and `bidi-js` are scaffolding for the future raw-operator save path; not imported by live code today.

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
       3. embed chosen font (subset:false)
       4. append a fresh stream drawing the replacement via pdf-lib drawText
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

- **Thaana shaping in saved PDFs is approximate.** pdf-lib's `drawText` doesn't apply GPOS, GSUB, or BiDi. Most bundled fonts ship zero-advance combining marks so fili stack on the preceding base, but fili sit at a fixed offset rather than the GPOS anchor — visible on wider consonants and stacked clusters. Fix is the raw-operator emit path under TODO; blocked on pdf-lib renumbering glyph IDs even with `subset: false`.

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

| File                                          | What it covers                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `move-edit.test.ts`                           | move-only / edit-only / move+edit on the Maldivian PDF                          |
| `move-edit-maldivian2.test.ts`                | same flow against the second Maldivian fixture                                  |
| `image-move.test.ts`                          | drag image → cm rewrite, neighbours untouched                                   |
| `image-resize.test.ts`                        | corner-drag resize anchors the opposite corner across save+reload               |
| `preview-strip.test.ts`                       | original glyphs removed from canvas during edits                                |
| `preview-strip-paragraph.test.ts`             | every line under agenda item 6 strips cleanly                                   |
| `preview-strip-paragraph-maldivian2.test.ts`  | paragraph-strip coverage on maldivian2                                          |
| `edit-text-includes-punct.test.ts`            | parens / slash / digits land in the edit box                                    |
| `edit-text-includes-punct-maldivian2.test.ts` | punctuation-clustering against maldivian2                                       |
| `edit-format.test.ts`                         | bold OFF override persists across editor close/reopen                           |
| `edit-format-duplicate.test.ts`               | font-swap on Form-XObject text: outside-click commits, no duplicates            |
| `italic-save.test.ts`                         | italic toggle emits the shear `cm`; OFF run has none                            |
| `decoration-roundtrip.test.ts`                | underline + strikethrough save → reopen → toggle off → no orphan line           |
| `insert.test.ts`                              | drop text + image → both persist after save                                     |
| `insert-format.test.ts`                       | font / size / bold round-trip from the inserted-text toolbar                    |
| `cross-page-move.test.ts`                     | drag text run / source image / inserted text / inserted image across pages     |
| `delete-objects.test.ts`                      | source image, inserted image, source text, inserted text — all deletable        |
| `delete-shape.test.ts`                        | click-select a vector rect, Del flags it, save drops it                         |
| `delete-source-text-maldivian2.test.ts`       | source-text trash button strips the run                                         |
| `external-first-class.test.ts`                | external pages: edit run, insert text/image, cross-source drag round-trip       |
| `theme.test.ts`                               | system default + override, OS-flip tracking, persistence                        |
| `undo.test.ts`                                | every recordable mutation undoes + redoes; coalescing                           |
| `annotations.test.ts`                         | highlight / comment / ink → save → parse `/Annots` → fields round-trip          |
| `mobile-layout.test.ts`                       | 390×844 viewport: no horizontal overflow, drawer closed                         |
| `mobile-edit.test.ts`                         | tap-to-edit, fixed-bottom toolbar, synthetic touch drag                         |

One-off diagnostic scripts (not part of CI) live in [scripts/](scripts/).

## TODO

### Editing

- [ ] **Multi-line paragraph editing.** A wrapped paragraph is N separate runs today; needs cross-line merging keyed on indent + line-spacing plus a multi-line `EditField`.
- [ ] **Caret-at-click instead of full select.** Land the caret at the click position so long lines can be partial-edited.
- [ ] **Marquee select / multi-move.** Drag-rectangle multi-select.

### Save pipeline

- [ ] **HarfBuzz-shaped output.** Replace `drawText` for the Thaana path with a custom Type 0 / Identity-H emitter that takes pre-shaped glyph IDs from harfbuzzjs and writes raw Tj operators. Unblocks GPOS mark positioning.

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma lays out wider than the embedded subset — `probeOverlayCoverage.mjs` flags 37 runs.
- [ ] **Image / non-text glyph clusters in the coverage probe.** Replace the height heuristic with an actual `<image>` op inspector.

### Document-level

- [ ] **Thaana inside `/FreeText` comments.** Today `/DA` references Helv, which has no Thaana glyphs. Quick fix: embed Faruma in `/AcroForm/DR/Font` and reference it from `/DA`. Proper fix: ship a custom `/AP` appearance stream with HarfBuzz-shaped raw Tj — same blocker as raw-operator output.
- [ ] **Annotation extras** — `/Square` / `/Circle`, multi-line highlight quads, `/FreeTextCallout`, colour pickers.
- [ ] **Round-trip existing `/Annots`.** Source annotations pass through `copyPages` but aren't surfaced as editable. Parse `/Annots` in [loadSource.ts](src/lib/loadSource.ts).
- [ ] **Form fields** (text + checkbox).

### Source-PDF support

- [ ] **PDFs without `/ToUnicode`.** Need a glyph-name → codepoint table for Adobe Thaana glyph names. Survey of ~140 gazette.gov.mv PDFs (via [sweepGazette.mjs](scripts/sweepGazette.mjs)) found no real cases in the wild — deprioritised until a fixture shows up.
- [ ] **Smarter source-font matching.** Tighter weight + width matching when picking a bundled family for replacement text.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.** Pure ligature fonts with no Unicode coverage.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true` but loses encryption on save.

### Long shots

- [ ] **Table detection + reflow.**
- [ ] **Standalone desktop build** (Tauri / Electron) for offline use.
