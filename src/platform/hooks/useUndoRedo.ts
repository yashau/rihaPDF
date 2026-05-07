import { useCallback, useEffect, useRef, useState } from "react";

/** Debounce window for the undo/redo coalescing rule: a second
 *  change to the same coalesce key (e.g. typing in the same text
 *  field, dragging the same image) within this window does NOT
 *  push a new history entry — the original pre-change snapshot
 *  is reused. After this much idle time, the next change starts
 *  a fresh history entry. */
const DEFAULT_COALESCE_MS = 500;
/** Hard cap on history depth so a long editing session can't
 *  grow the snapshot stack without bound. */
const DEFAULT_MAX_HISTORY = 100;

/** Generic snapshot stack with debounce-and-replace coalescing.
 *  The tradeoff: per-keystroke snapshots flood the stack and undo
 *  feels broken; one snapshot per "user action" (typing session,
 *  drag, click-to-place) is what people actually mean by Ctrl+Z.
 *  We capture pre-mutation state at the START of each mutating
 *  callback, but *only* push it if the coalesce key differs from
 *  the in-flight one (or the debounce window has elapsed). Native
 *  textarea / input undo still handles per-character undo while
 *  a field is focused; this stack is for app-level actions.
 *
 *  Coalesce-key convention: callers should namespace keys as
 *  `<domain>:<id>` (e.g. `edit:slotId:runId`,
 *  `image-move:slotId:imageId`). A bare key like `"drag"` will
 *  silently coalesce across unrelated flows. */
export function useUndoRedo<S>({
  captureSnapshot,
  restoreSnapshot,
  maxHistory = DEFAULT_MAX_HISTORY,
  coalesceMs = DEFAULT_COALESCE_MS,
}: {
  captureSnapshot: () => S;
  restoreSnapshot: (s: S) => void;
  maxHistory?: number;
  coalesceMs?: number;
}) {
  const [undoStack, setUndoStack] = useState<S[]>([]);
  const [redoStack, setRedoStack] = useState<S[]>([]);
  /** In-flight coalesce window: when the next `recordHistory` call
   *  arrives with the same `key` before `timer` fires, the call is
   *  dropped (the existing pre-change snapshot is still the right
   *  one to revert to). A different key, or a fired timer, ends
   *  the window. */
  const coalesceRef = useRef<{ key: string; timer: number } | null>(null);

  /** Call BEFORE a state mutation. `coalesceKey` of `null` always
   *  pushes (use for one-shot actions like click-to-place);
   *  a string key coalesces consecutive same-key calls within
   *  `coalesceMs`. Always clears the redo stack — once you
   *  branch the timeline, redo is gone. */
  const recordHistory = useCallback(
    (coalesceKey: string | null) => {
      if (coalesceKey !== null && coalesceRef.current?.key === coalesceKey) {
        // Same-key follow-up within the window: keep the original
        // pre-change snapshot, just extend the window.
        window.clearTimeout(coalesceRef.current.timer);
        coalesceRef.current.timer = window.setTimeout(() => {
          coalesceRef.current = null;
        }, coalesceMs);
        return;
      }
      const snapshot = captureSnapshot();
      setUndoStack((prev) => {
        const next = [...prev, snapshot];
        if (next.length > maxHistory) next.splice(0, next.length - maxHistory);
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
              }, coalesceMs),
            };
    },
    [captureSnapshot, coalesceMs, maxHistory],
  );

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

  return {
    recordHistory,
    undo,
    redo,
    clearHistory,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
