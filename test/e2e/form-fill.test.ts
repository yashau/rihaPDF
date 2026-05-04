// AcroForm fill round-trip. Loads the MNU job-application form,
// types Latin + Thaana into two text fields, saves, and asserts the
// saved PDF has the expected /V values reachable from /AcroForm/Fields.
//
// We assert on the AcroForm tree's structure (/V on each filled
// field, /NeedAppearances true on the AcroForm dict, top-level
// /Fields populated) rather than on rendering — viewers regenerate
// appearances from /DA + /V once /NeedAppearances is set, and /V
// being present + correctly addressed is what guarantees the saved
// PDF is a valid filled form for any reader.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFObject,
  PDFString,
} from "pdf-lib";
import {
  FIXTURE,
  SCREENSHOTS,
  loadFixture,
  setupBrowser,
  tearDown,
  type Harness,
} from "../helpers/browser";

let h: Harness;

beforeAll(async () => {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  h = await setupBrowser();
});

afterAll(async () => {
  if (h) await tearDown(h);
});

function decodeText(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return null;
}

function partialName(d: PDFDict): string | null {
  return decodeText(d.lookup(PDFName.of("T")));
}

/** Walk /AcroForm/Fields to find a terminal field by fully-qualified
 *  name (parts joined with `.`). Mirrors `findFieldByName` in
 *  saveFormFields.ts so the assertion uses the same name-resolution
 *  rules the writer used. */
function findFieldByName(catalog: PDFDict, fullName: string): PDFDict | null {
  const acroForm = catalog.lookup(PDFName.of("AcroForm"));
  if (!(acroForm instanceof PDFDict)) return null;
  const fields = acroForm.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return null;
  const parts = fullName.split(".");
  function walk(d: PDFDict, idx: number): PDFDict | null {
    const partial = partialName(d);
    let next = idx;
    if (partial !== null) {
      if (partial !== parts[idx]) return null;
      next = idx + 1;
    }
    if (next === parts.length) return d;
    const kids = d.lookup(PDFName.of("Kids"));
    if (!(kids instanceof PDFArray)) return null;
    for (let i = 0; i < kids.size(); i++) {
      const k = kids.lookup(i);
      if (k instanceof PDFDict) {
        const f = walk(k, next);
        if (f) return f;
      }
    }
    return null;
  }
  for (let i = 0; i < fields.size(); i++) {
    const top = fields.lookup(i);
    if (top instanceof PDFDict) {
      const f = walk(top, 0);
      if (f) return f;
    }
  }
  return null;
}

describe("AcroForm fills (MNU job-application)", () => {
  test("Latin + Thaana text fields round-trip through /V", async () => {
    await loadFixture(h, FIXTURE.mnuJobApplication);
    // Wait for the FormFieldLayer overlays to render — the load helper
    // only waits for [data-page-index] + canvas, the form overlays
    // mount as part of the same React commit but want a brief beat
    // before we start typing.
    await h.page.waitForSelector('[data-form-field="fill_1"]', { timeout: 5_000 });

    const LATIN_FIELD = "fill_1";
    const LATIN_VALUE = "Ibrahim Yashau";
    const THAANA_FIELD = "fill_86";
    const THAANA_VALUE = "ހުވަދުމަތި";

    await h.page.locator(`[data-form-field="${LATIN_FIELD}"]`).first().fill(LATIN_VALUE);
    await h.page.locator(`[data-form-field="${THAANA_FIELD}"]`).first().fill(THAANA_VALUE);
    // Let undo coalesce settle so save sees the latest values.
    await h.page.waitForTimeout(300);

    const [download] = await Promise.all([
      h.page.waitForEvent("download"),
      h.page.getByRole("button", { name: /^Save/i }).click(),
    ]);
    const tmpOut = path.join(tmpdir(), `riha-form-fill-${Date.now()}.pdf`);
    await download.saveAs(tmpOut);

    const bytes = fs.readFileSync(tmpOut);
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"));
    expect(acroForm).toBeInstanceOf(PDFDict);
    const fields = (acroForm as PDFDict).lookup(PDFName.of("Fields"));
    expect(fields).toBeInstanceOf(PDFArray);
    expect((fields as PDFArray).size()).toBeGreaterThan(0);

    const need = (acroForm as PDFDict).lookup(PDFName.of("NeedAppearances"));
    // PDFBool.True stringifies to "true"; either way we want truthy.
    expect(need?.toString()).toBe("true");

    const latinField = findFieldByName(doc.catalog, LATIN_FIELD);
    expect(latinField, `${LATIN_FIELD} missing from saved /AcroForm`).not.toBeNull();
    expect(decodeText(latinField!.lookup(PDFName.of("V")))).toBe(LATIN_VALUE);

    const thaanaField = findFieldByName(doc.catalog, THAANA_FIELD);
    expect(thaanaField, `${THAANA_FIELD} missing from saved /AcroForm`).not.toBeNull();
    expect(decodeText(thaanaField!.lookup(PDFName.of("V")))).toBe(THAANA_VALUE);

    fs.unlinkSync(tmpOut);
  });

  test("re-loading the saved PDF re-extracts the same fills", async () => {
    // Round-trip in the OTHER direction: open, fill, save, then load
    // the saved file back into the app and confirm the FormFieldLayer
    // shows the previously-typed values. Catches regressions where
    // /V is written but not re-read on extraction (the loader's
    // `decodeText` UTF-16BE path is the obvious break-point).
    await loadFixture(h, FIXTURE.mnuJobApplication);
    await h.page.waitForSelector('[data-form-field="fill_1"]', { timeout: 5_000 });
    const VALUE = "ޓެސްޓް"; // "Test" in Thaana
    await h.page.locator(`[data-form-field="fill_1"]`).first().fill(VALUE);
    await h.page.waitForTimeout(300);
    const [download] = await Promise.all([
      h.page.waitForEvent("download"),
      h.page.getByRole("button", { name: /^Save/i }).click(),
    ]);
    const tmpOut = path.join(tmpdir(), `riha-form-fill-reload-${Date.now()}.pdf`);
    await download.saveAs(tmpOut);

    await loadFixture(h, tmpOut);
    await h.page.waitForSelector('[data-form-field="fill_1"]', { timeout: 5_000 });
    // The overlay's `value` prop reads from the FormField's pre-parsed
    // `value` since formValues is fresh on a new load. inputValue() is
    // the React-controlled input's live value.
    const reloaded = await h.page.locator(`[data-form-field="fill_1"]`).first().inputValue();
    expect(reloaded).toBe(VALUE);

    fs.unlinkSync(tmpOut);
  });
});
