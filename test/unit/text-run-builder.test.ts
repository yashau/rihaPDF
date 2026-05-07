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
