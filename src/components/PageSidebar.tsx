import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { FilePlus2, Plus, Trash2 } from "lucide-react";
import type React from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PageSlot } from "@/domain/slots";
import { blankSlot } from "@/domain/slots";
import type { LoadedSource } from "../lib/loadSource";

type Props = {
  slots: PageSlot[];
  /** All loaded sources, keyed by sourceKey. Sidebar reads them to
   *  size blanks against neighbouring pages and to render thumbs by
   *  downscaling each source's already-rendered canvas. */
  sources: Map<string, LoadedSource>;
  onSlotsChange: (next: PageSlot[]) => void;
  onAddExternalPdfs: (files: File[], insertAt?: number) => void;
  /** Tailwind width class for the <aside>. Defaults to a desktop-rail
   *  size; the mobile drawer wrapper passes "w-full" so the aside
   *  fills the drawer's own width budget. */
  widthClass?: string;
  /** Called after a thumbnail tap scrolls the main view. The mobile
   *  drawer uses this to auto-close — otherwise the user taps a
   *  thumb, the page scrolls behind a drawer they can't see. */
  onSlotActivate?: () => void;
};

// Target CSS width of the displayed thumbnail. Sized for the widest
// mount — the mobile drawer (`max-w-sm` 384 − `px-3` 24 = 360). The
// desktop rail (`w-56`) downscales further at draw time, which the
// browser handles cleanly. Bitmap is rendered at this × DPR so device
// pixels land 1:1 instead of being upscaled.
const THUMB_TARGET_CSS_WIDTH = 360;
const PDF_DROP_AUTOSCROLL_EDGE_PX = 56;
const PDF_DROP_AUTOSCROLL_MAX_STEP = 18;

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function hasFileTransfer(dt: DataTransfer): boolean {
  if (dt.items.length > 0) return Array.from(dt.items).some((item) => item.kind === "file");
  return dt.files.length > 0 || Array.from(dt.types).includes("Files");
}

function dragMayContainPdf(dt: DataTransfer): boolean {
  if (dt.items.length > 0) {
    return Array.from(dt.items).some(
      (item) => item.kind === "file" && (item.type === "application/pdf" || item.type === ""),
    );
  }
  if (dt.files.length > 0) return Array.from(dt.files).some(isPdfFile);
  return Array.from(dt.types).includes("Files");
}

export function PageSidebar({
  slots,
  sources,
  onSlotsChange,
  onAddExternalPdfs,
  widthClass = "w-56",
  onSlotActivate,
}: Props) {
  const externalFileInputRef = useRef<HTMLInputElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const fileDragClientYRef = useRef<number | null>(null);
  const fileDragScrollFrameRef = useRef<number | null>(null);
  /** Thumb cache. Keys: `${sourceKey}:${pageIndex}` — values are PNG
   *  data URLs so multiple <img> tags can share one entry. */
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const [pdfDropIndex, setPdfDropIndex] = useState<number | null>(null);
  // Tracks the LoadedSource object identity per sourceKey. We compare by
  // identity (not just key presence) because opening a new primary PDF
  // reuses PRIMARY_SOURCE_KEY — only the underlying source object
  // changes. Without this, stale thumbnails from the previous file would
  // keep showing under their old (sourceKey, pageIndex) cache entries.
  const knownSourcesRef = useRef<Map<string, LoadedSource>>(new Map());

  // Single effect that handles both stale-source eviction and thumb
  // generation. Merging is required: if eviction lived in its own effect
  // it would call setThumbs, but the regen effect's closure would still
  // see the old (stale) thumbs map and skip regeneration — and `thumbs`
  // can't be added to its deps without an infinite loop. Doing both in
  // one effect with one functional setThumbs makes cleanup + regen a
  // single atomic update.
  useEffect(() => {
    const prevKnown = knownSourcesRef.current;
    const stale = new Set<string>();
    for (const [k, v] of prevKnown) {
      if (sources.get(k) !== v) stale.add(k);
    }
    knownSourcesRef.current = new Map(sources);

    // Downscale the already-rendered source canvas via 2D drawImage.
    // Cheaper than re-running pdf.js because we already have the source
    // canvas in memory after eager extraction. pdf.js renders source
    // canvases at scale × DPR (capped 2), so src.width is already in
    // device pixels; target = CSS width × DPR (same cap) gives a 1:1
    // device-pixel display on the widest mount. Clamp factor to 1 so a
    // tiny source PDF doesn't get upscaled.
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const targetW = THUMB_TARGET_CSS_WIDTH * dpr;
    const additions = new Map<string, string>();
    for (const slot of slots) {
      if (slot.kind !== "page") continue;
      const source = sources.get(slot.sourceKey);
      const rp = source?.pages[slot.sourcePageIndex];
      if (!rp) continue;
      const key = `${slot.sourceKey}:${slot.sourcePageIndex}`;
      // Regenerate if either uncached or evicted by stale-source
      // detection above. Skip otherwise to avoid pointless re-encoding.
      if (thumbs.has(key) && !stale.has(slot.sourceKey)) continue;
      const src = rp.canvas;
      const factor = Math.min(1, targetW / src.width);
      const w = Math.max(1, Math.round(src.width * factor));
      const h = Math.max(1, Math.round(src.height * factor));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, 0, 0, w, h);
      additions.set(key, c.toDataURL("image/png"));
    }

    if (stale.size === 0 && additions.size === 0) return;
    // oxlint-disable-next-line react-hooks/set-state-in-effect
    setThumbs((prev) => {
      const next = new Map<string, string>();
      for (const [k, v] of prev) {
        const sourceKey = k.split(":")[0];
        if (!stale.has(sourceKey)) next.set(k, v);
      }
      for (const [k, v] of additions) next.set(k, v);
      return next;
    });
    // oxlint-disable-next-line react/exhaustive-deps
  }, [slots, sources]);

  useEffect(
    () => () => {
      if (fileDragScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(fileDragScrollFrameRef.current);
      }
    },
    [],
  );

  const insertBlankAt = (i: number) => {
    // Match the size of the nearest neighbour so a blank inserted into
    // a Letter-size doc stays Letter, not A4.
    const ref = slots[i] ?? slots[i - 1] ?? null;
    let size: [number, number] = [595.28, 841.89];
    if (ref) {
      if (ref.kind === "page") {
        const source = sources.get(ref.sourceKey);
        const p = source?.pages[ref.sourcePageIndex];
        if (p) size = [p.viewWidth / p.scale, p.viewHeight / p.scale];
      } else {
        size = ref.size;
      }
    }
    onSlotsChange([...slots.slice(0, i), blankSlot(size), ...slots.slice(i)]);
  };

  const removeSlot = (slotId: string) => {
    onSlotsChange(slots.filter((s) => s.id !== slotId));
  };

  // Mouse: 5px activation distance keeps a click on the delete X from
  // being misread as the start of a drag.
  // Touch: 400ms hold-to-drag so a finger swipe scrolls the sidebar
  // (which is a common reflex on phones) instead of immediately
  // grabbing whichever thumb sits under the finger. The 8px tolerance
  // lets the browser fire pan-y and abort the would-be drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 8 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slots.findIndex((s) => s.id === active.id);
    const newIndex = slots.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onSlotsChange(arrayMove(slots, oldIndex, newIndex));
  };

  const sourcesLoaded = sources.size > 0;

  const dropIndexForClientY = (clientY: number): number => {
    const nodes = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLElement>("[data-sidebar-slot-index]") ?? [],
    );
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) return Number(node.dataset.sidebarSlotIndex ?? 0);
    }
    return slots.length;
  };

  const stopFileDragAutoScroll = () => {
    fileDragClientYRef.current = null;
    if (fileDragScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(fileDragScrollFrameRef.current);
      fileDragScrollFrameRef.current = null;
    }
  };

  const tickFileDragAutoScroll = () => {
    const sidebar = sidebarRef.current;
    const clientY = fileDragClientYRef.current;
    if (!sidebar || clientY === null) {
      fileDragScrollFrameRef.current = null;
      return;
    }

    const rect = sidebar.getBoundingClientRect();
    const topDistance = clientY - rect.top;
    const bottomDistance = rect.bottom - clientY;
    let step = 0;
    if (topDistance < PDF_DROP_AUTOSCROLL_EDGE_PX) {
      const t = Math.max(0, Math.min(1, 1 - topDistance / PDF_DROP_AUTOSCROLL_EDGE_PX));
      step = -Math.ceil(t * PDF_DROP_AUTOSCROLL_MAX_STEP);
    } else if (bottomDistance < PDF_DROP_AUTOSCROLL_EDGE_PX) {
      const t = Math.max(0, Math.min(1, 1 - bottomDistance / PDF_DROP_AUTOSCROLL_EDGE_PX));
      step = Math.ceil(t * PDF_DROP_AUTOSCROLL_MAX_STEP);
    }

    if (step !== 0) {
      sidebar.scrollTop += step;
      setPdfDropIndex(dropIndexForClientY(clientY));
    }
    fileDragScrollFrameRef.current = window.requestAnimationFrame(tickFileDragAutoScroll);
  };

  const startFileDragAutoScroll = (clientY: number) => {
    fileDragClientYRef.current = clientY;
    if (fileDragScrollFrameRef.current === null) {
      fileDragScrollFrameRef.current = window.requestAnimationFrame(tickFileDragAutoScroll);
    }
  };

  const handleFileDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    if (!sourcesLoaded || !dragMayContainPdf(e.dataTransfer)) {
      e.dataTransfer.dropEffect = "none";
      setPdfDropIndex(null);
      stopFileDragAutoScroll();
      return;
    }
    e.dataTransfer.dropEffect = "copy";
    startFileDragAutoScroll(e.clientY);
    setPdfDropIndex(dropIndexForClientY(e.clientY));
  };

  const handleFileDrop = (e: React.DragEvent<HTMLElement>) => {
    if (!hasFileTransfer(e.dataTransfer)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(isPdfFile);
    const insertAt = pdfDropIndex ?? dropIndexForClientY(e.clientY);
    setPdfDropIndex(null);
    stopFileDragAutoScroll();
    if (!sourcesLoaded || files.length === 0) return;
    onAddExternalPdfs(files, insertAt);
  };

  return (
    <aside
      ref={sidebarRef}
      data-testid="page-sidebar"
      className={`flex-shrink-0 ${widthClass} h-full border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-y-auto py-2 [scrollbar-gutter:stable]`}
      onDragOver={handleFileDragOver}
      onDragLeave={(e) => {
        const nextTarget = e.relatedTarget;
        if (!(nextTarget instanceof Node) || !e.currentTarget.contains(nextTarget)) {
          setPdfDropIndex(null);
          stopFileDragAutoScroll();
        }
      }}
      onDrop={handleFileDrop}
    >
      <div className="flex flex-col gap-2 px-3 mb-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Pages
        </span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!sourcesLoaded}
            onPress={() => insertBlankAt(slots.length)}
          >
            <Plus size={14} aria-hidden />
            Blank
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!sourcesLoaded}
            onPress={() => externalFileInputRef.current?.click()}
          >
            <FilePlus2 size={14} aria-hidden />
            From PDF
          </Button>
          <input
            ref={externalFileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) onAddExternalPdfs(files);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={slots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col px-3">
            {slots.map((slot, idx) => (
              <div key={slot.id} data-sidebar-slot-index={idx}>
                <InsertGap active={pdfDropIndex === idx} onClick={() => insertBlankAt(idx)} />
                <SortableSlotThumb
                  slot={slot}
                  displayIndex={idx}
                  dataUrl={
                    slot.kind === "page"
                      ? (thumbs.get(`${slot.sourceKey}:${slot.sourcePageIndex}`) ?? null)
                      : null
                  }
                  onRemove={() => removeSlot(slot.id)}
                  onActivate={() => {
                    const el = document.getElementById(`page-slot-${slot.id}`);
                    el?.scrollIntoView({ behavior: "smooth", block: "start" });
                    onSlotActivate?.();
                  }}
                />
              </div>
            ))}
            <InsertGap
              active={pdfDropIndex === slots.length}
              onClick={() => insertBlankAt(slots.length)}
            />
          </div>
        </SortableContext>
      </DndContext>
    </aside>
  );
}

function InsertGap({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-center h-3 w-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
      aria-label="Insert blank page here"
    >
      <span
        data-testid={active ? "pdf-drop-marker" : undefined}
        className={`text-[10px] leading-none border-t w-full mx-2 relative ${
          active
            ? "opacity-100 border-blue-500 dark:border-blue-400 text-blue-700 dark:text-blue-300"
            : "opacity-0 group-hover:opacity-100 border-zinc-400 dark:border-zinc-600"
        }`}
      >
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-zinc-50 dark:bg-zinc-900 px-1">
          {active ? "Drop PDF" : "+ Blank"}
        </span>
      </span>
    </button>
  );
}

function SortableSlotThumb({
  slot,
  displayIndex,
  dataUrl,
  onRemove,
  onActivate,
}: {
  slot: PageSlot;
  displayIndex: number;
  dataUrl: string | null;
  onRemove: () => void;
  onActivate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      className="group relative bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden cursor-pointer active:cursor-grabbing touch-pan-y"
    >
      <div className="absolute top-1 left-1 z-10 bg-zinc-700/75 dark:bg-zinc-950/75 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none">
        {displayIndex + 1}
      </div>
      {/* Stop pointerdown so dnd-kit's PointerSensor doesn't capture
          the click as a drag start. */}
      <div
        className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 z-10"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Button
          isIconOnly
          size="sm"
          variant="danger-soft"
          aria-label={`Delete page ${displayIndex + 1}`}
          onPress={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      {slot.kind === "blank" ? (
        // A blank slot is just a white page in the saved PDF. Render
        // it as one in the thumb too — same aspect ratio as the
        // slot's natural size, no "Blank" label — so it sits next to
        // real thumbs without looking like a UI placeholder.
        <div
          className="block w-full bg-white"
          style={{ aspectRatio: `${slot.size[0]} / ${slot.size[1]}` }}
        />
      ) : dataUrl ? (
        <img src={dataUrl} alt="" className="block w-full h-auto" draggable={false} />
      ) : (
        <div className="flex items-center justify-center text-zinc-300 dark:text-zinc-600 text-xs h-32">
          …
        </div>
      )}
    </div>
  );
}
