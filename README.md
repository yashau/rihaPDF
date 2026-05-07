<br />
<br />

<p align="center">
  <img src="public/riha-logo.png" alt="rihaPDF" height="120" />
</p>

# rihaPDF

[![CI](https://img.shields.io/github/actions/workflow/status/yashau/rihaPDF/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white)](https://github.com/yashau/rihaPDF/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-114%20e2e%20%2B%2029%20unit-2ea44f?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=111111)
![HeroUI](https://img.shields.io/badge/HeroUI-3-000000?style=for-the-badge)
![Vite](https://img.shields.io/badge/Vite-8-646cff?style=for-the-badge&logo=vite&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-4-6e9f18?style=for-the-badge&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-e2e-2ead33?style=for-the-badge&logo=playwright&logoColor=white)
![Oxlint](https://img.shields.io/badge/Oxlint-1.63-cc5a2f?style=for-the-badge)
![Oxfmt](https://img.shields.io/badge/Oxfmt-0.48-cc5a2f?style=for-the-badge)
![pnpm](https://img.shields.io/badge/pnpm-11-f69220?style=for-the-badge&logo=pnpm&logoColor=white)

Browser-based PDF editor for Dhivehi / Thaana documents. Click any text run, edit in place, save. Saved PDFs contain **real, selectable, searchable** text — original glyphs are removed from the content stream, not whited out.

**100% client-side.** Your PDF is parsed, edited, and saved entirely in your browser. Nothing is uploaded; no server ever sees your file.

**Free forever. Apache-2.0 ([LICENSE](LICENSE)). No accounts, no tracking, no paywall.**

**Live demo:** <https://rihapdf.yashau.com>

## Features

- **Edit text runs.** Click → source-glyph-positioned caret input + floating toolbar (font, size, B/I/U/S, RTL/LTR). Style overrides survive close/reopen.
- **Drag to move.** Any run, image, inserted item, or comment — within a page or across pages. Cross-page arrivals are re-draggable.
- **Insert text and images.** Click-to-place tools that share the edit toolbar.
- **Visual signatures.** Draw a signature with signing colour presets or import one from an image. Imported signatures are trimmed and background-cleaned, and saved signatures stay local in the browser for reuse. These are visual PDF image inserts only, not cryptographic PDF signatures.
- **Resize images.** 4 corner handles on source and inserted images, anchored opposite corner.
- **Delete anything.** `Del`/`Backspace` on selected images; trash button on the text toolbar.
- **Undo / redo.** Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Coalesces typing and drags into single steps.
- **Page sidebar.** Thumbnail per page; reorder, delete, insert blank, or insert pages from another PDF by picker or PDF drag-and-drop. External pages are first-class — every editing affordance works on them.
- **230 bundled Thaana fonts.** Shipped via `@font-face` with `local()` first; saved PDFs embed the chosen family with `subset: false`. Sources, attributions, and per-file credits in [NOTICE](NOTICE) and [public/fonts/dhivehi/README.md](public/fonts/dhivehi/README.md).
- **Annotations.** Highlight, resizable comment (FreeText), and freehand draw — saved as native `/Annot` objects so other tools recognise them.
- **Redact.** Click a text run to drop an opaque black rectangle; drag corners to resize. On save the rect paints into the content stream AND the underlying content is destroyed: glyphs are stripped per-bbox, supported raster image XObjects are rewritten with covered pixels blacked out, fully covered / unsupported image or Form XObject draws are removed, vector paint ops under the rect are stripped, native annotations are clipped or removed on overlap, and overlapped AcroForm widgets are removed with their field values and appearances. The saved file has no recoverable text, page-level image/vector draw data, annotation content, or form-widget value data under the rect for supported layers.
- **Fill AcroForm fields.** Open a form PDF — Maldivian gov applications, etc. — and the existing widgets become interactive overlays: text inputs (single-line, multiline, password), checkboxes, radio groups, combo / list boxes. Type Thaana via the same DV/EN phonetic keyboard the rest of the editor uses; saved PDFs write `/V` (UTF-16BE for Thaana, ASCII otherwise) and rebuild `/Root /AcroForm /Fields` after copyPages so the output stays interactive in Acrobat / Preview / Chrome / pdf.js. Reopening in rihaPDF re-extracts the same values. XFA, JS actions, `/AA`, and digital-signature creation are out of scope.
- **Phonetic Latin → Thaana keyboard.** `DV`/`EN` toggle on the edit toolbar maps Latin keystrokes to Thaana via the Mahaa keymap.
- **Dark theme.** System / light / dark toggle that tracks `prefers-color-scheme` and persists.
- **Installable app.** Chrome / Edge can install rihaPDF as a standalone PWA when served from HTTPS; supporting browsers expose the native install affordance in the browser UI.
- **Mobile layout.** Fit-to-width pages, app-owned two-finger document zoom, 400ms touch hold before drag, edge-band auto-scroll, drawer sidebar, visual-viewport-anchored chrome for keyboard-aware controls.
- **Multi-page docs** with per-page preview canvases that strip-and-re-render on every edit.

## Stack

- **Vite + React + TypeScript** — UI
- **pdf.js** — page rendering + text extraction
- **pdf-lib** — page operations + font embedding + saving
- **HeroUI v3 + Tailwind v4 + lucide-react** — components / styling / icons
- **@dnd-kit** — sortable thumbnails

`harfbuzzjs` does the Thaana shaping at save time — replacement runs are shaped via HarfBuzz and emitted as raw `Tj` operators against a `subset: false` Type 0 font, so GPOS mark anchoring is correct ([shapedDraw.ts](src/pdf/text/shapedDraw.ts)). `bidi-js` segments mixed-script runs by direction so each level-run shapes with its own font and direction ([shapedBidi.ts](src/pdf/text/shapedBidi.ts)).

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

Underline / strikethrough are paired to runs at load time ([runDecorations.ts](src/pdf/text/runDecorations.ts)) so toggling them off on re-edit strips the original line. Italic for fonts without an oblique variant is a shear-about-baseline `cm`. Bold without a bold variant is a double-pass with x-offset.

Content-stream surgery is a small custom tokenizer in [contentStream.ts](src/pdf/content/contentStream.ts) — pdf-lib doesn't expose its parser publicly, so [pageContent.ts](src/pdf/content/pageContent.ts) reads raw bytes and rewrites them.

Caret placement for source text uses the same PDF-side text-show data as the edit/save pipeline: [sourceFonts.ts](src/pdf/source/sourceFonts.ts) walks `Tj`/`TJ` operators, font widths, text spacing, and horizontal scaling to derive per-glyph source edges; [pdf.ts](src/pdf/render/pdf.ts) maps those edges back to logical text offsets for LTR/RTL run hit-testing before the browser input mounts.

The page renderer is split per concern under [src/components/PdfPage/](src/components/PdfPage/): `index.tsx` (page chrome + gesture wiring), `EditField.tsx`, `EditTextToolbar.tsx`, `overlays/`, `helpers.ts`, `types.ts`.

`App.tsx` is a composition root at [src/app/App.tsx](src/app/App.tsx) over [AppHeader](src/components/AppHeader/), [PageList](src/components/PageList.tsx), [PageWithToolbar](src/components/PageWithToolbar.tsx), and [AboutModal](src/components/AboutModal.tsx). App-specific state hooks live in [src/app/hooks/](src/app/hooks/), including [usePreviewCanvases](src/app/hooks/usePreviewCanvases.ts), [useSelection](src/app/hooks/useSelection.ts), and [useMobileChrome](src/app/hooks/useMobileChrome.ts); shared platform hooks such as [useUndoRedo](src/platform/hooks/useUndoRedo.ts) and [useDragGesture](src/platform/hooks/useDragGesture.ts) live in [src/platform/hooks/](src/platform/hooks/). [buildSavePayload.ts](src/app/buildSavePayload.ts) is the pure translator from slot list → `SourceSavePayload[]`.

## Adding a new Dhivehi font

1. Drop the `.ttf` into [public/fonts/dhivehi/](public/fonts/dhivehi/) (slugified filename).
2. Append a row to `FONTS` in [src/pdf/text/fonts.ts](src/pdf/text/fonts.ts):
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

## Scripts

```bash
pnpm dev            # vite dev server (localhost:5173)
pnpm build          # tsc + vite build → dist/
pnpm check          # tsc -b && oxfmt --check && oxlint  (CI gate)
pnpm lint           # oxlint over src/test/config entry points
pnpm format         # oxfmt
pnpm test           # vitest unit + E2E suite (E2E needs dev server up)
pnpm test:coverage  # vitest with V8 coverage output in coverage/
pnpm test:fixtures  # rebuild test/fixtures/with-images*.pdf
pnpm cf:config      # generate wrangler.jsonc from env vars
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

Vitest runs focused unit tests under [test/unit/](test/unit/) and the E2E suite under [test/e2e/](test/e2e/). E2E tests drive the dev server through Playwright:

```bash
pnpm dev          # one terminal
pnpm test         # another
```

Coverage uses Vitest's V8 provider. Run the full suite with coverage while the dev server is up:

```bash
pnpm test:coverage
```

For focused unit coverage that does not need the dev server:

```bash
pnpm test:coverage test/unit
```

The detailed coverage inventories and current test counts live in [test/unit/README.md](test/unit/README.md) and [test/e2e/README.md](test/e2e/README.md). Unit coverage locks down low-level rectangle overlap, PDF `/Rect` normalization, content-stream parsing/serialization, text-show state tracking, text-run ordering and source-font ownership, plus redaction glyph planning, raster image sanitization, vector strip marking, XObject pruning, annotation clipping/removal, and AcroForm widget cleanup.

One-off diagnostic scripts (not part of CI) live in [scripts/](scripts/).

## TODO

### Editing

- [ ] **Multi-line paragraph editing.** A wrapped paragraph is N separate runs today; needs cross-line merging keyed on indent + line-spacing plus a multi-line `EditField`.
- [ ] **Marquee select / multi-move.** Drag-rectangle multi-select.

### Save pipeline

- [ ] **Logical-order text extraction for mixed-script saves.** HarfBuzz-shaped output ships in [shapedDraw.ts](src/pdf/text/shapedDraw.ts) / [shapedBidi.ts](src/pdf/text/shapedBidi.ts), but pdf.js's getTextContent reorders base+mark within RTL clusters when adjacent Latin items share the line — visual is correct, extraction is not. Either emit one Tj per cluster (TJ-array form for inter-glyph adjustments) so each cluster lands as a single TextItem, or repair after extraction by re-clustering on the recovered codepoints. See [test/e2e/mixed-script.test.ts](test/e2e/mixed-script.test.ts).
- [ ] **Partial form-widget redaction.** Redaction removes an overlapped AcroForm field as the safe default. A future version could split visual widget appearances or preserve non-overlapped widgets from the same field when that can be done without leaving `/V`/`/DV` recoverable.

### Overlay / interaction

- [ ] **Overlay-rect vs rendered-text-rect drift.** Web-font Faruma lays out wider than the embedded subset — `probeOverlayCoverage.mjs` flags 37 runs.
- [ ] **Image / non-text glyph clusters in the coverage probe.** Replace the height heuristic with an actual `<image>` op inspector.

### Document-level

- [ ] **Annotation extras** — `/Square` / `/Circle`, multi-line highlight quads, `/FreeTextCallout`, colour pickers.

### Source-PDF support

- [ ] **PDFs without `/ToUnicode`.** Need a glyph-name → codepoint table for Adobe Thaana glyph names. Survey of ~140 gazette.gov.mv PDFs (via [sweepGazette.mjs](scripts/sweepGazette.mjs)) found no real cases in the wild — deprioritised until a fixture shows up.
- [ ] **Smarter source-font matching.** Tighter weight + width matching when picking a bundled family for replacement text.
- [ ] **Drop A_Bismillah-style display fonts from the editor picker.** Pure ligature fonts with no Unicode coverage.
- [ ] **Encrypted PDFs.** `pdf-lib` accepts `ignoreEncryption: true` but loses encryption on save.

### Long shots

- [ ] **Table detection + reflow.**
- [ ] **Standalone desktop build** (Tauri / Electron) for offline use.
