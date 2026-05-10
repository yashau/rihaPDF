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
//   - We write fresh widget /AP streams and keep /NeedAppearances false.
//     Setting it true causes Acrobat/Preview to discard the shaped /AP and
//     regenerate with their non-shaping form engine, which reverses/drops
//     Thaana marks.
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
  beginText,
  endText,
  PDFArray,
  PDFBool,
  PDFContentStream,
  PDFContext,
  PDFDict,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFOperator,
} from "pdf-lib";
import type { FormValue } from "@/domain/formFields";
import { isRtlScript } from "@/pdf/text/fonts";
import {
  collectWidgetDicts,
  discoverWidgetOnState,
  inheritedOwner,
  isFieldKid,
  partialFieldName,
  readPdfRect,
} from "@/pdf/forms/pdfFormTree";
import {
  encodePdfTextString,
  makeAcroFormFontSetup,
  type EmbeddedFontFactory,
} from "@/pdf/forms/pdfAcroForm";
import { buildVisualShapedTextOps, measureShapedWidth } from "@/pdf/text/shapedDraw";

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
  getFont: EmbeddedFontFactory;
};

/** Encode a string for /V. ASCII → PDFString, otherwise UTF-16BE hex. */
function encodeFieldString(s: string): PDFString | PDFHexString {
  return encodePdfTextString(s);
}

function readFt(dict: PDFDict): string {
  const owner = inheritedOwner(dict, PDFName.of("FT"));
  const ft = owner?.lookup(PDFName.of("FT"));
  if (ft instanceof PDFName) return ft.asString().replace(/^\//, "");
  return "";
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
    const partial = partialFieldName(dict);
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

/** Keep `/NeedAppearances` off when we provide explicit appearances.
 *  Acrobat/Preview treat a true value as permission to regenerate widget
 *  appearances from `/DA + /V`; their form text engine does not perform
 *  HarfBuzz shaping, so Thaana text appears reversed and can lose edge
 *  vowel marks even when our fresh shaped `/AP` is present. */
function clearNeedAppearances(catalog: PDFDict): void {
  const acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return;
  acroForm.set(PDFName.of("NeedAppearances"), PDFBool.False);
}

type ResolvedThaanaFont = {
  pdfFont: PDFFont;
  fontBytes: Uint8Array;
  alias: string;
};

type ResolvedLatinFont = {
  pdfFont: PDFFont;
  alias: string;
};

type AcroFormSetup = {
  ensureThaanaFont(): Promise<ResolvedThaanaFont | null>;
  ensureLatinFont(): Promise<ResolvedLatinFont>;
};

function makeAcroFormSetup(
  ctx: PDFContext,
  catalog: PDFDict,
  getFont: EmbeddedFontFactory,
): AcroFormSetup {
  const setup = makeAcroFormFontSetup({ context: ctx, catalog }, getFont, { requireBytes: true });
  return {
    async ensureThaanaFont() {
      const font = await setup.ensureFont();
      return font?.fontBytes
        ? { pdfFont: font.pdfFont, fontBytes: font.fontBytes, alias: font.alias }
        : null;
    },
    async ensureLatinFont() {
      const font = await getFont("Arial");
      return { pdfFont: font.pdfFont, alias: "RihaHelv" };
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
  const owner = inheritedOwner(field, PDFName.of("DA"));
  const da = owner?.lookup(PDFName.of("DA"));
  if (da instanceof PDFString || da instanceof PDFHexString) return da.decodeText();
  return null;
}

function readDaFontSize(field: PDFDict, fallbackSize = 10): number {
  const da = readDa(field);
  if (!da) return fallbackSize;
  const match = da.match(/\/[^\s]+\s+(\d+(?:\.\d+)?)\s+Tf/);
  const parsed = match ? Number.parseFloat(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSize;
}

function readQ(field: PDFDict): number {
  const q = inheritedOwner(field, PDFName.of("Q"))?.lookup(PDFName.of("Q"));
  return q instanceof PDFNumber ? q.asNumber() : 0;
}

function makeFontResources(ctx: PDFContext, alias: string, font: PDFFont): PDFDict {
  const fontSubdict = PDFDict.withContext(ctx);
  fontSubdict.set(PDFName.of(alias), font.ref);
  const resources = PDFDict.withContext(ctx);
  resources.set(PDFName.of("Font"), fontSubdict);
  return resources;
}

function makeAppearanceStream(
  ctx: PDFContext,
  width: number,
  height: number,
  resources: PDFDict,
  ops: PDFOperator[],
): PDFRef {
  const bbox = ctx.obj([
    PDFNumber.of(0),
    PDFNumber.of(0),
    PDFNumber.of(width),
    PDFNumber.of(height),
  ]);
  const formStream: PDFContentStream = ctx.formXObject(ops, {
    BBox: bbox,
    Resources: resources,
  });
  return ctx.register(formStream);
}

function attachNormalAppearance(widget: PDFDict, apRef: PDFRef): void {
  const ap = PDFDict.withContext(widget.context);
  ap.set(PDFName.of("N"), apRef);
  widget.set(PDFName.of("AP"), ap);
  widget.delete(PDFName.of("AS"));
}

function latinTextOps(
  text: string,
  font: PDFFont,
  alias: string,
  x: number,
  y: number,
  size: number,
): PDFOperator[] {
  return [
    setFillingRgbColor(0, 0, 0),
    beginText(),
    setFontAndSize(alias, size),
    setTextMatrix(1, 0, 0, 1, x, y),
    showText(font.encodeText(text)),
    endText(),
  ];
}

async function buildTextWidgetAppearance(
  widget: PDFDict,
  field: PDFDict,
  value: string,
  acroFormSetup: AcroFormSetup,
): Promise<PDFRef | null> {
  const rect = readPdfRect(widget);
  if (!rect) return null;
  const padding = 2;
  const fieldSize = readDaFontSize(field, 10);
  const size = Math.max(4, Math.min(fieldSize, Math.max(4, rect.pdfHeight - padding * 2)));
  const baselineY = Math.max(padding, (rect.pdfHeight - size) / 2);
  const widthLimit = Math.max(0, rect.pdfWidth - padding * 2);
  const rtl = isRtlScript(value);
  const q = rtl ? 2 : readQ(field);

  if (rtl) {
    const faruma = await acroFormSetup.ensureThaanaFont();
    if (!faruma) return null;
    const textWidth = await measureShapedWidth(value, faruma.fontBytes, size, "rtl");
    const x = q === 2 ? Math.max(padding, rect.pdfWidth - padding - textWidth) : padding;
    const shaped = await buildVisualShapedTextOps({
      text: value,
      font: faruma.pdfFont,
      fontBytes: faruma.fontBytes,
      fontKey: faruma.alias,
      x,
      y: baselineY,
      size,
      dir: "rtl",
      color: [0, 0, 0],
    });
    return makeAppearanceStream(
      widget.context,
      rect.pdfWidth,
      rect.pdfHeight,
      makeFontResources(widget.context, faruma.alias, faruma.pdfFont),
      shaped.ops,
    );
  }

  const helv = await acroFormSetup.ensureLatinFont();
  const textWidth = helv.pdfFont.widthOfTextAtSize(value, size);
  const x =
    q === 2
      ? Math.max(padding, rect.pdfWidth - padding - textWidth)
      : q === 1
        ? Math.max(padding, padding + (widthLimit - textWidth) / 2)
        : padding;
  return makeAppearanceStream(
    widget.context,
    rect.pdfWidth,
    rect.pdfHeight,
    makeFontResources(widget.context, helv.alias, helv.pdfFont),
    latinTextOps(value, helv.pdfFont, helv.alias, x, baselineY, size),
  );
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
  const widgets = collectWidgetDicts(field);
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
  // Replace stale widget appearances with fresh /AP /N streams. Many
  // external readers ignore /NeedAppearances and render only /AP; if we
  // merely write /V and strip /AP the value is present but visually blank.
  for (const widget of widgets) {
    const apRef = await buildTextWidgetAppearance(widget, field, value, acroFormSetup);
    if (apRef) attachNormalAppearance(widget, apRef);
    else stripWidgetAppearance(widget);
  }
}

function writeCheckboxField(field: PDFDict, checked: boolean, onState: string): void {
  const stateName = checked ? onState : "Off";
  field.set(PDFName.of("V"), PDFName.of(stateName));
  const widgets = collectWidgetDicts(field);
  for (const widget of widgets) {
    widget.set(PDFName.of("AS"), PDFName.of(stateName));
  }
}

function writeRadioField(field: PDFDict, chosen: string | null): void {
  field.set(PDFName.of("V"), PDFName.of(chosen ?? "Off"));
  const widgets = collectWidgetDicts(field);
  for (const widget of widgets) {
    // The widget's on-state comes from its /AP /N keys; pick whichever
    // entry isn't /Off. If the chosen on-state matches THIS widget's
    // on-state, set /AS to that name; otherwise /Off so only one kid
    // appears selected.
    const widgetOnState = discoverWidgetOnState(widget);
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
  for (const widget of collectWidgetDicts(field)) stripWidgetAppearance(widget);
}

/** Walk every output page's `/Annots`, collect widget annotations, and
 *  rebuild `/Root /AcroForm /Fields` from the topmost ancestor of each
 *  widget (via /Parent). Pdf-lib's `copyPages` deep-copies widgets and
 *  their /Parent chains across docs but does NOT carry the source's
 *  `/Root /AcroForm` over — without this rebuild, copied widgets are
 *  orphaned in the output and viewers don't recognise them as
 *  interactive form fields, dropping our /V writes on reload.
 *
 *  Also keeps `/NeedAppearances false`: the save pipeline now writes
 *  fresh appearances for filled text widgets, and asking viewers to
 *  regenerate them makes Thaana render incorrectly. */
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
  if (topFieldRefs.size === 0) return;

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
  (acroForm as PDFDict).set(PDFName.of("NeedAppearances"), PDFBool.False);
}

/** Apply each fill in `fills` to its named field on `doc`. The
 *  AcroForm dict keeps `/NeedAppearances false`; per-field encoding
 *  matches the field's /FT. Fills targeting fields that aren't on
 *  this doc (e.g. cross-source mismatches) are silently dropped —
 *  same forgiving stance as the annotation save path. */
export async function applyFormFillsToDoc(
  doc: { context: PDFContext; catalog: PDFDict },
  fills: FormFill[],
  opts: FormFillSaveOptions,
): Promise<void> {
  if (fills.length === 0) return;
  clearNeedAppearances(doc.catalog);
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
      const widgets = collectWidgetDicts(field);
      let onState = "Yes";
      for (const widget of widgets) {
        onState = discoverWidgetOnState(widget) ?? onState;
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
