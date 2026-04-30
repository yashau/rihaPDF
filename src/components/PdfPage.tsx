import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import type { RenderedPage, TextRun } from "../lib/pdf";
import type { EditStyle } from "../lib/save";
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
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
};

export function PdfPage({
  page,
  pageIndex,
  edits,
  imageMoves,
  onEdit,
  onImageMove,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    node.replaceChildren(page.canvas);
    page.canvas.style.display = "block";
    page.canvas.style.width = `${page.viewWidth}px`;
    page.canvas.style.height = `${page.viewHeight}px`;
  }, [page]);

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
      <div
        className="absolute inset-0"
        style={{ pointerEvents: editingId === null ? "auto" : "none" }}
      >
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

          // Cover the original glyphs at their unmodified bounds so a drag,
          // text replacement, OR an open editor makes the source disappear
          // immediately. Without this, the canvas glyphs bleed through and
          // the user sees both the old text and the editor / replacement.
          const padX = 4;
          const padY = Math.max(run.height * 0.25, 4);
          const cover =
            isModified || isEditing ? (
              <div
                key={`${run.id}-cover`}
                aria-hidden
                style={{
                  position: "absolute",
                  left: run.bounds.left - padX,
                  top: run.bounds.top - padY,
                  width: Math.max(run.bounds.width, 12) + padX * 2,
                  height: run.bounds.height + padY * 2,
                  backgroundColor: "white",
                  pointerEvents: "none",
                }}
              />
            ) : null;

          if (isEditing) {
            return (
              <Fragment key={run.id}>
                {cover}
                <EditField
                  run={run}
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
              </Fragment>
            );
          }

          if (edited) {
            const style = editedValue.style ?? {};
            return (
              <Fragment key={run.id}>
                {cover}
                <span
                  data-run-id={run.id}
                  style={{
                    position: "absolute",
                    left: run.bounds.left - padX + dx,
                    top: run.bounds.top - padY + dy,
                    width: Math.max(run.bounds.width, 12) + padX * 2,
                    height: run.bounds.height + padY * 2,
                    backgroundColor: "white",
                    outline: "1px solid rgba(255, 200, 60, 0.7)",
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
              </Fragment>
            );
          }
          // Unedited (and possibly mid-drag): cover hides the original PDF
          // glyphs while the user is dragging so the run appears to truly
          // detach from its source position.
          return (
            <Fragment key={run.id}>
              {cover}
              <span
                data-run-id={run.id}
                dir="auto"
                className="thaana-stack absolute select-text"
                style={{
                  left: run.bounds.left + dx,
                  top: run.bounds.top + dy,
                  width: Math.max(run.bounds.width, 12),
                  height: run.bounds.height,
                  fontSize: `${run.height}px`,
                  lineHeight: `${run.bounds.height}px`,
                  // While dragging, render the run visibly so the user
                  // sees what they're moving (and the cover hides the
                  // original underneath). At rest the span stays a
                  // transparent click target.
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
            </Fragment>
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

  // Crop the image's pixels from the page canvas exactly once so we can
  // paint them at the moved position. Done lazily (only when first
  // moved) so we don't burn CPU on documents the user never edits.
  const sprite = useMemo(() => {
    if (!isMoved) return null;
    return cropCanvasToDataUrl(page.canvas, left, top, w, h);
  }, [isMoved, page.canvas, left, top, w, h]);

  return (
    <Fragment>
      {isMoved ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left,
            top,
            width: w,
            height: h,
            backgroundColor: "white",
            pointerEvents: "none",
          }}
        />
      ) : null}
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
    </Fragment>
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

function EditField({
  run,
  initial,
  onCommit,
  onCancel,
}: {
  run: TextRun;
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
  const fontSizePx = style.fontSize ?? run.height;

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
      {/* Floating toolbar above the input */}
      <div
        data-edit-toolbar
        style={{
          position: "absolute",
          left: run.bounds.left - 2 + dx,
          top: run.bounds.top - 48 + dy,
          zIndex: 10,
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
        onMouseDown={(e) => {
          // Prevent the input from blurring (which commits the edit) when
          // the user clicks a toolbar button.
          e.preventDefault();
        }}
      >
        <select
          aria-label="Font"
          value={style.fontFamily ?? run.fontFamily}
          style={{
            padding: "4px 6px",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 4,
            fontSize: 12,
            background: "white",
            minWidth: 140,
          }}
          onChange={(e) =>
            setStyle((s) => ({ ...s, fontFamily: e.target.value }))
          }
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
          value={Math.round(fontSizePx)}
          style={{
            width: 56,
            padding: "4px 6px",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 4,
            fontSize: 12,
          }}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setStyle((s) => ({
              ...s,
              fontSize: Number.isFinite(v) ? v : undefined,
            }));
          }}
        />
        <ToggleButton
          label="B"
          active={effectiveBold}
          weight="bold"
          onClick={() =>
            setStyle((s) => ({ ...s, bold: !(s.bold ?? run.bold) }))
          }
        />
        <ToggleButton
          label="I"
          active={effectiveItalic}
          italic
          onClick={() =>
            setStyle((s) => ({ ...s, italic: !(s.italic ?? run.italic) }))
          }
        />
        <ToggleButton
          label="U"
          active={!!style.underline}
          underline
          onClick={() => setStyle((s) => ({ ...s, underline: !s.underline }))}
        />
        <Button
          size="sm"
          variant="ghost"
          onPress={() => onCancel()}
          aria-label="Cancel edit"
        >
          ✕
        </Button>
      </div>
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
        onBlur={commit}
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
