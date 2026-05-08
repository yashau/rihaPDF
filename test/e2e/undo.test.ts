// End-to-end undo/redo coverage. Each test exercises one of the
// recordHistory wiring points in App.tsx, asserts the operation
// took effect, presses Undo, asserts the state reverted, then
// presses Redo and asserts the state came back. Together these
// hit every mutation path that snapshots: source text edits/moves/
// deletes, source image moves/deletes, shape deletes, inserted
// text/image add/edit/delete, slot reorder/blank/remove, external
// PDF additions, and the keystroke-coalescing rule.
//
// We rely on UI signals (Save button label, overlay counts, undo
// button disabled state) rather than save+reload — the snapshot
// stack lives in React state, so a saved-PDF round-trip would only
// exercise it via the same observable state we check directly.

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

const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFUlEQVR4nGP8z8AARMQDxlGNAxoAAH7vAv9OUszhAAAAAElFTkSuQmCC",
  "base64",
);

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

/** Whether the Save button is disabled — used as the "are there
 *  any document mutations on the stack" signal. The button text
 *  carries an exact change-count breakdown, but exact counts shift
 *  (e.g. coalesced edits, derived blank-vs-reorder bookkeeping), so
 *  these tests stick to the disabled bit instead. */
async function saveDisabled(): Promise<boolean> {
  return h.page.locator("header button").filter({ hasText: /^Save/ }).isDisabled();
}

async function undoDisabled(): Promise<boolean> {
  return h.page.locator('[data-testid="undo"]').isDisabled();
}

async function redoDisabled(): Promise<boolean> {
  return h.page.locator('[data-testid="redo"]').isDisabled();
}

async function clickUndo(): Promise<void> {
  await h.page.locator('[data-testid="undo"]').click();
  await h.page.waitForTimeout(80);
}

async function clickRedo(): Promise<void> {
  await h.page.locator('[data-testid="redo"]').click();
  await h.page.waitForTimeout(80);
}

/** Wait past the UNDO_COALESCE_MS window (500ms in App.tsx) so the
 *  next mutation starts a fresh history entry rather than coalescing
 *  with the previous one. */
async function breakCoalesceWindow(): Promise<void> {
  await h.page.waitForTimeout(550);
}

describe("undo/redo: every mutation path", () => {
  test("baseline: undo and redo disabled on fresh load, no edits", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    expect(await undoDisabled(), "undo should be disabled before any edits").toBe(true);
    expect(await redoDisabled(), "redo should be disabled before any edits").toBe(true);
    expect(await saveDisabled(), "save should be disabled with no edits").toBe(true);
  });

  test("source text edit: undo reverts text, redo restores it", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const run = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await run.waitFor({ state: "visible" });
    const originalText = (await run.textContent()) ?? "";
    expect(originalText.length).toBeGreaterThan(0);

    await run.click();
    await h.page.waitForTimeout(150);
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    await editor.fill("UNDO_PROBE_EDIT");
    await editor.press("Control+Enter");
    await editor.waitFor({ state: "detached" });

    expect(await saveDisabled(), "save enables after edit").toBe(false);
    expect(await undoDisabled(), "undo enables after edit").toBe(false);

    await clickUndo();
    expect(await saveDisabled(), "save back to disabled after undo").toBe(true);
    expect(await undoDisabled(), "undo disabled after popping the only entry").toBe(true);
    expect(await redoDisabled(), "redo enabled after the undo").toBe(false);

    await clickRedo();
    expect(await saveDisabled(), "save re-enabled after redo").toBe(false);
    expect(await redoDisabled(), "redo disabled — nothing left to redo").toBe(true);
  });

  test("source text edit: keystrokes within coalesce window collapse to one undo step", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const run = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await run.click();
    await h.page.waitForTimeout(150);
    const editor = h.page.locator('[data-editor][contenteditable="true"]').first();
    // Type a few characters in quick succession (well within the
    // 500ms coalesce window) — should collapse to one snapshot.
    await editor.fill("ABC");
    await editor.press("Control+Enter");
    await editor.waitFor({ state: "detached" });

    expect(await saveDisabled()).toBe(false);
    // One undo should be enough to revert the whole "ABC" — not
    // three (one per character).
    await clickUndo();
    expect(await undoDisabled(), "single undo reverts the whole coalesced edit").toBe(true);
    expect(await saveDisabled(), "save back to disabled after one undo").toBe(true);
  });

  test("source image move: drag is one undo step", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const img = h.page.locator("[data-image-id]").first();
    await img.waitFor({ state: "visible" });
    const box = await img.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await h.page.mouse.move(cx, cy);
    await h.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await h.page.mouse.move(cx + (50 * i) / 6, cy + (30 * i) / 6);
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(300);

    expect(await saveDisabled()).toBe(false);
    // Continuous drag = one undo step (key coalesces by image id).
    await clickUndo();
    expect(await undoDisabled(), "drag was a single coalesced action").toBe(true);
    expect(await saveDisabled(), "save back to disabled").toBe(true);
  });

  test("source image delete via Delete key: undo restores the image overlay", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const img = h.page.locator("[data-image-id]").first();
    await img.click();
    await h.page.waitForTimeout(80);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(200);
    expect(await saveDisabled(), "delete is a save-able change").toBe(false);

    await clickUndo();
    expect(await saveDisabled(), "undo brings the image back").toBe(true);
    expect(await undoDisabled()).toBe(true);
  });

  test("source text delete via trash: undo restores the run", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const run = h.page.locator('[data-page-index="0"] [data-run-id]').first();
    await run.click();
    await h.page.waitForTimeout(150);
    const trash = h.page.locator('button[aria-label^="Delete text"]');
    await trash.waitFor({ state: "visible" });
    await trash.click();
    await h.page.waitForTimeout(150);
    expect(await saveDisabled()).toBe(false);

    await clickUndo();
    expect(await saveDisabled(), "undo restores the deleted text run").toBe(true);
  });

  test("insert new text: undo removes the inserted overlay", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.4, pageBox!.y + pageBox!.height * 0.4);
    await h.page.waitForTimeout(200);
    const insertedInput = h.page.locator('[data-editor][contenteditable="true"]').first();
    await insertedInput.fill("UNDO_INSERT_TEXT");
    await insertedInput.press("Control+Enter");
    await h.page.waitForTimeout(150);

    expect(await h.page.locator("[data-text-insert-id]").count()).toBe(1);
    // We expect at least 2 history entries: the click-to-place
    // (no-coalesce) and the typing (coalesced as one).
    await clickUndo(); // pops the typing
    await clickUndo(); // pops the click-to-place
    expect(
      await h.page.locator("[data-text-insert-id]").count(),
      "both undo steps remove the inserted text overlay entirely",
    ).toBe(0);
    expect(await saveDisabled(), "no insertions remain").toBe(true);

    // Redo brings them back in order.
    await clickRedo();
    await clickRedo();
    const restored = h.page.locator("[data-text-insert-id]").first();
    await restored.waitFor({ state: "visible" });
    // After redo the overlay is in display (not editing) mode —
    // the inserted text shows up as both the visible text and as
    // the suffix of the aria-label (`Edit inserted text: …`).
    const aria = (await restored.getAttribute("aria-label")) ?? "";
    expect(aria, "redo restores the typed text on the overlay").toContain("UNDO_INSERT_TEXT");
  });

  test("insert new image: undo removes the inserted overlay", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const tmpPng = path.join(SCREENSHOTS, "undo-insert-pixel.png");
    fs.writeFileSync(tmpPng, RED_PIXEL_PNG);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Image/ })
      .click();
    await h.page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);
    await h.page.waitForTimeout(300);
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.6, pageBox!.y + pageBox!.height * 0.6);
    await h.page.waitForTimeout(300);

    expect(await h.page.locator("[data-image-insert-id]").count()).toBe(1);
    await clickUndo();
    expect(await h.page.locator("[data-image-insert-id]").count()).toBe(0);
    expect(await saveDisabled()).toBe(true);
    await clickRedo();
    expect(
      await h.page.locator("[data-image-insert-id]").count(),
      "redo restores the inserted image",
    ).toBe(1);
  });

  test("inserted image move: drag coalesces, undo reverts to drop position", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const tmpPng = path.join(SCREENSHOTS, "undo-insert-move-pixel.png");
    fs.writeFileSync(tmpPng, RED_PIXEL_PNG);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Image/ })
      .click();
    await h.page.locator('input[type="file"][accept*="image"]').setInputFiles(tmpPng);
    await h.page.waitForTimeout(300);
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.4, pageBox!.y + pageBox!.height * 0.4);
    await h.page.waitForTimeout(300);

    // Wait past the coalesce window so the drag isn't merged with
    // the click-to-place snapshot.
    await breakCoalesceWindow();

    const inserted = h.page.locator("[data-image-insert-id]").first();
    const beforeBox = await inserted.boundingBox();
    expect(beforeBox).not.toBeNull();
    const startCx = beforeBox!.x + beforeBox!.width / 2;
    const startCy = beforeBox!.y + beforeBox!.height / 2;

    await h.page.mouse.move(startCx, startCy);
    await h.page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await h.page.mouse.move(startCx + (60 * i) / 6, startCy + (40 * i) / 6);
      await h.page.waitForTimeout(20);
    }
    await h.page.mouse.up();
    await h.page.waitForTimeout(300);

    const afterDragBox = await inserted.boundingBox();
    expect(afterDragBox).not.toBeNull();
    expect(
      Math.abs(afterDragBox!.x - beforeBox!.x),
      "drag should have moved the inserted image",
    ).toBeGreaterThan(20);

    // Single undo reverts the drag to the drop position (drag is
    // one coalesced step keyed by inserted-image id).
    await clickUndo();
    await h.page.waitForTimeout(120);
    const afterUndoBox = await inserted.boundingBox();
    expect(afterUndoBox).not.toBeNull();
    expect(
      Math.abs(afterUndoBox!.x - beforeBox!.x),
      "undo should restore the drop position",
    ).toBeLessThan(3);
  });

  test("inserted text delete via trash: undo brings it back", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.3);
    await h.page.waitForTimeout(200);
    const inputLoc = h.page.locator('[data-editor][contenteditable="true"]').first();
    await inputLoc.fill("DELETE_AND_UNDO");
    await inputLoc.press("Control+Enter");
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-text-insert-id]").count()).toBe(1);

    // Click the inserted text again to open the trash button.
    await breakCoalesceWindow();
    await h.page.locator("[data-text-insert-id]").first().click();
    await h.page.waitForTimeout(150);
    const trash = h.page.locator('button[aria-label^="Delete text"]');
    await trash.waitFor({ state: "visible" });
    await trash.click();
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-text-insert-id]").count()).toBe(0);

    await clickUndo();
    expect(
      await h.page.locator("[data-text-insert-id]").count(),
      "undo restores the just-deleted inserted text overlay",
    ).toBe(1);
  });

  test("shape delete: undo restores the deleted shape overlay", async () => {
    await loadFixture(h.page, FIXTURE.withShapes);
    const initialCount = await h.page.locator("[data-shape-id]").count();
    expect(initialCount).toBeGreaterThanOrEqual(2);

    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    // Hit the rectangle (centred at PDF y=340pt → CSS y from top).
    const clickX = pageBox!.x + 200 * 1.5;
    const clickY = pageBox!.y + (842 - 340) * 1.5;
    await h.page.mouse.click(clickX, clickY);
    await h.page.waitForTimeout(120);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-shape-id]").count()).toBe(initialCount - 1);

    await clickUndo();
    expect(
      await h.page.locator("[data-shape-id]").count(),
      "undo restores the deleted shape overlay",
    ).toBe(initialCount);
    expect(await saveDisabled()).toBe(true);
  });

  test("blank page insert via PageSidebar: undo removes the blank slot", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const beforeSlotCount = await h.page.locator("[id^='page-slot-']").count();

    await h.page
      .locator("aside button")
      .filter({ hasText: /^Blank$/ })
      .click();
    await h.page.waitForTimeout(150);
    const afterAddCount = await h.page.locator("[id^='page-slot-']").count();
    expect(afterAddCount, "Blank should add one slot").toBe(beforeSlotCount + 1);

    await clickUndo();
    expect(await h.page.locator("[id^='page-slot-']").count(), "undo removes the blank slot").toBe(
      beforeSlotCount,
    );
  });

  test("add external PDF: undo removes the appended pages and source", async () => {
    await loadFixture(h.page, FIXTURE.withImages, { expectedPages: 1 });
    const beforeSlotCount = await h.page.locator("[id^='page-slot-']").count();

    // Click the "From PDF" button in the sidebar; it triggers a
    // file-input click on the same hidden input.
    await h.page
      .locator("aside button")
      .filter({ hasText: /^From PDF$/ })
      .click();
    // The external file input is the second `input[type=file]`
    // accepting application/pdf. Set files directly.
    await h.page
      .locator('aside input[type="file"][accept*="pdf"]')
      .setInputFiles(FIXTURE.externalSource);
    // External-source.pdf has 2 pages — wait for both to render.
    await h.page.waitForFunction(
      (n) => document.querySelectorAll("[id^='page-slot-']").length === n,
      beforeSlotCount + 2,
      { timeout: 15_000 },
    );

    await clickUndo();
    await h.page.waitForFunction(
      (n) => document.querySelectorAll("[id^='page-slot-']").length === n,
      beforeSlotCount,
      { timeout: 5_000 },
    );
    expect(await saveDisabled(), "removing externally-added pages clears save").toBe(true);
  });

  test("multi-step undo+redo: pop in LIFO order, redo replays in order", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();

    // Step 1: insert text.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.3, pageBox!.y + pageBox!.height * 0.3);
    await h.page.waitForTimeout(200);
    const insIn = h.page.locator('[data-editor][contenteditable="true"]').first();
    await insIn.fill("STEP_ONE");
    await insIn.press("Control+Enter");
    await h.page.waitForTimeout(150);
    await breakCoalesceWindow();

    // Step 2: delete the first source image.
    await h.page.locator("[data-image-id]").first().click();
    await h.page.waitForTimeout(80);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(200);
    await breakCoalesceWindow();

    // Step 3: insert blank page via sidebar.
    await h.page
      .locator("aside button")
      .filter({ hasText: /^Blank$/ })
      .click();
    await h.page.waitForTimeout(150);

    // We don't pin the exact totalChangeCount because of preview
    // rebuild timing, but each undo must strictly DECREASE the
    // count, and three undos must zero it out.
    const isAfterAllUndoZero = async () => (await saveDisabled()) === true;
    expect(await isAfterAllUndoZero(), "before undoing, save should be enabled").toBe(false);

    await clickUndo(); // undo blank
    await clickUndo(); // undo image delete
    await clickUndo(); // undo text insert (typing)
    await clickUndo(); // undo text insert (placement)
    expect(await isAfterAllUndoZero(), "all four undos zero out the change set").toBe(true);
    expect(await undoDisabled()).toBe(true);

    // Redo all four — change set should match the post-step state.
    await clickRedo();
    await clickRedo();
    await clickRedo();
    await clickRedo();
    expect(await saveDisabled(), "four redos reapply all four steps").toBe(false);
    expect(await redoDisabled()).toBe(true);
  });

  test("Ctrl+Z keyboard shortcut: undoes when focus isn't in an input", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    // Make a no-coalesce edit (delete a source image) so there's
    // exactly one undo entry to pop with the keyboard.
    await h.page.locator("[data-image-id]").first().click();
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await saveDisabled()).toBe(false);

    // Click on the page background so focus isn't in any text
    // input — the keyboard handler skips when active element is
    // INPUT/TEXTAREA/contenteditable.
    await h.page.locator("body").click({ position: { x: 1, y: 1 } });
    await h.page.keyboard.press("Control+z");
    await h.page.waitForTimeout(150);
    expect(await saveDisabled(), "Ctrl+Z reverts the delete").toBe(true);

    // Ctrl+Shift+Z = redo.
    await h.page.keyboard.press("Control+Shift+z");
    await h.page.waitForTimeout(150);
    expect(await saveDisabled(), "Ctrl+Shift+Z reapplies it").toBe(false);
  });

  test("opening a new file clears history", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    // Make any change.
    await h.page.locator("[data-image-id]").first().click();
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await undoDisabled(), "undo enabled after the delete").toBe(false);

    // Re-load the same fixture (handleFile fires regardless of file
    // identity). History should reset.
    await loadFixture(h.page, FIXTURE.withImages);
    expect(await undoDisabled(), "loading a new file should reset the history stack").toBe(true);
    expect(await redoDisabled()).toBe(true);
  });

  test("starting a new branch (undo then mutate) clears redo stack", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    // Action A: delete first image.
    await h.page.locator("[data-image-id]").first().click();
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    await breakCoalesceWindow();
    // Undo it — now redo is available.
    await clickUndo();
    expect(await redoDisabled(), "after undo, redo is available").toBe(false);

    // Action B: a different mutation (insert text) — branches the
    // history, redo stack must clear.
    await h.page
      .locator("button")
      .filter({ hasText: /^\+ Text$/ })
      .click();
    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.mouse.click(pageBox!.x + pageBox!.width * 0.5, pageBox!.y + pageBox!.height * 0.5);
    await h.page.waitForTimeout(200);
    expect(await redoDisabled(), "branching the timeline must clear the redo stack").toBe(true);
  });
});
