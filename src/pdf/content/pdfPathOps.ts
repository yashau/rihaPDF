import type { ContentOp } from "@/pdf/content/contentStream";

export const VECTOR_PAINT_OPS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*"]);
export const VECTOR_PATH_END_OPS = new Set([...VECTOR_PAINT_OPS, "n"]);
export const VECTOR_CLIP_OPS = new Set(["W", "W*"]);

export function readNumberOperands(op: ContentOp): number[] | null {
  const out: number[] = [];
  for (const t of op.operands) {
    if (t.kind !== "number") return null;
    out.push(t.value);
  }
  return out;
}

export function includePathConstructionPoints(
  op: ContentOp,
  includePoint: (x: number, y: number) => void,
): boolean {
  const nums = readNumberOperands(op);
  switch (op.op) {
    case "m":
    case "l":
      if (nums?.length !== 2) return false;
      includePoint(nums[0], nums[1]);
      return true;
    case "c":
      if (nums?.length !== 6) return false;
      includePoint(nums[0], nums[1]);
      includePoint(nums[2], nums[3]);
      includePoint(nums[4], nums[5]);
      return true;
    case "v":
    case "y":
      if (nums?.length !== 4) return false;
      includePoint(nums[0], nums[1]);
      includePoint(nums[2], nums[3]);
      return true;
    case "re":
      if (nums?.length !== 4) return false;
      includePoint(nums[0], nums[1]);
      includePoint(nums[0] + nums[2], nums[1]);
      includePoint(nums[0], nums[1] + nums[3]);
      includePoint(nums[0] + nums[2], nums[1] + nums[3]);
      return true;
    default:
      return false;
  }
}
