import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PdfDoc } from "@/pdf/render/pdfTypes";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// pdf.js AnnotationMode.ENABLE_FORMS: render non-form annotations, but
// leave AcroForm widgets for the display/edit layer. pdfjs-dist does
// not expose a stable TS enum import in our setup, so keep the numeric
// value centralized here instead of scattering a magic 2.
export const PDFJS_ANNOTATION_MODE_ENABLE_FORMS = 2;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}
