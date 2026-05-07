import type { TextRun } from "@/pdf/render/pdfTypes";

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/u;

export type SourceTextBlock = TextRun & {
  sourceRunIds: string[];
  lines: TextRun[];
  isParagraph: boolean;
};

function isRtl(text: string): boolean {
  return RTL_RE.test(text);
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

function canJoinParagraph(prev: TextRun, next: TextRun, first: TextRun): boolean {
  if (!sameInlineStyle(prev, next) || !sameInlineStyle(first, next)) return false;
  const rtl = isRtl(first.text);
  if (isRtl(next.text) !== rtl) return false;
  const lineStep = Math.abs(next.baselineY - prev.baselineY);
  const nominalLineHeight = Math.max(first.bounds.height, prev.bounds.height, next.bounds.height);
  if (lineStep < nominalLineHeight * 0.65 || lineStep > nominalLineHeight * 1.8) return false;
  const indentDelta = Math.abs(lineIndent(next, rtl) - lineIndent(first, rtl));
  if (indentDelta > nominalLineHeight * 1.25) return false;
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
  const opIndices = Array.from(
    new Set(lines.flatMap((line) => line.contentStreamOpIndices)),
  ).sort((a, b) => a - b);
  const decorationOpRanges = lines.flatMap((line) => line.decorationOpRanges ?? []);
  return {
    ...first,
    id: `p${pageNumber}-b${index}`,
    sourceIndices,
    contentStreamOpIndices: opIndices,
    text: lines.map((line) => line.text).join("\n"),
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
  };
}

export function buildSourceTextBlocks(runs: readonly TextRun[], pageNumber: number): SourceTextBlock[] {
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
