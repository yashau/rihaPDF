import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFString, PDFDocument } from "pdf-lib";
import type { Annotation, HighlightAnnotation } from "@/domain/annotations";
import type { Redaction } from "@/domain/redactions";
import {
  applyRedactionsToNewAnnotations,
  applyRedactionsToPageAnnotations,
} from "@/pdf/save/redactions/annotations";

function redaction(
  pdfX: number,
  pdfY: number,
  pdfWidth: number,
  pdfHeight: number,
  pageIndex = 0,
): Redaction {
  return {
    id: "r1",
    sourceKey: "source",
    pageIndex,
    pdfX,
    pdfY,
    pdfWidth,
    pdfHeight,
  };
}

function readNumberArray(arr: PDFArray): number[] {
  const values: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const item = arr.lookup(i);
    if (item instanceof PDFNumber) values.push(item.asNumber());
  }
  return values;
}

describe("new annotation redaction", () => {
  it("splits highlight quads around redacted space and removes comments", () => {
    const highlight: HighlightAnnotation = {
      kind: "highlight",
      id: "h1",
      sourceKey: "source",
      pageIndex: 0,
      color: [1, 1, 0],
      comment: "contains selected text",
      quads: [{ x1: 10, y1: 30, x2: 50, y2: 30, x3: 10, y3: 10, x4: 50, y4: 10 }],
    };

    const [out] = applyRedactionsToNewAnnotations([highlight], [redaction(25, 0, 10, 40)]);

    expect(out.kind).toBe("highlight");
    if (out.kind !== "highlight") return;
    expect(out.comment).toBeUndefined();
    expect(out.quads).toEqual([
      { x1: 10, y1: 30, x2: 25, y2: 30, x3: 10, y3: 10, x4: 25, y4: 10 },
      { x1: 35, y1: 30, x2: 50, y2: 30, x3: 35, y3: 10, x4: 50, y4: 10 },
    ]);
  });

  it("removes overlapping text-bearing annotations and keeps non-overlaps", () => {
    const annotations: Annotation[] = [
      {
        kind: "comment",
        id: "c1",
        sourceKey: "source",
        pageIndex: 0,
        pdfX: 10,
        pdfY: 10,
        pdfWidth: 30,
        pdfHeight: 20,
        color: [1, 1, 0],
        text: "secret",
        fontSize: 12,
      },
      {
        kind: "comment",
        id: "c2",
        sourceKey: "source",
        pageIndex: 0,
        pdfX: 80,
        pdfY: 80,
        pdfWidth: 30,
        pdfHeight: 20,
        color: [1, 1, 0],
        text: "safe",
        fontSize: 12,
      },
    ];

    expect(applyRedactionsToNewAnnotations(annotations, [redaction(15, 15, 10, 10)])).toEqual([
      annotations[1],
    ]);
  });

  it("clips ink strokes and drops fully covered stroke segments", () => {
    const ink: Annotation = {
      kind: "ink",
      id: "i1",
      sourceKey: "source",
      pageIndex: 0,
      color: [1, 0, 0],
      thickness: 0,
      strokes: [
        [
          { x: 0, y: 10 },
          { x: 100, y: 10 },
        ],
      ],
    };

    const [out] = applyRedactionsToNewAnnotations([ink], [redaction(40, 0, 20, 20)]);

    expect(out.kind).toBe("ink");
    if (out.kind !== "ink") return;
    expect(out.strokes).toHaveLength(2);
    expect(out.strokes[0][0]).toEqual({ x: 0, y: 10 });
    expect(out.strokes[0][1].x).toBeCloseTo(40);
    expect(out.strokes[1][0].x).toBeCloseTo(60);
    expect(out.strokes[1][1]).toEqual({ x: 100, y: 10 });
  });
});

describe("native page annotation redaction", () => {
  it("clips native markup QuadPoints and clears recoverable side data", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const popup = doc.context.register(doc.context.obj({ Type: PDFName.of("Annot") }));
    const annot = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Highlight"),
      Rect: [10, 10, 50, 30],
      QuadPoints: [10, 30, 50, 30, 10, 10, 50, 10],
      Contents: PDFString.of("selected secret"),
      AP: { N: doc.context.obj({}) },
      Popup: popup,
    });
    if (!(annot instanceof PDFDict)) throw new Error("failed to build annotation");
    page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));

    applyRedactionsToPageAnnotations(doc, page, [redaction(25, 0, 10, 40)]);

    const annots = page.node.lookup(PDFName.of("Annots"));
    expect(annots).toBeInstanceOf(PDFArray);
    const kept = (annots as PDFArray).lookup(0);
    expect(kept).toBe(annot);
    const quads = annot.lookup(PDFName.of("QuadPoints"));
    expect(quads).toBeInstanceOf(PDFArray);
    expect(readNumberArray(quads as PDFArray)).toEqual([
      10, 30, 25, 30, 10, 10, 25, 10, 35, 30, 50, 30, 35, 10, 50, 10,
    ]);
    expect(annot.get(PDFName.of("Contents"))).toBeUndefined();
    expect(annot.get(PDFName.of("AP"))).toBeUndefined();
    expect(annot.get(PDFName.of("Popup"))).toBeUndefined();
  });

  it("removes overlapping unsupported annotations from the page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const annotRef = doc.context.register(
      doc.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("FreeText"),
        Rect: [10, 10, 50, 30],
        Contents: PDFString.of("secret note"),
      }),
    );
    page.node.set(PDFName.of("Annots"), doc.context.obj([annotRef]));

    applyRedactionsToPageAnnotations(doc, page, [redaction(15, 15, 10, 10)]);

    expect(page.node.lookup(PDFName.of("Annots"))).toBeUndefined();
  });
});
