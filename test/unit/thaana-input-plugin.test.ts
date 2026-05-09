import { describe, expect, test } from "vitest";
import {
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from "lexical";
import {
  handleThaanaBeforeInput,
  registerThaanaInputCommands,
  thaanaReplacementForBeforeInput,
  type ThaanaBeforeInputEvent,
} from "@/components/PdfPage/richTextThaanaInput";

function beforeInput(overrides: Partial<ThaanaBeforeInputEvent> = {}): ThaanaBeforeInputEvent {
  return {
    data: "s",
    inputType: "insertText",
    isComposing: false,
    ...overrides,
  };
}

describe("ThaanaInputPlugin beforeinput command", () => {
  test("maps single-character insertText beforeinput events to Thaana", () => {
    expect(thaanaReplacementForBeforeInput(beforeInput())).toBe("ސ");
    expect(thaanaReplacementForBeforeInput(beforeInput({ data: "S" }))).toBe("ށ");
  });

  test("does not intercept composition, paste, multi-character, or unmapped input", () => {
    expect(thaanaReplacementForBeforeInput(beforeInput({ isComposing: true }))).toBeNull();
    expect(
      thaanaReplacementForBeforeInput(beforeInput({ inputType: "insertFromPaste" })),
    ).toBeNull();
    expect(thaanaReplacementForBeforeInput(beforeInput({ data: "sl" }))).toBeNull();
    expect(thaanaReplacementForBeforeInput(beforeInput({ data: "1" }))).toBeNull();
  });

  test("prevents the native beforeinput and inserts the mapped Thaana character", () => {
    let prevented = false;
    let inserted = "";

    const handled = handleThaanaBeforeInput(
      {
        ...beforeInput({ data: "d" }),
        preventDefault() {
          prevented = true;
        },
      },
      (text) => {
        inserted = text;
      },
    );

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(inserted).toBe("ދ");
  });

  test("registers the Lexical BEFORE_INPUT_COMMAND at high priority", () => {
    const registered: Array<{
      command: LexicalCommand<unknown>;
      listener: unknown;
      priority: number;
    }> = [];
    let unregisterCount = 0;
    const editor = {
      registerCommand(command: LexicalCommand<unknown>, listener: unknown, priority: number) {
        registered.push({ command, listener, priority });
        return () => {
          unregisterCount += 1;
        };
      },
      dispatchCommand() {
        return true;
      },
    } as unknown as LexicalEditor;

    const unregister = registerThaanaInputCommands(editor, true);

    expect(registered).toHaveLength(2);
    expect(registered[0]?.command).toBe(BEFORE_INPUT_COMMAND);
    expect(registered[0]?.listener).toBeTypeOf("function");
    expect(registered[0]?.priority).toBe(COMMAND_PRIORITY_HIGH);
    expect(registered[1]?.command).toBe(CONTROLLED_TEXT_INSERTION_COMMAND);
    expect(registered[1]?.listener).toBeTypeOf("function");
    expect(registered[1]?.priority).toBe(COMMAND_PRIORITY_HIGH);

    unregister();
    expect(unregisterCount).toBe(2);
  });
});
