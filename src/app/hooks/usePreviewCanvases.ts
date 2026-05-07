import { useEffect, useRef, useState } from "react";
import type { LoadedSource } from "@/lib/loadSource";
import type { PageStripSpec } from "@/lib/preview";
import type { PageSlot } from "@/domain/slots";
import type { EditValue, ImageMoveValue } from "@/components/PdfPage";

/** Rebuild the per-page preview canvases whenever the set of edited
 *  runs or moved images changes. Per-source — every affected source's
 *  doc gets its own buildPreviewBytes pass. The returned `previewCanvases`
 *  map is keyed by `${sourceKey}:${pageIndex}` so edits on external
 *  pages get their own preview canvas, not just primary pages. */
export function usePreviewCanvases({
  sources,
  slotById,
  edits,
  imageMoves,
  shapeDeletes,
  editingByPage,
  isMobile,
  renderScale,
}: {
  sources: Map<string, LoadedSource>;
  slotById: Map<string, PageSlot>;
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  shapeDeletes: Map<string, Set<string>>;
  editingByPage: Map<string, string>;
  isMobile: boolean;
  renderScale: number;
}) {
  const [previewCanvases, setPreviewCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map());
  /** Monotonic generation counter used to discard stale preview-rebuild
   *  results when the user keeps editing during the rebuild. */
  const previewGenRef = useRef(0);

  useEffect(() => {
    if (sources.size === 0) return;
    type SourceBuckets = {
      runIdsByPage: Map<number, Set<string>>;
      imageIdsByPage: Map<number, Set<string>>;
      shapeIdsByPage: Map<number, Set<string>>;
    };
    const bySource = new Map<string, SourceBuckets>();
    const get = (sourceKey: string): SourceBuckets => {
      let b = bySource.get(sourceKey);
      if (!b) {
        b = {
          runIdsByPage: new Map(),
          imageIdsByPage: new Map(),
          shapeIdsByPage: new Map(),
        };
        bySource.set(sourceKey, b);
      }
      return b;
    };
    const addRun = (sourceKey: string, pageIndex: number, runId: string) => {
      const b = get(sourceKey);
      const set = b.runIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(runId);
      b.runIdsByPage.set(pageIndex, set);
    };
    const addImage = (sourceKey: string, pageIndex: number, imageId: string) => {
      const b = get(sourceKey);
      const set = b.imageIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(imageId);
      b.imageIdsByPage.set(pageIndex, set);
    };
    const addShape = (sourceKey: string, pageIndex: number, shapeId: string) => {
      const b = get(sourceKey);
      const set = b.shapeIdsByPage.get(pageIndex) ?? new Set<string>();
      set.add(shapeId);
      b.shapeIdsByPage.set(pageIndex, set);
    };
    const sourceTupleFor = (slotId: string): [string, number] | null => {
      const slot = slotById.get(slotId);
      return slot && slot.kind === "page" ? [slot.sourceKey, slot.sourcePageIndex] : null;
    };
    for (const [slotId, runs] of edits) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const runId of runs.keys()) addRun(t[0], t[1], runId);
    }
    for (const [slotId, imgs] of imageMoves) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const [id, v] of imgs) {
        if (
          v.deleted ||
          (v.dx ?? 0) !== 0 ||
          (v.dy ?? 0) !== 0 ||
          (v.dw ?? 0) !== 0 ||
          (v.dh ?? 0) !== 0 ||
          v.targetSlotId !== undefined
        ) {
          addImage(t[0], t[1], id);
        }
      }
    }
    for (const [slotId, runId] of editingByPage) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      addRun(t[0], t[1], runId);
    }
    for (const [slotId, shapes] of shapeDeletes) {
      const t = sourceTupleFor(slotId);
      if (!t) continue;
      for (const shapeId of shapes) addShape(t[0], t[1], shapeId);
    }

    const tasks: Array<{ sourceKey: string; specs: PageStripSpec[] }> = [];
    for (const [sourceKey, b] of bySource) {
      const affected = new Set<number>([
        ...b.runIdsByPage.keys(),
        ...b.imageIdsByPage.keys(),
        ...b.shapeIdsByPage.keys(),
      ]);
      const specs: PageStripSpec[] = [];
      for (const pageIndex of affected) {
        const runIds = b.runIdsByPage.get(pageIndex) ?? new Set<string>();
        const imageIds = b.imageIdsByPage.get(pageIndex) ?? new Set<string>();
        const shapeIds = b.shapeIdsByPage.get(pageIndex) ?? new Set<string>();
        if (runIds.size === 0 && imageIds.size === 0 && shapeIds.size === 0) continue;
        specs.push({ pageIndex, runIds, imageIds, shapeIds });
      }
      if (specs.length > 0) tasks.push({ sourceKey, specs });
    }
    if (tasks.length === 0) {
      // oxlint-disable-next-line react-hooks/set-state-in-effect
      setPreviewCanvases((prev) => (prev.size === 0 ? prev : new Map<string, HTMLCanvasElement>()));
      return;
    }
    const gen = ++previewGenRef.current;
    let cancelled = false;
    // Mobile CPUs are slower; rebuild lag is more noticeable. Bump
    // the debounce so the user finishes a sustained edit (e.g.
    // typing in an EditField) before any rebuild kicks off.
    const debounceMs = isMobile ? 250 : 150;
    const handle = window.setTimeout(async () => {
      try {
        const { buildPreviewBytes, renderPagePreviewCanvas } = await import("@/lib/preview");
        const next = new Map<string, HTMLCanvasElement>();
        for (const { sourceKey, specs } of tasks) {
          const source = sources.get(sourceKey);
          if (!source) continue;
          const previewBytes = await buildPreviewBytes(source.bytes.slice(0), source.pages, specs);
          if (cancelled || previewGenRef.current !== gen) return;
          for (const spec of specs) {
            const canvas = await renderPagePreviewCanvas(previewBytes, spec.pageIndex, renderScale);
            if (cancelled || previewGenRef.current !== gen) return;
            next.set(`${sourceKey}:${spec.pageIndex}`, canvas);
          }
        }
        if (cancelled || previewGenRef.current !== gen) return;
        setPreviewCanvases(next);
      } catch (err) {
        console.warn("preview rebuild failed", err);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [sources, slotById, edits, imageMoves, shapeDeletes, editingByPage, isMobile, renderScale]);

  return { previewCanvases };
}
