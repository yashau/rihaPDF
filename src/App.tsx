import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { Check, FolderOpen, Image as ImageIcon, MousePointer2, Save, Type } from "lucide-react";
import { loadPdf, renderPage } from "./lib/pdf";
import type { RenderedPage } from "./lib/pdf";
import { extractPageFontShows } from "./lib/sourceFonts";
import { extractPageGlyphMaps } from "./lib/glyphMap";
import { extractPageImages } from "./lib/sourceImages";
import { PDFDocument } from "pdf-lib";
import {
  applyEditsAndSave,
  downloadBlob,
  type Edit,
  type ImageInsert,
  type ImageMove,
  type TextInsert,
} from "./lib/save";
import { buildPreviewBytes, renderPagePreviewCanvas, type PageStripSpec } from "./lib/preview";
import { readImageFile, type ImageInsertion, type TextInsertion } from "./lib/insertions";
import { PdfPage, type EditValue, type ImageMoveValue } from "./components/PdfPage";
import { PageSidebar } from "./components/PageSidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { externalSlot, slotsFromPages, type PageSlot } from "./lib/slots";
import { loadExternalPdf } from "./lib/externalPdf";
import { useTheme } from "./lib/theme";

export type ToolMode = "select" | "addText" | "addImage";

const RENDER_SCALE = 1.5;

export default function App() {
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [filename, setFilename] = useState<string | null>(null);
  const [originalBytes, setOriginalBytes] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  /** Ordered list of displayed pages. Each slot points back at a source
   *  page (`kind: "original"`) or is a fresh blank (`kind: "blank"`).
   *  Slot identity (`id`) is the stable key used to index per-page state
   *  so an entry follows its page through reorder. */
  const [slots, setSlots] = useState<PageSlot[]>([]);
  /** Map<slotId, Map<runId, EditValue>> */
  const [edits, setEdits] = useState<Map<string, Map<string, EditValue>>>(new Map());
  /** Map<slotId, Map<imageId, ImageMoveValue>> — drag offsets per
   *  image, identical shape to edits but for image XObject placements. */
  const [imageMoves, setImageMoves] = useState<Map<string, Map<string, ImageMoveValue>>>(new Map());
  const [busy, setBusy] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Per-source-page replacement canvases produced by the live preview
   *  pipeline. Keyed by SOURCE page index (not slotId) because the
   *  strip operates on the original PDF — multiple slots referencing
   *  the same source share the same preview canvas. */
  const [previewCanvases, setPreviewCanvases] = useState<Map<number, HTMLCanvasElement>>(new Map());
  /** Monotonic generation counter used to discard stale preview-rebuild
   *  results when the user keeps editing during the rebuild. */
  const previewGenRef = useRef(0);
  /** Mirror of `slots` so callbacks that need slotIndex→slotId lookups
   *  (cross-page insertion drags land via slot index from PdfPage's
   *  hit-test) don't re-create on every slot mutation. */
  const slotsRef = useRef<PageSlot[]>([]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  /** Map<slotId, currently-open runId> — populated by PdfPage's
   *  onEditingChange. Folded into the preview-strip spec so an open
   *  editor immediately hides the original glyph behind it. */
  const [editingByPage, setEditingByPage] = useState<Map<string, string>>(new Map());
  /** Tool mode for click-to-place actions ("select" = no insertion;
   *  "addText" = next click on a page drops a new text box; "addImage"
   *  = next click drops the pending image at that position). */
  const [tool, setTool] = useState<ToolMode>("select");
  /** Per-slot net-new text/image insertions — separate from edits
   *  because they don't reference an existing run/image. Keyed by
   *  slotId so an insertion follows its slot through reorder. */
  const [insertedTexts, setInsertedTexts] = useState<Map<string, TextInsertion[]>>(new Map());
  const [insertedImages, setInsertedImages] = useState<Map<string, ImageInsertion[]>>(new Map());
  /** Currently-selected object — set by single-click on an image
   *  overlay; cleared by Escape, by clicking elsewhere, or by tool
   *  changes. The keyboard delete shortcut targets this; the toolbar
   *  trash button (where applicable) does too. Text editing has its
   *  own focus model so text runs don't enter this state. */
  const [selection, setSelection] = useState<
    | { kind: "image"; slotId: string; imageId: string }
    | { kind: "insertedImage"; slotId: string; id: string }
    | null
  >(null);
  /** Bytes for each loaded external PDF, keyed by sourceKey. The save
   *  pipeline reads these to copyPages from the right doc. */
  const [externalSources, setExternalSources] = useState<Map<string, ArrayBuffer>>(new Map());
  /** Per-source rendered pages used to display external slots in the
   *  main view + to power their sidebar thumbnails. Read-only for v1
   *  so we only need the canvas — no fonts/glyph maps. */
  const [externalRendered, setExternalRendered] = useState<Map<string, RenderedPage[]>>(new Map());
  /** When the user picks an image file, we hold its bytes here until
   *  they click on a page to place it. Cleared on placement / cancel. */
  const [pendingImage, setPendingImage] = useState<{
    bytes: Uint8Array;
    format: "png" | "jpeg";
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const forPdfJs = buf.slice(0);
      const forSave = buf.slice(0);
      const forFonts = buf.slice(0);
      const forGlyphMaps = buf.slice(0);
      const forImages = buf.slice(0);
      const [doc, fontShowsByPage, glyphsDoc, imagesByPage] = await Promise.all([
        loadPdf(forPdfJs),
        extractPageFontShows(forFonts),
        PDFDocument.load(forGlyphMaps, { ignoreEncryption: true }),
        extractPageImages(forImages),
      ]);
      const rendered: RenderedPage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const glyphMaps = extractPageGlyphMaps(glyphsDoc, i - 1);
        rendered.push(
          await renderPage(
            page,
            RENDER_SCALE,
            fontShowsByPage[i - 1] ?? [],
            glyphMaps,
            imagesByPage[i - 1] ?? [],
          ),
        );
      }
      setFilename(file.name);
      setOriginalBytes(forSave);
      setPages(rendered);
      setSlots(slotsFromPages(rendered));
      // Dev-only: expose run.contentStreamOpIndices to E2E tests so a
      // probe can inspect what the strip pipeline thinks each run owns
      // without re-running the whole extractor in the browser.
      (
        window as unknown as {
          __runOpIndices?: Map<string, number[]>;
        }
      ).__runOpIndices = new Map(
        rendered.flatMap((p) => p.textRuns.map((r) => [r.id, r.contentStreamOpIndices])),
      );
      setEdits(new Map());
      setImageMoves(new Map());
      setPreviewCanvases(new Map());
      setInsertedTexts(new Map());
      setInsertedImages(new Map());
      setExternalSources(new Map());
      setExternalRendered(new Map());
      setTool("select");
      setPendingImage(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onEdit = useCallback((slotId: string, runId: string, value: EditValue) => {
    // Convert PdfPage's drop-time `targetPageIndex` (current slot
    // index) to the stable `targetSlotId` so the cross-page target
    // survives reorder. PdfPage never reads `targetSlotId`; App
    // re-derives `targetPageIndex` per render before passing back.
    let stored: EditValue = value;
    if (value.targetPageIndex !== undefined) {
      const targetSlot = slotsRef.current[value.targetPageIndex];
      stored = {
        ...value,
        targetPageIndex: undefined,
        targetSlotId: targetSlot?.id,
      };
    } else {
      stored = { ...value, targetSlotId: undefined };
    }
    setEdits((prev) => {
      const next = new Map(prev);
      const pageMap = new Map<string, EditValue>(next.get(slotId) ?? []);
      pageMap.set(runId, stored);
      next.set(slotId, pageMap);
      return next;
    });
  }, []);

  const onSelectImage = useCallback((slotId: string, imageId: string) => {
    setSelection({ kind: "image", slotId, imageId });
  }, []);
  const onSelectInsertedImage = useCallback((slotId: string, id: string) => {
    setSelection({ kind: "insertedImage", slotId, id });
  }, []);

  /** Delete whatever's currently selected. For source images this means
   *  flipping `deleted=true` on the stored ImageMoveValue (so save
   *  strips the q…Q block); for inserted images we just drop the
   *  entry from the slot's bucket. Selection is cleared either way. */
  const onDeleteSelection = useCallback(() => {
    setSelection((current) => {
      if (!current) return null;
      if (current.kind === "image") {
        setImageMoves((prev) => {
          const next = new Map(prev);
          const pageMap = new Map<string, ImageMoveValue>(next.get(current.slotId) ?? []);
          const existing = pageMap.get(current.imageId) ?? {};
          pageMap.set(current.imageId, { ...existing, deleted: true });
          next.set(current.slotId, pageMap);
          return next;
        });
      } else if (current.kind === "insertedImage") {
        setInsertedImages((prev) => {
          const next = new Map(prev);
          const arr = (next.get(current.slotId) ?? []).filter((m) => m.id !== current.id);
          next.set(current.slotId, arr);
          return next;
        });
      }
      return null;
    });
  }, []);

  // Window-level Delete / Backspace handler. The input-focus guard is
  // critical: without it, every Backspace inside the EditField text
  // input would also delete the selected image, which surprises users
  // mid-edit.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement).isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      onDeleteSelection();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onEsc);
    };
  }, [selection, onDeleteSelection]);

  // Click-outside handler: any window click that wasn't stop-propagated
  // by an overlay falls through to here and clears selection. Overlay
  // onClick callbacks call e.stopPropagation() so a click on a
  // selected image keeps the selection.
  useEffect(() => {
    if (!selection) return;
    const onClick = () => setSelection(null);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [selection]);

  const onImageMove = useCallback((slotId: string, imageId: string, value: ImageMoveValue) => {
    let stored: ImageMoveValue = value;
    if (value.targetPageIndex !== undefined) {
      const targetSlot = slotsRef.current[value.targetPageIndex];
      stored = {
        ...value,
        targetPageIndex: undefined,
        targetSlotId: targetSlot?.id,
      };
    } else {
      stored = { ...value, targetSlotId: undefined };
    }
    setImageMoves((prev) => {
      const next = new Map(prev);
      const pageMap = new Map<string, ImageMoveValue>(next.get(slotId) ?? []);
      pageMap.set(imageId, stored);
      next.set(slotId, pageMap);
      return next;
    });
  }, []);

  // Rebuild the per-page preview canvases whenever the set of edited
  // runs or moved images changes. The preview is a copy of the source
  // PDF with those items REMOVED from the content stream — pdf.js then
  // renders a clean canvas for each affected page, and the HTML
  // overlays in PdfPage paint the moved/edited content on top with
  // nothing to hide. Debounced so a fast edit loop doesn't spawn a
  // dozen overlapping renders.
  useEffect(() => {
    if (!originalBytes || pages.length === 0) return;
    // Group slot-keyed strip work by source-page index so each source
    // page is stripped at most once even if multiple slots reference
    // it. (Phase 1 has 1:1 slot↔source mapping but the grouping is
    // also future-proof for duplicate slots.)
    const slotById = new Map<string, PageSlot>(slots.map((s) => [s.id, s]));
    const sourceIndexFor = (slotId: string): number | null => {
      const slot = slotById.get(slotId);
      return slot && slot.kind === "original" ? slot.sourceIndex : null;
    };
    const runIdsBySource = new Map<number, Set<string>>();
    const imageIdsBySource = new Map<number, Set<string>>();
    const addRun = (sourceIndex: number, runId: string) => {
      const set = runIdsBySource.get(sourceIndex) ?? new Set<string>();
      set.add(runId);
      runIdsBySource.set(sourceIndex, set);
    };
    const addImage = (sourceIndex: number, imageId: string) => {
      const set = imageIdsBySource.get(sourceIndex) ?? new Set<string>();
      set.add(imageId);
      imageIdsBySource.set(sourceIndex, set);
    };
    for (const [slotId, runs] of edits) {
      const si = sourceIndexFor(slotId);
      if (si == null) continue;
      for (const runId of runs.keys()) addRun(si, runId);
    }
    for (const [slotId, imgs] of imageMoves) {
      const si = sourceIndexFor(slotId);
      if (si == null) continue;
      for (const [id, v] of imgs) {
        // Stored entries carry `targetSlotId` (cross-page) — the
        // pre-storage `targetPageIndex` is stripped by onImageMove.
        // Deletion always strips, even with no movement.
        if (
          v.deleted ||
          (v.dx ?? 0) !== 0 ||
          (v.dy ?? 0) !== 0 ||
          (v.dw ?? 0) !== 0 ||
          (v.dh ?? 0) !== 0 ||
          v.targetSlotId !== undefined
        ) {
          addImage(si, id);
        }
      }
    }
    for (const [slotId, runId] of editingByPage) {
      const si = sourceIndexFor(slotId);
      if (si == null) continue;
      // Currently-open editor counts as "needs strip" too — we want
      // the original to vanish the moment the input appears, not only
      // after commit.
      addRun(si, runId);
    }
    const specs: PageStripSpec[] = [];
    const affectedSources = new Set<number>([...runIdsBySource.keys(), ...imageIdsBySource.keys()]);
    for (const sourceIndex of affectedSources) {
      const runIds = runIdsBySource.get(sourceIndex) ?? new Set<string>();
      const imageIds = imageIdsBySource.get(sourceIndex) ?? new Set<string>();
      if (runIds.size === 0 && imageIds.size === 0) continue;
      specs.push({ pageIndex: sourceIndex, runIds, imageIds });
    }
    if (specs.length === 0) {
      // Nothing left modified — drop any cached preview canvases so the
      // pristine `page.canvas` shows again. We're already in a render-
      // triggered effect; the cascading re-render here is intentional
      // (one extra paint to clear the preview).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewCanvases((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const gen = ++previewGenRef.current;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const previewBytes = await buildPreviewBytes(originalBytes.slice(0), pages, specs);
        if (cancelled || previewGenRef.current !== gen) return;
        const next = new Map<number, HTMLCanvasElement>();
        for (const spec of specs) {
          const canvas = await renderPagePreviewCanvas(previewBytes, spec.pageIndex, RENDER_SCALE);
          if (cancelled || previewGenRef.current !== gen) return;
          next.set(spec.pageIndex, canvas);
        }
        if (cancelled || previewGenRef.current !== gen) return;
        setPreviewCanvases(next);
      } catch (err) {
        // Don't tear down editing on a preview failure — fall back to
        // the original canvas (the user just sees the old glyphs along
        // with overlays, same as before this feature).
        console.warn("preview rebuild failed", err);
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [originalBytes, pages, slots, edits, imageMoves, editingByPage]);

  const onEditingChange = useCallback((slotId: string, runId: string | null) => {
    setEditingByPage((prev) => {
      const next = new Map(prev);
      if (runId) next.set(slotId, runId);
      else next.delete(slotId);
      return next;
    });
  }, []);

  /** Handle a click on a page when a tool mode is active — drops a new
   *  text/image insertion at the click position (PDF user space). The
   *  insertion is bucketed by slotId (so it follows reorder) but its
   *  internal `pageIndex` field is the current slot index, used by the
   *  save pipeline to address pdf-lib's docPages array. */
  const onCanvasClick = useCallback(
    (slotId: string, pageIndex: number, pdfX: number, pdfY: number) => {
      if (tool === "addText") {
        const id = `p${pageIndex + 1}-t${Date.now().toString(36)}`;
        // Default font size: 12pt — tweakable via the editor toolbar.
        const ins: TextInsertion = {
          id,
          pageIndex,
          pdfX,
          pdfY,
          pdfWidth: 120,
          fontSize: 12,
          text: "",
        };
        setInsertedTexts((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(slotId) ?? []), ins];
          next.set(slotId, arr);
          return next;
        });
        setTool("select");
        // Open the editor for the brand-new text box automatically.
        setEditingByPage((prev) => {
          const next = new Map(prev);
          next.set(slotId, id);
          return next;
        });
        return;
      }
      if (tool === "addImage" && pendingImage) {
        const id = `p${pageIndex + 1}-ni${Date.now().toString(36)}`;
        // Drop with a sensible initial size: scale to fit ~200pt wide
        // while preserving aspect ratio, capped to the picture's
        // natural pixel dimensions but never smaller than 30pt — a
        // 1×1 source PNG would otherwise produce a sub-pixel overlay
        // the user can't grab.
        const targetW = Math.min(Math.max(pendingImage.naturalWidth, 30), 200);
        const aspect = pendingImage.naturalHeight / pendingImage.naturalWidth;
        const w = targetW;
        const h = targetW * aspect;
        const ins: ImageInsertion = {
          id,
          pageIndex,
          pdfX: pdfX - w / 2,
          pdfY: pdfY - h / 2,
          pdfWidth: w,
          pdfHeight: h,
          bytes: pendingImage.bytes,
          format: pendingImage.format,
        };
        setInsertedImages((prev) => {
          const next = new Map(prev);
          const arr = [...(next.get(slotId) ?? []), ins];
          next.set(slotId, arr);
          return next;
        });
        setPendingImage(null);
        setTool("select");
      }
    },
    [tool, pendingImage],
  );

  /** Update an inserted text box (text/style/position changes). When
   *  `patch.pageIndex` (the destination slot index) differs from the
   *  source slot, the entry is moved between slot buckets — this is
   *  how a cross-page drag lands. */
  const onTextInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<TextInsertion>) => {
      setInsertedTexts((prev) => {
        const next = new Map(prev);
        const fromArr = next.get(sourceSlotId) ?? [];
        const item = fromArr.find((t) => t.id === id);
        if (!item) return prev;
        // patch.pageIndex (when present) is the destination slot index
        // returned by PdfPage's cross-page hit-test. Resolve to slotId
        // via the current slots array so reorder doesn't strand it.
        const targetSlotId =
          patch.pageIndex !== undefined && patch.pageIndex !== item.pageIndex
            ? (slotsRef.current[patch.pageIndex]?.id ?? sourceSlotId)
            : sourceSlotId;
        const updated: TextInsertion = { ...item, ...patch };
        if (targetSlotId !== sourceSlotId) {
          next.set(
            sourceSlotId,
            fromArr.filter((t) => t.id !== id),
          );
          next.set(targetSlotId, [...(next.get(targetSlotId) ?? []), updated]);
        } else {
          next.set(
            sourceSlotId,
            fromArr.map((t) => (t.id === id ? updated : t)),
          );
        }
        return next;
      });
    },
    [],
  );
  const onTextInsertDelete = useCallback((slotId: string, id: string) => {
    setInsertedTexts((prev) => {
      const next = new Map(prev);
      const arr = (next.get(slotId) ?? []).filter((t) => t.id !== id);
      next.set(slotId, arr);
      return next;
    });
  }, []);
  const onImageInsertChange = useCallback(
    (sourceSlotId: string, id: string, patch: Partial<ImageInsertion>) => {
      setInsertedImages((prev) => {
        const next = new Map(prev);
        const fromArr = next.get(sourceSlotId) ?? [];
        const item = fromArr.find((m) => m.id === id);
        if (!item) return prev;
        const targetSlotId =
          patch.pageIndex !== undefined && patch.pageIndex !== item.pageIndex
            ? (slotsRef.current[patch.pageIndex]?.id ?? sourceSlotId)
            : sourceSlotId;
        const updated: ImageInsertion = { ...item, ...patch };
        if (targetSlotId !== sourceSlotId) {
          next.set(
            sourceSlotId,
            fromArr.filter((m) => m.id !== id),
          );
          next.set(targetSlotId, [...(next.get(targetSlotId) ?? []), updated]);
        } else {
          next.set(
            sourceSlotId,
            fromArr.map((m) => (m.id === id ? updated : m)),
          );
        }
        return next;
      });
    },
    [],
  );
  const onImageInsertDelete = useCallback((slotId: string, id: string) => {
    setInsertedImages((prev) => {
      const next = new Map(prev);
      const arr = (next.get(slotId) ?? []).filter((m) => m.id !== id);
      next.set(slotId, arr);
      return next;
    });
  }, []);

  /** "+ From PDF" handler: load one or more external PDFs, render
   *  every page, and append slots in pick order. External slots are
   *  read-only (v1) — display + reorder + delete, no text editing.
   *  Save copies them out of each external doc via pdf-lib's copyPages.
   *  Files are processed sequentially so the busy flag and slot order
   *  stay coherent even when several files land at once. */
  const onAddExternalPdfs = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (const file of files) {
        const { bytes, rendered, sourceKey } = await loadExternalPdf(file, RENDER_SCALE);
        setExternalSources((prev) => {
          const next = new Map(prev);
          next.set(sourceKey, bytes);
          return next;
        });
        setExternalRendered((prev) => {
          const next = new Map(prev);
          next.set(sourceKey, rendered);
          return next;
        });
        setSlots((prev) => [...prev, ...rendered.map((_, i) => externalSlot(sourceKey, i))]);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const onPickImageFile = useCallback(async (file: File) => {
    const parsed = await readImageFile(file);
    if (!parsed) {
      console.warn("Unsupported image format (PNG/JPEG only):", file.name);
      return;
    }
    setPendingImage(parsed);
    setTool("addImage");
  }, []);

  const onSave = useCallback(async () => {
    if (!originalBytes || !filename) return;
    setBusy(true);
    try {
      // Translate slotId-keyed state back to source-page-index keys
      // for the legacy save pipeline. Phase 1 has slots 1:1 with
      // pages so every slot maps to its source; blanks (none yet
      // in Phase 1) carry no per-slot edits and would be skipped.
      const sourceIndexBySlotId = new Map<string, number>();
      for (const slot of slots) {
        if (slot.kind === "original") sourceIndexBySlotId.set(slot.id, slot.sourceIndex);
      }
      const flatEdits: Edit[] = [];
      for (const [slotId, runs] of edits) {
        const pageIndex = sourceIndexBySlotId.get(slotId);
        if (pageIndex == null) continue;
        for (const [runId, value] of runs) {
          // Cross-page target: prefer the stable targetSlotId
          // (populated by onEdit) over the legacy targetPageIndex
          // shape. Resolve to the target's CURRENT source-page index.
          const targetPageIndex =
            value.targetSlotId !== undefined
              ? sourceIndexBySlotId.get(value.targetSlotId)
              : undefined;
          flatEdits.push({
            pageIndex,
            runId,
            newText: value.text,
            style: value.style,
            dx: value.dx,
            dy: value.dy,
            targetPageIndex,
            targetPdfX: value.targetPdfX,
            targetPdfY: value.targetPdfY,
            deleted: value.deleted,
          });
        }
      }
      const flatImageMoves: ImageMove[] = [];
      for (const [slotId, imgs] of imageMoves) {
        const pageIndex = sourceIndexBySlotId.get(slotId);
        if (pageIndex == null) continue;
        for (const [imageId, value] of imgs) {
          const dx = value.dx ?? 0;
          const dy = value.dy ?? 0;
          const dw = value.dw ?? 0;
          const dh = value.dh ?? 0;
          const isCrossPage = value.targetSlotId !== undefined;
          // Skip no-op entries (no movement, no resize, no cross-page,
          // not deleted). A `deleted` value still needs to flow through
          // even when dx/dy/dw/dh are all zero.
          if (!isCrossPage && !value.deleted && dx === 0 && dy === 0 && dw === 0 && dh === 0)
            continue;
          const targetPageIndex =
            value.targetSlotId !== undefined
              ? sourceIndexBySlotId.get(value.targetSlotId)
              : undefined;
          flatImageMoves.push({
            pageIndex,
            imageId,
            dx,
            dy,
            dw,
            dh,
            targetPageIndex,
            targetPdfX: value.targetPdfX,
            targetPdfY: value.targetPdfY,
            targetPdfWidth: value.targetPdfWidth,
            targetPdfHeight: value.targetPdfHeight,
            deleted: value.deleted,
          });
        }
      }
      const flatTextInserts: TextInsert[] = [];
      for (const [slotId, arr] of insertedTexts) {
        const pageIndex = sourceIndexBySlotId.get(slotId);
        if (pageIndex == null) continue;
        for (const t of arr) {
          if (!t.text || t.text.trim().length === 0) continue;
          flatTextInserts.push({
            pageIndex,
            pdfX: t.pdfX,
            pdfY: t.pdfY,
            fontSize: t.fontSize,
            text: t.text,
            style: t.style,
          });
        }
      }
      const flatImageInserts: ImageInsert[] = [];
      for (const [slotId, arr] of insertedImages) {
        const pageIndex = sourceIndexBySlotId.get(slotId);
        if (pageIndex == null) continue;
        for (const i of arr) {
          flatImageInserts.push({
            pageIndex,
            pdfX: i.pdfX,
            pdfY: i.pdfY,
            pdfWidth: i.pdfWidth,
            pdfHeight: i.pdfHeight,
            bytes: i.bytes,
            format: i.format,
          });
        }
      }
      const out = await applyEditsAndSave(
        originalBytes,
        pages,
        flatEdits,
        slots,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        externalSources,
      );
      const baseName = filename.replace(/\.pdf$/i, "");
      downloadBlob(out, `${baseName}.edited.pdf`);
    } finally {
      setBusy(false);
    }
  }, [
    originalBytes,
    filename,
    slots,
    edits,
    imageMoves,
    pages,
    insertedTexts,
    insertedImages,
    externalSources,
  ]);

  const totalEdits = Array.from(edits.values()).reduce((sum, m) => sum + m.size, 0);
  const totalImageMoves = Array.from(imageMoves.values()).reduce((sum, m) => sum + m.size, 0);
  const totalInsertedTexts = Array.from(insertedTexts.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  const totalInsertedImages = Array.from(insertedImages.values()).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  // Count structural changes vs the initial 1:1 slots/pages state:
  // sources missing from `slots` are deletions; "blank" slots are
  // inserts. Reorder isn't counted as a structural change for Save's
  // dirty bit because reordering the same set of pages still produces
  // a different output and warrants saving on its own.
  const slotOriginalCount = slots.reduce((n, s) => n + (s.kind === "original" ? 1 : 0), 0);
  const blankSlotCount = slots.reduce((n, s) => n + (s.kind === "blank" ? 1 : 0), 0);
  const externalSlotCount = slots.reduce((n, s) => n + (s.kind === "external" ? 1 : 0), 0);
  const removedSourceCount = Math.max(0, pages.length - slotOriginalCount);
  // Real reorder = the surviving originals appear out of source order.
  // Deleting page 0 leaves [1, 2, ...] which is still ascending and
  // shouldn't be flagged.
  const origSourceOrder: number[] = [];
  for (const s of slots) {
    if (s.kind === "original") origSourceOrder.push(s.sourceIndex);
  }
  const slotsReordered = origSourceOrder.some((si, i) => i > 0 && si < origSourceOrder[i - 1]);
  const structuralOpCount =
    removedSourceCount + blankSlotCount + externalSlotCount + (slotsReordered ? 1 : 0);

  return (
    <div className="flex flex-col h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <header className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex items-center gap-2 mr-4 cursor-pointer rounded hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="About rihaPDF"
        >
          <img src="/riha-logo.png" alt="" className="h-7 w-auto" />
          <h1 className="text-lg font-semibold">rihaPDF</h1>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          data-testid="open-pdf-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <Button variant="primary" isDisabled={busy} onPress={() => fileInputRef.current?.click()}>
          <FolderOpen size={16} aria-hidden />
          Open PDF
        </Button>
        <Button
          variant="secondary"
          isDisabled={
            !originalBytes ||
            busy ||
            totalEdits +
              totalImageMoves +
              structuralOpCount +
              totalInsertedTexts +
              totalInsertedImages ===
              0
          }
          onPress={() => void onSave()}
        >
          <Save size={16} aria-hidden />
          Save ({totalEdits} edit{totalEdits === 1 ? "" : "s"}
          {totalImageMoves
            ? `, ${totalImageMoves} image move${totalImageMoves === 1 ? "" : "s"}`
            : ""}
          {totalInsertedTexts
            ? `, +${totalInsertedTexts} text${totalInsertedTexts === 1 ? "" : "s"}`
            : ""}
          {totalInsertedImages
            ? `, +${totalInsertedImages} image${totalInsertedImages === 1 ? "" : "s"}`
            : ""}
          {removedSourceCount ? `, -${removedSourceCount} page` : ""}
          {blankSlotCount ? `, +${blankSlotCount} blank` : ""}
          {externalSlotCount ? `, +${externalSlotCount} from PDF` : ""}
          {slotsReordered ? ", reordered" : ""})
        </Button>
        <div className="flex items-center gap-1 ml-2 border-l pl-3">
          <Button
            size="sm"
            variant={tool === "select" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              setTool("select");
              setPendingImage(null);
            }}
          >
            <MousePointer2 size={14} aria-hidden />
            Select
          </Button>
          <Button
            size="sm"
            variant={tool === "addText" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              setTool((t) => (t === "addText" ? "select" : "addText"));
              setPendingImage(null);
            }}
          >
            <Type size={14} aria-hidden />+ Text
          </Button>
          <Button
            size="sm"
            variant={tool === "addImage" ? "primary" : "ghost"}
            isDisabled={busy || pages.length === 0}
            onPress={() => {
              if (tool === "addImage") {
                setTool("select");
                setPendingImage(null);
              } else {
                imageFileInputRef.current?.click();
              }
            }}
          >
            <ImageIcon size={14} aria-hidden />+ Image
            {pendingImage ? <Check size={14} aria-label="image queued" /> : null}
          </Button>
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImageFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <span className="text-sm text-zinc-500 dark:text-zinc-400 ml-auto">
          {tool === "addText"
            ? "Click on a page to drop a text box"
            : tool === "addImage" && pendingImage
              ? "Click on a page to place the image"
              : (filename ?? "No file loaded")}
        </span>
        <div className="flex items-center border-l border-zinc-200 dark:border-zinc-800 pl-3 ml-1">
          <ThemeToggle mode={themeMode} onChange={setThemeMode} />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {slots.length > 0 && (
          <PageSidebar
            slots={slots}
            pages={pages}
            originalBytes={originalBytes}
            externalRendered={externalRendered}
            onSlotsChange={setSlots}
            onAddExternalPdfs={(files) => void onAddExternalPdfs(files)}
          />
        )}
        <main className="flex-1 overflow-auto px-6 py-6">
          {slots.length === 0 ? (
            <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-500">
              Open a PDF to begin. Double-click any text fragment to edit it.
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6">
              {slots.map((slot, idx) => {
                if (slot.kind === "blank") {
                  return (
                    <div
                      key={slot.id}
                      className="bg-white dark:bg-zinc-800 border border-dashed border-zinc-300 dark:border-zinc-600 rounded shadow-sm flex items-center justify-center text-zinc-300 dark:text-zinc-500 text-sm"
                      style={{
                        width: slot.size[0] * RENDER_SCALE,
                        height: slot.size[1] * RENDER_SCALE,
                      }}
                    >
                      (blank)
                    </div>
                  );
                }
                if (slot.kind === "external") {
                  const rp = externalRendered.get(slot.sourceKey)?.[slot.sourcePageIndex];
                  if (!rp) return null;
                  return <ExternalPageView key={slot.id} page={rp} displayIndex={idx} />;
                }
                const page = pages[slot.sourceIndex];
                if (!page) return null;
                // Re-derive cross-page targetPageIndex from the stable
                // targetSlotId so reorder doesn't strand overlays.
                // Stored entries with no cross-page state pass through.
                const slotIndexById = (id: string | undefined) => {
                  if (!id) return -1;
                  return slots.findIndex((s) => s.id === id);
                };
                const editsForSlot = new Map<string, EditValue>();
                const storedEdits = edits.get(slot.id);
                if (storedEdits) {
                  for (const [runId, v] of storedEdits) {
                    if (v.targetSlotId) {
                      const i = slotIndexById(v.targetSlotId);
                      if (i >= 0) {
                        editsForSlot.set(runId, {
                          ...v,
                          targetPageIndex: i,
                          targetSlotId: undefined,
                        });
                      } else {
                        editsForSlot.set(runId, {
                          ...v,
                          targetPageIndex: undefined,
                          targetSlotId: undefined,
                          targetPdfX: undefined,
                          targetPdfY: undefined,
                        });
                      }
                    } else {
                      editsForSlot.set(runId, v);
                    }
                  }
                }
                const imageMovesForSlot = new Map<string, ImageMoveValue>();
                const storedMoves = imageMoves.get(slot.id);
                if (storedMoves) {
                  for (const [imageId, v] of storedMoves) {
                    if (v.targetSlotId) {
                      const i = slotIndexById(v.targetSlotId);
                      if (i >= 0) {
                        imageMovesForSlot.set(imageId, {
                          ...v,
                          targetPageIndex: i,
                          targetSlotId: undefined,
                        });
                      } else {
                        imageMovesForSlot.set(imageId, {
                          ...v,
                          targetPageIndex: undefined,
                          targetSlotId: undefined,
                          targetPdfX: undefined,
                          targetPdfY: undefined,
                          targetPdfWidth: undefined,
                          targetPdfHeight: undefined,
                        });
                      }
                    } else {
                      imageMovesForSlot.set(imageId, v);
                    }
                  }
                }
                const selectedImageId =
                  selection?.kind === "image" && selection.slotId === slot.id
                    ? selection.imageId
                    : null;
                const selectedInsertedImageId =
                  selection?.kind === "insertedImage" && selection.slotId === slot.id
                    ? selection.id
                    : null;
                return (
                  <PageWithToolbar
                    key={slot.id}
                    page={page}
                    pageIndex={idx}
                    edits={editsForSlot}
                    imageMoves={imageMovesForSlot}
                    insertedTexts={insertedTexts.get(slot.id) ?? []}
                    insertedImages={insertedImages.get(slot.id) ?? []}
                    previewCanvas={previewCanvases.get(slot.sourceIndex) ?? null}
                    tool={tool}
                    editingId={editingByPage.get(slot.id) ?? null}
                    selectedImageId={selectedImageId}
                    selectedInsertedImageId={selectedInsertedImageId}
                    onEdit={(runId, value) => onEdit(slot.id, runId, value)}
                    onImageMove={(imageId, value) => onImageMove(slot.id, imageId, value)}
                    onEditingChange={(runId) => onEditingChange(slot.id, runId)}
                    onCanvasClick={(pdfX, pdfY) => onCanvasClick(slot.id, idx, pdfX, pdfY)}
                    onTextInsertChange={(id, patch) => onTextInsertChange(slot.id, id, patch)}
                    onTextInsertDelete={(id) => onTextInsertDelete(slot.id, id)}
                    onImageInsertChange={(id, patch) => onImageInsertChange(slot.id, id, patch)}
                    onImageInsertDelete={(id) => onImageInsertDelete(slot.id, id)}
                    onSelectImage={(imageId) => onSelectImage(slot.id, imageId)}
                    onSelectInsertedImage={(id) => onSelectInsertedImage(slot.id, id)}
                  />
                );
              })}
            </div>
          )}
        </main>
      </div>
      <AboutModal isOpen={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}

function AboutModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>rihaPDF</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-5 text-sm text-zinc-800 dark:text-zinc-200">
              <section className="flex flex-col items-center text-center gap-3">
                <img src="/riha-logo.png" alt="" className="h-28 w-auto" />
                <p>
                  Browser-based PDF editor focused on Dhivehi / Thaana documents. Click any text run
                  on a page, type a replacement, save. The saved PDF contains real, selectable,
                  searchable text — original glyphs are surgically removed and replaced with new
                  ones rendered in the correct font. rihaPDF is{" "}
                  <a
                    href="https://github.com/yashau/rihaPDF"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    open source
                  </a>{" "}
                  and contributions are welcome.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Features</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>Edit existing text runs in place</li>
                  <li>Insert new text and images anywhere on a page</li>
                  <li>Move and resize inserted images; move text and image runs</li>
                  <li>Saved PDFs keep real, selectable, searchable text</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Built with</h3>
                <ul className="list-disc list-inside space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  <li>React 19 + TypeScript + Vite</li>
                  <li>Tailwind CSS + HeroUI + lucide-react</li>
                  <li>pdf-lib (write) and pdfjs-dist (render)</li>
                  <li>Runs entirely in the browser — no server, no upload</li>
                </ul>
              </section>

              <section>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-1">Author</h3>
                <p className="text-zinc-700 dark:text-zinc-300">Ibrahim Yashau</p>
                <ul className="mt-1 space-y-0.5">
                  <li>
                    <a
                      href="https://yashau.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      yashau.com
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:ibrahim@yashau.com"
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      ibrahim@yashau.com
                    </a>
                  </li>
                </ul>
              </section>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Read-only view for an "insert from PDF" slot. Mounts the rendered
 *  canvas and shows a "Read-only" badge — no edits / inserts / cross-
 *  page targets. Without `data-page-index` the cross-page hit-test
 *  also can't pick this as a drop target, so external pages stay
 *  immutable in v1. */
function ExternalPageView({ page, displayIndex }: { page: RenderedPage; displayIndex: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  /* eslint-disable-next-line react-hooks/immutability */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.replaceChildren();
    /* eslint-disable react-hooks/immutability */
    page.canvas.style.display = "block";
    page.canvas.style.width = `${page.viewWidth}px`;
    page.canvas.style.height = `${page.viewHeight}px`;
    /* eslint-enable react-hooks/immutability */
    node.appendChild(page.canvas);
  }, [page]);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Page {displayIndex + 1}</span>
        <span className="text-[10px] uppercase tracking-wide bg-amber-500/90 text-white px-1.5 py-0.5 rounded">
          Read-only
        </span>
      </div>
      <div
        ref={ref}
        className="relative border border-zinc-300 dark:border-zinc-700 shadow-sm bg-white"
        style={{ width: page.viewWidth, height: page.viewHeight }}
      />
    </div>
  );
}

function PageWithToolbar({
  page,
  pageIndex,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  previewCanvas,
  tool,
  editingId,
  selectedImageId,
  selectedInsertedImageId,
  onEdit,
  onImageMove,
  onEditingChange,
  onCanvasClick,
  onTextInsertChange,
  onTextInsertDelete,
  onImageInsertChange,
  onImageInsertDelete,
  onSelectImage,
  onSelectInsertedImage,
}: {
  page: RenderedPage;
  pageIndex: number;
  edits: Map<string, EditValue>;
  imageMoves: Map<string, ImageMoveValue>;
  insertedTexts: TextInsertion[];
  insertedImages: ImageInsertion[];
  previewCanvas: HTMLCanvasElement | null;
  tool: ToolMode;
  editingId: string | null;
  selectedImageId: string | null;
  selectedInsertedImageId: string | null;
  onEdit: (runId: string, value: EditValue) => void;
  onImageMove: (imageId: string, value: ImageMoveValue) => void;
  onEditingChange: (runId: string | null) => void;
  onCanvasClick: (pdfX: number, pdfY: number) => void;
  onTextInsertChange: (id: string, patch: Partial<TextInsertion>) => void;
  onTextInsertDelete: (id: string) => void;
  onImageInsertChange: (id: string, patch: Partial<ImageInsertion>) => void;
  onImageInsertDelete: (id: string) => void;
  onSelectImage: (imageId: string) => void;
  onSelectInsertedImage: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-2 items-center text-sm">
        <span className="text-zinc-500 dark:text-zinc-400">Page {pageIndex + 1}</span>
      </div>
      <PdfPage
        page={page}
        pageIndex={pageIndex}
        edits={edits}
        imageMoves={imageMoves}
        insertedTexts={insertedTexts}
        insertedImages={insertedImages}
        previewCanvas={previewCanvas}
        tool={tool}
        editingId={editingId}
        selectedImageId={selectedImageId}
        selectedInsertedImageId={selectedInsertedImageId}
        onEdit={onEdit}
        onImageMove={onImageMove}
        onEditingChange={onEditingChange}
        onCanvasClick={onCanvasClick}
        onTextInsertChange={onTextInsertChange}
        onTextInsertDelete={onTextInsertDelete}
        onImageInsertChange={onImageInsertChange}
        onImageInsertDelete={onImageInsertDelete}
        onSelectImage={onSelectImage}
        onSelectInsertedImage={onSelectInsertedImage}
      />
    </div>
  );
}
