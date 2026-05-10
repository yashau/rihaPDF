import { PageWithToolbar } from "./PageWithToolbar";
import { bindPageController } from "./pageControllerBinding";
import {
  selectCrossPageImageArrivals,
  selectCrossPageTextArrivals,
  selectRenderableEditsForSlot,
  selectRenderableImageMovesForSlot,
  selectRenderableSelectionForSlot,
} from "@/app/state/pageListSelectors";
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
  // Target-slot derivation lives in selectors so PageList stays focused
  // on binding page models to PageWithToolbar.
  const arrivalsBySlot = selectCrossPageTextArrivals({ slots, sources, edits });
  const imageArrivalsBySlot = selectCrossPageImageArrivals({ slots, sources, imageMoves });
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
      data-print-page-list
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
        const editsForSlot = selectRenderableEditsForSlot(edits.get(slot.id), slots);
        const imageMovesForSlot = selectRenderableImageMovesForSlot(imageMoves.get(slot.id), slots);
        const pageSelection = selectRenderableSelectionForSlot(selection, slot.id);
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
              selection: pageSelection,
            }}
            controller={bindPageController(controller, {
              slotId: slot.id,
              pageIndex: idx,
              sourceKey: pageSourceKey,
            })}
          />
        );
      })}
    </div>
  );
}
