import type {
  CrossPageArrival,
  CrossPageImageArrival,
  EditValue,
  ImageMoveValue,
} from "@/domain/editState";
import type { Selection } from "@/domain/selection";
import type { PageSlot } from "@/domain/slots";
import type { LoadedSource } from "@/pdf/source/loadSource";

export type RenderablePageSelection = {
  selectedImageId: string | null;
  selectedInsertedImageId: string | null;
  selectedShapeId: string | null;
  selectedRedactionId: string | null;
  selectedHighlightId: string | null;
  selectedInkId: string | null;
};

const emptyRenderableSelection: RenderablePageSelection = {
  selectedImageId: null,
  selectedInsertedImageId: null,
  selectedShapeId: null,
  selectedRedactionId: null,
  selectedHighlightId: null,
  selectedInkId: null,
};

export function selectRenderableSelectionForSlot(
  selection: Selection,
  slotId: string,
): RenderablePageSelection {
  if (!selection || selection.slotId !== slotId) return { ...emptyRenderableSelection };

  switch (selection.kind) {
    case "image":
      return { ...emptyRenderableSelection, selectedImageId: selection.imageId };
    case "insertedImage":
      return { ...emptyRenderableSelection, selectedInsertedImageId: selection.id };
    case "shape":
      return { ...emptyRenderableSelection, selectedShapeId: selection.shapeId };
    case "redaction":
      return { ...emptyRenderableSelection, selectedRedactionId: selection.id };
    case "highlight":
      return { ...emptyRenderableSelection, selectedHighlightId: selection.id };
    case "ink":
      return { ...emptyRenderableSelection, selectedInkId: selection.id };
  }
}

export function selectCrossPageTextArrivals({
  slots,
  sources,
  edits,
}: {
  slots: readonly PageSlot[];
  sources: Map<string, LoadedSource>;
  edits: Map<string, Map<string, EditValue>>;
}): Map<string, CrossPageArrival[]> {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const arrivalsBySlot = new Map<string, CrossPageArrival[]>();

  for (const [sourceSlotId, runs] of edits) {
    const sourceSlot = slotById.get(sourceSlotId);
    if (!sourceSlot || sourceSlot.kind !== "page") continue;

    const sourceSrc = sources.get(sourceSlot.sourceKey);
    const sourcePage = sourceSrc?.pages[sourceSlot.sourcePageIndex];
    if (!sourcePage) continue;

    for (const [runId, edit] of runs) {
      if (!edit.targetSlotId || edit.deleted) continue;
      if (edit.targetPdfX === undefined || edit.targetPdfY === undefined) continue;

      const sourceRun = sourcePage.textRuns.find((run) => run.id === runId);
      if (!sourceRun) continue;

      const style = edit.style ?? {};
      const arr = arrivalsBySlot.get(edit.targetSlotId) ?? [];
      arr.push({
        key: `${sourceSlotId}::${runId}`,
        sourceSlotId,
        runId,
        edit,
        text: edit.text,
        targetPdfX: edit.targetPdfX,
        targetPdfY: edit.targetPdfY,
        // run.height is in source-page viewport pixels; dividing by
        // source's scale yields PDF points.
        fontSizePdfPoints: style.fontSize ?? sourceRun.height / sourcePage.scale,
        fontFamily: style.fontFamily ?? sourceRun.fontFamily,
        bold: style.bold ?? sourceRun.bold,
        italic: style.italic ?? sourceRun.italic,
        underline: style.underline ?? sourceRun.underline ?? false,
        strikethrough: style.strikethrough ?? sourceRun.strikethrough ?? false,
        dir: style.dir,
        textAlign: edit.textAlign,
        color: style.color,
      });
      arrivalsBySlot.set(edit.targetSlotId, arr);
    }
  }

  return arrivalsBySlot;
}

export function selectCrossPageImageArrivals({
  slots,
  sources,
  imageMoves,
}: {
  slots: readonly PageSlot[];
  sources: Map<string, LoadedSource>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
}): Map<string, CrossPageImageArrival[]> {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const imageArrivalsBySlot = new Map<string, CrossPageImageArrival[]>();

  for (const [sourceSlotId, imgs] of imageMoves) {
    const sourceSlot = slotById.get(sourceSlotId);
    if (!sourceSlot || sourceSlot.kind !== "page") continue;

    const sourceSrc = sources.get(sourceSlot.sourceKey);
    const sourcePage = sourceSrc?.pages[sourceSlot.sourcePageIndex];
    if (!sourcePage) continue;

    for (const [imageId, move] of imgs) {
      if (!move.targetSlotId || move.deleted) continue;
      if (
        move.targetPdfX === undefined ||
        move.targetPdfY === undefined ||
        move.targetPdfWidth === undefined ||
        move.targetPdfHeight === undefined
      ) {
        continue;
      }

      const sourceImg = sourcePage.images.find((image) => image.id === imageId);
      if (!sourceImg) continue;

      // Crop region on the source canvas, in source-page natural px.
      const sourceLeft = sourceImg.pdfX * sourcePage.scale;
      const sourceTop =
        sourcePage.viewHeight - (sourceImg.pdfY + sourceImg.pdfHeight) * sourcePage.scale;
      const sourceWidth = sourceImg.pdfWidth * sourcePage.scale;
      const sourceHeight = sourceImg.pdfHeight * sourcePage.scale;
      const arr = imageArrivalsBySlot.get(move.targetSlotId) ?? [];
      arr.push({
        key: `${sourceSlotId}::${imageId}`,
        sourceSlotId,
        imageId,
        move,
        sourceCanvas: sourcePage.canvas,
        sourceLeft,
        sourceTop,
        sourceWidth,
        sourceHeight,
        targetPdfX: move.targetPdfX,
        targetPdfY: move.targetPdfY,
        targetPdfWidth: move.targetPdfWidth,
        targetPdfHeight: move.targetPdfHeight,
      });
      imageArrivalsBySlot.set(move.targetSlotId, arr);
    }
  }

  return imageArrivalsBySlot;
}

export function selectRenderableEditsForSlot(
  storedEdits: Map<string, EditValue> | undefined,
  slots: readonly PageSlot[],
): Map<string, EditValue> {
  const editsForSlot = new Map<string, EditValue>();
  if (!storedEdits) return editsForSlot;

  const slotIndexById = selectSlotIndexById(slots);
  for (const [runId, value] of storedEdits) {
    if (value.targetSlotId) {
      const targetPageIndex = slotIndexById.get(value.targetSlotId);
      if (targetPageIndex !== undefined) {
        editsForSlot.set(runId, {
          ...value,
          targetPageIndex,
          targetSlotId: undefined,
        });
      } else {
        editsForSlot.set(runId, {
          ...value,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetSlotId: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
        });
      }
    } else {
      editsForSlot.set(runId, value);
    }
  }

  return editsForSlot;
}

export function selectRenderableImageMovesForSlot(
  storedMoves: Map<string, ImageMoveValue> | undefined,
  slots: readonly PageSlot[],
): Map<string, ImageMoveValue> {
  const imageMovesForSlot = new Map<string, ImageMoveValue>();
  if (!storedMoves) return imageMovesForSlot;

  const slotIndexById = selectSlotIndexById(slots);
  for (const [imageId, value] of storedMoves) {
    if (value.targetSlotId) {
      const targetPageIndex = slotIndexById.get(value.targetSlotId);
      if (targetPageIndex !== undefined) {
        imageMovesForSlot.set(imageId, {
          ...value,
          targetPageIndex,
          targetSlotId: undefined,
        });
      } else {
        imageMovesForSlot.set(imageId, {
          ...value,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetSlotId: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
          targetPdfWidth: undefined,
          targetPdfHeight: undefined,
        });
      }
    } else {
      imageMovesForSlot.set(imageId, value);
    }
  }

  return imageMovesForSlot;
}

function selectSlotIndexById(slots: readonly PageSlot[]): Map<string, number> {
  return new Map(slots.map((slot, index) => [slot.id, index]));
}
