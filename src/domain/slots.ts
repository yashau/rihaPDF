// Ordered "slot" model for the displayed page list.
//
// A slot is one rendered page in the document. Slots are independent of
// any source PDF's page order so the user can reorder, insert, and
// remove pages without mutating the source. State that's keyed per slot
// (edits, image moves, insertions) uses the slot's stable `id` rather
// than its position in the array, so an entry follows its page through
// reordering.
//
// Sources are addressed by `sourceKey`. The primary file uses the
// sentinel `PRIMARY_SOURCE_KEY` from `sourceKeys.ts`; externals use
// per-session content keys. Page slots and blanks are the only kinds —
// what used to be `original` vs `external` collapses into a single
// `page` kind that carries a sourceKey + page index within that source.

import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";

export type PageSlot =
  | { id: string; kind: "page"; sourceKey: string; sourcePageIndex: number }
  | { id: string; kind: "blank"; size: [number, number] };

let blankCounter = 0;
let pageCounter = 0;

export function pageSlot(sourceKey: string, sourcePageIndex: number): PageSlot {
  pageCounter += 1;
  // Primary slots get a stable id derived solely from the source page
  // index so a fresh load of the same primary file produces the same
  // slot ids — keeps tests / debugging less noisy.
  const id =
    sourceKey === PRIMARY_SOURCE_KEY
      ? `slot-page-primary-${sourcePageIndex}`
      : `slot-page-${sourceKey}-${sourcePageIndex}-${pageCounter}`;
  return { id, kind: "page", sourceKey, sourcePageIndex };
}

export function blankSlot(size: [number, number]): PageSlot {
  blankCounter += 1;
  return { id: `slot-blank-${Date.now().toString(36)}-${blankCounter}`, kind: "blank", size };
}

type SlottedSource = {
  sourceKey: string;
  pages: readonly unknown[];
};

export function slotsFromSource(source: SlottedSource): PageSlot[] {
  return source.pages.map((_, i) => pageSlot(source.sourceKey, i));
}
