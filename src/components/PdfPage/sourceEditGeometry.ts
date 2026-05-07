import type { TextRun } from "@/pdf/render/pdf";
import type { SourceTextBlock } from "@/pdf/text/textBlocks";

function isSourceTextBlock(run: TextRun | SourceTextBlock): run is SourceTextBlock {
  return "isParagraph" in run;
}

export function sourceEditGeometry({
  run,
  pageViewWidth,
  dx,
  dy,
  isRtlEditor,
}: {
  run: TextRun | SourceTextBlock;
  pageViewWidth: number;
  dx: number;
  dy: number;
  isRtlEditor: boolean;
}) {
  const isParagraph = isSourceTextBlock(run) && run.isParagraph;
  const lineLayouts = isSourceTextBlock(run) ? run.lineLayouts : undefined;
  const hasSourceLineLayouts = !!lineLayouts && lineLayouts.length > 0;
  const layoutPadX = hasSourceLineLayouts ? Math.max(4, run.height * 0.25) : 0;
  const layoutPadTop = hasSourceLineLayouts ? Math.max(4, run.height * 0.55) : 0;
  const layoutPadBottom = hasSourceLineLayouts ? Math.max(8, run.height * 1.1) : 0;
  const layoutRight = hasSourceLineLayouts
    ? Math.max(...lineLayouts.map((layout) => layout.left + layout.width))
    : run.bounds.width;
  const singleLinePadding = Math.max(
    run.height * 2,
    Math.min(64, run.bounds.width * 0.25 + run.height * 1.5),
  );
  const widthPadding = isParagraph ? 32 : singleLinePadding;
  const maxWidth = hasSourceLineLayouts
    ? pageViewWidth + Math.max(96, run.height * 6)
    : pageViewWidth + Math.max(96, run.height * 6);
  const width = Math.min(
    maxWidth,
    Math.max(
      run.bounds.width + widthPadding + layoutPadX * 2,
      layoutRight + layoutPadX + Math.max(16, run.height),
      isParagraph ? 120 : run.bounds.width + widthPadding,
    ),
  );
  const left = hasSourceLineLayouts
    ? run.bounds.left - layoutPadX + dx
    : isRtlEditor
      ? run.bounds.left + run.bounds.width + dx - width
      : run.bounds.left + dx;
  const lineHeight =
    isSourceTextBlock(run) && run.lineStep
      ? run.lineStep
      : isParagraph
        ? Math.max(run.height * 1.45, run.height + 4)
        : run.bounds.height;
  const height = hasSourceLineLayouts
    ? run.bounds.height + layoutPadTop + layoutPadBottom
    : isParagraph
      ? run.bounds.height + Math.max(8, run.height * 0.9)
      : Math.max(run.bounds.height + Math.max(8, run.height * 0.75), lineHeight * 1.75);
  const textTopNudge = run.height * 0.25;
  const top = hasSourceLineLayouts
    ? run.bounds.top - layoutPadTop + dy
    : run.bounds.top + textTopNudge + dy;
  const lineLayoutOffsetY = hasSourceLineLayouts ? layoutPadTop : layoutPadTop + textTopNudge;

  return {
    left,
    top,
    width,
    height,
    lineHeight,
    lineLayouts,
    lineLayoutOffsetX: layoutPadX,
    lineLayoutOffsetY,
    isParagraph,
    hasSourceLineLayouts,
  };
}
