# Annotations and visual objects

rihaPDF has two families of visible additions: native PDF annotations and page-content visual objects. They look similar in the editor, but they save differently.

## Native annotations

Native annotations are written as PDF annotation dictionaries in `src/pdf/save/annotations.ts`.

Supported app-level annotations:

- highlights,
- freehand ink,
- comments as `/FreeText` annotations.

Highlights save as `/Highlight` with quad points. Ink saves as `/Ink` with stroke lists and border style. Comments save as `/FreeText`; Thaana comments get a custom normal appearance stream so fili/marks are shaped with HarfBuzz instead of trusting each viewer's annotation renderer.

## Visual objects

Visual objects are drawn into page content rather than saved as interactive PDF annotations:

- inserted images,
- moved source images,
- visual signatures,
- inserted text boxes,
- replacement source text.

Visual signatures are just reusable image inserts with background cleanup. They are not cryptographic PDF signatures and do not alter document signing state.

## Editor layers

The React page component stacks:

1. rendered PDF canvas,
2. source-run hit overlays,
3. image/text/comment/ink/signature/redaction overlays,
4. toolbars and drag previews.

Some overlays are preview-only. For example, a redaction box in the editor hides content visually, but actual redaction happens only in the save pipeline.

## Saving comments with Thaana

FreeText comment appearance generation is one of the places the shaped text pipeline is reused outside ordinary page content. The comment's `/AP /N` Form XObject registers the embedded font in its own resource dictionary and uses `buildShapedTextOps` to emit shaped glyph IDs.

This avoids the common viewer problem where annotation text renders with wrong mark placement or wrong fallback fonts.

## Redaction and annotations

Redaction handles annotations by type:

- Text markup quads can be clipped so non-redacted portions survive.
- Ink strokes can be split around redaction rectangles.
- Widgets are treated as forms and removed on overlap.
- Unsupported or text-bearing annotations are removed when they overlap because their dictionaries can contain recoverable `/Contents`, `/AP`, `/Popup`, actions, or other hidden data.

## Change rules

- Be explicit whether a feature saves as page content or a native annotation.
- Do not assume editor overlay behavior equals saved PDF behavior.
- For Thaana text in annotations, prefer deterministic appearance streams over viewer regeneration.
- For redaction overlap, remove annotation data if there is any chance hidden text/content remains.
