// Move + edit + move-then-edit on the canonical Maldivian doc — exact
// port of the old scripts/verifyMoveEdit.mjs into vitest. Keeps all
// three scenarios in one file because they share the loaded PDF and
// the snapshot of "original runs" we use for drift checks.

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
let originalRuns: Array<{ id: string; text: string; x: number; y: number; w: number; h: number }>;
let titleRun: typeof originalRuns[number];

const TITLE_TEXT = "ރައްޔިތުންގެ މަޖިލިސް";

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
  await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
  originalRuns = await captureRuns(h.page);
  const found = originalRuns.find((r) => r.text === TITLE_TEXT);
  if (!found) throw new Error(`title run "${TITLE_TEXT}" not in extracted runs`);
  titleRun = found;
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("text move + edit", () => {
  test("move-only: title shifts by the drag delta and other runs are untouched", async () => {
    const result = await runScenario({
      name: "move-only",
      drag: { dx: 60, dy: 30 },
      edit: null,
      expectTitleText: titleRun.text,
    });
    expect(result.titleOk, result.titleNote).toBe(true);
    expect(result.drift, formatDrift(result.drift)).toEqual([]);
  });

  test("edit-only: title text replaced in place; other runs unchanged", async () => {
    const result = await runScenario({
      name: "edit-only",
      drag: null,
      edit: "ތެސްޓު",
      expectTitleText: "ތެސްޓު",
    });
    expect(result.titleOk, result.titleNote).toBe(true);
    expect(result.drift, formatDrift(result.drift)).toEqual([]);
  });

  test("move-then-edit: title moved AND retyped lands at the moved position", async () => {
    const result = await runScenario({
      name: "move-then-edit",
      drag: { dx: 80, dy: 40 },
      edit: "ތެސްޓު",
      expectTitleText: "ތެސްޓު",
    });
    expect(result.titleOk, result.titleNote).toBe(true);
    expect(result.drift, formatDrift(result.drift)).toEqual([]);
  });
});

async function captureRuns(page: import("playwright").Page) {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-page-index="0"] [data-run-id]'),
    ).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute("data-run-id")!,
        text: el.textContent || "",
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    }),
  );
}

function formatDrift(drift: string[]): string {
  return drift.length ? `unexpected drift:\n  · ${drift.slice(0, 6).join("\n  · ")}` : "";
}

async function runScenario({
  name,
  drag,
  edit,
  expectTitleText,
}: {
  name: string;
  drag: { dx: number; dy: number } | null;
  edit: string | null;
  expectTitleText: string;
}): Promise<{ titleOk: boolean; titleNote: string; drift: string[] }> {
  // Reload fresh each run so previous edits don't bleed.
  await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });

  // Find the run id whose text matches the title, since the index can
  // shift between runs of the extractor as we change recovery logic.
  const titleRunId = await h.page.evaluate((title) => {
    for (const el of document.querySelectorAll(
      '[data-page-index="0"] [data-run-id]',
    )) {
      if ((el.textContent || "") === title)
        return el.getAttribute("data-run-id");
    }
    return null;
  }, TITLE_TEXT);
  if (!titleRunId) {
    // Diagnostics: dump every run we DID find.
    const all = await h.page.evaluate(() =>
      Array.from(
        document.querySelectorAll('[data-page-index="0"] [data-run-id]'),
      ).map((el) => ({
        id: el.getAttribute("data-run-id"),
        text: (el.textContent || "").slice(0, 80),
      })),
    );
    throw new Error(
      `title "${TITLE_TEXT}" not in DOM. Got ${all.length} runs:\n${all
        .map((r) => `  ${r.id}: ${r.text}`)
        .join("\n")}`,
    );
  }

  if (drag) {
    const target = h.page.locator(`[data-run-id="${titleRunId}"]`);
    const box = await target.boundingBox();
    if (!box) throw new Error("title run not in DOM");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await h.page.mouse.move(cx, cy);
    await h.page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await h.page.mouse.move(
        cx + (drag.dx * i) / 8,
        cy + (drag.dy * i) / 8,
      );
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    // App.tsx debounces the preview-strip rebuild by 150ms then runs
    // an async pdf-lib + pdf.js round-trip. Waiting just 300ms races
    // the rebuild on slower hosts — the click below times out because
    // the page tree is briefly being repainted. 800ms covers the
    // 99th percentile of rebuild durations on the dev box.
    await h.page.waitForTimeout(800);
  }

  if (edit) {
    await h.page.locator(`[data-run-id="${titleRunId}"]`).click();
    await h.page.waitForTimeout(200);
    const inp = h.page.locator("input[data-editor]").first();
    await inp.fill(edit);
    await inp.press("Enter");
    await h.page.waitForTimeout(300);
  }

  const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).click();
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, `move-edit-${name}.pdf`);
  await dl.saveAs(out);

  // The saved PDF inherits maldivian's page count, so reuse the same
  // expectedPages guard to keep the post-load screenshot reliable.
  await loadFixture(h.page, out, { expectedPages: 2 });
  const savedRuns = await captureRuns(h.page);
  await h.page
    .locator('[data-page-index="0"] canvas')
    .first()
    .screenshot({ path: path.join(SCREENSHOTS, `move-edit-${name}.png`) });

  // Drift: every original run except the title should still match a
  // saved run within 2px on x/y/width.
  const drift: string[] = [];
  for (const orig of originalRuns) {
    if (orig.id === "p1-r2") continue;
    const match = savedRuns.find((s) => s.text === orig.text);
    if (!match) {
      drift.push(`MISSING: "${orig.text}"`);
      continue;
    }
    if (
      Math.abs(match.x - orig.x) > 2 ||
      Math.abs(match.y - orig.y) > 2 ||
      Math.abs(match.w - orig.w) > 2
    ) {
      drift.push(
        `MOVED: "${orig.text.slice(0, 30)}" orig=(${orig.x},${orig.y},${orig.w}) → (${match.x},${match.y},${match.w})`,
      );
    }
  }

  // RTL Thaana anchors at the right edge — shorter replacement text
  // shifts bounds.left rightward but keeps the first logical char at
  // the same visual right edge. Detect direction via codepoint range.
  let titleOk = false;
  let titleNote = "";
  const titleNow = savedRuns.find((s) => s.text === expectTitleText);
  if (!titleNow) {
    titleNote = `expected title "${expectTitleText}" not found in saved PDF`;
  } else {
    const isRtl = /[ހ-޿]/u.test(expectTitleText);
    const origRight = titleRun.x + titleRun.w;
    const nowRight = titleNow.x + titleNow.w;
    const dxExp = drag?.dx ?? 0;
    const dyExp = drag?.dy ?? 0;
    let dx, dy;
    if (isRtl) {
      dx = nowRight - origRight - dxExp;
      dy = titleNow.y - titleRun.y - dyExp;
    } else {
      dx = titleNow.x - titleRun.x - dxExp;
      dy = titleNow.y - titleRun.y - dyExp;
    }
    const off = Math.hypot(dx, dy);
    if (off > 8) {
      titleNote = `title misplaced by ${off.toFixed(1)}px (Δ=${dx.toFixed(1)},${dy.toFixed(1)})`;
    } else {
      titleOk = true;
    }
  }

  return { titleOk, titleNote, drift };
}
