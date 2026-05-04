# Form Filling Plan

Add interactive AcroForm filling to rihaPDF. The goal is a user
opening a PDF with form fields (e.g. a Maldivian government
application) can tab through them, type Thaana with the same
phonetic-Latin transliteration the edit box uses, and save a PDF
whose `/V` values round-trip cleanly through Acrobat / Preview /
Chrome / pdf.js.

XFA forms are out of scope (deprecated by ISO 32000-2; rare in
.mv government PDFs); only AcroForm is targeted.

## What "form filling" means here

Per PDF 32000-1:

- An **AcroForm** dict lives on `/Root /AcroForm`. It carries
  `/Fields` (top-level field tree), `/DR` (default resources —
  fonts referenced by `/DA`), `/DA` (default appearance string),
  `/NeedAppearances` (flag asking viewers to regenerate `/AP`).
- **Field types** (`/FT`):
  - `Tx` — text box (single-line, multi-line, password, file)
  - `Btn` — checkbox, radio button, push-button (distinguished
    by the `/Ff` bit flags)
  - `Ch` — combo box / list box
  - `Sig` — signature (read-only in v1; we surface but don't fill)
- **Widget annotations**: `/Subtype /Widget` entries on a page's
  `/Annots`. A widget either is the field itself (terminal field)
  or references a field via `/Parent`. Widgets carry `/Rect` for
  geometry.
- **Value** is the field's `/V`. Text → `/V (string)`. Checkbox
  → `/V /Yes` or `/V /Off`. Radio group → `/V /<chosenAppearanceState>`.
  Choice → `/V (string)` or `/V [arr]` for multi-select.
- **Appearance** (`/AP /N`) is the rendered look for that value.
  Viewers either regenerate it from `/DA + /V` (if
  `/NeedAppearances true`) or trust the embedded stream.

## Reuse from existing edit pipeline

The form filling implementation should lean on:

- [useThaanaTransliteration](src/lib/thaanaKeyboard.ts#L119) hook —
  attach to every text/textarea field's ref. Mobile-only gate is
  identical to EditField's.
- [THAANA_KEYMAP](src/lib/thaanaKeyboard.ts#L22) for the
  per-keystroke Latin → Thaana table.
- [isRtlScript](src/lib/fonts.ts) for `dir="auto"` plumbing on
  inputs and for picking the field's default direction from `/V`.
- [EditField](src/components/PdfPage/EditField.tsx) as the design
  reference: focus management, blur-to-commit, Esc-to-cancel,
  mobile DV/EN toolbar toggle, font fallback to Faruma. Form text
  fields should reuse the same UX vocabulary.
- [annotations.ts](src/lib/annotations.ts) +
  [saveAnnotations.ts](src/lib/saveAnnotations.ts) as a structural
  precedent: store fills as plain values on `LoadedSource`-derived
  state, materialize them into pdf-lib dicts at save time. Mirror
  [applyAnnotationsToDoc](src/lib/saveAnnotations.ts#L381)'s pattern
  for `applyFormFillsToDoc`.
- [encodeUtf16BE](src/lib/saveAnnotations.ts#L88) — already handles
  the PDF text-string encoding Thaana needs in `/V`.
- [buildShapedTextOps + measureShapedWidth](src/lib/shapedDraw.ts) —
  HarfBuzz-shaped operator emitter already used by FreeText comment
  `/AP /N`. Reusable for self-generated text-field appearances (see
  Phase 4 Thaana-font note).

## Phase 1 — Extract form fields at load

New file: `src/lib/formFields.ts`.

- After `PDFDocument.load` in
  [loadSource.ts:46](src/lib/loadSource.ts#L46) (the `glyphsDoc`
  load that already runs as part of the parallel `Promise.all`),
  walk `/Root /AcroForm /Fields`, recursing into `/Kids` until each
  terminal field is found. Skip docs with no AcroForm dict.
- Resolve each field's full name (`a.b.c` per spec — concat `/T`
  with `.` from root to leaf), `/FT`, `/Ff` flag bits, default
  value `/DV`, current value `/V`, `/MaxLen` for `Tx`, `/Opt` for
  `Ch`, on-state name for `Btn` (read from a kid's `/AP /N` keys
  to discover the non-`Off` appearance state).
- For each terminal field, collect its widgets: either the field
  dict itself if it's the widget (`/Subtype /Widget` on the field),
  or its `/Kids` filtered to widget subtype. Capture each widget's
  `/Rect`, page index (look up the page each widget belongs to via
  `/P` or by scanning `/Annots` of every page), and a stable per-
  widget id (`<sourceKey>:<fullName>:<widgetIndex>`).
- Emit a typed list:
  ```ts
  type FormField =
    | { kind: "text"; id; fullName; sourceKey; widgets;
        value: string; multiline: boolean; password: boolean;
        maxLen?: number; fontSize?: number; rtl?: boolean }
    | { kind: "checkbox"; id; …; checked: boolean; onState: string }
    | { kind: "radio"; id; …; chosen: string | null;
        options: { widgetId; onState; rect; pageIndex }[] }
    | { kind: "choice"; id; …; multiSelect: boolean; combo: boolean;
        options: { value: string; label: string }[];
        chosen: string[] }
    | { kind: "signature"; id; …; readOnly: true };
  ```
- Add `formFields: FormField[]` to
  [LoadedSource](src/lib/loadSource.ts#L21) (alongside `glyphsDoc`,
  `fontShowsByPage`, `imagesByPage`, `shapesByPage`, `pages`).
  Populated from the same `glyphsDoc` that's already loaded — no
  extra round-trip through bytes.
- Read-only and hidden fields (`/Ff` bit 1 set, `/F` bit 2 set)
  surface but render disabled.

**Decision**: parse `/V` codepoints to seed `rtl`. Auto-detect
RTL via [isRtlScript](src/lib/fonts.ts) on first Thaana char. User
can flip direction per field via the same dir toggle as EditField.

## Phase 2 — Render form overlays

New file: `src/components/PdfPage/FormFieldLayer.tsx`.

- Composite layer in the spirit of
  [AnnotationLayer](src/components/PdfPage/AnnotationLayer.tsx),
  which is now a thin wrapper that delegates to
  [HighlightLayer](src/components/PdfPage/annotations/HighlightLayer.tsx),
  [InkLayer](src/components/PdfPage/annotations/InkLayer.tsx), and
  [CommentLayer](src/components/PdfPage/annotations/CommentLayer.tsx).
  FormFieldLayer can either dispatch to per-kind sub-layers under
  `src/components/PdfPage/formFields/` or render inline if the
  per-kind code stays small.
- Renders absolutely-positioned inputs over each widget's `/Rect`,
  converted PDF y-up → viewport y-down via `pageScale` and
  `viewHeight` — reuse the `vpY()` helper the annotation sub-layers
  already share (e.g. [HighlightLayer.tsx:35](src/components/PdfPage/annotations/HighlightLayer.tsx#L35)).
- Mount inside [PdfPage](src/components/PdfPage/index.tsx),
  immediately after `<AnnotationLayer />` at
  [index.tsx:535](src/components/PdfPage/index.tsx#L535). Keep
  z-order below the placement-mode capture layer so "addText" /
  "highlight" tools still work over a form field if needed.
- Per field-kind:
  - **Text**: `<input>` for single-line, `<textarea>` for multiline.
    Default `dir="auto"`; explicit override from FormField. Default
    font-family to Faruma (matching EditField). `font-size` from
    `/DA`'s Tf token if present, else field height heuristic.
  - **Checkbox**: `<input type="checkbox">` styled to overlay the
    widget rect.
  - **Radio**: per-option overlay with one shared group name.
    Clicking one widget sets the field-level `chosen` to that
    widget's `/AP /N` on-state name.
  - **Choice (combo)**: `<select>` populated from `/Opt`.
  - **Choice (list)**: `<select multiple>` if `/Ff` multi-select bit.
  - **Signature**: read-only outline with a "signature" badge.
- For text fields, attach `useThaanaTransliteration(ref, isMobile && thaanaInput)`
  exactly as EditField does. Per-field DV/EN toggle; opens via a
  micro-toolbar on focus (similar to EditTextToolbar but without
  the full font/size pickers — fonts come from `/DA`).
- All overlays use `pointerEvents: auto` and `touchAction: pinch-zoom`
  consistent with the rest of PdfPage.

## Phase 3 — App-level state

In [App.tsx](src/App.tsx):

- Add `formValues: Map<string, Map<string, FormValue>>` keyed by
  `sourceKey → fullName → value`. Mirror the existing `edits` /
  `imageMoves` / `insertedTexts` / `insertedImages` /
  `shapeDeletes` / `annotations` Maps (all declared around
  [App.tsx:66-99](src/App.tsx#L66-L99)) so the same persistence,
  undo, and slot-aware save plumbing applies for free.
- Include in `UndoSnapshot` ([App.tsx:37](src/App.tsx#L37)) so
  fills participate in Ctrl+Z / Ctrl+Y. Add a matching `useRef`
  mirror next to `editsRef` / `annotationsRef` etc. so
  `captureSnapshot` / `restoreSnapshot` stay symmetric.
- Wire `onFormChange(sourceKey, fullName, value)` through PdfPage
  → FormFieldLayer → individual field overlays.
- The undo coalesce key for text fields is `form:<sourceKey>:<fullName>`
  so per-keystroke typing collapses to one history entry.

## Phase 4 — Save: write `/V`s back

New file: `src/lib/saveFormFields.ts`.

- New export `applyFormFillsToDoc(doc, fills, options)`.
  Mirrors [applyAnnotationsToDoc](src/lib/saveAnnotations.ts#L381).
  `options` should carry the per-source `getFont` factory
  (`AnnotationFontFactory` shape), since Thaana fields need Faruma
  registered in `/AcroForm/DR` regardless of which `/AP` strategy
  we land on.
- For each filled field, walk the doc's `/Root /AcroForm /Fields`
  tree to find the field by full name, then:
  - `Tx`: set `/V` to `encodeUtf16BE(text)` (or `PDFString.of` for
    pure ASCII as a size optimisation). For multiline text with
    Thaana, encode the whole string as UTF-16BE — line breaks are
    `\r` (0x0D) per spec.
  - `Btn` checkbox: set `/V` and the widget's `/AS` to
    `PDFName.of(onState)` or `Off`.
  - `Btn` radio: same — set field-level `/V` and each kid widget's
    `/AS` to its on-state name only if it's the chosen one;
    otherwise `Off`.
  - `Ch`: `/V` PDFString or PDFArray of strings.
- Hook into the save pipeline immediately before the annotations
  pass at [save.ts:771-787](src/lib/save.ts#L771-L787): bucket
  fills by `sourceKey` and look up each `ctx` from
  [`ctxBySource`](src/lib/save.ts#L590) (the per-source
  `LoadedSourceContext` map that already holds `doc` + `getFont`).
  Each ctx's doc gets its fields updated in one pass before
  `applyAnnotationsToDoc` runs and before pages are copied into
  `output`. Remember to also extend `sourcesNeedingLoad` so a
  source that has only fills (no edits / annotations) still gets
  a ctx.
- Acceptance: a saved PDF reopens in Acrobat / Preview / Chrome
  with all values visible; reopening in rihaPDF re-extracts and
  shows the same `/V`s. A manual flatten (post-save "flatten"
  button) is **not** in v1 — interactive forms remain interactive.

### Thaana font in `/DA` and `/AP`

Form text rendering inside the field requires the appearance
string's font to actually contain the codepoints. Two options:

1. **Trust viewer regen**: set `/NeedAppearances true` on the
   AcroForm dict, rewrite each text field's `/DA` to reference
   Faruma (or another registered Thaana font), and embed that
   font under `/Root /AcroForm /DR /Font /Faruma`. Acrobat /
   Preview regenerate `/AP` from `/DA + /V`. Cheap, but viewer
   regen does not run a complex-script shaper, so Thaana fili
   stack at fixed offsets — same failure mode FreeText comments
   used to have before the HarfBuzz `/AP` work.
2. **Generate /AP ourselves with HarfBuzz**: shape `/V` and write
   the `/AP /N` Form XObject directly. This was the costly option
   when this plan was first written, but the infra is now landed
   for FreeText comments — see
   [shapedDraw.ts](src/lib/shapedDraw.ts) (`buildShapedTextOps`,
   `measureShapedWidth`), [shapedBidi.ts](src/lib/shapedBidi.ts),
   and the bidi-aware comment AP path in
   [saveAnnotations.ts](src/lib/saveAnnotations.ts) (the
   `CommentLayer` save path embeds Faruma, runs HB shaping, and
   writes a `/AP /N` stream). The same pipeline applies to a `Tx`
   field's widget rect with minor adjustments (single-line
   horizontal centering / multiline line-breaking, plus a
   `/MK /BC /BG` border honoring the widget's existing look).

**Decision (revised)**: pick (2) from day one. Dhivehi-quality is
the project's stated north star (see
[memory: project_stirling_rtl](C:\Users\Yashau\.claude\projects\c--Users-Yashau-Projects-rihaPDF\memory\project_stirling_rtl.md)),
and option (1) ships the same broken-Thaana behaviour in form
fields that we already rejected for inline comments. Implement
the shape-and-emit path for `Tx` fields whose `/V` contains
Thaana; keep (1) as the fallback for Latin-only `/V` to avoid
the cost of an `/AP` stream when viewer regen would render the
text correctly anyway. Still set `/NeedAppearances true` so any
viewer that ignores our `/AP` falls back to `/DA + /V` instead
of nothing — matches the saveAnnotations pattern.

For `Btn` (checkbox / radio) and `Ch` (combo / list): trust
viewer regen (option 1). The rendered glyphs are ASCII / arrow
checkmarks that don't need shaping.

## Phase 5 — Edge cases & polish

- **Field flags**:
  - ReadOnly (bit 1): render disabled.
  - Required (bit 2): render with a subtle red ring; no client-
    side enforcement at save (a PDF reader would enforce on submit,
    not us).
  - NoExport (bit 3): still allow editing; honored by submit
    targets, irrelevant to local save.
  - Password (Tx bit 14): render `<input type="password">`.
  - Multiline (Tx bit 13): `<textarea>`.
  - FileSelect (Tx bit 21): out of v1 scope; render disabled.
- **MaxLen**: enforce client-side on `<input maxLength>`.
- **Tab order**: respect `/AcroForm /Tabs` and per-page `/Tabs`
  (`/R` row order is the typical default). Fall back to widget
  document order if absent.
- **Field calculation order**: ignore `/CO` in v1 (no JS
  evaluation; we don't run `/AA` actions either).
- **Reset**: a "Reset form" toolbar action that clears all
  filled values back to `/DV`.
- **External sources**: form fields from inserted external PDFs
  ([loadSource.ts](src/lib/loadSource.ts#L46) external path) work
  the same — fills are bucketed by `sourceKey` and applied to
  the right ctx at save.

## Test plan

- Unit: `formFields.test.ts` parses a hand-crafted PDF with one
  of each field kind and asserts the extracted FormField shape.
- Integration: `saveFormFields.test.ts` round-trips fills through
  a real save, reloads bytes via pdf-lib, and asserts `/V` /`/AS`.
  Run via `pnpm test run saveFormFields` per
  [feedback_vitest_invocation.md](C:\Users\Yashau.claude\projects\c--Users-Yashau-Projects-rihaPDF\memory\feedback_vitest_invocation.md).
- E2E (Playwright probe): open a real form PDF, type Latin in DV
  mode, expect Thaana in the input value; save, reload, expect
  `/V` to contain Thaana codepoints. Hard-timeout the probe per
  [feedback_probe_timeouts.md](C:\Users\Yashau.claude\projects\c--Users-Yashau-Projects-rihaPDF\memory\feedback_probe_timeouts.md).
- Manual: run a saved fill through Acrobat, Preview, Chrome,
  pdf.js — confirm visible values and continued editability.

## File summary

New:

- `src/lib/formFields.ts` — extraction + types.
- `src/lib/saveFormFields.ts` — apply fills at save time.
- `src/components/PdfPage/FormFieldLayer.tsx` — overlay renderer.
- `src/lib/formFields.test.ts`, `src/lib/saveFormFields.test.ts`.

Modified:

- `src/lib/loadSource.ts` — populate `formFields`.
- `src/lib/loadSource.ts` `LoadedSource` type — add `formFields`.
- `src/lib/save.ts` — call `applyFormFillsToDoc` per source ctx.
- `src/components/PdfPage/index.tsx` — mount `<FormFieldLayer />`.
- `src/App.tsx` — `formValues` state, undo integration, save call.
- `README.md` — document AcroForm fill support and the
  HarfBuzz-shaped `/AP` strategy for Thaana `Tx` fields (mirroring
  the existing FreeText-comment note).

## Out of scope (followups)

- XFA forms (rare in .mv gov PDFs; full replacement of AcroForm).
- JavaScript actions (`/AA`, calculation order, validation).
- Submit / Reset buttons that POST to a URL.
- Form flattening on save (lock fields into the content stream).
- Digital signature creation; v1 only displays existing sigs.
