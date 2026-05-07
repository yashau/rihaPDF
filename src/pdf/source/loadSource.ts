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
import { loadPdf, renderPage, type RenderedPage } from "@/pdf/render/pdf";
import { extractPageFontShows, type FontShow } from "@/pdf/source/sourceFonts";
import { extractPageGlyphMaps } from "@/pdf/source/glyphMap";
import { extractPageImages } from "@/pdf/source/sourceImages";
import type { ImageInstance } from "@/pdf/source/sourceImages";
import { extractPageShapes } from "@/pdf/source/sourceShapes";
import type { ShapeInstance } from "@/pdf/source/sourceShapes";
import { pairDecorationsWithRuns } from "@/pdf/text/runDecorations";
import { extractFormFields, type FormField } from "@/domain/formFields";
import { extractSourceAnnotations } from "@/pdf/source/sourceAnnotations";
import type { Annotation } from "@/domain/annotations";
export { nextExternalSourceKey, PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";

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
  /** AcroForm fields extracted from `/Root /AcroForm /Fields`. Empty
   *  when the source has no form. Each terminal field carries its
   *  widgets pre-resolved to (pageIndex, /Rect) so FormFieldLayer can
   *  paint overlays without touching the doc again. */
  formFields: FormField[];
  /** Supported native source `/Annots`, bucketed by source page index.
   *  These seed the editable annotation overlay state on load; the save
   *  path removes their original PDF dicts before appending the current
   *  editable values to avoid duplicates. Unsupported annotation
   *  subtypes remain pass-through via copyPages. */
  annotationsByPage: Annotation[][];
};

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
      const rendered = await renderPage(
        page,
        scale,
        fontShowsByPage[i - 1] ?? [],
        glyphMaps,
        imagesByPage[i - 1] ?? [],
        shapesByPage[i - 1] ?? [],
      );
      // Pair thin horizontal q…Q blocks with the runs they decorate
      // (underline / strikethrough). Mutates `rendered.shapes` and the
      // matched runs' `underline` / `strikethrough` / `decorationOpRanges`
      // in place so the editor's toolbar starts in the right state and
      // save can strip the decoration alongside the run on re-edit.
      pairDecorationsWithRuns(rendered);
      pages.push(rendered);
    }
  } finally {
    void doc.destroy();
  }
  const formFields = extractFormFields(glyphsDoc, sourceKey);
  const annotationsByPage = extractSourceAnnotations(glyphsDoc, sourceKey);
  return {
    sourceKey,
    filename: file.name,
    bytes: forSave,
    glyphsDoc,
    fontShowsByPage,
    imagesByPage,
    shapesByPage,
    pages,
    formFields,
    annotationsByPage,
  };
}
