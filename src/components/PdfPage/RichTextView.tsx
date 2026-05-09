import { colorToCss } from "@/domain/color";
import type { EditStyle } from "@/domain/editStyle";
import type { RichTextBlock, RichTextSpan } from "@/domain/richText";
import type { TextAlignment } from "@/domain/textAlignment";
import type { SourceTextLineLayout } from "@/pdf/text/textBlocks";
import {
  displaySpanText,
  lineHasFormattingOverride,
  mergeSpanStyle,
  resolvedCssTextAlign,
  splitSpansIntoLines,
  trimLeadingLineSpans,
} from "./richTextEditorModel";

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
  const lines: RichTextSpan[][] = splitSpansIntoLines(spans);
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
              alignment === "justify" && lineIndex < lines.length - 1 ? "justify" : "auto",
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
