<br />
<br />

<p align="center">
  <img src="public/riha-logo.png" alt="rihaPDF" height="120" />
</p>

# rihaPDF

[![CI](https://img.shields.io/github/actions/workflow/status/yashau/rihaPDF/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/yashau/rihaPDF/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-131%20e2e%20%2B%2075%20unit-2ea44f?style=for-the-badge)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=111111)](https://react.dev/)
[![HeroUI](https://img.shields.io/badge/HeroUI-3-000000?style=for-the-badge)](https://www.heroui.com/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-4-6e9f18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-e2e-2ead33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Oxlint](https://img.shields.io/badge/Oxlint-1.63-cc5a2f?style=for-the-badge)](https://oxc.rs/docs/guide/usage/linter)
[![Oxfmt](https://img.shields.io/badge/Oxfmt-0.48-cc5a2f?style=for-the-badge)](https://oxc.rs/docs/guide/usage/formatter)
[![pnpm](https://img.shields.io/badge/pnpm-11-f69220?style=for-the-badge&logo=pnpm&logoColor=white)](https://pnpm.io/)

Browser-based PDF editor for Dhivehi / Thaana documents. Click any text run, edit in place, save. Saved PDFs contain **real, selectable, searchable** text - original glyphs are removed from the content stream, not whited out.

**100% client-side.** Your PDF is parsed, edited, and saved entirely in your browser. Nothing is uploaded; no server ever sees your file.

**Free forever. Apache-2.0 ([LICENSE](LICENSE)). No accounts, no tracking, no paywall.**

**Current browser limits:** PDFs up to **150 MB** and **250 pages** at a time. Larger files are rejected up front to avoid exhausting browser memory while rihaPDF eagerly loads page previews and editable metadata.

**Live demo:** <https://rihapdf.yashau.com>

## Features

- **Edit text runs.** Click existing PDF text and edit it in place with font, size, style, alignment, and direction controls.
- **Drag to move.** Move text, images, inserted items, and comments within a page or across pages.
- **Insert text and images.** Click-to-place text boxes and images, with resize handles and shared text formatting controls.
- **Visual signatures.** Draw or import reusable visual signatures. These are image inserts, not cryptographic PDF signatures.
- **Resize and delete objects.** Resize source/inserted images and remove selected text, images, comments, and inserted items.
- **Undo / redo.** Keyboard undo/redo with typing and drag coalescing.
- **Page sidebar.** Reorder, delete, insert blank pages, or import pages from another PDF.
- **Browser print.** Use the browser's Print command (Ctrl/Cmd+P or menu) to print just the document pages with current visual edits, forms, annotations, and redactions; app chrome is excluded.
- **232 bundled Thaana fonts.** Local-first `@font-face` loading and embedded saved output. Credits live in [NOTICE](NOTICE) and [public/fonts/dhivehi/README.md](public/fonts/dhivehi/README.md).
- **Annotations.** Highlight, resizable comments, and freehand drawing saved as native PDF annotations.
- **Redaction.** Add resizable black redaction boxes; saved PDFs remove supported underlying text, image, vector, annotation, and form-widget content under the redaction area. See [docs/redaction-pipeline.md](docs/redaction-pipeline.md).
- **Fill AcroForm fields.** Fill common PDF form widgets, including text fields, checkboxes, radios, combo boxes, and list boxes, with Thaana input support.
- **Phonetic Latin → Thaana keyboard.** `DV`/`EN` toggle maps Latin keystrokes to Thaana via the Mahaa keymap.
- **Dark theme.** System / light / dark toggle that tracks `prefers-color-scheme` and persists.
- **Installable app.** Chrome / Edge can install rihaPDF as a standalone PWA when served from HTTPS.
- **Mobile layout.** Fit-to-width pages, touch gestures, drawer sidebar, and keyboard-aware toolbar positioning.
- **Multi-page docs.** Per-page preview canvases update as edits change.

## Stack

- **Vite 8 + React 19 + TypeScript 6** - browser app shell and strict UI code.
- **HeroUI 3 + Tailwind CSS 4 + lucide-react** - components, styling, theme chrome, and icons.
- **Lexical 0.44** - bounded rich-text editing surface for page text fields.
- **pdf.js 5** - page rendering, workers, and source text extraction.
- **pdf-lib + @pdf-lib/fontkit** - page copying, object writes, font embedding, and save output.
- **harfbuzzjs + bidi-js** - Thaana shaping and mixed-direction text segmentation.
- **@dnd-kit + framer-motion** - sortable page thumbnails, drag sensors, and motion primitives.
- **Vitest 4 + Playwright + V8 coverage** - unit and browser-driven E2E regression tests.
- **Oxfmt + Oxlint** - formatting and lint/type-aware static checks.
- **Wrangler 4 + Cloudflare Workers Static Assets** - production hosting with SPA fallback.

## Quick start

```bash
pnpm install
pnpm dev
```

Open the URL Vite prints, click **Open PDF**, click a text fragment, hit **Save**.

Test fixtures in [test/fixtures/](test/fixtures/):

- `maldivian.pdf` - real Maldivian doc with broken-aabaafili ToUnicode (canonical Thaana-recovery test bed).
- `with-images.pdf` / `with-images-multipage.pdf` - synthetic image fixtures (`node test/fixtures/build.mjs`).
- `external-source.pdf` - two-page fixture used by the `+ From PDF` tests.

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

See [docs/thaana-text-pipeline.md](docs/thaana-text-pipeline.md) for the detailed shaped text save path, including font embedding, HarfBuzz operator emission, mixed-script bidi segmentation, annotations, and AcroForm widget appearances.

Underline / strikethrough are paired to runs at load time ([runDecorations.ts](src/pdf/text/runDecorations.ts)) so toggling them off on re-edit strips the original line. Italic for fonts without an oblique variant is a shear-about-baseline `cm`. Bold without a bold variant is a double-pass with x-offset.

Content-stream surgery is a small custom tokenizer in [contentStream.ts](src/pdf/content/contentStream.ts) - pdf-lib doesn't expose its parser publicly, so [pageContent.ts](src/pdf/content/pageContent.ts) reads raw bytes and rewrites them.

Caret placement for source text uses the same PDF-side text-show data as the edit/save pipeline: [sourceFonts.ts](src/pdf/source/sourceFonts.ts) walks `Tj`/`TJ` operators, font widths, text spacing, and horizontal scaling to derive per-glyph source edges; [pdf.ts](src/pdf/render/pdf.ts) maps those edges back to logical text offsets for LTR/RTL run hit-testing before the browser input mounts.

The page renderer is split per concern under [src/components/PdfPage/](src/components/PdfPage/): `index.tsx` owns page chrome and gesture wiring; `EditField.tsx`, `EditTextToolbar.tsx`, `RichTextEditor.tsx`, `RichTextEditorPlugins.tsx`, `RichTextView.tsx`, `richTextEditorModel.ts`, and `richTextThaanaInput.ts` cover source/inserted text editing; `SourceRunOverlay.tsx`, `AnnotationLayer.tsx`, `DragPreviews.tsx`, and the drag/geometry hooks cover overlays and object interaction.

`App.tsx` is a composition root at [src/app/App.tsx](src/app/App.tsx) over [AppHeader](src/components/AppHeader/), [PageList](src/components/PageList.tsx), [PageWithToolbar](src/components/PageWithToolbar.tsx), and [AboutModal](src/components/AboutModal.tsx). App-specific state hooks live in [src/app/hooks/](src/app/hooks/), including [useAppState](src/app/hooks/useAppState.ts), [useDocumentIo](src/app/hooks/useDocumentIo.ts), [useDocumentMutations](src/app/hooks/useDocumentMutations.ts), [usePreviewCanvases](src/app/hooks/usePreviewCanvases.ts), [useSelection](src/app/hooks/useSelection.ts), and [useMobileChrome](src/app/hooks/useMobileChrome.ts). Shared platform hooks such as [useUndoRedo](src/platform/hooks/useUndoRedo.ts) and [useDragGesture](src/platform/hooks/useDragGesture.ts) live in [src/platform/hooks/](src/platform/hooks/).

Derived app state lives in [src/app/state/](src/app/state/): [contentState.ts](src/app/state/contentState.ts) groups document/content/tool state, [pageListSelectors.ts](src/app/state/pageListSelectors.ts) derives renderable PageList selection/arrival state, and [saveStatusSelectors.ts](src/app/state/saveStatusSelectors.ts) keeps save-status logic pure. [pageControllerBinding.ts](src/components/pageControllerBinding.ts) binds per-page controller callbacks, and [buildSavePayload.ts](src/app/buildSavePayload.ts) translates the slot list into `SourceSavePayload[]` for the save pipeline.

## Internal docs

Architecture and maintenance notes live in [docs/](docs/):

- [docs/index.md](docs/index.md) - map of the internals documentation.
- [docs/thaana-text-pipeline.md](docs/thaana-text-pipeline.md) - HarfBuzz shaping, `RihaShaped` resources, and mixed-script text.
- [docs/save-pipeline.md](docs/save-pipeline.md) - how edits, inserts, forms, annotations, redactions, and page ops become the saved PDF.
- [docs/source-text-editing.md](docs/source-text-editing.md) - source run extraction, RTL display fixes, caret mapping, and stream surgery.
- [docs/coordinate-systems.md](docs/coordinate-systems.md) - PDF/user-space/browser coordinate conversions.
- [docs/forms-pipeline.md](docs/forms-pipeline.md) - AcroForm extraction, value saving, appearances, and redaction behavior.
- [docs/annotations-and-visual-objects.md](docs/annotations-and-visual-objects.md) - native annotations vs page-content objects.
- [docs/redaction-pipeline.md](docs/redaction-pipeline.md) - irreversible redaction internals.
- [docs/browser-privacy-security.md](docs/browser-privacy-security.md) - client-only privacy model, limits, caches, and security posture.
- [docs/testing-strategy.md](docs/testing-strategy.md) - regression-test guidance for bug-fix mode.
- [docs/compatibility-notes.md](docs/compatibility-notes.md) - intentional hacks for dates, punctuation, bidi, mobile input, and PDF quirks.

## Adding a new Dhivehi font

1. Drop the `.ttf` into [public/fonts/dhivehi/](public/fonts/dhivehi/) (slugified filename).
2. Append a row to `FONTS` in [src/pdf/text/fonts.ts](src/pdf/text/fonts.ts):
   ```ts
   { family: "MV MyFont", label: "MV MyFont", localAliases: ["MV MyFont"],
     url: "/fonts/dhivehi/myfont.ttf" },
   ```

The `@font-face` rule, picker, and save pipeline all read from this list.

The bundled MV-prefix fonts are included as a fallback - `@font-face` usually lists `local()` first, so an OS-installed copy wins. Faruma is the exception: rihaPDF labels the picker entry as `Faruma (ModFaruma)` and points it at bundled `modfaruma.ttf` without `local("Faruma")`, so older OS Faruma installs do not override the Faruma-compatible default. Font origins, attributions, and a contact path for rights-holder removal requests are documented in [public/fonts/dhivehi/README.md](public/fonts/dhivehi/README.md).

## Known limitations

- **No OCR.** rihaPDF edits existing PDF text objects; it does not perform OCR of any kind and is not meant for converting scanned/image-only documents into editable text. You can still use scanned PDFs for page organization, annotations, visual signatures, redaction boxes, and other visual edits.
- **Mixed-script text extraction is order-imperfect in some viewers.** When a single run mixes Thaana with Latin (e.g. `Hello ދިވެހި 42` typed into a `+ Text` insert), the saved PDF renders correctly visually - Latin segments via Helvetica, Thaana segments via HarfBuzz-shaped Faruma, segment ordering via `bidi-js` UAX #9 - but pdf.js's `getTextContent` and similar extractors that group adjacent Tj operators into compound items can swap base+mark order within RTL clusters when Latin items are in the same line. The visual output is correct; copy-paste / search may recover the same Unicode codepoints in slightly reordered positions. Pure-RTL or pure-LTR runs are unaffected. Fix path documented in [docs/thaana-text-pipeline.md](docs/thaana-text-pipeline.md) and [test/e2e/mixed-script.test.ts](test/e2e/mixed-script.test.ts) (one-Tj-per-cluster TJ-array emission, or post-extraction cluster repair).
- **Redaction non-text fallbacks are conservative.** Partial raster redaction is pixel-accurate for decoded 8-bit `/DeviceGray`, `/DeviceRGB`, and `/DeviceCMYK` image XObjects without masks: the saved PDF points at a new sanitized image stream and prunes the original XObject when it is no longer used. For masked images, unsupported image encodings / colour spaces, and Form XObjects, rihaPDF removes the whole draw if it overlaps the redaction. Vector paths are stripped at paint-op / detected q...Q block granularity, so a redaction over part of a complex path can remove more vector content than the visible rectangle covers. This is intentional: over-stripping is the safe failure mode.
- **Redaction fallback for unsupported fonts.** Non-Identity-H `/Type0` (vertical writing or custom CMap), `/Type3`, and Standard 14 fonts without an embedded `/Widths` table fall back to _whole-op stripping_ rather than per-glyph. The redaction stays correct (over-stripping is the safe failure mode) but a tightened rect over such an op may remove neighbouring glyphs that were outside the visual rect. In practice this only matters on very old / unusual PDFs - the maldivian2 fixture, Office output, and every browser-generated PDF we've tested take the per-glyph fast path.
- **Annotation and form redaction is geometry-first.** Text markup quads and ink strokes are clipped/split so portions outside the redaction survive. Text-bearing, unsupported annotation types, and overlapped AcroForm widgets are removed on overlap because their dictionaries can carry recoverable `/Contents`, `/V`, `/DV`, or appearance data. Partial form-field value redaction is not attempted; overlapping a widget removes the whole field.

## Scripts

```bash
pnpm dev               # strict Vite dev server on 127.0.0.1:5173
pnpm build             # tsc + vite build → dist/
pnpm check             # tsc -b && oxfmt --check && oxlint
pnpm check:ci          # CI variant with oxfmt/oxlint forced to one thread
pnpm lint              # oxlint over src/test/config entry points
pnpm format            # oxfmt
pnpm test              # unit tests only; self-contained, no dev server
pnpm test:unit         # explicit unit test alias
pnpm test:e2e          # starts strict Vite server, then runs Playwright E2E
pnpm test:all          # unit tests, then managed E2E tests
pnpm test:coverage     # unit coverage with V8 output in coverage/
pnpm test:e2e:coverage # managed E2E run with V8 coverage enabled
pnpm test:fixtures     # rebuild test/fixtures/with-images*.pdf
pnpm cf:config      # generate wrangler.jsonc from env vars
pnpm cf:dev         # wrangler dev - local Workers preview of dist/
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

CI deploys from GitHub Actions after checks, build, fixture generation, and E2E tests pass on `main`. It generates `wrangler.jsonc` first with:

- Secret `CLOUDFLARE_API_TOKEN`: Cloudflare API token used by `wrangler deploy`.
- Secret `CLOUDFLARE_ACCOUNT_ID`: account ID written into `wrangler.jsonc`.
- Variable `WRANGLER_NAME`: optional Worker name, defaults to `rihapdf`.
- Variable `WRANGLER_COMPATIBILITY_DATE`: optional compatibility date, defaults to `2026-04-01`.
- Variable `WRANGLER_ROUTE`: optional custom-domain route pattern, written as `{ "pattern": "...", "custom_domain": true }`.
- Variable `WRANGLER_ROUTES_JSON`: optional full routes JSON array. Use this instead of `WRANGLER_ROUTE` for multiple or advanced routes.

Do not run `wrangler login` in CI. GitHub Actions authenticates Wrangler with `CLOUDFLARE_API_TOKEN` instead.

## Debugging on devices without devtools

Append `?debug=1` to any URL to install a fixed-position error overlay that surfaces uncaught errors, promise rejections, worker errors, and `console.error` output. Implemented in [errorOverlay.ts](src/platform/browser/errorOverlay.ts); zero overhead when absent.

The About modal (`?` in the header) has a **Show browser diagnostics** toggle that lists feature-detection results plus whether `ReadableStream`'s async-iterator was native or polyfilled by [polyfills.ts](src/platform/browser/polyfills.ts).

## Tests

Vitest runs focused unit tests under [test/unit/](test/unit/) and the E2E suite under [test/e2e/](test/e2e/). `pnpm test` is intentionally unit-only so it is self-contained. Browser E2E tests use Playwright against a managed strict-port Vite server:

```bash
pnpm test          # unit suite only
pnpm test:e2e      # starts Vite on APP_URL or http://127.0.0.1:5173/, then runs E2E
pnpm test:all      # unit + managed E2E
```

Set `APP_URL` to run the E2E harness against a different local port, for example `APP_URL=http://127.0.0.1:5174/ pnpm test:e2e`. When running Vitest directly instead of `pnpm test:e2e`, start the server first with `pnpm dev`; Vite is configured with `strictPort` so port conflicts fail loudly instead of silently moving to another port.

Coverage uses Vitest's V8 provider:

```bash
pnpm test:coverage      # unit coverage
pnpm test:e2e:coverage  # E2E coverage with managed Vite server
```

The detailed coverage inventories and current test counts live in [test/unit/README.md](test/unit/README.md) and [test/e2e/README.md](test/e2e/README.md). Unit coverage locks down low-level rectangle overlap, PDF `/Rect` normalization, content-stream parsing/serialization, text-show state tracking, text-run ordering and source-font ownership, source paragraph grouping including table-row non-merging, RTL source-edit display normalization, plus redaction glyph planning, raster image sanitization, vector strip marking, XObject pruning, annotation clipping/removal, and AcroForm widget cleanup. E2E coverage includes strict source-paragraph visual WYSIWYG checks across active edit, committed render, and saved/reopened PDF output, plus resized source/inserted text boxes that must reflow, preserve indentation, and save with browser-matching geometry.

One-off diagnostic scripts (not part of CI) live in [scripts/](scripts/).

## TODO

### Editing

- [ ] **Marquee select / multi-move.** Drag-rectangle multi-select.

### Save pipeline

- [ ] **Logical-order text extraction for mixed-script saves.** HarfBuzz-shaped output ships in [shapedDraw.ts](src/pdf/text/shapedDraw.ts) / [shapedBidi.ts](src/pdf/text/shapedBidi.ts), but pdf.js's getTextContent reorders base+mark within RTL clusters when adjacent Latin items share the line - visual is correct, extraction is not. Either emit one Tj per cluster (TJ-array form for inter-glyph adjustments) so each cluster lands as a single TextItem, or repair after extraction by re-clustering on the recovered codepoints. See [test/e2e/mixed-script.test.ts](test/e2e/mixed-script.test.ts).
- [ ] **Partial form-widget redaction.** Redaction removes an overlapped AcroForm field as the safe default. A future version could split visual widget appearances or preserve non-overlapped widgets from the same field when that can be done without leaving `/V`/`/DV` recoverable.

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma lays out wider than the embedded subset - `probeOverlayCoverage.mjs` flags 37 runs.
- [ ] **Image / non-text glyph clusters in the coverage probe.** Replace the height heuristic with an actual `<image>` op inspector.

### Document-level

- [ ] **Annotation extras** - `/Square` / `/Circle`, multi-line highlight quads, `/FreeTextCallout`, colour pickers.

### Source-PDF support

- [ ] **PDFs without `/ToUnicode`.** Need a glyph-name → codepoint table for Adobe Thaana glyph names. Survey of ~140 gazette.gov.mv PDFs (via [sweepGazette.mjs](scripts/sweepGazette.mjs)) found no real cases in the wild - deprioritised until a fixture shows up.
- [ ] **Smarter source-font matching.** Tighter weight + width matching when picking a bundled family for replacement text.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.** Pure ligature fonts with no Unicode coverage.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true` but loses encryption on save.

### Long shots

- [ ] **Table detection + reflow.**
- [ ] **Standalone desktop build** (Tauri / Electron) for offline use.
