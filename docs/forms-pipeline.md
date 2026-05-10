# Forms pipeline

rihaPDF supports common AcroForm widgets while staying conservative about appearance streams and redaction safety.

## Supported field types

The form layer handles:

- text fields,
- checkboxes,
- radio groups,
- combo boxes,
- list boxes.

Extraction lives under `src/pdf/forms/`; UI overlays live in `src/components/PdfPage/FormFieldLayer/`; saving lives in `src/pdf/save/forms.ts`.

## Extraction model

PDF form widgets are annotations with subtype `/Widget`. A logical field can have multiple widgets and parent/kid dictionaries. The extractor normalizes enough state for the UI:

- full field name,
- field type,
- widget rectangle/page,
- current value,
- options/appearance states,
- RTL hint and font-size defaults where available.

Checkboxes and radio buttons use appearance-state names. `/V` for a radio group is the chosen widget's state name, not just true/false.

## UI defaults

Form text overlays choose Faruma for Thaana and Arial for Latin. Empty RTL fields still render with Faruma so the placeholder/caret looks like the field is ready for Dhivehi input before any character is typed.

Mobile Thaana input uses the same phonetic keyboard infrastructure as text editing, including `beforeinput` interception for browsers that bypass ordinary key/controlled insertion paths.

## Save behavior

For text fields, rihaPDF writes `/V`, replaces stale widget appearances with fresh `/AP /N` Form XObjects, sets alignment (`/Q`) based on script direction, and keeps `/NeedAppearances false` so external readers use the explicit appearances instead of regenerating them.

For Thaana text fields, the save path embeds Faruma into `/AcroForm/DR/Font`, updates `/DA` to reference it, and builds a HarfBuzz-shaped widget appearance stream. The appearance stream uses visual glyph order because its job is to paint field pixels consistently in Acrobat, Preview, Chrome, and pdf.js; `/V` remains the semantic field value. Setting `/NeedAppearances true` is intentionally avoided because Acrobat/Preview can regenerate from `/DA + /V` with non-shaping form engines that reverse or drop Thaana marks.

Checkboxes/radios update both field value and widget `/AS` appearance states. Choice fields update `/V` and, where needed, selected indices; their stale widget appearances are stripped so viewers rebuild choice visuals from state.

## Redaction interaction

Overlapped form widgets are removed rather than partially edited. A field dictionary can contain recoverable `/V`, `/DV`, rich text, actions, or appearance streams. Partial value redaction would be easy to get wrong, so the safe behavior is whole-field removal on overlap.

## Known risks

- Text-field `/AP` streams are visual-only compatibility data. Keep `/V` authoritative for extraction/reload and keep `/DA`/`/DR/Font` coherent as a fallback, but do not ask viewers to regenerate filled text appearances unless the custom `/AP` path is removed.
- Complex hierarchical forms can hide values in parents/kids; cleanup must walk both.
- Widget appearances can carry sensitive content independent of `/V`; stale `/AP` streams must be replaced or cleared when values change.

## Change rules

- Preserve `/V`/`/AS` consistency for buttons.
- Replace stale text-widget appearances when values change; clear appearances only when a fresh `/AP` cannot be built or for non-text widgets that rely on viewer state.
- Keep `/NeedAppearances false` while deterministic text-widget appearances exist; do not flip it true without testing Acrobat/Preview Thaana rendering.
- Treat redaction overlap as whole-widget removal unless a future design proves partial cleanup cannot leak.
