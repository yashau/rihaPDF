# RTL Source Editing Checkpoint

This is an implementation checkpoint, not a finished design. The source text editor is now much closer to WYSIWYG for the tested Thaana source-edit cases, but it is still a high-risk area. This note records what has been learned so the same failed paths do not get repeated.

## Current Goal

The editor must let users edit source PDF text while preserving the rendered appearance closely enough that opening an edit box does not visibly reorder Thaana, dates, list markers, parentheses, or punctuation. It also needs to keep per-character rich formatting working through Lexical for source text and inserted text.

## Current State

- Source paragraphs are grouped into multi-line edit blocks with `buildSourceTextBlocks`.
- The live source editor uses Lexical contenteditable, not a plain input.
- RTL editor direction is forced from detected RTL text, because relying on the `dir` prop alone was not enough in the rendered DOM.
- Source-layout paragraph rows use the PDF-derived line boxes first. CSS `text-align: justify` is allowed only as a final row-level paint aid for formatted source-layout lines; it is not allowed to drive wrapping or indentation.
- RTL paragraph line breaks are preserved as explicit newlines. Browser wrapping is not trusted for source paragraphs.
- For justified RTL lines, `textBlocks.ts` records source line geometry and spacing. Rich source edits reuse that geometry in the live editor, committed overlay, and saved PDF draw path instead of reflowing the paragraph from scratch.
- Display-only text normalization in `EditField.tsx` fixes several common bidi/punctuation artifacts before the text is handed to Lexical.
- Source edit geometry is shared between the live editor and the committed overlay through `sourceEditGeometry.ts`, so the edit box and committed HTML overlay use the same enlarged box, line height, and source-line offsets.
- Multi-line source blocks render line-by-line using PDF-derived line layouts in both the live editor and committed overlay.
- Saved RTL source edits strip a wider set of original `Tj`/`TJ` operators around each edited line, then redraw replacement text token-by-token so dates, numeric markers, and parenthesized mixed text do not collapse into one malformed RTL shape.
- The latest committed-overlay fix keeps line-level RTL plaintext behavior and avoids isolating every rendered span by default. This was necessary because per-span isolation made the committed render diverge from the edit box after deleting words.
- Per-character formatting is now represented as rich-text spans for both inserted text and source text. Single-line uniform source formatting can commit as a compact source style override, while paragraphs and partial-format source edits keep rich text plus line layouts so save output stays visually aligned.
- Table rows are guarded during paragraph grouping. Adjacent rows in `maldivian2.pdf` table regions must not merge into one paragraph merely because their x positions and line spacing look compatible.
- Paragraph caret placement has a trailing-blank click path: clicking after the final visible glyph should place the caret at the end of the text, not at the first character.

## What Failed

### Glyph Span Reconstruction

An attempted lower-layer approach used content-stream `glyphSpans` / caret pieces to reconstruct visual text. This became worse than the earlier state and was reverted.

Problem: the available glyph span data was not a proven "literal rendered text order". Some of it had already passed through logical text recovery, item grouping, bidi correction, or caret reconstruction. Feeding that back into the editor caused ordering to become chaotic.

Takeaway: do not assume glyph span index order equals visual text order. If revisiting this, first build a diagnostic that proves each character is paired to the glyph it actually paints, then compare that against an independent renderer.

### Browser `text-align: justify`

Forcing CSS `text-align: justify` and `text-align-last: justify` on the contenteditable looked plausible but was wrong.

Observed result:

- It stretched lines differently from the PDF.
- It locked line edges in ways that made the editor visibly worse.
- Chromium / Lexical also fought some inline style values, so computed style had to be checked directly.

Current rule:

- Do not let browser wrapping decide source paragraph line breaks.
- Preserve explicit source line layouts.
- Use CSS justification only when a source-layout line is already fixed and needs formatted-span paint parity with the committed/saved draw path.

Takeaway: source PDF text uses PDF positioning and word spacing, not browser paragraph layout. Browser justification can help final paint in a constrained source row, but it should not be the layout algorithm.

### Leading Indent Spaces in RTL Paragraphs

The earlier indentation method prepended spaces to continuation lines. That is okay-ish for LTR, but wrong for RTL.

Observed result:

- Continuation lines shared the same visual left edge.
- The editor looked left-aligned even though it was direction `rtl`.

Fix so far:

- Do not prepend indent spaces for RTL blocks.
- Instead, preserve explicit line breaks and add line-local spacing only for justified RTL lines.

### Per-Span Isolation in the Committed Overlay

The committed overlay briefly wrapped every rendered span in an isolated bidi context. That made text look stable in some simple cases, but it diverged from the live Lexical editor after editing/removing words in mixed RTL/LTR lines.

Observed result:

- Dates and parentheses could look correct in the edit box and saved PDF but shift in the committed HTML overlay.
- Word removal could cause line content to reflow differently between edit and committed render.

Fix so far:

- Keep the line row itself in the RTL plaintext context.
- Do not isolate every span by default.
- Only isolate a span when it carries an explicit direction override from rich-text styling.
- Continue protecting numeric/date markers for display so committed text keeps the same LTR-isolate behavior as the editor.

Takeaway: bidi context must be line-level for source-layout overlays. Per-token or per-span isolation is too aggressive unless the user explicitly applied a directional style.

### Formatting Commits

Formatting exposed a separate bug from text deletion and insertion. Deleting words could keep the paragraph geometry stable, while applying bold to a selected source word punted the styled word to the wrong visual edge.

Observed result:

- Partial bold on a single-line RTL source run moved the selected word to the beginning of the sentence.
- Paragraph formatting did not commit because unchanged display-normalized text was being simplified back to plain source text too aggressively.
- Tests that checked only the root `contenteditable` font weight missed the real state; Lexical applies style to text-node wrappers.

Fix so far:

- Source edit commit decisions now live in `src/domain/sourceEditCommit.ts`.
- Unchanged display-normalized text can still keep `richText` when any span has an explicit style.
- Single-line uniform style edits can still collapse to a compact `style` override.
- Paragraph edits keep rich text when formatting is involved so line-layout rendering and save output use the same spans as the editor.
- E2E tests inspect the styled text-node wrapper and compare active-editor pixels against committed and saved output.

Takeaway: text equality is not enough to decide whether a source edit is a no-op. Rich span styling is part of the edit payload even when the displayed string is unchanged.

## Visual Testing Workflow

Do not trust text-only tests for this area.

The useful workflow is:

1. Load `test/fixtures/maldivian.pdf` in a fresh Vite server.
2. Capture the original canvas crop around a specific `data-run-id`.
3. Open the editor for that same run.
4. Hide the toolbar with injected CSS so it does not pollute the comparison.
5. Capture the same crop with the editor open.
6. Generate a side-by-side image plus an amplified difference image.
7. Inspect the image, not only DOM text.

This workflow has now been promoted into `test/e2e/source-paragraph-wysiwyg.test.ts` for the known Maldivian paragraph cases. The test compares active editor, committed overlay, and saved/reopened PDF ink geometry with very low tolerances.

Useful generated files from this checkpoint live under `test-logs/visual-compare/`. These are diagnostic artifacts and should not be committed.

Examples that were useful:

- `p2-b12`: paragraph `6.2`, useful for alignment and multi-line spacing.
- `p2-b11`: paragraph `6.1`, useful for slash-date and parenthesized text.
- `p2-r6`: the `3-1` line with `14/1/2026`, useful for parentheses, dates, and section markers.
- `p2-r7`: single-line `.4`, useful for list-marker dot placement.
- `p1-r10`: `29 April 2026`, useful for comma-side spacing.

## Independent Renderer Comparison

PDFium and MuPDF were used as references during debugging.

Findings:

- PDFium and MuPDF agree well on physical character boxes.
- Their extracted text order is still not directly usable as editable text.
- PDFium may report marker text in extraction order that differs from the visual marker order.
- MuPDF may split the same visual line into multiple spans.

Takeaway: independent renderers are useful for verifying physical boxes, not for blindly replacing the app's editable string.

## Bidi and Punctuation Pitfalls

### Dates and Slash Numbers

The source extraction may contain slash-number sequences in the opposite order from the desired editor display. Example:

- Source text: `2026/1/14`
- Editor display should show: `14/1/2026`

The editor display path reverses slash-number components for RTL text.

### Numeric Isolates

Dates and numeric markers need LTR isolates so the browser does not reorder their digits and slashes.

Pitfall: do not include surrounding parentheses in the isolate. Wrapping `14/1/2026)` made the closing parenthesis behave like part of the LTR token.

Current rule:

- Isolate the number/date itself.
- Keep parentheses in the surrounding RTL flow.

### Section and List Markers

Observed marker cases:

- `.13` should display as `3-1` for the section marker line.
- A simple list marker should display as `.4`, not `4.` and not with the dot drifting away.

This is currently handled as display normalization before Lexical initialization.

### Parentheses

Extracted source text can include synthetic spaces near parentheses:

- `( އ...`
- `ާ )`
- `( 3 ...`

These spaces can be visual artifacts from extraction rather than actual desired editor spacing.

Current display cleanup:

- Remove spaces after an opening parenthesis when followed by RTL text or a digit.
- Remove spaces before a closing parenthesis when preceded by RTL text.

Save-side note:

- The saved PDF path cannot rely on browser bidi.
- RTL rich lines are tokenized and passed through bidi-js visual ordering before PDF drawing.
- Parentheses are mirrored only through bidi-level handling in the save path. A previous attempt to simply force parenthesis tokens to RTL made output worse.

### Commas

There are two different comma-space cases and they must not be confused:

- Bad: space before comma, e.g. `2026 ،` or `ވާ ،`
- Usually good: space after comma before the next word, e.g. `، ބ`

Current display cleanup:

- Remove spaces before Arabic/Latin commas when preceded by a digit or RTL character.
- Preserve the space after comma before the next word.

## Current Relevant Code

- `src/components/PdfPage/EditField.tsx`
  - Builds the display text handed to Lexical.
  - Applies RTL display-only normalization for slash dates, markers, parentheses, and comma spacing.
  - Uses `sourceEditCommitValue` so no-op display normalization, single-line uniform formatting, and paragraph rich-text formatting are handled in one place.

- `src/domain/sourceEditCommit.ts`
  - Decides whether a source edit should persist as plain text, compact style, rich-text spans, or some combination.
  - Keeps rich text when formatting is meaningful even if the displayed string itself did not change.

- `src/components/PdfPage/RichTextEditor.tsx`
  - Uses Lexical for rich text.
  - Forces RTL direction when the initial text contains RTL.
  - Isolates numeric markers/dates without swallowing parentheses.
  - Preserves source line layouts in the live contenteditable.
  - For committed source-layout overlays, keeps line-level bidi context and avoids default per-span isolation.
  - Handles clicks after trailing blank area by moving the caret to the last character on that line.

- `src/components/PdfPage/sourceEditGeometry.ts`
  - Centralizes source edit box geometry so the live editor and committed overlay use the same width, height, line height, and line-layout offsets.
  - Gives single-line source edit boxes extra width because contenteditable rendering is not byte-for-byte identical to source PDF text and needs breathing room.

- `src/pdf/text/textBlocks.ts`
  - Groups source lines into paragraph blocks.
  - Avoids leading-indent spaces for RTL paragraphs.
  - Detects table-like neighbouring rows so adjacent table cells do not merge into one paragraph block.
  - Records line-layout geometry and justification hints for source paragraph rows.

- `src/pdf/save/streamSurgery.ts`
  - Expands multi-line source edit stripping by baseline and x-range, not only direct op indices.
  - Uses the same widened RTL draw box for non-paragraph source edits so saved output matches the editor/overlay box.
  - Carries source line-layout justification hints into rich save drawing when formatting requires it.

- `src/pdf/save/textDraw.ts`
  - Draws RTL rich text token-by-token.
  - Splits numeric/date tokens out of mixed RTL text so they can stay LTR in saved PDFs.
  - Uses bidi-js visual token ordering for saved RTL rich lines to handle parentheses and mixed numeric text more like the browser editor.
  - Uses formatted-span-aware line justification so applying style does not change paragraph indentation or word placement relative to the editor.

## Known Remaining Work

- Alignment is much closer for the tested `maldivian.pdf` blocks, but it is still not a formally proven pixel-perfect renderer.
- Source paragraphs now have strict visual regression coverage, but only for the pinned Maldivian fixtures and selected edit operations.
- Commit and save behavior after edits still need careful visual verification, especially around dates, parentheses, section markers, list markers, table rows, and mixed formatted spans.
- The saved PDF path is close for tested parenthesis/date/formatting cases, but it is a separate renderer and can still diverge from browser layout in untested mixed-script cases.
- A future lower-layer approach may still be valid, but only if character-to-glyph pairing is proven against physical render boxes first.

## 2026-05-08 End State

This round ended with the source paragraph editor in a usable, much better state for the known Maldivian agenda cases. It is not perfect, but it is good enough that the tested edit box, committed overlay, and saved/reopened PDF are now close to each other under visual regression tests.

What is working now:

- `maldivian.pdf` agenda paragraphs `6.1` and `6.2` are covered by E2E visual comparisons while editing, after committing, and after saving/reopening.
- The live edit box and committed overlay are kept on a near-zero tolerance path. This is the most important WYSIWYG check because both are browser-rendered and should not meaningfully reflow relative to each other.
- The saved/reopened PDF comparison is intentionally a little looser. The saved output is rendered back through pdf.js canvas, while the committed overlay is browser HTML. CI showed real edge and centroid differences from font rasterization and hinting even when the paragraph shape was correct.
- Source paragraph line layouts now preserve explicit PDF line breaks and source-derived line geometry. The implementation avoids letting the browser rewrap Thaana paragraphs from scratch.
- Applying partial formatting inside source paragraphs no longer punts the formatted word to the wrong visual side of the line in the tested cases.
- Source save output now handles the tested mixed Thaana/date/parenthesis cases much better than the earlier attempts.
- Single-line source edits retain extra box width/height headroom to avoid accidental wrapping from contenteditable rendering differences.
- Table-adjacent text in `maldivian2.pdf` is guarded so table rows do not get merged into paragraph edit blocks.
- The CI run for commit `955513f` passed after stabilizing the 6.2 saved-PDF visual threshold.

The final visual thresholds are deliberate:

- Edit box vs committed overlay should remain very tight. A failure there usually means real UI WYSIWYG drift.
- Source PDF vs edit box and committed overlay vs saved PDF allow more edge movement because they compare different renderers and different font rasterization paths.
- Thresholds should not be loosened casually. If they fail again, inspect the failure output line-by-line first; only widen when the geometry still clearly represents the same paragraph layout.

Remaining gotchas:

- This is still a pragmatic WYSIWYG approximation, not a true copy of the PDF renderer.
- Browser HTML, pdf.js canvas, and saved PDF drawing are three different renderers. Small edge differences can be legitimate; line reordering, wrong indentation, punctuation migration, or line overlap are not.
- The punctuation cleanup is based on observed extraction artifacts. New punctuation classes may need explicit tests before changing normalization rules.
- Mixed bidi cases should be tested with the whole line, not only the numeric/date token. Parentheses, commas, and surrounding Thaana words are where regressions usually hide.
- Lower-layer glyph matching may still be the right long-term solution, but only after proving actual character-to-glyph pairing and visual order against rendered boxes. The previous glyph-span reconstruction attempt made ordering worse.
