import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFName, PDFString, PDFDocument } from "pdf-lib";
import type { Redaction } from "@/domain/redactions";
import { applyRedactionsToFormWidgets } from "@/pdf/save/redactions/forms";

function redaction(pdfX: number, pdfY: number, pdfWidth: number, pdfHeight: number): Redaction {
  return {
    id: "r1",
    sourceKey: "source",
    pageIndex: 0,
    pdfX,
    pdfY,
    pdfWidth,
    pdfHeight,
  };
}

function makeTextField(doc: PDFDocument, name: string, rect: number[]) {
  const normalAppearance = doc.context.register(doc.context.obj({ Type: PDFName.of("XObject") }));
  const appearance = doc.context.register(doc.context.obj({ N: normalAppearance }));
  const widget = doc.context.obj({
    Type: PDFName.of("Annot"),
    Subtype: PDFName.of("Widget"),
    Rect: rect,
    AP: appearance,
    AS: PDFName.of("On"),
  });
  const field = doc.context.obj({
    FT: PDFName.of("Tx"),
    T: PDFString.of(name),
    V: PDFString.of(`${name}-value`),
    DV: PDFString.of(`${name}-default`),
    AA: doc.context.obj({ K: PDFString.of("script") }),
    Kids: [widget],
  });
  if (!(field instanceof PDFDict) || !(widget instanceof PDFDict)) {
    throw new Error("failed to build field");
  }
  const fieldRef = doc.context.register(field);
  widget.set(PDFName.of("Parent"), fieldRef);
  return { field, fieldRef, widget };
}

describe("form widget redaction", () => {
  it("removes all widgets for a redacted field and scrubs field values", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const redacted = makeTextField(doc, "secret", [10, 10, 50, 30]);
    const kept = makeTextField(doc, "public", [100, 100, 150, 130]);
    page.node.set(PDFName.of("Annots"), doc.context.obj([redacted.widget, kept.widget]));
    doc.catalog.set(
      PDFName.of("AcroForm"),
      doc.context.obj({ Fields: [redacted.fieldRef, kept.fieldRef] }),
    );

    applyRedactionsToFormWidgets(doc, new Map([[0, [redaction(15, 15, 10, 10)]]]));

    const annots = page.node.lookup(PDFName.of("Annots"));
    expect(annots).toBeInstanceOf(PDFArray);
    expect((annots as PDFArray).size()).toBe(1);
    expect((annots as PDFArray).lookup(0)).toBe(kept.widget);

    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
    expect(acroForm).toBeInstanceOf(PDFDict);
    const fields = (acroForm as PDFDict).lookup(PDFName.of("Fields"));
    expect(fields).toBeInstanceOf(PDFArray);
    expect((fields as PDFArray).size()).toBe(1);
    expect((fields as PDFArray).get(0)).toBe(kept.fieldRef);

    expect(redacted.field.get(PDFName.of("V"))).toBeUndefined();
    expect(redacted.field.get(PDFName.of("DV"))).toBeUndefined();
    expect(redacted.field.get(PDFName.of("AA"))).toBeUndefined();
    expect(redacted.widget.get(PDFName.of("AP"))).toBeUndefined();
    expect(redacted.widget.get(PDFName.of("AS"))).toBeUndefined();
    expect(kept.field.lookup(PDFName.of("V"))).toEqual(PDFString.of("public-value"));
  });

  it("removes sibling widgets on other pages for the same redacted field", async () => {
    const doc = await PDFDocument.create();
    const page1 = doc.addPage([200, 200]);
    const page2 = doc.addPage([200, 200]);
    const field = makeTextField(doc, "shared", [10, 10, 50, 30]);
    const secondWidget = doc.context.obj({
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      Rect: [100, 100, 150, 130],
      Parent: field.fieldRef,
    });
    if (!(secondWidget instanceof PDFDict)) throw new Error("failed to build sibling widget");
    const kids = field.field.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) throw new Error("field kids missing");
    kids.push(secondWidget);
    page1.node.set(PDFName.of("Annots"), doc.context.obj([field.widget]));
    page2.node.set(PDFName.of("Annots"), doc.context.obj([secondWidget]));
    doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: [field.fieldRef] }));

    applyRedactionsToFormWidgets(doc, new Map([[0, [redaction(15, 15, 10, 10)]]]));

    expect(page1.node.lookup(PDFName.of("Annots"))).toBeUndefined();
    expect(page2.node.lookup(PDFName.of("Annots"))).toBeUndefined();
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
    expect(acroForm).toBeInstanceOf(PDFDict);
    expect((acroForm as PDFDict).lookup(PDFName.of("Fields"))).toBeUndefined();
    expect(field.field.get(PDFName.of("V"))).toBeUndefined();
  });
});
