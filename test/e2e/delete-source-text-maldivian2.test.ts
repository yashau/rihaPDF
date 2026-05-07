// Source-text deletion via the EditField trash button on
// maldivian2.pdf. Same shape as the source-text deletion case in
// delete-objects.test.ts, but on the non-office-generated fixture so
// we cover that the trash flow also works against PDFs whose
// extraction picks up extra spaces from missing sukun (the deleted
// run's text shouldn't reappear in the saved file regardless).

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

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

describe("source-text deletion (maldivian2)", () => {
  test("trash button strips the run from the saved PDF", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: PAGES });

    // Page 0's very first run is a single decorative backtick — skip
    // anything < 5 chars so the absence assertion below is meaningful.
    const target = await h.page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
        const t = (el.textContent ?? "").trim();
        if (t.length >= 5) {
          return { id: el.getAttribute("data-run-id")!, text: t };
        }
      }
      return null;
    });
    expect(target, "page-0 should have at least one substantial text run").not.toBeNull();
    const originalText = target!.text;

    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(150);
    const trash = h.page.locator('button[aria-label^="Delete text"]');
    await trash.waitFor({ state: "visible" });
    await trash.click();
    await h.page.waitForTimeout(150);

    const dlPromise = h.page.waitForEvent("download", { timeout: 15_000 });
    await h.page.locator("header button").filter({ hasText: /^Save/ }).click();
    const dl = await dlPromise;
    const saved = path.join(SCREENSHOTS, "delete-source-text-maldivian2.pdf");
    await dl.saveAs(saved);

    const text = await firstPageText(saved);
    expect(text, "deleted run's text should be absent from saved output").not.toContain(
      originalText,
    );
  });
});

async function firstPageText(pdfPath: string): Promise<string> {
  const bytes = fs.readFileSync(pdfPath);
  return h.page.evaluate(async (b64) => {
    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const pdfMod = (await importer("/src/lib/pdf.ts")) as typeof import("../../src/lib/pdf");
    const doc = await pdfMod.loadPdf(bytes.buffer.slice(0));
    const p = await doc.getPage(1);
    const content = await p.getTextContent();
    return content.items
      .filter((it) => "str" in it)
      .map((it) => (it as { str: string }).str)
      .join(" ");
  }, bytes.toString("base64"));
}
