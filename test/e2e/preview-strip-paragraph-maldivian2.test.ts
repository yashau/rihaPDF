// Preview-strip regression on maldivian2.pdf — same shape as
// preview-strip-paragraph.test.ts on the original maldivian fixture,
// but this PDF is non-office-generated, so the run-builder may slice
// glyph runs differently. The original test exhaustively swept every
// run in agenda-item-6; here we sample a small set of paragraph runs
// on page 2 (data-page-index=1) so the suite runtime stays bounded
// while still catching the "ghost glyph stays on canvas" regression
// that motivated the original test.
//
// Anchors: we pick paragraph runs that are wide (≥ 400px) — the
// short numeric / sub-heading runs on this page don't exercise the
// multi-show-on-one-line case the bug came from.

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

const PAGES = 14;
const SAMPLE_LIMIT = 6;
const MIN_WIDTH_PX = 400;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

type RunInfo = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  y: number;
  text: string;
};

describe("preview strip on maldivian2 page-2 paragraph runs", () => {
  test("dragging a sample of wide paragraph runs leaves no ink at the original position", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: PAGES });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const allRuns = await collectRuns();
    const wide = allRuns
      .filter((r) => r.w >= MIN_WIDTH_PX)
      .sort((a, b) => a.y - b.y)
      .slice(0, SAMPLE_LIMIT);
    expect(
      wide.length,
      `expected ≥1 paragraph run wider than ${MIN_WIDTH_PX}px on page 2; got ${allRuns.length} runs total`,
    ).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const target of wide) {
      const reason = await stripCheck(target);
      if (reason) failures.push(reason);
      // Reload between attempts so previous edit + preview state
      // doesn't bleed into the next run.
      await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: PAGES });
      await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
      await h.page.waitForTimeout(200);
    }
    expect(failures, `${failures.length} run(s) failed:\n${failures.join("\n")}`).toEqual([]);
  });
});

async function collectRuns(): Promise<RunInfo[]> {
  return h.page.evaluate(() => {
    const host = document.querySelector('[data-page-index="1"]');
    if (!host) return [];
    const out: RunInfo[] = [];
    for (const el of host.querySelectorAll("[data-run-id]")) {
      const r = el.getBoundingClientRect();
      out.push({
        id: el.getAttribute("data-run-id")!,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        w: r.width,
        h: r.height,
        y: r.y,
        text: el.textContent || "",
      });
    }
    return out;
  });
}

async function stripCheck(target: RunInfo): Promise<string | null> {
  const { id, cx, cy, text } = target;

  const beforeRect = await h.page.evaluate((rid) => {
    const el = document.querySelector(`[data-run-id="${rid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
  if (!beforeRect) return `[${id}] not in DOM at start of stripCheck`;

  const isInk = (p: [number, number, number, number] | null) => !!p && p[0] + p[1] + p[2] < 350;
  const sampleBefore = await samplePixelsAt(beforeRect);
  const inkBefore = sampleBefore.filter(isInk).length;
  if (inkBefore === 0) {
    return null;
  }

  await h.page.mouse.move(cx, cy);
  await h.page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await h.page.mouse.move(cx + (200 * i) / 8, cy + (100 * i) / 8);
    await h.page.waitForTimeout(20);
  }
  await h.page.mouse.up();
  await h.page.waitForTimeout(900);

  const screenshot = path.join(SCREENSHOTS, `maldivian2-drag-${id}.png`);
  await h.page.locator('[data-page-index="1"]').screenshot({ path: screenshot });

  // Save button no longer carries the per-category count in its
  // visible label (kept fixed-width to stop toolbar jitter); use the
  // disabled bit instead — disabled iff there are no pending edits.
  const saveBtn = h.page.locator("button").filter({ hasText: /^Save/ }).first();
  const saveIsDisabled = await saveBtn.isDisabled();
  if (saveIsDisabled) {
    return `[${id}] drag did not commit an edit (Save button still disabled, text="${text.slice(0, 40)}", screenshot=${screenshot})`;
  }

  const sampleAfter = await samplePixelsAt(beforeRect);
  const inkAfter = sampleAfter.filter(isInk).length;
  const inkRatio = inkAfter / Math.max(1, inkBefore);
  if (inkRatio > 0.25) {
    const opIdx = await h.page.evaluate((rid) => {
      const w = window as unknown as {
        __runOpIndices?: Map<string, number[]>;
      };
      return w.__runOpIndices?.get(rid) ?? null;
    }, id);
    return `[${id}] ${inkAfter}/${inkBefore} ink pixels remained at the ORIGINAL position after drag (${(inkRatio * 100).toFixed(1)}%), text="${text.slice(0, 40)}", opIndices=${JSON.stringify(opIdx)}, screenshot=${screenshot}`;
  }
  return null;
}

async function samplePixelsAt(rect: {
  x: number;
  y: number;
  w: number;
  h: number;
}): Promise<([number, number, number, number] | null)[]> {
  return h.page.evaluate((rect) => {
    const host = document.querySelector('[data-page-index="1"]');
    if (!host) return [];
    const canvas = host.querySelector("canvas");
    if (!canvas) return [];
    const cRect = canvas.getBoundingClientRect();
    const sx = canvas.width / cRect.width;
    const sy = canvas.height / cRect.height;
    const ctx = canvas.getContext("2d")!;
    const px0 = Math.max(0, Math.round((rect.x - cRect.x) * sx));
    const py0 = Math.max(0, Math.round((rect.y - cRect.y) * sy));
    const pxN = Math.min(canvas.width, Math.round((rect.x + rect.w - cRect.x) * sx));
    const pyN = Math.min(canvas.height, Math.round((rect.y + rect.h - cRect.y) * sy));
    if (pxN <= px0 || pyN <= py0) return [];
    const w = pxN - px0;
    const h = pyN - py0;
    const data = ctx.getImageData(px0, py0, w, h).data;
    const out: ([number, number, number, number] | null)[] = [];
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        out.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      }
    }
    return out;
  }, rect);
}
