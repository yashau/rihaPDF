export type ToolMode =
  | "select"
  | "addText"
  | "addImage"
  | "highlight"
  | "redact"
  | "comment"
  | "ink";

export type PendingImage = {
  kind: "image" | "signature";
  bytes: Uint8Array;
  format: "png" | "jpeg";
  naturalWidth: number;
  naturalHeight: number;
};
