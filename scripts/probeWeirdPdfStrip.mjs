// Local probe for the 2026-05 weird legacy-Thaana PDF strip issue.
// Usage:
//   PDF_PATH="C:\\path\\file.pdf" node scripts/probeWeirdPdfStrip.mjs p1-r22 [neighborRunId]
// Requires `pnpm dev --host 127.0.0.1` (or equivalent) to be running.

import { chromium } from "playwright";

const DEFAULT_PDF =
  "C:\\Users\\Yashau\\.openclaw\\media\\inbound\\5_6053142584165931466---10ed3eea-dc0d-43f7-a99e-d25edbf9d692.pdf";
const PDF = process.env.PDF_PATH ?? DEFAULT_PDF;
const runId = process.argv[2] ?? "p1-r22";
const neighborRunId = process.argv[3] ?? null;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 1900 } });
const page = await context.newPage();

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.locator('input[data-testid="open-pdf-input"]').setInputFiles(PDF);
await page.waitForSelector('[data-page-index="0"] canvas', { timeout: 60_000 });
await page.waitForTimeout(3_000);

const savedRects = new Map();
async function sampleRunBox(id) {
  return page.evaluate(
    ({ runId, savedRect }) => {
      const el = document.querySelector(`[data-run-id="${runId}"]`);
      if (!el && !savedRect) return null;
      const host = document.querySelector('[data-page-index="0"]');
      const canvas = host?.querySelector("canvas");
      if (!canvas) return null;
      const raw = savedRect ?? el.getBoundingClientRect();
      const rect = {
        x: raw.x,
        y: raw.y,
        width: raw.width ?? raw.w,
        height: raw.height ?? raw.h,
      };
      const cr = canvas.getBoundingClientRect();
      const sx = canvas.width / cr.width;
      const sy = canvas.height / cr.height;
      const ctx = canvas.getContext("2d");
      let dark = 0;
      let total = 0;
      for (let yy = rect.y; yy < rect.y + rect.height; yy += 2) {
        for (let xx = rect.x; xx < rect.x + rect.width; xx += 2) {
          const px = Math.round((xx - cr.x) * sx);
          const py = Math.round((yy - cr.y) * sy);
          if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
          const d = ctx.getImageData(px, py, 1, 1).data;
          total++;
          if (d[0] + d[1] + d[2] < 500) dark++;
        }
      }
      return { rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, dark, total };
    },
    { runId: id, savedRect: savedRects.get(id) ?? null },
  );
}

const before = await sampleRunBox(runId);
if (!before) throw new Error(`run not found: ${runId}`);
savedRects.set(runId, before.rect);
const neighborBefore = neighborRunId ? await sampleRunBox(neighborRunId) : null;
if (neighborRunId && !neighborBefore) throw new Error(`neighbor run not found: ${neighborRunId}`);
if (neighborRunId && neighborBefore) savedRects.set(neighborRunId, neighborBefore.rect);
const box = await page.locator(`[data-run-id="${runId}"]`).first().boundingBox();
if (!box) throw new Error(`run has no box: ${runId}`);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1_200);
const after = await sampleRunBox(runId);
const neighborAfter = neighborRunId ? await sampleRunBox(neighborRunId) : null;

console.log(
  JSON.stringify({ runId, before, after, neighborRunId, neighborBefore, neighborAfter }, null, 2),
);
await browser.close();
