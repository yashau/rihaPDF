import { PdfPage, type EditValue, type ImageMoveValue } from "./PdfPage";
import type { CrossPageArrival, CrossPageImageArrival } from "./PdfPage/types";
import type { Annotation, AnnotationColor } from "../lib/annotations";
import type { ImageInsertion, TextInsertion } from "../lib/insertions";
import type { RenderedPage } from "../lib/pdf";
import type { Redaction } from "../lib/redactions";
import type { ToolMode } from "../App";

export function PageWithToolbar({
  slotId,
  page,
  pageIndex,
  sourceKey,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  annotations,
  redactions,
  previewCanvas,
  tool,
  inkColor,
  inkThickness,
  highlightColor,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  selectedShapeId,
  selectedRedactionId,
  selectedHighlightId,
  deletedShapeIds,
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
  crossPageArrivals,
  crossPageImageArrivals,
  onSourceEdit,
  onSourceImageMove,
}: {
  slotId: string;
  page: RenderedPage;
  pageIndex: number;
  sourceKey: string;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  annotations: Annotation[];
  redactions: Redaction[];
  previewCanvas: HTMLCanvasElement | null;
  tool: ToolMode;
  inkColor: AnnotationColor;
  inkThickness: number;
  highlightColor: AnnotationColor;
  editingId: string | null;
  selectedImageId: string | null;
  selectedInsertedImageId: string | null;
  selectedShapeId: string | null;
  selectedRedactionId: string | null;
  selectedHighlightId: string | null;
  deletedShapeIds: Set<string>;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
  onSelectShape: (shapeId: string) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  onRedactionAdd: (redaction: Redaction) => void;
  onRedactionChange: (id: string, patch: Partial<Redaction>) => void;
  onSelectRedaction: (id: string) => void;
  onSelectHighlight: (id: string) => void;
  crossPageArrivals: CrossPageArrival[];
  crossPageImageArrivals: CrossPageImageArrival[];
  onSourceEdit: (sourceSlotId: string, runId: string, value: EditValue) => void;
  onSourceImageMove: (sourceSlotId: string, imageId: string, value: ImageMoveValue) => void;
}) {
  return (
    <div id={`page-slot-${slotId}`} className="flex flex-col items-center gap-2 scroll-mt-6 w-full">
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Page {pageIndex + 1}</span>
      </div>
      <PdfPage
        page={page}
        pageIndex={pageIndex}
        sourceKey={sourceKey}
        edits={edits}
        imageMoves={imageMoves}
        insertedTexts={insertedTexts}
        insertedImages={insertedImages}
        annotations={annotations}
        redactions={redactions}
        previewCanvas={previewCanvas}
        tool={tool}
        inkColor={inkColor}
        inkThickness={inkThickness}
        highlightColor={highlightColor}
        editingId={editingId}
        selectedImageId={selectedImageId}
        selectedInsertedImageId={selectedInsertedImageId}
        selectedShapeId={selectedShapeId}
        selectedRedactionId={selectedRedactionId}
        selectedHighlightId={selectedHighlightId}
        deletedShapeIds={deletedShapeIds}
        onEdit={onEdit}
        onImageMove={onImageMove}
        onEditingChange={onEditingChange}
        onCanvasClick={onCanvasClick}
        onTextInsertChange={onTextInsertChange}
        onTextInsertDelete={onTextInsertDelete}
        onImageInsertChange={onImageInsertChange}
        onImageInsertDelete={onImageInsertDelete}
        onSelectImage={onSelectImage}
        onSelectInsertedImage={onSelectInsertedImage}
        onSelectShape={onSelectShape}
        onAnnotationAdd={onAnnotationAdd}
        onAnnotationChange={onAnnotationChange}
        onAnnotationDelete={onAnnotationDelete}
        onRedactionAdd={onRedactionAdd}
        onRedactionChange={onRedactionChange}
        onSelectRedaction={onSelectRedaction}
        onSelectHighlight={onSelectHighlight}
        crossPageArrivals={crossPageArrivals}
        crossPageImageArrivals={crossPageImageArrivals}
        onSourceEdit={onSourceEdit}
        onSourceImageMove={onSourceImageMove}
      />
    </div>
  );
}
