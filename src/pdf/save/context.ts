import { PDFDocument, PDFFont, StandardFonts } from "pdf-lib";
import type { LoadedSource } from "@/pdf/source/loadSource";
import { fontDefinitionForFamily, loadFontBytes } from "@/pdf/text/fonts";

export type EmbeddedFontFactory = (
  family: string,
  bold?: boolean,
  italic?: boolean,
) => Promise<EmbeddedFont>;

export type LoadedSourceContext = {
  /** Origin source. Absent for synthetic per-blank-slot ctxs — those
   *  never go through stream surgery (no source runs / images / shapes
   *  to manipulate), so the page-extracted state isn't needed. */
  source?: LoadedSource;
  doc: PDFDocument;
  getFont: EmbeddedFontFactory;
};

const standardFontVariants: Record<
  "Helvetica" | "TimesRoman" | "Courier",
  Record<"regular" | "bold" | "italic" | "boldItalic", StandardFonts>
> = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};
const variantKey = (bold: boolean, italic: boolean) =>
  bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular";

/** Standard italic slant: tan(~12°). Used to synthesize italic for fonts
 *  that don't ship a real italic variant (every bundled Dhivehi family). */
export const ITALIC_SHEAR = 0.21;

/** True iff `family` resolves to a Standard 14 font that has a real
 *  italic / oblique variant we picked in `makeFontFactory`. For those,
 *  italic is rendered by the variant's own glyph shapes — no shear
 *  needed. For everything else (every bundled Dhivehi TTF) we synthesize
 *  italic via a Tm-equivalent shear `cm`. */
export function fontHasNativeItalic(family: string): boolean {
  const def = fontDefinitionForFamily(family);
  return !!def?.standardFont;
}

/** Cached per-(family, bold, italic) embedded font factory bound to a
 *  single PDFDocument — fonts can't be shared across docs because each
 *  doc owns its own object table. The save loop builds one of these
 *  per loaded source.
 *
 *  Returns both the embedded `PDFFont` and the raw TTF bytes. The bytes
 *  are needed by the HarfBuzz emitter so its glyph IDs match the CIDs
 *  pdf-lib will write (subset:false embeds the bytes verbatim and uses
 *  CIDToGIDMap=Identity, so HB GID == output CID). Standard-14 fonts
 *  have no TTF — `bytes` is null for those, signalling the caller to
 *  fall back to pdf-lib's drawText / widthOfTextAtSize. */
export type EmbeddedFont = {
  pdfFont: PDFFont;
  /** Raw TTF bytes, or null for standard-14 fonts. */
  bytes: Uint8Array | null;
};

export function makeFontFactory(doc: PDFDocument) {
  const cache = new Map<string, EmbeddedFont>();
  return async (family: string, bold = false, italic = false): Promise<EmbeddedFont> => {
    const cacheKey = `${family}|${bold ? "b" : ""}${italic ? "i" : ""}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const def = fontDefinitionForFamily(family);
    let entry: EmbeddedFont;
    if (def?.standardFont) {
      const variant = standardFontVariants[def.standardFont][variantKey(bold, italic)];
      const pdfFont = await doc.embedFont(variant);
      entry = { pdfFont, bytes: null };
    } else {
      const bytes = await loadFontBytes(family);
      const pdfFont = await doc.embedFont(bytes, {
        subset: false,
        customName: `DhivehiEdit_${family.replace(/\W+/g, "_")}`,
      });
      entry = { pdfFont, bytes };
    }
    cache.set(cacheKey, entry);
    return entry;
  };
}
