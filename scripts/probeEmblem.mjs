// Probe the emblem image overlay on page 0 of maldivian2.pdf:
//
//   * extract the image's declared geometry (pdfX / pdfY / width / height)
//     via the app's sourceImages module
//   * grab the on-screen rect of the [data-image-id] overlay
//   * sample the canvas at the overlay's centroid AND at a few page-relative
//     "where I expect the emblem to actually be" centroids — to tell
//     whether the overlay is misaligned vs the rendered emblem
//   * select the overlay (click) so the resize handles render, then capture
//     each handle's viewport rect
//   * screenshot the page-0 viewport so we can eyeball the misalignment

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(root, "test/fixtures/maldivian2.pdf");
const OUT = path.resolve(root, "test/e2e/screenshots/probe-emblem-maldivian2.png");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
setTimeout(() => process.exit(2), 90_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 30_000 });

// Wait for stable canvases
let lastReady = -1;
let stableSince = Date.now();
const DEADLINE = Date.now() + 30_000;
while (Date.now() < DEADLINE) {
  const counts = await page.evaluate(() => {
    const pages = document.querySelectorAll("[data-page-index]");
    let withCanvas = 0;
    for (const p of pages) if (p.querySelector("canvas")) withCanvas++;
    return { total: pages.length, ready: withCanvas };
  });
  if (counts.ready !== lastReady) {
    lastReady = counts.ready;
    stableSince = Date.now();
  } else if (counts.ready > 0 && counts.ready === counts.total && Date.now() - stableSince >= 1500) {
    break;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(800);

// Scroll back to page 0.
await page.locator('[data-page-index="0"]').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);

// Pull image extraction info + overlay rects.
const b64 = fs.readFileSync(PDF).toString("base64");
const info = await page.evaluate(async (b64) => {
  const importer = new Function("p", "return import(p)");
  const mod = await importer("/src/lib/sourceImages.ts");
  const dumpMod = await importer("/src/dev/dumpXObjectGeometry.ts");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const imagesByPage = await mod.extractPageImages(bytes);
  const xoGeom = await dumpMod.dumpXObjectGeometry(bytes, 0);

  const overlays = [];
  for (const el of document.querySelectorAll('[data-page-index="0"] [data-image-id]')) {
    const r = el.getBoundingClientRect();
    overlays.push({
      id: el.getAttribute("data-image-id"),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    });
  }
  // Page0 host rect + canvas dims.
  const host = document.querySelector('[data-page-index="0"]');
  const hostRect = host ? host.getBoundingClientRect() : null;
  const scale = host ? Number(host.getAttribute("data-page-scale")) : null;
  const viewWidth = host ? Number(host.getAttribute("data-view-width")) : null;
  const viewHeight = host ? Number(host.getAttribute("data-view-height")) : null;
  return {
    extracted: imagesByPage[0] ?? [],
    overlays,
    page: { hostRect, scale, viewWidth, viewHeight },
    xoGeom,
  };
}, b64);
console.log("\nXObject dicts on page 0 (Subtype / BBox / Matrix):");
for (const g of info.xoGeom) {
  console.log(`  ${g.resourceName}: subtype=${g.subtype} bbox=${JSON.stringify(g.bbox)} matrix=${JSON.stringify(g.matrix)}`);
}
console.log("page meta:", JSON.stringify(info.page, null, 2));
console.log("\nextracted images on page 0:");
for (const im of info.extracted) {
  console.log(
    `  id=${im.id} resourceName=${im.resourceName} subtype=${im.subtype} pdfX=${im.pdfX.toFixed(1)} pdfY=${im.pdfY.toFixed(1)} pdfW=${im.pdfWidth.toFixed(1)} pdfH=${im.pdfHeight.toFixed(1)} ctm=[${im.ctm.map((n) => n.toFixed(2)).join(",")}]`,
  );
}
console.log("\noverlay DOM rects:");
for (const o of info.overlays) {
  console.log(`  id=${o.id}  rect=${JSON.stringify(o.rect)}`);
}

// Click the overlay to select it (ImageOverlay's click path), then read
// each resize handle's bounding rect.
if (info.overlays.length > 0) {
  const id = info.overlays[0].id;
  await page.locator(`[data-image-id="${id}"]`).click();
  await page.waitForTimeout(200);
  const handles = await page.evaluate((id) => {
    const overlay = document.querySelector(`[data-image-id="${id}"]`);
    if (!overlay) return [];
    const out = [];
    for (const child of overlay.querySelectorAll("[data-resize-corner], [data-resize-handle]")) {
      const r = child.getBoundingClientRect();
      out.push({
        corner:
          child.getAttribute("data-resize-corner") ?? child.getAttribute("data-resize-handle"),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      });
    }
    return out;
  }, id);
  console.log("\nresize handles (post-select):");
  for (const h of handles) {
    console.log(`  ${h.corner}: ${JSON.stringify(h.rect)}`);
  }

  // Try a small drag — see if it moves.
  const before = await page.locator(`[data-image-id="${id}"]`).boundingBox();
  console.log("\noverlay before drag:", JSON.stringify(before));
  if (before) {
    const cx = before.x + before.width / 2;
    const cy = before.y + before.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(cx + (60 * i) / 8, cy + (30 * i) / 8);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await page.locator(`[data-image-id="${id}"]`).boundingBox();
    console.log("overlay after drag:", JSON.stringify(after));
    console.log(
      "delta:",
      after && before ? `dx=${after.x - before.x}, dy=${after.y - before.y}` : "n/a",
    );
  }
}

// Final screenshot of the top of page 0.
const pHost = info.page.hostRect;
const cropY = pHost ? Math.max(0, pHost.y) : 0;
const cropH = Math.min(1900 - cropY, 700);
await page.screenshot({
  path: OUT,
  clip: { x: pHost ? Math.max(0, pHost.x - 20) : 0, y: cropY, width: 1000, height: cropH },
});
console.log("\nscreenshot:", OUT);

await browser.close();
process.exit(0);
