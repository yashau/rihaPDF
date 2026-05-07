// Walk a page's content stream looking for q…Q blocks that paint
// vector shapes (lines, rectangles, paths) — i.e. blocks that contain
// at least one path-painting operator (S, f, B, …) but no text (BT)
// and no image (Do). Each such block becomes a `ShapeInstance` the UI
// can hit-test, select, and delete by stripping the q…Q range from
// the saved content stream (same mechanism source images use).
//
// Vector-drawing convention in PDF (§8.5):
//
//   q                           % push state
//   1 0 0 1 e f cm              % optional transform
//   x y m  x y l                % path construction
//   S | s | f | f* | B | b ...  % path painting
//   Q                           % pop state
//
// Clip-only blocks (path → W/W* → n, never painted) are excluded:
// `n` ends the path without painting, so they're invisible. We also
// skip blocks that mix in text or images — those belong to the text
// edit / image move pipelines and stripping the whole block would
// kill that content too.
//
// Scope cut for v1: only top-level q…Q blocks. Nested shapes are
// rolled into their parent block's bbox; un-wrapped page-level path
// ops (no q…Q at all) are not detected.

import { PDFDocument } from "pdf-lib";
import { parseContentStream, type ContentOp } from "@/pdf/content/contentStream";
import { getPageContentBytes } from "@/pdf/content/pageContent";
import {
  includePathConstructionPoints,
  readNumberOperands,
  VECTOR_CLIP_OPS,
  VECTOR_PAINT_OPS,
  VECTOR_PATH_END_OPS,
} from "@/pdf/content/pdfPathOps";
import { IDENTITY_MATRIX, mulCm, transformPoint, type Mat6 } from "@/pdf/geometry/pdfGeometry";

export type ShapeInstance = {
  /** Stable id: "p<pageNumber>-s<index>". */
  id: string;
  /** Index of the outer `q` op opening this block. */
  qOpIndex: number;
  /** Index of the matching `Q` op closing this block. Inclusive — the
   *  save strip removes [qOpIndex … QOpIndex]. */
  QOpIndex: number;
  /** Page-space bounding rect in PDF user units (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
};

export type PageShapes = ShapeInstance[];

/** Build a ShapeInstance[] for every page in the document. The returned
 *  array is page-indexed (0-based). */
export async function extractPageShapes(pdfBytes: ArrayBuffer): Promise<PageShapes[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const out: PageShapes[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const bytes = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(bytes);
    out.push(findShapesInOps(ops, pi + 1));
  }
  return out;
}

/** Walk ops and emit one ShapeInstance per top-level q…Q block whose
 *  contents are pure vector painting. */
function findShapesInOps(ops: ContentOp[], pageNumber: number): ShapeInstance[] {
  const out: ShapeInstance[] = [];

  type Block = {
    qIdx: number;
    /** True if any BT op appears inside (we skip — text). */
    hasText: boolean;
    /** True if any Do op appears inside (we skip — images own that). */
    hasImage: boolean;
    /** True if any path-painting op (S/f/B/…) appears. */
    hasPaint: boolean;
    /** Painted-path bbox: only paths ending in a paint op contribute.
     *  Clip-only (`re W* n`) and no-op-end (`n`) paths are discarded
     *  so they don't expand the hit zone over unrelated content. */
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    /** Bbox of the path currently being constructed. Reset whenever
     *  a path-end op fires; merged into the block's painted bbox iff
     *  the end op was a paint. */
    curMinX: number;
    curMinY: number;
    curMaxX: number;
    curMaxY: number;
  };

  const newBlock = (qIdx: number): Block => ({
    qIdx,
    hasText: false,
    hasImage: false,
    hasPaint: false,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    curMinX: Infinity,
    curMinY: Infinity,
    curMaxX: -Infinity,
    curMaxY: -Infinity,
  });

  const resetCurPath = (b: Block): void => {
    b.curMinX = Infinity;
    b.curMinY = Infinity;
    b.curMaxX = -Infinity;
    b.curMaxY = -Infinity;
  };

  const mergeCurIntoPainted = (b: Block): void => {
    if (!Number.isFinite(b.curMinX)) return;
    if (b.curMinX < b.minX) b.minX = b.curMinX;
    if (b.curMinY < b.minY) b.minY = b.curMinY;
    if (b.curMaxX > b.maxX) b.maxX = b.curMaxX;
    if (b.curMaxY > b.maxY) b.maxY = b.curMaxY;
  };

  const blockStack: Block[] = [];
  const ctmStack: Mat6[] = [];
  let ctm: Mat6 = [...IDENTITY_MATRIX] as Mat6;

  // Propagate child-block flags up to the outer block on Q so a
  // nested image / text inside the outermost q…Q correctly disqualifies
  // it (we only emit shapes for blocks that are pure vector all the way
  // down).
  const propagate = (child: Block, parent: Block) => {
    parent.hasText ||= child.hasText;
    parent.hasImage ||= child.hasImage;
    parent.hasPaint ||= child.hasPaint;
    if (child.minX < parent.minX) parent.minX = child.minX;
    if (child.minY < parent.minY) parent.minY = child.minY;
    if (child.maxX > parent.maxX) parent.maxX = child.maxX;
    if (child.maxY > parent.maxY) parent.maxY = child.maxY;
  };

  let counter = 0;

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const top = blockStack[blockStack.length - 1] ?? null;

    const includePoint = (x: number, y: number) => {
      if (!top) return;
      const [px, py] = transformPoint(ctm, x, y);
      if (px < top.curMinX) top.curMinX = px;
      if (py < top.curMinY) top.curMinY = py;
      if (px > top.curMaxX) top.curMaxX = px;
      if (py > top.curMaxY) top.curMaxY = py;
    };

    switch (o.op) {
      case "q":
        ctmStack.push([...ctm] as Mat6);
        blockStack.push(newBlock(i));
        break;

      case "Q": {
        const popped = ctmStack.pop();
        if (popped) ctm = popped;
        const child = blockStack.pop();
        if (!child) break;
        const parent = blockStack[blockStack.length - 1] ?? null;
        if (parent) {
          propagate(child, parent);
          break;
        }
        // Outermost block closing — emit if it's a pure-vector shape
        // with a real bbox.
        if (!child.hasText && !child.hasImage && child.hasPaint) {
          const w = child.maxX - child.minX;
          const h = child.maxY - child.minY;
          if (Number.isFinite(w) && Number.isFinite(h) && w > 0.01 && h > 0.01) {
            out.push({
              id: `p${pageNumber}-s${counter++}`,
              qOpIndex: child.qIdx,
              QOpIndex: i,
              pdfX: child.minX,
              pdfY: child.minY,
              pdfWidth: w,
              pdfHeight: h,
            });
          } else if (Number.isFinite(w) && Number.isFinite(h)) {
            // Path geometry has zero extent in at least one axis. Two
            // sub-cases that look the same in the bbox but should not
            // collapse to the same shape:
            //   - true horizontal / vertical line (one axis > 0)
            //     → keep the long axis, pad the short axis by ~1pt so
            //       it has a real visual extent the run-decoration
            //       pairer (`runDecorations.ts`) can see and downstream
            //       hit-test math can grab. Without this, an underline
            //       drawn as `m / l / S` collapses to a 2×2 dot at the
            //       segment centroid and the pairer finds nothing.
            //   - true point path (both axes ≤ 0.01) → pad to a small
            //     square around the centroid so the user can still
            //     click to delete.
            const isHorizontal = w > 0.01 && h <= 0.01;
            const isVertical = h > 0.01 && w <= 0.01;
            if (isHorizontal) {
              const pad = 0.5;
              out.push({
                id: `p${pageNumber}-s${counter++}`,
                qOpIndex: child.qIdx,
                QOpIndex: i,
                pdfX: child.minX,
                pdfY: child.minY - pad,
                pdfWidth: w,
                pdfHeight: pad * 2,
              });
            } else if (isVertical) {
              const pad = 0.5;
              out.push({
                id: `p${pageNumber}-s${counter++}`,
                qOpIndex: child.qIdx,
                QOpIndex: i,
                pdfX: child.minX - pad,
                pdfY: child.minY,
                pdfWidth: pad * 2,
                pdfHeight: h,
              });
            } else {
              const cx = (child.minX + child.maxX) / 2;
              const cy = (child.minY + child.maxY) / 2;
              const pad = 1;
              out.push({
                id: `p${pageNumber}-s${counter++}`,
                qOpIndex: child.qIdx,
                QOpIndex: i,
                pdfX: cx - pad,
                pdfY: cy - pad,
                pdfWidth: pad * 2,
                pdfHeight: pad * 2,
              });
            }
          }
        }
        break;
      }

      case "cm": {
        const nums = readNumberOperands(o);
        if (nums && nums.length === 6) {
          ctm = mulCm(nums as Mat6, ctm);
        }
        break;
      }

      case "BT":
        if (top) top.hasText = true;
        break;
      case "Do":
        if (top) top.hasImage = true;
        break;

      case "m":
      case "l":
      case "c":
      case "v":
      case "y":
      case "re": {
        includePathConstructionPoints(o, includePoint);
        break;
      }

      default:
        if (top && VECTOR_PATH_END_OPS.has(o.op)) {
          // Path is ending. If the end is a paint op, merge the
          // current path's bbox into the block's painted bbox; if it's
          // `n`, drop it (clip-only path that contributes no fill /
          // stroke). Either way, reset the per-path accumulator.
          if (VECTOR_PAINT_OPS.has(o.op)) {
            mergeCurIntoPainted(top);
            top.hasPaint = true;
          }
          resetCurPath(top);
        } else if (top && VECTOR_CLIP_OPS.has(o.op)) {
          // Clip op (W / W*) modifies the clipping path but does not
          // end the path or paint. The next op is typically `n` —
          // handled above. We don't need to do anything here.
        }
        break;
    }
  }

  return out;
}
