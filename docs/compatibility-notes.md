# Compatibility notes

This page is a maintainer map of the odd-looking fixes that keep real Maldivian PDFs editable. Most of these are compatibility shims for browser bidi behavior, PDF producer bugs, or gaps in pdf.js/pdf-lib APIs. If a rule looks too specific, assume it came from a fixture or git-history regression and preserve it until the matching test is updated.

## RTL editor display quirks

Key files/tests: `src/components/PdfPage/rtlDisplayText.ts`, `src/components/PdfPage/richTextEditorModel.ts`, `src/components/PdfPage/SourceRunOverlay.tsx`, `test/unit/rtl-display-text.test.ts`, `test/e2e/edit-text-includes-punct*.test.ts`, `test/e2e/caret-at-click.test.ts`.

- Date-like and number-group text can break editing in RTL content. Strings such as `1/1/2000`, `2026/1/14`, or `00:9` can be visually reversed, split, or caret-mapped incorrectly by the browser bidi algorithm. `displayTextForEditor` reverses single-separator number groups for RTL editor display and tightens separator spacing so the date/time behaves as one token.
- Punctuation and parentheses are intentionally massaged before Lexical sees the source text. Spaces before commas/semicolons/question marks are removed when preceded by RTL/digits, and interior spaces around brackets/quotes are tightened. Opening punctuation is treated differently so a normal space before an opener is not eaten.
- RTL list/section markers are display-normalized. Some extracted markers arrive as trailing dots or leading `.12`-style source text; the editor display rewrites them so the marker appears where Dhivehi users expect it.
- Numeric markers in RTL spans are wrapped with LRI/PDI by `protectRtlNumericMarkers`. Do not include surrounding parentheses in the isolate; that was a previous source-editing trap because the closing parenthesis started behaving like part of the LTR date/token.
- Bidi control characters are stripped when serializing rich text. They are editor-only scaffolding, not saved user content.

When changing this area, test date-looking text, times, parentheses, Arabic punctuation, list markers, and click-to-caret offsets in RTL source runs. A no-op open/close should not persist a display-normalized string as a semantic edit.

## Mobile Thaana input

Key files/tests: `src/domain/thaanaKeyboard.ts`, `src/components/PdfPage/richTextThaanaInput.ts`, `src/components/PdfPage/FormFieldLayer/overlays.tsx`, `src/components/PdfPage/annotations/CommentLayer.tsx`, `test/unit/thaana-input-plugin.test.ts`, `test/e2e/mobile-edit.test.ts`, `test/e2e/form-fill.test.ts`.

- Mobile users usually have a Latin soft keyboard, so DV mode intercepts single-character Latin `beforeinput` and replaces it with the Mahaa QWERTY-to-Thaana mapping before it enters the field.
- Composition, paste, delete, autocorrect, and multi-character insertions pass through. This avoids fighting Android/iOS IME composition.
- Controlled React inputs use the native element value setter and dispatch a real bubbling `input` event so React state stays synchronized.
- Lexical rich-text editors need both `BEFORE_INPUT_COMMAND` and `CONTROLLED_TEXT_INSERTION_COMMAND` hooks. Some insertion paths bypass ordinary DOM input.
- Bracket/paren keymap entries are flipped intentionally for RTL visual pairing.

## PDF.js extraction and `/ToUnicode` recovery

Key files/tests: `src/pdf/render/pdf.ts`, `src/pdf/text/textDecodeRecovery.ts`, `src/pdf/source/glyphMap.ts`, `src/pdf/source/sourceFonts.ts`, `test/fixtures/maldivian*.pdf`, `test/e2e/source-font-detection.test.ts`, `test/unit/text-run-builder.test.ts`.

- `disableCombineTextItems: true` is deliberate. pdf.js item combining inserts spaces and hides empty/orphan items that rihaPDF needs for missing Thaana fili recovery.
- Some Office-exported PDFs have broken `/ToUnicode` entries, including aabaafili mapping to U+0020 space. rihaPDF decodes raw `Tj`/`TJ` bytes with reverse glyph maps, reverses RTL shows into logical order, trims Office padding glyphs, and stamps content-stream op indices onto matching pdf.js items.
- Text extraction order is not the same as glyph paint order. Do not assume glyph span index order is visual order without proving it against physical boxes.
- PDFs without usable `/ToUnicode` remain a known limitation unless a glyph-name/codepoint recovery table is added and backed by a fixture.

## Shaped text and PDF resource names

Key files/tests: `src/pdf/text/shape.ts`, `src/pdf/text/shapedDraw.ts`, `src/pdf/text/shapedBidi.ts`, `src/pdf/save/textDraw.ts`, `test/e2e/mixed-script.test.ts`, `test/e2e/edit-format.test.ts`.

- Bundled Thaana fonts bypass pdf-lib `drawText`. HarfBuzz returns glyph IDs, and rihaPDF emits Type0/Identity-H text operators directly so saved text remains real/selectable.
- `Tf` must reference the page or Form XObject resource font name returned by `newFontDictionary`, not `pdfFont.name` or the BaseFont. Using the BaseFont-like name renders incorrectly in viewers.
- RTL glyph emission intentionally walks clusters in logical extraction order while preserving visual positions. Changing this can make the PDF look correct but copy/search incorrectly.
- Mixed Latin + Thaana uses `bidi-js` segmentation. Visual output is correct, but extraction can still be order-imperfect when viewers group adjacent LTR/RTL operators. See the README known limitation.
- Measurement and drawing must use the same path. If HarfBuzz measures and pdf-lib draws, right alignment, wrapping, and decorations drift.

## Content-stream surgery and source edits

Key files/tests: `src/pdf/content/contentStream.ts`, `src/pdf/content/pageContent.ts`, `src/pdf/save/streamSurgery.ts`, `src/pdf/save/orchestrator.ts`, `test/unit/content-stream.test.ts`, `test/e2e/move-edit*.test.ts`, `test/e2e/delete-source-text-maldivian2.test.ts`.

- pdf-lib does not expose a public content-stream parser, so rihaPDF has a custom tokenizer/serializer. This is why parser-looking code exists in app source.
- Source edits are not overlays. Save removes the old `Tj`/`TJ` operators under edited runs and then draws replacement text. Live white masks only prevent preview ghosting.
- Unsupported source text rewrite cases should fail safe by removing a larger op/block for security-sensitive paths. For ordinary editing, verify the saved PDF visually and by extraction.
- Source paragraph editing uses several browser/PDF compromises: explicit line breaks, line-local spacing, logical x sorting, source-line layout preservation, and caret offsets that pass through RTL display normalization.

## Images, forms, annotations, and redaction fallbacks

Key files/tests: `src/pdf/source/sourceImages.ts`, `src/pdf/save/sourceImageMoves.ts`, `src/pdf/save/forms.ts`, `src/pdf/save/annotations.ts`, `src/pdf/save/redactions/*`, `test/e2e/image-move.test.ts`, `test/e2e/save-redactions.test.ts`, `test/unit/redaction-*.test.ts`.

- Image moves are based on `q cm Do Q` structure. The safe move path inserts or adjusts a translation around the owning image block while preserving scale/rotation. Form XObjects need `/BBox` + `/Matrix` to get real grab boxes.
- AcroForm fills must keep `/V`, widget `/AS`, `/NeedAppearances`, `/DA`, `/DR/Font`, and text-widget `/AP /N` consistent. Filled text widgets get fresh appearances; Thaana appearances are HarfBuzz-shaped in visual glyph order so Acrobat/Preview/pdf.js paint the same pixels while `/V` remains the semantic value. Keep `/NeedAppearances false` when these explicit appearances exist, because Acrobat/Preview regeneration can reverse or drop Thaana marks.
- rihaPDF's editor canvas suppresses pdf.js form-widget appearance painting and renders widgets as DOM overlays instead. Otherwise re-opened filled forms can show rasterized `/AP` text underneath the editable input.
- FreeText comments with Thaana also get custom HarfBuzz-shaped `/AP /N` appearances. Highlight and Ink annotations mostly rely on native viewer rendering.
- Redaction is destructive save-time cleanup, not black overlay security. Text, images, vectors, annotations, widgets, appearance streams, and resource objects all need cleanup where supported.
- Redaction fallbacks prefer over-stripping. Unsupported image encodings/masks, Form XObjects, unsupported fonts, and complex vector blocks are removed more broadly rather than risking hidden recoverable content.

## Browser, cache, and deployment guardrails

Key files/tests: `src/pdf/render/guardrails.ts`, `src/app/hooks/usePreviewCanvases.ts`, `src/components/PageSidebar.tsx`, `src/platform/browser/serviceWorker.ts`, `test/unit/render-guardrails.test.ts`, `test/e2e/mobile-layout.test.ts`.

- File/page/canvas limits are browser memory guardrails, not PDF format limits: 150 MB, 250 pages, 16 MP canvas budget, 8192 px canvas edge, and DPR capped at 2.
- Heavy PDF extraction is serialized during load to avoid duplicating large buffers across pdf.js, pdf-lib, image, shape, and font walks.
- Preview/thumbnail caches are bounded or tied to the current document/session. Object URLs and generated download blobs should be revoked/expired because they can contain sensitive PDF pixels/bytes.
- The service worker is registered only in production. Local development should not accidentally cache stale app shells while testing save/render behavior.
- Mobile layout depends on VisualViewport-aware fixed toolbars and app-owned pinch zoom. Do not assume desktop viewport height or unscaled page positions.
