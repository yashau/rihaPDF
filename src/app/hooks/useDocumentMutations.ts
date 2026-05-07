import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  type Annotation,
  type AnnotationColor,
  COMMENT_DEFAULT_FONT_SIZE,
  COMMENT_DEFAULT_HEIGHT,
  COMMENT_DEFAULT_WIDTH,
  newAnnotationId,
} from "@/domain/annotations";
import { blankSourceKey } from "@/domain/blankSource";
import type { FormValue } from "@/domain/formFields";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import {
  REDACTION_DEFAULT_HEIGHT,
  REDACTION_DEFAULT_WIDTH,
  newRedactionId,
  type Redaction,
} from "@/domain/redactions";
import type { PageSlot } from "@/domain/slots";
import type { PendingImage, ToolMode } from "@/domain/toolMode";
import type { Selection } from "@/domain/selection";
import type { EditValue, ImageMoveValue } from "@/domain/editState";

type SlotBucketItem = {
  id: string;
  sourceKey: string;
  pageIndex: number;
};

function resolveSlotBucketPatch<T extends SlotBucketItem>(
  item: T,
  sourceSlotId: string,
  patch: Partial<T>,
  slots: readonly PageSlot[],
): { targetSlotId: string; updated: T } {
  let targetSlotId = sourceSlotId;
  if (patch.pageIndex !== undefined && patch.sourceKey !== undefined) {
    const destSlot = slots[patch.pageIndex];
    if (destSlot && destSlot.kind === "page" && destSlot.id !== sourceSlotId) {
      targetSlotId = destSlot.id;
      return {
        targetSlotId,
        updated: {
          ...item,
          ...patch,
          sourceKey: destSlot.sourceKey,
          pageIndex: destSlot.sourcePageIndex,
        },
      };
    }
    return {
      targetSlotId,
      updated: { ...item, ...patch, sourceKey: item.sourceKey, pageIndex: item.pageIndex },
    };
  }
  return { targetSlotId, updated: { ...item, ...patch } };
}

function updateSlotBucket<T extends SlotBucketItem>(
  prev: Map<string, T[]>,
  sourceSlotId: string,
  id: string,
  slots: readonly PageSlot[],
  patch: Partial<T>,
): { next: Map<string, T[]>; targetSlotId: string; found: boolean } {
  const next = new Map(prev);
  const fromArr = next.get(sourceSlotId) ?? [];
  const item = fromArr.find((t) => t.id === id);
  if (!item) return { next: prev, targetSlotId: sourceSlotId, found: false };
  const { targetSlotId, updated } = resolveSlotBucketPatch(item, sourceSlotId, patch, slots);
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
  return { next, targetSlotId, found: true };
}

export function useDocumentMutations({
  slotsRef,
  tool,
  pendingImage,
  commentColor,
  recordHistory,
  setTool,
  setPendingImage,
  setEditingByPage,
  setEdits,
  setImageMoves,
  setInsertedTexts,
  setInsertedImages,
  setAnnotations,
  setRedactions,
  setFormValues,
  setSlots,
  setSelection,
}: {
  slotsRef: RefObject<PageSlot[]>;
  tool: ToolMode;
  pendingImage: PendingImage | null;
  commentColor: AnnotationColor;
  recordHistory: (coalesceKey: string | null) => void;
  setTool: Dispatch<SetStateAction<ToolMode>>;
  setPendingImage: Dispatch<SetStateAction<PendingImage | null>>;
  setEditingByPage: Dispatch<SetStateAction<Map<string, string>>>;
  setEdits: Dispatch<SetStateAction<Map<string, Map<string, EditValue>>>>;
  setImageMoves: Dispatch<SetStateAction<Map<string, Map<string, ImageMoveValue>>>>;
  setInsertedTexts: Dispatch<SetStateAction<Map<string, TextInsertion[]>>>;
  setInsertedImages: Dispatch<SetStateAction<Map<string, ImageInsertion[]>>>;
  setAnnotations: Dispatch<SetStateAction<Map<string, Annotation[]>>>;
  setRedactions: Dispatch<SetStateAction<Map<string, Redaction[]>>>;
  setFormValues: Dispatch<SetStateAction<Map<string, Map<string, FormValue>>>>;
  setSlots: Dispatch<SetStateAction<PageSlot[]>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
}) {
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
    [recordHistory, setEdits, slotsRef],
  );

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
    [recordHistory, setImageMoves, slotsRef],
  );

  const onEditingChange = useCallback(
    (slotId: string, runId: string | null) => {
      setEditingByPage((prev) => {
        const next = new Map(prev);
        if (runId) next.set(slotId, runId);
        else next.delete(slotId);
        return next;
      });
    },
    [setEditingByPage],
  );

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
        setSelection({ kind: "insertedImage", slotId, id });
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
              color: commentColor,
              text: "",
              fontSize: COMMENT_DEFAULT_FONT_SIZE,
            } satisfies Annotation,
          ];
          next.set(slotId, arr);
          return next;
        });
        setTool("select");
        return;
      }
      if (tool === "redact") {
        const id = newRedactionId();
        recordHistory(null);
        setRedactions((prev) => {
          const next = new Map(prev);
          const arr = [
            ...(next.get(slotId) ?? []),
            {
              id,
              sourceKey: slotSourceKey,
              pageIndex: slotPageIndex,
              pdfX,
              pdfY: pdfY - REDACTION_DEFAULT_HEIGHT,
              pdfWidth: REDACTION_DEFAULT_WIDTH,
              pdfHeight: REDACTION_DEFAULT_HEIGHT,
            } satisfies Redaction,
          ];
          next.set(slotId, arr);
          return next;
        });
        setSelection({ kind: "redaction", slotId, id });
        setTool("select");
      }
    },
    [
      commentColor,
      pendingImage,
      recordHistory,
      setAnnotations,
      setEditingByPage,
      setInsertedImages,
      setInsertedTexts,
      setPendingImage,
      setRedactions,
      setSelection,
      setTool,
      slotsRef,
      tool,
    ],
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
        const { next } = updateSlotBucket(prev, sourceSlotId, id, slotsRef.current, patch);
        return next;
      });
    },
    [recordHistory, setInsertedTexts, slotsRef],
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
    [recordHistory, setInsertedTexts],
  );

  const onImageInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<ImageInsertion>) => {
      // Same-(slot,id) coalesces — drag/resize of an inserted
      // image is one undo step.
      recordHistory(`image-insert:${sourceSlotId}:${id}`);
      setInsertedImages((prev) => {
        const { next } = updateSlotBucket(prev, sourceSlotId, id, slotsRef.current, patch);
        return next;
      });
    },
    [recordHistory, setInsertedImages, slotsRef],
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
    [recordHistory, setInsertedImages],
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
    [recordHistory, setAnnotations],
  );

  /** Patch an existing annotation by id (used by the note-comment
   *  editor and color picker). Coalesces same-(slot,id) updates within
   *  the undo window so typing into a comment is one undo step. */
  const onAnnotationChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<Annotation>) => {
      recordHistory(`annotation:${sourceSlotId}:${id}`);
      const patchedDestSlot =
        patch.pageIndex !== undefined && patch.sourceKey !== undefined
          ? slotsRef.current[patch.pageIndex]
          : undefined;
      if (patchedDestSlot?.kind === "page" && patchedDestSlot.id !== sourceSlotId) {
        setSelection((prev) =>
          prev?.kind === "ink" && prev.slotId === sourceSlotId && prev.id === id
            ? { kind: "ink", slotId: patchedDestSlot.id, id }
            : prev,
        );
      }
      setAnnotations((prev) => {
        const { next } = updateSlotBucket(prev, sourceSlotId, id, slotsRef.current, patch);
        return next;
      });
    },
    [recordHistory, setAnnotations, setSelection, slotsRef],
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
    [recordHistory, setAnnotations],
  );

  /** Set / clear an AcroForm field's user-entered value. Coalesce key
   *  is `form:<sourceKey>:<fullName>` so per-keystroke typing into one
   *  text field collapses to a single undo step (matches how the
   *  edit-text and inserted-text flows undo a typing session). */
  const onFormFieldChange = useCallback(
    (sourceKey: string, fullName: string, value: FormValue) => {
      recordHistory(`form:${sourceKey}:${fullName}`);
      setFormValues((prev) => {
        const next = new Map(prev);
        const perSource = new Map<string, FormValue>(next.get(sourceKey) ?? []);
        perSource.set(fullName, value);
        next.set(sourceKey, perSource);
        return next;
      });
    },
    [recordHistory, setFormValues],
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
    [recordHistory, setRedactions],
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
    [recordHistory, setRedactions],
  );

  const onSlotsChange = useCallback(
    (next: PageSlot[]) => {
      recordHistory(null);
      setSlots(next);
    },
    [recordHistory, setSlots],
  );

  return {
    onEdit,
    onImageMove,
    onEditingChange,
    onCanvasClick,
    onTextInsertChange,
    onTextInsertDelete,
    onImageInsertChange,
    onImageInsertDelete,
    onAnnotationAdd,
    onAnnotationChange,
    onAnnotationDelete,
    onFormFieldChange,
    onRedactionAdd,
    onRedactionChange,
    onSlotsChange,
  };
}
