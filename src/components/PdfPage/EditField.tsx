import { useState } from "react";
import type { EditValue } from "@/domain/editState";
import { richTextOrPlain } from "@/domain/richText";
import { sourceEditCommitValue } from "@/domain/sourceEditCommit";
import type { TextRun } from "@/pdf/render/pdf";
import { chooseToolbarTop } from "./helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import { RichTextEditor } from "./RichTextEditor";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";
import { sourceEditGeometry } from "./sourceEditGeometry";
import { displayTextForEditor } from "./rtlDisplayText";
import { useDragGesture } from "@/platform/hooks/useDragGesture";
import { ResizeHandles, type ResizeHandlePosition } from "./overlays/ResizeHandle";

const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;
const MIN_SOURCE_TEXT_BOX_PX = 24;
const SOURCE_TEXT_TOOLBAR_GAP_PX = 18;
const RESIZE_CLICK_SUPPRESS_MS = 250;

function setTextBoxResizeActive(active: boolean): void {
  if (active) {
    document.body.dataset.textBoxResizeActive = "true";
    return;
  }
  window.setTimeout(() => {
    if (document.body.dataset.textBoxResizeActive === "true") {
      delete document.body.dataset.textBoxResizeActive;
    }
  }, RESIZE_CLICK_SUPPRESS_MS);
}

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
}

function cssSpaceWidth(run: TextRun): number {
  if (typeof document === "undefined") return run.height * 0.25;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return run.height * 0.25;
  ctx.font = `${run.italic ? "italic " : ""}${run.bold ? "700" : "400"} ${run.height}px "${run.fontFamily}"`;
  const width = ctx.measureText(" ").width;
  return width > 0 ? width : run.height * 0.25;
}

function spacesForIndent(gapPx: number, run: TextRun): string {
  if (gapPx <= 0) return "";
  return " ".repeat(Math.max(0, Math.round(gapPx / cssSpaceWidth(run))));
}

function lineRight(run: TextRun): number {
  return run.bounds.left + run.bounds.width;
}

export function sourceEditorText(
  displayText: string,
  run: TextRun | SourceTextBlock,
  isRtl: boolean,
) {
  if (!isRtl || !isSourceTextBlock(run) || run.lines.length < 2) return displayText;
  const textLines = displayText.split("\n");
  const baseRight = Math.max(...run.lines.map(lineRight));
  return textLines
    .map((lineText, index) => {
      const sourceLine = run.lines[index];
      if (!sourceLine) return lineText;
      return `${spacesForIndent(baseRight - lineRight(sourceLine), sourceLine)}${lineText}`;
    })
    .join("\n");
}

function resizeRealEstateFromCorner(
  base: { width: number; height: number },
  corner: ResizeHandlePosition,
  dx: number,
  dy: number,
  min: number,
  isRtl: boolean,
): { dx: number; width: number; height: number } {
  const isLeftHandle = corner === "tl" || corner === "bl";
  const width = Math.max(min, base.width + (isLeftHandle ? -dx : dx));
  let height = base.height;
  switch (corner) {
    case "br":
      height = Math.max(min, base.height + dy);
      break;
    case "tr":
      height = Math.max(min, base.height - dy);
      break;
    case "tl":
      height = Math.max(min, base.height - dy);
      break;
    case "bl":
      height = Math.max(min, base.height + dy);
      break;
  }
  const widthDelta = width - base.width;
  const anchorSideDragged = isRtl ? !isLeftHandle : isLeftHandle;
  const dxDelta = anchorSideDragged ? (isLeftHandle ? -widthDelta : widthDelta) : 0;
  return { dx: dxDelta, width, height };
}

export function EditField({
  run,
  pageScale,
  pageViewWidth,
  toolbarBlockers,
  initial,
  initialCaretPoint,
  textVisible,
  onCommit,
  onDelete,
}: {
  run: TextRun | SourceTextBlock;
  /** Viewport pixels per PDF point. */
  pageScale: number;
  pageViewWidth: number;
  toolbarBlockers: readonly ToolbarBlocker[];
  initial: EditValue;
  initialCaretPoint?: InitialCaretPoint;
  textVisible?: boolean;
  onCommit: (value: EditValue) => void;
  onDelete?: () => void;
}) {
  const [box, setBox] = useState({
    dx: initial.dx ?? 0,
    dy: initial.dy ?? 0,
    width: initial.editBoxWidth,
    height: initial.editBoxHeight,
  });
  const dx = box.dx;
  const dy = box.dy;
  const baseStyle = initial.style ?? {};
  const text = initial.richText?.text ?? initial.text;
  const defaultFontSizePt = run.height / pageScale;
  const sourceRtl =
    (baseStyle.dir === undefined || baseStyle.dir === "rtl") && RTL_TEXT_RE.test(text);
  const defaultStyle = {
    fontFamily: baseStyle.fontFamily ?? run.fontFamily,
    fontSize: baseStyle.fontSize ?? defaultFontSizePt,
    bold: baseStyle.bold ?? run.bold,
    italic: baseStyle.italic ?? run.italic,
    underline: baseStyle.underline ?? run.underline ?? false,
    strikethrough: baseStyle.strikethrough ?? run.strikethrough ?? false,
    dir: baseStyle.dir ?? (sourceRtl ? "rtl" : undefined),
    color: baseStyle.color,
  };
  const isRtlEditor =
    defaultStyle.dir === "rtl" || (defaultStyle.dir !== "ltr" && RTL_TEXT_RE.test(text));
  const geometry = sourceEditGeometry({
    run,
    dx,
    dy,
    isRtlEditor,
    editBoxWidth: box.width,
    editBoxHeight: box.height,
  });
  type SourceTextResizeCtx = {
    corner: ResizeHandlePosition;
    base: { width: number; height: number };
    baseDx: number;
    baseDy: number;
  };
  const beginSourceTextResize = useDragGesture<SourceTextResizeCtx>({
    touchActivation: "immediate",
    onStart: () => setTextBoxResizeActive(true),
    onMove: (ctx, info) => {
      const next = resizeRealEstateFromCorner(
        ctx.base,
        ctx.corner,
        info.dxRaw,
        info.dyRaw,
        MIN_SOURCE_TEXT_BOX_PX,
        isRtlEditor,
      );
      setBox({
        dx: ctx.baseDx + next.dx,
        dy: ctx.baseDy,
        width: next.width,
        height: next.height,
      });
    },
    onEnd: () => setTextBoxResizeActive(false),
    onCancel: () => setTextBoxResizeActive(false),
  });
  const startResize = (corner: ResizeHandlePosition) => (e: React.PointerEvent) => {
    beginSourceTextResize(e, {
      corner,
      base: {
        width: geometry.width,
        height: geometry.height,
      },
      baseDx: dx,
      baseDy: dy,
    });
  };
  const sourceText = initial.richText?.text ?? initial.text;
  const displayText = displayTextForEditor(sourceText, isRtlEditor);
  const flowSourceText = true;
  const editorDisplayText = flowSourceText
    ? sourceEditorText(displayText, run, isRtlEditor)
    : displayText;
  const initialBlock = richTextOrPlain(
    initial.richText,
    initial.richText ? initial.text : editorDisplayText,
    initial.style,
  );
  const editorBottom = geometry.top + geometry.height;
  const textAlign =
    geometry.isParagraph && isRtlEditor
      ? "justify"
      : isSourceTextBlock(run)
        ? run.textAlign
        : undefined;

  return (
    <>
      <RichTextEditor
        id={run.id}
        initial={initialBlock}
        defaultStyle={defaultStyle}
        pageScale={pageScale}
        left={geometry.left}
        top={geometry.top}
        width={geometry.width}
        minHeight={geometry.height}
        maxHeight={geometry.height}
        lineHeight={geometry.lineHeight}
        textAlign={textAlign}
        wrap={flowSourceText}
        scroll={flowSourceText}
        textVisible={textVisible}
        toolbarLeft={geometry.left}
        toolbarTop={chooseToolbarTop({
          editorLeft: geometry.left,
          editorTop: geometry.top,
          editorBottom,
          blockers: toolbarBlockers,
          selfId: run.id,
          gap: SOURCE_TEXT_TOOLBAR_GAP_PX,
        })}
        boundaryWidth={pageViewWidth}
        initialCaretOffset={initialCaretPoint?.caretOffset}
        onCommit={(richText) => {
          const value = sourceEditCommitValue({
            richText,
            displayText: editorDisplayText,
            sourceText,
            isParagraph: flowSourceText,
          });
          const committedValue = flowSourceText && !value.richText ? { ...value, richText } : value;
          onCommit({
            ...committedValue,
            dx,
            dy,
            editBoxWidth: box.width,
            editBoxHeight: box.height,
          });
        }}
        onDelete={onDelete}
      />
      <div
        style={{
          position: "absolute",
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          height: geometry.height,
          pointerEvents: "none",
          zIndex: 35,
        }}
      >
        <ResizeHandles
          placement="outside"
          parentW={geometry.width}
          parentH={geometry.height}
          onPointerDown={startResize}
        />
      </div>
    </>
  );
}
