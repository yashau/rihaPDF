import type { EditStyle } from "../../lib/save";
import type { ToolbarBlocker } from "./types";

/** Cross-page hit-test: given a viewport (clientX, clientY) point, find
 *  which page container is under it and return its index/scale/size.
 *  Iterates `[data-page-index]` elements and returns the first whose
 *  bounding rect contains the point. Returns null when the cursor is
 *  outside any page (e.g. in the header or between pages).
 *
 *  pageIndex is the CURRENT slot index in App's slots array — used to
 *  resolve the persisted target via `slotsRef`. sourceKey identifies
 *  which loaded source the slot points at; save uses it to route
 *  cross-source draws to the right `doc`.
 *
 *  Post-fit-to-width: the queried element's `getBoundingClientRect()`
 *  returns the DISPLAYED rect (page.viewWidth × displayScale). The
 *  natural `viewWidth/viewHeight` are read from the data attributes;
 *  `effectiveScale = page.scale * displayScale` is the pdf-user-space
 *  → displayed-screen-pixels ratio. Callers convert screen deltas to
 *  PDF by dividing by `effectiveScale` and convert positions inside
 *  the rect (e.g. `clientY - rect.top`) the same way. */
export function findPageAtPoint(
  clientX: number,
  clientY: number,
): {
  pageIndex: number;
  sourceKey: string;
  /** pdf user space → NATURAL viewport pixel ratio (== `page.scale`). */
  scale: number;
  /** screen-pixel size of the displayed rect. Equal to natural × displayScale. */
  rect: DOMRect;
  /** Natural viewport dimensions (pre-displayScale) — kept for callers
   *  that compute persisted offsets in natural pixels. */
  viewWidth: number;
  viewHeight: number;
  /** Displayed-pixel dimensions (= rect.width / rect.height). */
  displayedWidth: number;
  displayedHeight: number;
  /** Natural-to-displayed ratio (= rect.width / viewWidth). 1 on desktop. */
  displayScale: number;
  /** pdf user space → DISPLAYED screen-pixel ratio (= scale * displayScale).
   *  Use this when converting a (clientX, clientY) coord inside `rect`
   *  to PDF user space — it folds in both render scale and the
   *  fit-to-width transform. */
  effectiveScale: number;
} | null {
  const els = document.querySelectorAll<HTMLElement>("[data-page-index]");
  for (const el of Array.from(els)) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX < r.right && clientY >= r.top && clientY < r.bottom) {
      const idx = parseInt(el.dataset.pageIndex ?? "", 10);
      const scale = parseFloat(el.dataset.pageScale ?? "");
      const sourceKey = el.dataset.sourceKey ?? "";
      const naturalW = parseFloat(el.dataset.viewWidth ?? "");
      const naturalH = parseFloat(el.dataset.viewHeight ?? "");
      if (
        Number.isNaN(idx) ||
        Number.isNaN(scale) ||
        sourceKey === "" ||
        Number.isNaN(naturalW) ||
        Number.isNaN(naturalH)
      ) {
        continue;
      }
      const displayScale = naturalW > 0 ? r.width / naturalW : 1;
      return {
        pageIndex: idx,
        sourceKey,
        scale,
        rect: r,
        viewWidth: naturalW,
        viewHeight: naturalH,
        displayedWidth: r.width,
        displayedHeight: r.height,
        displayScale,
        effectiveScale: scale * displayScale,
      };
    }
  }
  return null;
}

/** True when the user has explicitly set ANY of the toolbar's style
 *  fields. We deliberately use `!== undefined` rather than truthiness
 *  so that `bold: false` / `italic: false` / `underline: false` /
 *  `strikethrough: false` count as a change — that's the toggle-off-an-
 *  already-bold-run case where the override would otherwise get stripped
 *  on commit and the original run.bold would silently come back. */
export function hasStyle(s: EditStyle): boolean {
  return (
    s.fontFamily !== undefined ||
    s.fontSize !== undefined ||
    s.bold !== undefined ||
    s.italic !== undefined ||
    s.underline !== undefined ||
    s.strikethrough !== undefined ||
    s.dir !== undefined
  );
}

/** Compose a CSS `text-decoration-line` value from the underline /
 *  strikethrough booleans. Returns `"none"` when neither is set so
 *  the property explicitly clears any inherited decoration. */
export function cssTextDecoration(underline: boolean, strikethrough: boolean): string {
  const parts: string[] = [];
  if (underline) parts.push("underline");
  if (strikethrough) parts.push("line-through");
  return parts.length > 0 ? parts.join(" ") : "none";
}

/** True when a `blur` event is moving focus into the formatting
 *  toolbar (so the editor should stay open). Caller passes the blur
 *  event's `relatedTarget`. */
export function isFocusMovingToToolbar(next: EventTarget | null): boolean {
  return next instanceof HTMLElement && !!next.closest("[data-edit-toolbar]");
}

/** Approximate footprint of `EditTextToolbar` in page-local pixels.
 *  Used by `chooseToolbarPosition` to decide if the default position
 *  (above the editor) would overlap a neighbouring run. The actual
 *  rendered toolbar grows slightly when a long font name is selected,
 *  but the dominant variability is the font dropdown — 432px covers
 *  the usual case (Times New Roman / Faruma / etc.). */
const TOOLBAR_HEIGHT_PX = 42;
const TOOLBAR_WIDTH_PX = 432;
const TOOLBAR_GAP_PX = 6;

/** Decide whether the formatting toolbar should sit above or below the
 *  editor. Returns the top in the same page-local pixel space the rest
 *  of the overlays use. The default is above; we flip below when the
 *  above-position would overlap a neighbouring text element on the
 *  same page (the case the user hit on maldivian2.pdf, where the
 *  paragraph being edited sat directly under the registration URL run
 *  and the 42-px toolbar extended up over the URL). */
export function chooseToolbarTop({
  editorLeft,
  editorTop,
  editorBottom,
  blockers,
  selfId,
}: {
  editorLeft: number;
  editorTop: number;
  editorBottom: number;
  blockers: readonly ToolbarBlocker[];
  selfId: string;
}): number {
  const aboveTop = editorTop - TOOLBAR_HEIGHT_PX - TOOLBAR_GAP_PX;
  const belowTop = editorBottom + TOOLBAR_GAP_PX;
  const right = editorLeft + TOOLBAR_WIDTH_PX;
  const overlaps = (top: number) => {
    const bottom = top + TOOLBAR_HEIGHT_PX;
    for (const b of blockers) {
      if (b.id === selfId) continue;
      if (b.right <= editorLeft) continue;
      if (b.left >= right) continue;
      if (b.bottom <= top) continue;
      if (b.top >= bottom) continue;
      return true;
    }
    return false;
  };
  if (!overlaps(aboveTop)) return aboveTop;
  if (!overlaps(belowTop)) return belowTop;
  // Both sides overlap — uncommon (the page is densely packed). Fall
  // back to the default (above) so the toolbar at least keeps its
  // usual relationship to the editor.
  return aboveTop;
}
