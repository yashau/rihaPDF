import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RenderedPage } from "../../lib/pdf";
import type { ImageInsertion, TextInsertion } from "../../lib/insertions";
import { type Annotation, DEFAULT_HIGHLIGHT_COLOR, newAnnotationId } from "../../lib/annotations";
import type { ToolMode } from "../../App";
import { clickSuppressMs, useDragGesture } from "../../lib/useDragGesture";
import { EditField } from "./EditField";
import { ImageOverlay, InsertedImageOverlay, InsertedTextOverlay, ShapeOverlay } from "./overlays";
import { AnnotationLayer } from "./AnnotationLayer";
import { cssTextDecoration, findPageAtPoint } from "./helpers";
import type {
  CrossPageArrival,
  EditValue,
  ImageMoveValue,
  ResizeCorner,
  ToolbarBlocker,
} from "./types";

export type { CrossPageArrival, EditValue, ImageMoveValue, ToolbarBlocker } from "./types";

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
  annotations: Annotation[];
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
  /** ID of the source vector shape currently selected on this page. */
  selectedShapeId: string | null;
  /** Set of shape ids on this page already flagged for delete — their
   *  overlays are hidden so the user can't re-grab them. */
  deletedShapeIds: Set<string>;
  /** Single-click on an image overlay → app marks it selected so
   *  Delete/Backspace targets it. */
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
  onSelectShape: (shapeId: string) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
  /** Source-page text runs that have been moved cross-page and now
   *  visually live on THIS slot. Built by PageList from the source-
   *  side `edits` map. Rendered as non-interactive styled spans at
   *  `targetPdfX/Y` — without this layer the runs disappear from the
   *  source canvas (preview-strip) but never reappear on the target,
   *  so the user can't see what they moved until save. */
  crossPageArrivals: CrossPageArrival[];
};

export function PdfPage({
  page,
  pageIndex,
  sourceKey,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  annotations,
  previewCanvas,
  tool,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  selectedShapeId,
  deletedShapeIds,
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
  onSelectShape,
  onAnnotationAdd,
  onAnnotationChange,
  onAnnotationDelete,
  crossPageArrivals,
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
   *  this state only carries the live (dx, dy) the renderer reads.
   *
   *  The remaining fields drive a `position: fixed` body-portal preview
   *  rendered ONCE the user has actually moved the cursor. The page
   *  wrapper has `overflow: hidden` (mandatory — see the wrapper
   *  comment further down), so the in-place span gets clipped the
   *  moment the cursor crosses onto another page; the portal'd clone
   *  escapes that clip by mounting under document.body.
   *
   *  `moved` distinguishes a real drag from a plain click. Mouse
   *  pointers eagerly enter the gesture on `pointerdown`, so for a
   *  no-movement click we'd otherwise hide the span the instant the
   *  cursor goes down — which would make `click` events miss the
   *  hidden span and silently break click-to-edit. We only hide the
   *  in-place span (and render the portal) once `onMove` has fired. */
  const [drag, setDrag] = useState<{
    runId: string;
    dx: number;
    dy: number;
    /** True once the user has actually moved the cursor (any non-zero
     *  pointermove). Click without motion leaves this false so the
     *  in-place span stays interactive and `onClick` can open the
     *  editor. */
    moved: boolean;
    /** Screen-px offset from the box's top-left to the cursor at gesture
     *  start. Stays constant for the rest of the drag — the cursor
     *  always grabs the same point on the box. */
    cursorOffsetX: number;
    cursorOffsetY: number;
    /** Box dimensions in SCREEN pixels (= natural × originDisplayScale).
     *  The portal lives in document.body, where there's no CSS transform,
     *  so all of its measurements are in raw screen pixels. */
    width: number;
    height: number;
    /** Latest cursor viewport coords; the portal renders at
     *  `clientX - cursorOffsetX, clientY - cursorOffsetY`. */
    clientX: number;
    clientY: number;
    /** Source page's natural→displayed ratio captured at gesture start.
     *  Used by the portal to convert the run's natural-pixel font size
     *  to the on-screen size that matches the in-page rendering. */
    originDisplayScale: number;
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
    onStart: (ctx, e) => {
      const run = page.textRuns.find((r) => r.id === ctx.runId);
      const rect = ctx.originRect;
      const ds = ctx.originDisplayScale;
      // Box dimensions match the edited-branch render (which uses
      // padX/padY = 2 around the run's natural-pixel bounds). The
      // unedited branch renders without padding, but visually swapping
      // to the slightly-padded box during drag is fine and means the
      // portal clone matches the post-drop in-place rendering exactly.
      const padX = 2;
      const padY = 2;
      let cursorOffsetX = 0;
      let cursorOffsetY = 0;
      let width = 0;
      let height = 0;
      if (run && rect) {
        const boxNaturalW = Math.max(run.bounds.width, 12) + padX * 2;
        const boxNaturalH = run.bounds.height + padY * 2;
        const screenLeft = rect.left + (run.bounds.left - padX + ctx.base.dx) * ds;
        const screenTop = rect.top + (run.bounds.top - padY + ctx.base.dy) * ds;
        cursorOffsetX = e.clientX - screenLeft;
        cursorOffsetY = e.clientY - screenTop;
        width = boxNaturalW * ds;
        height = boxNaturalH * ds;
      }
      setDrag({
        runId: ctx.runId,
        dx: ctx.base.dx,
        dy: ctx.base.dy,
        moved: false,
        cursorOffsetX,
        cursorOffsetY,
        width,
        height,
        clientX: e.clientX,
        clientY: e.clientY,
        originDisplayScale: ds,
      });
    },
    onMove: (ctx, info) => {
      const dxNat = info.dxRaw / ctx.originDisplayScale;
      const dyNat = info.dyRaw / ctx.originDisplayScale;
      const newDx = ctx.base.dx + dxNat;
      const newDy = ctx.base.dy + dyNat;
      setDrag((prev) =>
        prev && prev.runId === ctx.runId
          ? {
              ...prev,
              dx: newDx,
              dy: newDy,
              clientX: info.clientX,
              clientY: info.clientY,
              moved: true,
            }
          : prev,
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
    img: import("../../lib/sourceImages").ImageInstance,
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

  /** Add a highlight annotation covering a single run. The run's bbox
   *  lives in viewport pixels (y-down); we convert to PDF user space
   *  (y-up) and emit a single quad in TL/TR/BL/BR order. Multi-line
   *  highlight (one annotation, many quads) is a Phase 2 feature; one
   *  click currently means one quad over the clicked run. */
  const addHighlightForRun = (run: {
    bounds: { left: number; top: number; width: number; height: number };
  }) => {
    const pdfLeft = run.bounds.left / page.scale;
    const pdfRight = (run.bounds.left + run.bounds.width) / page.scale;
    const pdfTop = (page.viewHeight - run.bounds.top) / page.scale;
    const pdfBottom = (page.viewHeight - run.bounds.top - run.bounds.height) / page.scale;
    onAnnotationAdd({
      kind: "highlight",
      id: newAnnotationId("highlight"),
      sourceKey,
      pageIndex,
      quads: [
        {
          x1: pdfLeft,
          y1: pdfTop,
          x2: pdfRight,
          y2: pdfTop,
          x3: pdfLeft,
          y3: pdfBottom,
          x4: pdfRight,
          y4: pdfBottom,
        },
      ],
      color: DEFAULT_HIGHLIGHT_COLOR,
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
        {tool === "addText" || tool === "addImage" || tool === "comment" ? (
          // Placement-mode capture layer: sits above all other overlays
          // so a tap/click goes to onCanvasClick regardless of what's
          // underneath. The user is in "drop a new thing here" mode;
          // existing items shouldn't react to the click.
          //   - "highlight" excluded: click should hit a text run, not
          //     this layer (the run's onClick branches on tool).
          //   - "ink" excluded: AnnotationLayer captures pointer events
          //     itself for stroke drawing.
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
          {/* Source vector-shape overlays render BEFORE runs / images
            so runs and images intercept clicks first when they overlap
            — text under a decorative background still gets edited
            normally. Already-deleted shapes don't render. */}
          {page.shapes.map((shape) => {
            if (deletedShapeIds.has(shape.id)) return null;
            return (
              <ShapeOverlay
                key={shape.id}
                shape={shape}
                page={page}
                isSelected={selectedShapeId === shape.id}
                onSelect={() => onSelectShape(shape.id)}
              />
            );
          })}
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
              // wants it, with a white cover behind it. The preview
              // canvas SHOULD have the original glyphs stripped, but the
              // strip is content-stream surgery and silently no-ops when
              // the source text lives inside a Form XObject (common in
              // PDFs from Cloudflare-style invoice generators, browsers,
              // etc.) — `findTextShows()` only sees the page's top-level
              // ops. Without the cover the user sees the original glyphs
              // ghosting through the new format.
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
                    // White cover masks the original glyphs at the
                    // SOURCE position when the strip pipeline silently
                    // no-ops (Form XObject case). After a move the
                    // span paints at a NEW position where there's no
                    // original to mask — and the cover would just
                    // occlude whatever else lives at the destination.
                    // So: keep the cover only at the in-place position.
                    background: isDragging || dx !== 0 || dy !== 0 ? undefined : "white",
                    outline: isDragging
                      ? "1px dashed rgba(255, 180, 30, 0.9)"
                      : "1px solid rgba(255, 200, 60, 0.5)",
                    pointerEvents: "auto",
                    cursor: isDragging ? "grabbing" : tool === "highlight" ? "text" : "grab",
                    display: "flex",
                    alignItems: "center",
                    overflow: "visible",
                    // Once the user actually moves the cursor, the
                    // portal'd clone (rendered below) is what they see
                    // — the in-place span stays mounted (its rect
                    // anchors the drop math) but goes invisible so the
                    // page wrapper's overflow:hidden doesn't clip the
                    // preview at the page boundary. We DON'T hide on
                    // gesture-start alone: mouse pointers activate the
                    // gesture eagerly on pointerdown, and a no-motion
                    // click would otherwise hit a hidden span and skip
                    // the editor handoff.
                    visibility: isDragging && drag?.moved ? "hidden" : "visible",
                    // `pan-y pinch-zoom` lets the browser scroll the
                    // page (and pinch-zoom) on a quick finger swipe;
                    // useDragGesture's touch-hold gate means a single-
                    // finger drag only claims the run after a 400ms
                    // hold, so casual taps and scrolls aren't hijacked.
                    touchAction: "pan-y pinch-zoom",
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
                    if (tool === "highlight") {
                      addHighlightForRun(run);
                      return;
                    }
                    setEditingId(run.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      if (tool === "highlight") {
                        addHighlightForRun(run);
                        return;
                      }
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
                      textDecoration: cssTextDecoration(
                        style.underline ?? run.underline ?? false,
                        style.strikethrough ?? run.strikethrough ?? false,
                      ),
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
                  // Same as the edited branch above — hide once the
                  // user has moved so the body-portal preview can
                  // escape the page wrapper's overflow:hidden clip.
                  // Gesture-start alone keeps the span visible so a
                  // no-motion click reaches it.
                  visibility: isDragging && drag?.moved ? "hidden" : "visible",
                  cursor: isDragging ? "grabbing" : tool === "highlight" ? "text" : "grab",
                  // `pan-y pinch-zoom` so the page scrolls on a quick
                  // finger swipe; the run is only claimed after the
                  // 400ms touch-hold gate in useDragGesture.
                  touchAction: "pan-y pinch-zoom",
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
                  if (tool === "highlight") {
                    addHighlightForRun(run);
                    return;
                  }
                  setEditingId(run.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (tool === "highlight") {
                      addHighlightForRun(run);
                      return;
                    }
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
              slotIndex={pageIndex}
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
              slotIndex={pageIndex}
              displayScale={displayScale}
              isSelected={selectedInsertedImageId === ins.id}
              onChange={(patch) => onImageInsertChange(ins.id, patch)}
              onDelete={() => onImageInsertDelete(ins.id)}
              onSelect={() => onSelectInsertedImage(ins.id)}
            />
          ))}
          {/* Cross-page-arrived runs: source-page text the user dragged
            ONTO this slot. The source-side preview-strip removes the
            original glyphs from the source canvas; without these
            spans the run would otherwise vanish entirely until save.
            v1: render-only — to drag again the user has to undo and
            re-do the move. The save pipeline reads `targetSlotId`
            directly, so these spans are purely for live feedback. */}
          {crossPageArrivals.map((arr) => {
            const fontSizePx = arr.fontSizePdfPoints * page.scale;
            const lineHeightPx = arr.fontSizePdfPoints * 1.4 * page.scale;
            const left = arr.targetPdfX * page.scale;
            const top = page.viewHeight - arr.targetPdfY * page.scale - fontSizePx;
            return (
              <span
                key={arr.key}
                data-cross-page-arrival-key={arr.key}
                aria-hidden
                style={{
                  position: "absolute",
                  left,
                  top,
                  height: lineHeightPx,
                  display: "flex",
                  alignItems: "center",
                  // No outline / background — the user just sees the
                  // text where they dropped it. Matches the intent of
                  // a finished move (vs. the dashed dragging preview).
                  pointerEvents: "none",
                  whiteSpace: "pre",
                  zIndex: 15,
                }}
              >
                <span
                  dir={arr.dir ?? "auto"}
                  style={{
                    fontFamily: `"${arr.fontFamily}"`,
                    fontSize: `${fontSizePx}px`,
                    lineHeight: `${lineHeightPx}px`,
                    fontWeight: arr.bold ? 700 : 400,
                    fontStyle: arr.italic ? "italic" : "normal",
                    textDecoration: cssTextDecoration(arr.underline, arr.strikethrough),
                    color: "black",
                    whiteSpace: "pre",
                  }}
                >
                  {arr.text}
                </span>
              </span>
            );
          })}
          {/* Annotations: highlight rects, sticky-note markers, ink
            strokes. The layer also captures pointer events when the
            ink tool is active. */}
          <AnnotationLayer
            annotations={annotations}
            pageScale={page.scale}
            viewHeight={page.viewHeight}
            displayScale={displayScale}
            pageIndex={pageIndex}
            sourceKey={sourceKey}
            tool={tool}
            onAnnotationAdd={onAnnotationAdd}
            onAnnotationChange={onAnnotationChange}
            onAnnotationDelete={onAnnotationDelete}
          />
        </div>
      </div>
      {/* Body-portal'd drag preview. The page wrapper has
          `overflow: hidden` (it has to — see the wrapper comment above),
          which clips an in-place dragged span the moment the cursor
          crosses onto another page. Mounting the preview to document.body
          via createPortal lets it follow the cursor across pages. The
          in-place span stays mounted but `visibility: hidden`, so its
          rect still anchors the cross-page drop math while the user
          sees the portal'd clone. */}
      {drag && drag.moved
        ? (() => {
            const dragRun = page.textRuns.find((r) => r.id === drag.runId);
            if (!dragRun || drag.width <= 0 || drag.height <= 0) return null;
            // Mirror the edited-branch styling so the preview matches
            // exactly what the post-drop in-place rendering will look
            // like — same font family / weight / italic / decorations
            // as the source run, layered with any persisted style edit.
            const editedValue = edits.get(dragRun.id);
            const style = editedValue?.style ?? {};
            const text = editedValue?.text ?? dragRun.text;
            const fontFamily = style.fontFamily ?? dragRun.fontFamily;
            const fontSizeNat = style.fontSize ?? dragRun.height;
            const bold = style.bold ?? dragRun.bold;
            const italic = style.italic ?? dragRun.italic;
            const underline = style.underline ?? dragRun.underline ?? false;
            const strikethrough = style.strikethrough ?? dragRun.strikethrough ?? false;
            const dir = style.dir ?? "auto";
            // The portal sits in document.body where there's no CSS
            // transform — convert the natural-pixel font/line-height
            // values to screen pixels via the captured originDisplayScale.
            const ds = drag.originDisplayScale;
            const fontSizeScreen = fontSizeNat * ds;
            const lineHeightScreen = (dragRun.bounds.height + 4) * ds;
            return createPortal(
              <div
                aria-hidden
                style={{
                  position: "fixed",
                  left: drag.clientX - drag.cursorOffsetX,
                  top: drag.clientY - drag.cursorOffsetY,
                  width: drag.width,
                  height: drag.height,
                  outline: "1px dashed rgba(255, 180, 30, 0.9)",
                  // No background fill — a semi-opaque white card
                  // would cover whatever sits behind the cursor while
                  // the user drags across the page. The dashed outline
                  // alone is enough to convey "this is the thing
                  // being moved", and underlying content stays
                  // visible through the gaps between glyphs.
                  background: "transparent",
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  overflow: "visible",
                  zIndex: 10000,
                }}
              >
                <span
                  dir={dir}
                  style={{
                    fontFamily: `"${fontFamily}"`,
                    fontSize: `${fontSizeScreen}px`,
                    lineHeight: `${lineHeightScreen}px`,
                    fontWeight: bold ? 700 : 400,
                    fontStyle: italic ? "italic" : "normal",
                    textDecoration: cssTextDecoration(underline, strikethrough),
                    color: "black",
                    whiteSpace: "pre",
                    width: "100%",
                    paddingLeft: 2 * ds,
                    paddingRight: 2 * ds,
                  }}
                >
                  {text}
                </span>
              </div>,
              document.body,
            );
          })()
        : null}
    </div>
  );
}
