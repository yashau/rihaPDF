import { useMemo } from "react";
import type { Annotation } from "@/domain/annotations";
import type { FormValue } from "@/domain/formFields";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import type { LoadedSource } from "@/pdf/source/loadSource";
import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import type { Redaction } from "@/domain/redactions";
import type { PageSlot } from "@/domain/slots";
import type { PendingImage, ToolMode } from "@/domain/toolMode";
import { annotationArraysEquivalent } from "@/pdf/source/sourceAnnotations";
import { sumMapArrayLengths, sumMapSetSizes, sumMapSizes } from "@/domain/collectionCounts";
import type { EditValue, ImageMoveValue } from "@/domain/editState";

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

export function useSaveStatus({
  sources,
  slots,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  shapeDeletes,
  annotations,
  redactions,
  formValues,
  busy,
  tool,
  pendingImage,
}: {
  sources: Map<string, LoadedSource>;
  slots: PageSlot[];
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
  busy: boolean;
  tool: ToolMode;
  pendingImage: PendingImage | null;
}) {
  const totalChangeCount = useMemo(() => {
    const totalEdits = sumMapSizes(edits);
    const totalImageMoves = sumMapSizes(imageMoves);
    const totalInsertedTexts = sumMapArrayLengths(insertedTexts);
    const totalInsertedImages = sumMapArrayLengths(insertedImages);
    const totalShapeDeletes = sumMapSetSizes(shapeDeletes);
    const totalAnnotationChanges = countAnnotationChanges(sources, slots, annotations);
    const totalRedactions = sumMapArrayLengths(redactions);
    const totalFormFills = sumMapSizes(formValues);

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
  }, [
    annotations,
    edits,
    formValues,
    imageMoves,
    insertedImages,
    insertedTexts,
    redactions,
    shapeDeletes,
    slots,
    sources,
  ]);

  const saveDisabled = sources.size === 0 || busy || totalChangeCount === 0;
  const toolTip =
    tool === "addText"
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

  return { totalChangeCount, saveDisabled, toolTip };
}
