import type { EditStyle } from "@/domain/editStyle";

export type RichTextSpan = {
  text: string;
  style?: EditStyle;
};

export type RichTextBlock = {
  /** Plain text mirror of `spans`, including any line breaks. Kept as
   *  a cheap compatibility/search field for save, status, and tests. */
  text: string;
  spans: RichTextSpan[];
};

function stylesEqual(a: EditStyle | undefined, b: EditStyle | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.dir === b.dir &&
    a.color?.[0] === b.color?.[0] &&
    a.color?.[1] === b.color?.[1] &&
    a.color?.[2] === b.color?.[2]
  );
}

function copyStyle(style: EditStyle | undefined): EditStyle | undefined {
  if (!style) return undefined;
  return {
    ...style,
    color: style.color ? [...style.color] : undefined,
  };
}

export function normalizeRichTextSpans(spans: readonly RichTextSpan[]): RichTextSpan[] {
  const out: RichTextSpan[] = [];
  for (const span of spans) {
    if (span.text.length === 0) continue;
    const prev = out[out.length - 1];
    if (prev && stylesEqual(prev.style, span.style)) {
      prev.text += span.text;
    } else {
      out.push({ text: span.text, style: copyStyle(span.style) });
    }
  }
  return out;
}

export function richTextPlainText(spans: readonly RichTextSpan[]): string {
  return spans.map((span) => span.text).join("");
}

export function normalizeRichTextBlock(block: RichTextBlock): RichTextBlock {
  const spans = normalizeRichTextSpans(block.spans);
  return {
    text: richTextPlainText(spans),
    spans,
  };
}

export function richTextFromPlainText(text: string, style?: EditStyle): RichTextBlock {
  return normalizeRichTextBlock({
    text,
    spans: text.length > 0 ? [{ text, style: copyStyle(style) }] : [],
  });
}

export function richTextOrPlain(
  richText: RichTextBlock | undefined,
  text: string,
  style?: EditStyle,
): RichTextBlock {
  if (richText) return normalizeRichTextBlock(richText);
  return richTextFromPlainText(text, style);
}

export function uniformSpanStyle(block: RichTextBlock): EditStyle | undefined {
  const nonEmpty = block.spans.filter((span) => span.text.length > 0);
  if (nonEmpty.length !== 1) return undefined;
  return nonEmpty[0].style;
}
