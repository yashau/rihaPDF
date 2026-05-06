import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { Annotation } from "./annotations";
import type { FormValue } from "./formFields";
import type { ImageInsertion, TextInsertion } from "./insertions";
import type { LoadedSource } from "./loadSource";
import type { Redaction } from "./redactions";
import type { PageSlot } from "./slots";
import { useUndoRedo } from "./useUndoRedo";
import type { EditValue, ImageMoveValue } from "../components/PdfPage";

type UndoSnapshot = {
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
  slots: PageSlot[];
  sources: Map<string, LoadedSource>;
};

export function useAppUndo({
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  shapeDeletes,
  annotations,
  redactions,
  formValues,
  sources,
  slotsRef,
  setEdits,
  setImageMoves,
  setInsertedTexts,
  setInsertedImages,
  setShapeDeletes,
  setAnnotations,
  setRedactions,
  setFormValues,
  setSlots,
  setSources,
}: {
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
  sources: Map<string, LoadedSource>;
  slotsRef: RefObject<PageSlot[]>;
  setEdits: Dispatch<SetStateAction<Map<string, Map<string, EditValue>>>>;
  setImageMoves: Dispatch<SetStateAction<Map<string, Map<string, ImageMoveValue>>>>;
  setInsertedTexts: Dispatch<SetStateAction<Map<string, TextInsertion[]>>>;
  setInsertedImages: Dispatch<SetStateAction<Map<string, ImageInsertion[]>>>;
  setShapeDeletes: Dispatch<SetStateAction<Map<string, Set<string>>>>;
  setAnnotations: Dispatch<SetStateAction<Map<string, Annotation[]>>>;
  setRedactions: Dispatch<SetStateAction<Map<string, Redaction[]>>>;
  setFormValues: Dispatch<SetStateAction<Map<string, Map<string, FormValue>>>>;
  setSlots: Dispatch<SetStateAction<PageSlot[]>>;
  setSources: Dispatch<SetStateAction<Map<string, LoadedSource>>>;
}) {
  const editsRef = useRef(edits);
  const imageMovesRef = useRef(imageMoves);
  const insertedTextsRef = useRef(insertedTexts);
  const insertedImagesRef = useRef(insertedImages);
  const shapeDeletesRef = useRef(shapeDeletes);
  const annotationsRef = useRef(annotations);
  const redactionsRef = useRef(redactions);
  const formValuesRef = useRef(formValues);
  const sourcesRef = useRef(sources);
  const selectionSetterRef = useRef<(s: null) => void>(() => {});

  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);
  useEffect(() => {
    imageMovesRef.current = imageMoves;
  }, [imageMoves]);
  useEffect(() => {
    insertedTextsRef.current = insertedTexts;
  }, [insertedTexts]);
  useEffect(() => {
    insertedImagesRef.current = insertedImages;
  }, [insertedImages]);
  useEffect(() => {
    shapeDeletesRef.current = shapeDeletes;
  }, [shapeDeletes]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);
  useEffect(() => {
    redactionsRef.current = redactions;
  }, [redactions]);
  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  const captureSnapshot = useCallback(
    (): UndoSnapshot => ({
      edits: editsRef.current,
      imageMoves: imageMovesRef.current,
      insertedTexts: insertedTextsRef.current,
      insertedImages: insertedImagesRef.current,
      shapeDeletes: shapeDeletesRef.current,
      annotations: annotationsRef.current,
      redactions: redactionsRef.current,
      formValues: formValuesRef.current,
      slots: slotsRef.current,
      sources: sourcesRef.current,
    }),
    [slotsRef],
  );

  const restoreSnapshot = useCallback(
    (s: UndoSnapshot) => {
      setEdits(s.edits);
      setImageMoves(s.imageMoves);
      setInsertedTexts(s.insertedTexts);
      setInsertedImages(s.insertedImages);
      setShapeDeletes(s.shapeDeletes);
      setAnnotations(s.annotations);
      setRedactions(s.redactions);
      setFormValues(s.formValues);
      setSlots(s.slots);
      setSources(s.sources);
      selectionSetterRef.current(null);
    },
    [
      setAnnotations,
      setEdits,
      setFormValues,
      setImageMoves,
      setInsertedImages,
      setInsertedTexts,
      setRedactions,
      setShapeDeletes,
      setSlots,
      setSources,
    ],
  );

  const undoState = useUndoRedo({
    captureSnapshot,
    restoreSnapshot,
  });

  const bindSelectionSetter = useCallback((setSelection: (s: null) => void) => {
    selectionSetterRef.current = setSelection;
  }, []);

  return { ...undoState, bindSelectionSetter };
}
