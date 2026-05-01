// Drag an image, then sample a pixel at its ORIGINAL position to
// confirm the live preview canvas has the original glyphs removed
// (no big white cover, just the page background showing through).
// Driven by test/fixtures/with-images.pdf so it doesn't depend on
// any user-specific PDF.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
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

async function pixelAt(cx: number, cy: number) {
  return h.page.evaluate(
    ({ cx, cy }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-page-index="0"] canvas');
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      const sx = canvas.width / r.width;
      const sy = canvas.height / r.height;
      const px = Math.round((cx - r.x) * sx);
      const py = Math.round((cy - r.y) * sy);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
      const ctx = canvas.getContext("2d")!;
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    },
    { cx, cy },
  );
}

describe("preview strip — original glyphs disappear, no white cover", () => {
  test("dragging an image clears its source-position pixels on the live canvas", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    const overlays = await h.page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-image-id]")).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute("data-image-id")!,
          cx: Math.round(r.x + r.width / 2),
          cy: Math.round(r.y + r.height / 2),
        };
      }),
    );
    expect(overlays.length).toBeGreaterThanOrEqual(1);
    const target = overlays[0];

    const before = await pixelAt(target.cx, target.cy);
    expect(before, "fixture should expose canvas pixels at the image centroid").not.toBeNull();
    // The synthetic fixture fills the target with red ink — must not
    // be near-white before the drag.
    const beforeIsInk = !!before && before[0] + before[1] + before[2] < 600;
    expect(
      beforeIsInk,
      `expected ink at centroid before drag, got rgba(${before?.join(",")})`,
    ).toBe(true);

    // Drag by a chunk so the move clearly clears the source rect.
    const DRAG_DX = 200;
    const DRAG_DY = 100;
    const dragLoc = h.page.locator(`[data-image-id="${target.id}"]`);
    const box = await dragLoc.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await h.page.mouse.move(cx, cy);
    await h.page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await h.page.mouse.move(cx + (DRAG_DX * i) / 8, cy + (DRAG_DY * i) / 8);
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    // Preview rebuild is debounced 150ms + a render pass; give it time.
    await h.page.waitForTimeout(900);

    await h.page.locator('[data-page-index="0"]').screenshot({
      path: path.join(SCREENSHOTS, "preview-strip-after-drag.png"),
    });

    const after = await pixelAt(target.cx, target.cy);
    const afterIsBackground = !!after && after[0] > 230 && after[1] > 230 && after[2] > 230;
    expect(
      afterIsBackground,
      `expected page background at centroid after drag, got rgba(${after?.join(",")})`,
    ).toBe(true);
  });
});
