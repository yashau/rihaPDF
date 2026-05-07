import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { rectsOverlap, type PdfRect } from "@/domain/geometry";
import { readPdfRect, readPdfRectArray } from "@/pdf/forms/pdfFormTree";

describe("redaction rectangle geometry", () => {
  it("treats real area intersection as overlap", () => {
    const a: PdfRect = { pdfX: 10, pdfY: 20, pdfWidth: 40, pdfHeight: 30 };
    const b: PdfRect = { pdfX: 45, pdfY: 35, pdfWidth: 20, pdfHeight: 20 };

    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(b, a)).toBe(true);
  });

  it("does not treat edge-only contact as overlap", () => {
    const a: PdfRect = { pdfX: 10, pdfY: 20, pdfWidth: 40, pdfHeight: 30 };
    const touchingRightEdge: PdfRect = { pdfX: 50, pdfY: 20, pdfWidth: 10, pdfHeight: 30 };
    const touchingTopEdge: PdfRect = { pdfX: 10, pdfY: 50, pdfWidth: 40, pdfHeight: 10 };

    expect(rectsOverlap(a, touchingRightEdge)).toBe(false);
    expect(rectsOverlap(a, touchingTopEdge)).toBe(false);
  });
});

describe("PDF form rectangle parsing", () => {
  it("normalizes reversed PDF /Rect coordinates", async () => {
    const doc = await PDFDocument.create();
    const dict = doc.context.obj({ Rect: [100, 200, 50, 180] });

    expect(readPdfRectArray(dict)).toEqual([50, 180, 100, 200]);
    expect(readPdfRect(dict)).toEqual({ pdfX: 50, pdfY: 180, pdfWidth: 50, pdfHeight: 20 });
  });

  it("rejects zero-area rectangles after normalization", async () => {
    const doc = await PDFDocument.create();
    const dict = doc.context.obj({ Rect: [100, 200, 100, 180] });

    expect(readPdfRectArray(dict)).toEqual([100, 180, 100, 200]);
    expect(readPdfRect(dict)).toBeNull();
  });
});
