import { useMemo, useRef, useState } from "react";
import type { PageController, PageReadModel } from "../pageViewModels";
import {
  ImageOverlay,
  InsertedImageOverlay,
  InsertedTextOverlay,
  RedactionOverlay,
  ShapeOverlay,
} from "./overlays";
import { AnnotationLayer } from "./AnnotationLayer";
import { CanvasSlot } from "./CanvasSlot";
import { DragPreviews } from "./DragPreviews";
import { FormFieldLayer } from "./FormFieldLayer";
import { PlacementCaptureLayer } from "./PlacementCaptureLayer";
import { CrossPageImageArrivalOverlay, CrossPageTextArrivalOverlay } from "./arrivals";
import { SourceRunOverlay } from "./SourceRunOverlay";
import { buildToolbarBlockers } from "./toolbarBlockers";
import { buildSourceTextBlocks } from "@/pdf/text/textBlocks";
import { usePageFitScale } from "./usePageFitScale";
import { useRunMarkupActions } from "./useRunMarkupActions";
import { useRunDrag } from "./useRunDrag";
import { useImageDrag } from "./useImageDrag";
import type { InitialCaretPoint } from "./types";
type Props = { model: PageReadModel; controller: PageController };

export function PdfPage({ model, controller }: Props) {
  const { view, content, toolState, selection } = model;
  const { page, pageIndex, sourceKey, previewCanvas, documentZoom, formFields, formValues } = view;
  const {
    edits,
    imageMoves,
    insertedTexts,
    insertedImages,
    annotations,
    redactions,
    editingId,
    deletedShapeIds,
    crossPageArrivals,
    crossPageImageArrivals,
  } = content;
  const { tool, inkColor, inkThickness, highlightColor } = toolState;
  const {
    selectedImageId,
    selectedInsertedImageId,
    selectedShapeId,
    selectedRedactionId,
    selectedHighlightId,
    selectedInkId,
  } = selection;
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
    onSourceEdit,
    onSourceImageMove,
    onFormFieldChange,
  } = controller;
  const { fitRef, fitScale } = usePageFitScale(page.viewWidth);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayScale = fitScale * documentZoom;
  const [initialCaret, setInitialCaret] = useState<{
    id: string;
    point: InitialCaretPoint;
  } | null>(null);

  const setEditingId = (next: string | null, initialCaretPoint?: InitialCaretPoint) => {
    setInitialCaret(next && initialCaretPoint ? { id: next, point: initialCaretPoint } : null);
    onEditingChange(next);
  };

  const sourceTextBlocks = useMemo(
    () => buildSourceTextBlocks(page.textRuns, page.pageNumber),
    [page.pageNumber, page.textRuns],
  );
  const editableTextTargets =
    tool === "highlight" || tool === "redact" ? page.textRuns : sourceTextBlocks;

  // Source-run drag gesture (in-place dx/dy + body-portal preview +
  // cross-page commit). `drag` drives the renderer; `startDrag` is
  // wired onto each run overlay's onPointerDown; `justDraggedRef`
  // suppresses the trailing click that would otherwise pop the editor.
  const { drag, startDrag, justDraggedRef } = useRunDrag({
    page,
    pageIndex,
    dragTargets: editableTextTargets,
    edits,
    onEdit,
    containerRef,
    displayScale,
  });
  // Image translate + corner-resize gestures. Both produce the same
  // `imageDrag` state shape (corner === null distinguishes translate);
  // the renderer reads it for live position / size and the body-portal
  // preview during translate gestures.
  const { imageDrag, startImageDrag, startImageResize } = useImageDrag({
    page,
    pageIndex,
    onImageMove,
    containerRef,
    displayScale,
  });

  const { addHighlightForRun, addRedactionForRun } = useRunMarkupActions({
    page,
    sourceKey,
    pageIndex,
    highlightColor,
    onAnnotationAdd,
    onRedactionAdd,
  });
  const toolbarBlockers = buildToolbarBlockers(page, edits, insertedTexts);
  return (
    <div
      ref={fitRef}
      // Outer layout wrapper — reserves displayed-pixel space so the
      // scroll container sizes itself correctly. The natural-size
      // chrome lives in the inner div; CSS transform fits it into the
      // reserved displayed box. `position: relative` anchors the
      // absolutely-positioned inner; `overflow: hidden` clips the
      // inner's natural-size LAYOUT box (CSS transform shrinks
      // visually but doesn't shrink the layout box, so without the
      // clip the page would extend horizontally past its displayed
      // width and produce a phantom right-pan area).
      className="shadow-md"
      style={{
        width: page.viewWidth * displayScale,
        height: page.viewHeight * displayScale,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        className="relative inline-block"
        style={{
          width: page.viewWidth,
          height: page.viewHeight,
          // Absolute-position the inner so its natural-size layout
          // box doesn't push the outer's content box wider than the
          // displayed dimensions. The CSS transform handles the
          // visual fit; absolute positioning keeps the layout in line.
          position: "absolute",
          top: 0,
          left: 0,
          transform: displayScale === 1 ? undefined : `scale(${displayScale})`,
          transformOrigin: "top left",
        }}
        data-page-index={pageIndex}
        data-source-key={sourceKey}
        data-page-scale={page.scale}
        data-view-width={page.viewWidth}
        data-view-height={page.viewHeight}
      >
        <CanvasSlot page={page} previewCanvas={previewCanvas} />
        <PlacementCaptureLayer
          containerRef={containerRef}
          page={page}
          tool={tool}
          onCanvasClick={onCanvasClick}
        />
        <div className="absolute inset-0">
          {/* Source vector-shape overlays render BEFORE runs / images
            so runs and images intercept clicks first when they overlap
            — text under a decorative background still gets edited
            normally. Already-deleted shapes don't render. */}
          {page.shapes.map((shape) => {
            if (deletedShapeIds.has(shape.id)) return null;
            return (
              <ShapeOverlay
                key={shape.id}
                shape={shape}
                page={page}
                isSelected={selectedShapeId === shape.id}
                onSelect={() => onSelectShape(shape.id)}
                onDelete={onDeleteSelection}
              />
            );
          })}
          {/* Per-run + per-image overlays handle their own pointer-events.
            We don't switch the parent off while editing — the EditField's
            onBlur commits the current edit when the user clicks another
            run, so they can hop between edits without first dismissing. */}
          {editableTextTargets.map((run) => (
            <SourceRunOverlay
              key={run.id}
              run={run}
              page={page}
              tool={tool}
              isEditing={editingId === run.id}
              editedValue={edits.get(run.id)}
              previewReady={previewCanvas !== null}
              initialCaretPoint={
                editingId === run.id && initialCaret?.id === run.id ? initialCaret.point : undefined
              }
              drag={drag}
              startDrag={startDrag}
              justDraggedRef={justDraggedRef}
              toolbarBlockers={toolbarBlockers}
              onEdit={onEdit}
              onEditingChange={setEditingId}
              addHighlightForRun={addHighlightForRun}
              addRedactionForRun={addRedactionForRun}
            />
          ))}
          {page.images.map((img) => {
            // A deleted source image hides its overlay so the user can't
            // re-grab it; the preview-strip pipeline already removed
            // it from the canvas.
            const persisted = imageMoves.get(img.id);
            if (persisted?.deleted) return null;
            return (
              <ImageOverlay
                key={img.id}
                img={img}
                page={page}
                persisted={persisted}
                isDragging={imageDrag?.imageId === img.id}
                hideInPlace={
                  imageDrag?.imageId === img.id && imageDrag.corner === null && imageDrag.moved
                }
                isSelected={selectedImageId === img.id}
                liveDx={imageDrag?.imageId === img.id ? imageDrag.dx : null}
                liveDy={imageDrag?.imageId === img.id ? imageDrag.dy : null}
                liveDw={imageDrag?.imageId === img.id ? imageDrag.dw : null}
                liveDh={imageDrag?.imageId === img.id ? imageDrag.dh : null}
                onPointerDown={(e, base) => startImageDrag(img.id, e, base)}
                onResizeStart={(corner, e, base) => startImageResize(img.id, img, corner, e, base)}
                onSelect={() => onSelectImage(img.id)}
                onDelete={onDeleteSelection}
              />
            );
          })}
          {/* Inserted (net-new) text boxes. These render the same way as
            edited runs do — drag to move, click to edit — but the save
            path treats them as fresh content rather than a rewrite. */}
          {insertedTexts.map((ins) => (
            <InsertedTextOverlay
              key={ins.id}
              ins={ins}
              page={page}
              slotIndex={pageIndex}
              displayScale={displayScale}
              toolbarBlockers={toolbarBlockers}
              isEditing={editingId === ins.id}
              initialCaretPoint={
                editingId === ins.id && initialCaret?.id === ins.id ? initialCaret.point : undefined
              }
              onChange={(patch) => onTextInsertChange(ins.id, patch)}
              onDelete={() => {
                if (editingId === ins.id) setEditingId(null);
                onTextInsertDelete(ins.id);
              }}
              onOpen={(point) => setEditingId(ins.id, point)}
              onClose={() => setEditingId(null)}
            />
          ))}
          {/* Inserted images — drag to move, click to select, Del key
            to delete. Double-click is still a deletion shortcut. */}
          {insertedImages.map((ins) => (
            <InsertedImageOverlay
              key={ins.id}
              ins={ins}
              page={page}
              slotIndex={pageIndex}
              displayScale={displayScale}
              isSelected={selectedInsertedImageId === ins.id}
              onChange={(patch) => onImageInsertChange(ins.id, patch)}
              onDelete={() => {
                if (selectedInsertedImageId === ins.id) onDeleteSelection();
                else onImageInsertDelete(ins.id);
              }}
              onSelect={() => onSelectInsertedImage(ins.id)}
            />
          ))}
          {/* Redactions — opaque black rectangles. Preview-only here:
            the underlying glyphs are still in the live canvas; the
            save pipeline strips them at output time. Click to select,
            then drag corners to resize or Del to remove. */}
          {redactions.map((r) => (
            <RedactionOverlay
              key={r.id}
              redaction={r}
              page={page}
              displayScale={displayScale}
              isSelected={selectedRedactionId === r.id}
              onChange={(patch) => onRedactionChange(r.id, patch)}
              onSelect={() => onSelectRedaction(r.id)}
              onDelete={onDeleteSelection}
            />
          ))}
          {/* Cross-page-arrived runs: source-page text the user dragged
            ONTO this slot. The source-side preview-strip removes the
            original glyphs from the source canvas; without these
            spans the run would otherwise vanish entirely until save.
            v1: render-only — to drag again the user has to undo and
            re-do the move. The save pipeline reads `targetSlotId`
            directly, so these spans are purely for live feedback. */}
          {crossPageArrivals.map((arr) => (
            <CrossPageTextArrivalOverlay
              key={arr.key}
              arr={arr}
              page={page}
              displayScale={displayScale}
              onSourceEdit={onSourceEdit}
            />
          ))}
          {/* Cross-page-arrived source images: dropped onto this slot
            from another page. Same rationale as the text arrivals
            above — the source-side preview-strip removed the image's
            pixels from the source canvas, so without this layer it
            would just be a hole until the user saves. */}
          {crossPageImageArrivals.map((arr) => (
            <CrossPageImageArrivalOverlay
              key={arr.key}
              arr={arr}
              page={page}
              onSourceImageMove={onSourceImageMove}
            />
          ))}
          {/* Annotations: highlight rects, sticky-note markers, ink
            strokes. The layer also captures pointer events when the
            ink tool is active. */}
          <AnnotationLayer
            annotations={annotations}
            pageScale={page.scale}
            viewHeight={page.viewHeight}
            displayScale={displayScale}
            pageIndex={pageIndex}
            sourceKey={sourceKey}
            tool={tool}
            inkColor={inkColor}
            inkThickness={inkThickness}
            selectedHighlightId={selectedHighlightId}
            selectedInkId={selectedInkId}
            onAnnotationAdd={onAnnotationAdd}
            onAnnotationChange={onAnnotationChange}
            onAnnotationDelete={onAnnotationDelete}
            onSelectHighlight={onSelectHighlight}
            onSelectInk={onSelectInk}
            onDeleteSelection={onDeleteSelection}
          />
          {/* AcroForm fill overlays. Sits below the placement-mode
              capture layer (which has zIndex: 50) so addText / addImage
              still work over a form widget, but above the source-page
              run/image overlays so a click on a field always hits the
              input. */}
          <FormFieldLayer
            formFields={formFields}
            formValues={formValues}
            pageIndex={pageIndex}
            pageScale={page.scale}
            viewHeight={page.viewHeight}
            onChange={onFormFieldChange}
          />
        </div>
      </div>
      <DragPreviews
        drag={drag}
        imageDrag={imageDrag}
        page={page}
        dragTargets={editableTextTargets}
        edits={edits}
      />
    </div>
  );
}
