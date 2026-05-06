import { useMemo } from "react";
import type { Annotation } from "./annotations";
import type { FormValue } from "./formFields";
import type { ImageInsertion, TextInsertion } from "./insertions";
import type { LoadedSource } from "./loadSource";
import { PRIMARY_SOURCE_KEY } from "./sourceKeys";
import type { Redaction } from "./redactions";
import type { PageSlot } from "./slots";
import type { PendingImage, ToolMode } from "./toolMode";
import type { EditValue, ImageMoveValue } from "../components/PdfPage";

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
    const totalEdits = Array.from(edits.values()).reduce((sum, m) => sum + m.size, 0);
    const totalImageMoves = Array.from(imageMoves.values()).reduce((sum, m) => sum + m.size, 0);
    const totalInsertedTexts = Array.from(insertedTexts.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const totalInsertedImages = Array.from(insertedImages.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const totalShapeDeletes = Array.from(shapeDeletes.values()).reduce(
      (sum, set) => sum + set.size,
      0,
    );
    const totalAnnotations = Array.from(annotations.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const totalRedactions = Array.from(redactions.values()).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const totalFormFills = Array.from(formValues.values()).reduce((sum, m) => sum + m.size, 0);

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
      totalAnnotations +
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
            ? "Tap a text run to redact (drag corners to resize)"
            : tool === "comment"
              ? "Tap a page to drop a comment"
              : tool === "ink"
                ? "Drag on a page to draw"
                : null;

  return { totalChangeCount, saveDisabled, toolTip };
}
