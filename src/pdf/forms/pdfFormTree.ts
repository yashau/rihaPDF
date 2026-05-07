import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
  type PDFContext,
} from "pdf-lib";
import type { PdfRect } from "@/pdf/geometry/pdfGeometry";

export function decodePdfTextString(obj: PDFObject | undefined): string {
  if (!obj) return "";
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  if (obj instanceof PDFName) return obj.asString().replace(/^\//, "");
  return "";
}

export function readPdfNumber(obj: PDFObject | undefined): number | null {
  return obj instanceof PDFNumber ? obj.asNumber() : null;
}

/** Walk `/Parent` and return the first direct value for an inheritable key. */
export function inheritedObject(dict: PDFDict, key: PDFName): PDFObject | undefined {
  let node: PDFDict | null = dict;
  while (node) {
    const direct = node.lookup(key);
    if (direct !== undefined) return direct;
    const parent: PDFObject | undefined = node.lookup(PDFName.of("Parent"));
    node = parent instanceof PDFDict ? parent : null;
  }
  return undefined;
}

/** Walk `/Parent` and return the dict that owns an inheritable key. */
export function inheritedOwner(dict: PDFDict, key: PDFName): PDFDict | undefined {
  let node: PDFDict | null = dict;
  while (node) {
    if (node.lookup(key) !== undefined) return node;
    const parent: PDFObject | undefined = node.lookup(PDFName.of("Parent"));
    node = parent instanceof PDFDict ? parent : null;
  }
  return undefined;
}

export function partialFieldName(dict: PDFDict): string | null {
  const t = dict.lookup(PDFName.of("T"));
  if (t instanceof PDFString || t instanceof PDFHexString) return t.decodeText();
  return null;
}

export function fullyQualifiedFieldName(dict: PDFDict): string {
  const parts: string[] = [];
  let node: PDFDict | null = dict;
  while (node) {
    const partial = partialFieldName(node);
    if (partial) parts.unshift(partial);
    const parent: PDFObject | undefined = node.lookup(PDFName.of("Parent"));
    node = parent instanceof PDFDict ? parent : null;
  }
  return parts.join(".");
}

export function isWidgetDict(dict: PDFDict): boolean {
  const subtype = dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName && subtype.asString() === "/Widget";
}

export function resolvePdfDict(ctx: PDFContext, obj: PDFObject | undefined): PDFDict | null {
  if (obj instanceof PDFDict) return obj;
  if (obj instanceof PDFRef) {
    const resolved = ctx.lookup(obj);
    return resolved instanceof PDFDict ? resolved : null;
  }
  return null;
}

/** True iff a kid is itself a field, not merely a widget annotation. */
export function isFieldKid(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("T")) !== undefined) return true;
  const kids = dict.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return false;
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i);
    if (kid instanceof PDFDict && isFieldKid(kid)) return true;
  }
  return false;
}

export function readPdfRectArray(dict: PDFDict): [number, number, number, number] | null {
  const r = dict.lookup(PDFName.of("Rect"));
  if (!(r instanceof PDFArray) || r.size() < 4) return null;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const v = r.get(i);
    nums.push(v instanceof PDFNumber ? v.asNumber() : 0);
  }
  const [a, b, c, d] = nums;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export function readPdfRect(dict: PDFDict): PdfRect | null {
  const rect = readPdfRectArray(dict);
  if (!rect) return null;
  const [llx, lly, urx, ury] = rect;
  if (urx <= llx || ury <= lly) return null;
  return { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly };
}

export function discoverWidgetOnState(widgetDict: PDFDict): string | null {
  const ap = widgetDict.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return null;
  const n = ap.lookup(PDFName.of("N"));
  if (!(n instanceof PDFDict)) return null;
  for (const [key] of n.entries()) {
    const name = key.asString().replace(/^\//, "");
    if (name && name !== "Off") return name;
  }
  return null;
}

/** Collect widget dictionaries owned by a terminal field. Nested
 *  sub-fields are skipped. A merged field/widget returns the field
 *  dict itself. */
export function collectWidgetDicts(field: PDFDict): PDFDict[] {
  if (isWidgetDict(field)) return [field];
  const out: PDFDict[] = [];
  const kids = field.lookup(PDFName.of("Kids"));
  if (!(kids instanceof PDFArray)) return out;
  for (let i = 0; i < kids.size(); i++) {
    const kid = kids.lookup(i);
    if (!(kid instanceof PDFDict)) continue;
    if (kid.lookup(PDFName.of("T")) !== undefined) continue;
    const subtype = kid.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && subtype.asString() !== "/Widget") continue;
    out.push(kid);
  }
  return out;
}
