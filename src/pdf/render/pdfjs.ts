import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { PdfDoc } from "@/pdf/render/pdfTypes";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadPdf(data: ArrayBuffer): Promise<PdfDoc> {
  return pdfjsLib.getDocument({ data }).promise;
}
