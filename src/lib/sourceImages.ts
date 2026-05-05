// Walk a page's content stream looking for `Do` ops that draw an image
// XObject and report each one's position + size in PDF user space, along
// with the index of the `cm` op that owns its transform (the one we'll
// rewrite when the user drags the image to a new position).
//
// Image-positioning convention in PDF:
//
//   q                       % push graphics state
//   a b c d e f cm          % set the CTM that maps the unit square to
//                           % the image's drawn rectangle on the page
//   /Im1 Do                 % paint the XObject
//   Q                       % pop graphics state
//
// The `cm` matrix is `[a b c d e f]` where for an axis-aligned image
// (the common case from Word, PowerPoint, etc.) `a` is the rendered
// width, `d` is the rendered height, `b == c == 0`, and `(e, f)` is
// the bottom-left corner in PDF user space (y-up).
//
// To MOVE the image we just add (dx, dy) to operands [4] and [5] of
// that exact cm op, leaving the scale + rotation untouched. That keeps
// the rewrite trivially safe: nothing else on the page is affected, and
// scaling/rotation is preserved verbatim.

import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { parseContentStream, type ContentOp } from "./contentStream";
import { getPageContentBytes } from "./pageContent";
import { IDENTITY_MATRIX, mulCm, transformPoint, type Mat6 } from "./pdfGeometry";

export type ImageInstance = {
  /** Stable id for UI / save plumbing: "p<pageNumber>-i<index>". */
  id: string;
  /** PDF resource name (e.g. "Im0", "FormX1"). */
  resourceName: string;
  /** XObject subtype: "Image" or "Form" (form XObjects can wrap vector
   *  graphics; we treat both as movable rectangles). */
  subtype: "Image" | "Form" | "Unknown";
  /** Index of the `Do` op in the parsed content-stream ops array. */
  doOpIndex: number;
  /** Index of the `q` op that opens this image's drawing block. Save
   *  inserts a translate `cm` right after this index to move the
   *  image — that becomes the OUTERMOST transform in the chain so the
   *  user-space delta isn't scaled by a subsequent scale cm. Null if
   *  the Do isn't inside a balanced q…Q (rare; UI marks un-movable). */
  qOpIndex: number | null;
  /** Index of the *first* `cm` op (containing translation) inside this
   *  image's q…Q block. Kept for diagnostics; the save path now
   *  prefers inserting a fresh cm via `qOpIndex`. */
  cmOpIndex: number | null;
  /** Full CTM at the moment of `Do`. Used to compute bounds + to derive
   *  the move-translation vector for non-axis-aligned images later. */
  ctm: [number, number, number, number, number, number];
  /** Bottom-left corner in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  /** Rendered width / height in PDF user space (always positive — we
   *  take absolute value of CTM[0] and CTM[3]). */
  pdfWidth: number;
  pdfHeight: number;
};

export type PageImages = ImageInstance[];

/** Build an ImageInstance[] for every page in the document. The returned
 *  array is page-indexed (0-based). */
export async function extractPageImages(pdfBytes: ArrayBuffer): Promise<PageImages[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const out: PageImages[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const xobjectDict = resolveXObjectDict(page.node, doc);
    const bytes = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(bytes);
    out.push(findImagesInOps(ops, xobjectDict, doc, pi + 1));
  }
  return out;
}

/** Resources / XObject for the given page, walking the page tree so an
 *  inherited Resources entry on a parent Pages node also works. */
function resolveXObjectDict(pageNode: PDFDict, doc: PDFDocument): PDFDict | null {
  let node: PDFDict | null = pageNode;
  while (node) {
    const resourcesRaw = node.lookup(PDFName.of("Resources"));
    if (resourcesRaw instanceof PDFDict) {
      const xo = resourcesRaw.lookup(PDFName.of("XObject"));
      if (xo instanceof PDFDict) return xo;
    }
    const parent: unknown = node.lookup(PDFName.of("Parent"));
    if (parent instanceof PDFDict) {
      node = parent;
    } else if (parent instanceof PDFRef) {
      const r = doc.context.lookup(parent);
      node = r instanceof PDFDict ? r : null;
    } else {
      node = null;
    }
  }
  return null;
}

type BBox4 = [number, number, number, number];

/** Subtype + Form-specific geometry (BBox, Matrix) for an XObject. The
 *  BBox / Matrix entries are required by the PDF spec for Form XObjects
 *  (defaulting to identity matrix and the unit square); we leave them
 *  null for Image XObjects, where the unit square `(0, 0, 1, 1)` is the
 *  implicit BBox and the CTM at the time of `Do` is the only transform
 *  that matters.
 *
 *  We need this because some PDFs draw their letterhead emblem as a
 *  Form XObject whose `/BBox` is e.g. `[0, 0, 42, 47]` and whose
 *  `/Matrix` further scales that, making the rendered size much larger
 *  than `|CTM[0]|`. Without consulting BBox + Matrix the extracted
 *  size for those is sub-pixel and the user can't grab the overlay. */
function lookupXObject(
  xobjectDict: PDFDict | null,
  resName: string,
): { subtype: ImageInstance["subtype"]; bbox: BBox4 | null; matrix: Mat6 | null } {
  if (!xobjectDict) return { subtype: "Unknown", bbox: null, matrix: null };
  const x = xobjectDict.lookup(PDFName.of(resName));
  // pdf-lib resolves PDFRef on lookup; if it's a stream we still get a
  // PDFRawStream-like thing with a .dict accessor.
  let dict: PDFDict | null = null;
  if (x instanceof PDFDict) {
    dict = x;
  } else if (x && typeof x === "object") {
    const maybeDict = (x as unknown as { dict?: unknown }).dict;
    if (maybeDict instanceof PDFDict) dict = maybeDict;
  }
  if (!dict) return { subtype: "Unknown", bbox: null, matrix: null };
  const sub = dict.lookup(PDFName.of("Subtype"));
  const s = sub ? String(sub).replace(/^\//, "") : "";
  let subtype: ImageInstance["subtype"] = "Unknown";
  if (s === "Image") subtype = "Image";
  else if (s === "Form") subtype = "Form";
  if (subtype !== "Form") return { subtype, bbox: null, matrix: null };
  const bbox = readNumberArray(dict.lookup(PDFName.of("BBox")), 4) as BBox4 | null;
  const matrix = readNumberArray(dict.lookup(PDFName.of("Matrix")), 6) as Mat6 | null;
  return { subtype, bbox, matrix };
}

/** Decode a fixed-length array of numbers from a PDFArray, defensively
 *  ignoring entries that aren't numbers. Returns null on length / shape
 *  mismatch so the caller can fall back to the implicit defaults. */
function readNumberArray(value: unknown, length: number): number[] | null {
  if (!value || typeof value !== "object" || !("asArray" in value)) return null;
  const arr = (value as { asArray(): unknown[] }).asArray();
  if (arr.length < length) return null;
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const v = arr[i];
    if (v && typeof v === "object" && "asNumber" in v) {
      out.push((v as { asNumber(): number }).asNumber());
    } else if (typeof v === "number") {
      out.push(v);
    } else {
      return null;
    }
  }
  return out;
}

const IDENTITY_BBOX: BBox4 = [0, 0, 1, 1];
/** Compute the page-space axis-aligned bounding rectangle a Form
 *  (or Image) XObject occupies when drawn with the given outer CTM.
 *  For Forms we apply the chain `BBox-corner × Matrix × CTM`; for
 *  Images the BBox is the unit square and Matrix is identity, so the
 *  result reduces to `(|ctm[0]|, |ctm[3]|)` for axis-aligned cases —
 *  which is what we used to return directly. */
function transformedRect(
  bbox: BBox4 | null,
  matrix: Mat6 | null,
  ctm: Mat6,
): { x: number; y: number; width: number; height: number } {
  const b = bbox ?? IDENTITY_BBOX;
  const m = matrix ?? IDENTITY_MATRIX;
  const composed = mulCm(m, ctm);
  const corners: Array<[number, number]> = [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[0], b[3]],
    [b[2], b[3]],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const [px, py] = transformPoint(composed, x, y);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Walk ops with a q/Q stack tracking CTM, and emit one ImageInstance per
 *  Do op that references an Image / Form XObject. */
function findImagesInOps(
  ops: ContentOp[],
  xobjectDict: PDFDict | null,
  _doc: PDFDocument,
  pageNumber: number,
): ImageInstance[] {
  const out: ImageInstance[] = [];
  const stack: Mat6[] = [];
  let ctm: Mat6 = [...IDENTITY_MATRIX] as Mat6;
  // For each open q-block, the index of the q op AND the index of
  // the first cm seen inside it. Save uses qIdx to insert a fresh
  // outermost translate cm; the firstCmIdx is mostly a diagnostic.
  const blockStack: { qIdx: number; firstCmIdx: number | null }[] = [];
  let imageCounter = 0;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        stack.push([...ctm] as Mat6);
        blockStack.push({ qIdx: i, firstCmIdx: null });
        break;
      case "Q": {
        const popped = stack.pop();
        if (popped) ctm = popped;
        blockStack.pop();
        break;
      }
      case "cm": {
        if (o.operands.length === 6 && o.operands.every((x) => x.kind === "number")) {
          const m = o.operands.map((x) => (x as { value: number }).value) as Mat6;
          ctm = mulCm(m, ctm);
          const top = blockStack[blockStack.length - 1];
          if (top && top.firstCmIdx == null) top.firstCmIdx = i;
        }
        break;
      }
      case "Do": {
        const arg = o.operands[0];
        if (!arg || arg.kind !== "name") break;
        const resName = arg.value;
        const lookup = lookupXObject(xobjectDict, resName);
        if (lookup.subtype !== "Image" && lookup.subtype !== "Form") break;
        // Skip drawings with all-zero outer scale (sometimes used as
        // invisible markers — the rendered rect would be empty).
        if (Math.abs(ctm[0]) < 1e-6 && Math.abs(ctm[3]) < 1e-6) break;
        const block = blockStack[blockStack.length - 1] ?? null;
        // Apply the Form's BBox + Matrix to get the actual rendered
        // rect on the page. For Image XObjects the helper falls back
        // to the unit-square BBox + identity Matrix, reproducing the
        // older `|ctm[0]|, |ctm[3]|` size for axis-aligned cases.
        const rect = transformedRect(lookup.bbox, lookup.matrix, ctm);
        if (rect.width < 1e-6 || rect.height < 1e-6) break;
        out.push({
          id: `p${pageNumber}-i${imageCounter++}`,
          resourceName: resName,
          subtype: lookup.subtype,
          doOpIndex: i,
          qOpIndex: block?.qIdx ?? null,
          cmOpIndex: block?.firstCmIdx ?? null,
          ctm: [...ctm] as Mat6,
          pdfX: rect.x,
          pdfY: rect.y,
          pdfWidth: rect.width,
          pdfHeight: rect.height,
        });
        break;
      }
    }
  }
  return out;
}
