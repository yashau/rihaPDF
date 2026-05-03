# Split PdfPage (and overlays) again

The cross-page-drag work since 2026-05-03 has re-inflated the files that
got split earlier the same day. Numbers as of HEAD (commit `4e7e128`):

| File                                              | Lines | Δ since last split |
| ------------------------------------------------- | ----- | ------------------ |
| `src/components/PdfPage/index.tsx`                | 1727  | +870 (was ~860)    |
| `src/components/PdfPage/overlays.tsx`             | 1048  | +320 (was ~730)    |
| `src/components/PdfPage/AnnotationLayer.tsx`      | 565   | +180               |
| `src/App.tsx`                                     | 996   | +46 — leave alone  |

`App.tsx` only drifted ~50 lines; it's not the problem.
The real targets are `index.tsx`, `overlays.tsx`, and `AnnotationLayer.tsx`.

## Where the bloat is, by section

### `index.tsx` (1727 lines)

| Range       | What it is                                                          | Lines |
| ----------- | ------------------------------------------------------------------- | ----- |
| 1–138       | Imports, `Props` type                                               | 138   |
| 139–211     | `PdfPage` outer wrapper + `displayScale` layout effect              | 73    |
| 212–324     | `drag` / `imageDrag` state shapes + canvas-mount effect             | 113   |
| 326–461     | `beginRunDrag` + `startDrag` (source-run translate, cross-page)     | 136   |
| 463–619     | `beginImageDrag` + `startImageDrag` (source-image translate)        | 157   |
| 621–747     | `beginImageResize` + `startImageResize` (corner resize)             | 127   |
| 749–815     | `addHighlightForRun`, `toolbarBlockers` build                       | 67    |
| 816–1288    | Render JSX: wrapper, placement-mode capture layer, run / image /    | 473   |
|             | inserted-text / inserted-image / arrival mapping, AnnotationLayer   |       |
| 1289–1396   | Body-portal drag previews (run + image)                             | 108   |
| 1401–1581   | `CrossPageTextArrivalOverlay` component                             | 181   |
| 1583–1727   | `CrossPageImageArrivalOverlay` component                            | 145   |

The two arrival components at the bottom are completely self-contained
and account for **326 lines** of the file.

The render JSX has three big inline branches per source run
(editing / edited-but-not-editing / unedited) starting around line 923,
spanning ~270 lines inside the `.map`.

### `overlays.tsx` (1048 lines)

| Range     | Component               | Lines |
| --------- | ----------------------- | ----- |
| 30–199    | `ImageOverlay`          | 170   |
| 207–637   | `InsertedTextOverlay`   | 431   |
| 643–893   | `InsertedImageOverlay`  | 251   |
| 911–983   | `ResizeHandle`          | 73    |
| 991–1048  | `ShapeOverlay`          | 58    |

`InsertedTextOverlay` and `InsertedImageOverlay` each duplicate the
same `dragLive` state shape + body-portal preview pattern (lines
331–414 and 692–762). That's the seam for a shared hook.

### `AnnotationLayer.tsx` (565 lines)

One single 565-line component. Three rendering concerns interleaved:
highlight rects, comment boxes (with their own cross-page drag —
the 180-line addition from commit `4e7e128`), and ink stroke drawing /
capture. The cross-page comment drag is the obvious extractable piece.

## Proposed split

Keep the public API (`<PdfPage>`, the overlay components currently
consumed by `index.tsx`, the type re-exports) byte-identical so no
caller changes. Everything below is internal reorganisation.

### Phase 1 — extract the two arrival overlays from `index.tsx`

Lift `CrossPageTextArrivalOverlay` and `CrossPageImageArrivalOverlay`
out of `index.tsx` into a new file:

- **New:** `src/components/PdfPage/arrivals.tsx`
  - `CrossPageTextArrivalOverlay` (currently `index.tsx:1401–1581`)
  - `CrossPageImageArrivalOverlay` (currently `index.tsx:1583–1727`)

These already import nothing index-specific — they pull from
`./helpers`, `./types`, `../../lib/useDragGesture`, `../../lib/pdf`.

**Saves: ~326 lines from `index.tsx`.**

### Phase 2 — extract the three drag gestures into hooks

The three `useDragGesture` configurations (run drag, image translate,
image resize) total ~420 lines and are independent — each takes a
`page`, an `onCommit`-style callback (`onEdit` / `onImageMove`), the
`pageIndex` for the cross-page hit-test, and emits live state.
Extracting them turns three closures into three small hook calls.

- **New:** `src/components/PdfPage/useRunDrag.ts`
  - hosts `beginRunDrag` (`index.tsx:326–453`)
  - returns `{ drag, startDrag, justDraggedRef }`
- **New:** `src/components/PdfPage/useImageDrag.ts`
  - hosts `beginImageDrag` + `beginImageResize` (`index.tsx:463–747`)
  - returns `{ imageDrag, startImageDrag, startImageResize }`
- The portal preview JSX (`index.tsx:1289–1396`) stays inline in
  `index.tsx` for now — it reads the state these hooks return. We can
  extract it once the hooks land if there's still appetite.

**Saves: ~420 lines from `index.tsx`.** The state-shape declarations
(`index.tsx:212–302`) move into the hooks too.

### Phase 3 — break the per-run render branches into a component

The `.map((run) => …)` body in the render (`index.tsx:923–1179`)
contains the three big inline branches (editing / edited /
unedited). Lift to:

- **New:** `src/components/PdfPage/SourceRunOverlay.tsx`
  - props: `run`, `page`, `tool`, `editingId`, `edits.get(run.id)`,
    `drag` (from `useRunDrag`), the gesture's `startDrag`,
    `justDraggedRef`, callbacks (`onEdit`, `onEditingChange`,
    `addHighlightForRun`).

Keeps the JSX in one place per logical state (one component, three
branches → readable file). `EditField` integration stays where it is.

**Saves: ~260 lines from `index.tsx`.**

### Phase 4 — split `overlays.tsx` by component, share the cross-page-preview hook

Each component → its own file in `src/components/PdfPage/overlays/`,
and the duplicated `dragLive` + body-portal pattern becomes a hook.

- **New:** `src/components/PdfPage/useCrossPageDragPreview.ts`
  - The `dragLive` state + portal-render helper. Used by
    `InsertedTextOverlay`, `InsertedImageOverlay`, and the two arrival
    overlays from Phase 1 (they all share the same pattern).
  - Returns `{ dragLive, beginDrag, renderPortal({ children, ...style }) }`.
- **New file layout under `overlays/`:**
  - `overlays/ImageOverlay.tsx`
  - `overlays/InsertedTextOverlay.tsx`
  - `overlays/InsertedImageOverlay.tsx`
  - `overlays/ResizeHandle.tsx`
  - `overlays/ShapeOverlay.tsx`
  - `overlays/index.ts` re-exports the same names so existing
    `import { … } from "./overlays"` keeps working.
- Delete the old `overlays.tsx`.

**Result: no single overlay file > ~330 lines.**

### Phase 5 — split `AnnotationLayer.tsx` by annotation kind

Pull each render path + its gesture into its own component, and
re-keep the existing `AnnotationLayer` as a thin orchestrator.

- **New:** `src/components/PdfPage/annotations/HighlightLayer.tsx`
- **New:** `src/components/PdfPage/annotations/CommentLayer.tsx`
  (owns the cross-page comment drag — the 180-line addition from
  `4e7e128`)
- **New:** `src/components/PdfPage/annotations/InkLayer.tsx`
  (owns the pointerdown/move/up capture for new strokes)
- `AnnotationLayer.tsx` becomes ~80 lines of fan-out + the
  shared utilities `rgba()` and `vpY()`.

## Estimated end state

| File                                                | Before | After (target)   |
| --------------------------------------------------- | ------ | ---------------- |
| `src/components/PdfPage/index.tsx`                  | 1727   | ~700             |
| `src/components/PdfPage/overlays.tsx`               | 1048   | (deleted)        |
| `src/components/PdfPage/overlays/*` (5 files)       |        | ~150–330 each    |
| `src/components/PdfPage/arrivals.tsx`               |        | ~330             |
| `src/components/PdfPage/useRunDrag.ts`              |        | ~150             |
| `src/components/PdfPage/useImageDrag.ts`            |        | ~290             |
| `src/components/PdfPage/SourceRunOverlay.tsx`       |        | ~280             |
| `src/components/PdfPage/useCrossPageDragPreview.ts` |        | ~120             |
| `src/components/PdfPage/AnnotationLayer.tsx`        | 565    | ~80 (+ 3 layers) |

No file > ~330 lines after the split. No public-API changes.

## Order to land it

Phases are independent and each is shippable on its own:

1. **Phase 1 (arrivals)** — smallest, safest, ~326 lines moved
   verbatim. Good warm-up; lint will catch any broken imports.
2. **Phase 4 (overlays)** — pure file moves + the shared portal hook.
3. **Phase 5 (annotations)** — largest behavioural-code move; do
   alone so a regression is easy to bisect against.
4. **Phase 2 (drag hooks)** — touches the densest state in `index.tsx`.
5. **Phase 3 (SourceRunOverlay)** — depends on Phase 2's hook.

Run `pnpm check` between phases — tsc/prettier/eslint all green
before moving on, and the e2e suite should be untouched (the public
overlay components keep their existing names + props).

## Things to watch for

- **`react-refresh/only-export-components`** rule: `helpers.ts` already
  exists for exactly this reason — `cropCanvasToDataUrl` got pulled
  out of `overlays.tsx` in commit `4e7e128`. Hooks files (`useRunDrag`,
  `useImageDrag`, `useCrossPageDragPreview`) must export only the
  hook + types, no React components.
- **`useDragGesture` callback closures** capture render-time state. The
  arrival overlays already work around this with `dragLiveRef`. The
  same pattern must be preserved when these get moved.
- **Cross-page hit-test contract:** every component that calls
  `findPageAtPoint` relies on `[data-page-index]` / `[data-source-key]`
  / `[data-page-scale]` / `[data-view-width]` / `[data-view-height]`
  attributes on the page container. That container stays in
  `index.tsx`; the rest of the splits don't touch it.
- **Touch-hold gate** (`useDragGesture`'s 400ms claim window for touch
  drags) is consumed identically across all gestures — no change.
