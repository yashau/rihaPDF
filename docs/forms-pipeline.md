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

For text fields, rihaPDF writes `/V`, removes stale widget appearances, sets alignment (`/Q`) based on script direction, and marks the form with `/NeedAppearances true` so viewers regenerate the field appearance.

For Thaana text fields, the save path embeds Faruma into `/AcroForm/DR/Font` and updates `/DA` to reference it. This is a pragmatic fallback: unlike FreeText comments, form widgets currently do not get a fully HarfBuzz-shaped custom appearance stream. The app relies on viewers regenerating from `/V` + `/DA`.

Checkboxes/radios update both field value and widget `/AS` appearance states. Choice fields update `/V` and, where needed, selected indices.

## Redaction interaction

Overlapped form widgets are removed rather than partially edited. A field dictionary can contain recoverable `/V`, `/DV`, rich text, actions, or appearance streams. Partial value redaction would be easy to get wrong, so the safe behavior is whole-field removal on overlap.

## Known risks

- Viewer-generated Thaana appearances vary. Most modern PDF viewers handle embedded Faruma reasonably, but this is not as deterministic as rihaPDF's HarfBuzz-shaped page text path.
- Complex hierarchical forms can hide values in parents/kids; cleanup must walk both.
- Widget appearances can carry sensitive content independent of `/V`; stale `/AP` streams must be cleared when values change.

## Change rules

- Preserve `/V`/`/AS` consistency for buttons.
- Remove stale appearances when values change.
- Keep `/NeedAppearances` behavior unless replacing it with deterministic custom appearances.
- Treat redaction overlap as whole-widget removal unless a future design proves partial cleanup cannot leak.
