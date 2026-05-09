import { describe, expect, it } from "vitest";
import { PDFDict, PDFName, PDFRawStream, PDFDocument } from "pdf-lib";
import { parseContentStream } from "@/pdf/content/contentStream";
import type { Redaction } from "@/domain/redactions";
import { makeRedactedImageXObject, rectContains } from "@/pdf/save/redactions/images";
import { gcUnreachablePdfObjects } from "@/pdf/save/gc";
import {
  markVectorPaintOpsForRedaction,
  pruneUnusedPageXObjects,
} from "@/pdf/save/redactions/vectors";

function redaction(pdfX: number, pdfY: number, pdfWidth: number, pdfHeight: number): Redaction {
  return {
    id: "r1",
    sourceKey: "source",
    pageIndex: 0,
    pdfX,
    pdfY,
    pdfWidth,
    pdfHeight,
  };
}

function streamBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("redaction image handling", () => {
  it("treats epsilon-level boundary differences as fully covered", () => {
    expect(
      rectContains(redaction(10, 20, 30, 40), {
        pdfX: 10.0005,
        pdfY: 20.0005,
        pdfWidth: 29.999,
        pdfHeight: 39.999,
      }),
    ).toBe(true);
  });

  it("creates a replacement image XObject with overlapped pixels blacked", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const imageDict = doc.context.obj({
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Image"),
      Width: 2,
      Height: 2,
      BitsPerComponent: 8,
      ColorSpace: PDFName.of("DeviceRGB"),
    });
    if (!(imageDict instanceof PDFDict)) throw new Error("failed to build image dict");
    const original = new Uint8Array([10, 11, 12, 20, 21, 22, 30, 31, 32, 40, 41, 42]);
    const imageRef = doc.context.register(PDFRawStream.of(imageDict, original));
    page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: { Im1: imageRef } }));

    const replacementRef = makeRedactedImageXObject(
      doc,
      page.node,
      "Im1",
      [2, 0, 0, 2, 10, 20],
      [redaction(10, 20, 1, 1)],
    );

    expect(replacementRef).not.toBeNull();
    const replacement = doc.context.lookup(replacementRef!);
    expect(replacement).toBeInstanceOf(PDFRawStream);
    const bytes = (replacement as unknown as { contents: Uint8Array }).contents;
    expect(Array.from(bytes)).toEqual([10, 11, 12, 20, 21, 22, 0, 0, 0, 40, 41, 42]);
  });

  it("returns null for masked images so callers can strip the whole draw", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const mask = doc.context.register(doc.context.obj({ Type: PDFName.of("XObject") }));
    const imageDict = doc.context.obj({
      Type: PDFName.of("XObject"),
      Subtype: PDFName.of("Image"),
      Width: 1,
      Height: 1,
      BitsPerComponent: 8,
      ColorSpace: PDFName.of("DeviceGray"),
      SMask: mask,
    });
    if (!(imageDict instanceof PDFDict)) throw new Error("failed to build image dict");
    const imageRef = doc.context.register(PDFRawStream.of(imageDict, new Uint8Array([255])));
    page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: { Im1: imageRef } }));

    expect(
      makeRedactedImageXObject(doc, page.node, "Im1", [1, 0, 0, 1, 0, 0], [redaction(0, 0, 1, 1)]),
    ).toBeNull();
  });
});

describe("redaction vector handling", () => {
  it("marks only overlapping path construction and paint ops for removal", () => {
    const ops = parseContentStream(streamBytes("q 2 w 10 10 30 20 re S Q 100 100 10 10 re f"));
    const indicesToRemove = new Set<number>();

    markVectorPaintOpsForRedaction(ops, [redaction(15, 15, 5, 5)], indicesToRemove);

    expect([...indicesToRemove].sort((a, b) => a - b).map((i) => ops[i].op)).toEqual(["re", "S"]);
  });

  it("applies the graphics-state CTM before testing path bounds", () => {
    const ops = parseContentStream(streamBytes("q 10 0 0 10 50 50 cm 0 0 2 2 re f Q"));
    const indicesToRemove = new Set<number>();

    markVectorPaintOpsForRedaction(ops, [redaction(60, 60, 2, 2)], indicesToRemove);

    expect([...indicesToRemove].sort((a, b) => a - b).map((i) => ops[i].op)).toEqual(["re", "f"]);
  });

  it("prunes unused page XObjects while preserving other resources", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const im1 = doc.context.register(doc.context.obj({ Type: PDFName.of("XObject") }));
    const im2 = doc.context.register(doc.context.obj({ Type: PDFName.of("XObject") }));
    page.node.set(
      PDFName.of("Resources"),
      doc.context.obj({
        Font: { F1: doc.context.obj({ Type: PDFName.of("Font") }) },
        XObject: { Im1: im1, Im2: im2 },
      }),
    );

    pruneUnusedPageXObjects(page.node, new Set(["Im2"]));

    const resources = page.node.lookup(PDFName.of("Resources"));
    expect(resources).toBeInstanceOf(PDFDict);
    const xobjects = (resources as PDFDict).lookup(PDFName.of("XObject"));
    expect(xobjects).toBeInstanceOf(PDFDict);
    expect((xobjects as PDFDict).get(PDFName.of("Im1"))).toBeUndefined();
    expect((xobjects as PDFDict).get(PDFName.of("Im2"))).toBe(im2);
    expect((resources as PDFDict).lookup(PDFName.of("Font"))).toBeInstanceOf(PDFDict);
  });

  it("garbage-collects pruned XObject refs so their streams are not saved", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([100, 100]);
    const im1 = doc.context.register(
      PDFRawStream.of(
        doc.context.obj({ Type: PDFName.of("XObject"), Subtype: PDFName.of("Image") }),
        new Uint8Array(Buffer.from("RECOVERABLE_IMAGE_SECRET")),
      ),
    );
    const im2 = doc.context.register(doc.context.obj({ Type: PDFName.of("XObject") }));
    page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: { Im1: im1, Im2: im2 } }));

    pruneUnusedPageXObjects(page.node, new Set(["Im2"]));
    expect(doc.context.lookup(im1)).toBeInstanceOf(PDFRawStream);

    gcUnreachablePdfObjects(doc);

    expect(doc.context.lookup(im1)).toBeUndefined();
    expect(doc.context.lookup(im2)).toBeDefined();
    const saved = new TextDecoder("latin1").decode(await doc.save());
    expect(saved).not.toContain("RECOVERABLE_IMAGE_SECRET");
  });
});
