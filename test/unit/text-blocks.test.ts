import { describe, expect, it } from "vitest";
import type { TextRun } from "@/pdf/render/pdfTypes";
import { buildSourceTextBlocks } from "@/pdf/text/textBlocks";

function run(id: string, text: string, left: number, baselineY: number): TextRun {
  return {
    id,
    sourceIndices: [Number(id.replace(/\D/g, "")) || 0],
    contentStreamOpIndices: [Number(id.replace(/\D/g, "")) || 0],
    text,
    bounds: {
      left,
      top: baselineY - 20,
      width: 180,
      height: 24,
    },
    height: 20,
    baselineY,
    fontFamily: "Arial",
    fontBaseName: "Arial",
    bold: false,
    italic: false,
  };
}

describe("source text block grouping", () => {
  it("groups same-indent consecutive lines into one editable paragraph block", () => {
    const blocks = buildSourceTextBlocks(
      [run("p1-r0", "first wrapped line", 80, 120), run("p1-r1", "second wrapped line", 82, 148)],
      1,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: "p1-b0",
      isParagraph: true,
      sourceRunIds: ["p1-r0", "p1-r1"],
      text: "first wrapped line\nsecond wrapped line",
    });
  });

  it("keeps visibly different indents as separate editable blocks", () => {
    const blocks = buildSourceTextBlocks(
      [run("p1-r0", "main line", 80, 120), run("p1-r1", "new indented line", 150, 148)],
      1,
    );

    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.sourceRunIds)).toEqual([["p1-r0"], ["p1-r1"]]);
  });

  it("keeps list-marker first lines with their continuation text", () => {
    const blocks = buildSourceTextBlocks(
      [run("p1-r0", "6.2 first list line", 80, 120), run("p1-r1", "continuation line", 128, 148)],
      1,
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0].sourceRunIds).toEqual(["p1-r0", "p1-r1"]);
  });

  it("adds leading spaces to preserve continuation-line indentation", () => {
    const blocks = buildSourceTextBlocks(
      [run("p1-r0", "6.2 first list line", 80, 120), run("p1-r1", "continuation line", 128, 148)],
      1,
    );

    expect(blocks[0].text.split("\n")[1]).toMatch(/^\s+continuation line$/);
  });
});
