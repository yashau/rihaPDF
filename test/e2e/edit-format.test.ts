// Regression: editing an existing run, the user reported they can't
// unbold. Cover the full toggle-back loop: click an existing run →
// editor opens → toolbar reflects the source-detected style → toggle
// bold → close → reopen → confirm the override sticks (style.bold
// === false stays even if run.bold is true).

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
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

describe("edit-existing-run formatting", () => {
  test("toggling bold on an existing run flips the input weight + persists", async () => {
    // Use the Maldivian PDF — it carries real source-detected bold
    // metadata on at least one run.
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });

    // Grab every run with its data-bold attribute (for diagnostic
    // when we pick a target).
    const runs = await h.page.evaluate(() => {
      const out: { id: string; text: string; bold: boolean }[] = [];
      // Read run.bold via the React fiber? Simpler: re-extract the
      // source bold info via the same modules the app uses. We just
      // pick the visual title here and trust the toolbar's reported
      // initial state to tell us if it's bold.
      for (const el of document.querySelectorAll(
        '[data-page-index="0"] [data-run-id]',
      )) {
        out.push({
          id: el.getAttribute("data-run-id")!,
          text: (el.textContent ?? "").slice(0, 40),
          bold: false, // not used — we read the toolbar after click
        });
      }
      return out;
    });
    expect(runs.length).toBeGreaterThan(0);

    // Click the title run to open its editor.
    const target = runs.find((r) => r.text.includes("ރައްޔިތުންގެ"));
    expect(target, "title run not in DOM").toBeTruthy();
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(300);

    const initialWeight = await h.page.evaluate(() =>
      Number(
        getComputedStyle(
          document.querySelector("input[data-editor]")!,
        ).fontWeight,
      ),
    );
    const initiallyBold = initialWeight >= 600;

    // Toggle bold.
    await h.page
      .locator('[data-edit-toolbar] button[aria-pressed]')
      .first()
      .click();
    await h.page.waitForTimeout(150);
    const afterToggleWeight = await h.page.evaluate(() =>
      Number(
        getComputedStyle(
          document.querySelector("input[data-editor]")!,
        ).fontWeight,
      ),
    );
    if (initiallyBold) {
      expect(
        afterToggleWeight,
        "toggling bold off should drop the weight",
      ).toBeLessThan(600);
    } else {
      expect(
        afterToggleWeight,
        "toggling bold on should raise the weight",
      ).toBeGreaterThanOrEqual(600);
    }

    // Press Enter to commit, then re-open the editor and confirm the
    // override persists. This is where the hasStyle()-strip bug would
    // bite: after commit, style:undefined falls back to run.bold and
    // the toggled-off bold reverts.
    await h.page.locator("input[data-editor]").press("Enter");
    await h.page.waitForTimeout(300);
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(300);
    const reopenWeight = await h.page.evaluate(() =>
      Number(
        getComputedStyle(
          document.querySelector("input[data-editor]")!,
        ).fontWeight,
      ),
    );
    if (initiallyBold) {
      expect(
        reopenWeight,
        "after commit + reopen, the un-bold override should still apply",
      ).toBeLessThan(600);
    } else {
      expect(
        reopenWeight,
        "after commit + reopen, the bold override should still apply",
      ).toBeGreaterThanOrEqual(600);
    }
  });


  test("toggling bold OFF on an inserted run sticks across reopen", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    // Drop a text box and bold it.
    await h.page.locator("button").filter({ hasText: /^\+ Text$/ }).click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(
      pageBox!.x + pageBox!.width * 0.3,
      pageBox!.y + pageBox!.height * 0.4,
    );
    await h.page.waitForTimeout(200);
    const insertInput = h.page.locator("[data-text-insert-id] input").first();
    await insertInput.fill("Toggle me");
    await h.page.waitForTimeout(150);

    // First click on B → bold ON.
    const boldBtn = () =>
      h.page
        .locator('[data-edit-toolbar] button[aria-pressed]')
        .first();
    await boldBtn().click();
    await h.page.waitForTimeout(150);
    let weight = await h.page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector("[data-text-insert-id] input")!,
        ).fontWeight,
    );
    expect(parseInt(weight, 10), "bold ON should make the input bold").toBeGreaterThanOrEqual(600);

    // Second click on B → bold OFF.
    await boldBtn().click();
    await h.page.waitForTimeout(150);
    weight = await h.page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector("[data-text-insert-id] input")!,
        ).fontWeight,
    );
    expect(
      parseInt(weight, 10),
      "bold OFF should bring the input back to normal weight",
    ).toBeLessThan(600);

    // Click outside to close the editor and re-open it. The bold-OFF
    // override has to persist across editor close/open — this is the
    // case where a hasStyle()-style strip would silently drop the
    // override and bring back run.bold. The 200ms post-close wait was
    // racing the editor's exit animation on slower hosts; bump it so
    // the InsertedText overlay is fully back to its stable click-to-
    // open state before we re-click.
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await h.page.waitForTimeout(500);
    await h.page.locator("[data-text-insert-id]").first().click();
    await h.page.waitForTimeout(300);
    const reopenedWeight = await h.page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector("[data-text-insert-id] input")!,
        ).fontWeight,
    );
    expect(
      parseInt(reopenedWeight, 10),
      "bold OFF override should still apply after reopen",
    ).toBeLessThan(600);
  });
});
