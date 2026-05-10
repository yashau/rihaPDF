import type { RenderedPage } from "@/pdf/render/pdf";
import { pdfRectToViewportRect } from "../geometry";
import { OverlayDeleteButton } from "./OverlayDeleteButton";

/** Selectable hit-zone for a vector shape (line, rect, path) detected
 *  on the source page. v1 only supports delete — no move, no resize.
 *  A thin shape (e.g. a 0.5pt horizontal rule) gets a minimum 8px
 *  square hit zone centred on the shape so the user can actually grab
 *  it on touch. Visual outline only appears on hover / select to keep
 *  the page uncluttered.  */
export function ShapeOverlay({
  shape,
  page,
  isSelected,
  onSelect,
  onDelete,
}: {
  shape: import("@/pdf/source/sourceShapes").ShapeInstance;
  page: RenderedPage;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    left: visLeft,
    top: visTop,
    width: visW,
    height: visH,
  } = pdfRectToViewportRect(shape, page.scale, page.viewHeight);
  const MIN_HIT = 8;
  const hitW = Math.max(visW, MIN_HIT);
  const hitH = Math.max(visH, MIN_HIT);
  const left = visLeft - (hitW - visW) / 2;
  const top = visTop - (hitH - visH) / 2;
  return (
    <div
      data-shape-id={shape.id}
      role="button"
      tabIndex={0}
      aria-label="Vector shape — click to select, Del to delete"
      title="Click to select, Del to delete"
      style={{
        position: "absolute",
        left,
        top,
        width: hitW,
        height: hitH,
        // Only paint an outline when selected or hovered — a permanent
        // outline on every detected shape would clutter the page (large
        // PDFs can have dozens of shapes).
        outline: isSelected ? "2px solid rgba(220, 50, 50, 0.85)" : undefined,
        outlineOffset: isSelected ? "1px" : undefined,
        cursor: "pointer",
        pointerEvents: "auto",
        // Same as image overlays: one-finger swipes still pan the page
        // in either axis, while a tap selects.
        touchAction: "pan-x pan-y pinch-zoom",
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
        }
      }}
    >
      {isSelected ? <OverlayDeleteButton aria-label="Delete shape" onDelete={onDelete} /> : null}
    </div>
  );
}
