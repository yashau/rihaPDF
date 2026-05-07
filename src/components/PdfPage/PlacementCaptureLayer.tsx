import type { RefObject } from "react";
import type { RenderedPage } from "@/pdf/render/pdf";
import type { ToolMode } from "@/domain/toolMode";

export function PlacementCaptureLayer({
  containerRef,
  page,
  tool,
  onCanvasClick,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  page: RenderedPage;
  tool: ToolMode;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
}) {
  if (tool !== "addText" && tool !== "addImage" && tool !== "comment" && tool !== "redact") {
    return null;
  }

  return (
    <div
      className="absolute inset-0"
      style={{
        cursor: "crosshair",
        zIndex: 50,
        pointerEvents: "auto",
        touchAction: "manipulation",
      }}
      onClick={(e) => {
        e.stopPropagation();
        const host = containerRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        // r is the displayed rect (post-CSS-transform). Convert
        // screen px -> PDF user space through effective scale.
        const ds = page.viewWidth > 0 ? r.width / page.viewWidth : 1;
        const effective = page.scale * ds;
        const xView = e.clientX - r.x;
        const yView = e.clientY - r.y;
        const pdfX = xView / effective;
        const pdfY = (r.height - yView) / effective;
        onCanvasClick(pdfX, pdfY);
      }}
    />
  );
}
