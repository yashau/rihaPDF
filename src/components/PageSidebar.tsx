import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import type React from "react";
import {
  DndContext,
  PointerSensor,
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
import type { PageSlot } from "../lib/slots";
import { blankSlot } from "../lib/slots";
import { renderPagePreviewCanvas } from "../lib/preview";
import type { RenderedPage } from "../lib/pdf";

type Props = {
  slots: PageSlot[];
  pages: RenderedPage[];
  originalBytes: ArrayBuffer | null;
  /** Per-source rendered pages for external (insert-from-PDF) slots —
   *  used to display + thumbnail external slots without re-rendering. */
  externalRendered: Map<string, RenderedPage[]>;
  onSlotsChange: (next: PageSlot[]) => void;
  onAddExternalPdfs: (files: File[]) => void;
};

const THUMB_SCALE = 0.18;
const SOURCE_RENDER_SCALE = 1.5;

export function PageSidebar({
  slots,
  pages,
  originalBytes,
  externalRendered,
  onSlotsChange,
  onAddExternalPdfs,
}: Props) {
  const externalFileInputRef = useRef<HTMLInputElement | null>(null);
  // Unified thumbnail cache. Keys: `orig:${sourceIndex}` for original
  // pages, `ext:${sourceKey}:${pageIndex}` for external pages. Values
  // are PNG data URLs so multiple <img> tags can share one entry.
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const prevBytesRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    if (prevBytesRef.current !== originalBytes) {
      prevBytesRef.current = originalBytes;
      // Drop ALL thumbs (both original + external) on file reload —
      // external slots are also reset by App in the same flow.
      setThumbs(new Map());
    }
    if (!originalBytes) return;
    const wantedOriginals = new Set<number>();
    for (const slot of slots) {
      if (slot.kind === "original") wantedOriginals.add(slot.sourceIndex);
    }
    let cancelled = false;
    void (async () => {
      for (const sourceIndex of wantedOriginals) {
        const key = `orig:${sourceIndex}`;
        // Reading `thumbs` snapshot here is safe — setThumbs uses
        // functional updates so a stale read is just wasted-work hint.
        if (thumbs.has(key)) continue;
        try {
          const canvas = await renderPagePreviewCanvas(
            new Uint8Array(originalBytes.slice(0)),
            sourceIndex,
            THUMB_SCALE,
          );
          if (cancelled) return;
          const url = canvas.toDataURL("image/png");
          setThumbs((prev) => {
            if (prev.has(key)) return prev;
            const next = new Map(prev);
            next.set(key, url);
            return next;
          });
        } catch (err) {
          console.warn("thumbnail render failed", err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originalBytes, slots]);

  // External slot thumbs: downscale the already-rendered RenderedPage
  // canvas via 2D drawImage. Cheaper than re-running pdf.js because we
  // already have the source canvas in memory.
  useEffect(() => {
    const wantedExternals: Array<{ key: string; src: HTMLCanvasElement }> = [];
    for (const slot of slots) {
      if (slot.kind !== "external") continue;
      const renderedPages = externalRendered.get(slot.sourceKey);
      const rp = renderedPages?.[slot.sourcePageIndex];
      if (!rp) continue;
      const key = `ext:${slot.sourceKey}:${slot.sourcePageIndex}`;
      if (thumbs.has(key)) continue;
      wantedExternals.push({ key, src: rp.canvas });
    }
    if (wantedExternals.length === 0) return;
    const factor = THUMB_SCALE / SOURCE_RENDER_SCALE;
    const additions = new Map<string, string>();
    for (const { key, src } of wantedExternals) {
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
    if (additions.size === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThumbs((prev) => {
      const next = new Map(prev);
      for (const [k, v] of additions) {
        if (!next.has(k)) next.set(k, v);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, externalRendered]);

  const insertBlankAt = (i: number) => {
    // Match the size of the nearest neighbour so a blank inserted into
    // a Letter-size doc stays Letter, not A4.
    const ref = slots[i] ?? slots[i - 1] ?? null;
    let size: [number, number] = [595.28, 841.89];
    if (ref) {
      if (ref.kind === "original") {
        const p = pages[ref.sourceIndex];
        if (p) size = [p.viewWidth / p.scale, p.viewHeight / p.scale];
      } else if (ref.kind === "external") {
        const rp = externalRendered.get(ref.sourceKey)?.[ref.sourcePageIndex];
        if (rp) size = [rp.viewWidth / rp.scale, rp.viewHeight / rp.scale];
      } else {
        size = ref.size;
      }
    }
    onSlotsChange([...slots.slice(0, i), blankSlot(size), ...slots.slice(i)]);
  };

  const removeSlot = (slotId: string) => {
    onSlotsChange(slots.filter((s) => s.id !== slotId));
  };

  // 5px activation distance keeps a click on the delete X from being
  // misread as the start of a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slots.findIndex((s) => s.id === active.id);
    const newIndex = slots.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onSlotsChange(arrayMove(slots, oldIndex, newIndex));
  };

  return (
    <aside className="flex-shrink-0 w-52 border-r border-zinc-200 bg-zinc-50 overflow-y-auto py-2">
      <div className="flex flex-col gap-2 px-3 mb-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Pages</span>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!originalBytes}
            onPress={() => insertBlankAt(slots.length)}
          >
            + Blank
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!originalBytes}
            onPress={() => externalFileInputRef.current?.click()}
          >
            + From PDF
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
              <div key={slot.id}>
                <InsertGap onClick={() => insertBlankAt(idx)} />
                <SortableSlotThumb
                  slot={slot}
                  displayIndex={idx}
                  dataUrl={
                    slot.kind === "original"
                      ? (thumbs.get(`orig:${slot.sourceIndex}`) ?? null)
                      : slot.kind === "external"
                        ? (thumbs.get(`ext:${slot.sourceKey}:${slot.sourcePageIndex}`) ?? null)
                        : null
                  }
                  onRemove={() => removeSlot(slot.id)}
                />
              </div>
            ))}
            <InsertGap onClick={() => insertBlankAt(slots.length)} />
          </div>
        </SortableContext>
      </DndContext>
    </aside>
  );
}

function InsertGap({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-center h-3 w-full text-zinc-400 hover:text-zinc-700 cursor-pointer"
      aria-label="Insert blank page here"
    >
      <span className="opacity-0 group-hover:opacity-100 text-[10px] leading-none border-t border-zinc-400 w-full mx-2 relative">
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-zinc-50 px-1">+ Blank</span>
      </span>
    </button>
  );
}

function SortableSlotThumb({
  slot,
  displayIndex,
  dataUrl,
  onRemove,
}: {
  slot: PageSlot;
  displayIndex: number;
  dataUrl: string | null;
  onRemove: () => void;
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
      className="group relative bg-white border border-zinc-300 rounded shadow-sm overflow-hidden cursor-grab active:cursor-grabbing touch-none"
    >
      <div className="absolute top-1 left-1 z-10 bg-zinc-700/75 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none">
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
          ×
        </Button>
      </div>
      {slot.kind === "blank" ? (
        <div className="flex items-center justify-center text-zinc-400 text-xs h-32 border border-dashed border-zinc-200 m-1 rounded bg-zinc-50">
          Blank
        </div>
      ) : dataUrl ? (
        <>
          <img src={dataUrl} alt="" className="block w-full h-auto" draggable={false} />
          {slot.kind === "external" && (
            <div className="absolute bottom-1 left-1 z-10 bg-amber-500/90 text-white text-[9px] uppercase tracking-wide px-1 py-0.5 rounded pointer-events-none">
              Read-only
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center text-zinc-300 text-xs h-32">…</div>
      )}
    </div>
  );
}
