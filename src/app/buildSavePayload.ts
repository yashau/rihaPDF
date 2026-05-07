import {
  type Edit,
  type ImageInsert,
  type ImageMove,
  type ShapeDelete,
  type TextInsert,
} from "@/pdf/save/types";
import type { Annotation } from "@/domain/annotations";
import { blankSourceKey } from "@/domain/blankSource";
import type { FormValue } from "@/domain/formFields";
import type { FormFill } from "@/pdf/save/forms";
import type { ImageInsertion, TextInsertion } from "@/domain/insertions";
import type { Redaction } from "@/domain/redactions";
import type { PageSlot } from "@/domain/slots";
import type { EditValue, ImageMoveValue } from "@/domain/editState";

/** Translate the App's slotId-keyed edit / move / insert maps back
 *  to the (sourceKey, sourcePageIndex)-keyed flat arrays the per-
 *  source save pipeline expects. Pure — same input always produces
 *  the same output, no React state, no globals.
 *
 *  Cross-page targets stored as `targetSlotId` are resolved to
 *  their slot's current `(sourceKey, sourcePageIndex)` so a slot
 *  reorder before save lands the edit on the right destination
 *  page. Annotations are re-addressed to the slot's current
 *  source page for the same reason. */
export function buildSavePayload({
  slots,
  edits,
  imageMoves,
  insertedTexts,
  insertedImages,
  shapeDeletes,
  annotations,
  redactions,
  formValues,
}: {
  slots: PageSlot[];
  edits: Map<string, Map<string, EditValue>>;
  imageMoves: Map<string, Map<string, ImageMoveValue>>;
  insertedTexts: Map<string, TextInsertion[]>;
  insertedImages: Map<string, ImageInsertion[]>;
  shapeDeletes: Map<string, Set<string>>;
  annotations: Map<string, Annotation[]>;
  redactions: Map<string, Redaction[]>;
  formValues: Map<string, Map<string, FormValue>>;
}) {
  const slotAddr = new Map<string, { sourceKey: string; pageIndex: number; slot: PageSlot }>();
  for (const slot of slots) {
    if (slot.kind === "page") {
      slotAddr.set(slot.id, {
        sourceKey: slot.sourceKey,
        pageIndex: slot.sourcePageIndex,
        slot,
      });
    } else {
      // Blank slot — addressed by a synthetic per-slot sourceKey +
      // pageIndex 0. The save pipeline materialises a fresh one-page
      // PDFDocument for each such key so inserts / draws / annots
      // land on a real page that copyPages can pull into the output.
      slotAddr.set(slot.id, {
        sourceKey: blankSourceKey(slot.id),
        pageIndex: 0,
        slot,
      });
    }
  }

  const flatEdits: Edit[] = [];
  for (const [slotId, runs] of edits) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const [runId, value] of runs) {
      // Cross-page / cross-source target: prefer stable targetSlotId.
      let targetSourceKey: string | undefined;
      let targetPageIndex: number | undefined;
      if (value.targetSlotId !== undefined) {
        const target = slotAddr.get(value.targetSlotId);
        if (target) {
          targetSourceKey = target.sourceKey;
          targetPageIndex = target.pageIndex;
        }
      }
      flatEdits.push({
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
        runId,
        sourceRunIds: value.sourceRunIds,
        newText: value.text,
        style: value.style,
        dx: value.dx,
        dy: value.dy,
        targetSourceKey,
        targetPageIndex,
        targetPdfX: value.targetPdfX,
        targetPdfY: value.targetPdfY,
        deleted: value.deleted,
      });
    }
  }

  const flatImageMoves: ImageMove[] = [];
  for (const [slotId, imgs] of imageMoves) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const [imageId, value] of imgs) {
      const dx = value.dx ?? 0;
      const dy = value.dy ?? 0;
      const dw = value.dw ?? 0;
      const dh = value.dh ?? 0;
      const isCrossPage = value.targetSlotId !== undefined;
      if (!isCrossPage && !value.deleted && dx === 0 && dy === 0 && dw === 0 && dh === 0) continue;
      let targetSourceKey: string | undefined;
      let targetPageIndex: number | undefined;
      if (value.targetSlotId !== undefined) {
        const target = slotAddr.get(value.targetSlotId);
        if (target) {
          targetSourceKey = target.sourceKey;
          targetPageIndex = target.pageIndex;
        }
      }
      flatImageMoves.push({
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
        imageId,
        dx,
        dy,
        dw,
        dh,
        targetSourceKey,
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
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const t of arr) {
      if (!t.text || t.text.trim().length === 0) continue;
      flatTextInserts.push({
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
        pdfX: t.pdfX,
        pdfY: t.pdfY,
        pdfWidth: t.pdfWidth,
        fontSize: t.fontSize,
        text: t.text,
        style: t.style,
      });
    }
  }

  const flatImageInserts: ImageInsert[] = [];
  for (const [slotId, arr] of insertedImages) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const i of arr) {
      flatImageInserts.push({
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
        pdfX: i.pdfX,
        pdfY: i.pdfY,
        pdfWidth: i.pdfWidth,
        pdfHeight: i.pdfHeight,
        bytes: i.bytes,
        format: i.format,
      });
    }
  }

  const flatShapeDeletes: ShapeDelete[] = [];
  for (const [slotId, set] of shapeDeletes) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const shapeId of set) {
      flatShapeDeletes.push({
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
        shapeId,
      });
    }
  }

  const flatAnnotations: Annotation[] = [];
  for (const [slotId, arr] of annotations) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const a of arr) {
      // Re-address each annotation to the slot's current source
      // page so a slot reorder / move rewrites the destination
      // before save (mirrors how text inserts work).
      flatAnnotations.push({
        ...a,
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
      });
    }
  }

  const flatRedactions: Redaction[] = [];
  for (const [slotId, arr] of redactions) {
    const addr = slotAddr.get(slotId);
    if (!addr) continue;
    for (const r of arr) {
      // Same re-address pattern as annotations: a slot reorder
      // before save rewrites the destination so the redaction
      // lands on the right page in the output.
      flatRedactions.push({
        ...r,
        sourceKey: addr.sourceKey,
        pageIndex: addr.pageIndex,
      });
    }
  }

  // Form fills are keyed by source identity (not slot), so a slot
  // reorder doesn't relocate them — every fill targets a named field
  // on a specific source's AcroForm tree, which has no notion of
  // slot order. Flatten directly out of `formValues`.
  const flatFormFills: FormFill[] = [];
  for (const [sourceKey, byName] of formValues) {
    for (const [fullName, value] of byName) {
      flatFormFills.push({ sourceKey, fullName, value });
    }
  }

  return {
    flatEdits,
    flatImageMoves,
    flatTextInserts,
    flatImageInserts,
    flatShapeDeletes,
    flatAnnotations,
    flatRedactions,
    flatFormFills,
  };
}
