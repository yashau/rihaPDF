// Dev-only: dump each font's `/ToUnicode` stream content (the PDF's
// authoritative CID → Unicode map) so we can see exactly which CIDs
// the source PDF claims are mapped — and which it leaves out.

import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";

export type ToUnicodeDump = {
  resource: string;
  baseFont: string;
  hasToUnicode: boolean;
  cmapText?: string;
  parsedMappings?: Array<{ cid: number; codePoints: number[] }>;
  /** Single-CID Tj operands seen in the page content stream that are
   *  NOT covered by the ToUnicode CMap — these are the "orphan"
   *  glyphs pdf.js silently drops. */
  orphanCidTjs?: Array<{
    cid: number;
    operandHex: string;
    /** Approx baseline x/y from the latest preceding Tm if available. */
    x?: number;
    y?: number;
  }>;
};

export async function dumpToUnicode(
  pdfBytes: ArrayBuffer,
): Promise<ToUnicodeDump[]> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const out: ToUnicodeDump[] = [];
  const page = doc.getPages()[0];
  let node: PDFDict | null = page.node;
  let fontDict: PDFDict | null = null;
  while (node && !fontDict) {
    const r = node.lookup(PDFName.of("Resources"));
    if (r instanceof PDFDict) {
      const f = r.lookup(PDFName.of("Font"));
      if (f instanceof PDFDict) fontDict = f;
    }
    if (fontDict) break;
    const p: unknown = node.lookup(PDFName.of("Parent"));
    if (p instanceof PDFDict) node = p;
    else if (p instanceof PDFRef) {
      const r2 = doc.context.lookup(p);
      node = r2 instanceof PDFDict ? r2 : null;
    } else node = null;
  }
  if (!fontDict) return out;

  for (const [name] of fontDict.entries()) {
    const fd = fontDict.lookup(name);
    if (!(fd instanceof PDFDict)) continue;
    const baseFont = String(fd.lookup(PDFName.of("BaseFont")) ?? "");
    const tu = fd.lookup(PDFName.of("ToUnicode"));
    if (!(tu instanceof PDFRawStream)) {
      out.push({ resource: name.toString(), baseFont, hasToUnicode: false });
      continue;
    }
    const bytes = decodePDFRawStream(tu).decode();
    const text = new TextDecoder("latin1").decode(bytes);
    const parsed = parseToUnicodeCMap(text);
    out.push({
      resource: name.toString(),
      baseFont,
      hasToUnicode: true,
      cmapText: text.length > 4000 ? text.slice(0, 4000) + "\n…(truncated)" : text,
      parsedMappings: parsed,
    });
  }
  return out;
}

/** Tiny parser for the bfchar / bfrange entries in a ToUnicode CMap.
 *  Not a full CMap implementation — just enough to enumerate mappings. */
function parseToUnicodeCMap(text: string): Array<{ cid: number; codePoints: number[] }> {
  const out: Array<{ cid: number; codePoints: number[] }> = [];
  // bfchar blocks: <SRC> <DST>
  const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let m: RegExpExecArray | null;
  while ((m = bfcharRe.exec(text)) !== null) {
    const body = m[1];
    const tupleRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let t: RegExpExecArray | null;
    while ((t = tupleRe.exec(body)) !== null) {
      const cid = parseInt(t[1], 16);
      const cps = hexToCodePoints(t[2]);
      out.push({ cid, codePoints: cps });
    }
  }
  // bfrange blocks: <SRC_LO> <SRC_HI> <DST> | <SRC_LO> <SRC_HI> [ <…> ]
  const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrangeRe.exec(text)) !== null) {
    const body = m[1];
    // Form 1: <lo> <hi> <dst>  — destination starts at dst, increments by 1
    const form1 = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let r: RegExpExecArray | null;
    while ((r = form1.exec(body)) !== null) {
      const lo = parseInt(r[1], 16);
      const hi = parseInt(r[2], 16);
      const dstHex = r[3];
      const dstStart = parseInt(dstHex, 16);
      for (let cid = lo, i = 0; cid <= hi; cid++, i++) {
        out.push({ cid, codePoints: [dstStart + i] });
      }
    }
    // Form 2: <lo> <hi> [ <a> <b> <c> ]
    const form2 = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[(.*?)\]/gs;
    while ((r = form2.exec(body)) !== null) {
      const lo = parseInt(r[1], 16);
      const arr = r[3];
      const inner = /<([0-9a-fA-F]+)>/g;
      let inn: RegExpExecArray | null;
      let i = 0;
      while ((inn = inner.exec(arr)) !== null) {
        out.push({ cid: lo + i, codePoints: hexToCodePoints(inn[1]) });
        i++;
      }
    }
  }
  return out;
}

function hexToCodePoints(hex: string): number[] {
  // Hex strings in CMap dst can encode UTF-16BE — pairs of bytes, surrogates handled.
  if (hex.length % 4 !== 0) {
    // Single byte fallback
    return [parseInt(hex, 16)];
  }
  const cps: number[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    const u = parseInt(hex.slice(i, i + 4), 16);
    if (u >= 0xd800 && u <= 0xdbff && i + 8 <= hex.length) {
      const low = parseInt(hex.slice(i + 4, i + 8), 16);
      cps.push(0x10000 + ((u - 0xd800) << 10) + (low - 0xdc00));
      i += 4;
    } else {
      cps.push(u);
    }
  }
  return cps;
}
