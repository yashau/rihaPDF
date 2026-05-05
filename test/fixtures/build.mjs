// Generate test fixtures used by the E2E suite.
//
// Outputs (idempotent — re-running overwrites):
//   - test/fixtures/with-images.pdf
//       A 595×842 (A4) page with two PNG images placed at known
//       positions, plus a tiny piece of text. Used by the image-move
//       and preview-strip tests so we don't depend on any real-world
//       PDF for the imageful test path.
//   - test/fixtures/with-shapes.pdf
//       A 595×842 page with a known horizontal rule, a filled
//       rectangle, and a label. Used by the shape-delete test.
//
// We DO NOT regenerate test/fixtures/maldivian.pdf — that's the
// canonical Dhivehi government doc the Thaana-recovery and edit/move
// tests are pinned against. It's committed as-is.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DATE = new Date("2024-01-01T00:00:00.000Z");

/** @param {PDFDocument} doc */
function freezePdfMetadata(doc) {
  doc.setCreationDate(FIXTURE_DATE);
  doc.setModificationDate(FIXTURE_DATE);
}

// Two distinguishable solid-color PNGs so per-image asserts can tell
// them apart even after a save/reload roundtrip. Pre-encoded base64 to
// avoid a build-time dependency on a PNG encoder.
//   1×1 red:    rgb(220, 30, 30)
//   1×1 blue:   rgb(30, 80, 220)
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAFUlEQVR4nGP8z8AARMQDxlGNAxoAAH7vAv9OUszhAAAAAElFTkSuQmCC",
  "base64",
);
const BLUE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==",
  "base64",
);

const doc = await PDFDocument.create();
freezePdfMetadata(doc);
const page = doc.addPage([595, 842]);
const helv = await doc.embedFont(StandardFonts.Helvetica);
page.drawText("E2E test fixture (with images).", {
  x: 50,
  y: 800,
  size: 14,
  font: helv,
  color: rgb(0, 0, 0),
});

const red = await doc.embedPng(RED_PNG);
const blue = await doc.embedPng(BLUE_PNG);
// Stretch the 1×1 source to a generous rectangle so click targets are
// large enough for Playwright to hit reliably. Positions are in PDF
// user space (y-up).
page.drawImage(red, { x: 100, y: 600, width: 200, height: 100 });
page.drawImage(blue, { x: 100, y: 400, width: 150, height: 80 });

const out = path.join(__dirname, "with-images.pdf");
fs.writeFileSync(out, await doc.save());
console.log("wrote", out, fs.statSync(out).size, "bytes");

// Two-page fixture for cross-page move tests. Page 1 carries one image
// + one text label; page 2 is blank-ish (a single label so the cross-
// page text test has SOMETHING to find on page 2 if it needs context).
// The cross-page tests drag content from page 1 to page 2 and verify
// the saved PDF reflects the move.
{
  const doc2 = await PDFDocument.create();
  freezePdfMetadata(doc2);
  const helv2 = await doc2.embedFont(StandardFonts.Helvetica);
  const red2 = await doc2.embedPng(RED_PNG);
  const blue2 = await doc2.embedPng(BLUE_PNG);

  const p1 = doc2.addPage([595, 842]);
  p1.drawText("CROSS_PAGE_FIXTURE_P1", {
    x: 50,
    y: 800,
    size: 14,
    font: helv2,
    color: rgb(0, 0, 0),
  });
  // One image on page 1 — the cross-page image test drags it to page 2.
  p1.drawImage(red2, { x: 100, y: 500, width: 180, height: 100 });

  const p2 = doc2.addPage([595, 842]);
  p2.drawText("CROSS_PAGE_FIXTURE_P2", {
    x: 50,
    y: 800,
    size: 14,
    font: helv2,
    color: rgb(0, 0, 0),
  });
  // One image on page 2 too so cross-page image asserts can distinguish
  // a moved image from native-on-page-2 by ID rather than by position.
  p2.drawImage(blue2, { x: 350, y: 500, width: 120, height: 80 });

  const out2 = path.join(__dirname, "with-images-multipage.pdf");
  fs.writeFileSync(out2, await doc2.save());
  console.log("wrote", out2, fs.statSync(out2).size, "bytes");
}

// External-pdf-fixture for the "+ From PDF" first-class-pages tests.
// Two pages with distinct labels + a green image on page 2 so the
// external-page edit/insert/move tests can identify content after a
// save+reload through copyPages out of an external source.
{
  const docExt = await PDFDocument.create();
  freezePdfMetadata(docExt);
  const helvE = await docExt.embedFont(StandardFonts.Helvetica);
  const greenPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAtIbi/wAAAABJRU5ErkJggg==",
    "base64",
  );
  const green = await docExt.embedPng(greenPng);

  const ep1 = docExt.addPage([595, 842]);
  ep1.drawText("EXTERNAL_FIXTURE_P1", {
    x: 50,
    y: 800,
    size: 14,
    font: helvE,
    color: rgb(0, 0, 0),
  });
  // Place an editable run mid-page so the edit-on-external test has a
  // run it can double-click and replace.
  ep1.drawText("EXT_EDIT_ME_RUN", {
    x: 50,
    y: 600,
    size: 16,
    font: helvE,
    color: rgb(0, 0, 0),
  });

  const ep2 = docExt.addPage([595, 842]);
  ep2.drawText("EXTERNAL_FIXTURE_P2", {
    x: 50,
    y: 800,
    size: 14,
    font: helvE,
    color: rgb(0, 0, 0),
  });
  // Image on page 2 lets the move-on-external test drag it.
  ep2.drawImage(green, { x: 100, y: 500, width: 200, height: 120 });

  const outExt = path.join(__dirname, "external-source.pdf");
  fs.writeFileSync(outExt, await docExt.save());
  console.log("wrote", outExt, fs.statSync(outExt).size, "bytes");
}

// Vector-shape fixture for the shape-delete test. Two distinct shapes
// — a horizontal rule (line) at a known y, and a filled rectangle at
// another known y — let the test target one of them by hit-position
// while leaving the other in place to assert the delete is scoped.
{
  const docS = await PDFDocument.create();
  freezePdfMetadata(docS);
  const helvS = await docS.embedFont(StandardFonts.Helvetica);
  const ps = docS.addPage([595, 842]);
  ps.drawText("SHAPES_FIXTURE", {
    x: 50,
    y: 800,
    size: 14,
    font: helvS,
    color: rgb(0, 0, 0),
  });
  // Horizontal rule.
  ps.drawLine({
    start: { x: 100, y: 600 },
    end: { x: 400, y: 600 },
    thickness: 2,
    color: rgb(0, 0, 0),
  });
  // Filled rectangle (different shape so the test can target one
  // without touching the other).
  ps.drawRectangle({
    x: 100,
    y: 300,
    width: 200,
    height: 80,
    color: rgb(0.2, 0.6, 0.2),
  });

  const outS = path.join(__dirname, "with-shapes.pdf");
  fs.writeFileSync(outS, await docS.save());
  console.log("wrote", outS, fs.statSync(outS).size, "bytes");
}
