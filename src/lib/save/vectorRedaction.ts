import { PDFDict, PDFName } from "pdf-lib";
import type { ContentOp } from "../contentStream";
import {
  includePathConstructionPoints,
  readNumberOperands,
  VECTOR_PAINT_OPS,
  VECTOR_PATH_END_OPS,
} from "../pdfPathOps";
import { rectsOverlap, type Redaction } from "@/domain/redactions";
import { mulCm, type Mat6, transformPoint } from "../pdfGeometry";

export function markVectorPaintOpsForRedaction(
  ops: ContentOp[],
  redactions: Redaction[],
  indicesToRemove: Set<number>,
): void {
  if (redactions.length === 0) return;
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
        const nums = readNumberOperands(o);
        if (nums?.length === 6) {
          ctm = mulCm(nums as Mat6, ctm);
        }
        break;
      }
      case "w": {
        const nums = readNumberOperands(o);
        if (nums?.length === 1) lineWidth = nums[0];
        break;
      }
      case "m":
      case "l":
      case "c":
      case "v":
      case "y":
      case "re": {
        if (includePathConstructionPoints(o, includePoint)) pathOps.push(i);
        break;
      }
      case "h":
        pathOps.push(i);
        break;
      default:
        if (VECTOR_PATH_END_OPS.has(o.op)) {
          if (VECTOR_PAINT_OPS.has(o.op)) {
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
