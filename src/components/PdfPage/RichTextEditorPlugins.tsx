import { useEffect, useLayoutEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $isParagraphNode,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import type { EditStyle } from "@/domain/editStyle";
import type { TextAlignment } from "@/domain/textAlignment";
import { thaanaForLatin } from "@/domain/thaanaKeyboard";
import type { SourceTextLineLayout } from "@/pdf/text/textBlocks";
import {
  activeStyleFromSelection,
  cssSizeToPoints,
  sourceLineLayoutHasLeadingWhitespace,
  trimSourceLineLayoutLeadingWhitespace,
  type RichTextEditorDefaultStyle,
} from "./richTextEditorModel";

export function SelectionStylePlugin({
  defaults,
  pageScale,
  onStyleChange,
}: {
  defaults: RichTextEditorDefaultStyle;
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

export function ThaanaInputPlugin({ enabled }: { enabled: boolean }) {
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

export function SourceLineLayoutPlugin({
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
  defaultStyle: RichTextEditorDefaultStyle;
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

export function TrailingBlankClickPlugin({ enabled }: { enabled: boolean }) {
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

export function InitialFocusPlugin({ offset }: { offset?: number }) {
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
