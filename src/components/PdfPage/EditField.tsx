import type { EditValue } from "@/domain/editState";
import { richTextOrPlain, uniformSpanStyle } from "@/domain/richText";
import type { TextRun } from "@/pdf/render/pdf";
import { chooseToolbarTop, hasStyle } from "./helpers";
import type { InitialCaretPoint, ToolbarBlocker } from "./types";
import { RichTextEditor } from "./RichTextEditor";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";

const RTL_TEXT_RE = /[\u0590-\u05ff\u0600-\u06ff\u0780-\u07bf]/u;
const LTR_TEXT_RE = /[A-Za-z0-9]/u;
const SLASH_NUMBER_RE = /\d+(?:\/\d+)+/gu;
const RTL_TRAILING_LIST_DOT_RE = /^(\s*\d+)(\s+)([\s\S]*?)(\s*)\.$/u;

type VisualToken = {
  clusters: string[];
  left: number;
  right: number;
  kind: "rtl" | "ltr" | "neutral";
};

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
      const match = RTL_TRAILING_LIST_DOT_RE.exec(withSlashNumbers);
      if (!match || !RTL_TEXT_RE.test(match[3])) return withSlashNumbers;
      const [, marker, gap, body, tailSpace] = match;
      return `${marker}.${gap}${body}${tailSpace}`;
    })
    .join("\n");
}

function visualPieceKind(text: string): VisualToken["kind"] {
  if (RTL_TEXT_RE.test(text)) return "rtl";
  if (LTR_TEXT_RE.test(text)) return "ltr";
  return "neutral";
}

function mergeTokenKind(a: VisualToken["kind"], b: VisualToken["kind"]): VisualToken["kind"] {
  if (a === b) return a;
  if (a === "neutral") return b;
  if (b === "neutral") return a;
  return a;
}

function visualGapSpaces(gapPx: number, lineHeight: number): string {
  if (gapPx <= lineHeight * 0.18) return "";
  const estimatedSpace = Math.max(lineHeight * 0.32, 3);
  return " ".repeat(Math.max(1, Math.min(12, Math.round(gapPx / estimatedSpace))));
}

function visualTextFromLine(line: TextRun, rtl: boolean): string | undefined {
  const pieces = line.visualPieces;
  if (!pieces || pieces.length === 0) return undefined;
  const sorted = [...pieces].sort((a, b) => a.left - b.left);
  const tokens: VisualToken[] = [];
  const gapThreshold = Math.max(line.height * 0.22, 2);

  for (const piece of sorted) {
    const text = piece.text.trim();
    if (text.length === 0) continue;
    const left = piece.left;
    const right = piece.left + piece.width;
    const kind = visualPieceKind(text);
    const prev = tokens[tokens.length - 1];
    const gap = prev ? left - prev.right : 0;
    const shouldContinue =
      prev && (gap <= gapThreshold || prev.kind === "neutral" || kind === "neutral");
    if (prev && shouldContinue) {
      prev.clusters.push(text);
      prev.right = Math.max(prev.right, right);
      prev.kind = mergeTokenKind(prev.kind, kind);
    } else {
      tokens.push({ clusters: [text], left, right, kind });
    }
  }

  if (tokens.length === 0) return undefined;
  const ordered = rtl ? [...tokens].reverse() : tokens;
  let result = "";
  let prev: VisualToken | undefined;
  for (const token of ordered) {
    if (prev) {
      const gap = rtl ? prev.left - token.right : token.left - prev.right;
      result += visualGapSpaces(gap, line.height);
    }
    result +=
      token.kind === "rtl" ? [...token.clusters].reverse().join("") : token.clusters.join("");
    prev = token;
  }
  return result;
}

function visualTextForRun(
  run: TextRun | SourceTextBlock,
  sourceText: string,
  rtl: boolean,
): string {
  if (isSourceTextBlock(run) && run.lines.length > 0) {
    const lines = run.lines.map((line) => visualTextFromLine(line, rtl) ?? line.text);
    if (lines.some((line) => line.length > 0)) return lines.join("\n");
  }
  return visualTextFromLine(run, rtl) ?? displayTextForEditor(sourceText, rtl);
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
  const displayText = visualTextForRun(run, sourceText, isRtlEditor);
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
