import type { TextRun } from "@/pdf/render/pdfTypes";

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/u;
const LIST_MARKER_RE =
  /(?:^[\s\d.()[\]/-]+[A-Za-z\u0780-\u07bf]|[A-Za-z\u0780-\u07bf][\s\d.()[\]/-]+$)/u;

export type SourceTextBlock = TextRun & {
  sourceRunIds: string[];
  lines: TextRun[];
  isParagraph: boolean;
  textAlign?: "justify" | "start";
  lineStep?: number;
  lineLayouts?: SourceTextLineLayout[];
};

export type SourceTextLineLayout = {
  left: number;
  top: number;
  width: number;
  justify: boolean;
};

function isRtl(text: string): boolean {
  return RTL_RE.test(text);
}

function hasListMarker(text: string): boolean {
  return LIST_MARKER_RE.test(text);
}

function cssSpaceWidth(
  fontFamily: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): number {
  if (typeof document === "undefined") return fontSizePx * 0.25;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return fontSizePx * 0.25;
  ctx.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSizePx}px "${fontFamily}"`;
  const width = ctx.measureText(" ").width;
  return width > 0 ? width : fontSizePx * 0.25;
}

function spacesForIndent(gapPx: number, run: TextRun): string {
  if (gapPx <= 0) return "";
  const spaceWidth = cssSpaceWidth(run.fontFamily, run.height, run.bold, run.italic);
  return " ".repeat(Math.max(0, Math.round(gapPx / spaceWidth)));
}

function lineStartEdge(run: TextRun, rtl: boolean): number {
  return rtl ? run.bounds.left + run.bounds.width : run.bounds.left;
}

function textWidth(
  text: string,
  fontFamily: string,
  fontSizePx: number,
  bold: boolean,
  italic: boolean,
): number {
  if (typeof document === "undefined") return text.length * fontSizePx * 0.5;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * fontSizePx * 0.5;
  ctx.font = `${italic ? "italic " : ""}${bold ? "700" : "400"} ${fontSizePx}px "${fontFamily}"`;
  return ctx.measureText(text).width;
}

function justifyRtlLineText(line: TextRun): string {
  const text = line.text.trim();
  const gaps = Array.from(text.matchAll(/\s+/gu));
  if (gaps.length === 0) return text;
  const naturalWidth = textWidth(text, line.fontFamily, line.height, line.bold, line.italic);
  const extraWidth = line.bounds.width - naturalWidth;
  if (extraWidth <= line.height * 0.25) return text;
  const spaceWidth = cssSpaceWidth(line.fontFamily, line.height, line.bold, line.italic);
  const extraSpaces = Math.max(0, Math.round(extraWidth / spaceWidth));
  if (extraSpaces === 0) return text;
  let gapIndex = 0;
  return text.replace(/\s+/gu, (space) => {
    const add =
      Math.floor(extraSpaces / gaps.length) + (gapIndex < extraSpaces % gaps.length ? 1 : 0);
    gapIndex++;
    return `${space}${" ".repeat(add)}`;
  });
}

function textWithLineIndents(lines: TextRun[], justifiedIndexes: Set<number>): string {
  const first = lines[0];
  const rtl = isRtl(first.text);
  if (rtl) {
    return lines
      .map((line, index) => (justifiedIndexes.has(index) ? justifyRtlLineText(line) : line.text))
      .join("\n");
  }
  const firstStart = lineStartEdge(first, rtl);
  return lines
    .map((line, index) => {
      if (index === 0) return line.text;
      const start = lineStartEdge(line, rtl);
      const gap = rtl ? firstStart - start : start - firstStart;
      return `${spacesForIndent(gap, line)}${line.text}`;
    })
    .join("\n");
}

function sameInlineStyle(a: TextRun, b: TextRun): boolean {
  const height = Math.max(a.height, b.height);
  return (
    a.fontFamily === b.fontFamily &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    Math.abs(a.height - b.height) <= height * 0.2
  );
}

function lineIndent(run: TextRun, rtl: boolean): number {
  return rtl ? run.bounds.left + run.bounds.width : run.bounds.left;
}

function justifiedLineIndexes(lines: TextRun[]): Set<number> {
  if (lines.length < 3) return new Set();
  const first = lines[0];
  const bodyIndexes = lines.slice(0, -1).map((_, index) => index);
  if (isRtl(first.text)) return new Set(bodyIndexes);
  const checkedIndexes =
    hasListMarker(first.text) && bodyIndexes.length > 2 ? bodyIndexes.slice(1) : bodyIndexes;
  const checkedLines = checkedIndexes.map((index) => lines[index]);
  if (checkedLines.length < 2) return new Set();
  const left = Math.min(...checkedLines.map((line) => line.bounds.left));
  const right = Math.max(...checkedLines.map((line) => line.bounds.left + line.bounds.width));
  const tolerance = Math.max(...checkedLines.map((line) => line.height)) * 0.75;
  const justified = checkedLines.every((line) => {
    const lineLeft = line.bounds.left;
    const lineRight = line.bounds.left + line.bounds.width;
    return Math.abs(lineLeft - left) <= tolerance && Math.abs(lineRight - right) <= tolerance;
  });
  return justified ? new Set(checkedIndexes) : new Set();
}

function medianLineStep(lines: TextRun[]): number | undefined {
  if (lines.length < 2) return undefined;
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    deltas.push(Math.abs(lines[i].baselineY - lines[i - 1].baselineY));
  }
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function canJoinParagraph(prev: TextRun, next: TextRun, first: TextRun): boolean {
  if (!sameInlineStyle(prev, next) || !sameInlineStyle(first, next)) return false;
  const rtl = isRtl(first.text);
  if (isRtl(next.text) !== rtl) return false;
  const lineStep = Math.abs(next.baselineY - prev.baselineY);
  const nominalLineHeight = Math.max(first.bounds.height, prev.bounds.height, next.bounds.height);
  if (lineStep < nominalLineHeight * 0.65 || lineStep > nominalLineHeight * 1.8) return false;
  const indentDelta = Math.abs(lineIndent(next, rtl) - lineIndent(first, rtl));
  const indentLimit = hasListMarker(first.text) ? nominalLineHeight * 8 : nominalLineHeight * 1.25;
  if (indentDelta > indentLimit) return false;
  return true;
}

function makeBlock(pageNumber: number, index: number, lines: TextRun[]): SourceTextBlock {
  const first = lines[0];
  if (lines.length === 1) {
    return {
      ...first,
      sourceRunIds: [first.id],
      lines,
      isParagraph: false,
    };
  }
  const left = Math.min(...lines.map((line) => line.bounds.left));
  const right = Math.max(...lines.map((line) => line.bounds.left + line.bounds.width));
  const top = Math.min(...lines.map((line) => line.bounds.top));
  const bottom = Math.max(...lines.map((line) => line.bounds.top + line.bounds.height));
  const sourceIndices = lines.flatMap((line) => line.sourceIndices);
  const opIndices = Array.from(new Set(lines.flatMap((line) => line.contentStreamOpIndices))).sort(
    (a, b) => a - b,
  );
  const decorationOpRanges = lines.flatMap((line) => line.decorationOpRanges ?? []);
  const justifiedIndexes = justifiedLineIndexes(lines);
  return {
    ...first,
    id: `p${pageNumber}-b${index}`,
    sourceIndices,
    contentStreamOpIndices: opIndices,
    text: textWithLineIndents(lines, justifiedIndexes),
    caretPositions: undefined,
    bounds: {
      left,
      top,
      width: Math.max(right - left, 4),
      height: Math.max(bottom - top, first.bounds.height),
    },
    baselineY: first.baselineY,
    underline: lines.every((line) => line.underline),
    strikethrough: lines.every((line) => line.strikethrough),
    decorationOpRanges,
    sourceRunIds: lines.map((line) => line.id),
    lines,
    isParagraph: true,
    textAlign: justifiedIndexes.size > 0 ? "justify" : "start",
    lineStep: medianLineStep(lines),
    lineLayouts: lines.map((line, lineIndex) => ({
      left: line.bounds.left - left,
      top: line.bounds.top - top,
      width: line.bounds.width,
      justify: justifiedIndexes.has(lineIndex),
    })),
  };
}

export function buildSourceTextBlocks(
  runs: readonly TextRun[],
  pageNumber: number,
): SourceTextBlock[] {
  const blocks: SourceTextBlock[] = [];
  let bucket: TextRun[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    blocks.push(makeBlock(pageNumber, blocks.length, bucket));
    bucket = [];
  };

  for (const run of runs) {
    if (bucket.length === 0) {
      bucket.push(run);
      continue;
    }
    const prev = bucket[bucket.length - 1];
    if (canJoinParagraph(prev, run, bucket[0])) {
      bucket.push(run);
    } else {
      flush();
      bucket.push(run);
    }
  }
  flush();
  return blocks;
}
