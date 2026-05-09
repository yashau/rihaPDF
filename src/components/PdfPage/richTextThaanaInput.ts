import {
  $getSelection,
  $isRangeSelection,
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_HIGH,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type LexicalEditor,
} from "lexical";
import { thaanaForLatin } from "@/domain/thaanaKeyboard";

export type ThaanaBeforeInputEvent = Pick<InputEvent, "data" | "inputType" | "isComposing">;
export type ThaanaBeforeInputInsertEvent = ThaanaBeforeInputEvent &
  Pick<InputEvent, "preventDefault">;

export function thaanaReplacementForBeforeInput(event: ThaanaBeforeInputEvent): string | null {
  if (event.inputType !== "insertText" || event.isComposing) return null;
  const data = event.data;
  if (!data || data.length !== 1) return null;
  const mapped = thaanaForLatin(data);
  return mapped === data ? null : mapped;
}

export function handleThaanaBeforeInput(
  event: ThaanaBeforeInputInsertEvent,
  insertText: (text: string) => void,
): boolean {
  const mapped = thaanaReplacementForBeforeInput(event);
  if (!mapped) return false;
  event.preventDefault();
  insertText(mapped);
  return true;
}

export function registerThaanaInputCommands(editor: LexicalEditor, enabled: boolean): () => void {
  const unregisterBeforeInput = editor.registerCommand(
    BEFORE_INPUT_COMMAND,
    (event) => {
      if (!enabled) return false;
      if (!thaanaReplacementForBeforeInput(event)) return false;
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      return handleThaanaBeforeInput(event, (text) => selection.insertText(text));
    },
    COMMAND_PRIORITY_HIGH,
  );
  const unregisterControlledInsertion = editor.registerCommand(
    CONTROLLED_TEXT_INSERTION_COMMAND,
    (payload) => {
      if (!enabled || typeof payload !== "string" || payload.length !== 1) return false;
      const mapped = thaanaForLatin(payload);
      if (mapped === payload) return false;
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, mapped);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
  return () => {
    unregisterBeforeInput();
    unregisterControlledInsertion();
  };
}
