import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import type { RenderedPage, TextRun } from "../lib/pdf";
import type { EditStyle } from "../lib/save";
import type {
  ImageInsertion,
  TextInsertion,
} from "../lib/insertions";
import type { ToolMode } from "../App";
import { FONTS } from "../lib/fonts";

export type EditValue = {
  text: string;
  style?: EditStyle;
  /** Move offset from the original run position, in viewport pixels.
   *  Positive dx → right, positive dy → down. Saved by translating the
   *  drawn text by (dx / scale, -dy / scale) in PDF user space. */
  dx?: number;
  dy?: number;
};

/** Move offset for one image instance, in viewport pixels (same axis
 *  convention as EditValue). Saved by adding (dx/scale, -dy/scale) to
 *  the matching cm op's translation operands. */
export type ImageMoveValue = {
  dx?: number;
  dy?: number;
};

const DRAG_THRESHOLD_PX = 3;

type Props = {
  page: RenderedPage;
  pageIndex: number;
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
};

export function PdfPage({
  page,
  pageIndex,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  previewCanvas,
  tool,
  editingId,
  onEdit,
  onImageMove,
  onEditingChange,
  onCanvasClick,
  onTextInsertChange,
  onTextInsertDelete,
  onImageInsertChange,
  onImageInsertDelete,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setEditingId = (next: string | null) => {
    onEditingChange(next);
  };
  /** While dragging a run, the live offset for the dragged run. We keep
   *  it in local state during the drag so we don't churn the parent's
   *  edits Map on every mousemove. */
  const [drag, setDrag] = useState<
    | { runId: string; startX: number; startY: number; dx: number; dy: number }
    | null
  >(null);
  /** Same idea for images. Separate state because image drags don't
   *  have the click-suppression / edit handoff that text runs do. */
  const [imageDrag, setImageDrag] = useState<
    | { imageId: string; startX: number; startY: number; dx: number; dy: number }
    | null
  >(null);
  /** Set to the runId during a drag and cleared a tick after mouseup, used
   *  to suppress the click-to-edit that would otherwise fire after a drag
   *  (Playwright's synthesised events don't match the browser's native
   *  click-suppression on movement, so we guard explicitly). */
  const justDraggedRef = useRef<string | null>(null);

  useEffect(() => {
    const node = containerRef.current?.querySelector(
      "[data-canvas-slot]",
    ) as HTMLElement | null;
    if (!node) return;
    // Paint the preview canvas (= original content stream minus the
    // items the user is currently editing/moving) when one is
    // available; otherwise fall back to the original render. Either
    // way we size to the same viewport so the HTML overlay positions
    // line up.
    const liveCanvas = previewCanvas ?? page.canvas;
    node.replaceChildren(liveCanvas);
    liveCanvas.style.display = "block";
    liveCanvas.style.width = `${page.viewWidth}px`;
    liveCanvas.style.height = `${page.viewHeight}px`;
  }, [page, previewCanvas]);

  /** Start a drag on a run. The handlers track movement on the window so
   *  the drag continues even if the cursor leaves the original span. */
  const startDrag = (
    runId: string,
    e: React.MouseEvent,
    base: { dx: number; dy: number },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    setDrag({ runId, startX, startY, dx: base.dx, dy: base.dy });

    const onMove = (ev: MouseEvent) => {
      const newDx = base.dx + (ev.clientX - startX);
      const newDy = base.dy + (ev.clientY - startY);
      setDrag((prev) =>
        prev && prev.runId === runId
          ? { ...prev, dx: newDx, dy: newDy }
          : prev,
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
      onEdit(runId, { ...existing, dx: totalDx, dy: totalDy });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** Start a drag on an image overlay. Mirrors startDrag for runs but
   *  commits to the parent's onImageMove rather than onEdit. */
  const startImageDrag = (
    imageId: string,
    e: React.MouseEvent,
    base: { dx: number; dy: number },
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    setImageDrag({ imageId, startX, startY, dx: base.dx, dy: base.dy });
    const onMove = (ev: MouseEvent) => {
      const newDx = base.dx + (ev.clientX - startX);
      const newDy = base.dy + (ev.clientY - startY);
      setImageDrag((prev) =>
        prev && prev.imageId === imageId
          ? { ...prev, dx: newDx, dy: newDy }
          : prev,
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
      onImageMove(imageId, { dx: totalDx, dy: totalDy });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className="relative inline-block shadow-md"
      style={{ width: page.viewWidth, height: page.viewHeight }}
      data-page-index={pageIndex}
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
                initial={
                  editedValue ?? { text: run.text, style: undefined }
                }
                onCommit={(value) => {
                  // Preserve any existing move offset (dx/dy) — the
                  // EditField only owns text + style, so we layer back
                  // the persisted offset from editedValue.
                  const merged: EditValue = {
                    ...value,
                    dx: editedValue?.dx ?? 0,
                    dy: editedValue?.dy ?? 0,
                  };
                  const hasOffset =
                    (merged.dx ?? 0) !== 0 || (merged.dy ?? 0) !== 0;
                  if (value.text !== run.text || value.style || hasOffset) {
                    onEdit(run.id, merged);
                  }
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
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
                    fontStyle:
                      (style.italic ?? run.italic) ? "italic" : "normal",
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
        {page.images.map((img) => (
          <ImageOverlay
            key={img.id}
            img={img}
            page={page}
            persisted={imageMoves.get(img.id)}
            isDragging={imageDrag?.imageId === img.id}
            liveDx={imageDrag?.imageId === img.id ? imageDrag.dx : null}
            liveDy={imageDrag?.imageId === img.id ? imageDrag.dy : null}
            onMouseDown={(e, base) => startImageDrag(img.id, e, base)}
          />
        ))}
        {/* Inserted (net-new) text boxes. These render the same way as
            edited runs do — drag to move, click to edit — but the save
            path treats them as fresh content rather than a rewrite. */}
        {insertedTexts.map((ins) => (
          <InsertedTextOverlay
            key={ins.id}
            ins={ins}
            page={page}
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
        {/* Inserted images — drag to move, double-click to delete. */}
        {insertedImages.map((ins) => (
          <InsertedImageOverlay
            key={ins.id}
            ins={ins}
            page={page}
            onChange={(patch) => onImageInsertChange(ins.id, patch)}
            onDelete={() => onImageInsertDelete(ins.id)}
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
  liveDx,
  liveDy,
  onMouseDown,
}: {
  img: import("../lib/sourceImages").ImageInstance;
  page: RenderedPage;
  persisted: ImageMoveValue | undefined;
  isDragging: boolean;
  liveDx: number | null;
  liveDy: number | null;
  onMouseDown: (
    e: React.MouseEvent,
    base: { dx: number; dy: number },
  ) => void;
}) {
  // PDF user-space → viewport: x scales directly; y flips around the
  // page bottom. CTM origin (pdfX, pdfY) is the bottom-left corner in
  // PDF y-up so the viewport top is page.viewHeight - (pdfY + pdfH) × s.
  const left = img.pdfX * page.scale;
  const top = page.viewHeight - (img.pdfY + img.pdfHeight) * page.scale;
  const w = img.pdfWidth * page.scale;
  const h = img.pdfHeight * page.scale;
  const dx = (liveDx ?? persisted?.dx) ?? 0;
  const dy = (liveDy ?? persisted?.dy) ?? 0;
  const isMoved = dx !== 0 || dy !== 0;
  const movable = img.cmOpIndex != null;

  // Crop the image's pixels from the ORIGINAL page canvas (not the
  // preview, which has the image stripped) so we can paint them at the
  // moved position. Done lazily — only when first moved.
  const sprite = useMemo(() => {
    if (!isMoved) return null;
    return cropCanvasToDataUrl(page.canvas, left, top, w, h);
  }, [isMoved, page.canvas, left, top, w, h]);

  return (
    <div
      data-image-id={img.id}
      style={{
        position: "absolute",
        left: left + dx,
        top: top + dy,
        width: w,
        height: h,
        outline: movable
          ? isDragging
            ? "1px dashed rgba(60, 130, 255, 0.85)"
            : isMoved
              ? "1px solid rgba(60, 130, 255, 0.45)"
              : "1px dashed rgba(60, 130, 255, 0)"
          : "1px dashed rgba(160, 160, 160, 0.55)",
        backgroundImage: sprite ? `url(${sprite})` : undefined,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        cursor: movable
          ? isDragging
            ? "grabbing"
            : "grab"
          : "not-allowed",
        pointerEvents: "auto",
      }}
      title={
        movable
          ? `Image ${img.resourceName} (drag to move)`
          : `Image ${img.resourceName} (un-movable)`
      }
      onMouseDown={(e) => {
        if (!movable) return;
        onMouseDown(e, { dx, dy });
      }}
    />
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
    ctx.drawImage(
      src,
      x * sx,
      y * sy,
      w * sx,
      h * sy,
      0,
      0,
      dst.width,
      dst.height,
    );
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
  isEditing,
  onChange,
  onDelete,
  onOpen,
  onClose,
}: {
  ins: TextInsertion;
  page: RenderedPage;
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
  const family =
    style.fontFamily ?? (isRtlText ? "Faruma" : "Arial");
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
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

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
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <>
      {isEditing ? (
        <EditTextToolbar
          left={left - 2}
          top={top - 48}
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
  onChange,
  onDelete,
}: {
  ins: ImageInsertion;
  page: RenderedPage;
  onChange: (patch: Partial<ImageInsertion>) => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // Once-only data URL for the chosen image so the browser caches it.
  const dataUrl = useMemo(() => {
    const blob = new Blob([ins.bytes as BlobPart], {
      type: `image/${ins.format}`,
    });
    return URL.createObjectURL(blob);
  }, [ins.bytes, ins.format]);
  useEffect(() => {
    return () => URL.revokeObjectURL(dataUrl);
  }, [dataUrl]);

  const left = ins.pdfX * page.scale;
  const top = page.viewHeight - (ins.pdfY + ins.pdfHeight) * page.scale;
  const w = ins.pdfWidth * page.scale;
  const h = ins.pdfHeight * page.scale;

  const startDrag = (e: React.MouseEvent) => {
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
        pdfY: d.baseY - dyView / page.scale,
      });
    };
    const onUp = () => {
      dragRef.current = null;
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
        outline: "1px dashed rgba(40, 130, 255, 0.6)",
        cursor: "grab",
        pointerEvents: "auto",
        zIndex: 20,
      }}
      title={`Inserted image (double-click to delete)`}
      onMouseDown={startDrag}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    />
  );
}

function EditField({
  run,
  pageScale,
  initial,
  onCommit,
  onCancel,
}: {
  run: TextRun;
  /** Viewport pixels per PDF point — used to convert between the
   *  toolbar's user-facing PDF-point size and the CSS pixel size for
   *  rendering. */
  pageScale: number;
  initial: EditValue;
  onCommit: (value: EditValue) => void;
  onCancel: () => void;
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
  const [width, setWidth] = useState<number>(
    Math.max(run.bounds.width + 24, 80),
  );

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
        top={run.bounds.top - 48 + dy}
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

function hasStyle(s: EditStyle): boolean {
  return !!(
    s.fontFamily ||
    s.fontSize ||
    s.bold ||
    s.italic ||
    s.underline
  );
}

/** True when a `blur` event is moving focus into the formatting
 *  toolbar (so the editor should stay open). Caller passes the blur
 *  event's `relatedTarget`. */
function isFocusMovingToToolbar(
  next: EventTarget | null,
): boolean {
  return (
    next instanceof HTMLElement &&
    !!next.closest("[data-edit-toolbar]")
  );
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
}) {
  return (
    <div
      data-edit-toolbar
      style={{
        position: "absolute",
        left,
        top,
        zIndex: 30,
        display: "flex",
        gap: 4,
        padding: 4,
        background: "white",
        border: "1px solid rgba(0,0,0,0.15)",
        borderRadius: 6,
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
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
        style={{
          padding: "4px 6px",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 4,
          fontSize: 12,
          background: "white",
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
        style={{
          width: 56,
          padding: "4px 6px",
          border: "1px solid rgba(0,0,0,0.15)",
          borderRadius: 4,
          fontSize: 12,
        }}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange({ fontSize: v });
        }}
      />
      <ToggleButton
        label="B"
        active={bold}
        weight="bold"
        onClick={() => onChange({ bold: !bold })}
      />
      <ToggleButton
        label="I"
        active={italic}
        italic
        onClick={() => onChange({ italic: !italic })}
      />
      <ToggleButton
        label="U"
        active={underline}
        underline
        onClick={() => onChange({ underline: !underline })}
      />
      {onCancel ? (
        <Button
          size="sm"
          variant="ghost"
          onPress={() => onCancel()}
          aria-label="Cancel edit"
        >
          ✕
        </Button>
      ) : null}
    </div>
  );
}

function ToggleButton({
  label,
  active,
  weight,
  italic,
  underline,
  onClick,
}: {
  label: string;
  active: boolean;
  weight?: "bold";
  italic?: boolean;
  underline?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-pressed={active}
      style={{
        width: 26,
        height: 26,
        border: "1px solid rgba(0,0,0,0.15)",
        borderRadius: 4,
        background: active ? "rgb(219, 234, 254)" : "white",
        cursor: "pointer",
        fontWeight: weight === "bold" ? 700 : 500,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : "none",
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}
