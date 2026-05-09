import { $getSelectionStyleValueForProperty } from "@lexical/selection";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import type { AnnotationColor } from "@/domain/annotations";
import { colorToCss, hexToColor } from "@/domain/color";
import type { EditStyle } from "@/domain/editStyle";
import { normalizeRichTextBlock, type RichTextBlock, type RichTextSpan } from "@/domain/richText";
import type { TextAlignment } from "@/domain/textAlignment";

export type RichTextDefaultStyle = Required<Pick<EditStyle, "fontFamily" | "fontSize">> & EditStyle;

export type RichTextEditorDefaultStyle = Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
  Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;

const BIDI_CONTROL_RE = /[\u2066-\u2069]/gu;
const NUMERIC_MARKER_RE = /(^|[\s\p{P}])([.-]?\d[\d./:-]*)(?=$|\s|\p{P})/gu;
const LRI = "\u2066";
const PDI = "\u2069";

export function protectRtlNumericMarkers(text: string, rtl: boolean): string {
  if (!rtl) return text;
  return text.replace(NUMERIC_MARKER_RE, (_match, prefix: string, marker: string) => {
    return `${prefix}${LRI}${marker}${PDI}`;
  });
}

function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROL_RE, "");
}

export function hasRtlText(text: string): boolean {
  return /[\u0590-\u08ff\u0780-\u07bf]/u.test(text);
}

function colorToCssValue(color: AnnotationColor | undefined): string | undefined {
  return colorToCss(color) ?? undefined;
}

export function resolvedCssTextAlign(
  textAlign: TextAlignment | undefined,
  autoTextAlign: "justify" | "start" | undefined,
): "left" | "center" | "right" | "justify" | "start" {
  return textAlign ?? (autoTextAlign === "justify" ? "justify" : "start");
}

function styleToCss(style: EditStyle | undefined, pageScale: number): string {
  const parts: string[] = [];
  if (style?.fontFamily) parts.push(`font-family: "${style.fontFamily}"`);
  if (style?.fontSize !== undefined) parts.push(`font-size: ${style.fontSize * pageScale}px`);
  const color = colorToCssValue(style?.color);
  if (color) parts.push(`color: ${color}`);
  return parts.join("; ");
}

export function cssSizeToPoints(value: string, pageScale: number): number | undefined {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return undefined;
  if (value.trim().endsWith("pt")) return n;
  return n / pageScale;
}

function parseCssColor(value: string): AnnotationColor | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#")) return hexToColor(trimmed) ?? undefined;
  const match = /^rgba?\(([^)]+)\)$/i.exec(trimmed);
  if (!match) return undefined;
  const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [
    Math.max(0, Math.min(255, parts[0])) / 255,
    Math.max(0, Math.min(255, parts[1])) / 255,
    Math.max(0, Math.min(255, parts[2])) / 255,
  ];
}

function parseStyleString(style: string, pageScale: number): Partial<EditStyle> {
  if (!style.trim()) return {};
  const el = document.createElement("span");
  el.setAttribute("style", style);
  const fontFamily = el.style.fontFamily.replace(/^["']|["']$/g, "") || undefined;
  const fontSize = el.style.fontSize ? cssSizeToPoints(el.style.fontSize, pageScale) : undefined;
  const color = el.style.color ? parseCssColor(el.style.color) : undefined;
  const out: Partial<EditStyle> = {};
  if (fontFamily !== undefined) out.fontFamily = fontFamily;
  if (fontSize !== undefined) out.fontSize = fontSize;
  if (color !== undefined) out.color = color;
  return out;
}

function styleFromTextNode(node: ReturnType<typeof $createTextNode>, pageScale: number): EditStyle {
  const cssStyle = parseStyleString(node.getStyle(), pageScale);
  const out: EditStyle = { ...cssStyle };
  if (node.hasFormat("bold")) out.bold = true;
  if (node.hasFormat("italic")) out.italic = true;
  if (node.hasFormat("underline")) out.underline = true;
  if (node.hasFormat("strikethrough")) out.strikethrough = true;
  return out;
}

export function createInitialEditorState(block: RichTextBlock, pageScale: number, rtl: boolean) {
  return () => {
    const root = $getRoot();
    root.clear();
    const paragraph = $createParagraphNode();
    const spans = block.spans.length > 0 ? block.spans : [{ text: block.text }];
    for (const span of spans) {
      const pieces = protectRtlNumericMarkers(span.text, rtl).split("\n");
      pieces.forEach((piece, index) => {
        if (index > 0) paragraph.append($createLineBreakNode());
        if (piece.length === 0) return;
        const node = $createTextNode(piece);
        const style = span.style;
        if (style?.bold) node.toggleFormat("bold");
        if (style?.italic) node.toggleFormat("italic");
        if (style?.underline) node.toggleFormat("underline");
        if (style?.strikethrough) node.toggleFormat("strikethrough");
        node.setStyle(styleToCss(style, pageScale));
        paragraph.append(node);
      });
    }
    root.append(paragraph);
    paragraph.selectEnd();
  };
}

export function splitSpansIntoLines(spans: readonly RichTextSpan[]): RichTextSpan[][] {
  const lines: RichTextSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, style: span.style });
    });
  }
  return lines;
}

function appendTextNode(
  paragraph: ReturnType<typeof $createParagraphNode>,
  text: string,
  style: EditStyle | undefined,
  pageScale: number,
  rtl: boolean,
) {
  const node = $createTextNode(protectRtlNumericMarkers(text, rtl));
  if (style?.bold) node.toggleFormat("bold");
  if (style?.italic) node.toggleFormat("italic");
  if (style?.underline) node.toggleFormat("underline");
  if (style?.strikethrough) node.toggleFormat("strikethrough");
  node.setStyle(styleToCss(style, pageScale));
  paragraph.append(node);
}

export function createLineLayoutEditorState(block: RichTextBlock, pageScale: number, rtl: boolean) {
  return () => {
    const root = $getRoot();
    root.clear();
    const spans = block.spans.length > 0 ? block.spans : [{ text: block.text }];
    const lines = splitSpansIntoLines(spans);
    for (const rawLine of lines) {
      const line = trimLeadingLineSpans(rawLine);
      const paragraph = $createParagraphNode();
      for (const span of line) {
        appendTextNode(paragraph, span.text, span.style, pageScale, rtl);
      }
      root.append(paragraph);
    }
    const rootChildren = root.getChildren();
    const last = rootChildren[rootChildren.length - 1];
    if ($isParagraphNode(last)) last.selectEnd();
  };
}

export function sourceLineLayoutHasLeadingWhitespace(): boolean {
  for (const rootChild of $getRoot().getChildren()) {
    if (!$isParagraphNode(rootChild)) continue;
    for (const child of rootChild.getChildren()) {
      if (!$isTextNode(child)) break;
      const text = child.getTextContent();
      if (text.length === 0) continue;
      return /^\s/u.test(text);
    }
  }
  return false;
}

export function trimSourceLineLayoutLeadingWhitespace(): boolean {
  let changed = false;
  for (const rootChild of $getRoot().getChildren()) {
    if (!$isParagraphNode(rootChild)) continue;
    for (const child of rootChild.getChildren()) {
      if (!$isTextNode(child)) break;
      const text = child.getTextContent();
      if (text.length === 0) continue;
      const trimmed = text.replace(/^\s+/u, "");
      if (trimmed !== text) {
        if (trimmed.length === 0) {
          child.remove();
        } else {
          child.setTextContent(trimmed);
        }
        changed = true;
      }
      break;
    }
  }
  return changed;
}

export function editorStateToRichText(editorState: EditorState, pageScale: number): RichTextBlock {
  const spans: RichTextSpan[] = [];
  editorState.read(() => {
    const root = $getRoot();
    const rootChildren = root.getChildren();
    rootChildren.forEach((rootChild, rootIndex) => {
      if (rootIndex > 0) spans.push({ text: "\n" });
      if (!$isParagraphNode(rootChild)) return;
      for (const child of rootChild.getChildren()) {
        if ($isLineBreakNode(child)) {
          spans.push({ text: "\n" });
        } else if ($isTextNode(child)) {
          spans.push({
            text: stripBidiControls(child.getTextContent()),
            style: styleFromTextNode(child, pageScale),
          });
        }
      }
    });
  });
  return normalizeRichTextBlock({ text: "", spans });
}

export function activeStyleFromSelection(
  editor: LexicalEditor,
  pageScale: number,
  defaults: RichTextEditorDefaultStyle,
): EditStyle {
  let style: EditStyle = { ...defaults };
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    style = {
      ...style,
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      underline: selection.hasFormat("underline"),
      strikethrough: selection.hasFormat("strikethrough"),
    };
    const family = $getSelectionStyleValueForProperty(selection, "font-family", "");
    if (family) style.fontFamily = family.replace(/^["']|["']$/g, "");
    const size = $getSelectionStyleValueForProperty(selection, "font-size", "");
    if (size) {
      const parsed = cssSizeToPoints(size, pageScale);
      if (parsed !== undefined) style.fontSize = parsed;
    }
    const color = $getSelectionStyleValueForProperty(selection, "color", "");
    const parsedColor = color ? parseCssColor(color) : undefined;
    if (parsedColor) style.color = parsedColor;
  });
  return style;
}

function styleOverridesDefault(
  style: EditStyle | undefined,
  defaults: RichTextEditorDefaultStyle,
): boolean {
  if (!style) return false;
  return (
    (style.fontFamily !== undefined && style.fontFamily !== defaults.fontFamily) ||
    (style.fontSize !== undefined && style.fontSize !== defaults.fontSize) ||
    (style.bold !== undefined && style.bold !== defaults.bold) ||
    (style.italic !== undefined && style.italic !== defaults.italic) ||
    (style.underline !== undefined && style.underline !== defaults.underline) ||
    (style.strikethrough !== undefined && style.strikethrough !== defaults.strikethrough) ||
    style.color !== undefined
  );
}

export function lineHasFormattingOverride(
  line: readonly RichTextSpan[],
  defaults: RichTextEditorDefaultStyle,
): boolean {
  return line.some((span) => styleOverridesDefault(span.style, defaults));
}

export function trimLeadingLineSpans(line: RichTextSpan[]): RichTextSpan[] {
  let trimming = true;
  return line
    .map((span) => {
      if (!trimming) return span;
      const text = span.text.replace(/^\s+/, "");
      if (text.length > 0) trimming = false;
      return { ...span, text };
    })
    .filter((span) => span.text.length > 0);
}

export function displaySpanText(text: string, style: EditStyle): string {
  return protectRtlNumericMarkers(text, style.dir === "rtl");
}

export function mergeSpanStyle(
  defaultStyle: RichTextDefaultStyle,
  spanStyle: EditStyle | undefined,
): RichTextDefaultStyle {
  if (!spanStyle) return { ...defaultStyle };
  const out: RichTextDefaultStyle = { ...defaultStyle };
  if (spanStyle.fontFamily !== undefined) out.fontFamily = spanStyle.fontFamily;
  if (spanStyle.fontSize !== undefined) out.fontSize = spanStyle.fontSize;
  if (spanStyle.bold !== undefined) out.bold = spanStyle.bold;
  if (spanStyle.italic !== undefined) out.italic = spanStyle.italic;
  if (spanStyle.underline !== undefined) out.underline = spanStyle.underline;
  if (spanStyle.strikethrough !== undefined) out.strikethrough = spanStyle.strikethrough;
  if (spanStyle.dir !== undefined) out.dir = spanStyle.dir;
  if (spanStyle.color !== undefined) out.color = spanStyle.color;
  return out;
}
