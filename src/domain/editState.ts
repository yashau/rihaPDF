import type { AnnotationColor } from "@/domain/annotations";
import type { EditStyle } from "@/domain/editStyle";
import type { RichTextBlock } from "@/domain/richText";

export type EditValue = {
  text: string;
  style?: EditStyle;
  /** Rich replacement text for partial formatting and multi-line
   *  paragraph edits. `text` remains the plain-text mirror for legacy
   *  callers and simple status checks. */
  richText?: RichTextBlock;
  /** Source TextRun ids covered by this edit. Omitted for legacy
   *  single-run edits, where the map key is also the source run id. */
  sourceRunIds?: string[];
  /** Move offset from the original run position, in viewport pixels
   *  (origin-page-relative). Positive dx -> right, positive dy -> down.
   *  Used both for SAME-page save (translates drawn text by (dx/scale,
   *  -dy/scale) in PDF user space) and for rendering the HTML overlay
   *  during/after a cross-page move (the overlay still lives in its
   *  origin page's container and overflows visually onto the target
   *  page; z-index keeps it on top). */
  dx?: number;
  dy?: number;
  /** Cross-page move target as a CURRENT slot index. PdfPage emits
   *  this from its drag-end hit-test and consumes it for rendering;
   *  App converts to/from `targetSlotId` on the way in/out so the
   *  target survives reorder. */
  targetPageIndex?: number;
  /** Source identifier of the page the run was dropped on. Cross-source
   *  moves carry this through to save so the target source's doc gets
   *  the drawText. */
  targetSourceKey?: string;
  targetPdfX?: number;
  targetPdfY?: number;
  /** Stable identity of the target slot, populated by app state for
   *  persisted edits. When the underlying slot is reordered, App
   *  resolves this back to a fresh `targetPageIndex` before rendering. */
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
 *  axis convention: dx,dw>0 -> wider/right, dy>0 -> down (subtracted
 *  from PDF y), dh>0 -> taller. */
export type ImageMoveValue = {
  dx?: number;
  dy?: number;
  dw?: number;
  dh?: number;
  /** Cross-page move target. Same model as EditValue: dx/dy still
   *  position the visual overlay relative to the origin container,
   *  while save uses (targetPdfX/Y/W/H) to draw on the target page
   *  and strips the original q...Q block from the origin. */
  targetPageIndex?: number;
  /** Source identifier of the target page when the move crossed
   *  sources. Save uses this to decide between XObject-replication
   *  (same source) and pixel-bytes re-embed (different source). */
  targetSourceKey?: string;
  targetPdfX?: number;
  targetPdfY?: number;
  targetPdfWidth?: number;
  targetPdfHeight?: number;
  /** Stable identity of the target slot, populated by app state for
   *  persisted moves only. See EditValue.targetSlotId. */
  targetSlotId?: string;
  /** When true, this image is marked for deletion. Save strips its
   *  q...Q block; PdfPage hides the overlay entirely. */
  deleted?: boolean;
};

/** A source-page text run that has been moved across pages and now
 *  visually belongs to a target page. Built from the authoritative
 *  `edits` map, which is keyed by source slot. */
export type CrossPageArrival = {
  /** Composite key for React: source slot id + run id. */
  key: string;
  /** Stable id of the slot whose `edits` map owns the underlying entry. */
  sourceSlotId: string;
  /** Run id within the source page. */
  runId: string;
  /** Snapshot of the EditValue currently driving this arrival. */
  edit: EditValue;
  /** Logical text; the edit's `text` overrides the source run's. */
  text: string;
  /** Baseline x in target-page PDF user-space. */
  targetPdfX: number;
  /** Baseline y in target-page PDF user-space. */
  targetPdfY: number;
  /** Font size in PDF points. */
  fontSizePdfPoints: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  dir: "rtl" | "ltr" | undefined;
  /** Override fill color from the edit's style. */
  color?: AnnotationColor;
};

/** A source-page image that has been moved across pages and now
 *  visually belongs to a target page. Built from the authoritative
 *  `imageMoves` map, which is keyed by source slot. */
export type CrossPageImageArrival = {
  /** Composite key for React: source slot id + image id. */
  key: string;
  /** Stable id of the slot whose `imageMoves` map owns the entry. */
  sourceSlotId: string;
  /** Image id within the source page. */
  imageId: string;
  /** Snapshot of the move record. */
  move: ImageMoveValue;
  /** The original source canvas, used to crop a target-page sprite. */
  sourceCanvas: HTMLCanvasElement;
  /** Crop region on the source canvas, in source-page natural pixels. */
  sourceLeft: number;
  sourceTop: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Bottom-left placement on the target page in PDF user space. */
  targetPdfX: number;
  targetPdfY: number;
  targetPdfWidth: number;
  targetPdfHeight: number;
};
