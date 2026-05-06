import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
} from "pdf-lib";
import { rectsOverlap, type Redaction } from "./redactions";
import type { PdfRect } from "./pdfGeometry";

type FieldId = string;

function readRect(dict: PDFDict): PdfRect | null {
  const rect = dict.lookup(PDFName.of("Rect"));
  if (!(rect instanceof PDFArray) || rect.size() < 4) return null;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const n = rect.lookup(i);
    if (!(n instanceof PDFNumber)) return null;
    nums.push(n.asNumber());
  }
  const [a, b, c, d] = nums;
  const llx = Math.min(a, c);
  const lly = Math.min(b, d);
  const urx = Math.max(a, c);
  const ury = Math.max(b, d);
  if (urx <= llx || ury <= lly) return null;
  return { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly };
}

function isWidget(dict: PDFDict): boolean {
  const subtype = dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName && subtype.asString() === "/Widget";
}

function resolveDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | null {
  if (obj instanceof PDFDict) return obj;
  if (obj instanceof PDFRef) {
    const resolved = ctx.lookup(obj);
    return resolved instanceof PDFDict ? resolved : null;
  }
  return null;
}

const fieldIds = new WeakMap<PDFDict, string>();
let directFieldCounter = 0;

function stableFieldId(ctx: PDFContext, dict: PDFDict): FieldId {
  const ref = ctx.getObjectRef(dict);
  if (ref) return ref.toString();
  let id = fieldIds.get(dict);
  if (!id) {
    directFieldCounter += 1;
    id = `direct-field-${directFieldCounter}`;
    fieldIds.set(dict, id);
  }
  return id;
}

function topFieldStable(ctx: PDFContext, widget: PDFDict): { id: FieldId; dict: PDFDict } {
  let dict = widget;
  while (true) {
    const parent = dict.get(PDFName.of("Parent"));
    const parentDict = resolveDict(ctx, parent);
    if (!parentDict) break;
    dict = parentDict;
  }
  return { id: stableFieldId(ctx, dict), dict };
}

function maybeDeleteRef(ctx: PDFContext, obj: PDFObject | undefined): void {
  if (obj instanceof PDFRef) ctx.delete(obj);
}

function stripAppearanceRefs(ctx: PDFContext, dict: PDFDict): void {
  const ap = dict.get(PDFName.of("AP"));
  if (ap instanceof PDFRef) {
    const apDict = ctx.lookup(ap);
    if (apDict instanceof PDFDict) {
      maybeDeleteRef(ctx, apDict.get(PDFName.of("N")));
      maybeDeleteRef(ctx, apDict.get(PDFName.of("R")));
      maybeDeleteRef(ctx, apDict.get(PDFName.of("D")));
    }
    ctx.delete(ap);
  } else if (ap instanceof PDFDict) {
    maybeDeleteRef(ctx, ap.get(PDFName.of("N")));
    maybeDeleteRef(ctx, ap.get(PDFName.of("R")));
    maybeDeleteRef(ctx, ap.get(PDFName.of("D")));
  }
  dict.delete(PDFName.of("AP"));
  dict.delete(PDFName.of("AS"));
}

function scrubFieldTree(ctx: PDFContext, dict: PDFDict): void {
  dict.delete(PDFName.of("V"));
  dict.delete(PDFName.of("DV"));
  dict.delete(PDFName.of("RV"));
  dict.delete(PDFName.of("AA"));
  dict.delete(PDFName.of("A"));
  stripAppearanceRefs(ctx, dict);

  const kids = dict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return;
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i);
    if (kid instanceof PDFDict) scrubFieldTree(ctx, kid);
  }
}

function removeRedactedFieldsFromAcroForm(
  doc: { context: PDFContext; catalog: PDFDict },
  redactedFieldIds: Set<FieldId>,
): void {
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return;
  const fields = acroForm.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return;

  const next = doc.context.obj([]);
  for (let i = 0; i < fields.size(); i++) {
    const raw = fields.get(i);
    const dict = fields.lookup(i);
    if (dict instanceof PDFDict && redactedFieldIds.has(stableFieldId(doc.context, dict))) {
      scrubFieldTree(doc.context, dict);
      continue;
    }
    next.push(raw);
  }
  if (next.size() > 0) {
    acroForm.set(PDFName.of("Fields"), next);
  } else {
    acroForm.delete(PDFName.of("Fields"));
  }
}

function pageHasRedactionOverlap(widget: PDFDict, redactions: Redaction[]): boolean {
  const rect = readRect(widget);
  if (!rect) return false;
  return redactions.some((r) => rectsOverlap(r, rect));
}

export function applyRedactionsToFormWidgets(
  doc: { context: PDFContext; catalog: PDFDict; getPages: () => PDFPage[] },
  redactionsByPage: Map<number, Redaction[]>,
): void {
  if (redactionsByPage.size === 0) return;
  const pages = doc.getPages();
  const redactedFieldIds = new Set<FieldId>();
  const redactedFieldDicts = new Map<FieldId, PDFDict>();

  for (const [pageIndex, redactions] of redactionsByPage) {
    const page = pages[pageIndex];
    if (!page || redactions.length === 0) continue;
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict) || !isWidget(annot)) continue;
      if (!pageHasRedactionOverlap(annot, redactions)) continue;
      const field = topFieldStable(doc.context, annot);
      redactedFieldIds.add(field.id);
      redactedFieldDicts.set(field.id, field.dict);
    }
  }
  if (redactedFieldIds.size === 0) return;

  for (const page of pages) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const next = doc.context.obj([]);
    for (let i = 0; i < annots.size(); i++) {
      const raw = annots.get(i);
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict) || !isWidget(annot)) {
        next.push(raw);
        continue;
      }
      const field = topFieldStable(doc.context, annot);
      if (!redactedFieldIds.has(field.id)) {
        next.push(raw);
        continue;
      }
      scrubFieldTree(doc.context, annot);
    }
    if (next.size() > 0) page.node.set(PDFName.of("Annots"), next);
    else page.node.delete(PDFName.of("Annots"));
  }

  for (const dict of redactedFieldDicts.values()) scrubFieldTree(doc.context, dict);
  removeRedactedFieldsFromAcroForm(doc, redactedFieldIds);
}
