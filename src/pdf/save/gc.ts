import { PDFArray, PDFDict, PDFDocument, PDFRef } from "pdf-lib";

/** Remove indirect objects that are no longer reachable from the PDF trailer.
 *
 * pdf-lib serializes every object still registered in `PDFContext`, even if a
 * page resource/name was pruned. After redaction removes or replaces an
 * XObject, leaving the old indirect object in the context can make its bytes
 * recoverable from the saved file. This is a conservative mark-and-sweep over
 * normal PDF references: only objects reachable from trailer roots (Root, Info,
 * etc.) survive. */
export function gcUnreachablePdfObjects(doc: PDFDocument): void {
  const context = doc.context;
  const reachable = new Set<string>();

  const visit = (obj: unknown): void => {
    if (!obj) return;

    if (obj instanceof PDFRef) {
      const tag = obj.toString();
      if (reachable.has(tag)) return;
      reachable.add(tag);
      visit(context.lookup(obj));
      return;
    }

    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) visit(obj.get(i));
      return;
    }

    if (obj instanceof PDFDict) {
      for (const [, value] of obj.entries()) visit(value);
      return;
    }

    if (typeof obj === "object" && "dict" in obj) {
      const dict = (obj as { dict?: unknown }).dict;
      if (dict instanceof PDFDict) visit(dict);
    }
  };

  for (const value of Object.values(context.trailerInfo)) visit(value);

  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) context.delete(ref);
  }
}
