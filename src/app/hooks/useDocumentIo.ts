import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Annotation } from "@/domain/annotations";
import { buildSavePayload } from "@/app/buildSavePayload";
import type { FormValue } from "@/domain/formFields";
import { readImageFile, type ImageInsertion, type TextInsertion } from "@/domain/insertions";
import type { LoadedSource } from "@/pdf/source/loadSource";
import type { Redaction } from "@/domain/redactions";
import { nextExternalSourceKey, PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import { pageSlot, slotsFromSource, type PageSlot } from "@/domain/slots";
import type { PendingImage, ToolMode } from "@/domain/toolMode";
import { MIN_DOCUMENT_ZOOM } from "@/app/hooks/useMobileDocumentZoom";
import type { EditValue, ImageMoveValue } from "@/domain/editState";

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
  sources,
  slots,
  primaryFilename,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  shapeDeletes,
  annotations,
  redactions,
  formValues,
  setPrimaryFilename,
  setLoadedFileKey,
  setDocumentZoom,
  setSources,
  setSlots,
  setEdits,
  setImageMoves,
  setInsertedTexts,
  setInsertedImages,
  setShapeDeletes,
  setAnnotations,
  setRedactions,
  setFormValues,
  setTool,
  setPendingImage,
  setBusy,
  recordHistory,
  clearHistory,
}: {
  renderScale: number;
  sources: Map<string, LoadedSource>;
  slots: PageSlot[];
  primaryFilename: string | null;
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
  setPrimaryFilename: Dispatch<SetStateAction<string | null>>;
  setLoadedFileKey: Dispatch<SetStateAction<number>>;
  setDocumentZoom: Dispatch<SetStateAction<number>>;
  setSources: Dispatch<SetStateAction<Map<string, LoadedSource>>>;
  setSlots: Dispatch<SetStateAction<PageSlot[]>>;
  setEdits: Dispatch<SetStateAction<Map<string, Map<string, EditValue>>>>;
  setImageMoves: Dispatch<SetStateAction<Map<string, Map<string, ImageMoveValue>>>>;
  setInsertedTexts: Dispatch<SetStateAction<Map<string, TextInsertion[]>>>;
  setInsertedImages: Dispatch<SetStateAction<Map<string, ImageInsertion[]>>>;
  setShapeDeletes: Dispatch<SetStateAction<Map<string, Set<string>>>>;
  setAnnotations: Dispatch<SetStateAction<Map<string, Annotation[]>>>;
  setRedactions: Dispatch<SetStateAction<Map<string, Redaction[]>>>;
  setFormValues: Dispatch<SetStateAction<Map<string, Map<string, FormValue>>>>;
  setTool: Dispatch<SetStateAction<ToolMode>>;
  setPendingImage: Dispatch<SetStateAction<PendingImage | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  recordHistory: (coalesceKey: string | null) => void;
  clearHistory: () => void;
}) {
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
        setEdits(new Map());
        setImageMoves(new Map());
        setShapeDeletes(new Map());
        setAnnotations(sourceAnnotationsForSlots(source, nextSlots));
        setRedactions(new Map());
        setFormValues(new Map());
        setInsertedTexts(new Map());
        setInsertedImages(new Map());
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
      setAnnotations,
      setBusy,
      setDocumentZoom,
      setEdits,
      setFormValues,
      setImageMoves,
      setInsertedImages,
      setInsertedTexts,
      setLoadedFileKey,
      setPendingImage,
      setPrimaryFilename,
      setRedactions,
      setShapeDeletes,
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
        setAnnotations((prev) => {
          const next = new Map(prev);
          for (const { source, sourceSlots } of loaded) {
            for (const [slotId, annots] of sourceAnnotationsForSlots(source, sourceSlots)) {
              next.set(slotId, annots);
            }
          }
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [recordHistory, renderScale, setAnnotations, setBusy, setSlots, setSources],
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
