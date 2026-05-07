import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { parseContentStream } from "@/pdf/content/contentStream";
import { planRedactionStrip, readFontMetrics, resolveFontDict } from "@/pdf/save/redactions/glyphs";

async function simpleFontResources() {
  const doc = await PDFDocument.create();
  const font = doc.context.obj({
    Type: PDFName.of("Font"),
    Subtype: PDFName.of("TrueType"),
    BaseFont: PDFName.of("UnitTestFont"),
    FirstChar: 65,
    Widths: [600, 600, 600, 600],
    FontDescriptor: {
      Type: PDFName.of("FontDescriptor"),
      FontName: PDFName.of("UnitTestFont"),
      MissingWidth: 500,
    },
  });
  const resources = doc.context.obj({
    Font: {
      F1: font,
    },
  });

  if (!(font instanceof PDFDict) || !(resources instanceof PDFDict)) {
    throw new Error("failed to build test font resources");
  }

  return { ctx: doc.context, font, resources };
}

describe("redaction glyph metrics", () => {
  it("reads simple-font widths and missing-width fallback", async () => {
    const { ctx, font, resources } = await simpleFontResources();

    expect(resolveFontDict(resources, "F1", ctx)).toBe(font);
    expect(readFontMetrics(font, ctx)).toMatchObject({
      bytesPerGlyph: 1,
      defaultWidth: 500,
      twAppliesToSpace: true,
    });
    expect(readFontMetrics(font, ctx)?.widthByGid.get(66)).toBe(600);
  });
});

describe("redaction glyph strip planning", () => {
  it("rewrites only the covered glyphs in a multi-glyph Tj", async () => {
    const { ctx, resources } = await simpleFontResources();
    const ops = parseContentStream(
      new TextEncoder().encode("BT /F1 10 Tf 1 0 0 1 100 200 Tm (ABCD) Tj ET"),
    );

    const plans = planRedactionStrip(ops, resources, ctx, [
      { pdfX: 106.1, pdfY: 199, pdfWidth: 11.8, pdfHeight: 12 },
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: "rewrite", opIndex: 3 });
    if (plans[0]?.kind !== "rewrite") return;

    expect(plans[0].replacement.op).toBe("TJ");
    const array = plans[0].replacement.operands[0];
    expect(array?.kind).toBe("array");
    if (array?.kind !== "array") return;
    expect(array.items).toEqual([
      { kind: "hex-string", bytes: new Uint8Array([0x41]) },
      { kind: "number", value: -1200, raw: "-1200.000" },
      { kind: "hex-string", bytes: new Uint8Array([0x44]) },
    ]);
  });

  it("marks unsupported fonts so callers can whole-op strip safely", async () => {
    const doc = await PDFDocument.create();
    const unsupportedFont = doc.context.obj({
      Type: PDFName.of("Font"),
      Subtype: PDFName.of("Type0"),
      Encoding: PDFName.of("Custom-CMap"),
    });
    const resources = doc.context.obj({ Font: { F1: unsupportedFont } });
    if (!(resources instanceof PDFDict)) throw new Error("failed to build resources");
    const ops = parseContentStream(
      new TextEncoder().encode("BT /F1 10 Tf 1 0 0 1 100 200 Tm <0001> Tj ET"),
    );

    expect(
      planRedactionStrip(ops, resources, doc.context, [
        { pdfX: 100, pdfY: 200, pdfWidth: 20, pdfHeight: 20 },
      ]),
    ).toEqual([{ kind: "unsupported", opIndex: 3 }]);
  });
});
