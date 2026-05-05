import { describe, expect, test } from "vitest";
import fs from "fs";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
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
  const [doc, glyphsDoc, imagesByPage, shapesByPage] = await Promise.all([
    PDFDocument.load(bytes),
    PDFDocument.load(bytes),
    extractPageImages(bytes.slice(0)),
    extractPageShapes(bytes.slice(0)),
  ]);
  const pages = doc.getPages();
  return {
    sourceKey: PRIMARY_SOURCE_KEY,
    filename: fixturePath,
    bytes,
    glyphsDoc,
    fontShowsByPage: [],
    imagesByPage,
    shapesByPage,
    formFields: [],
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
});
