import { describe, expect, it } from "vitest";
import {
  selectCrossPageImageArrivals,
  selectCrossPageTextArrivals,
  selectRenderableEditsForSlot,
  selectRenderableImageMovesForSlot,
  selectRenderableSelectionForSlot,
} from "@/app/state/pageListSelectors";
import type { EditValue, ImageMoveValue } from "@/domain/editState";
import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import type { PageSlot } from "@/domain/slots";
import type { LoadedSource } from "@/pdf/source/loadSource";

const sourceSlot: PageSlot = {
  id: "slot-source",
  kind: "page",
  sourceKey: PRIMARY_SOURCE_KEY,
  sourcePageIndex: 0,
};
const targetSlot: PageSlot = {
  id: "slot-target",
  kind: "page",
  sourceKey: PRIMARY_SOURCE_KEY,
  sourcePageIndex: 1,
};
const slots = [sourceSlot, targetSlot] satisfies PageSlot[];

function loadedSource(): LoadedSource {
  const canvas = { label: "source-canvas" } as unknown as HTMLCanvasElement;
  return {
    sourceKey: PRIMARY_SOURCE_KEY,
    pages: [
      {
        pageNumber: 1,
        canvas,
        scale: 2,
        pdfWidth: 100,
        pdfHeight: 100,
        viewWidth: 200,
        viewHeight: 200,
        textItems: [],
        textRuns: [
          {
            id: "run-1",
            sourceIndices: [],
            contentStreamOpIndices: [],
            text: "original",
            bounds: { left: 0, top: 0, width: 20, height: 24 },
            height: 24,
            baselineY: 24,
            fontFamily: "Faruma",
            fontBaseName: "ABCDEE+Faruma",
            bold: false,
            italic: true,
            underline: true,
          },
        ],
        images: [
          {
            id: "img-1",
            resourceName: "Im1",
            subtype: "Image",
            doOpIndex: 4,
            qOpIndex: 1,
            cmOpIndex: 2,
            ctm: [30, 0, 0, 40, 10, 20],
            pdfX: 10,
            pdfY: 20,
            pdfWidth: 30,
            pdfHeight: 40,
          },
        ],
        shapes: [],
      },
      {
        pageNumber: 2,
        canvas: { label: "target-canvas" } as unknown as HTMLCanvasElement,
        scale: 2,
        pdfWidth: 100,
        pdfHeight: 100,
        viewWidth: 200,
        viewHeight: 200,
        textItems: [],
        textRuns: [],
        images: [],
        shapes: [],
      },
    ],
  } as unknown as LoadedSource;
}

describe("pageListSelectors", () => {
  it("derives per-slot selection ids from the global selection", () => {
    expect(selectRenderableSelectionForSlot(null, sourceSlot.id)).toEqual({
      selectedImageId: null,
      selectedInsertedImageId: null,
      selectedShapeId: null,
      selectedRedactionId: null,
      selectedHighlightId: null,
      selectedInkId: null,
    });

    expect(
      selectRenderableSelectionForSlot(
        { kind: "image", slotId: sourceSlot.id, imageId: "img-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedImageId: "img-1" });
    expect(
      selectRenderableSelectionForSlot(
        { kind: "insertedImage", slotId: sourceSlot.id, id: "inserted-img-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedInsertedImageId: "inserted-img-1" });
    expect(
      selectRenderableSelectionForSlot(
        { kind: "shape", slotId: sourceSlot.id, shapeId: "shape-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedShapeId: "shape-1" });
    expect(
      selectRenderableSelectionForSlot(
        { kind: "redaction", slotId: sourceSlot.id, id: "redaction-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedRedactionId: "redaction-1" });
    expect(
      selectRenderableSelectionForSlot(
        { kind: "highlight", slotId: sourceSlot.id, id: "highlight-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedHighlightId: "highlight-1" });
    expect(
      selectRenderableSelectionForSlot(
        { kind: "ink", slotId: sourceSlot.id, id: "ink-1" },
        sourceSlot.id,
      ),
    ).toMatchObject({ selectedInkId: "ink-1" });

    expect(
      selectRenderableSelectionForSlot(
        { kind: "image", slotId: targetSlot.id, imageId: "img-1" },
        sourceSlot.id,
      ),
    ).toEqual({
      selectedImageId: null,
      selectedInsertedImageId: null,
      selectedShapeId: null,
      selectedRedactionId: null,
      selectedHighlightId: null,
      selectedInkId: null,
    });
  });

  it("builds text arrivals with source-run style fallbacks", () => {
    const edit: EditValue = {
      text: "moved",
      targetSlotId: targetSlot.id,
      targetPdfX: 50,
      targetPdfY: 60,
      style: { fontFamily: "Arial", bold: true, underline: false, color: [0.1, 0.2, 0.3] },
      textAlign: "center",
    };
    const arrivals = selectCrossPageTextArrivals({
      slots,
      sources: new Map([[PRIMARY_SOURCE_KEY, loadedSource()]]),
      edits: new Map([
        [
          sourceSlot.id,
          new Map([
            ["run-1", edit],
            ["run-missing", { text: "skip", targetSlotId: targetSlot.id, targetPdfX: 1 }],
          ]),
        ],
      ]),
    });

    expect(arrivals.get(targetSlot.id)).toEqual([
      expect.objectContaining({
        key: "slot-source::run-1",
        sourceSlotId: sourceSlot.id,
        runId: "run-1",
        edit,
        text: "moved",
        targetPdfX: 50,
        targetPdfY: 60,
        fontSizePdfPoints: 12,
        fontFamily: "Arial",
        bold: true,
        italic: true,
        underline: false,
        strikethrough: false,
        textAlign: "center",
        color: [0.1, 0.2, 0.3],
      }),
    ]);
  });

  it("builds image arrivals with source-canvas crop geometry", () => {
    const move: ImageMoveValue = {
      targetSlotId: targetSlot.id,
      targetPdfX: 70,
      targetPdfY: 80,
      targetPdfWidth: 30,
      targetPdfHeight: 40,
    };
    const source = loadedSource();
    const arrivals = selectCrossPageImageArrivals({
      slots,
      sources: new Map([[PRIMARY_SOURCE_KEY, source]]),
      imageMoves: new Map([[sourceSlot.id, new Map([["img-1", move]])]]),
    });

    expect(arrivals.get(targetSlot.id)).toEqual([
      expect.objectContaining({
        key: "slot-source::img-1",
        sourceSlotId: sourceSlot.id,
        imageId: "img-1",
        move,
        sourceCanvas: source.pages[0]?.canvas,
        sourceLeft: 20,
        sourceTop: 80,
        sourceWidth: 60,
        sourceHeight: 80,
        targetPdfX: 70,
        targetPdfY: 80,
        targetPdfWidth: 30,
        targetPdfHeight: 40,
      }),
    ]);
  });

  it("derives current target page indexes from stable target slot ids", () => {
    const reorderedSlots = [targetSlot, sourceSlot];

    expect(
      selectRenderableEditsForSlot(
        new Map([
          [
            "run-1",
            {
              text: "moved",
              targetSlotId: targetSlot.id,
              targetSourceKey: PRIMARY_SOURCE_KEY,
              targetPdfX: 1,
              targetPdfY: 2,
            },
          ],
        ]),
        reorderedSlots,
      ).get("run-1"),
    ).toMatchObject({ targetPageIndex: 0, targetSlotId: undefined });

    expect(
      selectRenderableImageMovesForSlot(
        new Map([
          [
            "img-1",
            {
              targetSlotId: targetSlot.id,
              targetSourceKey: PRIMARY_SOURCE_KEY,
              targetPdfX: 1,
              targetPdfY: 2,
              targetPdfWidth: 3,
              targetPdfHeight: 4,
            },
          ],
        ]),
        reorderedSlots,
      ).get("img-1"),
    ).toMatchObject({ targetPageIndex: 0, targetSlotId: undefined });
  });

  it("clears stale cross-page targets when the target slot no longer exists", () => {
    expect(
      selectRenderableEditsForSlot(
        new Map([
          [
            "run-1",
            {
              text: "orphan",
              targetPageIndex: 4,
              targetSlotId: "missing-slot",
              targetSourceKey: PRIMARY_SOURCE_KEY,
              targetPdfX: 1,
              targetPdfY: 2,
            },
          ],
        ]),
        slots,
      ).get("run-1"),
    ).toEqual({
      text: "orphan",
      targetPageIndex: undefined,
      targetSlotId: undefined,
      targetSourceKey: undefined,
      targetPdfX: undefined,
      targetPdfY: undefined,
    });

    expect(
      selectRenderableImageMovesForSlot(
        new Map([
          [
            "img-1",
            {
              targetPageIndex: 4,
              targetSlotId: "missing-slot",
              targetSourceKey: PRIMARY_SOURCE_KEY,
              targetPdfX: 1,
              targetPdfY: 2,
              targetPdfWidth: 3,
              targetPdfHeight: 4,
            },
          ],
        ]),
        slots,
      ).get("img-1"),
    ).toEqual({
      targetPageIndex: undefined,
      targetSlotId: undefined,
      targetSourceKey: undefined,
      targetPdfX: undefined,
      targetPdfY: undefined,
      targetPdfWidth: undefined,
      targetPdfHeight: undefined,
    });
  });
});
