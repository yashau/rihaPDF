import { describe, expect, it } from "vitest";
import {
  contentReducer,
  createEmptyContentSnapshot,
  type AppContentSnapshot,
} from "@/app/state/contentState";
import { PRIMARY_SOURCE_KEY } from "@/domain/sourceKeys";
import type { PageSlot } from "@/domain/slots";
import type { TextInsertion } from "@/domain/insertions";

const slots: PageSlot[] = [
  { id: "slot-a", kind: "page", sourceKey: PRIMARY_SOURCE_KEY, sourcePageIndex: 0 },
  { id: "slot-b", kind: "page", sourceKey: PRIMARY_SOURCE_KEY, sourcePageIndex: 1 },
];

function textInsertion(overrides: Partial<TextInsertion> = {}): TextInsertion {
  return {
    id: "text-1",
    sourceKey: PRIMARY_SOURCE_KEY,
    pageIndex: 0,
    pdfX: 10,
    pdfY: 20,
    pdfWidth: 120,
    fontSize: 12,
    text: "hello",
    ...overrides,
  };
}

function reduce(
  action: Parameters<typeof contentReducer>[1],
  state = createEmptyContentSnapshot(),
) {
  return contentReducer(state, action);
}

describe("contentReducer", () => {
  it("stores nested source-run edits immutably", () => {
    const initial = createEmptyContentSnapshot();

    const next = reduce(
      { type: "content/setEdit", slotId: "slot-a", runId: "run-1", value: { text: "ރިހަ" } },
      initial,
    );

    expect(next).not.toBe(initial);
    expect(next.edits.get("slot-a")?.get("run-1")?.text).toBe("ރިހަ");
    expect(initial.edits.size).toBe(0);
  });

  it("moves a text insertion to the destination slot when a page-index patch targets another slot", () => {
    const withInsertion = reduce({
      type: "content/addTextInsert",
      slotId: "slot-a",
      insertion: textInsertion(),
    });

    const moved = reduce(
      {
        type: "content/patchTextInsert",
        sourceSlotId: "slot-a",
        id: "text-1",
        slots,
        patch: { sourceKey: PRIMARY_SOURCE_KEY, pageIndex: 1, pdfX: 42 },
      },
      withInsertion,
    );

    expect(moved.insertedTexts.get("slot-a")).toEqual([]);
    expect(moved.insertedTexts.get("slot-b")).toEqual([textInsertion({ pageIndex: 1, pdfX: 42 })]);
  });

  it("clears editing state and marks source images deleted through focused actions", () => {
    const editing = reduce({ type: "content/setEditingRun", slotId: "slot-a", runId: "run-1" });
    const cleared = reduce(
      { type: "content/setEditingRun", slotId: "slot-a", runId: null },
      editing,
    );
    const deletedImage = reduce(
      { type: "content/markImageDeleted", slotId: "slot-a", imageId: "img-1" },
      cleared,
    );

    expect(editing.editingByPage.get("slot-a")).toBe("run-1");
    expect(cleared.editingByPage.has("slot-a")).toBe(false);
    expect(deletedImage.imageMoves.get("slot-a")?.get("img-1")).toEqual({ deleted: true });
  });

  it("replaces the whole content snapshot for undo/redo restore", () => {
    const replacement: AppContentSnapshot = {
      ...createEmptyContentSnapshot(),
      insertedTexts: new Map([["slot-a", [textInsertion({ id: "restored" })]]]),
    };

    const next = reduce({ type: "content/replaceAll", next: replacement });

    expect(next).toBe(replacement);
  });
});
