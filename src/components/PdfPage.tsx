import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, ToggleButton as HeroToggleButton } from "@heroui/react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bold,
  Italic,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import type { RenderedPage, TextRun } from "../lib/pdf";
import type { EditStyle } from "../lib/save";
import type { ImageInsertion, TextInsertion } from "../lib/insertions";
import type { ToolMode } from "../App";
import { FONTS } from "../lib/fonts";
import { clickSuppressMs, useDragGesture } from "../lib/useDragGesture";
import { useIsMobile } from "../lib/useMediaQuery";

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
 *  cross-source draws to the right `doc`.
 *
 *  Post-fit-to-width: the queried element's `getBoundingClientRect()`
 *  returns the DISPLAYED rect (page.viewWidth × displayScale). The
 *  natural `viewWidth/viewHeight` are read from the data attributes;
 *  `effectiveScale = page.scale * displayScale` is the pdf-user-space
 *  → displayed-screen-pixels ratio. Callers convert screen deltas to
 *  PDF by dividing by `effectiveScale` and convert positions inside
 *  the rect (e.g. `clientY - rect.top`) the same way. */
function findPageAtPoint(
  clientX: number,
  clientY: number,
): {
  pageIndex: number;
  sourceKey: string;
  /** pdf user space → NATURAL viewport pixel ratio (== `page.scale`). */
  scale: number;
  /** screen-pixel size of the displayed rect. Equal to natural × displayScale. */
  rect: DOMRect;
  /** Natural viewport dimensions (pre-displayScale) — kept for callers
   *  that compute persisted offsets in natural pixels. */
  viewWidth: number;
  viewHeight: number;
  /** Displayed-pixel dimensions (= rect.width / rect.height). */
  displayedWidth: number;
  displayedHeight: number;
  /** Natural-to-displayed ratio (= rect.width / viewWidth). 1 on desktop. */
  displayScale: number;
  /** pdf user space → DISPLAYED screen-pixel ratio (= scale * displayScale).
   *  Use this when converting a (clientX, clientY) coord inside `rect`
   *  to PDF user space — it folds in both render scale and the
   *  fit-to-width transform. */
  effectiveScale: number;
} | null {
  const els = document.querySelectorAll<HTMLElement>("[data-page-index]");
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
      const idx = parseInt(el.dataset.pageIndex ?? "", 10);
      const scale = parseFloat(el.dataset.pageScale ?? "");
      const sourceKey = el.dataset.sourceKey ?? "";
      const naturalW = parseFloat(el.dataset.viewWidth ?? "");
      const naturalH = parseFloat(el.dataset.viewHeight ?? "");
      if (
        Number.isNaN(idx) ||
        Number.isNaN(scale) ||
        sourceKey === "" ||
        Number.isNaN(naturalW) ||
        Number.isNaN(naturalH)
      ) {
        continue;
      }
      const displayScale = naturalW > 0 ? r.width / naturalW : 1;
      return {
        pageIndex: idx,
        sourceKey,
        scale,
        rect: r,
        viewWidth: naturalW,
        viewHeight: naturalH,
        displayedWidth: r.width,
        displayedHeight: r.height,
        displayScale,
        effectiveScale: scale * displayScale,
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
  /** Outer layout wrapper. Reserves display-pixel space for the page
   *  (= natural × displayScale) so the document scroll container can
   *  size itself correctly. The actual page chrome lives on
   *  `containerRef` (the inner natural-size div) which is CSS-
   *  transformed by `displayScale` to fit. Children stay in NATURAL
   *  CSS pixels — only the conversion from screen-pixel input
   *  (cursor / finger) is wrapped through `displayScale`. */
  const fitRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Scale applied to the inner natural-size container so the page
   *  fits the available scroll-container width. 1 on desktop where
   *  the page already fits; <1 on mobile where it doesn't. */
  const [displayScale, setDisplayScale] = useState(1);

  // Compute displayScale synchronously before paint via
  // useLayoutEffect so the first frame already shows the page at the
  // correct scale. With a plain useEffect the first paint renders
  // the OUTER at natural width (918px on US-Letter), spilling out of
  // the mobile viewport and triggering a one-frame horizontal scroll
  // before the corrected scale gets applied — visible to the user
  // as a flash of overflow.
  useLayoutEffect(() => {
    const outer = fitRef.current;
    if (!outer) return;
    // Find the nearest scroll container — App's <main> with
    // `overflow: auto`. The immediate parent of `outer` is a flex
    // item that shrinks to fit its content (i.e. tracks displayScale
    // itself), so observing it would create a feedback loop where
    // displayScale stays at 1 forever. <main>'s clientWidth is the
    // genuine available content area on screen, independent of the
    // page's own width.
    let scrollHost: HTMLElement | null = outer.parentElement;
    while (scrollHost && scrollHost !== document.body) {
      const cs = window.getComputedStyle(scrollHost);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll" || scrollHost.tagName === "MAIN") {
        break;
      }
      scrollHost = scrollHost.parentElement;
    }
    if (!scrollHost || scrollHost === document.body) {
      // Fall back to the document element if no auto-overflow
      // ancestor was found (shouldn't happen — <main> is in App's
      // tree — but the fallback keeps the page renderable).
      scrollHost = document.documentElement;
    }
    const host = scrollHost;
    const compute = () => {
      // clientWidth excludes the vertical scrollbar (good — we don't
      // want to render under it) but includes the host's own padding.
      // Subtract horizontal padding so the page fits exactly inside
      // the visible content area.
      const cs = window.getComputedStyle(host);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const available = host.clientWidth - padX;
      if (available <= 0 || !page.viewWidth) return;
      const next = Math.min(1, available / page.viewWidth);
      setDisplayScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(host);
    return () => ro.disconnect();
  }, [page.viewWidth]);

  /** Read the current displayScale at gesture start. Stable through
   *  the gesture (we don't want a window resize mid-drag to retarget
   *  the deltas). */
  const readDisplayScale = (): number => {
    const inner = containerRef.current;
    if (!inner) return displayScale;
    const r = inner.getBoundingClientRect();
    return page.viewWidth > 0 ? r.width / page.viewWidth : 1;
  };

  const setEditingId = (next: string | null) => {
    onEditingChange(next);
  };
  /** While dragging a run, the live offset for the dragged run. We keep
   *  it in local state during the drag so we don't churn the parent's
   *  edits Map on every pointermove. The hook owns startX/startY so
   *  this state only carries the live (dx, dy) the renderer reads. */
  const [drag, setDrag] = useState<{
    runId: string;
    dx: number;
    dy: number;
  } | null>(null);
  /** Same idea for images. Separate state because image drags don't
   *  have the click-suppression / edit handoff that text runs do.
   *  Carries a resize corner when the gesture is a corner drag — null
   *  means whole-image translate. */
  const [imageDrag, setImageDrag] = useState<{
    imageId: string;
    dx: number;
    dy: number;
    dw: number;
    dh: number;
    corner: ResizeCorner | null;
  } | null>(null);
  /** Set to the runId during a drag and cleared a tick after pointerup,
   *  used to suppress the click-to-edit that would otherwise fire after
   *  a drag (Playwright's synthesised events don't match the browser's
   *  native click-suppression on movement, so we guard explicitly). */
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

  /** Start a drag on a run. The hook tracks the gesture on `window` so
   *  it survives the cursor / finger leaving the original span (the
   *  cross-page drop hit-test depends on this).
   *
   *  `originDisplayScale` is captured at start so screen-pixel deltas
   *  from the pointer get converted into NATURAL viewport pixels —
   *  the unit dx/dy is persisted in. With displayScale < 1 (mobile
   *  fit-to-width), a 100px finger swipe corresponds to ~240 natural
   *  pixels of run translation, matching the visual scale-up. */
  type RunDragCtx = {
    runId: string;
    base: { dx: number; dy: number };
    originRect: DOMRect | null;
    originDisplayScale: number;
  };
  const beginRunDrag = useDragGesture<RunDragCtx>({
    onStart: (ctx) => {
      setDrag({ runId: ctx.runId, dx: ctx.base.dx, dy: ctx.base.dy });
    },
    onMove: (ctx, info) => {
      const dxNat = info.dxRaw / ctx.originDisplayScale;
      const dyNat = info.dyRaw / ctx.originDisplayScale;
      const newDx = ctx.base.dx + dxNat;
      const newDy = ctx.base.dy + dyNat;
      setDrag((prev) =>
        prev && prev.runId === ctx.runId ? { ...prev, dx: newDx, dy: newDy } : prev,
      );
    },
    onEnd: (ctx, info) => {
      const { runId, base, originRect, originDisplayScale } = ctx;
      const totalDx = base.dx + info.dxRaw / originDisplayScale;
      const totalDy = base.dy + info.dyRaw / originDisplayScale;
      setDrag(null);
      if (!info.moved) return; // treat as click — caller's onClick handles it
      // Suppress the click that fires immediately after pointerup so we
      // don't drop into the editor right after a drag. Touch pointers
      // get a longer window because iOS' synthesised click is delayed.
      justDraggedRef.current = runId;
      const suppressMs = clickSuppressMs(info.pointerType);
      setTimeout(() => {
        if (justDraggedRef.current === runId) justDraggedRef.current = null;
      }, suppressMs);
      const run = page.textRuns.find((r) => r.id === runId);
      if (!run) return;
      const existing = edits.get(runId) ?? { text: run.text };
      // Cross-page detection: if the cursor landed on a different page
      // than this run's origin, persist absolute target-page baseline
      // coords too. Save uses them to strip-on-origin + draw-on-target.
      const hit = originRect ? findPageAtPoint(info.clientX, info.clientY) : null;
      if (hit && originRect && hit.pageIndex !== pageIndex) {
        // Source-page natural-pixel positions (run.bounds.left, baselineY,
        // totalDx, totalDy) projected to screen coords via the source's
        // displayScale; then back to PDF user space on the TARGET page
        // via `effectiveScale = scale * displayScale`.
        const screenBaselineX = originRect.left + (run.bounds.left + totalDx) * originDisplayScale;
        const screenBaselineY = originRect.top + (run.baselineY + totalDy) * originDisplayScale;
        const targetViewX = screenBaselineX - hit.rect.left;
        const targetViewY = screenBaselineY - hit.rect.top;
        const targetPdfX = targetViewX / hit.effectiveScale;
        const targetPdfY = (hit.displayedHeight - targetViewY) / hit.effectiveScale;
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
    },
    onCancel: () => setDrag(null),
  });
  const startDrag = (runId: string, e: React.PointerEvent, base: { dx: number; dy: number }) => {
    beginRunDrag(e, {
      runId,
      base,
      originRect: containerRef.current?.getBoundingClientRect() ?? null,
      originDisplayScale: readDisplayScale(),
    });
  };

  /** Start a translate drag on an image overlay. Mirrors startDrag for
   *  runs but commits to the parent's onImageMove rather than onEdit.
   *  Width/height deltas (dw/dh) are passed through unchanged so the
   *  user's earlier resize survives a subsequent move. */
  type ImageDragCtx = {
    imageId: string;
    base: { dx: number; dy: number; dw: number; dh: number };
    originRect: DOMRect | null;
    originDisplayScale: number;
  };
  const beginImageDrag = useDragGesture<ImageDragCtx>({
    onStart: (ctx) => {
      setImageDrag({
        imageId: ctx.imageId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        dw: ctx.base.dw,
        dh: ctx.base.dh,
        corner: null,
      });
    },
    onMove: (ctx, info) => {
      const dxNat = info.dxRaw / ctx.originDisplayScale;
      const dyNat = info.dyRaw / ctx.originDisplayScale;
      const newDx = ctx.base.dx + dxNat;
      const newDy = ctx.base.dy + dyNat;
      setImageDrag((prev) =>
        prev && prev.imageId === ctx.imageId ? { ...prev, dx: newDx, dy: newDy } : prev,
      );
    },
    onEnd: (ctx, info) => {
      const { imageId, base, originRect, originDisplayScale } = ctx;
      const totalDx = base.dx + info.dxRaw / originDisplayScale;
      const totalDy = base.dy + info.dyRaw / originDisplayScale;
      setImageDrag(null);
      if (!info.moved) return;
      const img = page.images.find((i) => i.id === imageId);
      const hit = originRect && img ? findPageAtPoint(info.clientX, info.clientY) : null;
      if (hit && originRect && img && hit.pageIndex !== pageIndex) {
        const origLeft = img.pdfX * page.scale;
        const origTopView = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
        const dwPdf = base.dw / page.scale;
        const dhPdf = base.dh / page.scale;
        const newW = img.pdfWidth + dwPdf;
        const newH = img.pdfHeight + dhPdf;
        // Effective box top on origin page after move + resize (matches
        // ImageOverlay's boxTop = top + dy - dh). Natural→screen via
        // origin's displayScale; screen→target-PDF via hit.effectiveScale.
        const screenLeft = originRect.left + (origLeft + totalDx) * originDisplayScale;
        const screenTopBox =
          originRect.top + (origTopView + totalDy - base.dh) * originDisplayScale;
        const targetViewLeft = screenLeft - hit.rect.left;
        const targetViewTopBox = screenTopBox - hit.rect.top;
        // newH is in PDF units; on target page that's `newH * hit.effectiveScale`
        // displayed-screen pixels.
        const newHScreen = newH * hit.effectiveScale;
        const targetPdfX = targetViewLeft / hit.effectiveScale;
        const targetViewBottom = targetViewTopBox + newHScreen;
        const targetPdfY = (hit.displayedHeight - targetViewBottom) / hit.effectiveScale;
        // Width / height in PDF units are simply newW / newH.
        const targetPdfWidth = newW;
        const targetPdfHeight = newH;
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
    },
    onCancel: () => setImageDrag(null),
  });
  const startImageDrag = (
    imageId: string,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    beginImageDrag(e, {
      imageId,
      base,
      originRect: containerRef.current?.getBoundingClientRect() ?? null,
      originDisplayScale: readDisplayScale(),
    });
  };

  /** Start a resize drag from one of the 4 image corners. Anchors the
   *  opposite corner so the box grows/shrinks toward the cursor.
   *  dx/dy are viewport-pixel translations of the bottom-left (same
   *  convention as the move drag); dw/dh are viewport-pixel growth
   *  deltas — dh > 0 means image is taller. App.tsx converts to PDF
   *  units when emitting the cm op. */
  type ImageResizeCtx = {
    imageId: string;
    corner: ResizeCorner;
    base: { dx: number; dy: number; dw: number; dh: number };
    origW: number;
    origH: number;
    minView: number;
    /** Source page's natural→displayed ratio. Captured at start so
     *  every screen delta gets converted to natural pixels (the unit
     *  base.dw / dh / dx / dy live in). */
    originDisplayScale: number;
    /** Mutated inside onMove so onEnd has the latest computed deltas
     *  without depending on the (async) imageDrag setState having
     *  flushed. Initialised from `base` on start. */
    latest: { dx: number; dy: number; dw: number; dh: number };
  };
  const beginImageResize = useDragGesture<ImageResizeCtx>({
    onStart: (ctx) => {
      setImageDrag({
        imageId: ctx.imageId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        dw: ctx.base.dw,
        dh: ctx.base.dh,
        corner: ctx.corner,
      });
    },
    onMove: (ctx, info) => {
      const { base, corner, origW, origH, minView, originDisplayScale } = ctx;
      // Convert screen-pixel deltas to NATURAL viewport pixels — base.*
      // and origW / origH all live in natural CSS px.
      const dxNat = info.dxRaw / originDisplayScale;
      const dyNat = info.dyRaw / originDisplayScale;
      // Step 1: unclamped width/height growth.
      let nDw = base.dw;
      let nDh = base.dh;
      switch (corner) {
        case "br":
          nDw = base.dw + dxNat;
          nDh = base.dh + dyNat;
          break;
        case "tr":
          nDw = base.dw + dxNat;
          nDh = base.dh - dyNat;
          break;
        case "tl":
          nDw = base.dw - dxNat;
          nDh = base.dh - dyNat;
          break;
        case "bl":
          nDw = base.dw - dxNat;
          nDh = base.dh + dyNat;
          break;
      }
      // Step 2: clamp size so the viewport bbox stays ≥ MIN_VIEW.
      if (origW + nDw < minView) nDw = minView - origW;
      if (origH + nDh < minView) nDh = minView - origH;
      // Step 3: derive translation from the clamped size to keep the
      // anchored corner pinned. The relations come from
      //   anchor.left_x   stays → nDx = base.dx                (br, tr)
      //   anchor.right_x  stays → nDx = base.dx + (base.dw - nDw) (tl, bl)
      //   anchor.bottom_y stays → nDy = base.dy                  (tr, tl)
      //   anchor.top_y    stays → nDy = base.dy + (nDh - base.dh) (br, bl)
      let nDx = base.dx;
      let nDy = base.dy;
      if (corner === "tl" || corner === "bl") {
        nDx = base.dx + (base.dw - nDw);
      }
      if (corner === "br" || corner === "bl") {
        nDy = base.dy + (nDh - base.dh);
      }
      ctx.latest = { dx: nDx, dy: nDy, dw: nDw, dh: nDh };
      setImageDrag((prev) =>
        prev && prev.imageId === ctx.imageId
          ? { ...prev, dx: nDx, dy: nDy, dw: nDw, dh: nDh }
          : prev,
      );
    },
    onEnd: (ctx) => {
      const { imageId, latest } = ctx;
      setImageDrag(null);
      onImageMove(imageId, {
        dx: latest.dx,
        dy: latest.dy,
        dw: latest.dw,
        dh: latest.dh,
      });
    },
    onCancel: () => setImageDrag(null),
  });
  const startImageResize = (
    imageId: string,
    img: import("../lib/sourceImages").ImageInstance,
    corner: ResizeCorner,
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => {
    beginImageResize(e, {
      imageId,
      corner,
      base,
      origW: img.pdfWidth * page.scale,
      origH: img.pdfHeight * page.scale,
      minView: 10 * page.scale,
      originDisplayScale: readDisplayScale(),
      latest: { dx: base.dx, dy: base.dy, dw: base.dw, dh: base.dh },
    });
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
      ref={fitRef}
      // Outer layout wrapper — reserves displayed-pixel space so the
      // scroll container sizes itself correctly. The natural-size
      // chrome lives in the inner div; CSS transform fits it into the
      // reserved displayed box. `position: relative` anchors the
      // absolutely-positioned inner; `overflow: hidden` clips the
      // inner's natural-size LAYOUT box (CSS transform shrinks
      // visually but doesn't shrink the layout box, so without the
      // clip the page would extend horizontally past its displayed
      // width and produce a phantom right-pan area).
      className="shadow-md"
      style={{
        width: page.viewWidth * displayScale,
        height: page.viewHeight * displayScale,
        maxWidth: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        ref={containerRef}
        className="relative inline-block"
        style={{
          width: page.viewWidth,
          height: page.viewHeight,
          // Absolute-position the inner so its natural-size layout
          // box doesn't push the outer's content box wider than the
          // displayed dimensions. The CSS transform handles the
          // visual fit; absolute positioning keeps the layout in line.
          position: "absolute",
          top: 0,
          left: 0,
          transform: displayScale === 1 ? undefined : `scale(${displayScale})`,
          transformOrigin: "top left",
        }}
        data-page-index={pageIndex}
        data-source-key={sourceKey}
        data-page-scale={page.scale}
        data-view-width={page.viewWidth}
        data-view-height={page.viewHeight}
      >
        <div data-canvas-slot />
        {tool !== "select" ? (
          // Placement-mode capture layer: sits above all other overlays
          // so a tap/click goes to onCanvasClick regardless of what's
          // underneath. The user is in "drop a new thing here" mode;
          // existing items shouldn't react to the click.
          // `touch-action: manipulation` suppresses iOS' 300ms double-
          // tap-zoom delay on the layer so the placement click fires
          // immediately on a finger tap.
          <div
            className="absolute inset-0"
            style={{
              cursor: "crosshair",
              zIndex: 50,
              pointerEvents: "auto",
              touchAction: "manipulation",
            }}
            onClick={(e) => {
              e.stopPropagation();
              const host = containerRef.current;
              if (!host) return;
              const r = host.getBoundingClientRect();
              // r is the DISPLAYED rect (post-CSS-transform). Convert
              // screen px → PDF user space via effectiveScale = scale ×
              // displayScale, derived once here so the math doesn't
              // depend on `displayScale` state being current.
              const ds = page.viewWidth > 0 ? r.width / page.viewWidth : 1;
              const effective = page.scale * ds;
              const xView = e.clientX - r.x;
              const yView = e.clientY - r.y;
              const pdfX = xView / effective;
              // Use displayed height (= page.viewHeight × ds) for the
              // y-flip so all terms are in the same unit before the
              // single divide.
              const pdfY = (r.height - yView) / effective;
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
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit text: ${editedValue.text}`}
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
                    // `pinch-zoom` lets two-finger pinch pass through
                    // to the browser's native zoom while suppressing
                    // single-finger pan — so a one-finger drag fires
                    // pointermove (the gesture we want to handle) and
                    // a two-finger pinch zooms the document (the
                    // gesture the user expects from a phone).
                    touchAction: "pinch-zoom",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                  title={editedValue.text}
                  onPointerDown={(e) =>
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingId(run.id);
                    }
                  }}
                >
                  <span
                    dir={style.dir ?? "auto"}
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
                role="button"
                tabIndex={0}
                aria-label={`Edit text: ${run.text}`}
                // `select-none` (was: `select-text`) prevents iOS from
                // popping the long-press copy menu over a drag-start —
                // the menu would otherwise eat the gesture and lock the
                // run in selection mode. Selection within the editor
                // input is unaffected because that's a separate node.
                className="thaana-stack absolute select-none"
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
                  // `pinch-zoom` so two-finger pinch zooms the page
                  // while one-finger drag still fires pointermove.
                  touchAction: "pinch-zoom",
                  WebkitUserSelect: "none",
                }}
                title={run.text}
                onPointerDown={(e) => startDrag(run.id, e, { dx: 0, dy: 0 })}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingId(run.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (drag || justDraggedRef.current === run.id) return;
                  setEditingId(run.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingId(run.id);
                  }
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
                onPointerDown={(e, base) => startImageDrag(img.id, e, base)}
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
              displayScale={displayScale}
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
              displayScale={displayScale}
              isSelected={selectedInsertedImageId === ins.id}
              onChange={(patch) => onImageInsertChange(ins.id, patch)}
              onDelete={() => onImageInsertDelete(ins.id)}
              onSelect={() => onSelectInsertedImage(ins.id)}
            />
          ))}
        </div>
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
  onPointerDown,
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
  onPointerDown: (
    e: React.PointerEvent,
    base: { dx: number; dy: number; dw: number; dh: number },
  ) => void;
  onResizeStart: (
    corner: ResizeCorner,
    e: React.PointerEvent,
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
      role={movable ? "button" : undefined}
      tabIndex={movable ? 0 : undefined}
      aria-label={
        movable
          ? `Image ${img.resourceName} — drag to move, corners to resize`
          : `Image ${img.resourceName}`
      }
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
        // `pinch-zoom` on movable images: one-finger drag fires
        // pointermove (move/resize); two-finger pinch zooms the
        // document. Un-movable images keep default behaviour so a
        // pan starting on them scrolls the document.
        touchAction: movable ? "pinch-zoom" : undefined,
      }}
      title={
        movable
          ? `Image ${img.resourceName} (drag to move, corners to resize, Del to delete)`
          : `Image ${img.resourceName} (un-movable)`
      }
      onPointerDown={(e) => {
        if (!movable) return;
        onPointerDown(e, baseFor());
      }}
      onClick={(e) => {
        // Stop propagation so the window-level click-outside handler
        // in App doesn't immediately deselect what we just selected.
        e.stopPropagation();
        if (movable) onSelect();
      }}
      onKeyDown={(e) => {
        if (!movable) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {movable ? (
        <>
          <ResizeHandle
            position="tl"
            parentW={boxW}
            parentH={boxH}
            onPointerDown={(e) => onResizeStart("tl", e, baseFor())}
          />
          <ResizeHandle
            position="tr"
            parentW={boxW}
            parentH={boxH}
            onPointerDown={(e) => onResizeStart("tr", e, baseFor())}
          />
          <ResizeHandle
            position="bl"
            parentW={boxW}
            parentH={boxH}
            onPointerDown={(e) => onResizeStart("bl", e, baseFor())}
          />
          <ResizeHandle
            position="br"
            parentW={boxW}
            parentH={boxH}
            onPointerDown={(e) => onResizeStart("br", e, baseFor())}
          />
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
  displayScale,
  toolbarBlockers,
  isEditing,
  onChange,
  onDelete,
  onOpen,
  onClose,
}: {
  ins: TextInsertion;
  page: RenderedPage;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
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
    /** `null` clears an explicit dir back to auto-detect. */
    dir?: "rtl" | "ltr" | null;
  }) => {
    // fontSize lives outside `style` (it's a top-level field on the
    // insertion since it's also used to derive the box height); split
    // the patch accordingly.
    const nextStyle: typeof style = { ...style };
    if (patch.fontFamily !== undefined) nextStyle.fontFamily = patch.fontFamily;
    if (patch.bold !== undefined) nextStyle.bold = patch.bold;
    if (patch.italic !== undefined) nextStyle.italic = patch.italic;
    if (patch.underline !== undefined) nextStyle.underline = patch.underline;
    if (patch.dir !== undefined) {
      // null = clear back to auto; "rtl"/"ltr" = explicit override.
      if (patch.dir === null) delete nextStyle.dir;
      else nextStyle.dir = patch.dir;
    }
    const insPatch: Partial<TextInsertion> = { style: nextStyle };
    if (patch.fontSize !== undefined) insPatch.fontSize = patch.fontSize;
    onChange(insPatch);
  };

  // Drag-pixel → PDF-unit conversion factor: a screen-pixel delta
  // divided by `effectivePdfScale` lands in PDF user space.
  const effectivePdfScale = page.scale * displayScale;
  type InsTextDragCtx = { baseX: number; baseY: number };
  const beginInsTextDrag = useDragGesture<InsTextDragCtx>({
    onMove: (ctx, info) => {
      onChange({
        pdfX: ctx.baseX + info.dxRaw / effectivePdfScale,
        // viewport y-down → PDF y-up: subtract.
        pdfY: ctx.baseY - info.dyRaw / effectivePdfScale,
      });
    },
    onEnd: (ctx, info) => {
      // Cross-page drop: re-key onto the target page in App. Convert
      // the overlay's screen position to the target page's PDF coords
      // (baseline x; baseline y is fontSizePx ABOVE the box top).
      const hit = findPageAtPoint(info.clientX, info.clientY);
      if (!hit || hit.pageIndex === ins.pageIndex) return;
      const originRect = document
        .querySelector<HTMLElement>(`[data-page-index="${ins.pageIndex}"]`)
        ?.getBoundingClientRect();
      if (!originRect) return;
      const pdfXOrigin = ctx.baseX + info.dxRaw / effectivePdfScale;
      const pdfYOrigin = ctx.baseY - info.dyRaw / effectivePdfScale;
      // Project origin-page PDF coords → screen px via the source's
      // displayed width factor; then back to PDF on the target.
      const overlayScreenLeft = originRect.left + pdfXOrigin * effectivePdfScale;
      const overlayScreenTopBox =
        originRect.top + (page.viewHeight - pdfYOrigin * page.scale - fontSizePx) * displayScale;
      const targetFontSizePxScreen = ins.fontSize * hit.effectiveScale;
      const targetPdfX = (overlayScreenLeft - hit.rect.left) / hit.effectiveScale;
      const targetPdfY =
        (hit.displayedHeight - (overlayScreenTopBox - hit.rect.top) - targetFontSizePxScreen) /
        hit.effectiveScale;
      onChange({
        sourceKey: hit.sourceKey,
        pageIndex: hit.pageIndex,
        pdfX: targetPdfX,
        pdfY: targetPdfY,
      });
    },
  });
  const startDrag = (e: React.PointerEvent) => {
    if (isEditing) return;
    beginInsTextDrag(e, { baseX: ins.pdfX, baseY: ins.pdfY });
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
          dir={style.dir}
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
        role={isEditing ? undefined : "button"}
        tabIndex={isEditing ? undefined : 0}
        aria-label={
          isEditing
            ? undefined
            : ins.text
              ? `Edit inserted text: ${ins.text}`
              : "Edit empty inserted text"
        }
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
          // Allow native gestures while in editing mode (so the user
          // can scroll the on-screen keyboard / select text); on the
          // drag-affordance state, allow pinch-zoom so two-finger
          // pinch passes through to the browser, but suppress single-
          // finger pan so a one-finger drag fires pointermove.
          touchAction: isEditing ? "auto" : "pinch-zoom",
        }}
        onPointerDown={startDrag}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditing) onOpen();
        }}
        onKeyDown={(e) => {
          if (isEditing) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onOpen();
          }
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            // Explicit `style.dir` overrides the codepoint-based
            // auto-detection. `dir="auto"` is the browser's own
            // detector — used when the user hasn't picked a side.
            dir={style.dir ?? "auto"}
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
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            dir={style.dir ?? "auto"}
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
  displayScale,
  isSelected,
  onChange,
  onDelete,
  onSelect,
}: {
  ins: ImageInsertion;
  page: RenderedPage;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
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

  // Drag-pixel → PDF-unit conversion factor: a screen-pixel delta
  // divided by `effectivePdfScale` lands in PDF user space.
  const effectivePdfScale = page.scale * displayScale;
  type InsImageDragCtx = { baseX: number; baseY: number };
  const beginInsImageDrag = useDragGesture<InsImageDragCtx>({
    onMove: (ctx, info) => {
      onChange({
        pdfX: ctx.baseX + info.dxRaw / effectivePdfScale,
        pdfY: ctx.baseY - info.dyRaw / effectivePdfScale,
      });
    },
    onEnd: (ctx, info) => {
      const hit = findPageAtPoint(info.clientX, info.clientY);
      if (!hit || hit.pageIndex === ins.pageIndex) return;
      const originRect = document
        .querySelector<HTMLElement>(`[data-page-index="${ins.pageIndex}"]`)
        ?.getBoundingClientRect();
      if (!originRect) return;
      const pdfXOrigin = ctx.baseX + info.dxRaw / effectivePdfScale;
      const pdfYOrigin = ctx.baseY - info.dyRaw / effectivePdfScale;
      const overlayScreenLeft = originRect.left + pdfXOrigin * effectivePdfScale;
      const overlayScreenTopBox =
        originRect.top +
        (page.viewHeight - (pdfYOrigin + ins.pdfHeight) * page.scale) * displayScale;
      const targetPdfX = (overlayScreenLeft - hit.rect.left) / hit.effectiveScale;
      const heightScreenOnTarget = ins.pdfHeight * hit.effectiveScale;
      const targetViewBottom = overlayScreenTopBox - hit.rect.top + heightScreenOnTarget;
      const targetPdfY = (hit.displayedHeight - targetViewBottom) / hit.effectiveScale;
      onChange({
        sourceKey: hit.sourceKey,
        pageIndex: hit.pageIndex,
        pdfX: targetPdfX,
        pdfY: targetPdfY,
      });
    },
  });
  const startDrag = (e: React.PointerEvent) => {
    beginInsImageDrag(e, { baseX: ins.pdfX, baseY: ins.pdfY });
  };

  // Resize from any of the 4 corners. Math is in PDF user space (y-up):
  // ins.pdfY is the BOTTOM of the box, ins.pdfY+pdfHeight is the top.
  // Each handle anchors the OPPOSITE corner so the box grows/shrinks
  // toward the dragged corner.
  type InsImageResizeCtx = {
    corner: "tl" | "tr" | "bl" | "br";
    base: { x: number; y: number; w: number; h: number };
  };
  const MIN_PDF = 10;
  const beginInsImageResize = useDragGesture<InsImageResizeCtx>({
    onMove: (ctx, info) => {
      const { corner, base } = ctx;
      const dxPdf = info.dxRaw / effectivePdfScale;
      // Viewport y is y-down, PDF is y-up — drag DOWN means -dyPdf.
      const dyPdf = -info.dyRaw / effectivePdfScale;
      let { x, y } = base;
      let nw = base.w;
      let nh = base.h;
      switch (corner) {
        case "br": // anchor TL: x stays, y+h stays
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h - dyPdf);
          y = base.y + base.h - nh;
          break;
        case "tr": // anchor BL: x stays, y stays
          nw = Math.max(MIN_PDF, base.w + dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          break;
        case "tl": // anchor BR: x+w stays, y stays
          nw = Math.max(MIN_PDF, base.w - dxPdf);
          nh = Math.max(MIN_PDF, base.h + dyPdf);
          x = base.x + base.w - nw;
          break;
        case "bl": // anchor TR: x+w stays, y+h stays
          nw = Math.max(MIN_PDF, base.w - dxPdf);
          nh = Math.max(MIN_PDF, base.h - dyPdf);
          x = base.x + base.w - nw;
          y = base.y + base.h - nh;
          break;
      }
      onChange({ pdfX: x, pdfY: y, pdfWidth: nw, pdfHeight: nh });
    },
  });
  const startResize = (corner: "tl" | "tr" | "bl" | "br") => (e: React.PointerEvent) => {
    beginInsImageResize(e, {
      corner,
      base: { x: ins.pdfX, y: ins.pdfY, w: ins.pdfWidth, h: ins.pdfHeight },
    });
  };

  return (
    <div
      data-image-insert-id={ins.id}
      role="button"
      tabIndex={0}
      aria-label="Inserted image — drag to move, corners to resize, Del to delete"
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
        touchAction: "pinch-zoom",
      }}
      title={`Inserted image (drag corners to resize, click to select then Del to delete)`}
      onPointerDown={startDrag}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      <ResizeHandle position="tl" parentW={w} parentH={h} onPointerDown={startResize("tl")} />
      <ResizeHandle position="tr" parentW={w} parentH={h} onPointerDown={startResize("tr")} />
      <ResizeHandle position="bl" parentW={w} parentH={h} onPointerDown={startResize("bl")} />
      <ResizeHandle position="br" parentW={w} parentH={h} onPointerDown={startResize("br")} />
    </div>
  );
}

/** Square corner handle for resizing image overlays. Sits at the
 *  corner of the box with a transparent hit-test pad surrounding the
 *  visible square — bigger than the dot so a finger touch lands
 *  cleanly, while desktop precision is preserved by the inset visible
 *  square. The pad extends slightly past the box (negative offsets)
 *  so a user grabbing the visible corner from outside still hits.
 *
 *  The hit pad is CAPPED so opposite-corner pads don't meet at the
 *  centre — there has to be at least `MIN_DRAG_GAP` pixels of
 *  drag-to-move surface left between them, otherwise the parent's
 *  click-to-translate gesture becomes unreachable on small overlays
 *  (e.g. a 45×45 inserted image). For overlays large enough to fit
 *  the full 32×32 pad with breathing room, the cap is a no-op.
 *
 *  z-index 21 keeps the handle above the parent box's onPointerDown
 *  surface so the resize wins the hit-test over the translate drag. */
function ResizeHandle({
  position,
  parentW,
  parentH,
  onPointerDown,
}: {
  position: "tl" | "tr" | "bl" | "br";
  /** Parent overlay's viewport-pixel width/height. Used to cap the
   *  hit pad so two corner pads don't meet in the centre. */
  parentW: number;
  parentH: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const VISIBLE = 12;
  const MAX_HIT = 32;
  const MIN_DRAG_GAP = 8;
  // Gap-between-opposite-pads = parentSize - HIT - VISIBLE, derived
  // from `pad_extent_inside_box = HIT - inset = (HIT + VISIBLE) / 2`.
  // Solve for HIT: HIT <= parentSize - VISIBLE - MIN_DRAG_GAP.
  const fitW = parentW - VISIBLE - MIN_DRAG_GAP;
  const fitH = parentH - VISIBLE - MIN_DRAG_GAP;
  const HIT = Math.max(VISIBLE, Math.min(MAX_HIT, Math.floor(Math.min(fitW, fitH))));
  const inset = (HIT - VISIBLE) / 2;
  const padStyle: React.CSSProperties = {
    position: "absolute",
    width: HIT,
    height: HIT,
    pointerEvents: "auto",
    zIndex: 21,
    // Resize handles need a precise grab — disable single-finger pan
    // so a drag at the corner fires pointermove. Two-finger pinch
    // still passes through to zoom the document.
    touchAction: "pinch-zoom",
  };
  if (position === "tl") {
    padStyle.left = -inset;
    padStyle.top = -inset;
    padStyle.cursor = "nwse-resize";
  } else if (position === "tr") {
    padStyle.right = -inset;
    padStyle.top = -inset;
    padStyle.cursor = "nesw-resize";
  } else if (position === "bl") {
    padStyle.left = -inset;
    padStyle.bottom = -inset;
    padStyle.cursor = "nesw-resize";
  } else {
    padStyle.right = -inset;
    padStyle.bottom = -inset;
    padStyle.cursor = "nwse-resize";
  }
  const dotStyle: React.CSSProperties = {
    position: "absolute",
    left: inset,
    top: inset,
    width: VISIBLE,
    height: VISIBLE,
    background: "white",
    border: "1px solid rgba(40, 130, 255, 0.9)",
    boxSizing: "border-box",
    pointerEvents: "none",
  };
  return (
    <div
      data-resize-handle={position}
      style={padStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div style={dotStyle} />
    </div>
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
  const isMobile = useIsMobile();
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
    if (isMobile) {
      // The on-screen keyboard occupies the bottom ~40% of the viewport
      // and the fixed-bottom toolbar adds ~80px more. Without scrolling,
      // an EditField near the bottom of the page would be hidden.
      // Centre it in the visible viewport area on open. `auto` skips
      // the smooth-scroll animation so the user sees the editor
      // immediately rather than after a 250ms slide.
      inputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
    }
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
        dir={style.dir}
        onChange={(patch) =>
          setStyle((s) => {
            const next: EditStyle = { ...s };
            if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
            // Toolbar's value is in PDF points — store as-is.
            if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
            if (patch.bold !== undefined) next.bold = patch.bold;
            if (patch.italic !== undefined) next.italic = patch.italic;
            if (patch.underline !== undefined) next.underline = patch.underline;
            if (patch.dir !== undefined) {
              // null = clear back to auto-detect; "rtl"/"ltr" = override.
              if (patch.dir === null) delete next.dir;
              else next.dir = patch.dir;
            }
            return next;
          })
        }
        onCancel={onCancel}
        onDelete={onDelete}
      />
      <input
        ref={inputRef}
        value={text}
        // Explicit `style.dir` overrides auto-detection (set via the
        // toolbar's direction button); falls back to "auto" so the
        // browser picks based on the text's strong codepoints.
        dir={style.dir ?? "auto"}
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
    s.underline !== undefined ||
    s.dir !== undefined
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
  dir,
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
  /** Explicit text direction. `undefined` = auto-detect from text. */
  dir: "rtl" | "ltr" | undefined;
  onChange: (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    /** `null` clears an explicit direction back to auto-detect. */
    dir?: "rtl" | "ltr" | null;
  }) => void;
  onCancel?: () => void;
  /** When provided, renders a trash button. Source-run deletion sets
   *  `deleted=true` on the stored EditValue; inserted-text deletion
   *  removes the entry from its slot bucket. */
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  // Distance from the bottom of the layout viewport to the bottom of
  // the visual viewport — i.e. how far the iOS keyboard pushes the
  // visible area up. We track it so the fixed-bottom mobile toolbar
  // rides above the keyboard instead of being hidden behind it.
  const [keyboardBottom, setKeyboardBottom] = useState(0);
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      setKeyboardBottom(Math.max(0, offset));
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [isMobile]);

  // Mobile layout: anchored to the visible viewport, full-width with
  // wrap so the font picker can drop to its own row when the labels
  // get long. Desktop keeps the original absolute / page-coord layout.
  const baseStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: keyboardBottom,
        zIndex: 30,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: 8,
        paddingBottom: `max(8px, var(--safe-bottom, 0px))`,
        alignItems: "center",
        pointerEvents: "auto",
      }
    : {
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
      };
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
      //
      // Mobile drops the rounded corners (it's a full-width strip) and
      // adds a top border to delineate it from the page content above.
      className={
        isMobile
          ? "border-t border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
          : "border border-zinc-300 bg-white text-zinc-900 shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
      }
      style={baseStyle}
      // We do NOT preventDefault on pointerdown here — the native
      // <select> dropdown won't open if its focus change is suppressed.
      // Instead each input's onBlur checks `relatedTarget`: if the new
      // focus target lives inside `[data-edit-toolbar]`, the editor
      // stays open. See `isFocusMovingToToolbar` below.
      onPointerDown={(e) => {
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
          // On mobile the font picker takes the full first row so its
          // long names don't truncate; size + B/I/U + ✕ wrap below.
          flexBasis: isMobile ? "100%" : undefined,
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
      {/* Direction button — cycles auto → rtl → ltr → auto. Lets the
          user override the codepoint-based auto-detection used by the
          overlay (`dir="auto"`) and the save path. Useful when the
          string is a mix or all-digits that the auto-detector
          misclassifies (a digit-only run inside a Dhivehi paragraph
          that should stay RTL, for example). */}
      <Button
        isIconOnly
        size="sm"
        variant={dir === undefined ? "ghost" : "primary"}
        // Pass `null` to clear back to auto so the receiver can
        // distinguish "no change" (key missing from patch) from
        // "explicitly clear".
        onPress={() => {
          const next = dir === undefined ? "rtl" : dir === "rtl" ? "ltr" : null;
          onChange({ dir: next });
        }}
        aria-label={
          dir === "rtl"
            ? "Direction: right-to-left (click for left-to-right)"
            : dir === "ltr"
              ? "Direction: left-to-right (click for auto)"
              : "Direction: auto (click for right-to-left)"
        }
        // HeroUI ToggleButton suppresses focus shift via onMouseDown
        // preventDefault — we need the same so clicking direction
        // doesn't blur the editor input mid-edit.
        onMouseDown={(e) => e.preventDefault()}
      >
        {dir === "rtl" ? (
          <ArrowLeft size={14} />
        ) : dir === "ltr" ? (
          <ArrowRight size={14} />
        ) : (
          <ArrowLeftRight size={14} />
        )}
      </Button>
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
