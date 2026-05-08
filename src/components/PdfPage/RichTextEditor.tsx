import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { $getSelectionStyleValueForProperty, $patchStyleText } from "@lexical/selection";
import type { AnnotationColor } from "@/domain/annotations";
import { colorToCss, hexToColor } from "@/domain/color";
import type { EditStyle } from "@/domain/editStyle";
import { normalizeRichTextBlock, type RichTextBlock, type RichTextSpan } from "@/domain/richText";
import type { TextAlignment } from "@/domain/textAlignment";
import { thaanaForLatin } from "@/domain/thaanaKeyboard";
import type { SourceTextLineLayout } from "@/pdf/text/textBlocks";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import { useVisualViewportFollow } from "@/platform/hooks/useVisualViewport";
import { EditTextToolbar } from "./EditTextToolbar";

type ToolbarPatch = Parameters<typeof EditTextToolbar>[0]["onChange"] extends (
  patch: infer P,
) => void
  ? P
  : never;
type RichTextDefaultStyle = Required<Pick<EditStyle, "fontFamily" | "fontSize">> & EditStyle;

const BIDI_CONTROL_RE = /[\u2066-\u2069]/gu;
const NUMERIC_MARKER_RE = /(^|[\s\p{P}])([.-]?\d[\d./:-]*)(?=$|\s|\p{P})/gu;
const LRI = "\u2066";
const PDI = "\u2069";

function protectRtlNumericMarkers(text: string, rtl: boolean): string {
  if (!rtl) return text;
  return text.replace(NUMERIC_MARKER_RE, (_match, prefix: string, marker: string) => {
    return `${prefix}${LRI}${marker}${PDI}`;
  });
}

function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROL_RE, "");
}

function hasRtlText(text: string): boolean {
  return /[\u0590-\u08ff\u0780-\u07bf]/u.test(text);
}

function colorToCssValue(color: AnnotationColor | undefined): string | undefined {
  return colorToCss(color) ?? undefined;
}

function resolvedCssTextAlign(
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

function cssSizeToPoints(value: string, pageScale: number): number | undefined {
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

function createInitialEditorState(block: RichTextBlock, pageScale: number, rtl: boolean) {
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

function splitSpansIntoLines(spans: readonly RichTextSpan[]): RichTextSpan[][] {
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

function createLineLayoutEditorState(block: RichTextBlock, pageScale: number, rtl: boolean) {
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

function sourceLineLayoutHasLeadingWhitespace(): boolean {
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

function trimSourceLineLayoutLeadingWhitespace(): boolean {
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

function editorStateToRichText(editorState: EditorState, pageScale: number): RichTextBlock {
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

function activeStyleFromSelection(
  editor: LexicalEditor,
  pageScale: number,
  defaults: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">,
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

function SelectionStylePlugin({
  defaults,
  pageScale,
  onStyleChange,
}: {
  defaults: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;
  pageScale: number;
  onStyleChange: (style: EditStyle) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const update = () => onStyleChange(activeStyleFromSelection(editor, pageScale, defaults));
    update();
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        update();
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const unregisterUpdate = editor.registerUpdateListener(() => {
      update();
    });
    return () => {
      unregisterSelection();
      unregisterUpdate();
    };
  }, [defaults, editor, onStyleChange, pageScale]);
  return null;
}

function ThaanaInputPlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        (payload) => {
          if (!enabled || typeof payload !== "string" || payload.length !== 1) return false;
          const mapped = thaanaForLatin(payload);
          if (mapped === payload) return false;
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, mapped);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, enabled],
  );
  return null;
}

function SourceLineLayoutPlugin({
  layouts,
  offsetX,
  offsetY,
  lineHeight,
  defaultStyle,
  pageScale,
  textAlign,
}: {
  layouts?: readonly SourceTextLineLayout[];
  offsetX?: number;
  offsetY?: number;
  lineHeight: number;
  pageScale: number;
  textAlign?: TextAlignment;
  defaultStyle: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;
}) {
  const [editor] = useLexicalComposerContext();
  useLayoutEffect(() => {
    if (!layouts || layouts.length === 0) return undefined;
    const apply = (root = editor.getRootElement()) => {
      if (!root) return;
      const children = Array.from(root.children);
      children.forEach((child, index) => {
        if (!(child instanceof HTMLElement)) return;
        const layout = layouts[index];
        child.style.margin = "0";
        child.style.padding = "0";
        child.style.position = "absolute";
        child.style.left = `${(layout?.left ?? 0) + (offsetX ?? 0)}px`;
        child.style.top = `${(layout?.top ?? lineHeight * index) + (offsetY ?? 0)}px`;
        child.style.width = typeof layout?.width === "number" ? `${layout.width}px` : "100%";
        child.style.minHeight = `${lineHeight}px`;
        child.style.lineHeight = `${lineHeight}px`;
        const hasFormattedDescendant =
          !!child.querySelector(".font-bold, .italic, .underline, .line-through") ||
          Array.from(child.querySelectorAll<HTMLElement>("[style]")).some((node) => {
            const style = node.style;
            return (
              (style.fontFamily !== "" &&
                style.fontFamily.replace(/^["']|["']$/g, "") !== defaultStyle.fontFamily) ||
              (style.fontSize !== "" &&
                cssSizeToPoints(style.fontSize, pageScale) !== defaultStyle.fontSize) ||
              style.fontWeight !== "" ||
              style.fontStyle !== "" ||
              style.textDecoration !== "" ||
              style.color !== ""
            );
          });
        const forceJustify = textAlign === "justify" && index < children.length - 1;
        child.style.textAlign =
          textAlign ?? (layout?.justify && hasFormattedDescendant ? "justify" : "start");
        child.style.textAlignLast =
          forceJustify || (!textAlign && layout?.justify && hasFormattedDescendant)
            ? "justify"
            : "auto";
        child.style.whiteSpace = "pre";
        child.style.overflowWrap = "normal";
        child.style.wordBreak = "normal";
      });
    };
    apply();
    const unregisterRoot = editor.registerRootListener((root) => apply(root));
    const unregisterUpdate = editor.registerUpdateListener(({ tags }) => {
      apply();
      if (tags.has("source-line-layout-trim")) return;
      let needsTrim = false;
      editor.getEditorState().read(() => {
        needsTrim = sourceLineLayoutHasLeadingWhitespace();
      });
      if (!needsTrim) return;
      editor.update(() => trimSourceLineLayoutLeadingWhitespace(), {
        tag: "source-line-layout-trim",
      });
    });
    return () => {
      unregisterRoot();
      unregisterUpdate();
    };
  }, [defaultStyle, editor, layouts, offsetX, offsetY, lineHeight, pageScale, textAlign]);
  return null;
}

function styleOverridesDefault(
  style: EditStyle | undefined,
  defaults: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">,
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

function lineHasFormattingOverride(
  line: readonly RichTextSpan[],
  defaults: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">,
): boolean {
  return line.some((span) => styleOverridesDefault(span.style, defaults));
}

function textRectForLine(lineEl: HTMLElement): DOMRect | null {
  const range = document.createRange();
  range.selectNodeContents(lineEl);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  range.detach();
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function nearestLineIndex(root: HTMLElement, clientY: number): number | null {
  const lines = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement,
  );
  if (lines.length === 0) return null;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  lines.forEach((line, index) => {
    const rect = line.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      bestIndex = index;
      bestDistance = 0;
      return;
    }
    const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function TrailingBlankClickPlugin({ enabled }: { enabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!enabled) return undefined;
    const root = editor.getRootElement();
    if (!root) return undefined;
    const onClick = (event: MouseEvent) => {
      const lineIndex = nearestLineIndex(root, event.clientY);
      if (lineIndex === null) return;
      const lineEl = root.children.item(lineIndex);
      if (!(lineEl instanceof HTMLElement)) return;
      const textRect = textRectForLine(lineEl);
      if (!textRect) return;
      const direction = getComputedStyle(lineEl).direction || getComputedStyle(root).direction;
      const tolerance = 2;
      const clickedAfterEnd =
        direction === "rtl"
          ? event.clientX < textRect.left - tolerance
          : event.clientX > textRect.right + tolerance;
      if (!clickedAfterEnd) return;
      event.preventDefault();
      editor.update(() => {
        const line = $getRoot().getChildren()[lineIndex];
        if ($isParagraphNode(line)) line.selectEnd();
      });
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor, enabled]);
  return null;
}

function isEditorChromeTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && !!target.closest("[data-edit-toolbar], [data-resize-handle]")
  );
}

function isTextBoxResizeActive(): boolean {
  return document.body.dataset.textBoxResizeActive === "true";
}

export function RichTextEditor({
  id,
  initial,
  defaultStyle,
  pageScale,
  left,
  top,
  width,
  minHeight,
  maxHeight,
  lineHeight,
  textAlign: autoTextAlign,
  alignment,
  lineLayouts,
  lineLayoutOffsetX,
  lineLayoutOffsetY,
  wrap,
  scroll,
  textVisible = true,
  toolbarTop,
  toolbarLeft,
  boundaryWidth,
  initialCaretOffset,
  onCommit,
  onDelete,
}: {
  id: string;
  initial: RichTextBlock;
  defaultStyle: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;
  pageScale: number;
  left: number;
  top: number;
  width: number;
  minHeight: number;
  maxHeight?: number;
  lineHeight: number;
  textAlign?: "justify" | "start";
  alignment?: TextAlignment;
  lineLayouts?: readonly SourceTextLineLayout[];
  lineLayoutOffsetX?: number;
  lineLayoutOffsetY?: number;
  wrap?: boolean;
  scroll?: boolean;
  textVisible?: boolean;
  toolbarTop: number;
  toolbarLeft: number;
  boundaryWidth: number;
  initialCaretOffset?: number;
  onCommit: (block: RichTextBlock, alignment?: TextAlignment) => void;
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  const editorRef = useRef<LexicalEditor | null>(null);
  const latestBlockRef = useRef<RichTextBlock>(initial);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const hasLineLayouts = !!lineLayouts && lineLayouts.length > 0;
  const [thaanaInput, setThaanaInput] = useState(true);
  const [activeStyle, setActiveStyle] = useState<EditStyle>(defaultStyle);
  const [activeTextAlign, setActiveTextAlign] = useState<TextAlignment | undefined>(alignment);
  useVisualViewportFollow(toolbarRef, "bottom", isMobile);

  const initialConfig = useMemo(
    () => ({
      namespace: `riha-rich-text-${id}`,
      theme: {
        text: {
          bold: "font-bold",
          italic: "italic",
          strikethrough: "line-through",
          underline: "underline",
        },
      },
      onError(error: Error) {
        throw error;
      },
      editorState: hasLineLayouts
        ? createLineLayoutEditorState(
            initial,
            pageScale,
            defaultStyle.dir === "rtl" || (defaultStyle.dir !== "ltr" && hasRtlText(initial.text)),
          )
        : createInitialEditorState(
            initial,
            pageScale,
            defaultStyle.dir === "rtl" || (defaultStyle.dir !== "ltr" && hasRtlText(initial.text)),
          ),
    }),
    [defaultStyle.dir, hasLineLayouts, id, initial, pageScale],
  );

  const commit = useCallback(() => {
    onCommit(latestBlockRef.current, activeTextAlign);
  }, [activeTextAlign, onCommit]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const root = editorRef.current?.getRootElement();
      if (root?.contains(t)) return;
      if (isEditorChromeTarget(t)) return;
      if (isTextBoxResizeActive()) return;
      commit();
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [commit]);

  const applyPatch = (patch: ToolbarPatch) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (patch.bold !== undefined) editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
    if (patch.italic !== undefined) editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
    if (patch.underline !== undefined) editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline");
    if (patch.strikethrough !== undefined)
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
    const stylePatch: Record<string, string | null> = {};
    if (patch.fontFamily !== undefined) stylePatch["font-family"] = `"${patch.fontFamily}"`;
    if (patch.fontSize !== undefined) stylePatch["font-size"] = `${patch.fontSize * pageScale}px`;
    if (patch.color !== undefined) stylePatch.color = colorToCss(patch.color);
    if (Object.keys(stylePatch).length > 0) {
      editor.update(() => {
        const selection = $getSelection();
        if (selection) $patchStyleText(selection, stylePatch);
      });
    }
    if (patch.dir !== undefined) {
      setActiveStyle((prev) => ({
        ...prev,
        dir: patch.dir === null ? undefined : patch.dir,
      }));
    }
    if (patch.textAlign !== undefined) setActiveTextAlign(patch.textAlign);
  };

  const fontFamily = activeStyle.fontFamily ?? defaultStyle.fontFamily;
  const fontSize = activeStyle.fontSize ?? defaultStyle.fontSize;
  const editorDir =
    activeStyle.dir ?? defaultStyle.dir ?? (hasRtlText(initial.text) ? "rtl" : "auto");
  const editorNode = (
    <LexicalComposer initialConfig={initialConfig}>
      <EditorRefPlugin editorRef={editorRef} />
      <SelectionStylePlugin
        defaults={defaultStyle}
        pageScale={pageScale}
        onStyleChange={setActiveStyle}
      />
      <ThaanaInputPlugin enabled={isMobile && thaanaInput} />
      <SourceLineLayoutPlugin
        layouts={lineLayouts}
        offsetX={lineLayoutOffsetX}
        offsetY={lineLayoutOffsetY}
        lineHeight={lineHeight}
        defaultStyle={defaultStyle}
        pageScale={pageScale}
        textAlign={activeTextAlign}
      />
      <TrailingBlankClickPlugin enabled={hasLineLayouts} />
      <HistoryPlugin />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(editorState) => {
          latestBlockRef.current = editorStateToRichText(editorState, pageScale);
        }}
      />
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Edit text"
            data-editor
            data-rich-editor
            data-text-visible={textVisible ? "true" : "false"}
            dir={editorDir}
            spellCheck={false}
            style={{
              width,
              height: maxHeight === minHeight ? minHeight : undefined,
              minHeight,
              maxHeight: maxHeight ?? (scroll ? 360 : undefined),
              overflow:
                lineLayouts && lineLayouts.length > 0 ? "visible" : scroll ? "auto" : "visible",
              padding: 0,
              outline: "2px solid rgb(59, 130, 246)",
              background: "transparent",
              color: textVisible ? (colorToCss(activeStyle.color) ?? "black") : "transparent",
              caretColor: "black",
              colorScheme: "light",
              fontFamily: `"${fontFamily}"`,
              fontSize: `${fontSize * pageScale}px`,
              lineHeight: `${lineHeight}px`,
              textAlign: resolvedCssTextAlign(activeTextAlign, autoTextAlign),
              textAlignLast: "auto",
              whiteSpace: wrap ? "pre-wrap" : "pre",
              overflowWrap: wrap ? "break-word" : "normal",
              wordBreak: "normal",
              boxSizing: "border-box",
              position: lineLayouts && lineLayouts.length > 0 ? "relative" : undefined,
              direction: editorDir === "auto" ? undefined : editorDir,
              unicodeBidi: "plaintext",
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                commit();
              }
            }}
            onBlur={(e) => {
              if (isEditorChromeTarget(e.relatedTarget)) return;
              commit();
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <InitialFocusPlugin offset={initialCaretOffset} />
    </LexicalComposer>
  );

  return (
    <>
      <div
        style={{
          position: "absolute",
          left,
          top,
          zIndex: 25,
          pointerEvents: "auto",
        }}
      >
        {editorNode}
      </div>
      <div ref={toolbarRef}>
        <EditTextToolbar
          left={toolbarLeft}
          top={toolbarTop}
          fontFamily={fontFamily}
          fontSize={fontSize}
          bold={!!activeStyle.bold}
          italic={!!activeStyle.italic}
          underline={!!activeStyle.underline}
          strikethrough={!!activeStyle.strikethrough}
          dir={activeStyle.dir}
          textAlign={activeTextAlign}
          color={activeStyle.color}
          thaanaInput={thaanaInput}
          onThaanaInputChange={setThaanaInput}
          boundaryWidth={boundaryWidth}
          onChange={applyPatch}
          onDelete={onDelete}
        />
      </div>
    </>
  );
}

function InitialFocusPlugin({ offset }: { offset?: number }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      editor.focus(() => {
        editor.update(() => {
          const root = $getRoot();
          const textNodes = root.getAllTextNodes();
          if (textNodes.length === 0) return;
          const targetOffset = offset ?? root.getTextContentSize();
          let remaining = targetOffset;
          for (const node of textNodes) {
            const len = node.getTextContentSize();
            if (remaining <= len) {
              node.select(remaining, remaining);
              return;
            }
            remaining -= len;
          }
          textNodes[textNodes.length - 1].selectEnd();
        });
      });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [editor, offset]);
  return null;
}

function trimLeadingLineSpans(line: RichTextSpan[]): RichTextSpan[] {
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

function displaySpanText(text: string, style: EditStyle): string {
  return protectRtlNumericMarkers(text, style.dir === "rtl");
}

function mergeSpanStyle(
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

export function RichTextView({
  block,
  defaultStyle,
  pageScale,
  lineHeight,
  textAlign,
  alignment,
  wrap = true,
  lineLayouts,
  lineLayoutOffsetX = 0,
  lineLayoutOffsetY = 0,
  justifyLineLayouts = false,
}: {
  block: RichTextBlock;
  defaultStyle: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;
  pageScale: number;
  lineHeight: number;
  textAlign?: "justify" | "start";
  alignment?: TextAlignment;
  wrap?: boolean;
  lineLayouts?: readonly SourceTextLineLayout[];
  lineLayoutOffsetX?: number;
  lineLayoutOffsetY?: number;
  justifyLineLayouts?: boolean;
}) {
  const spans = block.spans.length > 0 ? block.spans : [{ text: block.text }];
  const lines: RichTextSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, style: span.style });
    });
  }
  if (lineLayouts && lineLayouts.length > 0) {
    const rows = lines.map((line, lineIndex) => {
      const layout = lineLayouts[lineIndex];
      return {
        line: layout ? trimLeadingLineSpans(line) : line,
        layout,
        justify:
          !!layout?.justify &&
          (justifyLineLayouts || lineHasFormattingOverride(line, defaultStyle)),
      };
    });
    const height = Math.max(
      lineHeight,
      ...rows.map(({ layout }) => (layout ? layout.top + lineHeight : lineHeight)),
    );
    return (
      <span
        style={{
          display: "block",
          position: "relative",
          height,
          width: "100%",
        }}
      >
        {rows.map(({ line, layout, justify }, lineIndex) => {
          const forceJustify = alignment === "justify" && lineIndex < rows.length - 1;
          const lineAlign = alignment ?? (justify ? "justify" : "start");
          return (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- render-only line projection.
              key={lineIndex}
              style={{
                display: "block",
                position: "absolute",
                left: (layout?.left ?? 0) + lineLayoutOffsetX,
                top: (layout?.top ?? lineHeight * lineIndex) + lineLayoutOffsetY,
                width: layout?.width ?? "100%",
                minHeight: lineHeight,
                lineHeight: `${lineHeight}px`,
                textAlign: lineAlign,
                textAlignLast: forceJustify || (!alignment && justify) ? "justify" : "auto",
                whiteSpace: "pre",
                overflowWrap: "normal",
                wordBreak: "normal",
                direction: defaultStyle.dir,
                unicodeBidi: "plaintext",
              }}
            >
              {line.length === 0
                ? " "
                : line.map((span, spanIndex) => {
                    const style = mergeSpanStyle(defaultStyle, span.style);
                    const explicitDir = span.style?.dir;
                    return (
                      <span
                        // oxlint-disable-next-line react/no-array-index-key -- render-only span projection.
                        key={spanIndex}
                        style={{
                          fontFamily: `"${style.fontFamily}"`,
                          fontSize: `${style.fontSize * pageScale}px`,
                          lineHeight: `${lineHeight}px`,
                          fontWeight: style.bold ? 700 : 400,
                          fontStyle: style.italic ? "italic" : "normal",
                          textDecoration: [
                            style.underline ? "underline" : "",
                            style.strikethrough ? "line-through" : "",
                          ]
                            .filter(Boolean)
                            .join(" "),
                          color: colorToCss(style.color) ?? "black",
                          direction: explicitDir,
                          unicodeBidi: explicitDir ? "isolate" : "normal",
                          whiteSpace: "pre",
                        }}
                      >
                        {displaySpanText(span.text, style)}
                      </span>
                    );
                  })}
            </span>
          );
        })}
      </span>
    );
  }

  const effectiveTextAlign = resolvedCssTextAlign(alignment, textAlign);
  return (
    <>
      {lines.map((line, lineIndex) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- render-only line projection.
          key={lineIndex}
          style={{
            display: "block",
            minHeight: lineHeight,
            lineHeight: `${lineHeight}px`,
            textAlign: effectiveTextAlign,
            textAlignLast:
              effectiveTextAlign === "justify" && lineIndex < lines.length - 1 ? "justify" : "auto",
            whiteSpace: wrap ? "pre-wrap" : "pre",
            unicodeBidi: "plaintext",
          }}
        >
          {line.length === 0
            ? " "
            : line.map((span, spanIndex) => {
                const style = mergeSpanStyle(defaultStyle, span.style);
                const explicitDir = span.style?.dir;
                return (
                  <span
                    // oxlint-disable-next-line react/no-array-index-key -- render-only span projection.
                    key={spanIndex}
                    style={{
                      fontFamily: `"${style.fontFamily}"`,
                      fontSize: `${style.fontSize * pageScale}px`,
                      lineHeight: `${lineHeight}px`,
                      fontWeight: style.bold ? 700 : 400,
                      fontStyle: style.italic ? "italic" : "normal",
                      textDecoration: [
                        style.underline ? "underline" : "",
                        style.strikethrough ? "line-through" : "",
                      ]
                        .filter(Boolean)
                        .join(" "),
                      color: colorToCss(style.color) ?? "black",
                      direction: explicitDir,
                      unicodeBidi: explicitDir ? "isolate" : "normal",
                      whiteSpace: wrap ? "pre-wrap" : "pre",
                    }}
                  >
                    {displaySpanText(span.text, style)}
                  </span>
                );
              })}
        </span>
      ))}
    </>
  );
}
