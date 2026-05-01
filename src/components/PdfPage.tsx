import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ToggleButton as HeroToggleButton } from "@heroui/react";
import { Bold, Italic, Trash2, Underline, X } from "lucide-react";
import type { RenderedPage, TextRun } from "../lib/pdf";
import type { EditStyle } from "../lib/save";
import type { ImageInsertion, TextInsertion } from "../lib/insertions";
import type { ToolMode } from "../App";
import { FONTS } from "../lib/fonts";

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

const DRAG_THRESHOLD_PX = 3;

type ResizeCorner = "tl" | "tr" | "bl" | "br";

/** Cross-page hit-test: given a viewport (clientX, clientY) point, find
 *  which page container is under it and return its index/scale/size.
 *  Iterates `[data-page-index]` elements and returns the first whose
 *  bounding rect contains the point. Returns null when the cursor is
 *  outside any page (e.g. in the header or between pages).
 *
 *  pageIndex is the CURRENT slot index in App's slots array — used to
 *  resolve the persisted target via `slotsRef`. sourceKey identifies
 *  which loaded source the slot points at; save uses it to route
 *  cross-source draws to the right `doc`. */
function findPageAtPoint(
  clientX: number,
  clientY: number,
): {
  pageIndex: number;
  sourceKey: string;
  scale: number;
  viewWidth: number;
  viewHeight: number;
  rect: DOMRect;
} | null {
  const els = document.querySelectorAll<HTMLElement>("[data-page-index]");
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
      const idx = parseInt(el.dataset.pageIndex ?? "", 10);
      const scale = parseFloat(el.dataset.pageScale ?? "");
      const sourceKey = el.dataset.sourceKey ?? "";
      if (Number.isNaN(idx) || Number.isNaN(scale) || sourceKey === "") continue;
      return {
        pageIndex: idx,
        sourceKey,
        scale,
        viewWidth: r.width,
        viewHeight: r.height,
        rect: r,
      };
    }
  }
  return null;
}

type Props = {
  page: RenderedPage;
  pageIndex: number;
  /** Source identity for the rendered page. Emitted as `data-source-key`
   *  on the page container so the cross-page hit-test can carry it
   *  through to save-time addressing. */
  sourceKey: string;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  /** Live-preview canvas — when present, paint this in place of
   *  page.canvas. The preview has the currently-edited runs and moved
   *  images stripped from its content stream so HTML overlays don't
   *  need a white cover to hide the originals. */
  previewCanvas: HTMLCanvasElement | null;
  /** Active tool mode — when "addText" / "addImage", clicking on
   *  empty canvas creates a new insertion via onCanvasClick. */
  tool: ToolMode;
  /** Currently-open editor id on this page (lifted to App so a fresh
   *  insertion can immediately open its editor without a round-trip
   *  through PdfPage's own state). null = nothing is being edited. */
  editingId: string | null;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  /** Click on the page canvas with `tool` set to a placement mode. */
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  /** ID of the source image currently selected on this page (null
   *  means nothing on this page is selected). Drives the selected
   *  outline state on `ImageOverlay`. */
  selectedImageId: string | null;
  /** ID of the inserted image currently selected on this page. */
  selectedInsertedImageId: string | null;
  /** Single-click on an image overlay → app marks it selected so
   *  Delete/Backspace targets it. */
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
};

export function PdfPage({
  page,
  pageIndex,
  sourceKey,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  previewCanvas,
  tool,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  onEdit,
  onImageMove,
  onEditingChange,
  onCanvasClick,
  onTextInsertChange,
  onTextInsertDelete,
  onImageInsertChange,
  onImageInsertDelete,
  onSelectImage,
  onSelectInsertedImage,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setEditingId = (next: string | null) => {
    onEditingChange(next);
  };
  /** While dragging a run, the live offset for the dragged run. We keep
   *  it in local state during the drag so we don't churn the parent's
   *  edits Map on every mousemove. */
  const [drag, setDrag] = useState<{
    runId: string;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  } | null>(null);
  /** Same idea for images. Separate state because image drags don't
   *  have the click-suppression / edit handoff that text runs do.
   *  Carries a resize corner when the gesture is a corner drag — null
   *  means whole-image translate. */
  const [imageDrag, setImageDrag] = useState<{
    imageId: string;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
    corner: ResizeCorner | null;
  } | null>(null);
  /** Set to the runId during a drag and cleared a tick after mouseup, used
   *  to suppress the click-to-edit that would otherwise fire after a drag
   *  (Playwright's synthesised events don't match the browser's native
   *  click-suppression on movement, so we guard explicitly). */
  const justDraggedRef = useRef<string | null>(null);

  // Mounts the live canvas (preview or original) into our DOM slot and
  // sizes it. Mutating the DOM canvas's style is the whole point of
  // this effect — react-hooks/immutability would have us copy first,
  // but the canvas is a render artefact, not an owned prop value.
  /* eslint-disable-next-line react-hooks/immutability */
  useEffect(() => {
    const node = containerRef.current?.querySelector("[data-canvas-slot]") as HTMLElement | null;
    if (!node) return;
    const liveCanvas = previewCanvas ?? page.canvas;
    node.replaceChildren(liveCanvas);
    /* eslint-disable react-hooks/immutability */
    liveCanvas.style.display = "block";
    liveCanvas.style.width = `${page.viewWidth}px`;
    liveCanvas.style.height = `${page.viewHeight}px`;
    /* eslint-enable react-hooks/immutability */
  }, [page, previewCanvas]);

  /** Start a drag on a run. The handlers track movement on the window so
   *  the drag continues even if the cursor leaves the original span. */
  const startDrag = (runId: string, e: React.MouseEvent, base: { dx: number; dy: number }) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const originRect = containerRef.current?.getBoundingClientRect() ?? null;
    setDrag({ runId, startX, startY, dx: base.dx, dy: base.dy });

    const onMove = (ev: MouseEvent) => {
      const newDx = base.dx + (ev.clientX - startX);
      const newDy = base.dy + (ev.clientY - startY);
      setDrag((prev) => (prev && prev.runId === runId ? { ...prev, dx: newDx, dy: newDy } : prev));
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const totalDx = base.dx + (ev.clientX - startX);
      const totalDy = base.dy + (ev.clientY - startY);
      const moved =
        Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX;
      setDrag(null);
      if (!moved) return; // treat as click — caller's onClick handles it
      // Suppress the click that the browser/playwright fires immediately
      // after mouseup so we don't drop into the editor right after a drag.
      justDraggedRef.current = runId;
      setTimeout(() => {
        if (justDraggedRef.current === runId) justDraggedRef.current = null;
      }, 200);
      const run = page.textRuns.find((r) => r.id === runId);
      if (!run) return;
      const existing = edits.get(runId) ?? { text: run.text };
      // Cross-page detection: if the cursor landed on a different page
      // than this run's origin, persist absolute target-page baseline
      // coords too. Save uses them to strip-on-origin + draw-on-target.
      const hit = originRect ? findPageAtPoint(ev.clientX, ev.clientY) : null;
      if (hit && originRect && hit.pageIndex !== pageIndex) {
        const screenBaselineX = originRect.left + run.bounds.left + totalDx;
        const screenBaselineY = originRect.top + run.baselineY + totalDy;
        const targetViewX = screenBaselineX - hit.rect.left;
        const targetViewY = screenBaselineY - hit.rect.top;
        const targetPdfX = targetViewX / hit.scale;
        const targetPdfY = (hit.viewHeight - targetViewY) / hit.scale;
        onEdit(runId, {
          ...existing,
          dx: totalDx,
          dy: totalDy,
          targetPageIndex: hit.pageIndex,
          targetSourceKey: hit.sourceKey,
          targetPdfX,
          targetPdfY,
        });
      } else {
        onEdit(runId, {
          ...existing,
          dx: totalDx,
          dy: totalDy,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Start a translate drag on an image overlay. Mirrors startDrag for
   *  runs but commits to the parent's onImageMove rather than onEdit.
   *  Width/height deltas (dw/dh) are passed through unchanged so the
   *  user's earlier resize survives a subsequent move. */
  const startImageDrag = (
    imageId: string,
    e: React.MouseEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const originRect = containerRef.current?.getBoundingClientRect() ?? null;
    setImageDrag({
      imageId,
      startX,
      startY,
      dx: base.dx,
      dy: base.dy,
      dw: base.dw,
      dh: base.dh,
      corner: null,
    });
    const onMove = (ev: MouseEvent) => {
      const newDx = base.dx + (ev.clientX - startX);
      const newDy = base.dy + (ev.clientY - startY);
      setImageDrag((prev) =>
        prev && prev.imageId === imageId ? { ...prev, dx: newDx, dy: newDy } : prev,
      );
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const totalDx = base.dx + (ev.clientX - startX);
      const totalDy = base.dy + (ev.clientY - startY);
      const moved =
        Math.abs(ev.clientX - startX) > DRAG_THRESHOLD_PX ||
        Math.abs(ev.clientY - startY) > DRAG_THRESHOLD_PX;
      setImageDrag(null);
      if (!moved) return;
      const img = page.images.find((i) => i.id === imageId);
      // Cross-page detection: if the drop landed on a different page,
      // compute target-page bottom-left + size in PDF user space so
      // save can replicate the XObject reference there.
      const hit = originRect && img ? findPageAtPoint(ev.clientX, ev.clientY) : null;
      if (hit && originRect && img && hit.pageIndex !== pageIndex) {
        const origLeft = img.pdfX * page.scale;
        const origTopView = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
        const dwPdf = base.dw / page.scale;
        const dhPdf = base.dh / page.scale;
        const newW = img.pdfWidth + dwPdf;
        const newH = img.pdfHeight + dhPdf;
        // Effective box top on origin page after move + resize (matches
        // ImageOverlay's boxTop = top + dy - dh).
        const screenLeft = originRect.left + origLeft + totalDx;
        const screenTopBox = originRect.top + origTopView + totalDy - base.dh;
        const targetViewLeft = screenLeft - hit.rect.left;
        const targetViewTopBox = screenTopBox - hit.rect.top;
        const newWView = newW * hit.scale;
        const newHView = newH * hit.scale;
        const targetPdfX = targetViewLeft / hit.scale;
        // Bottom-left in PDF y-up = (viewHeight - viewBottom) / scale.
        const targetViewBottom = targetViewTopBox + newHView;
        const targetPdfY = (hit.viewHeight - targetViewBottom) / hit.scale;
        // newWView / hit.scale = newW; symmetric — but go through view
        // pixels so any scale mismatch between origin/target is handled.
        const targetPdfWidth = newWView / hit.scale;
        const targetPdfHeight = newHView / hit.scale;
        onImageMove(imageId, {
          dx: totalDx,
          dy: totalDy,
          dw: base.dw,
          dh: base.dh,
          targetPageIndex: hit.pageIndex,
          targetSourceKey: hit.sourceKey,
          targetPdfX,
          targetPdfY,
          targetPdfWidth,
          targetPdfHeight,
        });
      } else {
        onImageMove(imageId, {
          dx: totalDx,
          dy: totalDy,
          dw: base.dw,
          dh: base.dh,
          targetPageIndex: undefined,
          targetSourceKey: undefined,
          targetPdfX: undefined,
          targetPdfY: undefined,
          targetPdfWidth: undefined,
          targetPdfHeight: undefined,
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Start a resize drag from one of the 4 image corners. Anchors the
   *  opposite corner so the box grows/shrinks toward the cursor.
   *  dx/dy are viewport-pixel translations of the bottom-left (same
   *  convention as the move drag); dw/dh are viewport-pixel growth
   *  deltas — dh > 0 means image is taller. App.tsx converts to PDF
   *  units when emitting the cm op. */
  const startImageResize = (
    imageId: string,
    img: import("../lib/sourceImages").ImageInstance,
    corner: ResizeCorner,
    e: React.MouseEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    setImageDrag({
      imageId,
      startX,
      startY,
      dx: base.dx,
      dy: base.dy,
      dw: base.dw,
      dh: base.dh,
      corner,
    });
    const origW = img.pdfWidth * page.scale;
    const origH = img.pdfHeight * page.scale;
    const MIN_VIEW = 10 * page.scale;
    // (dx, dy, dw, dh) live in viewport pixels:
    //   dx, dy  → bottom-left translation (dy positive = downward).
    //   dw, dh  → growth of the box's width / height.
    // Per-corner increment from a cursor (dxV, dyV) — derived by
    // requiring that the OPPOSITE corner stays at its base viewport
    // position. See the table in the source comment.
    const onMove = (ev: MouseEvent) => {
      const dxV = ev.clientX - startX;
      const dyV = ev.clientY - startY;
      // Step 1: unclamped width/height growth.
      let nDw = base.dw;
      let nDh = base.dh;
      switch (corner) {
        case "br":
          nDw = base.dw + dxV;
          nDh = base.dh + dyV;
          break;
        case "tr":
          nDw = base.dw + dxV;
          nDh = base.dh - dyV;
          break;
        case "tl":
          nDw = base.dw - dxV;
          nDh = base.dh - dyV;
          break;
        case "bl":
          nDw = base.dw - dxV;
          nDh = base.dh + dyV;
          break;
      }
      // Step 2: clamp size so the viewport bbox stays ≥ MIN_VIEW.
      if (origW + nDw < MIN_VIEW) nDw = MIN_VIEW - origW;
      if (origH + nDh < MIN_VIEW) nDh = MIN_VIEW - origH;
      // Step 3: derive translation from the clamped size to keep the
      // anchored corner pinned. The relations come from
      //   anchor.left_x   stays → nDx = base.dx                (br, tr)
      //   anchor.right_x  stays → nDx = base.dx + (base.dw - nDw) (tl, bl)
      //   anchor.bottom_y stays → nDy = base.dy                  (tr, tl)
      //   anchor.top_y    stays → nDy = base.dy + (nDh - base.dh)(br, bl)
      let nDx = base.dx;
      let nDy = base.dy;
      if (corner === "tl" || corner === "bl") {
        nDx = base.dx + (base.dw - nDw);
      }
      if (corner === "br" || corner === "bl") {
        nDy = base.dy + (nDh - base.dh);
      }
      setImageDrag((prev) =>
        prev && prev.imageId === imageId ? { ...prev, dx: nDx, dy: nDy, dw: nDw, dh: nDh } : prev,
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setImageDrag((prev) => {
        if (!prev || prev.imageId !== imageId) return prev;
        onImageMove(imageId, {
          dx: prev.dx,
          dy: prev.dy,
          dw: prev.dw,
          dh: prev.dh,
        });
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Blocker rects the formatting toolbar must avoid. Computed once per
  // render so EditField + InsertedTextOverlay can decide whether to
  // place the toolbar above or below the editor without each rebuilding
  // the same list. Honors persisted move offsets so a dragged run still
  // counts as occupying its NEW position, not its source position.
  const toolbarBlockers: ToolbarBlocker[] = [];
  for (const r of page.textRuns) {
    const ev = edits.get(r.id);
    if (ev?.deleted) continue;
    const dx = ev?.dx ?? 0;
    const dy = ev?.dy ?? 0;
    toolbarBlockers.push({
      id: r.id,
      left: r.bounds.left + dx,
      right: r.bounds.left + dx + r.bounds.width,
      top: r.bounds.top + dy,
      bottom: r.bounds.top + dy + r.bounds.height,
    });
  }
  for (const ins of insertedTexts) {
    const fontSizePx = ins.fontSize * page.scale;
    const lineHeightPx = ins.fontSize * 1.4 * page.scale;
    const left = ins.pdfX * page.scale;
    const top = page.viewHeight - ins.pdfY * page.scale - fontSizePx;
    const width = Math.max(ins.pdfWidth * page.scale, 60);
    toolbarBlockers.push({
      id: ins.id,
      left,
      right: left + width,
      top,
      bottom: top + lineHeightPx,
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block shadow-md"
      style={{ width: page.viewWidth, height: page.viewHeight }}
      data-page-index={pageIndex}
      data-source-key={sourceKey}
      data-page-scale={page.scale}
      data-view-width={page.viewWidth}
      data-view-height={page.viewHeight}
    >
      <div data-canvas-slot />
      {tool !== "select" ? (
        // Placement-mode capture layer: sits above all other overlays
        // so a click goes to onCanvasClick regardless of what's
        // underneath. The user is in "drop a new thing here" mode;
        // existing items shouldn't react to the click.
        <div
          className="absolute inset-0"
          style={{
            cursor: "crosshair",
            zIndex: 50,
            pointerEvents: "auto",
          }}
          onClick={(e) => {
            e.stopPropagation();
            const host = containerRef.current;
            if (!host) return;
            const r = host.getBoundingClientRect();
            const xView = e.clientX - r.x;
            const yView = e.clientY - r.y;
            // Convert viewport (y-down) → PDF user space (y-up).
            const pdfX = xView / page.scale;
            const pdfY = (page.viewHeight - yView) / page.scale;
            onCanvasClick(pdfX, pdfY);
          }}
        />
      ) : null}
      <div className="absolute inset-0">
        {/* Per-run + per-image overlays handle their own pointer-events.
            We don't switch the parent off while editing — the EditField's
            onBlur commits the current edit when the user clicks another
            run, so they can hop between edits without first dismissing. */}
        {page.textRuns.map((run) => {
          const isEditing = editingId === run.id;
          const editedValue = edits.get(run.id);
          // Deleted runs have no overlay at all — the preview canvas
          // already stripped them; with no overlay there's nothing to
          // re-grab, which is the intent.
          if (editedValue?.deleted) return null;
          const edited = editedValue !== undefined;
          const isDragging = drag?.runId === run.id;
          const isModified = edited || isDragging;
          // Live drag offset for THIS run (or the persisted offset if we're
          // not currently dragging it).
          const dx = (isDragging ? drag.dx : editedValue?.dx) ?? 0;
          const dy = (isDragging ? drag.dy : editedValue?.dy) ?? 0;

          // No more white-rectangle cover — the live preview pipeline in
          // App.tsx rebuilds the page canvas with these runs/images
          // STRIPPED out of the content stream, so the original glyphs
          // are actually gone from the render. The HTML overlay below
          // just paints the new content where the user wants it.
          const padX = 2;
          const padY = 2;

          if (isEditing) {
            return (
              <EditField
                key={run.id}
                run={run}
                pageScale={page.scale}
                toolbarBlockers={toolbarBlockers}
                initial={editedValue ?? { text: run.text, style: undefined }}
                onCommit={(value) => {
                  // Preserve any existing move offset (dx/dy) — the
                  // EditField only owns text + style, so we layer back
                  // the persisted offset from editedValue.
                  const merged: EditValue = {
                    ...value,
                    dx: editedValue?.dx ?? 0,
                    dy: editedValue?.dy ?? 0,
                  };
                  const hasOffset = (merged.dx ?? 0) !== 0 || (merged.dy ?? 0) !== 0;
                  if (value.text !== run.text || value.style || hasOffset) {
                    onEdit(run.id, merged);
                  }
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
                onDelete={() => {
                  // Mark the source run for deletion: save strips its
                  // Tj/TJ ops, no replacement is drawn. The overlay is
                  // hidden via the deleted-flag short-circuit below.
                  onEdit(run.id, {
                    ...(editedValue ?? { text: run.text }),
                    deleted: true,
                  });
                  setEditingId(null);
                }}
              />
            );
          }

          if (edited) {
            const style = editedValue.style ?? {};
            // Edited / dragged run: paint the new text where the user
            // wants it, no white cover under or behind. The original
            // glyphs are already gone from the preview canvas.
            return (
              <span
                key={run.id}
                data-run-id={run.id}
                data-font-family={style.fontFamily ?? run.fontFamily}
                data-base-font={run.fontBaseName ?? ""}
                style={{
                  position: "absolute",
                  left: run.bounds.left - padX + dx,
                  top: run.bounds.top - padY + dy,
                  width: Math.max(run.bounds.width, 12) + padX * 2,
                  height: run.bounds.height + padY * 2,
                  outline: isDragging
                    ? "1px dashed rgba(255, 180, 30, 0.9)"
                    : "1px solid rgba(255, 200, 60, 0.5)",
                  pointerEvents: "auto",
                  cursor: isDragging ? "grabbing" : "grab",
                  display: "flex",
                  alignItems: "center",
                  overflow: "visible",
                }}
                title={editedValue.text}
                onMouseDown={(e) =>
                  startDrag(run.id, e, {
                    dx: editedValue.dx ?? 0,
                    dy: editedValue.dy ?? 0,
                  })
                }
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(run.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (drag || justDraggedRef.current === run.id) return;
                  setEditingId(run.id);
                }}
              >
                <span
                  dir="auto"
                  style={{
                    fontFamily: `"${style.fontFamily ?? run.fontFamily}"`,
                    fontSize: `${style.fontSize ?? run.height}px`,
                    lineHeight: `${run.bounds.height}px`,
                    fontWeight: (style.bold ?? run.bold) ? 700 : 400,
                    fontStyle: (style.italic ?? run.italic) ? "italic" : "normal",
                    textDecoration: style.underline ? "underline" : "none",
                    color: "black",
                    width: "100%",
                    whiteSpace: "pre",
                    paddingLeft: padX,
                    paddingRight: padX,
                  }}
                >
                  {editedValue.text}
                </span>
              </span>
            );
          }
          // Unedited and not currently dragging: a transparent click
          // target sits on top of the canvas glyphs. While the user IS
          // dragging it (live state) we render the text visibly so they
          // can see what's moving — the preview canvas has already
          // stripped the original from its source spot, so there's no
          // double-rendering.
          return (
            <span
              key={run.id}
              data-run-id={run.id}
              data-font-family={run.fontFamily}
              data-base-font={run.fontBaseName ?? ""}
              dir="auto"
              className="thaana-stack absolute select-text"
              style={{
                left: run.bounds.left + dx,
                top: run.bounds.top + dy,
                width: Math.max(run.bounds.width, 12),
                height: run.bounds.height,
                fontSize: `${run.height}px`,
                lineHeight: `${run.bounds.height}px`,
                color: isModified ? "black" : "transparent",
                backgroundColor: "transparent",
                pointerEvents: "auto",
                whiteSpace: "pre",
                overflow: "visible",
                cursor: isDragging ? "grabbing" : "grab",
              }}
              title={run.text}
              onMouseDown={(e) => startDrag(run.id, e, { dx: 0, dy: 0 })}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(run.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (drag || justDraggedRef.current === run.id) return;
                setEditingId(run.id);
              }}
            >
              {run.text}
            </span>
          );
        })}
        {page.images.map((img) => {
          // A deleted source image hides its overlay so the user can't
          // re-grab it; the preview-strip pipeline already removed
          // it from the canvas.
          const persisted = imageMoves.get(img.id);
          if (persisted?.deleted) return null;
          return (
            <ImageOverlay
              key={img.id}
              img={img}
              page={page}
              persisted={persisted}
              isDragging={imageDrag?.imageId === img.id}
              isSelected={selectedImageId === img.id}
              liveDx={imageDrag?.imageId === img.id ? imageDrag.dx : null}
              liveDy={imageDrag?.imageId === img.id ? imageDrag.dy : null}
              liveDw={imageDrag?.imageId === img.id ? imageDrag.dw : null}
              liveDh={imageDrag?.imageId === img.id ? imageDrag.dh : null}
              onMouseDown={(e, base) => startImageDrag(img.id, e, base)}
              onResizeStart={(corner, e, base) => startImageResize(img.id, img, corner, e, base)}
              onSelect={() => onSelectImage(img.id)}
            />
          );
        })}
        {/* Inserted (net-new) text boxes. These render the same way as
            edited runs do — drag to move, click to edit — but the save
            path treats them as fresh content rather than a rewrite. */}
        {insertedTexts.map((ins) => (
          <InsertedTextOverlay
            key={ins.id}
            ins={ins}
            page={page}
            toolbarBlockers={toolbarBlockers}
            isEditing={editingId === ins.id}
            onChange={(patch) => onTextInsertChange(ins.id, patch)}
            onDelete={() => {
              if (editingId === ins.id) setEditingId(null);
              onTextInsertDelete(ins.id);
            }}
            onOpen={() => setEditingId(ins.id)}
            onClose={() => setEditingId(null)}
          />
        ))}
        {/* Inserted images — drag to move, click to select, Del key
            to delete. Double-click is still a deletion shortcut. */}
        {insertedImages.map((ins) => (
          <InsertedImageOverlay
            key={ins.id}
            ins={ins}
            page={page}
            isSelected={selectedInsertedImageId === ins.id}
            onChange={(patch) => onImageInsertChange(ins.id, patch)}
            onDelete={() => onImageInsertDelete(ins.id)}
            onSelect={() => onSelectInsertedImage(ins.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** Drag-movable image overlay. Two visual layers when moved:
 *
 *   - cover  : a white box at the image's ORIGINAL position so the
 *              source pixels on the rendered canvas are masked.
 *   - sprite : the image's pixels (cropped from the page canvas one
 *              time and cached as a data URL) painted at the moved
 *              position via `background-image`.
 *
 * At rest (dx == 0 && dy == 0) we don't render the cover or sprite —
 * the original canvas pixels are visible directly and the overlay is
 * a transparent click target. */
function ImageOverlay({
  img,
  page,
  persisted,
  isDragging,
  isSelected,
  liveDx,
  liveDy,
  liveDw,
  liveDh,
  onMouseDown,
  onResizeStart,
  onSelect,
}: {
  img: import("../lib/sourceImages").ImageInstance;
  page: RenderedPage;
  persisted: ImageMoveValue | undefined;
  isDragging: boolean;
  isSelected: boolean;
  liveDx: number | null;
  liveDy: number | null;
  liveDw: number | null;
  liveDh: number | null;
  onMouseDown: (
    e: React.MouseEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  onResizeStart: (
    corner: ResizeCorner,
    e: React.MouseEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  onSelect: () => void;
}) {
  // PDF user-space → viewport: x scales directly; y flips around the
  // page bottom. CTM origin (pdfX, pdfY) is the bottom-left corner in
  // PDF y-up so the viewport top is page.viewHeight - (pdfY + pdfH) × s.
  const left = img.pdfX * page.scale;
  const top = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
  const w = img.pdfWidth * page.scale;
  const h = img.pdfHeight * page.scale;
  const dx = liveDx ?? persisted?.dx ?? 0;
  const dy = liveDy ?? persisted?.dy ?? 0;
  const dw = liveDw ?? persisted?.dw ?? 0;
  const dh = liveDh ?? persisted?.dh ?? 0;
  const isMoved = dx !== 0 || dy !== 0 || dw !== 0 || dh !== 0;
  const movable = img.qOpIndex != null;

  // Crop the image's pixels from the ORIGINAL page canvas (not the
  // preview, which has the image stripped) so we can paint them at the
  // moved position. Done lazily — only when first moved. Sprite source
  // is always the original size; we stretch via background-size.
  const sprite = useMemo(() => {
    if (!isMoved) return null;
    return cropCanvasToDataUrl(page.canvas, left, top, w, h);
  }, [isMoved, page.canvas, left, top, w, h]);

  // Effective viewport box after move + resize. dx/dy translate the
  // bottom-left; dh shifts the top-edge upward so the box grows toward
  // the user's cursor regardless of corner direction.
  const boxLeft = left + dx;
  const boxTop = top + dy - dh;
  const boxW = w + dw;
  const boxH = h + dh;

  const baseFor = () => ({ dx, dy, dw, dh });

  return (
    <div
      data-image-id={img.id}
      style={{
        position: "absolute",
        left: boxLeft,
        top: boxTop,
        width: boxW,
        height: boxH,
        outline: isSelected
          ? "2px solid rgba(220, 50, 50, 0.85)"
          : movable
            ? isDragging
              ? "1px dashed rgba(60, 130, 255, 0.85)"
              : isMoved
                ? "1px solid rgba(60, 130, 255, 0.45)"
                : "1px dashed rgba(60, 130, 255, 0)"
            : "1px dashed rgba(160, 160, 160, 0.55)",
        backgroundImage: sprite ? `url(${sprite})` : undefined,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        cursor: movable ? (isDragging ? "grabbing" : "grab") : "not-allowed",
        pointerEvents: "auto",
      }}
      title={
        movable
          ? `Image ${img.resourceName} (drag to move, corners to resize, Del to delete)`
          : `Image ${img.resourceName} (un-movable)`
      }
      onMouseDown={(e) => {
        if (!movable) return;
        onMouseDown(e, baseFor());
      }}
      onClick={(e) => {
        // Stop propagation so the window-level click-outside handler
        // in App doesn't immediately deselect what we just selected.
        e.stopPropagation();
        if (movable) onSelect();
      }}
    >
      {movable ? (
        <>
          <ResizeHandle position="tl" onMouseDown={(e) => onResizeStart("tl", e, baseFor())} />
          <ResizeHandle position="tr" onMouseDown={(e) => onResizeStart("tr", e, baseFor())} />
          <ResizeHandle position="bl" onMouseDown={(e) => onResizeStart("bl", e, baseFor())} />
          <ResizeHandle position="br" onMouseDown={(e) => onResizeStart("br", e, baseFor())} />
        </>
      ) : null}
    </div>
  );
}

/** Crop a region of a HTMLCanvasElement and return it as a PNG data URL.
 *  Used by ImageOverlay to paint the source-image pixels at the moved
 *  position. The returned URL is suitable as a CSS `background-image`. */
function cropCanvasToDataUrl(
  src: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  if (w <= 0 || h <= 0) return null;
  // Account for high-DPI rendering: pdf.js sets canvas.width / height in
  // device pixels (often = css pixels × scale), while the (left, top, w,
  // h) we received are in CSS pixels. Re-scale so we crop the right
  // region of the underlying bitmap.
  const sx = src.width / parseFloat(src.style.width || `${src.width}`);
  const sy = src.height / parseFloat(src.style.height || `${src.height}`);
  const dst = document.createElement("canvas");
  dst.width = Math.max(1, Math.round(w * sx));
  dst.height = Math.max(1, Math.round(h * sy));
  const ctx = dst.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(src, x * sx, y * sy, w * sx, h * sy, 0, 0, dst.width, dst.height);
    return dst.toDataURL("image/png");
  } catch {
    // Cross-origin canvases would taint here, but pdf.js renders into
    // our own canvas so this should never trip in practice.
    return null;
  }
}

/** Net-new text the user typed at a fresh position on the page (not
 *  associated with any source run). Click-to-edit, drag-to-move,
 *  Backspace on empty content deletes. Editing pops a formatting
 *  toolbar (font / size / B / I / U) above the input, identical to
 *  the EditField used for source-run edits. Saved by appending a
 *  drawText to the page content stream — see save.ts insertion path. */
function InsertedTextOverlay({
  ins,
  page,
  toolbarBlockers,
  isEditing,
  onChange,
  onDelete,
  onOpen,
  onClose,
}: {
  ins: TextInsertion;
  page: RenderedPage;
  toolbarBlockers: readonly ToolbarBlocker[];
  isEditing: boolean;
  onChange: (patch: Partial<TextInsertion>) => void;
  onDelete: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Style state is in the parent (TextInsertion.style + .fontSize),
  // mirrored here in convenience locals so the render stays readable.
  const style = ins.style ?? {};
  // Pick a sensible default per script if no explicit family was set
  // — Faruma when the typed text contains Thaana, otherwise Arial.
  const isRtlText = /[֐-׿؀-ۿހ-޿]/u.test(ins.text);
  const family = style.fontFamily ?? (isRtlText ? "Faruma" : "Arial");
  const bold = !!style.bold;
  const italic = !!style.italic;
  const underline = !!style.underline;
  const fontSizePt = ins.fontSize;
  const fontSizePx = fontSizePt * page.scale;
  // PDF user-space (pdfX, pdfY) is the BASELINE of the text. The
  // viewport top of the box is baseline - fontSize, scaled. Match the
  // EditField rendering: render text in a box of height = fontSize × 1.4
  // so descenders fit.
  const lineHeight = fontSizePt * 1.4;
  const left = ins.pdfX * page.scale;
  const top = page.viewHeight - ins.pdfY * page.scale - fontSizePx;
  const width = Math.max(ins.pdfWidth * page.scale, 60);
  const height = lineHeight * page.scale;
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const updateStyle = (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  }) => {
    // fontSize lives outside `style` (it's a top-level field on the
    // insertion since it's also used to derive the box height); split
    // the patch accordingly.
    const nextStyle: typeof style = { ...style };
    if (patch.fontFamily !== undefined) nextStyle.fontFamily = patch.fontFamily;
    if (patch.bold !== undefined) nextStyle.bold = patch.bold;
    if (patch.italic !== undefined) nextStyle.italic = patch.italic;
    if (patch.underline !== undefined) nextStyle.underline = patch.underline;
    const insPatch: Partial<TextInsertion> = { style: nextStyle };
    if (patch.fontSize !== undefined) insPatch.fontSize = patch.fontSize;
    onChange(insPatch);
  };

  const startDrag = (e: React.MouseEvent) => {
    if (isEditing) return;
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: ins.pdfX,
      baseY: ins.pdfY,
    };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxView = ev.clientX - d.startX;
      const dyView = ev.clientY - d.startY;
      onChange({
        pdfX: d.baseX + dxView / page.scale,
        // viewport y-down → PDF y-up: subtract.
        pdfY: d.baseY - dyView / page.scale,
      });
    };
    const onUp = (ev: MouseEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Cross-page drop: re-key onto the target page in App. Convert
      // the overlay's screen position to the target page's PDF coords
      // (baseline x; baseline y is fontSizePx ABOVE the box top).
      if (!d) return;
      const hit = findPageAtPoint(ev.clientX, ev.clientY);
      if (!hit || hit.pageIndex === ins.pageIndex) return;
      const originRect = document
        .querySelector<HTMLElement>(`[data-page-index="${ins.pageIndex}"]`)
        ?.getBoundingClientRect();
      if (!originRect) return;
      const dxView = ev.clientX - d.startX;
      const dyView = ev.clientY - d.startY;
      const pdfXOrigin = d.baseX + dxView / page.scale;
      const pdfYOrigin = d.baseY - dyView / page.scale;
      const overlayScreenLeft = originRect.left + pdfXOrigin * page.scale;
      const overlayScreenTopBox =
        originRect.top + page.viewHeight - pdfYOrigin * page.scale - fontSizePx;
      const targetFontSizePx = ins.fontSize * hit.scale;
      const targetPdfX = (overlayScreenLeft - hit.rect.left) / hit.scale;
      const targetPdfY =
        (hit.viewHeight - (overlayScreenTopBox - hit.rect.top) - targetFontSizePx) / hit.scale;
      onChange({
        sourceKey: hit.sourceKey,
        pageIndex: hit.pageIndex,
        pdfX: targetPdfX,
        pdfY: targetPdfY,
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      {isEditing ? (
        <EditTextToolbar
          left={left - 2}
          top={chooseToolbarTop({
            editorLeft: left - 2,
            editorTop: top,
            editorBottom: top + height,
            blockers: toolbarBlockers,
            selfId: ins.id,
          })}
          fontFamily={family}
          fontSize={fontSizePt}
          bold={bold}
          italic={italic}
          underline={underline}
          onChange={(patch) => {
            // Toolbar already reports fontSize in PDF points — store
            // it directly on the insertion, no scale conversion.
            updateStyle(patch);
          }}
          onCancel={() => {
            if (ins.text === "") onDelete();
            onClose();
          }}
          onDelete={() => {
            onDelete();
            onClose();
          }}
        />
      ) : null}
      <div
        data-text-insert-id={ins.id}
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          outline: isEditing
            ? "1px solid rgba(40, 130, 255, 0.85)"
            : "1px dashed rgba(40, 130, 255, 0.5)",
          background: isEditing ? "rgba(255, 255, 255, 0.9)" : "transparent",
          cursor: isEditing ? "text" : "grab",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          zIndex: 20,
        }}
        onMouseDown={startDrag}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onOpen();
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            dir="auto"
            value={ins.text}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              padding: "0 4px",
              fontFamily: `"${family}"`,
              fontSize: `${fontSizePx}px`,
              lineHeight: `${height}px`,
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? "italic" : "normal",
              textDecoration: underline ? "underline" : "none",
              background: "transparent",
            }}
            onChange={(e) => onChange({ text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onClose();
              } else if (e.key === "Escape") {
                if (ins.text === "") onDelete();
                onClose();
              } else if (e.key === "Backspace" && ins.text === "") {
                e.preventDefault();
                onDelete();
                onClose();
              }
            }}
            onBlur={(e) => {
              if (isFocusMovingToToolbar(e.relatedTarget)) return;
              if (ins.text === "") onDelete();
              onClose();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            dir="auto"
            style={{
              fontFamily: `"${family}"`,
              fontSize: `${fontSizePx}px`,
              lineHeight: `${height}px`,
              fontWeight: bold ? 700 : 400,
              fontStyle: italic ? "italic" : "normal",
              textDecoration: underline ? "underline" : "none",
              paddingLeft: 4,
              paddingRight: 4,
              color: "black",
              whiteSpace: "pre",
              width: "100%",
            }}
            title={ins.text || "(empty — click to type)"}
          >
            {ins.text || " "}
          </span>
        )}
      </div>
    </>
  );
}

/** Net-new image the user dropped onto the page. Drag to move; double-
 *  click to delete. The bytes ride along in state until save embeds
 *  them. We render a CSS background-image from a data URL so the
 *  preview matches what the saved PDF will show. */
function InsertedImageOverlay({
  ins,
  page,
  isSelected,
  onChange,
  onDelete,
  onSelect,
}: {
  ins: ImageInsertion;
  page: RenderedPage;
  isSelected: boolean;
  onChange: (patch: Partial<ImageInsertion>) => void;
  onDelete: () => void;
  onSelect: () => void;
}) {
  // Encode the chosen image as a base64 data URL once. We deliberately
  // avoid `URL.createObjectURL` here — its companion revoke needs to
  // run on a true unmount, but React 19 StrictMode does a synthetic
  // mount→unmount→mount in dev that fires the revoke before the
  // browser ever paints the background-image, leaving an empty
  // placeholder. data: URLs have no lifecycle to manage.
  const dataUrl = useMemo(() => {
    let s = "";
    for (let i = 0; i < ins.bytes.length; i++) {
      s += String.fromCharCode(ins.bytes[i]);
    }
    return `data:image/${ins.format};base64,${btoa(s)}`;
  }, [ins.bytes, ins.format]);

  const left = ins.pdfX * page.scale;
  const top = page.viewHeight - (ins.pdfY + ins.pdfHeight) * page.scale;
  const w = ins.pdfWidth * page.scale;
  const h = ins.pdfHeight * page.scale;

  const startDrag = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseX = ins.pdfX;
    const baseY = ins.pdfY;
    const onMove = (ev: MouseEvent) => {
      const dxView = ev.clientX - startX;
      const dyView = ev.clientY - startY;
      onChange({
        pdfX: baseX + dxView / page.scale,
        pdfY: baseY - dyView / page.scale,
      });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Cross-page drop: re-key onto the target page in App.
      const hit = findPageAtPoint(ev.clientX, ev.clientY);
      if (!hit || hit.pageIndex === ins.pageIndex) return;
      const originRect = document
        .querySelector<HTMLElement>(`[data-page-index="${ins.pageIndex}"]`)
        ?.getBoundingClientRect();
      if (!originRect) return;
      const dxView = ev.clientX - startX;
      const dyView = ev.clientY - startY;
      const pdfXOrigin = baseX + dxView / page.scale;
      const pdfYOrigin = baseY - dyView / page.scale;
      // ins.pdfY is the BOTTOM of the box; the overlay's screen top is
      // originRect.top + (page.viewHeight - (pdfY + pdfHeight) * scale).
      const overlayScreenLeft = originRect.left + pdfXOrigin * page.scale;
      const overlayScreenTopBox =
        originRect.top + page.viewHeight - (pdfYOrigin + ins.pdfHeight) * page.scale;
      const targetPdfX = (overlayScreenLeft - hit.rect.left) / hit.scale;
      const heightView = ins.pdfHeight * hit.scale;
      // Bottom-left in PDF y-up = (viewHeight - viewBottom) / scale.
      const targetViewBottom = overlayScreenTopBox - hit.rect.top + heightView;
      const targetPdfY = (hit.viewHeight - targetViewBottom) / hit.scale;
      onChange({
        sourceKey: hit.sourceKey,
        pageIndex: hit.pageIndex,
        pdfX: targetPdfX,
        pdfY: targetPdfY,
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Resize from any of the 4 corners. Math is in PDF user space (y-up):
  // ins.pdfY is the BOTTOM of the box, ins.pdfY+pdfHeight is the top.
  // Each handle anchors the OPPOSITE corner so the box grows/shrinks
  // toward the dragged corner.
  const startResize = (corner: "tl" | "tr" | "bl" | "br") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const base = {
      x: ins.pdfX,
      y: ins.pdfY,
      w: ins.pdfWidth,
      h: ins.pdfHeight,
    };
    const MIN = 10;
    const onMove = (ev: MouseEvent) => {
      const dxPdf = (ev.clientX - startX) / page.scale;
      // Viewport y is y-down, PDF is y-up — drag DOWN means -dyPdf.
      const dyPdf = -(ev.clientY - startY) / page.scale;
      let { x, y } = base;
      let nw = base.w;
      let nh = base.h;
      switch (corner) {
        case "br": // anchor TL: x stays, y+h stays
          nw = Math.max(MIN, base.w + dxPdf);
          nh = Math.max(MIN, base.h - dyPdf);
          y = base.y + base.h - nh;
          break;
        case "tr": // anchor BL: x stays, y stays
          nw = Math.max(MIN, base.w + dxPdf);
          nh = Math.max(MIN, base.h + dyPdf);
          break;
        case "tl": // anchor BR: x+w stays, y stays
          nw = Math.max(MIN, base.w - dxPdf);
          nh = Math.max(MIN, base.h + dyPdf);
          x = base.x + base.w - nw;
          break;
        case "bl": // anchor TR: x+w stays, y+h stays
          nw = Math.max(MIN, base.w - dxPdf);
          nh = Math.max(MIN, base.h - dyPdf);
          x = base.x + base.w - nw;
          y = base.y + base.h - nh;
          break;
      }
      onChange({ pdfX: x, pdfY: y, pdfWidth: nw, pdfHeight: nh });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      data-image-insert-id={ins.id}
      style={{
        position: "absolute",
        left,
        top,
        width: w,
        height: h,
        backgroundImage: `url(${dataUrl})`,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        outline: isSelected
          ? "2px solid rgba(220, 50, 50, 0.85)"
          : "1px dashed rgba(40, 130, 255, 0.6)",
        cursor: "grab",
        pointerEvents: "auto",
        zIndex: 20,
      }}
      title={`Inserted image (drag corners to resize, click to select then Del to delete)`}
      onMouseDown={startDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <ResizeHandle position="tl" onMouseDown={startResize("tl")} />
      <ResizeHandle position="tr" onMouseDown={startResize("tr")} />
      <ResizeHandle position="bl" onMouseDown={startResize("bl")} />
      <ResizeHandle position="br" onMouseDown={startResize("br")} />
    </div>
  );
}

/** Square corner handle for resizing image overlays. Sits flush against
 *  the corner INSIDE the box so it's never clipped by the page-level
 *  container's bounds (matters for images near the page edge). The
 *  square overlaps the drag-to-move surface, but its higher z-index
 *  and earlier mousedown hit-test wins out when the cursor is on it. */
function ResizeHandle({
  position,
  onMouseDown,
}: {
  position: "tl" | "tr" | "bl" | "br";
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const SIZE = 10;
  const style: React.CSSProperties = {
    position: "absolute",
    width: SIZE,
    height: SIZE,
    background: "white",
    border: "1px solid rgba(40, 130, 255, 0.9)",
    boxSizing: "border-box",
    pointerEvents: "auto",
    zIndex: 21,
  };
  if (position === "tl") {
    style.left = 0;
    style.top = 0;
    style.cursor = "nwse-resize";
  } else if (position === "tr") {
    style.right = 0;
    style.top = 0;
    style.cursor = "nesw-resize";
  } else if (position === "bl") {
    style.left = 0;
    style.bottom = 0;
    style.cursor = "nesw-resize";
  } else {
    style.right = 0;
    style.bottom = 0;
    style.cursor = "nwse-resize";
  }
  return (
    <div
      data-resize-handle={position}
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

function EditField({
  run,
  pageScale,
  toolbarBlockers,
  initial,
  onCommit,
  onCancel,
  onDelete,
}: {
  run: TextRun;
  /** Viewport pixels per PDF point — used to convert between the
   *  toolbar's user-facing PDF-point size and the CSS pixel size for
   *  rendering. */
  pageScale: number;
  /** Page-local rects the formatting toolbar must avoid — see
   *  `chooseToolbarTop`. The run being edited is included; the helper
   *  filters it out via `selfId`. */
  toolbarBlockers: readonly ToolbarBlocker[];
  initial: EditValue;
  onCommit: (value: EditValue) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [text, setText] = useState(initial.text);
  // Editor opens at the run's CURRENT position (= original bounds + any
  // committed move offset). Otherwise dragging-then-clicking opens the
  // input at the original spot, which is jarring.
  const dx = initial.dx ?? 0;
  const dy = initial.dy ?? 0;
  const [style, setStyle] = useState<EditStyle>(initial.style ?? {});
  const [width, setWidth] = useState<number>(Math.max(run.bounds.width + 24, 80));

  // Default everything to the run's source-detected formatting; the
  // toolbar overrides take precedence when explicitly set.
  const effectiveFamily = style.fontFamily ?? run.fontFamily;
  const fontFamilyCss = `"${effectiveFamily}"`;
  const effectiveBold = style.bold ?? run.bold;
  const effectiveItalic = style.italic ?? run.italic;
  // style.fontSize is stored in PDF points (the same unit as the saved
  // PDF). Default to the run's measured height, which buildTextRuns
  // returns in viewport pixels — divide by scale to convert.
  const defaultFontSizePt = run.height / pageScale;
  const fontSizePt = style.fontSize ?? defaultFontSizePt;
  const fontSizePx = fontSizePt * pageScale;

  const remeasure = () => {
    const node = measureRef.current;
    if (!node) return;
    setWidth(Math.max(run.bounds.width, node.offsetWidth) + 24);
  };

  useEffect(() => {
    if (measureRef.current) measureRef.current.textContent = text || " ";
    inputRef.current?.focus();
    inputRef.current?.select();
    remeasure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => onCommit({ text, style: hasStyle(style) ? style : undefined });

  return (
    <>
      <span
        ref={measureRef}
        aria-hidden
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "pre",
          fontFamily: fontFamilyCss,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${run.bounds.height}px`,
          fontWeight: effectiveBold ? 700 : 400,
          fontStyle: effectiveItalic ? "italic" : "normal",
          left: -9999,
          top: -9999,
        }}
      />
      <EditTextToolbar
        left={run.bounds.left - 2 + dx}
        top={chooseToolbarTop({
          editorLeft: run.bounds.left - 2 + dx,
          editorTop: run.bounds.top - 2 + dy,
          editorBottom: run.bounds.top + run.bounds.height + 2 + dy,
          blockers: toolbarBlockers,
          selfId: run.id,
        })}
        fontFamily={effectiveFamily}
        fontSize={fontSizePt}
        bold={effectiveBold}
        italic={effectiveItalic}
        underline={!!style.underline}
        onChange={(patch) =>
          setStyle((s) => {
            const next: EditStyle = { ...s };
            if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
            // Toolbar's value is in PDF points — store as-is.
            if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
            if (patch.bold !== undefined) next.bold = patch.bold;
            if (patch.italic !== undefined) next.italic = patch.italic;
            if (patch.underline !== undefined) next.underline = patch.underline;
            return next;
          })
        }
        onCancel={onCancel}
        onDelete={onDelete}
      />
      <input
        ref={inputRef}
        value={text}
        dir="auto"
        data-run-id={run.id}
        data-editor
        style={{
          position: "absolute",
          left: run.bounds.left - 2 + dx,
          top: run.bounds.top - 2 + dy,
          width,
          height: run.bounds.height + 4,
          fontFamily: fontFamilyCss,
          fontSize: `${fontSizePx}px`,
          lineHeight: `${run.bounds.height}px`,
          fontWeight: effectiveBold ? 700 : 400,
          fontStyle: effectiveItalic ? "italic" : "normal",
          textDecoration: style.underline ? "underline" : "none",
          padding: "0 4px",
          border: "none",
          outline: "2px solid rgb(59, 130, 246)",
          background: "white",
          pointerEvents: "auto",
          boxSizing: "border-box",
        }}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          if (measureRef.current) measureRef.current.textContent = v || " ";
          remeasure();
        }}
        onChange={() => {}}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={(e) => {
          // Don't commit when focus is just moving into the floating
          // toolbar (font picker / size / B-I-U). The user is mid-edit;
          // commit would close the editor and undo their change.
          if (isFocusMovingToToolbar(e.relatedTarget)) return;
          commit();
        }}
      />
    </>
  );
}

/** True when the user has explicitly set ANY of the toolbar's style
 *  fields. We deliberately use `!== undefined` rather than truthiness
 *  so that `bold: false` / `italic: false` / `underline: false`
 *  count as a change — that's the toggle-off-an-already-bold-run
 *  case where the override would otherwise get stripped on commit
 *  and the original run.bold would silently come back. */
function hasStyle(s: EditStyle): boolean {
  return (
    s.fontFamily !== undefined ||
    s.fontSize !== undefined ||
    s.bold !== undefined ||
    s.italic !== undefined ||
    s.underline !== undefined
  );
}

/** True when a `blur` event is moving focus into the formatting
 *  toolbar (so the editor should stay open). Caller passes the blur
 *  event's `relatedTarget`. */
function isFocusMovingToToolbar(next: EventTarget | null): boolean {
  return next instanceof HTMLElement && !!next.closest("[data-edit-toolbar]");
}

/** Approximate footprint of `EditTextToolbar` in page-local pixels.
 *  Used by `chooseToolbarPosition` to decide if the default position
 *  (above the editor) would overlap a neighbouring run. The actual
 *  rendered toolbar grows slightly when a long font name is selected,
 *  but the dominant variability is the font dropdown — 432px covers
 *  the usual case (Times New Roman / Faruma / etc.). */
const TOOLBAR_HEIGHT_PX = 42;
const TOOLBAR_WIDTH_PX = 432;
const TOOLBAR_GAP_PX = 6;

export type ToolbarBlocker = {
  /** id of the run / inserted text the blocker rect comes from. The
   *  caller uses this to skip the run currently being edited. */
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/** Decide whether the formatting toolbar should sit above or below the
 *  editor. Returns the top in the same page-local pixel space the rest
 *  of the overlays use. The default is above; we flip below when the
 *  above-position would overlap a neighbouring text element on the
 *  same page (the case the user hit on maldivian2.pdf, where the
 *  paragraph being edited sat directly under the registration URL run
 *  and the 42-px toolbar extended up over the URL). */
function chooseToolbarTop({
  editorLeft,
  editorTop,
  editorBottom,
  blockers,
  selfId,
}: {
  editorLeft: number;
  editorTop: number;
  editorBottom: number;
  blockers: readonly ToolbarBlocker[];
  selfId: string;
}): number {
  const aboveTop = editorTop - TOOLBAR_HEIGHT_PX - TOOLBAR_GAP_PX;
  const belowTop = editorBottom + TOOLBAR_GAP_PX;
  const right = editorLeft + TOOLBAR_WIDTH_PX;
  const overlaps = (top: number) => {
    const bottom = top + TOOLBAR_HEIGHT_PX;
    for (const b of blockers) {
      if (b.id === selfId) continue;
      if (b.right <= editorLeft) continue;
      if (b.left >= right) continue;
      if (b.bottom <= top) continue;
      if (b.top >= bottom) continue;
      return true;
    }
    return false;
  };
  if (!overlaps(aboveTop)) return aboveTop;
  if (!overlaps(belowTop)) return belowTop;
  // Both sides overlap — uncommon (the page is densely packed). Fall
  // back to the default (above) so the toolbar at least keeps its
  // usual relationship to the editor.
  return aboveTop;
}

/** Shared formatting toolbar — font picker, size, B / I / U toggles, X.
 *  Used by both the existing-run EditField and the InsertedTextOverlay
 *  so a brand-new text box has the exact same controls as an inline
 *  edit on a source-PDF run. */
function EditTextToolbar({
  left,
  top,
  fontFamily,
  fontSize,
  bold,
  italic,
  underline,
  onChange,
  onCancel,
  onDelete,
}: {
  /** Viewport-pixel position of the toolbar's top-left corner. */
  left: number;
  top: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  onChange: (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  }) => void;
  onCancel?: () => void;
  /** When provided, renders a trash button. Source-run deletion sets
   *  `deleted=true` on the stored EditValue; inserted-text deletion
   *  removes the entry from its slot bucket. */
  onDelete?: () => void;
}) {
  return (
    <div
      data-edit-toolbar
      // Theme-aware colours: HeroUI's ToggleButton honours the `.dark`
      // class (added by useTheme()) and renders dark fills there. The
      // wrapper used to hard-code `background: "white"`, which made the
      // panel jarringly bright around dark-filled buttons when the user
      // was in dark mode (the "all toggled, font empty" symptom). Match
      // the rest of the chrome (PageSidebar tile / sidebar) by switching
      // to Tailwind dark-variants. `color-scheme: dark` on the wrapper
      // also makes the native <select> dropdown arrow + <input>
      // up/down spinner pick the OS dark UI.
      className="border border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
      style={{
        position: "absolute",
        left,
        top,
        zIndex: 30,
        display: "flex",
        gap: 4,
        padding: 4,
        borderRadius: 6,
        alignItems: "center",
        pointerEvents: "auto",
        whiteSpace: "nowrap",
      }}
      // We do NOT preventDefault on mouseDown here — the native <select>
      // dropdown won't open if its focus change is suppressed. Instead
      // each input's onBlur checks `relatedTarget`: if the new focus
      // target lives inside `[data-edit-toolbar]`, the editor stays
      // open. See `isFocusMovingToToolbar` below.
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      <select
        aria-label="Font"
        value={fontFamily}
        className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
        style={{
          padding: "4px 6px",
          borderRadius: 4,
          fontSize: 12,
          minWidth: 140,
        }}
        onChange={(e) => onChange({ fontFamily: e.target.value })}
      >
        {FONTS.map((f) => (
          <option key={f.family} value={f.family}>
            {f.label}
          </option>
        ))}
      </select>
      <input
        aria-label="Font size"
        type="number"
        min={6}
        max={144}
        step={1}
        value={Math.round(fontSize)}
        className="border border-zinc-300 bg-white text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-100"
        style={{
          width: 56,
          padding: "4px 6px",
          borderRadius: 4,
          fontSize: 12,
        }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange({ fontSize: v });
        }}
      />
      <StyleToggle
        label="Bold"
        isSelected={bold}
        onChange={(v) => onChange({ bold: v })}
        icon={<Bold size={14} strokeWidth={2.5} />}
      />
      <StyleToggle
        label="Italic"
        isSelected={italic}
        onChange={(v) => onChange({ italic: v })}
        icon={<Italic size={14} />}
      />
      <StyleToggle
        label="Underline"
        isSelected={underline}
        onChange={(v) => onChange({ underline: v })}
        icon={<Underline size={14} />}
      />
      {onDelete ? (
        <Button
          isIconOnly
          size="sm"
          variant="danger-soft"
          onPress={() => onDelete()}
          aria-label="Delete text (Del)"
        >
          <Trash2 size={14} />
        </Button>
      ) : null}
      {onCancel ? (
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={() => onCancel()}
          aria-label="Cancel edit"
        >
          <X size={14} />
        </Button>
      ) : null}
    </div>
  );
}

/** Wrapper around HeroUI's ToggleButton that suppresses focus-shift on
 *  mousedown — the editor's input must keep focus when the user clicks
 *  B/I/U, otherwise typing breaks mid-style. */
function StyleToggle({
  label,
  isSelected,
  onChange,
  icon,
}: {
  label: string;
  isSelected: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
}) {
  return (
    <HeroToggleButton
      isIconOnly
      size="sm"
      isSelected={isSelected}
      onChange={onChange}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
    >
      {icon}
    </HeroToggleButton>
  );
}
