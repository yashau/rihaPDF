import { PDFName, PDFRef } from "pdf-lib";
import type { TextRun } from "@/pdf/render/pdf";
import {
  findTextShows,
  parseContentStream,
  serializeContentStream,
  type ContentOp,
} from "@/pdf/content/contentStream";
import { getPageContentBytes, setPageContentBytes } from "@/pdf/content/pageContent";
import { DEFAULT_FONT_FAMILY } from "@/pdf/text/fonts";
import { buildSourceTextBlocks, type SourceTextBlock } from "@/pdf/text/textBlocks";
import { rectsOverlap, type Redaction } from "@/domain/redactions";
import { planRedactionStrip } from "./redactions/glyphs";
import type { Edit, ImageMove, ShapeDelete } from "./types";
import type { LoadedSourceContext } from "./context";
import { findMatchingQ, lookupPageXObjectRef, readImageBytesFromXObject } from "./xobjects";
import { makeRedactedImageXObject, rectContains } from "./redactions/images";
import { markVectorPaintOpsForRedaction, pruneUnusedPageXObjects } from "./redactions/vectors";

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/u;

/** Plan for a same-source draw: emit drawText on this source's `doc`
 *  at (boxLeftPdf, baselineYPdf) on `targetPageIndex`. */
export type SameSourceDrawPlan = {
  edit: Edit;
  run: TextRun;
  sourceKey: string;
  targetPageIndex: number;
  boxLeftPdf: number;
  baselineYPdf: number;
  runPdfWidth: number;
  runPdfHeight: number;
  lineStepPdf?: number;
  lineLayoutsPdf?: RichTextLineLayoutPdf[];
};

/** Plan for a cross-source draw: drawText on the TARGET source's doc,
 *  but the run / styling came from a different source. */
export type CrossSourceDrawPlan = {
  edit: Edit;
  run: TextRun;
  targetSourceKey: string;
  targetPageIndex: number;
  boxLeftPdf: number;
  baselineYPdf: number;
  runPdfWidth: number;
  runPdfHeight: number;
  lineStepPdf?: number;
  lineLayoutsPdf?: RichTextLineLayoutPdf[];
};

export type RichTextLineLayoutPdf = {
  xOffset: number;
  baselineOffset: number;
  width: number;
  justify: boolean;
};

export type SameSourceImageDrawPlan = {
  move: ImageMove;
  sourceKey: string;
  xobjectRef: PDFRef;
  targetPageIndex: number;
  cm: [number, number, number, number, number, number];
};

export type CrossSourceImageDrawPlan = {
  move: ImageMove;
  /** Pixel bytes pulled out of the origin source — re-embedded on the
   *  target source's doc. Lossy for vector / masked images, ok for
   *  raster (the v1 trade-off documented in the plan). */
  imageBytes: Uint8Array;
  imageFormat: "png" | "jpeg" | null;
  targetSourceKey: string;
  targetPageIndex: number;
  cm: [number, number, number, number, number, number];
};

export async function applyStreamSurgeryForSource(
  ctx: LoadedSourceContext,
  sourceEdits: Edit[],
  sourceMoves: ImageMove[],
  sourceShapeDeletes: ShapeDelete[],
  sourceRedactions: Redaction[],
  sameSourceDraws: SameSourceDrawPlan[],
  crossSourceDraws: CrossSourceDrawPlan[],
  sameSourceImageDraws: SameSourceImageDrawPlan[],
  crossSourceImageDraws: CrossSourceImageDrawPlan[],
): Promise<void> {
  // Stream surgery only runs on real-source ctxs — caller filters out
  // synthetic blank ctxs upstream (their edits/moves/shape-deletes
  // buckets are always empty). Assert for the type narrowing.
  if (!ctx.source) throw new Error("applyStreamSurgeryForSource called on synthetic ctx");
  const source = ctx.source;
  const { doc, getFont } = ctx;
  const editsByPage = new Map<number, Edit[]>();
  for (const e of sourceEdits) {
    if (!editsByPage.has(e.pageIndex)) editsByPage.set(e.pageIndex, []);
    editsByPage.get(e.pageIndex)!.push(e);
  }
  const movesByPage = new Map<number, ImageMove[]>();
  for (const m of sourceMoves) {
    if (!movesByPage.has(m.pageIndex)) movesByPage.set(m.pageIndex, []);
    movesByPage.get(m.pageIndex)!.push(m);
  }
  const shapeDeletesByPage = new Map<number, ShapeDelete[]>();
  for (const d of sourceShapeDeletes) {
    if (!shapeDeletesByPage.has(d.pageIndex)) shapeDeletesByPage.set(d.pageIndex, []);
    shapeDeletesByPage.get(d.pageIndex)!.push(d);
  }
  const redactionsByPage = new Map<number, Redaction[]>();
  for (const r of sourceRedactions) {
    if (!redactionsByPage.has(r.pageIndex)) redactionsByPage.set(r.pageIndex, []);
    redactionsByPage.get(r.pageIndex)!.push(r);
  }
  const pagesToRewrite = new Set<number>([
    ...editsByPage.keys(),
    ...movesByPage.keys(),
    ...shapeDeletesByPage.keys(),
    ...redactionsByPage.keys(),
  ]);

  const docPages = doc.getPages();

  for (const pageIndex of pagesToRewrite) {
    const pageEdits = editsByPage.get(pageIndex) ?? [];
    const pageImageMoves = movesByPage.get(pageIndex) ?? [];
    const page = docPages[pageIndex];
    const rendered = source.pages[pageIndex];
    if (!page || !rendered) continue;

    // Pre-load all fonts this page needs and register them on the page so
    // the resource names exist before we emit operators referencing them.
    // (Cross-page edits register their font on the TARGET page later via
    // drawText's internal setFont call — handled in the second-pass phase.)
    const familiesUsed = Array.from(
      new Set(
        pageEdits
          .filter(
            (e) =>
              !isCrossPageEdit(e, source.sourceKey, pageIndex) &&
              !isCrossSourceEdit(e, source.sourceKey),
          )
          .map((e) => {
            if (e.style?.fontFamily) return e.style.fontFamily;
            const run = rendered.textRuns.find((r) => r.id === e.runId);
            return run?.fontFamily ?? DEFAULT_FONT_FAMILY;
          }),
      ),
    );
    for (const family of familiesUsed) {
      const f = await getFont(family);
      page.setFont(f.pdfFont);
    }

    // Read + parse the existing content stream.
    const originalContent = getPageContentBytes(doc.context, page.node);
    const ops = parseContentStream(originalContent);
    const shows = findTextShows(ops);

    const pageHeight = page.getHeight();
    const scale = rendered.scale;

    const indicesToRemove = new Set<number>();
    const replaceWithOps = new Map<number, ContentOp>();
    const moveOps: Array<{ tjIndex: number; newTx: number; newTy: number }> = [];

    for (const edit of pageEdits) {
      const run = resolveEditRun(rendered.textRuns, rendered.pageNumber, edit);
      if (!run) continue;
      const sourceRuns = sourceRunsForEdit(rendered.textRuns, run, edit);
      const runPdfX = run.bounds.left / scale;
      const runPdfY = pageHeight - run.baselineY / scale;
      const runPdfWidth = run.bounds.width / scale;
      const runPdfHeight = run.height / scale;
      const lineStepPdf = lineStepForRuns(sourceRuns, scale);
      const lineLayoutsPdf = lineLayoutsForRuns(sourceRuns, run, scale);
      const drawBox = drawBoxForEdit(run, edit, scale, runPdfX, runPdfWidth, lineLayoutsPdf);

      const editOpIndices = new Set(sourceRuns.flatMap((r) => r.contentStreamOpIndices));
      let matched = shows.filter((s) => editOpIndices.has(s.index));
      type TargetBox = { y: number; xMin: number; xMax: number };
      const targetBoxes: TargetBox[] = sourceRuns.map((sourceRun) => ({
        y: Math.round(pageHeight - sourceRun.baselineY / scale),
        xMin: sourceRun.bounds.left / scale,
        xMax: (sourceRun.bounds.left + sourceRun.bounds.width) / scale,
      }));
      if (matched.length === 0) {
        const tolY = Math.max(2, runPdfHeight * 0.4);
        const tolX = Math.max(2, runPdfHeight * 0.3);
        matched = shows.filter((s) => {
          const ex = s.textMatrix[4];
          const ey = s.textMatrix[5];
          if (Math.abs(ey - runPdfY) > tolY) return false;
          if (ex < runPdfX - tolX) return false;
          if (ex > runPdfX + runPdfWidth + tolX) return false;
          return true;
        });
      }
      const matchedIndexes = new Set(matched.map((s) => s.index));
      const xSlackPdf = Math.max(8, runPdfHeight);
      for (const s of shows) {
        if (matchedIndexes.has(s.index)) continue;
        const ey = Math.round(s.textMatrix[5]);
        const ex = s.textMatrix[4];
        for (const box of targetBoxes) {
          if (Math.abs(ey - box.y) > 1) continue;
          if (ex < box.xMin - xSlackPdf || ex > box.xMax + xSlackPdf) continue;
          matched.push(s);
          matchedIndexes.add(s.index);
          break;
        }
      }

      // Whatever the path, if the run carries source-detected
      // decoration ops (underline / strikethrough q…Q blocks paired
      // with this run at load time), strip those alongside the Tj's so
      // the line never desyncs from the text. The redraw paths re-emit
      // a fresh decoration that tracks the new geometry.
      const stripDecoration = () => {
        for (const sourceRun of sourceRuns) {
          for (const range of sourceRun.decorationOpRanges ?? []) {
            for (let k = range.qOpIndex; k <= range.QOpIndex; k++) {
              indicesToRemove.add(k);
            }
          }
        }
      };

      if (edit.deleted) {
        for (const s of matched) indicesToRemove.add(s.index);
        stripDecoration();
        continue;
      }

      const isCross = isCrossPageEdit(edit, source.sourceKey, pageIndex);
      if (isCross) {
        for (const s of matched) indicesToRemove.add(s.index);
        stripDecoration();
        const targetSourceKey = edit.targetSourceKey ?? source.sourceKey;
        if (targetSourceKey === source.sourceKey) {
          sameSourceDraws.push({
            edit,
            run,
            sourceKey: source.sourceKey,
            targetPageIndex: edit.targetPageIndex!,
            boxLeftPdf: edit.targetPdfX ?? drawBox.left,
            baselineYPdf: edit.targetPdfY ?? 0,
            runPdfWidth: drawBox.width,
            runPdfHeight,
            lineStepPdf,
            lineLayoutsPdf,
          });
        } else {
          crossSourceDraws.push({
            edit,
            run,
            targetSourceKey,
            targetPageIndex: edit.targetPageIndex!,
            boxLeftPdf: edit.targetPdfX ?? drawBox.left,
            baselineYPdf: edit.targetPdfY ?? 0,
            runPdfWidth: drawBox.width,
            runPdfHeight,
            lineStepPdf,
            lineLayoutsPdf,
          });
        }
        continue;
      }

      // A pure-translation move can normally keep the original Tj's in
      // place and emit a single Tm to relocate them — cheaper, exact.
      // But that path leaves any source-detected decoration q…Q at the
      // OLD position, so once a run has decoration we fall through to
      // the full strip-and-redraw path which will re-emit a fresh line
      // at the new position.
      const hasDecoration = (run.decorationOpRanges?.length ?? 0) > 0;
      const isMoveOnly =
        edit.newText === run.text &&
        !edit.style &&
        !hasDecoration &&
        ((edit.dx ?? 0) !== 0 || (edit.dy ?? 0) !== 0);
      if (isMoveOnly && matched.length > 0) {
        const moveX = (edit.dx ?? 0) / scale;
        const moveY = -(edit.dy ?? 0) / scale;
        for (const s of matched) {
          moveOps.push({
            tjIndex: s.index,
            newTx: s.textMatrix[4] + moveX,
            newTy: s.textMatrix[5] + moveY,
          });
        }
        continue;
      }

      for (const s of matched) indicesToRemove.add(s.index);
      stripDecoration();

      const moveX = (edit.dx ?? 0) / scale;
      const moveY = -(edit.dy ?? 0) / scale;
      sameSourceDraws.push({
        edit,
        run,
        sourceKey: source.sourceKey,
        targetPageIndex: pageIndex,
        boxLeftPdf: drawBox.left + moveX,
        baselineYPdf: runPdfY + moveY,
        runPdfWidth: drawBox.width,
        runPdfHeight,
        lineStepPdf,
        lineLayoutsPdf,
      });
    }

    const moveByTjIndex = new Map<number, { newTx: number; newTy: number }>();
    for (const m of moveOps) {
      moveByTjIndex.set(m.tjIndex, { newTx: m.newTx, newTy: m.newTy });
    }

    const insertAfterQ = new Map<number, [number, number, number, number, number, number]>();
    for (const move of pageImageMoves) {
      const img = rendered.images.find((i) => i.id === move.imageId);
      if (!img || img.qOpIndex == null) continue;

      if (move.deleted) {
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        if (matchingQ != null) {
          for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
        }
        continue;
      }

      const isCross = isCrossPageMove(move, source.sourceKey, pageIndex);

      if (isCross) {
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        if (matchingQ != null) {
          for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
        }
        const w = move.targetPdfWidth ?? img.pdfWidth;
        const h = move.targetPdfHeight ?? img.pdfHeight;
        const tx = move.targetPdfX ?? img.pdfX;
        const ty = move.targetPdfY ?? img.pdfY;
        const targetSourceKey = move.targetSourceKey ?? source.sourceKey;
        if (targetSourceKey === source.sourceKey) {
          // Same-source cross-page move — we can re-use the XObject ref.
          const ref = lookupPageXObjectRef(doc, page.node, img.resourceName);
          if (!ref) continue;
          sameSourceImageDraws.push({
            move,
            sourceKey: source.sourceKey,
            xobjectRef: ref,
            targetPageIndex: move.targetPageIndex!,
            cm: [w, 0, 0, h, tx, ty],
          });
        } else {
          // Cross-source move — pull the original pixel bytes out of
          // the source's XObject and queue an embed-on-target. Vector
          // / masked images won't survive cleanly; that's documented.
          const bytesAndFmt = readImageBytesFromXObject(doc, page.node, img.resourceName);
          crossSourceImageDraws.push({
            move,
            imageBytes: bytesAndFmt?.bytes ?? new Uint8Array(),
            imageFormat: bytesAndFmt?.format ?? null,
            targetSourceKey,
            targetPageIndex: move.targetPageIndex!,
            cm: [w, 0, 0, h, tx, ty],
          });
        }
        continue;
      }

      const dxPdf = (move.dx ?? 0) / scale;
      const dyPdf = -(move.dy ?? 0) / scale;
      const dwPdf = (move.dw ?? 0) / scale;
      const dhPdf = (move.dh ?? 0) / scale;
      const oldW = img.pdfWidth;
      const oldH = img.pdfHeight;
      const newW = oldW + dwPdf;
      const newH = oldH + dhPdf;
      const oldX = img.pdfX;
      const oldY = img.pdfY;
      const newX = oldX + dxPdf;
      const newY = oldY + dyPdf;
      const sx = oldW > 1e-6 ? newW / oldW : 1;
      const sy = oldH > 1e-6 ? newH / oldH : 1;
      const ex = newX - oldX * sx;
      const ey = newY - oldY * sy;
      insertAfterQ.set(img.qOpIndex, [sx, 0, 0, sy, ex, ey]);
    }

    const pageRedactions = redactionsByPage.get(pageIndex) ?? [];
    if (pageRedactions.length > 0) {
      for (const img of rendered.images) {
        const imageRect = {
          pdfX: img.pdfX,
          pdfY: img.pdfY,
          pdfWidth: img.pdfWidth,
          pdfHeight: img.pdfHeight,
        };
        const overlapping = pageRedactions.filter((r) => rectsOverlap(r, imageRect));
        if (overlapping.length === 0) continue;
        if (img.qOpIndex == null) {
          // No balanced q...Q to isolate. Drop just the Do op so the
          // pixels/Form content no longer paint; resource pruning below
          // removes the XObject when no other Do still references it.
          indicesToRemove.add(img.doOpIndex);
          continue;
        }
        const matchingQ = findMatchingQ(ops, img.qOpIndex);
        const fullyCovered = overlapping.some((r) => rectContains(r, imageRect));
        if (img.subtype !== "Image" || fullyCovered) {
          if (matchingQ != null) {
            for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
          } else {
            indicesToRemove.add(img.doOpIndex);
          }
          continue;
        }

        const replacementRef = makeRedactedImageXObject(
          doc,
          page.node,
          img.resourceName,
          img.ctm,
          overlapping,
        );
        if (!replacementRef) {
          // Unsupported raster encoding/mask. The safe failure mode is
          // removing the whole draw, because leaving the original XObject
          // reachable would leak pixels outside the visual black box.
          if (matchingQ != null) {
            for (let k = img.qOpIndex; k <= matchingQ; k++) indicesToRemove.add(k);
          } else {
            indicesToRemove.add(img.doOpIndex);
          }
          continue;
        }
        const replacementName = (
          page.node as unknown as {
            newXObject: (tag: string, ref: PDFRef) => PDFName;
          }
        ).newXObject("RihaRedactedImg", replacementRef);
        replaceWithOps.set(img.doOpIndex, {
          op: "Do",
          operands: [{ kind: "name", value: replacementName.decodeText() }],
        });
      }
    }

    // Vector-shape deletes — strip each shape's q…Q range. The detector
    // already validated the block is pure vector (no nested text /
    // image), so removing it can't take down unrelated content.
    const pageShapeDeletes = shapeDeletesByPage.get(pageIndex) ?? [];
    for (const del of pageShapeDeletes) {
      const shape = rendered.shapes.find((s) => s.id === del.shapeId);
      if (!shape) continue;
      for (let k = shape.qOpIndex; k <= shape.QOpIndex; k++) {
        indicesToRemove.add(k);
      }
    }

    // Redactions also destroy vector graphics underneath the rectangle.
    // First use the source shape detector's q...Q ranges for grouped
    // vector blocks; then run a lower-level path pass that catches
    // unwrapped path paint operators and individual paths inside larger
    // graphics-state blocks.
    if (pageRedactions.length > 0) {
      for (const shape of rendered.shapes) {
        const shapeRect = {
          pdfX: shape.pdfX,
          pdfY: shape.pdfY,
          pdfWidth: shape.pdfWidth,
          pdfHeight: shape.pdfHeight,
        };
        if (!pageRedactions.some((r) => rectsOverlap(r, shapeRect))) continue;
        for (let k = shape.qOpIndex; k <= shape.QOpIndex; k++) {
          indicesToRemove.add(k);
        }
      }
      markVectorPaintOpsForRedaction(ops, pageRedactions, indicesToRemove);
    }

    // Per-glyph redaction strip. Walks every Tj/TJ on the page,
    // intersects each glyph's world bbox against the redaction rects,
    // and emits one of three plans per affected op:
    //   - drop          → add to indicesToRemove (whole op removed)
    //   - rewrite       → replace ops[i] with a TJ that paints kept
    //                     glyphs and inserts negative-spacer numbers
    //                     where the redacted glyphs used to sit
    //   - unsupported   → fall back to whole-op strip (over-strip is
    //                     the safe failure mode for redaction; under-
    //                     strip would leak glyphs into the saved file)
    // Ops untouched by any redaction don't appear in the plan and are
    // emitted unchanged below. This pass runs after the edit/move
    // logic above so an op that's both being moved AND redacted ends
    // up dropped (the replacement-text-overlay model can't survive a
    // redaction over the same span anyway).
    if (pageRedactions.length > 0) {
      const resources = page.node.Resources();
      if (resources) {
        const plans = planRedactionStrip(ops, resources, doc.context, pageRedactions);
        for (const p of plans) {
          if (p.kind === "drop" || p.kind === "unsupported") {
            indicesToRemove.add(p.opIndex);
          } else {
            replaceWithOps.set(p.opIndex, p.replacement);
          }
        }
      } else {
        // No resources → can't resolve fonts → can't safely strip
        // per-glyph. Conservatively drop every text-show that any
        // redaction overlaps via the run-bbox shortcut so the saved
        // file still has nothing recoverable under the rect.
        for (const r of pageRedactions) {
          for (const run of rendered.textRuns) {
            const runRect = {
              pdfX: run.bounds.left / scale,
              pdfY: (rendered.viewHeight - run.bounds.top - run.bounds.height) / scale,
              pdfWidth: run.bounds.width / scale,
              pdfHeight: run.bounds.height / scale,
            };
            if (!rectsOverlap(r, runRect)) continue;
            for (const opIdx of run.contentStreamOpIndices) indicesToRemove.add(opIdx);
          }
        }
      }
    }

    const newOps: typeof ops = [];
    for (let i = 0; i < ops.length; i++) {
      if (indicesToRemove.has(i)) continue;
      const move = moveByTjIndex.get(i);
      if (move) {
        newOps.push({
          op: "Tm",
          operands: [
            { kind: "number", value: 1, raw: "1" },
            { kind: "number", value: 0, raw: "0" },
            { kind: "number", value: 0, raw: "0" },
            { kind: "number", value: 1, raw: "1" },
            {
              kind: "number",
              value: move.newTx,
              raw: move.newTx.toFixed(3),
            },
            {
              kind: "number",
              value: move.newTy,
              raw: move.newTy.toFixed(3),
            },
          ],
        });
      }
      const replacement = replaceWithOps.get(i);
      newOps.push(replacement ?? ops[i]);
      const imgMove = insertAfterQ.get(i);
      if (imgMove && ops[i].op === "q") {
        newOps.push({
          op: "cm",
          operands: imgMove.map((v) => ({
            kind: "number" as const,
            value: v,
            raw: v.toFixed(3),
          })),
        });
      }
    }
    if (pageRedactions.length > 0) {
      const usedXObjects = new Set<string>();
      for (const op of newOps) {
        if (op.op !== "Do") continue;
        const name = op.operands[0];
        if (name?.kind === "name") usedXObjects.add(name.value);
      }
      pruneUnusedPageXObjects(page.node, usedXObjects);
    }
    setPageContentBytes(doc.context, page.node, serializeContentStream(newOps));
  }
}

function resolveEditRun(
  runs: TextRun[],
  pageNumber: number,
  edit: Edit,
): TextRun | SourceTextBlock | undefined {
  const direct = runs.find((r) => r.id === edit.runId);
  if (direct) return direct;
  return buildSourceTextBlocks(runs, pageNumber).find((b) => b.id === edit.runId);
}

function sourceRunsForEdit(runs: TextRun[], run: TextRun | SourceTextBlock, edit: Edit): TextRun[] {
  const ids =
    edit.sourceRunIds && edit.sourceRunIds.length > 0
      ? edit.sourceRunIds
      : "sourceRunIds" in run
        ? run.sourceRunIds
        : [run.id];
  const byId = new Map(runs.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is TextRun => !!r);
}

function lineStepForRuns(runs: TextRun[], scale: number): number | undefined {
  if (runs.length < 2) return undefined;
  const deltas: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    deltas.push(Math.abs(runs[i].baselineY - runs[i - 1].baselineY) / scale);
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function lineLayoutsForRuns(
  sourceRuns: TextRun[],
  run: TextRun | SourceTextBlock,
  scale: number,
): RichTextLineLayoutPdf[] | undefined {
  if (!("lineLayouts" in run) || !run.lineLayouts || run.lineLayouts.length === 0) return undefined;
  const sourceById = new Map(sourceRuns.map((sourceRun) => [sourceRun.id, sourceRun]));
  return run.lineLayouts.map((layout, index) => {
    const sourceRunId = "sourceRunIds" in run ? run.sourceRunIds[index] : undefined;
    const sourceRun = sourceRunId ? sourceById.get(sourceRunId) : sourceRuns[index];
    const baselineOffset = sourceRun ? (sourceRun.baselineY - run.baselineY) / scale : 0;
    return {
      xOffset: layout.left / scale,
      baselineOffset,
      width: layout.width / scale,
      justify: layout.justify,
    };
  });
}

function drawBoxForEdit(
  run: TextRun | SourceTextBlock,
  edit: Edit,
  scale: number,
  runPdfX: number,
  runPdfWidth: number,
  lineLayoutsPdf: RichTextLineLayoutPdf[] | undefined,
): { left: number; width: number } {
  if (lineLayoutsPdf && lineLayoutsPdf.length > 0) return { left: runPdfX, width: runPdfWidth };
  const text = edit.richText?.text ?? edit.newText;
  const isRtl = edit.style?.dir === "rtl" || (edit.style?.dir !== "ltr" && RTL_RE.test(text));
  if (!isRtl) return { left: runPdfX, width: runPdfWidth };
  const widthPadding = Math.max(96, run.height * 6) / scale;
  const width = runPdfWidth + widthPadding;
  return {
    left: runPdfX + runPdfWidth - width,
    width,
  };
}

function isCrossPageEdit(edit: Edit, sourceKey: string, pageIndex: number): boolean {
  if (edit.targetPageIndex === undefined) return false;
  if (edit.targetSourceKey && edit.targetSourceKey !== sourceKey) return true;
  return edit.targetPageIndex !== pageIndex;
}
function isCrossSourceEdit(edit: Edit, sourceKey: string): boolean {
  return edit.targetSourceKey !== undefined && edit.targetSourceKey !== sourceKey;
}
function isCrossPageMove(move: ImageMove, sourceKey: string, pageIndex: number): boolean {
  if (move.targetPageIndex === undefined) return false;
  if (move.targetSourceKey && move.targetSourceKey !== sourceKey) return true;
  return move.targetPageIndex !== pageIndex;
}
