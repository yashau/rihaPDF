import type * as pdfjsLib from "pdfjs-dist";

export type PdfDoc = pdfjsLib.PDFDocumentProxy;
export type PdfPage = pdfjsLib.PDFPageProxy;

export type TextItem = {
  /** Original index into the page's text content array. Stable id for edits. */
  index: number;
  /** Logical-order string as extracted by pdf.js (BiDi-resolved). */
  str: string;
  /**
   * Full 6-element affine in *viewport pixel space*: viewport.transform ∘
   * item.transform. tx,ty are the baseline-left in viewport pixels with
   * y-down. scaleY (= |m[3]|) is the line height in viewport pixels.
   */
  transform: number[];
  /** Width in viewport pixels (already scaled). */
  width: number;
  /** Optional glyph span used only for inter-word gap detection. */
  gapLeft?: number;
  gapRight?: number;
  /** Line height in viewport pixels (= |scaleY|). */
  height: number;
  /** pdf.js font ID (looked up from page.commonObjs / objs). */
  fontName: string;
  /** True for trailing whitespace-only items pdf.js inserts between runs. */
  hasEOL: boolean;
  /** Content-stream Tj/TJ op indices that THIS item carries glyphs from.
   *  Filled in by `applyShowDecodes` so save / preview-strip can map
   *  an item back to the exact ops it owns without position guessing. */
  contentStreamOpIndices?: number[];
  /** Source glyph fragments in viewport pixels, decoded directly from
   *  content-stream text-show bytes and paired with their glyph spans. */
  visualPieces?: Array<{ text: string; left: number; width: number }>;
};

/**
 * A merged group of pdf.js text items that share a line and have no
 * meaningful horizontal gap between them. The unit of edit interaction.
 * Combining marks (zero-width items like Thaana fili) get folded into
 * the run with their base letter so the user edits whole words at a time.
 */
export type TextRun = {
  /** Stable id within page: "p<pageNumber>-r<runIndex>". */
  id: string;
  /** Indices into the source TextItem[] this run was built from. */
  sourceIndices: number[];
  /** Indices of the content-stream Tj/TJ ops painting this run.
   *  Used by save.ts (to delete) + preview.ts (to strip on drag).
   *  Authoritative — replaces fragile position-based matching. */
  contentStreamOpIndices: number[];
  /** Concatenated logical-order text. */
  text: string;
  /** Source-PDF caret candidates in viewport pixels. Each logical
   *  offset can appear more than once at bidi boundaries where the
   *  same insertion point has two visual edges. */
  caretPositions?: Array<{ offset: number; x: number }>;
  /** Source-PDF visual fragments in viewport pixels. These preserve
   *  the rendered order/placement before pdf.js logical text and bidi
   *  normalization collapse the run into an editable string. */
  visualPieces?: Array<{ text: string; left: number; width: number }>;
  /** Source text reconstructed from visual glyph positions. Intended
   *  for display/editing when pdf.js logical text gives poor bidi order. */
  visualText?: string;
  /** Viewport-pixel bounding box (left, top, width, height). */
  bounds: { left: number; top: number; width: number; height: number };
  /** Font height in viewport pixels (= |scaleY|). */
  height: number;
  /** Baseline y in viewport pixels. */
  baselineY: number;
  /** Original font, resolved to one of our registered families (best
   *  effort match against the source PDF's BaseFont name). */
  fontFamily: string;
  /** Original BaseFont string from the source PDF, e.g. "ABCDEF+Faruma".
   *  Kept for diagnostics + future smarter resolution. */
  fontBaseName: string | null;
  /** Detected from the original font's flags / name suffix. */
  bold: boolean;
  italic: boolean;
  /** Source-detected horizontal-line decorations under / through the
   *  run's glyphs. Set by `pairDecorationsWithRuns` during load when a
   *  thin vector q…Q block is geometrically associated with this run.
   *  The matching content-stream op range lives in `decorationOpRanges`
   *  so save can strip it on re-edit. */
  underline?: boolean;
  strikethrough?: boolean;
  /** Op-index ranges of vector q…Q blocks paired with this run as
   *  underline / strikethrough decoration. Stripped together with the
   *  run's Tj/TJ ops on edit so the line never desyncs from the text. */
  decorationOpRanges?: Array<{ qOpIndex: number; QOpIndex: number }>;
};

export type RenderedPage = {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  /** Viewport scale used at render time. */
  scale: number;
  /** PDF user-space dimensions. */
  pdfWidth: number;
  pdfHeight: number;
  /** Viewport pixel dimensions. */
  viewWidth: number;
  viewHeight: number;
  textItems: TextItem[];
  textRuns: TextRun[];
  /** Image / Form XObject placements on this page. Drag-movable. */
  images: import("@/pdf/source/sourceImages").ImageInstance[];
  /** Vector-shape (line / rect / path) blocks on this page. Selectable
   *  + deletable; not movable in v1. */
  shapes: import("@/pdf/source/sourceShapes").ShapeInstance[];
};
