import { useMemo } from "react";
import type { AppContentState, AppDocumentState, AppToolState } from "@/app/hooks/useAppState";
import {
  selectSaveDisabled,
  selectToolTip,
  selectTotalChangeCount,
} from "@/app/state/saveStatusSelectors";

export function useSaveStatus({
  documentState,
  contentState,
  toolState,
  busy,
}: {
  documentState: AppDocumentState;
  contentState: AppContentState;
  toolState: AppToolState;
  busy: boolean;
}) {
  const { sources, slots } = documentState;
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
  } = contentState;
  const { tool, pendingImage } = toolState;
  const totalChangeCount = useMemo(
    () =>
      selectTotalChangeCount({
        sources,
        slots,
        content: {
          edits,
          imageMoves,
          editingByPage,
          insertedTexts,
          insertedImages,
          shapeDeletes,
          annotations,
          redactions,
          formValues,
        },
      }),
    [
      annotations,
      editingByPage,
      edits,
      formValues,
      imageMoves,
      insertedImages,
      insertedTexts,
      redactions,
      shapeDeletes,
      slots,
      sources,
    ],
  );

  const saveDisabled = selectSaveDisabled({ sources, busy, totalChangeCount });
  const toolTip = selectToolTip({ tool, pendingImage });

  return { totalChangeCount, saveDisabled, toolTip };
}
