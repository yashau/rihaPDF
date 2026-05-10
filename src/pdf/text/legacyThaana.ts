// Decoder for old non-Unicode Thaana fonts embedded in PDFs.
//
// Some legacy Dhivehi fonts (notably VoguePSMT and A_Randhoo-Aa in Office
// output) store text as ASCII keyboard/font codes. Their PDF `/ToUnicode`
// maps faithfully expose those ASCII codes, while the font glyph program draws
// Thaana shapes. For editing we need the real Unicode Thaana string.

const LEGACY_FONT_RE = /(?:vogue(?:ps)?(?:mt)?|a[_\s-]?randhoo[_\s-]?aa|randhoo)/i;

// Common legacy ASCII -> Thaana glyph mapping used by Vogue/Randhoo-style
// fonts. This is intentionally NOT the app's phonetic input map: in these
// fonts, for example `a` is alifu, `w` is abafili, and `c` is sukun.
const LEGACY_THAANA_MAP: Readonly<Record<string, string>> = {
  a: "އ",
  b: "ބ",
  c: "ް",
  d: "ދ",
  e: "ެ",
  f: "ފ",
  g: "ގ",
  h: "ހ",
  i: "ި",
  j: "ޖ",
  k: "ކ",
  l: "ލ",
  m: "މ",
  n: "ނ",
  o: "ޮ",
  p: "ޕ",
  q: "ޤ",
  r: "ރ",
  s: "ސ",
  t: "ތ",
  u: "ު",
  v: "ވ",
  w: "ަ",
  x: "ޝ",
  y: "ޔ",
  z: "ޒ",
  A: "ާ",
  B: "ޞ",
  C: "ޗ",
  D: "ޑ",
  E: "ޭ",
  F: "ﷲ",
  G: "ޣ",
  H: "ހ",
  I: "ީ",
  J: "ޛ",
  K: "ޚ",
  L: "ޅ",
  M: "ޟ",
  N: "ޏ",
  O: "ޯ",
  Q: "ޤ",
  R: "ޜ",
  S: "ށ",
  T: "ޓ",
  U: "ޫ",
  V: "ޥ",
  W: "ާ",
  X: "ޘ",
  Y: "ޠ",
  Z: "ޡ",
  ",": "،",
  ";": "؛",
  "?": "؟",
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
};

const ASCII_LEGACY_RE = /[A-Za-z]/;
const THAANA_RE = /[\u0780-\u07bf]/u;

export function isLegacyThaanaFontHint(baseName: string | null | undefined): boolean {
  return !!baseName && LEGACY_FONT_RE.test(baseName);
}

export function decodeLegacyThaanaText(text: string): string {
  return [...text]
    .reverse()
    .map((ch) => LEGACY_THAANA_MAP[ch] ?? ch)
    .join("");
}

export function shouldDecodeLegacyThaanaText(
  baseName: string | null | undefined,
  text: string,
): boolean {
  return isLegacyThaanaFontHint(baseName) && ASCII_LEGACY_RE.test(text) && !THAANA_RE.test(text);
}
