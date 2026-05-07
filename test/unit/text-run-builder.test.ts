import { describe, expect, it } from "vitest";
import type { TextItem } from "@/pdf/render/pdfTypes";
import type { FontShow } from "@/pdf/source/sourceFonts";
import { buildTextRuns } from "@/pdf/text/textRunBuilder";

function item(
  index: number,
  str: string,
  x: number,
  y: number,
  width: number,
  opIndex: number,
): TextItem {
  return {
    index,
    str,
    transform: [1, 0, 0, 20, x, y],
    width,
    height: 20,
    fontName: "g_d0_f1",
    hasEOL: false,
    contentStreamOpIndices: [opIndex],
  };
}

describe("text run builder", () => {
  it("orders same-position RTL base glyphs before zero-width marks", () => {
    const runs = buildTextRuns(
      [item(1, "\u07a6", 100, 120, 0, 3), item(0, "\u0786", 100, 120, 12, 3)],
      1,
      [],
      1,
      200,
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe("\u0786\u07a6");
    expect(runs[0].sourceIndices).toEqual([0, 1]);
    expect(runs[0].contentStreamOpIndices).toEqual([3]);
  });

  it("orders widened RTL items by their right edge and preserves embedded digit gaps", () => {
    const marker = item(0, "7.2", 490, 120, 16, 1);
    const rtlPrefix = item(1, "\u078b\u07a8\u0788\u07ac\u0780\u07a8", 180, 120, 300, 2);
    const digits = item(2, "129", 260, 120, 20, 3);
    const rtlSuffix = item(3, "\u0788\u07a6\u0782\u07a6", 100, 120, 70, 4);
    rtlPrefix.gapLeft = 190;
    rtlPrefix.gapRight = 470;

    const runs = buildTextRuns([marker, rtlPrefix, digits, rtlSuffix], 1, [], 1, 200);

    expect(runs).toHaveLength(1);
    expect(runs[0].text).toMatch(/^7\.2\s+\u078b\u07a8\u0788\u07ac\u0780\u07a8/);
    expect(runs[0].text).toContain("\u078b\u07a8\u0788\u07ac\u0780\u07a8 129 ");
    expect(runs[0].text).not.toContain("\u078b\u07a8\u0788\u07ac\u0780\u07a8129");
    expect(runs[0].text.indexOf("129")).toBeGreaterThan(
      runs[0].text.indexOf("\u078b\u07a8\u0788\u07ac\u0780\u07a8"),
    );
    expect(runs[0].sourceIndices).toEqual([0, 1, 2, 3]);
  });

  it("prefers owned font shows over nearby unowned candidates", () => {
    const fontShows: FontShow[] = [
      {
        x: 100,
        y: 80,
        baseFont: "Helvetica",
        bold: false,
        italic: false,
        fontResource: "F1",
        bytes: new Uint8Array([0x41]),
        opIndex: 2,
      },
      {
        x: 102,
        y: 80,
        baseFont: "ABCDEE+Faruma",
        bold: true,
        italic: true,
        fontResource: "F2",
        bytes: new Uint8Array([0x07, 0x86]),
        opIndex: 7,
      },
    ];

    const runs = buildTextRuns([item(0, "\u0786", 100, 120, 12, 7)], 2, fontShows, 1, 200);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "p2-r0",
      text: "\u0786",
      fontBaseName: "ABCDEE+Faruma",
      bold: true,
      italic: true,
      contentStreamOpIndices: [7],
    });
  });
});
