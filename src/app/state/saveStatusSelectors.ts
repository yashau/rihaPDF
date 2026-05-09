import type { Annotation } from "@/domain/annotations";
import { sumMapArrayLengths, sumMapSetSizes, sumMapSizes } from "@/domain/collectionCounts";
import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import type { PageSlot } from "@/domain/slots";
import type { PendingImage, ToolMode } from "@/domain/toolMode";
import type { LoadedSource } from "@/pdf/source/loadSource";
import { annotationArraysEquivalent } from "@/pdf/source/sourceAnnotations";
import type { AppContentSnapshot } from "@/app/state/contentState";

function countAnnotationChanges(
  sources: Map<string, LoadedSource>,
  slots: PageSlot[],
  annotations: Map<string, Annotation[]>,
): number {
  let changes = 0;
  for (const slot of slots) {
    const current = annotations.get(slot.id) ?? [];
    const baseline =
      slot.kind === "page"
        ? (sources.get(slot.sourceKey)?.annotationsByPage[slot.sourcePageIndex] ?? [])
        : [];
    if (!annotationArraysEquivalent(current, baseline)) changes += 1;
  }
  return changes;
}

export function selectTotalChangeCount({
  sources,
  slots,
  content,
}: {
  sources: Map<string, LoadedSource>;
  slots: PageSlot[];
  content: AppContentSnapshot;
}): number {
  const totalEdits = sumMapSizes(content.edits);
  const totalImageMoves = sumMapSizes(content.imageMoves);
  const totalInsertedTexts = sumMapArrayLengths(content.insertedTexts);
  const totalInsertedImages = sumMapArrayLengths(content.insertedImages);
  const totalShapeDeletes = sumMapSetSizes(content.shapeDeletes);
  const totalAnnotationChanges = countAnnotationChanges(sources, slots, content.annotations);
  const totalRedactions = sumMapArrayLengths(content.redactions);
  const totalFormFills = sumMapSizes(content.formValues);

  const primarySource = sources.get(PRIMARY_SOURCE_KEY);
  const primaryPageCount = primarySource?.pages.length ?? 0;
  const slotPrimaryPageCount = slots.reduce(
    (n, s) => n + (s.kind === "page" && s.sourceKey === PRIMARY_SOURCE_KEY ? 1 : 0),
    0,
  );
  const blankSlotCount = slots.reduce((n, s) => n + (s.kind === "blank" ? 1 : 0), 0);
  const externalSlotCount = slots.reduce(
    (n, s) => n + (s.kind === "page" && s.sourceKey !== PRIMARY_SOURCE_KEY ? 1 : 0),
    0,
  );
  const removedSourceCount = Math.max(0, primaryPageCount - slotPrimaryPageCount);
  const primarySourceOrder: number[] = [];
  for (const s of slots) {
    if (s.kind === "page" && s.sourceKey === PRIMARY_SOURCE_KEY) {
      primarySourceOrder.push(s.sourcePageIndex);
    }
  }
  const slotsReordered = primarySourceOrder.some(
    (si, i) => i > 0 && si < primarySourceOrder[i - 1],
  );
  const structuralOpCount =
    removedSourceCount + blankSlotCount + externalSlotCount + (slotsReordered ? 1 : 0);

  return (
    totalEdits +
    totalImageMoves +
    structuralOpCount +
    totalInsertedTexts +
    totalInsertedImages +
    totalShapeDeletes +
    totalAnnotationChanges +
    totalRedactions +
    totalFormFills
  );
}

export function selectSaveDisabled({
  sources,
  busy,
  totalChangeCount,
}: {
  sources: Map<string, LoadedSource>;
  busy: boolean;
  totalChangeCount: number;
}): boolean {
  return sources.size === 0 || busy || totalChangeCount === 0;
}

export function selectToolTip({
  tool,
  pendingImage,
}: {
  tool: ToolMode;
  pendingImage: PendingImage | null;
}): string | null {
  return tool === "addText"
    ? "Tap a page to drop a text box"
    : tool === "addImage" && pendingImage
      ? pendingImage.kind === "signature"
        ? "Tap a page to place the signature"
        : "Tap a page to place the image"
      : tool === "highlight"
        ? "Tap a text run to highlight"
        : tool === "redact"
          ? "Tap a page to drop a redaction (drag corners to resize)"
          : tool === "comment"
            ? "Tap a page to drop a comment"
            : tool === "ink"
              ? "Drag on a page to draw"
              : null;
}
