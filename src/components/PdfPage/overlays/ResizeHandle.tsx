/** Square corner handle for resizing image overlays. Sits at the
 *  corner of the box with a transparent hit-test pad surrounding the
 *  visible square — bigger than the dot so a finger touch lands
 *  cleanly, while desktop precision is preserved by the inset visible
 *  square. The pad extends slightly past the box (negative offsets)
 *  so a user grabbing the visible corner from outside still hits.
 *
 *  The hit pad is CAPPED so opposite-corner pads don't meet at the
 *  centre — there has to be at least `MIN_DRAG_GAP` pixels of
 *  drag-to-move surface left between them, otherwise the parent's
 *  click-to-translate gesture becomes unreachable on small overlays
 *  (e.g. a 45×45 inserted image). For overlays large enough to fit
 *  the full 32×32 pad with breathing room, the cap is a no-op.
 *
 *  z-index 21 keeps the handle above the parent box's onPointerDown
 *  surface so the resize wins the hit-test over the translate drag. */
export type ResizeHandlePosition = "tl" | "tr" | "bl" | "br";
export type ResizeHandlePlacement = "inside" | "outside";

export function ResizeHandle({
  position,
  placement = "inside",
  parentW,
  parentH,
  onPointerDown,
}: {
  position: ResizeHandlePosition;
  /** `inside` preserves the established image/redaction behavior.
   *  `outside` keeps the visible square out of editable text boxes
   *  while retaining part of the hit target over the corner. */
  placement?: ResizeHandlePlacement;
  /** Parent overlay's viewport-pixel width/height. Used to cap the
   *  hit pad so two corner pads don't meet in the centre. */
  parentW: number;
  parentH: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const VISIBLE = 12;
  const MAX_HIT = 32;
  const MIN_DRAG_GAP = 8;
  // Gap-between-opposite-pads = parentSize - HIT - VISIBLE, derived
  // from `pad_extent_inside_box = HIT - inset = (HIT + VISIBLE) / 2`.
  // Solve for HIT: HIT <= parentSize - VISIBLE - MIN_DRAG_GAP.
  const fitW = parentW - VISIBLE - MIN_DRAG_GAP;
  const fitH = parentH - VISIBLE - MIN_DRAG_GAP;
  const HIT = Math.max(VISIBLE, Math.min(MAX_HIT, Math.floor(Math.min(fitW, fitH))));
  const inset = (HIT - VISIBLE) / 2;
  const offset = placement === "outside" ? VISIBLE + inset : inset;
  const padStyle: React.CSSProperties = {
    position: "absolute",
    width: HIT,
    height: HIT,
    pointerEvents: "auto",
    zIndex: 21,
    // Resize handles need a precise grab — disable single-finger pan
    // so a drag at the corner fires pointermove. Two-finger pinch
    // still passes through to zoom the document.
    touchAction: "pinch-zoom",
  };
  if (position === "tl") {
    padStyle.left = -offset;
    padStyle.top = -offset;
    padStyle.cursor = "nwse-resize";
  } else if (position === "tr") {
    padStyle.right = -offset;
    padStyle.top = -offset;
    padStyle.cursor = "nesw-resize";
  } else if (position === "bl") {
    padStyle.left = -offset;
    padStyle.bottom = -offset;
    padStyle.cursor = "nesw-resize";
  } else {
    padStyle.right = -offset;
    padStyle.bottom = -offset;
    padStyle.cursor = "nwse-resize";
  }
  const dotStyle: React.CSSProperties = {
    position: "absolute",
    left: inset,
    top: inset,
    width: VISIBLE,
    height: VISIBLE,
    background: "white",
    border: "1px solid rgba(40, 130, 255, 0.9)",
    boxSizing: "border-box",
    pointerEvents: "none",
  };
  return (
    <div
      data-resize-handle={position}
      style={padStyle}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div style={dotStyle} />
    </div>
  );
}

const HANDLE_POSITIONS: ResizeHandlePosition[] = ["tl", "tr", "bl", "br"];

export function ResizeHandles({
  placement,
  parentW,
  parentH,
  onPointerDown,
}: {
  placement?: ResizeHandlePlacement;
  parentW: number;
  parentH: number;
  onPointerDown: (position: ResizeHandlePosition) => (e: React.PointerEvent) => void;
}) {
  return (
    <>
      {HANDLE_POSITIONS.map((position) => (
        <ResizeHandle
          key={position}
          position={position}
          placement={placement}
          parentW={parentW}
          parentH={parentH}
          onPointerDown={onPointerDown(position)}
        />
      ))}
    </>
  );
}
