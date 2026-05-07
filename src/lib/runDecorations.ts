// Pair thin horizontal vector blocks on a page with text runs they
// visually decorate (underline / strikethrough). A shape that sits at
// the right offset from a run's baseline AND is horizontally contained
// in the run's bbox becomes that run's decoration: stamped on the run
// (so the editor's toolbar starts in the right state) AND removed from
// the shape list (so the user can't delete the line independently of
// the text). The shape's q…Q op range rides on the run as
// `decorationOpRanges`, which the save pipeline strips alongside the
// run's Tj/TJ ops on edit. That closes the round-trip: re-opening a
// PDF we saved with `style.underline = true` re-detects the line as
// the run's underline; toggling underline OFF on a subsequent edit
// strips both the text AND the decoration.

import type { RenderedPage, TextRun } from "@/lib/pdf";

/** In-place mutation: pairs each thin horizontal q…Q block with the
 *  run it decorates, drops paired shapes from `page.shapes`, and stamps
 *  `underline` / `strikethrough` / `decorationOpRanges` onto the run.
 *
 *  Pairing rules (PDF user space, y-up):
 *    - shape thickness ≤ MAX_THICKNESS_PT (rules are typically ~0.5pt)
 *    - shape's center x lies inside the run's [pdfLeft, pdfRight]
 *    - ≥ 60% of the shape's x-extent lies inside the run's x-extent
 *    - shape width ≤ 1.4× run width (a paragraph-wide underline that
 *      spans many runs is NOT paired — keeping that case correct
 *      requires splitting the shape, which is out of v1 scope)
 *    - vertical offset from baseline:
 *        underline:    center_y is 0.02..0.30 × size BELOW baseline
 *        strikethrough: center_y is 0.15..0.55 × size ABOVE baseline
 *
 *  When multiple runs match, the run with the largest horizontal
 *  overlap wins; underline and strikethrough are tracked independently
 *  so a run can have both. */
export function pairDecorationsWithRuns(page: RenderedPage): void {
  if (page.shapes.length === 0 || page.textRuns.length === 0) return;
  const pageHeight = page.pdfHeight;
  const scale = page.scale;

  type RunGeom = {
    run: TextRun;
    pdfLeft: number;
    pdfRight: number;
    pdfWidth: number;
    pdfBaselineY: number;
    sizePt: number;
    underlineSet: boolean;
    strikethroughSet: boolean;
  };
  const runGeoms: RunGeom[] = page.textRuns.map((run) => ({
    run,
    pdfLeft: run.bounds.left / scale,
    pdfRight: (run.bounds.left + run.bounds.width) / scale,
    pdfWidth: run.bounds.width / scale,
    pdfBaselineY: pageHeight - run.baselineY / scale,
    sizePt: run.height / scale,
    underlineSet: false,
    strikethroughSet: false,
  }));

  const MAX_THICKNESS_PT = 2.5;
  const consumed = new Set<string>();

  for (const shape of page.shapes) {
    if (shape.pdfHeight > MAX_THICKNESS_PT) continue;
    if (shape.pdfWidth < 2) continue;

    const sCenterY = shape.pdfY + shape.pdfHeight / 2;
    const sLeft = shape.pdfX;
    const sRight = shape.pdfX + shape.pdfWidth;
    const sCenterX = (sLeft + sRight) / 2;

    let bestUnderline: { rg: RunGeom; overlap: number } | null = null;
    let bestStrike: { rg: RunGeom; overlap: number } | null = null;

    for (const rg of runGeoms) {
      const overlap = Math.min(sRight, rg.pdfRight) - Math.max(sLeft, rg.pdfLeft);
      if (overlap <= 0) continue;
      if (overlap < shape.pdfWidth * 0.6) continue;
      if (shape.pdfWidth > rg.pdfWidth * 1.4) continue;
      if (sCenterX < rg.pdfLeft || sCenterX > rg.pdfRight) continue;

      const dY = sCenterY - rg.pdfBaselineY;
      const sz = Math.max(1, rg.sizePt);
      if (!rg.underlineSet && dY <= -0.02 * sz && dY >= -0.3 * sz) {
        if (!bestUnderline || overlap > bestUnderline.overlap) {
          bestUnderline = { rg, overlap };
        }
      }
      if (!rg.strikethroughSet && dY >= 0.15 * sz && dY <= 0.55 * sz) {
        if (!bestStrike || overlap > bestStrike.overlap) {
          bestStrike = { rg, overlap };
        }
      }
    }

    if (bestUnderline) {
      const { rg } = bestUnderline;
      rg.run.underline = true;
      rg.underlineSet = true;
      const ranges = rg.run.decorationOpRanges ?? [];
      ranges.push({ qOpIndex: shape.qOpIndex, QOpIndex: shape.QOpIndex });
      rg.run.decorationOpRanges = ranges;
      consumed.add(shape.id);
      continue;
    }
    if (bestStrike) {
      const { rg } = bestStrike;
      rg.run.strikethrough = true;
      rg.strikethroughSet = true;
      const ranges = rg.run.decorationOpRanges ?? [];
      ranges.push({ qOpIndex: shape.qOpIndex, QOpIndex: shape.QOpIndex });
      rg.run.decorationOpRanges = ranges;
      consumed.add(shape.id);
    }
  }

  if (consumed.size > 0) {
    page.shapes = page.shapes.filter((s) => !consumed.has(s.id));
  }
}
