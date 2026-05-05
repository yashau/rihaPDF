import { PDFContext, PDFDict, PDFFont, PDFHexString, PDFName, PDFRef, PDFString } from "pdf-lib";

export type EmbeddedPdfFont = {
  pdfFont: PDFFont;
  bytes: Uint8Array | null;
};

export type EmbeddedFontFactory = (
  family: string,
  bold?: boolean,
  italic?: boolean,
) => Promise<EmbeddedPdfFont>;

export type AcroFormDoc = {
  context: PDFContext;
  catalog: PDFDict;
};

export type ResolvedAcroFormFont = {
  pdfFont: PDFFont;
  fontBytes: Uint8Array | null;
  alias: string;
};

export type AcroFormFontSetup = {
  ensureFont(): Promise<ResolvedAcroFormFont | null>;
};

export function encodeUtf16BE(s: string): PDFHexString {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xffff) {
      bytes.push((cp >> 8) & 0xff, cp & 0xff);
    } else {
      const off = cp - 0x10000;
      const hi = 0xd800 + (off >> 10);
      const lo = 0xdc00 + (off & 0x3ff);
      bytes.push((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return PDFHexString.of(hex);
}

export function isPdfAsciiSafe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

export function encodePdfTextString(s: string): PDFString | PDFHexString {
  return isPdfAsciiSafe(s) ? PDFString.of(s) : encodeUtf16BE(s);
}

export function ensureAcroForm(doc: AcroFormDoc): PDFDict {
  const existing = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (existing instanceof PDFDict) return existing;
  const acroForm = PDFDict.withContext(doc.context);
  doc.catalog.set(PDFName.of("AcroForm"), acroForm);
  return acroForm;
}

export function registerAcroFormFont(doc: AcroFormDoc, alias: string, fontRef: PDFRef): void {
  const acroForm = ensureAcroForm(doc);
  const existingDr = acroForm.lookup(PDFName.of("DR"));
  let dr: PDFDict;
  if (existingDr instanceof PDFDict) {
    dr = existingDr;
  } else {
    dr = PDFDict.withContext(doc.context);
    acroForm.set(PDFName.of("DR"), dr);
  }
  const existingFontDict = dr.lookup(PDFName.of("Font"));
  let fontDict: PDFDict;
  if (existingFontDict instanceof PDFDict) {
    fontDict = existingFontDict;
  } else {
    fontDict = PDFDict.withContext(doc.context);
    dr.set(PDFName.of("Font"), fontDict);
  }
  const aliasName = PDFName.of(alias);
  if (!fontDict.has(aliasName)) {
    fontDict.set(aliasName, fontRef);
  }
}

export function makeAcroFormFontSetup(
  doc: AcroFormDoc,
  getFont: EmbeddedFontFactory,
  {
    family = "Faruma",
    alias = "RihaThaana",
    requireBytes = true,
  }: {
    family?: string;
    alias?: string;
    requireBytes?: boolean;
  } = {},
): AcroFormFontSetup {
  let cached: ResolvedAcroFormFont | null | undefined = undefined;
  return {
    async ensureFont() {
      if (cached !== undefined) return cached;
      const embedded = await getFont(family);
      if (requireBytes && !embedded.bytes) {
        cached = null;
        return cached;
      }
      registerAcroFormFont(doc, alias, embedded.pdfFont.ref);
      cached = {
        pdfFont: embedded.pdfFont,
        fontBytes: embedded.bytes,
        alias,
      };
      return cached;
    },
  };
}
