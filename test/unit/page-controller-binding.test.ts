import { describe, expect, it, vi } from "vitest";
import { bindPageController } from "@/components/pageControllerBinding";
import type { Annotation } from "@/domain/annotations";
import type { EditValue, ImageMoveValue } from "@/domain/editState";
import type { FormValue } from "@/domain/formFields";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import type { Redaction } from "@/domain/redactions";
import type { PageListController } from "@/components/pageViewModels";

function listController(): PageListController {
  return {
    onEdit: vi.fn(),
    onImageMove: vi.fn(),
    onEditingChange: vi.fn(),
    onCanvasClick: vi.fn(),
    onTextInsertChange: vi.fn(),
    onTextInsertDelete: vi.fn(),
    onImageInsertChange: vi.fn(),
    onImageInsertDelete: vi.fn(),
    onSelectImage: vi.fn(),
    onSelectInsertedImage: vi.fn(),
    onSelectShape: vi.fn(),
    onAnnotationAdd: vi.fn(),
    onAnnotationChange: vi.fn(),
    onAnnotationDelete: vi.fn(),
    onRedactionAdd: vi.fn(),
    onRedactionChange: vi.fn(),
    onSelectRedaction: vi.fn(),
    onSelectHighlight: vi.fn(),
    onSelectInk: vi.fn(),
    onDeleteSelection: vi.fn(),
    onFormFieldChange: vi.fn(),
  };
}

describe("bindPageController", () => {
  it("binds page-scoped callbacks to the current slot", () => {
    const controller = listController();
    const pageController = bindPageController(controller, {
      slotId: "slot-1",
      pageIndex: 3,
      sourceKey: "source-a",
    });
    const edit = { text: "hello" } satisfies EditValue;
    const imageMove = { targetPdfX: 1 } satisfies ImageMoveValue;
    const textPatch = { text: "inserted" } satisfies Partial<TextInsertion>;
    const imagePatch = { pdfX: 10 } satisfies Partial<ImageInsertion>;
    const annotation = { id: "annotation-1" } as Annotation;
    const annotationPatch = { color: [1, 0, 0] } as Partial<Annotation>;
    const redaction = { id: "redaction-1" } as Redaction;
    const redactionPatch = { pdfX: 25 } satisfies Partial<Redaction>;
    const formValue = { kind: "text", value: "field value" } satisfies FormValue;

    pageController.onEdit("run-1", edit);
    pageController.onImageMove("img-1", imageMove);
    pageController.onEditingChange("run-1");
    pageController.onCanvasClick(10, 20);
    pageController.onTextInsertChange("text-1", textPatch);
    pageController.onTextInsertDelete("text-1");
    pageController.onImageInsertChange("inserted-img-1", imagePatch);
    pageController.onImageInsertDelete("inserted-img-1");
    pageController.onSelectImage("img-1");
    pageController.onSelectInsertedImage("inserted-img-1");
    pageController.onSelectShape("shape-1");
    pageController.onAnnotationAdd(annotation);
    pageController.onAnnotationChange("annotation-1", annotationPatch);
    pageController.onAnnotationDelete("annotation-1");
    pageController.onRedactionAdd(redaction);
    pageController.onRedactionChange("redaction-1", redactionPatch);
    pageController.onSelectRedaction("redaction-1");
    pageController.onSelectHighlight("highlight-1");
    pageController.onSelectInk("ink-1");
    pageController.onFormFieldChange("Field.Name", formValue);

    expect(controller.onEdit).toHaveBeenCalledWith("slot-1", "run-1", edit);
    expect(controller.onImageMove).toHaveBeenCalledWith("slot-1", "img-1", imageMove);
    expect(controller.onEditingChange).toHaveBeenCalledWith("slot-1", "run-1");
    expect(controller.onCanvasClick).toHaveBeenCalledWith("slot-1", 3, 10, 20);
    expect(controller.onTextInsertChange).toHaveBeenCalledWith("slot-1", "text-1", textPatch);
    expect(controller.onTextInsertDelete).toHaveBeenCalledWith("slot-1", "text-1");
    expect(controller.onImageInsertChange).toHaveBeenCalledWith(
      "slot-1",
      "inserted-img-1",
      imagePatch,
    );
    expect(controller.onImageInsertDelete).toHaveBeenCalledWith("slot-1", "inserted-img-1");
    expect(controller.onSelectImage).toHaveBeenCalledWith("slot-1", "img-1");
    expect(controller.onSelectInsertedImage).toHaveBeenCalledWith("slot-1", "inserted-img-1");
    expect(controller.onSelectShape).toHaveBeenCalledWith("slot-1", "shape-1");
    expect(controller.onAnnotationAdd).toHaveBeenCalledWith("slot-1", annotation);
    expect(controller.onAnnotationChange).toHaveBeenCalledWith(
      "slot-1",
      "annotation-1",
      annotationPatch,
    );
    expect(controller.onAnnotationDelete).toHaveBeenCalledWith("slot-1", "annotation-1");
    expect(controller.onRedactionAdd).toHaveBeenCalledWith("slot-1", redaction);
    expect(controller.onRedactionChange).toHaveBeenCalledWith(
      "slot-1",
      "redaction-1",
      redactionPatch,
    );
    expect(controller.onSelectRedaction).toHaveBeenCalledWith("slot-1", "redaction-1");
    expect(controller.onSelectHighlight).toHaveBeenCalledWith("slot-1", "highlight-1");
    expect(controller.onSelectInk).toHaveBeenCalledWith("slot-1", "ink-1");
    expect(controller.onFormFieldChange).toHaveBeenCalledWith("source-a", "Field.Name", formValue);
  });

  it("keeps document-scoped callbacks unbound", () => {
    const controller = listController();
    const pageController = bindPageController(controller, {
      slotId: "slot-1",
      pageIndex: 3,
      sourceKey: "source-a",
    });
    const edit = { text: "hello" } satisfies EditValue;
    const imageMove = { targetPdfX: 1 } satisfies ImageMoveValue;

    pageController.onSourceEdit("source-slot", "run-1", edit);
    pageController.onSourceImageMove("source-slot", "img-1", imageMove);
    pageController.onDeleteSelection();

    expect(controller.onEdit).toHaveBeenCalledWith("source-slot", "run-1", edit);
    expect(controller.onImageMove).toHaveBeenCalledWith("source-slot", "img-1", imageMove);
    expect(controller.onDeleteSelection).toHaveBeenCalledOnce();
  });
});
