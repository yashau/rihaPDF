import { describe, expect, it } from "vitest";
import { createEmptyContentSnapshot, type AppContentSnapshot } from "@/app/state/contentState";
import {
  selectSaveDisabled,
  selectToolTip,
  selectTotalChangeCount,
} from "@/app/state/saveStatusSelectors";
import type { Annotation } from "@/domain/annotations";
import { DEFAULT_HIGHLIGHT_COLOR } from "@/domain/annotations";
import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import type { TextInsertion } from "@/domain/insertions";
import type { Redaction } from "@/domain/redactions";
import type { PageSlot } from "@/domain/slots";
import type { LoadedSource } from "@/pdf/source/loadSource";

const slots: PageSlot[] = [
  { id: "slot-0", kind: "page", sourceKey: PRIMARY_SOURCE_KEY, sourcePageIndex: 0 },
  { id: "slot-1", kind: "page", sourceKey: PRIMARY_SOURCE_KEY, sourcePageIndex: 1 },
];

const baselineHighlight: Annotation = {
  kind: "highlight",
  id: "highlight-1",
  sourceKey: PRIMARY_SOURCE_KEY,
  pageIndex: 0,
  quads: [{ x1: 0, y1: 10, x2: 10, y2: 10, x3: 0, y3: 0, x4: 10, y4: 0 }],
  color: DEFAULT_HIGHLIGHT_COLOR,
};

const insertedText: TextInsertion = {
  id: "t",
  sourceKey: PRIMARY_SOURCE_KEY,
  pageIndex: 0,
  pdfX: 10,
  pdfY: 20,
  pdfWidth: 120,
  fontSize: 12,
  text: "new text",
};

const redaction: Redaction = {
  id: "r",
  sourceKey: PRIMARY_SOURCE_KEY,
  pageIndex: 1,
  pdfX: 0,
  pdfY: 0,
  pdfWidth: 20,
  pdfHeight: 10,
};

function source(pageCount = 2, annotationsByPage: Annotation[][] = [[baselineHighlight], []]) {
  return {
    sourceKey: PRIMARY_SOURCE_KEY,
    pages: Array.from({ length: pageCount }, () => ({})),
    annotationsByPage,
  } as unknown as LoadedSource;
}

describe("saveStatusSelectors", () => {
  it("returns zero changes when slots match the primary source and annotations match baseline", () => {
    const content = {
      ...createEmptyContentSnapshot(),
      annotations: new Map([["slot-0", [baselineHighlight]]]),
    };

    expect(
      selectTotalChangeCount({
        sources: new Map([[PRIMARY_SOURCE_KEY, source()]]),
        slots,
        content,
      }),
    ).toBe(0);
  });

  it("counts reducer-owned content, form fills, annotation differences, and structural edits", () => {
    const content: AppContentSnapshot = {
      ...createEmptyContentSnapshot(),
      edits: new Map([["slot-0", new Map([["run-1", { text: "changed" }]])]]),
      insertedTexts: new Map([["slot-0", [insertedText]]]),
      redactions: new Map([["slot-1", [redaction]]]),
      formValues: new Map([
        [PRIMARY_SOURCE_KEY, new Map([["name", { kind: "text", value: "A" }]])],
      ]),
      annotations: new Map([["slot-1", [baselineHighlight]]]),
    };
    const withRemovedPage = [slots[1]];

    expect(
      selectTotalChangeCount({
        sources: new Map([[PRIMARY_SOURCE_KEY, source()]]),
        slots: withRemovedPage,
        content,
      }),
    ).toBe(6);
  });

  it("disables save with no source, busy status, or no changes", () => {
    const sources = new Map([[PRIMARY_SOURCE_KEY, source()]]);

    expect(selectSaveDisabled({ sources: new Map(), busy: false, totalChangeCount: 1 })).toBe(true);
    expect(selectSaveDisabled({ sources, busy: true, totalChangeCount: 1 })).toBe(true);
    expect(selectSaveDisabled({ sources, busy: false, totalChangeCount: 0 })).toBe(true);
    expect(selectSaveDisabled({ sources, busy: false, totalChangeCount: 1 })).toBe(false);
  });

  it("selects placement and markup tooltips", () => {
    expect(selectToolTip({ tool: "addText", pendingImage: null })).toBe(
      "Tap a page to drop a text box",
    );
    expect(
      selectToolTip({
        tool: "addImage",
        pendingImage: {
          kind: "signature",
          bytes: new Uint8Array(),
          format: "png",
          naturalWidth: 10,
          naturalHeight: 10,
        },
      }),
    ).toBe("Tap a page to place the signature");
    expect(selectToolTip({ tool: "select", pendingImage: null })).toBeNull();
  });
});
