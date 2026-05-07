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
import { annotationBBox, type Annotation, type HighlightAnnotation } from "@/domain/annotations";
import { rectsOverlap, type Redaction } from "@/domain/redactions";
import type { PdfRect } from "@/domain/geometry";

const EPS = 1e-6;

type Point = { x: number; y: number };
type Rect = [number, number, number, number];

function rectFromArray(values: number[]): PdfRect | null {
  if (values.length < 4) return null;
  const [x1, y1, x2, y2] = values;
  const llx = Math.min(x1, x2);
  const lly = Math.min(y1, y2);
  const urx = Math.max(x1, x2);
  const ury = Math.max(y1, y2);
  if (urx - llx <= EPS || ury - lly <= EPS) return null;
  return { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly };
}

function rectToArray(r: PdfRect): Rect {
  return [r.pdfX, r.pdfY, r.pdfX + r.pdfWidth, r.pdfY + r.pdfHeight];
}

function readNumberArray(arr: PDFArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const item = arr.lookup(i);
    if (item instanceof PDFNumber) out.push(item.asNumber());
  }
  return out;
}

function numberArray(ctx: PDFContext, values: number[]): PDFArray {
  return ctx.obj(values.map((v) => PDFNumber.of(v)));
}

function redactionRect(r: Redaction): PdfRect {
  return {
    pdfX: r.pdfX,
    pdfY: r.pdfY,
    pdfWidth: r.pdfWidth,
    pdfHeight: r.pdfHeight,
  };
}

function expandRect(r: PdfRect, pad: number): PdfRect {
  if (pad <= EPS) return r;
  return {
    pdfX: r.pdfX - pad,
    pdfY: r.pdfY - pad,
    pdfWidth: r.pdfWidth + pad * 2,
    pdfHeight: r.pdfHeight + pad * 2,
  };
}

function subtractOneRect(base: PdfRect, cut: PdfRect): PdfRect[] {
  if (!rectsOverlap(base, cut)) return [base];
  const bx1 = base.pdfX;
  const by1 = base.pdfY;
  const bx2 = base.pdfX + base.pdfWidth;
  const by2 = base.pdfY + base.pdfHeight;
  const cx1 = cut.pdfX;
  const cy1 = cut.pdfY;
  const cx2 = cut.pdfX + cut.pdfWidth;
  const cy2 = cut.pdfY + cut.pdfHeight;
  const ix1 = Math.max(bx1, cx1);
  const iy1 = Math.max(by1, cy1);
  const ix2 = Math.min(bx2, cx2);
  const iy2 = Math.min(by2, cy2);
  if (ix2 - ix1 <= EPS || iy2 - iy1 <= EPS) return [base];

  const pieces: PdfRect[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    if (x2 - x1 > EPS && y2 - y1 > EPS) {
      pieces.push({ pdfX: x1, pdfY: y1, pdfWidth: x2 - x1, pdfHeight: y2 - y1 });
    }
  };

  push(bx1, by1, ix1, by2);
  push(ix2, by1, bx2, by2);
  push(ix1, by1, ix2, iy1);
  push(ix1, iy2, ix2, by2);
  return pieces;
}

function subtractRedactions(rect: PdfRect, redactions: Redaction[]): PdfRect[] {
  let pieces = [rect];
  for (const r of redactions) {
    const cut = redactionRect(r);
    pieces = pieces.flatMap((p) => subtractOneRect(p, cut));
    if (pieces.length === 0) break;
  }
  return pieces;
}

function quadRect(values: number[], offset: number): PdfRect | null {
  const xs = [values[offset], values[offset + 2], values[offset + 4], values[offset + 6]];
  const ys = [values[offset + 1], values[offset + 3], values[offset + 5], values[offset + 7]];
  return rectFromArray([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
}

function rectToQuad(r: PdfRect): number[] {
  const [llx, lly, urx, ury] = rectToArray(r);
  return [llx, ury, urx, ury, llx, lly, urx, lly];
}

function bboxOfRects(rects: PdfRect[]): Rect | null {
  if (rects.length === 0) return null;
  let llx = Infinity;
  let lly = Infinity;
  let urx = -Infinity;
  let ury = -Infinity;
  for (const r of rects) {
    llx = Math.min(llx, r.pdfX);
    lly = Math.min(lly, r.pdfY);
    urx = Math.max(urx, r.pdfX + r.pdfWidth);
    ury = Math.max(ury, r.pdfY + r.pdfHeight);
  }
  return [llx, lly, urx, ury];
}

function sanitizeMarkupAnnotation(
  ctx: PDFContext,
  dict: PDFDict,
  redactions: Redaction[],
): boolean {
  const quadObj = dict.lookup(PDFName.of("QuadPoints"));
  if (!(quadObj instanceof PDFArray)) return false;
  const values = readNumberArray(quadObj);
  const keptRects: PdfRect[] = [];
  const keptQuads: number[] = [];
  for (let i = 0; i + 7 < values.length; i += 8) {
    const rect = quadRect(values, i);
    if (!rect) continue;
    const pieces = subtractRedactions(rect, redactions);
    for (const piece of pieces) {
      keptRects.push(piece);
      keptQuads.push(...rectToQuad(piece));
    }
  }
  if (keptQuads.length === 0) return false;
  dict.set(PDFName.of("QuadPoints"), numberArray(ctx, keptQuads));
  const bbox = bboxOfRects(keptRects);
  if (bbox) dict.set(PDFName.of("Rect"), numberArray(ctx, bbox));
  dict.delete(PDFName.of("AP"));
  dict.delete(PDFName.of("Contents"));
  dict.delete(PDFName.of("Popup"));
  return true;
}

function pointAt(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function segmentInsideRectInterval(a: Point, b: Point, rect: PdfRect): [number, number] | null {
  const xMin = rect.pdfX;
  const yMin = rect.pdfY;
  const xMax = rect.pdfX + rect.pdfWidth;
  const yMax = rect.pdfY + rect.pdfHeight;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) <= EPS) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - xMin)) return null;
  if (!clip(dx, xMax - a.x)) return null;
  if (!clip(-dy, a.y - yMin)) return null;
  if (!clip(dy, yMax - a.y)) return null;
  if (t1 - t0 <= EPS) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}

function subtractInterval(
  intervals: Array<[number, number]>,
  cut: [number, number] | null,
): Array<[number, number]> {
  if (!cut) return intervals;
  const [c0, c1] = cut;
  const out: Array<[number, number]> = [];
  for (const [a, b] of intervals) {
    if (c1 <= a + EPS || c0 >= b - EPS) {
      out.push([a, b]);
      continue;
    }
    if (c0 > a + EPS) out.push([a, Math.max(a, c0)]);
    if (c1 < b - EPS) out.push([Math.min(b, c1), b]);
  }
  return out;
}

function visibleSegmentIntervals(
  a: Point,
  b: Point,
  redactions: Redaction[],
  pad: number,
): Array<[number, number]> {
  let intervals: Array<[number, number]> = [[0, 1]];
  for (const r of redactions) {
    intervals = subtractInterval(
      intervals,
      segmentInsideRectInterval(a, b, expandRect(redactionRect(r), pad)),
    );
    if (intervals.length === 0) break;
  }
  return intervals;
}

function readInkStrokes(inkList: PDFArray): Point[][] {
  const strokes: Point[][] = [];
  for (let i = 0; i < inkList.size(); i++) {
    const strokeObj = inkList.lookup(i);
    if (!(strokeObj instanceof PDFArray)) continue;
    const values = readNumberArray(strokeObj);
    const stroke: Point[] = [];
    for (let j = 0; j + 1 < values.length; j += 2) {
      stroke.push({ x: values[j], y: values[j + 1] });
    }
    if (stroke.length > 0) strokes.push(stroke);
  }
  return strokes;
}

function inkStrokeArray(ctx: PDFContext, stroke: Point[]): PDFArray {
  const values: PDFObject[] = [];
  for (const p of stroke) {
    values.push(PDFNumber.of(p.x), PDFNumber.of(p.y));
  }
  return ctx.obj(values);
}

function readBorderWidth(dict: PDFDict): number {
  const bs = dict.lookup(PDFName.of("BS"));
  if (bs instanceof PDFDict) {
    const w = bs.lookup(PDFName.of("W"));
    if (w instanceof PDFNumber) return w.asNumber();
  }
  return 1;
}

function bboxOfPoints(strokes: Point[][], pad: number): Rect | null {
  let llx = Infinity;
  let lly = Infinity;
  let urx = -Infinity;
  let ury = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      llx = Math.min(llx, p.x);
      lly = Math.min(lly, p.y);
      urx = Math.max(urx, p.x);
      ury = Math.max(ury, p.y);
    }
  }
  if (!Number.isFinite(llx)) return null;
  return [llx - pad, lly - pad, urx + pad, ury + pad];
}

function sanitizeInkAnnotation(ctx: PDFContext, dict: PDFDict, redactions: Redaction[]): boolean {
  const inkObj = dict.lookup(PDFName.of("InkList"));
  if (!(inkObj instanceof PDFArray)) return false;
  const clipPad = Math.max(0, readBorderWidth(dict) / 2);
  const kept: Point[][] = [];
  let changed = false;
  for (const stroke of readInkStrokes(inkObj)) {
    for (let i = 0; i + 1 < stroke.length; i++) {
      const a = stroke[i];
      const b = stroke[i + 1];
      const intervals = visibleSegmentIntervals(a, b, redactions, clipPad);
      if (intervals.length !== 1 || intervals[0][0] > EPS || intervals[0][1] < 1 - EPS) {
        changed = true;
      }
      for (const [t0, t1] of intervals) {
        const p0 = pointAt(a, b, t0);
        const p1 = pointAt(a, b, t1);
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > EPS) kept.push([p0, p1]);
      }
    }
  }
  if (!changed) return true;
  if (kept.length === 0) return false;
  const inkList = ctx.obj([]);
  for (const stroke of kept) inkList.push(inkStrokeArray(ctx, stroke));
  dict.set(PDFName.of("InkList"), inkList);
  const bbox = bboxOfPoints(kept, Math.max(1, readBorderWidth(dict) / 2));
  if (bbox) dict.set(PDFName.of("Rect"), numberArray(ctx, bbox));
  dict.delete(PDFName.of("AP"));
  dict.delete(PDFName.of("Contents"));
  dict.delete(PDFName.of("Popup"));
  return true;
}

function maybeDeleteRef(ctx: PDFContext, obj: PDFObject | undefined): void {
  if (obj instanceof PDFRef) ctx.delete(obj);
}

function deleteAnnotationSideObjects(ctx: PDFContext, dict: PDFDict): void {
  const apRaw = dict.get(PDFName.of("AP"));
  if (apRaw instanceof PDFRef) {
    const ap = ctx.lookup(apRaw);
    if (ap instanceof PDFDict) maybeDeleteRef(ctx, ap.get(PDFName.of("N")));
    ctx.delete(apRaw);
  } else if (apRaw instanceof PDFDict) {
    maybeDeleteRef(ctx, apRaw.get(PDFName.of("N")));
  }
  maybeDeleteRef(ctx, dict.get(PDFName.of("Popup")));
}

function sanitizeAnnotationDict(ctx: PDFContext, dict: PDFDict, redactions: Redaction[]): boolean {
  const subtypeObj = dict.lookup(PDFName.of("Subtype"));
  const subtype = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : "";
  if (subtype === "Widget") return true;
  if (subtype === "Ink") {
    return sanitizeInkAnnotation(ctx, dict, redactions);
  }

  const rectObj = dict.lookup(PDFName.of("Rect"));
  const annotRect = rectObj instanceof PDFArray ? rectFromArray(readNumberArray(rectObj)) : null;
  if (!annotRect) return true;
  if (!redactions.some((r) => rectsOverlap(r, annotRect))) return true;
  if (
    subtype === "Highlight" ||
    subtype === "Underline" ||
    subtype === "StrikeOut" ||
    subtype === "Squiggly"
  ) {
    return sanitizeMarkupAnnotation(ctx, dict, redactions);
  }

  deleteAnnotationSideObjects(ctx, dict);
  return false;
}

export function applyRedactionsToPageAnnotations(
  doc: { context: PDFContext },
  page: PDFPage,
  redactions: Redaction[],
): void {
  if (redactions.length === 0) return;
  const annotsObj = page.node.lookup(PDFName.of("Annots"));
  if (!(annotsObj instanceof PDFArray)) return;

  const next = doc.context.obj([]);
  for (let i = 0; i < annotsObj.size(); i++) {
    const raw = annotsObj.get(i);
    const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (!(dict instanceof PDFDict)) {
      next.push(raw);
      continue;
    }
    if (sanitizeAnnotationDict(doc.context, dict, redactions)) {
      next.push(raw);
    } else if (raw instanceof PDFRef) {
      doc.context.delete(raw);
    }
  }

  if (next.size() > 0) {
    page.node.set(PDFName.of("Annots"), next);
  } else {
    page.node.delete(PDFName.of("Annots"));
  }
}

function redactionsForAnnotation(a: Annotation, redactions: Redaction[]): Redaction[] {
  return redactions.filter((r) => r.sourceKey === a.sourceKey && r.pageIndex === a.pageIndex);
}

function sanitizeHighlightValue(
  a: HighlightAnnotation,
  redactions: Redaction[],
): HighlightAnnotation | null {
  const quads: HighlightAnnotation["quads"] = [];
  for (const q of a.quads) {
    const rect = rectFromArray([
      Math.min(q.x1, q.x2, q.x3, q.x4),
      Math.min(q.y1, q.y2, q.y3, q.y4),
      Math.max(q.x1, q.x2, q.x3, q.x4),
      Math.max(q.y1, q.y2, q.y3, q.y4),
    ]);
    if (!rect) continue;
    for (const piece of subtractRedactions(rect, redactions)) {
      const [llx, lly, urx, ury] = rectToArray(piece);
      quads.push({ x1: llx, y1: ury, x2: urx, y2: ury, x3: llx, y3: lly, x4: urx, y4: lly });
    }
  }
  if (quads.length === 0) return null;
  return { ...a, quads, comment: undefined };
}

function sanitizeInkValue(a: Extract<Annotation, { kind: "ink" }>, redactions: Redaction[]) {
  const kept: Array<Array<{ x: number; y: number }>> = [];
  const clipPad = Math.max(0, a.thickness / 2);
  let changed = false;
  for (const stroke of a.strokes) {
    for (let i = 0; i + 1 < stroke.length; i++) {
      const start = stroke[i];
      const end = stroke[i + 1];
      const intervals = visibleSegmentIntervals(start, end, redactions, clipPad);
      if (intervals.length !== 1 || intervals[0][0] > EPS || intervals[0][1] < 1 - EPS) {
        changed = true;
      }
      for (const [t0, t1] of intervals) {
        const p0 = pointAt(start, end, t0);
        const p1 = pointAt(start, end, t1);
        if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > EPS) kept.push([p0, p1]);
      }
    }
  }
  if (!changed) return a;
  if (kept.length === 0) return null;
  return { ...a, strokes: kept };
}

export function applyRedactionsToNewAnnotations(
  annotations: Annotation[],
  redactions: Redaction[],
): Annotation[] {
  if (annotations.length === 0 || redactions.length === 0) return annotations;
  const out: Annotation[] = [];
  for (const a of annotations) {
    const hits = redactionsForAnnotation(a, redactions);
    if (hits.length === 0) {
      out.push(a);
      continue;
    }
    if (a.kind === "highlight") {
      const next = sanitizeHighlightValue(a, hits);
      if (next) out.push(next);
      continue;
    }
    if (a.kind === "ink") {
      const next = sanitizeInkValue(a, hits);
      if (next) out.push(next);
      continue;
    }
    const [llx, lly, urx, ury] = annotationBBox(a);
    const rect = { pdfX: llx, pdfY: lly, pdfWidth: urx - llx, pdfHeight: ury - lly };
    if (!hits.some((r) => rectsOverlap(r, rect))) out.push(a);
  }
  return out;
}
