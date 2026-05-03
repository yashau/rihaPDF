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
- The RTL auto-detect regex used in [save.ts](src/lib/save.ts) for
  `dir="auto"` plumbing on inputs.
- [EditField](src/components/PdfPage/EditField.tsx) as the design
  reference: focus management, blur-to-commit, Esc-to-cancel,
  mobile DV/EN toolbar toggle, font fallback to Faruma. Form text
  fields should reuse the same UX vocabulary.
- [annotations.ts](src/lib/annotations.ts) +
  [saveAnnotations.ts](src/lib/saveAnnotations.ts) as a structural
  precedent: store fills as plain values on `LoadedSource`-derived
  state, materialize them into pdf-lib dicts at save time. Mirror
  `applyAnnotationsToDoc`'s pattern for `applyFormFillsToDoc`.
- [encodeUtf16BE](src/lib/saveAnnotations.ts#L51) — already handles
  the PDF text-string encoding Thaana needs in `/V`.

## Phase 1 — Extract form fields at load

New file: `src/lib/formFields.ts`.

- After `PDFDocument.load` in
  [loadSource.ts](src/lib/loadSource.ts#L46), walk
  `/Root /AcroForm /Fields`, recursing into `/Kids` until each
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
  [LoadedSource](src/lib/loadSource.ts#L21). Populated from the
  same `glyphsDoc` that's already loaded — no extra round-trip
  through bytes.
- Read-only and hidden fields (`/Ff` bit 1 set, `/F` bit 2 set)
  surface but render disabled.

**Decision**: parse `/V` codepoints to seed `rtl`. Auto-detect
RTL on first Thaana char (same regex as save.ts). User can flip
direction per field via the same dir toggle as EditField.

## Phase 2 — Render form overlays

New file: `src/components/PdfPage/FormFieldLayer.tsx`.

- Sibling of [AnnotationLayer](src/components/PdfPage/AnnotationLayer.tsx).
  Renders absolutely-positioned inputs over each widget's `/Rect`,
  converted PDF y-up → viewport y-down via `pageScale` and
  `viewHeight` (same conversion math AnnotationLayer uses at
  [PdfPage/AnnotationLayer.tsx:52](src/components/PdfPage/AnnotationLayer.tsx#L52)).
- Mount inside [PdfPage](src/components/PdfPage/index.tsx#L1004),
  immediately after `<AnnotationLayer />`. Keep z-order below the
  placement-mode capture layer so "addText" / "highlight" tools
  still work over a form field if needed.
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
  `imageMoves` / `annotations` Maps so the same persistence,
  undo, and slot-aware save plumbing applies for free.
- Include in `UndoSnapshot` ([App.tsx:69](src/App.tsx#L69)) so
  fills participate in Ctrl+Z / Ctrl+Y.
- Wire `onFormChange(sourceKey, fullName, value)` through PdfPage
  → FormFieldLayer → individual field overlays.
- The undo coalesce key for text fields is `form:<sourceKey>:<fullName>`
  so per-keystroke typing collapses to one history entry.

## Phase 4 — Save: write `/V`s back

New file: `src/lib/saveFormFields.ts`.

- New export `applyFormFillsToDoc(doc, fills, glyphsDocFields)`.
  Mirrors [applyAnnotationsToDoc](src/lib/saveAnnotations.ts#L171).
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
- Set `/NeedAppearances true` on the AcroForm dict. This is the
  v1 trade-off (mirrored from saveAnnotations: viewers regen `/AP`
  from `/DA + /V`; legacy readers may show empty). Document this
  in the README.
- Hook into the save pipeline at the cross-source phase in
  [save.ts](src/lib/save.ts#L412) — after stream surgery and
  before annotations. Bucket fills by source so each ctx's doc
  gets its fields updated in one pass.
- Acceptance: a saved PDF reopens in Acrobat / Preview / Chrome
  with all values visible; reopening in rihaPDF re-extracts and
  shows the same `/V`s. A manual flatten (post-save "flatten"
  button) is **not** in v1 — interactive forms remain interactive.

### Thaana font in `/DA`

Form text rendering inside the field requires the appearance
string's font to actually contain the codepoints. Two options:

1. **Trust viewer regen** (recommended for v1): set
   `/NeedAppearances true` and rewrite each text field's `/DA`
   to reference Faruma (or another registered Thaana font), and
   embed that font under `/Root /AcroForm /DR /Font /Faruma`.
   Acrobat / Preview will regenerate `/AP` using Faruma, picking
   up the Thaana glyphs.
2. **Generate /AP ourselves**: shape `/V` with HarfBuzz (already
   wired in [src/lib/shape.ts](src/lib/shape.ts)) and write the
   appearance stream. Higher fidelity in legacy viewers but
   significantly more code.

Pick (1) for v1, document the legacy-reader caveat. If real-world
testing on gazette.gov.mv PDFs shows broken renders in a target
viewer, escalate to (2) using the existing shape pipeline.

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
- `README.md` — document the `/NeedAppearances` v1 trade-off.

## Out of scope (followups)

- XFA forms (rare in .mv gov PDFs; full replacement of AcroForm).
- JavaScript actions (`/AA`, calculation order, validation).
- Submit / Reset buttons that POST to a URL.
- Generating our own `/AP` appearance streams via HarfBuzz.
- Form flattening on save (lock fields into the content stream).
- Digital signature creation; v1 only displays existing sigs.
