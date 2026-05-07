import type { EditValue } from "@/domain/editState";
import { richTextOrPlain, uniformSpanStyle } from "@/domain/richText";
import type { TextRun } from "@/pdf/render/pdf";
import { chooseToolbarTop, hasStyle } from "./helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import { RichTextEditor } from "./RichTextEditor";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";

const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;
const SLASH_NUMBER_RE = /\d+(?:\/\d+)+/gu;
const RTL_TRAILING_LIST_DOT_RE = /^(\s*)(\d+)(\s+)([\s\S]*?)(\s*)\.$/u;
const RTL_LEADING_SECTION_MARKER_RE = /^(\s*)\.(\d)(\d)(\s+)/u;

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
}

function displayTextForEditor(text: string, rtl: boolean): string {
  if (!rtl) return text;
  return text
    .split("\n")
    .map((line) => {
      const withSlashNumbers = line.replace(SLASH_NUMBER_RE, (value) =>
        value.split("/").reverse().join("/"),
      );
      const withSectionMarker = withSlashNumbers.replace(
        RTL_LEADING_SECTION_MARKER_RE,
        (_match, lead: string, major: string, minor: string, gap: string) =>
          `${lead}${minor}-${major}${gap}`,
      );
      const match = RTL_TRAILING_LIST_DOT_RE.exec(withSectionMarker);
      if (!match || !RTL_TEXT_RE.test(match[4])) return withSectionMarker;
      const [, lead, marker, gap, body, tailSpace] = match;
      return `${lead}.${marker}${gap}${body}${tailSpace}`;
    })
    .join("\n");
}

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
  const isParagraph = isSourceTextBlock(run) && run.isParagraph;
  const widthPadding = isParagraph ? 32 : Math.max(96, run.height * 6);
  const editorWidth = Math.min(
    pageViewWidth - 8,
    Math.max(run.bounds.width + widthPadding, isParagraph ? 120 : run.bounds.width + widthPadding),
  );
  const editorLeft = isRtlEditor
    ? run.bounds.left + run.bounds.width + dx - editorWidth
    : run.bounds.left + dx;
  const sourceText = initial.richText?.text ?? initial.text;
  const displayText = displayTextForEditor(sourceText, isRtlEditor);
  const initialBlock = richTextOrPlain(
    initial.richText,
    initial.richText ? initial.text : displayText,
    initial.style,
  );
  const lineHeight =
    isSourceTextBlock(run) && run.lineStep
      ? run.lineStep
      : isParagraph
        ? Math.max(run.height * 1.45, run.height + 4)
        : run.bounds.height;
  const editorHeight = isParagraph
    ? run.bounds.height
    : Math.max(run.bounds.height + run.height, lineHeight * 1.75);
  const editorTop = isParagraph
    ? run.bounds.top + run.height * 0.25 + dy
    : run.bounds.top - (editorHeight - run.bounds.height) * 0.5 + dy;
  const editorBottom = editorTop + editorHeight;
  const textAlign =
    isParagraph && isRtlEditor ? "justify" : isSourceTextBlock(run) ? run.textAlign : undefined;

  return (
    <RichTextEditor
      id={run.id}
      initial={initialBlock}
      defaultStyle={defaultStyle}
      pageScale={pageScale}
      left={editorLeft}
      top={editorTop}
      width={editorWidth}
      minHeight={editorHeight}
      maxHeight={isParagraph ? undefined : editorHeight}
      lineHeight={lineHeight}
      textAlign={textAlign}
      wrap={false}
      scroll={isParagraph}
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
