import { PDFDict, PDFName } from "pdf-lib";
import type { ContentOp } from "../contentStream";
import { rectsOverlap, type Redaction } from "../redactions";
import { type Mat6, transformPoint } from "../pdfGeometry";

function opNumbers(op: ContentOp): number[] | null {
  const out: number[] = [];
  for (const t of op.operands) {
    if (t.kind !== "number") return null;
    out.push(t.value);
  }
  return out;
}

export function markVectorPaintOpsForRedaction(
  ops: ContentOp[],
  redactions: Redaction[],
  indicesToRemove: Set<number>,
): void {
  if (redactions.length === 0) return;
  const PAINT_OPS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
  const PATH_END_OPS = new Set([...PAINT_OPS, "n"]);
  const ctmStack: Mat6[] = [];
  let ctm: Mat6 = [1, 0, 0, 1, 0, 0];
  let lineWidth = 1;
  let pathOps: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const resetPath = () => {
    pathOps = [];
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
  };
  const includePoint = (x: number, y: number) => {
    const [px, py] = transformPoint(ctm, x, y);
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const currentPathRect = () => {
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    const pad = Math.max(1, Math.abs(lineWidth) / 2);
    return {
      pdfX: minX - pad,
      pdfY: minY - pad,
      pdfWidth: maxX - minX + pad * 2,
      pdfHeight: maxY - minY + pad * 2,
    };
  };

  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    switch (o.op) {
      case "q":
        ctmStack.push([...ctm] as Mat6);
        break;
      case "Q": {
        const popped = ctmStack.pop();
        if (popped) ctm = popped;
        resetPath();
        break;
      }
      case "cm": {
        const nums = opNumbers(o);
        if (nums?.length === 6) {
          const m = nums as Mat6;
          ctm = [
            m[0] * ctm[0] + m[1] * ctm[2],
            m[0] * ctm[1] + m[1] * ctm[3],
            m[2] * ctm[0] + m[3] * ctm[2],
            m[2] * ctm[1] + m[3] * ctm[3],
            m[4] * ctm[0] + m[5] * ctm[2] + ctm[4],
            m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
          ];
        }
        break;
      }
      case "w": {
        const nums = opNumbers(o);
        if (nums?.length === 1) lineWidth = nums[0];
        break;
      }
      case "m":
      case "l": {
        const nums = opNumbers(o);
        if (nums?.length === 2) {
          pathOps.push(i);
          includePoint(nums[0], nums[1]);
        }
        break;
      }
      case "c": {
        const nums = opNumbers(o);
        if (nums?.length === 6) {
          pathOps.push(i);
          includePoint(nums[0], nums[1]);
          includePoint(nums[2], nums[3]);
          includePoint(nums[4], nums[5]);
        }
        break;
      }
      case "v":
      case "y": {
        const nums = opNumbers(o);
        if (nums?.length === 4) {
          pathOps.push(i);
          includePoint(nums[0], nums[1]);
          includePoint(nums[2], nums[3]);
        }
        break;
      }
      case "re": {
        const nums = opNumbers(o);
        if (nums?.length === 4) {
          pathOps.push(i);
          const [x, y, w, h] = nums;
          includePoint(x, y);
          includePoint(x + w, y);
          includePoint(x, y + h);
          includePoint(x + w, y + h);
        }
        break;
      }
      case "h":
        pathOps.push(i);
        break;
      default:
        if (PATH_END_OPS.has(o.op)) {
          if (PAINT_OPS.has(o.op)) {
            const pathRect = currentPathRect();
            if (pathRect && redactions.some((r) => rectsOverlap(r, pathRect))) {
              for (const idx of pathOps) indicesToRemove.add(idx);
              indicesToRemove.add(i);
            }
          }
          resetPath();
        }
        break;
    }
  }
}

export function pruneUnusedPageXObjects(pageNode: PDFDict, usedNames: Set<string>): void {
  const resources = pageNode.lookup(PDFName.of("Resources"));
  if (!(resources instanceof PDFDict)) return;
  const oldXObjects = resources.lookup(PDFName.of("XObject"));
  if (!(oldXObjects instanceof PDFDict)) return;
  const nextResources = PDFDict.withContext(pageNode.context);
  for (const [key, value] of resources.entries()) {
    if (key.decodeText() !== "XObject") nextResources.set(key, value);
  }
  const nextXObjects = PDFDict.withContext(pageNode.context);
  for (const [key, value] of oldXObjects.entries()) {
    if (usedNames.has(key.decodeText())) nextXObjects.set(key, value);
  }
  if (nextXObjects.keys().length > 0) {
    nextResources.set(PDFName.of("XObject"), nextXObjects);
  }
  pageNode.set(PDFName.of("Resources"), nextResources);
}
