// Unified loader for any PDF the user opens — primary file OR an
// "insert from PDF" external. Both paths produce the same LoadedSource
// shape so the rest of the app can address pages by (sourceKey,
// pageIndex) without caring whether they came from the primary or an
// external doc.
//
// Extraction is eager: fonts, glyph maps and images are pulled out
// during load. This matches the primary's pre-Phase-1 behaviour and
// keeps every page first-class for editing the moment it appears.

import { PDFDocument } from "pdf-lib";
import { loadPdf, renderPage, type RenderedPage } from "./pdf";
import { extractPageFontShows, type FontShow } from "./sourceFonts";
import { extractPageGlyphMaps } from "./glyphMap";
import { extractPageImages } from "./sourceImages";
import type { ImageInstance } from "./sourceImages";
import { extractPageShapes } from "./sourceShapes";
import type { ShapeInstance } from "./sourceShapes";

export type LoadedSource = {
  /** Stable id used everywhere as the source identity. The primary uses
   *  the fixed sentinel `"primary"`; externals use a content-derived
   *  string from `loadSource`. */
  sourceKey: string;
  filename: string;
  /** Bytes for save's `PDFDocument.load`. Already a fresh copy — the
   *  load helper slices the input ArrayBuffer so the caller can keep
   *  using the original buffer without aliasing concerns. */
  bytes: ArrayBuffer;
  /** pdf-lib doc used by `extractPageGlyphMaps` to recover the missing
   *  CID → Unicode entries the source's `/ToUnicode` CMap drops. */
  glyphsDoc: PDFDocument;
  fontShowsByPage: FontShow[][];
  imagesByPage: ImageInstance[][];
  shapesByPage: ShapeInstance[][];
  /** Per-page pdfjs render + extracted text runs. */
  pages: RenderedPage[];
};

export const PRIMARY_SOURCE_KEY = "primary";

/** Load a PDF file into a fully-extracted `LoadedSource`. Used by both
 *  the primary "Open PDF" flow and the "+ From PDF" external-import
 *  flow — externals are now first-class. */
export async function loadSource(
  file: File,
  scale: number,
  sourceKey: string,
): Promise<LoadedSource> {
  const buf = await file.arrayBuffer();
  const forPdfJs = buf.slice(0);
  const forSave = buf.slice(0);
  const forFonts = buf.slice(0);
  const forGlyphMaps = buf.slice(0);
  const forImages = buf.slice(0);
  const forShapes = buf.slice(0);
  const [doc, fontShowsByPage, glyphsDoc, imagesByPage, shapesByPage] = await Promise.all([
    loadPdf(forPdfJs),
    extractPageFontShows(forFonts),
    PDFDocument.load(forGlyphMaps, { ignoreEncryption: true }),
    extractPageImages(forImages),
    extractPageShapes(forShapes),
  ]);
  const pages: RenderedPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const glyphMaps = extractPageGlyphMaps(glyphsDoc, i - 1);
      pages.push(
        await renderPage(
          page,
          scale,
          fontShowsByPage[i - 1] ?? [],
          glyphMaps,
          imagesByPage[i - 1] ?? [],
          shapesByPage[i - 1] ?? [],
        ),
      );
    }
  } finally {
    void doc.destroy();
  }
  return {
    sourceKey,
    filename: file.name,
    bytes: forSave,
    glyphsDoc,
    fontShowsByPage,
    imagesByPage,
    shapesByPage,
    pages,
  };
}

let externalNonce = 0;
/** Build a stable per-session sourceKey for an external file: name +
 *  size + a monotonic nonce so re-uploading the same file in the same
 *  session always produces a fresh key (no cross-talk if its bytes
 *  drifted between picks). */
export function nextExternalSourceKey(file: File): string {
  externalNonce += 1;
  return `ext:${file.name}:${file.size}:${externalNonce.toString(36)}`;
}
