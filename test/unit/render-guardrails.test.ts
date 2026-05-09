import { describe, expect, test } from "vitest";
import {
  PDF_LOAD_GUARDRAILS,
  assertPdfFileWithinLimits,
  assertPdfPageCountWithinLimits,
  chooseCanvasRenderBudget,
} from "../../src/pdf/render/guardrails";

describe("render guardrails", () => {
  test("keeps ordinary canvases at the requested capped DPR", () => {
    const budget = chooseCanvasRenderBudget(800, 1000, 3);
    expect(budget.pixelScale).toBe(PDF_LOAD_GUARDRAILS.maxDevicePixelRatio);
    expect(budget.width).toBe(1600);
    expect(budget.height).toBe(2000);
    expect(budget.constrained).toBe(true);
  });

  test("reduces backing pixels for oversized pages", () => {
    const budget = chooseCanvasRenderBudget(6000, 6000, 2);
    expect(budget.width * budget.height).toBeLessThanOrEqual(PDF_LOAD_GUARDRAILS.maxCanvasPixels);
    expect(budget.width).toBeLessThanOrEqual(PDF_LOAD_GUARDRAILS.maxCanvasEdgePx);
    expect(budget.height).toBeLessThanOrEqual(PDF_LOAD_GUARDRAILS.maxCanvasEdgePx);
    expect(budget.constrained).toBe(true);
  });

  test("rejects files and page counts above eager-load limits", () => {
    expect(() =>
      assertPdfFileWithinLimits({
        name: "huge.pdf",
        size: PDF_LOAD_GUARDRAILS.maxFileBytes + 1,
      }),
    ).toThrow(/supports PDFs up to/);
    expect(() =>
      assertPdfPageCountWithinLimits(PDF_LOAD_GUARDRAILS.maxPages + 1, "long.pdf"),
    ).toThrow(/supports up to/);
  });
});
