import { describe, expect, it } from "vitest";
import {
  displaySpanText,
  hasRtlText,
  mergeSpanStyle,
  protectRtlNumericMarkers,
  resolvedCssTextAlign,
  splitSpansIntoLines,
  trimLeadingLineSpans,
} from "@/components/PdfPage/richTextEditorModel";
import type { RichTextSpan } from "@/domain/richText";

describe("rich text editor model helpers", () => {
  it("detects RTL text and protects numeric markers only in RTL spans", () => {
    expect(hasRtlText("hello")).toBe(false);
    expect(hasRtlText("ހެނދުނު")).toBe(true);
    expect(protectRtlNumericMarkers("ހެނދުނު 9:00 test", true)).toBe("ހެނދުނު \u20669:00\u2069 test");
    expect(displaySpanText("ހެނދުނު 9:00 test", { dir: "ltr" })).toBe("ހެނދުނު 9:00 test");
  });

  it("splits rich spans into renderable lines while preserving span style", () => {
    const spans: RichTextSpan[] = [
      { text: "one\ntwo", style: { bold: true } },
      { text: " three", style: { italic: true } },
    ];

    expect(splitSpansIntoLines(spans)).toEqual([
      [{ text: "one", style: { bold: true } }],
      [
        { text: "two", style: { bold: true } },
        { text: " three", style: { italic: true } },
      ],
    ]);
  });

  it("trims source line layout leading whitespace across styled spans", () => {
    const line: RichTextSpan[] = [
      { text: "  ", style: { bold: true } },
      { text: " one", style: { italic: true } },
      { text: " two", style: { underline: true } },
    ];

    expect(trimLeadingLineSpans(line)).toEqual([
      { text: "one", style: { italic: true } },
      { text: " two", style: { underline: true } },
    ]);
  });

  it("resolves alignment and merged span style consistently with editor defaults", () => {
    expect(resolvedCssTextAlign(undefined, "justify")).toBe("justify");
    expect(resolvedCssTextAlign("right", "justify")).toBe("right");
    expect(
      mergeSpanStyle(
        { fontFamily: "Arial", fontSize: 12, bold: false, italic: false },
        { fontSize: 10, bold: true },
      ),
    ).toEqual({ fontFamily: "Arial", fontSize: 10, bold: true, italic: false });
  });
});
