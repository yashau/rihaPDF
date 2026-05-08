// Mobile (390×844) interaction smoke test. Verifies that on a touch-
// capable phone-sized viewport:
//   - Tap-to-edit on a text run opens the EditField (synthesised
//     click after pointerup, no 300ms delay courtesy of touch-action:
//     manipulation).
//   - The mobile EditTextToolbar is fixed-bottom (position: fixed at
//     the visual viewport's bottom).
//   - A touch drag on a run (pointerdown → pointermove → pointerup)
//     produces a persisted dx/dy via the `useDragGesture` hook.
//
// Playwright's touchscreen API only exposes single taps, so the drag
// case dispatches synthetic pointer events on the run overlay.

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
  h = await setupBrowser({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
});

afterAll(async () => {
  if (h) await tearDown(h);
});

async function findFirstNonEmptyRun(): Promise<{
  id: string;
  cx: number;
  cy: number;
  text: string;
} | null> {
  return h.page.evaluate(() => {
    const overlays = document.querySelectorAll("[data-run-id]");
    for (const el of overlays) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      // Skip runs whose overlay is offscreen or zero-sized (e.g. orphan).
      if (r.width < 8 || r.height < 8) continue;
      return {
        id: el.getAttribute("data-run-id") ?? "",
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        text,
      };
    }
    return null;
  });
}

async function findWideRun(minWidth = 120): Promise<{
  id: string;
  cx: number;
  cy: number;
  text: string;
} | null> {
  return h.page.evaluate((width) => {
    const overlays = document.querySelectorAll("[data-run-id]");
    for (const el of overlays) {
      const text = (el.textContent || "").trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width < width || r.height < 8) continue;
      return {
        id: el.getAttribute("data-run-id") ?? "",
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
        text,
      };
    }
    return null;
  }, minWidth);
}

async function dragLocatorByTouch(
  locator: ReturnType<typeof h.page.locator>,
  dx: number,
  dy: number,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, "touch drag target should have a bounding box").not.toBeNull();
  await locator.evaluate(
    (el, { sx, sy, dragX, dragY }) => {
      const pointer = {
        pointerType: "touch",
        pointerId: 1,
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      };
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...pointer,
          clientX: sx,
          clientY: sy,
        }),
      );
      const STEPS = 6;
      for (let i = 1; i <= STEPS; i++) {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            ...pointer,
            clientX: sx + (dragX * i) / STEPS,
            clientY: sy + (dragY * i) / STEPS,
          }),
        );
      }
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          ...pointer,
          clientX: sx + dragX,
          clientY: sy + dragY,
        }),
      );
    },
    {
      sx: box!.x + box!.width / 2,
      sy: box!.y + box!.height / 2,
      dragX: dx,
      dragY: dy,
    },
  );
}

async function seedSignatureStorage(): Promise<void> {
  await h.page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("rihaPDF.signatures");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("Failed to clear signature storage"));
      req.onblocked = () => resolve();
    });

    // oxlint-disable-next-line typescript/no-implied-eval
    const importer = new Function("p", "return import(p)") as (p: string) => Promise<unknown>;
    const sig = (await importer(
      "/src/domain/signatures.ts",
    )) as typeof import("../../src/domain/signatures");
    const canvas = document.createElement("canvas");
    canvas.width = 260;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to create signature canvas");
    ctx.strokeStyle = "rgb(20, 24, 32)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(42, 70);
    ctx.bezierCurveTo(82, 18, 126, 104, 176, 48);
    ctx.lineTo(220, 66);
    ctx.stroke();
    const processed = await sig.processDrawnSignature(canvas, [0, 0, 0]);
    if (!processed) throw new Error("Failed to process signature");
    await sig.saveSignatureAsset(processed);
  });
}

describe("mobile interaction (390×844, hasTouch)", () => {
  test("tap on a run opens the edit field", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);
    const target = await findFirstNonEmptyRun();
    expect(target, "expected at least one non-empty run on page 1").not.toBeNull();
    // page.touchscreen.tap fires a touchstart → touchend → click,
    // which the browser turns into pointerdown → pointerup → click on
    // the target. Our overlay's onClick opens the editor.
    await h.page.touchscreen.tap(target!.cx, target!.cy);
    await h.page.waitForTimeout(300);
    expect(
      await h.page.locator('[data-editor][contenteditable="true"]').first().isVisible(),
      "edit input should appear after tap",
    ).toBe(true);
    // The mobile toolbar should be fixed-bottom — assert position:fixed
    // by reading the computed style.
    const toolbarPos = await h.page.evaluate(() => {
      const el = document.querySelector<HTMLElement>("[data-edit-toolbar]");
      if (!el) return null;
      return getComputedStyle(el).position;
    });
    expect(toolbarPos).toBe("fixed");
  });

  test("tap-to-edit, type, Enter commits", async () => {
    // Continues from previous test's loaded fixture / open editor —
    // the input should still be focused.
    const input = h.page.locator('[data-editor][contenteditable="true"]').first();
    await input.fill("ޓެސްޓު");
    await input.press("Control+Enter");
    await h.page.waitForTimeout(200);
    // Editor closes; the edited overlay is now visible with new text.
    const editedText = await h.page.evaluate(() => {
      const overlays = document.querySelectorAll("[data-run-id]");
      for (const el of overlays) {
        const t = (el.textContent || "").trim();
        if (t === "ޓެސްޓު") return t;
      }
      return null;
    });
    expect(editedText).toBe("ޓެސްޓު");
  });

  test("touch drag on a run persists a dx/dy offset", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);
    const target = await findFirstNonEmptyRun();
    expect(target).not.toBeNull();
    const beforeRect = await h.page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(`[data-run-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }, target!.id);
    expect(beforeRect).not.toBeNull();
    // Dispatch a touch-drag as a sequence of pointer events. Playwright's
    // touchscreen helper only exposes tap, so we synthesise the move
    // chain ourselves. The hook listens on `window.pointermove` /
    // `pointerup`, so we dispatch on the window for those phases.
    //
    // Touch drags are gated by a 400ms hold in useDragGesture (so a
    // tap-and-pan doesn't hijack page scrolling). We split the
    // synthesised gesture in two: pointerdown, then a wait past the
    // hold timer before any move events, so the gate releases and the
    // hook switches into active drag mode.
    const DXV = 30; // screen pixels — well over the 10px touch threshold
    const DYV = 18;
    await h.page.evaluate(
      ({ runId, sx, sy }) => {
        const el = document.querySelector<HTMLElement>(`[data-run-id="${runId}"]`);
        if (!el) throw new Error(`no overlay for ${runId}`);
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX: sx,
            clientY: sy,
            pointerType: "touch",
            pointerId: 1,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { runId: target!.id, sx: target!.cx, sy: target!.cy },
    );
    // Hold past the touch-hold gate (400ms) so onStart fires.
    await h.page.waitForTimeout(450);
    await h.page.evaluate(
      ({ sx, sy, dx, dy }) => {
        const fire = (type: string, x: number, y: number) => {
          window.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerType: "touch",
              pointerId: 1,
              isPrimary: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        };
        const STEPS = 8;
        for (let i = 1; i <= STEPS; i++) {
          fire("pointermove", sx + (dx * i) / STEPS, sy + (dy * i) / STEPS);
        }
        fire("pointerup", sx + dx, sy + dy);
      },
      { sx: target!.cx, sy: target!.cy, dx: DXV, dy: DYV },
    );
    await h.page.waitForTimeout(300);
    // The overlay should now sit at a different screen position — the
    // dx/dy got persisted into App's edits map and the overlay re-
    // renders at (bounds.left + dx) in natural px which projects to
    // a shifted screen rect.
    const afterRect = await h.page.evaluate((id) => {
      const el = document.querySelector<HTMLElement>(`[data-run-id="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }, target!.id);
    expect(afterRect).not.toBeNull();
    const dxScreen = afterRect!.x - beforeRect!.x;
    const dyScreen = afterRect!.y - beforeRect!.y;
    // Direction should match the gesture and total magnitude should
    // be non-trivial. Exact value depends on displayScale (mobile
    // fit-to-width is < 1 so we expect dxScreen ≈ DXV).
    expect(dxScreen).toBeGreaterThan(5);
    expect(dyScreen).toBeGreaterThan(2);
  });

  test("redaction and highlight resize handles react to immediate touch drags", async () => {
    await loadFixture(h.page, FIXTURE.maldivian, { expectedPages: 2 });
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);
    const target = await findWideRun();
    expect(target, "expected a wide run for resize-handle testing").not.toBeNull();

    await h.page.locator('button[aria-label="Redact"]').click();
    await h.page.touchscreen.tap(target!.cx, target!.cy);
    await h.page.waitForTimeout(150);
    const redaction = h.page.locator("[data-redaction-id]").first();
    const redactionBox = await redaction.boundingBox();
    expect(redactionBox, "redaction overlay should be created").not.toBeNull();
    await h.page.touchscreen.tap(
      redactionBox!.x + redactionBox!.width / 2,
      redactionBox!.y + redactionBox!.height / 2,
    );
    await redaction.locator('[data-resize-handle="br"]').waitFor();
    await dragLocatorByTouch(redaction.locator('[data-resize-handle="br"]'), -36, 0);
    await h.page.waitForTimeout(150);
    const shrunkRedactionBox = await redaction.boundingBox();
    expect(shrunkRedactionBox!.width).toBeLessThan(redactionBox!.width - 12);
    await h.page.keyboard.press("Delete");
    await h.page.waitForTimeout(150);
    expect(await h.page.locator("[data-redaction-id]").count()).toBe(0);

    await h.page.locator('button[aria-label="Highlight"]').click();
    await h.page.touchscreen.tap(target!.cx, target!.cy);
    await h.page.waitForTimeout(150);
    const highlight = h.page.locator("[data-highlight-id]").first();
    const highlightBox = await highlight.boundingBox();
    expect(highlightBox, "highlight overlay should be created").not.toBeNull();
    await h.page.touchscreen.tap(
      highlightBox!.x + highlightBox!.width / 2,
      highlightBox!.y + highlightBox!.height / 2,
    );
    await highlight.locator('[data-resize-handle="br"]').waitFor();
    await dragLocatorByTouch(highlight.locator('[data-resize-handle="br"]'), -36, 0);
    await h.page.waitForTimeout(150);
    const shrunkHighlightBox = await highlight.boundingBox();
    expect(shrunkHighlightBox!.width).toBeLessThan(highlightBox!.width - 12);
  });

  test("signature resize handle reacts to an immediate touch drag", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await seedSignatureStorage();
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    await h.page.getByRole("button", { name: "Signature" }).click();
    const savedSignature = h.page.locator('button[aria-label="Place saved signature"]').first();
    await savedSignature.waitFor({ state: "visible", timeout: 12_000 });
    await savedSignature.click();
    await h.page.getByRole("heading", { name: "Add Signature" }).waitFor({ state: "hidden" });

    const pageBox = await h.page.locator('[data-page-index="0"]').boundingBox();
    expect(pageBox).not.toBeNull();
    await h.page.touchscreen.tap(
      pageBox!.x + pageBox!.width * 0.55,
      pageBox!.y + pageBox!.height * 0.55,
    );
    await h.page.waitForTimeout(150);

    const signature = h.page.locator("[data-image-insert-id]").first();
    const signatureBox = await signature.boundingBox();
    expect(signatureBox, "signature overlay should be created").not.toBeNull();
    await signature.locator('[data-resize-handle="br"]').waitFor();
    await dragLocatorByTouch(signature.locator('[data-resize-handle="br"]'), -36, 0);
    await h.page.waitForTimeout(150);

    const resizedBox = await signature.boundingBox();
    expect(resizedBox!.width).toBeLessThan(signatureBox!.width - 12);
  });

  test("source image resize handle reacts to an immediate touch drag", async () => {
    await loadFixture(h.page, FIXTURE.withImages);
    await h.page.locator("[data-page-index='0']").scrollIntoViewIfNeeded();
    await h.page.waitForTimeout(200);

    const image = h.page.locator("[data-image-id]").first();
    const imageBox = await image.boundingBox();
    expect(imageBox, "source image overlay should be visible").not.toBeNull();

    await h.page.touchscreen.tap(
      imageBox!.x + imageBox!.width / 2,
      imageBox!.y + imageBox!.height / 2,
    );
    await image.locator('[data-resize-handle="br"]').waitFor();
    await dragLocatorByTouch(image.locator('[data-resize-handle="br"]'), -36, 0);
    await h.page.waitForTimeout(150);

    const resizedBox = await image.boundingBox();
    expect(resizedBox!.width).toBeLessThan(imageBox!.width - 12);
  });
});
