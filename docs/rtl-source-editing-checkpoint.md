# RTL Source Editing Checkpoint

This is an implementation checkpoint, not a finished design. The source text editor is now much closer to WYSIWYG for the tested Thaana source-edit cases, but it is still a high-risk area. This note records what has been learned so the same failed paths do not get repeated.

## Current Goal

The editor must let users edit source PDF text while preserving the rendered appearance closely enough that opening an edit box does not visibly reorder Thaana, dates, list markers, parentheses, or punctuation. It also needs to keep per-character rich formatting working through Lexical for source text and inserted text.

## Current State

- Source paragraphs are grouped into multi-line edit blocks with `buildSourceTextBlocks`.
- The live source editor uses Lexical contenteditable, not a plain input.
- RTL editor direction is forced from detected RTL text, because relying on the `dir` prop alone was not enough in the rendered DOM.
- Browser CSS justification is deliberately not used for the live contenteditable. Visual testing showed it made the editor worse by stretching every line according to browser rules rather than the PDF's text positioning.
- RTL paragraph line breaks are preserved as explicit newlines. Browser wrapping is not trusted for source paragraphs.
- For justified RTL lines, extra spaces are synthesized per line in `textBlocks.ts` to approximate source PDF word spacing. This is a compromise and is still not pixel-perfect.
- Display-only text normalization in `EditField.tsx` fixes several common bidi/punctuation artifacts before the text is handed to Lexical.
- Source edit geometry is shared between the live editor and the committed overlay through `sourceEditGeometry.ts`, so the edit box and committed HTML overlay use the same enlarged box, line height, and source-line offsets.
- Multi-line source blocks render line-by-line using PDF-derived line layouts in both the live editor and committed overlay.
- Saved RTL source edits now strip a wider set of original `Tj`/`TJ` operators around each edited line, then redraw replacement text token-by-token so dates, numeric markers, and parenthesized mixed text do not collapse into one malformed RTL shape.
- The latest committed-overlay fix keeps line-level RTL plaintext behavior and avoids isolating every rendered span by default. This was necessary because per-span isolation made the committed render diverge from the edit box after deleting words.

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

Takeaway: source PDF text uses PDF positioning and word spacing, not browser paragraph layout. Browser justification should not be the live editor's main layout mechanism.

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
  - Maps an unchanged display-only edit back to source text on commit so a no-op editor close does not persist display-normalized text.

- `src/components/PdfPage/RichTextEditor.tsx`
  - Uses Lexical for rich text.
  - Forces RTL direction when the initial text contains RTL.
  - Isolates numeric markers/dates without swallowing parentheses.
  - Does not use browser justification in the live contenteditable.
  - For committed source-layout overlays, keeps line-level bidi context and avoids default per-span isolation.

- `src/components/PdfPage/sourceEditGeometry.ts`
  - Centralizes source edit box geometry so the live editor and committed overlay use the same width, height, line height, and line-layout offsets.
  - Gives single-line source edit boxes extra width because contenteditable rendering is not byte-for-byte identical to source PDF text and needs breathing room.

- `src/pdf/text/textBlocks.ts`
  - Groups source lines into paragraph blocks.
  - Avoids leading-indent spaces for RTL paragraphs.
  - Synthesizes extra word spacing for justified RTL lines as a current approximation.

- `src/pdf/save/streamSurgery.ts`
  - Expands multi-line source edit stripping by baseline and x-range, not only direct op indices.
  - Uses the same widened RTL draw box for non-paragraph source edits so saved output matches the editor/overlay box.
  - Disables save-side re-justification for source-layout lines because the UI now preserves the source line geometry instead.

- `src/pdf/save/textDraw.ts`
  - Draws RTL rich text token-by-token.
  - Splits numeric/date tokens out of mixed RTL text so they can stay LTR in saved PDFs.
  - Uses bidi-js visual token ordering for saved RTL rich lines to handle parentheses and mixed numeric text more like the browser editor.

## Known Remaining Work

- Alignment is much closer for the tested `maldivian.pdf` blocks, but it is still not a formally proven pixel-perfect renderer.
- The synthetic-space approximation remains a compromise. The better current path is preserving PDF-derived line boxes and avoiding browser justification for source-layout text.
- Commit and save behavior after edits still need careful visual verification, especially when deleting words around dates, parentheses, section markers, and list markers.
- The saved PDF path is now close for tested parenthesis/date cases, but it is a separate renderer and can still diverge from browser layout in untested mixed-script cases.
- The visual testing workflow should be turned into a repeatable script/test if this work continues.
- A future lower-layer approach may still be valid, but only if character-to-glyph pairing is proven against physical render boxes first.
