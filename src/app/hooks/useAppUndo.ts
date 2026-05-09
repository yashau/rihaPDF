import { useCallback, useRef } from "react";
import { useUndoRedo } from "@/platform/hooks/useUndoRedo";
import { useLatestRef } from "@/platform/hooks/useLatestRef";
import type { AppContentState, AppDocumentState } from "@/app/hooks/useAppState";

type UndoSnapshot = {
  edits: AppContentState["edits"];
  imageMoves: AppContentState["imageMoves"];
  insertedTexts: AppContentState["insertedTexts"];
  insertedImages: AppContentState["insertedImages"];
  shapeDeletes: AppContentState["shapeDeletes"];
  annotations: AppContentState["annotations"];
  redactions: AppContentState["redactions"];
  formValues: AppContentState["formValues"];
  slots: AppDocumentState["slots"];
  sources: AppDocumentState["sources"];
};

export function useAppUndo({
  documentState,
  contentState,
}: {
  documentState: AppDocumentState;
  contentState: AppContentState;
}) {
  const { sources, slotsRef, setSlots, setSources } = documentState;
  const {
    edits,
    imageMoves,
    editingByPage,
    insertedTexts,
    insertedImages,
    shapeDeletes,
    annotations,
    redactions,
    formValues,
    contentActions,
  } = contentState;

  const editsRef = useLatestRef(edits);
  const imageMovesRef = useLatestRef(imageMoves);
  const editingByPageRef = useLatestRef(editingByPage);
  const insertedTextsRef = useLatestRef(insertedTexts);
  const insertedImagesRef = useLatestRef(insertedImages);
  const shapeDeletesRef = useLatestRef(shapeDeletes);
  const annotationsRef = useLatestRef(annotations);
  const redactionsRef = useLatestRef(redactions);
  const formValuesRef = useLatestRef(formValues);
  const sourcesRef = useLatestRef(sources);
  const selectionSetterRef = useRef<(s: null) => void>(() => {});

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
    [
      annotationsRef,
      editsRef,
      formValuesRef,
      imageMovesRef,
      insertedImagesRef,
      insertedTextsRef,
      redactionsRef,
      shapeDeletesRef,
      slotsRef,
      sourcesRef,
    ],
  );

  const restoreSnapshot = useCallback(
    (s: UndoSnapshot) => {
      contentActions.replaceAll({
        edits: s.edits,
        imageMoves: s.imageMoves,
        editingByPage: editingByPageRef.current,
        insertedTexts: s.insertedTexts,
        insertedImages: s.insertedImages,
        shapeDeletes: s.shapeDeletes,
        annotations: s.annotations,
        redactions: s.redactions,
        formValues: s.formValues,
      });
      setSlots(s.slots);
      setSources(s.sources);
      selectionSetterRef.current(null);
    },
    [contentActions, editingByPageRef, setSlots, setSources],
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
