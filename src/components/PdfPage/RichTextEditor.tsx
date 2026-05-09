import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { $patchStyleText } from "@lexical/selection";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $getSelection, FORMAT_TEXT_COMMAND, type LexicalEditor } from "lexical";
import { colorToCss } from "@/domain/color";
import type { EditStyle } from "@/domain/editStyle";
import type { RichTextBlock } from "@/domain/richText";
import type { TextAlignment } from "@/domain/textAlignment";
import type { SourceTextLineLayout } from "@/pdf/text/textBlocks";
import { useIsMobile } from "@/platform/hooks/useMediaQuery";
import { useVisualViewportFollow } from "@/platform/hooks/useVisualViewport";
import { EditTextToolbar } from "./EditTextToolbar";
import {
  InitialFocusPlugin,
  SelectionStylePlugin,
  SourceLineLayoutPlugin,
  ThaanaInputPlugin,
  TrailingBlankClickPlugin,
} from "./RichTextEditorPlugins";
import {
  createInitialEditorState,
  createLineLayoutEditorState,
  editorStateToRichText,
  hasRtlText,
  resolvedCssTextAlign,
} from "./richTextEditorModel";
export { RichTextView } from "./RichTextView";

type ToolbarPatch = Parameters<typeof EditTextToolbar>[0]["onChange"] extends (
  patch: infer P,
) => void
  ? P
  : never;

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
