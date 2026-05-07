import { describe, expect, test } from "vitest";
import fs from "fs";
import {
  PDFArray,
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  concatTransformationMatrix,
  decodePDFRawStream,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import { applyEditsAndSave } from "../../src/lib/save";
import type { LoadedSource } from "../../src/lib/loadSource";
import { extractPageImages } from "../../src/lib/sourceImages";
import { extractPageShapes } from "../../src/lib/sourceShapes";
import type { Annotation } from "../../src/domain/annotations";
import { FIXTURE } from "../helpers/browser";

const PRIMARY_SOURCE_KEY = "primary";
const FIRST_PAGE_SLOT = {
  id: "slot-page-primary-0",
  kind: "page" as const,
  sourceKey: PRIMARY_SOURCE_KEY,
  sourcePageIndex: 0,
};

function exactArrayBuffer(bytes: Buffer): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function makeSource(fixturePath: string): Promise<LoadedSource> {
  const bytes = exactArrayBuffer(fs.readFileSync(fixturePath));
  return makeSourceFromBytes(bytes, fixturePath);
}

async function makeSourceFromBytes(bytes: ArrayBuffer, filename: string): Promise<LoadedSource> {
  const [doc, glyphsDoc, imagesByPage, shapesByPage] = await Promise.all([
    PDFDocument.load(bytes),
    PDFDocument.load(bytes),
    extractPageImages(bytes.slice(0)),
    extractPageShapes(bytes.slice(0)),
  ]);
  const pages = doc.getPages();
  return {
    sourceKey: PRIMARY_SOURCE_KEY,
    filename,
    bytes,
    glyphsDoc,
    fontShowsByPage: [],
    imagesByPage,
    shapesByPage,
    formFields: [],
    annotationsByPage: pages.map(() => []),
    pages: pages.map((page, i) => ({
      pageNumber: i + 1,
      canvas: null as unknown as HTMLCanvasElement,
      scale: 1,
      pdfWidth: page.getWidth(),
      pdfHeight: page.getHeight(),
      viewWidth: page.getWidth(),
      viewHeight: page.getHeight(),
      textItems: [],
      textRuns: [],
      images: imagesByPage[i] ?? [],
      shapes: shapesByPage[i] ?? [],
    })),
  };
}

async function makeNativeAnnotationSource(): Promise<LoadedSource> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([400, 200]);
  page.drawText("keep", { x: 10, y: 10, size: 10, color: rgb(0, 0, 0) });

  const highlight = ctx.register(
    ctx.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Highlight"),
      Rect: [100, 100, 200, 120],
      QuadPoints: [100, 120, 200, 120, 100, 100, 200, 100],
      C: [1, 0.92, 0.23],
      Contents: PDFString.of("SOURCE_HIGHLIGHT_SECRET"),
    }),
  );
  const ink = ctx.register(
    ctx.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Ink"),
      Rect: [95, 84, 205, 96],
      InkList: [[100, 89, 200, 89]],
      C: [0.93, 0.27, 0.27],
      BS: { Type: PDFName.of("Border"), W: 10, S: PDFName.of("S") },
    }),
  );
  const freeText = ctx.register(
    ctx.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("FreeText"),
      Rect: [100, 95, 220, 130],
      Contents: PDFString.of("SOURCE_COMMENT_SECRET"),
      DA: PDFString.of("/Helv 12 Tf 0 0 0 rg"),
    }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([highlight, ink, freeText]));

  const bytes = uint8ToArrayBuffer(await doc.save());
  return makeSourceFromBytes(bytes, "native-annotations.pdf");
}

async function makeAcroFormSource(): Promise<LoadedSource> {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const page = doc.addPage([400, 200]);
  page.drawText("keep", { x: 10, y: 10, size: 10, color: rgb(0, 0, 0) });

  const appearance = ctx.register(
    PDFRawStream.of(
      ctx.obj({
        Type: PDFName.of("XObject"),
        Subtype: PDFName.of("Form"),
        BBox: [0, 0, 120, 30],
      }),
      new Uint8Array(Buffer.from("FORM_AP_SECRET")),
    ),
  );
  const ap = ctx.obj({ N: appearance });
  const field = ctx.register(
    ctx.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      FT: PDFName.of("Tx"),
      T: PDFString.of("secretField"),
      V: PDFString.of("SOURCE_FORM_SECRET"),
      DV: PDFString.of("SOURCE_FORM_DEFAULT_SECRET"),
      Rect: [100, 95, 220, 130],
      DA: PDFString.of("/Helv 12 Tf 0 0 0 rg"),
      AP: ap,
    }),
  );
  page.node.set(PDFName.of("Annots"), ctx.obj([field]));
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [field] }));

  const bytes = uint8ToArrayBuffer(await doc.save());
  return makeSourceFromBytes(bytes, "acroform-redaction.pdf");
}

async function pageXObjectNames(pdfBytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdfBytes);
  const resources = doc.getPages()[0].node.lookup(PDFName.of("Resources"));
  if (!(resources instanceof PDFDict)) return [];
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return [];
  return xobjects.keys().map((k) => k.decodeText());
}

function readDictNumber(dict: PDFDict, key: string): number {
  const value = dict.lookup(PDFName.of(key));
  if (!value || typeof value !== "object" || !("asNumber" in value)) {
    throw new Error(`missing numeric /${key}`);
  }
  return (value as { asNumber(): number }).asNumber();
}

function readName(value: unknown): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

async function decodedImageStreams(pdfBytes: Uint8Array): Promise<
  Array<{
    name: string;
    width: number;
    height: number;
    colorSpace: string | null;
    bytes: Uint8Array;
  }>
> {
  const doc = await PDFDocument.load(pdfBytes);
  const resources = doc.getPages()[0].node.lookup(PDFName.of("Resources"));
  if (!(resources instanceof PDFDict)) return [];
  const xobjects = resources.lookup(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return [];
  const out = [];
  for (const key of xobjects.keys()) {
    const obj = xobjects.lookup(key);
    if (!(obj instanceof PDFRawStream)) continue;
    if (readName(obj.dict.lookup(PDFName.of("Subtype"))) !== "Image") continue;
    out.push({
      name: key.decodeText(),
      width: readDictNumber(obj.dict, "Width"),
      height: readDictNumber(obj.dict, "Height"),
      colorSpace: readName(obj.dict.lookup(PDFName.of("ColorSpace"))),
      bytes: decodePDFRawStream(obj).decode(),
    });
  }
  return out;
}

async function savedAnnotations(pdfBytes: Uint8Array): Promise<
  Array<{
    subtype: string;
    rect: number[] | null;
    quadPoints: number[] | null;
    inkList: number[][] | null;
  }>
> {
  const doc = await PDFDocument.load(pdfBytes);
  const annots = doc.getPages()[0].node.lookup(PDFName.of("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    if (!(dict instanceof PDFDict)) continue;
    const subtype = readName(dict.lookup(PDFName.of("Subtype")));
    const rect = dict.lookup(PDFName.of("Rect"));
    const quadPoints = dict.lookup(PDFName.of("QuadPoints"));
    const inkObj = dict.lookup(PDFName.of("InkList"));
    let inkList: number[][] | null = null;
    if (inkObj instanceof PDFArray) {
      inkList = [];
      for (let j = 0; j < inkObj.size(); j++) {
        const stroke = inkObj.lookup(j);
        if (stroke instanceof PDFArray) inkList.push(readPdfNumberArray(stroke));
      }
    }
    if (!subtype) continue;
    out.push({
      subtype,
      rect: rect instanceof PDFArray ? readPdfNumberArray(rect) : null,
      quadPoints: quadPoints instanceof PDFArray ? readPdfNumberArray(quadPoints) : null,
      inkList,
    });
  }
  return out;
}

function readPdfNumberArray(arr: PDFArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const value = arr.lookup(i);
    if (value instanceof PDFNumber) out.push(value.asNumber());
  }
  return out;
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
      if (readName(annot.lookup(PDFName.of("Subtype"))) === "Widget") count += 1;
    }
  }
  return count;
}

async function savedAcroFormFieldCount(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return 0;
  const fields = acroForm.lookup(PDFName.of("Fields"));
  return fields instanceof PDFArray ? fields.size() : 0;
}

function getRgbPixel(
  image: { width: number; height: number; colorSpace: string | null; bytes: Uint8Array },
  x: number,
  y: number,
): [number, number, number] {
  expect(image.colorSpace).toBe("DeviceRGB");
  const off = (y * image.width + x) * 3;
  return [image.bytes[off], image.bytes[off + 1], image.bytes[off + 2]];
}

async function makeGradientImageSource(): Promise<LoadedSource> {
  const width = 4;
  const height = 1;
  const raw = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const doc = await PDFDocument.create();
  const imageDict = doc.context.obj({
    Type: PDFName.of("XObject"),
    Subtype: PDFName.of("Image"),
    Width: width,
    Height: height,
    BitsPerComponent: 8,
    ColorSpace: PDFName.of("DeviceRGB"),
  });
  const imageRef = doc.context.register(PDFRawStream.of(imageDict, raw));
  const page = doc.addPage([400, 200]);
  const imageName = (
    page.node as unknown as { newXObject: (tag: string, ref: unknown) => PDFName }
  ).newXObject("Gradient", imageRef);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(200, 0, 0, 50, 100, 100),
    drawObject(imageName),
    popGraphicsState(),
  );
  page.drawText("keep", { x: 10, y: 10, size: 10, color: rgb(0, 0, 0) });
  const bytes = uint8ToArrayBuffer(await doc.save());
  const imagesByPage = await extractPageImages(bytes.slice(0));
  const shapesByPage = await extractPageShapes(bytes.slice(0));
  const glyphsDoc = await PDFDocument.load(bytes);
  return {
    sourceKey: PRIMARY_SOURCE_KEY,
    filename: "gradient-image.pdf",
    bytes,
    glyphsDoc,
    fontShowsByPage: [],
    imagesByPage,
    shapesByPage,
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
        images: imagesByPage[0] ?? [],
        shapes: shapesByPage[0] ?? [],
      },
    ],
  };
}

describe("save redactions for non-text content", () => {
  test("a partial image redaction removes only the covered pixels from the saved image stream", async () => {
    const source = await makeGradientImageSource();
    const target = source.pages[0].images[0];
    expect(target, "gradient fixture should expose one image").toBeTruthy();
    expect(await decodedImageStreams(new Uint8Array(source.bytes))).toHaveLength(1);

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "redact-half-image",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          // The image is 4 pixels stretched to 200pt, so this covers
          // exactly the two rightmost source pixels.
          pdfX: target.pdfX + target.pdfWidth / 2,
          pdfY: target.pdfY,
          pdfWidth: target.pdfWidth / 2,
          pdfHeight: target.pdfHeight,
        },
      ],
    );

    const images = await extractPageImages(uint8ToArrayBuffer(saved));
    expect(images[0], "the partially redacted image should still draw once").toHaveLength(1);

    const streams = await decodedImageStreams(saved);
    expect(streams, "saved page should retain one sanitized image resource").toHaveLength(1);
    const sanitized = streams[0];
    expect(sanitized.width).toBe(4);
    expect(sanitized.height).toBe(1);
    expect(getRgbPixel(sanitized, 0, 0)).toEqual([255, 0, 0]);
    expect(getRgbPixel(sanitized, 1, 0)).toEqual([0, 255, 0]);
    expect(getRgbPixel(sanitized, 2, 0)).toEqual([0, 0, 0]);
    expect(getRgbPixel(sanitized, 3, 0)).toEqual([0, 0, 0]);
  });

  test("a full redaction over an image strips its draw and prunes the image resource", async () => {
    const source = await makeSource(FIXTURE.withImages);
    const target = source.pages[0].images[0];
    expect(target, "fixture should expose an image").toBeTruthy();

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "redact-image",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: target.pdfX,
          pdfY: target.pdfY,
          pdfWidth: target.pdfWidth,
          pdfHeight: target.pdfHeight,
        },
      ],
    );

    const images = await extractPageImages(uint8ToArrayBuffer(saved));
    expect(images[0]).toHaveLength(source.pages[0].images.length - 1);
    expect(await pageXObjectNames(saved)).toHaveLength(source.pages[0].images.length - 1);
  });

  test("a redaction over a vector shape strips the underlying vector operators", async () => {
    const source = await makeSource(FIXTURE.withShapes);
    const rect = source.pages[0].shapes.find((s) => s.pdfWidth > 100 && s.pdfHeight > 20);
    expect(rect, "fixture should expose the filled rectangle shape").toBeTruthy();

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "redact-vector",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: rect!.pdfX,
          pdfY: rect!.pdfY,
          pdfWidth: rect!.pdfWidth,
          pdfHeight: rect!.pdfHeight,
        },
      ],
    );

    const shapes = await extractPageShapes(uint8ToArrayBuffer(saved));
    expect(shapes[0]).toHaveLength(source.pages[0].shapes.length - 1);
  });

  test("a redaction over a highlight annotation clips only the covered quad area", async () => {
    const source = await makeSource(FIXTURE.withImages);
    const annotations: Annotation[] = [
      {
        kind: "highlight",
        id: "highlight-redaction-probe",
        sourceKey: PRIMARY_SOURCE_KEY,
        pageIndex: 0,
        quads: [
          {
            x1: 100,
            y1: 120,
            x2: 200,
            y2: 120,
            x3: 100,
            y3: 100,
            x4: 200,
            y4: 100,
          },
        ],
        color: [1, 0.92, 0.23],
      },
    ];

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      annotations,
      [
        {
          id: "redact-highlight-middle",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: 140,
          pdfY: 90,
          pdfWidth: 20,
          pdfHeight: 40,
        },
      ],
    );

    const highlights = (await savedAnnotations(saved)).filter((a) => a.subtype === "Highlight");
    expect(highlights).toHaveLength(1);
    expect(highlights[0].quadPoints).toHaveLength(16);
    const xs = highlights[0].quadPoints!.filter((_, i) => i % 2 === 0);
    expect(xs.some((x) => x > 140 && x < 160)).toBe(false);
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(200);
  });

  test("a redaction over ink annotation strokes keeps only segments outside the rect", async () => {
    const source = await makeSource(FIXTURE.withImages);
    const annotations: Annotation[] = [
      {
        kind: "ink",
        id: "ink-redaction-probe",
        sourceKey: PRIMARY_SOURCE_KEY,
        pageIndex: 0,
        // Centerline sits just below the redaction, but a 10pt stroke
        // still paints into it. Sanitizing only the centerline would
        // leave visible / recoverable ink over the black rectangle.
        strokes: [
          [
            { x: 100, y: 89 },
            { x: 200, y: 89 },
          ],
        ],
        color: [0.93, 0.27, 0.27],
        thickness: 10,
      },
    ];

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      annotations,
      [
        {
          id: "redact-ink-middle",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: 140,
          pdfY: 90,
          pdfWidth: 20,
          pdfHeight: 20,
        },
      ],
    );

    const inks = (await savedAnnotations(saved)).filter((a) => a.subtype === "Ink");
    expect(inks).toHaveLength(1);
    expect(inks[0].inkList).toEqual([
      [100, 89, 135, 89],
      [165, 89, 200, 89],
    ]);
  });

  test("a redaction over a FreeText annotation removes the text-bearing annotation", async () => {
    const source = await makeSource(FIXTURE.withImages);
    const sentinel = "ANNOTATION_REDACTION_SECRET_17";
    const annotations: Annotation[] = [
      {
        kind: "comment",
        id: "comment-redaction-probe",
        sourceKey: PRIMARY_SOURCE_KEY,
        pageIndex: 0,
        pdfX: 100,
        pdfY: 100,
        pdfWidth: 180,
        pdfHeight: 40,
        color: [1, 0.96, 0.62],
        text: sentinel,
        fontSize: 12,
      },
    ];

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      annotations,
      [
        {
          id: "redact-comment",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: 110,
          pdfY: 95,
          pdfWidth: 40,
          pdfHeight: 50,
        },
      ],
    );

    expect((await savedAnnotations(saved)).filter((a) => a.subtype === "FreeText")).toHaveLength(0);
    const bytes = Buffer.from(saved);
    expect(bytes.indexOf(Buffer.from(sentinel, "utf-8"))).toBe(-1);
    expect(bytes.indexOf(Buffer.from(toUtf16BEHexWithBom(sentinel), "utf-8"))).toBe(-1);
  });

  test("a redaction sanitizes native annotations already present in the source PDF", async () => {
    const source = await makeNativeAnnotationSource();

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "redact-source-annots",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: 140,
          pdfY: 90,
          pdfWidth: 20,
          pdfHeight: 40,
        },
      ],
    );

    const annots = await savedAnnotations(saved);
    const highlights = annots.filter((a) => a.subtype === "Highlight");
    expect(highlights).toHaveLength(1);
    expect(highlights[0].quadPoints).toHaveLength(16);
    const highlightXs = highlights[0].quadPoints!.filter((_, i) => i % 2 === 0);
    expect(highlightXs.some((x) => x > 140 && x < 160)).toBe(false);

    const inks = annots.filter((a) => a.subtype === "Ink");
    expect(inks).toHaveLength(1);
    expect(inks[0].inkList).toEqual([
      [100, 89, 135, 89],
      [165, 89, 200, 89],
    ]);

    expect(annots.filter((a) => a.subtype === "FreeText")).toHaveLength(0);
    const bytes = Buffer.from(saved);
    expect(bytes.indexOf(Buffer.from("SOURCE_COMMENT_SECRET", "utf-8"))).toBe(-1);
    expect(bytes.indexOf(Buffer.from("SOURCE_HIGHLIGHT_SECRET", "utf-8"))).toBe(-1);
  });

  test("a redaction over an AcroForm widget removes field values and appearances", async () => {
    const source = await makeAcroFormSource();

    const saved = await applyEditsAndSave(
      new Map([[PRIMARY_SOURCE_KEY, source]]),
      [FIRST_PAGE_SLOT],
      [],
      [],
      [],
      [],
      [],
      [],
      [
        {
          id: "redact-form-widget",
          sourceKey: PRIMARY_SOURCE_KEY,
          pageIndex: 0,
          pdfX: 110,
          pdfY: 100,
          pdfWidth: 40,
          pdfHeight: 20,
        },
      ],
      [
        {
          sourceKey: PRIMARY_SOURCE_KEY,
          fullName: "secretField",
          value: { kind: "text", value: "FILLED_FORM_SECRET" },
        },
      ],
    );

    expect(await savedWidgetCount(saved)).toBe(0);
    expect(await savedAcroFormFieldCount(saved)).toBe(0);
    const bytes = Buffer.from(saved);
    for (const secret of [
      "SOURCE_FORM_SECRET",
      "SOURCE_FORM_DEFAULT_SECRET",
      "FILLED_FORM_SECRET",
      "FORM_AP_SECRET",
    ]) {
      expect(bytes.indexOf(Buffer.from(secret, "utf-8")), `${secret} should be removed`).toBe(-1);
    }
  });
});

function toUtf16BEHexWithBom(s: string): string {
  const parts = ["feff"];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      parts.push(cp.toString(16).padStart(4, "0"));
    } else {
      const off = cp - 0x10000;
      const hi = 0xd800 + (off >> 10);
      const lo = 0xdc00 + (off & 0x3ff);
      parts.push(hi.toString(16).padStart(4, "0"));
      parts.push(lo.toString(16).padStart(4, "0"));
    }
  }
  return parts.join("");
}
