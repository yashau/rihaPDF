import { PageWithToolbar } from "./PageWithToolbar";
import type {
  CrossPageArrival,
  CrossPageImageArrival,
  EditValue,
  ImageMoveValue,
} from "@/domain/editState";
import type { FormValue } from "@/domain/formFields";
import { blankSourceKey } from "@/domain/blankSource";
import { blankRenderedPage } from "@/pdf/render/blankPage";
import type { RenderedPage } from "@/pdf/render/pdf";
import type {
  PageListContentReadModel,
  PageListController,
  PageListDocumentReadModel,
  PageListSelectionReadModel,
  PageListToolReadModel,
  PageViewReadModel,
} from "./pageViewModels";

export function PageList({
  document,
  content,
  toolState,
  selectionModel,
  controller,
}: {
  document: PageListDocumentReadModel;
  content: PageListContentReadModel;
  toolState: PageListToolReadModel;
  selectionModel: PageListSelectionReadModel;
  controller: PageListController;
}) {
  const { slots, sources, previewCanvases, renderScale, documentZoom } = document;
  const {
    edits,
    imageMoves,
    insertedTexts,
    insertedImages,
    annotations,
    redactions,
    shapeDeletes,
    editingByPage,
    formValues,
  } = content;
  const { selection } = selectionModel;
  const {
    onEdit,
    onImageMove,
    onEditingChange,
    onCanvasClick,
    onTextInsertChange,
    onTextInsertDelete,
    onImageInsertChange,
    onImageInsertDelete,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onAnnotationAdd,
    onAnnotationChange,
    onAnnotationDelete,
    onRedactionAdd,
    onRedactionChange,
    onSelectRedaction,
    onSelectHighlight,
    onSelectInk,
    onDeleteSelection,
    onFormFieldChange,
  } = controller;
  // Group cross-page-targeted edits by their target slot so each
  // slot's PdfPage can render the runs that have ARRIVED on it
  // from elsewhere. Without this, the source-side preview-strip
  // pipeline removes the original glyphs from the source canvas
  // but no rendering happens on the target page — the run
  // visually disappears until save. We resolve the source run
  // here (for default styling) so the renderer doesn't have to
  // walk the slots/sources maps every frame.
  const arrivalsBySlot = new Map<string, CrossPageArrival[]>();
  for (const [sourceSlotId, runs] of edits) {
    const sourceSlot = slots.find((s) => s.id === sourceSlotId);
    if (!sourceSlot || sourceSlot.kind !== "page") continue;
    const sourceSrc = sources.get(sourceSlot.sourceKey);
    const sourcePage = sourceSrc?.pages[sourceSlot.sourcePageIndex];
    if (!sourcePage) continue;
    for (const [runId, edit] of runs) {
      if (!edit.targetSlotId || edit.deleted) continue;
      if (edit.targetPdfX === undefined || edit.targetPdfY === undefined) continue;
      const sourceRun = sourcePage.textRuns.find((r) => r.id === runId);
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
        // run.height is in source-page viewport pixels;
        // dividing by source's scale yields PDF points.
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
  // Same idea for cross-page-targeted IMAGE moves. Source-side strip
  // pulls the image's pixels off the source canvas; without a target
  // render the user just sees an empty hole until they save.
  const imageArrivalsBySlot = new Map<string, CrossPageImageArrival[]>();
  for (const [sourceSlotId, imgs] of imageMoves) {
    const sourceSlot = slots.find((s) => s.id === sourceSlotId);
    if (!sourceSlot || sourceSlot.kind !== "page") continue;
    const sourceSrc = sources.get(sourceSlot.sourceKey);
    const sourcePage = sourceSrc?.pages[sourceSlot.sourcePageIndex];
    if (!sourcePage) continue;
    for (const [imageId, mv] of imgs) {
      if (!mv.targetSlotId || mv.deleted) continue;
      if (
        mv.targetPdfX === undefined ||
        mv.targetPdfY === undefined ||
        mv.targetPdfWidth === undefined ||
        mv.targetPdfHeight === undefined
      ) {
        continue;
      }
      const sourceImg = sourcePage.images.find((i) => i.id === imageId);
      if (!sourceImg) continue;
      // Crop region on the source canvas, in source-page natural px.
      const sourceLeft = sourceImg.pdfX * sourcePage.scale;
      const sourceTop =
        sourcePage.viewHeight - (sourceImg.pdfY + sourceImg.pdfHeight) * sourcePage.scale;
      const sourceWidth = sourceImg.pdfWidth * sourcePage.scale;
      const sourceHeight = sourceImg.pdfHeight * sourcePage.scale;
      const arr = imageArrivalsBySlot.get(mv.targetSlotId) ?? [];
      arr.push({
        key: `${sourceSlotId}::${imageId}`,
        sourceSlotId,
        imageId,
        move: mv,
        sourceCanvas: sourcePage.canvas,
        sourceLeft,
        sourceTop,
        sourceWidth,
        sourceHeight,
        targetPdfX: mv.targetPdfX,
        targetPdfY: mv.targetPdfY,
        targetPdfWidth: mv.targetPdfWidth,
        targetPdfHeight: mv.targetPdfHeight,
      });
      imageArrivalsBySlot.set(mv.targetSlotId, arr);
    }
  }
  return (
    // `w-full` so the flex column has a defined width to
    // constrain `max-width: 100%` on each PdfPage's outer
    // wrapper. Without it, the column auto-sizes to its
    // widest child (= the natural page width on first
    // render), breaking fit-to-width on mobile.
    <div
      className={`flex flex-col gap-6 w-full ${
        documentZoom > 1.001 ? "items-start" : "items-center"
      }`}
    >
      {slots.map((slot, idx) => {
        // Resolve the page object + sourceKey we'll hand to
        // PageWithToolbar. Blank slots get a synthetic RenderedPage
        // backed by a white canvas + a synthetic sourceKey so the
        // rest of the rendering / overlay machinery treats them
        // identically to a real PDF page (clicks place text/image,
        // arrivals from other pages render, annotations attach, etc.).
        let page: RenderedPage;
        let pageSourceKey: string;
        let previewKey: string | null = null;
        let pageFormFields: PageViewReadModel["formFields"] = [];
        if (slot.kind === "blank") {
          page = blankRenderedPage(slot, renderScale);
          pageSourceKey = blankSourceKey(slot.id);
        } else {
          const source = sources.get(slot.sourceKey);
          const resolved = source?.pages[slot.sourcePageIndex];
          if (!source || !resolved) return null;
          page = resolved;
          pageSourceKey = slot.sourceKey;
          previewKey = `${slot.sourceKey}:${slot.sourcePageIndex}`;
          pageFormFields = source.formFields;
        }
        // Per-source fills for this slot's source. Lookup keyed by
        // sourceKey so external-PDF form fills stay isolated from the
        // primary's fills — exactly the same isolation `imagesByPage`
        // / `pages` get from being scoped to a LoadedSource.
        const slotFormValues = formValues.get(pageSourceKey) ?? new Map<string, FormValue>();
        // Re-derive cross-page targetPageIndex from the stable
        // targetSlotId so reorder doesn't strand overlays.
        const slotIndexById = (id: string | undefined) => {
          if (!id) return -1;
          return slots.findIndex((s) => s.id === id);
        };
        const editsForSlot = new Map<string, EditValue>();
        const storedEdits = edits.get(slot.id);
        if (storedEdits) {
          for (const [runId, v] of storedEdits) {
            if (v.targetSlotId) {
              const i = slotIndexById(v.targetSlotId);
              if (i >= 0) {
                editsForSlot.set(runId, {
                  ...v,
                  targetPageIndex: i,
                  targetSlotId: undefined,
                });
              } else {
                editsForSlot.set(runId, {
                  ...v,
                  targetPageIndex: undefined,
                  targetSourceKey: undefined,
                  targetSlotId: undefined,
                  targetPdfX: undefined,
                  targetPdfY: undefined,
                });
              }
            } else {
              editsForSlot.set(runId, v);
            }
          }
        }
        const imageMovesForSlot = new Map<string, ImageMoveValue>();
        const storedMoves = imageMoves.get(slot.id);
        if (storedMoves) {
          for (const [imageId, v] of storedMoves) {
            if (v.targetSlotId) {
              const i = slotIndexById(v.targetSlotId);
              if (i >= 0) {
                imageMovesForSlot.set(imageId, {
                  ...v,
                  targetPageIndex: i,
                  targetSlotId: undefined,
                });
              } else {
                imageMovesForSlot.set(imageId, {
                  ...v,
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
              imageMovesForSlot.set(imageId, v);
            }
          }
        }
        const selectedImageId =
          selection?.kind === "image" && selection.slotId === slot.id ? selection.imageId : null;
        const selectedInsertedImageId =
          selection?.kind === "insertedImage" && selection.slotId === slot.id ? selection.id : null;
        const selectedShapeId =
          selection?.kind === "shape" && selection.slotId === slot.id ? selection.shapeId : null;
        const selectedRedactionId =
          selection?.kind === "redaction" && selection.slotId === slot.id ? selection.id : null;
        const selectedHighlightId =
          selection?.kind === "highlight" && selection.slotId === slot.id ? selection.id : null;
        const selectedInkId =
          selection?.kind === "ink" && selection.slotId === slot.id ? selection.id : null;
        const deletedShapeIds = shapeDeletes.get(slot.id) ?? new Set<string>();
        return (
          <PageWithToolbar
            key={slot.id}
            model={{
              view: {
                slotId: slot.id,
                page,
                pageIndex: idx,
                sourceKey: pageSourceKey,
                previewCanvas: previewKey ? (previewCanvases.get(previewKey) ?? null) : null,
                documentZoom,
                formFields: pageFormFields,
                formValues: slotFormValues,
              },
              content: {
                edits: editsForSlot,
                imageMoves: imageMovesForSlot,
                insertedTexts: insertedTexts.get(slot.id) ?? [],
                insertedImages: insertedImages.get(slot.id) ?? [],
                annotations: annotations.get(slot.id) ?? [],
                redactions: redactions.get(slot.id) ?? [],
                editingId: editingByPage.get(slot.id) ?? null,
                deletedShapeIds,
                crossPageArrivals: arrivalsBySlot.get(slot.id) ?? [],
                crossPageImageArrivals: imageArrivalsBySlot.get(slot.id) ?? [],
              },
              toolState,
              selection: {
                selectedImageId,
                selectedInsertedImageId,
                selectedShapeId,
                selectedRedactionId,
                selectedHighlightId,
                selectedInkId,
              },
            }}
            controller={{
              onEdit: (runId, value) => onEdit(slot.id, runId, value),
              onImageMove: (imageId, value) => onImageMove(slot.id, imageId, value),
              onEditingChange: (runId) => onEditingChange(slot.id, runId),
              onCanvasClick: (pdfX, pdfY) => onCanvasClick(slot.id, idx, pdfX, pdfY),
              onTextInsertChange: (id, patch) => onTextInsertChange(slot.id, id, patch),
              onTextInsertDelete: (id) => onTextInsertDelete(slot.id, id),
              onImageInsertChange: (id, patch) => onImageInsertChange(slot.id, id, patch),
              onImageInsertDelete: (id) => onImageInsertDelete(slot.id, id),
              onSelectImage: (imageId) => onSelectImage(slot.id, imageId),
              onSelectInsertedImage: (id) => onSelectInsertedImage(slot.id, id),
              onSelectShape: (shapeId) => onSelectShape(slot.id, shapeId),
              onAnnotationAdd: (a) => onAnnotationAdd(slot.id, a),
              onAnnotationChange: (id, patch) => onAnnotationChange(slot.id, id, patch),
              onAnnotationDelete: (id) => onAnnotationDelete(slot.id, id),
              onRedactionAdd: (r) => onRedactionAdd(slot.id, r),
              onRedactionChange: (id, patch) => onRedactionChange(slot.id, id, patch),
              onSelectRedaction: (id) => onSelectRedaction(slot.id, id),
              onSelectHighlight: (id) => onSelectHighlight(slot.id, id),
              onSelectInk: (id) => onSelectInk(slot.id, id),
              onDeleteSelection,
              onSourceEdit: onEdit,
              onSourceImageMove: onImageMove,
              onFormFieldChange: (fullName, value) =>
                onFormFieldChange(pageSourceKey, fullName, value),
            }}
          />
        );
      })}
    </div>
  );
}
