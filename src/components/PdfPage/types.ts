import type { EditStyle } from "../../lib/save";

export type InitialCaretPoint = {
  clientX: number;
  clientY: number;
  caretOffset?: number;
};

export type EditValue = {
  text: string;
  style?: EditStyle;
  /** Move offset from the original run position, in viewport pixels
   *  (origin-page-relative). Positive dx → right, positive dy → down.
   *  Used both for SAME-page save (translates drawn text by (dx/scale,
   *  -dy/scale) in PDF user space) and for rendering the HTML overlay
   *  during/after a cross-page move (the overlay still lives in its
   *  origin page's container and overflows visually onto the target
   *  page — z-index keeps it on top). */
  dx?: number;
  dy?: number;
  /** Cross-page move target as a CURRENT slot index. PdfPage emits
   *  this from its drag-end hit-test and consumes it for rendering;
   *  App.tsx converts to/from `targetSlotId` on the way in/out so the
   *  target survives reorder. */
  targetPageIndex?: number;
  /** Source identifier of the page the run was dropped on. Cross-source
   *  moves (drop onto a page from a different loaded PDF) carry this
   *  through to save so the target source's doc gets the drawText. */
  targetSourceKey?: string;
  targetPdfX?: number;
  targetPdfY?: number;
  /** Stable identity of the target slot — populated by App.tsx for
   *  persisted edits (PdfPage never sets or reads this). When the
   *  underlying slot is reordered, App resolves this back to a fresh
   *  `targetPageIndex` before re-rendering. */
  targetSlotId?: string;
  /** When true, this run is marked for deletion. Save strips its
   *  Tj/TJ ops without drawing a replacement; PdfPage hides the
   *  overlay entirely so the user can't re-grab a deleted run. */
  deleted?: boolean;
};

/** Move + resize for one image instance, in viewport pixels (same axis
 *  convention as EditValue). Save injects a fresh outermost cm right
 *  after the image's q so the image's effective bbox becomes
 *  (originalX + dx_pdf, originalY + dy_pdf, originalW + dw_pdf,
 *  originalH + dh_pdf). dx/dy are the bottom-left translation; dw/dh
 *  grow the box without moving the bottom-left. The viewport-pixel
 *  axis convention: dx,dw>0 → wider/right, dy>0 → down (subtracted
 *  from PDF y), dh>0 → taller. */
export type ImageMoveValue = {
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  /** Cross-page move target. Same model as EditValue: dx/dy still
   *  position the visual overlay relative to the origin container,
   *  while save uses (targetPdfX/Y/W/H) to draw on the target page
   *  and strips the original q…Q block from the origin. */
  targetPageIndex?: number;
  /** Source identifier of the target page when the move crossed
   *  sources. Save uses this to decide between XObject-replication
   *  (same source) and pixel-bytes re-embed (different source). */
  targetSourceKey?: string;
  targetPdfX?: number;
  targetPdfY?: number;
  targetPdfWidth?: number;
  targetPdfHeight?: number;
  /** Stable identity of the target slot — populated by App.tsx for
   *  persisted moves only. See EditValue.targetSlotId. */
  targetSlotId?: string;
  /** When true, this image is marked for deletion. Save strips its
   *  q…Q block; PdfPage hides the overlay entirely. */
  deleted?: boolean;
};

/** A source-page text run that has been moved across pages and now
 *  visually belongs to a TARGET page. Built by PageList from the
 *  authoritative `edits` map (which is keyed by SOURCE slot) by
 *  finding entries whose `targetSlotId` matches each slot, then
 *  resolving the source run for its baseline styling. PdfPage renders
 *  these as non-interactive spans on the target page so the user
 *  actually sees the moved content before save. */
export type CrossPageArrival = {
  /** Composite key for React: source slot id + run id. */
  key: string;
  /** Stable id of the slot whose `edits` map owns the underlying entry.
   *  Re-dragging the arrival writes back through this id so the move
   *  stays anchored to its origin (the cross-page preview-strip
   *  pipeline keys off the source slot). */
  sourceSlotId: string;
  /** Run id within the source page. Pairs with `sourceSlotId` to
   *  address the entry in `App.edits`. */
  runId: string;
  /** Snapshot of the EditValue currently driving this arrival —
   *  re-drag handlers spread it before applying their own patch so
   *  text / style edits survive the move. */
  edit: EditValue;
  /** Logical text — the edit's `text` overrides the source run's. */
  text: string;
  /** Baseline x in TARGET-page PDF user-space. */
  targetPdfX: number;
  /** Baseline y in TARGET-page PDF user-space (y-up, like the rest of
   *  the codebase — viewport y-down conversion happens in the renderer). */
  targetPdfY: number;
  /** Font size in PDF points. Computed at PageList time as
   *  `sourceRun.height / sourcePage.scale` so the renderer can scale
   *  by `targetPage.scale` without needing the source page's scale. */
  fontSizePdfPoints: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  dir: "rtl" | "ltr" | undefined;
  /** Override fill color from the edit's style. Undefined means the
   *  arrival inherits whatever the source run had (currently always
   *  black — buildTextRuns hasn't extracted source colors yet). */
  color?: import("../../lib/annotations").AnnotationColor;
};

/** A source-page image that has been moved across pages and now
 *  visually belongs to a TARGET page. PageList derives these from the
 *  authoritative `imageMoves` map (keyed by SOURCE slot) by finding
 *  entries whose `targetSlotId` matches each slot, then resolving the
 *  source image so the renderer can crop the original pixels and
 *  paint them at the target position. PdfPage renders these as
 *  non-interactive sprites — same v1 limitation as
 *  `CrossPageArrival` for text. */
export type CrossPageImageArrival = {
  /** Composite key for React: source slot id + image id. */
  key: string;
  /** Stable id of the slot whose `imageMoves` map owns the entry. */
  sourceSlotId: string;
  /** Image id within the source page. */
  imageId: string;
  /** Snapshot of the move record (dx/dy/dw/dh + target fields) so a
   *  re-drag can preserve the persisted resize while updating the
   *  target placement. */
  move: ImageMoveValue;
  /** The original source canvas — needed so we can crop the image's
   *  pixels into a sprite for the target overlay. PageList passes the
   *  reference; the renderer crops + memoises. */
  sourceCanvas: HTMLCanvasElement;
  /** Crop region on the source canvas, in source-page natural pixels. */
  sourceLeft: number;
  sourceTop: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Bottom-left placement on the TARGET page in PDF user space (y-up). */
  targetPdfX: number;
  targetPdfY: number;
  targetPdfWidth: number;
  targetPdfHeight: number;
};

export type ResizeCorner = "tl" | "tr" | "bl" | "br";

export type ToolbarBlocker = {
  /** id of the run / inserted text the blocker rect comes from. The
   *  caller uses this to skip the run currently being edited. */
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
