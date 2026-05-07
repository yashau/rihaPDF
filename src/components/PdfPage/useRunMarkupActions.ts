import type { Annotation, AnnotationColor } from "../../lib/annotations";
import { HIGHLIGHT_LINE_PAD, lineMarkupRect, newAnnotationId } from "../../lib/annotations";
import type { RenderedPage, TextRun } from "../../lib/pdf";
import { newRedactionId, REDACTION_LINE_PAD, type Redaction } from "../../lib/redactions";

export function useRunMarkupActions({
  page,
  sourceKey,
  pageIndex,
  highlightColor,
  onAnnotationAdd,
  onRedactionAdd,
}: {
  page: RenderedPage;
  sourceKey: string;
  pageIndex: number;
  highlightColor: AnnotationColor;
  onAnnotationAdd: (annotation: Annotation) => void;
  onRedactionAdd: (redaction: Redaction) => void;
}): {
  addHighlightForRun: (run: TextRun) => void;
  addRedactionForRun: (run: TextRun) => void;
} {
  const addHighlightForRun = (run: TextRun) => {
    const [llx, lly, urx, ury] = lineMarkupRect(
      run,
      page.scale,
      page.viewHeight,
      HIGHLIGHT_LINE_PAD,
    );
    onAnnotationAdd({
      kind: "highlight",
      id: newAnnotationId("highlight"),
      sourceKey,
      pageIndex,
      quads: [{ x1: llx, y1: ury, x2: urx, y2: ury, x3: llx, y3: lly, x4: urx, y4: lly }],
      color: highlightColor,
    });
  };

  const addRedactionForRun = (run: TextRun) => {
    const [llx, lly, urx, ury] = lineMarkupRect(
      run,
      page.scale,
      page.viewHeight,
      REDACTION_LINE_PAD,
    );
    onRedactionAdd({
      id: newRedactionId(),
      sourceKey,
      pageIndex,
      pdfX: llx,
      pdfY: lly,
      pdfWidth: urx - llx,
      pdfHeight: ury - lly,
    });
  };

  return { addHighlightForRun, addRedactionForRun };
}
