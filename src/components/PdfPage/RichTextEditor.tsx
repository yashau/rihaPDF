import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const BIDI_CONTROL_RE = /[\u2066-\u2069]/gu;
const NUMERIC_MARKER_RE = /(^|\s)([()[\]./-]*\d[\d()[\]./-]*)(?=$|\s)/gu;
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
  return {
    fontFamily,
    fontSize,
    color,
  };
}

function styleFromTextNode(node: ReturnType<typeof $createTextNode>, pageScale: number): EditStyle {
  const cssStyle = parseStyleString(node.getStyle(), pageScale);
  return {
    ...cssStyle,
    bold: node.hasFormat("bold") || undefined,
    italic: node.hasFormat("italic") || undefined,
    underline: node.hasFormat("underline") || undefined,
    strikethrough: node.hasFormat("strikethrough") || undefined,
  };
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
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        update();
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
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
  textAlign: _textAlign,
  wrap,
  scroll,
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
  wrap?: boolean;
  scroll?: boolean;
  toolbarTop: number;
  toolbarLeft: number;
  boundaryWidth: number;
  initialCaretOffset?: number;
  onCommit: (block: RichTextBlock) => void;
  onDelete?: () => void;
}) {
  const isMobile = useIsMobile();
  const editorRef = useRef<LexicalEditor | null>(null);
  const latestBlockRef = useRef<RichTextBlock>(initial);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [thaanaInput, setThaanaInput] = useState(true);
  const [activeStyle, setActiveStyle] = useState<EditStyle>(defaultStyle);
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
      editorState: createInitialEditorState(
        initial,
        pageScale,
        defaultStyle.dir === "rtl" || (defaultStyle.dir !== "ltr" && hasRtlText(initial.text)),
      ),
    }),
    [defaultStyle.dir, id, initial, pageScale],
  );

  const commit = useCallback(() => {
    onCommit(latestBlockRef.current);
  }, [onCommit]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      const root = editorRef.current?.getRootElement();
      if (root?.contains(t)) return;
      if (t instanceof HTMLElement && t.closest("[data-edit-toolbar]")) return;
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
            dir={editorDir}
            spellCheck={false}
            style={{
              width,
              height: maxHeight === minHeight ? minHeight : undefined,
              minHeight,
              maxHeight: maxHeight ?? (scroll ? 360 : undefined),
              overflow: scroll ? "auto" : "visible",
              padding: "0 4px",
              outline: "2px solid rgb(59, 130, 246)",
              background: "white",
              color: colorToCss(activeStyle.color) ?? "black",
              colorScheme: "light",
              fontFamily: `"${fontFamily}"`,
              fontSize: `${fontSize * pageScale}px`,
              lineHeight: `${lineHeight}px`,
              textAlign: "start",
              textAlignLast: "auto",
              whiteSpace: wrap ? "pre-wrap" : "pre",
              overflowWrap: wrap ? "break-word" : "normal",
              wordBreak: "normal",
              boxSizing: "border-box",
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
              const next = e.relatedTarget;
              if (next instanceof HTMLElement && next.closest("[data-edit-toolbar]")) return;
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

export function RichTextView({
  block,
  defaultStyle,
  pageScale,
  lineHeight,
  textAlign,
  wrap = true,
  lineLayouts,
}: {
  block: RichTextBlock;
  defaultStyle: Required<Pick<EditStyle, "fontFamily" | "fontSize">> &
    Pick<EditStyle, "bold" | "italic" | "underline" | "strikethrough" | "color" | "dir">;
  pageScale: number;
  lineHeight: number;
  textAlign?: "justify" | "start";
  wrap?: boolean;
  lineLayouts?: readonly SourceTextLineLayout[];
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
      return { line: layout ? trimLeadingLineSpans(line) : line, layout };
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
        {rows.map(({ line, layout }, lineIndex) => (
          <span
            // oxlint-disable-next-line react/no-array-index-key -- render-only line projection.
            key={lineIndex}
            style={{
              display: "block",
              position: "absolute",
              left: layout?.left ?? 0,
              top: layout?.top ?? lineHeight * lineIndex,
              width: layout?.width ?? "100%",
              minHeight: lineHeight,
              lineHeight: `${lineHeight}px`,
              textAlign: layout?.justify ? "justify" : "start",
              textAlignLast: layout?.justify ? "justify" : "auto",
              whiteSpace: layout?.justify ? "normal" : "pre",
              overflowWrap: "normal",
              wordBreak: "normal",
              unicodeBidi: "plaintext",
            }}
          >
            {line.length === 0
              ? " "
              : line.map((span, spanIndex) => {
                  const style = { ...defaultStyle, ...span.style };
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
                        direction: style.dir,
                        unicodeBidi: "isolate",
                        whiteSpace: layout?.justify ? "normal" : "pre",
                      }}
                    >
                      {span.text}
                    </span>
                  );
                })}
          </span>
        ))}
      </span>
    );
  }

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
            textAlign: textAlign === "justify" ? "justify" : "start",
            textAlignLast:
              textAlign === "justify" && lineIndex < lines.length - 1 ? "justify" : "auto",
            whiteSpace: wrap ? "pre-wrap" : "pre",
            unicodeBidi: "plaintext",
          }}
        >
          {line.length === 0
            ? " "
            : line.map((span, spanIndex) => {
                const style = { ...defaultStyle, ...span.style };
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
                      direction: style.dir,
                      unicodeBidi: "isolate",
                      whiteSpace: wrap ? "pre-wrap" : "pre",
                    }}
                  >
                    {span.text}
                  </span>
                );
              })}
        </span>
      ))}
    </>
  );
}
