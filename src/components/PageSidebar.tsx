import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { FilePlus2, Plus, Trash2 } from "lucide-react";
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
import type { LoadedSource } from "../lib/loadSource";

type Props = {
  slots: PageSlot[];
  /** All loaded sources, keyed by sourceKey. Sidebar reads them to
   *  size blanks against neighbouring pages and to render thumbs by
   *  downscaling each source's already-rendered canvas. */
  sources: Map<string, LoadedSource>;
  onSlotsChange: (next: PageSlot[]) => void;
  onAddExternalPdfs: (files: File[]) => void;
  /** Tailwind width class for the <aside>. Defaults to a desktop-rail
   *  size; the mobile drawer wrapper passes "w-full" so the aside
   *  fills the drawer's own width budget. */
  widthClass?: string;
  /** Called after a thumbnail tap scrolls the main view. The mobile
   *  drawer uses this to auto-close — otherwise the user taps a
   *  thumb, the page scrolls behind a drawer they can't see. */
  onSlotActivate?: () => void;
};

const THUMB_SCALE = 0.18;
const SOURCE_RENDER_SCALE = 1.5;

export function PageSidebar({
  slots,
  sources,
  onSlotsChange,
  onAddExternalPdfs,
  widthClass = "w-56",
  onSlotActivate,
}: Props) {
  const externalFileInputRef = useRef<HTMLInputElement | null>(null);
  /** Thumb cache. Keys: `${sourceKey}:${pageIndex}` — values are PNG
   *  data URLs so multiple <img> tags can share one entry. */
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map());
  const knownSourcesRef = useRef<Set<string>>(new Set());

  // When a source disappears (the user re-opened the primary PDF), drop
  // its cached thumbs so we don't keep stale entries around. Tracked by
  // the live set of known sourceKeys.
  useEffect(() => {
    const live = new Set(sources.keys());
    if (knownSourcesRef.current.size === 0) {
      knownSourcesRef.current = live;
      return;
    }
    let changed = false;
    for (const k of knownSourcesRef.current) {
      if (!live.has(k)) {
        changed = true;
        break;
      }
    }
    knownSourcesRef.current = live;
    if (!changed) return;
    setThumbs((prev) => {
      const next = new Map<string, string>();
      for (const [k, v] of prev) {
        const sourceKey = k.split(":")[0];
        if (live.has(sourceKey)) next.set(k, v);
      }
      return next;
    });
  }, [sources]);

  // For each page slot, downscale the already-rendered canvas via 2D
  // drawImage. Cheaper than re-running pdf.js because we already have
  // the source canvas in memory after eager extraction.
  useEffect(() => {
    const wanted: Array<{ key: string; src: HTMLCanvasElement }> = [];
    for (const slot of slots) {
      if (slot.kind !== "page") continue;
      const source = sources.get(slot.sourceKey);
      const rp = source?.pages[slot.sourcePageIndex];
      if (!rp) continue;
      const key = `${slot.sourceKey}:${slot.sourcePageIndex}`;
      if (thumbs.has(key)) continue;
      wanted.push({ key, src: rp.canvas });
    }
    if (wanted.length === 0) return;
    const factor = THUMB_SCALE / SOURCE_RENDER_SCALE;
    const additions = new Map<string, string>();
    for (const { key, src } of wanted) {
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
  }, [slots, sources]);

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

  const sourcesLoaded = sources.size > 0;

  return (
    <aside
      className={`flex-shrink-0 ${widthClass} h-full border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 overflow-y-auto py-2 [scrollbar-gutter:stable]`}
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
              <div key={slot.id}>
                <InsertGap onClick={() => insertBlankAt(idx)} />
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
      className="group flex items-center justify-center h-3 w-full text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
      aria-label="Insert blank page here"
    >
      <span className="opacity-0 group-hover:opacity-100 text-[10px] leading-none border-t border-zinc-400 dark:border-zinc-600 w-full mx-2 relative">
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-zinc-50 dark:bg-zinc-900 px-1">
          + Blank
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
      className="group relative bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded shadow-sm overflow-hidden cursor-pointer active:cursor-grabbing touch-none"
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
        <div className="flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-xs h-32 border border-dashed border-zinc-200 dark:border-zinc-700 m-1 rounded bg-zinc-50 dark:bg-zinc-900">
          Blank
        </div>
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
