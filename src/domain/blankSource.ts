// Blank slots are first-class destinations: the user can click into
// them to drop text/images, drag runs and images from other pages
// onto them, and add highlights / comments / ink. To plug into the
// existing per-source save pipeline they need an addressable
// (sourceKey, pageIndex) pair — even though they don't come from a
// loaded PDF.
//
// We give each blank slot its own synthetic source: sourceKey
// "__blank__:<slotId>", pageIndex 0. The save pipeline detects the
// prefix, materialises a fresh PDFDocument with one page sized to
// the slot, runs the same insert / draw / annotation passes against
// it, and copies that page into the output instead of the bare
// `output.addPage(slot.size)` we used before.

const BLANK_SOURCE_PREFIX = "__blank__:";

export function blankSourceKey(slotId: string): string {
  return BLANK_SOURCE_PREFIX + slotId;
}

export function isBlankSourceKey(sourceKey: string): boolean {
  return sourceKey.startsWith(BLANK_SOURCE_PREFIX);
}

export function slotIdFromBlankSourceKey(sourceKey: string): string {
  return sourceKey.slice(BLANK_SOURCE_PREFIX.length);
}
