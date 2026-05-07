export type InitialCaretPoint = {
  clientX: number;
  clientY: number;
  caretOffset?: number;
};

export type ResizeCorner = "tl" | "tr" | "bl" | "br";

export type ToolbarBlocker = {
  /** id of the run / inserted text the blocker rect comes from. The
   *  caller uses this to skip the run currently being edited. */
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
};
