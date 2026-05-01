// Drag an image's bottom-right corner to resize it, save, reload, and
// assert the bottom-left stayed pinned while the size grew by the
// expected viewport→PDF delta. Then drag the top-left corner and check
// the BR-anchored growth math the other direction.

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
  return h.page.evaluate(async (b64) => {
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

async function dragHandle(
  imageId: string,
  corner: "tl" | "tr" | "bl" | "br",
  dxView: number,
  dyView: number,
) {
  const handle = h.page.locator(
    `[data-image-id="${imageId}"] [data-resize-handle="${corner}"]`,
  );
  const box = await handle.boundingBox();
  expect(box, `${corner} handle for ${imageId} not in DOM`).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await h.page.mouse.move(cx, cy);
  await h.page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await h.page.mouse.move(cx + (dxView * i) / 8, cy + (dyView * i) / 8);
    await h.page.waitForTimeout(20);
  }
  await h.page.mouse.up();
  await h.page.waitForTimeout(200);
}

async function saveAs(filename: string): Promise<string> {
  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const saved = path.join(SCREENSHOTS, filename);
  await dl.saveAs(saved);
  return saved;
}

describe("image XObject resize via corner handles", () => {
  test("BR corner drag grows the box, anchoring TL", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const before = await captureImages(FIXTURE.withImages);
    expect(before[0].length).toBeGreaterThanOrEqual(2);
    const target = before[0][0];

    const DXV = 80;
    const DYV = 40;
    await dragHandle(target.id, "br", DXV, DYV);
    const saved = await saveAs("image-resize-br.pdf");

    const after = await captureImages(saved);
    expect(after[0].length).toBe(before[0].length);
    const a = after[0].find((i) => i.id === target.id)!;
    // PDF deltas: width grows by DXV/scale; height grows by DYV/scale.
    // BR anchor in PDF: TOP edge stays put, so pdfY moves DOWN by
    // height-growth (since pdfY is the bottom). pdfX stays.
    const expectedDw = DXV / RENDER_SCALE;
    const expectedDh = DYV / RENDER_SCALE;
    expect(a.w - target.w, "width should grow by DXV/scale").toBeCloseTo(
      expectedDw,
      0,
    );
    expect(a.h - target.h, "height should grow by DYV/scale").toBeCloseTo(
      expectedDh,
      0,
    );
    expect(a.pdfX - target.pdfX, "BR drag keeps left edge").toBeCloseTo(0, 0);
    // Top edge = pdfY + h stays → pdfY' + h' = pdfY + h
    expect(
      a.pdfY + a.h - (target.pdfY + target.h),
      "BR drag keeps top edge",
    ).toBeCloseTo(0, 0);

    // Other images untouched.
    for (const b of before[0]) {
      if (b.id === target.id) continue;
      const ai = after[0].find((x) => x.id === b.id)!;
      expect(ai.pdfX - b.pdfX, `${b.id} drifted`).toBeCloseTo(0, 0);
      expect(ai.pdfY - b.pdfY, `${b.id} drifted`).toBeCloseTo(0, 0);
      expect(ai.w - b.w, `${b.id} resized`).toBeCloseTo(0, 0);
      expect(ai.h - b.h, `${b.id} resized`).toBeCloseTo(0, 0);
    }
  });

  test("TL corner drag shrinks the box, anchoring BR", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const before = await captureImages(FIXTURE.withImages);
    const target = before[0][0];

    // Drag TL handle DOWN-RIGHT: shrinks width and height. The amount
    // is small (well within the original box) so the clamp won't fire.
    const DXV = 30;
    const DYV = 20;
    await dragHandle(target.id, "tl", DXV, DYV);
    const saved = await saveAs("image-resize-tl.pdf");

    const after = await captureImages(saved);
    const a = after[0].find((i) => i.id === target.id)!;
    const expectedDw = -DXV / RENDER_SCALE;
    const expectedDh = -DYV / RENDER_SCALE;
    expect(a.w - target.w).toBeCloseTo(expectedDw, 0);
    expect(a.h - target.h).toBeCloseTo(expectedDh, 0);
    // TL anchor in PDF = BR anchor: right edge & bottom edge stay.
    expect(
      a.pdfX + a.w - (target.pdfX + target.w),
      "TL drag keeps right edge",
    ).toBeCloseTo(0, 0);
    expect(a.pdfY - target.pdfY, "TL drag keeps bottom edge").toBeCloseTo(0, 0);
  });
});
