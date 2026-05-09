import { useCallback, type Dispatch, type SetStateAction } from "react";
import { buildSavePayload } from "@/app/buildSavePayload";
import { readImageFile } from "@/domain/insertions";
import type { LoadedSource } from "@/pdf/source/loadSource";
import { nextExternalSourceKey, PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import { pageSlot, slotsFromSource, type PageSlot } from "@/domain/slots";
import { MIN_DOCUMENT_ZOOM } from "@/app/hooks/useMobileDocumentZoom";
import type { Annotation } from "@/domain/annotations";
import type { AppContentState, AppDocumentState, AppToolState } from "@/app/hooks/useAppState";

function sourceAnnotationsForSlots(
  source: LoadedSource,
  slots: PageSlot[],
): Map<string, Annotation[]> {
  const out = new Map<string, Annotation[]>();
  for (const slot of slots) {
    if (slot.kind !== "page" || slot.sourceKey !== source.sourceKey) continue;
    const annots = source.annotationsByPage[slot.sourcePageIndex] ?? [];
    if (annots.length > 0)
      out.set(
        slot.id,
        annots.map((a) => ({ ...a })),
      );
  }
  return out;
}

export function useDocumentIo({
  renderScale,
  documentState,
  contentState,
  toolState,
  setDocumentZoom,
  setBusy,
  recordHistory,
  clearHistory,
}: {
  renderScale: number;
  documentState: AppDocumentState;
  contentState: AppContentState;
  toolState: AppToolState;
  setDocumentZoom: Dispatch<SetStateAction<number>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  recordHistory: (coalesceKey: string | null) => void;
  clearHistory: () => void;
}) {
  const {
    sources,
    slots,
    primaryFilename,
    setPrimaryFilename,
    setLoadedFileKey,
    setSources,
    setSlots,
  } = documentState;
  const {
    edits,
    imageMoves,
    insertedTexts,
    insertedImages,
    shapeDeletes,
    annotations,
    redactions,
    formValues,
    contentActions,
  } = contentState;
  const { setTool, setPendingImage } = toolState;

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const { loadSource } = await import("@/pdf/source/loadSource");
        const source = await loadSource(file, renderScale, PRIMARY_SOURCE_KEY);
        const nextSlots = slotsFromSource(source);
        setPrimaryFilename(file.name);
        setSources(new Map([[PRIMARY_SOURCE_KEY, source]]));
        setSlots(nextSlots);
        setDocumentZoom(MIN_DOCUMENT_ZOOM);
        clearHistory();
        (
          window as unknown as {
            __runOpIndices?: Map<string, number[]>;
          }
        ).__runOpIndices = new Map(
          source.pages.flatMap((p) => p.textRuns.map((r) => [r.id, r.contentStreamOpIndices])),
        );
        contentActions.replaceAll({
          edits: new Map(),
          imageMoves: new Map(),
          editingByPage: new Map(),
          insertedTexts: new Map(),
          insertedImages: new Map(),
          shapeDeletes: new Map(),
          annotations: sourceAnnotationsForSlots(source, nextSlots),
          redactions: new Map(),
          formValues: new Map(),
        });
        setTool("select");
        setPendingImage(null);
        setLoadedFileKey((n) => n + 1);
      } finally {
        setBusy(false);
      }
    },
    [
      clearHistory,
      renderScale,
      contentActions,
      setBusy,
      setDocumentZoom,
      setLoadedFileKey,
      setPendingImage,
      setPrimaryFilename,
      setSlots,
      setSources,
      setTool,
    ],
  );

  const onAddExternalPdfs = useCallback(
    async (files: File[], insertAt?: number) => {
      if (files.length === 0) return;
      setBusy(true);
      try {
        const { loadSource } = await import("@/pdf/source/loadSource");
        recordHistory(null);
        const loaded: { source: LoadedSource; sourceSlots: PageSlot[] }[] = [];
        for (const file of files) {
          const sourceKey = nextExternalSourceKey(file);
          const source = await loadSource(file, renderScale, sourceKey);
          const sourceSlots = source.pages.map((_, i) => pageSlot(sourceKey, i));
          loaded.push({ source, sourceSlots });
        }
        setSources((prev) => {
          const next = new Map(prev);
          for (const { source } of loaded) next.set(source.sourceKey, source);
          return next;
        });
        setSlots((prev) => {
          const newSlots = loaded.flatMap(({ sourceSlots }) => sourceSlots);
          const at =
            insertAt === undefined ? prev.length : Math.max(0, Math.min(insertAt, prev.length));
          return [...prev.slice(0, at), ...newSlots, ...prev.slice(at)];
        });
        const annotationsToMerge = new Map<string, Annotation[]>();
        for (const { source, sourceSlots } of loaded) {
          for (const [slotId, annots] of sourceAnnotationsForSlots(source, sourceSlots)) {
            annotationsToMerge.set(slotId, annots);
          }
        }
        contentActions.mergeAnnotations(annotationsToMerge);
      } finally {
        setBusy(false);
      }
    },
    [contentActions, recordHistory, renderScale, setBusy, setSlots, setSources],
  );

  const onPickImageFile = useCallback(
    async (file: File) => {
      const parsed = await readImageFile(file);
      if (!parsed) {
        console.warn("Unsupported image format (PNG/JPEG only):", file.name);
        return;
      }
      setPendingImage({ ...parsed, kind: "image" });
      setTool("addImage");
    },
    [setPendingImage, setTool],
  );

  const onSave = useCallback(async () => {
    if (sources.size === 0 || !primaryFilename) return;
    setBusy(true);
    try {
      const { applyEditsAndSave, downloadBlob } = await import("@/pdf/save");
      const {
        flatEdits,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        flatShapeDeletes,
        flatAnnotations,
        flatRedactions,
        flatFormFills,
      } = buildSavePayload({
        slots,
        edits,
        imageMoves,
        insertedTexts,
        insertedImages,
        shapeDeletes,
        annotations,
        redactions,
        formValues,
      });
      const out = await applyEditsAndSave(
        sources,
        slots,
        flatEdits,
        flatImageMoves,
        flatTextInserts,
        flatImageInserts,
        flatShapeDeletes,
        flatAnnotations,
        flatRedactions,
        flatFormFills,
      );
      const baseName = primaryFilename.replace(/\.pdf$/i, "");
      await downloadBlob(out, `${baseName}.edited.pdf`);
    } finally {
      setBusy(false);
    }
  }, [
    annotations,
    edits,
    formValues,
    imageMoves,
    insertedImages,
    insertedTexts,
    primaryFilename,
    redactions,
    setBusy,
    shapeDeletes,
    slots,
    sources,
  ]);

  return { handleFile, onAddExternalPdfs, onPickImageFile, onSave };
}
