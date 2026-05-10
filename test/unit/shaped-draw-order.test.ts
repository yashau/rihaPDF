import { describe, expect, test } from "vitest";
import { PDFName } from "pdf-lib";
import {
  buildShapedTextOpsFromShape,
  buildVisualShapedTextOpsFromShape,
} from "@/pdf/text/shapedDraw";
import type { ShapeResult } from "@/pdf/text/shape";

function syntheticRtlShape(): ShapeResult {
  return {
    direction: "rtl",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    totalAdvance: 2000,
    glyphs: [
      // HarfBuzz RTL visual order for two Thaana clusters: final
      // logical cluster first, and mark-before-base within each cluster.
      { glyphId: 0x00aa, cluster: 2, xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 },
      { glyphId: 0x00bb, cluster: 2, xAdvance: 1000, yAdvance: 0, xOffset: 0, yOffset: 0 },
      { glyphId: 0x00cc, cluster: 0, xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 },
      { glyphId: 0x00dd, cluster: 0, xAdvance: 1000, yAdvance: 0, xOffset: 0, yOffset: 0 },
    ],
  };
}

function shownGlyphHex(ops: unknown[]): string[] {
  return ops
    .map((op) => String(op))
    .map((s) => s.match(/<([0-9a-f]+)> Tj/i)?.[1])
    .filter((s): s is string => Boolean(s));
}

describe("shaped text operator ordering", () => {
  test("page text path keeps extraction-friendly RTL logical order", () => {
    const ops = buildShapedTextOpsFromShape(syntheticRtlShape(), PDFName.of("F1"), {
      x: 10,
      y: 20,
      size: 10,
    });

    expect(shownGlyphHex(ops)).toEqual(["00dd", "00cc", "00bb", "00aa"]);
  });

  test("appearance path keeps HarfBuzz visual order and edge marks", () => {
    const ops = buildVisualShapedTextOpsFromShape(syntheticRtlShape(), PDFName.of("F1"), {
      x: 10,
      y: 20,
      size: 10,
    });

    expect(shownGlyphHex(ops)).toEqual(["00aa", "00bb", "00cc", "00dd"]);
  });
});
