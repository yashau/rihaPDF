import { useEffect, useRef } from "react";
import type { RenderedPage } from "../../lib/pdf";

export function CanvasSlot({
  page,
  previewCanvas,
}: {
  page: RenderedPage;
  previewCanvas: HTMLCanvasElement | null;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);

  // Mounts the live canvas (preview or original) into our DOM slot and
  // sizes it. Mutating the DOM canvas's style is intentional here: the
  // canvas is a render artefact, not an owned prop value.
  /* oxlint-disable-next-line react-hooks/immutability */
  useEffect(() => {
    const node = slotRef.current;
    if (!node) return;
    const liveCanvas = previewCanvas ?? page.canvas;
    node.replaceChildren(liveCanvas);
    /* oxlint-disable react-hooks/immutability */
    liveCanvas.style.display = "block";
    liveCanvas.style.width = `${page.viewWidth}px`;
    liveCanvas.style.height = `${page.viewHeight}px`;
    /* oxlint-enable react-hooks/immutability */
  }, [page, previewCanvas]);

  return <div ref={slotRef} data-canvas-slot />;
}
