import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  DEFAULT_COMMENT_COLOR,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_INK_COLOR,
  type Annotation,
  type AnnotationColor,
  type CommentAnnotation,
  type HighlightAnnotation,
  type InkAnnotation,
  type Quad,
} from "./annotations";

const SUPPORTED_SOURCE_SUBTYPES = new Set(["Highlight", "FreeText", "Ink"]);

type SourceAnnotParseOptions = {
  sourceKey: string;
  pageIndex: number;
  annotIndex: number;
};

function decodeTextString(obj: unknown): string | null {
  if (obj instanceof PDFString) return obj.asString();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

function readNumberArray(arr: PDFArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const item = arr.lookup(i);
    if (item instanceof PDFNumber) out.push(item.asNumber());
  }
  return out;
}

function readColor(dict: PDFDict, key: string, fallback: AnnotationColor): AnnotationColor {
  const obj = dict.lookup(PDFName.of(key));
  if (!(obj instanceof PDFArray)) return fallback;
  const nums = readNumberArray(obj);
  if (nums.length < 3) return fallback;
  return [nums[0], nums[1], nums[2]];
}

function rectFromDict(dict: PDFDict): [number, number, number, number] | null {
  const obj = dict.lookup(PDFName.of("Rect"));
  if (!(obj instanceof PDFArray)) return null;
  const nums = readNumberArray(obj);
  if (nums.length < 4) return null;
  const llx = Math.min(nums[0], nums[2]);
  const lly = Math.min(nums[1], nums[3]);
  const urx = Math.max(nums[0], nums[2]);
  const ury = Math.max(nums[1], nums[3]);
  if (urx <= llx || ury <= lly) return null;
  return [llx, lly, urx, ury];
}

function sourceAnnotId(
  dict: PDFDict,
  kind: Annotation["kind"],
  { sourceKey, pageIndex, annotIndex }: SourceAnnotParseOptions,
): string {
  const nm = decodeTextString(dict.lookup(PDFName.of("NM")));
  const suffix = nm && nm.length > 0 ? nm.replace(/\s+/g, "-") : `${kind}-${annotIndex}`;
  return `${sourceKey}:source-annot:${pageIndex}:${annotIndex}:${suffix}`;
}

function parseHighlight(dict: PDFDict, opts: SourceAnnotParseOptions): HighlightAnnotation | null {
  const quadObj = dict.lookup(PDFName.of("QuadPoints"));
  if (!(quadObj instanceof PDFArray)) return null;
  const nums = readNumberArray(quadObj);
  const quads: Quad[] = [];
  for (let i = 0; i + 7 < nums.length; i += 8) {
    quads.push({
      x1: nums[i],
      y1: nums[i + 1],
      x2: nums[i + 2],
      y2: nums[i + 3],
      x3: nums[i + 4],
      y3: nums[i + 5],
      x4: nums[i + 6],
      y4: nums[i + 7],
    });
  }
  if (quads.length === 0) return null;
  return {
    kind: "highlight",
    id: sourceAnnotId(dict, "highlight", opts),
    sourceAnnotationId: sourceAnnotId(dict, "highlight", opts),
    sourceKey: opts.sourceKey,
    pageIndex: opts.pageIndex,
    quads,
    color: readColor(dict, "C", DEFAULT_HIGHLIGHT_COLOR),
    comment: decodeTextString(dict.lookup(PDFName.of("Contents"))) ?? undefined,
  };
}

function parseFontSize(dict: PDFDict): number {
  const da = decodeTextString(dict.lookup(PDFName.of("DA")));
  if (!da) return 12;
  const match = da.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+Tf(?:\s|$)/);
  return match ? Number(match[1]) : 12;
}

function parseComment(dict: PDFDict, opts: SourceAnnotParseOptions): CommentAnnotation | null {
  const rect = rectFromDict(dict);
  if (!rect) return null;
  const [llx, lly, urx, ury] = rect;
  const text = decodeTextString(dict.lookup(PDFName.of("Contents"))) ?? "";
  const id = sourceAnnotId(dict, "comment", opts);
  return {
    kind: "comment",
    id,
    sourceAnnotationId: id,
    sourceKey: opts.sourceKey,
    pageIndex: opts.pageIndex,
    pdfX: llx,
    pdfY: lly,
    pdfWidth: urx - llx,
    pdfHeight: ury - lly,
    color: readColor(dict, "IC", readColor(dict, "C", DEFAULT_COMMENT_COLOR)),
    text,
    fontSize: parseFontSize(dict),
  };
}

function readBorderWidth(dict: PDFDict): number {
  const bs = dict.lookup(PDFName.of("BS"));
  if (bs instanceof PDFDict) {
    const w = bs.lookup(PDFName.of("W"));
    if (w instanceof PDFNumber) return w.asNumber();
  }
  const border = dict.lookup(PDFName.of("Border"));
  if (border instanceof PDFArray) {
    const nums = readNumberArray(border);
    if (nums.length >= 3) return nums[2];
  }
  return 1.5;
}

function parseInk(dict: PDFDict, opts: SourceAnnotParseOptions): InkAnnotation | null {
  const inkObj = dict.lookup(PDFName.of("InkList"));
  if (!(inkObj instanceof PDFArray)) return null;
  const strokes: InkAnnotation["strokes"] = [];
  for (let i = 0; i < inkObj.size(); i++) {
    const strokeObj = inkObj.lookup(i);
    if (!(strokeObj instanceof PDFArray)) continue;
    const nums = readNumberArray(strokeObj);
    const stroke: Array<{ x: number; y: number }> = [];
    for (let j = 0; j + 1 < nums.length; j += 2) {
      stroke.push({ x: nums[j], y: nums[j + 1] });
    }
    if (stroke.length >= 2) strokes.push(stroke);
  }
  if (strokes.length === 0) return null;
  const id = sourceAnnotId(dict, "ink", opts);
  return {
    kind: "ink",
    id,
    sourceAnnotationId: id,
    sourceKey: opts.sourceKey,
    pageIndex: opts.pageIndex,
    strokes,
    color: readColor(dict, "C", DEFAULT_INK_COLOR),
    thickness: readBorderWidth(dict),
  };
}

function parseAnnotationDict(dict: PDFDict, opts: SourceAnnotParseOptions): Annotation | null {
  const subtypeObj = dict.lookup(PDFName.of("Subtype"));
  const subtype = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : "";
  if (subtype === "Highlight") return parseHighlight(dict, opts);
  if (subtype === "FreeText") return parseComment(dict, opts);
  if (subtype === "Ink") return parseInk(dict, opts);
  return null;
}

export function extractSourceAnnotations(doc: PDFDocument, sourceKey: string): Annotation[][] {
  return doc.getPages().map((page, pageIndex) => {
    const annotsObj = page.node.lookup(PDFName.of("Annots"));
    if (!(annotsObj instanceof PDFArray)) return [];
    const pageAnnotations: Annotation[] = [];
    for (let annotIndex = 0; annotIndex < annotsObj.size(); annotIndex++) {
      const raw = annotsObj.get(annotIndex);
      const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
      if (!(dict instanceof PDFDict)) continue;
      const parsed = parseAnnotationDict(dict, { sourceKey, pageIndex, annotIndex });
      if (parsed) pageAnnotations.push(parsed);
    }
    return pageAnnotations;
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function normalizedAnnotation(a: Annotation): unknown {
  if (a.kind === "highlight") {
    return {
      kind: a.kind,
      quads: a.quads.map((q) => ({
        x1: round(q.x1),
        y1: round(q.y1),
        x2: round(q.x2),
        y2: round(q.y2),
        x3: round(q.x3),
        y3: round(q.y3),
        x4: round(q.x4),
        y4: round(q.y4),
      })),
      color: a.color.map(round),
      comment: a.comment ?? "",
    };
  }
  if (a.kind === "comment") {
    return {
      kind: a.kind,
      pdfX: round(a.pdfX),
      pdfY: round(a.pdfY),
      pdfWidth: round(a.pdfWidth),
      pdfHeight: round(a.pdfHeight),
      color: a.color.map(round),
      text: a.text,
      fontSize: round(a.fontSize),
    };
  }
  return {
    kind: a.kind,
    strokes: a.strokes.map((stroke) => stroke.map((p) => ({ x: round(p.x), y: round(p.y) }))),
    color: a.color.map(round),
    thickness: round(a.thickness),
  };
}

function annotationSignature(a: Annotation): string {
  return JSON.stringify(normalizedAnnotation(a));
}

export function annotationsEquivalent(a: Annotation, b: Annotation): boolean {
  return annotationSignature(a) === annotationSignature(b);
}

export function annotationArraysEquivalent(a: Annotation[], b: Annotation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!annotationsEquivalent(a[i], b[i])) return false;
  }
  return true;
}

function decrementSignature(counts: Map<string, number>, sig: string): boolean {
  const n = counts.get(sig) ?? 0;
  if (n <= 0) return false;
  if (n === 1) counts.delete(sig);
  else counts.set(sig, n - 1);
  return true;
}

function supportedSubtype(dict: PDFDict): boolean {
  const subtypeObj = dict.lookup(PDFName.of("Subtype"));
  const subtype = subtypeObj instanceof PDFName ? subtypeObj.decodeText() : "";
  return SUPPORTED_SOURCE_SUBTYPES.has(subtype);
}

function removeParsedPageAnnotations(
  page: PDFPage,
  pageIndex: number,
  sourceKey: string,
  baseline: Annotation[],
): void {
  if (baseline.length === 0) return;
  const annotsObj = page.node.lookup(PDFName.of("Annots"));
  if (!(annotsObj instanceof PDFArray)) return;

  const baselineCounts = new Map<string, number>();
  for (const a of baseline) {
    const sig = annotationSignature(a);
    baselineCounts.set(sig, (baselineCounts.get(sig) ?? 0) + 1);
  }

  const next = page.doc.context.obj([]);
  for (let annotIndex = 0; annotIndex < annotsObj.size(); annotIndex++) {
    const raw = annotsObj.get(annotIndex);
    const dict = raw instanceof PDFRef ? page.doc.context.lookup(raw) : raw;
    if (!(dict instanceof PDFDict) || !supportedSubtype(dict)) {
      next.push(raw);
      continue;
    }
    const parsed = parseAnnotationDict(dict, { sourceKey, pageIndex, annotIndex });
    if (!parsed || !decrementSignature(baselineCounts, annotationSignature(parsed))) {
      next.push(raw);
      continue;
    }
    if (raw instanceof PDFRef) page.doc.context.delete(raw);
  }

  if (next.size() > 0) page.node.set(PDFName.of("Annots"), next);
  else page.node.delete(PDFName.of("Annots"));
}

export function removeParsedSourceAnnotationsFromDoc(
  doc: PDFDocument,
  sourceKey: string,
  annotationsByPage: Annotation[][],
): void {
  if (annotationsByPage.every((arr) => arr.length === 0)) return;
  const pages = doc.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    removeParsedPageAnnotations(
      pages[pageIndex],
      pageIndex,
      sourceKey,
      annotationsByPage[pageIndex] ?? [],
    );
  }
}
