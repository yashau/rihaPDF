import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal } from "@heroui/react";
import {
  Check,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  MousePointer2,
  PanelLeft,
  Pencil,
  Redo2,
  Save,
  Type,
  Undo2,
} from "lucide-react";
import {
  applyEditsAndSave,
  downloadBlob,
  type Edit,
  type ImageInsert,
  type ImageMove,
  type ShapeDelete,
  type TextInsert,
} from "./lib/save";
import { buildPreviewBytes, renderPagePreviewCanvas, type PageStripSpec } from "./lib/preview";
import { readImageFile, type ImageInsertion, type TextInsertion } from "./lib/insertions";
import {
  type Annotation,
  COMMENT_DEFAULT_FONT_SIZE,
  COMMENT_DEFAULT_HEIGHT,
  COMMENT_DEFAULT_WIDTH,
  DEFAULT_COMMENT_COLOR,
  newAnnotationId,
} from "./lib/annotations";
import { PdfPage, type EditValue, type ImageMoveValue } from "./components/PdfPage";
import { PageSidebar } from "./components/PageSidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { pageSlot, slotsFromSource, type PageSlot } from "./lib/slots";
import { loadSource, nextExternalSourceKey, PRIMARY_SOURCE_KEY } from "./lib/loadSource";
import type { LoadedSource } from "./lib/loadSource";
import type { RenderedPage } from "./lib/pdf";
import { useTheme } from "./lib/theme";
import { useIsMobile } from "./lib/useMediaQuery";
import { useVisualViewportFollow } from "./lib/useVisualViewport";
import { READABLE_STREAM_ASYNC_ITER_POLYFILLED } from "./lib/polyfills";

export type ToolMode = "select" | "addText" | "addImage" | "highlight" | "comment" | "ink";

const RENDER_SCALE = 1.5;
/** Debounce window for the undo/redo coalescing rule: a second
 *  change to the same coalesce key (e.g. typing in the same text
 *  field, dragging the same image) within this window does NOT
 *  push a new history entry — the original pre-change snapshot
 *  is reused. After this much idle time, the next change starts
 *  a fresh history entry. */
const UNDO_COALESCE_MS = 500;
/** Hard cap on history depth so a long editing session can't
 *  grow the snapshot stack without bound. Snapshots are mostly
 *  Map shells with values shared by reference (image bytes,
 *  source bytes), so the cap is generous. */
const UNDO_MAX_HISTORY = 100;

/** One undoable point-in-time of all document-mutating state.
 *  Selection / tool / pendingImage / editingByPage are excluded
 *  — they're UI state, not document state, and rolling them back
 *  would feel surprising. Sources is included so undoing an
 *  external-PDF add removes the just-added source as well. */
type UndoSnapshot = {
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  slots: PageSlot[];
  sources: Map<string, LoadedSource>;
};

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const isMobile = useIsMobile();
  const [primaryFilename, setPrimaryFilename] = useState<string | null>(null);
  // Mobile header is `position: fixed` (so it survives pinch-zoom via
  // `useVisualViewportFollow` below) — that takes it out of the flex
  // flow, so we measure its height and pad <main> by the same amount
  // to keep page content from sliding under it on first paint.
  const mobileHeaderRef = useRef<HTMLElement | null>(null);
  const [mobileHeaderH, setMobileHeaderH] = useState(0);
  // Mobile-only sidebar drawer. Desktop renders the sidebar inline as
  // a rail; on mobile it's a fixed overlay toggled from the header.
  // Auto-closes when the viewport flips back to desktop or the doc is
  // closed, so reopening on mobile starts in a clean state.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    const el = mobileHeaderRef.current;
    if (!el) return;
    // ResizeObserver fires once on observe with the current size, then
    // again on each layout change (theme tweaks, font swap, etc.). We
    // round to avoid sub-pixel state churn.
    const ro = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setMobileHeaderH(Math.round(last.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);
  // Counter pinch-zoom: keep the header visually fixed-size at the top
  // of the visual viewport even when the user pinches the page.
  useVisualViewportFollow(mobileHeaderRef, "top", isMobile);
  // Close the mobile drawer if the viewport widens past sm or the
  // document is closed — both states make the toggle invisible/disabled
  // and a stuck-open drawer would be unrecoverable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);
  /** All loaded sources keyed by sourceKey. The primary file uses the
   *  fixed key from `PRIMARY_SOURCE_KEY`; externals use per-pick keys
   *  from `nextExternalSourceKey`. Promoting external pages to first-
   *  class status meant collapsing the old `originalBytes / pages /
   *  externalSources / externalRendered` fan-out into this single map. */
  const [sources, setSources] = useState<Map<string, LoadedSource>>(new Map());
  /** Ordered list of displayed pages. Each slot points back at a source
   *  page (`kind: "page"`) or is a fresh blank (`kind: "blank"`).
   *  Slot identity (`id`) is the stable key used to index per-page state
   *  so an entry follows its page through reorder. */
  const [slots, setSlots] = useState<PageSlot[]>([]);
  /** Map<slotId, Map<runId, EditValue>> */
  const [edits, setEdits] = useState<Map<string, Map<string, EditValue>>>(new Map());
  /** Map<slotId, Map<imageId, ImageMoveValue>> — drag offsets per
   *  image, identical shape to edits but for image XObject placements. */
  const [imageMoves, setImageMoves] = useState<Map<string, Map<string, ImageMoveValue>>>(new Map());
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Per-(sourceKey, sourcePageIndex) replacement canvases produced by
   *  the live preview pipeline. Keys are `${sourceKey}:${pageIndex}` so
   *  edits on external pages get their own preview canvas, not just
   *  primary pages. */
  const [previewCanvases, setPreviewCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map());
  /** Monotonic generation counter used to discard stale preview-rebuild
   *  results when the user keeps editing during the rebuild. */
  const previewGenRef = useRef(0);
  /** Mirror of `slots` so callbacks that need slotIndex→slotId lookups
   *  (cross-page insertion drags land via slot index from PdfPage's
   *  hit-test) don't re-create on every slot mutation. */
  const slotsRef = useRef<PageSlot[]>([]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  /** Map<slotId, currently-open runId> — populated by PdfPage's
   *  onEditingChange. Folded into the preview-strip spec so an open
   *  editor immediately hides the original glyph behind it. */
  const [editingByPage, setEditingByPage] = useState<Map<string, string>>(new Map());
  /** Tool mode for click-to-place actions ("select" = no insertion;
   *  "addText" = next click on a page drops a new text box; "addImage"
   *  = next click drops the pending image at that position). */
  const [tool, setTool] = useState<ToolMode>("select");
  /** Per-slot net-new text/image insertions — separate from edits
   *  because they don't reference an existing run/image. Keyed by
   *  slotId so an insertion follows its slot through reorder. */
  const [insertedTexts, setInsertedTexts] = useState<Map<string, TextInsertion[]>>(new Map());
  const [insertedImages, setInsertedImages] = useState<Map<string, ImageInsertion[]>>(new Map());
  /** Currently-selected object — set by single-click on an image
   *  overlay; cleared by Escape, by clicking elsewhere, or by tool
   *  changes. */
  const [selection, setSelection] = useState<
    | { kind: "image"; slotId: string; imageId: string }
    | { kind: "insertedImage"; slotId: string; id: string }
    | { kind: "shape"; slotId: string; shapeId: string }
    | null
  >(null);
  /** Map<slotId, Set<shapeId>> — vector shapes flagged for deletion.
   *  Shapes are delete-only in v1 (no move / resize) so a Set is enough. */
  const [shapeDeletes, setShapeDeletes] = useState<Map<string, Set<string>>>(new Map());
  /** Map<slotId, Annotation[]> — user-added highlights / sticky notes /
   *  ink strokes. Keyed by slotId so an annotation follows its page
   *  through reorder, same as the insertion / edit maps. */
  const [annotations, setAnnotations] = useState<Map<string, Annotation[]>>(new Map());
  /** When the user picks an image file, we hold its bytes here until
   *  they click on a page to place it. Cleared on placement / cancel. */
  const [pendingImage, setPendingImage] = useState<{
    bytes: Uint8Array;
    format: "png" | "jpeg";
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Undo / redo: snapshot stack with debounce-and-replace coalescing ---
  // The tradeoff: per-keystroke snapshots flood the stack and undo
  // feels broken; one snapshot per "user action" (typing session,
  // drag, click-to-place) is what people actually mean by Ctrl+Z.
  // We capture pre-mutation state at the START of each mutating
  // callback, but *only* push it if the coalesce key differs from
  // the in-flight one (or the debounce window has elapsed). Native
  // textarea / input undo still handles per-character undo while
  // a field is focused; this stack is for app-level actions.
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);
  // Mirror refs so `recordHistory` can read current state without
  // taking every state slice as a useCallback dep (which would
  // re-create every callback on every keystroke). slotsRef already
  // exists above; the rest are added here.
  const editsRef = useRef(edits);
  const imageMovesRef = useRef(imageMoves);
  const insertedTextsRef = useRef(insertedTexts);
  const insertedImagesRef = useRef(insertedImages);
  const shapeDeletesRef = useRef(shapeDeletes);
  const annotationsRef = useRef(annotations);
  const sourcesRef = useRef(sources);
  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);
  useEffect(() => {
    imageMovesRef.current = imageMoves;
  }, [imageMoves]);
  useEffect(() => {
    insertedTextsRef.current = insertedTexts;
  }, [insertedTexts]);
  useEffect(() => {
    insertedImagesRef.current = insertedImages;
  }, [insertedImages]);
  useEffect(() => {
    shapeDeletesRef.current = shapeDeletes;
  }, [shapeDeletes]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  /** In-flight coalesce window: when the next `recordHistory` call
   *  arrives with the same `key` before `timer` fires, the call is
   *  dropped (the existing pre-change snapshot is still the right
   *  one to revert to). A different key, or a fired timer, ends
   *  the window. */
  const coalesceRef = useRef<{ key: string; timer: number } | null>(null);

  const captureSnapshot = useCallback(
    (): UndoSnapshot => ({
      edits: editsRef.current,
      imageMoves: imageMovesRef.current,
      insertedTexts: insertedTextsRef.current,
      insertedImages: insertedImagesRef.current,
      shapeDeletes: shapeDeletesRef.current,
      annotations: annotationsRef.current,
      slots: slotsRef.current,
      sources: sourcesRef.current,
    }),
    [],
  );

  /** Call BEFORE a state mutation. `coalesceKey` of `null` always
   *  pushes (use for one-shot actions like click-to-place);
   *  a string key coalesces consecutive same-key calls within
   *  `UNDO_COALESCE_MS`. Always clears the redo stack — once you
   *  branch the timeline, redo is gone. */
  const recordHistory = useCallback(
    (coalesceKey: string | null) => {
      if (coalesceKey !== null && coalesceRef.current?.key === coalesceKey) {
        // Same-key follow-up within the window: keep the original
        // pre-change snapshot, just extend the window.
        window.clearTimeout(coalesceRef.current.timer);
        coalesceRef.current.timer = window.setTimeout(() => {
          coalesceRef.current = null;
        }, UNDO_COALESCE_MS);
        return;
      }
      const snapshot = captureSnapshot();
      setUndoStack((prev) => {
        const next = [...prev, snapshot];
        if (next.length > UNDO_MAX_HISTORY) next.splice(0, next.length - UNDO_MAX_HISTORY);
        return next;
      });
      setRedoStack((r) => (r.length === 0 ? r : []));
      if (coalesceRef.current) window.clearTimeout(coalesceRef.current.timer);
      coalesceRef.current =
        coalesceKey === null
          ? null
          : {
              key: coalesceKey,
              timer: window.setTimeout(() => {
                coalesceRef.current = null;
              }, UNDO_COALESCE_MS),
            };
    },
    [captureSnapshot],
  );

  const restoreSnapshot = useCallback((s: UndoSnapshot) => {
    setEdits(s.edits);
    setImageMoves(s.imageMoves);
    setInsertedTexts(s.insertedTexts);
    setInsertedImages(s.insertedImages);
    setShapeDeletes(s.shapeDeletes);
    setAnnotations(s.annotations);
    setSlots(s.slots);
    setSources(s.sources);
    setSelection(null);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    if (coalesceRef.current) {
      window.clearTimeout(coalesceRef.current.timer);
      coalesceRef.current = null;
    }
    const target = undoStack[undoStack.length - 1];
    const current = captureSnapshot();
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, current]);
    restoreSnapshot(target);
  }, [undoStack, captureSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    if (coalesceRef.current) {
      window.clearTimeout(coalesceRef.current.timer);
      coalesceRef.current = null;
    }
    const target = redoStack[redoStack.length - 1];
    const current = captureSnapshot();
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, current]);
    restoreSnapshot(target);
  }, [redoStack, captureSnapshot, restoreSnapshot]);

  const clearHistory = useCallback(() => {
    if (coalesceRef.current) {
      window.clearTimeout(coalesceRef.current.timer);
      coalesceRef.current = null;
    }
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const source = await loadSource(file, RENDER_SCALE, PRIMARY_SOURCE_KEY);
        setPrimaryFilename(file.name);
        setSources(new Map([[PRIMARY_SOURCE_KEY, source]]));
        setSlots(slotsFromSource(source));
        // Opening a new primary file is a fresh start, not an
        // undoable mutation — drop any history from the previous
        // document so Ctrl+Z can't accidentally resurrect it.
        clearHistory();
        // Dev-only: expose run.contentStreamOpIndices to E2E tests so a
        // probe can inspect what the strip pipeline thinks each run owns
        // without re-running the whole extractor in the browser.
        (
          window as unknown as {
            __runOpIndices?: Map<string, number[]>;
          }
        ).__runOpIndices = new Map(
          source.pages.flatMap((p) => p.textRuns.map((r) => [r.id, r.contentStreamOpIndices])),
        );
        setEdits(new Map());
        setImageMoves(new Map());
        setShapeDeletes(new Map());
        setAnnotations(new Map());
        setPreviewCanvases(new Map());
        setInsertedTexts(new Map());
        setInsertedImages(new Map());
        setTool("select");
        setPendingImage(null);
      } finally {
        setBusy(false);
      }
    },
    [clearHistory],
  );

  const onEdit = useCallback(
    (slotId: string, runId: string, value: EditValue) => {
      // Coalesce key: same (slot, run) within UNDO_COALESCE_MS
      // collapses into one history entry — typing into one field
      // is one undo step. Cross-page target updates also coalesce
      // because the key is the source (slot, run), not the target.
      recordHistory(`edit:${slotId}:${runId}`);
      // Convert PdfPage's drop-time `targetPageIndex` (current slot
      // index) to the stable `targetSlotId` so the cross-page target
      // survives reorder. PdfPage never reads `targetSlotId`; App
      // re-derives `targetPageIndex` per render before passing back.
      let stored: EditValue = value;
      if (value.targetPageIndex !== undefined) {
        const targetSlot = slotsRef.current[value.targetPageIndex];
        stored = {
          ...value,
          targetPageIndex: undefined,
          // targetSourceKey is preserved as the authoritative source
          // identity for the drop; targetSlotId carries the slot's
          // stable id so reorder doesn't strand it.
          targetSlotId: targetSlot?.id,
        };
      } else {
        stored = { ...value, targetSlotId: undefined, targetSourceKey: undefined };
      }
      setEdits((prev) => {
        const next = new Map(prev);
        const pageMap = new Map<string, EditValue>(next.get(slotId) ?? []);
        pageMap.set(runId, stored);
        next.set(slotId, pageMap);
        return next;
      });
    },
    [recordHistory],
  );

  const onSelectImage = useCallback((slotId: string, imageId: string) => {
    setSelection({ kind: "image", slotId, imageId });
  }, []);
  const onSelectInsertedImage = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "insertedImage", slotId, id });
  }, []);
  const onSelectShape = useCallback((slotId: string, shapeId: string) => {
    setSelection({ kind: "shape", slotId, shapeId });
  }, []);

  const onDeleteSelection = useCallback(() => {
    if (!selection) return;
    // Each delete is its own undo step — Delete is a discrete user
    // action, not continuous like typing or dragging.
    recordHistory(null);
    if (selection.kind === "image") {
      setImageMoves((prev) => {
        const next = new Map(prev);
        const pageMap = new Map<string, ImageMoveValue>(next.get(selection.slotId) ?? []);
        const existing = pageMap.get(selection.imageId) ?? {};
        pageMap.set(selection.imageId, { ...existing, deleted: true });
        next.set(selection.slotId, pageMap);
        return next;
      });
    } else if (selection.kind === "insertedImage") {
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const arr = (next.get(selection.slotId) ?? []).filter((m) => m.id !== selection.id);
        next.set(selection.slotId, arr);
        return next;
      });
    } else if (selection.kind === "shape") {
      setShapeDeletes((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(selection.slotId) ?? []);
        set.add(selection.shapeId);
        next.set(selection.slotId, set);
        return next;
      });
    }
    setSelection(null);
  }, [selection, recordHistory]);

  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement).isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      onDeleteSelection();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [selection, onDeleteSelection]);

  useEffect(() => {
    if (!selection) return;
    const onClick = () => setSelection(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [selection]);

  // Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z = redo, Ctrl+Y = redo
  // (Windows convention). When focus is in a text input / textarea
  // / contenteditable, defer to the browser's native per-character
  // undo so users can step keystroke-by-keystroke inside one field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z";
      const isRedoY = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "y";
      if (!isUndo && !isRedoY) return;
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement).isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      if (isRedoY || (isUndo && e.shiftKey)) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const onImageMove = useCallback(
    (slotId: string, imageId: string, value: ImageMoveValue) => {
      // Coalesce a continuous drag of the same image into one
      // undo step — onImageMove fires per pointermove.
      recordHistory(`image-move:${slotId}:${imageId}`);
      let stored: ImageMoveValue = value;
      if (value.targetPageIndex !== undefined) {
        const targetSlot = slotsRef.current[value.targetPageIndex];
        stored = {
          ...value,
          targetPageIndex: undefined,
          targetSlotId: targetSlot?.id,
        };
      } else {
        stored = { ...value, targetSlotId: undefined, targetSourceKey: undefined };
      }
      setImageMoves((prev) => {
        const next = new Map(prev);
        const pageMap = new Map<string, ImageMoveValue>(next.get(slotId) ?? []);
        pageMap.set(imageId, stored);
        next.set(slotId, pageMap);
        return next;
      });
    },
    [recordHistory],
  );

  // Resolve a slotId to (sourceKey, sourcePageIndex). Used in the save
  // flatten phase + the preview strip useEffect.
  const slotById = useMemo(() => new Map<string, PageSlot>(slots.map((s) => [s.id, s])), [slots]);

  // Rebuild the per-page preview canvases whenever the set of edited
  // runs or moved images changes. Per-source — every affected source's
  // doc gets its own buildPreviewBytes pass.
  useEffect(() => {
    if (sources.size === 0) return;
    type SourceBuckets = {
      runIdsByPage: Map<number, Set<string>>;
      imageIdsByPage: Map<number, Set<string>>;
      shapeIdsByPage: Map<number, Set<string>>;
    };
    const bySource = new Map<string, SourceBuckets>();
    const get = (sourceKey: string): SourceBuckets => {
      let b = bySource.get(sourceKey);
      if (!b) {
        b = {
          runIdsByPage: new Map(),
          imageIdsByPage: new Map(),
          shapeIdsByPage: new Map(),
        };
        bySource.set(sourceKey, b);
      }
      return b;
    };
    const addRun = (sourceKey: string, pageIndex: number, runId: string) => {
      const b = get(sourceKey);
      const set = b.runIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(runId);
      b.runIdsByPage.set(pageIndex, set);
    };
    const addImage = (sourceKey: string, pageIndex: number, imageId: string) => {
      const b = get(sourceKey);
      const set = b.imageIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(imageId);
      b.imageIdsByPage.set(pageIndex, set);
    };
    const addShape = (sourceKey: string, pageIndex: number, shapeId: string) => {
      const b = get(sourceKey);
      const set = b.shapeIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(shapeId);
      b.shapeIdsByPage.set(pageIndex, set);
    };
    const sourceTupleFor = (slotId: string): [string, number] | null => {
      const slot = slotById.get(slotId);
      return slot && slot.kind === "page" ? [slot.sourceKey, slot.sourcePageIndex] : null;
    };
    for (const [slotId, runs] of edits) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const runId of runs.keys()) addRun(t[0], t[1], runId);
    }
    for (const [slotId, imgs] of imageMoves) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const [id, v] of imgs) {
        if (
          v.deleted ||
          (v.dx ?? 0) !== 0 ||
          (v.dy ?? 0) !== 0 ||
          (v.dw ?? 0) !== 0 ||
          (v.dh ?? 0) !== 0 ||
          v.targetSlotId !== undefined
        ) {
          addImage(t[0], t[1], id);
        }
      }
    }
    for (const [slotId, runId] of editingByPage) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      addRun(t[0], t[1], runId);
    }
    for (const [slotId, shapes] of shapeDeletes) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const shapeId of shapes) addShape(t[0], t[1], shapeId);
    }

    const tasks: Array<{ sourceKey: string; specs: PageStripSpec[] }> = [];
    for (const [sourceKey, b] of bySource) {
      const affected = new Set<number>([
        ...b.runIdsByPage.keys(),
        ...b.imageIdsByPage.keys(),
        ...b.shapeIdsByPage.keys(),
      ]);
      const specs: PageStripSpec[] = [];
      for (const pageIndex of affected) {
        const runIds = b.runIdsByPage.get(pageIndex) ?? new Set<string>();
        const imageIds = b.imageIdsByPage.get(pageIndex) ?? new Set<string>();
        const shapeIds = b.shapeIdsByPage.get(pageIndex) ?? new Set<string>();
        if (runIds.size === 0 && imageIds.size === 0 && shapeIds.size === 0) continue;
        specs.push({ pageIndex, runIds, imageIds, shapeIds });
      }
      if (specs.length > 0) tasks.push({ sourceKey, specs });
    }
    if (tasks.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewCanvases((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const gen = ++previewGenRef.current;
    let cancelled = false;
    // Mobile CPUs are slower; rebuild lag is more noticeable. Bump
    // the debounce so the user finishes a sustained edit (e.g.
    // typing in an EditField) before any rebuild kicks off.
    const debounceMs = isMobile ? 250 : 150;
    const handle = window.setTimeout(async () => {
      try {
        const next = new Map<string, HTMLCanvasElement>();
        for (const { sourceKey, specs } of tasks) {
          const source = sources.get(sourceKey);
          if (!source) continue;
          const previewBytes = await buildPreviewBytes(source.bytes.slice(0), source.pages, specs);
          if (cancelled || previewGenRef.current !== gen) return;
          for (const spec of specs) {
            const canvas = await renderPagePreviewCanvas(
              previewBytes,
              spec.pageIndex,
              RENDER_SCALE,
            );
            if (cancelled || previewGenRef.current !== gen) return;
            next.set(`${sourceKey}:${spec.pageIndex}`, canvas);
          }
        }
        if (cancelled || previewGenRef.current !== gen) return;
        setPreviewCanvases(next);
      } catch (err) {
        console.warn("preview rebuild failed", err);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [sources, slotById, edits, imageMoves, shapeDeletes, editingByPage, isMobile]);

  const onEditingChange = useCallback((slotId: string, runId: string | null) => {
    setEditingByPage((prev) => {
      const next = new Map(prev);
      if (runId) next.set(slotId, runId);
      else next.delete(slotId);
      return next;
    });
  }, []);

  const onCanvasClick = useCallback(
    (slotId: string, pageIndex: number, pdfX: number, pdfY: number) => {
      // Resolve the slot-time (sourceKey, sourcePageIndex) so net-new
      // insertions know which source's doc they target at save time.
      const slot = slotsRef.current[pageIndex];
      if (!slot || slot.kind !== "page") return;
      if (tool === "addText") {
        // Click-to-place is a discrete action — no coalesce.
        recordHistory(null);
        const id = `p${pageIndex + 1}-t${Date.now().toString(36)}`;
        const ins: TextInsertion = {
          id,
          sourceKey: slot.sourceKey,
          pageIndex: slot.sourcePageIndex,
          pdfX,
          pdfY,
          pdfWidth: 120,
          fontSize: 12,
          text: "",
        };
        setInsertedTexts((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(slotId) ?? []), ins];
          next.set(slotId, arr);
          return next;
        });
        setTool("select");
        setEditingByPage((prev) => {
          const next = new Map(prev);
          next.set(slotId, id);
          return next;
        });
        return;
      }
      if (tool === "addImage" && pendingImage) {
        recordHistory(null);
        const id = `p${pageIndex + 1}-ni${Date.now().toString(36)}`;
        const targetW = Math.min(Math.max(pendingImage.naturalWidth, 30), 200);
        const aspect = pendingImage.naturalHeight / pendingImage.naturalWidth;
        const w = targetW;
        const h = targetW * aspect;
        const ins: ImageInsertion = {
          id,
          sourceKey: slot.sourceKey,
          pageIndex: slot.sourcePageIndex,
          pdfX: pdfX - w / 2,
          pdfY: pdfY - h / 2,
          pdfWidth: w,
          pdfHeight: h,
          bytes: pendingImage.bytes,
          format: pendingImage.format,
        };
        setInsertedImages((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(slotId) ?? []), ins];
          next.set(slotId, arr);
          return next;
        });
        setPendingImage(null);
        setTool("select");
        return;
      }
      if (tool === "comment") {
        // Drop a FreeText comment box. The click point becomes the
        // bottom-left of the box (matches PDF /Rect convention).
        // After dropping, we switch back to Select so the user can
        // immediately type into the freshly-created box without the
        // capture layer eating their clicks.
        const id = newAnnotationId("comment");
        recordHistory(null);
        setAnnotations((prev) => {
          const next = new Map(prev);
          const arr = [
            ...(next.get(slotId) ?? []),
            {
              kind: "comment",
              id,
              sourceKey: slot.sourceKey,
              pageIndex: slot.sourcePageIndex,
              pdfX,
              pdfY: pdfY - COMMENT_DEFAULT_HEIGHT,
              pdfWidth: COMMENT_DEFAULT_WIDTH,
              pdfHeight: COMMENT_DEFAULT_HEIGHT,
              color: DEFAULT_COMMENT_COLOR,
              text: "",
              fontSize: COMMENT_DEFAULT_FONT_SIZE,
            } satisfies Annotation,
          ];
          next.set(slotId, arr);
          return next;
        });
        setTool("select");
      }
    },
    [tool, pendingImage, recordHistory],
  );

  /** Update an inserted text box (text/style/position changes). When
   *  `patch.pageIndex` (the destination slot index, set by PdfPage on
   *  cross-page drop) differs from the source slot, the entry is moved
   *  between slot buckets — this is how a cross-page or cross-source
   *  drag lands. PdfPage emits the destination's source-page index via
   *  `patch.pageIndex` (treated as a slot index here when paired with
   *  `patch.sourceKey`). */
  const onTextInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<TextInsertion>) => {
      // Same-(slot,id) coalesces — typing into the inserted text
      // box, or dragging it, is one undo step.
      recordHistory(`text-insert:${sourceSlotId}:${id}`);
      setInsertedTexts((prev) => {
        const next = new Map(prev);
        const fromArr = next.get(sourceSlotId) ?? [];
        const item = fromArr.find((t) => t.id === id);
        if (!item) return prev;
        // PdfPage's cross-page drop emits `patch.pageIndex` as the
        // destination's CURRENT slot index. Resolve to that slot's
        // (sourceKey, sourcePageIndex) so the patched insertion's
        // address survives reorder.
        let updated: TextInsertion;
        let targetSlotId = sourceSlotId;
        if (
          patch.pageIndex !== undefined &&
          patch.sourceKey !== undefined &&
          (patch.pageIndex !== item.pageIndex || patch.sourceKey !== item.sourceKey)
        ) {
          const destSlot = slotsRef.current[patch.pageIndex];
          if (destSlot && destSlot.kind === "page") {
            updated = {
              ...item,
              ...patch,
              sourceKey: destSlot.sourceKey,
              pageIndex: destSlot.sourcePageIndex,
            };
            targetSlotId = destSlot.id;
          } else {
            updated = { ...item, ...patch };
          }
        } else {
          updated = { ...item, ...patch };
        }
        if (targetSlotId !== sourceSlotId) {
          next.set(
            sourceSlotId,
            fromArr.filter((t) => t.id !== id),
          );
          next.set(targetSlotId, [...(next.get(targetSlotId) ?? []), updated]);
        } else {
          next.set(
            sourceSlotId,
            fromArr.map((t) => (t.id === id ? updated : t)),
          );
        }
        return next;
      });
    },
    [recordHistory],
  );
  const onTextInsertDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      setInsertedTexts((prev) => {
        const next = new Map(prev);
        const arr = (next.get(slotId) ?? []).filter((t) => t.id !== id);
        next.set(slotId, arr);
        return next;
      });
    },
    [recordHistory],
  );
  const onImageInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<ImageInsertion>) => {
      // Same-(slot,id) coalesces — drag/resize of an inserted
      // image is one undo step.
      recordHistory(`image-insert:${sourceSlotId}:${id}`);
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const fromArr = next.get(sourceSlotId) ?? [];
        const item = fromArr.find((m) => m.id === id);
        if (!item) return prev;
        let updated: ImageInsertion;
        let targetSlotId = sourceSlotId;
        if (
          patch.pageIndex !== undefined &&
          patch.sourceKey !== undefined &&
          (patch.pageIndex !== item.pageIndex || patch.sourceKey !== item.sourceKey)
        ) {
          const destSlot = slotsRef.current[patch.pageIndex];
          if (destSlot && destSlot.kind === "page") {
            updated = {
              ...item,
              ...patch,
              sourceKey: destSlot.sourceKey,
              pageIndex: destSlot.sourcePageIndex,
            };
            targetSlotId = destSlot.id;
          } else {
            updated = { ...item, ...patch };
          }
        } else {
          updated = { ...item, ...patch };
        }
        if (targetSlotId !== sourceSlotId) {
          next.set(
            sourceSlotId,
            fromArr.filter((m) => m.id !== id),
          );
          next.set(targetSlotId, [...(next.get(targetSlotId) ?? []), updated]);
        } else {
          next.set(
            sourceSlotId,
            fromArr.map((m) => (m.id === id ? updated : m)),
          );
        }
        return next;
      });
    },
    [recordHistory],
  );
  const onImageInsertDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const arr = (next.get(slotId) ?? []).filter((m) => m.id !== id);
        next.set(slotId, arr);
        return next;
      });
    },
    [recordHistory],
  );

  /** Add a new annotation to a slot. One snapshot per add — discrete
   *  user action like click-to-place. Returns the created annotation's
   *  id so callers can immediately open the comment editor for notes. */
  const onAnnotationAdd = useCallback(
    (slotId: string, annotation: Annotation) => {
      recordHistory(null);
      setAnnotations((prev) => {
        const next = new Map(prev);
        const arr = [...(next.get(slotId) ?? []), annotation];
        next.set(slotId, arr);
        return next;
      });
    },
    [recordHistory],
  );
  /** Patch an existing annotation by id (used by the note-comment
   *  editor and color picker). Coalesces same-(slot,id) updates within
   *  the undo window so typing into a comment is one undo step. */
  const onAnnotationChange = useCallback(
    (slotId: string, id: string, patch: Partial<Annotation>) => {
      recordHistory(`annotation:${slotId}:${id}`);
      setAnnotations((prev) => {
        const next = new Map(prev);
        const arr = next.get(slotId) ?? [];
        next.set(
          slotId,
          arr.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)),
        );
        return next;
      });
    },
    [recordHistory],
  );
  const onAnnotationDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      setAnnotations((prev) => {
        const next = new Map(prev);
        const arr = (next.get(slotId) ?? []).filter((a) => a.id !== id);
        next.set(slotId, arr);
        return next;
      });
    },
    [recordHistory],
  );

  /** "+ From PDF" handler: load one or more external PDFs and append
   *  their pages as full first-class slots. Each external goes through
   *  `loadSource` so its pages get the same font / glyph-map / image
   *  extraction as the primary — the user can edit, drag, insert,
   *  delete on them just like primary pages. */
  const onAddExternalPdfs = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      try {
        // Record once before the whole batch — undo removes all
        // pages added by this single "+ From PDF" action together,
        // not one external file at a time.
        recordHistory(null);
        for (const file of files) {
          const sourceKey = nextExternalSourceKey(file);
          const source = await loadSource(file, RENDER_SCALE, sourceKey);
          setSources((prev) => {
            const next = new Map(prev);
            next.set(sourceKey, source);
            return next;
          });
          setSlots((prev) => [...prev, ...source.pages.map((_, i) => pageSlot(sourceKey, i))]);
        }
      } finally {
        setBusy(false);
      }
    },
    [recordHistory],
  );

  const onPickImageFile = useCallback(async (file: File) => {
    const parsed = await readImageFile(file);
    if (!parsed) {
      console.warn("Unsupported image format (PNG/JPEG only):", file.name);
      return;
    }
    setPendingImage(parsed);
    setTool("addImage");
  }, []);

  // Wrap setSlots for PageSidebar so reorder / blank-insert /
  // remove-page actions all push a snapshot before mutating.
  // PageSidebar always passes an array (no functional updater),
  // so a value-only signature is safe.
  const onSlotsChange = useCallback(
    (next: PageSlot[]) => {
      recordHistory(null);
      setSlots(next);
    },
    [recordHistory],
  );

  const onSave = useCallback(async () => {
    if (sources.size === 0 || !primaryFilename) return;
    setBusy(true);
    try {
      // Translate slotId-keyed state back to (sourceKey, sourcePageIndex)
      // for the per-source save pipeline.
      const slotAddr = new Map<string, { sourceKey: string; pageIndex: number; slot: PageSlot }>();
      for (const slot of slots) {
        if (slot.kind === "page") {
          slotAddr.set(slot.id, {
            sourceKey: slot.sourceKey,
            pageIndex: slot.sourcePageIndex,
            slot,
          });
        }
      }
      const flatEdits: Edit[] = [];
      for (const [slotId, runs] of edits) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const [runId, value] of runs) {
          // Cross-page / cross-source target: prefer stable targetSlotId.
          let targetSourceKey: string | undefined;
          let targetPageIndex: number | undefined;
          if (value.targetSlotId !== undefined) {
            const target = slotAddr.get(value.targetSlotId);
            if (target) {
              targetSourceKey = target.sourceKey;
              targetPageIndex = target.pageIndex;
            }
          }
          flatEdits.push({
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
            runId,
            newText: value.text,
            style: value.style,
            dx: value.dx,
            dy: value.dy,
            targetSourceKey,
            targetPageIndex,
            targetPdfX: value.targetPdfX,
            targetPdfY: value.targetPdfY,
            deleted: value.deleted,
          });
        }
      }
      const flatImageMoves: ImageMove[] = [];
      for (const [slotId, imgs] of imageMoves) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const [imageId, value] of imgs) {
          const dx = value.dx ?? 0;
          const dy = value.dy ?? 0;
          const dw = value.dw ?? 0;
          const dh = value.dh ?? 0;
          const isCrossPage = value.targetSlotId !== undefined;
          if (!isCrossPage && !value.deleted && dx === 0 && dy === 0 && dw === 0 && dh === 0)
            continue;
          let targetSourceKey: string | undefined;
          let targetPageIndex: number | undefined;
          if (value.targetSlotId !== undefined) {
            const target = slotAddr.get(value.targetSlotId);
            if (target) {
              targetSourceKey = target.sourceKey;
              targetPageIndex = target.pageIndex;
            }
          }
          flatImageMoves.push({
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
            imageId,
            dx,
            dy,
            dw,
            dh,
            targetSourceKey,
            targetPageIndex,
            targetPdfX: value.targetPdfX,
            targetPdfY: value.targetPdfY,
            targetPdfWidth: value.targetPdfWidth,
            targetPdfHeight: value.targetPdfHeight,
            deleted: value.deleted,
          });
        }
      }
      const flatTextInserts: TextInsert[] = [];
      for (const [slotId, arr] of insertedTexts) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const t of arr) {
          if (!t.text || t.text.trim().length === 0) continue;
          flatTextInserts.push({
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
            pdfX: t.pdfX,
            pdfY: t.pdfY,
            fontSize: t.fontSize,
            text: t.text,
            style: t.style,
          });
        }
      }
      const flatImageInserts: ImageInsert[] = [];
      for (const [slotId, arr] of insertedImages) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const i of arr) {
          flatImageInserts.push({
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
            pdfX: i.pdfX,
            pdfY: i.pdfY,
            pdfWidth: i.pdfWidth,
            pdfHeight: i.pdfHeight,
            bytes: i.bytes,
            format: i.format,
          });
        }
      }
      const flatShapeDeletes: ShapeDelete[] = [];
      for (const [slotId, set] of shapeDeletes) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const shapeId of set) {
          flatShapeDeletes.push({
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
            shapeId,
          });
        }
      }
      const flatAnnotations: Annotation[] = [];
      for (const [slotId, arr] of annotations) {
        const addr = slotAddr.get(slotId);
        if (!addr) continue;
        for (const a of arr) {
          // Re-address each annotation to the slot's current source
          // page so a slot reorder / move rewrites the destination
          // before save (mirrors how text inserts work).
          flatAnnotations.push({
            ...a,
            sourceKey: addr.sourceKey,
            pageIndex: addr.pageIndex,
          });
        }
      }
      const out = await applyEditsAndSave(
        sources,
        slots,
        flatEdits,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        flatShapeDeletes,
        flatAnnotations,
      );
      const baseName = primaryFilename.replace(/\.pdf$/i, "");
      downloadBlob(out, `${baseName}.edited.pdf`);
    } finally {
      setBusy(false);
    }
  }, [
    sources,
    primaryFilename,
    slots,
    edits,
    imageMoves,
    shapeDeletes,
    insertedTexts,
    insertedImages,
    annotations,
  ]);

  const totalEdits = Array.from(edits.values()).reduce((sum, m) => sum + m.size, 0);
  const totalImageMoves = Array.from(imageMoves.values()).reduce((sum, m) => sum + m.size, 0);
  const totalInsertedTexts = Array.from(insertedTexts.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalInsertedImages = Array.from(insertedImages.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalShapeDeletes = Array.from(shapeDeletes.values()).reduce(
    (sum, set) => sum + set.size,
    0,
  );
  const totalAnnotations = Array.from(annotations.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  // Count structural changes vs the initial slots-from-primary state:
  // missing primary pages are deletions; "blank" slots are inserts;
  // page slots from non-primary sources are external inserts.
  const primarySource = sources.get(PRIMARY_SOURCE_KEY);
  const primaryPageCount = primarySource?.pages.length ?? 0;
  const slotPrimaryPageCount = slots.reduce(
    (n, s) => n + (s.kind === "page" && s.sourceKey === PRIMARY_SOURCE_KEY ? 1 : 0),
    0,
  );
  const blankSlotCount = slots.reduce((n, s) => n + (s.kind === "blank" ? 1 : 0), 0);
  const externalSlotCount = slots.reduce(
    (n, s) => n + (s.kind === "page" && s.sourceKey !== PRIMARY_SOURCE_KEY ? 1 : 0),
    0,
  );
  const removedSourceCount = Math.max(0, primaryPageCount - slotPrimaryPageCount);
  const primarySourceOrder: number[] = [];
  for (const s of slots) {
    if (s.kind === "page" && s.sourceKey === PRIMARY_SOURCE_KEY) {
      primarySourceOrder.push(s.sourcePageIndex);
    }
  }
  const slotsReordered = primarySourceOrder.some(
    (si, i) => i > 0 && si < primarySourceOrder[i - 1],
  );
  const structuralOpCount =
    removedSourceCount + blankSlotCount + externalSlotCount + (slotsReordered ? 1 : 0);

  // Compact "save badge" content shared between desktop and mobile —
  // desktop shows the verbose breakdown, mobile shows just the
  // per-category counts as short tokens. Op count is the same source
  // of truth (`structuralOpCount + …`). The boolean below drives the
  // disabled state in both layouts.
  const totalChangeCount =
    totalEdits +
    totalImageMoves +
    structuralOpCount +
    totalInsertedTexts +
    totalInsertedImages +
    totalShapeDeletes +
    totalAnnotations;
  const saveDisabled = sources.size === 0 || busy || totalChangeCount === 0;
  const toolTip =
    tool === "addText"
      ? "Tap a page to drop a text box"
      : tool === "addImage" && pendingImage
        ? "Tap a page to place the image"
        : tool === "highlight"
          ? "Tap a text run to highlight"
          : tool === "comment"
            ? "Tap a page to drop a comment"
            : tool === "ink"
              ? "Drag on a page to draw"
              : null;

  // The hidden file inputs are rendered ONCE outside both header
  // subtrees so the desktop / mobile layouts can target the same
  // input ref via `.click()`. Two render paths sharing one input
  // avoids the "ref attached to whichever subtree mounted last"
  // foot-gun.
  const fileInputs = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        data-testid="open-pdf-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Surface load errors via console.error so E2E `loadFixture`
          // postmortems pick them up (the timeout error includes the
          // captured page log). Without this catch the rejection from
          // handleFile is silently dropped and the test just sees
          // "0 pages after 25s" with no clue why.
          if (f) handleFile(f).catch((err) => console.error("handleFile failed:", err));
          e.target.value = "";
        }}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onPickImageFile(f);
          e.target.value = "";
        }}
      />
    </>
  );

  return (
    <div className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {fileInputs}
      {/* Render exactly one header at a time — keying by `isMobile`
          rather than CSS-only switching prevents duplicate buttons in
          the DOM (which would break `locator('button')` strict-mode
          tests + add hidden focus-cycle stops to keyboard users). */}
      {!isMobile && (
        /* Desktop header — single row, full labels. */
        <header className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="flex items-center gap-2 mr-4 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="About rihaPDF"
          >
            <img src="/riha-logo.png" alt="" className="h-7 w-auto" />
            <h1 className="text-lg font-semibold">
              rihaPDF
              <sup className="ml-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                preview
              </sup>
            </h1>
          </button>
          <Button variant="primary" isDisabled={busy} onPress={() => fileInputRef.current?.click()}>
            <FolderOpen size={16} aria-hidden />
            Open PDF
          </Button>
          <Button
            variant="secondary"
            isDisabled={saveDisabled}
            onPress={() => void onSave()}
            // Keep the visible label fixed-width — the change-count
            // breakdown lives only in aria-label so the button can't
            // grow and shift the toolbar to its right when the user
            // accumulates edits.
            aria-label={`Save (${totalChangeCount} change${totalChangeCount === 1 ? "" : "s"})`}
          >
            <Save size={16} aria-hidden />
            Save
          </Button>
          <Button
            variant="ghost"
            isDisabled={busy || undoStack.length === 0}
            onPress={() => undo()}
            aria-label="Undo"
            data-testid="undo"
          >
            <Undo2 size={16} aria-hidden />
            Undo
          </Button>
          <Button
            variant="ghost"
            isDisabled={busy || redoStack.length === 0}
            onPress={() => redo()}
            aria-label="Redo"
            data-testid="redo"
          >
            <Redo2 size={16} aria-hidden />
            Redo
          </Button>
          <div className="flex items-center gap-1 ml-2 border-l pl-3">
            <Button
              size="sm"
              variant={tool === "select" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                setTool("select");
                setPendingImage(null);
              }}
            >
              <MousePointer2 size={14} aria-hidden />
              Select
            </Button>
            <Button
              size="sm"
              variant={tool === "addText" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                setTool((t) => (t === "addText" ? "select" : "addText"));
                setPendingImage(null);
              }}
            >
              <Type size={14} aria-hidden />+ Text
            </Button>
            <Button
              size="sm"
              variant={tool === "addImage" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                if (tool === "addImage") {
                  setTool("select");
                  setPendingImage(null);
                } else {
                  imageFileInputRef.current?.click();
                }
              }}
            >
              <ImageIcon size={14} aria-hidden />+ Image
              {pendingImage ? <Check size={14} aria-label="image queued" /> : null}
            </Button>
            <Button
              size="sm"
              variant={tool === "highlight" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                setTool((t) => (t === "highlight" ? "select" : "highlight"));
                setPendingImage(null);
              }}
              aria-label="Highlight"
              data-testid="tool-highlight"
            >
              <Highlighter size={14} aria-hidden />
              Highlight
            </Button>
            <Button
              size="sm"
              variant={tool === "comment" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                setTool((t) => (t === "comment" ? "select" : "comment"));
                setPendingImage(null);
              }}
              aria-label="Comment"
              data-testid="tool-comment"
            >
              <MessageSquare size={14} aria-hidden />
              Comment
            </Button>
            <Button
              size="sm"
              variant={tool === "ink" ? "primary" : "ghost"}
              isDisabled={busy || sources.size === 0}
              onPress={() => {
                setTool((t) => (t === "ink" ? "select" : "ink"));
                setPendingImage(null);
              }}
              aria-label="Draw"
              data-testid="tool-ink"
            >
              <Pencil size={14} aria-hidden />
              Draw
            </Button>
          </div>
          <span className="text-sm text-zinc-500 dark:text-zinc-400 ml-auto">
            {toolTip ?? primaryFilename ?? "No file loaded"}
          </span>
          <div className="flex items-center border-l border-zinc-200 dark:border-zinc-800 pl-3 ml-1">
            <ThemeToggle mode={themeMode} onChange={setThemeMode} />
          </div>
        </header>
      )}
      {isMobile && (
        /* Mobile header — two stacked rows, icon-only tool buttons.
            position: fixed so it sits in front of the scrolling page
            list and so `useVisualViewportFollow` (above) can apply a
            visualViewport-driven transform that keeps it at constant
            visual size during pinch-zoom. <main> below receives a
            matching `paddingTop` so first-paint content isn't hidden
            behind the header. */
        <header
          ref={mobileHeaderRef}
          className="fixed inset-x-0 top-0 z-20 flex flex-col gap-2 px-3 py-2 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800"
          style={{ transformOrigin: "0 0" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="flex items-center gap-1.5 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 shrink-0"
              aria-label="About rihaPDF"
              style={{ touchAction: "manipulation" }}
            >
              <img src="/riha-logo.png" alt="" className="h-6 w-auto" />
              <h1 className="text-base font-semibold">
                rihaPDF
                <sup className="ml-0.5 text-[0.55rem] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  preview
                </sup>
              </h1>
            </button>
            {/* Filename slot doubles as the open-file affordance.
                Three render branches:
                  - mid-action: plain hint text (e.g. "Tap a page…").
                  - file loaded: subtle tappable filename with a
                    folder-icon prefix to hint it swaps files.
                  - empty: the primary "Open" Button itself sits in
                    the slot — same styling as the old second-row
                    button so it pulls the eye on first paint.
                The standalone Open button is omitted from the
                second row on mobile in all branches; this slot is
                the only path. */}
            {toolTip ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate min-w-0 flex-1">
                {toolTip}
              </span>
            ) : primaryFilename ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="flex items-center gap-1 min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 cursor-pointer rounded px-1 -mx-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={`Open a different PDF (current file: ${primaryFilename})`}
                style={{ touchAction: "manipulation" }}
                data-testid="mobile-open-target"
              >
                <FolderOpen size={12} aria-hidden className="shrink-0" />
                <span className="truncate">{primaryFilename}</span>
              </button>
            ) : (
              <div className="min-w-0 flex-1">
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={busy}
                  onPress={() => fileInputRef.current?.click()}
                  aria-label="Open PDF"
                  data-testid="mobile-open-target"
                >
                  <FolderOpen size={14} aria-hidden />
                  Open
                </Button>
              </div>
            )}
            {/* Save sits adjacent to the filename so the two
                file-level controls cluster on the first row.
                Rendered only when a file is loaded; in the empty
                state the Open button takes the whole slot. */}
            {primaryFilename && (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={saveDisabled}
                onPress={() => void onSave()}
                aria-label={`Save (${totalChangeCount} change${totalChangeCount === 1 ? "" : "s"})`}
              >
                <Save size={14} aria-hidden />
                Save
              </Button>
            )}
            <div className="shrink-0">
              <ThemeToggle mode={themeMode} onChange={setThemeMode} cycle />
            </div>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={slots.length === 0}
              onPress={() => setMobileSidebarOpen((v) => !v)}
              aria-label={mobileSidebarOpen ? "Close pages sidebar" : "Open pages sidebar"}
              aria-expanded={mobileSidebarOpen}
              data-testid="mobile-sidebar-toggle"
            >
              <PanelLeft size={14} aria-hidden />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy || undoStack.length === 0}
              onPress={() => undo()}
              aria-label="Undo"
              data-testid="undo-mobile"
            >
              <Undo2 size={14} aria-hidden />
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              isDisabled={busy || redoStack.length === 0}
              onPress={() => redo()}
              aria-label="Redo"
              data-testid="redo-mobile"
            >
              <Redo2 size={14} aria-hidden />
            </Button>
            <div className="flex items-center gap-1 ml-1 pl-1 border-l border-zinc-200 dark:border-zinc-800">
              <Button
                isIconOnly
                size="sm"
                variant={tool === "select" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  setTool("select");
                  setPendingImage(null);
                }}
                aria-label="Select tool"
              >
                <MousePointer2 size={14} aria-hidden />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={tool === "addText" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  setTool((t) => (t === "addText" ? "select" : "addText"));
                  setPendingImage(null);
                }}
                aria-label="Add text"
              >
                <Type size={14} aria-hidden />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={tool === "addImage" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  if (tool === "addImage") {
                    setTool("select");
                    setPendingImage(null);
                  } else {
                    imageFileInputRef.current?.click();
                  }
                }}
                aria-label="Add image"
              >
                <ImageIcon size={14} aria-hidden />
                {pendingImage ? <Check size={12} aria-label="image queued" /> : null}
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={tool === "highlight" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  setTool((t) => (t === "highlight" ? "select" : "highlight"));
                  setPendingImage(null);
                }}
                aria-label="Highlight"
              >
                <Highlighter size={14} aria-hidden />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={tool === "comment" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  setTool((t) => (t === "comment" ? "select" : "comment"));
                  setPendingImage(null);
                }}
                aria-label="Comment"
              >
                <MessageSquare size={14} aria-hidden />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant={tool === "ink" ? "primary" : "ghost"}
                isDisabled={busy || sources.size === 0}
                onPress={() => {
                  setTool((t) => (t === "ink" ? "select" : "ink"));
                  setPendingImage(null);
                }}
                aria-label="Draw"
              >
                <Pencil size={14} aria-hidden />
              </Button>
            </div>
          </div>
        </header>
      )}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar is a static left rail on desktop and an overlay
            drawer on mobile. We keep a single PageSidebar instance and
            swap the wrapper styling so the thumbnail cache survives
            open/close on mobile. The drawer sits below the fixed
            mobile header (z-20) so the toggle button stays tappable
            even while the drawer covers the page area. */}
        {slots.length > 0 &&
          (isMobile ? (
            <>
              <div
                onClick={() => setMobileSidebarOpen(false)}
                aria-hidden
                className={`fixed inset-0 z-10 bg-black/40 transition-opacity ${
                  mobileSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                style={{ top: mobileHeaderH }}
              />
              <div
                className={`fixed left-0 bottom-0 z-10 w-[85vw] max-w-sm transition-transform duration-200 ease-out ${
                  mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
                }`}
                style={{ top: mobileHeaderH }}
                role="dialog"
                aria-label="Pages"
                aria-hidden={!mobileSidebarOpen}
              >
                <PageSidebar
                  slots={slots}
                  sources={sources}
                  onSlotsChange={onSlotsChange}
                  onAddExternalPdfs={(files) => void onAddExternalPdfs(files)}
                  widthClass="w-full"
                  onSlotActivate={() => setMobileSidebarOpen(false)}
                />
              </div>
            </>
          ) : (
            <PageSidebar
              slots={slots}
              sources={sources}
              onSlotsChange={onSlotsChange}
              onAddExternalPdfs={(files) => void onAddExternalPdfs(files)}
            />
          ))}
        <main
          className="flex-1 overflow-auto px-2 py-3 sm:px-6 sm:py-6"
          // Mobile header is `position: fixed` (out of flow), so push
          // page content down by its measured height. `mobileHeaderH`
          // is 0 on desktop, where the header is back in the flex flow.
          style={isMobile ? { paddingTop: mobileHeaderH + 12 } : undefined}
          onPointerDown={(e) => {
            // Tap on empty `<main>` (no overlay child consumed the
            // event) cancels a pending image placement so the user
            // can back out without picking a target page.
            if (e.target === e.currentTarget && tool === "addImage" && pendingImage) {
              setTool("select");
              setPendingImage(null);
            }
          }}
        >
          {slots.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-500">
              Open a PDF to begin. Double-click any text fragment to edit it.
            </div>
          ) : (
            // `w-full` so the flex column has a defined width to
            // constrain `max-width: 100%` on each PdfPage's outer
            // wrapper. Without it, the column auto-sizes to its
            // widest child (= the natural page width on first
            // render), breaking fit-to-width on mobile.
            <div className="flex flex-col items-center gap-6 w-full">
              {slots.map((slot, idx) => {
                if (slot.kind === "blank") {
                  return (
                    <div
                      key={slot.id}
                      id={`page-slot-${slot.id}`}
                      className="bg-white dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded shadow-sm flex items-center justify-center text-zinc-300 dark:text-zinc-500 text-sm scroll-mt-6"
                      style={{
                        width: slot.size[0] * RENDER_SCALE,
                        height: slot.size[1] * RENDER_SCALE,
                      }}
                    >
                      (blank)
                    </div>
                  );
                }
                const source = sources.get(slot.sourceKey);
                const page = source?.pages[slot.sourcePageIndex];
                if (!source || !page) return null;
                // Re-derive cross-page targetPageIndex from the stable
                // targetSlotId so reorder doesn't strand overlays.
                const slotIndexById = (id: string | undefined) => {
                  if (!id) return -1;
                  return slots.findIndex((s) => s.id === id);
                };
                const editsForSlot = new Map<string, EditValue>();
                const storedEdits = edits.get(slot.id);
                if (storedEdits) {
                  for (const [runId, v] of storedEdits) {
                    if (v.targetSlotId) {
                      const i = slotIndexById(v.targetSlotId);
                      if (i >= 0) {
                        editsForSlot.set(runId, {
                          ...v,
                          targetPageIndex: i,
                          targetSlotId: undefined,
                        });
                      } else {
                        editsForSlot.set(runId, {
                          ...v,
                          targetPageIndex: undefined,
                          targetSourceKey: undefined,
                          targetSlotId: undefined,
                          targetPdfX: undefined,
                          targetPdfY: undefined,
                        });
                      }
                    } else {
                      editsForSlot.set(runId, v);
                    }
                  }
                }
                const imageMovesForSlot = new Map<string, ImageMoveValue>();
                const storedMoves = imageMoves.get(slot.id);
                if (storedMoves) {
                  for (const [imageId, v] of storedMoves) {
                    if (v.targetSlotId) {
                      const i = slotIndexById(v.targetSlotId);
                      if (i >= 0) {
                        imageMovesForSlot.set(imageId, {
                          ...v,
                          targetPageIndex: i,
                          targetSlotId: undefined,
                        });
                      } else {
                        imageMovesForSlot.set(imageId, {
                          ...v,
                          targetPageIndex: undefined,
                          targetSourceKey: undefined,
                          targetSlotId: undefined,
                          targetPdfX: undefined,
                          targetPdfY: undefined,
                          targetPdfWidth: undefined,
                          targetPdfHeight: undefined,
                        });
                      }
                    } else {
                      imageMovesForSlot.set(imageId, v);
                    }
                  }
                }
                const selectedImageId =
                  selection?.kind === "image" && selection.slotId === slot.id
                    ? selection.imageId
                    : null;
                const selectedInsertedImageId =
                  selection?.kind === "insertedImage" && selection.slotId === slot.id
                    ? selection.id
                    : null;
                const selectedShapeId =
                  selection?.kind === "shape" && selection.slotId === slot.id
                    ? selection.shapeId
                    : null;
                const deletedShapeIds = shapeDeletes.get(slot.id) ?? new Set<string>();
                return (
                  <PageWithToolbar
                    key={slot.id}
                    slotId={slot.id}
                    page={page}
                    pageIndex={idx}
                    sourceKey={slot.sourceKey}
                    edits={editsForSlot}
                    imageMoves={imageMovesForSlot}
                    insertedTexts={insertedTexts.get(slot.id) ?? []}
                    insertedImages={insertedImages.get(slot.id) ?? []}
                    annotations={annotations.get(slot.id) ?? []}
                    previewCanvas={
                      previewCanvases.get(`${slot.sourceKey}:${slot.sourcePageIndex}`) ?? null
                    }
                    tool={tool}
                    editingId={editingByPage.get(slot.id) ?? null}
                    selectedImageId={selectedImageId}
                    selectedInsertedImageId={selectedInsertedImageId}
                    selectedShapeId={selectedShapeId}
                    deletedShapeIds={deletedShapeIds}
                    onEdit={(runId, value) => onEdit(slot.id, runId, value)}
                    onImageMove={(imageId, value) => onImageMove(slot.id, imageId, value)}
                    onEditingChange={(runId) => onEditingChange(slot.id, runId)}
                    onCanvasClick={(pdfX, pdfY) => onCanvasClick(slot.id, idx, pdfX, pdfY)}
                    onTextInsertChange={(id, patch) => onTextInsertChange(slot.id, id, patch)}
                    onTextInsertDelete={(id) => onTextInsertDelete(slot.id, id)}
                    onImageInsertChange={(id, patch) => onImageInsertChange(slot.id, id, patch)}
                    onImageInsertDelete={(id) => onImageInsertDelete(slot.id, id)}
                    onSelectImage={(imageId) => onSelectImage(slot.id, imageId)}
                    onSelectInsertedImage={(id) => onSelectInsertedImage(slot.id, id)}
                    onSelectShape={(shapeId) => onSelectShape(slot.id, shapeId)}
                    onAnnotationAdd={(a) => onAnnotationAdd(slot.id, a)}
                    onAnnotationChange={(id, patch) => onAnnotationChange(slot.id, id, patch)}
                    onAnnotationDelete={(id) => onAnnotationDelete(slot.id, id)}
                  />
                );
              })}
            </div>
          )}
        </main>
      </div>
      <AboutModal isOpen={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}

function AboutModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>rihaPDF</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-5 text-sm text-zinc-800 dark:text-zinc-200">
              <section className="flex flex-col items-center text-center gap-3">
                <img src="/riha-logo.png" alt="" className="h-28 w-auto" />
                <p>
                  Browser-based PDF editor focused on Dhivehi / Thaana documents. Click any text run
                  on a page, type a replacement, save. The saved PDF contains real, selectable,
                  searchable text — original glyphs are surgically removed and replaced with new
                  ones rendered in the correct font. rihaPDF is{" "}
                  <a
                    href="https://github.com/yashau/rihaPDF"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    open source
                  </a>{" "}
                  and contributions are welcome.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Features</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>Edit existing text runs in place</li>
                  <li>Insert new text and images anywhere on a page</li>
                  <li>Move and resize inserted images; move text and image runs</li>
                  <li>Saved PDFs keep real, selectable, searchable text</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Built with</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>React 19 + TypeScript + Vite</li>
                  <li>Tailwind CSS + HeroUI + lucide-react</li>
                  <li>pdf-lib (write) and pdfjs-dist (render)</li>
                  <li>Runs entirely in the browser — no server, no upload</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Author</h3>
                <p className="text-zinc-700 dark:text-zinc-300">Ibrahim Yashau</p>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    <a
                      href="https://yashau.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      yashau.com
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:ibrahim@yashau.com"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      ibrahim@yashau.com
                    </a>
                  </li>
                </ul>
              </section>

              <BrowserSupportSection />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

type BrowserId = "ios-safari" | "safari" | "firefox" | "chromium";

function detectBrowser(ua: string): BrowserId {
  // iOS forces every browser onto WebKit, so iPhone/iPad UAs are
  // grouped as ios-safari regardless of brand.
  if (/iPhone|iPad|iPod/.test(ua)) return "ios-safari";
  if (/Firefox\//.test(ua)) return "firefox";
  // Desktop Safari has "Safari/" but not "Chrome/" or "Chromium/".
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua)) return "safari";
  return "chromium";
}

const BROWSER_LABEL: Record<BrowserId, string> = {
  "ios-safari": "iOS Safari",
  safari: "Safari",
  firefox: "Firefox",
  chromium: "Chrome",
};

function BrowserSupportSection() {
  const [shown, setShown] = useState(false);
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const browser = detectBrowser(ua);
  const label = BROWSER_LABEL[browser];
  // Min version per check for the detected browser. Sources: MDN compat
  // tables. Each tuple is [iosSafari, safari, firefox, chromium].
  const minVersion = (per: Record<BrowserId, string>) => `${label} ${per[browser]}+`;

  const checks: { label: string; status: "ok" | "missing" | "polyfilled" }[] = [
    {
      label: `ReadableStream async iterator (${minVersion({ "ios-safari": "—", safari: "—", firefox: "131", chromium: "124" })})`,
      status: READABLE_STREAM_ASYNC_ITER_POLYFILLED ? "polyfilled" : "ok",
    },
    {
      label: `Promise.withResolvers (${minVersion({ "ios-safari": "17.4", safari: "17.4", firefox: "121", chromium: "119" })})`,
      status:
        typeof (Promise as { withResolvers?: unknown }).withResolvers === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Set.prototype.intersection (${minVersion({ "ios-safari": "17", safari: "17", firefox: "127", chromium: "122" })})`,
      status:
        typeof (Set.prototype as { intersection?: unknown }).intersection === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Iterator.prototype.toArray (${minVersion({ "ios-safari": "18.4", safari: "18.4", firefox: "131", chromium: "122" })})`,
      status:
        typeof (globalThis as { Iterator?: { prototype?: { toArray?: unknown } } }).Iterator
          ?.prototype?.toArray === "function"
          ? "ok"
          : "missing",
    },
    {
      label: `Array.prototype.findLast (${minVersion({ "ios-safari": "15.4", safari: "15.4", firefox: "104", chromium: "97" })})`,
      status: typeof Array.prototype.findLast === "function" ? "ok" : "missing",
    },
    {
      label: `Object.groupBy (${minVersion({ "ios-safari": "17.4", safari: "17.4", firefox: "119", chromium: "117" })})`,
      status: typeof (Object as { groupBy?: unknown }).groupBy === "function" ? "ok" : "missing",
    },
    {
      label: `OffscreenCanvas (${minVersion({ "ios-safari": "16.4", safari: "16.4", firefox: "105", chromium: "69" })})`,
      status: typeof globalThis.OffscreenCanvas === "function" ? "ok" : "missing",
    },
    {
      label: `structuredClone (${minVersion({ "ios-safari": "15.4", safari: "15.4", firefox: "94", chromium: "98" })})`,
      status: typeof globalThis.structuredClone === "function" ? "ok" : "missing",
    },
  ];
  return (
    <section>
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline underline-offset-2"
      >
        {shown ? "Hide browser diagnostics" : "Show browser diagnostics"}
      </button>
      {shown && (
        <div className="mt-2">
          <ul className="space-y-0.5 text-zinc-700 dark:text-zinc-300 font-mono text-xs">
            {checks.map((c) => {
              const color =
                c.status === "ok"
                  ? "text-green-600 dark:text-green-400"
                  : c.status === "polyfilled"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400";
              return (
                <li key={c.label}>
                  <span className={color}>[{c.status}]</span> {c.label}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400 break-all">UA: {ua}</p>
        </div>
      )}
    </section>
  );
}

function PageWithToolbar({
  slotId,
  page,
  pageIndex,
  sourceKey,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  annotations,
  previewCanvas,
  tool,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  selectedShapeId,
  deletedShapeIds,
  onEdit,
  onImageMove,
  onEditingChange,
  onCanvasClick,
  onTextInsertChange,
  onTextInsertDelete,
  onImageInsertChange,
  onImageInsertDelete,
  onSelectImage,
  onSelectInsertedImage,
  onSelectShape,
  onAnnotationAdd,
  onAnnotationChange,
  onAnnotationDelete,
}: {
  slotId: string;
  page: RenderedPage;
  pageIndex: number;
  sourceKey: string;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  annotations: Annotation[];
  previewCanvas: HTMLCanvasElement | null;
  tool: ToolMode;
  editingId: string | null;
  selectedImageId: string | null;
  selectedInsertedImageId: string | null;
  selectedShapeId: string | null;
  deletedShapeIds: Set<string>;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
  onSelectShape: (shapeId: string) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationChange: (id: string, patch: Partial<Annotation>) => void;
  onAnnotationDelete: (id: string) => void;
}) {
  return (
    <div id={`page-slot-${slotId}`} className="flex flex-col items-center gap-2 scroll-mt-6 w-full">
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Page {pageIndex + 1}</span>
      </div>
      <PdfPage
        page={page}
        pageIndex={pageIndex}
        sourceKey={sourceKey}
        edits={edits}
        imageMoves={imageMoves}
        insertedTexts={insertedTexts}
        insertedImages={insertedImages}
        annotations={annotations}
        previewCanvas={previewCanvas}
        tool={tool}
        editingId={editingId}
        selectedImageId={selectedImageId}
        selectedInsertedImageId={selectedInsertedImageId}
        selectedShapeId={selectedShapeId}
        deletedShapeIds={deletedShapeIds}
        onEdit={onEdit}
        onImageMove={onImageMove}
        onEditingChange={onEditingChange}
        onCanvasClick={onCanvasClick}
        onTextInsertChange={onTextInsertChange}
        onTextInsertDelete={onTextInsertDelete}
        onImageInsertChange={onImageInsertChange}
        onImageInsertDelete={onImageInsertDelete}
        onSelectImage={onSelectImage}
        onSelectInsertedImage={onSelectInsertedImage}
        onSelectShape={onSelectShape}
        onAnnotationAdd={onAnnotationAdd}
        onAnnotationChange={onAnnotationChange}
        onAnnotationDelete={onAnnotationDelete}
      />
    </div>
  );
}
