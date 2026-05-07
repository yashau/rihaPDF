import type { EditValue } from "./editState";
import type { EditStyle } from "./editStyle";
import { type RichTextBlock, uniformSpanStyle } from "./richText";

export function hasEditStyle(style: EditStyle | undefined): boolean {
  if (!style) return false;
  return Object.values(style).some((value) => value !== undefined);
}

export function richTextHasStyle(block: RichTextBlock | undefined): boolean {
  return !!block?.spans.some((span) => hasEditStyle(span.style));
}

export function richTextHasTextOrStyle(
  block: RichTextBlock | undefined,
  sourceText: string,
): boolean {
  if (!block) return false;
  return block.text !== sourceText || richTextHasStyle(block);
}

export function sourceEditCommitValue({
  richText,
  displayText,
  sourceText,
  isParagraph,
}: {
  richText: RichTextBlock;
  displayText: string;
  sourceText: string;
  isParagraph: boolean;
}): EditValue {
  const style = uniformSpanStyle(richText);
  const hasUniformStyle = hasEditStyle(style);
  const hasStyledSpans = richTextHasStyle(richText);
  const unchangedDisplayText = richText.text === displayText && displayText !== sourceText;
  const text = unchangedDisplayText ? sourceText : richText.text;

  return {
    text,
    richText:
      (hasUniformStyle && !isParagraph) || (unchangedDisplayText && !hasStyledSpans)
        ? undefined
        : richText,
    style: hasUniformStyle ? style : undefined,
  };
}
