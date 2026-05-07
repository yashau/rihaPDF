import type { AnnotationColor } from "@/domain/annotations";

export type EditStyle = {
  /** Override of which Dhivehi font to render with. Defaults to the
   *  registry's DEFAULT_FONT_FAMILY (Faruma). */
  fontFamily?: string;
  /** Override of font size in PDF points. Defaults to the original run's
   *  rendered height. */
  fontSize?: number;
  /** Render bold via stroke + fill (simulated since most Dhivehi fonts
   *  don't ship a true bold variant). */
  bold?: boolean;
  /** Italic via shear (simulated for the same reason). */
  italic?: boolean;
  /** Underline drawn as a thin horizontal line under the text. */
  underline?: boolean;
  /** Strikethrough drawn as a thin horizontal line through the text. */
  strikethrough?: boolean;
  /** Explicit text direction. When `undefined` (the default), the
   *  draw / overlay paths auto-detect from the codepoints — Thaana
   *  / Hebrew / Arabic → "rtl", Latin → "ltr". Set explicitly when
   *  auto-detection misclassifies (e.g. an all-digit run that should
   *  render RTL inside a Dhivehi paragraph). */
  dir?: "rtl" | "ltr";
  /** Fill color for the rendered text + decorations, as a 0..1 RGB
   *  triple (same shape as `AnnotationColor`). Undefined renders
   *  black — matches the prior hardcoded behavior so existing edits
   *  with no `color` set save byte-identical to before. */
  color?: AnnotationColor;
};

export type Edit = {
  /** Source the run belongs to. */
  sourceKey: string;
  /** Page index within `sourceKey`'s doc. */
  pageIndex: number;
  runId: string;
  newText: string;
  style?: EditStyle;
  /** Move offset in viewport pixels — translates the new draw position
   *  by (dx / scale, -dy / scale) in PDF user space (y-flipped). */
  dx?: number;
  dy?: number;
  /** Cross-page move target. When set and != (sourceKey, pageIndex),
   *  the run is stripped from origin and re-drawn on the target page
   *  at (targetPdfX, targetPdfY). Same-page moves use dx/dy and leave
   *  these undefined. */
  targetSourceKey?: string;
  targetPageIndex?: number;
  /** Baseline x on the target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Baseline y on the target page in PDF user space (y-up). */
  targetPdfY?: number;
  /** When true, strip the original Tj/TJ ops AND skip the replacement
   *  draw entirely. `newText`, move offsets, and cross-page fields are
   *  ignored — deletion removes the run from the saved PDF. */
  deleted?: boolean;
};

/** Drag + resize offset for an image XObject placement. Save injects a
 *  fresh outermost `cm` right after the image's `q`. dx/dy/dw/dh are
 *  in viewport pixels (same axis convention as ImageMoveValue):
 *    dx > 0 → bottom-left moves right
 *    dy > 0 → bottom-left moves DOWN in viewport (= -dy in PDF y-up)
 *    dw > 0 → wider; dh > 0 → taller
 *  (When dw == dh == 0 the cm reduces to a pure translate, matching
 *  the original move-only behavior.) */
export type ImageMove = {
  sourceKey: string;
  pageIndex: number;
  imageId: string;
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  /** Cross-page move target. When set and != (sourceKey, pageIndex),
   *  the image is stripped from origin (its q…Q block removed) and
   *  re-drawn on the target. When `targetSourceKey === sourceKey` the
   *  cross-page path replicates the XObject ref into the target page
   *  resources; when sources differ the image's pixel bytes are
   *  re-embedded into the target's doc instead. */
  targetSourceKey?: string;
  targetPageIndex?: number;
  /** Bottom-left x on target page in PDF user space (y-up). */
  targetPdfX?: number;
  /** Bottom-left y on target page in PDF user space (y-up). */
  targetPdfY?: number;
  /** Width on target page in PDF user space. */
  targetPdfWidth?: number;
  /** Height on target page in PDF user space. */
  targetPdfHeight?: number;
  /** When true, strip the entire q…Q block of this image's draw and
   *  emit nothing. Move/resize/cross-page fields are ignored. */
  deleted?: boolean;
};

/** Net-new text the user typed at a fresh position on the page. Saved
 *  by appending a draw call to the page's content stream — no
 *  modification of existing ops. */
export type TextInsert = {
  sourceKey: string;
  pageIndex: number;
  /** PDF user-space LEFT edge of the editor's overlay box. For LTR
   *  text this is also the baseline x; for RTL the rendered text is
   *  right-aligned within the `pdfWidth`-wide box, so its baseline x
   *  ends up at `pdfX + pdfWidth - widthPt`. */
  pdfX: number;
  /** PDF user-space baseline y (y-up). */
  pdfY: number;
  /** Width of the editor's overlay box in PDF points. Used for RTL
   *  right-alignment so the saved-PDF glyphs land where the editor
   *  visually right-aligns the typed text. */
  pdfWidth: number;
  fontSize: number;
  text: string;
  style?: EditStyle;
};

/** Net-new image dropped onto the page. */
export type ImageInsert = {
  sourceKey: string;
  pageIndex: number;
  /** Bottom-left in PDF user space (y-up). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  bytes: Uint8Array;
  format: "png" | "jpeg";
};

/** Vector-shape removal — strip the shape's q…Q block from the source
 *  page's content stream so the saved PDF no longer paints it. Only
 *  delete is supported in v1 (no move / resize). */
export type ShapeDelete = {
  sourceKey: string;
  pageIndex: number;
  shapeId: string;
};
