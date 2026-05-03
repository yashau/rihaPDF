# Splitting App.tsx

App.tsx is **2178 lines**. It mixes header chrome, document state,
undo/redo machinery, selection, save serialization, preview rebuild,
and a per-slot render loop. The goal is to bring [App.tsx](src/App.tsx)
under ~250 lines as a composition root, with the rest factored into
focused hooks and sub-components.

Hooks live in [src/lib/](src/lib/) to match the existing
`useDragGesture` / `useMediaQuery` / `useVisualViewport` convention —
no new `src/hooks/` directory.

## Target structure

```
src/App.tsx                          ~250 lines, composition only
src/components/AppHeader.tsx         desktop + mobile headers, file inputs
src/components/AboutModal.tsx        modal + BrowserSupportSection
src/components/PageList.tsx          slot mapping + targetSlotId rebind
src/components/PageWithToolbar.tsx   (already inline at 2077–2178)
src/lib/useUndoRedo.ts               snapshot stack, coalesce, Ctrl+Z keys
src/lib/useSelection.ts              selection + Delete/Esc/click handlers
src/lib/usePreviewCanvases.ts        preview rebuild effect
src/lib/useMobileChrome.ts           header height + sidebar drawer
src/lib/buildSavePayload.ts          slot→flat translation for onSave
```

Each phase below compiles, tests pass, and is independently mergeable.

## Phase 1 — pure components (low risk)

No state moves. Props drilled from App.

1. **[components/AboutModal.tsx](src/components/AboutModal.tsx)**
   Move `AboutModal` ([App.tsx:1882-1970](src/App.tsx#L1882-L1970)),
   `BrowserSupportSection` ([App.tsx:1991-2075](src/App.tsx#L1991-L2075)),
   `detectBrowser` ([App.tsx:1974-1982](src/App.tsx#L1974-L1982)),
   `BROWSER_LABEL` and the `BrowserId` type. Default export
   `<AboutModal>`; everything else file-private.

2. **[components/PageWithToolbar.tsx](src/components/PageWithToolbar.tsx)**
   Move `PageWithToolbar` ([App.tsx:2077-2178](src/App.tsx#L2077-L2178))
   verbatim. Already has a clean props interface — drop-in.

3. **[components/AppHeader.tsx](src/components/AppHeader.tsx)**
   Move desktop header ([App.tsx:1310-1453](src/App.tsx#L1310-L1453))
   and mobile header ([App.tsx:1454-1668](src/App.tsx#L1454-L1668)).
   Export two components:
   - `<AppHeader>` — takes `tool`, `setTool`, `pendingImage`,
     `setPendingImage`, `primaryFilename`, `busy`, `saveDisabled`,
     `totalChangeCount`, `canUndo`, `canRedo`, `onOpen`, `onSave`,
     `onUndo`, `onRedo`, `themeMode`, `setThemeMode`, `isMobile`,
     `mobileSidebarOpen`, `setMobileSidebarOpen`, `mobileHeaderRef`,
     `imageFileInputRef`, `fileInputRef`, `onAboutOpen`, `slotsLength`.
   - `<AppFileInputs>` — the hidden inputs
     ([App.tsx:1269-1300](src/App.tsx#L1269-L1300)). Stays separate
     because the refs are App-level and the inputs intentionally sit
     **outside** both header subtrees (see the comment at
     [App.tsx:1264-1268](src/App.tsx#L1264-L1268)). App renders
     `<AppFileInputs>` once at root.

4. **[components/PageList.tsx](src/components/PageList.tsx)**
   Move the slot-mapping JSX
   ([App.tsx:1740-1873](src/App.tsx#L1740-L1873)) and the
   `targetSlotId`→`targetPageIndex` rebind helpers
   ([App.tsx:1762-1821](src/App.tsx#L1762-L1821)). Takes the full state
   maps + selection + tool + editingByPage + the `on*` callbacks.
   Renders the centered page column.

After phase 1, App.tsx is ~1500 lines and all rendering is extracted.

## Phase 2 — custom hooks

5. **[lib/useMobileChrome.ts](src/lib/useMobileChrome.ts)**
   Move the `mobileHeaderRef` / `mobileHeaderH` ResizeObserver
   ([App.tsx:88-108](src/App.tsx#L88-L108)), the
   `useVisualViewportFollow` call
   ([App.tsx:111](src/App.tsx#L111)), the auto-close effect
   ([App.tsx:115-118](src/App.tsx#L115-L118)), and the
   `mobileSidebarOpen` state
   ([App.tsx:94](src/App.tsx#L94)).
   Signature: `useMobileChrome(isMobile: boolean)` →
   `{ mobileHeaderRef, mobileHeaderH, mobileSidebarOpen,
setMobileSidebarOpen }`.

6. **[lib/usePreviewCanvases.ts](src/lib/usePreviewCanvases.ts)**
   Move `previewCanvases` state
   ([App.tsx:142](src/App.tsx#L142)), `previewGenRef`
   ([App.tsx:145](src/App.tsx#L145)), and the rebuild effect
   ([App.tsx:547-677](src/App.tsx#L547-L677)).
   Signature: `usePreviewCanvases({ sources, slotById, edits,
imageMoves, shapeDeletes, editingByPage, isMobile })` →
   `{ previewCanvases }`. Internal — only one consumer.

7. **[lib/useSelection.ts](src/lib/useSelection.ts)**
   Move selection state
   ([App.tsx:169-174](src/App.tsx#L169-L174)), the three `onSelect*`
   ([App.tsx:414-422](src/App.tsx#L414-L422)), `onDeleteSelection`
   ([App.tsx:424-455](src/App.tsx#L424-L455)), and the two keyboard
   effects ([App.tsx:457-487](src/App.tsx#L457-L487)).
   Signature: `useSelection({ recordHistory, setImageMoves,
setInsertedImages, setShapeDeletes })` → `{ selection,
setSelection, onSelectImage, onSelectInsertedImage,
onSelectShape, onDeleteSelection }`.

8. **[lib/useUndoRedo.ts](src/lib/useUndoRedo.ts)**
   Make it generic so the `UndoSnapshot` type stays in App. Signature:

   ```
   useUndoRedo<S>({
     captureSnapshot: () => S,
     restoreSnapshot: (s: S) => void,
     maxHistory?: number,
     coalesceMs?: number,
   }) => {
     recordHistory(coalesceKey: string | null): void,
     undo(): void,
     redo(): void,
     clearHistory(): void,
     canUndo: boolean,
     canRedo: boolean,
   }
   ```

   Owns the two stacks, the coalesce-window ref
   ([App.tsx:240](src/App.tsx#L240)), and the Ctrl+Z / Ctrl+Y / Shift+Z
   keyboard effect ([App.tsx:489-511](src/App.tsx#L489-L511)).

   App keeps:
   - The `UndoSnapshot` type and the `*Ref` mirrors
     ([App.tsx:207-234](src/App.tsx#L207-L234)) — the hook can't own
     these without taking every state setter as input, which defeats
     the point.
   - `captureSnapshot` / `restoreSnapshot` callbacks
     ([App.tsx:242-254](src/App.tsx#L242-L254),
     [293-303](src/App.tsx#L293-L303)) passed in.

## Phase 3 — save serialization

9. **[lib/buildSavePayload.ts](src/lib/buildSavePayload.ts)**
   Pure function. Move the `slotAddr` build + the six `flat*` loops
   from `onSave` ([App.tsx:1024-1164](src/App.tsx#L1024-L1164)):
   ```
   buildSavePayload({
     slots, edits, imageMoves, insertedTexts,
     insertedImages, shapeDeletes, annotations,
   }) => {
     flatEdits, flatImageMoves, flatTextInserts,
     flatImageInserts, flatShapeDeletes, flatAnnotations,
   }
   ```
   App's `onSave` shrinks to: `buildSavePayload(...)` →
   `applyEditsAndSave(...)` → `downloadBlob(...)`.

## What stays in App.tsx

- All `on*` edit callbacks (`onEdit`, `onImageMove`, `onCanvasClick`,
  `onTextInsertChange`/`Delete`, `onImageInsertChange`/`Delete`,
  `onAnnotationAdd`/`Change`/`Delete`, `onSlotsChange`,
  `onEditingChange`). Each is tightly coupled to `recordHistory` +
  `slotsRef`, with bespoke coalesce keys. A `useEditCallbacks` hook
  would move 250 lines into another file with the same prop list — no
  clarity win.
- File-loading callbacks (`handleFile`, `onAddExternalPdfs`,
  `onPickImageFile`).
- Change-count derivations
  ([App.tsx:1192-1249](src/App.tsx#L1192-L1249)). Cheap, single-purpose.

## Pitfalls

- **`slotsRef` survives the move.** Five callbacks read
  `slotsRef.current` ([App.tsx:391](src/App.tsx#L391),
  [520](src/App.tsx#L520), [692](src/App.tsx#L692),
  [813](src/App.tsx#L813), [874](src/App.tsx#L874)). It exists to
  break the re-render dep on `slots`. Don't replace with `slots`
  during extraction.
- **`react-hooks/set-state-in-effect` suppressions.** Two spots
  ([App.tsx:116](src/App.tsx#L116),
  [639](src/App.tsx#L639)) carry an explicit eslint-disable. Move the
  comments with the lines or CI flags them.
- **Coalesce-key collisions.** Every existing `recordHistory` call
  uses a `<domain>:<id>` key (e.g. `edit:slotId:runId`,
  `image-move:slotId:imageId`). Add a one-line convention comment
  in `useUndoRedo.ts` so future callers don't pick a bare key like
  `"drag"` and silently merge with another flow.
- **`data-testid` attributes.** `open-pdf-input`, `undo`, `redo`,
  `undo-mobile`, `redo-mobile`, `mobile-sidebar-toggle`,
  `mobile-open-target`, `tool-highlight`, `tool-comment`, `tool-ink`
  all live in the headers. Don't drop them while moving JSX —
  Playwright probes use them.
- **`__runOpIndices` window hook.** [App.tsx:355-361](src/App.tsx#L355-L361)
  exposes a dev-only map for E2E. Stays in `handleFile`, which stays
  in App.

## Verification

After each phase: `pnpm test run`, `pnpm build`, smoke test in the
dev server (open a PDF, edit a run, undo, save, reload). Phase
boundaries are independently shippable, so a stalled phase doesn't
block prior wins.
