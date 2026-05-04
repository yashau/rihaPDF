// Color helpers for text/annotation colors. The on-disk shape is the
// 0..1 RGB triple already used for annotations (`AnnotationColor`) — it
// hands directly to pdf-lib's `rgb()` and to PDF /C arrays without any
// parsing in between. CSS / hex conversion lives here so the toolbar
// and overlays can render the same value back to the user.

import type { AnnotationColor } from "./annotations";

/** Preset palette for the format toolbar's text-color picker. All
 *  Tailwind-700 level so they're tonally consistent and stay legible
 *  on white paper (≥ 4.5:1 contrast against white, passes WCAG AA).
 *  Ordered by frequency of use, not spectrum: black → gray → primary
 *  accents. */
export const TEXT_COLOR_PRESETS: ReadonlyArray<{
  /** Display label for the swatch's aria-label / tooltip. */
  label: string;
  /** Hex form for swatch fill + the picker's input. */
  hex: string;
  /** 0..1 RGB triple — what gets stored on the EditStyle. */
  value: AnnotationColor;
}> = [
  { label: "Black", hex: "#000000", value: [0, 0, 0] },
  { label: "Slate", hex: "#334155", value: [0x33 / 255, 0x41 / 255, 0x55 / 255] },
  { label: "Red", hex: "#B91C1C", value: [0xb9 / 255, 0x1c / 255, 0x1c / 255] },
  { label: "Orange", hex: "#C2410C", value: [0xc2 / 255, 0x41 / 255, 0x0c / 255] },
  { label: "Green", hex: "#15803D", value: [0x15 / 255, 0x80 / 255, 0x3d / 255] },
  { label: "Teal", hex: "#0F766E", value: [0x0f / 255, 0x76 / 255, 0x6e / 255] },
  { label: "Blue", hex: "#1D4ED8", value: [0x1d / 255, 0x4e / 255, 0xd8 / 255] },
  { label: "Violet", hex: "#6D28D9", value: [0x6d / 255, 0x28 / 255, 0xd9 / 255] },
];

/** Default text color when no `style.color` is set. Black — matches
 *  prior hardcoded behavior so existing inserts/edits stay byte-identical. */
export const DEFAULT_TEXT_COLOR: AnnotationColor = [0, 0, 0];

/** Parse `#RRGGBB` or `#RGB` into a 0..1 RGB triple. Returns null on
 *  malformed input (not a hex string, wrong length, non-hex chars) so
 *  callers can keep the previous value while the user is still typing. */
export function hexToColor(hex: string): AnnotationColor | null {
  const s = hex.trim().replace(/^#/, "");
  if (s.length === 3) {
    if (!/^[0-9a-fA-F]{3}$/.test(s)) return null;
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return [r / 255, g / 255, b / 255];
  }
  if (s.length === 6) {
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return [r / 255, g / 255, b / 255];
  }
  return null;
}

/** Format a 0..1 RGB triple as `#RRGGBB` (lower-case, always 6 digits).
 *  Used by the toolbar's hex input as the canonical display form. */
export function colorToHex(c: AnnotationColor): string {
  const r = clamp255(c[0]);
  const g = clamp255(c[1]);
  const b = clamp255(c[2]);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** Format a 0..1 RGB triple as a CSS `rgb(...)` color. Used by the
 *  editor input + overlay span so the rendered text matches the saved
 *  PDF. `undefined` falls through to `null` so the caller can fall
 *  back to its own default (typically `"black"`). */
export function colorToCss(c: AnnotationColor | undefined): string | null {
  if (!c) return null;
  return `rgb(${clamp255(c[0])}, ${clamp255(c[1])}, ${clamp255(c[2])})`;
}

/** Compare two 0..1 RGB triples for equality with a small tolerance —
 *  hex round-trips can introduce 1/255 jitter. Used by the swatch grid
 *  to highlight the active preset. */
export function colorsEqual(a: AnnotationColor | undefined, b: AnnotationColor | undefined): boolean {
  if (!a || !b) return a === b;
  const eps = 1 / 512;
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

function clamp255(x: number): number {
  return Math.max(0, Math.min(255, Math.round(x * 255)));
}
