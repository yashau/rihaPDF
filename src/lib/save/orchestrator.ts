import {
  PDFDocument,
  PDFName,
  PDFRef,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { PageSlot } from "../slots";
import type { LoadedSource } from "../loadSource";
import { blankSourceKey, isBlankSourceKey, slotIdFromBlankSourceKey } from "../blankSource";
import type { Annotation } from "../annotations";
import { applyAnnotationsToDoc } from "../saveAnnotations";
import { applyFormFillsToDoc, rebuildOutputAcroForm, type FormFill } from "../saveFormFields";
import { applyRedactionsToFormWidgets } from "../redactFormFields";
import { DEFAULT_FONT_FAMILY } from "../fonts";
import { type Redaction } from "../redactions";
import {
  applyRedactionsToNewAnnotations,
  applyRedactionsToPageAnnotations,
} from "../redactAnnotations";
import type { Edit, ImageInsert, ImageMove, ShapeDelete, TextInsert } from "./types";
import { makeFontFactory, type LoadedSourceContext } from "./context";
import { drawDecorations, drawTextWithStyle, emitTextDraw, measureTextWidth } from "./textDraw";
import {
  applyStreamSurgeryForSource,
  type CrossSourceDrawPlan,
  type CrossSourceImageDrawPlan,
  type SameSourceDrawPlan,
  type SameSourceImageDrawPlan,
} from "./streamSurgery";
import { idOf } from "./xobjects";

export async function applyEditsAndSave(
  sources: Map<string, LoadedSource>,
  slots: PageSlot[],
  edits: Edit[],
  imageMoves: ImageMove[] = [],
  textInserts: TextInsert[] = [],
  imageInserts: ImageInsert[] = [],
  shapeDeletes: ShapeDelete[] = [],
  annotations: Annotation[] = [],
  redactions: Redaction[] = [],
  formFills: FormFill[] = [],
): Promise<Uint8Array> {
  // Bucket ops by source so each source's doc gets surgery in one pass.
  const editsBySource = new Map<string, Edit[]>();
  const movesBySource = new Map<string, ImageMove[]>();
  const shapeDeletesBySource = new Map<string, ShapeDelete[]>();
  const redactionsBySource = new Map<string, Redaction[]>();
  const sourcesNeedingLoad = new Set<string>();
  // Sources referenced by any slot need to be loaded so copyPages can
  // pull from them. Edits / moves / inserts can target a source even
  // when no slot from that source is in `slots` — but the user can't
  // produce such a state today (cross-source operations only fire
  // when both endpoints are visible). Still, register origins/targets
  // so the bucket loop in the load phase loads them all.
  for (const slot of slots) {
    if (slot.kind === "page") sourcesNeedingLoad.add(slot.sourceKey);
  }
  for (const e of edits) {
    sourcesNeedingLoad.add(e.sourceKey);
    if (e.targetSourceKey) sourcesNeedingLoad.add(e.targetSourceKey);
    if (!editsBySource.has(e.sourceKey)) editsBySource.set(e.sourceKey, []);
    editsBySource.get(e.sourceKey)!.push(e);
  }
  for (const m of imageMoves) {
    sourcesNeedingLoad.add(m.sourceKey);
    if (m.targetSourceKey) sourcesNeedingLoad.add(m.targetSourceKey);
    if (!movesBySource.has(m.sourceKey)) movesBySource.set(m.sourceKey, []);
    movesBySource.get(m.sourceKey)!.push(m);
  }
  for (const t of textInserts) sourcesNeedingLoad.add(t.sourceKey);
  for (const i of imageInserts) sourcesNeedingLoad.add(i.sourceKey);
  for (const a of annotations) sourcesNeedingLoad.add(a.sourceKey);
  // Form fills target a source's AcroForm tree directly — register
  // their sources so a doc-without-slots-but-with-fills still gets a
  // ctx. (In practice fills always come from a source whose pages
  // are slotted, but the bookkeeping mirrors edits / annots.)
  for (const f of formFills) sourcesNeedingLoad.add(f.sourceKey);
  for (const r of redactions) {
    sourcesNeedingLoad.add(r.sourceKey);
    if (!redactionsBySource.has(r.sourceKey)) redactionsBySource.set(r.sourceKey, []);
    redactionsBySource.get(r.sourceKey)!.push(r);
  }
  for (const d of shapeDeletes) {
    sourcesNeedingLoad.add(d.sourceKey);
    if (!shapeDeletesBySource.has(d.sourceKey)) shapeDeletesBySource.set(d.sourceKey, []);
    shapeDeletesBySource.get(d.sourceKey)!.push(d);
  }

  // Load each source's doc once. We re-load from bytes (rather than
  // reusing any cached PDFDocument) so the save pipeline can't leave
  // mutations behind in the in-memory source state. Blank slots that
  // are referenced by any insert / draw / annotation get a synthetic
  // ctx — a fresh PDFDocument with a single page sized to the slot —
  // so the same insert / draw / annotation passes can apply to them.
  const ctxBySource = new Map<string, LoadedSourceContext>();
  const blankSlotById = new Map<string, PageSlot>();
  for (const slot of slots) {
    if (slot.kind === "blank") blankSlotById.set(slot.id, slot);
  }
  for (const sourceKey of sourcesNeedingLoad) {
    if (isBlankSourceKey(sourceKey)) {
      const slotId = slotIdFromBlankSourceKey(sourceKey);
      const slot = blankSlotById.get(slotId);
      if (!slot || slot.kind !== "blank") continue;
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      doc.addPage(slot.size);
      ctxBySource.set(sourceKey, {
        doc,
        getFont: makeFontFactory(doc),
      });
      continue;
    }
    const source = sources.get(sourceKey);
    if (!source) continue;
    const doc = await PDFDocument.load(source.bytes);
    doc.registerFontkit(fontkit);
    ctxBySource.set(sourceKey, {
      source,
      doc,
      getFont: makeFontFactory(doc),
    });
  }

  const sameSourceDraws: SameSourceDrawPlan[] = [];
  const crossSourceDraws: CrossSourceDrawPlan[] = [];
  const sameSourceImageDraws: SameSourceImageDrawPlan[] = [];
  const crossSourceImageDraws: CrossSourceImageDrawPlan[] = [];

  // First pass — per source, do content-stream surgery. Cross-source
  // draws are queued and emitted in the second pass after every source
  // has had its strips committed.
  for (const [sourceKey, ctx] of ctxBySource) {
    const sourceEdits = editsBySource.get(sourceKey) ?? [];
    const sourceMoves = movesBySource.get(sourceKey) ?? [];
    const sourceShapeDeletes = shapeDeletesBySource.get(sourceKey) ?? [];
    const sourceRedactions = redactionsBySource.get(sourceKey) ?? [];
    if (
      sourceEdits.length === 0 &&
      sourceMoves.length === 0 &&
      sourceShapeDeletes.length === 0 &&
      sourceRedactions.length === 0
    ) {
      continue;
    }
    await applyStreamSurgeryForSource(
      ctx,
      sourceEdits,
      sourceMoves,
      sourceShapeDeletes,
      sourceRedactions,
      sameSourceDraws,
      crossSourceDraws,
      sameSourceImageDraws,
      crossSourceImageDraws,
    );
  }

  // Second pass — emit cross-source / cross-page image draws on the
  // target page's resources. For same-source cross-page we replicate
  // the XObject ref; for cross-source we embed the pixel bytes fresh
  // on the target's doc.
  for (const plan of sameSourceImageDraws) {
    const ctx = ctxBySource.get(plan.sourceKey);
    if (!ctx) continue;
    const targetPage = ctx.doc.getPages()[plan.targetPageIndex];
    if (!targetPage) continue;
    const name = (
      targetPage.node as unknown as {
        newXObject: (tag: string, ref: PDFRef) => PDFName;
      }
    ).newXObject("RihaImg", plan.xobjectRef);
    targetPage.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(...plan.cm),
      drawObject(name),
      popGraphicsState(),
    );
  }

  for (const plan of crossSourceImageDraws) {
    const targetCtx = ctxBySource.get(plan.targetSourceKey);
    if (!targetCtx) continue;
    const targetPage = targetCtx.doc.getPages()[plan.targetPageIndex];
    if (!targetPage) continue;
    if (!plan.imageFormat) continue; // unsupported format — silently skip
    const embedded =
      plan.imageFormat === "png"
        ? await targetCtx.doc.embedPng(plan.imageBytes)
        : await targetCtx.doc.embedJpg(plan.imageBytes);
    targetPage.drawImage(embedded, {
      x: plan.cm[4],
      y: plan.cm[5],
      width: plan.cm[0],
      height: plan.cm[3],
    });
  }

  // Same-source text draws — emit on origin or target page within the
  // same doc.
  for (const plan of sameSourceDraws) {
    const ctx = ctxBySource.get(plan.sourceKey);
    if (!ctx) continue;
    await emitTextDraw(ctx, plan.targetPageIndex, plan);
  }
  for (const plan of crossSourceDraws) {
    const ctx = ctxBySource.get(plan.targetSourceKey);
    if (!ctx) continue;
    await emitTextDraw(ctx, plan.targetPageIndex, plan);
  }

  // Net-new insertions — text + image. Each insertion already targets a
  // specific (sourceKey, pageIndex) pair; the load phase ensured the
  // doc is open.
  for (const ins of textInserts) {
    if (!ins.text || ins.text.trim().length === 0) continue;
    const ctx = ctxBySource.get(ins.sourceKey);
    if (!ctx) continue;
    const page = ctx.doc.getPages()[ins.pageIndex];
    if (!page) continue;
    const family =
      ins.style?.fontFamily ??
      // default per-script: Thaana → Faruma, otherwise Arial
      (/[֐-׿؀-ۿހ-޿]/u.test(ins.text) ? DEFAULT_FONT_FAMILY : "Arial");
    const bold = !!ins.style?.bold;
    const italic = !!ins.style?.italic;
    const { pdfFont, bytes: fontBytes } = await ctx.getFont(family, bold, italic);
    const fontSizePt = ins.fontSize;
    // Explicit `style.dir` wins; otherwise auto-detect from the text's
    // strong codepoints. RTL right-aligns the rendered text to the
    // overlay box's RIGHT edge (= `pdfX + pdfWidth`) so the saved-PDF
    // glyphs land where the editor right-aligns the typed text in its
    // 120pt-wide box. Anchoring to `pdfX` itself (the box's LEFT) put
    // RTL text a full box-width too far left in the saved file
    // — visible on mobile where the overlay box and the saved text
    // visibly disagreed by ~120pt.
    const isRtl =
      ins.style?.dir === "rtl" || (ins.style?.dir !== "ltr" && /[֐-׿؀-ۿހ-޿]/u.test(ins.text));
    const dir: "rtl" | "ltr" | undefined = ins.style?.dir;
    const widthPt = await measureTextWidth(
      ins.text,
      pdfFont,
      fontBytes,
      family,
      fontSizePt,
      dir,
      ctx.getFont,
    );
    const baseX = isRtl ? ins.pdfX + ins.pdfWidth - widthPt : ins.pdfX;
    await drawTextWithStyle(page, ins.text, {
      x: baseX,
      y: ins.pdfY,
      size: fontSizePt,
      font: pdfFont,
      fontBytes,
      family,
      italic,
      dir,
      getFont: ctx.getFont,
      color: ins.style?.color,
    });
    drawDecorations(page, {
      x: baseX,
      y: ins.pdfY,
      width: widthPt,
      size: fontSizePt,
      underline: !!ins.style?.underline,
      strikethrough: !!ins.style?.strikethrough,
      color: ins.style?.color,
    });
  }

  // Embed each unique image once per (doc, byte-buffer) pair so a
  // single user image dropped on multiple pages of the same source
  // shares one XObject in the saved file.
  const imageEmbedCache = new Map<
    string,
    Awaited<ReturnType<typeof PDFDocument.prototype.embedPng>>
  >();
  for (const ins of imageInserts) {
    const ctx = ctxBySource.get(ins.sourceKey);
    if (!ctx) continue;
    const page = ctx.doc.getPages()[ins.pageIndex];
    if (!page) continue;
    const cacheKey = `${ins.sourceKey}\0${idOf(ins.bytes)}`;
    let embedded = imageEmbedCache.get(cacheKey);
    if (!embedded) {
      embedded =
        ins.format === "png"
          ? await ctx.doc.embedPng(ins.bytes)
          : await ctx.doc.embedJpg(ins.bytes);
      imageEmbedCache.set(cacheKey, embedded);
    }
    page.drawImage(embedded, {
      x: ins.pdfX,
      y: ins.pdfY,
      width: ins.pdfWidth,
      height: ins.pdfHeight,
    });
  }

  // Form fills — write /V (and per-widget /AS) on each source's
  // AcroForm tree before annotations / copyPages so the field
  // surgery rides through copyPages along with the rest. Bucket by
  // source for the same reason annotations do: one AcroForm tree
  // per source, one pass per source.
  if (formFills.length > 0) {
    const fillsBySource = new Map<string, FormFill[]>();
    for (const f of formFills) {
      const list = fillsBySource.get(f.sourceKey) ?? [];
      list.push(f);
      fillsBySource.set(f.sourceKey, list);
    }
    for (const [sourceKey, list] of fillsBySource) {
      const ctx = ctxBySource.get(sourceKey);
      if (!ctx) continue;
      await applyFormFillsToDoc(ctx.doc, list, { getFont: ctx.getFont });
    }
  }

  // AcroForm widgets carry field values outside the page content stream.
  // If a redaction overlaps any widget of a field, remove that field's
  // widgets and clear its value/appearance data before copyPages can
  // preserve it into the output.
  if (redactions.length > 0) {
    for (const [sourceKey, ctx] of ctxBySource) {
      const sourceRedactions = redactionsBySource.get(sourceKey) ?? [];
      if (sourceRedactions.length === 0) continue;
      const byPage = new Map<number, Redaction[]>();
      for (const r of sourceRedactions) {
        const list = byPage.get(r.pageIndex) ?? [];
        list.push(r);
        byPage.set(r.pageIndex, list);
      }
      applyRedactionsToFormWidgets(ctx.doc, byPage);
    }
  }

  // Annotations - native PDF /Annot dicts appended to each source
  // page's /Annots array. Bucket by source so we only pay one pass per
  // doc; pdf-lib copyPages then carries the new /Annots through to the
  // output along with any pre-existing source annotations.
  const annotationsForSave =
    redactions.length > 0 ? applyRedactionsToNewAnnotations(annotations, redactions) : annotations;
  if (annotationsForSave.length > 0) {
    const annotsBySource = new Map<string, Annotation[]>();
    for (const a of annotationsForSave) {
      const list = annotsBySource.get(a.sourceKey) ?? [];
      list.push(a);
      annotsBySource.set(a.sourceKey, list);
    }
    for (const [sourceKey, list] of annotsBySource) {
      const ctx = ctxBySource.get(sourceKey);
      if (!ctx) continue;
      await applyAnnotationsToDoc(ctx.doc, list, { getFont: ctx.getFont });
    }
  }

  // Annotation redaction - sanitize native /Annots before copyPages
  // preserves them into the output. Geometry-based markups can be
  // clipped/split; text-bearing or otherwise unsupported annotation
  // types are removed on overlap so their dictionaries do not keep
  // recoverable content under the black redaction rectangle.
  if (redactions.length > 0) {
    for (const [sourceKey, ctx] of ctxBySource) {
      const sourceRedactions = redactionsBySource.get(sourceKey) ?? [];
      if (sourceRedactions.length === 0) continue;
      const byPage = new Map<number, Redaction[]>();
      for (const r of sourceRedactions) {
        const list = byPage.get(r.pageIndex) ?? [];
        list.push(r);
        byPage.set(r.pageIndex, list);
      }
      for (const [pageIndex, pageRedactions] of byPage) {
        const page = ctx.doc.getPages()[pageIndex];
        if (!page) continue;
        applyRedactionsToPageAnnotations(ctx.doc, page, pageRedactions);
      }
    }
  }

  // Redactions — opaque black rectangles drawn into each target
  // page's content stream. The glyph strip half is already wired
  // upstream (synthetic deleted Edits), so by the time we reach this
  // pass the underlying Tj/TJ ops are gone; we just need to paint
  // the rect. `page.drawRectangle` appends to the page's content
  // stream, so the result is real graphics ops, not an /Annot — no
  // viewer can hide it, and no extractor can recover anything from
  // beneath it (there's nothing left beneath it to recover).
  if (redactions.length > 0) {
    for (const r of redactions) {
      const ctx = ctxBySource.get(r.sourceKey);
      if (!ctx) continue;
      const page = ctx.doc.getPages()[r.pageIndex];
      if (!page) continue;
      page.drawRectangle({
        x: r.pdfX,
        y: r.pdfY,
        width: r.pdfWidth,
        height: r.pdfHeight,
        color: rgb(0, 0, 0),
        borderWidth: 0,
      });
    }
  }

  // Build the output by walking `slots[]` in order. Edits are baked
  // into each source's `doc` from the loops above; copyPages preserves
  // embedded fonts / images / XObjects. Blanks with inserts / draws /
  // annotations have a synthetic ctx — copyPages from that doc so the
  // applied content carries through. Blanks with NO content fall back
  // to a bare `output.addPage(slot.size)` (no synthetic ctx materialised).
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const indicesPerSource = new Map<string, number[]>();
  for (const slot of slots) {
    if (slot.kind === "page") {
      const arr = indicesPerSource.get(slot.sourceKey) ?? [];
      arr.push(slot.sourcePageIndex);
      indicesPerSource.set(slot.sourceKey, arr);
    } else {
      const sk = blankSourceKey(slot.id);
      if (ctxBySource.has(sk)) indicesPerSource.set(sk, [0]);
    }
  }
  const copiedPerSource = new Map<string, Awaited<ReturnType<typeof output.copyPages>>>();
  for (const [sourceKey, indices] of indicesPerSource) {
    const ctx = ctxBySource.get(sourceKey);
    if (!ctx) continue;
    const copied = await output.copyPages(ctx.doc, indices);
    copiedPerSource.set(sourceKey, copied);
  }
  const cursorPerSource = new Map<string, number>();
  const outputRedactionsByPage = new Map<number, Redaction[]>();
  for (const slot of slots) {
    const outputPageIndex = output.getPageCount();
    if (slot.kind === "blank") {
      const sk = blankSourceKey(slot.id);
      const copied = copiedPerSource.get(sk);
      if (copied && copied.length > 0) {
        output.addPage(copied[0]);
      } else {
        output.addPage(slot.size);
      }
      const pageRedactions = redactionsBySource.get(sk)?.filter((r) => r.pageIndex === 0) ?? [];
      if (pageRedactions.length > 0) outputRedactionsByPage.set(outputPageIndex, pageRedactions);
      continue;
    }
    const copied = copiedPerSource.get(slot.sourceKey);
    if (!copied) continue;
    const cursor = cursorPerSource.get(slot.sourceKey) ?? 0;
    output.addPage(copied[cursor]);
    cursorPerSource.set(slot.sourceKey, cursor + 1);
    const pageRedactions =
      redactionsBySource.get(slot.sourceKey)?.filter((r) => r.pageIndex === slot.sourcePageIndex) ??
      [];
    if (pageRedactions.length > 0) outputRedactionsByPage.set(outputPageIndex, pageRedactions);
  }
  if (outputRedactionsByPage.size > 0) {
    for (const [pageIndex, pageRedactions] of outputRedactionsByPage) {
      const page = output.getPages()[pageIndex];
      if (!page) continue;
      applyRedactionsToFormWidgets(output, new Map([[pageIndex, pageRedactions]]));
      applyRedactionsToPageAnnotations(output, page, pageRedactions);
    }
  }
  // After every page has landed in the output, rebuild /AcroForm/Fields
  // from the widgets that came across with copyPages. copyPages deep-
  // copies widget dicts and their /Parent → field chains, but doesn't
  // carry /Root /AcroForm itself, so without this step the saved file
  // would have the field tree populated but unreachable — viewers
  // would render the (now-stripped) /AP and ignore /V on reopen.
  if (formFills.length > 0) {
    rebuildOutputAcroForm(output);
  }
  return output.save();
}
