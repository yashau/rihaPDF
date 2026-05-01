// Light-weight loader for "insert from PDF": just renders each page to
// a canvas via pdf.js — no font/glyph/image extraction, since external
// pages are read-only in v1. The bytes are returned alongside so the
// save pipeline can copyPages out of them.

import { loadPdf, renderPage, type RenderedPage } from "./pdf";

export async function loadExternalPdf(
  file: File,
  scale: number,
): Promise<{
  bytes: ArrayBuffer;
  rendered: RenderedPage[];
  /** Stable identifier for cache keys. Derived from file name + size +
   *  a session-local nonce so re-uploading the same file in the same
   *  session reuses cached renders, but a fresh session gets a fresh
   *  key (avoids stale-cache cross-talk if file content drifted). */
  sourceKey: string;
}> {
  const buf = await file.arrayBuffer();
  const forPdfJs = buf.slice(0);
  const forSave = buf.slice(0);
  const doc = await loadPdf(forPdfJs);
  const rendered: RenderedPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      rendered.push(await renderPage(page, scale));
    }
  } finally {
    void doc.destroy();
  }
  const sourceKey = `${file.name}:${forSave.byteLength}:${nextNonce()}`;
  return { bytes: forSave, rendered, sourceKey };
}

let nonce = 0;
function nextNonce() {
  nonce += 1;
  return nonce.toString(36);
}
