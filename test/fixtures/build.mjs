// Generate test fixtures used by the E2E suite.
//
// Outputs (idempotent — re-running overwrites):
//   - test/fixtures/with-images.pdf
//       A 595×842 (A4) page with two PNG images placed at known
//       positions, plus a tiny piece of text. Used by the image-move
//       and preview-strip tests so we don't depend on any real-world
//       PDF for the imageful test path.
//
// We DO NOT regenerate test/fixtures/maldivian.pdf — that's the
// canonical Dhivehi government doc the Thaana-recovery and edit/move
// tests are pinned against. It's committed as-is.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
