import type { EditValue } from "@/domain/editState";
import { richTextOrPlain, uniformSpanStyle } from "@/domain/richText";
import type { TextRun } from "@/pdf/render/pdf";
import { chooseToolbarTop, hasStyle } from "./helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import { RichTextEditor } from "./RichTextEditor";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";
import { sourceEditGeometry } from "./sourceEditGeometry";
import { displayTextForEditor } from "./rtlDisplayText";

const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
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
  run: TextRun;
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
  const dx = initial.dx ?? 0;
  const dy = initial.dy ?? 0;
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
    pageViewWidth,
    dx,
    dy,
    isRtlEditor,
  });
  const sourceText = initial.richText?.text ?? initial.text;
  const displayText = displayTextForEditor(sourceText, isRtlEditor);
  const initialBlock = richTextOrPlain(
    initial.richText,
    initial.richText ? initial.text : displayText,
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
    <RichTextEditor
      id={run.id}
      initial={initialBlock}
      defaultStyle={defaultStyle}
      pageScale={pageScale}
      left={geometry.left}
      top={geometry.top}
      width={geometry.width}
      minHeight={geometry.height}
      maxHeight={geometry.isParagraph ? undefined : geometry.height}
      lineHeight={geometry.lineHeight}
      textAlign={textAlign}
      lineLayouts={geometry.lineLayouts}
      lineLayoutOffsetX={geometry.lineLayoutOffsetX}
      lineLayoutOffsetY={geometry.lineLayoutOffsetY}
      wrap={false}
      scroll={geometry.isParagraph}
      textVisible={textVisible}
      toolbarLeft={geometry.left}
      toolbarTop={chooseToolbarTop({
        editorLeft: geometry.left,
        editorTop: geometry.top,
        editorBottom,
        blockers: toolbarBlockers,
        selfId: run.id,
      })}
      boundaryWidth={pageViewWidth}
      initialCaretOffset={initialCaretPoint?.caretOffset}
      onCommit={(richText) => {
        const style = uniformSpanStyle(richText);
        const unchangedText = richText.text === displayText && displayText !== sourceText;
        onCommit({
          text: unchangedText && !(style && hasStyle(style)) ? sourceText : richText.text,
          richText: unchangedText && !(style && hasStyle(style)) ? undefined : richText,
          style: style && hasStyle(style) ? style : undefined,
        });
      }}
      onDelete={onDelete}
    />
  );
}
