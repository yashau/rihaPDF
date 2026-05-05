// Repro for the reported page-2 paragraph move bug: when the user
// drags a long paragraph run, the live preview canvas keeps painting
// part of the original text — even though the Tj's are no longer in
// the content stream, they still render visually. Means
// matchTjIndicesForRun is missing some shows on the same line.
//
// We exhaustively cover every run inside agenda item 6 of the
// Maldivian fixture — that's section 6's title + every line of
// subsections 6.1 and 6.2 (the multi-line paragraphs the user
// reported the bug against).

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

type RunInfo = {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  y: number;
  text: string;
};

describe("preview strip on agenda item 6 paragraph runs", () => {
  test("dragging any line in section 6 / 6.1 / 6.2 leaves no ink at the original position", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const runs = await collectRuns();
    // Anchor: the run carrying the "6." section-6 title. The Thaana
    // text "ނުނިމިހުރި" ("nunimihuri" — unfinished) is unique enough
    // to lock onto, even if our run-builder folds the leading "6"
    // digit into the same run.
    const sectionSix = runs.find((r) => r.text.includes("ނުނިމިހުރި"));
    expect(
      sectionSix,
      `section 6 marker not found on page 2. Saw runs:\n${runs.map((r) => `  ${r.id}@y=${r.y.toFixed(0)} "${r.text.slice(0, 40)}"`).join("\n")}`,
    ).toBeTruthy();
    const inSection6 = runs.filter((r) => r.y >= sectionSix!.y - 2);
    expect(inSection6.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const target of inSection6) {
      const reason = await stripCheck(target);
      if (reason) failures.push(reason);
      // Reload between attempts so previous edit + preview state
      // doesn't bleed into the next run.
      await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
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

async function getRunRect(
  id: string,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return h.page.evaluate((rid) => {
    const el = document.querySelector(`[data-run-id="${rid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
}

async function dragRun(id: string): Promise<boolean> {
  const target = h.page.locator(`[data-run-id="${id}"]`);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const saveBtn = h.page.locator("button").filter({ hasText: /^Save/ }).first();
  await h.page.mouse.move(cx, cy);
  await h.page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await h.page.mouse.move(cx + (200 * i) / 12, cy + (100 * i) / 12);
    await h.page.waitForTimeout(20);
  }
  await h.page.mouse.up();

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!(await saveBtn.isDisabled())) return true;
    await h.page.waitForTimeout(100);
  }
  return false;
}

/** Drag the candidate run by (200, 100) viewport pixels and return
 *  null if its ORIGINAL position has zero ink samples afterwards, or
 *  a diagnostic string when stripping was incomplete. We freeze the
 *  rect *before* the drag — sampling the run's own bounding box
 *  after the move would chase the ghost overlay and miss the
 *  not-actually-stripped original content sitting on the canvas. */
async function stripCheck(target: RunInfo): Promise<string | null> {
  const { id, text } = target;

  const beforeRect = await getRunRect(id);
  if (!beforeRect) return `[${id}] not in DOM at start of stripCheck`;

  // Threshold of 350 (i.e. average per channel < ~117) catches only
  // black ink glyphs, not the ~210/210/210 gray of Word's section
  // heading shading or anti-aliased glyph edges.
  const isInk = (p: [number, number, number, number] | null) => !!p && p[0] + p[1] + p[2] < 350;
  const sampleBefore = await samplePixelsAt(beforeRect);
  const inkBefore = sampleBefore.filter(isInk).length;
  if (inkBefore === 0) {
    // Not actually rendered (zero-width spacer / empty run) — skip.
    return null;
  }

  // Save button no longer carries the per-category count in its
  // visible label (kept fixed-width to stop toolbar jitter); use the
  // disabled bit instead — disabled iff there are no pending edits.
  const committed = await dragRun(id);
  if (!committed) {
    const screenshot = path.join(SCREENSHOTS, `agenda6-drag-${id}.png`);
    await h.page.locator('[data-page-index="1"]').screenshot({ path: screenshot });
    return `[${id}] drag did not commit an edit (Save button still disabled, text="${text.slice(0, 40)}", screenshot=${screenshot})`;
  }

  let sampleAfter = await samplePixelsAt(beforeRect);
  for (let i = 0; i < 20 && sampleAfter.filter(isInk).length / Math.max(1, inkBefore) > 0.25; i++) {
    await h.page.waitForTimeout(250);
    sampleAfter = await samplePixelsAt(beforeRect);
  }
  const inkAfter = sampleAfter.filter(isInk).length;
  // The strip is allowed to leave ≤ 25% of original "ink" as
  // residual. Most runs are well below 5%, but Word's section-
  // heading gray bar has intrinsic dark gradient/border pixels that
  // count as ink under our < 350 RGB-sum threshold even when there's
  // no text — those should never be stripped.
  const inkRatio = inkAfter / Math.max(1, inkBefore);
  if (inkRatio > 0.25) {
    const screenshot = path.join(SCREENSHOTS, `agenda6-drag-${id}.png`);
    await h.page.locator('[data-page-index="1"]').screenshot({ path: screenshot });
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

/** Read EVERY canvas pixel inside the given viewport rect and return
 *  the count of "ink" pixels (RGB sum < 350 = solid black glyph).
 *  The rect is captured BEFORE the drag so we read the canvas at the
 *  run's ORIGINAL position regardless of what the live overlay does.
 *
 *  Returns the raw rgba arrays only when ≤ 25 pixels qualify — for
 *  large rects we just return the count to keep the cross-page
 *  payload small. */
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
    // Map the viewport rect into canvas-pixel coords.
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
