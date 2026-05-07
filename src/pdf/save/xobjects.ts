import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

/** Walk forward from a `q` op tracking nested q/Q depth and return the
 *  index of the matching `Q`. Used by the cross-page image strip path
 *  to remove the entire q…Q block of the moved image so its pixels
 *  vanish from the origin page. */
export function findMatchingQ(ops: Array<{ op: string }>, qIndex: number): number | null {
  if (ops[qIndex]?.op !== "q") return null;
  let depth = 1;
  for (let i = qIndex + 1; i < ops.length; i++) {
    if (ops[i].op === "q") depth++;
    else if (ops[i].op === "Q") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** Look up the PDFRef for an XObject named `resName` on a page (walking
 *  the page-tree via Parent so inherited Resources also work). Returns
 *  null when the XObject is stored inline (no ref) — we register it as
 *  a fresh ref before returning, since cross-page replication needs a
 *  ref to put into the target page's resources. */
export function lookupPageXObjectRef(
  doc: PDFDocument,
  pageNode: PDFDict,
  resName: string,
): PDFRef | null {
  let node: PDFDict | null = pageNode;
  while (node) {
    const resources = node.lookup(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      const xo = resources.lookup(PDFName.of("XObject"));
      if (xo instanceof PDFDict) {
        const raw = xo.get(PDFName.of(resName));
        if (raw instanceof PDFRef) return raw;
        if (raw) {
          // Inline object — register it so we can reference it from
          // another page. (Should be very rare; XObjects are usually
          // indirect.)
          return doc.context.register(raw);
        }
      }
    }
    const parent: unknown = node.lookup(PDFName.of("Parent"));
    if (parent instanceof PDFDict) {
      node = parent;
    } else if (parent instanceof PDFRef) {
      const r = doc.context.lookup(parent);
      node = r instanceof PDFDict ? r : null;
    } else {
      node = null;
    }
  }
  return null;
}

/** Pull raw image-XObject bytes (and format hint) out of a page's
 *  resources by name. Used by cross-source image moves so we can
 *  re-embed the original pixels on the target source's doc. Falls back
 *  to null when the XObject isn't a raster (Form XObjects, indirect
 *  masks, weird filter chains). */
export function readImageBytesFromXObject(
  doc: PDFDocument,
  pageNode: PDFDict,
  resName: string,
): { bytes: Uint8Array; format: "png" | "jpeg" | null } | null {
  const ref = lookupPageXObjectRef(doc, pageNode, resName);
  if (!ref) return null;
  const obj = doc.context.lookup(ref);
  if (!obj || typeof obj !== "object" || !("contents" in obj)) return null;
  const stream = obj as unknown as {
    contents?: Uint8Array;
    dict: PDFDict;
  };
  if (!(stream.contents instanceof Uint8Array)) return null;
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  let format: "png" | "jpeg" | null = null;
  // pdf-lib's filter values vary in shape (single name vs array). We
  // only need a coarse hint — JPEG = DCTDecode, anything else we fall
  // back to PNG and trust pdf-lib's embedPng to fail loud if the bytes
  // aren't actually PNG (which is fine; cross-source image moves of
  // exotic filters are best-effort in v1).
  const filterStr = String(filter ?? "");
  if (filterStr.includes("DCTDecode")) format = "jpeg";
  else if (looksLikePngBytes(stream.contents)) format = "png";
  return { bytes: stream.contents, format };
}

function looksLikePngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

let nextImageId = 0;
const imageBytesIds = new WeakMap<Uint8Array, string>();
export function idOf(bytes: Uint8Array): string {
  let id = imageBytesIds.get(bytes);
  if (!id) {
    nextImageId += 1;
    id = `i${nextImageId}`;
    imageBytesIds.set(bytes, id);
  }
  return id;
}
