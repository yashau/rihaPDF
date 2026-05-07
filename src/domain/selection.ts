export type Selection =
  | { kind: "image"; slotId: string; imageId: string }
  | { kind: "insertedImage"; slotId: string; id: string }
  | { kind: "shape"; slotId: string; shapeId: string }
  | { kind: "redaction"; slotId: string; id: string }
  | { kind: "highlight"; slotId: string; id: string }
  | { kind: "ink"; slotId: string; id: string }
  | null;
