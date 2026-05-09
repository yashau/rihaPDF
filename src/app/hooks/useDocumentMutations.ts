import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  type Annotation,
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
import type { Selection } from "@/domain/selection";
import type { PageSlot } from "@/domain/slots";
import type { EditValue, ImageMoveValue } from "@/domain/editState";
import type { AppContentState, AppDocumentState, AppToolState } from "@/app/hooks/useAppState";

export function useDocumentMutations({
  documentState,
  contentState,
  toolState,
  recordHistory,
  setSelection,
}: {
  documentState: AppDocumentState;
  contentState: AppContentState;
  toolState: AppToolState;
  recordHistory: (coalesceKey: string | null) => void;
  setSelection: Dispatch<SetStateAction<Selection>>;
}) {
  const { slotsRef, setSlots } = documentState;
  const { contentActions } = contentState;
  const { tool, pendingImage, commentColor, setTool, setPendingImage } = toolState;
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
      contentActions.setEdit(slotId, runId, stored);
    },
    [contentActions, recordHistory, slotsRef],
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
      contentActions.setImageMove(slotId, imageId, stored);
    },
    [contentActions, recordHistory, slotsRef],
  );

  const onEditingChange = useCallback(
    (slotId: string, runId: string | null) => {
      contentActions.setEditingRun(slotId, runId);
    },
    [contentActions],
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
        contentActions.addTextInsert(slotId, ins);
        setTool("select");
        contentActions.setEditingRun(slotId, id);
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
        contentActions.addImageInsert(slotId, ins);
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
        contentActions.addAnnotation(slotId, {
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
        } satisfies Annotation);
        setTool("select");
        return;
      }
      if (tool === "redact") {
        const id = newRedactionId();
        recordHistory(null);
        contentActions.addRedaction(slotId, {
          id,
          sourceKey: slotSourceKey,
          pageIndex: slotPageIndex,
          pdfX,
          pdfY: pdfY - REDACTION_DEFAULT_HEIGHT,
          pdfWidth: REDACTION_DEFAULT_WIDTH,
          pdfHeight: REDACTION_DEFAULT_HEIGHT,
        } satisfies Redaction);
        setSelection({ kind: "redaction", slotId, id });
        setTool("select");
      }
    },
    [
      commentColor,
      contentActions,
      pendingImage,
      recordHistory,
      setPendingImage,
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
      contentActions.patchTextInsert(sourceSlotId, id, slotsRef.current, patch);
    },
    [contentActions, recordHistory, slotsRef],
  );

  const onTextInsertDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      contentActions.deleteTextInsert(slotId, id);
    },
    [contentActions, recordHistory],
  );

  const onImageInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<ImageInsertion>) => {
      // Same-(slot,id) coalesces — drag/resize of an inserted
      // image is one undo step.
      recordHistory(`image-insert:${sourceSlotId}:${id}`);
      contentActions.patchImageInsert(sourceSlotId, id, slotsRef.current, patch);
    },
    [contentActions, recordHistory, slotsRef],
  );

  const onImageInsertDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      contentActions.deleteImageInsert(slotId, id);
    },
    [contentActions, recordHistory],
  );

  /** Add a new annotation to a slot. One snapshot per add — discrete
   *  user action like click-to-place. Returns the created annotation's
   *  id so callers can immediately open the comment editor for notes. */
  const onAnnotationAdd = useCallback(
    (slotId: string, annotation: Annotation) => {
      recordHistory(null);
      contentActions.addAnnotation(slotId, annotation);
    },
    [contentActions, recordHistory],
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
      contentActions.patchAnnotation(sourceSlotId, id, slotsRef.current, patch);
    },
    [contentActions, recordHistory, setSelection, slotsRef],
  );

  const onAnnotationDelete = useCallback(
    (slotId: string, id: string) => {
      recordHistory(null);
      contentActions.deleteAnnotation(slotId, id);
    },
    [contentActions, recordHistory],
  );

  /** Set / clear an AcroForm field's user-entered value. Coalesce key
   *  is `form:<sourceKey>:<fullName>` so per-keystroke typing into one
   *  text field collapses to a single undo step (matches how the
   *  edit-text and inserted-text flows undo a typing session). */
  const onFormFieldChange = useCallback(
    (sourceKey: string, fullName: string, value: FormValue) => {
      recordHistory(`form:${sourceKey}:${fullName}`);
      contentActions.setFormValue(sourceKey, fullName, value);
    },
    [contentActions, recordHistory],
  );

  const onRedactionAdd = useCallback(
    (slotId: string, redaction: Redaction) => {
      // Discrete user action — one snapshot per add.
      recordHistory(null);
      contentActions.addRedaction(slotId, redaction);
    },
    [contentActions, recordHistory],
  );

  /** Patch a redaction by id (used by drag/resize on RedactionOverlay).
   *  Coalesces same-(slot, id) updates inside the undo window so a
   *  drag or resize is one undo step. */
  const onRedactionChange = useCallback(
    (slotId: string, id: string, patch: Partial<Redaction>) => {
      recordHistory(`redaction:${slotId}:${id}`);
      contentActions.patchRedaction(slotId, id, patch);
    },
    [contentActions, recordHistory],
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
