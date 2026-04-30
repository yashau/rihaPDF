// Net-new content the user adds to a page — text boxes typed from
// scratch, images dropped in from disk. Lives alongside the existing
// "edit existing run" + "move existing image" features but doesn't
// reference any source-PDF object; it gets appended to the page on
// save.
//
// Coordinates: all positions are stored in PDF USER SPACE (y-up),
// matching how source-extracted ImageInstance + TextRun store theirs.
// PdfPage converts to viewport space when rendering.

import type { EditStyle } from "./save";

export type TextInsertion = {
  /** Stable id for state plumbing: "p<pageNumber>-t<index>". */
  id: string;
  pageIndex: number;
  /** Baseline x in PDF user space. */
  pdfX: number;
  /** Baseline y in PDF user space (y-up). */
  pdfY: number;
  /** Initial bounding-box width in PDF points — used as a soft hint
   *  for the EditField's measured width. The actual width on save is
   *  computed from the chosen font + text. */
  pdfWidth: number;
  /** Font size in PDF points. */
  fontSize: number;
  text: string;
  style?: EditStyle;
};

export type ImageInsertion = {
  /** Stable id: "p<pageNumber>-ni<index>". */
  id: string;
  pageIndex: number;
  /** Bottom-left in PDF user space (matches ImageInstance convention). */
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  /** Raw bytes of the image file the user picked. We keep them as-is
   *  so save.ts can hand them to pdf-lib's embedJpg / embedPng. */
  bytes: Uint8Array;
  /** Detected from the file's magic bytes — pdf-lib needs the right
   *  embed method. */
  format: "png" | "jpeg";
};

/** Detect a binary blob's image format from the first few bytes.
 *  Returns null when neither PNG nor JPEG (we don't try to support
 *  GIF/BMP/etc — pdf-lib doesn't either). */
export function detectImageFormat(
  bytes: Uint8Array,
): "png" | "jpeg" | null {
  if (bytes.length < 4) return null;
  // PNG: 89 50 4E 47
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  return null;
}

/** Read an <input type="file"> selection into a typed ImageInsertion
 *  blob (without yet attaching it to a page — caller picks the
 *  position via click). Resolves to null if the file isn't PNG/JPEG. */
export async function readImageFile(
  file: File,
): Promise<{
  bytes: Uint8Array;
  format: "png" | "jpeg";
  naturalWidth: number;
  naturalHeight: number;
} | null> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const format = detectImageFormat(bytes);
  if (!format) return null;
  // Use the browser to read the natural pixel dimensions so the
  // initial PDF placement has reasonable defaults.
  const dims = await new Promise<{ w: number; h: number }>((resolve) => {
    const url = URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: `image/${format}` }),
    );
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ w: 100, h: 100 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
  return { bytes, format, naturalWidth: dims.w, naturalHeight: dims.h };
}
