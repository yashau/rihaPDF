// Annotation round-trip: highlight, comment (FreeText), ink. Each
// tool drops a different /Annot subtype on save; this suite drives
// the UI for each, then parses the saved PDF's /Annots arrays in
// Node via pdf-lib to assert the structural fields are present and
// correctly populated.
//
// We assert on the PDF object structure (subtype, contents, quad
// points, ink list) rather than rendering, since rendering /Annots
// without /AP appearance streams varies across viewers — the spec-
// level structure is what guarantees the saved PDF is a valid
// annotation that any reader can render and edit.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  FIXTURE,
  RENDER_SCALE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser({ viewport: { width: 1400, height: 2900 } });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

type ParsedAnnot = {
  pageIndex: number;
  subtype: string;
  contents: string | null;
  rect: number[] | null;
  quadPoints: number[] | null;
  inkList: number[][] | null;
  fillColor: number[] | null;
  borderWidth: number | null;
};

/** Decode a PDF text-string field (which may be a literal PDFString or
 *  a UTF-16BE-encoded PDFHexString) to a plain JS string. Returns null
 *  for any other object type. */
function decodeTextString(obj: unknown): string | null {
  if (obj instanceof PDFString) return obj.asString();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

function readNumberArray(arr: PDFArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const o = arr.get(i);
    if (o instanceof PDFNumber) out.push(o.asNumber());
  }
  return out;
}

function numberArray(ctx: PDFContext, values: number[]): PDFArray {
  return ctx.obj(values.map((v) => PDFNumber.of(v)));
}

async function writeSourceAnnotationFixture(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date("2024-01-01T00:00:00.000Z"));
  doc.setModificationDate(new Date("2024-01-01T00:00:00.000Z"));
  const page = doc.addPage([595, 842]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SOURCE_ANNOT_FIXTURE", { x: 80, y: 760, size: 16, font: helv });

  const ctx = doc.context;
  const annots = ctx.obj([]);

  const highlight = PDFDict.withContext(ctx);
  highlight.set(PDFName.of("Type"), PDFName.of("Annot"));
  highlight.set(PDFName.of("Subtype"), PDFName.of("Highlight"));
  highlight.set(PDFName.of("Rect"), numberArray(ctx, [80, 700, 260, 724]));
  highlight.set(PDFName.of("QuadPoints"), numberArray(ctx, [80, 724, 260, 724, 80, 700, 260, 700]));
  highlight.set(PDFName.of("C"), numberArray(ctx, [1, 0.92, 0.23]));
  annots.push(ctx.register(highlight));

  const comment = PDFDict.withContext(ctx);
  comment.set(PDFName.of("Type"), PDFName.of("Annot"));
  comment.set(PDFName.of("Subtype"), PDFName.of("FreeText"));
  comment.set(PDFName.of("Rect"), numberArray(ctx, [80, 620, 240, 660]));
  comment.set(PDFName.of("Contents"), PDFString.of("loaded source comment"));
  comment.set(PDFName.of("DA"), PDFString.of("/Helv 12 Tf 0 0 0 rg"));
  comment.set(PDFName.of("IC"), numberArray(ctx, [1, 0.96, 0.62]));
  annots.push(ctx.register(comment));

  const ink = PDFDict.withContext(ctx);
  ink.set(PDFName.of("Type"), PDFName.of("Annot"));
  ink.set(PDFName.of("Subtype"), PDFName.of("Ink"));
  ink.set(PDFName.of("Rect"), numberArray(ctx, [80, 540, 220, 590]));
  ink.set(PDFName.of("InkList"), ctx.obj([numberArray(ctx, [80, 540, 130, 570, 220, 590])]));
  ink.set(PDFName.of("C"), numberArray(ctx, [0.93, 0.27, 0.27]));
  const bs = PDFDict.withContext(ctx);
  bs.set(PDFName.of("W"), PDFNumber.of(2));
  ink.set(PDFName.of("BS"), bs);
  annots.push(ctx.register(ink));

  page.node.set(PDFName.of("Annots"), annots);

  const out = path.join(SCREENSHOTS, "source-annots-input.pdf");
  fs.writeFileSync(out, await doc.save());
  return out;
}

/** Read every /Annots entry on every page of the saved PDF and pull
 *  out the fields we want to assert on. Resolves indirect refs and
 *  skips any entry whose /Subtype isn't recognised here. */
async function readAnnotations(savedPath: string): Promise<ParsedAnnot[]> {
  const bytes = fs.readFileSync(savedPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out: ParsedAnnot[] = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annotsObj = pages[i].node.lookup(PDFName.of("Annots"));
    if (!(annotsObj instanceof PDFArray)) continue;
    for (let j = 0; j < annotsObj.size(); j++) {
      const raw = annotsObj.get(j);
      const dict = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
      if (!(dict instanceof PDFDict)) continue;
      const subtypeObj = dict.lookup(PDFName.of("Subtype"));
      if (!(subtypeObj instanceof PDFName)) continue;
      const subtype = subtypeObj.asString().replace(/^\//, "");
      const rectObj = dict.lookup(PDFName.of("Rect"));
      const quadObj = dict.lookup(PDFName.of("QuadPoints"));
      const inkObj = dict.lookup(PDFName.of("InkList"));
      const icObj = dict.lookup(PDFName.of("IC"));
      const bsObj = dict.lookup(PDFName.of("BS"));
      let inkList: number[][] | null = null;
      if (inkObj instanceof PDFArray) {
        inkList = [];
        for (let k = 0; k < inkObj.size(); k++) {
          const stroke = inkObj.get(k);
          if (stroke instanceof PDFArray) inkList.push(readNumberArray(stroke));
        }
      }
      let borderWidth: number | null = null;
      if (bsObj instanceof PDFDict) {
        const w = bsObj.lookup(PDFName.of("W"));
        if (w instanceof PDFNumber) borderWidth = w.asNumber();
      }
      out.push({
        pageIndex: i,
        subtype,
        contents: decodeTextString(dict.lookup(PDFName.of("Contents"))),
        rect: rectObj instanceof PDFArray ? readNumberArray(rectObj) : null,
        quadPoints: quadObj instanceof PDFArray ? readNumberArray(quadObj) : null,
        inkList,
        fillColor: icObj instanceof PDFArray ? readNumberArray(icObj) : null,
        borderWidth,
      });
    }
  }
  return out;
}

async function saveAndDownload(name: string): Promise<string> {
  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const saved = path.join(SCREENSHOTS, name);
  await dl.saveAs(saved);
  return saved;
}

describe("annotation round-trip", () => {
  test("highlight a text run → saved PDF carries a /Highlight with QuadPoints", async () => {
    await loadFixture(h, FIXTURE.maldivian);
    // Activate the highlight tool, then click any text run on page 1.
    // The first run on the Maldivian doc lands well inside the page,
    // away from the edges where a click could land outside the
    // overlay's bbox.
    await h.page.locator('[data-testid="tool-highlight"]').click();
    const targetRun = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await targetRun.click();
    await h.page.waitForTimeout(150);

    const saved = await saveAndDownload("annotation-highlight.pdf");
    const annots = await readAnnotations(saved);
    const highlights = annots.filter((a) => a.subtype === "Highlight");
    expect(
      highlights.length,
      `expected at least 1 /Highlight annotation, got ${annots.length} total annots`,
    ).toBeGreaterThanOrEqual(1);
    const hl = highlights[0];
    expect(hl.pageIndex).toBe(0);
    expect(hl.rect, "/Rect must be present on /Highlight").toHaveLength(4);
    expect(
      hl.quadPoints,
      "/QuadPoints must be 8 numbers per quad — exactly 8 for a single-line highlight",
    ).toHaveLength(8);
    // The quad must be non-degenerate: TL.x < TR.x and TL.y > BL.y.
    const [x1, y1, x2, , , y3] = hl.quadPoints!;
    expect(x2, "TR.x should be greater than TL.x").toBeGreaterThan(x1);
    expect(y1, "TL.y should be greater than BL.y (PDF y-up)").toBeGreaterThan(y3);
  }, 60_000);

  test("drop a comment, type, save → /FreeText with /Contents matches", async () => {
    await loadFixture(h, FIXTURE.withImages);
    const SENTINEL = "ANNOT_COMMENT_PROBE_42";

    await h.page.locator('[data-testid="tool-comment"]').click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    // Drop in the upper-third of the page, away from the fixture's
    // images so the comment box doesn't overlap them visually.
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.5, pageBox!.y + pageBox!.height * 0.1);
    await h.page.waitForTimeout(200);
    // The comment textarea auto-focuses on creation. Type the sentinel
    // through the page (not into a specific locator) so the test
    // doesn't depend on the textarea's selector — the auto-focus
    // contract is what matters.
    await h.page.keyboard.type(SENTINEL);
    await h.page.waitForTimeout(150);
    // Click far away (top-left corner of the page) to blur and commit.
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await h.page.waitForTimeout(200);

    const saved = await saveAndDownload("annotation-comment.pdf");
    const annots = await readAnnotations(saved);
    const comments = annots.filter((a) => a.subtype === "FreeText");
    expect(comments.length, "expected at least 1 /FreeText annotation").toBeGreaterThanOrEqual(1);
    const c = comments[0];
    expect(c.pageIndex).toBe(0);
    expect(c.contents, "/Contents should round-trip the typed text").toBe(SENTINEL);
    expect(c.rect, "/Rect must be 4 numbers").toHaveLength(4);
    // Border width must be 0 — viewers draw a default 1pt black border
    // for /FreeText without /BS /W 0, which produced the dark border
    // bug we shipped a fix for.
    expect(c.borderWidth, "/BS /W must be 0 to suppress the default border").toBe(0);
    // /IC is the interior fill color; we use the comment's yellow.
    expect(c.fillColor, "/IC fill must be 3 RGB components").toHaveLength(3);
  }, 60_000);

  test("draw an ink stroke → /Ink with /InkList covering the path", async () => {
    await loadFixture(h, FIXTURE.withImages);

    await h.page.locator('[data-testid="tool-ink"]').click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    // Draw a short diagonal stroke in screen space. Multiple move
    // steps so the polyline simplification in AnnotationLayer keeps
    // > 2 points (anything < 2 is dropped on commit).
    const startX = pageBox!.x + pageBox!.width * 0.3;
    const startY = pageBox!.y + pageBox!.height * 0.7;
    await h.page.mouse.move(startX, startY);
    await h.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await h.page.mouse.move(startX + i * 12, startY + i * 6, { steps: 2 });
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(150);

    const saved = await saveAndDownload("annotation-ink.pdf");
    const annots = await readAnnotations(saved);
    const inks = annots.filter((a) => a.subtype === "Ink");
    expect(inks.length, "expected at least 1 /Ink annotation").toBeGreaterThanOrEqual(1);
    const ink = inks[0];
    expect(ink.pageIndex).toBe(0);
    expect(ink.inkList, "/InkList must be present").not.toBeNull();
    expect(ink.inkList!.length, "at least one stroke").toBeGreaterThanOrEqual(1);
    expect(
      ink.inkList![0].length,
      "stroke needs ≥ 4 numbers (2 points) to draw a line",
    ).toBeGreaterThanOrEqual(4);
    expect(ink.borderWidth, "/BS /W is the stroke thickness").toBeGreaterThan(0);
  }, 60_000);

  test("load existing /Annots as editable overlays and save without duplicates", async () => {
    const fixture = await writeSourceAnnotationFixture();
    await loadFixture(h, fixture);

    expect(await h.page.locator("[data-highlight-id]").count()).toBe(1);
    expect(await h.page.locator("[data-annotation-id]").count()).toBe(1);
    expect(await h.page.locator("[data-ink-id]").count()).toBe(1);
    const saveButton = h.page.locator("button").filter({ hasText: /^Save/ });
    expect(await saveButton.isDisabled()).toBe(true);

    await h.page.locator("[data-ink-id]").first().click();
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-ink-id]").count()).toBe(0);
    expect(await saveButton.isDisabled()).toBe(false);

    const saved = await saveAndDownload("source-annots-edited.pdf");
    const annots = await readAnnotations(saved);
    expect(annots.filter((a) => a.subtype === "Highlight")).toHaveLength(1);
    expect(annots.filter((a) => a.subtype === "FreeText")).toHaveLength(1);
    expect(annots.filter((a) => a.subtype === "Ink")).toHaveLength(0);
    expect(annots.filter((a) => a.subtype === "FreeText")[0].contents).toBe(
      "loaded source comment",
    );
  }, 60_000);

  test("select, drag, and delete an ink stroke", async () => {
    await loadFixture(h, FIXTURE.withImagesMultipage, { expectedPages: 2 });

    await h.page.locator('[data-testid="tool-ink"]').click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    const startX = pageBox!.x + pageBox!.width * 0.28;
    const startY = pageBox!.y + pageBox!.height * 0.62;
    await h.page.mouse.move(startX, startY);
    await h.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await h.page.mouse.move(startX + i * 14, startY + i * 7, { steps: 2 });
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(150);

    await h.page.locator('[data-testid="tool-ink"]').click();
    const beforeSaved = await saveAndDownload("annotation-ink-move-before.pdf");
    const beforeInks = (await readAnnotations(beforeSaved)).filter((a) => a.subtype === "Ink");
    expect(beforeInks).toHaveLength(1);
    expect(beforeInks[0].pageIndex, "ink should start on page 1").toBe(0);

    const inkPath = h.page.locator("[data-ink-id]").first();
    const inkBox = await inkPath.boundingBox();
    expect(inkBox).not.toBeNull();
    const dragStartX = inkBox!.x + inkBox!.width / 2;
    const dragStartY = inkBox!.y + inkBox!.height / 2;
    const page2Box = await h.page.locator('[data-page-index="1"]').boundingBox();
    expect(page2Box).not.toBeNull();
    const dragEndX = page2Box!.x + page2Box!.width * 0.35;
    const dragEndY = page2Box!.y + page2Box!.height * 0.2;
    await h.page.mouse.move(dragStartX, dragStartY);
    await h.page.mouse.down();
    await h.page.mouse.move(dragEndX, dragEndY, { steps: 16 });
    await h.page.mouse.up();
    await h.page.waitForTimeout(200);

    const afterMoveSaved = await saveAndDownload("annotation-ink-move-after.pdf");
    const afterMoveInks = (await readAnnotations(afterMoveSaved)).filter(
      (a) => a.subtype === "Ink",
    );
    expect(afterMoveInks).toHaveLength(1);
    expect(afterMoveInks[0].pageIndex, "ink should move into page 2's /Annots").toBe(1);

    await h.page.locator("[data-ink-id]").first().click();
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-ink-id]").count()).toBe(0);
  }, 60_000);

  test("drag a comment → saved /Rect reflects the new position", async () => {
    await loadFixture(h, FIXTURE.withImages);
    const SENTINEL = "ANNOT_MOVE_PROBE_99";

    // Drop a comment at a known origin, type the sentinel, blur to
    // commit out of edit mode (drag only fires when not editing).
    await h.page.locator('[data-testid="tool-comment"]').click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    const originX = pageBox!.x + pageBox!.width * 0.3;
    const originY = pageBox!.y + pageBox!.height * 0.3;
    await h.page.mouse.click(originX, originY);
    await h.page.waitForTimeout(200);
    await h.page.keyboard.type(SENTINEL);
    await h.page.waitForTimeout(150);
    // Click outside to blur; then click the box once to be safely out
    // of the textarea (clicking outside an empty box deletes it, but
    // since we typed the sentinel it persists).
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await h.page.waitForTimeout(200);

    // Save once at origin so we can assert the saved /Rect changes
    // after the drag.
    const beforeSaved = await saveAndDownload("annotation-move-before.pdf");
    const beforeAnnots = (await readAnnotations(beforeSaved)).filter(
      (a) => a.subtype === "FreeText",
    );
    expect(beforeAnnots).toHaveLength(1);
    const beforeRect = beforeAnnots[0].rect!;

    // Drag the comment box ~120px right and ~80px down. The drag must
    // start ON the comment overlay, so re-find it via [data-annotation-id].
    const commentBox = h.page.locator("[data-annotation-id]").first();
    const commentBB = await commentBox.boundingBox();
    expect(commentBB).not.toBeNull();
    const dragStartX = commentBB!.x + commentBB!.width / 2;
    const dragStartY = commentBB!.y + commentBB!.height / 2;
    await h.page.mouse.move(dragStartX, dragStartY);
    await h.page.mouse.down();
    // Multi-step move past the drag threshold (3px for mouse).
    await h.page.mouse.move(dragStartX + 60, dragStartY + 40, { steps: 4 });
    await h.page.mouse.move(dragStartX + 120, dragStartY + 80, { steps: 4 });
    await h.page.mouse.up();
    await h.page.waitForTimeout(200);

    const afterSaved = await saveAndDownload("annotation-move-after.pdf");
    const afterAnnots = (await readAnnotations(afterSaved)).filter((a) => a.subtype === "FreeText");
    expect(afterAnnots).toHaveLength(1);
    const afterRect = afterAnnots[0].rect!;

    // /Rect = [llx, lly, urx, ury]. Dragging right increases llx; dragging
    // down in viewport space decreases lly (PDF y-up, viewport y-down).
    expect(afterRect[0], "/Rect llx should move right after dragging right").toBeGreaterThan(
      beforeRect[0] + 50,
    );
    expect(afterRect[1], "/Rect lly should decrease after dragging down").toBeLessThan(
      beforeRect[1] - 30,
    );
    // The text content must survive the drag — we're moving the
    // annotation, not recreating it.
    expect(afterAnnots[0].contents).toBe(SENTINEL);
  }, 60_000);

  test("same-session redaction clips newly drawn ink in the saved PDF", async () => {
    await loadFixture(h, FIXTURE.maldivian);

    const targetRun = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    const runBox = await targetRun.boundingBox();
    expect(runBox, "target text run should be visible").not.toBeNull();

    await h.page.locator('[data-testid="tool-ink"]').click();
    const inkTargetBox = await targetRun.boundingBox();
    expect(
      inkTargetBox,
      "target text run should still be visible after ink toolbar",
    ).not.toBeNull();
    const y = inkTargetBox!.y + inkTargetBox!.height / 2;
    await h.page.mouse.move(inkTargetBox!.x - 80, y);
    await h.page.mouse.down();
    await h.page.mouse.move(inkTargetBox!.x + inkTargetBox!.width + 80, y, {
      steps: 16,
    });
    await h.page.mouse.up();
    await h.page.waitForTimeout(150);

    await h.page.locator('[data-testid="tool-redact"]').click();
    await targetRun.click();
    await h.page.waitForTimeout(150);
    const redactionBox = await h.page.locator("[data-redaction-id]").first().boundingBox();
    expect(redactionBox, "redaction overlay should be created").not.toBeNull();

    const saved = await saveAndDownload("annotation-ink-redacted-same-session.pdf");
    const inks = (await readAnnotations(saved)).filter((a) => a.subtype === "Ink");
    expect(inks).toHaveLength(1);
    expect(inks[0].inkList, "/InkList should survive with outside segments only").not.toBeNull();

    const redLeft = redactionBox!.x;
    const redRight = redactionBox!.x + redactionBox!.width;
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();

    for (const stroke of inks[0].inkList!) {
      for (let i = 0; i + 1 < stroke.length; i += 2) {
        const xScreen = pageBox!.x + stroke[i] * RENDER_SCALE;
        expect(
          xScreen <= redLeft + 1 || xScreen >= redRight - 1,
          `ink point ${xScreen} should not remain inside saved redaction span ${redLeft}..${redRight}`,
        ).toBe(true);
      }
    }
  }, 60_000);
});
