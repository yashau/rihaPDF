// Whole-PDF overlay-coverage audit.
//
// For every page we walk the rendered canvas pixels, find clusters of
// dark pixels (= text glyphs), pick their centroid, and ask: is there
// a data-run-id under that point? If not, that text is unclickable.
//
// We also compare each run's overlay rect against the bounding rect of
// the actual rendered text inside it, and flag overlays that are too
// narrow / too short for their text (a sign that pdf.js's reported
// item.width was wrong for what we ended up rendering).
//
// Outputs:
//   - per-page coverage % (uncovered glyph clusters / total glyph
//     clusters), top-N misaligned runs with overlay-vs-text deltas,
//     and an annotated screenshot per page (red = misaligned overlay,
//     blue dots = uncovered glyph centroids).

import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PDF = path.resolve(
  root,
  "test/fixtures/maldivian.pdf",
);
const SCREENSHOTS = path.join(root, "scripts", "screenshots");
fs.mkdirSync(SCREENSHOTS, { recursive: true });
setTimeout(() => process.exit(2), 240_000).unref?.();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(8_000);
page.on("pageerror", (e) => console.log("[err]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.locator('input[type="file"][accept="application/pdf"]').setInputFiles(PDF);
await page.waitForSelector("[data-page-index]", { timeout: 25_000 });
await page.waitForTimeout(3_500);

const numPages = await page.evaluate(() =>
  document.querySelectorAll("[data-page-index]").length,
);
console.log(`PDF has ${numPages} pages`);

const issues = [];
let totalGlyphClusters = 0;
let totalCoveredClusters = 0;

for (let pi = 0; pi < numPages; pi++) {
  const target = page.locator(`[data-page-index="${pi}"]`);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  // Step A: scan the canvas for dark-pixel clusters (glyphs).
  // Returns array of {x, y, w, h, cx, cy} cluster rects in viewport coords.
  const probe = await page.evaluate((pageIndex) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return null;
    const canvas = host.querySelector("canvas");
    if (!canvas) return null;
    const cRect = canvas.getBoundingClientRect();
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    // A cell is "dark" if it contains real text glyphs — pixels with
    // RGB sum < 350 (very dark, basically black ink). Word's gray
    // section-heading shading sits around RGB sum 700+ and we want to
    // ignore it. We also require >= 3 such pixels in the cell so a
    // single anti-aliased speck doesn't trip the detector.
    const cellSz = 12;
    const cw = Math.ceil(w / cellSz);
    const ch = Math.ceil(h / cellSz);
    const grid = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let dark = 0;
        const px0 = cx * cellSz;
        const py0 = cy * cellSz;
        const pxN = Math.min(px0 + cellSz, w);
        const pyN = Math.min(py0 + cellSz, h);
        outer: for (let py = py0; py < pyN; py += 1) {
          for (let px = px0; px < pxN; px += 1) {
            const i = (py * w + px) * 4;
            const sum = data[i] + data[i + 1] + data[i + 2];
            if (sum < 350) {
              dark++;
              if (dark >= 3) {
                grid[cy * cw + cx] = 1;
                break outer;
              }
            }
          }
        }
      }
    }
    // Flood-fill connected dark cells → cluster centroids.
    const visited = new Uint8Array(cw * ch);
    const clusters = [];
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const idx = cy * cw + cx;
        if (!grid[idx] || visited[idx]) continue;
        // BFS
        let minX = cx, maxX = cx, minY = cy, maxY = cy, count = 0;
        const stack = [idx];
        visited[idx] = 1;
        while (stack.length) {
          const k = stack.pop();
          const x = k % cw;
          const y = Math.floor(k / cw);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
            const ni = ny * cw + nx;
            if (grid[ni] && !visited[ni]) {
              visited[ni] = 1;
              stack.push(ni);
            }
          }
        }
        if (count < 1) continue;
        // Convert grid coords back to canvas pixel coords, then to
        // viewport coords using cRect.
        const scaleX = cRect.width / w;
        const scaleY = cRect.height / h;
        const x0 = minX * cellSz * scaleX + cRect.x;
        const y0 = minY * cellSz * scaleY + cRect.y;
        const x1 = (maxX + 1) * cellSz * scaleX + cRect.x;
        const y1 = (maxY + 1) * cellSz * scaleY + cRect.y;
        clusters.push({
          x: x0,
          y: y0,
          w: x1 - x0,
          h: y1 - y0,
          cx: (x0 + x1) / 2,
          cy: (y0 + y1) / 2,
        });
      }
    }
    return { clusters, canvasRect: cRect };
  }, pi);

  if (!probe) {
    console.log(`page ${pi + 1}: no canvas, skipping`);
    continue;
  }
  const { clusters } = probe;

  // Step B: for each cluster centroid, check if a data-run-id exists
  // under that point.
  const coverage = await page.evaluate(({ pts, pageIndex }) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return [];
    return pts.map(({ cx, cy }) => {
      const els = document.elementsFromPoint(cx, cy);
      const run = els.find(
        (e) => e instanceof HTMLElement && e.dataset.runId,
      );
      return run?.dataset?.runId ?? null;
    });
  }, { pts: clusters.map((c) => ({ cx: c.cx, cy: c.cy })), pageIndex: pi });

  // Filter out false-positive clusters before scoring coverage:
  //   - Bitmaps embedded as ink in the PDF (the bismillah calligraphy
  //     and the Maldives crest at the top of page 1) come through as
  //     huge dark clusters but aren't extracted as text by pdf.js, so
  //     we shouldn't expect overlays for them. Skip clusters bigger
  //     than ~3× normal text height.
  //   - Tiny anti-aliasing speckles smaller than a single glyph (less
  //     than 6×6 css px). These are not meaningful text.
  const lineHeightPx = 25;
  const trimmed = clusters.filter((c) => {
    if (c.h > lineHeightPx * 2.2) return false;
    if (c.w < 6 || c.h < 6) return false;
    return true;
  });
  const trimmedCoverage = coverage.filter((_, i) => {
    const c = clusters[i];
    return c.h <= lineHeightPx * 2.2 && c.w >= 6 && c.h >= 6;
  });
  let covered = 0;
  const uncoveredClusters = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmedCoverage[i]) covered++;
    else uncoveredClusters.push(trimmed[i]);
  }
  totalGlyphClusters += trimmed.length;
  totalCoveredClusters += covered;

  // Step C: per-run overlay vs rendered-text alignment.
  const runs = await page.evaluate((pageIndex) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return [];
    return Array.from(host.querySelectorAll("[data-run-id]")).map((el) => {
      const overlay = el.getBoundingClientRect();
      let textRect = overlay;
      const range = document.createRange();
      try {
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) textRect = r;
      } catch {
        /* */
      }
      return {
        id: el.getAttribute("data-run-id"),
        text: el.textContent || "",
        overlayRect: { x: overlay.x, y: overlay.y, w: overlay.width, h: overlay.height },
        textRect: { x: textRect.x, y: textRect.y, w: textRect.width, h: textRect.height },
      };
    });
  }, pi);

  let misaligned = 0;
  const misalignedIds = [];
  for (const r of runs) {
    const o = r.overlayRect;
    const t = r.textRect;
    if (t.w === 0 || t.h === 0) continue;
    const leftSlack = o.x - t.x;
    const rightSlack = (o.x + o.w) - (t.x + t.w);
    const topSlack = o.y - t.y;
    const bottomSlack = (o.y + o.h) - (t.y + t.h);
    if (leftSlack < -8 || rightSlack < -8 || topSlack < -8 || bottomSlack < -8) {
      misaligned++;
      misalignedIds.push(r.id);
      issues.push({
        page: pi + 1,
        kind: "MISALIGNED",
        id: r.id,
        text: r.text.replace(/\s+/g, " ").slice(0, 80),
        overlay: o,
        text_rect: t,
        slack: { leftSlack, rightSlack, topSlack, bottomSlack },
      });
    }
  }

  console.log(
    `page ${pi + 1}: ${runs.length} runs, ${misaligned} misaligned overlays, ` +
      `glyph-coverage ${covered}/${clusters.length} (${
        clusters.length > 0
          ? ((covered / clusters.length) * 100).toFixed(1)
          : "n/a"
      }%)`,
  );

  // Annotate the screenshot: misaligned in red, uncovered glyphs as blue dots.
  await page.evaluate(
    ({ pageIndex, uncoveredClusters, misalignedIds }) => {
      const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
      if (!host) return;
      // Reset
      for (const el of host.querySelectorAll("[data-run-id]")) {
        el.style.outline = "1px solid rgba(255, 100, 100, 0.5)";
        el.style.background = "rgba(255, 200, 100, 0.07)";
      }
      for (const id of misalignedIds) {
        const el = host.querySelector(`[data-run-id="${id}"]`);
        if (el) {
          el.style.outline = "2px solid rgba(255, 30, 30, 0.95)";
          el.style.background = "rgba(255, 30, 30, 0.18)";
        }
      }
      const hostRect = host.getBoundingClientRect();
      for (const c of uncoveredClusters) {
        const dot = document.createElement("div");
        dot.style.position = "absolute";
        dot.style.left = c.x - hostRect.x + "px";
        dot.style.top = c.y - hostRect.y + "px";
        dot.style.width = c.w + "px";
        dot.style.height = c.h + "px";
        dot.style.background = "rgba(0, 100, 255, 0.25)";
        dot.style.outline = "1px solid rgba(0, 100, 255, 0.85)";
        dot.style.pointerEvents = "none";
        host.appendChild(dot);
      }
    },
    { pageIndex: pi, uncoveredClusters, misalignedIds },
  );
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const out = path.join(SCREENSHOTS, `coverage-page-${pi + 1}.png`);
  await target.screenshot({ path: out });
  console.log(`  → ${out}`);
}

// Step D: click-test. For every run we sample 5 points across its
// overlay rect + one point in the rendered-text rect (which can
// overflow past the overlay), and click each one. We also click the
// centroid of every canvas dark-pixel cluster — that's the real "I
// clicked exactly on what I see" probe. Each click is verified by
// finding which run's bounds best overlap the editor that opens.
let totalClickAttempts = 0;
let totalClickHits = 0;
const clickIssues = [];

// Re-collect glyph cluster centroids per page.
const allGlyphCentroidsByPage = new Map();
for (let pi = 0; pi < numPages; pi++) {
  const target = page.locator(`[data-page-index="${pi}"]`);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const cs = await page.evaluate((pageIndex) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return [];
    const canvas = host.querySelector("canvas");
    if (!canvas) return [];
    const cRect = canvas.getBoundingClientRect();
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const cellSz = 12;
    const cw = Math.ceil(w / cellSz);
    const ch = Math.ceil(h / cellSz);
    const grid = new Uint8Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let dark = 0;
        const px0 = cx * cellSz;
        const py0 = cy * cellSz;
        const pxN = Math.min(px0 + cellSz, w);
        const pyN = Math.min(py0 + cellSz, h);
        outer: for (let py = py0; py < pyN; py += 1) {
          for (let px = px0; px < pxN; px += 1) {
            const i = (py * w + px) * 4;
            const sum = data[i] + data[i + 1] + data[i + 2];
            if (sum < 350) {
              dark++;
              if (dark >= 3) {
                grid[cy * cw + cx] = 1;
                break outer;
              }
            }
          }
        }
      }
    }
    const visited = new Uint8Array(cw * ch);
    const out = [];
    const scaleX = cRect.width / w;
    const scaleY = cRect.height / h;
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const idx = cy * cw + cx;
        if (!grid[idx] || visited[idx]) continue;
        let minX = cx, maxX = cx, minY = cy, maxY = cy;
        const stack = [idx];
        visited[idx] = 1;
        while (stack.length) {
          const k = stack.pop();
          const x = k % cw;
          const y = Math.floor(k / cw);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
            const ni = ny * cw + nx;
            if (grid[ni] && !visited[ni]) {
              visited[ni] = 1;
              stack.push(ni);
            }
          }
        }
        const x0 = minX * cellSz * scaleX + cRect.x;
        const y0 = minY * cellSz * scaleY + cRect.y;
        const x1 = (maxX + 1) * cellSz * scaleX + cRect.x;
        const y1 = (maxY + 1) * cellSz * scaleY + cRect.y;
        out.push({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
      }
    }
    return out;
  }, pi);
  allGlyphCentroidsByPage.set(pi, cs);
}

for (let pi = 0; pi < numPages; pi++) {
  const target = page.locator(`[data-page-index="${pi}"]`);
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);

  // For each run we sample two kinds of points:
  //   (a) overlay-rect points — directly inside data-run-id's box.
  //       These should always hit because pointer-events follow that
  //       very element.
  //   (b) text-rect points — points where the HTML rendered text
  //       lays out (which can extend past the overlay because the
  //       web font's metrics differ from the embedded subset). If a
  //       click on visible-but-overflowing text fails to register,
  //       the user perceives the overlay as broken at that spot.
  // We also sample the centroid of every dark glyph cluster on the
  // canvas — those are the real "I clicked on what I see" probes.
  const sampleSet = await page.evaluate(({ pageIndex, glyphCentroids }) => {
    const host = document.querySelector(`[data-page-index="${pageIndex}"]`);
    if (!host) return [];
    const out = [];
    for (const el of host.querySelectorAll("[data-run-id]")) {
      const id = el.getAttribute("data-run-id");
      const overlay = el.getBoundingClientRect();
      let textRect = overlay;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) textRect = r;
      } catch {
        /* */
      }
      const cy = overlay.y + overlay.height / 2;
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        out.push({
          id,
          cx: overlay.x + overlay.width * t,
          cy,
          desc: `overlay-t${t.toFixed(2)}`,
        });
      }
      // Plus one mid-text-rect point so we exercise overflow.
      out.push({
        id,
        cx: textRect.x + textRect.width * 0.5,
        cy,
        desc: "text-mid",
      });
    }
    // Glyph-cluster centroid clicks — caller passes in canvas-detected
    // dark clusters from the previous step. Expected id is whatever
    // run currently sits under that point (may be null if uncovered).
    for (const g of glyphCentroids) {
      const els = document.elementsFromPoint(g.cx, g.cy);
      const run = els.find(
        (e) => e instanceof HTMLElement && e.dataset.runId,
      );
      out.push({
        id: run?.dataset?.runId ?? null,
        cx: g.cx,
        cy: g.cy,
        desc: "glyph-centroid",
      });
    }
    return out;
  }, { pageIndex: pi, glyphCentroids: allGlyphCentroidsByPage.get(pi) ?? [] });

  for (const c of sampleSet) {
    totalClickAttempts++;
    await page.mouse.click(c.cx, c.cy);
    await page.waitForTimeout(40);
    const opened = await page.evaluate(() => {
      const ed = document.querySelector("input[data-editor]");
      if (!ed) return null;
      // The EditField sits inside its run's parent; find the nearest
      // [data-run-id] ancestor — but EditField doesn't have one because
      // the run renders the EditField *next to* the cover. Use the
      // editor's bounding rect to find which run it overlaps.
      const er = ed.getBoundingClientRect();
      let bestId = null;
      let bestArea = 0;
      for (const el of document.querySelectorAll("[data-run-id]")) {
        const r = el.getBoundingClientRect();
        const ix = Math.max(
          0,
          Math.min(r.x + r.width, er.x + er.width) - Math.max(r.x, er.x),
        );
        const iy = Math.max(
          0,
          Math.min(r.y + r.height, er.y + er.height) -
            Math.max(r.y, er.y),
        );
        const area = ix * iy;
        if (area > bestArea) {
          bestArea = area;
          bestId = el.getAttribute("data-run-id");
        }
      }
      return bestId;
    });
    // For glyph-centroid clicks where expected id is null (no overlay
    // under that point), success = "no editor opened".
    const expected = c.id;
    let hit = false;
    if (expected === null) hit = opened === null;
    else hit = opened === expected;
    if (hit) {
      totalClickHits++;
    } else {
      clickIssues.push({
        page: pi + 1,
        at: { x: Math.round(c.cx), y: Math.round(c.cy) },
        clickedExpected: expected,
        editorOpenedFor: opened,
        desc: c.desc,
      });
    }
    // Dismiss the editor by clicking outside, in the page margin.
    await page.mouse.click(20, 20);
    await page.waitForTimeout(30);
  }
  console.log(`page ${pi + 1}: ${sampleSet.length} click-test points`);
}

console.log(`\n=== OVERALL ===`);
console.log(
  `Glyph-cluster coverage: ${totalCoveredClusters}/${totalGlyphClusters} (${
    totalGlyphClusters > 0
      ? ((totalCoveredClusters / totalGlyphClusters) * 100).toFixed(1)
      : "n/a"
  }%)`,
);
console.log(
  `Click hits: ${totalClickHits}/${totalClickAttempts} (${
    totalClickAttempts > 0
      ? ((totalClickHits / totalClickAttempts) * 100).toFixed(1)
      : "n/a"
  }%)`,
);
if (clickIssues.length) {
  console.log("\n=== Mis-clicks (top 10) ===");
  for (const c of clickIssues.slice(0, 10)) {
    console.log(
      `  p${c.page}: clicked ${c.clickedExpected} → editor opened for ${c.editorOpenedFor}`,
    );
  }
}
console.log(
  `Misaligned overlays: ${
    issues.filter((i) => i.kind === "MISALIGNED").length
  }`,
);

console.log("\n=== Worst-misaligned runs (top 12) ===");
for (const i of issues
  .filter((i) => i.kind === "MISALIGNED")
  .sort((a, b) => {
    const aw = Math.min(...Object.values(a.slack));
    const bw = Math.min(...Object.values(b.slack));
    return aw - bw;
  })
  .slice(0, 12)) {
  console.log(
    `  p${i.page} ${i.id}  slack=(L${i.slack.leftSlack.toFixed(0)} R${i.slack.rightSlack.toFixed(0)} T${i.slack.topSlack.toFixed(0)} B${i.slack.bottomSlack.toFixed(0)})  text="${i.text}"`,
  );
}

await browser.close();
process.exit(0);
