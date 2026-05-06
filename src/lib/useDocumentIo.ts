import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Annotation } from "./annotations";
import { buildSavePayload } from "./buildSavePayload";
import type { FormValue } from "./formFields";
import { readImageFile, type ImageInsertion, type TextInsertion } from "./insertions";
import {
  loadSource,
  nextExternalSourceKey,
  PRIMARY_SOURCE_KEY,
  type LoadedSource,
} from "./loadSource";
import type { Redaction } from "./redactions";
import { applyEditsAndSave, downloadBlob } from "./save";
import { pageSlot, slotsFromSource, type PageSlot } from "./slots";
import type { PendingImage, ToolMode } from "./toolMode";
import { MIN_DOCUMENT_ZOOM } from "./useMobileDocumentZoom";
import type { EditValue, ImageMoveValue } from "../components/PdfPage";

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
        const source = await loadSource(file, renderScale, PRIMARY_SOURCE_KEY);
        setPrimaryFilename(file.name);
        setSources(new Map([[PRIMARY_SOURCE_KEY, source]]));
        setSlots(slotsFromSource(source));
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
        setAnnotations(new Map());
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
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy(true);
      try {
        recordHistory(null);
        for (const file of files) {
          const sourceKey = nextExternalSourceKey(file);
          const source = await loadSource(file, renderScale, sourceKey);
          setSources((prev) => {
            const next = new Map(prev);
            next.set(sourceKey, source);
            return next;
          });
          setSlots((prev) => [...prev, ...source.pages.map((_, i) => pageSlot(sourceKey, i))]);
        }
      } finally {
        setBusy(false);
      }
    },
    [recordHistory, renderScale, setBusy, setSlots, setSources],
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
      downloadBlob(out, `${baseName}.edited.pdf`);
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
