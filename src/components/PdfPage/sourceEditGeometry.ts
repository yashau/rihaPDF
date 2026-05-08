import type { TextRun } from "@/pdf/render/pdf";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
}

export function sourceEditGeometry({
  run,
  dx,
  dy,
  isRtlEditor,
  editBoxWidth,
  editBoxHeight,
}: {
  run: TextRun | SourceTextBlock;
  dx: number;
  dy: number;
  isRtlEditor: boolean;
  editBoxWidth?: number;
  editBoxHeight?: number;
}) {
  const isParagraph = isSourceTextBlock(run) && run.isParagraph;
  const lineLayouts = isSourceTextBlock(run) ? run.lineLayouts : undefined;
  const hasSourceLineLayouts = !!lineLayouts && lineLayouts.length > 0;
  // Keep the initial editor close to the extracted text bounds, with
  // only a small horizontal allowance for caret/outline/scrollbar
  // rounding. Direction controls where that allowance appears: LTR
  // grows right, RTL grows left.
  const fitAllowance = Math.max(12, Math.min(32, run.height * 1.5));
  const defaultWidth = Math.max(24, run.bounds.width + fitAllowance);
  const width = editBoxWidth ?? defaultWidth;
  const left = isRtlEditor ? run.bounds.left + run.bounds.width + dx - width : run.bounds.left + dx;
  const lineHeight =
    isSourceTextBlock(run) && run.lineStep
      ? run.lineStep
      : isParagraph
        ? Math.max(run.height * 1.45, run.height + 4)
        : run.bounds.height;
  const lineCount = hasSourceLineLayouts ? lineLayouts.length : 1;
  const bottomFitAllowance = Math.max(2, Math.min(4, run.height * 0.18));
  const defaultHeight = Math.max(
    run.bounds.height + bottomFitAllowance,
    (lineCount > 1 ? lineHeight * lineCount : lineHeight) + bottomFitAllowance,
  );
  const height = editBoxHeight ?? defaultHeight;
  const top = run.bounds.top + dy;

  return {
    left,
    top,
    width,
    height,
    lineHeight,
    lineLayouts,
    lineLayoutOffsetX: 0,
    lineLayoutOffsetY: 0,
    isParagraph,
    hasSourceLineLayouts,
  };
}
