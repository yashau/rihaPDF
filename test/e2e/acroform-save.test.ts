import { describe, expect, test } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFString, rgb } from "pdf-lib";
import { applyEditsAndSave } from "../../src/lib/save";
import type { LoadedSource } from "../../src/pdf/source/loadSource";

const SOURCE_KEY = "fillable";
const FIELD_NAME = "keptField";
const FIELD_VALUE = "ORIGINAL_VALUE";

function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function decodeText(obj: PDFObject | undefined): string | null {
  return obj instanceof PDFString ? obj.decodeText() : null;
}

function partialName(d: PDFDict): string | null {
  return decodeText(d.lookup(PDFName.of("T")));
}

function findFieldByName(catalog: PDFDict, fullName: string): PDFDict | null {
  const acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return null;
  const fields = acroForm.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return null;
  const parts = fullName.split(".");

  function walk(d: PDFDict, idx: number): PDFDict | null {
    const partial = partialName(d);
    let next = idx;
    if (partial !== null) {
      if (partial !== parts[idx]) return null;
      next = idx + 1;
    }
    if (next === parts.length) return d;
    const kids = d.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) return null;
    for (let i = 0; i < kids.size(); i++) {
      const k = kids.lookup(i);
      if (k instanceof PDFDict) {
        const found = walk(k, next);
        if (found) return found;
      }
    }
    return null;
  }

  for (let i = 0; i < fields.size(); i++) {
    const top = fields.lookup(i);
    if (top instanceof PDFDict) {
      const found = walk(top, 0);
      if (found) return found;
    }
  }
  return null;
}

async function makeFillableSource(): Promise<LoadedSource> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([400, 200]);
  page.drawText("keep", { x: 10, y: 10, size: 10, color: rgb(0, 0, 0) });

  const field = ctx.register(
    ctx.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      FT: PDFName.of("Tx"),
      T: PDFString.of(FIELD_NAME),
      V: PDFString.of(FIELD_VALUE),
      Rect: [100, 95, 220, 130],
      DA: PDFString.of("/Helv 12 Tf 0 0 0 rg"),
    }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([field]));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field] }));

  const bytes = uint8ToArrayBuffer(await doc.save());
  const glyphsDoc = await PDFDocument.load(bytes);
  return {
    sourceKey: SOURCE_KEY,
    filename: "fillable-unrelated-save.pdf",
    bytes,
    glyphsDoc,
    fontShowsByPage: [],
    imagesByPage: [[]],
    shapesByPage: [[]],
    formFields: [],
    annotationsByPage: [[]],
    pages: [
      {
        pageNumber: 1,
        canvas: null as unknown as HTMLCanvasElement,
        scale: 1,
        pdfWidth: 400,
        pdfHeight: 200,
        viewWidth: 400,
        viewHeight: 200,
        textItems: [],
        textRuns: [],
        images: [],
        shapes: [],
      },
    ],
  };
}

async function savedWidgetCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  let count = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i);
      if (!(annot instanceof PDFDict)) continue;
      const subtype = annot.lookup(PDFName.of("Subtype"));
      if (subtype instanceof PDFName && subtype.asString() === "/Widget") count += 1;
    }
  }
  return count;
}

describe("AcroForm preservation on save", () => {
  test("unrelated saves rebuild /Root /AcroForm /Fields for copied widgets", async () => {
    const source = await makeFillableSource();
    const saved = await applyEditsAndSave(
      new Map([[SOURCE_KEY, source]]),
      [
        {
          id: "slot-page-fillable-0",
          kind: "page",
          sourceKey: SOURCE_KEY,
          sourcePageIndex: 0,
        },
      ],
      [],
      [],
      [
        {
          sourceKey: SOURCE_KEY,
          pageIndex: 0,
          pdfX: 20,
          pdfY: 60,
          pdfWidth: 120,
          fontSize: 12,
          text: "unrelated edit",
        },
      ],
    );

    expect(await savedWidgetCount(saved)).toBe(1);
    const doc = await PDFDocument.load(saved);
    const field = findFieldByName(doc.catalog, FIELD_NAME);
    expect(field, "copied widget must be reachable through /AcroForm/Fields").not.toBeNull();
    expect(decodeText(field!.lookup(PDFName.of("V")))).toBe(FIELD_VALUE);
  });
});
