// Drag an image, save, reload — assert the moved image landed at the
// expected new PDF-space position and every other image stayed put.
// Replaces the old scripts/verifyImageMove.mjs which depended on a
// personal e-Visa PDF; now driven by test/fixtures/with-images.pdf.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import {
  FIXTURE,
  RENDER_SCALE,
  SCREENSHOTS,
  captureImages,
  loadFixture,
  saveAndDownload,
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

describe("image XObject move", () => {
  test("dragging an image rewrites its cm op; neighbours unchanged", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    const before = await captureImages(h.page, FIXTURE.withImages);
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
    const saved = await saveAndDownload(h.page, "image-move.pdf");

    await loadFixture(h.page, saved);
    const after = await captureImages(h.page, saved);

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
