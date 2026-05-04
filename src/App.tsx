import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEditsAndSave, downloadBlob } from "./lib/save";
import { buildSavePayload } from "./lib/buildSavePayload";
import { usePreviewCanvases } from "./lib/usePreviewCanvases";
import { useSelection } from "./lib/useSelection";
import { useUndoRedo } from "./lib/useUndoRedo";
import { readImageFile, type ImageInsertion, type TextInsertion } from "./lib/insertions";
import {
  type Annotation,
  COMMENT_DEFAULT_FONT_SIZE,
  COMMENT_DEFAULT_HEIGHT,
  COMMENT_DEFAULT_WIDTH,
  DEFAULT_COMMENT_COLOR,
  newAnnotationId,
} from "./lib/annotations";
import type { Redaction } from "./lib/redactions";
import type { EditValue, ImageMoveValue } from "./components/PdfPage";
import { PageSidebar } from "./components/PageSidebar";
import { pageSlot, slotsFromSource, type PageSlot } from "./lib/slots";
import { blankSourceKey } from "./lib/blankSource";
import { loadSource, nextExternalSourceKey, PRIMARY_SOURCE_KEY } from "./lib/loadSource";
import type { LoadedSource } from "./lib/loadSource";
import { useTheme } from "./lib/theme";
import { useIsMobile } from "./lib/useMediaQuery";
import { useMobileChrome } from "./lib/useMobileChrome";
import { AboutModal } from "./components/AboutModal";
import { AppHeader, AppFileInputs } from "./components/AppHeader";
import { PageList } from "./components/PageList";

export type ToolMode =
  | "select"
  | "addText"
  | "addImage"
  | "highlight"
  | "redact"
  | "comment"
  | "ink";

const RENDER_SCALE = 1.5;

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
  redactions: Map<string, Redaction[]>;
  slots: PageSlot[];
  sources: Map<string, LoadedSource>;
};

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const isMobile = useIsMobile();
  const [primaryFilename, setPrimaryFilename] = useState<string | null>(null);
  const { mobileHeaderRef, mobileHeaderH, mobileSidebarOpen, setMobileSidebarOpen } =
    useMobileChrome(isMobile);
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
  /** Map<slotId, Set<shapeId>> — vector shapes flagged for deletion.
   *  Shapes are delete-only in v1 (no move / resize) so a Set is enough. */
  const [shapeDeletes, setShapeDeletes] = useState<Map<string, Set<string>>>(new Map());
  /** Map<slotId, Annotation[]> — user-added highlights / sticky notes /
   *  ink strokes. Keyed by slotId so an annotation follows its page
   *  through reorder, same as the insertion / edit maps. */
  const [annotations, setAnnotations] = useState<Map<string, Annotation[]>>(new Map());
  /** Map<slotId, Redaction[]> — opaque-black redaction rectangles.
   *  Kept separate from `annotations` because at save time these
   *  paint into the page content stream + strip overlapping glyphs,
   *  rather than appending /Annot dicts (which leave underlying
   *  text selectable / extractable). */
  const [redactions, setRedactions] = useState<Map<string, Redaction[]>>(new Map());
  /** When the user picks an image file, we hold its bytes here until
   *  they click on a page to place it. Cleared on placement / cancel. */
  const [pendingImage, setPendingImage] = useState<{
    bytes: Uint8Array;
    format: "png" | "jpeg";
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  // Mirror refs so `captureSnapshot` can read current state without
  // taking every state slice as a useCallback dep (which would
  // re-create every callback on every keystroke). slotsRef already
  // exists above; the rest are added here.
  const editsRef = useRef(edits);
  const imageMovesRef = useRef(imageMoves);
  const insertedTextsRef = useRef(insertedTexts);
  const insertedImagesRef = useRef(insertedImages);
  const shapeDeletesRef = useRef(shapeDeletes);
  const annotationsRef = useRef(annotations);
  const redactionsRef = useRef(redactions);
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
    redactionsRef.current = redactions;
  }, [redactions]);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const captureSnapshot = useCallback(
    (): UndoSnapshot => ({
      edits: editsRef.current,
      imageMoves: imageMovesRef.current,
      insertedTexts: insertedTextsRef.current,
      insertedImages: insertedImagesRef.current,
      shapeDeletes: shapeDeletesRef.current,
      annotations: annotationsRef.current,
      redactions: redactionsRef.current,
      slots: slotsRef.current,
      sources: sourcesRef.current,
    }),
    [],
  );

  // Forward declaration of `setSelection` via ref so `restoreSnapshot`
  // (passed into `useUndoRedo`) can clear selection on undo/redo
  // without taking a hard dep on the (later-declared) `useSelection`
  // return value. The ref is bound right after `useSelection` runs.
  const setSelectionRef = useRef<(s: null) => void>(() => {});
  const restoreSnapshot = useCallback((s: UndoSnapshot) => {
    setEdits(s.edits);
    setImageMoves(s.imageMoves);
    setInsertedTexts(s.insertedTexts);
    setInsertedImages(s.insertedImages);
    setShapeDeletes(s.shapeDeletes);
    setAnnotations(s.annotations);
    setRedactions(s.redactions);
    setSlots(s.slots);
    setSources(s.sources);
    setSelectionRef.current(null);
  }, []);

  const { recordHistory, undo, redo, clearHistory, canUndo, canRedo } = useUndoRedo({
    captureSnapshot,
    restoreSnapshot,
  });

  const {
    selection,
    setSelection,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onSelectRedaction,
  } = useSelection({
    recordHistory,
    setImageMoves,
    setInsertedImages,
    setShapeDeletes,
    setRedactions,
  });
  useEffect(() => {
    setSelectionRef.current = setSelection;
  }, [setSelection]);

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
        setRedactions(new Map());
        // previewCanvases auto-clears via usePreviewCanvases when the
        // inputs reset to empty, so no explicit reset needed here.
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
      // Coalesce key: same (slot, run) within the undo coalesce window
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
  // flatten phase + the preview strip hook.
  const slotById = useMemo(() => new Map<string, PageSlot>(slots.map((s) => [s.id, s])), [slots]);

  const { previewCanvases } = usePreviewCanvases({
    sources,
    slotById,
    edits,
    imageMoves,
    shapeDeletes,
    editingByPage,
    isMobile,
    renderScale: RENDER_SCALE,
  });

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
      // Blank slots get a synthetic per-slot sourceKey so the save
      // pipeline can materialise a one-page PDFDocument for them and
      // run the same insert / draw / annotation passes.
      const slot = slotsRef.current[pageIndex];
      if (!slot) return;
      const slotSourceKey = slot.kind === "page" ? slot.sourceKey : blankSourceKey(slot.id);
      const slotPageIndex = slot.kind === "page" ? slot.sourcePageIndex : 0;
      if (tool === "addText") {
        // Click-to-place is a discrete action — no coalesce.
        recordHistory(null);
        const id = `p${pageIndex + 1}-t${Date.now().toString(36)}`;
        const ins: TextInsertion = {
          id,
          sourceKey: slotSourceKey,
          pageIndex: slotPageIndex,
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
          sourceKey: slotSourceKey,
          pageIndex: slotPageIndex,
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
              sourceKey: slotSourceKey,
              pageIndex: slotPageIndex,
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
        // destination's CURRENT slot index — NOT a source-page index.
        // Resolve to that slot's id and (sourceKey, sourcePageIndex):
        // - slot id is the stable bucket key, so reorder doesn't strand
        //   the insertion;
        // - sourceKey + sourcePageIndex are the persisted address used
        //   at save time. Comparing against `item.pageIndex` would mix
        //   slot-index and source-page-index spaces and silently drop
        //   moves whenever the two happened to match numerically.
        let updated: TextInsertion;
        let targetSlotId = sourceSlotId;
        if (patch.pageIndex !== undefined && patch.sourceKey !== undefined) {
          const destSlot = slotsRef.current[patch.pageIndex];
          if (destSlot && destSlot.kind === "page" && destSlot.id !== sourceSlotId) {
            updated = {
              ...item,
              ...patch,
              sourceKey: destSlot.sourceKey,
              pageIndex: destSlot.sourcePageIndex,
            };
            targetSlotId = destSlot.id;
          } else {
            // Same slot (or unresolvable) — keep the item's existing
            // source address; only the pdfX/pdfY portion of the patch
            // is meaningful here.
            updated = {
              ...item,
              ...patch,
              sourceKey: item.sourceKey,
              pageIndex: item.pageIndex,
            };
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
        // See onTextInsertChange for the rationale — patch.pageIndex
        // is a SLOT index from PdfPage, not a source-page index, so we
        // resolve the destination slot and compare slot ids.
        let updated: ImageInsertion;
        let targetSlotId = sourceSlotId;
        if (patch.pageIndex !== undefined && patch.sourceKey !== undefined) {
          const destSlot = slotsRef.current[patch.pageIndex];
          if (destSlot && destSlot.kind === "page" && destSlot.id !== sourceSlotId) {
            updated = {
              ...item,
              ...patch,
              sourceKey: destSlot.sourceKey,
              pageIndex: destSlot.sourcePageIndex,
            };
            targetSlotId = destSlot.id;
          } else {
            updated = {
              ...item,
              ...patch,
              sourceKey: item.sourceKey,
              pageIndex: item.pageIndex,
            };
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
    (sourceSlotId: string, id: string, patch: Partial<Annotation>) => {
      recordHistory(`annotation:${sourceSlotId}:${id}`);
      setAnnotations((prev) => {
        const next = new Map(prev);
        const fromArr = next.get(sourceSlotId) ?? [];
        const item = fromArr.find((a) => a.id === id);
        if (!item) return prev;
        // Cross-page move: when the patch carries a `pageIndex` (slot
        // index) + `sourceKey` that resolve to a DIFFERENT slot than
        // the one the annotation currently lives in, move it across
        // buckets and rewrite its source-page address to the
        // destination slot's. Mirrors the inserted text / image
        // cross-page path so dragging a comment across pages lands it
        // on the new page rather than at off-page PDF coords. Same-
        // slot patches (text edits, color tweaks, tiny re-positions)
        // fall through to the in-place branch below.
        let targetSlotId = sourceSlotId;
        let updated: Annotation = { ...item, ...patch } as Annotation;
        if (patch.pageIndex !== undefined && patch.sourceKey !== undefined) {
          const destSlot = slotsRef.current[patch.pageIndex];
          if (destSlot && destSlot.kind === "page" && destSlot.id !== sourceSlotId) {
            updated = {
              ...item,
              ...patch,
              sourceKey: destSlot.sourceKey,
              pageIndex: destSlot.sourcePageIndex,
            } as Annotation;
            targetSlotId = destSlot.id;
          } else {
            updated = {
              ...item,
              ...patch,
              sourceKey: item.sourceKey,
              pageIndex: item.pageIndex,
            } as Annotation;
          }
        }
        if (targetSlotId !== sourceSlotId) {
          next.set(
            sourceSlotId,
            fromArr.filter((a) => a.id !== id),
          );
          next.set(targetSlotId, [...(next.get(targetSlotId) ?? []), updated]);
        } else {
          next.set(
            sourceSlotId,
            fromArr.map((a) => (a.id === id ? updated : a)),
          );
        }
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

  const onRedactionAdd = useCallback(
    (slotId: string, redaction: Redaction) => {
      // Discrete user action — one snapshot per add.
      recordHistory(null);
      setRedactions((prev) => {
        const next = new Map(prev);
        const arr = [...(next.get(slotId) ?? []), redaction];
        next.set(slotId, arr);
        return next;
      });
    },
    [recordHistory],
  );
  /** Patch a redaction by id (used by drag/resize on RedactionOverlay).
   *  Coalesces same-(slot, id) updates inside the undo window so a
   *  drag or resize is one undo step. */
  const onRedactionChange = useCallback(
    (slotId: string, id: string, patch: Partial<Redaction>) => {
      recordHistory(`redaction:${slotId}:${id}`);
      setRedactions((prev) => {
        const next = new Map(prev);
        const arr = next.get(slotId) ?? [];
        next.set(
          slotId,
          arr.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        );
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
      const {
        flatEdits,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        flatShapeDeletes,
        flatAnnotations,
        flatRedactions,
      } = buildSavePayload({
        slots,
        edits,
        imageMoves,
        insertedTexts,
        insertedImages,
        shapeDeletes,
        annotations,
        redactions,
      });
      const out = await applyEditsAndSave(
        sources,
        slots,
        flatEdits,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        flatShapeDeletes,
        flatAnnotations,
        flatRedactions,
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
    redactions,
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
  const totalRedactions = Array.from(redactions.values()).reduce(
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
    totalAnnotations +
    totalRedactions;
  const saveDisabled = sources.size === 0 || busy || totalChangeCount === 0;
  const toolTip =
    tool === "addText"
      ? "Tap a page to drop a text box"
      : tool === "addImage" && pendingImage
        ? "Tap a page to place the image"
        : tool === "highlight"
          ? "Tap a text run to highlight"
          : tool === "redact"
            ? "Tap a text run to redact (drag corners to resize)"
            : tool === "comment"
              ? "Tap a page to drop a comment"
              : tool === "ink"
                ? "Drag on a page to draw"
                : null;

  return (
    <div className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* The hidden file inputs are rendered ONCE outside both header
          subtrees so the desktop / mobile layouts can target the same
          input ref via `.click()`. Two render paths sharing one input
          avoids the "ref attached to whichever subtree mounted last"
          foot-gun. */}
      <AppFileInputs
        fileInputRef={fileInputRef}
        imageFileInputRef={imageFileInputRef}
        // Surface load errors via console.error so E2E `loadFixture`
        // postmortems pick them up (the timeout error includes the
        // captured page log). Without this catch the rejection from
        // handleFile is silently dropped and the test just sees
        // "0 pages after 25s" with no clue why.
        onPickPdf={(f) => {
          handleFile(f).catch((err) => console.error("handleFile failed:", err));
        }}
        onPickImage={(f) => {
          void onPickImageFile(f);
        }}
      />
      {/* Render exactly one header at a time — keying by `isMobile`
          rather than CSS-only switching prevents duplicate buttons in
          the DOM (which would break `locator('button')` strict-mode
          tests + add hidden focus-cycle stops to keyboard users). */}
      <AppHeader
        isMobile={isMobile}
        tool={tool}
        setTool={setTool}
        pendingImage={pendingImage}
        setPendingImage={setPendingImage}
        primaryFilename={primaryFilename}
        busy={busy}
        saveDisabled={saveDisabled}
        totalChangeCount={totalChangeCount}
        canUndo={canUndo}
        canRedo={canRedo}
        onOpen={() => fileInputRef.current?.click()}
        onSave={() => void onSave()}
        onUndo={undo}
        onRedo={redo}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        imageFileInputRef={imageFileInputRef}
        onAboutOpen={() => setAboutOpen(true)}
        hasSources={sources.size > 0}
        toolTip={toolTip}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
        mobileHeaderRef={mobileHeaderRef}
        slotsLength={slots.length}
      />
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
            <PageList
              slots={slots}
              sources={sources}
              edits={edits}
              imageMoves={imageMoves}
              insertedTexts={insertedTexts}
              insertedImages={insertedImages}
              annotations={annotations}
              redactions={redactions}
              shapeDeletes={shapeDeletes}
              previewCanvases={previewCanvases}
              editingByPage={editingByPage}
              tool={tool}
              selection={selection}
              renderScale={RENDER_SCALE}
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
              onRedactionAdd={onRedactionAdd}
              onRedactionChange={onRedactionChange}
              onSelectRedaction={onSelectRedaction}
            />
          )}
        </main>
      </div>
      <AboutModal isOpen={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
