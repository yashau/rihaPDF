import type { ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DragGestureEndInfo, DragGestureInfo } from "@/platform/hooks/useDragGesture";
import { useDragGesture } from "@/platform/hooks/useDragGesture";

/** Screen-pixel state captured at gesture-start so the body-portal
 *  preview can mount a `position: fixed` clone that escapes the page
 *  wrapper's `overflow: hidden`. `moved` tracks whether the cursor
 *  has actually moved during the gesture: mouse pointers eagerly
 *  enter the gesture on pointerdown, so a no-motion click would
 *  otherwise hide the in-place overlay (`visibility: hidden`) the
 *  instant the cursor went down — the click would then dispatch on
 *  whatever sits underneath and miss the overlay's own onClick. */
export type DragLive = {
  cursorOffsetX: number;
  cursorOffsetY: number;
  width: number;
  height: number;
  clientX: number;
  clientY: number;
  moved: boolean;
};

/** Shared `dragLive` + body-portal preview pattern used by inserted
 *  text / inserted image / cross-page-arrival overlays.
 *
 *  The page wrapper carries `overflow: hidden` so an in-parent
 *  overlay gets clipped the moment it crosses a page boundary.
 *  This hook owns the screen-px state needed to mount a position:
 *  fixed clone via `document.body` so the preview escapes the clip
 *  during cross-page drags. Consumers register their own gesture
 *  handlers on `onMove` / `onEnd`; the hook handles the boilerplate
 *  setDragLive plumbing and exposes `renderPortal(style, children)`
 *  to render the clone with the gesture's live screen position. */
export function useCrossPageDragPreview<C>(handlers: {
  onMove?: (ctx: C, info: DragGestureInfo) => void;
  /** `live` is the pre-clear snapshot of `dragLive` so consumers can
   *  read `cursorOffsetX/Y` to compute drop positions without racing
   *  the hook's own `setDragLive(null)`. */
  onEnd?: (ctx: C, info: DragGestureEndInfo, live: DragLive | null) => void;
  onCancel?: (ctx: C) => void;
}): {
  overlayRef: RefObject<HTMLDivElement | null>;
  dragLive: DragLive | null;
  beginDrag: (e: React.PointerEvent, ctx: C) => void;
  renderPortal: (style: React.CSSProperties, children?: ReactNode) => ReactNode;
} {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [dragLive, setDragLive] = useState<DragLive | null>(null);
  // dragLive captured fresh in onEnd — useDragGesture's callbacks
  // close over the original render's values otherwise. A ref keeps
  // the latest live state available without re-installing the
  // gesture every render.
  const dragLiveRef = useRef(dragLive);
  useEffect(() => {
    dragLiveRef.current = dragLive;
  }, [dragLive]);

  const beginDrag = useDragGesture<C>({
    onStart: (_ctx, e) => {
      const el = overlayRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDragLive({
        cursorOffsetX: e.clientX - r.left,
        cursorOffsetY: e.clientY - r.top,
        width: r.width,
        height: r.height,
        clientX: e.clientX,
        clientY: e.clientY,
        moved: false,
      });
    },
    onMove: (ctx, info) => {
      setDragLive((prev) =>
        prev ? { ...prev, clientX: info.clientX, clientY: info.clientY, moved: true } : prev,
      );
      handlers.onMove?.(ctx, info);
    },
    onEnd: (ctx, info) => {
      const live = dragLiveRef.current;
      setDragLive(null);
      handlers.onEnd?.(ctx, info, live);
    },
    onCancel: (ctx) => {
      setDragLive(null);
      handlers.onCancel?.(ctx);
    },
  });

  const renderPortal = (style: React.CSSProperties, children?: ReactNode): ReactNode => {
    if (!dragLive?.moved) return null;
    return createPortal(
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: dragLive.clientX - dragLive.cursorOffsetX,
          top: dragLive.clientY - dragLive.cursorOffsetY,
          width: dragLive.width,
          height: dragLive.height,
          pointerEvents: "none",
          zIndex: 10000,
          ...style,
        }}
      >
        {children}
      </div>,
      document.body,
    );
  };

  return { overlayRef, dragLive, beginDrag, renderPortal };
}
