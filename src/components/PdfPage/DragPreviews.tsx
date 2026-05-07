import { createPortal } from "react-dom";
import { colorToCss } from "@/domain/color";
import type { RenderedPage } from "../../lib/pdf";
import { cssTextDecoration } from "./helpers";
import type { EditValue } from "./types";
import type { ImageDragState } from "./useImageDrag";
import type { RunDragState } from "./useRunDrag";

export function DragPreviews({
  drag,
  imageDrag,
  page,
  edits,
}: {
  drag: RunDragState | null;
  imageDrag: ImageDragState | null;
  page: RenderedPage;
  edits: Map<string, EditValue>;
}) {
  return (
    <>
      {drag && drag.moved ? <RunDragPreview drag={drag} page={page} edits={edits} /> : null}
      {imageDrag && imageDrag.corner === null && imageDrag.moved ? (
        <ImageDragPreview imageDrag={imageDrag} />
      ) : null}
    </>
  );
}

function RunDragPreview({
  drag,
  page,
  edits,
}: {
  drag: RunDragState;
  page: RenderedPage;
  edits: Map<string, EditValue>;
}) {
  const dragRun = page.textRuns.find((r) => r.id === drag.runId);
  if (!dragRun || drag.width <= 0 || drag.height <= 0) return null;

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
}

function ImageDragPreview({ imageDrag }: { imageDrag: ImageDragState }) {
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
}
