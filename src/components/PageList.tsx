import { PageWithToolbar } from "./PageWithToolbar";
import type { EditValue, ImageMoveValue } from "./PdfPage";
import type { Annotation } from "../lib/annotations";
import type { ImageInsertion, TextInsertion } from "../lib/insertions";
import type { LoadedSource } from "../lib/loadSource";
import type { PageSlot } from "../lib/slots";
import type { ToolMode } from "../App";

export type Selection =
  | { kind: "image"; slotId: string; imageId: string }
  | { kind: "insertedImage"; slotId: string; id: string }
  | { kind: "shape"; slotId: string; shapeId: string }
  | null;

export function PageList({
  slots,
  sources,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  annotations,
  shapeDeletes,
  previewCanvases,
  editingByPage,
  tool,
  selection,
  renderScale,
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
}: {
  slots: PageSlot[];
  sources: Map<string, LoadedSource>;
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  annotations: Map<string, Annotation[]>;
  shapeDeletes: Map<string, Set<string>>;
  previewCanvases: Map<string, HTMLCanvasElement>;
  editingByPage: Map<string, string>;
  tool: ToolMode;
  selection: Selection;
  renderScale: number;
  onEdit: (slotId: string, runId: string, value: EditValue) => void;
  onImageMove: (slotId: string, imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (slotId: string, runId: string | null) => void;
  onCanvasClick: (slotId: string, pageIndex: number, pdfX: number, pdfY: number) => void;
  onTextInsertChange: (slotId: string, id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (slotId: string, id: string) => void;
  onImageInsertChange: (slotId: string, id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (slotId: string, id: string) => void;
  onSelectImage: (slotId: string, imageId: string) => void;
  onSelectInsertedImage: (slotId: string, id: string) => void;
  onSelectShape: (slotId: string, shapeId: string) => void;
  onAnnotationAdd: (slotId: string, annotation: Annotation) => void;
  onAnnotationChange: (slotId: string, id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (slotId: string, id: string) => void;
}) {
  return (
    // `w-full` so the flex column has a defined width to
    // constrain `max-width: 100%` on each PdfPage's outer
    // wrapper. Without it, the column auto-sizes to its
    // widest child (= the natural page width on first
    // render), breaking fit-to-width on mobile.
    <div className="flex flex-col items-center gap-6 w-full">
      {slots.map((slot, idx) => {
        if (slot.kind === "blank") {
          return (
            <div
              key={slot.id}
              id={`page-slot-${slot.id}`}
              className="bg-white dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded shadow-sm flex items-center justify-center text-zinc-300 dark:text-zinc-500 text-sm scroll-mt-6"
              style={{
                width: slot.size[0] * renderScale,
                height: slot.size[1] * renderScale,
              }}
            >
              (blank)
            </div>
          );
        }
        const source = sources.get(slot.sourceKey);
        const page = source?.pages[slot.sourcePageIndex];
        if (!source || !page) return null;
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
        const deletedShapeIds = shapeDeletes.get(slot.id) ?? new Set<string>();
        return (
          <PageWithToolbar
            key={slot.id}
            slotId={slot.id}
            page={page}
            pageIndex={idx}
            sourceKey={slot.sourceKey}
            edits={editsForSlot}
            imageMoves={imageMovesForSlot}
            insertedTexts={insertedTexts.get(slot.id) ?? []}
            insertedImages={insertedImages.get(slot.id) ?? []}
            annotations={annotations.get(slot.id) ?? []}
            previewCanvas={previewCanvases.get(`${slot.sourceKey}:${slot.sourcePageIndex}`) ?? null}
            tool={tool}
            editingId={editingByPage.get(slot.id) ?? null}
            selectedImageId={selectedImageId}
            selectedInsertedImageId={selectedInsertedImageId}
            selectedShapeId={selectedShapeId}
            deletedShapeIds={deletedShapeIds}
            onEdit={(runId, value) => onEdit(slot.id, runId, value)}
            onImageMove={(imageId, value) => onImageMove(slot.id, imageId, value)}
            onEditingChange={(runId) => onEditingChange(slot.id, runId)}
            onCanvasClick={(pdfX, pdfY) => onCanvasClick(slot.id, idx, pdfX, pdfY)}
            onTextInsertChange={(id, patch) => onTextInsertChange(slot.id, id, patch)}
            onTextInsertDelete={(id) => onTextInsertDelete(slot.id, id)}
            onImageInsertChange={(id, patch) => onImageInsertChange(slot.id, id, patch)}
            onImageInsertDelete={(id) => onImageInsertDelete(slot.id, id)}
            onSelectImage={(imageId) => onSelectImage(slot.id, imageId)}
            onSelectInsertedImage={(id) => onSelectInsertedImage(slot.id, id)}
            onSelectShape={(shapeId) => onSelectShape(slot.id, shapeId)}
            onAnnotationAdd={(a) => onAnnotationAdd(slot.id, a)}
            onAnnotationChange={(id, patch) => onAnnotationChange(slot.id, id, patch)}
            onAnnotationDelete={(id) => onAnnotationDelete(slot.id, id)}
          />
        );
      })}
    </div>
  );
}
