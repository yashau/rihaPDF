import type { AnnotationColor } from "@/domain/annotations";

export type EditStyle = {
  /** Override of which Dhivehi font to render with. Defaults to the
   *  registry's DEFAULT_FONT_FAMILY (Faruma). */
  fontFamily?: string;
  /** Override of font size in PDF points. Defaults to the original run's
   *  rendered height. */
  fontSize?: number;
  /** Render bold via stroke + fill (simulated since most Dhivehi fonts
   *  don't ship a true bold variant). */
  bold?: boolean;
  /** Italic via shear (simulated for the same reason). */
  italic?: boolean;
  /** Underline drawn as a thin horizontal line under the text. */
  underline?: boolean;
  /** Strikethrough drawn as a thin horizontal line through the text. */
  strikethrough?: boolean;
  /** Explicit text direction. When `undefined` (the default), the
   *  draw / overlay paths auto-detect from the codepoints — Thaana
   *  / Hebrew / Arabic → "rtl", Latin → "ltr". Set explicitly when
   *  auto-detection misclassifies (e.g. an all-digit run that should
   *  render RTL inside a Dhivehi paragraph). */
  dir?: "rtl" | "ltr";
  /** Fill color for the rendered text + decorations, as a 0..1 RGB
   *  triple (same shape as `AnnotationColor`). Undefined renders
   *  black — matches the prior hardcoded behavior so existing edits
   *  with no `color` set save byte-identical to before. */
  color?: AnnotationColor;
};
