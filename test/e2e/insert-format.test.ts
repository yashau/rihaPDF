// Drop a text box, change font / size / bold via the formatting
// toolbar, save, reload — assert both the live overlay AND the saved
// PDF reflect every change. Driven by the synthetic image fixture
// (works on any PDF — we just need a page to drop onto).

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

const SENTINEL = "FORMAT_PROBE_xyz";

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("inserted-text formatting toolbar", () => {
  test("font / size / bold round-trip from toolbar to saved PDF", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    // Drop a text box near the top-left.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.5);
    await h.page.waitForTimeout(200);
    const insertInput = h.page.locator("[data-text-insert-id] input").first();
    await insertInput.fill(SENTINEL);
    await h.page.waitForTimeout(150);

    // Toolbar: Times New Roman / 28pt / bold.
    const toolbar = h.page.locator("[data-edit-toolbar]");
    await toolbar.locator("select").selectOption("Times New Roman");
    await h.page.waitForTimeout(120);
    const sizeInput = toolbar.locator('input[aria-label="Font size"]');
    await sizeInput.fill("28");
    await sizeInput.press("Tab");
    await h.page.waitForTimeout(120);
    await toolbar.locator("button[aria-pressed]").first().click();
    await h.page.waitForTimeout(150);

    // Live-overlay computed style sanity.
    const live = await h.page.evaluate(() => {
      const el = document.querySelector("[data-text-insert-id] input");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
      };
    });
    expect(live).not.toBeNull();
    expect(live!.fontFamily).toMatch(/Times New Roman/i);
    // 28pt × 1.5 scale = 42px CSS.
    expect(parseFloat(live!.fontSize)).toBeGreaterThan(30);
    expect(parseInt(live!.fontWeight, 10)).toBeGreaterThanOrEqual(600);

    // Click outside (page edge) to commit, then save.
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await h.page.waitForTimeout(200);

    const dlPromise = h.page.waitForEvent("download", { timeout: 12_000 });
    await h.page.locator("button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "insert-format.pdf");
    await dl.saveAs(saved);

    await loadFixture(h.page, saved);

    const checks = await h.page.evaluate(async (b64) => {
      // oxlint-disable-next-line typescript/no-implied-eval
      const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdfMod = (await importer(
        "/src/pdf/render/pdf.ts",
      )) as typeof import("../../src/pdf/render/pdf");
      const baseFontMod = (await importer(
        "/src/dev/readBaseFonts.ts",
      )) as typeof import("../../src/dev/readBaseFonts");
      const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
      const p = await doc.getPage(1);
      const content = await p.getTextContent();
      const target = content.items
        .filter((it) => "str" in it)
        .find((it) => (it as { str: string }).str.includes("FORMAT_PROBE_xyz")) as
        | { str: string; transform: number[] }
        | undefined;
      if (!target) return { found: false } as const;
      const baseFontStrings = (await baseFontMod.readBaseFonts(bytes.buffer.slice(0)))[0] ?? [];
      return {
        found: true as const,
        text: target.str,
        heightPt: Math.abs(target.transform[3]),
        baseFontStrings,
      };
    }, fs.readFileSync(saved).toString("base64"));

    expect(checks.found).toBe(true);
    if (checks.found) {
      expect(checks.text).toContain(SENTINEL);
      expect(checks.heightPt).toBeGreaterThanOrEqual(26);
      expect(checks.heightPt).toBeLessThanOrEqual(30);
      expect(
        checks.baseFontStrings.some((b) => /times.*bold/i.test(b)),
        `expected /Times-Bold in BaseFonts, got: ${checks.baseFontStrings.join(", ")}`,
      ).toBe(true);
    }
  });
});
