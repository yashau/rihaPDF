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

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
} from "pdf-lib";
import { parseContentStream, type ContentOp } from "./contentStream";
import { getPageContentBytes } from "./pageContent";

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
  /** Index of the *single* `cm` op inside the q…Q block whose translation
   *  we'll rewrite on save. Null if we couldn't find a clean cm to own
   *  this image's transform — UI should still show the image but mark it
   *  un-movable. */
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
export async function extractPageImages(
  pdfBytes: ArrayBuffer,
): Promise<PageImages[]> {
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
function resolveXObjectDict(
  pageNode: PDFDict,
  doc: PDFDocument,
): PDFDict | null {
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

/** Look up the Subtype of the XObject named `resName` on the page. */
function subtypeOf(
  xobjectDict: PDFDict | null,
  resName: string,
): ImageInstance["subtype"] {
  if (!xobjectDict) return "Unknown";
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
  if (!dict) return "Unknown";
  const sub = dict.lookup(PDFName.of("Subtype"));
  const s = sub ? String(sub).replace(/^\//, "") : "";
  if (s === "Image") return "Image";
  if (s === "Form") return "Form";
  return "Unknown";
}

/** 6-element affine A × B (PDF row-vector convention: P' = P × M). */
function mulCm(
  a: [number, number, number, number, number, number],
  b: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

const IDENTITY: [number, number, number, number, number, number] = [
  1, 0, 0, 1, 0, 0,
];

/** Walk ops with a q/Q stack tracking CTM, and emit one ImageInstance per
 *  Do op that references an Image / Form XObject. */
function findImagesInOps(
  ops: ContentOp[],
  xobjectDict: PDFDict | null,
  _doc: PDFDocument,
  pageNumber: number,
): ImageInstance[] {
  const out: ImageInstance[] = [];
  const stack: [
    number,
    number,
    number,
    number,
    number,
    number,
  ][] = [];
  let ctm: [number, number, number, number, number, number] = [...IDENTITY];
  // Track the most recent cm op index AND the q-block depth at which it
  // was applied. We only treat a cm as "owning" a Do if both sit inside
  // the same q...Q block — otherwise rewriting it would also shift other
  // content after Q.
  let lastCmIndex: number | null = null;
  let lastCmDepth = -1;
  let depth = 0;
  let imageCounter = 0;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        stack.push([...ctm]);
        depth++;
        break;
      case "Q": {
        const popped = stack.pop();
        if (popped) ctm = popped;
        if (lastCmDepth === depth) {
          // The cm we were tracking dies with this q-block.
          lastCmIndex = null;
          lastCmDepth = -1;
        }
        depth--;
        break;
      }
      case "cm": {
        if (
          o.operands.length === 6 &&
          o.operands.every((x) => x.kind === "number")
        ) {
          const m = o.operands.map(
            (x) => (x as { value: number }).value,
          ) as [number, number, number, number, number, number];
          ctm = mulCm(m, ctm);
          lastCmIndex = i;
          lastCmDepth = depth;
        }
        break;
      }
      case "Do": {
        const arg = o.operands[0];
        if (!arg || arg.kind !== "name") break;
        const resName = arg.value;
        const subtype = subtypeOf(xobjectDict, resName);
        if (subtype !== "Image" && subtype !== "Form") break;
        // Skip Forms with all-zero scale (sometimes used as invisible
        // markers).
        if (Math.abs(ctm[0]) < 1e-6 && Math.abs(ctm[3]) < 1e-6) break;
        out.push({
          id: `p${pageNumber}-i${imageCounter++}`,
          resourceName: resName,
          subtype,
          doOpIndex: i,
          cmOpIndex: lastCmIndex,
          ctm: [...ctm],
          pdfX: ctm[4],
          pdfY: ctm[5],
          pdfWidth: Math.abs(ctm[0]),
          pdfHeight: Math.abs(ctm[3]),
        });
        break;
      }
    }
  }
  return out;
}
