// Drag an image, save, reload — assert the moved image landed at the
// expected new PDF-space position and every other image stayed put.
// Replaces the old scripts/verifyImageMove.mjs which depended on a
// personal e-Visa PDF; now driven by test/fixtures/with-images.pdf.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
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
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

async function captureImages(pdfPath: string) {
  const bytes = fs.readFileSync(pdfPath);
  const b64 = bytes.toString("base64");
  // `new Function('return import(p)')` keeps vitest's SSR transform
  // from rewriting the dynamic import to a helper that doesn't exist
  // in the browser — see test/helpers/browser.ts:dynImport.
  return h.page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importer = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<typeof import("../../src/lib/sourceImages")>;
    const mod = await importer("/src/lib/sourceImages.ts");
    const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const all = await mod.extractPageImages(buf);
    return all.map((perPage) =>
      perPage.map((i) => ({
        id: i.id,
        resourceName: i.resourceName,
        pdfX: i.pdfX,
        pdfY: i.pdfY,
        w: i.pdfWidth,
        h: i.pdfHeight,
      })),
    );
  }, b64);
}

describe("image XObject move", () => {
  test("dragging an image rewrites its cm op; neighbours unchanged", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    const before = await captureImages(FIXTURE.withImages);
    expect(before[0].length, "synthetic fixture should have ≥ 2 images").toBeGreaterThanOrEqual(2);
    const target = before[0][0];

    // Locate the on-screen overlay for the target image and drag it.
    const dragLoc = h.page.locator(`[data-image-id="${target.id}"]`);
    const box = await dragLoc.boundingBox();
    expect(box, `image overlay ${target.id} not in DOM`).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const DRAG_DX = 60;
    const DRAG_DY = 30;
    await h.page.mouse.move(cx, cy);
    await h.page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await h.page.mouse.move(cx + (DRAG_DX * i) / 8, cy + (DRAG_DY * i) / 8);
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(300);

    // Save and reload.
    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "image-move.pdf");
    await dl.saveAs(saved);

    await loadFixture(h.page, saved);
    const after = await captureImages(saved);

    // Every image should still be present, target moved by the
    // expected Δ in PDF user space, others stayed put.
    const expectedDx = DRAG_DX / RENDER_SCALE;
    const expectedDy = -DRAG_DY / RENDER_SCALE; // viewport y-down → PDF y-up flip
    expect(after[0].length).toBe(before[0].length);
    for (let i = 0; i < before[0].length; i++) {
      const b = before[0][i];
      const a = after[0][i];
      const isTarget = b.id === target.id;
      const wantDx = isTarget ? expectedDx : 0;
      const wantDy = isTarget ? expectedDy : 0;
      expect(a.pdfX - b.pdfX, `${b.id} pdfX drift`).toBeCloseTo(wantDx, 0);
      expect(a.pdfY - b.pdfY, `${b.id} pdfY drift`).toBeCloseTo(wantDy, 0);
    }
  });
});
