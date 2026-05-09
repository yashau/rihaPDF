import { useCallback, useEffect, useState } from "react";
import type { Selection } from "@/domain/selection";
import type { AppContentActions } from "@/app/state/contentState";

/** Currently-selected object — set by single-click on an image
 *  overlay; cleared by Escape, by clicking elsewhere, or by tool
 *  changes. The hook owns the keyboard handlers (Delete /
 *  Backspace to delete, Escape to clear) and the click-anywhere
 *  clear, so callers only deal with the per-kind setters and the
 *  delete-the-selected-thing action. */
export function useSelection({
  recordHistory,
  contentActions,
}: {
  recordHistory: (coalesceKey: string | null) => void;
  contentActions: AppContentActions;
}) {
  const [selection, setSelection] = useState<Selection>(null);

  const onSelectImage = useCallback((slotId: string, imageId: string) => {
    setSelection({ kind: "image", slotId, imageId });
  }, []);
  const onSelectInsertedImage = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "insertedImage", slotId, id });
  }, []);
  const onSelectShape = useCallback((slotId: string, shapeId: string) => {
    setSelection({ kind: "shape", slotId, shapeId });
  }, []);
  const onSelectRedaction = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "redaction", slotId, id });
  }, []);
  const onSelectHighlight = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "highlight", slotId, id });
  }, []);
  const onSelectInk = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "ink", slotId, id });
  }, []);

  const onDeleteSelection = useCallback(() => {
    if (!selection) return;
    // Each delete is its own undo step — Delete is a discrete user
    // action, not continuous like typing or dragging.
    recordHistory(null);
    if (selection.kind === "image") {
      contentActions.markImageDeleted(selection.slotId, selection.imageId);
    } else if (selection.kind === "insertedImage") {
      contentActions.deleteImageInsert(selection.slotId, selection.id);
    } else if (selection.kind === "shape") {
      contentActions.markShapeDeleted(selection.slotId, selection.shapeId);
    } else if (selection.kind === "redaction") {
      contentActions.deleteRedaction(selection.slotId, selection.id);
    } else if (selection.kind === "highlight" || selection.kind === "ink") {
      // Highlights and ink live in the same per-slot annotations array
      // as comments — drop the matching id.
      contentActions.deleteAnnotation(selection.slotId, selection.id);
    }
    setSelection(null);
  }, [contentActions, selection, recordHistory]);

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
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("[data-ink-id]")) return;
      setSelection(null);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [selection]);

  return {
    selection,
    setSelection,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onSelectRedaction,
    onSelectHighlight,
    onSelectInk,
    onDeleteSelection,
  };
}
