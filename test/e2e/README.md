# E2E Test Suite

Vitest tests under this directory drive the Vite app through Playwright. Use the managed script for normal local and CI runs; it starts Vite on a strict port, waits for readiness, runs Vitest, then stops the server.

## Running

```bash
pnpm test:e2e
```

By default the harness uses `http://127.0.0.1:5173/`. Set `APP_URL` for another local URL, for example:

```bash
APP_URL=http://127.0.0.1:5174/ pnpm test:e2e
```

Targeted runs pass a Vitest file/name fragment or flags after `--`:

```bash
pnpm test:e2e -- move-edit
pnpm test:e2e -- form-fill
pnpm test:e2e -- save-redactions
pnpm test:e2e -- signature
pnpm test:e2e -- -t "theme follows system"
```

If you bypass the managed script and run Vitest directly, start the app first with `pnpm dev`. Vite is configured with `strictPort`, so a busy port fails loudly instead of moving to a port the tests are not using.

The shared browser harness lives in [browser.ts](../helpers/browser.ts). It launches Chromium, loads the app, captures page errors / console warnings, and exposes fixture paths through `FIXTURE`.

## Fixtures

- `maldivian.pdf` - real Maldivian document with broken-aabaafili `/ToUnicode`; canonical Thaana recovery and text edit/move fixture.
- `maldivian2.pdf` - 14-page real Maldivian document with mixed Thaana/English content, images, and a boundary ToUnicode fili mapping bug.
- `mnu-job-application.pdf` - fillable MNU AcroForm application used for `/V` round-trip coverage.
- `with-images.pdf` - synthetic one-page PDF with two known-position PNG image XObjects.
- `with-images-multipage.pdf` - synthetic two-page image fixture for cross-page source-image moves.
- `with-shapes.pdf` - synthetic vector-shape fixture for shape delete and redaction coverage.
- `external-source.pdf` - synthetic two-page PDF for `+ From PDF` first-class external-page behavior.

Regenerate synthetic fixtures with:

```bash
pnpm test:fixtures
```

Generated fixtures are intended to be deterministic. If regeneration changes tracked PDFs unexpectedly, inspect metadata, object ordering, compression, or dependency changes before accepting the diff.

## Coverage

The suite currently has 39 files / 121 e2e tests.

| File                                          | What it covers                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `acroform-save.test.ts`                       | unrelated saves of fillable PDFs rebuild `/Root /AcroForm /Fields`               |
| `annotations.test.ts`                         | annotation save/move/resize/delete; source `/Annots`; same-session ink redaction |
| `caret-at-click.test.ts`                      | source-glyph and trailing-blank clicks place paragraph carets in reflowed text   |
| `cross-page-move.test.ts`                     | drag text run / source image / inserted text / inserted image across pages       |
| `decoration-roundtrip.test.ts`                | inserted underline + strikethrough decorations are emitted into saved PDFs       |
| `delete-objects.test.ts`                      | source image, inserted image, source text, inserted text - all deletable         |
| `delete-shape.test.ts`                        | click-select a vector rect, Del flags it, save drops it                          |
| `delete-source-text-maldivian2.test.ts`       | source-text trash button strips the run                                          |
| `drag-autoscroll.test.ts`                     | edge auto-scroll uses the visual viewport during drags                           |
| `edit-format-duplicate.test.ts`               | font-swap on Form-XObject text: outside-click commits, no duplicates             |
| `edit-format.test.ts`                         | existing/inserted/source formatting overrides persist without bidi word jumps    |
| `edit-text-includes-punct-maldivian2.test.ts` | punctuation clustering and table-cell non-merging against maldivian2             |
| `edit-text-includes-punct.test.ts`            | parens / slash / digits land in the edit box                                     |
| `external-first-class.test.ts`                | external pages: edit run, insert text/image, cross-source drag round-trip        |
| `form-fill.test.ts`                           | AcroForm `/V` values round-trip and reopen with the same fills                   |
| `image-move.test.ts`                          | drag image -> cm rewrite, neighbours untouched                                   |
| `image-resize.test.ts`                        | corner-drag resize anchors the opposite corner across save+reload                |
| `insert-format.test.ts`                       | font / size / bold round-trip from the inserted-text toolbar                     |
| `insert.test.ts`                              | drop text + image -> both persist                                                |
| `italic-save.test.ts`                         | italic toggle emits the shear `cm`; OFF run has none                             |
| `mixed-script.test.ts`                        | bidi-segmented insert (Latin + Thaana) round-trips every codepoint               |
| `mobile-edit.test.ts`                         | tap-to-edit, fixed-bottom toolbar, synthetic touch drag and resize               |
| `mobile-layout.test.ts`                       | 390x844 viewport: no horizontal overflow, drawer closed, app-owned pinch zoom    |
| `mobile-positioning.test.ts`                  | mobile insert/drag positions persist in PDF coordinates                          |
| `move-edit-maldivian2.test.ts`                | move/edit flow against the second Maldivian fixture                              |
| `move-edit.test.ts`                           | move-only / edit-only / move+edit on the Maldivian PDF                           |
| `preview-strip-paragraph-maldivian2.test.ts`  | paragraph-strip coverage on maldivian2                                           |
| `preview-strip-paragraph.test.ts`             | every line under agenda item 6 strips cleanly                                    |
| `preview-strip.test.ts`                       | original image pixels removed from live canvas during drag                       |
| `redact-maldivian2.test.ts`                   | partial rect preserves outside glyphs; full redaction removes text/bytes         |
| `save-redactions.test.ts`                     | image/vector/annotation/form content under redactions is sanitized               |
| `signature.test.ts`                           | visual signature draw/import -> local library, cleanup, insert, save             |
| `sidebar-pdf-drop.test.ts`                    | PDF file drops show a sidebar insertion marker and add pages at that gap         |
| `source-font-detection.test.ts`               | source BaseFont selection keeps Thaana edit fields on the source font            |
| `source-paragraph-wysiwyg.test.ts`            | active/committed/saved source paragraphs preserve indentation and ink geometry   |
| `text-box-resize.test.ts`                     | resized inserted/source text boxes reflow, justify, and save to the same bounds  |
| `text-alignment.test.ts`                      | source and inserted text alignment toolbar choices persist into saved PDFs       |
| `theme.test.ts`                               | system default + override, OS-flip tracking, persistence                         |
| `undo.test.ts`                                | every recordable mutation undoes + redoes; coalescing                            |

One-off investigation scripts live in [scripts](../../scripts). They are useful for diagnostics, but changes to user-facing behavior should land in this e2e suite rather than only in a probe script.
