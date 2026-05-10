import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

const MIN_DOCUMENT_ZOOM = 1;
const MAX_DOCUMENT_ZOOM = 4;

type TouchPoint = {
  clientX: number;
  clientY: number;
};

type PinchState = {
  startDistance: number;
  startZoom: number;
  anchorContentX: number;
  anchorContentY: number;
  anchorViewportX: number;
  anchorViewportY: number;
  anchorTargetX: number;
  anchorTargetY: number;
};

type ZoomAnchor = {
  zoom: number;
  contentX: number;
  contentY: number;
  viewportX: number;
  viewportY: number;
  targetX: number;
  targetY: number;
};

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_DOCUMENT_ZOOM;
  return Math.min(MAX_DOCUMENT_ZOOM, Math.max(MIN_DOCUMENT_ZOOM, value));
}

function distance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function midpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}

function isDocumentOverlayTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("[data-run-id], [data-text-insert-id], [data-form-field]");
}

function isActiveEditableTarget(target: HTMLElement): boolean {
  const editable = target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
  if (!editable) return false;
  const active = document.activeElement;
  return active instanceof HTMLElement && editable.contains(active);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-edit-toolbar]")) return true;
  // Form fields are real controls, but an inactive field should not
  // block the document's two-finger zoom. We only reserve the gesture
  // for the control itself once it is active/focused; single taps still
  // flow through because pointerdown is not prevented until a second
  // touch joins the gesture.
  if (target.closest("[data-form-field]") && !isActiveEditableTarget(target)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  // Source/inserted text overlays are intentionally button-like for
  // tap-to-edit and keyboard access. Do not treat those document-page
  // overlays as UI chrome: a two-finger gesture that starts over text
  // should still become document zoom.
  if (isDocumentOverlayTarget(target)) return false;
  return !!target.closest('button, [role="button"]');
}

/** Owns mobile pinch-zoom for the document scroll surface.
 *
 *  Browser viewport pinch zoom makes fixed app chrome follow
 *  `visualViewport` events, which arrive too sparsely on mobile to
 *  keep the header/toolbars stable. This hook disables browser pinch on
 *  the PDF scroll surface (via the caller's `touch-action: pan-x pan-y`)
 *  and converts two-finger distance changes into the app's controlled
 *  document zoom instead. Single-finger scrolling remains native. */
export function useMobileDocumentZoom({
  enabled,
  zoom,
  targetRef,
  onZoomChange,
}: {
  enabled: boolean;
  zoom: number;
  targetRef: RefObject<HTMLElement | null>;
  onZoomChange: (next: number) => void;
}) {
  const zoomRef = useRef(zoom);
  const pointsRef = useRef<Map<number, TouchPoint>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveZoomRef = useRef<number | null>(null);
  const liveAnchorRef = useRef<ZoomAnchor | null>(null);
  const wheelAnchorRef = useRef<ZoomAnchor | null>(null);
  const wheelResetRef = useRef<number | null>(null);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!enabled) {
      pointsRef.current.clear();
      pinchRef.current = null;
      liveZoomRef.current = null;
      liveAnchorRef.current = null;
      const target = targetRef.current;
      if (target) clearLiveTransform(target);
    }
  }, [enabled, targetRef]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      if (wheelResetRef.current !== null) window.clearTimeout(wheelResetRef.current);
      const target = targetRef.current;
      if (target) clearLiveTransform(target);
    },
    [targetRef],
  );

  const applyLiveZoom = useCallback(
    (nextZoom: number, anchor: ZoomAnchor): void => {
      liveZoomRef.current = nextZoom;
      liveAnchorRef.current = anchor;
      const target = targetRef.current;
      if (!target) return;
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const committedZoom = zoomRef.current;
        const ratio = nextZoom / committedZoom;
        target.style.transformOrigin = `${anchor.targetX}px ${anchor.targetY}px`;
        target.style.transform = ratio === 1 ? "" : `scale(${ratio})`;
        target.style.willChange = ratio === 1 ? "" : "transform";
      });
    },
    [targetRef],
  );

  const commitLiveZoom = useCallback(
    (el: HTMLElement): void => {
      const nextZoom = liveZoomRef.current;
      const anchor = liveAnchorRef.current;
      const target = targetRef.current;
      if (nextZoom === null || !anchor) return;

      liveZoomRef.current = null;
      liveAnchorRef.current = null;
      onZoomChange(nextZoom);

      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const ratio = nextZoom / anchor.zoom;
        el.scrollLeft = anchor.contentX * ratio - anchor.viewportX;
        el.scrollTop = anchor.contentY * ratio - anchor.viewportY;
        if (target) clearLiveTransform(target);
      });
    },
    [onZoomChange, targetRef],
  );

  const startPinch = useCallback(
    (el: HTMLElement): void => {
      const points = [...pointsRef.current.values()];
      if (points.length < 2) return;
      const [a, b] = points;
      const startDistance = distance(a, b);
      if (startDistance <= 0) return;
      const mid = midpoint(a, b);
      const rect = el.getBoundingClientRect();
      const targetRect = targetRef.current?.getBoundingClientRect() ?? rect;
      const anchorViewportX = mid.clientX - rect.left;
      const anchorViewportY = mid.clientY - rect.top;
      pinchRef.current = {
        startDistance,
        startZoom: zoomRef.current,
        anchorContentX: el.scrollLeft + anchorViewportX,
        anchorContentY: el.scrollTop + anchorViewportY,
        anchorViewportX,
        anchorViewportY,
        anchorTargetX: mid.clientX - targetRect.left,
        anchorTargetY: mid.clientY - targetRect.top,
      };
    },
    [targetRef],
  );

  const updatePinch = useCallback((): void => {
    const pinch = pinchRef.current;
    if (!pinch) return;
    const points = [...pointsRef.current.values()];
    if (points.length < 2) return;
    const [a, b] = points;
    const nextZoom = clampZoom((pinch.startZoom * distance(a, b)) / pinch.startDistance);
    applyLiveZoom(nextZoom, {
      zoom: pinch.startZoom,
      contentX: pinch.anchorContentX,
      contentY: pinch.anchorContentY,
      viewportX: pinch.anchorViewportX,
      viewportY: pinch.anchorViewportY,
      targetX: pinch.anchorTargetX,
      targetY: pinch.anchorTargetY,
    });
  }, [applyLiveZoom]);

  const onPointerDownCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      if (!enabled || e.pointerType !== "touch" || isInteractiveTarget(e.target)) return;
      pointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (pointsRef.current.size >= 2) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic E2E PointerEvents do not create an active browser
          // pointer, so capture can fail even though the gesture path is
          // otherwise representative.
        }
        startPinch(e.currentTarget);
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [enabled, startPinch],
  );

  const onPointerMoveCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      if (!enabled || e.pointerType !== "touch" || !pointsRef.current.has(e.pointerId)) return;
      pointsRef.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      if (pointsRef.current.size >= 2) {
        if (!pinchRef.current) startPinch(e.currentTarget);
        updatePinch();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [enabled, startPinch, updatePinch],
  );

  const endPointer = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      pointsRef.current.delete(e.pointerId);
      if (pointsRef.current.size < 2) {
        pinchRef.current = null;
        commitLiveZoom(e.currentTarget);
      }
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // See setPointerCapture note above.
      }
    },
    [commitLiveZoom],
  );

  const onWheelCapture = useCallback(
    (e: ReactWheelEvent<HTMLElement>): void => {
      if (!enabled || !e.ctrlKey || isInteractiveTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const targetRect = targetRef.current?.getBoundingClientRect() ?? rect;
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;
      const currentZoom = liveZoomRef.current ?? zoomRef.current;
      const anchor = wheelAnchorRef.current ?? {
        zoom: zoomRef.current,
        contentX: el.scrollLeft + viewportX,
        contentY: el.scrollTop + viewportY,
        viewportX,
        viewportY,
        targetX: e.clientX - targetRect.left,
        targetY: e.clientY - targetRect.top,
      };
      wheelAnchorRef.current = anchor;

      // Trackpad/devtools pinch gestures arrive as a stream of small
      // ctrl+wheel deltas. Exponential scaling keeps the gesture smooth
      // and symmetric for zoom-in vs zoom-out.
      const nextZoom = clampZoom(currentZoom * Math.exp(-e.deltaY / 300));
      applyLiveZoom(nextZoom, anchor);

      if (wheelResetRef.current !== null) window.clearTimeout(wheelResetRef.current);
      wheelResetRef.current = window.setTimeout(() => {
        commitLiveZoom(el);
        wheelAnchorRef.current = null;
        wheelResetRef.current = null;
      }, 120);
    },
    [applyLiveZoom, commitLiveZoom, enabled, targetRef],
  );

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture: endPointer,
    onPointerCancelCapture: endPointer,
    onWheelCapture,
  };
}

export { MAX_DOCUMENT_ZOOM, MIN_DOCUMENT_ZOOM };

function clearLiveTransform(target: HTMLElement): void {
  target.style.transform = "";
  target.style.transformOrigin = "";
  target.style.willChange = "";
}
