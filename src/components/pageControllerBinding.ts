import type { PageController, PageListController } from "./pageViewModels";

export type PageControllerBindingTarget = {
  slotId: string;
  pageIndex: number;
  sourceKey: string;
};

export function bindPageController(
  controller: PageListController,
  { slotId, pageIndex, sourceKey }: PageControllerBindingTarget,
): PageController {
  return {
    onEdit: (runId, value) => controller.onEdit(slotId, runId, value),
    onImageMove: (imageId, value) => controller.onImageMove(slotId, imageId, value),
    onEditingChange: (runId) => controller.onEditingChange(slotId, runId),
    onCanvasClick: (pdfX, pdfY) => controller.onCanvasClick(slotId, pageIndex, pdfX, pdfY),
    onTextInsertChange: (id, patch) => controller.onTextInsertChange(slotId, id, patch),
    onTextInsertDelete: (id) => controller.onTextInsertDelete(slotId, id),
    onImageInsertChange: (id, patch) => controller.onImageInsertChange(slotId, id, patch),
    onImageInsertDelete: (id) => controller.onImageInsertDelete(slotId, id),
    onSelectImage: (imageId) => controller.onSelectImage(slotId, imageId),
    onSelectInsertedImage: (id) => controller.onSelectInsertedImage(slotId, id),
    onSelectShape: (shapeId) => controller.onSelectShape(slotId, shapeId),
    onAnnotationAdd: (annotation) => controller.onAnnotationAdd(slotId, annotation),
    onAnnotationChange: (id, patch) => controller.onAnnotationChange(slotId, id, patch),
    onAnnotationDelete: (id) => controller.onAnnotationDelete(slotId, id),
    onRedactionAdd: (redaction) => controller.onRedactionAdd(slotId, redaction),
    onRedactionChange: (id, patch) => controller.onRedactionChange(slotId, id, patch),
    onSelectRedaction: (id) => controller.onSelectRedaction(slotId, id),
    onSelectHighlight: (id) => controller.onSelectHighlight(slotId, id),
    onSelectInk: (id) => controller.onSelectInk(slotId, id),
    onDeleteSelection: controller.onDeleteSelection,
    onSourceEdit: controller.onEdit,
    onSourceImageMove: controller.onImageMove,
    onFormFieldChange: (fullName, value) =>
      controller.onFormFieldChange(sourceKey, fullName, value),
  };
}
