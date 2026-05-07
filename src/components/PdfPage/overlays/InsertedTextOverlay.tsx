import { useEffect, useRef, useState } from "react";
import type { AnnotationColor } from "../../../lib/annotations";
import { colorToCss } from "../../../lib/color";
import type { RenderedPage } from "../../../lib/pdf";
import type { TextInsertion } from "../../../lib/insertions";
import { useThaanaTransliteration } from "../../../lib/thaanaKeyboard";
import { useCenterInVisibleViewport } from "../../../lib/useVisualViewport";
import { useIsMobile } from "../../../lib/useMediaQuery";
import { EditTextToolbar } from "../EditTextToolbar";
import { pdfBaselineToViewportBox } from "../geometry";
import {
  chooseToolbarTop,
  cssTextDecoration,
  findPageAtPoint,
  focusInputAtInitialCaret,
  isFocusMovingToToolbar,
} from "../helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "../types";
import { useCrossPageDragPreview } from "../useCrossPageDragPreview";

/** Net-new text the user typed at a fresh position on the page (not
 *  associated with any source run). Click-to-edit, drag-to-move,
 *  Backspace on empty content deletes. Editing pops a formatting
 *  toolbar (font / size / B / I / U) above the input, identical to
 *  the EditField used for source-run edits. Saved by appending a
 *  drawText to the page content stream — see save.ts insertion path. */
export function InsertedTextOverlay({
  ins,
  page,
  slotIndex,
  displayScale,
  toolbarBlockers,
  isEditing,
  initialCaretPoint,
  onChange,
  onDelete,
  onOpen,
  onClose,
}: {
  ins: TextInsertion;
  page: RenderedPage;
  /** Slot index this insertion is currently rendered in. Used to detect
   *  cross-page drops and to look up the origin page's screen rect.
   *  `ins.pageIndex` is the SOURCE page index (offset within its source
   *  doc) — different number space, can't be used here. */
  slotIndex: number;
  /** Source page's natural→displayed ratio. Drag deltas in screen px
   *  divide by `displayScale * page.scale` to land in PDF user space. */
  displayScale: number;
  toolbarBlockers: readonly ToolbarBlocker[];
  isEditing: boolean;
  initialCaretPoint?: InitialCaretPoint;
  onChange: (patch: Partial<TextInsertion>) => void;
  onDelete: () => void;
  onOpen: (initialCaretPoint?: InitialCaretPoint) => void;
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
  // Default to black when no color override is set — same as the
  // pre-color-picker hardcoded behavior. `colorToCss` returns null
  // for undefined so the `??` lets us fall back inline.
  const cssColor = colorToCss(style.color) ?? "black";
  const fontSizePt = ins.fontSize;
  // PDF user-space (pdfX, pdfY) is the BASELINE of the text. The
  // viewport top of the box is baseline - fontSize, scaled. Match the
  // EditField rendering: render text in a box of height = fontSize × 1.4
  // so descenders fit.
  const lineHeight = fontSizePt * 1.4;
  const { left, top, width, height } = pdfBaselineToViewportBox({
    pdfX: ins.pdfX,
    pdfY: ins.pdfY,
    fontSizePt,
    lineHeightPt: lineHeight,
    widthPt: ins.pdfWidth,
    minWidthPx: 60,
    pageScale: page.scale,
    viewHeight: page.viewHeight,
  });
  const fontSizePx = fontSizePt * page.scale;
  useEffect(() => {
    if (isEditing) {
      if (inputRef.current) focusInputAtInitialCaret(inputRef.current, initialCaretPoint);
    }
  }, [isEditing, initialCaretPoint]);

  // Click-outside-to-close. Same reason as EditField: the input's
  // onBlur fires once when focus first moves to the toolbar (suppressed
  // by the toolbar relatedTarget check), and after the user finishes
  // with a toolbar control no further blur arrives on a page-body click.
  useEffect(() => {
    if (!isEditing) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (inputRef.current?.contains(t)) return;
      if (t instanceof HTMLElement && t.closest("[data-edit-toolbar]")) return;
      if (ins.text === "") onDelete();
      onClose();
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [isEditing, ins.text, onClose, onDelete]);

  const updateStyle = (patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    /** `null` clears an explicit dir back to auto-detect. */
    dir?: "rtl" | "ltr" | null;
    color?: AnnotationColor;
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
    if (patch.color !== undefined) nextStyle.color = patch.color;
    const insPatch: Partial<TextInsertion> = { style: nextStyle };
    if (patch.fontSize !== undefined) insPatch.fontSize = patch.fontSize;
    onChange(insPatch);
  };

  // Drag-pixel → PDF-unit conversion factor: a screen-pixel delta
  // divided by `effectivePdfScale` lands in PDF user space.
  const effectivePdfScale = page.scale * displayScale;
  type InsTextDragCtx = { baseX: number; baseY: number };
  const { overlayRef, dragLive, beginDrag, renderPortal } = useCrossPageDragPreview<InsTextDragCtx>(
    {
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
        // hit.pageIndex is the SLOT index of the dropped-on page; compare
        // against the origin slot, not ins.pageIndex (which is the
        // source-page offset within ins.sourceKey's doc).
        const hit = findPageAtPoint(info.clientX, info.clientY);
        if (!hit || hit.pageIndex === slotIndex) return;
        const originRect = document
          .querySelector<HTMLElement>(`[data-page-index="${slotIndex}"]`)
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
    },
  );
  const startDrag = (e: React.PointerEvent) => {
    if (isEditing) return;
    beginDrag(e, { baseX: ins.pdfX, baseY: ins.pdfY });
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
          color={style.color}
          thaanaInput={thaanaInput}
          onThaanaInputChange={setThaanaInput}
          onChange={(patch) => {
            // Toolbar already reports fontSize in PDF points — store
            // it directly on the insertion, no scale conversion.
            updateStyle(patch);
          }}
          onDelete={() => {
            onDelete();
            onClose();
          }}
        />
      ) : null}
      <div
        ref={overlayRef}
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
          cursor: isEditing || !dragLive?.moved ? "text" : "grabbing",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          zIndex: 20,
          // Once the user actually moves, the in-parent copy stays
          // mounted (so its rect reference for the drop math is
          // stable) but we hide it — the body-portal clone below is
          // what the user sees. We DON'T hide on gesture-start alone:
          // mouse pointers activate the gesture eagerly on
          // pointerdown, and a no-motion click would otherwise hit a
          // hidden span and skip the editor handoff.
          visibility: dragLive?.moved ? "hidden" : "visible",
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
          if (!isEditing) onOpen({ clientX: e.clientX, clientY: e.clientY });
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
              // and the user types into invisible ink. When the user
              // picks a color the same property carries it.
              color: cssColor,
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
              color: cssColor,
              whiteSpace: "pre",
              width: "100%",
            }}
            title={ins.text || "(empty — click to type)"}
          >
            {ins.text || " "}
          </span>
        )}
      </div>
      {renderPortal(
        {
          outline: "1px dashed rgba(40, 130, 255, 0.85)",
          background: "rgba(255, 255, 255, 0.6)",
          display: "flex",
          alignItems: "center",
        },
        <span
          dir={style.dir ?? "auto"}
          style={{
            fontFamily: `"${family}"`,
            // Match the in-parent visual size: in-parent uses NATURAL
            // px inside a `transform: scale(displayScale)` container;
            // the portal lives in document.body (no transform) so
            // multiply once here to land at the same on-screen size.
            fontSize: `${fontSizePx * displayScale}px`,
            lineHeight: `${height * displayScale}px`,
            fontWeight: bold ? 700 : 400,
            fontStyle: italic ? "italic" : "normal",
            textDecoration: cssTextDecoration(underline, strikethrough),
            paddingLeft: 4,
            paddingRight: 4,
            color: cssColor,
            whiteSpace: "pre",
            width: "100%",
          }}
        >
          {ins.text || " "}
        </span>,
      )}
    </>
  );
}
