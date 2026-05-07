import type { RenderedPage } from "../../lib/pdf";
import type { TextInsertion } from "@/domain/insertions";
import type { EditValue, ToolbarBlocker } from "./types";

export function buildToolbarBlockers(
  page: RenderedPage,
  edits: Map<string, EditValue>,
  insertedTexts: TextInsertion[],
): ToolbarBlocker[] {
  const toolbarBlockers: ToolbarBlocker[] = [];
  for (const r of page.textRuns) {
    const ev = edits.get(r.id);
    if (ev?.deleted) continue;
    const dx = ev?.dx ?? 0;
    const dy = ev?.dy ?? 0;
    toolbarBlockers.push({
      id: r.id,
      left: r.bounds.left + dx,
      right: r.bounds.left + dx + r.bounds.width,
      top: r.bounds.top + dy,
      bottom: r.bounds.top + dy + r.bounds.height,
    });
  }
  for (const ins of insertedTexts) {
    const fontSizePx = ins.fontSize * page.scale;
    const lineHeightPx = ins.fontSize * 1.4 * page.scale;
    const left = ins.pdfX * page.scale;
    const top = page.viewHeight - ins.pdfY * page.scale - fontSizePx;
    const width = Math.max(ins.pdfWidth * page.scale, 60);
    toolbarBlockers.push({
      id: ins.id,
      left,
      right: left + width,
      top,
      bottom: top + lineHeightPx,
    });
  }
  return toolbarBlockers;
}
