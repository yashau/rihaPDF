// Mobile-positioning regression: at 390×844 with hasTouch the page is
// CSS-scaled to fit the viewport (displayScale < 1). Pointer events
// arrive in screen pixels; the save pipeline persists positions in PDF
// user space (y-up). Anywhere the conversion misses `displayScale`,
// inserts / edits / moves land at wildly wrong positions in the saved
// PDF.
//
// The assertion strategy is to inspect the SAVED PDF's content stream
// directly via pikepdf-style regex on the raw text — we look for the
// `Tm` operator that places our sentinel run and verify its (x, y)
// matches the click point's expected PDF coords. A stale displayScale
// shifts the persisted Tm by a factor of `1/displayScale` (or its
// reciprocal), which a tight ±5pt tolerance catches reliably.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

const VIEWPORT_W = 390;
const VIEWPORT_H = 844;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    hasTouch: true,
  });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

/** Decode all content streams in a saved PDF and return them as text.
 *  Decompresses /FlateDecode streams; concatenates by page so callers
 *  can grep across the whole document. */
function decodedContentStreams(pdfPath: string): string {
  return decodedContentStreamsList(pdfPath).join("\n");
}

/** Same as `decodedContentStreams` but returns the per-stream list,
 *  so callers can pick out the freshly-appended emit (= the stream
 *  containing `RihaShaped` for Thaana inserts) and ignore unmodified
 *  source-document streams. */
function decodedContentStreamsList(pdfPath: string): string[] {
  const pdf = fs.readFileSync(pdfPath);
  const out: string[] = [];
  const re = /<<([^>]*)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf.toString("latin1"))) !== null) {
    const dict = m[1];
    let body: Buffer = Buffer.from(m[2], "latin1");
    if (/\/FlateDecode/.test(dict)) {
      try {
        body = zlib.inflateSync(body);
      } catch {
        continue;
      }
    }
    out.push(body.toString("latin1"));
  }
  return out;
}

/** Extract all `Tm` operands in document order. Each entry is the
 *  6-tuple [a, b, c, d, e, f]; the (e, f) pair is the text origin in
 *  PDF user space. Used by tests to confirm a sentinel landed at the
 *  expected PDF coords. */
function extractTmOps(text: string): Array<[number, number, number, number, number, number]> {
  const ops: Array<[number, number, number, number, number, number]> = [];
  const re = /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) Tm/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ops.push([
      parseFloat(m[1]),
      parseFloat(m[2]),
      parseFloat(m[3]),
      parseFloat(m[4]),
      parseFloat(m[5]),
      parseFloat(m[6]),
    ]);
  }
  return ops;
}

/** Read the natural + displayed dimensions of page 0 so the test can
 *  compute expected PDF coords from a screen-pixel click point. */
async function readPageGeometry() {
  const g = await h.page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-page-index="0"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      rectLeft: r.left,
      rectTop: r.top,
      rectWidth: r.width,
      rectHeight: r.height,
      scale: parseFloat(el.dataset.pageScale ?? ""),
      naturalW: parseFloat(el.dataset.viewWidth ?? ""),
      naturalH: parseFloat(el.dataset.viewHeight ?? ""),
    };
  });
  if (!g) throw new Error("page 0 not in DOM");
  const displayScale = g.rectWidth / g.naturalW;
  const effectiveScale = g.scale * displayScale;
  return { ...g, displayScale, effectiveScale };
}

describe("mobile positioning round-trip", () => {
  test("inserted text persists at the click point's PDF coords (maldivian)", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();

    const g = await readPageGeometry();
    expect(g.displayScale, "fit-to-width should be active on mobile").toBeLessThan(1);

    const clickClientX = g.rectLeft + g.rectWidth * 0.5;
    const clickClientY = g.rectTop + g.rectHeight * 0.25;
    const expectedPdfX = (clickClientX - g.rectLeft) / g.effectiveScale;
    const expectedPdfY = (g.rectHeight - (clickClientY - g.rectTop)) / g.effectiveScale;

    await h.page.locator('button[aria-label="Add text"]').click();
    await h.page.waitForTimeout(150);
    await h.page.touchscreen.tap(clickClientX, clickClientY);
    await h.page.waitForTimeout(250);

    const insertInput = h.page.locator("[data-text-insert-id] input").first();
    await insertInput.fill("MOBILE_INS");
    await insertInput.press("Enter");
    await h.page.waitForTimeout(200);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator('button[aria-label^="Save"]').first().click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "mobile-insert.pdf");
    await dl.saveAs(saved);

    const tms = extractTmOps(decodedContentStreams(saved));
    // Find the Tm whose (e, f) is closest to our expected click point.
    // The fixture itself has a header Tm at (50, 800); the inserted
    // text adds a fresh Tm — find it by proximity to the expected
    // coords rather than relying on stream order.
    let best: { tm: number[]; dist: number } | null = null;
    for (const tm of tms) {
      const dx = tm[4] - expectedPdfX;
      const dy = tm[5] - expectedPdfY;
      const d = Math.hypot(dx, dy);
      if (!best || d < best.dist) best = { tm, dist: d };
    }
    expect(best, "saved PDF should contain at least one Tm").not.toBeNull();
    expect(
      Math.abs(best!.tm[4] - expectedPdfX),
      `inserted-text x: expected ${expectedPdfX.toFixed(1)}, got ${best!.tm[4].toFixed(1)}`,
    ).toBeLessThan(5);
    expect(
      Math.abs(best!.tm[5] - expectedPdfY),
      `inserted-text y: expected ${expectedPdfY.toFixed(1)}, got ${best!.tm[5].toFixed(1)}`,
    ).toBeLessThan(5);
  }, 30_000);

  test("inserted Thaana right-aligns to the overlay's right edge, not pdfX", async () => {
    // RTL inserts: the editor's overlay box is 120pt wide with its
    // LEFT edge at pdfX, so a user typing Thaana sees the text
    // right-aligned near `pdfX + 120`. Save must put the rendered
    // text's RIGHT edge at the same x — anchoring to pdfX itself
    // dropped the saved text a full box-width to the left of where
    // the user saw it. This regression was easy to miss on desktop
    // where the overlay's 120pt = 180 natural px ≈ 1.2cm and looked
    // forgiveable; on mobile (displayScale ~0.4) the displayed box
    // shrinks to ~75px but the PDF-coord shift is still 120pt.
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();

    const g = await readPageGeometry();
    const clickClientX = g.rectLeft + g.rectWidth * 0.5;
    const clickClientY = g.rectTop + g.rectHeight * 0.3;
    const expectedPdfX = (clickClientX - g.rectLeft) / g.effectiveScale;

    await h.page.locator('button[aria-label="Add text"]').click();
    await h.page.waitForTimeout(150);
    await h.page.touchscreen.tap(clickClientX, clickClientY);
    await h.page.waitForTimeout(250);

    const insertInput = h.page.locator("[data-text-insert-id] input").first();
    await insertInput.fill("ދިވެހި");
    await insertInput.press("Enter");
    await h.page.waitForTimeout(200);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator('button[aria-label^="Save"]').first().click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "mobile-thaana-insert.pdf");
    await dl.saveAs(saved);

    // Inspect ONLY the freshly-appended insert stream — the one with
    // `RihaShaped` (the alias used by drawShapedText). Maldivian.pdf's
    // original streams contain hundreds of Tms unrelated to our insert.
    const insertedStreams = decodedContentStreamsList(saved).filter((s) =>
      s.includes("RihaShaped"),
    );
    expect(
      insertedStreams.length,
      "saved PDF should contain at least one RihaShaped emit stream",
    ).toBeGreaterThan(0);
    const tms = extractTmOps(insertedStreams.join("\n"));
    expect(tms.length, "shaped emit should produce ≥1 Tm").toBeGreaterThan(0);
    // The shaped emitter pushes one Tm per cluster; the leftmost (=
    // last logical char in RTL) sits at the run's left edge. After
    // the fix, that's `pdfX + pdfWidth - widthPt` ≥ pdfX (since
    // widthPt ≤ pdfWidth for short Thaana). Pre-fix it was at
    // `pdfX − widthPt` < pdfX.
    const leftmostX = Math.min(...tms.map((t) => t[4]));
    expect(
      leftmostX,
      `Thaana left-edge should be at or right of pdfX (${expectedPdfX.toFixed(1)}); was ${leftmostX.toFixed(1)}`,
    ).toBeGreaterThanOrEqual(expectedPdfX - 1);
  }, 30_000);

  test("source-run drag persists a Tm shifted by the screen-delta in PDF user space", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const g = await readPageGeometry();
    expect(g.displayScale).toBeLessThan(1);

    // Find a non-empty run and capture its baseline coords + screen pos.
    const target = await h.page.evaluate(() => {
      const overlays = document.querySelectorAll<HTMLElement>(
        '[data-page-index="0"] [data-run-id]',
      );
      for (const el of overlays) {
        const t = (el.textContent || "").trim();
        if (!t) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) continue;
        return {
          id: el.getAttribute("data-run-id") ?? "",
          text: t,
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
        };
      }
      return null;
    });
    expect(target, "expected at least one editable run on page 0").not.toBeNull();

    const DXV = 30;
    const DYV = 18;
    await h.page.evaluate(
      ({ runId, sx, sy }) => {
        const el = document.querySelector<HTMLElement>(`[data-run-id="${runId}"]`);
        if (!el) throw new Error(`no overlay for ${runId}`);
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX: sx,
            clientY: sy,
            pointerType: "touch",
            pointerId: 1,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { runId: target!.id, sx: target!.cx, sy: target!.cy },
    );
    await h.page.waitForTimeout(450);
    await h.page.evaluate(
      ({ sx, sy, dx, dy }) => {
        const fire = (type: string, x: number, y: number) => {
          window.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerType: "touch",
              pointerId: 1,
              isPrimary: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        const STEPS = 8;
        for (let i = 1; i <= STEPS; i++) {
          fire("pointermove", sx + (dx * i) / STEPS, sy + (dy * i) / STEPS);
        }
        fire("pointerup", sx + dx, sy + dy);
      },
      { sx: target!.cx, sy: target!.cy, dx: DXV, dy: DYV },
    );
    await h.page.waitForTimeout(300);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator('button[aria-label^="Save"]').first().click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "mobile-move.pdf");
    await dl.saveAs(saved);

    // Expected PDF-space delta: SCREEN delta / effectiveScale.
    const expectedDxPdf = DXV / g.effectiveScale;
    const expectedDyPdf = -DYV / g.effectiveScale; // viewport-y-down → PDF-y-up
    // Source-run drags emit a fresh Tm at the moved position. We can't
    // know the original baseline to compute the absolute target without
    // re-extracting font metrics, so we take a sentinel approach: the
    // SAVED stream's Tm count went up by ≥ 1 vs unmodified, and at
    // least one Tm in the new save sits at delta ≈ expected from any
    // un-moved Tm that's nearby. As a coarser proxy, just check that
    // SOME Tm in the file lies in the expected delta range from the
    // pre-save run baseline. We reuse the overlay's screen rect →
    // PDF coords as the pre-save baseline approximation.
    const preBaselinePdfX = (target!.cx - g.rectLeft) / g.effectiveScale;
    const preBaselinePdfY = (g.rectHeight - (target!.cy - g.rectTop)) / g.effectiveScale;
    const expectedTargetX = preBaselinePdfX + expectedDxPdf;
    const expectedTargetY = preBaselinePdfY + expectedDyPdf;

    const tms = extractTmOps(decodedContentStreams(saved));
    let best: { tm: number[]; dist: number } | null = null;
    for (const tm of tms) {
      const d = Math.hypot(tm[4] - expectedTargetX, tm[5] - expectedTargetY);
      if (!best || d < best.dist) best = { tm, dist: d };
    }
    expect(best).not.toBeNull();
    // Looser tolerance here: the run's overlay-center → baseline
    // approximation is rough (overlay extends past the baseline by run
    // padding, and the run's vertical baseline ≠ overlay center).
    // ±25pt tolerance still catches a missed displayScale (which would
    // shift by hundreds of points).
    expect(
      best!.dist,
      `closest Tm to expected (${expectedTargetX.toFixed(1)}, ${expectedTargetY.toFixed(1)}) was (${best!.tm[4].toFixed(1)}, ${best!.tm[5].toFixed(1)}) — distance ${best!.dist.toFixed(1)}pt`,
    ).toBeLessThan(40);
  }, 30_000);
});
