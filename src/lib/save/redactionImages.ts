import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import type { Redaction } from "@/domain/redactions";
import { type Mat6, transformPoint } from "../pdfGeometry";
import { lookupPageXObjectRef } from "./xobjects";

export function rectContains(
  outer: Redaction,
  inner: { pdfX: number; pdfY: number; pdfWidth: number; pdfHeight: number },
): boolean {
  const eps = 0.001;
  return (
    outer.pdfX <= inner.pdfX + eps &&
    outer.pdfY <= inner.pdfY + eps &&
    outer.pdfX + outer.pdfWidth >= inner.pdfX + inner.pdfWidth - eps &&
    outer.pdfY + outer.pdfHeight >= inner.pdfY + inner.pdfHeight - eps
  );
}

function inverseMat6(m: Mat6): Mat6 | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-9) return null;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

function readDictNumber(dict: PDFDict, key: string): number | null {
  const value = dict.lookup(PDFName.of(key));
  if (value && typeof value === "object" && "asNumber" in value) {
    return (value as { asNumber(): number }).asNumber();
  }
  return typeof value === "number" ? value : null;
}

function pdfNameText(value: unknown): string | null {
  if (value instanceof PDFName) return value.decodeText();
  return null;
}

function imageComponents(dict: PDFDict): number | null {
  const cs = dict.lookup(PDFName.of("ColorSpace"));
  const name = pdfNameText(cs);
  if (name === "DeviceGray") return 1;
  if (name === "DeviceRGB") return 3;
  if (name === "DeviceCMYK") return 4;
  return null;
}

function decodedRawImageBytes(stream: PDFRawStream): Uint8Array | null {
  try {
    return decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
}

function redactionToImagePixelBounds(
  redaction: Redaction,
  imageCtm: Mat6,
  pixelWidth: number,
  pixelHeight: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const inv = inverseMat6(imageCtm);
  if (!inv) return null;
  const x0 = redaction.pdfX;
  const y0 = redaction.pdfY;
  const x1 = redaction.pdfX + redaction.pdfWidth;
  const y1 = redaction.pdfY + redaction.pdfHeight;
  const pts = [
    transformPoint(inv, x0, y0),
    transformPoint(inv, x1, y0),
    transformPoint(inv, x0, y1),
    transformPoint(inv, x1, y1),
  ];
  let minUx = Infinity;
  let maxUx = -Infinity;
  let minUy = Infinity;
  let maxUy = -Infinity;
  for (const [ux, uy] of pts) {
    minUx = Math.min(minUx, ux);
    maxUx = Math.max(maxUx, ux);
    minUy = Math.min(minUy, uy);
    maxUy = Math.max(maxUy, uy);
  }
  minUx = Math.max(0, Math.min(1, minUx));
  maxUx = Math.max(0, Math.min(1, maxUx));
  minUy = Math.max(0, Math.min(1, minUy));
  maxUy = Math.max(0, Math.min(1, maxUy));
  if (maxUx <= minUx || maxUy <= minUy) return null;
  return {
    x0: Math.max(0, Math.floor(minUx * pixelWidth)),
    x1: Math.min(pixelWidth, Math.ceil(maxUx * pixelWidth)),
    y0: Math.max(0, Math.floor((1 - maxUy) * pixelHeight)),
    y1: Math.min(pixelHeight, Math.ceil((1 - minUy) * pixelHeight)),
  };
}

export function makeRedactedImageXObject(
  doc: PDFDocument,
  pageNode: PDFDict,
  resName: string,
  imageCtm: Mat6,
  redactions: Redaction[],
): PDFRef | null {
  const ref = lookupPageXObjectRef(doc, pageNode, resName);
  if (!ref) return null;
  const obj = doc.context.lookup(ref);
  if (!(obj instanceof PDFRawStream)) return null;
  const dict = obj.dict;
  if (pdfNameText(dict.lookup(PDFName.of("Subtype"))) !== "Image") return null;
  // Masks can carry the sensitive silhouette even when the color
  // samples are blanked. Fall back to whole-draw stripping for those.
  if (dict.lookup(PDFName.of("SMask")) || dict.lookup(PDFName.of("Mask"))) return null;

  const width = readDictNumber(dict, "Width");
  const height = readDictNumber(dict, "Height");
  const bits = readDictNumber(dict, "BitsPerComponent");
  const components = imageComponents(dict);
  if (!width || !height || bits !== 8 || !components) return null;

  const decoded = decodedRawImageBytes(obj);
  if (!decoded) return null;
  const rowStride = width * components;
  if (decoded.length < rowStride * height) return null;

  const redacted = new Uint8Array(decoded);
  const fill = components === 4 ? [0, 0, 0, 255] : components === 3 ? [0, 0, 0] : [0];
  let touched = false;
  for (const r of redactions) {
    const bounds = redactionToImagePixelBounds(r, imageCtm, width, height);
    if (!bounds) continue;
    touched = true;
    for (let y = bounds.y0; y < bounds.y1; y++) {
      for (let x = bounds.x0; x < bounds.x1; x++) {
        const off = y * rowStride + x * components;
        for (let c = 0; c < components; c++) redacted[off + c] = fill[c];
      }
    }
  }
  if (!touched) return null;

  const imageDict = doc.context.obj({
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Image"),
    Width: width,
    Height: height,
    BitsPerComponent: bits,
    ColorSpace: dict.lookup(PDFName.of("ColorSpace")) ?? PDFName.of("DeviceRGB"),
  });
  return doc.context.register(PDFRawStream.of(imageDict, redacted));
}
