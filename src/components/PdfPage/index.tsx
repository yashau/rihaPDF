import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { colorToCss } from "../../lib/color";
import type { RenderedPage, TextRun } from "../../lib/pdf";
import type { ImageInsertion, TextInsertion } from "../../lib/insertions";
import {
  type Annotation,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_LINE_PAD,
  lineMarkupRect,
  newAnnotationId,
} from "../../lib/annotations";
import { newRedactionId, REDACTION_LINE_PAD, type Redaction } from "../../lib/redactions";
import type { ToolMode } from "../../App";
import {
  ImageOverlay,
  InsertedImageOverlay,
  InsertedTextOverlay,
  RedactionOverlay,
  ShapeOverlay,
} from "./overlays";
import { AnnotationLayer } from "./AnnotationLayer";
import { CrossPageImageArrivalOverlay, CrossPageTextArrivalOverlay } from "./arrivals";
import { SourceRunOverlay } from "./SourceRunOverlay";
import { cssTextDecoration } from "./helpers";
import { useRunDrag } from "./useRunDrag";
import { useImageDrag } from "./useImageDrag";
import type {
  CrossPageArrival,
  CrossPageImageArrival,
  EditValue,
  ImageMoveValue,
  ToolbarBlocker,
} from "./types";

export type {
  CrossPageArrival,
  CrossPageImageArrival,
  EditValue,
  ImageMoveValue,
  ToolbarBlocker,
} from "./types";

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
  redactions: Redaction[];
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
  /** ID of the redaction currently selected on this page. */
  selectedRedactionId: string | null;
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
  onRedactionAdd: (redaction: Redaction) => void;
  onRedactionChange: (id: string, patch: Partial<Redaction>) => void;
  onSelectRedaction: (id: string) => void;
  /** Source-page text runs that have been moved cross-page and now
   *  visually live on THIS slot. Built by PageList from the source-
   *  side `edits` map. Rendered as non-interactive styled spans at
   *  `targetPdfX/Y` — without this layer the runs disappear from the
   *  source canvas (preview-strip) but never reappear on the target,
   *  so the user can't see what they moved until save. */
  crossPageArrivals: CrossPageArrival[];
  /** Same idea for source IMAGES that have been moved cross-page —
   *  the source canvas strip removes them, so the target slot needs
   *  to paint them back at the dropped location. */
  crossPageImageArrivals: CrossPageImageArrival[];
  /** Re-drag handlers for arrivals. The arrival overlay calls these
   *  when the user grabs a moved item on the target page and drops
   *  it elsewhere — they write back to the SOURCE slot's edits /
   *  imageMoves entry (where the cross-page move actually lives), so
   *  any subsequent move stays anchored to its origin. The signatures
   *  match App.tsx's `onEdit` / `onImageMove` directly: the arrival
   *  carries the source slot id; the App handler handles
   *  `targetPageIndex → targetSlotId` resolution. */
  onSourceEdit: (sourceSlotId: string, runId: string, value: EditValue) => void;
  onSourceImageMove: (sourceSlotId: string, imageId: string, value: ImageMoveValue) => void;
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
  redactions,
  previewCanvas,
  tool,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  selectedShapeId,
  selectedRedactionId,
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
  onRedactionAdd,
  onRedactionChange,
  onSelectRedaction,
  crossPageArrivals,
  crossPageImageArrivals,
  onSourceEdit,
  onSourceImageMove,
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

  const setEditingId = (next: string | null) => {
    onEditingChange(next);
  };

  // Source-run drag gesture (in-place dx/dy + body-portal preview +
  // cross-page commit). `drag` drives the renderer; `startDrag` is
  // wired onto each run overlay's onPointerDown; `justDraggedRef`
  // suppresses the trailing click that would otherwise pop the editor.
  const { drag, startDrag, justDraggedRef } = useRunDrag({
    page,
    pageIndex,
    edits,
    onEdit,
    containerRef,
    displayScale,
  });
  // Image translate + corner-resize gestures. Both produce the same
  // `imageDrag` state shape (corner === null distinguishes translate);
  // the renderer reads it for live position / size and the body-portal
  // preview during translate gestures.
  const { imageDrag, startImageDrag, startImageResize } = useImageDrag({
    page,
    pageIndex,
    onImageMove,
    containerRef,
    displayScale,
  });

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

  /** Add a highlight annotation covering a single run. We don't reuse
   *  `run.bounds` directly here — that envelope carries extra padding
   *  for replacement-text overlays (fili headroom) and reads as offset
   *  too high when used as a markup rect. `lineMarkupRect` rebuilds a
   *  tighter rect from the run's baseline + height, balanced around the
   *  glyph row. Multi-line highlight (one annotation, many quads) is a
   *  Phase 2 feature; one click currently means one quad. */
  const addHighlightForRun = (run: TextRun) => {
    const [llx, lly, urx, ury] = lineMarkupRect(
      run,
      page.scale,
      page.viewHeight,
      HIGHLIGHT_LINE_PAD,
    );
    onAnnotationAdd({
      kind: "highlight",
      id: newAnnotationId("highlight"),
      sourceKey,
      pageIndex,
      quads: [
        { x1: llx, y1: ury, x2: urx, y2: ury, x3: llx, y3: lly, x4: urx, y4: lly },
      ],
      color: DEFAULT_HIGHLIGHT_COLOR,
    });
  };

  /** Drop a redaction rect over a single run. The default size comes
   *  from `lineMarkupRect` with `REDACTION_LINE_PAD` — generous
   *  enough that no glyph extents leak past the box on typical
   *  Thaana/Latin runs. The user can drag corners to tighten or
   *  expand after the click; the save pipeline strips whatever runs
   *  intersect the FINAL rect (not the originally-clicked run), so
   *  resize is meaningful, not cosmetic. */
  const addRedactionForRun = (run: TextRun) => {
    const [llx, lly, urx, ury] = lineMarkupRect(
      run,
      page.scale,
      page.viewHeight,
      REDACTION_LINE_PAD,
    );
    onRedactionAdd({
      id: newRedactionId(),
      sourceKey,
      pageIndex,
      pdfX: llx,
      pdfY: lly,
      pdfWidth: urx - llx,
      pdfHeight: ury - lly,
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
          {page.textRuns.map((run) => (
            <SourceRunOverlay
              key={run.id}
              run={run}
              page={page}
              tool={tool}
              isEditing={editingId === run.id}
              editedValue={edits.get(run.id)}
              drag={drag}
              startDrag={startDrag}
              justDraggedRef={justDraggedRef}
              toolbarBlockers={toolbarBlockers}
              onEdit={onEdit}
              onEditingChange={setEditingId}
              addHighlightForRun={addHighlightForRun}
              addRedactionForRun={addRedactionForRun}
            />
          ))}
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
                hideInPlace={
                  imageDrag?.imageId === img.id && imageDrag.corner === null && imageDrag.moved
                }
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
          {/* Redactions — opaque black rectangles. Preview-only here:
            the underlying glyphs are still in the live canvas; the
            save pipeline strips them at output time. Click to select,
            then drag corners to resize or Del to remove. */}
          {redactions.map((r) => (
            <RedactionOverlay
              key={r.id}
              redaction={r}
              page={page}
              displayScale={displayScale}
              isSelected={selectedRedactionId === r.id}
              onChange={(patch) => onRedactionChange(r.id, patch)}
              onSelect={() => onSelectRedaction(r.id)}
            />
          ))}
          {/* Cross-page-arrived runs: source-page text the user dragged
            ONTO this slot. The source-side preview-strip removes the
            original glyphs from the source canvas; without these
            spans the run would otherwise vanish entirely until save.
            v1: render-only — to drag again the user has to undo and
            re-do the move. The save pipeline reads `targetSlotId`
            directly, so these spans are purely for live feedback. */}
          {crossPageArrivals.map((arr) => (
            <CrossPageTextArrivalOverlay
              key={arr.key}
              arr={arr}
              page={page}
              displayScale={displayScale}
              onSourceEdit={onSourceEdit}
            />
          ))}
          {/* Cross-page-arrived source images: dropped onto this slot
            from another page. Same rationale as the text arrivals
            above — the source-side preview-strip removed the image's
            pixels from the source canvas, so without this layer it
            would just be a hole until the user saves. */}
          {crossPageImageArrivals.map((arr) => (
            <CrossPageImageArrivalOverlay
              key={arr.key}
              arr={arr}
              page={page}
              onSourceImageMove={onSourceImageMove}
            />
          ))}
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
            const cssColor = colorToCss(style.color) ?? "black";
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
                    color: cssColor,
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
      {/* Body-portal'd drag preview for SOURCE images. Same rationale
          as the source-run portal above. Only rendered for translate
          gestures (corner === null) once the user has actually moved;
          resize gestures stay on the source page so they don't need a
          portal. */}
      {imageDrag && imageDrag.corner === null && imageDrag.moved
        ? (() => {
            if (imageDrag.width <= 0 || imageDrag.height <= 0) return null;
            return createPortal(
              <div
                aria-hidden
                style={{
                  position: "fixed",
                  left: imageDrag.clientX - imageDrag.cursorOffsetX,
                  top: imageDrag.clientY - imageDrag.cursorOffsetY,
                  width: imageDrag.width,
                  height: imageDrag.height,
                  backgroundImage: imageDrag.sprite ? `url(${imageDrag.sprite})` : undefined,
                  backgroundSize: "100% 100%",
                  backgroundRepeat: "no-repeat",
                  outline: "1px dashed rgba(60, 130, 255, 0.85)",
                  pointerEvents: "none",
                  zIndex: 10000,
                }}
              />,
              document.body,
            );
          })()
        : null}
    </div>
  );
}
