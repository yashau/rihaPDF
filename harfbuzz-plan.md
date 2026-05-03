# HarfBuzz-shaped save pipeline

## Goal

Replace pdf-lib's `drawText` for the Thaana save path with a custom
emitter that takes pre-shaped glyph IDs from harfbuzzjs and writes raw
`Tj` operators against a `subset: false` Type 0 / Identity-H font.

Unblocks correct GPOS mark positioning (fili anchored to the consonant
they sit over, not at a fixed offset from the cursor) and fixes Thaana
inside `/FreeText` comments. Same emitter serves both call sites.

## Why this works (and why the README's blocker statement is wrong)

The README claims:

> pdf-lib renumbers glyph IDs during embed even with `subset: false`,
> so HarfBuzz-shaped CIDs cannot be written through `drawText`.

This is incorrect. Reading pdf-lib's source:

- [CustomFontEmbedder.js:135](node_modules/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js#L135)
  sets `CIDToGIDMap: 'Identity'` — CIDs == native GIDs.
- [CustomFontEmbedder.js:184-188](node_modules/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js#L184-L188)
  `serializeFont` returns `this.fontData` verbatim — bytes are unchanged.
- The `W` array uses native `glyph.id`s from fontkit.

So GIDs HarfBuzz returns from a font's TTF bytes match the GIDs pdf-lib
expects in the Tj operand. The actual obstacle is narrower:
`drawText(string)` calls `encodeText(string)` which calls fontkit's
`font.layout(text)` ([CustomFontEmbedder.js:51-58](node_modules/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js#L51-L58)) —
fontkit re-shapes through its own (Thaana-incomplete) engine, discarding
HarfBuzz's output.

We don't need to fight pdf-lib. Its public API exposes every operator
we need: `beginText`, `endText`, `setFontAndSize`, `setTextMatrix`,
`moveText`, `showText`
([operators.js:128-138](node_modules/pdf-lib/cjs/api/operators.js#L128-L138)),
plus `page.pushOperators(...)` and `page.setFont(font)`
([PDFPage.js:574-579](node_modules/pdf-lib/cjs/api/PDFPage.js#L574-L579)).

## Why the previous raw-ops attempt failed (commit `1a8f23e`)

The reverted code used `PDFName.of(pdfFont.name)` as the operand of
`Tf`. `pdfFont.name` is the **BaseFont** string (`DhivehiEdit_Faruma_xxxxx`),
not the **page resource key** (`/F1`, `/F2`...). Acrobat / pdf.js then
treated the unknown font name as a fallback Latin font, which is why
the commit message describes "Latin garbage."

The fix: always call `page.setFont(pdfFont)` first, then read the
populated `page.fontKey` field — that's the right `PDFName` to feed
into `Tf`. `setFont` registers the font in the page's
`/Resources/Font` dict via `node.newFontDictionary` and returns the
generated key.

CIDToGIDMap was a red herring in that commit message. With
`subset: false` it's always `Identity`. The bug was the resource name.

## Architecture

One emitter, three callers.

```
src/lib/shapedDraw.ts                   ← new
  drawShapedText(page, plan)
    1. shape via shape.ts (already exists)
    2. page.setFont(pdfFont)            → page.fontKey = /Fn
    3. push: BT
    4. push: Tf <fontKey> <size>
    5. push: nonStrokingColor (rgb)
    6. push: Tm <a 0 0 d e f>           start at baseline
    7. for each shaped glyph:
         if (xOffset|yOffset != 0):
           push: Td <xOffset/upem * size> <yOffset/upem * size>
         push: <hex GID>Tj
         if (any offset applied):
           push: Td <-xOffset+xAdvance/upem*size> <-yOffset/upem*size>
         else:
           push: Td <xAdvance/upem*size> 0
    8. push: ET
```

Decorations (underline / strikethrough) and italic shear `cm` stay
**outside** the BT…ET block in their existing places — no change.

### Callers

1. **`drawTextWithStyle`** ([src/lib/save.ts:257-279](src/lib/save.ts#L257-L279)) —
   used by `emitTextDraw` (run edits / cross-page moves) and the
   `textInserts` loop. Becomes a dispatcher: Thaana script → new
   emitter; standard-14 fonts (Helvetica, Times, Courier) → existing
   `page.drawText`. The dispatch is a one-line check on the resolved
   `family`'s entry in [src/lib/fonts.ts](src/lib/fonts.ts) — if the
   family has `standardFont`, use drawText; else use the shaped
   emitter.

2. **`textInserts` loop** ([src/lib/save.ts:556-593](src/lib/save.ts#L556-L593)) —
   the inline `page.drawText` call goes through `drawTextWithStyle`
   already, so this is covered by (1).

3. **`/FreeText` comment annotations** ([src/lib/saveAnnotations.ts:153](src/lib/saveAnnotations.ts#L153)) —
   today writes `/DA "/Helv NN Tf 0 0 0 rg"` and relies on the viewer
   to render `/Contents`. Thaana viewers don't run a shaping pipeline
   on `/Contents`, so fili stack wrong or appear as `.notdef`. Fix:
   build an `/AP /N` appearance-stream Form XObject per comment with
   the same emitter writing into the form's content stream, plus
   register the embedded Faruma in `/AcroForm/DR/Font` so legacy
   viewers without `/AP` regeneration still render the right glyphs.

## Width measurement

Today `pdfFont.widthOfTextAtSize(text, size)` ([PDFFont.js:50-54](node_modules/pdf-lib/cjs/api/PDFFont.js#L50-L54))
goes through fontkit's layout. After the switch, the source of truth
for shaped width is `shape.totalAdvance / shape.unitsPerEm * size`.

Where this matters in the codebase:

- [src/lib/save.ts:575](src/lib/save.ts#L575) — `widthPt` for
  RTL right-alignment and underline geometry on text inserts.
- [src/lib/save.ts:1028](src/lib/save.ts#L1028) — `widthPt` for
  RTL right-alignment in `emitTextDraw`.

Both must use the HarfBuzz advance, not the fontkit one. Otherwise
the run starts at the wrong x and the underline misses the glyphs.
Cleanest packaging: have the emitter return the shaped width so the
caller passes it straight into `drawDecorations`.

## Phases

### Phase 1 — Thaana-only emitter (≈1 day)

- New `src/lib/shapedDraw.ts` exporting `drawShapedText(page, opts)`
  and `measureShapedWidth(text, fontBytes, size)`.
- Wire `drawTextWithStyle` to dispatch by family. Standard-14 fonts
  keep `page.drawText`; everything else routes to the emitter.
- Plumb `fontBytes` from `loadFontBytes(family)` through
  `LoadedSourceContext.getFont`. Either expose a sibling
  `getFontBytes(family)` cache or extend `getFont` to return
  `{ pdfFont, bytes }`.
- Replace `widthOfTextAtSize` calls in the two spots above with the
  shaped measurement.

Acceptance: open `test/fixtures/maldivian.pdf`, edit a fili-bearing
run, save, parse the saved Tj operands. The hex CIDs must match the
GIDs HarfBuzz returns for the same input.

### Phase 2 — `/FreeText` `/AP` appearance streams (≈0.5 day)

- In `buildCommentDict`, when the comment text contains Thaana
  codepoints, build a Form XObject `/AP /N` whose content stream is
  the emitter's output sized to the comment's `/Rect`.
- Register Faruma in the doc's `/AcroForm/DR/Font` so legacy viewers
  fall back gracefully if they ignore `/AP`.
- Latin-only comments keep today's `/Helv` `/DA` path — no `/AP`
  needed; viewers handle them fine.

Acceptance: comment containing `ދިވެހި` renders correctly in Acrobat,
Preview, Chrome, pdf.js, Firefox.

### Phase 3 — Mixed-script BiDi (≈1 day, deferrable)

- Run `bidi-js` `getEmbeddingLevels` on the input.
- Segment by level + script (Latin runs vs Thaana runs).
- Shape each segment separately with the right primary font (Latin →
  Arial, Thaana → Faruma) using `shapeWithFallback`
  ([src/lib/shape.ts:141](src/lib/shape.ts#L141)) which already exists.
- Emit segments in **visual** order (bidi-js's reorder output).

The toolbar's explicit `dir` button still wins; bidi-js is the
fallback for `dir === undefined`.

Acceptance: run "abc ދިވެހި 123 xyz" through edit + save. Visual order
in the saved PDF matches the screen rendering.

## Files touched

| File                                                     | Change                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/lib/shapedDraw.ts`                                  | **new** — emitter + width helper                                                              |
| [src/lib/save.ts](src/lib/save.ts)                       | `drawTextWithStyle` dispatches by family; widths go through emitter                           |
| [src/lib/fonts.ts](src/lib/fonts.ts)                     | maybe add a typed `getFontBytes` accessor (already has `loadFontBytes`)                       |
| [src/lib/saveAnnotations.ts](src/lib/saveAnnotations.ts) | `buildCommentDict` builds `/AP` for Thaana comments                                           |
| [src/lib/shape.ts](src/lib/shape.ts)                     | unchanged in P1; P3 may add a tiny `shapeMixed` helper that wraps bidi-js + shapeWithFallback |

## Tests

- **Unit**: `shapedDraw.test.ts` — feed known Thaana strings + the
  bundled Faruma bytes; assert emitted operator sequence has the
  expected `Tf <key> <size>`, expected `Tm`, and the right hex CIDs in
  Tj order.
- **E2E (vitest + playwright)**: extend the existing fixture suite
  with a "shape-fidelity" test — open `maldivian.pdf`, edit a run to
  contain a stacked-fili cluster (e.g. `ޝަރުޠު`), save, re-load with
  pdf.js, render to canvas, and assert the visual-position of the fili
  glyph relative to the base is within ~1px of where HarfBuzz placed
  it in font units. Use the existing `verify*` probe pattern.
- **Annotation**: write a comment containing Thaana, save, re-load,
  assert `/AP /N` exists and that pdf.js renders the comment without
  `.notdef` boxes.

Per [feedback_test_logs](C:/Users/Yashau/.claude/projects/c--Users-Yashau-Projects-rihaPDF/memory/feedback_test_logs.md):
redirect long test runs to a logfile and grep, don't tail.

## Risks

- **Font key drift**: `page.setFont(pdfFont)` mutates `page.fontKey`.
  Anything between our `setFont` and our `Tf` push that calls
  `setFont` for a different font invalidates our key. The emitter
  must read `page.fontKey` _immediately_ after its own `setFont` and
  push `Tf` synchronously.
- **CFF fonts**: pdf-lib uses `CIDFontType0` with `FontFile3`
  ([CustomFontEmbedder.js:134, 176](node_modules/pdf-lib/cjs/core/embedders/CustomFontEmbedder.js#L134))
  for CFF; CIDToGIDMap is still Identity, so the emitter doesn't care.
  Worth a smoke test on any CFF-based bundled family.
- **Width round-tripping**: any caller still using
  `widthOfTextAtSize` after the switch will mis-align. Audit the
  three current call sites; eliminate them all in P1.
- **Vertical metrics**: HarfBuzz returns `yAdvance`. For horizontal
  Thaana it should be 0; assert this in the emitter and bail loud if
  not (would indicate a font-table problem).
- **Standard-14 fallback**: families with `standardFont` set in
  [src/lib/fonts.ts](src/lib/fonts.ts) have no TTF bytes — must
  fall through to `page.drawText`. Single guard at the dispatch.

## Open questions

1. Where does `fontBytes` live during the save loop? Cleanest is to
   extend `LoadedSourceContext.getFont` to return `{ pdfFont, bytes,
harfbuzzFont }` and cache the HB face alongside pdf-lib's embed.
   The cache key matches `(family, bold, italic)`.
2. Italic on shaped runs: the existing `cm` shear sits outside BT/ET
   — it composes with our raw operators just as it did with
   `drawText`. No change. Confirm with a smoke test.
3. Bold: today bold uses `Tr 2` (fill+stroke) — that's a text-state
   operator that lives between BT and ET. The emitter needs to push
   `Tr 2` before the per-glyph `Tj` loop when `bold && !nativeBold`,
   and reset to `Tr 0` after. Faruma has no real bold variant, so
   every Thaana bold needs this.
