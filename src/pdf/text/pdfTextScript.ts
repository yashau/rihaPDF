/** Coarse script classification used to keep text-show recovery and run
 *  grouping from merging punctuation/digits into the wrong bidi side. */
export function scriptOf(text: string): "rtl" | "ltr" | "unknown" {
  let hasRtl = false;
  let hasLtr = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (
      (cp >= 0x0590 && cp <= 0x08ff) || // Hebrew, Arabic, Syriac, Thaana, Arabic Supplement
      (cp >= 0xfb1d && cp <= 0xfdff) || // Arabic Presentation Forms-A
      (cp >= 0xfe70 && cp <= 0xfeff) || // Arabic Presentation Forms-B
      (cp >= 0x10800 && cp <= 0x10fff) // older RTL scripts
    ) {
      hasRtl = true;
    } else if (cp >= 0x0021 && cp <= 0x007e) {
      // Any ASCII printable — letters, digits, parens, slash, comma,
      // period — counts as LTR-flow content here.
      hasLtr = true;
    }
  }
  if (hasRtl) return "rtl";
  if (hasLtr) return "ltr";
  return "unknown";
}
