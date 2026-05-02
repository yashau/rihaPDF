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
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from "pdf-lib";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
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
});
