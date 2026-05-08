import type { TextRun } from "@/pdf/render/pdf";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
}

function cssSpaceWidth(run: TextRun): number {
  if (typeof document === "undefined") return run.height * 0.25;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return run.height * 0.25;
  ctx.font = `${run.italic ? "italic " : ""}${run.bold ? "700" : "400"} ${run.height}px "${run.fontFamily}"`;
  const width = ctx.measureText(" ").width;
  return width > 0 ? width : run.height * 0.25;
}

function spacesForIndent(gapPx: number, run: TextRun): string {
  if (gapPx <= 0) return "";
  return " ".repeat(Math.max(0, Math.round(gapPx / cssSpaceWidth(run))));
}

function lineRight(run: TextRun): number {
  return run.bounds.left + run.bounds.width;
}

export function sourceEditorText(
  displayText: string,
  run: TextRun | SourceTextBlock,
  isRtl: boolean,
) {
  if (!isRtl || !isSourceTextBlock(run) || run.lines.length < 2) return displayText;
  const textLines = displayText.split("\n");
  const baseRight = Math.max(...run.lines.map(lineRight));
  return textLines
    .map((lineText, index) => {
      const sourceLine = run.lines[index];
      if (!sourceLine) return lineText;
      return `${spacesForIndent(baseRight - lineRight(sourceLine), sourceLine)}${lineText}`;
    })
    .join("\n");
}
