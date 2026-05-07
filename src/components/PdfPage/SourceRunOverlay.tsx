import type { RefObject } from "react";
import type { EditValue } from "@/domain/editState";
import { richTextOrPlain, type RichTextBlock } from "@/domain/richText";
import type { RenderedPage, TextRun } from "@/pdf/render/pdf";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";
import type { ToolMode } from "@/domain/toolMode";
import { EditField } from "./EditField";
import { RichTextView } from "./RichTextEditor";
import { cssTextDecoration } from "./helpers";
import { displayTextForEditor } from "./rtlDisplayText";
import { sourceEditGeometry } from "./sourceEditGeometry";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import type { RunDragState } from "./useRunDrag";

function hasMeaningfulStyle(style: EditValue["style"]): boolean {
  if (!style) return false;
  return Object.values(style).some((value) => value !== undefined);
}

function hasMeaningfulRichText(block: RichTextBlock | undefined, runText: string): boolean {
  if (!block) return false;
  return block.text !== runText || block.spans.some((span) => hasMeaningfulStyle(span.style));
}

function hasRichTextStyle(block: RichTextBlock | undefined): boolean {
  return !!block?.spans.some((span) => hasMeaningfulStyle(span.style));
}

function hasTextOrStyleEdit(run: TextRun | SourceTextBlock, value: EditValue): boolean {
  return (
    value.deleted === true ||
    value.text !== run.text ||
    hasMeaningfulStyle(value.style) ||
    hasMeaningfulRichText(value.richText, run.text)
  );
}

function sourceCaretOffsetFromClick(
  run: TextRun | SourceTextBlock,
  page: RenderedPage,
  e: React.MouseEvent<HTMLElement>,
): number | undefined {
  const pageEl = e.currentTarget.closest<HTMLElement>("[data-page-index]");
  if (!pageEl) return undefined;
  const pageRect = pageEl.getBoundingClientRect();
  const displayScale = page.viewWidth > 0 ? pageRect.width / page.viewWidth : 1;
  if (!Number.isFinite(displayScale) || displayScale <= 0) return undefined;
  const sourceX = (e.clientX - pageRect.left) / displayScale;
  const sourceY = (e.clientY - pageRect.top) / displayScale;
  const caretRun =
    "lines" in run && run.lines.length > 0
      ? run.lines.reduce((best, line) => {
          const bestMid = best.bounds.top + best.bounds.height / 2;
          const lineMid = line.bounds.top + line.bounds.height / 2;
          return Math.abs(lineMid - sourceY) < Math.abs(bestMid - sourceY) ? line : best;
        }, run.lines[0])
      : run;
  if (!caretRun.caretPositions || caretRun.caretPositions.length === 0) return undefined;
  let best = caretRun.caretPositions[0];
  let bestDist = Math.abs(best.x - sourceX);
  for (const pos of caretRun.caretPositions) {
    const dist = Math.abs(pos.x - sourceX);
    if (dist < bestDist) {
      best = pos;
      bestDist = dist;
    }
  }
  if ("lines" in run && run.lines.length > 0) {
    const lineIndex = run.lines.findIndex((line) => line.id === caretRun.id);
    if (lineIndex <= 0) {
      return displayTextForEditor(caretRun.text.slice(0, best.offset), true).length;
    }
    const rawPrefix = [
      ...run.lines.slice(0, lineIndex).map((line) => line.text),
      caretRun.text.slice(0, best.offset),
    ].join("\n");
    return displayTextForEditor(rawPrefix, true).length;
  }
  return best.offset;
}

/** One source-page text run as an interactive overlay. Renders one of
 *  three branches based on state:
 *
 *   - `isEditing` → `<EditField>` for inline text editing.
 *   - persisted edit (text or position) → a styled span showing the
 *     edited content; click reopens the editor, drag re-positions.
 *   - unedited → a transparent click target sitting over the canvas
 *     glyphs; click opens the editor, drag relocates the run.
 *
 *  The body-portal preview that follows the cursor across pages is
 *  rendered by `PdfPage` itself (it owns `drag` from `useRunDrag` and
 *  the createPortal call). This component only owns the in-place
 *  rendering — it goes invisible once the user has actually moved so
 *  the portal'd clone takes over without the page wrapper's
 *  overflow:hidden clipping the preview at the page boundary. */
export function SourceRunOverlay({
  run,
  page,
  tool,
  isEditing,
  editedValue,
  previewReady,
  drag,
  startDrag,
  justDraggedRef,
  toolbarBlockers,
  initialCaretPoint,
  onEdit,
  onEditingChange,
  addHighlightForRun,
  addRedactionForRun,
}: {
  run: TextRun | SourceTextBlock;
  page: RenderedPage;
  tool: ToolMode;
  isEditing: boolean;
  /** Persisted edit for this run (text override / position offset /
   *  style / deleted flag). undefined means the run is unedited. */
  editedValue: EditValue | undefined;
  previewReady: boolean;
  /** Live drag state from `useRunDrag`. Non-null only while a run drag
   *  is in progress (which may or may not be THIS run). */
  drag: RunDragState | null;
  startDrag: (runId: string, e: React.PointerEvent, base: { dx: number; dy: number }) => void;
  /** Set during a drag; the click handler bails when this matches the
   *  current run's id so the trailing pointerup-click doesn't re-open
   *  the editor right after a drag-to-move. */
  justDraggedRef: RefObject<string | null>;
  toolbarBlockers: readonly ToolbarBlocker[];
  initialCaretPoint?: InitialCaretPoint;
  onEdit: (runId: string, value: EditValue) => void;
  onEditingChange: (next: string | null, initialCaretPoint?: InitialCaretPoint) => void;
  addHighlightForRun: (run: TextRun) => void;
  addRedactionForRun: (run: TextRun) => void;
}) {
  // Deleted runs have no overlay at all — the preview canvas already
  // stripped them; with no overlay there's nothing to re-grab, which
  // is the intent.
  if (editedValue?.deleted) return null;
  const edited = editedValue !== undefined;
  const hasContentEdit = editedValue ? hasTextOrStyleEdit(run, editedValue) : false;
  const isDragging = drag?.runId === run.id;
  // Live drag offset for THIS run (or the persisted offset if we're
  // not currently dragging it).
  const dx = (isDragging ? drag.dx : editedValue?.dx) ?? 0;
  const dy = (isDragging ? drag.dy : editedValue?.dy) ?? 0;

  // No more white-rectangle cover — the live preview pipeline in
  // App.tsx rebuilds the page canvas with these runs/images STRIPPED
  // out of the content stream, so the original glyphs are actually
  // gone from the render. The HTML overlay below just paints the new
  // content where the user wants it.
  const padX = 2;
  const activateRun = (nextInitialCaretPoint?: InitialCaretPoint) => {
    if (tool === "highlight") {
      addHighlightForRun(run);
      return;
    }
    if (tool === "redact") {
      addRedactionForRun(run);
      return;
    }
    onEditingChange(run.id, nextInitialCaretPoint);
  };
  const handleOverlayClick = (
    e: React.MouseEvent<HTMLElement>,
    nextInitialCaretPoint?: InitialCaretPoint,
  ) => {
    e.stopPropagation();
    if (drag || justDraggedRef.current === run.id) return;
    activateRun(nextInitialCaretPoint);
  };
  const handleOverlayKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    activateRun();
  };

  if (isEditing) {
    const sourceRunIds =
      "sourceRunIds" in run && run.sourceRunIds.length > 1 ? run.sourceRunIds : undefined;
    return (
      <EditField
        run={run}
        pageScale={page.scale}
        pageViewWidth={page.viewWidth}
        toolbarBlockers={toolbarBlockers}
        initial={editedValue ?? { text: run.text, style: undefined }}
        initialCaretPoint={initialCaretPoint}
        textVisible={previewReady}
        onCommit={(value) => {
          // Preserve any existing move offset (dx/dy) — the EditField
          // only owns text + style, so we layer back the persisted
          // offset from editedValue.
          const merged: EditValue = {
            ...value,
            dx: editedValue?.dx ?? 0,
            dy: editedValue?.dy ?? 0,
            sourceRunIds,
          };
          const hasOffset = (merged.dx ?? 0) !== 0 || (merged.dy ?? 0) !== 0;
          if (hasTextOrStyleEdit(run, merged) || hasOffset) {
            onEdit(run.id, merged);
          }
          onEditingChange(null);
        }}
        onDelete={() => {
          // Mark the source run for deletion: save strips its Tj/TJ
          // ops, no replacement is drawn. The overlay is hidden via
          // the deleted-flag short-circuit above on next render.
          onEdit(run.id, {
            ...(editedValue ?? { text: run.text }),
            deleted: true,
          });
          onEditingChange(null);
        }}
      />
    );
  }

  if (edited && hasContentEdit) {
    const style = editedValue.style ?? {};
    const defaultFontSizePt = run.height / page.scale;
    const hasRtlText = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u.test(editedValue.text);
    const isRtlEditor =
      style.dir === "rtl" ||
      (style.dir !== "ltr" && (hasRtlText || /[\u0780-\u07bf]/u.test(run.text)));
    const geometry = sourceEditGeometry({
      run,
      pageViewWidth: page.viewWidth,
      dx,
      dy,
      isRtlEditor,
    });
    const defaultStyle = {
      fontFamily: style.fontFamily ?? run.fontFamily,
      fontSize: style.fontSize ?? defaultFontSizePt,
      bold: style.bold ?? run.bold,
      italic: style.italic ?? run.italic,
      underline: style.underline ?? run.underline ?? false,
      strikethrough: style.strikethrough ?? run.strikethrough ?? false,
      dir: style.dir ?? (isRtlEditor ? "rtl" : undefined),
      color: style.color,
    };
    // Edited / dragged run: paint the new text where the user wants
    // it, with a white cover behind it. The preview canvas SHOULD
    // have the original glyphs stripped, but the strip is content-
    // stream surgery and silently no-ops when the source text lives
    // inside a Form XObject (common in PDFs from Cloudflare-style
    // invoice generators, browsers, etc.) — `findTextShows()` only
    // sees the page's top-level ops. Without the cover the user
    // sees the original glyphs ghosting through the new format.
    return (
      <span
        data-run-id={run.id}
        data-font-family={style.fontFamily ?? run.fontFamily}
        data-base-font={run.fontBaseName ?? ""}
        role="button"
        tabIndex={0}
        aria-label={`Edit text: ${editedValue.text}`}
        style={{
          position: "absolute",
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          height: geometry.height,
          // White cover masks the original glyphs at the SOURCE
          // position when the strip pipeline silently no-ops (Form
          // XObject case). After a move the span paints at a NEW
          // position where there's no original to mask — and the
          // cover would just occlude whatever else lives at the
          // destination. So: keep the cover only at the in-place
          // position.
          background: isDragging || dx !== 0 || dy !== 0 ? undefined : "white",
          outline: isDragging
            ? "1px dashed rgba(255, 180, 30, 0.9)"
            : "1px solid rgba(255, 200, 60, 0.5)",
          pointerEvents: "auto",
          cursor: isDragging ? "grabbing" : "text",
          display: "block",
          overflow: "visible",
          // Once the user actually moves the cursor, the portal'd
          // clone (rendered by PdfPage) is what they see — the
          // in-place span stays mounted (its rect anchors the drop
          // math) but goes invisible so the page wrapper's
          // overflow:hidden doesn't clip the preview at the page
          // boundary. We DON'T hide on gesture-start alone: mouse
          // pointers activate the gesture eagerly on pointerdown,
          // and a no-motion click would otherwise hit a hidden span
          // and skip the editor handoff.
          visibility: isDragging && drag?.moved ? "hidden" : "visible",
          // `pan-y pinch-zoom` lets the browser scroll the page (and
          // pinch-zoom) on a quick finger swipe; useDragGesture's
          // touch-hold gate means a single-finger drag only claims
          // the run after a 400ms hold, so casual taps and scrolls
          // aren't hijacked.
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
          onEditingChange(run.id);
        }}
        onClick={(e) => {
          handleOverlayClick(e, { clientX: e.clientX, clientY: e.clientY });
        }}
        onKeyDown={handleOverlayKeyDown}
      >
        <span
          dir={defaultStyle.dir ?? "auto"}
          style={{
            display: "block",
            boxSizing: "border-box",
            height: "100%",
            lineHeight: `${geometry.lineHeight}px`,
            width: "100%",
            whiteSpace: "pre",
            paddingLeft: geometry.hasSourceLineLayouts ? 0 : padX * 2,
            paddingRight: geometry.hasSourceLineLayouts ? 0 : padX * 2,
          }}
        >
          <RichTextView
            block={richTextOrPlain(editedValue.richText, editedValue.text, style)}
            defaultStyle={defaultStyle}
            pageScale={page.scale}
            lineHeight={geometry.lineHeight}
            textAlign={"textAlign" in run ? run.textAlign : undefined}
            wrap={false}
            lineLayouts={"lineLayouts" in run ? run.lineLayouts : undefined}
            lineLayoutOffsetX={geometry.lineLayoutOffsetX}
            lineLayoutOffsetY={geometry.lineLayoutOffsetY}
            justifyLineLayouts={
              "textAlign" in run &&
              run.textAlign === "justify" &&
              (hasMeaningfulStyle(style) || hasRichTextStyle(editedValue.richText))
            }
          />
        </span>
      </span>
    );
  }
  // Unedited and move-only runs keep the tight source box. The active
  // edit geometry intentionally adds typing slack, but using that
  // geometry for pure moves makes precise placement impossible.
  const overlayText = editedValue?.text ?? run.text;
  const tightFontSize = run.height;
  const tightLineHeight =
    "lineStep" in run && run.lineStep !== undefined ? run.lineStep : run.bounds.height;
  return (
    <span
      data-run-id={run.id}
      data-font-family={run.fontFamily}
      data-base-font={run.fontBaseName ?? ""}
      dir="auto"
      role="button"
      tabIndex={0}
      aria-label={`Edit text: ${overlayText}`}
      // `select-none` (was: `select-text`) prevents iOS from popping
      // the long-press copy menu over a drag-start — the menu would
      // otherwise eat the gesture and lock the run in selection
      // mode. Selection within the editor input is unaffected because
      // that's a separate node.
      className="thaana-stack absolute select-none"
      style={{
        left: run.bounds.left + dx,
        top: run.bounds.top + dy,
        width: Math.max(run.bounds.width, 12),
        height: run.bounds.height,
        fontFamily: `"${run.fontFamily}"`,
        fontSize: `${tightFontSize}px`,
        lineHeight: `${tightLineHeight}px`,
        fontWeight: run.bold ? 700 : 400,
        fontStyle: run.italic ? "italic" : "normal",
        textDecoration: cssTextDecoration(run.underline ?? false, run.strikethrough ?? false),
        color: edited ? "black" : "transparent",
        backgroundColor: "transparent",
        pointerEvents: "auto",
        whiteSpace: "pre",
        overflow: "visible",
        // Same as the edited branch above — hide once the user has
        // moved so the body-portal preview can escape the page
        // wrapper's overflow:hidden clip. Gesture-start alone keeps
        // the span visible so a no-motion click reaches it.
        visibility: isDragging && drag?.moved ? "hidden" : "visible",
        cursor: isDragging ? "grabbing" : "text",
        // `pan-y pinch-zoom` so the page scrolls on a quick finger
        // swipe; the run is only claimed after the 400ms touch-hold
        // gate in useDragGesture.
        touchAction: "pan-y pinch-zoom",
        WebkitUserSelect: "none",
      }}
      title={overlayText}
      onPointerDown={(e) =>
        startDrag(run.id, e, {
          dx: editedValue?.dx ?? 0,
          dy: editedValue?.dy ?? 0,
        })
      }
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEditingChange(run.id);
      }}
      onClick={(e) => {
        handleOverlayClick(e, {
          clientX: e.clientX,
          clientY: e.clientY,
          caretOffset: sourceCaretOffsetFromClick(run, page, e),
        });
      }}
      onKeyDown={handleOverlayKeyDown}
    >
      {overlayText}
    </span>
  );
}
