import { useCallback, useEffect, useState } from "react";
import type { ImageInsertion } from "./insertions";
import type { ImageMoveValue } from "../components/PdfPage";
import type { Selection } from "../components/PageList";

export type { Selection };

/** Currently-selected object — set by single-click on an image
 *  overlay; cleared by Escape, by clicking elsewhere, or by tool
 *  changes. The hook owns the keyboard handlers (Delete /
 *  Backspace to delete, Escape to clear) and the click-anywhere
 *  clear, so callers only deal with the per-kind setters and the
 *  delete-the-selected-thing action. */
export function useSelection({
  recordHistory,
  setImageMoves,
  setInsertedImages,
  setShapeDeletes,
}: {
  recordHistory: (coalesceKey: string | null) => void;
  setImageMoves: React.Dispatch<React.SetStateAction<Map<string, Map<string, ImageMoveValue>>>>;
  setInsertedImages: React.Dispatch<React.SetStateAction<Map<string, ImageInsertion[]>>>;
  setShapeDeletes: React.Dispatch<React.SetStateAction<Map<string, Set<string>>>>;
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
  }, [selection, recordHistory, setImageMoves, setInsertedImages, setShapeDeletes]);

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

  return {
    selection,
    setSelection,
    onSelectImage,
    onSelectInsertedImage,
    onSelectShape,
    onDeleteSelection,
  };
}
