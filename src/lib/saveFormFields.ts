// Apply user form-field fills to a pdf-lib doc at save time.
//
// Walks /Root /AcroForm /Fields to find each filled field by full
// name, then writes /V (and per-widget /AS) according to the field's
// kind. Mirrors `applyAnnotationsToDoc` from saveAnnotations.ts —
// bucket-by-source upstream, one pass per source's doc.
//
// Thaana /V handling:
//   - /V is encoded UTF-16BE-with-BOM via `encodeUtf16BE` (the same
//     encoding the comment annotation path uses for /Contents).
//   - /NeedAppearances true is set on /AcroForm so any viewer that
//     ignores our /AP regenerates from /DA + /V.
//   - For Tx fields whose value contains Thaana / RTL codepoints, we
//     embed Faruma into /AcroForm/DR/Font and rewrite /DA to
//     reference it, so /DA-based regen produces the right glyphs
//     (option 1 from form-filling-plan.md). The HarfBuzz-shaped /AP
//     stream (option 2) is a follow-up — option 1 alone gets values
//     visible in Acrobat / Preview / Chrome / pdf.js, which is what
//     this phase needs to land.
//
// Pure surgery on `doc` — no copyPages, no flatten, the field stays
// interactive in the saved file.

import {
  PDFArray,
  PDFBool,
  PDFContext,
  PDFDict,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from "pdf-lib";
import type { FormValue } from "./formFields";
import { isRtlScript } from "./fonts";
import type { AnnotationFontFactory } from "./saveAnnotations";

/** Flat fill record passed into the save pipeline — the App's
 *  formValues Map<sourceKey, Map<fullName, FormValue>> is flattened to
 *  this shape by buildSavePayload, the same way annotations / edits
 *  / etc. are flattened. */
export type FormFill = {
  sourceKey: string;
  fullName: string;
  value: FormValue;
};

export type FormFillSaveOptions = {
  /** Embedded-font factory bound to the same doc the fills are being
   *  applied to. Used to embed Faruma into /AcroForm/DR/Font for Tx
   *  fields whose value contains Thaana — viewer regen reads /DA's
   *  font reference from there. */
  getFont: AnnotationFontFactory;
};

/** PDF text-string encoding for non-PDFDocEncoding values (Thaana /
 *  emoji / any non-Latin-1 codepoint): UTF-16BE with a 0xFEFF BOM,
 *  written as a hex string. Same encoder saveAnnotations.ts uses for
 *  /Contents — kept private here to avoid a cross-import. */
function encodeUtf16BE(s: string): PDFHexString {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      bytes.push((cp >> 8) & 0xff, cp & 0xff);
    } else {
      const off = cp - 0x10000;
      const hi = 0xd800 + (off >> 10);
      const lo = 0xdc00 + (off & 0x3ff);
      bytes.push((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return PDFHexString.of(hex);
}

/** True iff every codepoint is in PDFDocEncoding's safe ASCII subset
 *  (printable Latin-1, tab, newline, carriage return). When true we
 *  can write /V as a plain `(string)` literal — saves a few bytes vs
 *  hex-encoded UTF-16BE. */
function isAsciiSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/** Encode a string for /V. ASCII → PDFString, otherwise UTF-16BE hex. */
function encodeFieldString(s: string): PDFString | PDFHexString {
  return isAsciiSafe(s) ? PDFString.of(s) : encodeUtf16BE(s);
}

/** Walk /Parent until we find a node that has `key` directly. /FT,
 *  /Ff, /DA are inheritable per spec — same helper as in formFields.ts
 *  but kept private here because the save pipeline only needs it for
 *  /FT lookup at write time. */
function inherited(dict: PDFDict, key: PDFName): PDFDict | undefined {
  let node: PDFDict | null = dict;
  while (node) {
    if (node.lookup(key) !== undefined) return node;
    const parent: PDFObject | undefined = node.lookup(PDFName.of("Parent"));
    node = parent instanceof PDFDict ? parent : null;
  }
  return undefined;
}

function readFt(dict: PDFDict): string {
  const owner = inherited(dict, PDFName.of("FT"));
  const ft = owner?.lookup(PDFName.of("FT"));
  if (ft instanceof PDFName) return ft.asString().replace(/^\//, "");
  return "";
}

/** Decode a /T entry without touching the inheritance chain (each
 *  level contributes its OWN partial name to the fully-qualified
 *  name). */
function partialName(dict: PDFDict): string | null {
  const t = dict.lookup(PDFName.of("T"));
  if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText();
  return null;
}

/** True iff a kid is itself a terminal field (matches the rule in
 *  formFields.ts so we walk the same field tree on save). */
function isFieldKid(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("T")) !== undefined) return true;
  const kids = dict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return false;
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i);
    if (kid instanceof PDFDict && isFieldKid(kid)) return true;
  }
  return false;
}

/** Resolve a target field by fully-qualified name. Returns null when
 *  the doc's AcroForm tree no longer contains that field — we silently
 *  drop fills targeting absent fields rather than throwing, since the
 *  user could have re-opened a different doc with the same source key
 *  in a long session. */
function findFieldByName(catalog: PDFDict, fullName: string): PDFDict | null {
  const acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return null;
  const fields = acroForm.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return null;
  const parts = fullName.split(".");

  function walk(dict: PDFDict, idx: number): PDFDict | null {
    const partial = partialName(dict);
    let nextIdx = idx;
    if (partial !== null) {
      if (partial !== parts[idx]) return null;
      nextIdx = idx + 1;
    }
    if (nextIdx === parts.length) return dict;
    const kids = dict.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) return null;
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (!(kid instanceof PDFDict)) continue;
      if (!isFieldKid(kid)) continue;
      const found = walk(kid, nextIdx);
      if (found) return found;
    }
    return null;
  }

  for (let i = 0; i < fields.size(); i++) {
    const field = fields.lookup(i);
    if (!(field instanceof PDFDict)) continue;
    const found = walk(field, 0);
    if (found) return found;
  }
  return null;
}

/** Collect every widget annotation owned by `field`. Mirrors the
 *  formFields.ts collector so the save pass operates on the same set
 *  the extractor surfaced to the UI. */
function collectFieldWidgets(field: PDFDict): PDFDict[] {
  const subtype = field.lookup(PDFName.of("Subtype"));
  if (subtype instanceof PDFName && subtype.asString() === "/Widget") {
    return [field];
  }
  const out: PDFDict[] = [];
  const kids = field.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return out;
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i);
    if (!(kid instanceof PDFDict)) continue;
    // Skip nested fields (those have their own /T) — only widgets.
    if (kid.lookup(PDFName.of("T")) !== undefined) continue;
    const kidSubtype = kid.lookup(PDFName.of("Subtype"));
    if (kidSubtype instanceof PDFName && kidSubtype.asString() !== "/Widget") continue;
    out.push(kid);
  }
  return out;
}

/** Set /NeedAppearances true on the AcroForm dict so viewers regenerate
 *  /AP from /DA + /V whenever they don't trust an embedded /AP. We do
 *  this once per save (idempotent set + already-true is a no-op). */
function setNeedAppearances(catalog: PDFDict): void {
  const acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return;
  acroForm.set(PDFName.of("NeedAppearances"), PDFBool.True);
  // Strip any pre-existing /AP /N on widgets we touch — see the per-
  // widget logic in writeTextField. Done at the dict level so the
  // viewer can't fall back to a stale appearance for the OLD /V.
}

/** Idempotently register `font` under `alias` in the doc's
 *  /AcroForm/DR/Font dict. Identical recipe to the one in
 *  saveAnnotations.ts — duplicated rather than cross-imported because
 *  the save flow keeps each phase independent and the function is
 *  small. */
function registerAcroFormFont(
  ctx: PDFContext,
  catalog: PDFDict,
  alias: string,
  fontRef: PDFRef,
): void {
  let acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) {
    acroForm = PDFDict.withContext(ctx);
    catalog.set(PDFName.of("AcroForm"), acroForm);
  }
  let dr = (acroForm as PDFDict).lookup(PDFName.of("DR"));
  if (!(dr instanceof PDFDict)) {
    dr = PDFDict.withContext(ctx);
    (acroForm as PDFDict).set(PDFName.of("DR"), dr);
  }
  let fontDict = (dr as PDFDict).lookup(PDFName.of("Font"));
  if (!(fontDict instanceof PDFDict)) {
    fontDict = PDFDict.withContext(ctx);
    (dr as PDFDict).set(PDFName.of("Font"), fontDict);
  }
  const aliasName = PDFName.of(alias);
  if (!(fontDict as PDFDict).has(aliasName)) {
    (fontDict as PDFDict).set(aliasName, fontRef);
  }
}

type ResolvedThaanaFont = {
  pdfFont: PDFFont;
  alias: string;
};

type AcroFormSetup = {
  ensureThaanaFont(): Promise<ResolvedThaanaFont | null>;
};

function makeAcroFormSetup(
  ctx: PDFContext,
  catalog: PDFDict,
  getFont: AnnotationFontFactory,
): AcroFormSetup {
  let cached: ResolvedThaanaFont | null | undefined = undefined;
  return {
    async ensureThaanaFont() {
      if (cached !== undefined) return cached;
      const embedded = await getFont("Faruma");
      if (!embedded.bytes) {
        cached = null;
        return cached;
      }
      const alias = "RihaThaana";
      registerAcroFormFont(ctx, catalog, alias, embedded.pdfFont.ref);
      cached = { pdfFont: embedded.pdfFont, alias };
      return cached;
    },
  };
}

/** Replace (or insert) the font reference + size in a /DA string.
 *  PDF /DA looks like `/Helv 10 Tf 0 0 0 rg`; we want the same minus
 *  the font name. When the source has no /DA we synthesise a default
 *  with black text at the given size. */
function rewriteDaFont(da: string | null, alias: string, fallbackSize: number): string {
  if (!da) return `/${alias} ${fallbackSize} Tf 0 0 0 rg`;
  // /Helv 10 Tf  →  /<alias> 10 Tf (preserve everything before/after
  // the Tf chunk so the color setter doesn't get dropped).
  const tfRegex = /\/[^\s]+\s+(\d+(?:\.\d+)?)\s+Tf/;
  const m = da.match(tfRegex);
  if (!m) return `/${alias} ${fallbackSize} Tf 0 0 0 rg`;
  return da.replace(tfRegex, `/${alias} ${m[1]} Tf`);
}

function readDa(field: PDFDict): string | null {
  const owner = inherited(field, PDFName.of("DA"));
  const da = owner?.lookup(PDFName.of("DA"));
  if (da instanceof PDFString || da instanceof PDFHexString) return da.decodeText();
  return null;
}

/** Strip a widget's pre-baked /AP. Once we've replaced /V the previous
 *  /AP is stale; viewers fall back to /NeedAppearances regeneration
 *  from /DA + /V instead. */
function stripWidgetAppearance(widget: PDFDict): void {
  widget.delete(PDFName.of("AP"));
  widget.delete(PDFName.of("AS"));
}

async function writeTextField(
  field: PDFDict,
  value: string,
  acroFormSetup: AcroFormSetup,
): Promise<void> {
  field.set(PDFName.of("V"), encodeFieldString(value));
  const widgets = collectFieldWidgets(field);
  // Right-align RTL text so /DA-driven regen produces the correct
  // visual layout for Thaana even when the box is wider than the
  // shaped run. /Q 2 = right-aligned; 0 = left.
  field.set(PDFName.of("Q"), PDFNumber.of(isRtlScript(value) ? 2 : 0));
  if (isRtlScript(value)) {
    const faruma = await acroFormSetup.ensureThaanaFont();
    if (faruma) {
      const da = readDa(field);
      const newDa = rewriteDaFont(da, faruma.alias, 10);
      field.set(PDFName.of("DA"), PDFString.of(newDa));
    }
  }
  // Drop stale /AP on every widget — /NeedAppearances will rebuild.
  // For Tx fields the field dict itself can be the widget (merged),
  // in which case it's already in the widgets list above.
  for (const widget of widgets) stripWidgetAppearance(widget);
  // When the field IS the widget but no kids were collected (single-
  // widget Tx), strip on the field too. collectFieldWidgets already
  // returns [field] in that case, so the loop covers it.
}

function writeCheckboxField(field: PDFDict, checked: boolean, onState: string): void {
  const stateName = checked ? onState : "Off";
  field.set(PDFName.of("V"), PDFName.of(stateName));
  const widgets = collectFieldWidgets(field);
  for (const widget of widgets) {
    widget.set(PDFName.of("AS"), PDFName.of(stateName));
  }
}

function writeRadioField(field: PDFDict, chosen: string | null): void {
  field.set(PDFName.of("V"), PDFName.of(chosen ?? "Off"));
  const widgets = collectFieldWidgets(field);
  for (const widget of widgets) {
    // The widget's on-state comes from its /AP /N keys; pick whichever
    // entry isn't /Off. If the chosen on-state matches THIS widget's
    // on-state, set /AS to that name; otherwise /Off so only one kid
    // appears selected.
    const ap = widget.lookup(PDFName.of("AP"));
    let widgetOnState: string | null = null;
    if (ap instanceof PDFDict) {
      const n = ap.lookup(PDFName.of("N"));
      if (n instanceof PDFDict) {
        for (const [key] of n.entries()) {
          const name = key.asString().replace(/^\//, "");
          if (name && name !== "Off") {
            widgetOnState = name;
            break;
          }
        }
      }
    }
    if (chosen !== null && widgetOnState === chosen) {
      widget.set(PDFName.of("AS"), PDFName.of(chosen));
    } else {
      widget.set(PDFName.of("AS"), PDFName.of("Off"));
    }
  }
}

function writeChoiceField(field: PDFDict, chosen: string[]): void {
  if (chosen.length === 0) {
    field.delete(PDFName.of("V"));
  } else if (chosen.length === 1) {
    field.set(PDFName.of("V"), encodeFieldString(chosen[0]));
  } else {
    const arr = field.context.obj(chosen.map((s) => encodeFieldString(s)));
    field.set(PDFName.of("V"), arr);
  }
  // /I = indices into /Opt for currently-selected entries. Some
  // viewers prefer it for multi-select; we emit it whenever /Opt is
  // an array we can resolve indices against.
  const opt = field.lookup(PDFName.of("Opt"));
  if (opt instanceof PDFArray) {
    const indices: number[] = [];
    for (let i = 0; i < opt.size(); i++) {
      const row = opt.get(i);
      let value: string | null = null;
      if (row instanceof PDFString || row instanceof PDFHexString) value = row.decodeText();
      else if (row instanceof PDFArray && row.size() >= 1) {
        const v = row.get(0);
        if (v instanceof PDFString || v instanceof PDFHexString) value = v.decodeText();
      }
      if (value !== null && chosen.includes(value)) indices.push(i);
    }
    if (indices.length > 0) {
      field.set(PDFName.of("I"), field.context.obj(indices.map((n) => PDFNumber.of(n))));
    } else {
      field.delete(PDFName.of("I"));
    }
  }
  // Strip any pre-baked /AP on widgets — viewer regen rebuilds it.
  for (const widget of collectFieldWidgets(field)) stripWidgetAppearance(widget);
}

/** Walk every output page's `/Annots`, collect widget annotations, and
 *  rebuild `/Root /AcroForm /Fields` from the topmost ancestor of each
 *  widget (via /Parent). Pdf-lib's `copyPages` deep-copies widgets and
 *  their /Parent chains across docs but does NOT carry the source's
 *  `/Root /AcroForm` over — without this rebuild, copied widgets are
 *  orphaned in the output and viewers don't recognise them as
 *  interactive form fields, dropping our /V writes on reload.
 *
 *  Also sets `/NeedAppearances true` so any viewer that ignores the
 *  widgets' (now-stripped) `/AP` falls back to regenerating an
 *  appearance from `/DA + /V` — covers Thaana fields visually until
 *  the option-2 HarfBuzz `/AP` path lands. */
export function rebuildOutputAcroForm(doc: {
  context: PDFContext;
  catalog: PDFDict;
  getPages: () => unknown[];
}): void {
  const pages = doc.getPages() as Array<{ node: PDFDict }>;
  // Set of topmost-field refs gathered across every widget on every
  // output page. Using a Set so a multi-widget field (radio group with
  // N kids) contributes its top-level ref exactly once.
  const topFieldRefs = new Set<PDFRef>();
  // We also need to clear /Parent on the topmost fields, since pdf-lib
  // can leave them pointing into a non-existent parent chain after a
  // copy.  Doing so lets viewers treat them as bona fide top-level
  // fields rather than malformed dicts. The fields themselves stay
  // referenced from /Fields below.
  const topFieldDicts = new Map<PDFRef, PDFDict>();
  for (const page of pages) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annotRef = annots.get(i);
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.lookup(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName) || subtype.asString() !== "/Widget") continue;
      // Climb /Parent until we hit a node without one.
      let nodeRef: PDFRef | null = annotRef instanceof PDFRef ? annotRef : null;
      let nodeDict: PDFDict = annot;
      // Walk up. Each step we look at /Parent; if it's a ref we resolve;
      // we continue while /Parent exists. We track the latest seen ref
      // for the topmost field.
      while (true) {
        const parent = nodeDict.get(PDFName.of("Parent"));
        if (parent instanceof PDFRef) {
          const resolved = doc.context.lookup(parent);
          if (!(resolved instanceof PDFDict)) break;
          nodeRef = parent;
          nodeDict = resolved;
          continue;
        }
        if (parent instanceof PDFDict) {
          // Inline parent — we don't have a ref to write into /Fields,
          // so register it as a fresh indirect object so we can.
          nodeRef = doc.context.register(parent);
          nodeDict = parent;
          continue;
        }
        break;
      }
      if (nodeRef) {
        topFieldRefs.add(nodeRef);
        topFieldDicts.set(nodeRef, nodeDict);
      }
    }
  }
  // Detach top-level fields from any dangling /Parent left over from
  // the source's intermediate field-tree nodes.
  for (const dict of topFieldDicts.values()) {
    dict.delete(PDFName.of("Parent"));
  }

  let acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) {
    acroForm = PDFDict.withContext(doc.context);
    doc.catalog.set(PDFName.of("AcroForm"), acroForm);
  }
  // Replace /Fields with the topmost-field collection we just built.
  // Merging with whatever was there before would risk re-adding refs
  // from the source's catalog (broken in the output's context), so a
  // full overwrite is safer.
  const fieldsArr = doc.context.obj([] as PDFRef[]);
  for (const ref of topFieldRefs) fieldsArr.push(ref);
  (acroForm as PDFDict).set(PDFName.of("Fields"), fieldsArr);
  (acroForm as PDFDict).set(PDFName.of("NeedAppearances"), PDFBool.True);
}

/** Apply each fill in `fills` to its named field on `doc`. The
 *  AcroForm dict gets `/NeedAppearances true`; per-field encoding
 *  matches the field's /FT. Fills targeting fields that aren't on
 *  this doc (e.g. cross-source mismatches) are silently dropped —
 *  same forgiving stance as the annotation save path. */
export async function applyFormFillsToDoc(
  doc: { context: PDFContext; catalog: PDFDict },
  fills: FormFill[],
  opts: FormFillSaveOptions,
): Promise<void> {
  if (fills.length === 0) return;
  setNeedAppearances(doc.catalog);
  const acroFormSetup = makeAcroFormSetup(doc.context, doc.catalog, opts.getFont);
  for (const fill of fills) {
    const field = findFieldByName(doc.catalog, fill.fullName);
    if (!field) continue;
    const ft = readFt(field);
    const value = fill.value;
    if (value.kind === "text" && ft === "Tx") {
      await writeTextField(field, value.value, acroFormSetup);
    } else if (value.kind === "checkbox" && ft === "Btn") {
      // The field's first widget's non-Off /AP /N key is the canonical
      // on-state. We re-discover it here rather than threading it
      // through the fill payload — the extractor already filtered out
      // pushbutton fields, so the first widget always has one.
      const widgets = collectFieldWidgets(field);
      let onState = "Yes";
      for (const widget of widgets) {
        const ap = widget.lookup(PDFName.of("AP"));
        if (!(ap instanceof PDFDict)) continue;
        const n = ap.lookup(PDFName.of("N"));
        if (!(n instanceof PDFDict)) continue;
        for (const [key] of n.entries()) {
          const name = key.asString().replace(/^\//, "");
          if (name && name !== "Off") {
            onState = name;
            break;
          }
        }
        break;
      }
      writeCheckboxField(field, value.checked, onState);
    } else if (value.kind === "radio" && ft === "Btn") {
      writeRadioField(field, value.chosen);
    } else if (value.kind === "choice" && ft === "Ch") {
      writeChoiceField(field, value.chosen);
    }
    // Mismatched value/FT pairs (shouldn't happen — extractor types
    // the FormValue to match the field's /FT) silently drop.
  }
}
