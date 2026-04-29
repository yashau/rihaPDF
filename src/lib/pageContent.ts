// Helpers for reading + replacing a page's raw content stream bytes via
// pdf-lib's lower-level APIs. pdf-lib's public API only lets you APPEND
// operators (`page.pushOperators`); for true text replacement we need to
// modify or remove existing operators, which requires going through the
// underlying PDFStream objects.

import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";

/**
 * Read a page's full content as a single uncompressed byte stream. If the
 * page has multiple content streams (Contents = array), they're
 * concatenated with a newline separator (PDF spec §7.8.2 says they're
 * concatenated as if one stream).
 */
export function getPageContentBytes(
  context: PDFContext,
  pageNode: PDFDict,
): Uint8Array {
  const contents = pageNode.lookup(PDFName.of("Contents"));
  if (!contents) return new Uint8Array();

  const decode = (s: PDFStream): Uint8Array => {
    if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
    // PDFContentStream / PDFFlateStream both expose getUnencodedContents.
    const maybe = s as { getUnencodedContents?: () => Uint8Array };
    if (typeof maybe.getUnencodedContents === "function") {
      return maybe.getUnencodedContents();
    }
    throw new Error("Unsupported content stream type");
  };

  if (contents instanceof PDFStream) {
    return decode(contents);
  }
  if (contents instanceof PDFArray) {
    const chunks: Uint8Array[] = [];
    for (const item of contents.asArray()) {
      const resolved =
        item instanceof PDFRef ? context.lookup(item) : item;
      if (!(resolved instanceof PDFStream)) continue;
      chunks.push(decode(resolved));
      chunks.push(new Uint8Array([0x0a]));
    }
    return concat(chunks);
  }
  return new Uint8Array();
}

/**
 * Replace a page's Contents entry with a single new uncompressed stream
 * containing the given bytes. We wrap the stream ref in a PDFArray so
 * subsequent pdf-lib calls that expect Contents to be appendable
 * (`page.pushOperators` -> `Contents.push(ref)`) keep working.
 */
export function setPageContentBytes(
  context: PDFContext,
  pageNode: PDFDict,
  bytes: Uint8Array,
): void {
  const dict = context.obj({}) as PDFDict;
  const stream = PDFRawStream.of(dict, bytes);
  const ref = context.register(stream);
  const array = context.obj([ref]) as PDFArray;
  pageNode.set(PDFName.of("Contents"), array);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
