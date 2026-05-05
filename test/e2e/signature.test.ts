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

async function clearSignatureStorage() {
  await h.page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("rihaPDF.signatures");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("Failed to clear signature storage"));
      req.onblocked = () => resolve();
    });
  });
}

async function captureImageCount(pdfPath: string): Promise<number> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const mod = (await importer(
      "/src/lib/sourceImages.ts",
    )) as typeof import("../../src/lib/sourceImages");
    const images = await mod.extractPageImages(bytes.buffer);
    return images[0]?.length ?? 0;
  }, bytes.toString("base64"));
}

async function saveAs(filename: string): Promise<string> {
  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const saved = path.join(SCREENSHOTS, filename);
  await dl.saveAs(saved);
  return saved;
}

describe("signature insertion", () => {
  test("draw signature, save to library, place, and persist as a page image", async () => {
    await clearSignatureStorage();
    await loadFixture(h.page, FIXTURE.withImages);
    const before = await captureImageCount(FIXTURE.withImages);

    await h.page.locator('[data-testid="tool-signature"]').click();
    const canvas = h.page.locator('[data-testid="signature-draw-canvas"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width * 0.2;
    const startY = box!.y + box!.height * 0.55;
    await h.page.mouse.move(startX, startY);
    await h.page.mouse.down();
    await h.page.mouse.move(startX + 90, startY - 35, { steps: 4 });
    await h.page.mouse.move(startX + 170, startY + 20, { steps: 4 });
    await h.page.mouse.move(startX + 260, startY - 20, { steps: 4 });
    await h.page.mouse.up();

    await h.page.getByRole("button", { name: "Save", exact: true }).click();
    const savedSignature = h.page.locator('button[aria-label="Place saved signature"]').first();
    expect(await savedSignature.isVisible()).toBe(true);
    await savedSignature.click();
    await h.page.getByRole("heading", { name: "Add Signature" }).waitFor({ state: "hidden" });

    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.55,
      pageBox!.y + pageBox!.height * 0.55,
    );
    await h.page.waitForTimeout(300);

    const overlayBg = await h.page
      .locator("[data-image-insert-id]")
      .last()
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(overlayBg).toMatch(/url\(.*data:image\/png;base64,/);

    const saved = await saveAs("signature-insert.pdf");
    const after = await captureImageCount(saved);
    expect(after).toBe(before + 1);
  }, 60_000);

  test("import processing removes a light background and trims transparent pixels", async () => {
    await h.page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
    const result = await h.page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
      const sig = (await importer(
        "/src/lib/signatures.ts",
      )) as typeof import("../../src/lib/signatures");
      const canvas = document.createElement("canvas");
      canvas.width = 260;
      canvas.height = 120;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgb(250, 248, 241)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgb(20, 24, 32)";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(50, 70);
      ctx.bezierCurveTo(90, 20, 130, 105, 180, 50);
      ctx.lineTo(215, 66);
      ctx.stroke();
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      const file = new File([blob], "signature.png", { type: "image/png" });
      const processed = await sig.processImportedSignature(file, [0, 0, 0]);
      if (!processed) return null;
      const copied = new ArrayBuffer(processed.bytes.byteLength);
      new Uint8Array(copied).set(processed.bytes);
      const bmp = await createImageBitmap(new Blob([copied], { type: "image/png" }));
      const out = document.createElement("canvas");
      out.width = bmp.width;
      out.height = bmp.height;
      const outCtx = out.getContext("2d")!;
      outCtx.drawImage(bmp, 0, 0);
      const data = outCtx.getImageData(0, 0, out.width, out.height).data;
      const cornerAlpha = data[3];
      return {
        width: processed.naturalWidth,
        height: processed.naturalHeight,
        cornerAlpha,
      };
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBeLessThan(220);
    expect(result!.height).toBeLessThan(100);
    expect(result!.cornerAlpha).toBe(0);
  });
});
