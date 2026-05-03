import { useEffect, useMemo, useRef, useState } from "react";
import type { RenderedPage } from "../../lib/pdf";
import type { ImageInsertion, TextInsertion } from "../../lib/insertions";
import { useThaanaTransliteration } from "../../lib/thaanaKeyboard";
import { useDragGesture } from "../../lib/useDragGesture";
import { useCenterInVisibleViewport } from "../../lib/useVisualViewport";
import { useIsMobile } from "../../lib/useMediaQuery";
import { EditTextToolbar } from "./EditTextToolbar";
import {
  chooseToolbarTop,
  cssTextDecoration,
  findPageAtPoint,
  isFocusMovingToToolbar,
} from "./helpers";
import type { ImageMoveValue, ResizeCorner, ToolbarBlocker } from "./types";

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
export function ImageOverlay({
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
  img: import("../../lib/sourceImages").ImageInstance;
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
        // Movable images: `pan-y pinch-zoom` lets the page scroll on
        // a quick finger swipe; the 400ms touch-hold gate in
        // useDragGesture is what actually claims the image as a drag.
        // Un-movable images keep default behaviour.
        touchAction: movable ? "pan-y pinch-zoom" : undefined,
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
export function InsertedTextOverlay({
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
  const isMobile = useIsMobile();
  // Mobile-only Latin → Thaana phonetic transliteration. Defaults on
  // (most users on mobile have a Latin keyboard); the toolbar's DV/EN
  // toggle flips it for the current edit session.
  const [thaanaInput, setThaanaInput] = useState(true);
  useThaanaTransliteration(inputRef, isMobile && isEditing && thaanaInput);
  // Centre the input in the visible viewport on mobile so the keyboard
  // doesn't cover it. Fires only while the input is mounted (isEditing).
  useCenterInVisibleViewport(inputRef, isMobile && isEditing);
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
  const strikethrough = !!style.strikethrough;
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
    strikethrough?: boolean;
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
    if (patch.strikethrough !== undefined) nextStyle.strikethrough = patch.strikethrough;
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
          strikethrough={strikethrough}
          dir={style.dir}
          thaanaInput={thaanaInput}
          onThaanaInputChange={setThaanaInput}
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
          // Allow native gestures while editing; in drag-affordance
          // state, `pan-y pinch-zoom` lets the page scroll on a quick
          // swipe — the 400ms touch-hold gate in useDragGesture
          // promotes the gesture to a drag.
          touchAction: isEditing ? "auto" : "pan-y pinch-zoom",
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
            // Mobile + DV mode: suppress the soft keyboard's autocorrect
            // / autocapitalise / spellcheck so each keystroke fires a
            // single-char `insertText` event the Thaana transliterator
            // can intercept. Off otherwise so Latin typing keeps native
            // affordances.
            autoComplete={isMobile && thaanaInput ? "off" : undefined}
            autoCorrect={isMobile && thaanaInput ? "off" : undefined}
            autoCapitalize={isMobile && thaanaInput ? "none" : undefined}
            spellCheck={isMobile && thaanaInput ? false : undefined}
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
              textDecoration: cssTextDecoration(underline, strikethrough),
              background: "transparent",
              // Wrapper paints rgba(255,255,255,0.9) — without explicit
              // color, dark mode lets text inherit the page's near-white
              // and the user types into invisible ink.
              color: "black",
              colorScheme: "light",
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
              textDecoration: cssTextDecoration(underline, strikethrough),
              paddingLeft: 4,
              paddingRight: 4,
              color: "black",
              whiteSpace: "pre",
              width: "100%",
            }}
            title={ins.text || "(empty — click to type)"}
          >
            {ins.text || " "}
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
export function InsertedImageOverlay({
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
        touchAction: "pan-y pinch-zoom",
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
export function ResizeHandle({
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

/** Selectable hit-zone for a vector shape (line, rect, path) detected
 *  on the source page. v1 only supports delete — no move, no resize.
 *  A thin shape (e.g. a 0.5pt horizontal rule) gets a minimum 8px
 *  square hit zone centred on the shape so the user can actually grab
 *  it on touch. Visual outline only appears on hover / select to keep
 *  the page uncluttered.  */
export function ShapeOverlay({
  shape,
  page,
  isSelected,
  onSelect,
}: {
  shape: import("../../lib/sourceShapes").ShapeInstance;
  page: RenderedPage;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const visW = shape.pdfWidth * page.scale;
  const visH = shape.pdfHeight * page.scale;
  const visLeft = shape.pdfX * page.scale;
  const visTop = page.viewHeight - (shape.pdfY + shape.pdfHeight) * page.scale;
  const MIN_HIT = 8;
  const hitW = Math.max(visW, MIN_HIT);
  const hitH = Math.max(visH, MIN_HIT);
  const left = visLeft - (hitW - visW) / 2;
  const top = visTop - (hitH - visH) / 2;
  return (
    <div
      data-shape-id={shape.id}
      role="button"
      tabIndex={0}
      aria-label="Vector shape — click to select, Del to delete"
      title="Click to select, Del to delete"
      style={{
        position: "absolute",
        left,
        top,
        width: hitW,
        height: hitH,
        // Only paint an outline when selected or hovered — a permanent
        // outline on every detected shape would clutter the page (large
        // PDFs can have dozens of shapes).
        outline: isSelected ? "2px solid rgba(220, 50, 50, 0.85)" : undefined,
        outlineOffset: isSelected ? "1px" : undefined,
        cursor: "pointer",
        pointerEvents: "auto",
        // Same as image overlays: one-finger drag still pans the page,
        // a tap selects.
        touchAction: "pinch-zoom",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    />
  );
}
