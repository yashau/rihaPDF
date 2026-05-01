import type { EditStyle } from "../../lib/save";

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
