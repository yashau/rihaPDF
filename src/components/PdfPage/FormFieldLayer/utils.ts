import { isRtlScript } from "@/pdf/text/fonts";

/** Default CSS font-family for a form text field given its current
 *  value. Thaana -> Faruma (the Maldivian de-facto), Latin -> Arial.
 *  Mirrors the comment layer's auto-detect; the browser's `dir="auto"`
 *  handles mixed strings visually. */
export function fontFamilyFor(text: string): string {
  return isRtlScript(text) ? '"Faruma"' : '"Arial"';
}
