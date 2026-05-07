# Unit Test Suite

Vitest tests under this directory exercise focused parser, geometry, text-run, and redaction internals without launching the Vite dev server or Playwright.

## Running

```bash
pnpm test test/unit
```

Targeted runs can pass a file path or name fragment through the existing script:

```bash
pnpm test test/unit/content-stream.test.ts
pnpm test test/unit run redaction
```

## Coverage

The suite currently has 39 unit tests.

| File                               | What it covers                                                              |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `content-stream.test.ts`           | PDF content-stream token parsing/serialization and text-show state tracking |
| `redaction-annotations.test.ts`    | new/native annotation clipping, side-data scrubbing, and removal fallbacks  |
| `redaction-forms.test.ts`          | AcroForm widget removal, field value scrubbing, and sibling-widget cleanup  |
| `redaction-geometry.test.ts`       | rectangle overlap semantics and PDF `/Rect` normalization                   |
| `redaction-glyphs.test.ts`         | simple/composite font metrics, per-glyph rewrites, drops, and fallbacks     |
| `redaction-save-internals.test.ts` | raster pixel sanitization, vector strip marking, and XObject pruning        |
| `rtl-display-text.test.ts`         | RTL source-edit display normalization for dates, times, and punctuation     |
| `text-run-builder.test.ts`         | RTL base/mark ordering, mixed digit placement, and source font ownership    |
| `text-blocks.test.ts`              | source run grouping into editable paragraph blocks and table-row boundaries |

Add unit tests here for pure internals where synthetic inputs can lock down behavior faster and more directly than an E2E browser round-trip. User-facing save, layout, and interaction behavior should still be covered in [../e2e](../e2e) when the browser workflow matters.
