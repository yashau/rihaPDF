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
      for (const el of document.querySelectorAll('[data-page-index="0"] [data-run-id]')) {
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

    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    const initialWeight = await editor.evaluate(textWeightAtOffset, 1);
    const initiallyBold = initialWeight >= 600;
    await editor.press("Control+A");

    // Toggle bold.
    await h.page.locator("[data-edit-toolbar] button[aria-pressed]").first().click();
    await h.page.waitForTimeout(150);
    const afterToggleWeight = await editor.evaluate(textWeightAtOffset, 1);
    if (initiallyBold) {
      expect(afterToggleWeight, "toggling bold off should drop the weight").toBeLessThan(600);
    } else {
      expect(afterToggleWeight, "toggling bold on should raise the weight").toBeGreaterThanOrEqual(
        600,
      );
    }

    // Press Enter to commit, then re-open the editor and confirm the
    // override persists. This is where the hasStyle()-strip bug would
    // bite: after commit, style:undefined falls back to run.bold and
    // the toggled-off bold reverts.
    const pageBox0 = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox0).not.toBeNull();
    await h.page.mouse.click(pageBox0!.x + 5, pageBox0!.y + 5);
    await editor.waitFor({ state: "detached" });
    await h.page.waitForTimeout(300);
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    await h.page.waitForTimeout(300);
    const reopenedEditor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await reopenedEditor.waitFor({ state: "visible" });
    const reopenWeight = await reopenedEditor.evaluate(textWeightAtOffset, 1);
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

  test("partial bold on source text persists after commit and reopen", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: 14 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.includes("forms.office.com")) {
          return { id: el.getAttribute("data-run-id")!, text };
        }
      }
      return null;
    });
    expect(target, "registration URL source run not found").not.toBeNull();

    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    await editor.evaluate((el) => {
      const root = el as HTMLElement;
      root.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let remainingStart = 0;
      let remainingEnd = 5;
      while (node) {
        const textNode = node as Text;
        const len = textNode.data.length;
        if (remainingStart <= len) {
          range.setStart(textNode, remainingStart);
          break;
        }
        remainingStart -= len;
        remainingEnd -= len;
        node = walker.nextNode();
      }
      while (node) {
        const textNode = node as Text;
        const len = textNode.data.length;
        if (remainingEnd <= len) {
          range.setEnd(textNode, remainingEnd);
          break;
        }
        remainingEnd -= len;
        node = walker.nextNode();
      }
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await h.page.locator('[data-edit-toolbar] button[aria-label="Bold"]').click();
    await h.page.waitForTimeout(200);

    const liveWeights = await editor.evaluate(
      (el, offsets) => {
        return offsets.map((offset) => {
          const walker = document.createTreeWalker(el as HTMLElement, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          let remaining = offset;
          while (node) {
            const textNode = node as Text;
            if (remaining <= textNode.data.length) {
              const parent = textNode.parentElement ?? (el as HTMLElement);
              return Number.parseInt(getComputedStyle(parent).fontWeight, 10);
            }
            remaining -= textNode.data.length;
            node = walker.nextNode();
          }
          return 0;
        });
      },
      [1, 8],
    );
    expect(
      liveWeights[0],
      "selected URL prefix should become bold while editing",
    ).toBeGreaterThanOrEqual(600);
    expect(liveWeights[1], "unselected URL tail should stay normal while editing").toBeLessThan(
      600,
    );

    const pageBox = await h.page.locator('[data-page-index="1"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await editor.waitFor({ state: "detached" });
    await h.page.waitForTimeout(300);
    await h.page.locator(`[data-run-id="${target!.id}"]`).click();
    const reopened = h.page.locator('[data-editor][contenteditable="true"]').first();
    await reopened.waitFor({ state: "visible" });
    const reopenedWeights = await reopened.evaluate(
      (el, offsets) => {
        return offsets.map((offset) => {
          const walker = document.createTreeWalker(el as HTMLElement, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          let remaining = offset;
          while (node) {
            const textNode = node as Text;
            if (remaining <= textNode.data.length) {
              const parent = textNode.parentElement ?? (el as HTMLElement);
              return Number.parseInt(getComputedStyle(parent).fontWeight, 10);
            }
            remaining -= textNode.data.length;
            node = walker.nextNode();
          }
          return 0;
        });
      },
      [1, 8],
    );

    expect(
      reopenedWeights[0],
      "partial source bold should persist after commit",
    ).toBeGreaterThanOrEqual(600);
    expect(
      reopenedWeights[1],
      "unselected source text should stay non-bold after commit",
    ).toBeLessThan(600);
  });

  test("partial bold on a mixed RTL date line stays in the same visual slot", async () => {
    await loadFixture(h.page, FIXTURE.maldivian2, { expectedPages: 14 });
    await h.page.locator('[data-page-index="1"]').scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const target = await h.page.evaluate(() => {
      const host = document.querySelector('[data-page-index="1"]');
      if (!host) return null;
      for (const el of host.querySelectorAll("[data-run-id]")) {
        const text = el.textContent || "";
        if (text.includes("26 އެޕްރީލް 2026") && text.includes("10:30")) {
          const rect = el.getBoundingClientRect();
          return {
            id: el.getAttribute("data-run-id")!,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }
      return null;
    });
    expect(target, "mixed RTL/date source line not found").not.toBeNull();

    await h.page.mouse.click(target!.x, target!.y);
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.waitFor({ state: "visible" });
    const wordRect = await editor.evaluate((el) => {
      const root = el as HTMLElement;
      const word = "އެޕްރީލް";
      const text = root.innerText;
      const start = text.indexOf(word);
      if (start < 0) throw new Error("target word not found in editor");
      const end = start + word.length;
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      let pos = 0;
      while (node) {
        const textNode = node as Text;
        const next = pos + textNode.data.length;
        if (start >= pos && start <= next) {
          range.setStart(textNode, start - pos);
        }
        if (end >= pos && end <= next) {
          range.setEnd(textNode, end - pos);
          break;
        }
        pos = next;
        node = walker.nextNode();
      }
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      const rect = range.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        cx: rect.left + rect.width / 2,
      };
    });

    await h.page.locator('[data-edit-toolbar] button[aria-label="Bold"]').click();
    await h.page.waitForTimeout(200);
    const pageBox = await h.page.locator('[data-page-index="1"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + 5, pageBox!.y + 5);
    await editor.waitFor({ state: "detached" });
    await h.page.waitForTimeout(300);

    const committedRect = await h.page.evaluate((runId) => {
      const host = document.querySelector<HTMLElement>(`[data-run-id="${runId}"]`);
      if (!host) return null;
      for (const el of host.querySelectorAll<HTMLElement>("span")) {
        if (!el.textContent?.includes("އެޕްރީލް")) continue;
        if (Number.parseInt(getComputedStyle(el).fontWeight, 10) < 600) continue;
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          cx: rect.left + rect.width / 2,
        };
      }
      return null;
    }, target!.id);
    expect(committedRect, "bolded word span not found after commit").not.toBeNull();
    expect(Math.abs(committedRect!.cx - wordRect.cx)).toBeLessThan(40);
    expect(Math.abs(committedRect!.top - wordRect.top)).toBeLessThan(8);
  });

  test("toggling bold OFF on an inserted run sticks across reopen", async () => {
    await loadFixture(h.page, FIXTURE.withImages);

    // Drop a text box and bold it.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.4);
    await h.page.waitForTimeout(200);
    const insertInput = h.page.locator('[data-editor][contenteditable="true"]').first();
    await insertInput.waitFor({ state: "visible" });
    await insertInput.fill("Toggle me");
    await h.page.waitForTimeout(150);
    await insertInput.press("Control+A");

    // First click on B → bold ON.
    const boldBtn = () => h.page.locator("[data-edit-toolbar] button[aria-pressed]").first();
    await boldBtn().click();
    await h.page.waitForTimeout(150);
    let weight = await insertInput.evaluate(textWeightAtOffset, 1);
    expect(weight, "bold ON should make the input bold").toBeGreaterThanOrEqual(600);

    // Second click on B → bold OFF.
    await boldBtn().click();
    await h.page.waitForTimeout(150);
    weight = await insertInput.evaluate(textWeightAtOffset, 1);
    expect(weight, "bold OFF should bring the input back to normal weight").toBeLessThan(600);

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
    const reopenedInsert = h.page.locator('[data-editor][contenteditable="true"]').first();
    await reopenedInsert.waitFor({ state: "visible" });
    const reopenedWeight = await reopenedInsert.evaluate(textWeightAtOffset, 1);
    expect(reopenedWeight, "bold OFF override should still apply after reopen").toBeLessThan(600);
  });
});

function textWeightAtOffset(root: Element, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = offset;
  while (node) {
    const textNode = node as Text;
    if (remaining <= textNode.data.length) {
      const parent = textNode.parentElement ?? (root as HTMLElement);
      return Number.parseInt(getComputedStyle(parent).fontWeight, 10);
    }
    remaining -= textNode.data.length;
    node = walker.nextNode();
  }
  return Number.parseInt(getComputedStyle(root).fontWeight, 10);
}
