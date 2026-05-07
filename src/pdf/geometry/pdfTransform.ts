import type { TextItem } from "@/pdf/render/pdfTypes";

/** 6-element affine transform: [a, b, c, d, tx, ty]. */
export type Mat = number[];

export function multiplyTransforms(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/** Convert a text item's transform into a CSS-positioned bounding box in viewport pixels. */
export function itemBoundsInViewport(item: TextItem): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const [, , , scaleY, tx, ty] = item.transform;
  const height = Math.abs(scaleY);
  return {
    left: tx,
    top: ty - height,
    width: item.width,
    height,
  };
}
