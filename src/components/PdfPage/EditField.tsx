import type { EditValue } from "@/domain/editState";
import { richTextOrPlain, uniformSpanStyle } from "@/domain/richText";
import type { TextRun } from "@/pdf/render/pdf";
import { chooseToolbarTop, hasStyle } from "./helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import { RichTextEditor } from "./RichTextEditor";

const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;

export function EditField({
  run,
  pageScale,
  pageViewWidth,
  toolbarBlockers,
  initial,
  initialCaretPoint,
  onCommit,
  onDelete,
}: {
  run: TextRun;
  /** Viewport pixels per PDF point. */
  pageScale: number;
  pageViewWidth: number;
  toolbarBlockers: readonly ToolbarBlocker[];
  initial: EditValue;
  initialCaretPoint?: InitialCaretPoint;
  onCommit: (value: EditValue) => void;
  onDelete?: () => void;
}) {
  const dx = initial.dx ?? 0;
  const dy = initial.dy ?? 0;
  const baseStyle = initial.style ?? {};
  const text = initial.richText?.text ?? initial.text;
  const defaultFontSizePt = run.height / pageScale;
  const defaultStyle = {
    fontFamily: baseStyle.fontFamily ?? run.fontFamily,
    fontSize: baseStyle.fontSize ?? defaultFontSizePt,
    bold: baseStyle.bold ?? run.bold,
    italic: baseStyle.italic ?? run.italic,
    underline: baseStyle.underline ?? run.underline ?? false,
    strikethrough: baseStyle.strikethrough ?? run.strikethrough ?? false,
    dir: baseStyle.dir,
    color: baseStyle.color,
  };
  const isRtlEditor =
    defaultStyle.dir === "rtl" || (defaultStyle.dir !== "ltr" && RTL_TEXT_RE.test(text));
  const isParagraph = "isParagraph" in run && run.isParagraph;
  const editorWidth = Math.min(
    pageViewWidth - 8,
    Math.max(run.bounds.width + (isParagraph ? 32 : 0), 120),
  );
  const editorLeft = isRtlEditor
    ? run.bounds.left + run.bounds.width + dx - editorWidth
    : run.bounds.left + dx;
  const editorTop = run.bounds.top + run.height * 0.25 + dy;
  const editorBottom = editorTop + run.bounds.height;
  const initialBlock = richTextOrPlain(initial.richText, initial.text, initial.style);
  const lineHeight = isParagraph ? Math.max(run.height * 1.45, run.height + 4) : run.bounds.height;

  return (
    <RichTextEditor
      id={run.id}
      initial={initialBlock}
      defaultStyle={defaultStyle}
      pageScale={pageScale}
      left={editorLeft}
      top={editorTop}
      width={editorWidth}
      minHeight={run.bounds.height}
      lineHeight={lineHeight}
      toolbarLeft={editorLeft}
      toolbarTop={chooseToolbarTop({
        editorLeft,
        editorTop,
        editorBottom,
        blockers: toolbarBlockers,
        selfId: run.id,
      })}
      boundaryWidth={pageViewWidth}
      initialCaretOffset={initialCaretPoint?.caretOffset}
      onCommit={(richText) => {
        const style = uniformSpanStyle(richText);
        onCommit({
          text: richText.text,
          richText,
          style: style && hasStyle(style) ? style : undefined,
        });
      }}
      onDelete={onDelete}
    />
  );
}
