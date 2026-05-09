import type { Dispatch } from "react";
import type { Annotation } from "@/domain/annotations";
import type { EditValue, ImageMoveValue } from "@/domain/editState";
import type { FormValue } from "@/domain/formFields";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import type { Redaction } from "@/domain/redactions";
import type { PageSlot } from "@/domain/slots";

type SlotBucketItem = {
  id: string;
  sourceKey: string;
  pageIndex: number;
};

export type AppContentSnapshot = {
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  editingByPage: Map<string, string>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
};

type ReplaceContentAction = {
  type: "content/replaceAll";
  next: AppContentSnapshot;
};

export type AppContentAction =
  | ReplaceContentAction
  | { type: "content/setEdit"; slotId: string; runId: string; value: EditValue }
  | { type: "content/setImageMove"; slotId: string; imageId: string; value: ImageMoveValue }
  | { type: "content/setEditingRun"; slotId: string; runId: string | null }
  | { type: "content/addTextInsert"; slotId: string; insertion: TextInsertion }
  | {
      type: "content/patchTextInsert";
      sourceSlotId: string;
      id: string;
      slots: readonly PageSlot[];
      patch: Partial<TextInsertion>;
    }
  | { type: "content/deleteTextInsert"; slotId: string; id: string }
  | { type: "content/addImageInsert"; slotId: string; insertion: ImageInsertion }
  | {
      type: "content/patchImageInsert";
      sourceSlotId: string;
      id: string;
      slots: readonly PageSlot[];
      patch: Partial<ImageInsertion>;
    }
  | { type: "content/deleteImageInsert"; slotId: string; id: string }
  | { type: "content/markImageDeleted"; slotId: string; imageId: string }
  | { type: "content/markShapeDeleted"; slotId: string; shapeId: string }
  | { type: "content/addAnnotation"; slotId: string; annotation: Annotation }
  | { type: "content/mergeAnnotations"; annotations: Map<string, Annotation[]> }
  | {
      type: "content/patchAnnotation";
      sourceSlotId: string;
      id: string;
      slots: readonly PageSlot[];
      patch: Partial<Annotation>;
    }
  | { type: "content/deleteAnnotation"; slotId: string; id: string }
  | { type: "content/setFormValue"; sourceKey: string; fullName: string; value: FormValue }
  | { type: "content/addRedaction"; slotId: string; redaction: Redaction }
  | { type: "content/patchRedaction"; slotId: string; id: string; patch: Partial<Redaction> }
  | { type: "content/deleteRedaction"; slotId: string; id: string };

export type AppContentActions = {
  replaceAll(next: AppContentSnapshot): void;
  setEdit(slotId: string, runId: string, value: EditValue): void;
  setImageMove(slotId: string, imageId: string, value: ImageMoveValue): void;
  setEditingRun(slotId: string, runId: string | null): void;
  addTextInsert(slotId: string, insertion: TextInsertion): void;
  patchTextInsert(
    sourceSlotId: string,
    id: string,
    slots: readonly PageSlot[],
    patch: Partial<TextInsertion>,
  ): void;
  deleteTextInsert(slotId: string, id: string): void;
  addImageInsert(slotId: string, insertion: ImageInsertion): void;
  patchImageInsert(
    sourceSlotId: string,
    id: string,
    slots: readonly PageSlot[],
    patch: Partial<ImageInsertion>,
  ): void;
  deleteImageInsert(slotId: string, id: string): void;
  markImageDeleted(slotId: string, imageId: string): void;
  markShapeDeleted(slotId: string, shapeId: string): void;
  addAnnotation(slotId: string, annotation: Annotation): void;
  mergeAnnotations(annotations: Map<string, Annotation[]>): void;
  patchAnnotation(
    sourceSlotId: string,
    id: string,
    slots: readonly PageSlot[],
    patch: Partial<Annotation>,
  ): void;
  deleteAnnotation(slotId: string, id: string): void;
  setFormValue(sourceKey: string, fullName: string, value: FormValue): void;
  addRedaction(slotId: string, redaction: Redaction): void;
  patchRedaction(slotId: string, id: string, patch: Partial<Redaction>): void;
  deleteRedaction(slotId: string, id: string): void;
};

export function createEmptyContentSnapshot(): AppContentSnapshot {
  return {
    edits: new Map(),
    imageMoves: new Map(),
    editingByPage: new Map(),
    insertedTexts: new Map(),
    insertedImages: new Map(),
    shapeDeletes: new Map(),
    annotations: new Map(),
    redactions: new Map(),
    formValues: new Map(),
  };
}

function setNestedMapValue<T>(
  prev: Map<string, Map<string, T>>,
  outerKey: string,
  innerKey: string,
  value: T,
): Map<string, Map<string, T>> {
  const next = new Map(prev);
  const inner = new Map<string, T>(next.get(outerKey) ?? []);
  inner.set(innerKey, value);
  next.set(outerKey, inner);
  return next;
}

function appendSlotBucketItem<T>(
  prev: Map<string, T[]>,
  slotId: string,
  item: T,
): Map<string, T[]> {
  const next = new Map(prev);
  next.set(slotId, [...(next.get(slotId) ?? []), item]);
  return next;
}

function deleteSlotBucketItem<T extends { id: string }>(
  prev: Map<string, T[]>,
  slotId: string,
  id: string,
): Map<string, T[]> {
  const next = new Map(prev);
  next.set(
    slotId,
    (next.get(slotId) ?? []).filter((item) => item.id !== id),
  );
  return next;
}

function resolveSlotBucketPatch<T extends SlotBucketItem>(
  item: T,
  sourceSlotId: string,
  patch: Partial<T>,
  slots: readonly PageSlot[],
): { targetSlotId: string; updated: T } {
  let targetSlotId = sourceSlotId;
  if (patch.pageIndex !== undefined && patch.sourceKey !== undefined) {
    const destSlot = slots[patch.pageIndex];
    if (destSlot && destSlot.kind === "page" && destSlot.id !== sourceSlotId) {
      targetSlotId = destSlot.id;
      return {
        targetSlotId,
        updated: {
          ...item,
          ...patch,
          sourceKey: destSlot.sourceKey,
          pageIndex: destSlot.sourcePageIndex,
        },
      };
    }
    return {
      targetSlotId,
      updated: { ...item, ...patch, sourceKey: item.sourceKey, pageIndex: item.pageIndex },
    };
  }
  return { targetSlotId, updated: { ...item, ...patch } };
}

function updateSlotBucket<T extends SlotBucketItem>(
  prev: Map<string, T[]>,
  sourceSlotId: string,
  id: string,
  slots: readonly PageSlot[],
  patch: Partial<T>,
): Map<string, T[]> {
  const next = new Map(prev);
  const fromArr = next.get(sourceSlotId) ?? [];
  const item = fromArr.find((t) => t.id === id);
  if (!item) return prev;
  const { targetSlotId, updated } = resolveSlotBucketPatch(item, sourceSlotId, patch, slots);
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
}

export function contentReducer(
  state: AppContentSnapshot,
  action: AppContentAction,
): AppContentSnapshot {
  switch (action.type) {
    case "content/replaceAll":
      return action.next;
    case "content/setEdit":
      return {
        ...state,
        edits: setNestedMapValue(state.edits, action.slotId, action.runId, action.value),
      };
    case "content/setImageMove":
      return {
        ...state,
        imageMoves: setNestedMapValue(
          state.imageMoves,
          action.slotId,
          action.imageId,
          action.value,
        ),
      };
    case "content/setEditingRun": {
      const editingByPage = new Map(state.editingByPage);
      if (action.runId) editingByPage.set(action.slotId, action.runId);
      else editingByPage.delete(action.slotId);
      return { ...state, editingByPage };
    }
    case "content/addTextInsert":
      return {
        ...state,
        insertedTexts: appendSlotBucketItem(state.insertedTexts, action.slotId, action.insertion),
      };
    case "content/patchTextInsert":
      return {
        ...state,
        insertedTexts: updateSlotBucket(
          state.insertedTexts,
          action.sourceSlotId,
          action.id,
          action.slots,
          action.patch,
        ),
      };
    case "content/deleteTextInsert":
      return {
        ...state,
        insertedTexts: deleteSlotBucketItem(state.insertedTexts, action.slotId, action.id),
      };
    case "content/addImageInsert":
      return {
        ...state,
        insertedImages: appendSlotBucketItem(state.insertedImages, action.slotId, action.insertion),
      };
    case "content/patchImageInsert":
      return {
        ...state,
        insertedImages: updateSlotBucket(
          state.insertedImages,
          action.sourceSlotId,
          action.id,
          action.slots,
          action.patch,
        ),
      };
    case "content/deleteImageInsert":
      return {
        ...state,
        insertedImages: deleteSlotBucketItem(state.insertedImages, action.slotId, action.id),
      };
    case "content/markImageDeleted": {
      const existing = state.imageMoves.get(action.slotId)?.get(action.imageId) ?? {};
      return {
        ...state,
        imageMoves: setNestedMapValue(state.imageMoves, action.slotId, action.imageId, {
          ...existing,
          deleted: true,
        }),
      };
    }
    case "content/markShapeDeleted": {
      const shapeDeletes = new Map(state.shapeDeletes);
      const deleted = new Set(shapeDeletes.get(action.slotId) ?? []);
      deleted.add(action.shapeId);
      shapeDeletes.set(action.slotId, deleted);
      return { ...state, shapeDeletes };
    }
    case "content/addAnnotation":
      return {
        ...state,
        annotations: appendSlotBucketItem(state.annotations, action.slotId, action.annotation),
      };
    case "content/mergeAnnotations": {
      const annotations = new Map(state.annotations);
      for (const [slotId, annots] of action.annotations) annotations.set(slotId, annots);
      return { ...state, annotations };
    }
    case "content/patchAnnotation":
      return {
        ...state,
        annotations: updateSlotBucket(
          state.annotations,
          action.sourceSlotId,
          action.id,
          action.slots,
          action.patch,
        ),
      };
    case "content/deleteAnnotation":
      return {
        ...state,
        annotations: deleteSlotBucketItem(state.annotations, action.slotId, action.id),
      };
    case "content/setFormValue":
      return {
        ...state,
        formValues: setNestedMapValue(
          state.formValues,
          action.sourceKey,
          action.fullName,
          action.value,
        ),
      };
    case "content/addRedaction":
      return {
        ...state,
        redactions: appendSlotBucketItem(state.redactions, action.slotId, action.redaction),
      };
    case "content/patchRedaction": {
      const redactions = new Map(state.redactions);
      const arr = redactions.get(action.slotId) ?? [];
      redactions.set(
        action.slotId,
        arr.map((redaction) =>
          redaction.id === action.id ? { ...redaction, ...action.patch } : redaction,
        ),
      );
      return { ...state, redactions };
    }
    case "content/deleteRedaction":
      return {
        ...state,
        redactions: deleteSlotBucketItem(state.redactions, action.slotId, action.id),
      };
  }
}

export function createContentActions(dispatch: Dispatch<AppContentAction>): AppContentActions {
  return {
    replaceAll: (next) => dispatch({ type: "content/replaceAll", next }),
    setEdit: (slotId, runId, value) => dispatch({ type: "content/setEdit", slotId, runId, value }),
    setImageMove: (slotId, imageId, value) =>
      dispatch({ type: "content/setImageMove", slotId, imageId, value }),
    setEditingRun: (slotId, runId) => dispatch({ type: "content/setEditingRun", slotId, runId }),
    addTextInsert: (slotId, insertion) =>
      dispatch({ type: "content/addTextInsert", slotId, insertion }),
    patchTextInsert: (sourceSlotId, id, slots, patch) =>
      dispatch({ type: "content/patchTextInsert", sourceSlotId, id, slots, patch }),
    deleteTextInsert: (slotId, id) => dispatch({ type: "content/deleteTextInsert", slotId, id }),
    addImageInsert: (slotId, insertion) =>
      dispatch({ type: "content/addImageInsert", slotId, insertion }),
    patchImageInsert: (sourceSlotId, id, slots, patch) =>
      dispatch({ type: "content/patchImageInsert", sourceSlotId, id, slots, patch }),
    deleteImageInsert: (slotId, id) => dispatch({ type: "content/deleteImageInsert", slotId, id }),
    markImageDeleted: (slotId, imageId) =>
      dispatch({ type: "content/markImageDeleted", slotId, imageId }),
    markShapeDeleted: (slotId, shapeId) =>
      dispatch({ type: "content/markShapeDeleted", slotId, shapeId }),
    addAnnotation: (slotId, annotation) =>
      dispatch({ type: "content/addAnnotation", slotId, annotation }),
    mergeAnnotations: (annotations) => dispatch({ type: "content/mergeAnnotations", annotations }),
    patchAnnotation: (sourceSlotId, id, slots, patch) =>
      dispatch({ type: "content/patchAnnotation", sourceSlotId, id, slots, patch }),
    deleteAnnotation: (slotId, id) => dispatch({ type: "content/deleteAnnotation", slotId, id }),
    setFormValue: (sourceKey, fullName, value) =>
      dispatch({ type: "content/setFormValue", sourceKey, fullName, value }),
    addRedaction: (slotId, redaction) =>
      dispatch({ type: "content/addRedaction", slotId, redaction }),
    patchRedaction: (slotId, id, patch) =>
      dispatch({ type: "content/patchRedaction", slotId, id, patch }),
    deleteRedaction: (slotId, id) => dispatch({ type: "content/deleteRedaction", slotId, id }),
  };
}
