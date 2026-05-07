import type { RenderedPage } from "@/pdf/render/pdf";
import type { TextInsertion } from "@/domain/insertions";
import { richTextOrPlain } from "@/domain/richText";
import { pdfBaselineToViewportBox } from "../geometry";
import {
  chooseToolbarTop,
  findPageAtPoint,
} from "../helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "../types";
import { useCrossPageDragPreview } from "../useCrossPageDragPreview";
import { RichTextEditor, RichTextView, uniformSpanStyle } from "../RichTextEditor";

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
  const defaultStyle = {
    fontFamily: family,
    fontSize: fontSizePt,
    bold,
    italic,
    underline,
    strikethrough,
    dir: style.dir,
    color: style.color,
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
        <RichTextEditor
          id={ins.id}
          initial={richTextOrPlain(ins.richText, ins.text, ins.style)}
          defaultStyle={defaultStyle}
          pageScale={page.scale}
          left={left - 2}
          top={top}
          width={width}
          minHeight={height}
          lineHeight={height}
          toolbarLeft={left - 2}
          toolbarTop={chooseToolbarTop({
            editorLeft: left - 2,
            editorTop: top,
            editorBottom: top + height,
            blockers: toolbarBlockers,
            selfId: ins.id,
          })}
          boundaryWidth={page.viewWidth}
          initialCaretOffset={initialCaretPoint?.caretOffset}
          onCommit={(richText) => {
            if (richText.text === "") {
              onDelete();
              onClose();
              return;
            }
            const nextStyle = uniformSpanStyle(richText);
            onChange({
              text: richText.text,
              richText,
              style: nextStyle,
              fontSize: nextStyle?.fontSize ?? ins.fontSize,
            });
            onClose();
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
          <span aria-hidden style={{ width: "100%" }}>
            {ins.text || " "}
          </span>
        ) : (
          <span
            dir={style.dir ?? "auto"}
            style={{
              lineHeight: `${height}px`,
              paddingLeft: 4,
              paddingRight: 4,
              whiteSpace: "pre",
              width: "100%",
            }}
            title={ins.text || "(empty — click to type)"}
          >
            {ins.text ? (
              <RichTextView
                block={richTextOrPlain(ins.richText, ins.text, style)}
                defaultStyle={defaultStyle}
                pageScale={page.scale}
                lineHeight={height}
              />
            ) : (
              " "
            )}
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
            // Match the in-parent visual size: in-parent uses NATURAL
            // px inside a `transform: scale(displayScale)` container;
            // the portal lives in document.body (no transform) so
            // multiply once here to land at the same on-screen size.
            lineHeight: `${height * displayScale}px`,
            paddingLeft: 4,
            paddingRight: 4,
            whiteSpace: "pre",
            width: "100%",
          }}
        >
          {ins.text ? (
            <RichTextView
              block={richTextOrPlain(ins.richText, ins.text, style)}
              defaultStyle={defaultStyle}
              pageScale={page.scale * displayScale}
              lineHeight={height * displayScale}
            />
          ) : (
            " "
          )}
        </span>,
      )}
    </>
  );
}
