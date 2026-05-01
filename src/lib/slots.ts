// Ordered "slot" model for the displayed page list.
//
// A slot is one rendered page in the document. Slots are independent of
// the source PDF's page order so the user can reorder, insert, and
// remove pages without mutating the source. State that's keyed per slot
// (edits, image moves, insertions) uses the slot's stable `id` rather
// than its position in the array, so an entry follows its page through
// reordering.

import type { RenderedPage } from "./pdf";

export type PageSlot =
  | { id: string; kind: "original"; sourceIndex: number }
  | { id: string; kind: "blank"; size: [number, number] }
  | { id: string; kind: "external"; sourceKey: string; sourcePageIndex: number };

let blankCounter = 0;
let externalCounter = 0;

export function originalSlot(sourceIndex: number): PageSlot {
  return { id: `slot-orig-${sourceIndex}`, kind: "original", sourceIndex };
}

export function blankSlot(size: [number, number]): PageSlot {
  blankCounter += 1;
  return { id: `slot-blank-${Date.now().toString(36)}-${blankCounter}`, kind: "blank", size };
}

export function externalSlot(sourceKey: string, sourcePageIndex: number): PageSlot {
  externalCounter += 1;
  return {
    id: `slot-ext-${Date.now().toString(36)}-${externalCounter}`,
    kind: "external",
    sourceKey,
    sourcePageIndex,
  };
}

export function slotsFromPages(pages: RenderedPage[]): PageSlot[] {
  return pages.map((_, i) => originalSlot(i));
}

/** Resolve a slot to the rendered canvas/page used by the main view.
 *  Originals point back into `pages[sourceIndex]`; blanks have no
 *  source render and are handled separately by the caller. */
export function resolveOriginal(slot: PageSlot, pages: RenderedPage[]): RenderedPage | null {
  if (slot.kind !== "original") return null;
  return pages[slot.sourceIndex] ?? null;
}
