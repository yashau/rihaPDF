import type { AnnotationColor } from "@/domain/annotations";

/** rgba() css string from our 0..1 RGB tuple plus an alpha. Used by
 *  highlight rects (translucent fill) and ink strokes (full alpha). */
export function rgba(c: AnnotationColor, a: number): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
}

/** Convert PDF user-space y → viewport-pixel y (y-down). The viewport
 *  coordinate system runs from 0 at the top to viewHeight at the
 *  bottom; PDF user space is y-up. */
export function vpY(pdfY: number, pageScale: number, viewHeight: number): number {
  return viewHeight - pdfY * pageScale;
}
