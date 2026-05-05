// Move + edit + move-then-edit on the second Maldivian doc (a NON-
// office-generated PDF). Same patterns as move-edit.test.ts on the
// original maldivian fixture, with two differences forced by the
// fixture's quirks:
//
//   1. The page-0 anchor is the short address line "މާލެ، ދިވެހިރާއްޖެ"
//      (contains a Thaana comma). It's unique on page 0 and far enough
//      from other runs that we can do a clean drift check without
//      worrying about overlap. The sukun in "ދިވެހިރާއްޖެ" only
//      shows up after the boundary-case fili-gap recovery in
//      glyphMap.ts — older versions of that code returned the run as
//      "ދިވެހިރާއ ޖެ" (sukun-as-space).
//   2. The edit replacement is a substring of the original text
//      ("މާލެ"). Re-emitting glyphs the source font already carries
//      avoids the missing-glyph fallout that bites when we type a
//      genuinely new string into a non-office font.
//
// We don't replicate the bold-toggle test from edit-format.test.ts here
// because maldivian2 doesn't carry source-detected bold metadata that
// we can rely on for the assertion.

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
let titleRun: (typeof originalRuns)[number];

const PAGES = 14;
const TITLE_TEXT = "މާލެ، ދިވެހިރާއްޖެ";
const SHORT_EDIT = "މާލެ";

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
  await loadFixture(h, FIXTURE.maldivian2, { expectedPages: PAGES });
  originalRuns = await captureRuns(h.page);
  const found = originalRuns.find((r) => r.text === TITLE_TEXT);
  if (!found) {
    const dump = originalRuns.map((r) => `  ${r.id}: "${r.text}"`).join("\n");
    throw new Error(`title run "${TITLE_TEXT}" not in extracted runs. Got:\n${dump}`);
  }
  titleRun = found;
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("text move + edit (maldivian2)", () => {
  test("move-only: title shifts by the drag delta and other page-0 runs are untouched", async () => {
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
      edit: SHORT_EDIT,
      expectTitleText: SHORT_EDIT,
    });
    expect(result.titleOk, result.titleNote).toBe(true);
    expect(result.drift, formatDrift(result.drift)).toEqual([]);
  });

  test("move-then-edit: title moved AND retyped lands at the moved position", async () => {
    const result = await runScenario({
      name: "move-then-edit",
      drag: { dx: 80, dy: 40 },
      edit: SHORT_EDIT,
      expectTitleText: SHORT_EDIT,
    });
    expect(result.titleOk, result.titleNote).toBe(true);
    expect(result.drift, formatDrift(result.drift)).toEqual([]);
  });
});

async function captureRuns(page: import("playwright").Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-page-index="0"] [data-run-id]')).map((el) => {
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
  await loadFixture(h, FIXTURE.maldivian2, { expectedPages: PAGES });

  const titleRunId = await waitForTitleRunId();
  if (!titleRunId) {
    const all = await h.page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-page-index="0"] [data-run-id]')).map((el) => ({
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
      await h.page.mouse.move(cx + (drag.dx * i) / 8, cy + (drag.dy * i) / 8);
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(800);
  }

  if (edit) {
    await h.page.locator(`[data-run-id="${titleRunId}"]`).click();
    await h.page.waitForTimeout(200);
    const inp = h.page.locator("input[data-editor]").first();
    await inp.fill(edit);
    await inp.press("Enter");
    await h.page.locator("input[data-editor]").first().waitFor({ state: "detached" });
  }

  const dlPromise = h.page.waitForEvent("download", { timeout: 20_000 });
  await h.page.locator("button").filter({ hasText: /^Save/ }).first().click({ timeout: 20_000 });
  const dl = await dlPromise;
  const out = path.join(SCREENSHOTS, `move-edit-maldivian2-${name}.pdf`);
  await dl.saveAs(out);

  await loadFixture(h, out, { expectedPages: PAGES });
  const savedRuns = await captureRuns(h.page);

  // Drift: every page-0 run except the title should still match a
  // saved run within 2px on x/y/width, relative to the median whole-
  // page render shift. The saved PDF can land at a slightly different
  // sub-pixel viewport offset in pdf.js, especially under CI.
  const deltas: { dx: number; dy: number }[] = [];
  for (const orig of originalRuns) {
    if (orig.id === titleRun.id) continue;
    const match = savedRuns.find((s) => s.text === orig.text);
    if (!match) continue;
    deltas.push({ dx: match.x - orig.x, dy: match.y - orig.y });
  }
  const median = (xs: number[]) =>
    xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const offX = median(deltas.map((d) => d.dx));
  const offY = median(deltas.map((d) => d.dy));

  const drift: string[] = [];
  for (const orig of originalRuns) {
    if (orig.id === titleRun.id) continue;
    const match = savedRuns.find((s) => s.text === orig.text);
    if (!match) {
      drift.push(`MISSING: "${orig.text}"`);
      continue;
    }
    if (
      Math.abs(match.x - orig.x - offX) > 2 ||
      Math.abs(match.y - orig.y - offY) > 2 ||
      Math.abs(match.w - orig.w) > 2
    ) {
      drift.push(
        `MOVED: "${orig.text.slice(0, 30)}" orig=(${orig.x},${orig.y},${orig.w}) → (${match.x},${match.y},${match.w}) (median dx=${offX},dy=${offY})`,
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
      dx = nowRight - origRight - dxExp - offX;
      dy = titleNow.y - titleRun.y - dyExp - offY;
    } else {
      dx = titleNow.x - titleRun.x - dxExp - offX;
      dy = titleNow.y - titleRun.y - dyExp - offY;
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

async function waitForTitleRunId(): Promise<string | null> {
  try {
    await h.page.waitForFunction(
      (title) =>
        Array.from(document.querySelectorAll('[data-page-index="0"] [data-run-id]')).some(
          (el) => (el.textContent || "") === title,
        ),
      TITLE_TEXT,
      { timeout: 20_000 },
    );
  } catch {
    return null;
  }
  return h.page.evaluate((title) => {
    for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
      if ((el.textContent || "") === title) return el.getAttribute("data-run-id");
    }
    return null;
  }, TITLE_TEXT);
}
